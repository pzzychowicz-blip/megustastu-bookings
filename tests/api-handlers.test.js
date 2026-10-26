// tests/api-handlers.test.js
//
// v18.4.5 (ROADMAP #4) — the WhatsApp backend's handlers, run.
//
// `api/wa-send.js`, `api/wa-recheck.js`, `api/wa-config.js`,
// `api/_lib/inbound-core.js` and `api/_lib/meta.js` had no test that executed
// them: the existing WhatsApp tests read their source or call the pure helpers
// they import. These call the handlers with a request and a response object and
// read what was answered and what was written.
//
// What is real and what is not. `firebase-admin` is replaced by an in-memory
// tree (three modules, below), so `api/_lib/rtdb.js` itself runs: its paths,
// its `sanitizeKey`, its staff check. The only other stand-in is
// `parseThread` (the recheck's LLM read of a thread); `parseMessage` runs in
// its mock mode, and `sendText` in its mock mode except where the live half is
// the subject, with `fetch` stubbed.
//
// v18.8.0 adds the four handlers it did not run: `wa-inbound` (the webhook,
// read from a raw byte stream so its HMAC sees what Meta signed) and the three
// `wa-sim-*` endpoints (the 404 kill switch, then the shared method and auth
// gate, then their own 400s).
//
// And `wa-media` both ways: viewing a stored file (phase 4) and sending a photo
// or a PDF (phase 5), the second also against checklist A4-5 — one Graph
// `/messages` call per send, the caption inside it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { Readable, Writable } from "node:stream";
import { readFileSync, readdirSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const fake = vi.hoisted(() => {
  // `failWrite(op, path)` → true makes that write throw (a database error the
  // code under test has to survive), before anything is changed.
  const state = { tree: {}, writes: [], queries: [], failWrite: null, noIndex: false };
  const parts = (p) => p.split("/").filter(Boolean);
  const read = (p) => parts(p).reduce((n, k) => (n != null && typeof n === "object" ? n[k] : undefined), state.tree);
  const write = (p, v) => {
    const ks = parts(p);
    let n = state.tree;
    ks.slice(0, -1).forEach((k) => { if (n[k] == null || typeof n[k] !== "object") n[k] = {}; n = n[k]; });
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete n[last]; else n[last] = v;
  };
  const snapOf = (v) => ({ exists: () => v !== undefined && v !== null, val: () => (v === undefined ? null : v) });
  const db = {
    ref: (path = "") => ({
      get: async () => snapOf(read(path)),
      // v18.8.0 /code-review (api/wa-prune.js): `orderByChild(k).endAt(v)`,
      // as RTDB orders it for this use: a child with no number at `k` (null)
      // sorts first and is kept, a string sorts after every number and is not.
      // Each query is recorded, so a test can see what the prune asked for.
      orderByChild: (k) => ({
        endAt: (end) => ({
          get: async () => {
            state.queries.push({ path, orderByChild: k, endAt: end });
            // What the server answers a get() on a query it has no index for.
            if (state.noIndex) throw new Error('Index not defined, add ".indexOn": "' + k + '", for path "/' + path + '", to the rules');
            const node = read(path);
            if (node == null || typeof node !== "object") return snapOf(undefined);
            const out = {};
            Object.keys(node).forEach((id) => {
              const v = node[id] != null && typeof node[id] === "object" ? node[id][k] : undefined;
              if (v === undefined || v === null || (typeof v === "number" && v <= end)) out[id] = node[id];
            });
            return snapOf(Object.keys(out).length ? out : undefined);
          },
        }),
      }),
      set: async (v) => {
        if (state.failWrite && state.failWrite("set", path)) throw new Error("database unavailable");
        state.writes.push({ op: "set", path, value: v }); write(path, v);
      },
      update: async (patch) => {
        if (state.failWrite && state.failWrite("update", path)) throw new Error("database unavailable");
        state.writes.push({ op: "update", path, value: patch });
        Object.keys(patch).forEach((k) => write(path + "/" + k, patch[k]));
      },
      // v18.8.0 phase 7 (api/wa-prune.js). The real SDK may first call `fn`
      // with null and retry with the stored value; this calls it once, with
      // the stored value, which is the call that decides.
      transaction: async (fn) => {
        if (state.failWrite && state.failWrite("transaction", path)) throw new Error("database unavailable");
        const cur = read(path);
        const next = fn(cur === undefined ? null : cur);
        if (next === undefined) return { committed: false, snapshot: { exists: () => cur != null, val: () => cur } };
        state.writes.push({ op: "transaction", path, value: next });
        write(path, next);
        return { committed: true, snapshot: { exists: () => next != null, val: () => next } };
      },
    }),
  };
  const TOKENS = {
    staff: { uid: "u1", email: "ana@example.com", email_verified: true },
    stranger: { uid: "u2", email: "eve@example.com", email_verified: true },
    unverified: { uid: "u3", email: "ana@example.com", email_verified: false },
  };
  return { state, db, TOKENS, read };
});

vi.mock("firebase-admin/app", () => ({ initializeApp: () => ({}), getApps: () => [], cert: (x) => x }));
vi.mock("firebase-admin/database", () => ({ getDatabase: () => fake.db }));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (t) => { if (fake.TOKENS[t]) return fake.TOKENS[t]; throw new Error("bad token"); },
  }),
}));
vi.mock("../api/_lib/gemini.js", async (orig) => Object.assign({}, await orig(), { parseThread: vi.fn() }));

import sendHandler from "../api/wa-send.js";
import recheckHandler from "../api/wa-recheck.js";
import configHandler from "../api/wa-config.js";
import inboundHandler, { inboundContent } from "../api/wa-inbound.js";
import simInboundHandler from "../api/wa-sim-inbound.js";
import simSuggestHandler from "../api/wa-sim-suggest.js";
import simGenerateHandler from "../api/wa-sim-generate.js";
import mediaHandler, { MEDIA_VIEW_MAX, servedType, sniffType, isStoredMsgKey } from "../api/wa-media.js";
import pruneHandler, { conversationExpired, mayHoldOld, staleMessageIds } from "../api/wa-prune.js";
import onboardHandler from "../api/wa-onboard.js";
import usageHandler from "../api/wa-usage.js";
import { removeConversationIf, sanitizeKey } from "../api/_lib/rtdb.js";
import { processInbound, applyParse, injectSimInbound } from "../api/_lib/inbound-core.js";
import { numberIsOurs, makeNumberGuard, freshResults, measuredAfter, beganAfter, chunkKeys } from "../api/_lib/coexist-core.js";
import { readJsonBody, bearerToken } from "../api/_lib/request.js";
import { contactPlan, contactPatch, WA_CONTACT_NAME_MAX, echoConvPatch, editedText, editPatch, revokePatch, WA_REVOKED_IN, WA_REVOKED_OUT, historyConvPatch, historyProgress, historyRequested, historyStatus, WA_IMPORT_ARCHIVE_MS, disconnectSentence } from "../src/lib/wa-coexist.js";
import { verifySignature, sendText } from "../api/_lib/meta.js";
import { parseThread } from "../api/_lib/gemini.js";
import { WA_WINDOW_MS, WA_MAX_TEXT_LEN, WA_RECHECK_HISTORY, AUTO_ACK_TEXT, WA_SEND_MAX_BYTES, WA_CAPTION_MAX, WA_UNSUPPORTED_LINE, replyUnarchives } from "../src/lib/whatsapp.js";
import { simMediaMessage } from "../src/lib/wa-mock-media.js";
import { DEFAULT_TAG_LIST } from "../src/lib/tags.js";
import { simHistoryValue, simEchoValue, simContent, SIM_HISTORY_RECENT, SIM_HISTORY_OLD, SIM_HISTORY_PHOTO_ID, SIM_WABA_ID, SIM_PHONE_NUMBER_ID } from "../src/lib/wa-sim-coexist.js";

// A request as Vercel hands it over (the body already parsed) and a response
// that records the one answer a handler gives.
function call(handler, { method = "POST", token, body } = {}) {
  const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const headers = token ? { authorization: "Bearer " + token } : {};
  return handler({ method, headers, body: body === undefined ? {} : body }, res).then(() => res);
}
const convAt = (key) => fake.read("conversations/" + key);
const msgsAt = (key) => Object.values(fake.read("messages/" + key) || {}).sort((a, b) => a.ts - b.ts);
const KEY = "+34600111222";
const openConv = (extra) => Object.assign({ phoneKey: KEY, phone: KEY, windowExpiresAt: Date.now() + 60000 }, extra || {});

beforeEach(() => {
  fake.state.tree = {};
  fake.state.writes = [];
  fake.state.queries = [];
  fake.state.failWrite = null;
  fake.state.noIndex = false;
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", '{"project_id":"test"}');
  ["WA_STAFF_EMAILS", "WA_SEND_MODE", "WA_LLM_MODE", "WA_DB_URL", "WA_ALLOW_UNSIGNED", "WA_SIM_ENABLED",
    "META_APP_SECRET", "META_WA_TOKEN", "META_PHONE_NUMBER_ID", "META_VERIFY_TOKEN", "GEMINI_API_KEY", "GEMINI_MODEL", "TENANT_WA_CONTEXT",
    "CRON_SECRET", "META_APP_ID", "META_ES_CONFIG_ID", "META_WABA_ID",
  ].forEach((k) => vi.stubEnv(k, ""));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  parseThread.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ── The gate the three token endpoints share ────────────────────────────────
describe.each([
  ["wa-send", sendHandler, "POST", "GET"],
  ["wa-recheck", recheckHandler, "POST", "GET"],
  ["wa-config", configHandler, "GET", "POST"],
  ["wa-media", mediaHandler, "GET", "PUT"],
  ["wa-media (send)", mediaHandler, "POST", "PUT"],
  ["wa-onboard", onboardHandler, "GET", "PUT"],
  ["wa-onboard (connect)", onboardHandler, "POST", "PUT"],
  ["wa-usage", usageHandler, "GET", "POST"],
])("%s — method and staff auth", (name, handler, method, wrong) => {
  it("answers 405 to the wrong method, before anything else", async () => {
    const res = await call(handler, { method: wrong, token: "staff" });
    expect(res.statusCode).toBe(405);
  });
  it("answers 401 with no token and with a token that does not verify", async () => {
    expect((await call(handler, { method })).statusCode).toBe(401);
    const bad = await call(handler, { method, token: "nonsense" });
    expect([bad.statusCode, bad.body.error]).toEqual([401, "invalid token"]);
  });
  it("answers 403 to a verified account that is not on the allow-list, and to an unverified one that is", async () => {
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    expect((await call(handler, { method, token: "stranger" })).statusCode).toBe(403);
    const unverified = await call(handler, { method, token: "unverified" });
    expect(unverified.statusCode).toBe(403);
    expect(unverified.body.error).toMatch(/not verified/);
  });
  it("answers 503 when the server is misconfigured: live sends with no allow-list, or no service account", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    expect((await call(handler, { method, token: "staff" })).statusCode).toBe(503);
  });
  it("writes nothing on any refusal", async () => {
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    await call(handler, { method: wrong, token: "staff", body: { phoneKey: KEY, text: "hi" } });
    await call(handler, { method, body: { phoneKey: KEY, text: "hi" } });
    await call(handler, { method, token: "stranger", body: { phoneKey: KEY, text: "hi" } });
    expect(fake.state.writes).toEqual([]);
  });
});

// ── api/wa-send.js ───────────────────────────────────────────────────────────
describe("wa-send", () => {
  const send = (body, token = "staff") => call(sendHandler, { token, body });

  it("400 without a phoneKey, without text, and with text that is only spaces", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    expect((await send({ text: "hi" })).statusCode).toBe(400);
    expect((await send({ phoneKey: KEY })).statusCode).toBe(400);
    expect((await send({ phoneKey: KEY, text: "   " })).statusCode).toBe(400);
    expect((await send({ phoneKey: KEY, text: 42 })).statusCode).toBe(400);
    expect(fake.state.writes).toEqual([]);
  });

  it("404 for a conversation that does not exist: a reply never opens a thread", async () => {
    const res = await send({ phoneKey: KEY, text: "hi" });
    expect(res.statusCode).toBe(404);
    expect(fake.state.writes).toEqual([]);
  });

  it("410 once the 24h window has passed, or was never set", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ windowExpiresAt: Date.now() - 1 }), "+34600999888": { phoneKey: "+34600999888" } } };
    expect((await send({ phoneKey: KEY, text: "hi" })).statusCode).toBe(410);
    expect((await send({ phoneKey: "+34600999888", text: "hi" })).statusCode).toBe(410);
    expect(fake.state.writes).toEqual([]);
  });

  it("200: stores the message with its author and updates the conversation, without moving the window", async () => {
    const conv = openConv();
    fake.state.tree = { conversations: { [KEY]: conv } };
    const res = await send({ phoneKey: KEY, text: "  Mesa confirmada  " });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "delivered" });
    const [m] = msgsAt(KEY);
    expect(m).toMatchObject({ id: res.body.msgId, direction: "out", text: "Mesa confirmada", status: "delivered",
      isAutoAck: false, channel: "whatsapp", authorEmail: "ana@example.com", providerMsgId: res.body.wamid });
    expect(convAt(KEY)).toMatchObject({ lastMessageSnippet: "Mesa confirmada", lastMessageAt: m.ts, windowExpiresAt: conv.windowExpiresAt });
  });

  it("a reply to an archived conversation un-archives it; one to an open conversation does not write the field", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ archived: true, archivedAt: 5 }) } };
    await send({ phoneKey: KEY, text: "hi" });
    expect(convAt(KEY).archived).toBe(false);
    expect("archivedAt" in convAt(KEY)).toBe(false);

    fake.state.tree = { conversations: { [KEY]: openConv() } };
    fake.state.writes = [];
    await send({ phoneKey: KEY, text: "hi" });
    const patch = fake.state.writes.find((w) => w.op === "update").value;
    expect(Object.keys(patch).sort()).toEqual(["lastMessageAt", "lastMessageSnippet"]);
  });

  // v18.9.0 /code-review: only the phone's echo knew about the mute, so a
  // reply typed in MGT took a "Not a customer" thread back to Inbox, still
  // muted, where nothing offers "Customer again".
  it("a reply to a muted (\"Not a customer\") archived conversation leaves it archived", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ archived: true, archivedAt: 5, muted: true }) } };
    expect((await send({ phoneKey: KEY, text: "hi" })).statusCode).toBe(200);
    expect(convAt(KEY)).toMatchObject({ archived: true, archivedAt: 5, muted: true, lastMessageSnippet: "hi" });
  });

  it("caps the text before the send, so what is sent and what is stored are one string", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    vi.stubEnv("META_WA_TOKEN", "t");
    vi.stubEnv("META_PHONE_NUMBER_ID", "123");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: "wamid.REAL" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    const res = await send({ phoneKey: KEY, text: "x".repeat(WA_MAX_TEXT_LEN + 500) });
    expect(res.statusCode).toBe(200);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body).text.body;
    expect(sentBody.length).toBe(WA_MAX_TEXT_LEN);
    expect(msgsAt(KEY)[0].text).toBe(sentBody);
    expect(msgsAt(KEY)[0]).toMatchObject({ status: "sent", providerMsgId: "wamid.REAL" });
  });

  it("502 when the provider refuses, and then nothing is stored: a failed send is never shown as sent", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    vi.stubEnv("META_WA_TOKEN", "t");
    vi.stubEnv("META_PHONE_NUMBER_ID", "123");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Recipient not allowed" } }) })));
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    const res = await send({ phoneKey: KEY, text: "hi" });
    expect([res.statusCode, res.body.error]).toEqual([502, "send failed: Recipient not allowed"]);
    expect(fake.state.writes).toEqual([]);
  });

  it("a phoneKey holding a path separator reads and writes ONE child, never a sub-path", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ draftData: { windowExpiresAt: Date.now() + 60000 } }) } };
    const res = await send({ phoneKey: KEY + "/draftData", text: "hi" });
    expect(res.statusCode).toBe(404);
    expect(fake.state.writes).toEqual([]);
  });
});

// ── api/wa-recheck.js ────────────────────────────────────────────────────────
describe("wa-recheck", () => {
  const recheck = (body) => call(recheckHandler, { token: "staff", body });
  const thread = (list) => Object.fromEntries(list.map((m, i) => ["m" + i, Object.assign({ id: "m" + i, ts: i + 1 }, m)]));

  it("400 for a key that is not a normalised phone, before any read", async () => {
    for (const phoneKey of ["", "+", "+34 600 111 222", "+34600111222/draftData", "abc", 5, null]) {
      const res = await recheck({ phoneKey });
      expect([phoneKey, res.statusCode]).toEqual([phoneKey, 400]);
    }
    expect(parseThread).not.toHaveBeenCalled();
  });

  it("404 for an unknown conversation and 400 for one with no messages", async () => {
    expect((await recheck({ phoneKey: KEY })).statusCode).toBe(404);
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    const res = await recheck({ phoneKey: KEY });
    expect([res.statusCode, res.body.error]).toEqual([400, "no messages to check"]);
    expect(parseThread).not.toHaveBeenCalled();
  });

  it("hands the model the thread without the auto-ack, the pending draft, the hours and the occasion tags", async () => {
    const hours = { days: { 1: { open: 13, close: 22 } } };
    fake.state.tree = {
      settings: { operatingHours: hours, tags: { v: 1, occasion: [{ id: "o-grad", label: "Graduation" }] } },
      conversations: { [KEY]: openConv({ draftStatus: "parsed", draftData: { size: 2 } }) },
      messages: { [KEY]: thread([
        { direction: "in", text: "Hola" },
        { direction: "out", text: AUTO_ACK_TEXT.es, isAutoAck: true },
        { direction: "out", text: "Buenas" },
        { direction: "in", text: "Mesa para 4" },
      ]) },
    };
    parseThread.mockResolvedValue({ intent: "question", language: "es" });
    await recheck({ phoneKey: KEY });
    expect(parseThread).toHaveBeenCalledWith(
      [{ direction: "in", text: "Hola" }, { direction: "out", text: "Buenas" }, { direction: "in", text: "Mesa para 4" }],
      { hours, existingDraft: { size: 2 }, occasions: [{ id: "o-grad", label: "Graduation" }] }
    );
  });

  // v18.11.0: no stored tag list is the seed list, as the booking form reads it.
  it("hands the model the seed occasions when no tag list is stored", async () => {
    fake.state.tree = {
      conversations: { [KEY]: openConv({}) },
      messages: { [KEY]: thread([{ direction: "in", text: "Mesa para 4, es un cumpleaños" }]) },
    };
    parseThread.mockResolvedValue({ intent: "question", language: "es" });
    await recheck({ phoneKey: KEY });
    expect(parseThread.mock.calls.at(-1)[1].occasions).toEqual(DEFAULT_TAG_LIST.occasion);
  });

  it("an accepted or dismissed draft is not context, and only the last messages are read", async () => {
    const many = Array.from({ length: WA_RECHECK_HISTORY + 5 }, (_, i) => ({ direction: "in", text: "m" + i }));
    fake.state.tree = {
      conversations: { [KEY]: openConv({ draftStatus: "accepted", draftData: { size: 2 } }) },
      messages: { [KEY]: thread(many) },
    };
    parseThread.mockResolvedValue(null);
    await recheck({ phoneKey: KEY });
    const [history, opts] = parseThread.mock.calls[0];
    expect(history.length).toBe(WA_RECHECK_HISTORY);
    expect(history[history.length - 1].text).toBe("m" + (WA_RECHECK_HISTORY + 4));
    expect(opts.existingDraft).toBe(null);
  });

  it("a draft intent writes the draft, stamped now, and answers updated: true", async () => {
    fake.state.tree = {
      conversations: { [KEY]: openConv({ parsing: true, parsingAt: 1 }) },
      messages: { [KEY]: thread([{ direction: "in", text: "Mesa para 4 mañana a las 21" }]) },
    };
    parseThread.mockResolvedValue({ intent: "new_booking", language: "en", size: 4, date: "2026-10-08", time: "21:00", confidence: "high" });
    const before = Date.now();
    const res = await recheck({ phoneKey: KEY });
    expect([res.statusCode, res.body]).toEqual([200, { intent: "new_booking", updated: true }]);
    const c = convAt(KEY);
    expect(c).toMatchObject({ draftStatus: "parsed", language: "en", draftData: { intent: "new_booking", size: 4, date: "2026-10-08", time: "21:00", confidence: "high" } });
    expect(c.draftUpdatedAt).toBeGreaterThanOrEqual(before);
    expect("parsing" in c).toBe(false);
    expect(msgsAt(KEY).length).toBe(1); // a re-check never appends a message
  });

  it("a question clears the indicator, leaves the draft alone and answers updated: false", async () => {
    fake.state.tree = {
      conversations: { [KEY]: openConv({ parsing: true, draftStatus: "parsed", draftData: { size: 2 } }) },
      messages: { [KEY]: thread([{ direction: "in", text: "¿Tenéis terraza?" }]) },
    };
    parseThread.mockResolvedValue({ intent: "question", language: "es" });
    const res = await recheck({ phoneKey: KEY });
    expect(res.body).toEqual({ intent: "question", updated: false });
    expect(convAt(KEY)).toMatchObject({ draftStatus: "parsed", draftData: { size: 2 } });
    expect("parsing" in convAt(KEY)).toBe(false);
  });

  it("a model timeout is named, and a model error keeps its own status", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv() }, messages: { [KEY]: thread([{ direction: "in", text: "hola" }]) } };
    parseThread.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const timeout = await recheck({ phoneKey: KEY });
    expect([timeout.statusCode, timeout.body.error]).toEqual([500, "Gemini timeout"]);
    parseThread.mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    const quota = await recheck({ phoneKey: KEY });
    expect([quota.statusCode, quota.body.error]).toEqual([429, "quota"]);
  });
});

