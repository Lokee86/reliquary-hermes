"""Run the setup-only file chooser in a transient Python GUI process."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

_FILTERS = {
    "open_rel": ("Choose a Reliquary REL", "Reliquary REL", ".rel", None),
    "open_phy": ("Choose a Reliquary PHY", "Reliquary PHY", ".phy", None),
    "open_config": ("Choose processing routes", "Processing routes", ".json", None),
    "save_rel": ("Create a Reliquary REL", "Reliquary REL", ".rel", "general.rel"),
    "save_phy": ("Create a Reliquary PHY", "Reliquary PHY", ".phy", "active.phy"),
}
MODES = frozenset(_FILTERS)
_DIALOG_LOCK = threading.Lock()
_DIALOG_TIMEOUT = 180
_POLL_INTERVAL = 0.25


def available() -> bool:
    return importlib.util.find_spec("tkinter") is not None and importlib.util.find_spec("_tkinter") is not None


def _unavailable() -> dict:
    return {"status": "unavailable"}


def _result(path: object) -> dict:
    if not isinstance(path, str) or "\x00" in path or not os.path.isabs(path) or len(path.encode("utf-8")) > 4096:
        return _unavailable()
    return {"status": "selected", "path": path}


def _show(mode: str) -> dict:
    from tkinter import Tk, filedialog

    title, label, extension, filename = _FILTERS[mode]
    root = Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
        options = {"parent": root, "title": title, "filetypes": [(label, "*" + extension)]}
        if filename:
            path = filedialog.asksaveasfilename(**options, initialfile=filename, defaultextension=extension,
                                               confirmoverwrite=False)
        else:
            path = filedialog.askopenfilename(**options)
        return _result(path) if path else {"status": "cancelled"}
    finally:
        root.destroy()


def _run(mode: str, stop: threading.Event) -> dict:
    if mode not in MODES or not _DIALOG_LOCK.acquire(blocking=False):
        return _unavailable()
    try:
        if stop.is_set():
            return _unavailable()
        command = [sys.executable, "-I", "-B", str(Path(__file__).resolve()), mode]
        with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)) as child:
            deadline = time.monotonic() + _DIALOG_TIMEOUT
            while not stop.is_set() and time.monotonic() < deadline:
                try:
                    stdout, _ = child.communicate(timeout=_POLL_INTERVAL)
                except subprocess.TimeoutExpired:
                    continue
                if child.returncode:
                    return _unavailable()
                reply = json.loads(stdout)
                if isinstance(reply, dict) and reply.get("status") == "selected":
                    return _result(reply.get("path"))
                return {"status": "cancelled"} if reply == {"status": "cancelled"} else _unavailable()
            child.kill()
            child.communicate()
            return _unavailable()
    except (OSError, UnicodeError, ValueError):
        return _unavailable()
    finally:
        _DIALOG_LOCK.release()


async def choose(mode: str, disconnected) -> dict:
    stop = threading.Event()
    task = asyncio.create_task(asyncio.to_thread(_run, mode, stop))
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=_POLL_INTERVAL)
            if not task.done() and await disconnected():
                return {"status": "cancelled"}
        return task.result()
    finally:
        stop.set()


if __name__ == "__main__":
    try:
        result = _show(sys.argv[1])
    except Exception:
        result = _unavailable()
    print(json.dumps(result))
