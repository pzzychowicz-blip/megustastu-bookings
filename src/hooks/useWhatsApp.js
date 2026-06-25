// src/hooks/useWhatsApp.js
//
// WhatsApp Inbox — Firebase data layer + handlers, modelled on usePersistence.
// Owns the three NEW Firebase nodes (DEV project, this sandbox):
//   conversations/{phoneKey}     — one object per conversation (KEYED — the
//                                  production schema; matches api/_lib/rtdb.js)
//   messages/{phoneKey}/{msgId}  — one object per message (KEYED)
//   templates/                   — staff-editable quick replies (array)
// plus every inbox handler ported from the pre-refactor preview, the
// draft→form handoff seam (draftSourceRef + completeDraftAccept), and the
// guarded save helpers.
//
// Write-guard contract follows usePersistence (CLAUDE.md → Critical patterns):
// a saver refuses to write until its node's initial onValue has landed. The
// empty-array wipe guard has no per-key equivalent — keyed patches/deletes
// structurally cannot blank the node (see the savers section below). The
// listeners read BOTH shapes (legacy array or keyed object) and dedup, so any
// pre-migration array data is read fine and re-lands keyed on its next write.
//
// The handlers that drive form/view overlays receive the relevant BookingApp
// setters as args (controlled-component pattern, exactly like useWalkin gets
// setViewDate/getUser). `setWriteWarning` is shared in, same as useReminders.
// The inbox-shell UI flags (showInbox / confirmArchive / confirmDeleteConv /
// returnToInboxKey) stay owned by BookingApp because they interleave with the
// global anyModal logic and the return-to-inbox effect; the hook only calls
// their setters.

import { useState, useRef, useEffect } from "react";
import { ref, onValue, set, update } from "firebase/database";
import { db } from "../firebase";
import { EMPTY_FORM } from "../lib/constants";
import { matchCustomerByPhone, normalizePhone, DEFAULT_TEMPLATES, intentBannerVisible } from "../lib/whatsapp";
import { backendEnabled, sendViaBackend } from "../lib/wa-backend";
import { clearCollapseSection } from "./useCollapseState";

