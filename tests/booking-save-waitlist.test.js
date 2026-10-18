// v18.11.0 (ROADMAP #17) — `waitlistEntry` (src/lib/booking-save.js), the
// entry the three "Add to waitlist" doors write.
//
// Each door wrote its own object literal until v18.11.0. Those three literals
// are copied below VERBATIM from v18.10.0's App.jsx (only `cleanPhoneOf` and
// `generalSettings` turned into arguments), and the builder is held to them
// over generated drafts: the move changes nothing a door hands `addToWaitlist`
// that the hook would store differently. The hook applies `|| ""`, `|| 2`,
// `|| null` and the today fallback on its own, so the comparison is made on
// what it STORES (`stored` below is `addToWaitlist`'s entry, less its id and
// clock), which is the claim that matters.
import { describe, it, expect } from "vitest";
import { waitlistEntry } from "../src/lib/booking-save.js";
import { phoneForSave, enteredPhone, NO_CODE_REFUSAL } from "../src/lib/booking-logic";

const P = ["ES", "GB"];
const PREFIX = "+34";
const TODAY = "2026-10-18";
const VIEW = "2026-10-20";

// useWaitlist.js's addToWaitlist, its entry without `id`, `createdAt` and
// `status` (which no door supplies).
function stored(a) {
  const e = {
    name: a.name || "",
    phone: a.phone || "",
    size: Number(a.size) || 2,
    date: a.date || TODAY,
    prefTime: a.prefTime || null,
    notes: a.notes || "",
  };
  if (a.preference === "indoor" || a.preference === "outdoor") e.preference = a.preference;
  return e;
}

const clean = (p) => enteredPhone(p, PREFIX);

// ── v18.10.0's three doors, verbatim ────────────────────────────────────────
function oldDraftDoor(p) {
  const phoneRule = phoneForSave(p.phone, P, PREFIX, false);
  if (phoneRule.refusal) return { refusal: phoneRule.refusal };
  return { args: { name: p.name, phone: clean(phoneRule.phone), size: p.size, date: p.date, prefTime: p.time, notes: p.notes, preference: p.preference } };
}
function oldFormDoor(f0) {
  const phoneRule = phoneForSave(f0.phone, P, PREFIX, false);
  const f = phoneRule.phone !== f0.phone ? Object.assign({}, f0, { phone: phoneRule.phone }) : f0;
  const ph = clean(f.phone);
  if (phoneRule.refusal) return { refusal: phoneRule.refusal };
  return { args: { name: f.name || "", phone: ph, size: Number(f.size) || 2, date: f.date || VIEW, prefTime: f.time || null, notes: f.notes || "", preference: f.preference } };
}
function oldWalkinDoor(walkinForm) {
  const wf = walkinForm || {};
  return { args: { name: wf.name || "", phone: clean(wf.phone), size: Number(wf.size) || 2, date: TODAY, prefTime: wf.time || null, notes: wf.notes || "" } };
}

// ── the three doors as v18.11.0 calls the builder ───────────────────────────
const opts = { checkPhone: true, pinned: P, prefix: PREFIX };
const newDraftDoor = (p) => waitlistEntry(p, opts);
const newFormDoor = (f) => waitlistEntry(f, Object.assign({ date: VIEW }, opts));
const newWalkinDoor = (wf) => waitlistEntry(Object.assign({}, wf, { date: TODAY, preference: undefined }), { prefix: PREFIX });

// ── generated drafts ────────────────────────────────────────────────────────
const PHONES = [undefined, "", "+", "+34", "600 111 333", "34 600 111 333", "+34 600 111 333",
  "07911 123456", "+44 07911 123456", "0044 7911 123456", "+1 212 555 0100", "12"];
const NAMES = [undefined, "", "Ana", "  Pau "];
const SIZES = [undefined, "", 0, "0", 1, "4", 7];
const DATES = [undefined, "", "2026-10-25"];
const TIMES = [undefined, "", "20:30"];
const NOTES = [undefined, "", "terrace"];
const PREFS = [undefined, "", "indoor", "outdoor", "any"];

function drafts(n) {
  // A small seeded LCG so a failure names the same draft on every run.
  let s = 42;
  const pick = (a) => { s = (s * 1103515245 + 12345) % 2147483648; return a[s % a.length]; };
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ name: pick(NAMES), phone: pick(PHONES), size: pick(SIZES), date: pick(DATES), time: pick(TIMES), notes: pick(NOTES), preference: pick(PREFS) });
  }
  return out;
}

function same(oldR, newR) {
  if (oldR.refusal || newR.refusal) return oldR.refusal === newR.refusal && !newR.entry;
  return JSON.stringify(stored(oldR.args)) === JSON.stringify(stored(newR.entry));
}

describe("waitlistEntry stores what each door stored before it (v18.11.0)", () => {
  const list = drafts(4000);
  it("the WhatsApp draft's door", () => {
    const bad = list.filter((d) => !same(oldDraftDoor(d), newDraftDoor(d)));
    expect(bad).toEqual([]);
  });
  it("the booking form's door", () => {
    const bad = list.filter((d) => !same(oldFormDoor(d), newFormDoor(d)));
    expect(bad).toEqual([]);
  });
  it("the walk-in form's door (no phone check; the date is today whatever the draft says)", () => {
    const bad = list.filter((d) => !same(oldWalkinDoor(d), newWalkinDoor(d)));
    expect(bad).toEqual([]);
    // A walk-in form that is not open (`walkinForm` null) still builds an entry.
    expect(stored(newWalkinDoor(null).entry)).toEqual(stored(oldWalkinDoor(null).args));
  });
  it("the generated drafts reach both answers: refusals and entries", () => {
    const answers = list.map(newFormDoor);
    expect(answers.some((r) => r.refusal)).toBe(true);
    expect(answers.some((r) => r.entry)).toBe(true);
  });
});

describe("waitlistEntry's phone rule (v18.2.0 phase 80, moved in v18.11.0)", () => {
  it("gives a code typed without its plus its plus, and stores the checked number", () => {
    expect(newFormDoor({ phone: "34 600 111 333" }).entry.phone).toBe("+34 600 111 333");
  });
  it("refuses a number that names no country, and builds no entry", () => {
    expect(newFormDoor({ phone: "600 111 333" })).toEqual({ refusal: NO_CODE_REFUSAL });
  });
  it("lets a draft with no phone through: the waitlist does not require one", () => {
    expect(newFormDoor({ name: "Ana" }).entry.phone).toBe("");
  });
  it("asks nothing without checkPhone (the walk-in has no phone field)", () => {
    expect(waitlistEntry({ phone: "600 111 333" }, { prefix: PREFIX }).refusal).toBeUndefined();
  });
  it("carries the draft's date, else the door's", () => {
    expect(newFormDoor({ date: "2026-10-25" }).entry.date).toBe("2026-10-25");
    expect(newFormDoor({}).entry.date).toBe(VIEW);
  });
});
