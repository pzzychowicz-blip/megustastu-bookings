// tests/settings-tabs.test.js — v18.0.0 phase 3
//
// `SETTINGS_TABS` being a single list has been guarded by convention and a
// comment since v16.0.0, and that was enough while every tab was
// unconditional. The Admin tab is not: it is filtered by `can("settingsAdmin")`,
// and the ←/→ keyboard cycle derives from the SAME list the tab bar renders.
//
// So filtering at the render site alone leaves arrows landing on a tab that
// renders nothing — the fifth version of the hand-copied-tab-list bug, arriving
// through the one door the original fix left open. `visibleTabs` is the single
// filter, and this asserts BOTH consumers go through it rather than reading the
// raw list.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SETTINGS_TABS, visibleTabs } from "../src/components/SettingsChrome.jsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("visibleTabs — the one filter", () => {
  const ALL = SETTINGS_TABS.map((t) => t.id);

  it("returns every tab for an admin", () => {
    expect(visibleTabs(() => true).map((t) => t.id)).toEqual(ALL);
  });

  it("hides a capability-gated tab from someone without it", () => {
    const ids = visibleTabs(() => false).map((t) => t.id);
    expect(ids).not.toContain("admin");
    // …and hides ONLY the gated ones — a filter that emptied the tab bar would
    // pass a "does not contain admin" assertion just as well.
    expect(ids).toEqual(ALL.filter((id) => id !== "admin"));
  });

  it("asks `can` with the tab's own declared capability", () => {
    const asked = [];
    visibleTabs((cap) => { asked.push(cap); return true; });
    expect(asked).toEqual(["settingsAdmin"]);
  });

  it("degrades to the ungated tabs when there is no `can` at all", () => {
    // A caller with no roles context must not get an empty tab bar, and must
    // not get the Admin tab either — the conservative direction in both.
    [undefined, null, "nope"].forEach((bad) => {
      const ids = visibleTabs(bad).map((t) => t.id);
      expect(ids).toEqual(ALL.filter((id) => id !== "admin"));
    });
  });

  it("every gated tab names a capability that exists", async () => {
    const { CAP_IDS } = await import("../src/lib/roles.js");
    SETTINGS_TABS.filter((t) => t.cap).forEach((t) => {
      expect(CAP_IDS).toContain(t.cap);
    });
  });
});

describe("both consumers read the FILTERED list", () => {
  // The whole point. Each of these is a place that would silently disagree with
  // the other if it read SETTINGS_TABS directly.
  it("the ←/→ cycle derives from visibleTabs, not from SETTINGS_TABS", () => {
    const src = read("src/hooks/useKeyboardShortcuts.js");
    expect(src).toContain("visibleTabs(K.can)");
    // A raw read would be the bug — the cycle stepping onto a tab the render
    // side refuses to show.
    expect(src).not.toContain("SETTINGS_TABS.map");
    expect(src).not.toContain("SETTINGS_TABS.filter");
  });

  it("the TabBar renders the filtered list", () => {
    const src = read("src/components/Settings.jsx");
    expect(src).toContain("const tabs = visibleTabs(can)");
    expect(src).toContain("tabs={tabs}");
    expect(src).not.toContain("tabs={SETTINGS_TABS}");
  });

  it("a tab that disappears resets rather than stranding the reader", () => {
    // Two halves, and the test names both because either alone is a bug: `cur`
    // is DERIVED so no frame renders empty, and the effect corrects the STATE so
    // the keyboard cycle is not left pointing at a tab that is gone.
    const src = read("src/components/Settings.jsx");
    expect(src).toContain('tabs.some(function (t) { return t.id === tab; }) ? tab : "general"');
    expect(src).toContain("if (cur !== tab) setTab(cur)");
  });

  it("every tab body branches on the DERIVED id, never the raw state", () => {
    // The `else` fallthrough is what makes this load-bearing: an id no branch
    // matches renders the LAST branch's body, which is Shortcuts. A single
    // `tab === "..."` left behind would render the Shortcuts sheet whenever the
    // active tab vanished.
    const src = read("src/components/Settings.jsx");
    const branches = src.match(/(?:if|else if) \((?:tab|cur) === "/g) || [];
    expect(branches.length).toBeGreaterThanOrEqual(7);
    expect(branches.every((b) => b.includes("cur ==="))).toBe(true);
  });
});
