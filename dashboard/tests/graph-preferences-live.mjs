import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { relative, isAbsolute, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { verifyOwnerScope } from "./knowledge-live.mjs";

const PREFERENCE_PREFIX = "reliquary.graph.preferences.v1:";
const DISPLAY_DEFAULTS = {
  "Edge brightness": { min: "0.1", value: "1", max: "3" },
  "Node glow": { min: "0", value: "1", max: "2" },
  Bloom: { min: "0", value: "1", max: "2" },
  "Territory shells": { min: "0", value: "0.3", max: "1" },
  "Community shell limit": { min: "0", value: "128", max: "128" },
};
const AXIS_DEFAULTS = {
  X: { speed: "0", randomRange: "0", counterspin: false },
  Y: { speed: "0.4", randomRange: "0", counterspin: false },
  Z: { speed: "0", randomRange: "0", counterspin: false },
};

function pngPixels(png) {
  assert(Buffer.isBuffer(png) && png.readUInt32BE(0) === 0x89504e47, "Canvas screenshot was not a PNG.");
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const data = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      depth = chunk[8];
      colorType = chunk[9];
    } else if (type === "IDAT") data.push(chunk);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  assert.equal(depth, 8, "Live screenshot decoder expects 8-bit canvas PNGs.");
  assert([2, 6].includes(colorType), "Live screenshot decoder expects RGB or RGBA canvas PNGs.");
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++];
    const rowOffset = y * rowBytes;
    const priorOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[sourceOffset++];
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const above = y > 0 ? pixels[priorOffset + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[priorOffset + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else assert.equal(filter, 0, `Unknown PNG filter ${filter}.`);
      pixels[rowOffset + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function compareFrames(left, right) {
  assert.equal(left.width, right.width, "Canvas dimensions changed between screenshots.");
  assert.equal(left.height, right.height, "Canvas dimensions changed between screenshots.");
  let changed = 0;
  const count = left.width * left.height;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const offset = pixel * left.channels;
    const otherOffset = pixel * right.channels;
    if (Math.max(
      Math.abs(left.pixels[offset] - right.pixels[otherOffset]),
      Math.abs(left.pixels[offset + 1] - right.pixels[otherOffset + 1]),
      Math.abs(left.pixels[offset + 2] - right.pixels[otherOffset + 2]),
    ) > 8) changed += 1;
  }
  return { changedPixels: changed, totalPixels: count, ratio: changed / count };
}

function countColorPixels(frame, colors) {
  let count = 0;
  for (let pixel = 0; pixel < frame.width * frame.height; pixel += 1) {
    const offset = pixel * frame.channels;
    if (colors.some(([r, g, b]) =>
      Math.max(
        Math.abs(frame.pixels[offset] - r),
        Math.abs(frame.pixels[offset + 1] - g),
        Math.abs(frame.pixels[offset + 2] - b),
      ) < 58)) count += 1;
  }
  return count;
}

function territoryColors(manifest) {
  return (manifest?.hierarchy ?? [])
    .filter((entry) => entry.kind === "territory" && entry.territory?.color)
    .slice(0, 48)
    .map(({ territory }) => territory.color.map((channel) => Math.round(channel * 255)));
}

async function setRangeValue(locator, value) {
  await locator.evaluate((input, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Range input value setter is unavailable.");
    setter.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await locator.evaluate((input, next) => {
    if (input.value !== String(next)) throw new Error(`Range control did not accept ${next}; got ${input.value}.`);
  }, value);
}

async function captureCanvas(canvas, screenshotDir, name) {
  await canvas.evaluate((element) => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  const path = screenshotDir ? join(screenshotDir, safeName + ".png") : undefined;
  // Read the actual WebGL framebuffer in the render frame. Element screenshots
  // also include HTML menus above the canvas and can falsely prove slider effects.
  const dataUrl = await canvas.evaluate((element) => new Promise((resolve) =>
    requestAnimationFrame(() => resolve({ dataUrl: element.toDataURL("image/png"), at: performance.now() }))));
  const png = Buffer.from(dataUrl.dataUrl.split(",", 2)[1], "base64");
  if (path) await import("node:fs/promises").then(({ writeFile }) => writeFile(path, png));
  return { frame: pngPixels(png), path, capturedAtMs: dataUrl.at };
}

function assertVisibleEffect(name, diff) {
  assert(diff.changedPixels >= 8, `${name} did not change the rendered canvas enough to prove a visual effect (${diff.changedPixels} changed pixels).`);
}

function graphApiOperation(request) {
  let url;
  try { url = new URL(request.url()); } catch { return null; }
  const match = url.pathname.match(/\/graph-render-v1\/([a-z-]+)$/);
  return match?.[1] ?? null;
}

async function assertPopoverFits(dialog, width, height) {
  let box;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    box = await dialog.boundingBox();
    if (box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 0.5 && box.y + box.height <= height + 0.5) break;
    await dialog.page().waitForTimeout(50);
  }
  assert(box && box.x >= 0 && box.y >= 0
    && box.x + box.width <= width + 0.5 && box.y + box.height <= height + 0.5,
  `Preference popover exceeded the ${width}px viewport.`);
  const clipping = await dialog.evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect();
    const clippedBy = [];
    let ancestor = panel.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if ([style.overflowX, style.overflowY].some((value) => ["hidden", "clip", "auto", "scroll"].includes(value))) {
        const rect = ancestor.getBoundingClientRect();
        const outside = panelRect.left < rect.left || panelRect.top < rect.top
          || panelRect.right > rect.right || panelRect.bottom > rect.bottom;
        if (outside) clippedBy.push({ className: ancestor.className?.baseVal ?? ancestor.className, overflowX: style.overflowX, overflowY: style.overflowY });
      }
      ancestor = ancestor.parentElement;
    }
    return clippedBy;
  });
  assert.deepEqual(clipping, [], "Preference popover is clipped by a canvas or surface ancestor.");
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

async function enterMainGraph(page, fixture) {
  const app = page.getByRole("region", { name: "Reliquary", exact: true });
  const sectionNav = app.getByRole("navigation", { name: "Reliquary sections" });
  await sectionNav.waitFor({ timeout: 30000 });
  await sectionNav.getByRole("button", { name: "Knowledge", exact: true }).click();
  // Begin from an unselected owner. Existing selection intentionally hides
  // ambient relations, so a brightness test must not inherit an inspector pick.
  if (fixture.ownerIds.phy) await verifyOwnerScope(app, fixture.ownerIds.phy, "PHY");
  await verifyOwnerScope(app, fixture.ownerIds.main, "REL");
  await app.getByRole("button", { name: "Graph", exact: true }).click();
  const graph = app.locator(".knowledge-graph-wrap");
  await graph.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  assert.equal(await graph.getAttribute("data-graph-node-count"), String(fixture.counts.main));
  const canvas = graph.locator("canvas");
  await canvas.waitFor({ state: "visible", timeout: 15000 });
  return { app, graph, canvas };
}

/**
 * Exercise the actual graph preference menus against a rendered REL.
 * The caller owns Web/Desktop launch and fixture validation. Configure
 * fixture.screenshotDir or RELIQUARY_SMOKE_SCREENSHOTS to save canvas frames.
 */
export async function exerciseGraphPreferences(page, fixture, surface, readNativeTraffic) {
  assert(["web", "desktop"].includes(surface), "Pass surface as 'web' or 'desktop'.");
  assert(fixture?.ownerIds?.main && fixture?.counts?.main, "Graph preferences fixture needs a prepared main REL owner and node count.");

  const worktree = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
  const screenshotValue = fixture.screenshotDir ?? process.env.RELIQUARY_SMOKE_SCREENSHOTS;
  let screenshotDir = null;
  if (screenshotValue) {
    screenshotDir = resolve(screenshotValue);
    const relativePath = relative(worktree, await realpathOrCreateParent(screenshotDir));
    assert(relativePath && !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(".." + sep),
      "Preference screenshots must stay inside this worktree.");
    await mkdir(screenshotDir, { recursive: true });
  }

  const nativeStart = readNativeTraffic ? (await readNativeTraffic()).length : 0;
  async function refreshTraffic() {
    if (!readNativeTraffic) return;
    requests.length = prepares.length = chunks.length = manifests.length = 0;
    for (const entry of (await readNativeTraffic()).slice(nativeStart)) {
      const request = { postDataJSON: () => entry.body };
      requests.push({ operation: entry.operation, request });
      if (entry.operation === "prepare") prepares.push(request);
      if (["node-chunk", "edge-chunk"].includes(entry.operation)) chunks.push({ operation: entry.operation, request });
      if (entry.manifest) manifests.push(entry.manifest);
    }
  }
  const requests = [];
  const prepares = [];
  const chunks = [];
  const manifests = [];
  const onRequest = (request) => {
    const operation = graphApiOperation(request);
    if (!operation) return;
    requests.push({ operation, request });
    if (operation === "prepare") prepares.push(request);
    if (operation === "node-chunk" || operation === "edge-chunk") chunks.push({ operation, request });
  };
  const onResponse = (response) => {
    if (graphApiOperation(response.request()) !== "prepare" || !response.ok()) return;
    void response.json().then((manifest) => manifests.push(manifest)).catch(() => {});
  };
  page.on("request", onRequest);
  page.on("response", onResponse);

  const pageErrors = [];
  const onPageError = (error) => pageErrors.push(error.message);
  page.on("pageerror", onPageError);
  const baselineStorage = await page.evaluate((prefix) =>
    Object.keys(localStorage).filter((key) => key.startsWith(prefix)).sort(), PREFERENCE_PREFIX);

  try {
    const { app, graph, canvas } = await enterMainGraph(page, fixture);
    await refreshTraffic();
    const readyManifest = manifests.at(-1) ?? null;
    const authReads = () => requests.filter(({ operation }) =>
      ["resolve", "inspect", "neighborhood", "locate"].includes(operation)).length;
    const requestCountsAtReady = { prepares: prepares.length, chunks: chunks.length,
      total: requests.length, authReads: authReads() };
    assert(requestCountsAtReady.prepares >= 1, "Graph mount did not issue its authenticated prepare request.");
    assert(readyManifest, "Graph prepare response was not captured for frame-budget checks.");

    const nodeIds = new Set();
    const edgeIds = new Map();
    for (const { operation, request } of chunks) {
      if (!request.postDataJSON) continue;
      const body = request.postDataJSON();
      if (operation === "node-chunk") nodeIds.add(body.chunk_id);
      if (operation === "edge-chunk") edgeIds.set(body.chunk_id, readyManifest.edgeChunks.find((item) => item.chunkId === body.chunk_id)?.lod);
    }
    assert(nodeIds.size <= 32, `Initial graph viewport exceeded the 32 node-chunk frame budget (${nodeIds.size}).`);
    const edgeCounts = { overview: 0, intermediate: 0, detail: 0 };
    for (const lod of edgeIds.values()) if (lod in edgeCounts) edgeCounts[lod] += 1;
    assert(edgeCounts.overview <= 4, "Initial graph viewport exceeded the overview edge-chunk budget.");
    assert(edgeCounts.intermediate <= 16, "Initial graph viewport exceeded the intermediate edge-chunk budget.");
    assert(edgeCounts.detail <= 32, "Initial graph viewport exceeded the detail edge-chunk budget.");

    const initialCanvasHandle = await canvas.elementHandle();
    assert(initialCanvasHandle, "Graph canvas DOM element is missing.");

    // Keep the view stable during display tests, then verify motion separately.
    const animationTrigger = app.getByRole("button", { name: /^Animation/ });
    await animationTrigger.click();
    const animationDialog = app.getByRole("dialog", { name: "Graph animation controls" });
    await animationDialog.waitFor({ state: "visible" });
    const pause = animationDialog.getByRole("button", { name: "Pause animation", exact: true });
    await animationDialog.getByRole("button", { name: "Reset motion", exact: true }).click();
    if (await pause.count()) await pause.click();
    await page.keyboard.press("Escape");
    await animationDialog.waitFor({ state: "hidden" });
    const displayTrigger = app.getByRole("button", { name: /^Display/ });
    await displayTrigger.click();
    let displayDialog = app.getByRole("dialog", { name: "Display settings" });
    await displayDialog.waitFor({ state: "visible" });

    const originalViewport = page.viewportSize() ?? { width: 1440, height: 920 };
    const popoverBounds = {};
    for (const width of [390, 493, 1440]) {
      await page.setViewportSize({ width, height: 760 });
      await page.waitForTimeout(40);
      popoverBounds[width] = await assertPopoverFits(displayDialog, width, 760);
    }
    await page.setViewportSize(originalViewport);
    await page.keyboard.press("Escape");
    await displayDialog.waitFor({ state: "hidden" });
    assert(await displayTrigger.evaluate((button) => document.activeElement === button),
      "Escape did not return focus to the Display trigger.");
    await displayTrigger.click();
    displayDialog = app.getByRole("dialog", { name: "Display settings" });
    await displayDialog.waitFor({ state: "visible" });
    await app.locator(".knowledge-memory-list > header strong").click();
    await displayDialog.waitFor({ state: "hidden" });
    await app.getByRole("button", { name: "Reset view", exact: true }).click();
    await displayTrigger.click();
    displayDialog = app.getByRole("dialog", { name: "Display settings" });
    await displayDialog.waitFor({ state: "visible" });

    const resetDisplay = displayDialog.getByRole("button", { name: "Reset", exact: true });
    if (await resetDisplay.isEnabled()) await resetDisplay.click();
    const screenshotReport = {};
    const displayEvidence = {};
    // Resizing and Reset view legitimately update viewport LOD. The cosmetic
    // interval starts only after those camera/layout actions have settled.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    await refreshTraffic();
    const cosmeticBaseline = { prepares: prepares.length, chunks: chunks.length,
      total: requests.length, authReads: authReads() };
    const baseline = await captureCanvas(canvas, screenshotDir, `${surface}-display-default`);
    for (const [label, limits] of Object.entries(DISPLAY_DEFAULTS)) {
      const slider = displayDialog.getByRole("slider", { name: new RegExp("^" + escapeRegex(label)) });
      assert.equal(await slider.getAttribute("min"), limits.min, `${label} minimum changed.`);
      assert.equal(await slider.getAttribute("max"), limits.max, `${label} maximum changed.`);
      assert.equal(await slider.inputValue(), limits.value, `${label} did not start at its model default.`);

      await setRangeValue(slider, limits.min);
      const minimum = await captureCanvas(canvas, screenshotDir, `${surface}-${label}-min`);
      const minDiff = compareFrames(baseline.frame, minimum.frame);
      assertVisibleEffect(`${label} minimum`, minDiff);

      await setRangeValue(slider, limits.value);
      const restored = await captureCanvas(canvas, screenshotDir, `${surface}-${label}-default`);
      assertVisibleEffect(`${label} restore after minimum`, compareFrames(minimum.frame, restored.frame));

      await setRangeValue(slider, limits.max);
      const maximum = await captureCanvas(canvas, screenshotDir, `${surface}-${label}-max`);
      const maxDiff = compareFrames(restored.frame, maximum.frame);
      if (limits.max !== limits.value) assertVisibleEffect(`${label} maximum`, maxDiff);
      screenshotReport[label] = { minimum: minDiff, maximum: maxDiff };
      await setRangeValue(slider, limits.value);
      displayEvidence[label] = { min: limits.min, default: limits.value, max: limits.max };
    }

    const opacitySlider = displayDialog.getByRole("slider", { name: /^Territory shells/ });
    await setRangeValue(opacitySlider, "0");
    const shellFree = await captureCanvas(canvas, screenshotDir, `${surface}-territory-shell-opacity-zero`);
    const labelColors = territoryColors(readyManifest);
    if (labelColors.length) {
      const retainedLabels = countColorPixels(shellFree.frame, labelColors);
      assert(retainedLabels >= 8, "Zero shell opacity also removed the rendered territory labels.");
      displayEvidence.territoryLabelsAtZeroOpacity = retainedLabels;
    }

    const centerToggle = displayDialog.getByRole("checkbox", { name: /Camera center indicator/ });
    const centerWasChecked = await centerToggle.isChecked();
    const centerOff = await captureCanvas(canvas, screenshotDir, `${surface}-camera-center-off`);
    await centerToggle.setChecked(!centerWasChecked);
    const centerOn = await captureCanvas(canvas, screenshotDir, `${surface}-camera-center-on`);
    assertVisibleEffect("Camera center indicator", compareFrames(centerOff.frame, centerOn.frame));
    await centerToggle.setChecked(false);
    const resetDisplayAfterChanges = displayDialog.getByRole("button", { name: "Reset", exact: true });
    if (await resetDisplayAfterChanges.isEnabled()) await resetDisplayAfterChanges.click();
    await displayDialog.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await displayDialog.waitFor({ state: "hidden" });

    await refreshTraffic();
    const displayRequestsAtEnd = requests.length;
    assert.equal(prepares.length, cosmeticBaseline.prepares, "Display slider changes caused a graph prepare.");
    assert.equal(chunks.length, cosmeticBaseline.chunks, "Display slider changes fetched additional graph chunks.");
    assert.equal(displayRequestsAtEnd, cosmeticBaseline.total,
      "Display preferences caused an extra graph request after the prepared frame.");
    assert.equal(authReads(), cosmeticBaseline.authReads,
      "Display preferences repeated an authenticated Memory or relation read.");
    const displayCanvasHandle = await canvas.elementHandle();
    assert(displayCanvasHandle && await initialCanvasHandle.evaluate((initial, current) => initial === current, displayCanvasHandle),
      "Display preference changes recreated the graph canvas.");

    // Exercise all three signed speed/range/counterspin groups, delay, pause,
    // reroll and reset using the real controls and rendered canvas frames.
    await animationTrigger.click();
    const animation = app.getByRole("dialog", { name: "Graph animation controls" });
    await animation.waitFor({ state: "visible" });
    const animationPopoverBounds = {};
    for (const width of [390, 493, 1440]) {
      await page.setViewportSize({ width, height: 760 });
      await page.waitForTimeout(40);
      animationPopoverBounds[width] = await assertPopoverFits(animation, width, 760);
    }
    await page.setViewportSize(originalViewport);
    const startDelay = animation.getByLabel("Animation start delay");
    assert.equal(await startDelay.getAttribute("min"), "0");
    assert.equal(await startDelay.getAttribute("max"), "300");

    const axes = animation.locator(".graph-preferences-axis");
    assert.equal(await axes.count(), 3, "Animation controls must expose X, Y, and Z axes.");
    const axisReport = {};
    for (const [index, [axis, expected]] of Object.entries(Object.entries(AXIS_DEFAULTS))) {
      const row = axes.nth(Number(index));
      const fields = row.locator('input[type="number"]');
      const counterspin = row.locator('input[type="checkbox"]');
      assert.equal(await fields.count(), 2, `${axis} axis must expose speed and random range.`);
      assert.equal(await fields.nth(0).getAttribute("min"), "-5");
      assert.equal(await fields.nth(0).getAttribute("max"), "5");
      assert.equal(await fields.nth(1).getAttribute("min"), "0");
      assert.equal(await fields.nth(1).getAttribute("max"), "5");
      axisReport[axis] = { speed: await fields.nth(0).inputValue(), randomRange: await fields.nth(1).inputValue(),
        counterspin: await counterspin.isChecked() };
      assert.deepEqual(axisReport[axis], expected, `${axis} motion did not start at its model default.`);
    }

    await startDelay.fill("1");
    for (const row of await axes.all()) {
      const fields = row.locator('input[type="number"]');
      await fields.nth(0).fill("5");
      await fields.nth(1).fill("5");
      const counterspin = row.locator('input[type="checkbox"]');
      await counterspin.setChecked(true);
    }
    for (let index = 0; index < 3; index += 1) {
      const row = axes.nth(index);
      const fields = row.locator('input[type="number"]');
      assert.equal(await fields.nth(0).inputValue(), "5", "Speed range input did not accept its maximum.");
      assert.equal(await fields.nth(1).inputValue(), "5", "Random range input did not accept its maximum.");
      assert(await row.locator('input[type="checkbox"]').isChecked(), "Counterspin toggle did not enable.");
    }
    await axes.nth(0).locator('input[type="checkbox"]').setChecked(false);
    assert(await axes.nth(1).locator('input[type="checkbox"]').isChecked()
      && await axes.nth(2).locator('input[type="checkbox"]').isChecked(),
    "Counterspin toggles are not independent.");
    await axes.nth(0).locator('input[type="checkbox"]').setChecked(true);
    await axes.nth(0).locator('input[type="number"]').nth(0).fill("-5");
    assert.equal(await axes.nth(0).locator('input[type="number"]').nth(0).inputValue(), "-5",
      "Signed negative speed was not accepted.");
    for (const row of await axes.all()) await row.locator('input[type="number"]').nth(0).fill("0");

    await startDelay.fill("300");
    assert.equal(await startDelay.inputValue(), "300", "Delay maximum was not accepted.");
    const testedDelay = surface === "desktop" ? 3 : 1;
    await startDelay.fill(String(testedDelay));
    await animation.getByRole("button", { name: "Reroll", exact: true }).click();
    await animation.getByRole("button", { name: "Start animation", exact: true }).click();
    await page.keyboard.press("Escape");
    await animation.waitFor({ state: "hidden" });
    await canvas.focus();
    await page.keyboard.press("a");
    const delayStart = await captureCanvas(canvas, screenshotDir, `${surface}-animation-delay-start`);
    await page.waitForTimeout(350);
    const delayedFrame = await captureCanvas(canvas, screenshotDir, `${surface}-animation-delay-wait`);
    assert(compareFrames(delayStart.frame, delayedFrame.frame).changedPixels < 8,
      `Automatic rotation began before the configured interaction delay (frame interval ${delayedFrame.capturedAtMs-delayStart.capturedAtMs}ms, delay ${testedDelay}s).`);
    await page.waitForTimeout(testedDelay * 1000 - 150);
    const movingFrame = await captureCanvas(canvas, screenshotDir, `${surface}-animation-moving`);
    const motionDiff = compareFrames(delayedFrame.frame, movingFrame.frame);
    assertVisibleEffect("Signed 3-axis camera rotation", motionDiff);

    // A focused canvas key event is a real graph interaction. With a 1-second
    // delay, the camera should remain still for the next short interval.
    await canvas.focus();
    await page.keyboard.press("Escape");
    const interruptedFrame = await captureCanvas(canvas, screenshotDir, `${surface}-animation-interrupted`);
    await page.waitForTimeout(300);
    const interruptedWaitFrame = await captureCanvas(canvas, screenshotDir, `${surface}-animation-interruption-wait`);
    assert(compareFrames(interruptedFrame.frame, interruptedWaitFrame.frame).changedPixels < 8,
      "Keyboard interaction did not interrupt automatic camera motion.");

    await animationTrigger.click();
    await animation.waitFor({ state: "visible" });
    await animation.getByRole("button", { name: "Pause animation", exact: true }).click();
    const pausedFrame = await captureCanvas(canvas, screenshotDir, `${surface}-animation-paused`);
    await page.waitForTimeout(400);
    const pausedWait = await captureCanvas(canvas, screenshotDir, `${surface}-animation-paused-wait`);
    assert(compareFrames(pausedFrame.frame, pausedWait.frame).changedPixels < 8,
      "Paused camera continued to move.");

    const saveView = animation.getByRole("button", { name: "Set Current View as Default", exact: true });
    const restoreView = animation.getByRole("button", { name: "Restore Factory View", exact: true });
    assert(await saveView.isEnabled(), "Set Current View must be enabled when the camera bridge is ready.");
    await saveView.click();
    await page.waitForFunction(() => {
      const button = document.querySelectorAll(".graph-preferences-animation .graph-preferences-view-button")[1];
      return button && !button.disabled;
    }, null, { timeout: 10000 });
    assert(await restoreView.isEnabled(), "Restore Factory View must enable after saving a custom view.");
    const savedViewStorage = await page.evaluate((prefix) =>
      Object.keys(localStorage).filter((key) => key.startsWith(prefix) && key.endsWith(":camera-view")),
    PREFERENCE_PREFIX);
    if (surface === "desktop") {
      assert(savedViewStorage.some((key) => key.includes(encodeURIComponent(fixture.ownerIds.main))),
        "Saved camera view did not use the authorized owner key.");
    }
    await restoreView.click();
    await page.waitForFunction(() => document.querySelectorAll(".graph-preferences-animation .graph-preferences-view-button")[1]?.disabled === true,
      null, { timeout: 10000 });
    assert(await restoreView.isDisabled(), "Restore Factory View must disable after restoring factory framing.");
    await page.keyboard.press("Escape");
    await animation.waitFor({ state: "hidden" });
    await app.getByRole("button", { name: "Reset view", exact: true }).click();
    await animationTrigger.click();
    await animation.waitFor({ state: "visible" });

    await animation.getByRole("button", { name: "Reset motion", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#graph-animation-preferences input[type="number"]')?.value === "60",
    null, { timeout: 10000 });
    assert.equal(await startDelay.inputValue(), "60", "Reset motion did not restore the 60-second delay.");
    const resetValues = {};
    for (const [index, [axis, expected]] of Object.entries(Object.entries(AXIS_DEFAULTS))) {
      const row = axes.nth(Number(index));
      const fields = row.locator('input[type="number"]');
      const counterspin = row.locator('input[type="checkbox"]');
      resetValues[axis] = { speed: await fields.nth(0).inputValue(), randomRange: await fields.nth(1).inputValue(),
        counterspin: await counterspin.isChecked() };
      assert.deepEqual(resetValues[axis], expected, `Reset motion did not restore the ${axis} axis.`);
    }
    assert(await animation.getByRole("button", { name: "Pause animation", exact: true }).isVisible(),
      "Reset motion did not restore the enabled state.");
    await page.keyboard.press("Escape");
    await animation.waitFor({ state: "hidden" });

    const afterStorage = await page.evaluate((prefix) =>
      Object.keys(localStorage).filter((key) => key.startsWith(prefix)).sort(), PREFERENCE_PREFIX);
    const oldKeys = await page.evaluate(() => [
      "cbm-display", "warlock-graph-animation-v1",
      ...Object.keys(localStorage).filter((key) => key.startsWith("warlock-graph-default-view:")),
    ].filter((key) => localStorage.getItem(key) !== null));
    assert.deepEqual(oldKeys, [], "Graph preferences read or wrote a Warlock-era storage key.");
    if (surface === "web") {
      assert.deepEqual(afterStorage, baselineStorage, "Web preferences escaped their mount-local store into localStorage.");
    } else {
      assert(afterStorage.some((key) => key.endsWith(":display")), "Desktop did not persist display settings in its profile scope.");
      assert(afterStorage.some((key) => key.endsWith(":animation")), "Desktop did not persist animation settings in its profile scope.");
      assert(!afterStorage.some((key) => key.endsWith(":camera-view")
        && key.includes(encodeURIComponent(fixture.ownerIds.main))),
      "Restore Factory View did not delete this owner's custom camera view.");
      assert(afterStorage.every((key) => key.startsWith(PREFERENCE_PREFIX + "profile:")),
        "Desktop preferences escaped the active profile namespace.");
    }

    await refreshTraffic();
    assert.equal(prepares.length, cosmeticBaseline.prepares, "Animation controls caused a graph prepare.");
    assert.equal(authReads(), cosmeticBaseline.authReads,
      "Animation preferences repeated an authenticated Memory or relationship read.");
    assert.equal(await graph.getAttribute("data-graph-node-count"), String(fixture.counts.main),
      "Preference controls changed the mounted REL graph size.");
    assert.deepEqual(pageErrors, [], "Preference UI raised a browser error.");

    const finalCanvasHandle = await canvas.elementHandle();
    assert(finalCanvasHandle && await initialCanvasHandle.evaluate((initial, current) => initial === current, finalCanvasHandle),
      "Animation preferences recreated the graph canvas.");

    return {
      surface,
      nodeCount: Number(fixture.counts.main),
      initialFrameChunks: { nodes: nodeIds.size, edges: edgeIds.size, byLod: edgeCounts },
      display: displayEvidence,
      popoverBounds,
      animationPopoverBounds,
      canvasPixels: screenshotReport,
      animation: { initial: axisReport, reset: resetValues, motion: motionDiff },
      storage: { baseline: baselineStorage.length, after: afterStorage.length },
      screenshots: screenshotDir,
    };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("pageerror", onPageError);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function realpathOrCreateParent(path) {
  try { return await realpath(path); }
  catch {
    const parent = resolve(path, "..");
    await mkdir(parent, { recursive: true });
    return await realpath(parent).then((resolved) => join(resolved, path.split(/[\\/]/).at(-1)));
  }
}

export { captureCanvas, compareFrames, setRangeValue, assertPopoverFits };
