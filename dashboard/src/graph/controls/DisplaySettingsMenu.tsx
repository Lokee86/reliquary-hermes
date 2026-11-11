import { useState, type ComponentType } from "react";
import { usePreferencePopover, stopPreferenceEvent } from "./usePreferencePopover";
import { createPortal } from "react-dom";
import type { ButtonProps } from "../../host";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_LIMITS,
  type DisplaySettings,
} from "../model/displaySettings";
import "./graph-preferences.css";

interface DisplaySettingsMenuProps {
  settings: DisplaySettings;
  onChange: (next: DisplaySettings) => void;
  Button: ComponentType<ButtonProps>;
}

interface SliderRowProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  format?: "multiplier" | "percent" | "count";
  step?: number;
  onChange: (value: number) => void;
}

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  format = "multiplier",
  step = 0.05,
  onChange,
}: SliderRowProps) {
  return (
    <label className="graph-preferences-slider">
      <span className="graph-preferences-slider-heading">
        <span className="graph-preferences-label">{label}</span>
        <span className="graph-preferences-value">
          {format === "percent"
            ? `${Math.round(value * 100)}%`
            : format === "count"
              ? Math.round(value).toLocaleString("en-US")
              : `${value.toFixed(2)}×`}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`${label} (${hint})`}
      />
      <span className="graph-preferences-hint">{hint}</span>
    </label>
  );
}

/* Contrast / brightness preferences compose with automatic density compensation. */
export function DisplaySettingsMenu({
  settings,
  onChange,
  Button,
}: DisplaySettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { triggerRef, panelRef } = usePreferencePopover(open, close);
  const isDefault =
    settings.edgeBrightness === DEFAULT_DISPLAY_SETTINGS.edgeBrightness &&
    settings.nodeGlow === DEFAULT_DISPLAY_SETTINGS.nodeGlow &&
    settings.bloom === DEFAULT_DISPLAY_SETTINGS.bloom &&
    settings.territoryOpacity === DEFAULT_DISPLAY_SETTINGS.territoryOpacity &&
    settings.communityShellLimit === DEFAULT_DISPLAY_SETTINGS.communityShellLimit &&
    settings.cameraCenterIndicator === DEFAULT_DISPLAY_SETTINGS.cameraCenterIndicator;

  const set = (patch: Partial<DisplaySettings>) => onChange({ ...settings, ...patch });
  const portalRoot = triggerRef.current?.closest(".knowledge-surface") ?? null;

  return (
    <div ref={triggerRef} className="graph-preferences-anchor">
      <Button
        type="button"
        variant="outline"
        className="graph-preferences-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? "graph-display-preferences" : undefined}
        title="Display preferences"
      >
        Display{!isDefault && <span className="graph-preferences-indicator" aria-label="Custom display settings">•</span>}
      </Button>

      {open && portalRoot && createPortal(
        <div
          id="graph-display-preferences"
          ref={panelRef}
          role="dialog"
          aria-label="Display settings"
          aria-modal="false"
          data-placement="below"
          className="graph-preferences-popover graph-preferences-display"
          onPointerDown={stopPreferenceEvent}
          onPointerUp={stopPreferenceEvent}
          onClick={stopPreferenceEvent}
          onKeyDown={stopPreferenceEvent}
          onWheel={stopPreferenceEvent}
        >
          <div className="graph-preferences-section-heading">
            <span>Contrast</span>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_DISPLAY_SETTINGS)}
              className="graph-preferences-text-button"
              disabled={isDefault}
            >
              Reset
            </button>
          </div>

          <SliderRow
            label="Edge brightness"
            hint="Adjust relation brightness after automatic density compensation"
            value={settings.edgeBrightness}
            min={DISPLAY_LIMITS.edgeBrightness.min}
            max={DISPLAY_LIMITS.edgeBrightness.max}
            onChange={(edgeBrightness) => set({ edgeBrightness })}
          />
          <SliderRow
            label="Node glow"
            hint="Halo boost around each Memory"
            value={settings.nodeGlow}
            min={DISPLAY_LIMITS.nodeGlow.min}
            max={DISPLAY_LIMITS.nodeGlow.max}
            onChange={(nodeGlow) => set({ nodeGlow })}
          />
          <SliderRow
            label="Bloom"
            hint="Overall glow bloom strength"
            value={settings.bloom}
            min={DISPLAY_LIMITS.bloom.min}
            max={DISPLAY_LIMITS.bloom.max}
            onChange={(bloom) => set({ bloom })}
          />
          <SliderRow
            label="Territory shells"
            hint="Transparency of community shells"
            value={settings.territoryOpacity}
            min={DISPLAY_LIMITS.territoryOpacity.min}
            max={DISPLAY_LIMITS.territoryOpacity.max}
            format="percent"
            onChange={(territoryOpacity) => set({ territoryOpacity })}
          />
          <SliderRow
            label="Community shell limit"
            hint="Maximum community shells shown from the current frame"
            value={settings.communityShellLimit}
            min={DISPLAY_LIMITS.communityShellLimit.min}
            max={DISPLAY_LIMITS.communityShellLimit.max}
            step={1}
            format="count"
            onChange={(communityShellLimit) => set({ communityShellLimit })}
          />

          <div className="graph-preferences-subsection">
            <p className="graph-preferences-subheading">Overlays</p>
            <label className="graph-preferences-checkbox-row">
              <input
                type="checkbox"
                checked={settings.cameraCenterIndicator}
                onChange={(event) => set({ cameraCenterIndicator: event.target.checked })}
              />
              <span>
                <span className="graph-preferences-label">Camera center indicator</span>
                <span className="graph-preferences-hint">Show a non-pickable marker at the current camera pivot</span>
              </span>
            </label>
          </div>

          <p className="graph-preferences-footnote">
            Brightness controls multiply the automatic density compensation. Territory shells default to 30% so they frame communities without hiding relations.
          </p>
        </div>,
        portalRoot,
      )}
    </div>
  );
}
