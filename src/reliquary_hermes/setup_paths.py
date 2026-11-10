"""Validated owner destination paths for profile setup."""

from contextlib import ExitStack, contextmanager
import ctypes
import os
from pathlib import Path
import re
import stat

from .validation import ContractError, require, text

_PATH_BYTES = 1024
_REPARSE = 0x400
_EXTENSIONS = {"rel": ".rel", "phy": ".phy"}
_RESERVED = re.compile(r"(?i)(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[0-9¹²³])(?:\.|$)")


def _path(value):
    value = text(value, _PATH_BYTES)
    parts = re.split(r"[/\\]", value)
    require(not value.startswith(("//", "\\\\")) and ".." not in parts
            and not any(ord(char) < 32 for char in value), "invalid_owner_path")
    path = Path(value)
    require(path.is_absolute(), "invalid_owner_path")
    if os.name == "nt":
        require(all(not any(char in part for char in '<>:"|?*')
                    and not part.endswith((" ", ".")) and not _RESERVED.match(part)
                    for part in path.parts[1:]), "invalid_owner_path")
        # Windows also exposes mapped network shares as drive letters.
        require(ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(path.anchor)) in (2, 3, 5, 6),
                "invalid_owner_path")
    return path


def _reparse(info):
    return stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & _REPARSE


@contextmanager
def _windows_directory(path):
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    open_handle = kernel.CreateFileW
    open_handle.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                            wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    open_handle.restype = wintypes.HANDLE
    close_handle = kernel.CloseHandle
    close_handle.argtypes = [wintypes.HANDLE]
    close_handle.restype = wintypes.BOOL
    handle = open_handle(str(path), 0x80, 0x3, None, 3, 0x02200000, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        info = path.lstat()
        require(not _reparse(info) and stat.S_ISDIR(info.st_mode), "invalid_owner_path")
        yield
    finally:
        close_handle(handle)


@contextmanager
def _open_directory(path):
    with ExitStack() as stack:
        fd = None
        for component in [*reversed(path.parents), path]:
            info = component.lstat()
            require(not _reparse(info) and stat.S_ISDIR(info.st_mode), "invalid_owner_path")
            if os.name == "nt":
                stack.enter_context(_windows_directory(component))
            else:
                name = component.name if fd is not None else component.anchor
                fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                stack.callback(os.close, fd)
        require(path.resolve(strict=True) == path, "invalid_owner_path")
        yield str(path) if fd is None else fd


def _in_scope(home, default_home, path):
    if path.is_relative_to(home):
        return not path.is_relative_to(home / "profiles")
    return not path.is_relative_to(default_home)


def _default_home():
    from hermes_constants import get_default_hermes_root

    return get_default_hermes_root().resolve()


@contextmanager
def destination(home, kind, value):
    path = _path(value)
    require(kind in _EXTENSIONS and path.suffix.lower() == _EXTENSIONS[kind], "invalid_owner_path")
    default_home = _default_home()
    require(_in_scope(home, default_home, path), "invalid_owner_path")
    try:
        with _open_directory(path.parent):
            yield path
    except OSError:
        raise ContractError("invalid_owner_path") from None
