"""Context-bound, nonblocking Hermes callback handoff to the durable outbox."""

from collections import deque
from threading import Event, Lock

from agent.memory_provider import spawn_context_thread

from .client import HostUnavailable
from .outbox import SourceOutbox, SourceOutboxError
from .validation import ContractError


class SourceWorker:
    def __init__(self, settings, client):
        self._settings = settings
        self._client = client
        self._lock = Lock()
        self._wake = Event()
        self._captures = deque()
        self._session = None
        self._generation = None
        self._fenced = set()
        self._runtime_lease = None
        self._fence_epochs = {}
        self._stopped = False
        self._thread = spawn_context_thread(self._run, name="reliquary-source")
        self._status = "source_ingestion_unavailable"
        self._thread.start()

    def _outbox(self):
        return SourceOutbox(self._settings.state_dir, self._settings.profile_id, self._settings.principal_id)

    @property
    def status(self):
        with self._lock:
            return self._status

    def activate(self, session_id):
        with self._lock:
            if self._session != session_id:
                self._session, self._generation = session_id, None
                self._status = "source_ingestion_unavailable"
        self._wake.set()

    def set_runtime(self, lease_id, reconciliation, *, queried_scope=None):
        with self._lock:
            if lease_id != self._runtime_lease:
                self._fence_epochs.clear()
            self._runtime_lease = lease_id
            if queried_scope is not None:
                self._fence_epochs.pop(queried_scope, None)
            for session_id, epoch in reconciliation.items():
                self._fence_epochs[session_id] = epoch
                if self._session == session_id:
                    self._status = "source_reconciliation_required"

    def submit(self, snapshot):
        with self._lock:
            if self._stopped or snapshot.session_id != self._session or self._generation is None:
                return
            if self._generation or snapshot.session_id in self._fenced:
                self._status = "source_reconciliation_required"
                return
            if len(self._captures) >= 8:
                self._status = "source_outbox_full"
                return
            epoch = self._fence_epochs.get(snapshot.session_id)
            candidate = (self._runtime_lease, epoch) if epoch is not None else (None, None)
            self._captures.append((snapshot, self._generation, *candidate))
            self._status = "source_reconciliation_required" if epoch is not None else "source_capture_pending"
        self._wake.set()

    def pause(self, session_id):
        with self._lock:
            self._fenced.add(session_id)
            self._captures = deque(item for item in self._captures if item[0].session_id != session_id)
            if self._session == session_id:
                self._generation = None
                self._status = "source_reconciliation_required"

    def invalidate(self, session_id):
        try:
            generation = self._outbox().invalidate(session_id)
            with self._lock:
                if self._session == session_id:
                    self._generation = generation
                self._fenced.discard(session_id)
        except (OSError, SourceOutboxError, ContractError):
            self._report(session_id, "source_ingestion_unavailable")
        self._wake.set()

    def unavailable(self, session_id):
        self._report(session_id, "source_ingestion_unavailable")

    def stop(self):
        with self._lock:
            self._stopped = True
        self._wake.set()
        self._thread.join(timeout=15)
        with self._lock:
            return not self._captures and not self._thread.is_alive()

    def _report(self, session, status):
        with self._lock:
            if session == self._session:
                self._status = status

    def _persist(self, outbox):
        while True:
            with self._lock:
                if not self._captures:
                    return
                snapshot, generation, lease_id, fence_epoch = self._captures[0]
            try:
                outbox.enqueue(snapshot, generation=generation, lease_id=lease_id, fence_epoch=fence_epoch)
            except (SourceOutboxError, ContractError) as error:
                self._report(snapshot.session_id, str(error))
                if str(error) in {"source_outbox_unavailable", "source_outbox_full"}:
                    return
            else:
                self._report(snapshot.session_id, "source_queued_durable")
            with self._lock:
                if self._captures and self._captures[0][0] is snapshot:
                    self._captures.popleft()

    def _deliver(self, outbox):
        for _ in range(8):
            with self._lock:
                if self._stopped:
                    return
            job = outbox.next_job(fence_only=True)
            active_session = None
            if job is None:
                with self._lock:
                    active_session = self._session
                if active_session is not None:
                    if hasattr(self._client, "runtime_has_scope"):
                        job = outbox.next_job(active_session, runtime_scope=True,
                                              runtime_lease_id=self._client.runtime_lease_id)
                    else:
                        job = outbox.next_job(active_session)
            if job is None:
                return
            if job.kind == "snapshot" and hasattr(self._client, "runtime_has_scope"):
                if not self._client.runtime_has_scope(job.session_id):
                    return
            with self._lock:
                if job.kind == "snapshot" and job.session_id in self._fenced:
                    return
            if not outbox.is_current(job):
                continue
            try:
                receipt = self._client.deliver_source_job(job)
            except HostUnavailable as error:
                if job.lease_id is not None and str(error) in {
                        "source_revision_unreconciled", "source_fence_epoch_stale",
                        "source_terminal", "runtime_lease_stale"}:
                    outbox.discard_candidate(job)
                    self._report(job.session_id, "source_reconciliation_required")
                    continue
                self._report(job.session_id, str(error))
                return
            if outbox.acknowledge(job, receipt):
                if job.lease_id is not None:
                    with self._lock:
                        if self._fence_epochs.get(job.session_id) == job.fence_epoch:
                            self._fence_epochs.pop(job.session_id, None)
                self._report(job.session_id, {
                    "snapshot": "source_accepted_durable",
                    "invalidate": "source_reconciliation_required",
                    "terminal": "source_terminal",
                }[job.kind])

    def _run(self):
        outbox = None
        while True:
            self._wake.clear()
            with self._lock:
                session = self._session
                stopped = self._stopped
            try:
                if outbox is None:
                    outbox = self._outbox()
                if session is not None:
                    generation = outbox.generation(session)
                    with self._lock:
                        if session == self._session and session not in self._fenced:
                            if self._generation is None:
                                self._status = ("source_reconciliation_required"
                                                if generation or session in self._fence_epochs else "source_ready")
                            self._generation = generation
                self._persist(outbox)
                if not stopped:
                    self._deliver(outbox)
            except (OSError, SourceOutboxError, ContractError):
                self._report(session, "source_outbox_unavailable")
            if stopped:
                return
            self._wake.wait(0.5)
