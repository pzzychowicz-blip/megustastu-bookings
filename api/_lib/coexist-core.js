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

// ── The delivery's counters ──────────────────────────────────────────────────
// freshResults() — what one delivery did: one counter per kind of record, plus
// `skipped` (stored already), `ignored` (another number, or a field this
// webhook does not handle) and `errors`. The webhook (api/wa-inbound.js) and
// the simulator's events (_lib/sim-events.js) both start from it, where each
// typed it out (the /code-review): wa-inbound's retry rule sums every key but
// `errors`, so a counter a handler bumps and a copy lacks reads NaN, and a
// delivery that failed everywhere is answered 200 and never sent again.
// tests/api-handlers.test.js holds every `results.<name>++` under api/ to these.
// `mgtEchoes` (v18.9.0 follow-up) is an echo that named a message MGT sent,
// counted apart from `skipped` because the rehearsal asks whether one ever
// comes (handleEchoes, and "What a delivery measures" below).
export function freshResults() {
  return { messages: 0, statuses: 0, echoes: 0, mgtEchoes: 0, edits: 0, contacts: 0, history: 0, events: 0, skipped: 0, ignored: 0, errors: 0 };
}

// ── What a delivery measures (v18.9.0 follow-up) ─────────────────────────────
// The rehearsal (go-live plan §3b) has two questions that only Meta's real
// webhooks can answer, and this is their instrument:
//
//   Does an echo ever name a message MGT sent? (`mgtEchoes`, handleEchoes.)
//     If never, handleEchoes can find a new phone reply by its key alone
//     instead of reading the whole thread for it (ROADMAP). findMessageByWamid
//     keeps its scan either way: an echoed edit or delete of a message MGT sent
//     finds its original through it (applyMessageChange), a case this count
//     does not see (/code-review).
//   How big and how slow is a history delivery? Vercel refuses a request body
//     over 4.5 MB, and the import runs against the function's time limit.
//     A body over the cap is refused BEFORE this function runs, so nothing
//     here can see it; what it can see is which chunks did land, listed per
//     phase (`historyChunks`): a gap in their numbers is one that never did
//     (/code-review).
//
// COUNTS ONLY: nothing here holds a message's text, a phone number, a name, a
// wamid, an account id or a token. Every value is a number or one of this
// file's own names, which tests/api-handlers.test.js holds to a strict shape.
//
// Each coexistence delivery logs ONE line (`deliveryLine`), for watching it
// live. Vercel keeps a Hobby project's runtime logs for an hour, and a
// week-long rehearsal cannot be watched for a week, so a history delivery and
// an echo of a message MGT sent are also recorded on `waLink/measured`
// (`measuredAfter`), which stays: read it in the Firebase console.
//
// That record is written at the END of the handler, so a delivery that never
// gets there would leave nothing on it, and the one that does not get there is
// the one the time question is about: an invocation the function's time limit
// ends (/code-review). A history delivery is therefore also counted as it
// BEGINS (`recordBegun`): `historyBegun` above `historyDeliveries` is a
// delivery that never answered.

// newMeasure() → the tally api/wa-inbound.js keeps while it dispatches: the
// changes it handed to a coexistence handler, per field, and for `history` the
// threads and messages they carried. Those are the PAYLOAD's counts, what the
// size and the time were spent on; `results.history` is what was stored.
// `begun` is a history delivery's start record while it is being written, and
// `chunks` the chunks it carried, as `{phase: "p0", chunk: "c1"}` (chunkKeys).
export function newMeasure() {
  return { changes: 0, fields: {}, threads: 0, messages: 0, begun: null, chunks: [] };
}

