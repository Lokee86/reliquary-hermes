import type { DisplaySettings } from "../model/displaySettings";
import type { GraphAnimationSettings } from "../model/animationSettings";
import type { GraphCameraPreferences } from "./GraphCameraBridge";

export interface GraphPresentation {
  display: DisplaySettings;
  animation: GraphAnimationSettings;
  rerollToken: number;
  selectedCommunityId: string | null;
  camera: GraphCameraPreferences;
}
