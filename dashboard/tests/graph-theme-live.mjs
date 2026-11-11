import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertPopoverFits } from "./graph-preferences-live.mjs";

/** Compare painted plugin colors to the active host palette, then hit-test menus. */
export async function exerciseThemedMenus(page, fixture, surface) {
  const app = page.getByRole("region", { name: "Reliquary", exact: true });
  await app.locator('[data-graph-ready="true"]').waitFor({ timeout: 40000 });
  const palette = await app.evaluate((element, surface) => {
    const node = element.querySelector(".knowledge-surface") ?? element;
    const sample = document.createElement("span"); node.append(sample);
    const color = value => {
      sample.style.color = value;
      return getComputedStyle(sample).color;
    };
    const names = ["background", "foreground", "card", "primary", "primary-foreground", "secondary", "secondary-foreground", "accent", "accent-foreground", "border", "input", "ring", "popover", "popover-foreground", "muted-foreground"];
    const aliases = {};
    for (const name of names) {
      const web = name === "background" ? "--background-base" : name === "foreground" ? "--midground" : "--color-" + name;
      aliases[name] = { actual: color(`var(--reliquary-${name})`), host: color(surface === "desktop" ? `var(--dt-${name})` : `var(${web})`) };
    }
    const styles = getComputedStyle(node);
    const result = { aliases, background: styles.backgroundColor, text: styles.color, scheme: styles.colorScheme };
    sample.remove(); return result;
  }, surface);
  for (const [name, value] of Object.entries(palette.aliases)) assert.equal(value.actual, value.host, name + " ignored the active Hermes theme.");
  assert.equal(palette.background, palette.aliases.background.actual);
  assert.equal(palette.text, palette.aliases.foreground.actual);
  const viewport = page.viewportSize();
  const bounds = {};
  const directory = fixture.screenshotDir ?? process.env.RELIQUARY_SMOKE_SCREENSHOTS;
  if (directory) await mkdir(directory, { recursive: true });
  for (const width of [390, 493, 1440]) {
    await page.setViewportSize({ width, height: 760 });
    bounds[width] = {};
    for (const menu of ["Display", "Animation"]) {
      const trigger = app.getByRole("button", { name: new RegExp("^" + menu) });
      await trigger.click();
      const dialog = app.getByRole("dialog", { name: menu === "Display" ? "Display settings" : "Graph animation controls" });
      await dialog.waitFor();
      const box = await assertPopoverFits(dialog, width, 760);
      const painted = await dialog.evaluate(panel => {
        const r = panel.getBoundingClientRect(), style = getComputedStyle(panel);
        const points = [[r.left+4,r.top+4],[r.right-4,r.top+4],[r.left+4,r.bottom-4],[r.right-4,r.bottom-4]];
        return { background: style.backgroundColor, text: style.color, border: style.borderTopColor,
          hits: points.map(([x,y]) => panel.contains(document.elementFromPoint(x,y))) };
      });
      assert(painted.hits.every(Boolean), menu + " has a covered or clipped corner.");
      assert.equal(painted.background, palette.aliases.popover.actual);
      assert.equal(painted.text, palette.aliases["popover-foreground"].actual);
      assert.equal(painted.border, palette.aliases.border.actual);
      bounds[width][menu] = { ...box, ...painted };
      if (directory) await page.screenshot({ path: join(directory, `${surface}-${palette.scheme}-${menu.toLowerCase()}-${width}.png`) });
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
      assert(await trigger.evaluate(button => document.activeElement === button), menu + " did not restore keyboard focus.");
    }
  }
  await page.setViewportSize(viewport);
  return { palette, bounds };
}