// chunkKeys(item) → `{phase, chunk}` naming one history chunk on the record, or
// null when its metadata has no whole numbers in a sane range: the keys are
// `p<phase>` and `c<chunk_order>`, letters first so the database keeps them an
// object (all-number keys can read back as an array).
export function chunkKeys(item) {
  const meta = item && item.metadata;
  if (!meta || typeof meta !== "object") return null;
  const phase = Number(meta.phase);
  const order = Number(meta.chunk_order);
  if (!Number.isInteger(phase) || phase < 0 || phase > 9) return null;
  if (!Number.isInteger(order) || order < 0 || order > 99999) return null;
  return { phase: "p" + phase, chunk: "c" + order };
}

// noteChange(m, field, value) — one change handed to a coexistence handler.
// `field` is a COEXIST_HANDLERS key (the webhook asks before it calls this).
export function noteChange(m, field, value) {
  m.changes++;
  m.fields[field] = (m.fields[field] || 0) + 1;
  if (field !== "history") return;
  for (const item of Array.isArray(value.history) ? value.history : []) {
    for (const t of item && Array.isArray(item.threads) ? item.threads : []) {
      m.threads++;
      if (t && Array.isArray(t.messages)) m.messages += t.messages.length;
    }
    // A chunk of chats (a declined share carries none, and is not one).
    const ck = item && Array.isArray(item.threads) ? chunkKeys(item) : null;
    if (ck) m.chunks.push(ck);
  }
  // A photo's media, sent after its placeholder (attachHistoryMedia).
  if (Array.isArray(value.messages)) m.messages += value.messages.length;
}

// deliveryLine(m, results, d) → the line one coexistence delivery logs, `d`
// being `{status, bytes, ms}`: the answer, the body's size, and the time from
// the request's arrival until its answer was decided (the record's own write
// comes after, and is not in it). `fields` are the coexistence fields
// handed on, `threads` and `messages` a history delivery's, and `counts` the
// delivery's counters that are not 0:
//   [wa-inbound] coexistence delivery status=200 bytes=48211 ms=930 fields=history:1 threads=3 messages=41 counts=history:41
export function deliveryLine(m, results, d) {
  const fields = Object.keys(m.fields).sort().map(function (f) { return f + ":" + m.fields[f]; }).join(",");
  const counts = Object.keys(results).filter(function (k) { return results[k]; }).map(function (k) { return k + ":" + results[k]; }).join(",");
  return "[wa-inbound] coexistence delivery status=" + d.status + " bytes=" + d.bytes + " ms=" + d.ms + " fields=" + fields
    + (m.fields.history ? " threads=" + m.threads + " messages=" + m.messages : "")
    + " counts=" + (counts || "none");
}

// measuredAfter(cur, d, now) → `waLink/measured` after one delivery, `d` being
// `{history, failed, bytes, ms, threads, messages, chunks, mgtEchoes}`:
//   historyBegun        every history delivery that began (beganAfter)
//   historyDeliveries   every one that was answered, 200 or 500: fewer than
//                       historyBegun means one ended first (the time limit)
//   historyFailed       those answered 500, which Meta sends again
//   historyLargest      {bytes, ms, threads, messages, at} of the largest
//   historySlowest      the same, of the slowest; a tie keeps the first
//   historyChunks       per phase, each chunk of a delivery answered 200 and
//                       how many times: {p0: {c1: 1, c2: 2}}. A number missing
//                       between two that came is a chunk that never landed:
//                       one over the 4.5 MB cap, refused before this function
//                       runs, or one that failed every time it was sent
//   mgtEchoes           echoes that named a message MGT sent
//   mgtEchoAt           when the last of them came
// It keeps adding up for as long as `waLink` is there: across history requests
// and across another number connected later (api/wa-onboard.js clears that
// number's sync records and not this, /code-review), because what it answers
// is what Meta sends, and the cap and the time limit are asked about the
// maximum.
export function measuredAfter(cur, d, now) {
  const next = Object.assign({}, cur && typeof cur === "object" ? cur : {});
  const beats = function (prev, key, v) { return !(prev && Number(prev[key]) >= v); };
  if (d.history) {
    const snap = { bytes: d.bytes, ms: d.ms, threads: d.threads, messages: d.messages, at: now };
    next.historyDeliveries = (Number(next.historyDeliveries) || 0) + 1;
    if (d.failed) next.historyFailed = (Number(next.historyFailed) || 0) + 1;
    if (beats(next.historyLargest, "bytes", d.bytes)) next.historyLargest = snap;
    if (beats(next.historySlowest, "ms", d.ms)) next.historySlowest = snap;
    // A delivery answered 500 is sent again, so its chunks wait for the one
    // that lands; listed now, a chunk that fails every time would look landed.
    for (const ck of !d.failed && Array.isArray(d.chunks) ? d.chunks : []) {
      const all = next.historyChunks && typeof next.historyChunks === "object" ? next.historyChunks : {};
      const phase = Object.assign({}, all[ck.phase] && typeof all[ck.phase] === "object" ? all[ck.phase] : {});
      phase[ck.chunk] = (Number(phase[ck.chunk]) || 0) + 1;
      next.historyChunks = Object.assign({}, all, { [ck.phase]: phase });
    }
  }
  if (d.mgtEchoes > 0) {
    next.mgtEchoes = (Number(next.mgtEchoes) || 0) + d.mgtEchoes;
    next.mgtEchoAt = now;
  }
  return next;
}

