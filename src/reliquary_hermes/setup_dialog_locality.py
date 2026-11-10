"""Fail-closed boundary for plugin-local Tk dialogs on Windows."""

from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import socket
import struct
import sys


def _address(value):
    if not isinstance(value, (tuple, list)) or len(value) < 2:
        return None
    try:
        return str(value[0]).split("%", 1)[0], int(value[1])
    except (TypeError, ValueError):
        return None


def _ipv4_tcp_rows():
    """Return TCP owner-PID rows from Windows' kernel table; fail closed."""
    if os.name != "nt":
        return None
    iphlpapi = ctypes.WinDLL("iphlpapi.dll")
    get_table = iphlpapi.GetExtendedTcpTable
    get_table.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong), ctypes.c_int,
                          ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    get_table.restype = ctypes.c_ulong
    size = ctypes.c_ulong(0)
    # AF_INET=2, TCP_TABLE_OWNER_PID_ALL=5, ERROR_INSUFFICIENT_BUFFER=122.
    result = get_table(None, ctypes.byref(size), False, 2, 5, 0)
    if result != 122 or not size.value:
        return None
    buffer = ctypes.create_string_buffer(size.value)
    result = get_table(buffer, ctypes.byref(size), False, 2, 5, 0)
    if result != 0:
        return None
    count = struct.unpack_from("=I", buffer, 0)[0]
    row_size = 24
    if count > (size.value - 4) // row_size:
        return None
    rows = []
    offset = 4
    for _ in range(count):
        state, local_addr, local_port, remote_addr, remote_port, pid = struct.unpack_from("=IIIIII", buffer, offset)
        rows.append((state, socket.inet_ntoa(struct.pack("=I", local_addr)), socket.ntohs(local_port & 0xffff),
                     socket.inet_ntoa(struct.pack("=I", remote_addr)), socket.ntohs(remote_port & 0xffff), pid))
        offset += row_size
    return rows


def _process_identity(pid):
    """Return (image path, user SID, Windows session id), or None."""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    kernel.OpenProcess.argtypes = [ctypes.c_ulong, wintypes.BOOL, ctypes.c_ulong]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.QueryFullProcessImageNameW.argtypes = [ctypes.c_void_p, ctypes.c_ulong,
                                                   ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong)]
    kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel.ProcessIdToSessionId.argtypes = [ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)]
    kernel.ProcessIdToSessionId.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel.CloseHandle.restype = wintypes.BOOL
    advapi.OpenProcessToken.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_void_p)]
    advapi.OpenProcessToken.restype = wintypes.BOOL
    advapi.GetTokenInformation.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p,
                                            ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)]
    advapi.GetTokenInformation.restype = wintypes.BOOL
    advapi.GetLengthSid.argtypes = [ctypes.c_void_p]
    advapi.GetLengthSid.restype = ctypes.c_ulong
    process = kernel.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not process:
        return None
    token = ctypes.c_void_p()
    try:
        length = ctypes.c_ulong(32768)
        image = ctypes.create_unicode_buffer(length.value)
        if not kernel.QueryFullProcessImageNameW(process, 0, image, ctypes.byref(length)):
            return None
        session = ctypes.c_ulong()
        if not kernel.ProcessIdToSessionId(int(pid), ctypes.byref(session)) or session.value == 0:
            return None
        if not advapi.OpenProcessToken(process, 0x0008, ctypes.byref(token)):
            return None
        needed = ctypes.c_ulong()
        advapi.GetTokenInformation(token, 1, None, 0, ctypes.byref(needed))
        if not needed.value:
            return None
        token_data = ctypes.create_string_buffer(needed.value)
        if not advapi.GetTokenInformation(token, 1, token_data, needed.value, ctypes.byref(needed)):
            return None
        # TOKEN_USER starts with the SID pointer from SID_AND_ATTRIBUTES.
        sid = ctypes.cast(token_data, ctypes.POINTER(ctypes.c_void_p))[0]
        length = advapi.GetLengthSid(sid) if sid else 0
        if not length:
            return None
        return image.value, ctypes.string_at(sid, length), session.value
    except Exception:
        return None
    finally:
        if token:
            kernel.CloseHandle(token)
        kernel.CloseHandle(process)


