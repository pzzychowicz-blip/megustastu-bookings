// tests/draft-check.test.js
//
// v18.8.0 phase 8 — the WhatsApp draft checks the request before Accept.
// `draftAvailability` must answer exactly what the booking form the card opens
// would answer (it is composed from the same helpers, in the same order), so
// most cases here run the form's helpers beside it and compare. The fixtures
// use the default layout (13 tables, kitchen limit 3) and hours (13:00–22:00),
// on a fixed FUTURE date so the optimiser is always on.

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import {
  draftCheckable, draftAvailability, draftCheckLine, nearestTimes, draftPrefill, onWaitlistFor, DRAFT_ALTS,
} from "../src/lib/draft-check.js";
import { trialFits, findTimes, formatSugg, genId, toMins } from "../src/lib/booking-logic.js";
import { ALL_TABLES, setWeekHours, DEFAULT_WEEK_HOURS } from "../src/lib/constants.js";
import { availabilityReply, spokenDay } from "../src/lib/whatsapp.js";

const D = "2099-06-15"; // a Monday, far in the future
const read = (...p) => stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", ...p), "utf8")).join("\n");

function bk(o) {
  return Object.assign({
    id: genId(), name: "T", phone: "", date: D, time: "13:00", size: 2,
    duration: 90, preference: "auto", status: "confirmed", tables: [],
    _locked: false, _manual: false, preferredTables: [], history: [],
  }, o);
}
// Every table taken from 19:30 to 22:00 by a party that cannot be moved.
function fullEvening(status) {
  return ALL_TABLES.map((t) => bk({ time: "19:30", duration: 150, tables: [t.id], _locked: true, status: status || "confirmed" }));
}
const conv = (draft, extra) => Object.assign({ phoneKey: "+34600111222", phone: "+34600111222", draftData: Object.assign({ intent: "new_booking", size: 4, date: D, time: "20:00" }, draft) }, extra);

describe("which drafts are checked", () => {
  it("a new booking with a usable size, date and time, still waiting", () => {
    expect(draftCheckable(conv({}))).toBe(true);
    expect(draftCheckable(conv({ intent: undefined }))).toBe(true); // a missing intent is a new booking
  });
  it("nothing else: a missing field, another intent, or a decided draft", () => {
    expect(draftCheckable(conv({ size: null }))).toBe(false);
    expect(draftCheckable(conv({ size: 0 }))).toBe(false);
    expect(draftCheckable(conv({ size: "4" }))).toBe(false); // the parse stores numbers; a string is not one
    expect(draftCheckable(conv({ date: "next tuesday" }))).toBe(false);
    expect(draftCheckable(conv({ time: "8 in the evening" }))).toBe(false);
    expect(draftCheckable(conv({ intent: "modify" }))).toBe(false);
    expect(draftCheckable(conv({}, { draftStatus: "accepted" }))).toBe(false);
    expect(draftCheckable(conv({}, { draftStatus: "dismissed" }))).toBe(false);
    expect(draftCheckable({ phoneKey: "x" })).toBe(false);
    expect(draftCheckable(null)).toBe(false);
  });
});

