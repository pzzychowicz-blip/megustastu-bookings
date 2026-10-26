// tests/wa-sim-coexist.test.js
//
// v18.9.0 phase 9 — the simulator's coexistence events. The server half runs
// in tests/api-handlers.test.js against the in-memory database; this file has
// the pure rules both halves share (src/lib/wa-sim-coexist.js, and the two
// planners phase 9 lifted out of api/_lib/coexist-core.js) and the CLIENT
// mode of simulateCoexist (src/lib/wa-sim.js), whose writes go through the
// hook's savers, recorded here.

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ backend: false }));
vi.mock("../src/lib/wa-backend", () => ({ backendEnabled: () => state.backend, WA_BACKEND_URL: "" }));
vi.mock("../src/lib/wa-backend-sim", () => ({ backendInbound: vi.fn(), postSimEvent: vi.fn() }));

import { simulateCoexist } from "../src/lib/wa-sim";
import { postSimEvent } from "../src/lib/wa-backend-sim";
import {
  SIM_EVENTS, simMayTouchLink, simEventRefusal, simContactValue, simChangeMessage, lastCustomerMessage,
  simHistoryValue, simLinkPatch, SIM_WABA_ID, SIM_PHONE_NUMBER_ID, SIM_HISTORY_RECENT, SIM_HISTORY_OLD,
} from "../src/lib/wa-sim-coexist.js";
import { threadPlan, changeLine, WA_REVOKED_IN } from "../src/lib/wa-coexist.js";

const KEY = "+34600111222";
const REAL = { status: "connected", wabaId: "102030405060", phoneNumberId: "908070605040" };
const SIM = { status: "connected", wabaId: SIM_WABA_ID, phoneNumberId: SIM_PHONE_NUMBER_ID, sim: true };
const REFUSE_REAL = "A real Business-app connection is recorded on this database, so the simulator leaves it alone.";
const REFUSE_CLIENT = "Turn on backend mode first: only the server can store this.";

describe("which events may run, one rule for both halves", () => {
  it("a link with no ids, and one the simulator made, are fair game; a real one is not", () => {
    expect([null, undefined, {}, { contacts: { firstAt: 5 } }, SIM].map(simMayTouchLink)).toEqual([true, true, true, true, true]);
    expect([REAL, { wabaId: "1" }, { phoneNumberId: "1" }, Object.assign({}, REAL, { sim: "true" })].map(simMayTouchLink)).toEqual([false, false, false, false]);
  });

  it("refuses by the event's own two flags, then asks for a simulated connection to go and come back", () => {
    const table = Object.keys(SIM_EVENTS).map((e) => [e, simEventRefusal(e, null, false), simEventRefusal(e, REAL, true), simEventRefusal(e, SIM, true)]);
    expect(table).toEqual([
      ["contact", null, REFUSE_REAL, null],
      ["echo", null, null, null],
      ["edit", null, null, null],
      ["revoke", null, null, null],
      ["history", null, REFUSE_REAL, null],
      ["history-media", REFUSE_CLIENT, null, null],
      ["connect", REFUSE_CLIENT, REFUSE_REAL, null],
      ["disconnect", REFUSE_CLIENT, REFUSE_REAL, null],
      ["reconnect", REFUSE_CLIENT, REFUSE_REAL, null],
      ["forget", REFUSE_CLIENT, REFUSE_REAL, null],
    ]);
    expect(simEventRefusal("disconnect", null, true)).toBe("Connect (simulated) first.");
    expect(simEventRefusal("reconnect", { contacts: { firstAt: 5 } }, true)).toBe("Connect (simulated) first.");
    expect(["toString", "__proto__", "", undefined].map((e) => simEventRefusal(e, null, true))).toEqual(Array(4).fill("Unknown event."));
  });
});