def _official_browser(path):
    candidate = os.path.normcase(os.path.abspath(path))
    roots = [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")]
    allowed = []
    for root in roots:
        if not root:
            continue
        allowed.extend(os.path.normcase(os.path.abspath(os.path.join(root, relative))) for relative in (
            r"Google\Chrome\Application\chrome.exe",
            r"Microsoft\Edge\Application\msedge.exe",
            r"Mozilla Firefox\firefox.exe",
        ))
    return candidate in allowed


def _session_is_active(session):
    wts = ctypes.WinDLL("wtsapi32.dll", use_last_error=True)
    query = wts.WTSQuerySessionInformationW
    query.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.c_int,
                      ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.DWORD)]
    query.restype = wintypes.BOOL
    wts.WTSFreeMemory.argtypes = [ctypes.c_void_p]
    wts.WTSFreeMemory.restype = None
    state, size = ctypes.c_void_p(), wintypes.DWORD()
    if not query(None, session, 8, ctypes.byref(state), ctypes.byref(size)):
        return False
    try:
        # WTSConnectState (8) returns WTSActive (0) for an active logon session.
        return bool(state) and size.value == ctypes.sizeof(ctypes.c_int) and ctypes.c_int.from_address(state.value).value == 0
    finally:
        wts.WTSFreeMemory(state)


def _on_default_input_desktop():
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.OpenInputDesktop.argtypes = [ctypes.c_ulong, wintypes.BOOL, ctypes.c_ulong]
    user32.OpenInputDesktop.restype = ctypes.c_void_p
    user32.GetUserObjectInformationW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p,
                                                  ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)]
    user32.GetUserObjectInformationW.restype = wintypes.BOOL
    user32.CloseDesktop.argtypes = [ctypes.c_void_p]
    user32.CloseDesktop.restype = wintypes.BOOL
    desktop = user32.OpenInputDesktop(0, False, 0x0100)
    if not desktop:
        return False
    try:
        needed = ctypes.c_ulong()
        user32.GetUserObjectInformationW(desktop, 2, None, 0, ctypes.byref(needed))
        if not needed.value:
            return False
        name = ctypes.create_unicode_buffer(needed.value // ctypes.sizeof(ctypes.c_wchar) + 1)
        if not user32.GetUserObjectInformationW(desktop, 2, name, needed.value, ctypes.byref(needed)):
            return False
        return name.value.casefold() == "default"
    finally:
        user32.CloseDesktop(desktop)


def local_interactive_request(request) -> bool:
    """Prove a direct same-user browser socket in an interactive local dashboard session."""
    try:
        if sys.platform != "win32" or os.name != "nt":
            return False
        app = request.app
        state = app.state
        if (getattr(state, "auth_required", True) is not False
                or getattr(state, "bound_host", None) != "127.0.0.1"
                or getattr(state, "serves_spa", False) is not True
                or getattr(state, "ssh_isolated_clients", None) is not None
                or getattr(request.state, "hosted_http_authenticated", False) is True):
            return False
        scope = request.scope
        if scope.get("type") != "http":
            return False
        peer, listener = _address(scope.get("client")), _address(scope.get("server"))
        if (peer is None or listener is None or peer[0] != "127.0.0.1"
                or listener[0] != "127.0.0.1" or peer[1] <= 0 or listener[1] <= 0):
            return False
        if not _on_default_input_desktop():
            return False
        rows = _ipv4_tcp_rows()
        if rows is None:
            return False
        pid = os.getpid()
        # Require both the listening socket and this exact accepted connection to belong to Hermes.
        if not any(state_id == 2 and local_port == listener[1] and local_addr == listener[0]
                   and owner == pid for state_id, local_addr, local_port, _, _, owner in rows):
            return False
        if not any(state_id == 5 and local_port == listener[1] and local_addr == listener[0]
                   and remote_addr == peer[0] and remote_port == peer[1] and owner == pid
                   for state_id, local_addr, local_port, remote_addr, remote_port, owner in rows):
            return False
        hermes_identity = _process_identity(pid)
        if hermes_identity is None:
            return False
        hermes_user, hermes_session = hermes_identity[1], hermes_identity[2]
        if not _session_is_active(hermes_session):
            return False
        # Find a reciprocal established connection owned by an official browser process.
        for state_id, local_addr, local_port, remote_addr, remote_port, owner in rows:
            if (state_id != 5 or local_addr != peer[0] or local_port != peer[1]
                    or remote_addr != listener[0] or remote_port != listener[1]):
                continue
            identity = _process_identity(owner)
            if identity is None or not _official_browser(identity[0]):
                continue
            if identity[1] == hermes_user and identity[2] == hermes_session:
                return True
        return False
    except Exception:
        return False
