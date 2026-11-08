"""Reliquary Hermes protocol constants and standalone provider registration."""

HERMES_REVISION = "cf4f3a7396814ffcaef69d9af09f7cfdade3ddbe"
PROTOCOL_VERSION = 1


def register(context):
    from .provider import ReliquaryMemoryProvider

    context.register_memory_provider(ReliquaryMemoryProvider())
