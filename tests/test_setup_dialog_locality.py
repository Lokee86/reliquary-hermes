from types import SimpleNamespace

import reliquary_hermes.setup_dialog_locality as locality


def request(**state):
    defaults = {"auth_required": False, "bound_host": "127.0.0.1", "serves_spa": True,
                "ssh_isolated_clients": None}
    defaults.update(state)
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(**defaults)), state=SimpleNamespace(),
                           scope={"type": "http", "client": ("127.0.0.1", 51000),
                                  "server": ("127.0.0.1", 8000)})


def setup_proof(monkeypatch, req):
    monkeypatch.setattr(locality.sys, "platform", "win32")
    monkeypatch.setattr(locality.os, "name", "nt")
    monkeypatch.setattr(locality, "_on_default_input_desktop", lambda: True)
    monkeypatch.setattr(locality, "_session_is_active", lambda session: session == 1)
    # (state, local address, local port, remote address, remote port, owning pid)
    monkeypatch.setattr(locality, "_ipv4_tcp_rows", lambda: [
        (2, "127.0.0.1", 8000, "0.0.0.0", 0, 100),
        (5, "127.0.0.1", 8000, "127.0.0.1", 51000, 100),
        (5, "127.0.0.1", 51000, "127.0.0.1", 8000, 200),
    ])
    monkeypatch.setattr(locality.os, "getpid", lambda: 100)
    monkeypatch.setattr(locality, "_process_identity", lambda pid: {
        100: (r"C:\Program Files\Hermes\hermes.exe", r"DOMAIN\user", 1),
        200: (r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"DOMAIN\user", 1),
    }.get(pid))
    monkeypatch.setattr(locality, "_official_browser", lambda path: path.startswith(r"C:\Program Files\Google\Chrome"))


def test_accepts_verified_same_user_interactive_browser(monkeypatch):
    req = request()
    setup_proof(monkeypatch, req)
    assert locality.local_interactive_request(req) is True


def test_rejects_auth_gated_or_non_dashboard_deployment(monkeypatch):
    for req in (request(auth_required=True), request(bound_host="0.0.0.0"),
                request(serves_spa=False), request(ssh_isolated_clients=object())):
        setup_proof(monkeypatch, req)
        assert locality.local_interactive_request(req) is False


def test_rejects_hosted_worker(monkeypatch):
    req = request()
    req.state.hosted_http_authenticated = True
    setup_proof(monkeypatch, req)
    assert locality.local_interactive_request(req) is False


def test_rejects_proxy_peer_without_matching_accepted_socket(monkeypatch):
    req = request()
    setup_proof(monkeypatch, req)
    monkeypatch.setattr(locality, "_ipv4_tcp_rows", lambda: [])
    assert locality.local_interactive_request(req) is False


def test_rejects_remote_or_headless_desktop(monkeypatch):
    req = request()
    setup_proof(monkeypatch, req)
    monkeypatch.setattr(locality, "_on_default_input_desktop", lambda: False)
    assert locality.local_interactive_request(req) is False


def test_rejects_unrecognized_browser_or_different_user(monkeypatch):
    req = request()
    setup_proof(monkeypatch, req)
    monkeypatch.setattr(locality, "_process_identity", lambda pid: {
        100: (r"C:\Program Files\Hermes\hermes.exe", r"DOMAIN\user", 1),
        200: (r"C:\Temp\chrome.exe", r"DOMAIN\user", 1),
    }.get(pid))
    assert locality.local_interactive_request(req) is False
    setup_proof(monkeypatch, req)
    monkeypatch.setattr(locality, "_process_identity", lambda pid: {
        100: (r"C:\Program Files\Hermes\hermes.exe", r"DOMAIN\user", 1),
        200: (r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"OTHER\user", 1),
    }.get(pid))
    assert locality.local_interactive_request(req) is False



def test_rejects_disconnected_session(monkeypatch):
    req = request()
    setup_proof(monkeypatch, req)
    monkeypatch.setattr(locality, "_session_is_active", lambda session: False)
    assert locality.local_interactive_request(req) is False
