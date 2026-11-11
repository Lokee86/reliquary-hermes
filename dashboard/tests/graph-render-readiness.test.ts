import assert from "node:assert/strict";
import test from "node:test";
import { createDrawReadyReporter } from "../src/graph/render/drawReadiness";

test("graph readiness waits until every planned chunk draws", () => {
  let readyCount = 0;
  const reportDrawReady = createDrawReadyReporter([3, 7, 11], () => { readyCount += 1; });

  reportDrawReady(99);
  reportDrawReady(3);
  assert.equal(readyCount, 0, "unknown and partial chunks do not report a drawn graph");
  reportDrawReady(7);
  assert.equal(readyCount, 0, "readiness stays false until the last planned chunk draws");
  reportDrawReady(11);
  assert.equal(readyCount, 1);
  reportDrawReady(3);
  reportDrawReady(11);
  assert.equal(readyCount, 1, "duplicate callbacks do not cause readiness rerenders");
});
