// api/_lib/inbound-core.js
//
// WhatsApp backend — the inbound-message mechanics. This is the SERVER port of
// the sandbox's src/lib/wa-sim.js::simulateInbound (which mocked exactly this
// file's job client-side): given one normalized inbound message + its LLM
// parse, upsert the conversation and append the message — with every Phase-1b
// behaviour the design doc assigned to the backend:
//
//   · opens/RESETS the 24h service window on every inbound
//   · AUTO-ACK fires ONCE EVER per phone number (autoAckSent gate, Q1),
//     language-matched, sent through the real send layer (mock/live applies)
//   · auto-unarchives an archived conversation (Q2)
//   · clears acceptedBadgeDismissedAt → the "Booking confirmed" banner
//     re-surfaces on new activity
//   · draft intents (new_booking|cancel|modify) set/REPLACE the draft;
//     question/other leave any existing draft + linked booking untouched
//   · intentHandledAt needs no explicit reset — a draft-setting parse stamping
//     draftUpdatedAt past it is what re-shows the intent banner (the shared
//     intentBannerVisible rule). Neither lastMessageAt (staff replies move it)
//     nor a bare every-inbound stamp (a customer "thank you" moves it) may be
//     the gate — both resurrected handled banners in live QA
//
// Pure-helper imports come from the CLIENT module src/lib/whatsapp.js — same
// normalizer, same window length, same auto-ack texts. One source of truth.
//
// Idempotency: Meta retries webhook deliveries (up to 7 days on failure). The
// message id is the sanitized wamid, so a redelivery targets the same RTDB
// path; we additionally skip the whole upsert when the message already exists.

import { normalizePhone, isPhoneKey, pendingDraftOf, WA_WINDOW_MS, AUTO_ACK_TEXT, WA_MAX_TEXT_LEN, clampConfidence, sanitizeParse, sanitizeMedia, snippet, WA_MEDIA_KINDS, WA_OPEN_ON_PHONE, WA_UNSUPPORTED_CODE, WA_UNSUPPORTED_LINE, mediaLabel, mediaSnippet, isSimConversation, simMarkPatch } from "../../src/lib/whatsapp.js";
import { simMediaMessage } from "../../src/lib/wa-mock-media.js";
import { getConversation, upsertConversation, appendMessage, messageExists, sanitizeKey, readOperatingHours, readOccasionTags, readWaAutoReply } from "./rtdb.js";
import { sendText } from "./meta.js";
import { parseMessage, mockParse } from "./gemini.js";

// draftPatchFromParse(parse, ts) — the conversation fields a draft-intent
// parse sets. Shared by processInbound (when called with a parse — the
// harness's /dev paths still do) and applyParse (the async post-response
// path). `draftUpdatedAt` (= the triggering message's ts) is the intent-banner
// re-show gate (intentBannerVisible): ONLY a parse that sets/updates the draft
// stamps it, so a customer's "thank you" (intent other — drafts untouched)
// never resurrects a handled banner.
function draftPatchFromParse(parse, ts) {
  // v18.0.0 phase 6 (CT-WA-01): the model's answer is untrusted input, and this
  // is the one door every server-side parse walks through. `sanitizeParse` nulls
  // a size/date/time the app cannot use, so a schema-valid nonsense answer
  // ("next tuesday", "8 in the evening") reads as "the customer did not say"
  // instead of reaching /bookings verbatim. See src/lib/whatsapp.js.
  parse = sanitizeParse(parse);
  const draftData = {
    name: parse.name != null ? parse.name : null,
    size: parse.size != null ? parse.size : null,
    date: parse.date || null,
    time: parse.time || null,
    notes: parse.notes || "",
    preference: parse.preference || "auto",
    // v18.11.0: occasion tag ids, or null (RTDB has no empty array to store).
    occasions: parse.occasions || null,
    intent: parse.intent,
    confidence: parse.confidence || "high",
    ambiguity: parse.ambiguity || null,
  };
  // Confidence ceiling: high only when size/date/time are all present and there's
  // no ambiguity (see clampConfidence). A draft missing the party size can never
  // read "high confidence".
  draftData.confidence = clampConfidence(draftData.confidence, draftData);
  return { draftStatus: "parsed", draftUpdatedAt: ts || Date.now(), draftData };
}