describe("draftAvailability answers what the booking form would", () => {
  afterEach(() => setWeekHours(DEFAULT_WEEK_HOURS));

  it("an empty evening: it fits, on the tables the form's scan chooses, and offers nothing", () => {
    const d = { size: 4, date: D, time: "20:00" };
    const r = draftAvailability(d, [], [], [], false);
    expect(r.fits).toBe(true);
    expect(r.tables).toEqual(trialFits([], D, "20:00", 4, "auto", 90, [], null, null, false));
    expect(r.kitchenBusy).toBe(false);
    expect(r.alts).toEqual([]);
    expect(draftCheckLine(d, r)).toEqual({ tone: "success", text: "Fits at 20:00" });
  });

  it("a full evening: no table, and the nearest times the form would list", () => {
    const list = fullEvening();
    const d = { size: 4, date: D, time: "20:00" };
    const r = draftAvailability(d, list, list, [], false);
    expect(r.fits).toBe(false);
    expect(r.sugg).toEqual(formatSugg(findTimes(D, 4, "auto", list, 90, toMins("20:00"), [], null, false), toMins("20:00")));
    // A party of four for 90 minutes must be gone by 19:30, so 18:00 is the latest.
    expect(r.alts).toEqual(["17:15", "17:30", "17:45", "18:00"]);
    expect(r.alts).toHaveLength(DRAFT_ALTS);
    expect(draftCheckLine(d, r)).toEqual({ tone: "danger", text: "No tables for 4 at 20:00" });
  });

  it("a completed visit counts as it does in the form's scan (by the length it was recorded with)", () => {
    // Completed at 20:00, so its recorded stay ends where the request starts.
    const list = ALL_TABLES.map((t) => bk({ time: "18:30", duration: 90, tables: [t.id], _locked: true, status: "completed" }));
    const r = draftAvailability({ size: 4, date: D, time: "20:00" }, list, list, [], false);
    expect(r.fits).toBe(true);
    expect(r.tables).toEqual(trialFits(list, D, "20:00", 4, "auto", 90, [], null, null, false));
  });

  it("a kitchen at its limit: it fits, says so in the warn tone, and offers quieter times that also have a table", () => {
    // Two other parties starting at 20:00; with this one that is the limit (3).
    const list = [bk({ time: "20:00", tables: ["1"], _locked: true }), bk({ time: "20:00", tables: ["10"], _locked: true })];
    const d = { size: 2, date: D, time: "20:00" };
    const r = draftAvailability(d, list, list, [], false);
    expect(r.fits).toBe(true);
    expect(r.kitchenBusy).toBe(true);
    expect(r.load.starts).toBe(2);
    expect(r.kitchenSugg).not.toBeNull();
    expect(r.alts).toEqual(["19:30", "19:45", "20:15", "20:30"]);
    expect(draftCheckLine(d, r)).toEqual({ tone: "warn", text: "Kitchen may be busy at 20:00" });
  });

  it("one party fewer and the kitchen is fine", () => {
    const list = [bk({ time: "20:00", tables: ["1"], _locked: true })];
    const r = draftAvailability({ size: 2, date: D, time: "20:00" }, list, list, [], false);
    expect(r.kitchenBusy).toBe(false);
    expect(r.kitchenSugg).toBeNull();
  });

  it("a table block counts like a booking", () => {
    const blocks = ALL_TABLES.map((t) => ({ id: "b" + t.id, tableId: t.id, date: D, allDay: true }));
    const r = draftAvailability({ size: 2, date: D, time: "20:00" }, [], [], blocks, false);
    expect(r.fits).toBe(false);
    expect(r.alts).toEqual([]);
  });

  it("a closed day asks nothing else", () => {
    const closed = { open: 13, close: 22, closed: true };
    setWeekHours(Object.assign({}, DEFAULT_WEEK_HOURS, { 1: closed })); // D is a Monday
    const d = { size: 2, date: D, time: "20:00" };
    const r = draftAvailability(d, [], [], [], false);
    expect(r).toMatchObject({ closed: true, fits: false, alts: [] });
    expect(draftCheckLine(d, r)).toEqual({ tone: "danger", text: "Closed on that day" });
  });

  it("a time Save would refuse is not a fit: after the last start, or before opening", () => {
    const late = { size: 4, date: D, time: "23:00" };
    const r = draftAvailability(late, [], [], [], false);
    expect(r).toMatchObject({ outside: true, fits: false });
    // 90 minutes from 20:30 ends at closing; nothing later fits the day.
    expect(r.alts).toEqual(["19:45", "20:00", "20:15", "20:30"]);
    expect(draftCheckLine(late, r)).toEqual({ tone: "danger", text: "23:00 is outside opening hours" });
    expect(draftAvailability({ size: 2, date: D, time: "21:50" }, [], [], [], false).outside).toBe(true); // last start is 21:45
    expect(draftAvailability({ size: 2, date: D, time: "12:00" }, [], [], [], false).outside).toBe(true);
    expect(draftAvailability({ size: 2, date: D, time: "21:45" }, [], [], [], false).outside).toBe(false);
  });

  it("with the optimiser off, only a table free as the day stands is a fit (the form's noResh)", () => {
    // Table 9 (the only 4-top) holds an unlocked 2-top that the optimiser
    // would move to a 2-top; with it off, nothing is moved, so a party of four
    // needs a joined pair that is free as it stands.
    const list = [bk({ time: "20:00", tables: ["9"] })];
    const d = { size: 4, date: D, time: "20:00" };
    expect(draftAvailability(d, list, list, [], true).tables).toEqual(trialFits(list, D, "20:00", 4, "auto", 90, [], null, null, true));
    expect(draftAvailability(d, list, list, [], false).tables).toEqual(trialFits(list, D, "20:00", 4, "auto", 90, [], null, null, false));
  });

  it("asks for the seating the customer stated, and reads anything else as no preference", () => {
    const list = [bk({ time: "20:00", tables: ["10"], _locked: true })];
    const indoor = draftAvailability({ size: 2, date: D, time: "20:00", preference: "indoor" }, list, list, [], false);
    expect(indoor.tables).toEqual(trialFits(list, D, "20:00", 2, "indoor", 90, [], null, null, false));
    expect(["11", "12", "13"]).toEqual(expect.arrayContaining(indoor.tables));
    const junk = draftAvailability({ size: 2, date: D, time: "20:00", preference: "chatty" }, list, list, [], false);
    expect(junk.tables).toEqual(trialFits(list, D, "20:00", 2, "auto", 90, [], null, null, false));
  });
});

