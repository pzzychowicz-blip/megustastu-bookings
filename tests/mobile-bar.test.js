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
    // v18.3.1: data-fixed-bottom is how the timeline drag's edge scroll finds
    // the bar (lib/edge-scroll.js's scrollBounds), so it is pinned here too.
    expect(header).toMatch(/\{isMobile\?<div\s+role="group" aria-label="Add a booking"\s+data-fixed-bottom=""\s+style=\{MOBILE_BAR\}>/);
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

// v18.2.0 phase 79 (round 2's loose end): with WhatsApp on, the phone's
// controls row was 21px too full at 375px and the connection dot wrapped onto a
// third row by itself (header 126px). On a phone it now ends the TITLE row,
// opposite the cog (Patryk's pick); measured after, 327–363px on row one and a
// header of 84px, with the tablet's one 40px row unchanged.
describe("the connection dot on a phone", () => {
  it("is built once and placed by width: the title row on a phone, the controls on a tablet", () => {
    expect((App.match(/<ConnectionStatus /g) || []).length, "one element, two places").toBe(1);
    expect(App).toMatch(/const connStatus=<ConnectionStatus /);
    expect(App).toMatch(/\{isMobile\?<div style=\{\{marginLeft:"auto",flexShrink:0\}\}>\{connStatus\}<\/div>:null\}<\/div>/);
    expect(App).toMatch(/\{isMobile\?null:connStatus\}<\/div>/);
    // The title block takes the whole first row on a phone, so the dot ends it.
    // v18.4.0: it carries the ref the header's own-line measurement reads.
    expect(App).toMatch(/<div ref=\{headTitleRef\} style=\{\{display:"flex",alignItems:"center",gap:10,minWidth:0,flex:isMobile\?"1 1 100%":undefined\}\}><button/);
  });
});

// v18.4.0 (Patryk): on a line of their own the controls split, the view
// switcher left and the actions with the dot right.
describe("the header's controls on their own line", () => {
  it("is measured, and never by changing the block's flex basis", () => {
    expect(App).toMatch(/const headCtrlOwnLine=useSharesLine\(headerRef,headTitleRef,headCtrlRef\)\.same===false;/);
    const block = App.match(/<div ref=\{headCtrlRef\} style=\{\{([^}]*)\}\}><ViewSwitcher/);
    expect(block, "the controls block").not.toBeNull();
    // A basis of 100% would keep the block on its own line for good.
    expect(block[1]).not.toMatch(/flexBasis|flex:/);
    expect(block[1]).toMatch(/justifyContent:"flex-end",flexGrow:1/);
  });
  it("moves the actions as ONE group, right only on a line of their own", () => {
    expect((App.match(/marginLeft:headCtrlOwnLine\?"auto":undefined/g) || []).length).toBe(1);
    // The dot is the group's last child on a tablet.
    expect(App).toMatch(/\{isMobile\?null:connStatus\}<\/div><\/div>\{isMobile\?<div/);
  });
});
