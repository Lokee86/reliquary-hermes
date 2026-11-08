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
        self._stopped = False
        self._status = "source_ingestion_unavailable"
        spawn_context_thread(self._run, name="reliquary-source").start()

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
            self._captures.append((snapshot, self._generation))
            self._status = "source_capture_pending"
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

    def _report(self, session, status):
        with self._lock:
            if session == self._session:
                self._status = status

    def _persist(self, outbox):
        while True:
            with self._lock:
                if not self._captures:
                    return
                snapshot, generation = self._captures[0]
            try:
                outbox.enqueue(snapshot, generation=generation)
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
            job = outbox.next_job()
            if job is None:
                return
            with self._lock:
                if job.kind == "snapshot" and job.session_id in self._fenced:
                    return
            if not outbox.is_current(job):
                continue
            try:
                receipt = self._client.deliver_source_job(job)
            except HostUnavailable as error:
                self._report(job.session_id, str(error))
                return
            if outbox.acknowledge(job, receipt):
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
                                self._status = "source_reconciliation_required" if generation else "source_ready"
                            self._generation = generation
                self._persist(outbox)
                if not stopped:
                    self._deliver(outbox)
            except (OSError, SourceOutboxError, ContractError):
                self._report(session, "source_outbox_unavailable")
            if stopped:
                return
            self._wake.wait(0.5)