// applyParse(phoneKey, parse, ts) — the ASYNC half of the inbound flow.
// wa-inbound answers Meta first (processInbound ran with parse=null, so the
// message is already stored and visible), then the LLM result lands here as a
// follow-up conversation patch: draft intents set/REPLACE the draft (the parse
// was already draft-aware-merged by the caller) and stamp draftUpdatedAt=ts
// (the message's ts — the banner re-show gate); question/other only refresh
// the detected language. No-op on a null parse (LLM failed → no draft).
export async function applyParse(phoneKey, parse, ts) {
  if (!phoneKey) return;
  // Always clear the "analyzing…" indicator — the LLM route has finished, even
  // on a null/failed parse, so the indicator can never get stuck.
  const patch = { parsing: null, parsingAt: null };
  if (parse) {
    patch.language = parse.language === "en" ? "en" : "es";
    const intent = parse.intent || null;
    if (intent === "new_booking" || intent === "cancel" || intent === "modify") {
      Object.assign(patch, draftPatchFromParse(parse, ts));
    }
  }
  await upsertConversation(phoneKey, patch);
}

// processInbound({ phone, text, ts, wamid, profileName, parse, langHint, preloadedConv })
//   ts           — ms epoch (from the Meta payload's timestamp; faithful for
//                  retries and lets local testing back-date the window)
//   parse        — gemini.parseMessage() result or null (= no draft). When the
//                  conversation had a PENDING draft, the caller already fed it
//                  to the parse, so `parse` IS the merged/updated draft.
//                  The webhook path now passes null and parses AFTER answering
//                  Meta (applyParse above); a non-null parse still works — the
//                  harness's synchronous /dev paths use it.
//   langHint     — "en"|"es"|null: cheap regex language detection (gemini.js
//                  mockParse) used for the auto-ack language when parse is null
//                  (the async flow acks before the LLM answers).
//   preloadedConv— the conversation the caller (wa-inbound) already read for
//                  the draft-aware parse; passing it avoids a duplicate read.
//   media        — v18.8.0: `{ kind, mediaId, mime, filename?, voice? }` for a
//                  photo, a voice note or a document (inboundContent below);
//                  stored on the message, re-checked here.
//   snippetText  — the conversation list's line when it is not `text` itself
//                  (a media message's "Photo · caption").
//   sim          — v18.12.0: the sandbox simulator's message. A conversation
//                  it CREATES is stamped `sim: true`, and every send to a sim
//                  conversation stays mock (`simulated`, meta.js): its phone is
//                  made up, and once the sandbox sends from a real number
//                  (the rehearsal) it would reach whoever owns it.
// Returns { phoneKey, skipped, muted } — skipped=true when the wamid was seen
// before; muted=true when the conversation is "Not a customer" (v18.9.0), so
// the caller must not parse it.
export async function processInbound({ phone, text, ts, wamid, profileName, parse, langHint, preloadedConv, willParse, media, snippetText, sim }) {
  const phoneKey = normalizePhone(phone);
  // v18.0.0 phase 6 (CT-WA-04): `!phoneKey` is not the question — "+" is truthy,
  // is a legal RTDB key and is nobody. api/wa-recheck.js had already refused it
  // by hand; this is the same rule, in the other place that builds a key.
  if (!isPhoneKey(phoneKey)) return { phoneKey: null, skipped: true };
  // Storage cap — one choke point for every caller (webhook, harness /dev).
  text = String(text || "").slice(0, WA_MAX_TEXT_LEN);
  const msgId = wamid ? sanitizeKey(wamid) : "in" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  if (wamid && (await messageExists(phoneKey, msgId))) {
    return { phoneKey, skipped: true }; // webhook redelivery — already processed
  }

  const lang = parse ? (parse.language === "en" ? "en" : "es") : (langHint === "en" ? "en" : "es");
  const intent = parse ? parse.intent || null : null;
  const isDraftIntent = intent === "new_booking" || intent === "cancel" || intent === "modify";

  const existing = preloadedConv !== undefined ? preloadedConv : await getConversation(phoneKey);
  // v18.9.0: a conversation staff marked "Not a customer" (a supplier, the
  // gestor) is MUTED: its messages are stored, and nothing else happens — no
  // auto-reply, no parse, it stays in Archived and does not count as unread.
  // Staff undo it from Archived ("Customer again").
  const muted = !!(existing && existing.muted);
  const firstEver = !muted && (!existing || !existing.autoAckSent);

  // ── Conversation upsert (per-key update(); see rtdb.js on the keyed shape) ──
  const patch = {
    phoneKey,
    phone: phone || phoneKey,
    channel: "whatsapp",
    lastMessageAt: ts,
    lastMessageSnippet: snippet(snippetText != null ? snippetText : text),
    unread: !muted,
    windowExpiresAt: ts + WA_WINDOW_MS,
    language: lang,
    acceptedBadgeDismissedAt: null, // inbound re-shows the "confirmed" banner
    autoAckSent: true,
  };
  if (!muted) { patch.archived = false; patch.archivedAt = null; } // auto-unarchive on inbound
  // v18.12.0: the simulator's mark, in this same write (simMarkPatch): set on a
  // conversation the simulator creates, cleared when a real message arrives in
  // one it marked. A real chat never becomes a simulated one.
  Object.assign(patch, simMarkPatch(existing, sim));
  if (!existing) {
    patch.createdAt = ts;
    patch.acceptedBookingId = null;
    patch.draftStatus = null;
    patch.draftData = null;
  }
  if (profileName && (!existing || !existing.profileName)) patch.profileName = profileName;
  if (isDraftIntent && !muted) Object.assign(patch, draftPatchFromParse(parse, ts));
  // Async path (parse runs after the response): flag "analyzing…" so the inbox
  // shows the LLM route in progress; applyParse clears it when the draft lands.
  // `parsingAt` bounds the flag: if nothing ever clears it (the process dies
  // mid-parse, a client tab closes mid-re-check), the client's isParsing()
  // stops believing it after WA_PARSING_STALE_MS instead of showing "Reading
  // the message…" on every device forever.
  if (parse == null && willParse && !muted) { patch.parsing = true; patch.parsingAt = Date.now(); }
  await upsertConversation(phoneKey, patch);

  // ── The inbound message itself ────────────────────────────────────────────
  const inbound = {
    id: msgId,
    direction: "in",
    text: String(text || ""),
    ts,
    status: "delivered",
    isAutoAck: false,
    channel: "whatsapp",
    providerMsgId: wamid || null,
  };
  // Omitted, not null, when absent: a text message keeps the shape it had.
  const m = sanitizeMedia(media);
  if (m) inbound.media = m;
  await appendMessage(phoneKey, inbound);

  // ── One-time auto-ack (after the inbound so the thread reads naturally) ───
  // v18.8.0: `autoAckSent: true` in the patch above is a CLAIM, written before
  // the send so two inbounds arriving together do not both ack. A send that
  // FAILS hands the claim back (`autoAckSent: false`), so the next inbound
  // tries again; before, a failed auto-reply was never retried, because the
  // flag said it had been sent. A send that succeeded keeps the claim even if
  // storing the ack's bubble then fails: the customer has the message, and a
  // second one would be the duplicate the claim exists to prevent.
  //
  // v18.12.0: the switch (Settings → WhatsApp, `readWaAutoReply`). OFF keeps
  // the claim and sends nothing, so this number never gets one, even after the
  // switch goes back on: a "thanks for your message" days into a conversation
  // is worse than none (Patryk, 2026-10-26). A read that FAILS sends nothing
  // and hands the claim back, like a failed send. Read only here, for a first
  // message, so an ordinary inbound costs no extra read.
  if (firstEver) {
    const ackText = AUTO_ACK_TEXT[lang] || AUTO_ACK_TEXT.es;
    const simulated = sim === true || isSimConversation(existing);
    let sent = null;
    try {
      const on = await readWaAutoReply();
      if (on === null) throw new Error("could not read the auto-reply setting");
      if (on) sent = await sendText(phoneKey, ackText, { simulated });
    } catch (e) {
      // Auto-ack failure must never fail the inbound — log, release, move on.
      console.warn("[wa-inbound] auto-ack send failed: " + e.message);
      try {
        await upsertConversation(phoneKey, { autoAckSent: false });
      } catch (e2) {
        console.warn("[wa-inbound] could not release the auto-ack claim: " + e2.message);
      }
    }
    if (sent) {
      try {
        await appendMessage(phoneKey, {
          id: "ack" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          direction: "out",
          text: ackText,
          ts: ts + 1500,
          status: sent.status,
          isAutoAck: true,
          channel: "whatsapp",
          providerMsgId: sent.wamid || null,
        });
      } catch (e) {
        console.warn("[wa-inbound] auto-ack sent but not stored: " + e.message);
      }
    }
  }

  // `muted`: the caller schedules no parse (the webhook's phase B, the sim's).
  return { phoneKey, skipped: false, muted };
}

