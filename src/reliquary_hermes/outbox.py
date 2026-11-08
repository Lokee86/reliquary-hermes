"""Private queue for verified Hermes adapter work and acknowledged host receipts."""

from contextlib import closing, contextmanager
from dataclasses import dataclass, field
import os
from pathlib import Path
import sqlite3
import stat

from .source import SourceSnapshot
from .validation import MAX_WIRE_BYTES, canonical, choice, content_digest, decode, identifier, integer, require


BACKPRESSURE = "source_outbox_full"
STALE = "source_generation_stale"
TERMINAL = "source_terminal"
UNAVAILABLE = "source_outbox_unavailable"
_MAX_GENERATION = (1 << 63) - 1
_MAX_SNAPSHOT_BYTES = MAX_WIRE_BYTES - 4096
_MAX_PENDING = 64
_MAX_PENDING_BYTES = 4 * MAX_WIRE_BYTES
_APPLICATION_ID = 0x52484F42


class SourceOutboxError(RuntimeError):
    """Fixed diagnostic for unavailable, full, stale or terminal state."""


@dataclass(frozen=True)
class SourceJob:
    kind: str
    idempotency_key: str
    session_id: str
    generation: int
    snapshot: SourceSnapshot | None = field(repr=False)
    snapshot_json: bytes | None = field(repr=False)
    reason: str | None
    _scope: tuple[str, str] = field(repr=False)


@dataclass(frozen=True)
class SourceCursor:
    session_id: str
    generation: int
    kind: str
    idempotency_key: str
    receipt: str
    snapshot_digest: str | None
    last_message_uid: str | None


_SCHEMA = (
    """CREATE TABLE source_state (
        profile TEXT NOT NULL, principal TEXT NOT NULL, session TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0), terminal_reason TEXT,
        PRIMARY KEY(profile, principal, session)
    ) WITHOUT ROWID""",
    """CREATE TABLE source_jobs (
        sequence INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE,
        profile TEXT NOT NULL, principal TEXT NOT NULL, session TEXT NOT NULL,
        generation INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('snapshot', 'invalidate', 'terminal')),
        reason TEXT, payload BLOB, snapshot_digest TEXT, last_message_uid TEXT, receipt TEXT,
        FOREIGN KEY(profile, principal, session) REFERENCES source_state(profile, principal, session)
    )""",
    """CREATE INDEX source_jobs_pending ON source_jobs(profile, principal, session, sequence)
        WHERE receipt IS NULL""",
    """CREATE INDEX source_jobs_accepted ON source_jobs(profile, principal, session, sequence)
        WHERE receipt IS NOT NULL""",
)


