import { useEffect, useState } from "react";

type Rgb = readonly [number, number, number];
export interface HermesMarkerColors {
  primary: Rgb;
  ring: Rgb;
}

function resolveCssColor(context: CanvasRenderingContext2D, value: string): Rgb | null {
  if (!value.trim()) return null;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "rgba(0, 0, 0, 0)";
  context.fillStyle = value.trim();
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (!alpha) return null;
  return [red / 255, green / 255, blue / 255];
}

export function useHermesMarkerColors(): HermesMarkerColors | null {
  const [colors, setColors] = useState<HermesMarkerColors | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const surface = document.querySelector<HTMLElement>(".knowledge-surface");
    const root = document.documentElement;
    const body = document.body;

    const refresh = () => {
      if (!context) return;
      const themeRoot = surface ?? root;
      const style = getComputedStyle(themeRoot);
      const primary = resolveCssColor(context, style.getPropertyValue("--reliquary-primary"));
      const ring = resolveCssColor(context, style.getPropertyValue("--reliquary-ring"));
      if (!primary || !ring) return;
      setColors((current) => current?.primary.every((value, index) => value === primary[index])
        && current.ring.every((value, index) => value === ring[index])
        ? current
        : { primary, ring });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    const observeThemeAttributes = (element: Element | null) => {
      if (element) observer.observe(element, { attributes: true, attributeFilter: ["class", "style"] });
    };
    observeThemeAttributes(root);
    observeThemeAttributes(body);
    observeThemeAttributes(surface);
    return () => observer.disconnect();
  }, []);

  return colors;
}
