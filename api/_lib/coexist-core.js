// api/_lib/coexist-core.js
//
// WhatsApp backend — COEXISTENCE (v18.9.0): the restaurant number runs the
// WhatsApp Business app on the phone AND the Cloud API (MGT) at once. Meta then
// sends four more webhook fields to the same URL, beside `messages`:
//
//   smb_app_state_sync  — the phone's address book: a contact added, edited or
//                         removed (and every contact once, on request, after
//                         onboarding)
//   smb_message_echoes  — a message staff sent FROM THE PHONE
//   history             — the chats the phone already held, imported once
//   account_update      — the connection itself: disconnected, reconnected, …
//
// api/wa-inbound.js dispatches on `change.field` and hands each of these to a
// handler here; the simulator (api/wa-sim-inbound.js, `event`) builds the same
// Meta-shaped `value`s and calls the same handlers, so a simulated contact or
// history import is stored exactly as Meta's would be.
//
// Every handler is IDEMPOTENT — keyed by wamid or by phone key — because the
// webhook's retry rule (500 when everything failed, so Meta redelivers) assumes
// a redelivery rewrites the same records rather than adding new ones.

import { env } from "./env.js";
import {
  readWaLink, readWaContactsFor, updateWaContacts, stampWaLinkOnce,
  getConversation, upsertConversation, appendMessage, sanitizeKey, findMessageByWamid, updateMessage,
  readMessageNode, writeImportedThread, transactWaLink, updateWaLink,
} from "./rtdb.js";
import { inboundContent } from "./inbound-core.js";
import { snippet } from "../../src/lib/whatsapp.js";
import {
  contactPlan, contactPatch, secondsTs, webhookPhoneKey,
  echoRecord, echoConvPatch, changedMessageId, editedMessage, editedText, editPatch, revokePatch, changeLine,
  historyRecord, historyStatus, historyConvPatch, historyDeclined, historyProgress, threadPlan,
  accountEvent, linkAfterEvent,
} from "../../src/lib/wa-coexist.js";

// The fields this file handles. `messages` is not among them: it stays in
// api/wa-inbound.js, which owns the async parse.
export const COEXIST_FIELDS = ["smb_app_state_sync", "smb_message_echoes", "history", "account_update"];

// ── The number guard ─────────────────────────────────────────────────────────
// numberIsOurs(phoneNumberId, envId, linkId) — may this change be stored?
//
// One Meta app can hold several numbers, and the sandbox app does: Meta's test
// number AND the rehearsal's number. Without a guard every number's customers,
// contacts and history would land in one inbox. The allowed set is the
// configured number (META_PHONE_NUMBER_ID) plus the one Embedded Signup
// connected (`waLink.phoneNumberId`). The second is not a convenience: the
// contact and history syncs are requested during onboarding, minutes BEFORE
// anyone can set the env var to the new id and redeploy, and they are requested
// once — a sync dropped for a wrong number is a sync lost.
//
//   · no phone-number id on the change → allowed (account_update carries none;
//     the simulator's fake webhook carries none on purpose)
//   · nothing configured at all → allowed: the mock sandbox and the local
//     harness, where there is no real number to protect
//   · otherwise allowed only when it is one of the two
export function numberIsOurs(phoneNumberId, envId, linkId) {
  if (!phoneNumberId) return true;
  if (!envId && !linkId) return true;
  const id = String(phoneNumberId);
  return (!!envId && id === String(envId)) || (!!linkId && id === String(linkId));
}

// makeNumberGuard() → async (value) => boolean, for one webhook delivery.
// `waLink` is read at most ONCE per delivery, and only when the env id did not
// already answer — so the common case (the configured number) costs no read.
// A failed read throws to the caller, which counts the change as an error: a
// delivery that could not be checked is one Meta should send again.
export function makeNumberGuard(readLink = readWaLink) {
  let link; // undefined = not read yet
  return async function isOurs(value) {
    const meta = value && value.metadata;
    const pid = meta && typeof meta === "object" ? meta.phone_number_id : null;
    const envId = env("META_PHONE_NUMBER_ID", null);
    if (!pid || (envId && String(pid) === String(envId))) return true;
    if (link === undefined) link = (await readLink()) || null;
    return numberIsOurs(pid, envId, link && link.phoneNumberId);
  };
}