// ── api/wa-config.js ─────────────────────────────────────────────────────────
describe("wa-config", () => {
  const config = () => call(configHandler, { method: "GET", token: "staff" });

  it("reports each key as set or not, and never a value", async () => {
    vi.stubEnv("GEMINI_API_KEY", "secret-key-value");
    vi.stubEnv("META_VERIFY_TOKEN", "   "); // present: a blank-looking value is still a value
    const res = await config();
    expect(res.statusCode).toBe(200);
    expect(res.body.set).toMatchObject({ GEMINI_API_KEY: true, FIREBASE_SERVICE_ACCOUNT: true, META_WA_TOKEN: false, META_VERIFY_TOKEN: true, WA_STAFF_EMAILS: false, CRON_SECRET: false });
    expect(Object.values(res.body.set).every((v) => typeof v === "boolean")).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("secret-key-value");
  });

  it("reports the EFFECTIVE modes: only exactly \"live\" is live", async () => {
    expect((await config()).body.modes).toEqual({ llm: "mock", send: "mock" });
    vi.stubEnv("WA_LLM_MODE", "LIVE");
    vi.stubEnv("WA_SEND_MODE", "true");
    expect((await config()).body.modes).toEqual({ llm: "mock", send: "mock" });
    vi.stubEnv("WA_LLM_MODE", "live");
    expect((await config()).body.modes).toEqual({ llm: "live", send: "mock" });
  });

  // v18.9.2: the Gemini model the backend calls: the default when GEMINI_MODEL
  // is unset, the variable when it is set, and the same id the parse uses.
  it("reports the EFFECTIVE Gemini model, the default when GEMINI_MODEL is unset", async () => {
    expect((await config()).body.llmModel).toBe("gemini-3.5-flash-lite");
    vi.stubEnv("GEMINI_MODEL", "gemini-9-test");
    expect((await config()).body.llmModel).toBe("gemini-9-test");
    vi.stubEnv("GEMINI_MODEL", "");
    expect((await config()).body.llmModel).toBe("gemini-3.5-flash-lite");
    // /code-review: a pasted newline would 404 every live parse while looking right.
    vi.stubEnv("GEMINI_MODEL", " gemini-9-test\n");
    expect((await config()).body.llmModel).toBe("gemini-9-test");
    vi.stubEnv("GEMINI_MODEL", " \n");
    expect((await config()).body.llmModel).toBe("gemini-3.5-flash-lite");
  });
  // /code-review: live mode with no key runs the mock, so no model is called.
  it("says whether a parse really calls Gemini: live AND a key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("WA_LLM_MODE", "live");
    expect((await config()).body.llmCalls).toBe(false);
    vi.stubEnv("GEMINI_API_KEY", "k");
    expect((await config()).body.llmCalls).toBe(true);
    vi.stubEnv("WA_LLM_MODE", "mock");
    expect((await config()).body.llmCalls).toBe(false);
  });

  // v18.9.0: the /wa-connect page's two ids, and whether the environment's
  // number is the one Embedded Signup connected — a boolean, never either id.
  it("reports the Connect page's two keys", async () => {
    vi.stubEnv("META_APP_ID", "111222333");
    const res = await config();
    expect(res.body.set).toMatchObject({ META_APP_ID: true, META_ES_CONFIG_ID: false });
    expect(JSON.stringify(res.body)).not.toContain("111222333");
  });
  it("says whether META_PHONE_NUMBER_ID is the connected number, null when there is nothing to compare", async () => {
    expect((await config()).body.phoneNumberIdMatches).toBe(null);
    vi.stubEnv("META_PHONE_NUMBER_ID", "555000111");
    expect((await config()).body.phoneNumberIdMatches).toBe(null);
    fake.state.tree = { waLink: { phoneNumberId: "555000111" } };
    expect((await config()).body.phoneNumberIdMatches).toBe(true);
    fake.state.tree = { waLink: { phoneNumberId: "999888777" } };
    const res = await config();
    expect(res.body.phoneNumberIdMatches).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/555000111|999888777/);
  });
});

// ── api/wa-usage.js (v18.10.0) ──────────────────────────────────────────────
describe("wa-usage", () => {
  const WABA = "1003233032795372";
  const get = (token = "staff") => call(usageHandler, { method: "GET", token });
  const MANAGER = { roles: { u1: { role: "manager" } } };
  // Meta's Pricing Analytics, as far as the counter meets it: one GET, which
  // records what was asked and answers this month and last.
  function meta({ status = 200, answer } = {}) {
    const f = vi.fn(async (url, init = {}) => {
      f.asked.push({ url: String(url), method: init.method || "GET", auth: (init.headers || {}).Authorization || null });
      if (status !== 200) return { ok: false, status, json: async () => ({ error: { message: "Unsupported get request" } }) };
      const oct = Date.parse("2026-10-02T00:00:00Z") / 1000;
      const sep = Date.parse("2026-09-15T00:00:00Z") / 1000;
      return { ok: true, status: 200, json: async () => answer || {
        id: WABA, currency: "EUR",
        pricing_analytics: { data: [{ data_points: [
          { start: oct, end: oct + 86400, pricing_category: "SERVICE", pricing_type: "FREE_CUSTOMER_SERVICE", volume: 12, cost: 0 },
          { start: oct, end: oct + 86400, pricing_category: "UTILITY", pricing_type: "REGULAR", volume: 1, cost: 0.0166 },
          { start: sep, end: sep + 86400, pricing_category: "SERVICE", pricing_type: "FREE_CUSTOMER_SERVICE", volume: 40, cost: 0 },
        ] }] },
      } };
    });
    f.asked = [];
    return f;
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T09:30:00Z"));
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    vi.stubEnv("META_WA_TOKEN", "sys-token");
    vi.stubEnv("META_WABA_ID", WABA);
    fake.state.tree = JSON.parse(JSON.stringify(MANAGER));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("answers this month and last month as Meta counted them, in the account's currency", async () => {
    const f = meta(); vi.stubGlobal("fetch", f);
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      configured: true, mock: false, source: "env", currency: "EUR",
      months: { thisStart: Date.parse("2026-10-01T00:00:00Z") / 1000, lastStart: Date.parse("2026-09-01T00:00:00Z") / 1000 },
      this: { delivered: 13, free: 12, entryPoint: 0, billed: 1, cost: 0.0166 },
      last: { delivered: 40, free: 40, entryPoint: 0, billed: 0, cost: 0 },
    });
    expect(f.asked).toHaveLength(1);
    const u = f.asked[0];
    expect(u.method).toBe("GET");
    expect(u.auth).toBe("Bearer sys-token");
    expect(u.url).toContain("/v26.0/" + WABA + "?fields=currency,pricing_analytics.start(" + (Date.parse("2026-08-31T00:00:00Z") / 1000) + ").end(" + (Date.parse("2026-10-18T09:30:00Z") / 1000) + ")");
    expect(u.url).toContain(".granularity(DAILY).dimensions(PRICING_CATEGORY,PRICING_TYPE)");
    expect(JSON.stringify(res.body)).not.toContain("sys-token");
  });
  it("writes nothing, ever: the figures are asked for, not kept", async () => {
    vi.stubGlobal("fetch", meta());
    await get();
    expect(fake.state.writes).toEqual([]);
  });
  it("asks about the connected account first, and the variable only when nothing is connected", async () => {
    const f = meta(); vi.stubGlobal("fetch", f);
    fake.state.tree.waLink = { status: "connected", wabaId: "555666777888", phoneNumberId: "111222333" };
    expect((await get()).body.source).toBe("link");
    expect(f.asked[0].url).toContain("/v26.0/555666777888?");
    // The sandbox simulator's connection names no account at Meta.
    fake.state.tree.waLink = { status: "connected", wabaId: "555666777888", sim: true };
    expect((await get()).body.source).toBe("env");
    expect(f.asked[1].url).toContain("/v26.0/" + WABA + "?");
  });
  it("is not configured without an account id that is a Meta id, and calls nobody", async () => {
    const f = meta(); vi.stubGlobal("fetch", f);
    for (const id of ["", "12ab", "1/../2", " "]) {
      vi.stubEnv("META_WABA_ID", id);
      const res = await get();
      expect([res.statusCode, res.body]).toEqual([200, { configured: false, mock: false }]);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("in mock sending there is no Meta to ask: { mock: true }, and no call", async () => {
    vi.stubEnv("WA_SEND_MODE", "mock");
    const f = meta(); vi.stubGlobal("fetch", f);
    const res = await get();
    expect([res.statusCode, res.body]).toEqual([200, { configured: false, mock: true }]);
    expect(f).not.toHaveBeenCalled();
  });
  it("503 without META_WA_TOKEN, before any call", async () => {
    vi.stubEnv("META_WA_TOKEN", "");
    const f = meta(); vi.stubGlobal("fetch", f);
    const res = await get();
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/META_WA_TOKEN/);
    expect(f).not.toHaveBeenCalled();
  });
  it("Meta's refusal is a 502 carrying Meta's own message", async () => {
    vi.stubGlobal("fetch", meta({ status: 400 }));
    const res = await get();
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/Unsupported get request/);
  });

  describe("the capability", () => {
    const REFUSED = [403, "Not authorised: you do not have permission to see WhatsApp costs."];
    it("refuses staff with roles enforced, and calls nobody", async () => {
      const f = meta(); vi.stubGlobal("fetch", f);
      for (const roles of [{}, { u1: { role: "staff" } }, { u1: { role: "manager", denies: { waCostView: true } } }]) {
        fake.state.tree = { roles, settings: { admin: { enforceRoles: true } } };
        const res = await get();
        expect([res.statusCode, res.body.error]).toEqual(REFUSED);
      }
      expect(f).not.toHaveBeenCalled();
    });
    it("lets a manager, an admin and staff with the extra through, with roles enforced", async () => {
      vi.stubGlobal("fetch", meta());
      for (const roles of [{ u1: { role: "manager" } }, { u1: { role: "admin" } }, { u1: { role: "staff", extras: { waCostView: true } } }]) {
        fake.state.tree = { roles, settings: { admin: { enforceRoles: true } } };
        expect((await get()).statusCode).toBe(200);
      }
    });
    it("with roles not enforced, asks as the app does: everyone may (only settingsAdmin is always enforced)", async () => {
      vi.stubGlobal("fetch", meta());
      for (const flag of [undefined, false, "true", 1]) {
        fake.state.tree = { roles: { u1: { role: "staff" } }, settings: { admin: flag === undefined ? {} : { enforceRoles: flag } } };
        expect((await get()).statusCode).toBe(200);
      }
    });
    it("a role that cannot be read is a 503 saying to try again", async () => {
      const f = meta(); vi.stubGlobal("fetch", f);
      const realRef = fake.db.ref;
      fake.db.ref = (path) => (path === "roles/u1" ? { get: async () => { throw new Error("database unreachable"); } } : realRef(path));
      try {
        const res = await get();
        expect([res.statusCode, res.body.error]).toEqual([503, "Could not check your role just now: try again in a moment."]);
      } finally { fake.db.ref = realRef; }
      expect(f).not.toHaveBeenCalled();
    });
  });
});

// ── api/wa-onboard.js (v18.9.0) ─────────────────────────────────────────────
describe("wa-onboard", () => {
  const WABA = "102030405060";
  const PHONE = "908070605040";
  const BIZ = "BIZ-TOKEN-never-kept";
  const ADMIN = { roles: { u1: { role: "admin" } } };
  const connect = (body, token = "staff") => call(onboardHandler, { method: "POST", token, body });
  const ids = () => ({ code: "the-code", wabaId: WABA, phoneNumberId: PHONE });
  // Meta, as far as onboarding meets it. Every call is recorded with what the
  // database held when it was made, so the order can be asserted against it.
  function meta({ fail = {} } = {}) {
    const calls = [];
    const f = vi.fn(async (url, init = {}) => {
      const u = new URL(url);
      const path = u.pathname.replace(/^\/v26\.0\//, "");
      const body = typeof init.body === "string" ? init.body : "";
      const step = path === "oauth/access_token" ? "exchange"
        : path === WABA + "/subscribed_apps" ? "subscribe"
        : path === PHONE + "/smb_app_data" ? (JSON.parse(body).sync_type === "history" ? "history" : "contacts")
        : path === PHONE ? "phone" : "unknown";
      calls.push({ step, method: init.method || "GET", auth: (init.headers || {}).Authorization || null, body, url,
        linkedPhone: fake.read("waLink/phoneNumberId") || null });
      if (fail[step]) return { ok: false, status: fail[step], json: async () => ({ error: { message: step + " refused" } }) };
      const data = step === "exchange" ? { access_token: BIZ, token_type: "bearer" }
        : step === "subscribe" ? { success: true }
        : step === "contacts" || step === "history" ? { messaging_product: "whatsapp", request_id: "req-" + step }
        : step === "phone" ? { is_on_biz_app: true, platform_type: "CLOUD_API", id: PHONE } : {};
      return { ok: true, status: 200, json: async () => data };
    });
    f.calls = calls;
    return f;
  }
  beforeEach(() => {
    vi.stubEnv("META_APP_ID", "app-1");
    vi.stubEnv("META_ES_CONFIG_ID", "cfg-1");
    vi.stubEnv("META_APP_SECRET", "app-secret");
  });

  describe("the admin gate", () => {
    it("refuses a staff account with no admin grant, writing nothing and calling nobody", async () => {
      const f = meta(); vi.stubGlobal("fetch", f);
      for (const tree of [{}, { roles: { u1: { role: "staff" } } }, { roles: { u1: { role: "manager" } } }]) {
        fake.state.tree = tree;
        const res = await connect(ids());
        expect([res.statusCode, res.body.error]).toEqual([403, "Not authorised: only an admin can connect the WhatsApp Business app."]);
        expect((await call(onboardHandler, { method: "GET", token: "staff" })).statusCode).toBe(403);
      }
      expect(f).not.toHaveBeenCalled();
      expect(fake.state.writes).toEqual([]);
    });
    it("asks the client's question: an admin level, or the settingsAdmin extra, and never one under a deny", async () => {
      const get = () => call(onboardHandler, { method: "GET", token: "staff" });
      fake.state.tree = { roles: { u1: { role: "admin" } } };
      expect((await get()).statusCode).toBe(200);
      fake.state.tree = { roles: { u1: { role: "staff", extras: { settingsAdmin: true } } } };
      expect((await get()).statusCode).toBe(200);
      fake.state.tree = { roles: { u1: { role: "admin", denies: { settingsAdmin: true } } } };
      expect((await get()).statusCode).toBe(403);
    });
    it("the enforcement flag does not open it: settingsAdmin is always enforced (roles.js ALWAYS_ENFORCED)", async () => {
      fake.state.tree = { roles: { u1: { role: "staff" } }, settings: { admin: { enforceRoles: false } } };
      expect((await call(onboardHandler, { method: "GET", token: "staff" })).statusCode).toBe(403);
    });
    // /code-review: a failed read reached staffAuthError's default, and the
    // page told an admin "invalid token", which signing in again cannot fix.
    it("a role that cannot be read is a 503 saying to try again, never \"invalid token\"", async () => {
      fake.state.tree = ADMIN;
      const f = meta(); vi.stubGlobal("fetch", f);
      const realRef = fake.db.ref;
      fake.db.ref = (path) => (path === "roles/u1" ? { get: async () => { throw new Error("database unreachable"); } } : realRef(path));
      try {
        for (const method of ["GET", "POST"]) {
          const res = await call(onboardHandler, { method, token: "staff", body: ids() });
          expect([res.statusCode, res.body.error]).toEqual([503, "Could not check your role just now: try again in a moment."]);
        }
      } finally { fake.db.ref = realRef; }
      expect(f).not.toHaveBeenCalled();
      expect(fake.state.writes).toEqual([]);
    });
  });

  describe("GET", () => {
    it("hands the page the two ids and the Graph version its SDK must use", async () => {
      fake.state.tree = ADMIN;
      const res = await call(onboardHandler, { method: "GET", token: "staff" });
      expect([res.statusCode, res.body]).toEqual([200, { appId: "app-1", configId: "cfg-1", graphVersion: "v26.0" }]);
    });
    it("503 while either id is unset", async () => {
      fake.state.tree = ADMIN;
      vi.stubEnv("META_ES_CONFIG_ID", "");
      const res = await call(onboardHandler, { method: "GET", token: "staff" });
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toMatch(/META_ES_CONFIG_ID/);
    });
  });

  describe("POST, the onboarding", () => {
    beforeEach(() => { fake.state.tree = JSON.parse(JSON.stringify(ADMIN)); });

    it("400 without a code, or with ids that are not Meta's, before calling anyone", async () => {
      const f = meta(); vi.stubGlobal("fetch", f);
      for (const body of [{ wabaId: WABA, phoneNumberId: PHONE }, { code: 7, wabaId: WABA, phoneNumberId: PHONE },
        Object.assign(ids(), { wabaId: "12/../me" }), Object.assign(ids(), { phoneNumberId: "abc123456" }), Object.assign(ids(), { phoneNumberId: undefined })]) {
        expect((await connect(body)).statusCode).toBe(400);
      }
      expect(f).not.toHaveBeenCalled();
      expect(fake.state.writes).toEqual([]);
    });
    it("503 without the app secret the exchange needs, before calling anyone", async () => {
      vi.stubEnv("META_APP_SECRET", "");
      const f = meta(); vi.stubGlobal("fetch", f);
      expect((await connect(ids())).statusCode).toBe(503);
      expect(f).not.toHaveBeenCalled();
    });

    it("runs Meta's steps in order, links the number BEFORE any sync, and answers each step", async () => {
      vi.stubEnv("META_PHONE_NUMBER_ID", "111111111");
      const f = meta(); vi.stubGlobal("fetch", f);
      const res = await connect(ids());
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true, phoneNumberId: PHONE, envNumber: "different",
        steps: ["exchange", "link", "subscribe", "contacts", "history", "phone"].map((id) => ({ id, ok: true })) });
      expect(f.calls.map((c) => c.step)).toEqual(["exchange", "subscribe", "contacts", "history", "phone"]);
      // The code went in a form body, the secret with it, never in the URL.
      const ex = f.calls[0];
      expect(ex.method).toBe("POST");
      expect(new URLSearchParams(ex.body).get("code")).toBe("the-code");
      expect(new URLSearchParams(ex.body).get("client_id")).toBe("app-1");
      expect(ex.url).not.toMatch(/app-secret|the-code/);
      // Every later call carries the business token, and the syncs found the
      // number already linked, so the number guard accepts their webhooks.
      expect(f.calls.slice(1).every((c) => c.auth === "Bearer " + BIZ)).toBe(true);
      expect(f.calls.filter((c) => c.step === "contacts" || c.step === "history").map((c) => c.linkedPhone)).toEqual([PHONE, PHONE]);
      expect(fake.read("waLink")).toMatchObject({ status: "connected", wabaId: WABA, phoneNumberId: PHONE, connectedBy: "ana@example.com",
        contacts: { requestId: "req-contacts" }, history: { requestId: "req-history" },
        phone: { isOnBizApp: true, platformType: "CLOUD_API" } });
      expect(typeof fake.read("waLink/subscribedAt")).toBe("number");
    });

    it("never stores or returns the business token", async () => {
      vi.stubGlobal("fetch", meta());
      const res = await connect(ids());
      expect(JSON.stringify(res.body)).not.toContain(BIZ);
      expect(JSON.stringify(fake.state.writes)).not.toContain(BIZ);
      expect(JSON.stringify(fake.state.tree)).not.toContain(BIZ);
    });

    it("a refused exchange stops there: 502, nothing linked, nobody else called", async () => {
      const f = meta({ fail: { exchange: 400 } }); vi.stubGlobal("fetch", f);
      const res = await connect(ids());
      expect([res.statusCode, res.body.steps]).toEqual([502, [{ id: "exchange", ok: false, error: "exchange refused" }]]);
      expect(f.calls.map((c) => c.step)).toEqual(["exchange"]);
      expect(fake.read("waLink")).toBeUndefined();
    });

    it("a failed subscribe skips both syncs, which Meta runs only once, and still checks the phone", async () => {
      const f = meta({ fail: { subscribe: 500 } }); vi.stubGlobal("fetch", f);
      const res = await connect(ids());
      expect(res.statusCode).toBe(502);
      expect(res.body.steps.map((s) => [s.id, s.ok, !!s.skipped])).toEqual([
        ["exchange", true, false], ["link", true, false], ["subscribe", false, false],
        ["contacts", false, true], ["history", false, true], ["phone", true, false]]);
      expect(f.calls.map((c) => c.step)).toEqual(["exchange", "subscribe", "phone"]);
      expect(fake.read("waLink/contacts")).toBeUndefined();
    });

    it("one failed sync does not stop the other", async () => {
      vi.stubGlobal("fetch", meta({ fail: { contacts: 400 } }));
      const res = await connect(ids());
      expect(res.statusCode).toBe(502);
      expect(res.body.steps.find((s) => s.id === "contacts")).toEqual({ id: "contacts", ok: false, error: "contacts refused" });
      expect(res.body.steps.find((s) => s.id === "history")).toEqual({ id: "history", ok: true });
    });

    it("a failed link stops before the syncs: 500, and Meta's one sync is not spent", async () => {
      fake.state.failWrite = (op, path) => path === "waLink";
      const f = meta(); vi.stubGlobal("fetch", f);
      const res = await connect(ids());
      expect(res.statusCode).toBe(500);
      expect(res.body.steps.map((s) => [s.id, s.ok])).toEqual([["exchange", true], ["link", false]]);
      expect(f.calls.map((c) => c.step)).toEqual(["exchange"]);
    });

    it("reconnecting clears a disconnection; a different number forgets the old number's sync records", async () => {
      vi.stubGlobal("fetch", meta({ fail: { contacts: 400, history: 400 } }));
      fake.state.tree.waLink = { status: "disconnected", disconnect: { event: "PARTNER_REMOVED" }, phoneNumberId: PHONE, contacts: { firstAt: 5 } };
      await connect(ids());
      expect(fake.read("waLink/status")).toBe("connected");
      expect(fake.read("waLink/disconnect")).toBeUndefined();
      expect(fake.read("waLink/contacts")).toEqual({ firstAt: 5 });
      fake.state.tree.waLink.phoneNumberId = "123123123";
      fake.state.tree.waLink.measured = { historyDeliveries: 2, mgtEchoes: 1 };
      await connect(ids());
      expect(fake.read("waLink/contacts")).toBeUndefined();
      // /code-review: the rehearsal's record is about Meta, not one number, so it stays.
      expect(fake.read("waLink/measured")).toEqual({ historyDeliveries: 2, mgtEchoes: 1 });
    });

    // /code-review: the same number connected again kept the earlier import's
    // record, so Settings described the new import as declined or done.
    it("a new history request starts a new record for the same number", async () => {
      vi.stubGlobal("fetch", meta());
      fake.state.tree.waLink = { status: "disconnected", wabaId: WABA, phoneNumberId: PHONE,
        contacts: { requestId: "old-c", requestedAt: 1, firstAt: 2 },
        history: { requestId: "old", requestedAt: 1, declined: true, progress: 100, phase: 2, doneAt: 3, at: 3 } };
      expect((await connect(ids())).statusCode).toBe(200);
      expect(fake.read("waLink/history")).toEqual({ requestId: "req-history", requestedAt: expect.any(Number) });
      expect(fake.read("waLink/contacts")).toMatchObject({ requestId: "req-contacts", firstAt: 2 });
    });

    // v18.9.0 phase 9: a real connection over the sandbox simulator's.
    it("a real connection over a simulated one is no longer the simulator's", async () => {
      fake.state.tree.waLink = { status: "connected", wabaId: SIM_WABA_ID, phoneNumberId: SIM_PHONE_NUMBER_ID, sim: true };
      vi.stubGlobal("fetch", meta());
      expect((await connect(ids())).statusCode).toBe(200);
      expect(fake.read("waLink")).toMatchObject({ wabaId: WABA, phoneNumberId: PHONE });
      expect(fake.read("waLink/sim")).toBeUndefined();
    });

    it("says whether the environment's number is the one connected, as a word", async () => {
      vi.stubGlobal("fetch", meta());
      expect((await connect(ids())).body.envNumber).toBe("unset");
      vi.stubEnv("META_PHONE_NUMBER_ID", PHONE);
      expect((await connect(ids())).body.envNumber).toBe("same");
    });
  });

  describe("POST, a retry", () => {
    beforeEach(() => { fake.state.tree = JSON.parse(JSON.stringify(ADMIN)); });
    it("400 for a step it does not know, and while nothing is connected", async () => {
      vi.stubEnv("META_WA_TOKEN", "sys-token");
      expect((await connect({ retry: "exchange" })).statusCode).toBe(400);
      const res = await connect({ retry: "contacts" });
      expect([res.statusCode, res.body.error]).toEqual([400, "Nothing is connected yet: connect the Business app first."]);
    });
    it("400 for a connection the sandbox's simulator made, calling nobody", async () => {
      vi.stubEnv("META_WA_TOKEN", "sys-token");
      fake.state.tree.waLink = { status: "connected", wabaId: SIM_WABA_ID, phoneNumberId: SIM_PHONE_NUMBER_ID, sim: true };
      const f = meta(); vi.stubGlobal("fetch", f);
      const res = await connect({ retry: "contacts" });
      expect([res.statusCode, res.body.error]).toEqual([400, "The connection is the sandbox simulator's: there is nothing at Meta to try again."]);
      expect(f).not.toHaveBeenCalled();
    });
    it("503 without the system user's token", async () => {
      fake.state.tree.waLink = { wabaId: WABA, phoneNumberId: PHONE };
      expect((await connect({ retry: "history" })).statusCode).toBe(503);
    });
    it("runs that one step with META_WA_TOKEN and the ids waLink holds", async () => {
      vi.stubEnv("META_WA_TOKEN", "sys-token");
      fake.state.tree.waLink = { status: "connected", wabaId: WABA, phoneNumberId: PHONE };
      const f = meta(); vi.stubGlobal("fetch", f);
      const res = await connect({ retry: "history" });
      expect([res.statusCode, res.body.steps]).toEqual([200, [{ id: "history", ok: true }]]);
      expect(f.calls.map((c) => [c.step, c.auth])).toEqual([["history", "Bearer sys-token"]]);
      expect(fake.read("waLink/history/requestId")).toBe("req-history");
    });
  });
});

