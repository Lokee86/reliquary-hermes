"""Context-bound, nonblocking Hermes callback handoff to the durable outbox."""

from collections import deque
from threading import Event, Lock
from time import monotonic

from agent.memory_provider import spawn_context_thread

from .client import HostUnavailable
from .outbox import REMOVAL_PENDING, SourceOutbox, SourceOutboxError
from .source_removals import reconcile_configured_removals
from .validation import ContractError


class SourceWorker:
    def __init__(self, settings, client, *, manual_only=False):
        self._settings = settings
        self._manual_only = manual_only
        self._processing = set()
        self._last_heartbeat = 0
        self._client = client
        self._lock = Lock()
        self._wake = Event()
        self._captures = deque()
        self._session = None
        self._capture_allowed = False
        self._generation = None
        self._capture_block = None
        self._fenced = set()
        self._recheck = set()
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

    @property
    def running(self):
        return self._thread.is_alive()

    def set_scope(self, session_id, *, capture_allowed):
        with self._lock:
            if (self._session, self._capture_allowed) != (session_id, capture_allowed):
                self._session, self._capture_allowed = session_id, capture_allowed
                self._generation = None
                self._capture_block = None
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
            if self._stopped or not self._capture_allowed or snapshot.session_id != self._session:
                return
            if self._capture_block is not None or snapshot.session_id in self._fenced:
                self._status = self._capture_block or "source_reconciliation_required"
                return
            if len(self._captures) >= 8:
                self._status = "source_outbox_full"
                return
            epoch = self._fence_epochs.get(snapshot.session_id)
            candidate = (self._runtime_lease, epoch) if epoch is not None else (None, None)
            # Hermes may commit its session row during the first turn. If activation
            # just became possible, enqueue still checks the initial generation atomically.
            self._captures.append((snapshot, self._generation or 0, *candidate))
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
                    self._capture_block = "source_reconciliation_required"
                self._fenced.discard(session_id)
        except (OSError, SourceOutboxError, ContractError):
            self._report(session_id, "source_ingestion_unavailable")
        self._wake.set()

    def observe_committed_rewind(self, session_id):
        """The memory callback wakes replay without making the rewind flag an authority."""
        with self._lock:
            self._recheck.add(session_id)
        self._wake.set()

    def unavailable(self, session_id):
        self._report(session_id, "source_ingestion_unavailable")

    def disclosure_cut(self):
        """Fence a selection until the native host has acknowledged known removals."""
        try:
            outbox = self._outbox()
            reconcile_configured_removals(outbox, self._settings)
            return outbox.disclosure_cut()
        except (OSError, SourceOutboxError, ContractError) as error:
            raise HostUnavailable(str(error) if isinstance(error, SourceOutboxError)
                                  else "source_removal_authority_unavailable") from None

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

    def _update_capture(self, outbox, session):
        generation, blocked = outbox.capture_state(session)
        with self._lock:
            if session != self._session or not self._capture_allowed or session in self._fenced:
                return
            if (generation, blocked) != (self._generation, self._capture_block):
                self._status = blocked or (
                    "source_reconciliation_required" if session in self._fence_epochs else "source_ready")
                self._captures = deque(item for item in self._captures if
                                       item[0].session_id != session or (item[1] == generation and not blocked))
            self._generation, self._capture_block = generation, blocked

    def _deliver(self, outbox):
        for _ in range(8):
            with self._lock:
                if self._stopped:
                    return
            job = outbox.next_job(fence_only=True)
            if job is None and self._manual_only:
                job = outbox.next_job(manual_only=True)
            active_session = None
            if job is None and self._manual_only:
                return
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
            if job.kind == "snapshot" and job.manual_owner_id is None and hasattr(self._client, "runtime_has_scope"):
                if not self._client.runtime_has_scope(job.session_id):
                    return
            with self._lock:
                if job.kind == "snapshot" and job.manual_owner_id is None and job.session_id in self._fenced:
                    return
            if not outbox.is_current(job):
                continue
            if job.manual_owner_id is not None:
                self._deliver_manual(outbox, job)
                continue
            try:
                receipt = self._client.deliver_source_job(job)
            except HostUnavailable as error:
                if job.kind in {"rewind", "terminal"}:
                    self._report(job.session_id, REMOVAL_PENDING)
                    return
                if job.lease_id is not None and str(error) in {
                        "source_revision_unreconciled", "source_fence_epoch_stale",
                        "source_terminal", "runtime_lease_stale"}:
                    outbox.discard_candidate(job)
                    self._report(job.session_id, "source_reconciliation_required")
                    continue
                self._report(job.session_id, str(error))
                return
            if outbox.acknowledge(job, receipt):
                if job.kind in {"rewind", "terminal"}:
                    self._update_capture(outbox, job.session_id)
                if job.lease_id is not None:
                    with self._lock:
                        if self._fence_epochs.get(job.session_id) == job.fence_epoch:
                            self._fence_epochs.pop(job.session_id, None)
                status = {
                    "snapshot": "source_accepted_durable",
                    "invalidate": "source_reconciliation_required",
                    "terminal": "source_terminal",
                }.get(job.kind)
                if status is not None:
                    self._report(job.session_id, status)

    def _deliver_manual(self, outbox, job):
        client = self._client
        try:
            if client.runtime_lease_id is None:
                client.connect_dashboard(None)
            if not client.runtime_has_scope(job.session_id) or job.lease_id != client.runtime_lease_id:
                lease, scopes = client.add_runtime_scope(job.session_id)
                outbox.rebind_manual(job, lease_id=lease, fence_epoch=scopes.get(job.session_id))
                return
            receipt = client.deliver_source_job(job)
        except HostUnavailable as error:
            code = str(error)
            if code in {"runtime_lease_stale", "source_reconciliation_required", "source_fence_epoch_stale"}:
                try:
                    lease, scopes = client.add_runtime_scope(job.session_id)
                    if (job.lease_id, job.fence_epoch) != (lease, scopes.get(job.session_id)):
                        outbox.rebind_manual(job, lease_id=lease, fence_epoch=scopes.get(job.session_id))
                        return
                except HostUnavailable:
                    pass
            if code in {"host_unavailable", "host_connection_refused"}:
                self._detach_manual()
            outbox.fail_manual(job, code)
            return
        if outbox.acknowledge(job, receipt):
            self._processing.add(job.session_id)

    def _detach_manual(self):
        try:
            self._client.detach_runtime()
        except (HostUnavailable, OSError, ContractError):
            pass

    def _manual_work_remains(self, outbox):
        # Keep the historical source lease while Root is actively processing.
        for session_id in tuple(self._processing):
            try:
                state = self._client.read_source_status(session_id)["state"]
            except HostUnavailable:
                state = "unavailable"
            if state != "processing":
                self._processing.discard(session_id)
        if not self._processing and not outbox.has_pending_manual() and not outbox.has_pending_removals():
            return False
        now = monotonic()
        if self._client.runtime_lease_id is not None and now - self._last_heartbeat >= 12:
            try:
                self._client.heartbeat_runtime()
                self._last_heartbeat = now
            except HostUnavailable:
                self._detach_manual()
        return True

    def _run(self):
        try:
            self._run_loop()
        finally:
            if self._manual_only:
                self._detach_manual()

    def _run_loop(self):
        outbox = None
        while True:
            self._wake.clear()
            with self._lock:
                session = self._session
                capture_allowed = self._capture_allowed
                stopped = self._stopped
            try:
                if outbox is None:
                    outbox = self._outbox()
                reconcile_configured_removals(outbox, self._settings)
                with self._lock:
                    self._fenced.difference_update(self._recheck)
                    self._recheck.clear()
                if session is not None and capture_allowed:
                    self._update_capture(outbox, session)
                self._persist(outbox)
                if not stopped:
                    self._deliver(outbox)
                if self._manual_only and not self._manual_work_remains(outbox):
                    return
            except (OSError, SourceOutboxError, ContractError):
                self._report(session, "source_outbox_unavailable")
            if stopped:
                return
            self._wake.wait(0.5)
