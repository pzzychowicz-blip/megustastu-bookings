// api/wa-onboard.js
//
// Connecting the restaurant's WhatsApp Business app number to MGT (v18.9.0):
// the server half of Embedded Signup, which the /wa-connect page drives
// (src/wa-connect/). Production's seventh function.
//
// GET  → { appId, configId, graphVersion }: what the page initialises Meta's
//        SDK and FB.login with. Neither id is a secret (both sit in the page's
//        JavaScript the moment it runs); they come from here so they live in
//        the deployment's environment beside the rest of Meta's keys, and the
//        GET doubles as the page's admin check.
// POST { code, wabaId, phoneNumberId }: the onboarding, in Meta's order.
//   1. exchange   the code for a business token, at once: it lives 30 seconds
//   2. link       `waLink` records the account and the number BEFORE any sync
//                 is asked for, so the number guard (wa-inbound) accepts the
//                 sync's webhooks while META_PHONE_NUMBER_ID still names the
//                 old number
//   3. subscribe  POST /{waba}/subscribed_apps, or no webhook comes at all
//   4. contacts   POST /{phone}/smb_app_data  smb_app_state_sync
//   5. history    POST /{phone}/smb_app_data  history
//   6. phone      GET  /{phone}?fields=is_on_biz_app,platform_type
// POST { retry: "subscribe" | "contacts" | "history" | "phone" }: one step
//   again, with META_WA_TOKEN and the ids `waLink` holds (the code is spent).
//   Whether the system user may make these calls on a converted account is a
//   rehearsal finding (go-live plan §3b).
//
// The answer is per step, `{ ok, steps: [{ id, ok, error?, skipped? }], … }`:
// 200 when every step succeeded, 502 when a Meta call failed. A failed
// subscribe SKIPS the two syncs, because Meta runs each once (within 24 hours
// of onboarding) and a sync asked for while no webhook can arrive is a sync
// spent. The phone check runs regardless; it changes nothing.
//
// **The business token is never stored and never returned.** It is a bearer
// that can send as the restaurant and read its chats, and the database is
// readable by every account that can sign in (CLAUDE.md, "A secret … in the
// database"). It lives in this request's memory and nowhere else.
//
// Guards in order: 405 → staff (verifyStaffToken) → admin (assertWaAdmin) →
// 400 → 503 (a key this needs is not set) → the steps.

import { env } from "./_lib/env.js";
import { verifyStaffToken, assertWaAdmin, staffAuthError, readWaLink, updateWaLink, transactWaLink } from "./_lib/rtdb.js";
import { readJsonBody, bearerToken } from "./_lib/request.js";
import { GRAPH_VERSION, exchangeCode, subscribeApp, requestSmbSync, phoneInfo } from "./_lib/meta.js";
import { historyRequested } from "../src/lib/wa-coexist.js";

// Meta's ids are decimal strings. Checked rather than escaped: they become
// Graph paths with a token on them, and the number guard's allowed set.
const META_ID_RE = /^[0-9]{5,25}$/;
const CODE_MAX = 4096;
const RETRYABLE = ["subscribe", "contacts", "history", "phone"];

// Whether the environment's number id is the one just connected. Booleans and
// a word, never the value: wa-config's rule (it answers which keys are set,
// never what they are).
function envNumberState(phoneNumberId) {
  const envId = env("META_PHONE_NUMBER_ID", null);
  if (!envId) return "unset";
  return String(envId) === String(phoneNumberId) ? "same" : "different";
}

// One step: run it, and report it as `{ id, ok }` or `{ id, ok: false, error }`.
// The message is Meta's (graphError) or the database's, never a token: none of
// these errors is built from one.
async function step(id, fn) {
  try { await fn(); return { id, ok: true }; }
  catch (e) { return { id, ok: false, error: (e && e.message) || "failed" }; }
}

// Steps 3–6, shared by the onboarding and by a retry. `only` names the one step
// a retry runs; absent, all four run in order.
async function syncSteps(link, token, now, only) {
  const out = [];
  const want = (id) => !only || only === id;
  let subscribed = true;
  if (want("subscribe")) {
    const r = await step("subscribe", async () => {
      await subscribeApp(link.wabaId, token);
      await updateWaLink({ subscribedAt: now });
    });
    subscribed = r.ok;
    out.push(r);
  }
  for (const [id, syncType] of [["contacts", "smb_app_state_sync"], ["history", "history"]]) {
    if (!want(id)) continue;
    if (!subscribed) { out.push({ id, ok: false, skipped: true, error: "Not asked: the subscription failed, and Meta runs this only once." }); continue; }
    out.push(await step(id, async () => {
      const requestId = await requestSmbSync(link.phoneNumberId, syncType, token);
      // A new history import starts a new record (`historyRequested`): the
      // same number connected again kept the earlier import's, so Settings
      // said "declined" or "imported" for one that had not begun. The
      // contacts' `firstAt` is a fact about the phone's address book and stays.
      if (id === "history") await transactWaLink("history", (cur) => historyRequested(cur, requestId, now));
      else await updateWaLink({ [id + "/requestId"]: requestId, [id + "/requestedAt"]: now });
    }));
  }
  if (want("phone")) {
    out.push(await step("phone", async () => {
      const p = await phoneInfo(link.phoneNumberId, token);
      await updateWaLink({ phone: { isOnBizApp: p.isOnBizApp, platformType: p.platformType, checkedAt: now } });
    }));
  }
  return out;
}