// ── api/_lib/inbound-core.js ─────────────────────────────────────────────────
describe("processInbound", () => {
  const TS = 1_800_000_000_000;

  it("skips a sender that is not a phone, writing nothing", async () => {
    for (const phone of ["", "+", "abc", null]) {
      expect(await processInbound({ phone, text: "hola", ts: TS })).toEqual({ phoneKey: null, skipped: true });
    }
    expect(fake.state.writes).toEqual([]);
  });

  it("a first message opens the conversation, stores the message and sends the one-time auto-ack", async () => {
    const r = await processInbound({ phone: "+34 600 111 222", text: "Hola", ts: TS, wamid: "wamid.A1", profileName: "Juan", langHint: "es" });
    expect(r).toEqual({ phoneKey: KEY, skipped: false, muted: false });
    expect(convAt(KEY)).toMatchObject({ phoneKey: KEY, channel: "whatsapp", lastMessageAt: TS, lastMessageSnippet: "Hola", unread: true,
      windowExpiresAt: TS + WA_WINDOW_MS, language: "es", archived: false, autoAckSent: true, createdAt: TS, profileName: "Juan" });
    const [inbound, ack] = msgsAt(KEY);
    expect(inbound).toMatchObject({ id: "wamid_A1", direction: "in", text: "Hola", ts: TS, providerMsgId: "wamid.A1", isAutoAck: false });
    expect(ack).toMatchObject({ direction: "out", text: AUTO_ACK_TEXT.es, ts: TS + 1500, isAutoAck: true, status: "delivered" });
  });

  it("a later message sends no second ack, resets the window, and keeps what the conversation holds", async () => {
    fake.state.tree = { conversations: { [KEY]: { phoneKey: KEY, autoAckSent: true, createdAt: 5, acceptedBookingId: "b1",
      draftStatus: "accepted", draftData: { size: 2 }, profileName: "Juan", archived: true, archivedAt: 9, acceptedBadgeDismissedAt: 7 } } };
    await processInbound({ phone: KEY, text: "gracias", ts: TS, wamid: "wamid.B", profileName: "Someone Else", langHint: "es" });
    const c = convAt(KEY);
    expect(c).toMatchObject({ createdAt: 5, acceptedBookingId: "b1", draftStatus: "accepted", draftData: { size: 2 }, profileName: "Juan",
      archived: false, windowExpiresAt: TS + WA_WINDOW_MS });
    expect("archivedAt" in c).toBe(false);
    expect("acceptedBadgeDismissedAt" in c).toBe(false);
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
  });

  it("a redelivered webhook (same wamid) is skipped: one message, however often Meta retries", async () => {
    await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.DUP" });
    const count = fake.state.writes.length;
    expect(await processInbound({ phone: KEY, text: "Hola", ts: TS + 5000, wamid: "wamid.DUP" })).toEqual({ phoneKey: KEY, skipped: true });
    expect(fake.state.writes.length).toBe(count);
    expect(convAt(KEY).lastMessageAt).toBe(TS);
  });

  // v18.9.0 — "Not a customer".
  it("a muted conversation stores the message and does nothing else: no ack, no draft, no flag, read, still archived", async () => {
    fake.state.tree = { conversations: { [KEY]: { phoneKey: KEY, muted: true, archived: true, archivedAt: 9, createdAt: 5 } } };
    const r = await processInbound({ phone: KEY, text: "mesa para 4", ts: TS, wamid: "wamid.M",
      parse: { intent: "new_booking", language: "es", size: 4 }, willParse: true });
    expect(r).toEqual({ phoneKey: KEY, skipped: false, muted: true });
    const c = convAt(KEY);
    expect(c).toMatchObject({ muted: true, archived: true, archivedAt: 9, unread: false, lastMessageAt: TS, windowExpiresAt: TS + WA_WINDOW_MS });
    expect("draftStatus" in c).toBe(false);
    expect("parsing" in c).toBe(false);
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
  });

  it("a draft intent stores a draft the app can use: an unusable time or size becomes null and the confidence drops", async () => {
    await processInbound({ phone: KEY, text: "mesa", ts: TS, wamid: "wamid.C",
      parse: { intent: "new_booking", language: "en", size: 5000.5, date: "next tuesday", time: "8 in the evening", confidence: "high" } });
    const c = convAt(KEY);
    expect(c).toMatchObject({ draftStatus: "parsed", draftUpdatedAt: TS, language: "en" });
    expect(c.draftData).toMatchObject({ intent: "new_booking", size: null, date: null, time: null, preference: "auto", notes: "" });
    expect(c.draftData.confidence).not.toBe("high");
  });

  it("a question stores no draft, and the parsing flag is set only when a parse is still to come", async () => {
    await processInbound({ phone: KEY, text: "¿terraza?", ts: TS, wamid: "wamid.D", parse: { intent: "question", language: "es" }, willParse: true });
    expect("draftStatus" in convAt(KEY)).toBe(false); // written as null, which RTDB stores as absent
    expect("parsing" in convAt(KEY)).toBe(false);
    await processInbound({ phone: KEY, text: "otra", ts: TS + 1, wamid: "wamid.E", parse: null, willParse: true });
    expect(convAt(KEY).parsing).toBe(true);
  });

  it("stores at most WA_MAX_TEXT_LEN characters and a 200-character snippet", async () => {
    await processInbound({ phone: KEY, text: "y".repeat(WA_MAX_TEXT_LEN + 10), ts: TS, wamid: "wamid.F" });
    expect(msgsAt(KEY)[0].text.length).toBe(WA_MAX_TEXT_LEN);
    expect(convAt(KEY).lastMessageSnippet.length).toBe(200);
  });

  it("a failed auto-ack does not lose the customer's message, and hands its claim back", async () => {
    vi.stubEnv("WA_SEND_MODE", "live"); // live with no token: sendText throws
    const r = await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.G" });
    expect(r.skipped).toBe(false);
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
    expect(convAt(KEY).autoAckSent).toBe(false);
    // The claim is written BEFORE the send (two quick inbounds must not both
    // ack), then released: the order of the two writes is the contract.
    const claims = fake.state.writes.filter((w) => w.op === "update" && "autoAckSent" in w.value).map((w) => w.value.autoAckSent);
    expect(claims).toEqual([true, false]);
  });

  it("the next inbound after a failed auto-ack sends it, once", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.H1" });
    vi.stubEnv("WA_SEND_MODE", "mock"); // the provider is back
    await processInbound({ phone: KEY, text: "¿Hola?", ts: TS + 60000, wamid: "wamid.H2" });
    expect(msgsAt(KEY).map((m) => [m.direction, !!m.isAutoAck])).toEqual([["in", false], ["in", false], ["out", true]]);
    expect(convAt(KEY).autoAckSent).toBe(true);
    await processInbound({ phone: KEY, text: "gracias", ts: TS + 120000, wamid: "wamid.H3" });
    expect(msgsAt(KEY).filter((m) => m.isAutoAck).length).toBe(1);
  });

  it("an auto-ack that was sent keeps its claim even if its bubble cannot be stored", async () => {
    const realSet = fake.db.ref;
    fake.db.ref = (path) => {
      const r = realSet(path);
      if (/\/ack/.test(path)) r.set = async () => { throw new Error("write refused"); };
      return r;
    };
    try {
      await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.I" });
    } finally {
      fake.db.ref = realSet;
    }
    expect(convAt(KEY).autoAckSent).toBe(true);
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
  });
});

describe("applyParse", () => {
  it("clears the indicator whatever the parse, and sets a draft only for a draft intent", async () => {
    fake.state.tree = { conversations: { [KEY]: { phoneKey: KEY, parsing: true, parsingAt: 3, language: "es" } } };
    await applyParse(KEY, null, 10);
    expect(convAt(KEY)).toEqual({ phoneKey: KEY, language: "es" });
    await applyParse(KEY, { intent: "other", language: "en" }, 10);
    expect(convAt(KEY)).toEqual({ phoneKey: KEY, language: "en" });
    await applyParse(KEY, { intent: "cancel", language: "es", confidence: "high" }, 10);
    expect(convAt(KEY)).toMatchObject({ draftStatus: "parsed", draftUpdatedAt: 10, draftData: { intent: "cancel" } });
  });
  it("does nothing without a key", async () => {
    await applyParse("", { intent: "cancel" }, 10);
    expect(fake.state.writes).toEqual([]);
  });
  // v18.11.0: the draft keeps the occasions, cleaned, and none is stored as none.
  it("stores a draft's occasions as clean tag ids, and none as nothing", async () => {
    fake.state.tree = { conversations: { [KEY]: { phoneKey: KEY } } };
    await applyParse(KEY, { intent: "new_booking", language: "es", occasions: ["o-birthday", "o-birthday", "bad id!", 7] }, 10);
    expect(convAt(KEY).draftData.occasions).toEqual(["o-birthday"]);
    await applyParse(KEY, { intent: "new_booking", language: "es", occasions: [] }, 11);
    expect(convAt(KEY).draftData.occasions ?? null).toBe(null); // RTDB drops a null; the fake keeps it
  });
});

describe("injectSimInbound", () => {
  it("stores the message at once with the indicator on, and lands the parse afterwards", async () => {
    let later;
    const r = await injectSimInbound({ phone: KEY, text: "Mesa para 4 personas mañana a las 21:00", name: "Sim" }, (p) => { later = p; });
    expect(r).toEqual({ phoneKey: KEY, skipped: false, muted: false });
    expect(convAt(KEY)).toMatchObject({ parsing: true, profileName: "Sim" });
    expect(msgsAt(KEY)[0].direction).toBe("in");
    await later;
    const c = convAt(KEY);
    expect("parsing" in c).toBe(false);
    expect(c.draftStatus).toBe("parsed");
    expect(c.draftData.size).toBe(4);
  });
  it("back-dates the message by agoMs, so an expired window can be simulated", async () => {
    const before = Date.now();
    await injectSimInbound({ phone: KEY, text: "hola", agoMs: 25 * 3600 * 1000 }, () => {});
    expect(convAt(KEY).windowExpiresAt).toBeLessThan(before);
  });
});

// ── api/_lib/meta.js ─────────────────────────────────────────────────────────
describe("verifySignature", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const sign = (secret, raw) => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

  it("accepts the HMAC of the exact bytes under the app secret, and nothing else", () => {
    vi.stubEnv("META_APP_SECRET", "s3cret");
    expect(verifySignature(body, sign("s3cret", body))).toBe(true);
    expect(verifySignature(body, sign("other", body))).toBe(false);
    expect(verifySignature(Buffer.from(body.toString() + " "), sign("s3cret", body))).toBe(false);
    expect(verifySignature(body, sign("s3cret", body).replace("sha256=", "sha1="))).toBe(false);
    expect(verifySignature(body, sign("s3cret", body).slice(0, -2))).toBe(false);
    expect(verifySignature(body, "")).toBe(false);
    expect(verifySignature(body, undefined)).toBe(false);
  });
  it("refuses everything when no secret is configured", () => {
    expect(verifySignature(body, sign("", body))).toBe(false);
  });
  it("WA_ALLOW_UNSIGNED skips the check only at exactly \"1\"", () => {
    vi.stubEnv("WA_ALLOW_UNSIGNED", "true");
    expect(verifySignature(body, undefined)).toBe(false);
    vi.stubEnv("WA_ALLOW_UNSIGNED", "1");
    expect(verifySignature(body, undefined)).toBe(true);
  });
});

describe("sendText", () => {
  it("mock mode touches no network and reports delivered", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendText(KEY, "hi");
    expect(r.status).toBe("delivered");
    expect(r.wamid).toMatch(/^wamid\.MOCK\./);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("live mode without its two settings throws rather than pretending", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    await expect(sendText(KEY, "hi")).rejects.toThrow(/META_WA_TOKEN/);
  });
  it("live mode posts a text message to the number's endpoint, the recipient without its plus", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("META_WA_TOKEN", "tok");
    vi.stubEnv("META_PHONE_NUMBER_ID", "555");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: "wamid.X" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendText(KEY, "hola")).toEqual({ wamid: "wamid.X", status: "sent" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/555\/messages$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ messaging_product: "whatsapp", to: "34600111222", type: "text", text: { body: "hola" } });
  });
  it("a Graph error carries Meta's message, or the status when there is none", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("META_WA_TOKEN", "tok");
    vi.stubEnv("META_PHONE_NUMBER_ID", "555");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid OAuth access token" } }) })));
    await expect(sendText(KEY, "hi")).rejects.toThrow("Invalid OAuth access token");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error("not json"); } })));
    await expect(sendText(KEY, "hi")).rejects.toThrow("Graph API error 500");
  });
});

// ── api/wa-inbound.js — the webhook (v18.8.0) ────────────────────────────────
// A request whose body is a byte STREAM, as Vercel hands this handler over
// (`bodyParser: false`), and a response that also records `send`.
function rawCall(handler, { method = "POST", body = "", headers = {}, query } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { method, headers, query: query || {} });
  const res = {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
  return handler(req, res).then(() => res);
}
const SECRET = "s3cret";
const hmac = (raw, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
const webhook = (value) => JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: Object.assign({ messaging_product: "whatsapp" }, value) }] }],
});
const nowSecs = () => String(Math.floor(Date.now() / 1000));
const inMsg = (extra) => Object.assign({ from: "34600111222", id: "wamid.IN1", timestamp: nowSecs() }, extra);
// Posts a payload signed with the app secret; `raw` overrides the bytes.
const deliver = (value, { raw, headers } = {}) => {
  const body = raw !== undefined ? raw : webhook(value);
  return rawCall(inboundHandler, { body, headers: Object.assign({ "x-hub-signature-256": hmac(body) }, headers) });
};
const inbound = () => msgsAt(KEY).filter((m) => m.direction === "in");

// The phase-B parse is registered through Vercel's request-context waitUntil;
// the stub collects what was scheduled so a test can wait for it.
const REQ_CTX = Symbol.for("@vercel/request-context");
let scheduled;
beforeEach(() => {
  scheduled = [];
  globalThis[REQ_CTX] = { get: () => ({ waitUntil: (p) => scheduled.push(p) }) };
});
afterEach(() => { delete globalThis[REQ_CTX]; });

describe("wa-inbound — the handshake, the method, the signature", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("GET echoes hub.challenge only for subscribe with the configured verify token", async () => {
    vi.stubEnv("META_VERIFY_TOKEN", "vt");
    const q = (mode, token) => ({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "1234" });
    const ok = await rawCall(inboundHandler, { method: "GET", query: q("subscribe", "vt") });
    expect([ok.statusCode, ok.body]).toEqual([200, "1234"]);
    expect((await rawCall(inboundHandler, { method: "GET", query: q("subscribe", "nope") })).statusCode).toBe(403);
    expect((await rawCall(inboundHandler, { method: "GET", query: q("unsubscribe", "vt") })).statusCode).toBe(403);
  });
  it("GET refuses every token when none is configured, the empty one included", async () => {
    const res = await rawCall(inboundHandler, { method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" } });
    expect(res.statusCode).toBe(403);
  });
  it("answers 405 to anything but GET and POST", async () => {
    expect((await rawCall(inboundHandler, { method: "PUT" })).statusCode).toBe(405);
  });
  it("answers 401 to a missing signature, a wrong secret and bytes changed after signing, and writes nothing", async () => {
    const body = webhook({ messages: [inMsg({ type: "text", text: { body: "hola" } })] });
    expect((await rawCall(inboundHandler, { body })).statusCode).toBe(401);
    expect((await rawCall(inboundHandler, { body, headers: { "x-hub-signature-256": hmac(body, "other") } })).statusCode).toBe(401);
    expect((await rawCall(inboundHandler, { body: body + " ", headers: { "x-hub-signature-256": hmac(body) } })).statusCode).toBe(401);
    expect(fake.state.writes).toEqual([]);
  });
  it("answers 400 to signed bytes that are not JSON", async () => {
    expect((await deliver(null, { raw: "{not json" })).statusCode).toBe(400);
  });
  it("answers 200 to a signed payload with nothing in it", async () => {
    const res = await deliver({});
    expect([res.statusCode, res.body]).toEqual([200, { ok: true, messages: 0, statuses: 0, echoes: 0, mgtEchoes: 0, edits: 0, contacts: 0, history: 0, events: 0, skipped: 0, ignored: 0, errors: 0 }]);
  });
  // The retry rule sums every counter but `errors`, so one a handler bumps that
  // the record lacks reads NaN and switches the retry off: every counter under
  // api/ is one freshResults() starts at 0, and nothing else types the record.
  it("every results counter under api/ is a freshResults() key, and only coexist-core types the record", () => {
    expect(freshResults()).not.toBe(freshResults());
    expect(Object.values(freshResults()).every((v) => v === 0)).toBe(true);
    const keys = Object.keys(freshResults());
    const files = ["api/", "api/_lib/"].flatMap((d) => readdirSync(new URL("../" + d, import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => d + f));
    let bumps = 0;
    for (const f of files) {
      const src = stripComments(readFileSync(new URL("../" + f, import.meta.url), "utf8")).join("\n");
      for (const m of src.matchAll(/\bresults\.([a-zA-Z]+)\s*(?:\+\+|\+=)/g)) { bumps++; expect(keys, f + " bumps results." + m[1]).toContain(m[1]); }
      if (f !== "api/_lib/coexist-core.js") expect(src, f).not.toMatch(/statuses:\s*0/);
    }
    expect(bumps).toBeGreaterThan(30);
  });
});

describe("wa-inbound — what a message is stored as", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  // v18.8.0 phase 6: the DEV simulator posts `simMediaMessage` in a webhook to
  // the harness, so its photo, voice note and PDF take this handler's road.
  it("the simulator's media messages are stored as Meta's are", async () => {
    await deliver({ messages: [
      inMsg(Object.assign({ id: "wamid.S1" }, simMediaMessage("document", "La carta"))),
      inMsg(Object.assign({ id: "wamid.S2" }, simMediaMessage("audio", "no caption on audio"))),
    ] });
    const [doc, voice] = inbound().sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(doc).toMatchObject({ text: "La carta", media: { kind: "document", mime: "application/pdf", filename: "menu-grupos-2026.pdf" } });
    expect(voice).toMatchObject({ text: "Voice message", media: { kind: "audio", voice: true } });
    expect(doc.media.mediaId).toMatch(/^MOCK\.document\./);
  });

  it("a text is stored as it came, with no media key, and parsed after the response", async () => {
    const res = await deliver({
      contacts: [{ wa_id: "34600111222", profile: { name: "Ana" } }],
      messages: [inMsg({ type: "text", text: { body: "Mesa para 4 mañana a las 21:00" } })],
    });
    expect(res.body).toMatchObject({ ok: true, messages: 1 });
    const [m] = inbound();
    expect(m.text).toBe("Mesa para 4 mañana a las 21:00");
    expect("media" in m).toBe(false);
    expect(convAt(KEY)).toMatchObject({ profileName: "Ana", lastMessageSnippet: "Mesa para 4 mañana a las 21:00", parsing: true });
    expect(scheduled).toHaveLength(1);
    await scheduled[0];
    expect(convAt(KEY)).toMatchObject({ draftStatus: "parsed", draftData: { size: 4 } });
  });
  it("a photo with a caption: the media beside the caption, the caption parsed", async () => {
    await deliver({ messages: [inMsg({ type: "image", image: { id: "1234567890", mime_type: "image/jpeg", sha256: "x", caption: " Mesa para 4 mañana a las 21:00 " } })] });
    const [m] = inbound();
    expect(m.media).toEqual({ kind: "image", mediaId: "1234567890", mime: "image/jpeg" });
    expect(m.text).toBe("Mesa para 4 mañana a las 21:00");
    expect(convAt(KEY).lastMessageSnippet).toBe("Photo · Mesa para 4 mañana a las 21:00");
    expect(scheduled).toHaveLength(1);
    await scheduled[0];
    expect(convAt(KEY).draftData.size).toBe(4);
  });
  it("a photo without a caption reads \"Photo\" and is not parsed", async () => {
    await deliver({ messages: [inMsg({ type: "image", image: { id: "1234567890", mime_type: "image/png" } })] });
    expect(inbound()[0]).toMatchObject({ text: "Photo", media: { kind: "image", mime: "image/png" } });
    expect(convAt(KEY).lastMessageSnippet).toBe("Photo");
    expect("parsing" in convAt(KEY)).toBe(false);
    expect(scheduled).toEqual([]);
  });
  it("a voice note keeps its voice flag and its codec line, and is never parsed", async () => {
    await deliver({ messages: [inMsg({ type: "audio", audio: { id: "998877", mime_type: "audio/ogg; codecs=opus", voice: true } })] });
    expect(inbound()[0]).toMatchObject({ text: "Voice message", media: { kind: "audio", mediaId: "998877", mime: "audio/ogg; codecs=opus", voice: true } });
    expect(scheduled).toEqual([]);
  });
  it("an audio file that is not a voice note reads \"Audio\" and carries no voice key", async () => {
    await deliver({ messages: [inMsg({ type: "audio", audio: { id: "998877", mime_type: "audio/mpeg" } })] });
    const [m] = inbound();
    expect(m.text).toBe("Audio");
    expect("voice" in m.media).toBe(false);
  });
  it("a document keeps its file name and is not parsed without a caption", async () => {
    await deliver({ messages: [inMsg({ type: "document", document: { id: "555", mime_type: "application/pdf", filename: "menu.pdf" } })] });
    expect(inbound()[0]).toMatchObject({ text: "Document: menu.pdf", media: { kind: "document", mediaId: "555", mime: "application/pdf", filename: "menu.pdf" } });
    expect(scheduled).toEqual([]);
  });
  it("a kind the app does not show is one line saying it stays on the phone, with no media", async () => {
    await deliver({ messages: [
      inMsg({ id: "wamid.V", type: "video", video: { id: "777", mime_type: "video/mp4" } }),
      inMsg({ id: "wamid.L", type: "location", location: { latitude: 28.1, longitude: -15.4 } }),
    ] });
    const ms = inbound();
    expect(ms.map((m) => m.text)).toEqual(["Video — open WhatsApp on the phone to see it", "Location — open WhatsApp on the phone to see it"]);
    expect(ms.some((m) => "media" in m)).toBe(false);
    expect(scheduled).toEqual([]);
  });
  it("a media id that could climb a path is not stored as media", async () => {
    await deliver({ messages: [inMsg({ type: "image", image: { id: "../x", mime_type: "image/jpeg" } })] });
    const [m] = inbound();
    expect(m.text).toBe("Photo — open WhatsApp on the phone to see it");
    expect("media" in m).toBe(false);
  });
  it("a redelivered message is skipped, not stored twice", async () => {
    const msg = inMsg({ type: "text", text: { body: "hola" } });
    await deliver({ messages: [msg] });
    const again = await deliver({ messages: [msg] });
    expect(again.body).toMatchObject({ messages: 0, skipped: 1 });
    expect(inbound()).toHaveLength(1);
  });
  it("messages that are not an array manufacture nothing (CT-WA-04)", async () => {
    const res = await deliver({ messages: "abc" });
    expect(res.body).toMatchObject({ messages: 0, errors: 0 });
    expect(fake.state.writes).toEqual([]);
  });
});

describe("wa-inbound — the message timestamp", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));
  const tsFor = async (timestamp) => {
    fake.state.tree = {};
    await deliver({ messages: [inMsg({ timestamp, type: "text", text: { body: "hola" } })] });
    return inbound()[0].ts;
  };

  it("a timestamp that is not a number, or not positive, is now — stored, not a 500 (CT-WA-02)", async () => {
    for (const bad of ["abc", "-1", "0", ""]) {
      const before = Date.now();
      const ts = await tsFor(bad);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(Date.now());
    }
  });
  it("a future timestamp is now, and an old one is kept", async () => {
    const before = Date.now();
    expect(await tsFor("99999999999")).toBeLessThanOrEqual(Date.now());
    expect(await tsFor("99999999999")).toBeGreaterThanOrEqual(before);
    const old = Math.floor(Date.now() / 1000) - 3 * 86400;
    expect(await tsFor(String(old))).toBe(old * 1000);
  });
});

