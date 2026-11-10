"""Pinned probes use an isolated profile and never load user configuration."""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

from reliquary_hermes import HERMES_REVISION


@pytest.fixture(scope="session")
def pinned_checkout():
    value = os.environ.get("HP01_HERMES_CHECKOUT")
    if not value:
        pytest.skip("Set HP01_HERMES_CHECKOUT for the pinned Hermes source probes")
    checkout = Path(value).resolve()
    actual = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    assert actual == HERMES_REVISION, "unsupported Hermes revision"
    return checkout


@pytest.fixture(scope="session")
def history_checkout():
    value = os.environ.get("HU08_HERMES_INSTALLED_CHECKOUT")
    if not value:
        pytest.skip("Set HU08_HERMES_INSTALLED_CHECKOUT for the trusted Hermes history contract")
    checkout = Path(value).resolve(strict=True)
    assert (checkout / "hermes_state.py").is_file()
    return checkout


@pytest.fixture(scope="session")
def pinned_abc(pinned_checkout):
    spec = importlib.util.spec_from_file_location(
        "hp01_pinned_memory_provider", pinned_checkout / "agent" / "memory_provider.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
