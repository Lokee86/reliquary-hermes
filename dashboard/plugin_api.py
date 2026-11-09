"""Hermes manifest-loaded backend router for the Reliquary dashboard."""

from plugins.memory import import_provider_module

router = import_provider_module("reliquary", "dashboard_api").router
