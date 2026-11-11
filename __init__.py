"""Hermes directory-plugin entry point for Reliquary."""


def register(context):
    from .src.reliquary_hermes.provider import ReliquaryMemoryProvider
    from .src.reliquary_hermes.source_observer import register as register_observer

    # Hermes discovers exclusive providers separately from generic plugin hooks.
    # The generic PluginContext does not expose the memory-provider slot.
    provider = ReliquaryMemoryProvider()
    register_provider = getattr(context, "register_memory_provider", None)
    if register_provider is not None:
        register_provider(provider)
    register_observer(context)
