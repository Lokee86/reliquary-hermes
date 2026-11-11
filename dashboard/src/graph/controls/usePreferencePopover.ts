import { useEffect, useLayoutEffect, useRef, type SyntheticEvent } from "react";

export function stopPreferenceEvent(event: SyntheticEvent) { event.stopPropagation(); }

/** Original outside/Escape behavior plus Hermes pane-aware portal placement. */
export function usePreferencePopover(open: boolean, onClose: () => void) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const position = () => {
      const margin = 8;
      let leftBound = 0, topBound = 0, rightBound = window.innerWidth, bottomBound = window.innerHeight;
      let ancestor = trigger.closest<HTMLElement>(".knowledge-surface");
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        const rect = ancestor.getBoundingClientRect();
        if (ancestor.classList.contains("knowledge-surface") || /(hidden|clip|auto|scroll)/.test(style.overflowX)) {
          leftBound = Math.max(leftBound, rect.left);
          rightBound = Math.min(rightBound, rect.right);
        }
        if (ancestor.classList.contains("knowledge-surface") || /(hidden|clip|auto|scroll)/.test(style.overflowY)) {
          topBound = Math.max(topBound, rect.top);
          bottomBound = Math.min(bottomBound, rect.bottom);
        }
        ancestor = ancestor.parentElement;
      }
      leftBound += margin; topBound += margin; rightBound -= margin; bottomBound -= margin;
      panel.style.maxWidth = `${Math.max(0, rightBound - leftBound)}px`;
      panel.style.maxHeight = `${Math.max(0, bottomBound - topBound)}px`;
      const anchor = trigger.getBoundingClientRect();
      const menu = panel.getBoundingClientRect();
      const above = anchor.top - menu.height - margin;
      const below = anchor.bottom + margin;
      const fitsAbove = above >= topBound;
      const fitsBelow = below + menu.height <= bottomBound;
      const preferred = panel.dataset.placement === "above"
        ? (fitsAbove || !fitsBelow ? above : below)
        : (fitsBelow || !fitsAbove ? below : above);
      panel.style.left = `${Math.max(leftBound, Math.min(anchor.right - menu.width, rightBound - menu.width))}px`;
      panel.style.top = `${Math.max(topBound, Math.min(preferred, bottomBound - menu.height))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    observer.observe(trigger);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      close.current();
      triggerRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    panelRef.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return { triggerRef, panelRef };
}
