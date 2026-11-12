"""Public provider-module entry used by the Hermes dashboard loader."""

from .src.reliquary_hermes.dashboard_api import router

__all__ = ["router"]
