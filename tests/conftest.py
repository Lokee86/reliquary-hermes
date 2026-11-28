"""Pinned probes use an isolated profile and never load user configuration."""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

from reliquary_hermes import HERMES_REMOVALS_REVISION, HERMES_REVISION

HERMES_INFERENCE_REVISION = "8fc0374447313e276f6b9a2764bfc750190c966a"


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
def removal_checkout():
    value = os.environ.get("HP_REMOVAL_HERMES_CHECKOUT")
    if not value:
        pytest.skip("Set HP_REMOVAL_HERMES_CHECKOUT for committed removal probes")
    checkout = Path(value).resolve(strict=True)
    actual = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    assert actual == HERMES_REMOVALS_REVISION, "unsupported Hermes removal revision"
    return checkout


@pytest.fixture(scope="session")
def inference_checkout():
    value = os.environ.get("HP_INFERENCE_HERMES_CHECKOUT")
    if not value:
        pytest.skip("Set HP_INFERENCE_HERMES_CHECKOUT for hosted inference process tests")
    checkout = Path(value).resolve(strict=True)
    actual = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    assert actual == HERMES_INFERENCE_REVISION, "unsupported Hermes inference revision"
    assert not subprocess.check_output(
        ["git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"], text=True
    ).strip(), "hosted inference requires unmodified stock Hermes"
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
