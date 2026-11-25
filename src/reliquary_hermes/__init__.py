"""Reliquary Hermes protocol constants and standalone provider registration."""

from pathlib import Path
import logging


HERMES_REVISION = "2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19"
HERMES_INFERENCE_REVISION = "168a923023a7018be3dbf66530531dd20b1834b9"
HERMES_REMOVALS_REVISION = "4f1bf621049ebbf811ed4a3b1cc444c910db5d0f"
PROTOCOL_VERSION = 1
logger = logging.getLogger(__name__)


def register(context):
    llm = getattr(context, "llm", None)
    if llm is None:
        logger.warning("Reliquary hosted inference unavailable: Hermes ctx.llm embedding support is required (embedding_unavailable).")
    else:
        on_unload = getattr(context, "on_unload", None)
        if callable(on_unload):
            try:
                from .inference_worker import HostedInferenceWorker
                from .provider import _availability_home

                worker = HostedInferenceWorker(llm, str(_availability_home()))
                worker.start()
                on_unload(worker.stop)
            except (OSError, RuntimeError, ValueError):
                logger.warning("Reliquary hosted inference worker could not bind to the current Hermes profile.")
        else:
            logger.warning("Reliquary hosted inference unavailable: plugin unload lifecycle is unsupported.")
    from .provider import ReliquaryMemoryProvider

    register_memory_provider = getattr(context, "register_memory_provider", None)
    if callable(register_memory_provider):
        register_memory_provider(ReliquaryMemoryProvider())
    if Path(__file__).with_name("host-pin.json").is_file():
        from .source_observer import register as register_observer

        register_observer(context)
