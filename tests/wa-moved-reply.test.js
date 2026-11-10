// tests/wa-moved-reply.test.js — v18.16.0
//
// When staff move the time of a booking that came through WhatsApp, the new
// time is DRAFTED in that guest's chat: put in the reply box on this device,
// read and sent by a person. The text and every decision about it are pure
// (src/lib/whatsapp.js); the hook holds the refs and the store, and App calls it
// only where a write has landed. What the form's save does with the answer is
// run in tests/save-path.test.js; the time drag's half is pinned in
// tests/drop-plan.test.js (`saveMove`).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";
import { movedReply, movedSlot, movedReplyPlan, movedReplyUndo, movedReplyWords, WA_WINDOW_MS } from "../src/lib/whatsapp.js";

const read = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8")).join("\n");
const HOOK = read("../src/hooks/useWhatsApp.js");
const APP = appCode();

describe("movedReply: the text, in the guest's language", () => {
  const to = { date: "2026-10-16", time: "19:30" };
  it("English", () => {
    expect(movedReply("en", to)).toBe("We've moved your booking: it is now on Friday 16 October at 19:30. If that doesn't suit you, please let us know.");
  });
  it("Spanish, in the templates' formal register", () => {
    expect(movedReply("es", to)).toBe("Hemos cambiado su reserva: ahora es el viernes 16 de octubre a las 19:30. Si no le va bien, díganoslo, por favor.");
  });
  it("no language is Spanish, and one the app has no text for is English, as the other replies do", () => {
    expect(movedReply(undefined, to)).toBe(movedReply("es", to));
    expect(movedReply("", to)).toBe(movedReply("es", to));
    expect(movedReply("de", to)).toBe(movedReply("en", to));
  });
});

describe("movedSlot: did the write change when the guest should come", () => {
  const b = (o) => Object.assign({ id: "b1", date: "2026-10-16", time: "19:00", scheduledTime: "19:00", status: "confirmed" }, o);
  it("a new time, a new date, or both", () => {
    expect(movedSlot(b(), b({ time: "19:30", scheduledTime: "19:30" }))).toEqual({ date: "2026-10-16", time: "19:30" });
    expect(movedSlot(b(), b({ date: "2026-10-17" }))).toEqual({ date: "2026-10-17", time: "19:00" });
    expect(movedSlot(b(), b({ date: "2026-10-17", time: "20:00" }))).toEqual({ date: "2026-10-17", time: "20:00" });
  });
  it("nothing when neither moved, whatever else the write changed", () => {
    expect(movedSlot(b(), b({ size: 6, tables: ["4"], notes: "window" }))).toBeNull();
  });
  it("a pending booking counts; a seated or a finished one does not", () => {
    expect(movedSlot(b({ status: "pending" }), b({ status: "pending", time: "20:00" }))).not.toBeNull();
    for (const status of ["seated", "completed", "cancelled"]) {
      expect(movedSlot(b(), b({ status, time: "20:00" })), status).toBeNull();
    }
  });
  it("compares the time the guest was given: an un-seat that restores the booked start is no move", () => {
    // Seated at 18:50 on a 19:00 booking, then walked back to confirmed.
    const seated = b({ status: "seated", time: "18:50", scheduledTime: "19:00" });
    expect(movedSlot(seated, b({ time: "19:00" }))).toBeNull();
    // …and one that types a new time in the same save is.
    expect(movedSlot(seated, b({ time: "19:30" }))).toEqual({ date: "2026-10-16", time: "19:30" });
  });
  it("a booking with no readable scheduled time falls back to its time", () => {
    expect(movedSlot(b({ scheduledTime: undefined }), b({ time: "19:00" }))).toBeNull();
    expect(movedSlot(b({ scheduledTime: "soon" }), b({ time: "19:30" }))).not.toBeNull();
  });
  it("answers nothing without both rows", () => {
    expect(movedSlot(null, b())).toBeNull();
    expect(movedSlot(b(), undefined)).toBeNull();
  });
});