// inboundContent(m) — what one webhook message becomes (v18.8.0): the text to
// store, the media to store beside it, the conversation list's line, and the
// text to hand the parser (null = no parse). It decides what staff see of a
// customer's message. Here since phase 6 (it was api/wa-inbound.js's, which
// re-exports it): the simulator's media messages take the same road
// (injectSimInbound below), so a sim photo is stored as a real one is.
//
//   text      → the body; parsed.
//   image / document → `media` + the caption as text, or the fallback
//               ("Photo", "Document: menu.pdf"); the caption is parsed like a
//               text, a photo without one is not parsed at all.
//   audio     → `media` (`voice: true` for a voice note) + "Voice message" /
//               "Audio"; never parsed (no caption exists).
//   unsupported with error 131060 (v18.9.0) → WA_UNSUPPORTED_LINE: a message
//               only the Business app can show, under coexistence.
//   anything else, or a media message whose id is not one → one line naming
//               the kind and saying it stays on the phone (decided
//               2026-10-14). It used to be "[image message]".
const OTHER_LABEL = {
  image: "Photo", audio: "Audio", document: "Document", video: "Video", sticker: "Sticker",
  location: "Location", contacts: "Contact card", reaction: "Reaction", interactive: "Reply", button: "Reply",
  // v18.9.0: an imported photo or file, until its media follows (history).
  media_placeholder: "Photo or file",
};
export function inboundContent(m) {
  const type = m && typeof m.type === "string" ? m.type : "";
  if (type === "text" && m.text && typeof m.text.body === "string") {
    const body = m.text.body;
    return { text: body, media: null, snippet: body, parseText: body.trim() ? body : null };
  }
  if (WA_MEDIA_KINDS.includes(type) && m[type] && typeof m[type] === "object") {
    const src = m[type];
    const media = sanitizeMedia({ kind: type, mediaId: src.id, mime: src.mime_type, filename: src.filename, voice: src.voice });
    if (media) {
      const caption = type !== "audio" && typeof src.caption === "string" ? src.caption.trim() : "";
      return { text: caption || mediaLabel(media), media, snippet: mediaSnippet(media, caption), parseText: caption || null };
    }
  }
  // v18.9.0: a message only the Business app can show (coexistence, 131060).
  if (type === "unsupported" && Array.isArray(m.errors) && m.errors.some((e) => e && Number(e.code) === WA_UNSUPPORTED_CODE)) {
    return { text: WA_UNSUPPORTED_LINE, media: null, snippet: WA_UNSUPPORTED_LINE, parseText: null };
  }
  const line = (OTHER_LABEL[type] || "Message") + " — " + WA_OPEN_ON_PHONE;
  return { text: line, media: null, snippet: line, parseText: null };
}