// ── Contacts: smb_app_state_sync ─────────────────────────────────────────────
// The phone's address book, one webhook per batch: after onboarding every
// contact once (requested by api/wa-onboard.js, phase 8), then each add, edit
// or remove as it happens on the phone. The phone is the master (Patryk,
// 2026-10-15): MGT never writes a name back, because Meta has no API for it.
//
// The first batch to land stamps `waLink.contacts.firstAt`. Before it, a number
// missing from waContacts means "not synced yet"; after it, "not saved on the
// restaurant phone", which the open conversation says (phase 2's hint).
export async function handleStateSync(value, results, now = Date.now()) {
  const items = Array.isArray(value.state_sync) ? value.state_sync : [];
  const keys = [];
  items.forEach(function (it) {
    const p = contactPlan(it, now);
    if (p && keys.indexOf(p.phoneKey) < 0) keys.push(p.phoneKey);
  });
  if (!keys.length) { results.ignored++; return; }
  const stored = await readWaContactsFor(keys);
  const { patch, count } = contactPatch(items, stored, now);
  await updateWaContacts(patch);
  results.contacts += count;
  await stampWaLinkOnce("contacts/firstAt", now);
}

// ── A customer edits or deletes a message (and staff, on the phone) ─────────
// applyMessageChange(phoneKey, m, now) — apply one `edit` or `revoke` to the
// message it names. Called for the customer's (`messages`, api/wa-inbound.js)
// and for the phone's own (`smb_message_echoes`, below). Answers:
//   "applied"   — the stored message changed
//   "unchanged" — it is stored and there is nothing to apply (deleted already,
//                 or an edit with no text in it): a redelivery lands here too
//   "missing"   — no stored message has that id. An edit is then kept as a new
//                 message by the caller; a delete has nothing to delete
//   "invalid"   — no original id: not one we can act on
// Never parsed again, and the draft is left alone (Patryk, 2026-10-15): staff
// see the change in the thread. When the changed message is the conversation's
// last, its line in the list follows, so a deleted message's words do not stay
// on screen there.
export async function applyMessageChange(phoneKey, m, now = Date.now()) {
  const origId = changedMessageId(m);
  if (!origId) return "invalid";
  const found = await findMessageByWamid(phoneKey, origId);
  if (!found) return "missing";
  const ts = secondsTs(m.timestamp, now);
  const stored = found.msg;
  const patch = m.type === "revoke" ? revokePatch(stored, ts) : editPatch(stored, editedText(m), ts);
  if (!patch) return "unchanged";
  await updateMessage(phoneKey, found.key, patch);
  const conv = await getConversation(phoneKey);
  if (conv && Number(conv.lastMessageAt) === Number(stored.ts)) {
    await upsertConversation(phoneKey, { lastMessageSnippet: snippet(changeLine(stored, patch, editedText(m))) });
  }
  return "applied";
}

