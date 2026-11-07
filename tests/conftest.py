"""No plugin autoload, user configuration, model calls, or external cache writes."""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

from reliquary_hermes import HERMES_REVISION


@pytest.fixture(scope="session")
def pinned_abc():
    value = os.environ.get("HP01_HERMES_CHECKOUT")
    if not value:
        pytest.skip("Set HP01_HERMES_CHECKOUT for the pinned, dependency-free ABC probe")
    checkout = Path(value).resolve()
    actual = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    assert actual == HERMES_REVISION, "unsupported Hermes revision"
    spec = importlib.util.spec_from_file_location("hp01_pinned_memory_provider", checkout / "agent" / "memory_provider.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