export function useWhatsApp({
  bookings,
  setWriteWarning,
  // form / view handoff setters (BookingApp-owned):
  setForm, setEditId, setError, setSwapAffected, setViewDate,
  setShowForm, setConfirmCancel,
  // inbox-shell UI setters (BookingApp-owned):
  setShowInbox, setConfirmArchive, setConfirmDeleteConv, setReturnToInboxKey,
}) {
  const [conversations, setConversations] = useState([]);
  const [messagesMap, setMessagesMap] = useState({}); // { phoneKey: [msg, …] }
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);

  // Write-guard refs — flip true only after each node's first onValue returns.
  const conversationsLoaded = useRef(false);
  const messagesLoaded = useRef(false);
  const templatesLoaded = useRef(false);
  const templatesSeeded = useRef(false);
  const convFirstLoadCount = useRef(null); // #conversations on first load (empty-array guard)
  // draftSourceRef: phoneKey whose draft is being accepted. Set by
  // handleAcceptDraft, consumed by completeDraftAccept after the booking saves.
  const draftSourceRef = useRef(null);
  // Live mirrors of the two collection states. Savers compute the next value
  // from THESE (not from a setState updater) so the Firebase `set()` runs ONCE,
  // outside React's updater — under <StrictMode> updaters are double-invoked, and
  // a `set()` inside one re-enters via Firebase's synchronous local echo, which
  // appended the same message twice. Refs are kept in sync by the listeners + savers.
  const conversationsRef = useRef([]);
  const messagesMapRef = useRef({});

  // ── Listeners (read-only; never write back) ────────────────────────────────
  useEffect(() => {
    const unsub = onValue(ref(db, "conversations"), (snap) => {
      const val = snap.val();
      const raw = val ? (Array.isArray(val) ? val.filter(Boolean) : Object.values(val)) : [];
      // Dedup by phoneKey (last wins) — defensive against any write race.
      const byKey = {};
      raw.forEach((c) => { if (c && c.phoneKey) byKey[c.phoneKey] = c; });
      const arr = Object.values(byKey);
      conversationsRef.current = arr;
      setConversations(arr);
      if (convFirstLoadCount.current === null) convFirstLoadCount.current = arr.length;
      conversationsLoaded.current = true;
    });
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = onValue(ref(db, "messages"), (snap) => {
      const val = snap.val() || {};
      const map = {};
      Object.keys(val).forEach((pk) => {
        const node = val[pk];
        const list = Array.isArray(node) ? node.filter(Boolean) : Object.values(node || {});
        // Dedup by message id (last wins), then sort by timestamp.
        const byId = {};
        list.forEach((m) => { if (m && m.id) byId[m.id] = m; });
        map[pk] = Object.values(byId).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      });
      messagesMapRef.current = map;
      setMessagesMap(map);
      messagesLoaded.current = true;
    });
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = onValue(ref(db, "templates"), (snap) => {
      const val = snap.val();
      if (val) {
        setTemplates(Array.isArray(val) ? val.filter(Boolean) : Object.values(val));
      } else {
        // Empty node → seed the defaults once so staff has something to edit.
        setTemplates(DEFAULT_TEMPLATES);
        if (!templatesSeeded.current) {
          templatesSeeded.current = true;
          set(ref(db, "templates"), DEFAULT_TEMPLATES).catch(function () {});
        }
      }
      templatesLoaded.current = true;
    });
    return unsub;
  }, []);

  // ── Guarded savers — KEYED writes (Phase 1b backend alignment) ─────────────
  // Storage shape is the production schema: conversations/{phoneKey} is one
  // object per conversation; messages/{phoneKey}/{msgId} one object per message.
  // Per-key update()/child-set() writes are what lets this client and the
  // backend webhook write CONCURRENTLY without clobbering each other — the old
  // whole-node array set() could erase a record the other writer just added.
  // The listeners above already read both shapes (and dedup), so old array data
  // migrates implicitly: the next write after a read simply lands keyed.
  //
  // Write-guard contract: the loaded-ref half stays (no write before the first
  // onValue). The EMPTY-ARRAY guard is structurally obsolete here — a per-key
  // patch/delete cannot wipe the node — so it has no per-key equivalent.
  // Local state updates optimistically from the live ref (PLAIN value into
  // setState, Firebase write exactly ONCE, never inside an updater — the
  // StrictMode double-write lesson, §4.1); the listener echo then confirms.

  // patchConversation(phoneKey, patch | (conv)=>patch) — update() semantics on
  // an EXISTING conversation; null fields delete. No-op when the key is unknown.
  function patchConversation(phoneKey, next) {
    if (!conversationsLoaded.current) {
      console.warn("[SAFE] Refused to write conversations — initial read has not completed yet.");
      if (setWriteWarning) setWriteWarning("Refused to write: Firebase not yet connected. If this persists, reload the page.");
      return;
    }
    const conv = conversationsRef.current.find(function (c) { return c.phoneKey === phoneKey; });
    if (!conv) { console.warn("[wa] patchConversation: unknown phoneKey " + phoneKey); return; }
    const patch = typeof next === "function" ? next(conv) : next;
    if (!patch) return;
    const merged = Object.assign({}, conv, patch);
    const arr = conversationsRef.current.map(function (c) { return c.phoneKey === phoneKey ? merged : c; });
    conversationsRef.current = arr;
    setConversations(arr);
    update(ref(db, "conversations/" + phoneKey), patch).catch(function () {});
  }
  // upsertConversation(phoneKey, fullObject) — create-or-replace one record
  // (the simulator's client-mode inbound path creates conversations this way).
  function upsertConversation(phoneKey, obj) {
    if (!conversationsLoaded.current) {
      console.warn("[SAFE] Refused to write conversations — initial read has not completed yet.");
      if (setWriteWarning) setWriteWarning("Refused to write: Firebase not yet connected. If this persists, reload the page.");
      return;
    }
    const exists = conversationsRef.current.some(function (c) { return c.phoneKey === phoneKey; });
    const arr = exists
      ? conversationsRef.current.map(function (c) { return c.phoneKey === phoneKey ? obj : c; })
      : conversationsRef.current.concat([obj]);
    conversationsRef.current = arr;
    setConversations(arr);
    set(ref(db, "conversations/" + phoneKey), obj).catch(function () {});
  }
  function removeConversation(phoneKey) {
    if (!conversationsLoaded.current) return;
    const arr = conversationsRef.current.filter(function (c) { return c.phoneKey !== phoneKey; });
    conversationsRef.current = arr;
    setConversations(arr);
    set(ref(db, "conversations/" + phoneKey), null).catch(function () {});
  }
  // appendMessage — child-set at messages/{phoneKey}/{msg.id}: appending can
  // never overwrite a sibling the backend wrote a moment earlier.
  function appendMessage(phoneKey, msg) {
    if (!messagesLoaded.current) {
      console.warn("[SAFE] Refused to write messages — initial read has not completed yet.");
      return;
    }
    const prevArr = messagesMapRef.current[phoneKey] || [];
    const arr = prevArr.concat([msg]).sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    const nextMap = Object.assign({}, messagesMapRef.current); nextMap[phoneKey] = arr;
    messagesMapRef.current = nextMap;
    setMessagesMap(nextMap);
    set(ref(db, "messages/" + phoneKey + "/" + msg.id), msg).catch(function () {});
  }
  // patchMessage — update one message in place (status flips etc.).
  function patchMessage(phoneKey, msgId, patch) {
    if (!messagesLoaded.current) return;
    const prevArr = messagesMapRef.current[phoneKey] || [];
    const arr = prevArr.map(function (m) { return m.id === msgId ? Object.assign({}, m, patch) : m; });
    const nextMap = Object.assign({}, messagesMapRef.current); nextMap[phoneKey] = arr;
    messagesMapRef.current = nextMap;
    setMessagesMap(nextMap);
    update(ref(db, "messages/" + phoneKey + "/" + msgId), patch).catch(function () {});
  }
  function removeMessages(phoneKey) {
    if (!messagesLoaded.current) return;
    const nextMap = Object.assign({}, messagesMapRef.current);
    delete nextMap[phoneKey];
    messagesMapRef.current = nextMap;
    setMessagesMap(nextMap);
    set(ref(db, "messages/" + phoneKey), null).catch(function () {});
  }
  function saveTemplates(next) {
    if (!templatesLoaded.current) {
      console.warn("[SAFE] Refused to write templates — initial read has not completed yet.");
      return;
    }
    setTemplates(next);
    set(ref(db, "templates"), next).catch(function () {});
  }

  // ── Inbox handlers ──────────────────────────────────────────────────────────
  // handleSendReply — two paths:
  //   BACKEND mode (DEV toggle in the Sim panel): POST /api/wa-send on the local
  //   harness with the staff's Firebase ID token. The SERVER appends the message
  //   + updates the conversation; this client just waits for the listener echo.
  //   Failures surface through setWriteWarning.
  //   CLIENT mode (default): the original sandbox mock — append locally with
  //   status "sending", update the conversation, flip to "delivered" after
  //   800ms to fake the provider round-trip.
  function handleSendReply(phoneKey, text) {
    if (backendEnabled()) {
      sendViaBackend(phoneKey, text).catch(function (e) {
        console.warn("[wa] backend send failed:", e.message);
        if (setWriteWarning) setWriteWarning("WhatsApp send failed: " + e.message);
      });
      return;
    }
    const msgId = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const ts = Date.now();
    const msg = { id: msgId, direction: "out", text, ts, status: "sending", isAutoAck: false, channel: "whatsapp" };
    appendMessage(phoneKey, msg);
    patchConversation(phoneKey, function (c) {
      const patch = { lastMessageAt: ts, lastMessageSnippet: text };
      if (c.archived) { patch.archived = false; patch.archivedAt = null; } // auto-unarchive on send
      return patch;
    });
    setTimeout(() => {
      patchMessage(phoneKey, msgId, { status: "delivered" });
    }, 800);
  }

  // handleAcceptDraft: close inbox, pre-fill the booking form from the draft,
  // flag draftSourceRef so doSave flips the conversation on success, and set
  // returnToInboxKey so closing the form returns to the WA module.
  function handleAcceptDraft(conv) {
    if (!conv || !conv.draftData) return;
    const d = conv.draftData;
    const match = matchCustomerByPhone(conv.phoneKey, bookings);
    const prefilledName = (d.name && d.name.trim()) || (match && match.name) || "";
    let prefilledPhone = conv.phone || conv.phoneKey || "+";
    if (prefilledPhone && prefilledPhone.charAt(0) !== "+") prefilledPhone = "+" + prefilledPhone;
    const size = Number(d.size) || 2;
    const today = new Date().toISOString().slice(0, 10);
    const date = d.date || today;
    const time = d.time || "13:00";
    setForm(Object.assign({}, EMPTY_FORM, { name: prefilledName, phone: prefilledPhone, date, time, size, preference: "auto", notes: d.notes || "", status: "confirmed", customDur: null, manualTables: [], preferredTables: [], returnOf: null }));
    setEditId(null); setError(""); setSwapAffected(null);
    draftSourceRef.current = conv.phoneKey;
    setReturnToInboxKey(conv.phoneKey);
    setShowInbox(false); setShowForm(true); setViewDate(date);
  }
  // completeDraftAccept: called from doSave's new-booking success branch when
  // draftSourceRef is set. Flips the source conversation to accepted + links it.
  function completeDraftAccept(bookingId) {
    const phoneKey = draftSourceRef.current;
    if (!phoneKey) return;
    patchConversation(phoneKey, { draftStatus: "accepted", acceptedBookingId: bookingId });
    draftSourceRef.current = null;
  }

  // linkBookingByPhone: a booking created MANUALLY (the + New form, not via
  // Accept & open) whose phone matches an existing WhatsApp conversation links
  // itself there — the conversation window then shows the LinkedBookingCard.
  // Called from doSave's new-booking success branch, AFTER completeDraftAccept
  // (whose patch lands in conversationsRef synchronously, so the early-return
  // below also covers "this save WAS the draft accept").
  // Rules: never overwrite an existing link; a PENDING draft also flips to
  // "accepted" — the manual booking fulfils the request, and leaving the draft
  // pending would invite a duplicate Accept & open for the same customer.
  function linkBookingByPhone(bookingId, phone) {
    const key = normalizePhone(phone);
    if (!key || key === "+") return;
    const conv = conversationsRef.current.find(function (c) { return c.phoneKey === key; });
    if (!conv || conv.acceptedBookingId) return;
    const patch = { acceptedBookingId: bookingId };
    if (conv.draftStatus === "parsed") patch.draftStatus = "accepted";
    patchConversation(key, patch);
  }

  function handleDismissDraft(phoneKey) {
    patchConversation(phoneKey, { draftStatus: "dismissed" });
  }
  function handleMarkRead(phoneKey) {
    patchConversation(phoneKey, { unread: false });
  }
  // The big "Booking confirmed" banner ✕. Stamps a dismissal time; the banner
  // reappears on a new inbound message (inbound clears the stamp — both the
  // simulator and the backend webhook do).
  function handleDismissAcceptedBadge(phoneKey) {
    patchConversation(phoneKey, { acceptedBadgeDismissedAt: Date.now() });
  }
  // "✓ Mark as handled" on an intent banner. Stamps intentHandledAt = now and
  // clears the per-conversation collapse so a fresh request shows expanded.
  function handleMarkIntentHandled(phoneKey) {
    patchConversation(phoneKey, { intentHandledAt: Date.now() });
    clearCollapseSection(phoneKey, "intent");
  }
  // §7 decision (2026-06-13): cancelling the LINKED booking auto-handles a
  // pending cancel-intent banner — the action IS the handling, no second click.
  // Called from doCancelBooking (App.jsx) after the save, so it covers BOTH the
  // WA-initiated flow (LinkedBookingCard → confirmCancel) and a cancel of the
  // same booking from the main list — either way the customer's request is
  // fulfilled. Gating mirrors the banner's own show condition, so a banner
  // that isn't showing never gets a phantom stamp.
  function autoHandleCancelIntent(bookingId) {
    const conv = conversationsRef.current.find(function (c) { return c.acceptedBookingId === bookingId; });
    if (!conv || !conv.draftData || conv.draftData.intent !== "cancel") return;
    if (intentBannerVisible(conv)) handleMarkIntentHandled(conv.phoneKey); // same gate the banner renders with
  }

  // ── Archive / unarchive / delete ────────────────────────────────────────────
  function handleArchive(phoneKey) {
    const conv = conversations.find((c) => c.phoneKey === phoneKey);
    if (!conv) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    if (conv.acceptedBookingId) {
      const booking = bookings.find((b) => b.id === conv.acceptedBookingId);
      const isUpcoming = booking && booking.date && booking.date >= todayStr && booking.status !== "cancelled" && booking.status !== "completed";
      if (isUpcoming) { setConfirmArchive(phoneKey); return; } // warn before archiving an upcoming linked booking
    }
    doArchive(phoneKey);
  }
  function doArchive(phoneKey) {
    patchConversation(phoneKey, { archived: true, archivedAt: Date.now() });
  }
  function handleUnarchive(phoneKey) {
    patchConversation(phoneKey, { archived: false, archivedAt: null });
  }
  function handleDeleteConversation(phoneKey) { setConfirmDeleteConv(phoneKey); }
  function doDeleteConversation(phoneKey) {
    removeConversation(phoneKey);
    removeMessages(phoneKey);
    setConfirmDeleteConv(null);
  }

  // handleCancelLinkedBooking: route through the existing confirmCancel overlay
  // so cancelling here looks identical to cancelling from the booking form.
  function handleCancelLinkedBooking(conv) {
    if (!conv || !conv.acceptedBookingId) return;
    setReturnToInboxKey(conv.phoneKey);
    setShowInbox(false);
    setConfirmCancel(conv.acceptedBookingId);
  }
  // handleOpenLinkedBooking: open the linked booking in the form for editing.
  function handleOpenLinkedBooking(conv) {
    if (!conv || !conv.acceptedBookingId) return;
    const booking = bookings.find((b) => b.id === conv.acceptedBookingId);
    if (!booking) return;
    setForm(Object.assign({}, EMPTY_FORM, {
      name: booking.name || "", phone: booking.phone || "+", date: booking.date || "", time: booking.time || "13:00",
      size: booking.size || 2, preference: booking.preference || "auto", notes: booking.notes || "", status: booking.status || "confirmed",
      customDur: booking.customDur || null, manualTables: [], preferredTables: Array.isArray(booking.preferredTables) ? booking.preferredTables.slice() : [], returnOf: null,
    }));
    setEditId(booking.id); setError(""); setSwapAffected(null);
    setReturnToInboxKey(conv.phoneKey);
    setShowInbox(false); setShowForm(true); setViewDate(booking.date || new Date().toISOString().slice(0, 10));
  }

  // Dev-only hard reset for the simulator: wipe BOTH WA nodes directly (bypasses
  // the empty-array guard on purpose — this is an explicit "clear the sandbox"
  // action, not an accidental effect write). Never wired outside the DEV-gated
  // simulator surface.
  function clearAllWaData() {
    set(ref(db, "conversations"), null).catch(function () {});
    set(ref(db, "messages"), null).catch(function () {});
  }

  const unreadCount = conversations.filter((c) => c.unread && !c.archived).length;

  return {
    // data
    conversations, messagesMap, templates,
    // savers (used by the simulator core — keyed shape, Phase 1b)
    patchConversation, upsertConversation, appendMessage, patchMessage,
    removeConversation, removeMessages, saveTemplates, clearAllWaData,
    // derived
    unreadCount,
    // draft seam (doSave calls completeDraftAccept, then linkBookingByPhone)
    draftSourceRef, completeDraftAccept, linkBookingByPhone,
    // handlers
    handleSendReply, handleAcceptDraft, handleDismissDraft, handleMarkRead,
    handleDismissAcceptedBadge, handleMarkIntentHandled, autoHandleCancelIntent,
    handleArchive, doArchive, handleUnarchive,
    handleDeleteConversation, doDeleteConversation,
    handleCancelLinkedBooking, handleOpenLinkedBooking,
  };
}