// injectSimInbound({ phone, text, name, agoMs, media }, afterResponse) — the
// SANDBOX inbound flow shared by api/wa-sim-inbound (online Sim panel) and
// api/wa-sim-generate (Gemini-invented scenarios). Mirrors api/wa-inbound for a
// single message: store fast (processInbound, parse=null + auto-ack), then parse
// with Gemini AFTER the response via `afterResponse` (the endpoint's Vercel
// waitUntil / harness shim) so the draft lands through the client's onValue.
// `afterResponse(promise)` schedules post-response work; returns the
// processInbound result ({ phoneKey, skipped }).
//
// v18.8.0 phase 6: `media` is a KIND ("image" / "audio" / "document"), never an
// id. The message is built here (`simMediaMessage`, a MOCK id minted on the
// server) and read through `inboundContent`, as a webhook's is, so `text`
// becomes its caption and only a caption is parsed. An unknown kind is refused
// by the endpoint before this runs; here it would read as a text.
export async function injectSimInbound({ phone, text, name, agoMs = 0, media }, afterResponse) {
  const ts = Date.now() - (Number(agoMs) || 0);
  const conv = await getConversation(normalizePhone(phone));
  const existingDraft = pendingDraftOf(conv);
  const content = inboundContent((media && simMediaMessage(media, text)) || { type: "text", text: { body: String(text || "") } });
  const parseText = content.parseText;
  const r = await processInbound({
    phone, text: content.text, ts,
    wamid: "sim." + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    profileName: name || null,
    parse: null,
    langHint: mockParse(parseText || "").language,
    preloadedConv: conv,
    media: content.media,
    snippetText: content.snippet,
    willParse: !!parseText, // flags "analyzing…" until applyParse lands the draft
    sim: true, // v18.12.0: a conversation this creates is the simulator's; nothing it sends leaves
  });
  // /code-review v18.0.0 phase 6: nothing was stored, so there is nothing to
  // parse. `api/wa-inbound.js` has always guarded this — `parseJobs.push` sits
  // on the non-skipped branch — and this second scheduler did not, so a junk
  // phone or a repeated wamid still bought a live, billed Gemini call whose
  // result `applyParse` then discarded on the null key. The rule applied at one
  // of the two places that schedule a parse. v18.8.0: and a voice note or a
  // photo without a caption has nothing to parse, as in the webhook.
  if (r.skipped || !r.phoneKey || !parseText || r.muted) return r;
  afterResponse((async () => {
    try {
      const [hours, occasions] = await Promise.all([readOperatingHours(), readOccasionTags()]);
      const parse = await parseMessage(parseText, { hours, existingDraft, occasions });
      await applyParse(r.phoneKey, parse, ts);
    } catch (e) {
      console.warn("[wa-sim] parse failed: " + e.message);
      try { await applyParse(r.phoneKey, null, ts); } catch { /* ignore */ } // clear the indicator
    }
  })());
  return r;
}
