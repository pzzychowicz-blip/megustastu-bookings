// src/lib/tags.js
//
// v18.5.0 — the tag list (`settings/tags`), and everything that decides
// something about it. Pure: the hook (`hooks/useTagSettings.js`) keeps the
// subscription, the refs and the write.
//
// ── TWO KINDS, AND THEY LIVE IN DIFFERENT PLACES ────────────────────────────
// A GUEST tag says something about the person (an allergy, vegetarian, VIP).
// It follows the guest from booking to booking and is erased with them.
// An OCCASION tag says something about one visit (a birthday). It stays on
// that booking and is not carried to the next.
//
// Patryk's scope, 2026-10-08: a FIXED list, edited in Settings, not free text
// typed per booking. A fixed list is what makes a tag something the kitchen
// can rely on reading the same way twice.
//
// ── THE MODEL ───────────────────────────────────────────────────────────────
//   { v: 1, guest: [{ id, label }…], occasion: [{ id, label }…] }
//
// A booking stores tag IDS, never labels, so renaming a tag renames it on
// every booking that carries it and writes to none of them. An id is minted
// once, when the tag is added, and never reused: removing "Vegan" and adding
// "Vegan" again makes a NEW tag, and the bookings that carried the old one do
// not come back tagged. That is deliberate. A removed tag's meaning cannot be
// handed to whatever is next given its name.
//
// The seed ids are fixed strings, so two devices that have never seen a stored
// list agree about them, and a booking can carry a seed tag before anybody has
// saved the list.
//
// ── ABSENT IS THE SEED, A MISSING LIST IS EMPTY ─────────────────────────────
// RTDB drops an empty array. So a stored node whose `guest` is missing is a
// restaurant that removed every guest tag, not one that never chose: a PRESENT
// node reads each missing list as EMPTY, and only an ABSENT node reads as the
// seed. `v: 1` is what keeps the node present when both lists are empty (the
// v15.9.0 priorities lesson).

export const TAG_KINDS = ["guest", "occasion"];

// What each kind is called on screen, in one place.
export const TAG_KIND_LABEL = { guest: "Guest tags", occasion: "Occasion tags" };

// A tag is a word or two on a chip, on a List card and in a printed column.
export const TAG_LABEL_MAX = 24;
// Per kind. The booking form shows every tag of both kinds as a chip.
export const TAG_LIST_MAX = 12;

// Patryk's seed, 2026-10-08.
export const DEFAULT_TAG_LIST = {
  v: 1,
  guest: [
    { id: "g-allergy", label: "Allergy" },
    { id: "g-vegetarian", label: "Vegetarian" },
    { id: "g-vegan", label: "Vegan" },
    { id: "g-gluten-free", label: "Gluten-free" },
    { id: "g-vip", label: "VIP" },
  ],
  occasion: [
    { id: "o-birthday", label: "Birthday" },
    { id: "o-anniversary", label: "Anniversary" },
  ],
};

// An id is a path-safe token. It is also a key in nothing today, but a booking
// stores it, and a value that could not be a key is one refactor from a bug.
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

// One line of text: runs of whitespace are one space, the ends are trimmed.
export function cleanTagLabel(label) {
  return String(label === null || label === undefined ? "" : label).replace(/\s+/g, " ").trim().slice(0, TAG_LABEL_MAX).trim();
}

// Two labels are the same tag name whatever their capitals.
function labelKey(label) { return cleanTagLabel(label).toLowerCase(); }

// RTDB hands an array back as an object when it has holes in it.
function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.keys(raw).sort(function (a, b) { return Number(a) - Number(b); }).map(function (k) { return raw[k]; });
  }
  return [];
}

function freshSeed() {
  return {
    v: 1,
    guest: DEFAULT_TAG_LIST.guest.map(function (t) { return { id: t.id, label: t.label }; }),
    occasion: DEFAULT_TAG_LIST.occasion.map(function (t) { return { id: t.id, label: t.label }; }),
  };
}

// What a read makes of the stored node. An id is unique across BOTH lists (a
// booking's id must name one tag), a label is unique within its own list, and
// a row that is not a tag is dropped. First wins, in stored order.
export function sanitizeTagList(src) {
  if (!src || typeof src !== "object") return freshSeed();
  const seenIds = {};
  function list(raw) {
    const out = [], seenLabels = {};
    asArray(raw).forEach(function (t) {
      if (!t || typeof t !== "object") return;
      const id = typeof t.id === "string" ? t.id : "";
      const label = cleanTagLabel(t.label);
      if (!ID_RE.test(id) || !label) return;
      const lk = label.toLowerCase();
      if (seenIds[id] || seenLabels[lk]) return;
      if (out.length >= TAG_LIST_MAX) return;
      seenIds[id] = true; seenLabels[lk] = true;
      out.push({ id: id, label: label });
    });
    return out;
  }
  return { v: 1, guest: list(src.guest), occasion: list(src.occasion) };
}

