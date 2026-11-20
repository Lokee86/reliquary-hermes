"""Hermes directory-plugin entry point for the Reliquary MemoryProvider."""


def register(context):
    from .src.reliquary_hermes import register as register_runtime
    from .src.reliquary_hermes.source_observer import register as register_observer

    register_runtime(context)
    register_observer(context)
