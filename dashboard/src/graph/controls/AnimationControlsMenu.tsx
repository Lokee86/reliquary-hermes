import { useState, type ComponentType } from "react";
import { usePreferencePopover, stopPreferenceEvent } from "./usePreferencePopover";
import { createPortal } from "react-dom";
import type { ButtonProps } from "../../host";
import {
  ANIMATION_LIMITS,
  DEFAULT_ANIMATION_SETTINGS,
  type AxisAnimationSettings,
  type GraphAnimationSettings,
} from "../model/animationSettings";
import "./graph-preferences.css";

interface AnimationControlsMenuProps {
  settings: GraphAnimationSettings;
  hasCustomDefaultView: boolean;
  canSetCurrentView: boolean;
  onChange: (next: GraphAnimationSettings) => void;
  onReroll: () => void;
  onSetCurrentViewAsDefault: () => void;
  onRestoreFactoryView: () => void;
  Button: ComponentType<ButtonProps>;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="graph-preferences-number-field">
      <span className="graph-preferences-number-label">{label}</span>
      <span className="graph-preferences-number-control">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span>{suffix}</span>
      </span>
    </label>
  );
}

function AxisRow({
  axis,
  value,
  onChange,
}: {
  axis: "X" | "Y" | "Z";
  value: AxisAnimationSettings;
  onChange: (next: AxisAnimationSettings) => void;
}) {
  return (
    <div className="graph-preferences-axis">
      <div className="graph-preferences-axis-heading">
        <span>{axis} axis</span>
        <label className="graph-preferences-counterspin">
          <input
            type="checkbox"
            checked={value.randomCounterspin}
            onChange={(event) => onChange({ ...value, randomCounterspin: event.target.checked })}
          />
          Random counterspin
        </label>
      </div>
      <div className="graph-preferences-axis-fields">
        <NumberField
          label="Speed"
          value={value.speed}
          min={ANIMATION_LIMITS.speed.min}
          max={ANIMATION_LIMITS.speed.max}
          step={0.05}
          suffix="RPM"
          onChange={(speed) => onChange({ ...value, speed })}
        />
        <NumberField
          label="Random range"
          value={value.randomRange}
          min={ANIMATION_LIMITS.randomRange.min}
          max={ANIMATION_LIMITS.randomRange.max}
          step={0.05}
          suffix="±RPM"
          onChange={(randomRange) => onChange({ ...value, randomRange })}
        />
      </div>
    </div>
  );
}

export function AnimationControlsMenu({
  settings,
  hasCustomDefaultView,
  canSetCurrentView,
  onChange,
  onReroll,
  onSetCurrentViewAsDefault,
  onRestoreFactoryView,
  Button,
}: AnimationControlsMenuProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { triggerRef, panelRef } = usePreferencePopover(open, close);
  const portalRoot = triggerRef.current?.closest(".knowledge-surface") ?? null;
  const setAxis = (key: "x" | "y" | "z", value: AxisAnimationSettings) =>
    onChange({ ...settings, [key]: value });

  return (
    <div ref={triggerRef} className="graph-preferences-anchor">
      {open && portalRoot && createPortal(
        <div
          id="graph-animation-preferences"
          ref={panelRef}
          role="dialog"
          aria-label="Graph animation controls"
          aria-modal="false"
          data-placement="above"
          className="graph-preferences-popover graph-preferences-animation"
          onPointerDown={stopPreferenceEvent}
          onPointerUp={stopPreferenceEvent}
          onClick={stopPreferenceEvent}
          onKeyDown={stopPreferenceEvent}
          onWheel={stopPreferenceEvent}
        >
          <div className="graph-preferences-animation-heading">
            <div>
              <p className="graph-preferences-section-title">Animation</p>
              <p className="graph-preferences-caption">Signed world-axis rotation around the current pivot</p>
            </div>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_ANIMATION_SETTINGS)}
              className="graph-preferences-text-button"
            >
              Reset motion
            </button>
          </div>

          <div className="graph-preferences-delay-row">
            <NumberField
              label="Animation start delay"
              value={settings.startDelay}
              min={ANIMATION_LIMITS.startDelay.min}
              max={ANIMATION_LIMITS.startDelay.max}
              step={1}
              suffix="sec"
              onChange={(startDelay) => onChange({ ...settings, startDelay })}
            />
            <Button type="button" variant="outline" className="graph-preferences-secondary-button" onClick={onReroll}>
              Reroll
            </Button>
          </div>

          <AxisRow axis="X" value={settings.x} onChange={(value) => setAxis("x", value)} />
          <AxisRow axis="Y" value={settings.y} onChange={(value) => setAxis("y", value)} />
          <AxisRow axis="Z" value={settings.z} onChange={(value) => setAxis("z", value)} />

          <div className="graph-preferences-view-actions">
            <Button
              type="button"
              variant="outline"
              className="graph-preferences-view-button"
              onClick={onSetCurrentViewAsDefault}
              disabled={!canSetCurrentView}
            >
              Set Current View as Default
            </Button>
            <Button
              type="button"
              variant="outline"
              className="graph-preferences-view-button"
              onClick={onRestoreFactoryView}
              disabled={!hasCustomDefaultView}
            >
              Restore Factory View
            </Button>
          </div>

          <Button
            type="button"
            className="graph-preferences-motion-toggle"
            variant={settings.enabled ? "default" : "outline"}
            onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          >
            {settings.enabled ? "Pause animation" : "Start animation"}
          </Button>

          <p className="graph-preferences-footnote">
            Random values reroll after the interaction delay. Negative speed reverses direction. A custom view is stored separately from the factory view.
          </p>
        </div>,
        portalRoot,
      )}

      <Button
        type="button"
        variant="outline"
        className="graph-preferences-trigger graph-preferences-animation-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? "graph-animation-preferences" : undefined}
      >
        Animation
        <span className={`graph-preferences-status-dot ${settings.enabled ? "is-enabled" : ""}`} aria-label={settings.enabled ? "Animation enabled" : "Animation paused"} />
      </Button>
    </div>
  );
}
