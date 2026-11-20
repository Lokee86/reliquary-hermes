"""Check bundle selection and cleanup through the existing startup path."""

import io
import os
from types import SimpleNamespace

import pytest

from reliquary_hermes import native_host, setup
from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.settings import read_settings
from reliquary_hermes.validation import ContractError, canonical


@pytest.mark.parametrize(("system", "machine", "translated", "target"), [
    ("Linux", "x86_64", False, "linux-x86_64"),
    ("Linux", "aarch64", False, "linux-arm64"),
    ("Darwin", "x86_64", False, "macos-x86_64"),
    ("Darwin", "arm64", False, "macos-arm64"),
    ("Darwin", "x86_64", True, "macos-arm64"),
    ("Linux", "riscv64", False, None),
])
def test_target_uses_the_backend_cpu(monkeypatch, system, machine, translated, target):
    monkeypatch.setattr(native_host.platform, "machine", lambda: machine)
    monkeypatch.setattr(native_host.platform, "mac_ver", lambda: ("15.0", (), machine))
    monkeypatch.setattr(native_host, "_glibc_version", lambda: "2.35")
    monkeypatch.setattr(native_host, "_under_rosetta", lambda: translated)
    if target is None:
        with pytest.raises(ContractError, match="unsupported_bundled_host"):
            native_host._target(system)
    else:
        assert native_host._target(system) == target


@pytest.mark.parametrize(("system", "version"), [("Linux", ""), ("Linux", "2.34"), ("Darwin", "14.7")])
def test_target_rejects_unsupported_system_baseline(monkeypatch, system, version):
    monkeypatch.setattr(native_host.platform, "machine", lambda: "arm64")
    monkeypatch.setattr(native_host.platform, "mac_ver", lambda: (version, (), "arm64"))
    monkeypatch.setattr(native_host, "_glibc_version", lambda: version)
    with pytest.raises(ContractError, match="unsupported_bundled_host"):
        native_host._target(system)


@pytest.fixture
def bundle(tmp_path):
    home = tmp_path.resolve()
    root = home / "plugins" / "reliquary" / "host" / "bundled"
    paths = {target: root / target / native_host._HOST for target in native_host._TARGETS}
    for path in paths.values():
        path.parent.mkdir(parents=True)
        path.write_bytes(b"fixture")
        path.chmod(0o755)
    return home, paths


def test_setup_and_configured_start_resolve_the_same_bundle(bundle, monkeypatch):
    home, paths = bundle
    selected = paths["linux-arm64"]
    monkeypatch.setattr(native_host.platform, "system", lambda: "Linux")
    monkeypatch.setattr(native_host, "_target", lambda _system: "linux-arm64")
    state = home / "reliquary"
    state.mkdir()
    (state / "owners.json").write_bytes(canonical({
        "profile_id": "profile", "principal_id": "user", "projects": {},
        "main_rel": str(home / "main.rel"), "active_phy": str(home / "private.phy"),
    }))
    provider = state / "provider.json"
    legacy = selected.parents[2] / native_host._HOST
    prior = canonical({"binary": str(legacy)})
    provider.write_bytes(prior)
    assert setup._defaults(home)[1] == read_settings(home).binary == selected
    assert provider.read_bytes() == prior
    assert all(path.is_file() for path in paths.values())

    selected.unlink()
    legacy.touch()
    with pytest.raises(ContractError, match="missing_bundled_host"):
        read_settings(home)
    external = home / "external-host"
    external.touch()
    provider.write_bytes(canonical({"binary": str(external)}))
    assert setup._defaults(home)[1] == read_settings(home).binary == external


@pytest.mark.skipif(os.name != "posix", reason="native bundle cleanup runs on Linux and macOS")
def test_prune_requires_an_authenticated_new_start_and_keeps_unrelated_files(bundle, monkeypatch):
    home, paths = bundle
    selected = paths["linux-arm64"]
    unrelated = selected.parent.parent / "linux-x86_64" / "notes"
    unrelated.write_bytes(b"keep")
    state = home / "reliquary"
    state.mkdir()
    monkeypatch.setattr(
        "reliquary_hermes.client.subprocess.Popen",
        lambda *args, **kwargs: SimpleNamespace(poll=lambda: None, stdin=io.BytesIO()),
    )

    def connect(exchange):
        client = HostClient(state, "profile", "user", "x" * 32, binary=selected)
        discoveries = iter((None, "new-discovery"))
        monkeypatch.setattr(client, "_read_discovery", lambda: next(discoveries))
        return client._connect(exchange)

    def reject(*_):
        raise HostUnavailable("host_authentication")

    with pytest.raises(HostUnavailable, match="host_authentication"):
        connect(reject)
    assert all(path.is_file() for path in paths.values())

    assert connect(lambda *_: "signed") == "signed"
    assert connect(lambda *_: "signed") == "signed"
    assert [path for path in paths.values() if path.exists()] == [selected]
    assert unrelated.read_bytes() == b"keep"


@pytest.mark.skipif(os.name != "posix", reason="native bundle cleanup runs on Linux and macOS")
def test_prune_skips_a_replacement_bundle_and_linked_target(bundle, tmp_path):
    home, paths = bundle
    selected = paths["linux-arm64"]
    bundle_dir = selected.parent.parent
    original = native_host.bundle_at_launch(home / "reliquary", selected)
    bundle_dir.rename(bundle_dir.with_name("retired"))
    selected.parent.mkdir(parents=True)
    selected.touch()
    unused = paths["macos-arm64"]
    unused.parent.mkdir()
    unused.touch()
    native_host.prune_unused_hosts(selected, original)
    assert unused.exists()

    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / native_host._HOST
    sentinel.touch()
    paths["macos-x86_64"].parent.symlink_to(outside, target_is_directory=True)
    current = native_host.bundle_at_launch(home / "reliquary", selected)
    native_host.prune_unused_hosts(selected, current)
    assert not unused.exists()
    assert selected.exists() and sentinel.exists()
