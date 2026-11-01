// tests/arm-guard.test.js — v18.14.0 (correction 19, Patryk)
//
// A two-tap delete takes two taps somebody meant. On DEV two taps 120ms apart
// erased a customer, because arming changes a button's label and leaves it where
// it stands, which is what the second tap needs and what a double tap walks
// through. The clock is run here; each site is read, because the suite mounts no
// component (tests/CLAUDE.md), and a site's two lines are what a new one forgets.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { stripComments } from "../scripts/strip-comments.mjs";
import { ARM_GUARD_MS, CONFIRM_MODALS, armSettled, markArmed } from "../src/lib/arm-guard.js";
import { MODAL_Z } from "../src/hooks/useModalStack.js";
import { appCode } from "./app-source.js";

describe("the wait after arming", () => {
  it("is half a second", () => {
    expect(ARM_GUARD_MS).toBe(500);
  });
  it("holds a second tap back for the whole of it, and not a moment longer", () => {
    markArmed(10_000);
    expect(armSettled(10_000)).toBe(false);
    expect(armSettled(10_120)).toBe(false); // the double tap measured on DEV
    expect(armSettled(10_499)).toBe(false);
    expect(armSettled(10_500)).toBe(true);
    expect(armSettled(14_000)).toBe(true);
  });
  it("starts again when another button arms, the safe direction", () => {
    markArmed(20_000);
    markArmed(20_400);
    expect(armSettled(20_600)).toBe(false);
    expect(armSettled(20_900)).toBe(true);
  });
});

// Every file under src/components, comments gone: a comment names "Confirm — …"
// in files that draw no such button, and the stripper is what stops one counting.
function componentFiles(dir = "src/components") {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? componentFiles(path) : path.endsWith(".jsx") ? [path] : [];
  });
}
const sources = componentFiles().map((path) => [path, stripComments(readFileSync(path, "utf8")).join("\n")]);

const count = (source, re) => (source.match(re) || []).length;
const ASKS = /if\s*\(\s*!armSettled\(\)\s*\)\s*return/g;
const MARKS = /markArmed\(\)/g;

// How many two-tap buttons each file draws.
const SITES = {
  "src/components/ActivityLogModal.jsx": 1,
  "src/components/AdminSettings.jsx": 1,
  "src/components/CustomersSettings.jsx": 1,
  "src/components/ParkedDiscard.jsx": 1,
  "src/components/Settings.jsx": 2,
  "src/components/SpecialDayModal.jsx": 1,
  "src/components/TagListEditor.jsx": 1,
  "src/components/WaitlistPanel.jsx": 1,
  "src/components/whatsapp/TemplatesEditor.jsx": 1,
};

describe("every two-tap button", () => {
  it("is on the list: a file that draws one and is not here fails", () => {
    const drawn = sources.filter(([, source]) => source.includes("Confirm — ")).map(([path]) => path);
    expect(drawn.sort()).toEqual(Object.keys(SITES).sort());
  });
  it("marks the arm and asks before it acts, once per button", () => {
    sources.filter(([path]) => SITES[path]).forEach(([path, source]) => {
      expect(count(source, ASKS), path).toBe(SITES[path]);
      expect(count(source, MARKS), path).toBe(SITES[path]);
    });
  });
  it("asks and marks nowhere else", () => {
    sources.filter(([path]) => !SITES[path] && !path.endsWith("InboxPanel.jsx")).forEach(([path, source]) => {
      expect(source, path).not.toContain("armSettled(");
      expect(source, path).not.toContain("markArmed(");
    });
  });
  it("asks on the armed path, ahead of what it does", () => {
    const customers = sources.find(([path]) => path.endsWith("CustomersSettings.jsx"))[1];
    expect(customers.indexOf("armSettled()")).toBeLessThan(customers.indexOf("onDeleteCustomer("));
    const tiers = sources.find(([path]) => path.endsWith("/Settings.jsx"))[1];
    const arm = tiers.slice(tiers.indexOf("const armTierRemove"));
    expect(arm.indexOf("armSettled()")).toBeLessThan(arm.indexOf("removeTier(i)"));
    expect(arm.indexOf("removeTier(i)")).toBeLessThan(arm.indexOf("markArmed()"));
  });
});

// Correction 22: Discard is the one button on the strip that loses something for good.
describe("the parked write", () => {
  it("draws the two-tap Discard before Retry, so the way forward takes the right", () => {
    const banners = sources.find(([path]) => path.endsWith("AppBanners.jsx"))[1];
    expect(banners.indexOf("<ParkedDiscard")).toBeGreaterThan(-1);
    expect(banners.indexOf("<ParkedDiscard")).toBeLessThan(banners.indexOf(">Retry<"));
  });
});

// Correction 20: a confirm opens where the finger may still be. On a phone the booking
// form's Back sits exactly under the confirm's Discard, and a second tap lost the draft.
describe("a confirm's action", () => {
  it("names real modals", () => {
    CONFIRM_MODALS.forEach((id) => expect(MODAL_Z, id).toContain(id));
  });
  it("starts the clock when a confirm reaches the top", () => {
    expect(appCode()).toMatch(/useEffect\(function\(\)\{if\(CONFIRM_MODALS\.includes\(topModalId\)\)markArmed\(\);\},\[topModalId\]\)/);
  });
  it("waits on every button that acts, in App and in the inbox's bulk delete", () => {
    const app = appCode();
    [
      "if(armSettled())doDiscard();",
      "if(armSettled())delBooking(confirmDel);",
      "if(!armSettled())return;doCancelBooking(confirmCancel,true);",
      "if(!armSettled())return;doCancelBooking(confirmCancel,false);",
      "if(!armSettled())return;setConfirmReshuffle(false);forceReshuffle();",
      "if(armSettled())doDeleteReminder(confirmReminderDel);",
      "if(!armSettled())return;wa.doArchive(confirmArchive);",
      "if(armSettled())wa.doDeleteConversation(confirmDeleteConv);",
    ].forEach((call) => expect(app, call).toContain(call));
    const inbox = sources.find(([path]) => path.endsWith("InboxPanel.jsx"))[1];
    expect(inbox).toMatch(/markArmed\(\); setConfirmBulkDelete\(true\)/);
    expect(inbox).toMatch(/if \(!armSettled\(\)\) return; setConfirmBulkDelete\(false\); runBulk\("delete"\);/);
  });
});