describe("what the events are built as", () => {
  it("a contact saved carries its names; a contact removed carries only the number", () => {
    const add = simContactValue({ phone: KEY, name: "  Lucía Pérez ", now: 1_800_000_000_000 }).state_sync[0];
    expect(add).toEqual({ type: "contact", action: "add", contact: { phone_number: "34600111222", full_name: "Lucía Pérez", first_name: "Lucía" }, metadata: { timestamp: "1800000000" } });
    expect(simContactValue({ phone: KEY, remove: true, now: 1_800_000_000_000 }).state_sync[0].contact).toEqual({ phone_number: "34600111222" });
  });

  it("an edit names its original and its new text; a delete names only its original", () => {
    expect(simChangeMessage({ kind: "edit", phone: KEY, originalId: "wamid.B", text: "a las 10", now: 2000, id: "e1" }))
      .toEqual({ from: "34600111222", id: "e1", timestamp: "2", type: "edit", edit: { original_message_id: "wamid.B", message: { type: "text", text: { body: "a las 10" } } } });
    expect(simChangeMessage({ kind: "revoke", phone: KEY, originalId: "wamid.B", now: 2000, id: "d1" }))
      .toEqual({ from: "34600111222", id: "d1", timestamp: "2", type: "revoke", revoke: { original_message_id: "wamid.B" } });
  });

  it("lastCustomerMessage: the customer's newest, never one deleted already, never the restaurant's", () => {
    const e = (key, msg) => ({ key, msg });
    const list = [e("a", { direction: "in", ts: 10 }), e("b", { direction: "out", ts: 30 }), e("c", { direction: "in", ts: 20 }), e("d", { direction: "in", ts: 25, revokedAt: 26 })];
    expect(lastCustomerMessage(list).key).toBe("c");
    expect(lastCustomerMessage([e("x", { direction: "in", ts: 5 }), e("y", { direction: "in", ts: 5 })]).key).toBe("y");
    expect(lastCustomerMessage([e("b", { direction: "out", ts: 1 })])).toBe(null);
    expect(lastCustomerMessage(null)).toBe(null);
  });

  it("the history's ids are fixed and its times count back from now, so the recent chat is always this week's", () => {
    const now = 1_800_000_000_000;
    const [recent, old] = simHistoryValue(now).history[0].threads;
    expect([recent.id, old.id]).toEqual([SIM_HISTORY_RECENT, SIM_HISTORY_OLD]);
    expect(simHistoryValue(now + 5).history[0].threads[0].messages.map((m) => m.id)).toEqual(recent.messages.map((m) => m.id));
    const newest = (t) => Math.max(...t.messages.map((m) => Number(m.timestamp) * 1000));
    expect(now - newest(recent)).toBeLessThan(7 * 86400000);
    expect(now - newest(old)).toBeGreaterThan(7 * 86400000);
  });

  it("a simulated connection is marked, and takes the deployment's own number when it has one", () => {
    expect(simLinkPatch({ now: 5, by: "ana@example.com" })).toEqual({ status: "connected", wabaId: SIM_WABA_ID, phoneNumberId: SIM_PHONE_NUMBER_ID, connectedAt: 5, connectedBy: "ana@example.com", sim: true, disconnect: null });
    expect(simLinkPatch({ now: 5, phoneNumberId: "555" }).phoneNumberId).toBe("555");
  });
});

describe("the two planners phase 9 lifted out of the server", () => {
  const content = (m) => ({ text: m.text ? m.text.body : "?", media: null, snippet: m.text ? m.text.body : "?" });
  const thread = { id: "34600111222", messages: [
    { from: "34600111222", id: "w1", timestamp: "100", type: "text", text: { body: "hola" } },
    { from: "34600000000", id: "w2", timestamp: "200", type: "text", text: { body: "¡hola!" }, history_context: { status: "READ" } },
    { from: "34600111222", id: "w3", timestamp: "150", type: "edit" },
    { from: "34600111222", timestamp: "300", type: "text", text: { body: "no id" } },
  ] };
  it("threadPlan: direction from the thread's customer, no edits, no message without an id, nothing stored twice", () => {
    const plan = threadPlan(thread, [], content, (id) => id, 1_000_000);
    expect(plan.phoneKey).toBe(KEY);
    expect(plan.records.map((r) => [r.id, r.direction, r.status, r.source || null])).toEqual([["w1", "in", "delivered", null], ["w2", "out", "read", "phone"]]);
    expect([plan.oldest, plan.newest, plan.line]).toEqual([100000, 200000, "¡hola!"]);
    expect(threadPlan(thread, ["w1"], content, (id) => id, 1_000_000).records.map((r) => r.id)).toEqual(["w2"]);
    expect(threadPlan({ id: "+", messages: [] }, [], content, (id) => id, 1)).toBe(null);
  });
  it("changeLine: a photo keeps its line with the new caption, unless it was deleted", () => {
    const photo = { media: { kind: "image" } };
    expect(changeLine(photo, { text: "x", editedAt: 1 }, " La terraza ")).toBe("Photo · La terraza");
    expect(changeLine(photo, { text: WA_REVOKED_IN, revokedAt: 1 }, null)).toBe(WA_REVOKED_IN);
    expect(changeLine({ text: "a" }, { text: "b", editedAt: 1 }, "b")).toBe("b");
  });
});

