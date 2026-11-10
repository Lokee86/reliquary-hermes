import type { HostControls } from "../host";
import type { GraphRenderNodeResolution } from "../graph/render";

export interface GraphSelection {
  resolution: GraphRenderNodeResolution;
  generationId: string;
  renderId: number;
}

interface Props { selection: GraphSelection | null; controls: HostControls; onOpenMemory(memoryId: string): void; }

export function GraphSelectionInspector({ selection, controls, onOpenMemory }: Props) {
  const { Button } = controls;
  return (
    <aside className="knowledge-inspector" aria-label="Graph selection">
      <div className="eyebrow">GRAPH SELECTION</div>
      {!selection ? <div className="knowledge-state">Select a node in the graph.</div> : (
        <>
          <h2>Memory selected</h2>
          <dl className="knowledge-details">
            <div><dt>Memory ID</dt><dd>{selection.resolution.memoryId}</dd></div>
            <div><dt>Render generation</dt><dd>{selection.generationId}</dd></div>
          </dl>
          <Button type="button" onClick={() => onOpenMemory(selection.resolution.memoryId)}>Inspect in List</Button>
        </>
      )}
    </aside>
  );
}