function answer(res, steps, extra) {
  const ok = steps.every((s) => s.ok);
  res.status(ok ? 200 : 502).json(Object.assign({ ok, steps }, extra || {}));
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

  const idToken = bearerToken(req);
  if (!idToken) { res.status(401).json({ error: "missing token" }); return; }
  let decoded;
  try {
    decoded = await assertWaAdmin(await verifyStaffToken(idToken));
  } catch (e) {
    const f = staffAuthError(e);
    res.status(f.status).json({ error: f.error });
    return;
  }

  if (req.method === "GET") {
    const appId = env("META_APP_ID", null);
    const configId = env("META_ES_CONFIG_ID", null);
    if (!appId || !configId) {
      res.status(503).json({ error: "META_APP_ID and META_ES_CONFIG_ID must both be set in this deployment's environment variables before the Business app can be connected." });
      return;
    }
    res.status(200).json({ appId, configId, graphVersion: GRAPH_VERSION });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") { res.status(400).json({ error: "a JSON body is required" }); return; }
  const now = Date.now();

  // ── A retry: one step, with the system user's token ───────────────────────
  if (body.retry !== undefined) {
    if (RETRYABLE.indexOf(body.retry) < 0) { res.status(400).json({ error: "retry must be one of " + RETRYABLE.join(", ") }); return; }
    const link = await readWaLink();
    if (!link || !META_ID_RE.test(String(link.wabaId || "")) || !META_ID_RE.test(String(link.phoneNumberId || ""))) {
      res.status(400).json({ error: "Nothing is connected yet: connect the Business app first." });
      return;
    }
    if (link.sim === true) {
      res.status(400).json({ error: "The connection is the sandbox simulator's: there is nothing at Meta to try again." });
      return;
    }
    const token = env("META_WA_TOKEN", null);
    if (!token) { res.status(503).json({ error: "META_WA_TOKEN is not set, so a step cannot be tried again." }); return; }
    answer(res, await syncSteps(link, token, now, body.retry), { phoneNumberId: String(link.phoneNumberId), envNumber: envNumberState(link.phoneNumberId) });
    return;
  }

  // ── The onboarding ────────────────────────────────────────────────────────
  const code = typeof body.code === "string" ? body.code : "";
  const wabaId = typeof body.wabaId === "string" ? body.wabaId : "";
  const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId : "";
  if (!code || code.length > CODE_MAX) { res.status(400).json({ error: "code is required" }); return; }
  if (!META_ID_RE.test(wabaId) || !META_ID_RE.test(phoneNumberId)) { res.status(400).json({ error: "wabaId and phoneNumberId must be Meta ids" }); return; }
  const appId = env("META_APP_ID", null);
  const appSecret = env("META_APP_SECRET", null);
  if (!appId || !appSecret) { res.status(503).json({ error: "META_APP_ID and META_APP_SECRET must both be set to exchange the signup code." }); return; }

  const extra = { phoneNumberId, envNumber: envNumberState(phoneNumberId) };
  let token = null;
  const exchanged = await step("exchange", async () => { token = await exchangeCode(code, appId, appSecret); });
  if (!exchanged.ok) { answer(res, [exchanged], extra); return; }

  const linked = await step("link", async () => {
    const prev = await readWaLink();
    const patch = {
      status: "connected", wabaId, phoneNumberId,
      connectedAt: now, connectedBy: String(decoded.email || ""),
      disconnect: null,
      // A real connection over one the sandbox's simulator made: no longer
      // the simulator's (api/_lib/sim-events.js leaves a real one alone).
      sim: null,
    };
    // Another number than the one connected before: what was recorded about
    // the old one's syncs is not this one's. The contacts themselves stay
    // (waContacts is keyed by the customer's number, not ours), and so does
    // `measured` (/code-review): it records what Meta sends, which another
    // number does not change, and cleared here it would take the rehearsal's
    // answers with it at the next connection.
    if (prev && prev.phoneNumberId && String(prev.phoneNumberId) !== phoneNumberId) {
      patch.contacts = null; patch.history = null; patch.phone = null; patch.subscribedAt = null;
    }
    await updateWaLink(patch);
  });
  // Without the link, the sync's webhooks would be refused by the number
  // guard; asking for them now would spend Meta's one sync on nothing.
  if (!linked.ok) { res.status(500).json(Object.assign({ ok: false, steps: [exchanged, linked] }, extra)); return; }

  answer(res, [exchanged, linked].concat(await syncSteps({ wabaId, phoneNumberId }, token, now)), extra);
}