// ── Phone replies: smb_message_echoes ────────────────────────────────────────
// What staff send from the WhatsApp Business app comes back here, one
// `message_echoes[]` item per message, `to` being the customer. Each is stored
// as an outgoing message tagged "phone" (`echoRecord`), keyed by its wamid, and
// its conversation is updated by `echoConvPatch` (read, out of Archived unless
// muted, no auto-reply, the window untouched). An echoed edit or delete goes
// through `applyMessageChange`.
//
// One echo's failure does not stop the next: each is counted on its own, and
// only a delivery where everything failed is answered 500 for Meta to send
// again, which rewrites the same records.
export async function handleEchoes(value, results, now = Date.now()) {
  const echoes = Array.isArray(value.message_echoes) ? value.message_echoes : [];
  if (!echoes.length) { results.ignored++; return; }
  for (const raw of echoes) {
    try {
      const phoneKey = webhookPhoneKey(raw && raw.to);
      if (!phoneKey) { results.ignored++; continue; }
      let m = raw;
      if (m.type === "edit" || m.type === "revoke") {
        const r = await applyMessageChange(phoneKey, m, now);
        if (r === "applied") { results.edits++; continue; }
        if (r !== "missing" || m.type === "revoke") { results.skipped++; continue; }
        m = editedMessage(m); // an edit of a message we never stored: keep it as a new one
        if (!m) { results.skipped++; continue; }
      }
      const wamid = typeof m.id === "string" && m.id ? m.id : null;
      // No wamid, no key: storing it under a made-up one would add it again on
      // every redelivery.
      if (!wamid) { results.ignored++; continue; }
      // A message sent FROM MGT is stored under its own id with the wamid as
      // `providerMsgId`, so the look-up is by wamid, not by key alone.
      if (await findMessageByWamid(phoneKey, wamid)) { results.skipped++; continue; }
      const content = inboundContent(m);
      const ts = secondsTs(m.timestamp, now);
      const conv = await getConversation(phoneKey);
      // The conversation first, as processInbound does: a redelivery after a
      // failed message write still finds no message and writes both again.
      await upsertConversation(phoneKey, echoConvPatch(conv, { phoneKey, phone: phoneKey, ts, snippet: snippet(content.snippet) }));
      await appendMessage(phoneKey, echoRecord(sanitizeKey(wamid), wamid, content, ts));
      results.echoes++;
    } catch (e) {
      results.errors++;
      console.error("[wa-inbound] phone reply failed:", e.message);
    }
  }
}

// ── History: the chats the phone already held ───────────────────────────────
// importThread(thread, now) → how many messages it stored. One read of the
// thread's messages (what is already stored is skipped: a redelivered chunk
// rewrites nothing), one of its conversation, and ONE root update of both
// (`writeImportedThread`). What the thread stores is `threadPlan`
// (src/lib/wa-coexist.js), which the simulator's client mode asks too.
export async function importThread(thread, now = Date.now()) {
  if (!webhookPhoneKey(thread && thread.id)) return 0;
  const node = await readMessageNode(webhookPhoneKey(thread.id));
  const have = new Set();
  Object.keys(node).forEach(function (k) {
    have.add(k);
    const p = node[k] && node[k].providerMsgId;
    if (typeof p === "string" && p) have.add(sanitizeKey(p));
  });
  const plan = threadPlan(thread, have, inboundContent, sanitizeKey, now);
  if (!plan || plan.newest === -Infinity) return 0;
  const conv = await getConversation(plan.phoneKey);
  await writeImportedThread(plan.phoneKey, plan.records, historyConvPatch(conv, { phoneKey: plan.phoneKey, oldest: plan.oldest, newest: plan.newest, snippet: snippet(plan.line), now }));
  return plan.records.length;
}

// attachHistoryMedia(value, m, now) — a `history` change's own `messages[]`:
// the media of a photo or a file imported as a placeholder, under the same
// wamid. Its customer is `from`, or `to` when it is the restaurant's own (the
// business number is the change's `display_phone_number`). Found → the
// placeholder takes the media and its caption or label; not found (it came
// before its thread) → stored whole, and the thread's import, finding it
// stored, leaves it. Answers "applied", "stored", "skipped" or "ignored".
export async function attachHistoryMedia(value, m, now = Date.now()) {
  const wamid = m && typeof m.id === "string" && m.id ? m.id : null;
  if (!wamid) return "ignored";
  const content = inboundContent(m);
  if (!content.media) return "skipped";
  const biz = webhookPhoneKey(value.metadata && value.metadata.display_phone_number);
  const fromKey = webhookPhoneKey(m.from);
  const incoming = !biz || fromKey !== biz;
  const phoneKey = incoming ? fromKey : webhookPhoneKey(m.to);
  if (!phoneKey) return "ignored";
  const found = await findMessageByWamid(phoneKey, wamid);
  if (found) {
    if (found.msg && found.msg.media) return "skipped";
    await updateMessage(phoneKey, found.key, { media: content.media, text: content.text });
    return "applied";
  }
  const ts = secondsTs(m.timestamp, now);
  await appendMessage(phoneKey, historyRecord(sanitizeKey(wamid), wamid, content, ts, incoming, historyStatus(m, incoming)));
  return "stored";
}

