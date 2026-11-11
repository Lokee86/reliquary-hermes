import { useCallback, useMemo, useState } from "react";
import { clampDisplaySettings, loadDisplaySettings, saveDisplaySettings } from "./model/displaySettings";
import type { DisplaySettings } from "./model/displaySettings";
import { clampAnimationSettings, loadAnimationSettings, saveAnimationSettings } from "./model/animationSettings";
import type { GraphAnimationSettings } from "./model/animationSettings";
import { clearStoredGraphView, loadStoredGraphView, parseStoredGraphView, saveStoredGraphView } from "./model/viewDefaults";
import type { StoredGraphView } from "./model/viewDefaults";
import { createPreferenceSessionStore } from "./model/scopedStorage";
import type { StorageLike } from "./model/scopedStorage";

/** Presentation state only. A host without a profile namespace never writes browser storage. */
export function useGraphPreferences(profileKey: string | null, ownerKey: string, hostSession?: StorageLike) {
  const localSession = useMemo(createPreferenceSessionStore, [profileKey, ownerKey]);
  const session = hostSession ?? localSession;
  const scope = useMemo(() => ({ profileKey }), [profileKey]);
  const viewScope = useMemo(() => ({ profileKey, ownerKey }), [profileKey, ownerKey]);
  const [display, setDisplay] = useState(() => loadDisplaySettings(scope, session));
  const [animation, setAnimation] = useState(() => loadAnimationSettings(scope, session));
  const [defaultView, setDefaultView] = useState(() => loadStoredGraphView(viewScope, session));
  const [rerollToken, setRerollToken] = useState(0);
  const [captureRequest, setCaptureRequest] = useState(0);
  const [resetRequest, setResetRequest] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const updateDisplay = useCallback((next: DisplaySettings) => {
    const value = clampDisplaySettings(next);
    setDisplay(value);
    saveDisplaySettings(value, scope, session);
  }, [scope, session]);
  const updateAnimation = useCallback((next: GraphAnimationSettings) => {
    const value = clampAnimationSettings(next);
    setAnimation(value);
    saveAnimationSettings(value, scope, session);
  }, [scope, session]);
  const captureView = useCallback((value: StoredGraphView) => {
    const view = parseStoredGraphView(value);
    if (!view) return;
    setDefaultView(view);
    saveStoredGraphView(view, viewScope, session);
  }, [viewScope, session]);
  const restoreFactoryView = useCallback(() => {
    clearStoredGraphView(viewScope, session);
    setDefaultView(null);
    setResetRequest(value => value + 1);
  }, [viewScope, session]);
  return {
    display, updateDisplay, animation, updateAnimation, defaultView, captureView,
    rerollToken, reroll: () => setRerollToken(value => value + 1),
    captureRequest, requestCapture: () => setCaptureRequest(value => value + 1),
    resetRequest, restoreFactoryView, cameraReady, setCameraReady,
  };
}