describe("wa-inbound — delivery and read receipts", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));
  const seedOut = (status) => {
    fake.state.tree = { messages: { [KEY]: { o1: { id: "o1", direction: "out", text: "hi", ts: 1, status, providerMsgId: "wamid.OUT" } } } };
  };
  const receipt = (status, id = "wamid.OUT", recipient = "34600111222") => deliver({ statuses: [{ id, status, recipient_id: recipient, timestamp: nowSecs() }] });

  it("a receipt moves the message's status forward and is counted", async () => {
    seedOut("sent");
    const res = await receipt("delivered");
    expect(res.body).toMatchObject({ statuses: 1 });
    expect(fake.read("messages/" + KEY + "/o1/status")).toBe("delivered");
  });
  it("a receipt that arrives late never moves it back (CT-WA-05)", async () => {
    seedOut("read");
    const res = await receipt("delivered");
    expect(res.body).toMatchObject({ statuses: 1 });
    expect(fake.read("messages/" + KEY + "/o1/status")).toBe("read");
  });
  it("a receipt for a message nobody has, or for no recipient, writes nothing", async () => {
    seedOut("sent");
    expect((await receipt("delivered", "wamid.OTHER")).body).toMatchObject({ statuses: 0 });
    expect((await receipt("delivered", "wamid.OUT", "")).body).toMatchObject({ statuses: 0 });
    expect(fake.state.writes).toEqual([]);
  });
});

describe("wa-inbound — when to ask Meta to deliver again", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("answers 500 only when everything in the payload failed", async () => {
    const realRef = fake.db.ref;
    fake.db.ref = () => { throw new Error("database unreachable"); };
    try {
      const res = await deliver({ messages: [inMsg({ type: "text", text: { body: "hola" } })] });
      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({ messages: 0, errors: 1 });
    } finally {
      fake.db.ref = realRef;
    }
  });
  it("answers 200 when one message failed and another was stored, so the stored one is not redelivered", async () => {
    const realRef = fake.db.ref;
    const OTHER = "+34600999888";
    fake.db.ref = (path) => { if (path.includes(OTHER)) throw new Error("refused"); return realRef(path); };
    try {
      const res = await deliver({ messages: [
        inMsg({ id: "wamid.OK", type: "text", text: { body: "hola" } }),
        inMsg({ id: "wamid.BAD", from: "34600999888", type: "text", text: { body: "hola" } }),
      ] });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ messages: 1, errors: 1 });
    } finally {
      fake.db.ref = realRef;
    }
  });
});

// ── v18.9.0 — coexistence: the field dispatch and the number guard ──────────
// A coexistence number sends four more fields to the same URL; each change is
// dispatched on its `field`, and a change for a number that is not the
// restaurant's is ignored before anything reads it.
const change = (field, value) => JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field, value: Object.assign({ messaging_product: "whatsapp" }, value) }] }],
});
const deliverChange = (field, value) => deliver(null, { raw: change(field, value) });
const forNumber = (id) => ({ metadata: { display_phone_number: "34600000000", phone_number_id: id } });
const hola = (extra) => Object.assign({ messages: [inMsg({ type: "text", text: { body: "hola" } })] }, extra);

describe("wa-inbound — dispatch by field (v18.9.0)", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("a field the webhook does not handle is counted as ignored, answered 200, and writes nothing", async () => {
    const res = await deliverChange("message_template_status_update", { event: "APPROVED" });
    expect([res.statusCode, res.body]).toMatchObject([200, { ok: true, ignored: 1, messages: 0 }]);
    expect(fake.state.writes).toEqual([]);
  });
  it("a change with no field reads as `messages`, the one field there was", async () => {
    const res = await deliver(null, { raw: JSON.stringify({ entry: [{ changes: [{ value: hola() }] }] }) });
    expect(res.body).toMatchObject({ messages: 1 });
    expect(inbound()).toHaveLength(1);
  });
  it("`value.messages` under another field never takes the inbound road: no auto-reply, no parse", async () => {
    await deliverChange("history", hola());
    expect(msgsAt(KEY).filter((m) => m.isAutoAck)).toEqual([]);
    expect(scheduled).toEqual([]);
  });
});

describe("wa-inbound — the number guard (v18.9.0)", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("with META_PHONE_NUMBER_ID set, a change for another number is ignored and writes nothing", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "111");
    const res = await deliver(hola(forNumber("222")));
    expect(res.body).toMatchObject({ ignored: 1, messages: 0 });
    expect(fake.state.writes).toEqual([]);
  });
  it("a change for the configured number, or with no number on it, is stored", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "111");
    expect((await deliver(hola(forNumber("111")))).body).toMatchObject({ messages: 1, ignored: 0 });
    expect((await deliver(hola({ messages: [inMsg({ id: "wamid.IN2", type: "text", text: { body: "otra" } })] }))).body)
      .toMatchObject({ messages: 1, ignored: 0 });
  });
  it("the number Embedded Signup connected is accepted before the env var names it", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "111");
    fake.state.tree = { waLink: { status: "connected", phoneNumberId: "333" } };
    expect((await deliver(hola(forNumber("333")))).body).toMatchObject({ messages: 1 });
    expect((await deliver(hola(forNumber("222")))).body).toMatchObject({ ignored: 1 });
  });
  it("with nothing configured anywhere, every number is accepted (the mock sandbox, the harness)", async () => {
    expect((await deliver(hola(forNumber("whatever")))).body).toMatchObject({ messages: 1 });
  });
  it("a delivery whose number cannot be checked is an error, so Meta sends it again", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "111");
    const realRef = fake.db.ref;
    fake.db.ref = (path) => { if (path === "waLink") throw new Error("database unreachable"); return realRef(path); };
    try {
      const res = await deliver(hola(forNumber("333")));
      expect([res.statusCode, res.body]).toMatchObject([500, { errors: 1, messages: 0 }]);
    } finally {
      fake.db.ref = realRef;
    }
  });
});

// ── Phase 2: the phone's contacts (smb_app_state_sync) ──────────────────────
const contactItem = (phone, action, full, first, secs) => ({
  type: "contact", action,
  contact: { full_name: full, first_name: first, phone_number: phone },
  metadata: { timestamp: String(secs || Math.floor(Date.now() / 1000) - 60) },
});
const syncContacts = (items) => deliverChange("smb_app_state_sync", Object.assign(forNumber("111"), { state_sync: items }));

describe("wa-inbound — the phone's contacts (v18.9.0)", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("an add is stored per key, named, and counted; the first batch stamps waLink.contacts.firstAt", async () => {
    const res = await syncContacts([contactItem("34600111222", "add", "Ana López", "Ana"), contactItem("34600999888", "add", "Proveedor Pescado", "")]);
    expect(res.body).toMatchObject({ contacts: 2, errors: 0 });
    expect(fake.read("waContacts/" + KEY)).toMatchObject({ name: "Ana López", first: "Ana" });
    expect(fake.read("waContacts/+34600999888")).toMatchObject({ name: "Proveedor Pescado" });
    expect("first" in fake.read("waContacts/+34600999888")).toBe(false);
    const firstAt = fake.read("waLink/contacts/firstAt");
    expect(firstAt).toBeGreaterThan(0);
    // A later batch does not move the moment the first one landed.
    await syncContacts([contactItem("34600111222", "add", "Ana L.", "Ana")]);
    expect(fake.read("waLink/contacts/firstAt")).toBe(firstAt);
    expect(fake.read("waContacts/" + KEY).name).toBe("Ana L.");
  });
  it("a remove deletes the key and nothing else; the write is per key, never the node", async () => {
    fake.state.tree = { waContacts: { [KEY]: { name: "Ana", at: 1000 }, "+34999": { name: "Pau", at: 1000 } } };
    await syncContacts([contactItem("34600111222", "remove", "Ana", "Ana")]);
    expect(fake.read("waContacts/" + KEY)).toBeUndefined();
    expect(fake.read("waContacts/+34999")).toMatchObject({ name: "Pau" });
    expect(fake.state.writes.filter((w) => w.path === "waContacts")).toEqual([{ op: "update", path: "waContacts", value: { [KEY]: null } }]);
  });
  it("an edit older than what is stored never replaces it (out of order)", async () => {
    const now = Math.floor(Date.now() / 1000);
    fake.state.tree = { waContacts: { [KEY]: { name: "Ana (new)", at: (now - 10) * 1000 } } };
    await syncContacts([contactItem("34600111222", "add", "Ana (old)", "", now - 100)]);
    expect(fake.read("waContacts/" + KEY).name).toBe("Ana (new)");
  });
  it("an item that is not a contact, or has no usable number, writes nothing and is ignored", async () => {
    const res = await syncContacts([{ type: "label", action: "add" }, contactItem("", "add", "Nobody", ""), contactItem("+", "add", "Plus", "")]);
    expect(res.body).toMatchObject({ contacts: 0, ignored: 1 });
    expect(fake.state.writes).toEqual([]);
  });
  it("names are cleaned: control characters out, whitespace collapsed, capped", async () => {
    await syncContacts([contactItem("34600111222", "add", "  Ana\u0000\n  López\t" + "x".repeat(200), "Ana")]);
    const c = fake.read("waContacts/" + KEY);
    expect(c.name.startsWith("Ana López x")).toBe(true);
    expect(c.name.length).toBe(WA_CONTACT_NAME_MAX);
  });
  it("a contact for another number's change is ignored by the guard", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "999");
    const res = await syncContacts([contactItem("34600111222", "add", "Ana", "Ana")]);
    expect(res.body).toMatchObject({ ignored: 1, contacts: 0 });
    expect(fake.read("waContacts/" + KEY)).toBeUndefined();
  });
  it("a failed write is an error, so Meta sends the batch again", async () => {
    fake.state.failWrite = (op, path) => path === "waContacts";
    const res = await syncContacts([contactItem("34600111222", "add", "Ana", "Ana")]);
    expect([res.statusCode, res.body]).toMatchObject([500, { errors: 1 }]);
  });
});

describe("contactPlan / contactPatch", () => {
  const now = 2000000000000;
  it("keys by the normalised number, keeps a nameless contact as saved, and deletes on remove", () => {
    expect(contactPlan(contactItem("34 600-111-222", "add", "", "", 1900000000), now)).toEqual({ phoneKey: KEY, at: 1900000000000, contact: { name: "", at: 1900000000000 } });
    expect(contactPlan(contactItem("34600111222", "remove", "Ana", "", 1900000000), now)).toEqual({ phoneKey: KEY, at: 1900000000000, contact: null });
    expect(contactPlan(contactItem("34600111222", "add", "", "Ana", 1900000000), now).contact).toEqual({ name: "Ana", at: 1900000000000 });
    expect(contactPlan({ type: "contact", contact: "nope" }, now)).toBeNull();
    expect(contactPlan(null, now)).toBeNull();
  });
  it("a timestamp in the future is now, a missing one is now", () => {
    expect(contactPlan(contactItem("34600111222", "add", "Ana", "", 9999999999), now).at).toBe(now);
    expect(contactPlan({ type: "contact", action: "add", contact: { full_name: "Ana", phone_number: "34600111222" } }, now).at).toBe(now);
  });
  it("within one batch the later change to a key wins, in either order", () => {
    const a = contactItem("34600111222", "add", "First", "", 1900000000);
    const b = contactItem("34600111222", "add", "Second", "", 1900000100);
    expect(contactPatch([a, b], {}, now).patch[KEY].name).toBe("Second");
    expect(contactPatch([b, a], {}, now).patch[KEY].name).toBe("Second");
  });
});

describe("numberIsOurs / makeNumberGuard", () => {
  it("decides on the configured id and the connected id, and lets a change with no id through", () => {
    expect(numberIsOurs(null, "111", "333")).toBe(true);
    expect(numberIsOurs("222", null, null)).toBe(true);
    expect(numberIsOurs("111", "111", null)).toBe(true);
    expect(numberIsOurs("333", "111", "333")).toBe(true);
    expect(numberIsOurs("333", null, "333")).toBe(true);
    expect(numberIsOurs("222", "111", "333")).toBe(false);
    expect(numberIsOurs("222", null, "333")).toBe(false);
    expect(numberIsOurs(111, "111", null)).toBe(true); // Meta sends a string; a number is the same id
  });
  it("reads waLink at most once per delivery, and not at all when the env id answers", async () => {
    vi.stubEnv("META_PHONE_NUMBER_ID", "111");
    const readLink = vi.fn(async () => ({ phoneNumberId: "333" }));
    const isOurs = makeNumberGuard(readLink);
    expect(await isOurs(forNumber("111"))).toBe(true);
    expect(readLink).not.toHaveBeenCalled();
    expect(await isOurs(forNumber("222"))).toBe(false);
    expect(await isOurs(forNumber("333"))).toBe(true);
    expect(await isOurs(forNumber("444"))).toBe(false);
    expect(readLink).toHaveBeenCalledTimes(1);
  });
});

// ── Phases 3–4: phone replies (smb_message_echoes), edits and deletes ───────
const echo = (extra) => Object.assign({ from: "34600000000", to: "34600111222", id: "wamid.E1", timestamp: nowSecs(), type: "text", text: { body: "Hola Ana, ¿a qué hora venís?" } }, extra);
const deliverEchoes = (echoes) => deliverChange("smb_message_echoes", Object.assign(forNumber("111"), { message_echoes: echoes }));
const editOf = (orig, body, extra) => inMsg(Object.assign({ id: "wamid.ED1", type: "edit", edit: { original_message_id: orig, message: { type: "text", text: { body } } } }, extra));
const revokeOf = (orig, extra) => inMsg(Object.assign({ id: "wamid.RV1", type: "revoke", revoke: { original_message_id: orig } }, extra));

describe("wa-inbound — phone replies (v18.9.0)", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("an echo is an outgoing message tagged phone, keyed by its wamid; a new conversation is read, settled, with no window", async () => {
    const res = await deliverEchoes([echo()]);
    expect(res.body).toMatchObject({ ok: true, echoes: 1, messages: 0, errors: 0 });
    const msgs = msgsAt(KEY);
    expect(msgs).toHaveLength(1); // no auto-reply beside it
    expect(fake.read("messages/" + KEY + "/wamid_E1")).toMatchObject({
      direction: "out", source: "phone", text: "Hola Ana, ¿a qué hora venís?", status: "sent", isAutoAck: false, providerMsgId: "wamid.E1",
    });
    const c = convAt(KEY);
    expect(c).toMatchObject({ phoneKey: KEY, unread: false, autoAckSent: true, archived: false, lastMessageSnippet: "Hola Ana, ¿a qué hora venís?" });
    expect(c.windowExpiresAt).toBeUndefined();
    expect(scheduled).toEqual([]); // never parsed
  });
  it("an echo marks the conversation read and brings it out of Archived, and leaves the window alone", async () => {
    const win = Date.now() + 5000;
    fake.state.tree = { conversations: { [KEY]: openConv({ unread: true, archived: true, archivedAt: 5, windowExpiresAt: win, lastMessageAt: 1 }) } };
    await deliverEchoes([echo()]);
    expect(convAt(KEY)).toMatchObject({ unread: false, archived: false, windowExpiresAt: win });
    expect(convAt(KEY).archivedAt).toBeUndefined(); // null deletes the key, as in RTDB
  });
  it("a muted conversation (not a customer) stays archived", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ muted: true, archived: true, archivedAt: 5, lastMessageAt: 1 }) } };
    await deliverEchoes([echo()]);
    expect(convAt(KEY)).toMatchObject({ archived: true, archivedAt: 5, unread: false });
  });
  it("an echo delivered late does not make an older reply the conversation's last line", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ lastMessageAt: Date.now(), lastMessageSnippet: "newer" }) } };
    await deliverEchoes([echo({ timestamp: String(Math.floor(Date.now() / 1000) - 3600) })]);
    expect(convAt(KEY).lastMessageSnippet).toBe("newer");
    expect(msgsAt(KEY)).toHaveLength(1);
  });
  // v18.9.0 follow-up: both are left alone, and the second is counted apart,
  // because the rehearsal asks whether Meta ever sends one.
  it("a redelivered echo is skipped, and the echo of a message MGT sent itself is stored nowhere and counted apart", async () => {
    fake.state.tree = { messages: { [KEY]: { out1: { id: "out1", direction: "out", text: "x", ts: 1, providerMsgId: "wamid.MGT" } } } };
    await deliverEchoes([echo()]);
    const res = await deliverEchoes([echo(), echo({ id: "wamid.MGT" })]);
    expect(res.body).toMatchObject({ echoes: 0, skipped: 1, mgtEchoes: 1 });
    expect(msgsAt(KEY)).toHaveLength(2);
  });
  it("a photo sent from the phone keeps its media id, and its caption is the text", async () => {
    await deliverEchoes([echo({ type: "image", image: { id: "123456", mime_type: "image/jpeg", caption: "La terraza" } })]);
    expect(fake.read("messages/" + KEY + "/wamid_E1")).toMatchObject({ text: "La terraza", media: { kind: "image", mediaId: "123456" } });
    expect(convAt(KEY).lastMessageSnippet).toBe("Photo · La terraza");
  });
  // /code-review: every other stored message is capped (an inbound one, an
  // imported one, an edit); a reply typed on the phone was not.
  it("a long phone reply is stored capped, like every other message", async () => {
    await deliverEchoes([echo({ text: { body: "x".repeat(WA_MAX_TEXT_LEN + 500) } })]);
    expect(fake.read("messages/" + KEY + "/wamid_E1").text).toHaveLength(WA_MAX_TEXT_LEN);
  });
  it("an echo with no customer number, or no wamid, is ignored and writes nothing", async () => {
    const res = await deliverEchoes([echo({ to: "" }), echo({ id: "" })]);
    expect(res.body).toMatchObject({ echoes: 0, ignored: 2 });
    expect(fake.state.writes).toEqual([]);
  });
  it("staff deleting a phone reply on the phone empties it on the MGT side too", async () => {
    await deliverEchoes([echo()]);
    const res = await deliverEchoes([echo({ id: "wamid.E2", type: "revoke", revoke: { original_message_id: "wamid.E1" } })]);
    expect(res.body).toMatchObject({ edits: 1, echoes: 0 });
    expect(fake.read("messages/" + KEY + "/wamid_E1")).toMatchObject({ text: WA_REVOKED_OUT, source: "phone" });
    expect(msgsAt(KEY)).toHaveLength(1);
  });
  it("one failing echo is counted and the next is still stored", async () => {
    fake.state.failWrite = (op, path) => path.endsWith("wamid_E1");
    const res = await deliverEchoes([echo(), echo({ id: "wamid.E2" })]);
    expect([res.statusCode, res.body]).toMatchObject([200, { echoes: 1, errors: 1 }]);
  });
});