// handleHistory(value, results, now) — one `history` change. A declined
// share (2593109) is recorded on `waLink.history` and nothing else. Each
// thread is imported on its own; the chunk's progress is recorded after its
// threads. Counted as `results.history` (messages stored or given media).
//
// **A chunk with a thread that failed answers `{ retry: true }`**, which
// api/wa-inbound.js turns into a 500 so Meta sends the chunk again. History
// is sent ONCE, so a thread dropped is a thread lost; every write here is
// keyed, so the resend skips what landed and writes only what did not.
export async function handleHistory(value, results, now = Date.now()) {
  const items = Array.isArray(value.history) ? value.history : [];
  const follow = Array.isArray(value.messages) ? value.messages : [];
  if (!items.length && !follow.length && !historyDeclined(value)) { results.ignored++; return undefined; }
  let retry = false;
  if (historyDeclined(value)) {
    await transactWaLink("history", function (cur) { return Object.assign({}, cur || {}, { declined: true, at: now }); });
    results.events++;
  }
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (historyDeclined(item)) {
      await transactWaLink("history", function (cur) { return Object.assign({}, cur || {}, { declined: true, at: now }); });
      results.events++;
      continue;
    }
    let failed = false;
    for (const thread of Array.isArray(item.threads) ? item.threads : []) {
      try {
        results.history += await importThread(thread, now);
      } catch (e) {
        failed = true;
        results.errors++;
        console.error("[wa-inbound] history thread failed:", e.message);
      }
    }
    if (failed) retry = true;
    // Progress is recorded even after a failed thread: what it says is how far
    // Meta has got, and the resend brings the thread, not a new figure.
    if (item.metadata) await transactWaLink("history", function (cur) { return historyProgress(cur, item.metadata, now); });
  }
  for (const m of follow) {
    try {
      const r = await attachHistoryMedia(value, m, now);
      if (r === "applied" || r === "stored") results.history++;
      else if (r === "skipped") results.skipped++;
      else results.ignored++;
    } catch (e) {
      retry = true;
      results.errors++;
      console.error("[wa-inbound] history media failed:", e.message);
    }
  }
  return retry ? { retry: true } : undefined;
}

// ── The connection: account_update ───────────────────────────────────────────
// handleAccountUpdate(value, results, now, { wabaId }) — a disconnection or a
// reconnection of the number Embedded Signup connected, recorded on `waLink`
// (`linkAfterEvent`): `status`, `disconnect` (why, for the banner) and
// `lastEvent`. An account_update carries no phone-number id, so the number
// guard lets every one through; this one asks instead whether the event is
// about the CONNECTED account: the delivery's `entry.id` is the WABA, and it
// must be `waLink.wabaId`. With no link at all (the mock sandbox, a deployment
// never connected) there is nothing to describe, so it is ignored: the
// sandbox's Meta app holds the test number's account too, and an event about
// that one must not put a red banner on the inbox.
export async function handleAccountUpdate(value, results, now = Date.now(), ctx = {}) {
  const ev = accountEvent(value, now);
  if (!ev) { results.ignored++; return; }
  const link = await readWaLink();
  const wabaId = link && link.wabaId ? String(link.wabaId) : "";
  if (!wabaId || (ctx.wabaId && String(ctx.wabaId) !== wabaId)) { results.ignored++; return; }
  await updateWaLink(linkAfterEvent(ev));
  results.events++;
}

// The handler for each coexistence field, as api/wa-inbound.js dispatches:
// `(value, results, now, { wabaId })`, the last being the delivery's
// `entry.id`. A handler may answer `{ retry: true }`: the delivery is then
// answered 500.
export const COEXIST_HANDLERS = {
  smb_app_state_sync: handleStateSync,
  smb_message_echoes: handleEchoes,
  history: handleHistory,
  account_update: handleAccountUpdate,
};