// beganAfter(cur) → `waLink/measured` once a history delivery has begun:
// `historyBegun` one higher, the rest as it was (it never changes `cur`).
export function beganAfter(cur) {
  const next = Object.assign({}, cur && typeof cur === "object" ? cur : {});
  next.historyBegun = (Number(next.historyBegun) || 0) + 1;
  return next;
}

// recordBegun() → a promise that never rejects: a history delivery's start, on
// the record. api/wa-inbound.js starts it as it hands on the delivery's first
// history change and does not wait for it, so the import is not held up by a
// measurement; reportDelivery waits for it before the end's record. A start
// that cannot be recorded is logged, like an end that cannot.
export function recordBegun() {
  return transactWaLink("measured", beganAfter).catch(function (e) {
    console.error("[wa-inbound] a history delivery's start was not recorded:", e.message);
  });
}

// reportDelivery(m, results, d, now) — the line, then the record when the
// delivery is one the rehearsal asks about (a history change, an echo of a
// message MGT sent). It never throws, and a record that fails changes nothing
// about the delivery's answer: it is a measurement, and a 500 would have Meta
// send the delivery again for nothing but a second measurement.
export async function reportDelivery(m, results, d, now = Date.now()) {
  try {
    console.info(deliveryLine(m, results, d));
    if (m.begun) await m.begun; // the start's record first (recordBegun); it never rejects
    const history = !!m.fields.history;
    if (!history && !(results.mgtEchoes > 0)) return;
    const one = { history, failed: d.status >= 500, bytes: d.bytes, ms: d.ms, threads: m.threads, messages: m.messages, chunks: m.chunks, mgtEchoes: results.mgtEchoes };
    await transactWaLink("measured", function (cur) { return measuredAfter(cur, one, now); });
  } catch (e) {
    console.error("[wa-inbound] the delivery's measures were not recorded:", e.message);
  }
}

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
// v18.12.0: `ctx.sim` — the simulator's echo event (`_lib/sim-events.js`), so a
// conversation it creates is marked in the same write (`simMarkPatch`).
export async function handleEchoes(value, results, now = Date.now(), ctx = {}) {
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
      const found = await findMessageByWamid(phoneKey, wamid);
      if (found) {
        // Found under another key, it is a message MGT sent (wa-send,
        // wa-media, the auto-reply), which Meta is not expected to echo:
        // counted apart, since whether it ever does decides whether this
        // look-up needs the scan (v18.9.0 follow-up, "What a delivery
        // measures"). Under its own key it is a
        // redelivery, or a history import that got there first.
        if (found.key !== sanitizeKey(wamid)) results.mgtEchoes++;
        else results.skipped++;
        continue;
      }
      const content = inboundContent(m);
      const ts = secondsTs(m.timestamp, now);
      const conv = await getConversation(phoneKey);
      // The conversation first, as processInbound does: a redelivery after a
      // failed message write still finds no message and writes both again.
      await upsertConversation(phoneKey, echoConvPatch(conv, { phoneKey, phone: phoneKey, ts, snippet: snippet(content.snippet), sim: ctx.sim === true }));
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
// `sim`: the simulator's history event (v18.12.0, `simMarkPatch`).
export async function importThread(thread, now = Date.now(), sim = false) {
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
  await writeImportedThread(plan.phoneKey, plan.records, historyConvPatch(conv, { phoneKey: plan.phoneKey, oldest: plan.oldest, newest: plan.newest, snippet: snippet(plan.line), now, sim: sim === true }));
  return plan.records.length;
}

// attachHistoryMedia(value, m, now) — a `history` change's own `messages[]`:
// the media of a photo or a file imported as a placeholder, under the same
// wamid. Its customer is `from`, or `to` when it is the restaurant's own (the
// business number is the change's `display_phone_number`). Found → the
// placeholder takes the media and its caption or label; not found (it came
// before its thread) → stored whole, and the thread's import, finding it
// stored, leaves it. Answers "applied", "stored", "skipped" or "ignored".
export async function attachHistoryMedia(value, m, now = Date.now(), sim = false) {
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
  // The conversation first (/code-review): stored alone, a photo that came
  // before its thread had no conversation, which the inbox does not list and
  // the nightly prune never reaches (both walk conversations), so a thread that
  // never came left it there for good. Written as the thread's import would
  // write it; the import, when it comes, moves it on (`historyConvPatch`).
  const conv = await getConversation(phoneKey);
  await upsertConversation(phoneKey, historyConvPatch(conv, { phoneKey, oldest: ts, newest: ts, snippet: snippet(content.snippet), now, sim: sim === true }));
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
//
// So does a `waLink.history` record that fails (the progress, a declined
// share), and it no longer ends the change (/code-review): thrown, it skipped
// every chunk after it, and with the threads before it counted the delivery
// was a 200, so Meta never sent those chunks again.
//
// v18.12.0: `ctx.sim` — the simulator's history event; passed to each write.
export async function handleHistory(value, results, now = Date.now(), ctx = {}) {
  const sim = ctx.sim === true;
  const items = Array.isArray(value.history) ? value.history : [];
  const follow = Array.isArray(value.messages) ? value.messages : [];
  if (!items.length && !follow.length && !historyDeclined(value)) { results.ignored++; return undefined; }
  let retry = false;
  async function record(what, fn) {
    try {
      await transactWaLink("history", fn);
      return true;
    } catch (e) {
      retry = true;
      results.errors++;
      console.error("[wa-inbound] history " + what + " not recorded:", e.message);
      return false;
    }
  }
  const declined = function (cur) { return Object.assign({}, cur || {}, { declined: true, at: now }); };
  if (historyDeclined(value) && await record("declined", declined)) results.events++;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (historyDeclined(item)) {
      if (await record("declined", declined)) results.events++;
      continue;
    }
    let failed = false;
    for (const thread of Array.isArray(item.threads) ? item.threads : []) {
      try {
        results.history += await importThread(thread, now, sim);
      } catch (e) {
        failed = true;
        results.errors++;
        console.error("[wa-inbound] history thread failed:", e.message);
      }
    }
    if (failed) retry = true;
    // Progress is recorded even after a failed thread: what it says is how far
    // Meta has got, and the resend brings the thread, not a new figure.
    if (item.metadata) await record("progress", function (cur) { return historyProgress(cur, item.metadata, now); });
  }
  for (const m of follow) {
    try {
      const r = await attachHistoryMedia(value, m, now, sim);
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
