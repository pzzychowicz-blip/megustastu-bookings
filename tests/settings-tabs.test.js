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
  // v18.0.0 phase 4: BOTH gates, at both consumers. The assertions match the
  // call with its arguments rather than a fixed string, because pinning
  // `visibleTabs(K.can)` exactly is what failed the moment the second gate was
  // added — which is the guard working, but it should fail on a consumer that
  // DROPS a gate, not on one that gains one. What must not drift is that each
  // consumer passes the same set.
  // Anchored on the ASSIGNMENT and not on `visibleTabs(`, because the comment
  // directly above that call quotes `visibleTabs(can)` in prose — so a bare
  // search finds the sentence about the call before the call. That is this
  // repo's own recorded trap (`tests/csp.test.js`' boot block, `src/index.css`'
  // header): prose that names the thing a matcher hunts for is indistinguishable
  // from the thing, and it looks perfect in review.
  const callArgs = (src, call) => {
    const i = src.indexOf(call);
    if (i < 0) return null;
    return src.slice(i + call.length, src.indexOf(")", i));
  };

  it("the ←/→ cycle derives from visibleTabs, with every gate", () => {
    const src = read("src/hooks/useKeyboardShortcuts.js");
    const args = callArgs(src, "const TABS=visibleTabs(");
    expect(args).not.toBe(null);
    expect(args).toContain("K.can");
    // The module gate. Without it the cycle steps onto the Vouchers tab of a
    // restaurant that has switched vouchers off — the capability bug of
    // v18.0.0 phase 3, one gate over.
    expect(args).toContain("K.hasModule");
    expect(src).not.toContain("SETTINGS_TABS.map");
    expect(src).not.toContain("SETTINGS_TABS.filter");
  });

  it("the TabBar renders the filtered list, with every gate", () => {
    const src = read("src/components/Settings.jsx");
    const args = callArgs(src, "const tabs = visibleTabs(");
    expect(args).not.toBe(null);
    expect(args).toContain("can");
    expect(args).toContain("hasModule");
    expect(src).toContain("tabs={tabs}");
    expect(src).not.toContain("tabs={SETTINGS_TABS}");
  });

  it("hides a module-gated tab, and only that one", () => {
    const MODULED = SETTINGS_TABS.filter((t) => t.module);
    expect(MODULED.length).toBeGreaterThanOrEqual(1);
    const ids = visibleTabs(() => true, () => false).map((t) => t.id);
    MODULED.forEach((t) => expect(ids).not.toContain(t.id));
    // …and hides ONLY those: an emptied tab bar would satisfy the line above.
    SETTINGS_TABS.filter((t) => !t.module).forEach((t) => expect(ids).toContain(t.id));
  });

  it("checks the module BEFORE the capability", () => {
    // The order is load-bearing: a module that is off hides the tab from
    // everybody INCLUDING an admin. The other order would let a capability
    // grant re-open a feature the restaurant switched off. Proven with a tab
    // carrying both gates would need a fixture; what is checkable here is that
    // an all-capable caller still loses a module-gated tab.
    const ids = visibleTabs(() => true, (m) => m !== "vouchers").map((t) => t.id);
    expect(ids).not.toContain("vouchers");
    expect(ids).toContain("admin");
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
    // And the list it indexes can never be empty. FOUR tabs carry no
    // capability — the assertion said "at least two" while the comment beside
    // it said four, which is a guard describing coverage it does not have.
    expect(SETTINGS_TABS.filter((t) => !t.caps).length).toBe(4);
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
    // THREE wrappers, not eight: the six contiguous settingsWrite sections
    // share one gate. A count is what catches a wrapper that stopped being
    // applied — a missing string would not, because the others still match.
    expect((src.match(/\{sw \? \(/g) || []).length).toBe(3);
  });

  it("gates the three sections that are NOT settingsWrite", () => {
    // Opening hours and Shifts both write settings/operatingHours-family nodes.
    // One gate over both adjacent hours sections (Opening hours, Shifts).
    expect((src.match(/\{can\("hoursEdit"\) \? \(/g) || []).length).toBe(1);
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