class SourceOutbox:
    """Durable adapter queue. The service still fences requests already in flight."""

    def __init__(self, state_dir: Path, profile_id: str, principal_id: str):
        self._scope = identifier(profile_id), identifier(principal_id)
        directory = Path(state_dir)
        require(directory.is_absolute(), "invalid_state_directory")
        self._path = directory / "source-outbox-v1.sqlite3"
        try:
            if not stat.S_ISDIR(directory.lstat().st_mode):
                raise SourceOutboxError(UNAVAILABLE)
            try:
                fd = os.open(self._path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                pass
            else:
                os.close(fd)
            mode = self._path.lstat().st_mode
            if not stat.S_ISREG(mode) or (os.name != "nt" and mode & 0o077):
                raise SourceOutboxError(UNAVAILABLE)
        except OSError:
            raise SourceOutboxError(UNAVAILABLE) from None
        with self._transaction(write=True) as db:
            application = db.execute("PRAGMA application_id").fetchone()[0]
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if (application, version) == (0, 0):
                if db.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone():
                    raise SourceOutboxError(UNAVAILABLE)
                for statement in _SCHEMA:
                    db.execute(statement)
                db.execute(f"PRAGMA application_id = {_APPLICATION_ID}")
                db.execute("PRAGMA user_version = 1")
            elif (application, version) != (_APPLICATION_ID, 1):
                raise SourceOutboxError(UNAVAILABLE)

    @contextmanager
    def _transaction(self, *, write=False):
        try:
            # mode=rw fences an accidentally removed queue instead of opening a new empty database.
            address = self._path.as_uri() + "?mode=rw"
            with closing(sqlite3.connect(address, uri=True, timeout=0.2, isolation_level=None)) as db:
                db.row_factory = sqlite3.Row
                db.execute("PRAGMA foreign_keys = ON")
                db.execute("PRAGMA synchronous = FULL")
                db.execute("PRAGMA secure_delete = ON")
                db.execute("PRAGMA temp_store = MEMORY")
                db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
                yield db
                db.commit()
        except (OSError, sqlite3.Error):
            raise SourceOutboxError(UNAVAILABLE) from None

    def _state(self, db, session_id):
        row = db.execute(
            "SELECT generation, terminal_reason FROM source_state WHERE profile=? AND principal=? AND session=?",
            (*self._scope, session_id),
        ).fetchone()
        return (0, None) if row is None else (row["generation"], row["terminal_reason"])

    def _ensure_state(self, db, session_id):
        db.execute(
            "INSERT INTO source_state(profile, principal, session) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
            (*self._scope, session_id),
        )

    def _key(self, kind, session_id, generation, snapshot_digest=None):
        return content_digest(["hermes-source-outbox-v1", *self._scope, session_id, kind, generation, snapshot_digest])

    def generation(self, session_id: str) -> int:
        with self._transaction() as db:
            return self._state(db, identifier(session_id))[0]

    def enqueue(self, snapshot: SourceSnapshot, *, generation: int) -> str:
        """Persist a current snapshot for an exact adapter generation."""
        require(type(snapshot) is SourceSnapshot, "invalid_source_snapshot")
        require(snapshot.profile_id == self._scope[0], "source_scope_mismatch")
        snapshot.require_current()
        session = identifier(snapshot.session_id)
        integer(generation, 0, _MAX_GENERATION)
        payload, last_uid = _snapshot_payload(snapshot)
        key = self._key("snapshot", session, generation, snapshot.snapshot_digest)
        with self._transaction(write=True) as db:
            current, terminal = self._state(db, session)
            if terminal is not None:
                raise SourceOutboxError(TERMINAL)
            if current != generation:
                raise SourceOutboxError(STALE)
            if db.execute("SELECT 1 FROM source_jobs WHERE key=?", (key,)).fetchone():
                return key
            count, size = db.execute(
                """SELECT COUNT(*), COALESCE(SUM(length(payload)), 0) FROM source_jobs
                   WHERE profile=? AND principal=? AND receipt IS NULL AND kind='snapshot'""",
                self._scope,
            ).fetchone()
            if count >= _MAX_PENDING or size + len(payload) > _MAX_PENDING_BYTES:
                raise SourceOutboxError(BACKPRESSURE)
            self._ensure_state(db, session)
            db.execute(
                """INSERT INTO source_jobs(key, profile, principal, session, generation, kind,
                   payload, snapshot_digest, last_message_uid) VALUES (?, ?, ?, ?, ?, 'snapshot', ?, ?, ?)""",
                (key, *self._scope, session, generation, payload, snapshot.snapshot_digest, last_uid),
            )
        return key

    def _fence(self, db, session_id, generation, kind, reason=None):
        self._ensure_state(db, session_id)
        db.execute(
            "UPDATE source_state SET generation=?, terminal_reason=? WHERE profile=? AND principal=? AND session=?",
            (generation, reason, *self._scope, session_id),
        )
        db.execute(
            "DELETE FROM source_jobs WHERE profile=? AND principal=? AND session=? AND receipt IS NULL",
            (*self._scope, session_id),
        )
        key = self._key(kind, session_id, generation)
        db.execute(
            "INSERT INTO source_jobs(key, profile, principal, session, generation, kind, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (key, *self._scope, session_id, generation, kind, reason),
        )
        return key

    def invalidate(self, session_id: str) -> int:
        """Queue a new source fence and coalesce this session's older pending work."""
        session = identifier(session_id)
        with self._transaction(write=True) as db:
            generation, terminal = self._state(db, session)
            if terminal is not None:
                return generation
            if generation == _MAX_GENERATION:
                raise SourceOutboxError(UNAVAILABLE)
            generation += 1
            self._fence(db, session, generation, "invalidate")
        return generation

    def terminal(self, session_id: str, reason: str) -> str:
        """Persist one session-wide terminal intent and suppress any future enqueue."""
        session = identifier(session_id)
        choice(reason, {"archive", "delete"})
        with self._transaction(write=True) as db:
            generation, terminal = self._state(db, session)
            if terminal is not None:
                return self._key("terminal", session, generation)
            return self._fence(db, session, generation, "terminal", reason)

    def next_job(self, session_id: str | None = None) -> SourceJob | None:
        query = "SELECT * FROM source_jobs WHERE profile=? AND principal=? AND receipt IS NULL"
        bindings = self._scope
        if session_id is not None:
            query += " AND session=?"
            bindings = (*bindings, identifier(session_id))
        query += " ORDER BY CASE kind WHEN 'terminal' THEN 0 WHEN 'invalidate' THEN 1 ELSE 2 END, sequence LIMIT 1"
        with self._transaction() as db:
            row = db.execute(query, bindings).fetchone()
        if row is None:
            return None
        try:
            payload = row["payload"]
            kind, session = row["kind"], identifier(row["session"])
            generation = integer(row["generation"], 0, _MAX_GENERATION)
            snapshot = SourceSnapshot.parse(decode(payload)) if kind == "snapshot" else None
            if snapshot is not None:
                snapshot.require_current()
                require((snapshot.profile_id, snapshot.session_id, snapshot.snapshot_digest) ==
                        (self._scope[0], session, row["snapshot_digest"]), "source_scope_mismatch")
            require(row["key"] == self._key(kind, session, generation, row["snapshot_digest"]), "invalid_source_job")
        except ValueError:
            raise SourceOutboxError(UNAVAILABLE) from None
        return SourceJob(kind, row["key"], session, generation, snapshot, payload, row["reason"], self._scope)

    def _job_receipt(self, db, job):
        if job._scope != self._scope:
            return None
        generation, terminal = self._state(db, job.session_id)
        if generation != job.generation or (terminal is not None) != (job.kind == "terminal"):
            return None
        return db.execute(
            "SELECT receipt FROM source_jobs WHERE key=? AND profile=? AND principal=? AND session=? AND generation=? AND kind=?",
            (job.idempotency_key, *self._scope, job.session_id, job.generation, job.kind),
        ).fetchone()

    def is_current(self, job: SourceJob) -> bool:
        with self._transaction() as db:
            row = self._job_receipt(db, job)
            return row is not None and row["receipt"] is None

    def acknowledge(self, job: SourceJob, receipt: str) -> bool:
        """Record a correlated durable host receipt, discarding the local copy body."""
        receipt = identifier(receipt)
        with self._transaction(write=True) as db:
            row = self._job_receipt(db, job)
            if row is None:
                return False
            if row["receipt"] is not None:
                return row["receipt"] == receipt
            db.execute("UPDATE source_jobs SET receipt=?, payload=NULL WHERE key=?", (receipt, job.idempotency_key))
        return True

    def cursor(self, session_id: str) -> SourceCursor | None:
        session = identifier(session_id)
        with self._transaction() as db:
            row = db.execute(
                """SELECT generation, kind, key, receipt, snapshot_digest, last_message_uid FROM source_jobs
                   WHERE profile=? AND principal=? AND session=? AND receipt IS NOT NULL
                   ORDER BY sequence DESC LIMIT 1""",
                (*self._scope, session),
            ).fetchone()
        return None if row is None else SourceCursor(session, *row)


def _snapshot_payload(snapshot):
    messages_json = snapshot.messages_json
    require(type(messages_json) is bytes and len(messages_json) <= _MAX_SNAPSHOT_BYTES, "source_wire_limit")
    messages = decode(b'{"messages":' + messages_json + b"}")["messages"]
    value = {
        "authority": "hermes_source_copied_snapshot", "profile_id": snapshot.profile_id,
        "session_id": snapshot.session_id, "branch_id": snapshot.branch_id,
        "source_revision": snapshot.source_revision, "snapshot_digest": snapshot.snapshot_digest,
        "availability": snapshot.availability, "messages": messages,
    }
    require(SourceSnapshot.parse(value) == snapshot and bool(messages), "invalid_source_snapshot")
    payload = canonical(value)
    require(len(payload) <= _MAX_SNAPSHOT_BYTES, "source_wire_limit")
    return payload, messages[-1]["message_uid"]