describe("wa-inbound — a customer edits or deletes a message (v18.9.0)", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("an edit replaces the stored text and marks it edited: no new bubble, no parse, and the list's line follows", async () => {
    await deliver(hola());
    const before = scheduled.length;
    const res = await deliver({ messages: [editOf("wamid.IN1", "hola, mesa para 2")] });
    expect(res.body).toMatchObject({ edits: 1, messages: 0 });
    expect(inbound()).toHaveLength(1);
    expect(inbound()[0]).toMatchObject({ id: "wamid_IN1", text: "hola, mesa para 2" });
    expect(inbound()[0].editedAt).toBeGreaterThan(0);
    expect(scheduled).toHaveLength(before);
    expect(convAt(KEY).lastMessageSnippet).toBe("hola, mesa para 2");
  });
  it("a delete replaces the text with a line saying so and drops the photo; an edit after it changes nothing", async () => {
    await deliver({ messages: [inMsg({ type: "image", image: { id: "123456", mime_type: "image/jpeg", caption: "mi foto" } })] });
    const res = await deliver({ messages: [revokeOf("wamid.IN1")] });
    expect(res.body).toMatchObject({ edits: 1 });
    const [m] = inbound();
    expect(m).toMatchObject({ text: WA_REVOKED_IN });
    expect(m.media).toBeUndefined();
    expect(m.revokedAt).toBeGreaterThan(0);
    expect(convAt(KEY).lastMessageSnippet).toBe(WA_REVOKED_IN);
    expect((await deliver({ messages: [editOf("wamid.IN1", "back again")] })).body).toMatchObject({ edits: 0, skipped: 1 });
    expect(inbound()[0].text).toBe(WA_REVOKED_IN);
  });
  it("an edit whose original was never stored is kept as a new message under the edit's id", async () => {
    const res = await deliver({ messages: [editOf("wamid.GONE", "mesa para 3")] });
    expect(res.body).toMatchObject({ messages: 1, edits: 0 });
    expect(inbound()).toEqual([expect.objectContaining({ id: "wamid_ED1", text: "mesa para 3" })]);
  });
  it("a delete whose original was never stored has nothing to delete", async () => {
    const res = await deliver({ messages: [revokeOf("wamid.GONE")] });
    expect(res.body).toMatchObject({ skipped: 1, messages: 0 });
    expect(fake.state.writes).toEqual([]);
  });
  it("an edit or a delete finds a message by its providerMsgId too", async () => {
    fake.state.tree = { messages: { [KEY]: { in7: { id: "in7", direction: "in", text: "old", ts: 1, providerMsgId: "wamid.X" } } } };
    await deliver({ messages: [editOf("wamid.X", "new")] });
    expect(fake.read("messages/" + KEY + "/in7")).toMatchObject({ text: "new" });
  });
});

describe("echoConvPatch / editedText / editPatch / revokePatch", () => {
  it("the snippet and time move only forward; a muted conversation stays archived", () => {
    expect(echoConvPatch({ lastMessageAt: 100 }, { ts: 50, snippet: "x" })).toEqual({ unread: false, autoAckSent: true });
    expect(echoConvPatch({ lastMessageAt: 100 }, { ts: 100, snippet: "x" })).toMatchObject({ lastMessageAt: 100, lastMessageSnippet: "x" });
    expect(echoConvPatch({ archived: true, muted: true }, { ts: 1, snippet: "x" })).not.toHaveProperty("archived");
    expect(echoConvPatch({ archived: true }, { ts: 1, snippet: "x" })).toMatchObject({ archived: false, archivedAt: null });
  });
  it("replyUnarchives: archived and not muted, and nothing else", () => {
    expect(replyUnarchives({ archived: true })).toBe(true);
    expect(replyUnarchives({ archived: true, muted: true })).toBe(false);
    expect(replyUnarchives({ archived: false })).toBe(false);
    expect(replyUnarchives({ muted: true })).toBe(false);
    expect(replyUnarchives(null)).toBe(false);
  });
  // The rule was written out at four sites and three had dropped the mute, so
  // every place a reply un-archives must ASK it rather than restate it.
  it("every place a reply is written asks replyUnarchives, and none restates the test", () => {
    ["api/wa-send.js", "api/wa-media.js", "src/hooks/useWhatsApp.js", "src/lib/wa-coexist.js"].forEach((f) => {
      const src = stripComments(readFileSync(new URL("../" + f, import.meta.url), "utf8")).join("\n");
      expect(src, f).toMatch(/replyUnarchives\(/);
      expect(src, f).not.toMatch(/\.archived\)\s*\{\s*patch\.archived\s*=\s*false/);
    });
  });
  it("an edit's text is a text's body or a caption, with or without a type on the edited message", () => {
    expect(editedText({ type: "edit", edit: { message: { type: "text", text: { body: "a" } } } })).toBe("a");
    expect(editedText({ type: "edit", edit: { message: { text: { body: "b" } } } })).toBe("b");
    expect(editedText({ type: "edit", edit: { message: { type: "image", image: { caption: "c" } } } })).toBe("c");
    expect(editedText({ type: "edit", edit: { message: { type: "sticker", sticker: {} } } })).toBeNull();
    expect(editedText({ type: "edit" })).toBeNull();
  });
  it("a caption edited away leaves the photo's label; a deleted message takes no edit and no second delete", () => {
    expect(editPatch({ text: "x", media: { kind: "image", mediaId: "1" } }, "  ", 5)).toEqual({ text: "Photo", editedAt: 5 });
    expect(editPatch({ text: "x", revokedAt: 1 }, "y", 5)).toBeNull();
    expect(editPatch({ text: "x" }, null, 5)).toBeNull();
    expect(revokePatch({ direction: "out", text: "x" }, 5)).toEqual({ text: WA_REVOKED_OUT, media: null, revokedAt: 5 });
    expect(revokePatch({ direction: "in", revokedAt: 1 }, 5)).toBeNull();
  });
});

// ── Phase 5: the chats the phone already held (history) ─────────────────────
const BIZ = "34600000000";
const secsAgo = (n) => String(Math.floor(Date.now() / 1000) - n);
const histMsg = (id, from, ago, extra) => Object.assign({ from, id, timestamp: secsAgo(ago), type: "text", text: { body: "msg " + id }, history_context: { status: "READ" } }, extra);
const deliverHistory = (history, extra) => deliverChange("history", Object.assign(forNumber("111"), { history }, extra));
const chunk = (threads, meta) => ({ metadata: Object.assign({ phase: 0, chunk_order: 1, progress: 40 }, meta), threads });
const DAY = 24 * 3600;

describe("wa-inbound — the chats the phone already held (v18.9.0)", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("a recent thread is imported read, settled, with no window, never parsed or answered; progress is recorded", async () => {
    const res = await deliverHistory([chunk([{ id: "34600111222", messages: [
      histMsg("wamid.H1", "34600111222", 7200),
      histMsg("wamid.H2", BIZ, 3600, { history_context: { status: "DELIVERED" } }),
    ] }])]);
    expect(res.body).toMatchObject({ ok: true, history: 2, messages: 0, errors: 0 });
    const [a, b] = msgsAt(KEY);
    expect(a).toMatchObject({ id: "wamid_H1", direction: "in", status: "delivered", imported: true, text: "msg wamid.H1" });
    expect(a.source).toBeUndefined();
    expect(b).toMatchObject({ id: "wamid_H2", direction: "out", source: "phone", status: "delivered", imported: true });
    const c = convAt(KEY);
    expect(c).toMatchObject({ unread: false, autoAckSent: true, archived: false, lastMessageAt: b.ts, createdAt: a.ts, lastMessageSnippet: "msg wamid.H2" });
    expect(c.windowExpiresAt).toBeUndefined();
    expect(msgsAt(KEY).filter((m) => m.isAutoAck)).toEqual([]);
    expect(scheduled).toEqual([]);
    expect(fake.read("waLink/history")).toMatchObject({ progress: 40, phase: 0 });
    // One root update for the thread: its messages and its conversation's fields.
    const root = fake.state.writes.filter((w) => w.op === "update" && w.path === "");
    expect(root).toHaveLength(1);
    expect(Object.keys(root[0].value).every((k) => k.startsWith("messages/" + KEY + "/") || k.startsWith("conversations/" + KEY + "/"))).toBe(true);
  });
  it("a thread with nothing newer than a week goes straight to Archived", async () => {
    await deliverHistory([chunk([{ id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 10 * DAY)] }])]);
    expect(convAt(KEY)).toMatchObject({ archived: true, unread: false });
  });
  it("a resent chunk stores nothing twice", async () => {
    const h = [chunk([{ id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 600)] }])];
    await deliverHistory(h);
    const res = await deliverHistory(h);
    expect([res.statusCode, res.body]).toMatchObject([200, { history: 0 }]);
    expect(msgsAt(KEY)).toHaveLength(1);
  });
  it("into a live conversation: createdAt moves back to the oldest import, nothing else of it moves back", async () => {
    const win = Date.now() + 5000;
    const live = openConv({ createdAt: Date.now() - 60000, lastMessageAt: Date.now() - 1000, lastMessageSnippet: "live", unread: true, windowExpiresAt: win, archived: false });
    fake.state.tree = { conversations: { [KEY]: live } };
    await deliverHistory([chunk([{ id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 30 * DAY)] }])]);
    const c = convAt(KEY);
    expect(c).toMatchObject({ lastMessageSnippet: "live", unread: true, windowExpiresAt: win, archived: false, autoAckSent: true });
    expect(c.createdAt).toBe(msgsAt(KEY)[0].ts);
  });
  it("a photo comes as a placeholder, and its media follows under the same id", async () => {
    await deliverHistory([chunk([{ id: "34600111222", messages: [histMsg("wamid.P1", "34600111222", 600, { type: "media_placeholder", text: undefined })] }])]);
    expect(msgsAt(KEY)[0]).toMatchObject({ text: "Photo or file — open WhatsApp on the phone to see it" });
    const res = await deliverChange("history", Object.assign(forNumber("111"), { messages: [
      { from: "34600111222", id: "wamid.P1", timestamp: secsAgo(600), type: "image", image: { id: "777", mime_type: "image/jpeg", caption: "la mesa" } },
    ] }));
    expect(res.body).toMatchObject({ history: 1, messages: 0 });
    expect(msgsAt(KEY)).toHaveLength(1);
    expect(msgsAt(KEY)[0]).toMatchObject({ text: "la mesa", media: { kind: "image", mediaId: "777" }, imported: true });
  });
  it("media that comes before its thread is stored whole, and the thread leaves it; the restaurant's own goes to its customer", async () => {
    await deliverChange("history", Object.assign(forNumber("111"), { messages: [
      { from: BIZ, to: "34600111222", id: "wamid.P2", timestamp: secsAgo(900), type: "document", document: { id: "778", mime_type: "application/pdf", filename: "carta.pdf" } },
    ] }));
    expect(msgsAt(KEY)[0]).toMatchObject({ direction: "out", source: "phone", media: { kind: "document", filename: "carta.pdf" } });
    // /code-review: with a conversation, so the inbox lists it and the prune
    // reaches it even if its thread never comes.
    expect(convAt(KEY)).toMatchObject({ phoneKey: KEY, unread: false, autoAckSent: true, archived: false, lastMessageAt: msgsAt(KEY)[0].ts, createdAt: msgsAt(KEY)[0].ts });
    await deliverHistory([chunk([{ id: "34600111222", messages: [histMsg("wamid.P2", BIZ, 900, { type: "media_placeholder", text: undefined })] }])]);
    expect(msgsAt(KEY)).toHaveLength(1);
    expect(msgsAt(KEY)[0].media).toMatchObject({ mediaId: "778" });
  });
  it("a photo over a week old that comes before its thread does not keep a recent thread in Archived", async () => {
    await deliverChange("history", Object.assign(forNumber("111"), { messages: [
      { from: "34600111222", id: "wamid.P3", timestamp: secsAgo(10 * DAY), type: "image", image: { id: "779", mime_type: "image/jpeg" } },
    ] }));
    expect(convAt(KEY)).toMatchObject({ archived: true });
    await deliverHistory([chunk([{ id: "34600111222", messages: [
      histMsg("wamid.P3", "34600111222", 10 * DAY, { type: "media_placeholder", text: undefined }),
      histMsg("wamid.P4", "34600111222", DAY),
    ] }])]);
    expect(convAt(KEY)).toMatchObject({ archived: false, lastMessageSnippet: "msg wamid.P4" });
    expect("archivedAt" in convAt(KEY)).toBe(false);
    expect(msgsAt(KEY)).toHaveLength(2);
  });
  it("a business that declined to share its history is recorded, and nothing is imported", async () => {
    const res = await deliverHistory([{ errors: [{ code: 2593109, title: "History sharing declined" }] }]);
    expect(res.body).toMatchObject({ ok: true, events: 1, history: 0 });
    expect(fake.read("waLink/history")).toMatchObject({ declined: true });
    expect(fake.read("conversations")).toBeUndefined();
  });
  it("an edit, a delete and a message with no id are not imported", async () => {
    await deliverHistory([chunk([{ id: "34600111222", messages: [
      histMsg("", "34600111222", 600),
      histMsg("wamid.E", "34600111222", 600, { type: "edit", edit: { original_message_id: "x", message: { type: "text", text: { body: "y" } } } }),
      histMsg("wamid.R", "34600111222", 600, { type: "revoke", revoke: { original_message_id: "x" } }),
    ] }])]);
    expect(fake.read("messages")).toBeUndefined();
  });
  it("a chunk with a thread that failed is answered 500, and its resend imports that thread without doubling the others", async () => {
    const h = [chunk([
      { id: "34600111222", messages: [histMsg("wamid.A1", "34600111222", 600)] },
      { id: "34600999888", messages: [histMsg("wamid.B1", "34600999888", 600)] },
    ])];
    const realRef = fake.db.ref;
    fake.db.ref = (path) => { if (path === "messages/+34600999888") throw new Error("database unreachable"); return realRef(path); };
    let res;
    try { res = await deliverHistory(h); } finally { fake.db.ref = realRef; }
    expect([res.statusCode, res.body]).toMatchObject([500, { history: 1, errors: 1 }]);
    res = await deliverHistory(h);
    expect([res.statusCode, res.body]).toMatchObject([200, { history: 1, errors: 0 }]);
    expect(msgsAt(KEY)).toHaveLength(1);
    expect(msgsAt("+34600999888")).toHaveLength(1);
  });
  // /code-review: the progress write threw out of the handler, so the second
  // chunk was never read, and with the first chunk's thread counted the
  // delivery was a 200: Meta never sent the second chunk again.
  it("a progress record that fails does not stop the chunks after it, and the delivery is sent again", async () => {
    const h = [
      chunk([{ id: "34600111222", messages: [histMsg("wamid.A1", "34600111222", 600)] }], { progress: 40 }),
      chunk([{ id: "34600999888", messages: [histMsg("wamid.B1", "34600999888", 600)] }], { progress: 80, chunk_order: 2 }),
    ];
    fake.state.failWrite = (op, path) => op === "transaction" && path === "waLink/history";
    let res = await deliverHistory(h);
    expect([res.statusCode, res.body]).toMatchObject([500, { history: 2, errors: 2 }]);
    expect(msgsAt("+34600999888")).toHaveLength(1);
    fake.state.failWrite = null;
    res = await deliverHistory(h);
    expect([res.statusCode, res.body]).toMatchObject([200, { history: 0, errors: 0 }]);
    expect(fake.read("waLink/history")).toMatchObject({ progress: 80 });
    expect(msgsAt(KEY)).toHaveLength(1);
  });
  it("a declined share that cannot be recorded is answered 500, so Meta sends it again", async () => {
    fake.state.failWrite = (op, path) => op === "transaction" && path === "waLink/history";
    const res = await deliverHistory([{ errors: [{ code: 2593109, title: "History sharing declined" }] }]);
    expect([res.statusCode, res.body]).toMatchObject([500, { events: 0, errors: 1 }]);
  });
});

// ── v18.9.0 follow-up: what a coexistence delivery measures ─────────────────
// The rehearsal's two questions (does an echo ever name a message MGT sent; how
// big and how slow is a history delivery) are answered by one log line per
// delivery, for watching live, and by `waLink/measured`, which outlasts
// Vercel's hour of logs. Counts only: the line's shape below admits nothing but
// numbers and this code's own names.
const LINE = /^\[wa-inbound\] coexistence delivery status=\d{3} bytes=\d+ ms=\d+ fields=[a-z_]+:\d+(,[a-z_]+:\d+)*( threads=\d+ messages=\d+)? counts=([a-zA-Z]+:\d+(,[a-zA-Z]+:\d+)*|none)$/;
const coexistLines = () => console.info.mock.calls.map((c) => c.join(" ")).filter((l) => l.includes("coexistence delivery"));
const mgtSent = () => ({ messages: { [KEY]: { out1: { id: "out1", direction: "out", text: "x", ts: 1, providerMsgId: "wamid.MGT" } } } });
const leaves = (o) => Object.values(o).flatMap((v) => (v && typeof v === "object" ? leaves(v) : [v]));

