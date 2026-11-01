// tests/modal-keys.test.js — v18.13.0 (#31)
//
// What Escape and Enter do to the topmost modal, run rather than read. Until this
// version `escapeAction` and `enterAction` were private to the hook, so
// tests/modal-stack.test.js could only look for a `case` in its source, which says a
// row exists and not what it does. The rows that matter most are the guarded closes:
// a surface holding a draft that names a raw setter here has an Esc key that walks
// past the unsaved-changes guard.

import { describe, it, expect } from "vitest";
import { escapeAction, enterAction, MODAL_ENTER_ORDER } from "../src/lib/modal-keys.js";
import { MODAL_Z } from "../src/hooks/useModalStack.js";
import { appCode } from "./app-source.js";

// v18.14.0 (correction 18, Patryk): the one confirm nobody asked for, so the way back
// takes the right and the blue, and the words stop proposing the loss.
describe("the unsaved-changes confirm", () => {
  const app = appCode();
  const at = app.indexOf("const discardModal=");
  const modal = app.slice(at, app.indexOf("const manualModal=", at));
  it("is found, and draws Discard first and the blue Keep editing last", () => {
    expect(at).toBeGreaterThan(-1);
    const discard = modal.indexOf(">Discard<");
    const keep = modal.indexOf(">Keep editing<");
    expect(discard).toBeGreaterThan(-1);
    expect(keep).toBeGreaterThan(discard);
    expect(modal.slice(discard, keep)).toContain("mkSolidBtn(S.accent)");
  });
  it("names the situation and says what discarding costs", () => {
    expect(modal).toContain(">Unsaved changes<");
    expect(modal).not.toContain("Discard unsaved changes?");
    expect(modal).toContain("Discarding can't be undone.");
  });
});

// The ctx: any name it is not given reads as a function that records its call.
function recorder(values = {}) {
  const calls = [];
  const K = new Proxy(values, {
    get: (target, name) => (name in target ? target[name] : (...args) => calls.push([name, ...args])),
  });
  return { K, calls };
}

// id → the guard Escape must go through.
const GUARDED = {
  form: "requestCloseForm",
  walkin: "requestCloseWalkin",
  manual: "requestCloseManual",
  block: "requestCloseBlock",
  specialday: "requestCloseSpecialDay",
  reminder: "requestCloseReminderEditor",
  settings: "requestCloseSettings",
  inbox: "closeInbox",
};
// id → the one setter Escape calls, and what with.
const PLAIN = {
  splitmenu: ["setSplitMenuFor", null],
  discard: ["setConfirmDiscard", null],
  reminderdel: ["setConfirmReminderDel", null],
  roles: ["setRolesFor", null],
  activity: ["setActivityOpen", null],
  history: ["setShowHistory", false],
  kitchen: ["setConfirmKitchen", null],
  voucher: ["setVoucherAsk", null],
  voucherback: ["setVoucherBack", null],
  vouchercarry: ["setVoucherCarry", null],
  seatnote: ["setSeatNote", null],
  seatclash: ["setSeatClash", null],
  reshuffle: ["setConfirmReshuffle", false],
  cancel: ["setConfirmCancel", null],
  del: ["setConfirmDel", null],
  prefpicker: ["setShowPrefPicker", false],
  search: ["setShowSearch", false],
  waitlist: ["setShowWaitlist", false],
  wadelete: ["setConfirmDeleteConv", null],
  waarchive: ["setConfirmArchive", null],
  waphoto: ["setWaPhoto", null],
  sim: ["setShowSim", false],
  week: ["setShowWeek", false],
  print: ["setPrintAsk", null],
};

