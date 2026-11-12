"""The source status DTO carries safe embedding failures alongside durable receipts."""

import pytest

from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.validation import canonical
from test_host_client import TOKEN


@pytest.mark.parametrize("error", [None, "embedding_identity_stale", "embedding_identity_unbound"])
def test_source_status_preserves_receipt_and_typed_embedding_error(tmp_path, error):
    client = HostClient(tmp_path, "profile-a", "principal-a", TOKEN)
    value = {"session_id": "session-a", "state": "unavailable" if error else "complete",
             "receipt": "a" * 64, "import_id": "import-a", "owner_id": "owner-a",
             "snapshot_digest": "b" * 64, "embedding_error": error}
    client._read_discovery = lambda: object()
    client._exchange = lambda *args, **kwargs: canonical(value)
    assert client.read_source_status("session-a") == value
    value["embedding_error"] = "arbitrary provider diagnostic"
    with pytest.raises(HostUnavailable, match="invalid_source_status"):
        client.read_source_status("session-a")