// ── simulateCoexist, client mode: the hook's savers, recorded ────────────────
function fakeCtx(extra) {
  const log = [];
  const rec = (name) => vi.fn((...a) => { log.push([name, ...a]); });
  return Object.assign({
    log,
    conversations: [], messagesMap: {}, contacts: {}, waLink: null,
    upsertConversation: rec("upsert"), patchConversation: rec("patch"), appendMessage: rec("append"), patchMessage: rec("patchMessage"),
    simSetContacts: vi.fn(async (p) => { log.push(["contacts", p]); return true; }),
  }, extra || {});
}

describe("simulateCoexist in client mode", () => {
  beforeEach(() => { state.backend = false; postSimEvent.mockReset(); });

  it("refuses what only the server can store, and a real connection's events, writing nothing", async () => {
    const ctx = fakeCtx();
    for (const ev of ["history-media", "connect", "disconnect", "reconnect", "forget"]) {
      await expect(simulateCoexist(ev, {}, ctx)).rejects.toThrow(REFUSE_CLIENT);
    }
    const real = fakeCtx({ waLink: REAL });
    await expect(simulateCoexist("contact", { phone: KEY, name: "Ana" }, real)).rejects.toThrow(REFUSE_REAL);
    await expect(simulateCoexist("history", {}, real)).rejects.toThrow(REFUSE_REAL);
    expect(ctx.log.concat(real.log)).toEqual([]);
  });

  it("contact: one per-key write of what the server would store; a remove is a null", async () => {
    const ctx = fakeCtx();
    expect(await simulateCoexist("contact", { phone: "+34 600 111 222", name: "Lucía Pérez" }, ctx)).toBe("Contact saved on the phone as Lucía Pérez.");
    expect(ctx.log).toEqual([["contacts", { [KEY]: { name: "Lucía Pérez", first: "Lucía", at: expect.any(Number) } }]]);
    expect(await simulateCoexist("contact", { phone: KEY, remove: true }, ctx)).toBe("Contact removed on the phone.");
    expect(ctx.log[1]).toEqual(["contacts", { [KEY]: null }]);
  });

  // v18.12.0 /code-review: client-mode history and echo created chats with no
  // `sim` mark, so a reply to one from a backend-mode device reached Meta.
  it("history and an echo to a new phone mark what they create `sim`; an existing chat is left unmarked", async () => {
    const ctx = fakeCtx();
    await simulateCoexist("history", {}, ctx);
    const created = ctx.log.filter((e) => e[0] === "upsert").map((e) => e[2]);
    expect(created.length).toBe(2);
    expect(created.every((c) => c.sim === true)).toBe(true);
    const echo = fakeCtx();
    await simulateCoexist("echo", { phone: KEY, text: "hola" }, echo);
    expect(echo.log[0][2].sim).toBe(true);
    const real = fakeCtx({ conversations: [{ phoneKey: KEY, lastMessageAt: 1 }] });
    await simulateCoexist("echo", { phone: KEY, text: "hola" }, real);
    expect("sim" in real.log[0][2]).toBe(false);
  });

  it("contact: a refused write is the panel's failure", async () => {
    const ctx = fakeCtx({ simSetContacts: vi.fn(async () => { throw new Error("PERMISSION_DENIED: Permission denied"); }) });
    await expect(simulateCoexist("contact", { phone: KEY, name: "Ana" }, ctx)).rejects.toThrow("PERMISSION_DENIED");
  });

  it("echo: a phone reply, read and back in the Inbox, unless the conversation is muted", async () => {
    const ctx = fakeCtx({ conversations: [{ phoneKey: KEY, unread: true, archived: true, archivedAt: 5, lastMessageAt: 1 }] });
    await expect(simulateCoexist("echo", { phone: KEY, text: " " }, ctx)).rejects.toThrow("Type the reply first.");
    expect(await simulateCoexist("echo", { phone: KEY, text: " Os esperamos " }, ctx)).toBe("Reply sent from the phone.");
    const [[, k1, patch], [, k2, msg]] = ctx.log;
    expect([k1, k2]).toEqual([KEY, KEY]);
    expect(patch).toMatchObject({ unread: false, autoAckSent: true, archived: false, archivedAt: null, lastMessageSnippet: "Os esperamos" });
    expect(msg).toMatchObject({ direction: "out", source: "phone", text: "Os esperamos", status: "sent" });
    expect(msg.id).toBe(msg.providerMsgId);
    const muted = fakeCtx({ conversations: [{ phoneKey: KEY, muted: true, archived: true, lastMessageAt: 1 }] });
    await simulateCoexist("echo", { phone: KEY, text: "hola" }, muted);
    expect("archived" in muted.log[0][2]).toBe(false);
  });

  it("edit and revoke: the open thread's newest customer message, and its line when it is the last", async () => {
    const thread = [
      { id: "in1", direction: "in", text: "mesa para 2", ts: 10 },
      { id: "in2", direction: "in", text: "a las 9", ts: 20 },
    ];
    const ctx = fakeCtx({ conversations: [{ phoneKey: KEY, lastMessageAt: 20 }], messagesMap: { [KEY]: thread } });
    expect(await simulateCoexist("edit", { phone: KEY, text: "a las 10" }, ctx)).toBe("The customer edited their last message.");
    expect(ctx.log[0]).toEqual(["patchMessage", KEY, "in2", { text: "a las 10", editedAt: expect.any(Number) }]);
    expect(ctx.log[1]).toEqual(["patch", KEY, { lastMessageSnippet: "a las 10" }]);
    expect(await simulateCoexist("revoke", { phone: KEY }, ctx)).toBe("The customer deleted their last message.");
    expect(ctx.log[2]).toEqual(["patchMessage", KEY, "in2", { text: WA_REVOKED_IN, media: null, revokedAt: expect.any(Number) }]);
    const none = fakeCtx({ messagesMap: { [KEY]: [{ id: "o", direction: "out", ts: 1 }] } });
    await expect(simulateCoexist("revoke", { phone: KEY }, none)).rejects.toThrow("That conversation has no message from the customer to delete.");
  });

  it("history: two new chats, the old one archived; chats already here are left alone", async () => {
    const ctx = fakeCtx();
    expect(await simulateCoexist("history", {}, ctx)).toBe("Chat history imported: 6\u00a0messages.");
    const ups = ctx.log.filter((l) => l[0] === "upsert");
    expect(ups.map((u) => [u[1], u[2].archived, u[2].unread, u[2].autoAckSent])).toEqual([["+" + SIM_HISTORY_RECENT, false, false, true], ["+" + SIM_HISTORY_OLD, true, false, true]]);
    expect(ctx.log.filter((l) => l[0] === "append").map((l) => l[2].imported)).toEqual(Array(6).fill(true));
    const again = fakeCtx({ conversations: ups.map((u) => u[2]) });
    expect(await simulateCoexist("history", {}, again)).toBe("Both chats are here already. Clear conversations to import them again.");
    expect(again.log).toEqual([]);
  });
});

describe("simulateCoexist in backend mode", () => {
  beforeEach(() => { state.backend = true; postSimEvent.mockReset(); });
  it("posts the event and its params, writes nothing itself, and says what the server answered", async () => {
    const ctx = fakeCtx({ waLink: REAL });
    postSimEvent.mockResolvedValueOnce({ ok: true, event: "forget", results: {}, removed: false });
    expect(await simulateCoexist("forget", {}, ctx)).toBe("Nothing to forget: no simulated connection is recorded.");
    postSimEvent.mockResolvedValueOnce({ ok: true, event: "history", results: { history: 6 } });
    expect(await simulateCoexist("history", { phone: undefined }, ctx)).toBe("Chat history imported: 6\u00a0messages.");
    expect(postSimEvent.mock.calls.map((c) => c[0])).toEqual(["forget", "history"]);
    postSimEvent.mockRejectedValueOnce(new Error(REFUSE_REAL));
    await expect(simulateCoexist("connect", {}, ctx)).rejects.toThrow(REFUSE_REAL);
    expect(ctx.log).toEqual([]);
  });
});