describe("escapeAction", () => {
  it("every modal is decided below: a guard, or the one setter it clears", () => {
    expect([...Object.keys(GUARDED), ...Object.keys(PLAIN)].sort()).toEqual([...MODAL_Z].sort());
  });
  it("a surface that holds a draft goes through its guard, and does nothing else", () => {
    Object.entries(GUARDED).forEach(([id, guard]) => {
      const { K, calls } = recorder();
      escapeAction(K, id)();
      expect(calls, id).toEqual([[guard]]);
    });
  });
  it("every other modal clears its own state, and does nothing else", () => {
    Object.entries(PLAIN).forEach(([id, call]) => {
      const { K, calls } = recorder();
      escapeAction(K, id)();
      expect(calls, id).toEqual([call]);
    });
  });
  it("an id with no row closes nothing", () => {
    expect(escapeAction(recorder().K, "nope")).toBe(null);
  });
});

describe("enterAction", () => {
  function press(id, values) {
    const { K, calls } = recorder(values);
    let prevented = 0;
    enterAction(K, id, { preventDefault: () => { prevented++; } });
    return { calls, prevented };
  }
  const REMINDER = { text: "Order wine", times: ["13:00"], recurrence: { type: "weekly", days: [1] } };

  it("Enter's order is its own, and every id in it is a modal", () => {
    // Deliberately not MODAL_Z reversed: unifying the two would be a keyboard change.
    expect(MODAL_ENTER_ORDER).toEqual(["discard", "reminder", "reminderdel", "manual", "kitchen",
      "reshuffle", "del", "prefpicker", "walkin", "form"]);
    MODAL_ENTER_ORDER.forEach((id) => expect(MODAL_Z).toContain(id));
  });
  it("each primary action runs once, with its own payload", () => {
    expect(press("reminderdel", { confirmReminderDel: "r1" })).toEqual({ calls: [["doDeleteReminder", "r1"]], prevented: 1 });
    expect(press("del", { confirmDel: "b1" })).toEqual({ calls: [["delBooking", "b1"]], prevented: 1 });
    expect(press("prefpicker")).toEqual({ calls: [["setShowPrefPicker", false]], prevented: 1 });
    expect(press("walkin")).toEqual({ calls: [["saveWalkin"]], prevented: 1 });
  });
  // v18.14.0 (correction 18): it used to run doDiscard, measured on DEV: Escape, then
  // Enter, and the walk-in was gone. Nobody asked to discard, so Enter goes back.
  it("Enter on the discard confirm keeps editing, and never discards", () => {
    const p = press("discard");
    expect(p).toEqual({ calls: [["setConfirmDiscard", null]], prevented: 1 });
    expect(p.calls.flat()).not.toContain("doDiscard");
  });
  it("the confirm closes before what it confirms runs", () => {
    expect(press("reshuffle").calls).toEqual([["setConfirmReshuffle", false], ["forceReshuffle"]]);
    expect(press("kitchen", { confirmKitchen: "form" }).calls).toEqual([["setConfirmKitchen", null], ["doSave"]]);
    expect(press("kitchen", { confirmKitchen: "walkin" }).calls).toEqual([["setConfirmKitchen", null], ["doSaveWalkin"]]);
  });
  it("a reminder saves only a valid draft", () => {
    expect(press("reminder", { reminderEditor: { draft: REMINDER } })).toEqual({ calls: [["saveReminderFromEditor"]], prevented: 1 });
    expect(press("reminder", { reminderEditor: { draft: { ...REMINDER, text: " " } } })).toEqual({ calls: [], prevented: 0 });
  });
  it("the form saves only with a date, as its Save button does", () => {
    expect(press("form", { form: { date: "2026-11-02" } })).toEqual({ calls: [["save"]], prevented: 1 });
    expect(press("form", { form: { date: "" } })).toEqual({ calls: [], prevented: 0 });
    expect(press("form", { form: null })).toEqual({ calls: [], prevented: 0 });
  });
  it("the manual picker keeps its own Enter, and an id outside the order does nothing", () => {
    expect(press("manual")).toEqual({ calls: [], prevented: 0 });
    expect(press("settings")).toEqual({ calls: [], prevented: 0 });
  });
});
