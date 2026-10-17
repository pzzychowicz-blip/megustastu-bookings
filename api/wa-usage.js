// api/wa-usage.js
//
// v18.10.0 — the WhatsApp cost counter's server half (Settings → WhatsApp →
// Messages and cost). Production's eighth function.
//
// GET → `{ configured, mock, currency, months, this, last, at }`: this month's
// and last month's messages as META counted them (delivered, free, billed,
// cost), from Pricing Analytics on the restaurant's WhatsApp Business account.
// Nothing is stored: the figures are asked for each time the section opens, so
// they are always Meta's and there is no node, rule or schema to keep.
//
// **Which account.** `waLink.wabaId` (the one Embedded Signup connected), else
// `META_WABA_ID`, a deployment variable for an account no signup recorded:
// Meta's test account on the sandbox before the rehearsal, or the API-only
// fallback the go-live plan keeps in reserve. Either is checked as a Meta id
// before it becomes a Graph path with the token on it. Neither → 200
// `{ configured: false }`, which the section says in words.
//
// **Mock.** While `WA_SEND_MODE` is not live there is no Meta behind the
// deployment: 200 `{ mock: true }`, and no call.
//
// Guards in order: 405 → staff (verifyStaffToken) → the capability
// (`waCostView`: manager and admin by default, grantable to staff, the same
// `can` the app asks, read from `/roles` and `settings/admin.enforceRoles`) →
// the mock answer → `{ configured: false }` → 503 (no `META_WA_TOKEN`) → Meta,
// whose refusal is a 502 carrying Meta's own message.

import { env, sendMode } from "./_lib/env.js";
import { verifyStaffToken, assertCapability, staffAuthError, readWaLink } from "./_lib/rtdb.js";
import { bearerToken } from "./_lib/request.js";
import { pricingAnalytics } from "./_lib/meta.js";
import { monthBounds, summariseUsage, pricingPoints, currencyOf } from "../src/lib/wa-usage.js";

// Meta's ids are decimal strings (wa-onboard's rule, for the same reason).
const META_ID_RE = /^[0-9]{5,25}$/;

const REFUSAL = "Not authorised: you do not have permission to see WhatsApp costs.";

// The account to ask about, and where its id came from. A `waLink` that is the
// sandbox simulator's (`sim: true`) names no account at Meta.
async function accountId() {
  const link = await readWaLink().catch(() => null);
  const linked = link && link.sim !== true ? String(link.wabaId || "") : "";
  if (META_ID_RE.test(linked)) return { wabaId: linked, source: "link" };
  const fromEnv = String(env("META_WABA_ID", "") || "").trim();
  if (META_ID_RE.test(fromEnv)) return { wabaId: fromEnv, source: "env" };
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }

  const idToken = bearerToken(req);
  if (!idToken) { res.status(401).json({ error: "missing token" }); return; }
  try {
    const decoded = await verifyStaffToken(idToken);
    await assertCapability(decoded, "waCostView", REFUSAL);
  } catch (e) {
    const f = staffAuthError(e);
    res.status(f.status).json({ error: f.error });
    return;
  }

  if (sendMode() !== "live") { res.status(200).json({ configured: false, mock: true }); return; }

  const account = await accountId();
  if (!account) { res.status(200).json({ configured: false, mock: false }); return; }

  const token = env("META_WA_TOKEN", null);
  if (!token) { res.status(503).json({ error: "META_WA_TOKEN is not set, so Meta cannot be asked." }); return; }

  const now = Date.now();
  const bounds = monthBounds(now);
  let answer;
  try {
    answer = await pricingAnalytics(account.wabaId, bounds.askFrom, bounds.askTo, token);
  } catch (e) {
    console.error("[wa-usage] Meta refused the pricing analytics call:", e && e.message);
    res.status(502).json({ error: "Meta did not answer: " + ((e && e.message) || "unknown error") });
    return;
  }
  const months = summariseUsage(pricingPoints(answer), bounds);
  res.status(200).json({
    configured: true,
    mock: false,
    source: account.source,
    currency: currencyOf(answer && answer.currency),
    months: { thisStart: bounds.thisStart, lastStart: bounds.lastStart },
    this: months.this,
    last: months.last,
    at: now,
  });
}
