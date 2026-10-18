// src/lib/wa-reply-drafts.js — v18.10.0
//
// ── WhatsApp reply drafts, kept as you type ──────────────────────────────────
// What is typed in a conversation's reply box and not yet sent, the way a
// messenger keeps it: it survives closing the inbox, Back on a phone and a
// reload, and the conversation's row says "Draft:" until it is sent or emptied
// (Patryk, 2026-10-18).
//
// THIS DEVICE ONLY, on purpose: a draft is half a sentence, and syncing it would
// put one person's unfinished words on every screen in the restaurant. So it
// lives in localStorage, never in the database, under one key holding
//   { <uid>: { <phoneKey>: { text, at } } }
// — per signed-in account as well as per conversation, so two people sharing a
// tablet do not finish each other's messages. A picked photo or PDF is not kept
// (a file cannot go into localStorage); its caption is, because it is the text.
//
// A module store read through `useSyncExternalStore` (`useReplyDraft`), because
// two components that never share a render need it: the reply box writes it and
// each conversation row reads its own. Per conversation, as a string, so a
// keystroke re-renders the box and that one row, never the whole inbox
// (/code-review: a whole-store subscription in InboxPanel re-rendered the list
// and the open thread's every bubble on every key). A second tab on this device follows through
// the `storage` event. Every storage access is in a try: a private window, a
// full quota or blocked site data leave the drafts in memory for this session.
//
// Removed for EVERY account on this device when the conversation is deleted or
// Delete customer erases it (`forgetReplyDrafts`, called by useWhatsApp): a
// guest's erased conversation must not survive as somebody's draft to them.

export const DRAFTS_KEY = "mgt-wa-drafts";
// Longer than WhatsApp's 4,096-character message, so nothing typed is cut; the
// cap only stops a pasted novel from filling this device's storage.
export const DRAFT_MAX = 8000;

const EMPTY = Object.freeze({});

// ── Pure core (tested) ───────────────────────────────────────────────────────

// Whatever is stored is untrusted: another version, a hand edit, a broken write.
// Keeps only {uid: {key: {text: non-empty string, at: number}}}.
export function sanitizeDrafts(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.keys(raw).forEach((uid) => {
    const per = raw[uid];
    if (!per || typeof per !== "object" || Array.isArray(per)) return;
    const kept = {};
    Object.keys(per).forEach((k) => {
      const d = per[k];
      if (!d || typeof d.text !== "string" || !d.text) return;
      kept[k] = { text: d.text.slice(0, DRAFT_MAX), at: Number.isFinite(d.at) ? d.at : 0 };
    });
    if (Object.keys(kept).length) out[uid] = kept;
  });
  return out;
}

// The store with one draft set or (empty text) removed. Returns `all` itself
// when nothing changes, so a re-render with the same text writes nothing.
export function withDraft(all, uid, key, text, at) {
  const per = all[uid] || EMPTY;
  const t = typeof text === "string" ? text.slice(0, DRAFT_MAX) : "";
  const cur = per[key];
  if (t ? cur && cur.text === t : !cur) return all;
  const nextPer = Object.assign({}, per);
  if (t) nextPer[key] = { text: t, at: at }; else delete nextPer[key];
  const out = Object.assign({}, all);
  if (Object.keys(nextPer).length) out[uid] = nextPer; else delete out[uid];
  return out;
}

// The store without these conversations, for every account. `all` itself when
// none of them had a draft.
export function withoutKeys(all, keys) {
  const gone = new Set(keys || []);
  let changed = false;
  const out = {};
  Object.keys(all).forEach((uid) => {
    const per = all[uid];
    const kept = {};
    Object.keys(per).forEach((k) => { if (gone.has(k)) changed = true; else kept[k] = per[k]; });
    if (Object.keys(kept).length) out[uid] = kept;
  });
  return changed ? out : all;
}

// ── The store ────────────────────────────────────────────────────────────────

let cache = null;
const listeners = new Set();

function load() {
  if (cache) return cache;
  try {
    const s = localStorage.getItem(DRAFTS_KEY);
    cache = s ? sanitizeDrafts(JSON.parse(s)) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function commit(next) {
  if (next === cache) return;
  cache = next;
  try {
    if (Object.keys(next).length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(next));
    else localStorage.removeItem(DRAFTS_KEY);
  } catch { /* kept in memory for this session */ }
  listeners.forEach((fn) => fn());
}

function onStorage(e) {
  if (e.key !== null && e.key !== DRAFTS_KEY) return;
  cache = null;
  listeners.forEach((fn) => fn());
}

export function subscribeDrafts(fn) {
  listeners.add(fn);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

// One account's drafts, {phoneKey: {text, at}}. The same object until they
// change, which `useSyncExternalStore` requires of a snapshot.
export function draftsOf(uid) {
  return load()[uid || ""] || EMPTY;
}

// One conversation's draft text, or "". A string, so a subscriber whose draft
// did not change gets the same snapshot and does not re-render: every
// keystroke commits the store, and only the row typed into should follow it.
export function draftTextOf(uid, key) {
  const d = draftsOf(uid)[key];
  return d ? d.text : "";
}

export function setReplyDraft(uid, key, text) {
  if (!key) return;
  commit(withDraft(load(), uid || "", key, text, Date.now()));
}

export function forgetReplyDrafts(keys) {
  commit(withoutKeys(load(), keys));
}