describe("wa-inbound — what a coexistence delivery measures (v18.9.0 follow-up)", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("a history delivery logs one line and records its size, time, threads and messages on waLink/measured", async () => {
    const body = change("history", Object.assign(forNumber("111"), { history: [chunk([
      { id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 600), histMsg("wamid.H2", BIZ, 300)] },
      { id: "34600999888", messages: [histMsg("wamid.H3", "34600999888", 600)] },
    ])] }));
    const res = await deliver(null, { raw: body });
    expect(res.statusCode).toBe(200);
    const lines = coexistLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(LINE);
    expect(lines[0]).toMatch(/ fields=history:1 threads=2 messages=3 counts=history:3$/);
    const m = fake.read("waLink/measured");
    expect(m).toMatchObject({ historyBegun: 1, historyDeliveries: 1, historyLargest: { bytes: Buffer.byteLength(body), threads: 2, messages: 3, at: expect.any(Number) } });
    expect(lines[0]).toContain("status=200 bytes=" + Buffer.byteLength(body) + " ms=" + m.historyLargest.ms + " ");
    expect(m.historySlowest).toEqual(m.historyLargest);
    expect(Object.keys(m).sort()).toEqual(["historyBegun", "historyChunks", "historyDeliveries", "historyLargest", "historySlowest"]);
    expect(m.historyChunks).toEqual({ p0: { c1: 1 } });
  });
  it("an echo of a message MGT sent is logged and recorded; a phone reply is logged only", async () => {
    fake.state.tree = mgtSent();
    await deliverEchoes([echo()]);
    expect(coexistLines()).toEqual([expect.stringMatching(/ fields=smb_message_echoes:1 counts=echoes:1$/)]);
    expect(fake.read("waLink/measured")).toBeUndefined();
    await deliverEchoes([echo({ id: "wamid.MGT" })]);
    await deliverEchoes([echo({ id: "wamid.MGT" })]);
    expect(coexistLines().slice(1)).toEqual([expect.stringMatching(/ counts=mgtEchoes:1$/), expect.stringMatching(/ counts=mgtEchoes:1$/)]);
    expect(fake.read("waLink/measured")).toEqual({ mgtEchoes: 2, mgtEchoAt: expect.any(Number) });
    expect(msgsAt(KEY)).toHaveLength(2); // the echo of MGT's own is stored nowhere
  });
  it("nothing a customer said or is reaches the line or the record", async () => {
    fake.state.tree = mgtSent();
    await syncContacts([contactItem("34600111222", "add", "Ana López", "Ana")]);
    await deliverEchoes([echo(), echo({ id: "wamid.MGT" })]);
    await deliverHistory([chunk([{ id: "34600999888", messages: [histMsg("wamid.H9", "34600999888", 600, { text: { body: "Mesa para 4 el viernes" } })] }])]);
    const lines = coexistLines();
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => LINE.test(l))).toBe(true);
    const measured = fake.read("waLink/measured");
    expect(leaves(measured).every((v) => typeof v === "number")).toBe(true);
    for (const s of lines.concat(JSON.stringify(measured))) {
      for (const secret of ["600111222", "600999888", "34600000000", "Ana", "López", "Hola", "Mesa", "wamid", "WABA", "MGT"]) {
        expect(s, secret).not.toContain(secret);
      }
    }
  });
  it("a delivery of messages alone, and a change for another number, are not measured", async () => {
    await deliver(hola());
    vi.stubEnv("META_PHONE_NUMBER_ID", "111");
    const res = await deliverChange("history", Object.assign(forNumber("222"), { history: [chunk([{ id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 600)] }])] }));
    expect(res.body).toMatchObject({ ignored: 1, history: 0 });
    expect(coexistLines()).toEqual([]);
    expect(fake.read("waLink/measured")).toBeUndefined();
  });
  it("a contacts delivery is logged and not recorded", async () => {
    await syncContacts([contactItem("34600111222", "add", "Ana López", "Ana")]);
    expect(coexistLines()).toEqual([expect.stringMatching(/ fields=smb_app_state_sync:1 counts=contacts:1$/)]);
    expect(fake.read("waLink/measured")).toBeUndefined();
  });
  it("a history delivery answered 500 says so in its line and is counted as failed", async () => {
    const realRef = fake.db.ref;
    fake.db.ref = (path) => { if (path === "messages/+34600999888") throw new Error("database unreachable"); return realRef(path); };
    let res;
    try {
      res = await deliverHistory([chunk([{ id: "34600999888", messages: [histMsg("wamid.B1", "34600999888", 600)] }])]);
    } finally { fake.db.ref = realRef; }
    expect(res.statusCode).toBe(500);
    expect(coexistLines()).toEqual([expect.stringMatching(/^\[wa-inbound\] coexistence delivery status=500 .* counts=errors:1$/)]);
    expect(fake.read("waLink/measured")).toMatchObject({ historyBegun: 1, historyDeliveries: 1, historyFailed: 1 });
    expect(fake.read("waLink/measured").historyChunks).toBeUndefined(); // Meta sends it again: the resend lists it
  });
  // /code-review: a body over the 4.5 MB cap is refused before the function
  // runs, so the record lists the chunks that DID land; a gap is one that did not.
  it("the chunks that landed are listed per phase with how often, so a gap in their numbers is one that never did", async () => {
    await deliverHistory([chunk([{ id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 600)] }])]);
    await deliverHistory([
      chunk([{ id: "34600999888", messages: [histMsg("wamid.H2", "34600999888", 600)] }], { chunk_order: 3, progress: 90 }),
      chunk([{ id: "34600999777", messages: [histMsg("wamid.H3", "34600999777", 900)] }], { phase: 1, chunk_order: 1, progress: 100 }),
    ]);
    await deliverHistory([chunk([{ id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 600)] }])]); // chunk 1 again
    expect(fake.read("waLink/measured").historyChunks).toEqual({ p0: { c1: 2, c3: 1 }, p1: { c1: 1 } });
  });
  it("a chunk whose numbers are not whole numbers in range, and a declined share, are not listed", async () => {
    await deliverHistory([
      chunk([{ id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 600)] }], { phase: "zero", chunk_order: 2 }),
      chunk([{ id: "34600999888", messages: [histMsg("wamid.H2", "34600999888", 600)] }], { chunk_order: 1.5 }),
      { metadata: { phase: 0, chunk_order: 4 }, errors: [{ code: 2593109 }] },
    ]);
    expect(fake.read("waLink/measured")).toMatchObject({ historyBegun: 1, historyDeliveries: 1 });
    expect(fake.read("waLink/measured").historyChunks).toBeUndefined();
    expect([chunkKeys({ metadata: { phase: 2, chunk_order: 7 } }), chunkKeys({ metadata: { phase: 10, chunk_order: 1 } }), chunkKeys({ metadata: { phase: 0, chunk_order: -1 } }), chunkKeys({})])
      .toEqual([{ phase: "p2", chunk: "c7" }, null, null, null]);
  });
  // /code-review: the record is written at the end of the handler, so an
  // invocation the time limit ends would leave nothing; its start is recorded.
  it("a history delivery that never answers, as one the time limit ends, still leaves its start on the record", async () => {
    const realRef = fake.db.ref;
    // The thread's read never comes back, so the handler never reaches its end.
    fake.db.ref = (path) => (path === "messages/+34600111222" ? { get: () => new Promise(() => {}) } : realRef(path));
    try {
      let answered = false;
      deliverHistory([chunk([{ id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 600)] }])]).then(() => { answered = true; });
      await vi.waitFor(() => expect(fake.read("waLink/measured")).toEqual({ historyBegun: 1 }));
      expect(answered).toBe(false);
      expect(coexistLines()).toEqual([]);
    } finally { fake.db.ref = realRef; }
  });
  it("a record that cannot be written leaves the delivery's answer and what it stored alone", async () => {
    fake.state.failWrite = (op, path) => op === "transaction" && path === "waLink/measured";
    const res = await deliverHistory([chunk([{ id: "34600111222", messages: [histMsg("wamid.H1", "34600111222", 600)] }])]);
    expect([res.statusCode, res.body]).toMatchObject([200, { history: 1, errors: 0 }]);
    expect(msgsAt(KEY)).toHaveLength(1);
    expect(coexistLines()).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/measures were not recorded/), "database unavailable");
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/start was not recorded/), "database unavailable");
  });
  it("measuredAfter: deliveries and failures add up, the largest and the slowest are kept apart, a tie keeps the first", () => {
    let m = measuredAfter(null, { history: true, failed: false, bytes: 100, ms: 900, threads: 1, messages: 2 }, 1);
    m = measuredAfter(m, { history: true, failed: true, bytes: 5000, ms: 300, threads: 4, messages: 40 }, 2);
    m = measuredAfter(m, { history: true, failed: false, bytes: 5000, ms: 900, threads: 9, messages: 9 }, 3);
    expect(m).toEqual({
      historyDeliveries: 3, historyFailed: 1,
      historyLargest: { bytes: 5000, ms: 300, threads: 4, messages: 40, at: 2 },
      historySlowest: { bytes: 100, ms: 900, threads: 1, messages: 2, at: 1 },
    });
    const before = JSON.stringify(m);
    expect(measuredAfter(m, { mgtEchoes: 2 }, 5)).toEqual(Object.assign({}, m, { mgtEchoes: 2, mgtEchoAt: 5 }));
    expect(measuredAfter(m, { history: false, mgtEchoes: 0 }, 6)).toEqual(m);
    expect(JSON.stringify(m)).toBe(before); // never changes what it was given
    const listed = measuredAfter(m, { history: true, failed: false, bytes: 1, ms: 1, threads: 1, messages: 1, chunks: [{ phase: "p0", chunk: "c2" }] }, 4);
    expect(measuredAfter(listed, { history: true, failed: false, bytes: 1, ms: 1, threads: 1, messages: 1, chunks: [{ phase: "p0", chunk: "c2" }, { phase: "p1", chunk: "c1" }] }, 5).historyChunks)
      .toEqual({ p0: { c2: 2 }, p1: { c1: 1 } });
    expect(listed.historyChunks).toEqual({ p0: { c2: 1 } }); // the next one copied, never changed it
    expect(measuredAfter(m, { history: true, failed: true, bytes: 1, ms: 1, threads: 1, messages: 1, chunks: [{ phase: "p0", chunk: "c2" }] }, 6).historyChunks).toBeUndefined();
    expect(beganAfter(null)).toEqual({ historyBegun: 1 });
    expect(beganAfter(beganAfter(m))).toEqual(Object.assign({}, m, { historyBegun: 2 }));
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe("historyConvPatch / historyProgress / historyStatus", () => {
  const now = 2000000000000;
  it("a new conversation is archived only when its newest message is over a week old", () => {
    expect(historyConvPatch(null, { phoneKey: KEY, oldest: 1, newest: now - WA_IMPORT_ARCHIVE_MS + 1, snippet: "x", now })).toMatchObject({ archived: false, archivedAt: null });
    expect(historyConvPatch(null, { phoneKey: KEY, oldest: 1, newest: now - WA_IMPORT_ARCHIVE_MS - 1, snippet: "x", now })).toMatchObject({ archived: true, archivedAt: now });
  });
  it("an existing conversation's createdAt only moves back, its time only forward", () => {
    expect(historyConvPatch({ createdAt: 50, lastMessageAt: 500 }, { oldest: 10, newest: 100, snippet: "x", now })).toEqual({ autoAckSent: true, createdAt: 10 });
    expect(historyConvPatch({ createdAt: 5, lastMessageAt: 50 }, { oldest: 10, newest: 100, snippet: "x", now })).toEqual({ autoAckSent: true, lastMessageAt: 100, lastMessageSnippet: "x" });
  });
  it("archived for being old, it comes back out when the import brings a message inside the week; a person's archive and a mute stay", () => {
    const old = now - WA_IMPORT_ARCHIVE_MS - 1;
    const recent = now - WA_IMPORT_ARCHIVE_MS + 1;
    const o = { oldest: old, newest: recent, snippet: "x", now };
    expect(historyConvPatch({ createdAt: old, lastMessageAt: old, archived: true, archivedAt: now }, o)).toMatchObject({ archived: false, archivedAt: null });
    expect(historyConvPatch({ createdAt: old, lastMessageAt: old, archived: true, muted: true }, o)).not.toHaveProperty("archived");
    expect(historyConvPatch({ createdAt: old, lastMessageAt: recent - 1, archived: true }, o)).not.toHaveProperty("archived");
    expect(historyConvPatch({ createdAt: old, lastMessageAt: old - 1, archived: true }, { oldest: old, newest: old, snippet: "x", now })).not.toHaveProperty("archived");
  });
  it("progress and phase only move forward, and done is stamped once at 100", () => {
    const a = historyProgress(null, { progress: 60, phase: 1 }, 1);
    expect(historyProgress(a, { progress: 40, phase: 0 }, 2)).toMatchObject({ progress: 60, phase: 1, at: 2 });
    const done = historyProgress(a, { progress: 100, phase: 2 }, 3);
    expect(done.doneAt).toBe(3);
    expect(historyProgress(done, { progress: 100 }, 4).doneAt).toBe(3);
    expect(historyProgress(null, { progress: 250 }, 1).progress).toBe(100);
  });
  it("a new request drops what an earlier one recorded, and keeps what its own webhooks wrote first", () => {
    expect(historyRequested({ requestId: "old", declined: true, progress: 100, doneAt: 3, at: 3 }, "new", 10)).toEqual({ requestId: "new", requestedAt: 10 });
    expect(historyRequested({ progress: 40, phase: 0, at: 12 }, "new", 10)).toEqual({ progress: 40, phase: 0, at: 12, requestId: "new", requestedAt: 10 });
    expect(historyRequested(null, "new", 10)).toEqual({ requestId: "new", requestedAt: 10 });
  });
  it("the phone's statuses read as this app's; a customer's message is delivered", () => {
    expect(historyStatus({ history_context: { status: "PLAYED" } }, false)).toBe("read");
    expect(historyStatus({ history_context: { status: "error" } }, false)).toBe("failed");
    expect(historyStatus({}, false)).toBe("sent");
    expect(historyStatus({ history_context: { status: "READ" } }, true)).toBe("delivered");
  });
});

// ── Phase 6: "Not a customer" ───────────────────────────────────────────────
describe("wa-inbound and the simulator — a muted conversation (v18.9.0)", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));
  const muted = () => ({ conversations: { [KEY]: { phoneKey: KEY, autoAckSent: true, muted: true, archived: true, archivedAt: 9, createdAt: 5 } } });

  it("the webhook stores the message and schedules no parse", async () => {
    fake.state.tree = muted();
    const res = await deliver({ messages: [inMsg({ type: "text", text: { body: "Mesa para 4 mañana" } })] });
    expect(res.body).toMatchObject({ messages: 1 });
    expect(inbound()).toHaveLength(1);
    expect(scheduled).toEqual([]);
    expect(convAt(KEY)).toMatchObject({ archived: true, unread: false });
  });
  it("the simulator's inbound schedules no parse either", async () => {
    fake.state.tree = muted();
    let later = null;
    const r = await injectSimInbound({ phone: KEY, text: "Mesa para 4 personas mañana a las 21:00", name: "Sim" }, (p) => { later = p; });
    expect(r).toMatchObject({ skipped: false, muted: true });
    expect(later).toBeNull();
  });
});

// ── Phase 7: the connection itself (account_update) ─────────────────────────
const accountEvent = (event, info) => deliverChange("account_update", Object.assign({ phone_number: "34600000000", event }, info ? { disconnection_info: info } : {}));

describe("wa-inbound — the connection's own events (v18.9.0)", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));
  const linked = () => ({ waLink: { status: "connected", wabaId: "WABA", phoneNumberId: "111" } });

  it("a disconnection of the connected account is recorded: status, why, and the last event", async () => {
    fake.state.tree = linked();
    const res = await accountEvent("PARTNER_REMOVED", { reason: "USER_ACTION", initiated_by: "BUSINESS" });
    expect(res.body).toMatchObject({ ok: true, events: 1 });
    const l = fake.read("waLink");
    expect(l).toMatchObject({ status: "disconnected", wabaId: "WABA", phoneNumberId: "111" });
    expect(l.disconnect).toMatchObject({ event: "PARTNER_REMOVED", reason: "USER_ACTION", initiatedBy: "BUSINESS" });
    expect(l.lastEvent).toEqual(l.disconnect);
  });
  it("another event keeps the reason staff are shown; a reconnection clears it", async () => {
    fake.state.tree = linked();
    await accountEvent("ACCOUNT_OFFBOARDED");
    await accountEvent("VERIFIED_ACCOUNT");
    expect(fake.read("waLink")).toMatchObject({ status: "disconnected", disconnect: { event: "ACCOUNT_OFFBOARDED" }, lastEvent: { event: "VERIFIED_ACCOUNT" } });
    await accountEvent("ACCOUNT_RECONNECTED");
    const l = fake.read("waLink");
    expect(l.status).toBe("connected");
    expect(l.disconnect).toBeUndefined();
  });
  it("an event about another account, or with nothing connected, is ignored and writes nothing", async () => {
    fake.state.tree = { waLink: { status: "connected", wabaId: "OTHER" } };
    expect((await accountEvent("PARTNER_REMOVED")).body).toMatchObject({ ignored: 1, events: 0 });
    fake.state.tree = {};
    expect((await accountEvent("PARTNER_REMOVED")).body).toMatchObject({ ignored: 1, events: 0 });
    expect(fake.state.writes).toEqual([]);
  });
  it("a change with no event is ignored", async () => {
    fake.state.tree = linked();
    expect((await deliverChange("account_update", { phone_number: "34600000000" })).body).toMatchObject({ ignored: 1 });
  });
  it("the banner's sentence names the event in words and the reason as given", () => {
    expect(disconnectSentence({ event: "PARTNER_REMOVED", reason: "USER_ACTION" })).toMatch(/^WhatsApp is disconnected from MGT: the connection was removed .* \(user action\)\. Replies from MGT won't send/);
    expect(disconnectSentence({ event: "ACCOUNT_OFFBOARDED" })).toMatch(/opened at least every 14 days/);
    expect(disconnectSentence(null)).toMatch(/Meta ended the connection/);
  });
});

describe("inboundContent", () => {
  it("a text that is only spaces is stored and not parsed", () => {
    expect(inboundContent({ type: "text", text: { body: "  " } })).toEqual({ text: "  ", media: null, snippet: "  ", parseText: null });
  });
  it("an audio's caption, should one ever arrive, is not read", () => {
    expect(inboundContent({ type: "audio", audio: { id: "1", caption: "hola" } })).toMatchObject({ text: "Audio", parseText: null });
  });
  it("a message only the Business app can show (131060) says so; another unsupported one is a message to read on the phone", () => {
    expect(inboundContent({ type: "unsupported", errors: [{ code: 131060, title: "Unsupported" }] })).toEqual({ text: WA_UNSUPPORTED_LINE, media: null, snippet: WA_UNSUPPORTED_LINE, parseText: null });
    expect(inboundContent({ type: "unsupported", errors: [{ code: 131051 }] }).text).toBe("Message — open WhatsApp on the phone to see it");
  });
  it("a message with no type at all is a message to read on the phone", () => {
    expect(inboundContent({}).text).toBe("Message — open WhatsApp on the phone to see it");
    expect(inboundContent(null).text).toBe("Message — open WhatsApp on the phone to see it");
  });
});

// ── api/wa-sim-*.js — the simulator's three endpoints (v18.8.0) ──────────────
describe.each([
  ["wa-sim-inbound", simInboundHandler, { phone: KEY, text: "hola" }],
  ["wa-sim-suggest", simSuggestHandler, { history: [] }],
  ["wa-sim-generate", simGenerateHandler, {}],
])("%s — the kill switch, then the gate", (name, handler, body) => {
  it("answers 404 unless WA_SIM_ENABLED is exactly \"1\", before the method and before auth", async () => {
    for (const v of [undefined, "", "0", "true", "yes"]) {
      vi.stubEnv("WA_SIM_ENABLED", v);
      for (const method of ["GET", "POST"]) {
        for (const token of [undefined, "staff", "nonsense"]) {
          const res = await call(handler, { method, token, body });
          expect([v, method, token, res.statusCode]).toEqual([v, method, token, 404]);
        }
      }
    }
    expect(fake.state.writes).toEqual([]);
  });
  it("once enabled: 405 to GET, 401 without a token or with a bad one, 403 off the allow-list", async () => {
    vi.stubEnv("WA_SIM_ENABLED", "1");
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    expect((await call(handler, { method: "GET", token: "staff", body })).statusCode).toBe(405);
    expect((await call(handler, { body })).statusCode).toBe(401);
    expect((await call(handler, { token: "nonsense", body })).statusCode).toBe(401);
    expect((await call(handler, { token: "stranger", body })).statusCode).toBe(403);
    expect((await call(handler, { token: "unverified", body })).statusCode).toBe(403);
    expect(fake.state.writes).toEqual([]);
  });
});

describe("the simulator endpoints, enabled and signed in", () => {
  beforeEach(() => vi.stubEnv("WA_SIM_ENABLED", "1"));

  it("wa-sim-inbound: 400 without a phone or a text, and stores one that has both", async () => {
    expect((await call(simInboundHandler, { token: "staff", body: { text: "hola" } })).statusCode).toBe(400);
    expect((await call(simInboundHandler, { token: "staff", body: { phone: KEY, text: "  " } })).statusCode).toBe(400);
    expect(fake.state.writes).toEqual([]);
    const res = await call(simInboundHandler, { token: "staff", body: { phone: KEY, text: "hola", name: "Sim" } });
    expect([res.statusCode, res.body]).toEqual([200, { ok: true, phoneKey: KEY, skipped: false }]);
    expect(inbound()[0].text).toBe("hola");
  });
  // v18.8.0 phase 6: the customer's photo, voice note or PDF, from the panel.
  it("wa-sim-inbound: a media message is a KIND, with the id minted here and the text as its caption", async () => {
    const res = await call(simInboundHandler, { token: "staff", body: { phone: KEY, text: "  La terraza  ", media: "image" } });
    expect([res.statusCode, res.body]).toEqual([200, { ok: true, phoneKey: KEY, skipped: false }]);
    const [m] = inbound();
    expect(m.text).toBe("La terraza");
    expect(m.media).toEqual({ kind: "image", mediaId: m.media.mediaId, mime: "image/jpeg" });
    expect(m.media.mediaId).toMatch(/^MOCK\.image\.[a-z0-9]+$/);
    // A caption is parsed, as a webhook's is (one job handed to waitUntil).
    expect(convAt(KEY).lastMessageSnippet).toBe("Photo · La terraza");
    expect(scheduled).toHaveLength(1);
  });
  it("wa-sim-inbound: a voice note needs no text, carries none, and is not parsed", async () => {
    const res = await call(simInboundHandler, { token: "staff", body: { phone: KEY, text: "ignored", media: "audio" } });
    expect(res.statusCode).toBe(200);
    const [m] = inbound();
    expect([m.text, m.media.kind, m.media.voice, m.media.mime]).toEqual(["Voice message", "audio", true, "audio/ogg; codecs=opus"]);
    expect("parsing" in convAt(KEY)).toBe(false);
    expect(scheduled).toHaveLength(0);
    expect((await call(simInboundHandler, { token: "staff", body: { phone: KEY, media: "document" } })).statusCode).toBe(200);
    expect(inbound().map((x) => x.text)).toContain("Document: menu-grupos-2026.pdf");
    expect(scheduled).toHaveLength(0);
  });
  it("wa-sim-inbound: 400 to a media that is not one of the three kinds, an id included, and writes nothing", async () => {
    for (const media of ["video", "__proto__", "toString", "", 7, { kind: "image", mediaId: "1234567890" }]) {
      const res = await call(simInboundHandler, { token: "staff", body: { phone: KEY, text: "x", media } });
      expect([String(media), res.statusCode]).toEqual([String(media), 400]);
    }
    expect(fake.state.writes).toEqual([]);
  });
  it("wa-media answers the simulator's voice note with the bundled sample while sending is mock", async () => {
    await call(simInboundHandler, { token: "staff", body: { phone: KEY, media: "audio" } });
    const [m] = inbound();
    const res = await mediaCall({ query: { phoneKey: KEY, msgId: m.id } });
    expect([res.statusCode, res.headers["content-type"]]).toEqual([200, "audio/ogg; codecs=opus"]);
    expect(res.bytes.subarray(0, 4).toString("latin1")).toBe("OggS");
  });
  it("wa-sim-suggest: 400 without a history, and 400 naming the key when Gemini has none", async () => {
    expect((await call(simSuggestHandler, { token: "staff", body: {} })).statusCode).toBe(400);
    const res = await call(simSuggestHandler, { token: "staff", body: { history: [] } });
    expect([res.statusCode, res.body.error]).toEqual([400, "GEMINI_API_KEY not set"]);
  });
  it("wa-sim-generate: 400 naming the key when Gemini has none, and writes nothing", async () => {
    const res = await call(simGenerateHandler, { token: "staff", body: { hint: "x" } });
    expect([res.statusCode, res.body.error]).toEqual([400, "GEMINI_API_KEY not set"]);
    expect(fake.state.writes).toEqual([]);
  });
});

// ── api/wa-sim-inbound.js — the Business app's events (v18.9.0) ──────────────
describe("wa-sim-inbound — the WhatsApp Business app's events (v18.9.0)", () => {
  beforeEach(() => vi.stubEnv("WA_SIM_ENABLED", "1"));
  const ev = (event, extra) => call(simInboundHandler, { token: "staff", body: Object.assign({ event }, extra || {}) });
  const REAL = { status: "connected", wabaId: "102030405060", phoneNumberId: "908070605040" };
  const R = "+" + SIM_HISTORY_RECENT;
  const O = "+" + SIM_HISTORY_OLD;

  it("400 to an event it does not know, and to a phone's event with no phone or no text: a body with an event is never a message", async () => {
    const unknown = await ev("nonsense", { phone: KEY, text: "hola" });
    expect([unknown.statusCode, unknown.body.error]).toEqual([400, "Unknown event."]);
    expect((await ev("toString", { phone: KEY })).statusCode).toBe(400);
    expect((await ev("contact", { name: "Ana" })).statusCode).toBe(400);
    expect((await ev("echo", { phone: KEY, text: "  " })).statusCode).toBe(400);
    expect((await ev("edit", { phone: KEY })).statusCode).toBe(400);
    expect(fake.state.writes).toEqual([]);
  });

  it("contact: saved on the phone, stamping the first sync once; removed again", async () => {
    const res = await ev("contact", { phone: KEY, name: "Lucía (terraza)" });
    expect([res.statusCode, res.body.results.contacts]).toEqual([200, 1]);
    expect(fake.read("waContacts/" + KEY)).toMatchObject({ name: "Lucía (terraza)", first: "Lucía" });
    const first = fake.read("waLink/contacts/firstAt");
    expect(typeof first).toBe("number");
    await ev("contact", { phone: KEY, remove: true });
    expect(fake.read("waContacts/" + KEY)).toBeUndefined();
    expect(fake.read("waLink/contacts/firstAt")).toBe(first);
  });

  it("echo: a reply from the phone is stored as one, and its conversation is read and back in the Inbox", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ unread: true, archived: true, archivedAt: 5, lastMessageAt: 1 }) } };
    const res = await ev("echo", { phone: KEY, text: "  Os esperamos a las 21:00  " });
    expect([res.statusCode, res.body.results.echoes]).toEqual([200, 1]);
    const [m] = msgsAt(KEY);
    expect(m).toMatchObject({ direction: "out", source: "phone", text: "Os esperamos a las 21:00", status: "sent" });
    expect(m.providerMsgId).toMatch(/^wamid-SIMECHO-/);
    expect(convAt(KEY)).toMatchObject({ unread: false, archived: false, lastMessageSnippet: "Os esperamos a las 21:00" });
  });

  it("edit and revoke: the customer's newest message that is not deleted, its line in the list following", async () => {
    fake.state.tree = {
      conversations: { [KEY]: openConv({ lastMessageAt: 20, lastMessageSnippet: "a las 9" }) },
      messages: { [KEY]: {
        in1: { id: "in1", direction: "in", text: "mesa para 2", ts: 10, providerMsgId: "wamid.A" },
        out1: { id: "out1", direction: "out", text: "¡Claro!", ts: 15 },
        in2: { id: "in2", direction: "in", text: "a las 9", ts: 20, providerMsgId: "wamid.B" },
      } },
    };
    const edit = await ev("edit", { phone: KEY, text: "a las 10" });
    expect([edit.statusCode, edit.body.outcome]).toEqual([200, "applied"]);
    expect(fake.read("messages/" + KEY + "/in2")).toMatchObject({ text: "a las 10" });
    expect(typeof fake.read("messages/" + KEY + "/in2/editedAt")).toBe("number");
    expect(convAt(KEY).lastMessageSnippet).toBe("a las 10");
    await ev("revoke", { phone: KEY });
    expect(fake.read("messages/" + KEY + "/in2")).toMatchObject({ text: WA_REVOKED_IN });
    expect(convAt(KEY).lastMessageSnippet).toBe(WA_REVOKED_IN);
    await ev("revoke", { phone: KEY });
    expect(fake.read("messages/" + KEY + "/in1")).toMatchObject({ text: WA_REVOKED_IN });
    expect(fake.read("messages/" + KEY + "/out1/text")).toBe("¡Claro!");
    const none = await ev("revoke", { phone: KEY });
    expect([none.statusCode, none.body.error]).toEqual([409, "That conversation has no message from the customer to delete."]);
  });

  it("history: two chats, the old one straight to Archived, read and settled, its photo a placeholder; a second import stores nothing", async () => {
    const res = await ev("history");
    expect([res.statusCode, res.body.results.history]).toEqual([200, 6]);
    expect(convAt(R)).toMatchObject({ archived: false, unread: false, autoAckSent: true, lastMessageSnippet: "Perfecto, a nombre de Lucía. ¡Gracias!" });
    expect(convAt(O)).toMatchObject({ archived: true, unread: false, autoAckSent: true });
    expect("windowExpiresAt" in convAt(R)).toBe(false);
    const recent = msgsAt(R);
    expect(recent.map((m) => [m.direction, m.imported, m.source || null])).toEqual([["in", true, null], ["out", true, "phone"], ["in", true, null], ["in", true, null]]);
    expect(recent[1].status).toBe("read");
    expect(recent[2].text).toBe("Photo or file — open WhatsApp on the phone to see it");
    expect(fake.read("waLink/history")).toMatchObject({ progress: 100, phase: 0 });
    const writes = fake.state.writes.length;
    const again = await ev("history");
    expect(again.body.results.history).toBe(0);
    expect(fake.state.writes.slice(writes).filter((w) => /^messages|^$/.test(w.path) && JSON.stringify(w.value).includes("wamid-SIMHIST"))).toEqual([]);
    expect(msgsAt(R)).toHaveLength(4);
  });

  it("history-media: the placeholder takes its photo and the caption", async () => {
    await ev("history");
    const res = await ev("history-media");
    expect([res.statusCode, res.body.results.history]).toEqual([200, 1]);
    const photo = fake.read("messages/" + R + "/" + SIM_HISTORY_PHOTO_ID);
    expect(photo.text).toBe("La terraza");
    expect(photo.media).toMatchObject({ kind: "image", mime: "image/jpeg" });
    expect(photo.media.mediaId).toMatch(/^MOCK\.image\./);
    expect((await ev("history-media")).body.results.skipped).toBe(1);
  });

  it("connect, disconnect, reconnect, forget: a connection marked as the simulator's, and its banner", async () => {
    const early = await ev("disconnect");
    expect([early.statusCode, early.body.error]).toEqual([409, "Connect (simulated) first."]);
    vi.stubEnv("META_PHONE_NUMBER_ID", "555000111");
    expect((await ev("connect")).statusCode).toBe(200);
    expect(fake.read("waLink")).toMatchObject({ status: "connected", wabaId: SIM_WABA_ID, phoneNumberId: "555000111", sim: true, connectedBy: "ana@example.com" });
    expect((await ev("disconnect")).body.results.events).toBe(1);
    expect(fake.read("waLink")).toMatchObject({ status: "disconnected", disconnect: { event: "PARTNER_REMOVED", reason: "USER_REQUESTED", initiatedBy: "BUSINESS" } });
    await ev("reconnect");
    expect(fake.read("waLink/status")).toBe("connected");
    expect(fake.read("waLink/disconnect")).toBeUndefined();
    expect((await ev("forget")).body.removed).toBe(true);
    expect(fake.read("waLink")).toBeUndefined();
    expect((await ev("forget")).body.removed).toBe(false);
  });

  it("leaves a REAL connection alone: every event that writes waLink is 409, and nothing is written", async () => {
    fake.state.tree = { waLink: Object.assign({}, REAL) };
    for (const [event, extra] of [["contact", { phone: KEY, name: "Ana" }], ["history"], ["connect"], ["disconnect"], ["reconnect"], ["forget"]]) {
      const res = await ev(event, extra);
      expect([event, res.statusCode, res.body.error]).toEqual([event, 409, "A real Business-app connection is recorded on this database, so the simulator leaves it alone."]);
    }
    expect(fake.state.writes).toEqual([]);
    expect(fake.read("waLink")).toEqual(REAL);
    // A link that holds only a sync's stamp is no connection, and is fair game.
    fake.state.tree = { waLink: { contacts: { firstAt: 5 } } };
    expect((await ev("connect")).statusCode).toBe(200);
  });

  it("the client mode's reading of each message it builds agrees with the server's", () => {
    const now = 1_800_000_000_000;
    const msgs = simHistoryValue(now).history[0].threads.flatMap((t) => t.messages)
      .concat(simEchoValue({ phone: KEY, text: "Os esperamos", now }).message_echoes);
    expect(msgs).toHaveLength(7);
    msgs.forEach((m) => {
      const server = inboundContent(m);
      expect([m.id, simContent(m)]).toEqual([m.id, { text: server.text, media: server.media, snippet: server.snippet }]);
    });
  });
});