describe("nearestTimes", () => {
  it("takes the closest to the time asked, then puts them in clock order", () => {
    expect(nearestTimes(["17:00", "18:00", "19:30", "20:30", "22:00"], toMins("20:00"), 3)).toEqual(["19:30", "20:30", "18:00"].sort());
    expect(nearestTimes([], 600)).toEqual([]);
    expect(nearestTimes(null, 600)).toEqual([]);
  });
  it("breaks a tie towards the earlier time", () => {
    expect(nearestTimes(["19:30", "20:30"], toMins("20:00"), 1)).toEqual(["19:30"]);
  });
});

describe("draftPrefill — one rule for Accept and for the waitlist", () => {
  it("the draft's name, else the customer's from their bookings; the phone with its plus", () => {
    const list = [bk({ name: "Ana López", phone: "+34600111222", status: "completed", date: "2099-01-01" })];
    expect(draftPrefill(conv({ name: "  " }), list)).toMatchObject({ name: "Ana López", phone: "+34600111222", size: 4, date: D, time: "20:00", preference: "auto", notes: "" });
    expect(draftPrefill(conv({ name: "Pau" }), list).name).toBe("Pau");
    expect(draftPrefill(conv({}, { phone: "34600111222" }), []).phone).toBe("+34600111222");
  });
  it("then the WhatsApp profile name, last: typed and known names win over it", () => {
    const list = [bk({ name: "Ana López", phone: "+34600111222", status: "completed", date: "2099-01-01" })];
    // A real customer who types no name, and is not known yet.
    expect(draftPrefill(conv({}, { profileName: " Patryk " }), []).name).toBe("Patryk");
    // Known on this phone: the name staff have is kept.
    expect(draftPrefill(conv({}, { profileName: "Patryk" }), list).name).toBe("Ana López");
    // Typed in the message: that wins over both.
    expect(draftPrefill(conv({ name: "Pau" }, { profileName: "Patryk" }), list).name).toBe("Pau");
    // Nothing anywhere, or a profile name that is not text: empty, as before.
    expect(draftPrefill(conv({}), []).name).toBe("");
    expect(draftPrefill(conv({}, { profileName: 42 }), []).name).toBe("");
  });
  it("v18.9.0: the name the restaurant phone saves comes after the typed one and before the bookings'", () => {
    const list = [bk({ name: "Ana López", phone: "+34600111222", status: "completed", date: "2099-01-01" })];
    const saved = { "+34600111222": { name: " Ana (terraza) ", at: 1 } };
    expect(draftPrefill(conv({}, { profileName: "Patryk" }), list, saved).name).toBe("Ana (terraza)");
    expect(draftPrefill(conv({ name: "Pau" }), list, saved).name).toBe("Pau");
    // A contact saved with no name, or none at all, falls through as before.
    expect(draftPrefill(conv({}), list, { "+34600111222": { name: "", at: 1 } }).name).toBe("Ana López");
    expect(draftPrefill(conv({}), list, undefined).name).toBe("Ana López");
  });
  it("Accept's fallbacks for a draft it opens anyway", () => {
    const p = draftPrefill({ phoneKey: "+44", draftData: { preference: "indoor", notes: "terrace" } }, []);
    expect(p).toMatchObject({ size: 2, time: "13:00", preference: "indoor", notes: "terrace" });
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("is what Accept and the waitlist read: neither spells the rule again", () => {
    const hook = read("hooks", "useWhatsApp.js");
    const accept = hook.slice(hook.indexOf("function handleAcceptDraft("), hook.indexOf("function takeDraftSource("));
    expect(accept).toMatch(/const p = draftPrefill\(conv, bookings, contactsRef\.current, tagList\);/);
    // v18.11.0: the form opens with the occasions the prefill kept.
    expect(accept).toMatch(/tags: p\.tags,/);
    expect(accept).toMatch(/const time = \(over && over\.time\) \|\| p\.time;/);
    expect(accept).not.toMatch(/matchCustomerByPhone|charAt\(0\)/);
    const App = read("App.jsx");
    const wl = App.slice(App.indexOf("function addDraftToWaitlist(conv){"), App.indexOf("function addFormToWaitlist(){"));
    // v18.11.0: the entry is `waitlistEntry`'s, built from the prefill.
    // v18.11.0: with the tag list, so the entry keeps the draft's occasions.
    expect(wl).toMatch(/waitlistEntry\(draftPrefill\(conv,bookings,wa\.contacts,tagList\),/);
    expect(wl).toMatch(/addToWaitlist\(w\.entry\);/);
  });
});

describe("onWaitlistFor — derived, never stored", () => {
  const c = conv({});
  it("matches the same phone on the same date, whatever its punctuation", () => {
    expect(onWaitlistFor([{ phone: "+34 600 111 222", date: D }], c)).toBe(true);
    expect(onWaitlistFor([{ phone: "+34600111222", date: "2099-06-16" }], c)).toBe(false);
    expect(onWaitlistFor([{ phone: "+34600999999", date: D }], c)).toBe(false);
    expect(onWaitlistFor([], c)).toBe(false);
    expect(onWaitlistFor(null, c)).toBe(false);
  });
});

describe("availabilityReply — the reply Suggest these puts in the box", () => {
  const base = { size: 4, date: "2026-10-16", time: "20:00" };
  it("names the day in the customer's language", () => {
    expect(spokenDay("2026-10-16", "en")).toBe("Friday 16 October");
    expect(spokenDay("2026-10-16", "es")).toBe("viernes 16 de octubre");
    expect(spokenDay("16/10/2026", "en")).toBe("16/10/2026");
  });
  it("no table: the times on the chips, then the waitlist", () => {
    const o = Object.assign({ reason: "full", alts: ["19:30", "19:45", "21:00"], waitlist: true }, base);
    expect(availabilityReply("en", o)).toBe("Sorry, we have no table for 4 at 20:00 on Friday 16 October. We could offer 19:30, 19:45 or 21:00. Or we can put you on our waitlist and let you know if a table frees up.");
    expect(availabilityReply("es", o)).toBe("Lo sentimos, no tenemos mesa para 4 a las 20:00 del viernes 16 de octubre. Podemos ofrecerle las 19:30, las 19:45 o las 21:00. Si lo prefiere, le apuntamos en la lista de espera y le avisamos si se libera una mesa.");
  });
  it("no table and no other time: the waitlist alone, or that they are on it", () => {
    const o = Object.assign({ reason: "full", alts: [], waitlist: true }, base);
    expect(availabilityReply("en", o)).toBe("Sorry, we have no table for 4 at 20:00 on Friday 16 October. We can put you on our waitlist and let you know if a table frees up.");
    expect(availabilityReply("es", o)).toMatch(/del viernes 16 de octubre\. Si lo desea, le apuntamos en la lista de espera/);
    const added = Object.assign({}, o, { waitlist: "added" });
    expect(availabilityReply("en", added)).toMatch(/\. We've put you on our waitlist and will let you know if a table frees up\.$/);
    expect(availabilityReply("es", added)).toMatch(/\. Le hemos apuntado en la lista de espera y le avisaremos si se libera una mesa\.$/);
  });
  it("a busy kitchen asks about the quieter times", () => {
    const o = Object.assign({ reason: "kitchen", alts: ["19:30", "20:45"] }, base);
    expect(availabilityReply("en", o)).toBe("At 20:00 on Friday 16 October our kitchen is at its busiest. Would 19:30 or 20:45 suit you instead?");
    expect(availabilityReply("es", o)).toBe("A las 20:00 del viernes 16 de octubre tenemos la cocina muy llena. ¿Le iría bien a las 19:30 o a las 20:45?");
  });
  it("outside the hours: the times it can offer that day", () => {
    const o = Object.assign({}, base, { reason: "hours", time: "23:00", alts: ["20:15", "20:30"] });
    expect(availabilityReply("en", o)).toBe("Sorry, we don't take bookings at 23:00. On Friday 16 October we could offer 20:15 or 20:30.");
    expect(availabilityReply("es", o)).toBe("Lo sentimos, no aceptamos reservas a las 23:00. El viernes 16 de octubre podemos ofrecerle las 20:15 o las 20:30.");
  });
  it("Spanish when no language is known (the template chips' default), English for any other", () => {
    const o = Object.assign({ reason: "kitchen", alts: ["19:30"] }, base);
    expect(availabilityReply(undefined, o)).toMatch(/^A las 20:00/);
    expect(availabilityReply("de", o)).toMatch(/^At 20:00/);
  });
});

describe("the card runs the check after the paint, never in render", () => {
  it("through useDeferredCompute, keyed on the draft and the day's data but not the clock", () => {
    const hook = read("hooks", "useDraftCheck.js");
    expect(hook).toMatch(/useDeferredCompute\(function \(\) \{/);
    expect(hook).toMatch(/\[applies, size, date, time, pref, bookings, tableBlocks, autoOptimizer, hoursSig\]/);
    expect(hook).toMatch(/!optimizerActiveFor\(date, autoOptimizer\)/);
    const view = read("components", "whatsapp", "ConversationView.jsx");
    expect(view).toMatch(/const draftCheck = useDraftCheck\(conv, \{ bookings, liveBookings, tableBlocks, autoOptimizer \}\);/);
    // Nothing in the view or the card runs a scan itself.
    const card = read("components", "whatsapp", "DraftCard.jsx");
    for (const src of [view, card]) expect(src).not.toMatch(/draftAvailability\(|trialFits\(|findTimes\(/);
  });
  it("a time chip accepts at that time, and Suggest puts the reply in the box without sending", () => {
    const card = read("components", "whatsapp", "DraftCard.jsx");
    expect(card).toMatch(/onAcceptAt=\{\(time\) => onAccept\(\{ time \}\)\}/);
    expect(card).toMatch(/onSuggest\(availabilityReply\(conv\.language, \{/);
    const view = read("components", "whatsapp", "ConversationView.jsx");
    expect(view).toMatch(/composerRef\.current\.insert\(text\)/);
    expect(view).toMatch(/onSuggest=\{disabled \? null : suggestReply\}/);
    const composer = read("components", "whatsapp", "ReplyComposer.jsx");
    expect(composer).toMatch(/useImperativeHandle\(ref, \(\) => \(\{ insert: insertTemplate \}\)\);/);
  });
  // Measured on DEV: as a status chip of its own, "On the waitlist" was a
  // content-box span 44px tall beside 36px buttons and narrower than the button
  // it replaced, so the row re-wrapped and the control jumped 460px from under
  // the finger; and the press dropped focus to <body> with the button.
  it("Add to waitlist and On the waitlist are one button, in one box, that keeps its focus", () => {
    const card = read("components", "whatsapp", "DraftCard.jsx");
    expect(card).toMatch(/<OutlineChip as="button" tone=\{onTheWaitlist \? "success" : "neutral"\}/);
    expect(card).toMatch(/aria-disabled=\{onTheWaitlist \? "true" : undefined\}/);
    expect(card).toMatch(/\{onTheWaitlist \? "On the waitlist" : "Add to waitlist"\}/);
    expect(card).toMatch(/Object\.assign\(\{\}, CHECK_BTN, \{ minWidth: WAIT_W, justifyContent: "center" \}/);
    // Not a second element for the done state, and never `disabled` (Chrome
    // blurs a focused control that becomes disabled).
    expect(card).not.toMatch(/<OutlineChip tone="success"[^>]*>\s*<CheckIcon[^>]*\/>\s*On the waitlist/);
    expect(card).not.toMatch(/\sdisabled=\{onTheWaitlist/);
  });
});

describe("useDeferredCompute never hands back an answer to another question", () => {
  it("a result is read only while the deps it was computed for are the deps", async () => {
    const { sameDeps } = await import("../src/hooks/useDeferredCompute.js");
    const list = [];
    expect(sameDeps([1, "a", list], [1, "a", list])).toBe(true);
    expect(sameDeps([1, "a", list], [1, "a", []])).toBe(false); // identity, as React compares deps
    expect(sameDeps([NaN], [NaN])).toBe(true);
    expect(sameDeps([1], [1, 2])).toBe(false);
    expect(sameDeps(null, [1])).toBe(false);
    const hook = read("hooks", "useDeferredCompute.js");
    expect(hook).toMatch(/setState\(\{ value: result, pending: false, deps: deps \}\);/);
    expect(hook).toMatch(/return state\.deps && !sameDeps\(state\.deps, deps\) \? STALE : state;/);
  });
});
