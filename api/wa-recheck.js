// api/wa-recheck.js
//
// WhatsApp backend — MANUAL re-check of one conversation. The staff-initiated
// counterpart of the webhook's automatic per-message parse, for the case the
// design always knew would happen: the LLM read a message as "question"/"other"
// when the customer was in fact asking for a change, or the request only makes
// sense across several messages. The ⟳✓ button in the conversation header
// posts here.
//
//   POST { phoneKey }
//   Authorization: Bearer <Firebase ID token>     (staff auth, NOT Meta HMAC —
//                                                  same gate as api/wa-sim-*)
//   → { intent, updated }   updated = a draft/intent was actually set
//
// Unlike api/wa-sim-*, this is NOT sandbox-only tooling — it is a real staff
// feature that ships with the module. It writes through the SAME applyParse the
// webhook uses, so a re-check produces exactly the draft, the intent banner and
// the draftUpdatedAt stamp an inbound message would have produced. In
// particular a previously "handled" intent banner re-surfaces, which is correct
// here: the staff explicitly asked whether anything is outstanding.
//
// It never appends a message and never sends anything to the customer — the
// thread is read-only input.

import { verifyStaffToken, staffAuthError, getConversation, readMessages, readOperatingHours } from "./_lib/rtdb.js";
import { parseThread } from "./_lib/gemini.js";
import { applyParse } from "./_lib/inbound-core.js";
import { WA_RECHECK_HISTORY, normalizePhone } from "../src/lib/whatsapp.js";

function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve(null); } }
    return Promise.resolve(req.body);
  }
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }

  // ── Staff auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) { res.status(401).json({ error: "missing token" }); return; }
  try {
    await verifyStaffToken(idToken);
  } catch (e) {
    const f = staffAuthError(e);
    res.status(f.status).json({ error: f.error });
    return;
  }

  const body = await readJsonBody(req);
  const raw = body && typeof body.phoneKey === "string" ? body.phoneKey.trim() : "";
  // Normalise, don't trust. This is the first endpoint to take a conversation
  // key straight from a request body, and that key is concatenated into RTDB
  // paths by getConversation / readMessages / applyParse. `/` is legal in an
  // RTDB path, so an unvalidated key would let a signed-in client read and
  // WRITE arbitrary sub-paths under conversations/. Every other caller of those
  // helpers passes a normalizePhone() result — so require the client sent one,
  // and reject anything that does not round-trip through it unchanged.
  const phoneKey = normalizePhone(raw);
  if (!phoneKey || phoneKey === "+" || phoneKey !== raw) { res.status(400).json({ error: "valid phoneKey required" }); return; }

  try {
    const conv = await getConversation(phoneKey);
    if (!conv) { res.status(404).json({ error: "unknown conversation" }); return; }
    const history = await readMessages(phoneKey, WA_RECHECK_HISTORY);
    if (!history.length) { res.status(400).json({ error: "no messages to check" }); return; }

    // Same draft-awareness as the inbound path: a PENDING draft is context the
    // model merges into, an accepted/dismissed one is not.
    const existingDraft = conv.draftStatus === "parsed" ? conv.draftData : null;
    const hours = await readOperatingHours();
    // isAutoAck is dropped, not passed through: the one-time "Thanks for your
    // message! We'll get back to you shortly." is a bot line, and handing it to
    // the model as a STAFF turn — under a prompt that says to ignore whatever
    // staff has already answered — biases it toward "nothing outstanding" on
    // exactly the short threads this button exists to re-examine.
    const parse = await parseThread(
      history.filter((m) => !m.isAutoAck).map((m) => ({ direction: m.direction, text: m.text })),
      { hours, existingDraft }
    );

    // Stamp with NOW, not the last message's ts: this check happened now, and
    // draftUpdatedAt is the intent-banner re-show gate (intentBannerVisible).
    // Stamping it in the past would leave a genuine finding hidden behind an
    // older "Mark as handled".
    await applyParse(phoneKey, parse, Date.now());

    const intent = parse ? parse.intent || null : null;
    const updated = intent === "new_booking" || intent === "cancel" || intent === "modify";
    res.status(200).json({ intent, updated });
  } catch (e) {
    // applyParse already cleared `parsing` on any path that reached it; a throw
    // before that leaves it set, which the CLIENT clears in its catch.
    res.status(e.status || 500).json({ error: e.name === "AbortError" ? "Gemini timeout" : e.message });
  }
}