// ── api/wa-media.js — viewing a photo, a voice note, a document (v18.8.0) ─────
// A response that is a real Writable, so the handler can stream into it.
function mediaCall({ token = "staff", query } = {}) {
  const chunks = [];
  const res = new Writable({ write(c, e, cb) { chunks.push(Buffer.from(c)); cb(); } });
  Object.assign(res, {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.end(); return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  });
  const req = { method: "GET", headers: token ? { authorization: "Bearer " + token } : {}, query: query || {} };
  return mediaHandler(req, res).then(() => Object.assign(res, { bytes: Buffer.concat(chunks) }));
}
const MEDIA_MSG = (media, extra) => Object.assign({ id: "wamid_P", direction: "in", text: "Photo", ts: Date.now(), media }, extra);
const seedMedia = (msg) => { fake.state.tree = { messages: { [KEY]: { [msg.id]: msg } } }; };
const PIC = Buffer.from("\xff\xd8\xff\xe0 a jpeg", "binary");
// Meta's two answers: the lookup (JSON) and the file (bytes).
const metaFetch = ({ info = {}, infoStatus = 200, file = PIC, fileStatus = 200, fileHeaders } = {}) => vi.fn(async (url) => {
  if (url.startsWith("https://graph.facebook.com/")) {
    return new Response(JSON.stringify(Object.assign({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", mime_type: "image/jpeg", file_size: file.length }, info)), { status: infoStatus });
  }
  return new Response(fileStatus === 200 ? file : "nope", { status: fileStatus, headers: Object.assign({ "content-type": "image/jpeg", "content-length": String(file.length) }, fileHeaders) });
});

describe("wa-media GET", () => {
  beforeEach(() => vi.stubEnv("META_WA_TOKEN", "tok"));

  it("400 without a usable phone key or message id, and writes nothing", async () => {
    expect((await mediaCall({ query: { msgId: "wamid_P" } })).statusCode).toBe(400);
    expect((await mediaCall({ query: { phoneKey: KEY } })).statusCode).toBe(400);
    expect((await mediaCall({ query: { phoneKey: "+", msgId: "wamid_P" } })).statusCode).toBe(400);
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "../x" } })).statusCode).toBe(400);
    expect(fake.state.writes).toEqual([]);
  });
  // v18.9.1: a real wamid is base64, so its stored key can carry `+` and `=`.
  // v18.8.0's check refused both, and every received file answered 400.
  // The key is DERIVED, through the function inbound-core stores a message
  // under (`sanitizeKey(wamid)`), from a raw wamid carrying every base64
  // character that is not a letter or digit: so a change to what that function
  // writes cannot leave this test passing while received media answers 400.
  it("serves a message keyed by a real-shaped wamid, with + / and = in it", async () => {
    const id = sanitizeKey("wamid.HBgLMzQ2MTIyMDIzNTkVAgASGBQzQUY1+RjA4/QkU2QzE4MjQ0RkI4AA==");
    expect(id).toBe("wamid_HBgLMzQ2MTIyMDIzNTkVAgASGBQzQUY1+RjA4_QkU2QzE4MjQ0RkI4AA==");
    seedMedia(MEDIA_MSG({ kind: "image", mediaId: "1234567890", mime: "image/jpeg" }, { id }));
    vi.stubGlobal("fetch", metaFetch());
    const res = await mediaCall({ query: { phoneKey: KEY, msgId: id } });
    expect(res.statusCode).toBe(200);
    expect(res.bytes.equals(PIC)).toBe(true);
  });
  // v18.9.1 /code-review: the key check asks sanitizeKey instead of a hand-kept
  // character list, so any key it could have stored passes and nothing that
  // could reach outside one message's child does.
  it("isStoredMsgKey: every key sanitizeKey could store, and nothing that leaves the child", () => {
    for (const k of ["wamid_HBgL+AA==", "mmvcuojx87osu", "in1x2y", "sim_abc", "r-1"]) expect(isStoredMsgKey(k)).toBe(true);
    for (const k of ["", "../x", "a/b", "a.b", "a#b", "a$b", "a[b]", "a\u0000b", "a\nb", "x".repeat(257), null, 7]) expect(isStoredMsgKey(k)).toBe(false);
    expect(isStoredMsgKey("x".repeat(256))).toBe(true);
  });
  it("404 for a message nobody has, and for one with no media", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } })).statusCode).toBe(404);
    seedMedia({ id: "wamid_P", direction: "in", text: "hola", ts: 1 });
    const res = await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } });
    expect([res.statusCode, res.body.error]).toEqual([404, "this message has no media"]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("streams the file Meta holds, asked with the id STORED on the message, never one from the request", async () => {
    seedMedia(MEDIA_MSG({ kind: "image", mediaId: "1234567890", mime: "image/jpeg" }));
    const f = metaFetch();
    vi.stubGlobal("fetch", f);
    const res = await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P", mediaId: "999" } });
    expect(res.statusCode).toBe(200);
    expect(res.bytes.equals(PIC)).toBe(true);
    expect(res.headers).toMatchObject({ "content-type": "image/jpeg", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-disposition": "inline" });
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      "https://graph.facebook.com/v26.0/1234567890",
      "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
    ]);
    expect(f.mock.calls.every((c) => c[1].headers.Authorization === "Bearer tok")).toBe(true);
  });
  it("410 when Meta no longer has the file, at either call; 502 when Meta fails otherwise", async () => {
    seedMedia(MEDIA_MSG({ kind: "image", mediaId: "1234567890" }));
    vi.stubGlobal("fetch", metaFetch({ infoStatus: 404 }));
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } })).statusCode).toBe(410);
    vi.stubGlobal("fetch", metaFetch({ fileStatus: 404 }));
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } })).statusCode).toBe(410);
    vi.stubGlobal("fetch", metaFetch({ infoStatus: 500 }));
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } })).statusCode).toBe(502);
  });
  it("413 for a file larger than the browser is handed, before the download starts", async () => {
    seedMedia(MEDIA_MSG({ kind: "document", mediaId: "555", filename: "big.pdf" }));
    const f = metaFetch({ info: { file_size: MEDIA_VIEW_MAX + 1 } });
    vi.stubGlobal("fetch", f);
    const res = await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } });
    expect(res.statusCode).toBe(413);
    expect(f).toHaveBeenCalledTimes(1);
    // …and when only the download says how big it is.
    vi.stubGlobal("fetch", metaFetch({ info: { file_size: undefined }, fileHeaders: { "content-length": String(MEDIA_VIEW_MAX + 1) } }));
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } })).statusCode).toBe(413);
  });
  it("a type that could run as the app is served as a download, never inline", async () => {
    seedMedia(MEDIA_MSG({ kind: "document", mediaId: "555", filename: "menú carta.html" }));
    vi.stubGlobal("fetch", metaFetch({ info: { mime_type: "text/html" } }));
    const res = await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } });
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''men%C3%BA%20carta.html");
    expect(servedType("image/svg+xml")).toBe("application/octet-stream");
    expect(servedType("audio/ogg; codecs=opus")).toBe("audio/ogg; codecs=opus");
    expect(servedType("application/PDF")).toBe("application/PDF");
  });
  it("sends the token only to a host Meta serves media from", async () => {
    seedMedia(MEDIA_MSG({ kind: "image", mediaId: "1234567890" }));
    const f = metaFetch({ info: { url: "https://evil.example.com/x" } });
    vi.stubGlobal("fetch", f);
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } })).statusCode).toBe(502);
    expect(f).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", metaFetch({ info: { url: "http://lookaside.fbsbx.com/x" } }));
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } })).statusCode).toBe(502);
  });
  it("503 when the deployment has no Meta token", async () => {
    vi.stubEnv("META_WA_TOKEN", "");
    seedMedia(MEDIA_MSG({ kind: "image", mediaId: "1234567890" }));
    vi.stubGlobal("fetch", vi.fn());
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } })).statusCode).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("a simulator id is answered with the bundled sample in mock mode, and is gone in live mode", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const [kind, file, type] of [["image", "photo.jpg", "image/jpeg"], ["audio", "voice.ogg", "audio/ogg; codecs=opus"], ["document", "menu.pdf", "application/pdf"]]) {
      seedMedia(MEDIA_MSG({ kind, mediaId: "MOCK." + kind + ".abc" }));
      const res = await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } });
      expect([kind, res.statusCode, res.headers["content-type"]]).toEqual([kind, 200, type]);
      expect(res.bytes.equals(readFileSync(new URL("../api/_lib/mock-media/" + file, import.meta.url)))).toBe(true);
    }
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    expect((await mediaCall({ query: { phoneKey: KEY, msgId: "wamid_P" } })).statusCode).toBe(410);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ── api/wa-media.js — sending a photo or a PDF (v18.8.0, phase 5) ─────────────
// The request is a byte stream (`bodyParser` is off), the file its body, the
// caption and a document's name in two percent-encoded headers.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("IHDR")]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n");
function sendFile({ token = "staff", phoneKey = KEY, bytes = JPEG, type = "image/jpeg", caption, filename, headers } = {}) {
  const h = Object.assign({ "content-type": type }, token ? { authorization: "Bearer " + token } : {});
  if (caption !== undefined) h["x-caption"] = encodeURIComponent(caption);
  if (filename !== undefined) h["x-filename"] = encodeURIComponent(filename);
  return rawCall(mediaHandler, { body: bytes, headers: Object.assign(h, headers), query: phoneKey === null ? {} : { phoneKey } });
}
const goLive = () => {
  vi.stubEnv("WA_SEND_MODE", "live");
  vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
  vi.stubEnv("META_WA_TOKEN", "tok");
  vi.stubEnv("META_PHONE_NUMBER_ID", "555");
};
// Meta's two answers to a send: the upload (`/media`) and the message (`/messages`).
const graphFetch = ({ uploadStatus = 200, upload = { id: "1122334455" }, sendStatus = 200 } = {}) => vi.fn(async (url) => {
  if (url.endsWith("/media")) return new Response(JSON.stringify(uploadStatus === 200 ? upload : { error: { message: "Upload refused" } }), { status: uploadStatus });
  if (url.endsWith("/messages")) return new Response(JSON.stringify(sendStatus === 200 ? { messages: [{ id: "wamid.OUT" }] } : { error: { message: "Recipient not allowed" } }), { status: sendStatus });
  throw new Error("unexpected call to " + url);
});
const messageCalls = (f) => f.mock.calls.filter((c) => c[0].endsWith("/messages"));

describe("wa-media POST — what is refused, before anything is sent or stored", () => {
  beforeEach(() => {
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    vi.stubGlobal("fetch", vi.fn());
  });

  it("400 without a usable phone key, with a header that does not decode, and with a caption over WA_CAPTION_MAX", async () => {
    expect((await sendFile({ phoneKey: null })).statusCode).toBe(400);
    expect((await sendFile({ phoneKey: "+" })).statusCode).toBe(400);
    expect((await sendFile({ headers: { "x-caption": "%E0%A4%A" } })).statusCode).toBe(400);
    expect((await sendFile({ type: "application/pdf", bytes: PDF, headers: { "x-filename": "%" } })).statusCode).toBe(400);
    const long = await sendFile({ caption: "x".repeat(WA_CAPTION_MAX + 1) });
    expect([long.statusCode, long.body.error]).toEqual([400, "a caption can be up to " + WA_CAPTION_MAX + " characters"]);
    expect(fake.state.writes).toEqual([]);
    // The cap is on the caption as sent, so spaces around it do not count.
    expect((await sendFile({ caption: "  " + "x".repeat(WA_CAPTION_MAX) + "  " })).statusCode).toBe(200);
  });

  it("415 for anything but a JPEG, a PNG or a PDF, whatever its bytes are", async () => {
    for (const type of ["text/html", "image/gif", "image/svg+xml", "application/octet-stream", ""]) {
      const res = await sendFile({ type });
      expect([type, res.statusCode]).toEqual([type, 415]);
    }
    expect(fake.state.writes).toEqual([]);
  });

  it("413 when the declared length is over the cap, and when the body runs past it without one", async () => {
    expect((await sendFile({ headers: { "content-length": String(WA_SEND_MAX_BYTES + 1) } })).statusCode).toBe(413);
    const over = Buffer.concat([JPEG, Buffer.alloc(WA_SEND_MAX_BYTES + 1 - JPEG.length)]);
    expect((await sendFile({ bytes: over })).statusCode).toBe(413);
    expect(fake.state.writes).toEqual([]);
    const atCap = Buffer.concat([JPEG, Buffer.alloc(WA_SEND_MAX_BYTES - JPEG.length)]);
    expect((await sendFile({ bytes: atCap })).statusCode).toBe(200);
  });

  it("the cap fits under Vercel's 4.5 MB request body, which a raw body is all of", () => {
    expect(WA_SEND_MAX_BYTES).toBeLessThan(4.5 * 1000 * 1000);
  });

  it("400 for an empty body, and for bytes that are not what the Content-Type says", async () => {
    const empty = await sendFile({ bytes: Buffer.alloc(0) });
    expect([empty.statusCode, empty.body.error]).toEqual([400, "no file"]);
    expect((await sendFile({ bytes: PNG, type: "image/jpeg" })).body.error).toBe("the file is not a photo");
    expect((await sendFile({ bytes: JPEG, type: "image/png" })).statusCode).toBe(400);
    const html = await sendFile({ bytes: Buffer.from("<html><script>"), type: "application/pdf" });
    expect([html.statusCode, html.body.error]).toEqual([400, "the file is not a PDF"]);
    expect(fake.state.writes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("404 for a conversation that does not exist, 410 once its window has shut", async () => {
    expect((await sendFile({ phoneKey: "+34600999888" })).statusCode).toBe(404);
    fake.state.tree = { conversations: { [KEY]: openConv({ windowExpiresAt: Date.now() - 1 }) } };
    expect((await sendFile()).statusCode).toBe(410);
    expect(fake.state.writes).toEqual([]);
  });

  it("sniffType names the three by their first bytes, and nothing else", () => {
    expect(sniffType(JPEG)).toBe("image/jpeg");
    expect(sniffType(PNG)).toBe("image/png");
    expect(sniffType(PDF)).toBe("application/pdf");
    for (const b of [Buffer.alloc(0), Buffer.from([0xff, 0xd8]), Buffer.from("GIF89a"), Buffer.from("%PDF"), Buffer.from("<svg")]) {
      expect(sniffType(b)).toBe(null);
    }
  });
});

describe("wa-media POST — a photo or a PDF sent", () => {
  beforeEach(() => { fake.state.tree = { conversations: { [KEY]: openConv() } }; });

  it("mock: stores an outbound message with its caption, its author and its media, and touches no network", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const conv = convAt(KEY);
    const res = await sendFile({ caption: "  Your table on the terrace  ", filename: "ignored.jpg" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "delivered" });
    expect(res.body.wamid).toMatch(/^wamid\.MOCK\./);
    expect(res.body.mediaId).toMatch(/^MOCK\.image\./);
    const [m] = msgsAt(KEY);
    expect(m).toEqual({
      id: res.body.msgId, direction: "out", text: "Your table on the terrace", ts: m.ts, status: "delivered",
      isAutoAck: false, channel: "whatsapp", providerMsgId: res.body.wamid, authorEmail: "ana@example.com",
      media: { kind: "image", mediaId: res.body.mediaId, mime: "image/jpeg", size: JPEG.length },
    });
    expect(convAt(KEY)).toMatchObject({ lastMessageAt: m.ts, lastMessageSnippet: "Photo · Your table on the terrace", windowExpiresAt: conv.windowExpiresAt });
    expect(f).not.toHaveBeenCalled();
  });

  it("a PDF keeps its name, cleaned of control characters, or is document.pdf; with no caption its text is the label", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await sendFile({ bytes: PDF, type: "application/pdf", filename: "Menú\u0007 otoño.pdf" });
    const [named] = msgsAt(KEY);
    expect(named.media).toMatchObject({ kind: "document", mime: "application/pdf", filename: "Menú otoño.pdf" });
    expect(named.text).toBe("Document: Menú otoño.pdf");
    expect(convAt(KEY).lastMessageSnippet).toBe("Document: Menú otoño.pdf");
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    await sendFile({ bytes: PDF, type: "application/pdf", caption: "   " });
    expect(msgsAt(KEY)[0].media.filename).toBe("document.pdf");
    expect(msgsAt(KEY)[0].text).toBe("Document: document.pdf");
  });

  it("a PNG is sent as a photo, with its own type", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = await sendFile({ bytes: PNG, type: "image/png" });
    expect(res.statusCode).toBe(200);
    expect(msgsAt(KEY)[0].media).toMatchObject({ kind: "image", mime: "image/png" });
    expect(msgsAt(KEY)[0].text).toBe("Photo");
  });

  it("a send to an archived conversation un-archives it", async () => {
    vi.stubGlobal("fetch", vi.fn());
    fake.state.tree = { conversations: { [KEY]: openConv({ archived: true, archivedAt: 5 }) } };
    await sendFile();
    expect(convAt(KEY).archived).toBe(false);
    expect("archivedAt" in convAt(KEY)).toBe(false);
  });

  it("a send to a muted (\"Not a customer\") archived conversation leaves it archived", async () => {
    vi.stubGlobal("fetch", vi.fn());
    fake.state.tree = { conversations: { [KEY]: openConv({ archived: true, archivedAt: 5, muted: true }) } };
    expect((await sendFile()).statusCode).toBe(200);
    expect(convAt(KEY)).toMatchObject({ archived: true, archivedAt: 5, muted: true });
  });

  // /code-review: Meta had the photo, the database write failed, and the
  // answer was a 500, so the composer said "Couldn't send … still attached"
  // and a second press sent the customer the same photo twice.
  it("a send that reached the customer is a 200 even when storing it fails, and says it was not stored", async () => {
    vi.stubGlobal("fetch", vi.fn());
    fake.state.failWrite = (op, path) => op === "set" && path.startsWith("messages/");
    const res = await sendFile({ caption: "La carta" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, stored: false, status: "delivered" });
    expect(msgsAt(KEY)).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/sent, but not stored/), "database unavailable");
    fake.state.failWrite = null;
    expect((await sendFile()).body).toMatchObject({ ok: true, stored: true });
  });

  it("the photo it stored opens: in mock mode the GET answers the bundled sample for the stored id", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const sent = await sendFile();
    const res = await mediaCall({ query: { phoneKey: KEY, msgId: sent.body.msgId } });
    expect([res.statusCode, res.headers["content-type"]]).toEqual([200, "image/jpeg"]);
    expect(res.bytes.equals(readFileSync(new URL("../api/_lib/mock-media/photo.jpg", import.meta.url)))).toBe(true);
  });
});