// Content equality, for "is there anything to write". Order counts: the list's
// order is the order the chips are drawn in.
export function sameTagList(a, b) {
  return TAG_KINDS.every(function (k) {
    const x = (a && a[k]) || [], y = (b && b[k]) || [];
    return x.length === y.length && x.every(function (t, i) { return t.id === y[i].id && t.label === y[i].label; });
  });
}

function kindOf(list, id) {
  for (let i = 0; i < TAG_KINDS.length; i++) {
    const k = TAG_KINDS[i];
    if (((list && list[k]) || []).some(function (t) { return t.id === id; })) return k;
  }
  return null;
}

// Why this name cannot be a tag of this kind, as the sentence the editor shows,
// or null. `exceptId` is the tag being renamed, which may keep its own name.
// The add and the rename both ask it, so the two cannot disagree.
export function tagLabelRefusal(list, kind, label, exceptId) {
  const clean = cleanTagLabel(label);
  if (!clean) return "Type a name for the tag.";
  const taken = ((list && list[kind]) || []).some(function (t) {
    return t.id !== exceptId && labelKey(t.label) === clean.toLowerCase();
  });
  if (taken) return "There is already a tag called “" + clean + "”.";
  return null;
}

// Each of the three edits answers `{ list }` or `{ refuse }`. `list` is a new
// object; the input is never changed.
export function addTag(list, kind, label, id) {
  if (TAG_KINDS.indexOf(kind) < 0) return { refuse: "Unknown kind of tag." };
  const cur = (list && list[kind]) || [];
  if (cur.length >= TAG_LIST_MAX) return { refuse: "Up to " + TAG_LIST_MAX + " tags of each kind." };
  const refuse = tagLabelRefusal(list, kind, label, null);
  if (refuse) return { refuse: refuse };
  // The hook mints the id; a clash with a stored one would make two tags one.
  if (!ID_RE.test(String(id || "")) || kindOf(list, id)) return { refuse: "Couldn’t add the tag. Try again." };
  const next = { v: 1, guest: ((list && list.guest) || []).slice(), occasion: ((list && list.occasion) || []).slice() };
  next[kind] = cur.concat([{ id: id, label: cleanTagLabel(label) }]);
  return { list: next };
}

export function renameTag(list, id, label) {
  const kind = kindOf(list, id);
  if (!kind) return { refuse: "That tag is no longer in the list." };
  const refuse = tagLabelRefusal(list, kind, label, id);
  if (refuse) return { refuse: refuse };
  const clean = cleanTagLabel(label);
  const next = { v: 1, guest: list.guest.slice(), occasion: list.occasion.slice() };
  next[kind] = list[kind].map(function (t) { return t.id === id ? { id: t.id, label: clean } : t; });
  return { list: next };
}

// Removing a tag takes it out of the list. The bookings that carry its id are
// not written: they stop SHOWING it, because every surface draws a tag through
// `tagLabels`, which knows only the list.
export function removeTag(list, id) {
  const kind = kindOf(list, id);
  if (!kind) return { list: list };
  const next = { v: 1, guest: list.guest.slice(), occasion: list.occasion.slice() };
  next[kind] = list[kind].filter(function (t) { return t.id !== id; });
  return { list: next };
}

// A new tag's id: the kind's initial, a dash, then the app's id shape. The
// caller passes the random part (`genId()`), so this file imports nothing.
export function tagIdFor(kind, unique) {
  return (kind === "occasion" ? "o" : "g") + "-" + String(unique || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 36);
}

// The tags of one kind that `ids` names, as `[{ id, label }]` in the LIST's
// order (never the stored order, so two bookings carrying the same tags read
// alike). An id the list does not have is left out: that is a removed tag.
export function tagsOf(list, kind, ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  return ((list && list[kind]) || []).filter(function (t) { return ids.indexOf(t.id) >= 0; });
}

// The same, as labels.
export function tagLabels(list, kind, ids) {
  return tagsOf(list, kind, ids).map(function (t) { return t.label; });
}
