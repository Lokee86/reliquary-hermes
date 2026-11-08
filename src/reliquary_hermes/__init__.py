"""Reliquary Hermes protocol constants and standalone provider registration."""

HERMES_REVISION = "2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19"
PROTOCOL_VERSION = 1


def register(context):
    from .provider import ReliquaryMemoryProvider

    context.register_memory_provider(ReliquaryMemoryProvider())