describe("movedReplyPlan: the answers", () => {
  const NOW = 1_800_000_000_000;
  const to = { date: "2026-10-16", time: "19:30" };
  const conv = (o) => Object.assign({ phoneKey: "34600111222", acceptedBookingId: "b1", language: "en", windowExpiresAt: NOW + WA_WINDOW_MS / 2 }, o);
  const ask = (o) => movedReplyPlan(Object.assign({
    on: true, conversations: [conv()], bookingId: "b1", to,
    booking: { id: "b1", date: "2026-10-16", time: "19:30" },
    textOf: () => "", mine: undefined, now: NOW,
  }, o));
  it("drafts the text in the linked conversation's box", () => {
    // …and says what it names and what it replaced, which Undo asks about.
    expect(ask()).toEqual({ phoneKey: "34600111222", text: movedReply("en", to), to, prev: null });
    expect(ask({ conversations: [conv({ language: "es" })] }).text).toBe(movedReply("es", to));
  });
  it("1 · the module off does nothing at all, and is asked first", () => {
    expect(ask({ on: false })).toBeNull();
    expect(ask({ on: undefined })).toBeNull();
    // First: nothing else is even looked at.
    expect(movedReplyPlan({ on: false })).toBeNull();
  });
  it("2 · no conversation linked to this booking", () => {
    expect(ask({ conversations: [] })).toBeNull();
    expect(ask({ conversations: [conv({ acceptedBookingId: "other" })] })).toBeNull();
    expect(ask({ conversations: [null, conv({ acceptedBookingId: null })] })).toBeNull();
  });
  it("3 · a muted guest", () => {
    expect(ask({ conversations: [conv({ muted: true })] })).toBeNull();
  });
  it("4 · a reply box that already holds somebody's text is left alone", () => {
    expect(ask({ textOf: () => "On my way to check" })).toBeNull();
    // even when the window is closed: nothing is said about a box nobody touched
    expect(ask({ textOf: () => "x", conversations: [conv({ windowExpiresAt: NOW - 1 })] })).toBeNull();
  });
  it("…but text this session drafted for the same booking, unchanged, is replaced by the newer time", () => {
    const at1915 = { date: "2026-10-16", time: "19:15" };
    const first = movedReply("en", at1915);
    const mine = { phoneKey: "34600111222", text: first, to: at1915, prev: null };
    expect(ask({ textOf: () => first, mine })).toEqual({
      phoneKey: "34600111222", text: movedReply("en", to), to,
      prev: { phoneKey: "34600111222", text: first, to: at1915, prev: null },
    });
    // one step back is kept, never a chain
    const third = ask({ textOf: () => movedReply("en", to), mine: ask({ textOf: () => first, mine }), to: { date: "2026-10-16", time: "20:00" }, booking: { id: "b1", date: "2026-10-16", time: "20:00" } });
    expect(third.prev.prev).toBeNull();
    // edited since: theirs now
    expect(ask({ textOf: () => first + " See you then!", mine })).toBeNull();
    // ours, but in another conversation's box
    expect(ask({ textOf: () => first, mine: { phoneKey: "other", text: first, to: at1915, prev: null } })).toBeNull();
  });
  it("5 · an expired 24-hour window is said, not drafted", () => {
    expect(ask({ conversations: [conv({ windowExpiresAt: NOW - 1 })] })).toBe("closed");
    expect(ask({ conversations: [conv({ windowExpiresAt: NOW })] })).toBe("closed");
    expect(ask({ conversations: [conv({ windowExpiresAt: NOW + 1 })] })).not.toBe("closed");
  });
  it("a booking that no longer says this time drafts nothing: an Undo landed before the write did", () => {
    expect(ask({ booking: { id: "b1", date: "2026-10-16", time: "19:00" } })).toBeNull();
    expect(ask({ booking: { id: "b1", date: "2026-10-15", time: "19:30" } })).toBeNull();
    expect(ask({ booking: undefined })).toBeNull();
  });
  it("uses the composer's own question for the window", () => {
    expect(read("../src/lib/whatsapp.js")).toContain('if (windowState(conv.windowExpiresAt, o.now).expired) return "closed";');
  });
});

