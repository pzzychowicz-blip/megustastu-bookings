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
  // Derived, never typed out: v18.0.0 gated `admin` on settingsAdmin and then
  // three more on settingsWrite, and a hard-coded "only admin" broke every
  // assertion below. The filter is about `cap` being present, not about which
  // capability it happens to name.
  const UNGATED = SETTINGS_TABS.filter((t) => !t.caps).map((t) => t.id);
  const GATED = SETTINGS_TABS.filter((t) => t.caps);

  it("returns every tab for an admin", () => {
    expect(visibleTabs(() => true).map((t) => t.id)).toEqual(ALL);
  });

  it("hides every capability-gated tab from someone with no capabilities", () => {
    const ids = visibleTabs(() => false).map((t) => t.id);
    expect(GATED.length).toBeGreaterThanOrEqual(4);   // general, layout, reminders, admin
    GATED.forEach((t) => expect(ids).not.toContain(t.id));
    // …and hides ONLY those — a filter that emptied the tab bar would pass a
    // "does not contain admin" assertion just as well.
    expect(ids).toEqual(UNGATED);
  });

  it("keeps a tab whose OTHER capabilities the person still holds", () => {
    // The whole reason `caps` is a list. General holds controls belonging to
    // four capabilities; losing `settingsWrite` alone must not take away the
    // opening hours, and the tab stays because `hoursEdit` is still held.
    const ids = visibleTabs((cap) => cap !== "settingsWrite").map((t) => t.id);
    expect(ids).toContain("general");
    // …and it goes when the LAST of its four is gone.
    const none = visibleTabs((cap) => !["settingsWrite", "hoursEdit", "recurringManage", "dataExport"].includes(cap));
    expect(none.map((t) => t.id)).not.toContain("general");
  });

  it("hides exactly the config tabs from a staff account", () => {
    // The realistic case. It keeps Customers, Vouchers, App and Shortcuts —
    // reading those is not a capability — and loses every tab whose whole
    // contents it may not write.
    const staffCaps = ["bookingCreate", "bookingEdit", "bookingStatus",
      "bookingAssign", "tableBlock", "waitlistManage", "voucherRedeem"];
    const ids = visibleTabs((cap) => staffCaps.includes(cap)).map((t) => t.id);
    expect(ids).toEqual(["customers", "vouchers", "app", "shortcuts"]);
  });

  it("asks `can` with each tab's own declared capabilities", () => {
    const asked = [];
    // `some` short-circuits on the first true, so ask with a `can` that always
    // says no — which is also the only way to see the whole list.
    visibleTabs((cap) => { asked.push(cap); return false; });
    expect(asked).toEqual(GATED.flatMap((t) => t.caps));
    expect(new Set(asked)).toEqual(new Set([
      "settingsWrite", "hoursEdit", "recurringManage", "dataExport",
      "layoutEdit", "reminderManage", "settingsAdmin",
    ]));
  });

  it("degrades to the ungated tabs when there is no `can` at all", () => {
    // A caller with no roles context must not get an empty tab bar, and must
    // not get the Admin tab either — the conservative direction in both.
    [undefined, null, "nope"].forEach((bad) => {
      expect(visibleTabs(bad).map((t) => t.id)).toEqual(UNGATED);
    });
  });

  it("every gated tab names a capability that exists", async () => {
    const { CAP_IDS } = await import("../src/lib/roles.js");
    SETTINGS_TABS.filter((t) => t.caps).forEach((t) => {
      t.caps.forEach((c) => expect(CAP_IDS).toContain(c));
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
    expect(src).toContain("tabs.some(function (t) { return t.id === tab; }) ? tab : fallback");
    expect(src).toContain("if (cur !== tab) setTab(cur)");
  });

  it("the fallback is the first VISIBLE tab, never a hard-coded id", () => {
    // v18.0.0 gated `general` on settingsWrite in the same commit that added
    // this reset, so a literal "general" fallback would have reset a staff
    // account onto a tab absent from its own tab bar — the fix for one bug
    // reintroducing it one line down.
    const src = read("src/components/Settings.jsx");
    expect(src).toContain("const fallback = tabs.length ? tabs[0].id");
    expect(src).not.toMatch(/\? tab : "general"/);
    // And the list it indexes can never be empty: four tabs carry no capability.
    expect(SETTINGS_TABS.filter((t) => !t.caps).length).toBeGreaterThanOrEqual(2);
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

describe("the General tab gates its own sections (v18.0.0 phase 3)", () => {
  // `visibleTabs` opens the door for ANY of General's four capabilities, so
  // without a second gate inside, holding `hoursEdit` alone would show every
  // control on the tab. There are no DOM tests in this repo by design, so this
  // pins the structure the way the rest of the suite does — by reading the
  // source — and the live render is checked by hand against a real account.
  const src = read("src/components/Settings.jsx");

  it("takes `can` and derives the settingsWrite majority once", () => {
    expect(src).toContain("export function GeneralTabContent({ can =");
    expect(src).toContain('const sw = can("settingsWrite")');
    // Eight sections belong to settingsWrite; a wrapper that stopped being
    // applied would show up here as a count, not as a missing string.
    expect((src.match(/\{sw \? \(/g) || []).length).toBeGreaterThanOrEqual(8);
  });

  it("gates the three sections that are NOT settingsWrite", () => {
    // Opening hours and Shifts both write settings/operatingHours-family nodes.
    expect((src.match(/\{can\("hoursEdit"\) \? \(/g) || []).length).toBe(2);
    expect(src).toContain('{recurring && can("recurringManage") ? (');
    expect(src).toContain('{onBackup && can("dataExport") ? (');
  });

  it("is actually handed `can` at its call site", () => {
    // The prop defaults to permissive, so forgetting to pass it fails OPEN —
    // which is the right direction for a caller with no roles context and the
    // wrong one here. Nothing but this test can see the difference.
    expect(src).toContain("<GeneralTabContent can={can}");
  });
});
