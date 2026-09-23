// tests/mobile-bar.test.js — v18.2.0: on a phone, Walk-in and "+ New" live in
// a fixed bottom bar instead of wrapping onto a second header row.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const App = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "App.jsx"), "utf8")).join("\n");
const header = App.slice(App.indexOf("<header"), App.indexOf("</header>"));

describe("the phone's bottom bar", () => {
  it("replaces the header's create buttons on a phone, and only there", () => {
    expect(header).toMatch(/\{isMobile\?null:<><button\s+onClick=\{openWalkin\}/);
    expect(header).toMatch(/\{isMobile\?<div\s+role="group" aria-label="Add a booking"\s+style=\{MOBILE_BAR\}>/);
  });

  it("sits INSIDE <header>, so the header's inert reaches it while a modal is open", () => {
    expect(header.indexOf('aria-label="Add a booking"')).toBeGreaterThan(-1);
    expect(App.slice(App.indexOf("<header"), App.indexOf("<header") + 400)).toMatch(/inert=\{anyModal\}/);
  });

  it("is under every modal and opaque enough that the grid does not show through", () => {
    const bar = App.slice(App.indexOf("const MOBILE_BAR={"), App.indexOf("};", App.indexOf("const MOBILE_BAR={")));
    const z = Number((bar.match(/zIndex:(\d+)/) || [])[1]);
    expect(z).toBeGreaterThan(60);   // the toast layer
    expect(z).toBeLessThan(200);     // Overlay
    expect(bar).toMatch(/background:"var\(--bg-sheet-mobile\)"/);
    expect(bar, "the <=4 simultaneous blur budget").not.toMatch(/backdropFilter/);
  });

  it("<main> ends with a spacer of the bar's height, so nothing is left under it", () => {
    expect(App).toMatch(/\{isMobile\?<div aria-hidden="true" style=\{MOBILE_BAR_SPACER\} \/>:null\}<\/div><\/main>/);
  });
});
