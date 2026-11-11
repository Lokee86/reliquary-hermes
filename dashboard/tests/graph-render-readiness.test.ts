import assert from "node:assert/strict";
import test from "node:test";
import { createDrawReadyReporter } from "../src/graph/render/drawReadiness";

test("graph readiness is reported once after a node draw signal", () => {
  let readyCount = 0;
  const reportDrawReady = createDrawReadyReporter(() => { readyCount += 1; });

  assert.equal(readyCount, 0, "loading a frame alone must not report a drawn graph");
  reportDrawReady();
  assert.equal(readyCount, 1);
  reportDrawReady();
  assert.equal(readyCount, 1, "additional chunk draws do not cause readiness rerenders");
});
