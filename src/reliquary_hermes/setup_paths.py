"""Bounded onboarding access to explicitly allowed local host directories."""

from contextlib import ExitStack, contextmanager
import ctypes
from itertools import chain, islice
import os
from pathlib import Path
import re
import stat
import time

from .projects import active_projects
from .validation import ContractError, require, text

_PATH_BYTES = 1024
_MAX_DEPTH = 12
_MAX_ENTRIES = 128
_MAX_EXAMINED = 1024
_MAX_SECONDS = 2.0
_REPARSE = 0x400
_EXTENSIONS = {"rel": ".rel", "phy": ".phy", "config": ".cfg"}
_RESERVED = re.compile(r"(?i)(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[0-9¹²³])(?:\.|$)")


def _path(value):
    value = text(value, _PATH_BYTES)
    parts = re.split(r"[/\\]", value)
    require(not value.startswith(("//", "\\\\")) and ".." not in parts
            and not any(ord(char) < 32 for char in value), "invalid_local_path")
    path = Path(value)
    require(path.is_absolute(), "invalid_local_path")
    if os.name == "nt":
        require(all(not any(char in part for char in '<>:"|?*')
                    and not part.endswith((" ", ".")) and not _RESERVED.match(part)
                    for part in path.parts[1:]), "invalid_local_path")
        # Windows also exposes mapped network shares as drive letters.
        require(ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(path.anchor)) in (2, 3, 5, 6),
                "invalid_local_path")
    return path


def _reparse(info):
    return stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & _REPARSE


def _check_dir(info):
    require(not _reparse(info), "browse_reparse_point")
    require(stat.S_ISDIR(info.st_mode), "browse_not_directory")


def _check_time(deadline):
    require(time.monotonic() < deadline, "browse_timeout")


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
    # Keep the directory from being renamed/replaced while its pathname is used.
    # Open the reparse object itself if a replacement raced our initial check.
    handle = open_handle(str(path), 0x80, 0x3, None, 3, 0x02200000, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        _check_dir(path.lstat())
        yield
    finally:
        close_handle(handle)


@contextmanager
def _open_directory(path, deadline):
    with ExitStack() as stack:
        fd = None
        for component in [*reversed(path.parents), path]:
            _check_time(deadline)
            _check_dir(component.lstat())
            if os.name == "nt":
                stack.enter_context(_windows_directory(component))
            else:
                name = component.name if fd is not None else component.anchor
                fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                stack.callback(os.close, fd)
        require(path.resolve(strict=True) == path, "browse_reparse_point")
        yield str(path) if fd is None else fd


def _in_scope(home, default_home, path):
    if path.is_relative_to(home):
        return not path.is_relative_to(home / "profiles")
    return not path.is_relative_to(default_home)


def _default_home():
    from hermes_constants import get_default_hermes_root

    return get_default_hermes_root().resolve()


def _roots(home, default_home, defaults, deadline):
    try:
        projects = active_projects(home)
    except ContractError:
        # The project pane separately reports the registry error.
        projects = {}
    configured = [defaults.get("main_rel"), defaults.get("active_phy"),
                  *defaults.get("projects", {}).values()]
    project_folders = (folder.path for project in projects.values() for folder in project.folders)
    approved = os.environ.get("RELIQUARY_SETUP_BROWSE_ROOTS", "").split(os.pathsep)
    owner_folders = (str(Path(path).parent) for path in configured if isinstance(path, str))
    candidates = chain((str(home),), owner_folders, approved, project_folders)
    roots = {}
    for candidate in islice(candidates, _MAX_EXAMINED):
        _check_time(deadline)
        if len(roots) >= _MAX_ENTRIES:
            break
        if candidate:
            try:
                path = _path(candidate)
                if _in_scope(home, default_home, path):
                    with _open_directory(path, deadline):
                        roots[path] = None
            except (OSError, ContractError):
                continue
    return roots


def _permitted(path, roots):
    for root in roots:
        if path.is_relative_to(root) and len(path.relative_to(root).parts) <= _MAX_DEPTH:
            return
    raise ContractError("browse_outside_roots")


def _entry(path, kind):
    return {"name": path.name or str(path), "path": str(path), "kind": kind}


def browse(home, defaults, kind, requested):
    require(type(kind) is str and kind in _EXTENSIONS, "invalid_browse_kind")
    deadline = time.monotonic() + _MAX_SECONDS
    default_home = _default_home()
    path = _path(requested) if requested is not None else None
    roots = _roots(home, default_home, defaults, deadline)
    _check_time(deadline)
    if path is None:
        return {"path": None, "parent": None, "entries": [_entry(root, "directory") for root in roots],
                "truncated": len(roots) == _MAX_ENTRIES}
    require(_in_scope(home, default_home, path), "browse_outside_roots")
    _permitted(path, roots)
    parent = str(path.parent) if path not in roots else None
    entries = []
    truncated = False
    try:
        with _open_directory(path, deadline) as directory, os.scandir(directory) as children:
            for index, child in enumerate(children):
                _check_time(deadline)
                if index >= _MAX_EXAMINED or len(entries) == _MAX_ENTRIES:
                    truncated = True
                    break
                try:
                    candidate = _path(str(path / child.name))
                    info = child.stat(follow_symlinks=False)
                except (OSError, ContractError):
                    continue
                if _reparse(info) or not _in_scope(home, default_home, candidate):
                    continue
                if stat.S_ISDIR(info.st_mode):
                    entries.append(_entry(candidate, "directory"))
                elif stat.S_ISREG(info.st_mode) and candidate.suffix.lower() == _EXTENSIONS[kind]:
                    entries.append(_entry(candidate, "file"))
    except FileNotFoundError:
        raise ContractError("browse_not_found") from None
    except OSError:
        raise ContractError("browse_unreadable") from None
    entries.sort(key=lambda item: (item["kind"], item["name"].casefold()))
    return {"path": str(path), "parent": parent, "entries": entries, "truncated": truncated}


@contextmanager
def destination(home, defaults, kind, value, *, native):
    path = _path(value)
    require(path.suffix.lower() == _EXTENSIONS[kind], "invalid_owner_path")
    deadline = time.monotonic() + _MAX_SECONDS
    default_home = _default_home()
    require(_in_scope(home, default_home, path), "browse_outside_roots")
    if not native:
        _permitted(path.parent, _roots(home, default_home, defaults, deadline))
    try:
        with _open_directory(path.parent, deadline):
            yield path
    except OSError:
        raise ContractError("invalid_owner_path") from None
