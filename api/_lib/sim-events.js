// api/_lib/sim-events.js
//
// The sandbox simulator's coexistence events (v18.9.0), for
// api/wa-sim-inbound.js `POST { event, phone?, name?, text?, remove? }`.
// Each event is built as Meta's webhook `value` (src/lib/wa-sim-coexist.js)
// and handed to the handler the real webhook uses (_lib/coexist-core.js), so
// a simulated contact, phone reply, edit, history import or disconnection is
// stored exactly as Meta's would be:
//
//   contact         smb_app_state_sync   handleStateSync   (`remove: true` removes)
//   echo            smb_message_echoes   handleEchoes
//   edit · revoke   messages edit/revoke applyMessageChange, on the customer's
//                                        newest message in that conversation
//   history         history              handleHistory     (two chats, one old)
//   history-media   history messages[]   handleHistory     (the photo's media)
//   connect         —                    a `waLink` marked `sim: true`
//   disconnect      account_update       handleAccountUpdate (PARTNER_REMOVED)
//   reconnect       account_update       handleAccountUpdate (ACCOUNT_RECONNECTED)
//   forget          —                    removes the simulated `waLink`
//
// **A real connection is left alone** (`simEventRefusal`, 409): the sandbox
// runs on DEV Firebase, where the rehearsal's real connection is recorded, and
// an event that writes `waLink` would put words in its Settings section and
// its banner that Meta never said. Reached only behind the endpoint's own
// gates (simEnabled → staff), and the endpoint is not deployed to production.

import { env } from "./env.js";
import { readWaLink, updateWaLink, readMessageNode, removeSimWaLink } from "./rtdb.js";
import { handleStateSync, handleEchoes, handleHistory, handleAccountUpdate, applyMessageChange } from "./coexist-core.js";
import { normalizePhone, isPhoneKey } from "../../src/lib/whatsapp.js";
import {
  simEventRefusal, simContactValue, simEchoValue, simChangeMessage, lastCustomerMessage,
  simHistoryValue, simHistoryMediaValue, simAccountValue, simLinkPatch, SIM_WABA_ID,
} from "../../src/lib/wa-sim-coexist.js";

const NEEDS_PHONE = ["contact", "echo", "edit", "revoke"];

function freshResults() {
  return { messages: 0, statuses: 0, echoes: 0, edits: 0, contacts: 0, history: 0, events: 0, skipped: 0, ignored: 0, errors: 0 };
}

// runSimEvent(body, decoded, now) → { status, data }: what the endpoint
// answers. `decoded` is the staff token (its email names who connected).
export async function runSimEvent(body, decoded, now = Date.now()) {
  const event = String(body.event || "");
  const phoneKey = normalizePhone(body.phone);
  if (NEEDS_PHONE.indexOf(event) >= 0 && !isPhoneKey(phoneKey)) {
    return { status: 400, data: { error: "phone is required for " + event } };
  }
  const link = await readWaLink();
  const refusal = simEventRefusal(event, link, true);
  if (refusal) return { status: refusal === "Unknown event." ? 400 : 409, data: { error: refusal } };

  const results = freshResults();
  const ok = (extra) => ({ status: 200, data: Object.assign({ ok: true, event, results }, extra || {}) });

  if (event === "contact") {
    await handleStateSync(simContactValue({ phone: phoneKey, name: body.name, remove: body.remove === true, now }), results, now);
    return ok();
  }
  if (event === "echo") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return { status: 400, data: { error: "text is required for echo" } };
    await handleEchoes(simEchoValue({ phone: phoneKey, text, now }), results, now);
    return ok();
  }
  if (event === "edit" || event === "revoke") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (event === "edit" && !text) return { status: 400, data: { error: "text is required for edit" } };
    const node = await readMessageNode(phoneKey);
    const target = lastCustomerMessage(Object.keys(node).map((k) => ({ key: k, msg: node[k] })));
    if (!target) return { status: 409, data: { error: "That conversation has no message from the customer to " + (event === "edit" ? "edit." : "delete.") } };
    const m = simChangeMessage({ kind: event, phone: phoneKey, originalId: target.msg.providerMsgId || target.key, text, now });
    const r = await applyMessageChange(phoneKey, m, now);
    if (r === "applied") results.edits++;
    else results.skipped++;
    return ok({ outcome: r });
  }
  if (event === "history") {
    await handleHistory(simHistoryValue(now), results, now);
    return ok();
  }
  if (event === "history-media") {
    await handleHistory(simHistoryMediaValue(now), results, now);
    return ok();
  }
  if (event === "connect") {
    await updateWaLink(simLinkPatch({ now, by: decoded && decoded.email, phoneNumberId: env("META_PHONE_NUMBER_ID", null) }));
    return ok();
  }
  if (event === "disconnect" || event === "reconnect") {
    await handleAccountUpdate(simAccountValue(event), results, now, { wabaId: SIM_WABA_ID });
    return ok();
  }
  // forget
  return ok({ removed: await removeSimWaLink() });
}