describe("movedReplyUndo: what an Undo on that booking does to the draft", () => {
  const D = "2026-10-16";
  const at = (time) => ({ date: D, time });
  const draft = (time, prev) => ({ phoneKey: "34600111222", text: movedReply("en", at(time)), to: at(time), prev: prev || null });
  const bk = (o) => Object.assign({ id: "b1", date: D, time: "19:00", scheduledTime: "19:00", status: "confirmed" }, o);
  it("the move undone: its draft goes, and the box is emptied", () => {
    const mine = draft("19:30");
    expect(movedReplyUndo(mine, mine.text, bk())).toEqual({ mine: null, text: "" });
  });
  it("an Undo of something else leaves the move's draft alone (a note, a status, a table drop made after it)", () => {
    // Measured on DEV, 2026-11-10: a note edited and undone after a move emptied the box.
    const mine = draft("19:30");
    expect(movedReplyUndo(mine, mine.text, bk({ time: "19:30", scheduledTime: "19:30" }))).toBeNull();
    expect(movedReplyUndo(mine, mine.text, bk({ time: "19:30", scheduledTime: "19:30", status: "cancelled" }))).toBeNull();
  });
  it("the second of two moves undone: the first move's draft comes back, because that is where the party is", () => {
    const first = draft("19:30");
    const second = draft("20:00", first);
    expect(movedReplyUndo(second, second.text, bk({ time: "19:30", scheduledTime: "19:30" }))).toEqual({ mine: first, text: first.text });
    // …but not when the Undo put the booking somewhere the earlier draft does not name
    expect(movedReplyUndo(second, second.text, bk({ time: "18:00", scheduledTime: "18:00" }))).toEqual({ mine: null, text: "" });
  });
  it("a draft somebody has edited or sent is theirs: the box is left, and it is forgotten", () => {
    const mine = draft("19:30");
    expect(movedReplyUndo(mine, mine.text + " See you then!", bk())).toEqual({ mine: null });
    expect(movedReplyUndo(mine, "", bk())).toEqual({ mine: null });
  });
  it("compares the time the guest was given, as movedSlot does", () => {
    const mine = draft("19:30");
    // put back to seated at 19:25 on a 19:30 booking: the draft's time still stands
    expect(movedReplyUndo(mine, mine.text, bk({ status: "seated", time: "19:25", scheduledTime: "19:30" }))).toBeNull();
  });
  it("nothing drafted, or nothing known about the booking, changes nothing", () => {
    expect(movedReplyUndo(undefined, "", bk())).toBeNull();
    expect(movedReplyUndo(draft("19:30"), movedReply("en", at("19:30")), undefined)).toBeNull();
  });
});

describe("movedReplyWords: how the app says it", () => {
  it("a clause for the pill and a sentence for the toast slot", () => {
    expect(movedReplyWords("drafted")).toEqual({ pill: "reply drafted", toast: "The new time is drafted in the guest's WhatsApp chat.", good: true });
    expect(movedReplyWords("closed")).toEqual({ pill: "guest's WhatsApp window is closed", toast: "The guest's WhatsApp window is closed, so no reply was drafted.", good: false });
  });
  it("nothing to say when nothing happened", () => {
    expect(movedReplyWords(null)).toBeNull();
    expect(movedReplyWords(undefined)).toBeNull();
  });
});

