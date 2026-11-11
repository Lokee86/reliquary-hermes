import assert from "node:assert/strict";
import { compareFrames, captureCanvas } from "./graph-preferences-live.mjs";
import { verifyOwnerScope } from "./knowledge-live.mjs";

const STORAGE_PREFIX = "reliquary.graph.preferences.v1:";

async function enterMainGraph(page, fixture) {
  const app = page.getByRole("region", { name: "Reliquary", exact: true });
  const sections = app.getByRole("navigation", { name: "Reliquary sections" });
  await sections.waitFor({ timeout: 30000 });
  await sections.getByRole("button", { name: "Knowledge", exact: true }).click();
  await verifyOwnerScope(app, fixture.ownerIds.main, "REL");
  const view = app.getByRole("group", { name: "Knowledge view" });
  const graphButton = view.getByRole("button", { name: "Graph", exact: true });
  if (await graphButton.getAttribute("aria-pressed") !== "true") await graphButton.click();
  const graph = app.locator(".knowledge-graph-wrap");
  await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  const canvas = graph.locator("canvas");
  await canvas.waitFor({ state: "visible", timeout: 15000 });
  return { app, graph, canvas };
}

async function switchOwner(app, ownerId, kind) {
  await verifyOwnerScope(app, ownerId, kind);
  const graph = app.locator(".knowledge-graph-wrap");
  await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  return { graph, canvas: graph.locator("canvas") };
}

async function openAnimation(app) {
  await app.getByRole("button", { name: /^Animation/ }).first().click();
  const dialog = app.getByRole("dialog", { name: "Graph animation controls" });
  await dialog.waitFor({ state: "visible" });
  return dialog;
}