// Checklist A4-5: every send to a customer is ONE Graph `/messages` call. A
// caption never becomes a second message, and the upload is not one.
describe("A4-5 — one message per send, the caption inside it", () => {
  beforeEach(() => {
    goLive();
    fake.state.tree = { conversations: { [KEY]: openConv() } };
  });

  it("wa-send: exactly one Graph call, and it is /messages", async () => {
    const f = graphFetch();
    vi.stubGlobal("fetch", f);
    expect((await call(sendHandler, { token: "staff", body: { phoneKey: KEY, text: "hola" } })).statusCode).toBe(200);
    expect(f.mock.calls.map((c) => c[0])).toEqual(["https://graph.facebook.com/v26.0/555/messages"]);
  });

  it("wa-media: one upload to /media, then exactly one /messages, with the file's id and the caption inside it", async () => {
    const f = graphFetch();
    vi.stubGlobal("fetch", f);
    const res = await sendFile({ caption: "Mesa 4 a las 21:00" });
    expect(res.statusCode).toBe(200);
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      "https://graph.facebook.com/v26.0/555/media",
      "https://graph.facebook.com/v26.0/555/messages",
    ]);
    const [, up] = f.mock.calls[0];
    expect(up.headers).toEqual({ Authorization: "Bearer tok" }); // the multipart boundary is fetch's to write
    expect(up.body.get("messaging_product")).toBe("whatsapp");
    expect(up.body.get("type")).toBe("image/jpeg");
    const file = up.body.get("file");
    expect([file.name, file.type, file.size]).toEqual(["photo.jpg", "image/jpeg", JPEG.length]);
    expect(Buffer.from(await file.arrayBuffer()).equals(JPEG)).toBe(true);
    expect(JSON.parse(messageCalls(f)[0][1].body)).toEqual({
      messaging_product: "whatsapp", to: "34600111222", type: "image", image: { id: "1122334455", caption: "Mesa 4 a las 21:00" },
    });
    expect(msgsAt(KEY)).toHaveLength(1);
    expect(msgsAt(KEY)[0]).toMatchObject({ text: "Mesa 4 a las 21:00", status: "sent", providerMsgId: "wamid.OUT", media: { kind: "image", mediaId: "1122334455" } });
  });

  it("a PDF's one message carries its name; with no caption there is no caption key at all", async () => {
    const f = graphFetch({ upload: { id: "9988" } });
    vi.stubGlobal("fetch", f);
    await sendFile({ bytes: PDF, type: "application/pdf", filename: "carta.pdf", caption: "  " });
    expect(f.mock.calls[0][1].body.get("file").name).toBe("carta.pdf");
    expect(messageCalls(f)).toHaveLength(1);
    expect(JSON.parse(messageCalls(f)[0][1].body)).toEqual({
      messaging_product: "whatsapp", to: "34600111222", type: "document", document: { id: "9988", filename: "carta.pdf" },
    });
  });

  it("502 when the upload fails (and then no message is sent) or the send fails; nothing is stored either way", async () => {
    const f = graphFetch({ uploadStatus: 400 });
    vi.stubGlobal("fetch", f);
    const up = await sendFile();
    expect([up.statusCode, up.body.error]).toEqual([502, "send failed: Upload refused"]);
    expect(messageCalls(f)).toHaveLength(0);
    vi.stubGlobal("fetch", graphFetch({ sendStatus: 400 }));
    const sent = await sendFile();
    expect([sent.statusCode, sent.body.error]).toEqual([502, "send failed: Recipient not allowed"]);
    expect(fake.state.writes).toEqual([]);
  });
});

// ── api/wa-prune.js — the nightly message prune (v18.8.0 phase 7) ────────────
describe("wa-prune", () => {
  const DAY = 86400000;
  const CRON = "c".repeat(64);
  const prune = ({ auth = "Bearer " + CRON, method = "GET" } = {}) => {
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    return pruneHandler({ method, headers: auth == null ? {} : { authorization: auth } }, res).then(() => res);
  };
  const ago = (days) => Date.now() - days * DAY;
  const msg = (id, ts) => (ts === undefined ? { id, direction: "in", text: id } : { id, direction: "in", text: id, ts });

  it("503 with no CRON_SECRET, whatever is sent, and writes nothing", async () => {
    expect((await prune()).statusCode).toBe(503);
    expect((await prune({ auth: "Bearer " })).statusCode).toBe(503);
    expect(fake.state.writes).toEqual([]);
  });
  it("401 to a missing, wrong, or almost-right token, before the method is asked, and writes nothing", async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    for (const auth of [null, "", CRON, "Bearer " + CRON.slice(1), "Bearer " + CRON + " ", "bearer " + CRON, "Basic " + CRON]) {
      expect([auth, (await prune({ auth })).statusCode]).toEqual([auth, 401]);
    }
    expect((await prune({ auth: "nope", method: "POST" })).statusCode).toBe(401);
    expect((await prune({ method: "POST" })).statusCode).toBe(405);
    expect(fake.state.writes).toEqual([]);
  });

  it("deletes an old conversation with its messages, and old messages in a live one, and leaves the rest", async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    fake.state.tree = {
      settings: { admin: { waRetentionDays: 90 } },
      conversations: {
        "+34600000001": { phoneKey: "+34600000001", createdAt: ago(300), lastMessageAt: ago(120) },
        "+34600000002": { phoneKey: "+34600000002", createdAt: ago(200), lastMessageAt: ago(1) },
        "+34600000003": { phoneKey: "+34600000003", createdAt: ago(10), lastMessageAt: ago(2) },
        "+34600000004": { phoneKey: "+34600000004", createdAt: ago(200) }, // no lastMessageAt: never deleted
      },
      messages: {
        "+34600000001": { a: msg("a", ago(300)), b: msg("b", ago(120)), c: msg("c") },
        "+34600000002": { d: msg("d", ago(150)), e: msg("e", ago(91)), f: msg("f", ago(89)), g: msg("g", ago(1)), h: msg("h") },
        "+34600000003": { i: msg("i", ago(10)) },
        "+34600000004": { j: msg("j", ago(150)), k: msg("k", ago(5)) },
      },
    };
    const res = await prune();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, days: 90, conversations: 1, messages: 6, read: 3, errors: 0 });
    const t = fake.state.tree;
    expect(Object.keys(t.conversations).sort()).toEqual(["+34600000002", "+34600000003", "+34600000004"]);
    expect(t.messages["+34600000001"]).toEqual({});
    expect(Object.keys(t.messages["+34600000002"]).sort()).toEqual(["f", "g", "h"]); // a message with no ts stays in a live thread
    expect(Object.keys(t.messages["+34600000003"])).toEqual(["i"]);
    expect(Object.keys(t.messages["+34600000004"])).toEqual(["k"]);
    expect(t.conversations["+34600000004"]).toBeTruthy();
    // Per key and per message, never a whole node.
    for (const w of fake.state.writes) {
      expect(w.path).toMatch(/^(conversations|messages)\/\+346000000\d\d$/);
      expect(w.op === "transaction" ? w.value : Object.values(w.value).every((v) => v === null)).toBe(w.op === "transaction" ? null : true);
    }
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[wa-prune\] kept 90 days .*removed 1 conversation\(s\) and 6 message\(s\), read 3 thread\(s\), 0 error\(s\)$/));
  });

  // /code-review: the thread was deleted FIRST, so a failed message delete
  // left its messages behind with no conversation, and the prune walks
  // conversations only: kept for ever. Messages go first now, and a failure
  // leaves the conversation for the next night to find again.
  it("a failed message delete never orphans a thread: the conversation stays, and the next night finishes the job", async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    fake.state.tree = {
      settings: { admin: { waRetentionDays: 90 } },
      conversations: { [KEY]: { phoneKey: KEY, createdAt: ago(300), lastMessageAt: ago(120) } },
      messages: { [KEY]: { a: msg("a", ago(300)), b: msg("b", ago(120)) } },
    };
    fake.state.failWrite = (op, path) => op === "update" && path.startsWith("messages/");
    const first = await prune();
    expect(first.statusCode).toBe(500);
    expect(first.body).toMatchObject({ ok: false, conversations: 0, messages: 0, errors: 1 });
    expect(fake.state.tree.conversations[KEY]).toBeTruthy();
    expect(Object.keys(fake.state.tree.messages[KEY]).sort()).toEqual(["a", "b"]);

    fake.state.failWrite = null;
    const second = await prune();
    expect(second.body).toMatchObject({ ok: true, conversations: 1, messages: 2, errors: 0 });
    expect(fake.state.tree.conversations[KEY]).toBeUndefined();
    expect(fake.state.tree.messages[KEY]).toEqual({});
  });
  it("a failed conversation delete leaves an empty thread that the next night deletes", async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    fake.state.tree = {
      conversations: { [KEY]: { phoneKey: KEY, createdAt: ago(800), lastMessageAt: ago(400) } },
      messages: { [KEY]: { a: msg("a", ago(400)) } },
    };
    fake.state.failWrite = (op) => op === "transaction";
    expect((await prune()).body).toMatchObject({ ok: false, conversations: 0, messages: 1, errors: 1 });
    expect(fake.state.tree.messages[KEY]).toEqual({});
    fake.state.failWrite = null;
    expect((await prune()).body).toMatchObject({ ok: true, conversations: 1, messages: 0, errors: 0 });
    expect(fake.state.tree.conversations[KEY]).toBeUndefined();
  });

  // /code-review: after the first year every regular's thread began before the
  // cutoff, and each was read WHOLE every night. A live thread is now asked
  // only for what is older than the cutoff, on the indexed `ts`.
  it("a live thread is read through the ts query, only up to the cutoff; a thread that is going is read whole", async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    const live = "+34600000002";
    fake.state.tree = {
      settings: { admin: { waRetentionDays: 90 } },
      conversations: {
        [KEY]: { phoneKey: KEY, createdAt: ago(300), lastMessageAt: ago(120) },
        [live]: { phoneKey: live, createdAt: ago(400), lastMessageAt: ago(1) },
      },
      messages: {
        [KEY]: { a: msg("a", ago(120)) },
        [live]: { old: msg("old", ago(100)), "new": msg("new", ago(1)), nots: msg("nots") },
      },
    };
    const res = await prune();
    expect(res.body).toMatchObject({ ok: true, conversations: 1, messages: 2, read: 2 });
    expect(fake.state.queries).toEqual([{ path: "messages/" + live, orderByChild: "ts", endAt: res.body.cutoff - 1 }]);
    expect(Object.keys(fake.state.tree.messages[live]).sort()).toEqual(["new", "nots"]);
  });
  it("before the index is published the query is refused, and the thread is read whole instead", async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    fake.state.noIndex = true;
    fake.state.tree = {
      conversations: { [KEY]: { phoneKey: KEY, createdAt: ago(800), lastMessageAt: ago(1) } },
      messages: { [KEY]: { old: msg("old", ago(400)), "new": msg("new", ago(1)) } },
    };
    const res = await prune();
    expect(res.body).toMatchObject({ ok: true, messages: 1, errors: 0 });
    expect(Object.keys(fake.state.tree.messages[KEY])).toEqual(["new"]);
  });
  it("the index the query needs is in the rules, where the thread's messages are", () => {
    const rules = JSON.parse(readFileSync(new URL("../database.rules.json", import.meta.url), "utf8")).rules;
    expect(rules.messages.$phoneKey[".indexOn"]).toEqual(["ts"]);
  });

  it("reads the setting through the one normaliser: absent, null, 0 or junk is a year, and a tiny number is the 30-day floor", async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    for (const [v, days] of [[undefined, 365], [null, 365], [0, 365], ["x", 365], [-5, 365], [7, 30], [730, 730]]) {
      fake.state.tree = v === undefined ? {} : { settings: { admin: { waRetentionDays: v } } };
      expect([v, (await prune()).body.days]).toEqual([v, days]);
    }
  });

  it("a conversation that came alive after the read keeps its thread (the delete re-checks what is stored)", async () => {
    const cutoff = ago(90);
    fake.state.tree = { conversations: { [KEY]: { phoneKey: KEY, lastMessageAt: ago(1) } } };
    expect(await removeConversationIf(KEY, (cur) => conversationExpired(cur, cutoff))).toBe(false);
    expect(fake.state.tree.conversations[KEY]).toBeTruthy();
    fake.state.tree.conversations[KEY].lastMessageAt = ago(100);
    expect(await removeConversationIf(KEY, (cur) => conversationExpired(cur, cutoff))).toBe(true);
    expect(fake.state.tree.conversations[KEY]).toBeUndefined();
  });

  it("the three pure questions", () => {
    const cut = 1000;
    expect(conversationExpired({ lastMessageAt: 999 }, cut)).toBe(true);
    for (const c of [{ lastMessageAt: 1000 }, { lastMessageAt: "1" }, {}, null]) expect(conversationExpired(c, cut)).toBe(false);
    expect(mayHoldOld({ createdAt: 1000, lastMessageAt: 2000 }, cut)).toBe(false);
    expect(mayHoldOld({ createdAt: 999, lastMessageAt: 2000 }, cut)).toBe(true);
    expect(mayHoldOld({ lastMessageAt: 2000 }, cut)).toBe(true);
    const node = { a: { ts: 999 }, b: { ts: 1000 }, c: {}, d: { ts: "5" }, e: null };
    expect(staleMessageIds(node, cut, false)).toEqual(["a"]);
    expect(staleMessageIds(node, cut, true)).toEqual(["a", "c", "d", "e"]);
    expect(staleMessageIds(null, cut, true)).toEqual([]);
  });
});

// v18.9.0 (/code-review): the body reader was a private copy in six handlers
// and the bearer parse a copy in eight; one module serves them now, and a
// handler that writes either out again fails here.
describe("readJsonBody / bearerToken (api/_lib/request.js)", () => {
  it("reads a body Vercel parsed, a string, a stream, and answers null for no JSON", async () => {
    expect(await readJsonBody({ body: { a: 1 } })).toEqual({ a: 1 });
    expect(await readJsonBody({ body: '{"b":2}' })).toEqual({ b: 2 });
    expect(await readJsonBody({ body: "{bad" })).toBeNull();
    expect(await readJsonBody(Readable.from([Buffer.from('{"c":'), Buffer.from("3}")]))).toEqual({ c: 3 });
    expect(await readJsonBody(Readable.from([Buffer.from("not json")]))).toBeNull();
  });
  it("takes the token after \"Bearer \" and nothing else", () => {
    expect(bearerToken({ headers: { authorization: "Bearer abc.def" } })).toBe("abc.def");
    expect(bearerToken({ headers: { authorization: "Basic abc" } })).toBeNull();
    expect(bearerToken({ headers: {} })).toBeNull();
  });
  it("no handler under api/ reads a body or a bearer token by itself", () => {
    const files = ["api/", "api/_lib/"].flatMap((d) => readdirSync(new URL("../" + d, import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => d + f)).filter((f) => f !== "api/_lib/request.js");
    let users = 0;
    for (const f of files) {
      const src = stripComments(readFileSync(new URL("../" + f, import.meta.url), "utf8")).join("\n");
      expect(src, f).not.toMatch(/function readJsonBody\b/);
      expect(src, f).not.toMatch(/startsWith\("Bearer "\)/);
      if (/bearerToken\(req\)/.test(src)) users++;
    }
    // v18.10.0: wa-usage, the cost counter, is the ninth.
    expect(users).toBe(9);
  });
});

// ── v18.12.0: the rehearsal's two safety nets ───────────────────────────────
// The rehearsal connects a REAL number to the sandbox (Patryk's own Business
// number, 2026-10-26). Two things then reach real people unless stopped: the
// auto-reply, sent to anyone who writes to that number for the first time, and
// any reply to a simulator conversation, whose made-up phone may be somebody's.
describe("v18.12.0 — the auto-reply switch (settings/whatsapp.autoReply)", () => {
  const TS = 1_800_000_000_000;
  const acks = () => msgsAt(KEY).filter((m) => m.isAutoAck);

  it("absent node, absent key and true all send it: the default is on", async () => {
    for (const whatsapp of [undefined, {}, { autoReply: true }]) {
      fake.state.tree = whatsapp === undefined ? {} : { settings: { whatsapp } };
      await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.ON" });
      expect(acks().length).toBe(1);
    }
  });

  it("off: no reply, no Graph call, and the claim is KEPT, so the number never gets one, even after the switch goes back on", async () => {
    goLive();
    const f = graphFetch(); vi.stubGlobal("fetch", f);
    fake.state.tree = { settings: { whatsapp: { autoReply: false } } };
    await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.OFF1" });
    expect(f).not.toHaveBeenCalled();
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
    expect(convAt(KEY).autoAckSent).toBe(true);
    fake.state.tree.settings.whatsapp.autoReply = true;
    await processInbound({ phone: KEY, text: "¿Hola?", ts: TS + 60000, wamid: "wamid.OFF2" });
    expect(f).not.toHaveBeenCalled();
    expect(acks()).toEqual([]);
  });

  it("a setting that cannot be read sends nothing and hands the claim back, like a failed send", async () => {
    goLive();
    const f = graphFetch(); vi.stubGlobal("fetch", f);
    const realRef = fake.db.ref;
    fake.db.ref = (path) => {
      const r = realRef(path);
      if (path === "settings/whatsapp") r.get = async () => { throw new Error("read refused"); };
      return r;
    };
    try {
      await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.ERR" });
    } finally {
      fake.db.ref = realRef;
    }
    expect(f).not.toHaveBeenCalled();
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
    expect(convAt(KEY).autoAckSent).toBe(false);
  });

  it("is read only for a first message: a later one costs no extra read", async () => {
    fake.state.tree = { conversations: { [KEY]: { phoneKey: KEY, autoAckSent: true } } };
    const realRef = fake.db.ref;
    const paths = [];
    fake.db.ref = (path) => { paths.push(path); return realRef(path); };
    try {
      await processInbound({ phone: KEY, text: "gracias", ts: TS, wamid: "wamid.LATER" });
    } finally {
      fake.db.ref = realRef;
    }
    expect(paths).not.toContain("settings/whatsapp");
  });
});

describe("v18.12.0 — a simulator conversation never reaches Meta, whatever WA_SEND_MODE says", () => {
  beforeEach(() => vi.stubEnv("WA_SIM_ENABLED", "1"));

  it("the simulator's first message stamps the conversation `sim`, and its auto-reply stays mock on a live deployment", async () => {
    goLive();
    const f = graphFetch(); vi.stubGlobal("fetch", f);
    await injectSimInbound({ phone: KEY, text: "hola" }, () => {});
    expect(convAt(KEY).sim).toBe(true);
    expect(f).not.toHaveBeenCalled();
    const ack = msgsAt(KEY).find((m) => m.isAutoAck);
    expect(ack).toMatchObject({ status: "delivered" });
    expect(ack.providerMsgId).toMatch(/^wamid\.MOCK\./);
  });

  it("a real conversation is never stamped, and the simulator writing into one does not stamp it either", async () => {
    await processInbound({ phone: KEY, text: "Hola", ts: Date.now(), wamid: "wamid.REAL1" });
    expect("sim" in convAt(KEY)).toBe(false);
    await injectSimInbound({ phone: KEY, text: "otra" }, () => {});
    expect("sim" in convAt(KEY)).toBe(false);
  });

  it("wa-send: a reply to a sim conversation is stored as mock-delivered and calls nothing; a real one sends", async () => {
    goLive();
    const f = graphFetch(); vi.stubGlobal("fetch", f);
    fake.state.tree = { conversations: { [KEY]: openConv({ sim: true }) } };
    const res = await call(sendHandler, { token: "staff", body: { phoneKey: KEY, text: "Mesa confirmada" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("delivered");
    expect(res.body.wamid).toMatch(/^wamid\.MOCK\./);
    expect(f).not.toHaveBeenCalled();
    // A real one, and one carrying only the client simulator's old `_waSim`
    // (written on every simulated inbound, a real chat included): both send.
    for (const extra of [{}, { _waSim: true }]) {
      fake.state.tree = { conversations: { [KEY]: openConv(extra) } };
      expect((await call(sendHandler, { token: "staff", body: { phoneKey: KEY, text: "hi" } })).body.status).toBe("sent");
    }
    expect(messageCalls(f).length).toBe(2);
  });

  it("wa-media POST: a photo to a sim conversation uploads nothing and sends nothing", async () => {
    goLive();
    const f = graphFetch(); vi.stubGlobal("fetch", f);
    fake.state.tree = { conversations: { [KEY]: openConv({ sim: true }) } };
    const res = await sendFile({ caption: "La terraza" });
    expect(res.statusCode).toBe(200);
    expect(f).not.toHaveBeenCalled();
    const [m] = msgsAt(KEY);
    expect(m.media.mediaId).toMatch(/^MOCK\.image\./);
  });

  // /code-review: decided inside the write that creates the conversation, so
  // there is no unmarked moment and no second write that could fail.
  it("the mark is in the write that creates the conversation, never a write after it", async () => {
    await injectSimInbound({ phone: KEY, text: "hola" }, () => {});
    const created = fake.state.writes.find((w) => w.op === "update" && w.value && w.value.createdAt !== undefined);
    expect(created.value.sim).toBe(true);
    const ev = (event, extra) => call(simInboundHandler, { token: "staff", body: Object.assign({ event }, extra || {}) });
    fake.state.writes = [];
    await ev("echo", { phone: "+34600999777", text: "Hola" });
    const echoConv = fake.state.writes.find((w) => w.op === "update" && w.value && w.value.createdAt !== undefined);
    expect(echoConv.value.sim).toBe(true);
    expect(fake.state.writes.filter((w) => w.value && w.value.sim === true).length).toBe(1);
  });

  it("a real message clears the mark: a chat simulated from a real phone that person then writes to", async () => {
    goLive();
    const f = graphFetch(); vi.stubGlobal("fetch", f);
    fake.state.tree = { conversations: { [KEY]: openConv({ sim: true, autoAckSent: true }) } };
    await processInbound({ phone: KEY, text: "Hola, soy yo", ts: Date.now(), wamid: "wamid.REALIN" });
    expect("sim" in convAt(KEY)).toBe(false);
    expect((await call(sendHandler, { token: "staff", body: { phoneKey: KEY, text: "hi" } })).body.status).toBe("sent");
    // And a reply typed on the phone (a real echo) clears it too.
    fake.state.tree.conversations[KEY].sim = true;
    const { handleEchoes } = await import("../api/_lib/coexist-core.js");
    await handleEchoes(simEchoValue({ phone: KEY, text: "from the phone", now: Date.now() }), freshResults());
    expect("sim" in convAt(KEY)).toBe(false);
  });

  it("the simulator's events stamp what they CREATE (the history's two chats, an echo's new chat) and leave an existing chat alone", async () => {
    const ev = (event, extra) => call(simInboundHandler, { token: "staff", body: Object.assign({ event }, extra || {}) });
    expect((await ev("history")).statusCode).toBe(200);
    for (const digits of [SIM_HISTORY_RECENT, SIM_HISTORY_OLD]) expect(convAt("+" + digits).sim).toBe(true);
    expect((await ev("echo", { phone: "+34600999777", text: "Hola" })).statusCode).toBe(200);
    expect(convAt("+34600999777").sim).toBe(true);
    await processInbound({ phone: KEY, text: "Hola", ts: Date.now(), wamid: "wamid.REAL2" });
    await ev("echo", { phone: KEY, text: "Hola" });
    expect("sim" in convAt(KEY)).toBe(false);
  });
});