describe("the hook: refs and the store, nothing decided", () => {
  const draft = HOOK.slice(HOOK.indexOf("function draftMovedReply("), HOOK.indexOf("function undoMovedReply("));
  const undo = HOOK.slice(HOOK.indexOf("function undoMovedReply("), HOOK.indexOf("function handleArchive("));
  it("hands the plan the module switch, the live conversations and what the booking says now", () => {
    expect(draft).toContain("const plan = movedReplyPlan({");
    expect(draft).toContain("on: on, conversations: conversationsRef.current, bookingId: bookingId, to: to,");
    expect(draft).toContain("booking: bookingsRef.current.find(function (b) { return b.id === bookingId; }),");
    expect(draft).toContain("textOf: function (key) { return draftTextOf(uid, key); },");
    expect(draft).toContain("mine: movedDraftsRef.current[bookingId], now: Date.now(),");
    expect(HOOK).toMatch(/const bookingsRef = useRef\(bookings\);\s+useEffect\(function \(\) \{ bookingsRef\.current = bookings; \}, \[bookings\]\);/);
  });
  it("writes only a plan with a text, to this device's draft store, and remembers it", () => {
    expect(draft).toMatch(/if \(!plan \|\| plan === "closed"\) return plan;\s+setReplyDraft\(uid, plan\.phoneKey, plan\.text\);\s+movedDraftsRef\.current\[bookingId\] = plan;\s+return "drafted";/);
  });
  it("nothing here reaches the database or sends anything", () => {
    expect(draft + undo).not.toMatch(/patchConversation|appendMessage|handleSendReply|sendViaBackend|update\(|set\(/);
  });
  it("Undo asks the plan what to do, with what the box holds and what the booking was put back to", () => {
    expect(undo).toContain("function undoMovedReply(bookingId, restored) {");
    expect(undo).toContain('const back = movedReplyUndo(mine, mine ? draftTextOf(uid, mine.phoneKey) : "", restored);');
    expect(undo).toMatch(/if \(!back\) return;\s+if \(back\.mine\) movedDraftsRef\.current\[bookingId\] = back\.mine; else delete movedDraftsRef\.current\[bookingId\];\s+if \(typeof back\.text === "string"\) setReplyDraft\(uid, mine\.phoneKey, back\.text\);/);
  });
  it("is handed the account whose drafts these are, and hands both functions out", () => {
    const call = APP.slice(APP.indexOf("useWhatsApp({"), APP.indexOf("});", APP.indexOf("useWhatsApp({")));
    expect(call).toContain("uid: uid,");
    expect(HOOK).toContain("draftMovedReply, undoMovedReply,");
  });
});

describe("noteUndo: a clause for a pill that is already up", () => {
  const arm = APP.slice(APP.indexOf("function armUndo("), APP.indexOf("function noteUndo("));
  const note = APP.slice(APP.indexOf("function noteUndo("), APP.indexOf("function undoLastAction("));
  it("armUndo hands back its timer, which is the pill's identity", () => {
    expect(arm).toMatch(/undoTimerRef\.current=setTimeout\([\s\S]*?\);\s+return undoTimerRef\.current;\s+\}/);
  });
  it("adds nothing to a pill that has gone or been replaced, and says so", () => {
    expect(note).toContain("if(!pill||undoTimerRef.current!==pill) return false;");
  });
  it("extends a sentence pill's label, or the note of a pill that words itself by kind", () => {
    expect(note).toContain('u.label?{label:u.label+" · "+clause}:{note:u.note?u.note+" · "+clause:clause}');
  });
});

describe("App calls it where a write has landed, and nowhere else", () => {
  it("one door: draftMoved, which asks nothing without a slot", () => {
    expect(APP).toContain("function draftMoved(id,slot){return slot?movedReplyWords(wa.draftMovedReply(id,slot)):null;}");
    expect((APP.match(/wa\.draftMovedReply\(/g) || []).length).toBe(1);
    expect((APP.match(/draftMoved\(/g) || []).length, "the declaration, the time drag and the form").toBe(3);
  });
  it("the form: inside its write's onLanded, only for an edit that moved the guest's time", () => {
    const fn = APP.slice(APP.indexOf("function doSaveEdit("), APP.indexOf("function standingOn("));
    expect(fn).toContain("const moved=movedSlot(bookings.find(function(b){return b.id===id;}),plan.fin.find(function(b){return b.id===id;}));");
    expect(fn).toMatch(/moved\?\{onLanded:function\(\)\{\s+const said=draftMoved\(id,moved\);\s+if\(said&&!noteUndo\(pill,said\.pill\)\) flashDragMsg\(said\.toast,said\.good\);\s+\}\}:null/);
    expect(fn, "the pill is this edit's own").toContain('if(ok&&plan.changed) pill=armUndo(undoDelta(bookings,plan.fin),editId,"edit",false);');
    expect(fn.indexOf("draftMoved(")).toBeGreaterThan(fn.indexOf("onLanded:function(){"));
  });
  it("Undo takes the draft with the move, once its own write is dispatched", () => {
    const fn = APP.slice(APP.indexOf("function undoLastAction("), APP.indexOf("function manualAssign("));
    const call = "wa.undoMovedReply(undoInfo.primaryId,undoInfo.snapshots.find(function(s){return s.id===undoInfo.primaryId;}));";
    expect(fn.indexOf(call), "with the booking as it was put back").toBeGreaterThan(fn.indexOf("const ok=saveBookings(plan.transform);"));
    expect(fn.slice(fn.indexOf("if(ok){"))).toContain(call);
  });
});
