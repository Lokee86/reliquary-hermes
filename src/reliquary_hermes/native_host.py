"""Resolve and prune the native executables shipped in a Reliquary checkout."""

from functools import cache
import logging
import os
from pathlib import Path
import platform
import stat

from .validation import ContractError, require


_LOG = logging.getLogger(__name__)
_HOST = "reliquary-hermes-host"
_TARGETS = ("linux-x86_64", "linux-arm64", "macos-x86_64", "macos-arm64")
_CPUS = {"x86_64": "x86_64", "amd64": "x86_64", "arm64": "arm64", "aarch64": "arm64"}
BUNDLED_HOST_ERRORS = {
    "unsupported_bundled_host": (
        "Reliquary's bundled host needs x86-64 or ARM64 with glibc 2.35+ on Linux or macOS 15+."
    ),
    "missing_bundled_host": (
        "Reliquary's matching native host is missing or unusable. Reinstall the plugin for this profile."
    ),
}


def host_environment(scratch: Path) -> dict[str, str]:
    # The native host needs the OS credential service. Provider credentials
    # and the rest of Hermes' environment stay in the parent process.
    allowed = ("SystemRoot", "WINDIR", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR")
    environment = {name: os.environ[name] for name in allowed if name in os.environ}
    environment.update({name: str(scratch) for name in ("TEMP", "TMP", "TMPDIR")})
    return environment


def _at_least(version: str, minimum: tuple[int, int]) -> bool:
    try:
        return tuple(map(int, version.split(".")[:2])) >= minimum
    except ValueError:
        return False


def _glibc_version() -> str:
    try:
        value = os.confstr("CS_GNU_LIBC_VERSION") or ""
    except (AttributeError, OSError, ValueError):
        return ""
    return value.removeprefix("glibc ") if value.startswith("glibc ") else ""


@cache
def _under_rosetta() -> bool:
    import ctypes

    # Ask from this process because the sysctl is relative to its caller.
    value = ctypes.c_int()
    size = ctypes.c_size_t(ctypes.sizeof(value))
    libc = ctypes.CDLL(None)
    status = libc.sysctlbyname(b"sysctl.proc_translated", ctypes.byref(value), ctypes.byref(size), None, 0)
    return status == 0 and value.value == 1


def _target(system: str) -> str:
    cpu = _CPUS.get(platform.machine().lower())
    require(cpu is not None, "unsupported_bundled_host")
    if system == "Linux":
        require(_at_least(_glibc_version(), (2, 35)), "unsupported_bundled_host")
        return f"linux-{cpu}"
    if system == "Darwin":
        require(_at_least(platform.mac_ver()[0], (15, 0)), "unsupported_bundled_host")
        if cpu == "x86_64" and _under_rosetta():
            cpu = "arm64"
        return f"macos-{cpu}"
    raise ContractError("unsupported_bundled_host")


def _is_variant(root: Path, binary: Path) -> bool:
    return binary.parent.parent == root and binary.parent.name in _TARGETS and binary.name == _HOST


def packaged_host_path(home: Path, saved: Path | None = None, *, setup: bool = False) -> Path:
    """Use the current managed bundle or the existing standalone host path."""
    host_dir = home / "plugins" / "reliquary" / "host"
    system = platform.system()
    flat = host_dir / (_HOST + ".exe" if system == "Windows" else _HOST)
    bundle = host_dir / "bundled"
    if system == "Windows" or not os.path.lexists(bundle):
        # Setup has historically offered an installed single-host package as its default.
        return flat if saved is None or (setup and flat.is_file()) else saved
    if saved is not None and saved != flat and not _is_variant(bundle, saved):
        return saved

    selected = bundle / _target(system) / _HOST
    try:
        regular = stat.S_ISREG(selected.lstat().st_mode)
        contained = selected.resolve(strict=True) == selected
    except (OSError, RuntimeError):
        raise ContractError("missing_bundled_host") from None
    require(regular and contained and os.access(selected, os.X_OK), "missing_bundled_host")
    return selected


def bundle_at_launch(state_dir: Path, binary: Path) -> os.stat_result | None:
    """Remember which installed bundle supplied this launch across a re-pin."""
    root = state_dir.parent / "plugins" / "reliquary" / "host" / "bundled"
    if os.name != "posix" or state_dir.name != "reliquary" or not _is_variant(root, binary):
        return None
    try:
        if binary.resolve(strict=True) == binary:
            return root.stat()
    except (OSError, RuntimeError):
        pass
    return None


def prune_unused_hosts(binary: Path, bundle: os.stat_result) -> None:
    """Remove the three unused regular files from the bundle that was launched."""
    flags = os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW
    try:
        root_fd = os.open(binary.parent.parent, flags)
        try:
            if not os.path.samestat(os.fstat(root_fd), bundle):
                return
            for target in _TARGETS:
                if target == binary.parent.name:
                    continue
                try:
                    variant_fd = os.open(target, flags, dir_fd=root_fd)
                    try:
                        info = os.stat(_HOST, dir_fd=variant_fd, follow_symlinks=False)
                        if stat.S_ISREG(info.st_mode):
                            os.unlink(_HOST, dir_fd=variant_fd)
                    finally:
                        os.close(variant_fd)
                except FileNotFoundError:
                    pass
                except OSError as exc:
                    _LOG.warning("Could not prune Reliquary's unused %s host (errno %s)", target, exc.errno)
        finally:
            os.close(root_fd)
    except FileNotFoundError:
        pass
    except OSError as exc:
        _LOG.warning("Could not prune Reliquary's unused bundled hosts (errno %s)", exc.errno)