async function pauseAnimation(page, app) {
  const dialog = await openAnimation(app);
  const pause = dialog.getByRole("button", { name: "Pause animation", exact: true });
  if (await pause.isVisible()) await pause.click();
  await dialog.getByRole("button", { name: "Start animation", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}

async function dragCamera(page, canvas, dx, dy) {
  const box = await canvas.boundingBox();
  assert(box && box.width > 50 && box.height > 50, "Graph canvas is too small for camera drag.");
  const x = box.x + box.width * 0.68;
  const y = box.y + box.height * 0.68;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function capture(canvas, fixture, name) {
  return captureCanvas(canvas, fixture.screenshotDir ?? null, name);
}

function assertChanged(label, before, after) {
  const diff = compareFrames(before.frame, after.frame);
  assert(diff.changedPixels >= 8, label + " did not change the rendered camera frame.");
  return diff;
}

function assertFrameRestored(label, expected, actual) {
  const diff = compareFrames(expected.frame, actual.frame);
  assert(diff.ratio <= 0.02, label + " did not restore the saved view; changed pixel ratio was " + diff.ratio + ".");
  return diff;
}

async function cameraKeys(page, ownerId) {
  return page.evaluate(({ prefix, ownerId }) => Object.keys(localStorage).filter(key => {
    const profilePart = key.startsWith(prefix + "profile:") && key.endsWith(":camera-view")
      ? key.slice((prefix + "profile:").length, -":camera-view".length) : "";
    try { return JSON.parse(decodeURIComponent(profilePart))?.[1] === ownerId; } catch { return false; }
  }).sort(), { prefix: STORAGE_PREFIX, ownerId });
}

function viewVectors(raw) {
  const view = JSON.parse(raw);
  assert(["position", "target", "up"].every(name => Array.isArray(view[name]) && view[name].length === 3
    && view[name].every(Number.isFinite)), "Camera record is missing finite position, target, or up vectors.");
  return view;
}

function assertViewVectorsClose(expectedRaw, actualRaw) {
  const expected = viewVectors(expectedRaw);
  const actual = viewVectors(actualRaw);
  for (const name of ["position", "target", "up"]) {
    expected[name].forEach((value, index) => assert(Math.abs(value - actual[name][index]) <= 1e-5,
      "Reload changed camera " + name + "[" + index + "] by more than 1e-5."));
  }
}

async function storageSnapshot(page) {
  return page.evaluate(prefix => Object.fromEntries(Object.keys(localStorage)
    .filter(key => key.startsWith(prefix)).sort().map(key => [key, localStorage.getItem(key)])), STORAGE_PREFIX);
}

function poisonViewRecord(raw) {
  const record = JSON.parse(raw);
  let changed = 0;
  const names = new Set(["position", "target", "up"]);
  function visit(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (names.has(key) && Array.isArray(child) && child.length === 3 && child.every(Number.isFinite)) {
        value[key] = [1e15, 1e15 + 1, 1e15 + 2];
        changed += 3;
      } else if (names.has(key) && child && typeof child === "object"
          && ["x", "y", "z"].every(axis => Number.isFinite(child[axis]))) {
        value[key] = { x: 1e15, y: 1e15 + 1, z: 1e15 + 2 };
        changed += 3;
      } else visit(child);
    }
  }
  visit(record);
  assert(changed >= 6, "Saved camera record did not include finite position and target/up vectors.");
  return JSON.stringify(record);
}

async function waitRestoreState(page, enabled) {
  await page.waitForFunction(value => [...document.querySelectorAll("button")]
    .some(button => button.textContent?.trim() === "Restore Factory View" && button.disabled !== value),
  enabled, { timeout: 10000 });
}

/**
 * Test camera preferences through graph controls and rendered canvas frames.
 * The caller owns host setup, fixture validation, and browser lifetime.
 */
export async function exerciseGraphCameraViews(page, fixture, surface) {
  assert(["web", "desktop"].includes(surface), "Pass surface as 'web' or 'desktop'.");
  assert(fixture?.ownerIds?.main, "Camera view fixture requires a prepared main REL owner.");

  let { app, graph, canvas } = await enterMainGraph(page, fixture);
  await pauseAnimation(page, app);
  const storageAtStart = await storageSnapshot(page);
  const factoryFrame = await capture(canvas, fixture, surface + "-camera-factory");

  await dragCamera(page, canvas, 132, 84);
  const rotatedFrame = await capture(canvas, fixture, surface + "-camera-rotated");
  const rotateDiff = assertChanged("Pointer drag rotation", factoryFrame, rotatedFrame);

  let dialog = await openAnimation(app);
  const save = dialog.getByRole("button", { name: "Set Current View as Default", exact: true });
  assert(await save.isEnabled(), "Set Current View must be enabled after graph readiness.");
  await save.click();
  await waitRestoreState(page, true);
  const savedFrame = await capture(canvas, fixture, surface + "-camera-saved");
  const saved = await page.evaluate(({ prefix, ownerId }) => {
    const key = Object.keys(localStorage).find(item => {
      const part = item.startsWith(prefix + "profile:") && item.endsWith(":camera-view")
        ? item.slice((prefix + "profile:").length, -":camera-view".length) : "";
      try { return JSON.parse(decodeURIComponent(part))?.[1] === ownerId; } catch { return false; }
    });
    return key ? { key, value: localStorage.getItem(key) } : null;
  }, { prefix: STORAGE_PREFIX, ownerId: fixture.ownerIds.main });
  if (surface === "desktop") assert(saved?.value, "Desktop did not persist the UI-saved camera view.");
  else assert.deepEqual(await cameraKeys(page, fixture.ownerIds.main), [],
    "Web camera views must remain in mount-local session storage.");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  await dragCamera(page, canvas, -148, 96);
  assertChanged("Movement after save", savedFrame, await capture(canvas, fixture, surface + "-camera-away"));
  await page.reload({ waitUntil: "domcontentloaded" });
  ({ app, graph, canvas } = await enterMainGraph(page, fixture));
  await pauseAnimation(page, app);
  dialog = await openAnimation(app);
  const restoreOnReload = dialog.getByRole("button", { name: "Restore Factory View", exact: true });
  let reloadDiff = null;
  if (surface === "desktop") {
    assert(await restoreOnReload.isEnabled(), "Desktop reload did not restore the profile camera view.");
    reloadDiff = assertFrameRestored("Desktop reload", savedFrame,
      await capture(canvas, fixture, "desktop-camera-reloaded"));
    const reloadedRecord = await page.evaluate(key => localStorage.getItem(key), saved.key);
    assert(reloadedRecord, "Profile camera record disappeared on reload.");
    assertViewVectorsClose(saved.value, reloadedRecord);
    assert.equal(reloadedRecord, saved.value, "Reload changed the UI-saved profile camera record.");
  } else {
    assert(await restoreOnReload.isDisabled(), "Web reload must discard its mount-local camera view.");
    assertFrameRestored("Web reload factory fallback", factoryFrame,
      await capture(canvas, fixture, "web-camera-reloaded-factory"));
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  if (surface === "web") {
    assert.deepEqual(await storageSnapshot(page), storageAtStart,
      "Web camera actions wrote graph preferences to localStorage.");
    return { surface, rotateDiff, reloadDiff, storageKeys: Object.keys(storageAtStart).length };
  }
  if (!fixture.ownerIds.phy) return { surface, rotateDiff, reloadDiff };

  // PHY begins at its own factory view, receives its own custom record, and
  // remains isolated when REL factory state is restored.
  let phy = await switchOwner(app, fixture.ownerIds.phy, "PHY");
  ({ graph, canvas } = phy);
  await pauseAnimation(page, app);
  dialog = await openAnimation(app);
  const restorePhy = dialog.getByRole("button", { name: "Restore Factory View", exact: true });
  assert(await restorePhy.isDisabled(), "Main REL camera view leaked into PHY.");
  const phyFactory = await capture(canvas, fixture, "desktop-phy-factory");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await dragCamera(page, canvas, 96, -112);
  dialog = await openAnimation(app);
  await dialog.getByRole("button", { name: "Set Current View as Default", exact: true }).click();
  await waitRestoreState(page, true);
  const phySaved = await capture(canvas, fixture, "desktop-phy-saved");
  const phyDiff = assertChanged("PHY camera drag", phyFactory, phySaved);
  const phyKey = (await cameraKeys(page, fixture.ownerIds.phy))[0];
  assert(phyKey, "PHY view was not stored under its own owner scope.");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  ({ graph, canvas } = await switchOwner(app, fixture.ownerIds.main, "REL"));
  await pauseAnimation(page, app);
  dialog = await openAnimation(app);
  const restoreMain = dialog.getByRole("button", { name: "Restore Factory View", exact: true });
  assert(await restoreMain.isEnabled(), "Returning to REL did not retain its saved camera view.");
  const beforeFactory = await storageSnapshot(page);
  const mainKey = (await cameraKeys(page, fixture.ownerIds.main))[0];
  assert(mainKey, "Expected the saved main REL camera record.");
  await restoreMain.click();
  await waitRestoreState(page, false);
  const afterFactory = await storageSnapshot(page);
  const beforeWithoutMain = Object.fromEntries(Object.entries(beforeFactory).filter(([key]) => key !== mainKey));
  const afterWithoutMain = Object.fromEntries(Object.entries(afterFactory).filter(([key]) => key !== mainKey));
  assert.deepEqual(afterWithoutMain, beforeWithoutMain,
    "Main factory restore changed PHY camera, display, or animation preferences.");
  assert(afterFactory[phyKey], "Main factory restore deleted the PHY camera record.");
  assert(Object.keys(afterFactory).some(key => key.endsWith(":display")), "Expected display preference to survive factory restore.");
  assert(Object.keys(afterFactory).some(key => key.endsWith(":animation")), "Expected motion preference to survive factory restore.");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  // Re-save via UI, poison only the REL record, and refresh the owner without
  // writing REL data. The graph should reject huge finite camera coordinates.
  dialog = await openAnimation(app);
  await dialog.getByRole("button", { name: "Set Current View as Default", exact: true }).click();
  await waitRestoreState(page, true);
  const raw = await page.evaluate(({ prefix, ownerId }) => {
    const key = Object.keys(localStorage).find(item => {
      const part = item.startsWith(prefix + "profile:") && item.endsWith(":camera-view")
        ? item.slice((prefix + "profile:").length, -":camera-view".length) : "";
      try { return JSON.parse(decodeURIComponent(part))?.[1] === ownerId; } catch { return false; }
    });
    return key ? { key, value: localStorage.getItem(key) } : null;
  }, { prefix: STORAGE_PREFIX, ownerId: fixture.ownerIds.main });
  assert(raw?.value, "Could not obtain the owned REL camera record for fallback testing.");
  const poisoned = poisonViewRecord(raw.value);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: raw.key, value: poisoned });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await app.getByRole("button", { name: "Refresh owner data", exact: true }).click();
  ({ app, graph, canvas } = await enterMainGraph(page, fixture));
  await pauseAnimation(page, app);
  dialog = await openAnimation(app);
  assert(await dialog.getByRole("button", { name: "Restore Factory View", exact: true }).isDisabled(),
    "Huge-coordinate view was applied after refresh instead of falling back to factory.");
  const fallbackDiff = assertFrameRestored("Invalid-record refresh fallback", factoryFrame,
    await capture(canvas, fixture, "desktop-camera-invalid-fallback"));
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: raw.key, value: raw.value });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await app.getByRole("button", { name: "Refresh owner data", exact: true }).click();
  ({ app, graph, canvas } = await enterMainGraph(page, fixture));
  await pauseAnimation(page, app);
  dialog = await openAnimation(app);
  const cleanupMain = dialog.getByRole("button", { name: "Restore Factory View", exact: true });
  assert(await cleanupMain.isEnabled(), "Valid REL camera record did not reload for cleanup.");
  await cleanupMain.click();
  await waitRestoreState(page, false);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  // Clean up the PHY record through its own Factory View action.
  ({ graph, canvas } = await switchOwner(app, fixture.ownerIds.phy, "PHY"));
  await pauseAnimation(page, app);
  dialog = await openAnimation(app);
  const cleanupPhy = dialog.getByRole("button", { name: "Restore Factory View", exact: true });
  if (await cleanupPhy.isEnabled()) {
    await cleanupPhy.click();
    await waitRestoreState(page, false);
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  return { surface, rotateDiff, reloadDiff, phyDiff, fallbackDiff, cleanedCameraKeys: true };
}
