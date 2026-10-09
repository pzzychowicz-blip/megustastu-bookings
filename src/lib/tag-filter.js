// src/lib/tag-filter.js
//
// v18.5.1 — filter and search by tag. v18.5.0 showed a booking's tags on six
// surfaces and filtered by none; this is the one read behind the three that
// now do: the List's chips for the viewed day, Settings → Customers' guest-tag
// chips, and Find a booking's match on a tag's name.
//
// A booking's tags are READ here exactly as they are shown (`bookingTags`,
// lib/customers.js): the guest's through `guestTagMap`, since the statement is
// usually on another of their bookings, and the booking's own occasion tags.
// Only ids still in the tag list count, as on a card: a removed tag shows
// nowhere, so it filters nothing.
//
// "Several, any of them" (Patryk, 2026-10-09): with more than one tag chosen a
// booking shows if it has ANY of them, which is the kitchen's question before
// service ("allergy, vegan or gluten-free tonight?").
import { guestTagsOf } from "./customers.js";
import { tagsOf, cleanTagIds } from "./tags.js";

// The ids booking `b` is tagged with, guest tags first, each in the list's order.
export function bookingTagIds(b, map, list) {
  return tagsOf(list, "guest", guestTagsOf(b, map))
    .concat(tagsOf(list, "occasion", cleanTagIds(b && b.tags)))
    .map(function (t) { return t.id; });
}

// The chosen ids that are still tags, in the list's order. A tag removed from
// the list while it was chosen simply stops filtering.
export function liveTagIds(list, chosen) {
  const want = Array.isArray(chosen) ? chosen : [];
  if (!want.length) return [];
  return allTags(list).filter(function (t) { return want.indexOf(t.id) >= 0; }).map(function (t) { return t.id; });
}

function allTags(list) {
  return ((list && list.guest) || []).concat((list && list.occasion) || []);
}

// `bookings` narrowed to those with any chosen tag. THE SAME ARRAY when nothing
// is chosen, so a memo downstream of an unfiltered list does not re-run.
export function filterByTags(bookings, map, list, chosen) {
  const want = liveTagIds(list, chosen);
  if (!want.length) return bookings;
  return (bookings || []).filter(function (b) {
    return bookingTagIds(b, map, list).some(function (id) { return want.indexOf(id) >= 0; });
  });
}

// The List's chip row for one day: `[{id, label, count}]` in the list's order.
// A tag gets a chip when a booking on the day has it, or while it is chosen —
// the filter is kept from day to day, so on a day nobody has the tag its chip
// must still be there to switch off. `count` is the bookings still to come or
// at their table (not completed, not cancelled): "Allergy 2" is two parties
// the kitchen will cook for. A tag only finished bookings carry has its chip
// and a count of 0.
export function dayTagChips(day, map, list, chosen) {
  const want = liveTagIds(list, chosen);
  const live = Object.create(null), any = Object.create(null);
  (day || []).forEach(function (b) {
    const open = b.status !== "completed" && b.status !== "cancelled";
    bookingTagIds(b, map, list).forEach(function (id) {
      any[id] = true;
      if (open) live[id] = (live[id] || 0) + 1;
    });
  });
  return allTags(list)
    .filter(function (t) { return any[t.id] || want.indexOf(t.id) >= 0; })
    .map(function (t) { return { id: t.id, label: t.label, count: live[t.id] || 0 }; });
}

// A tap on a chip: the id in or out of the chosen set.
export function toggleTagId(chosen, id) {
  const cur = Array.isArray(chosen) ? chosen : [];
  return cur.indexOf(id) >= 0 ? cur.filter(function (x) { return x !== id; }) : cur.concat([id]);
}

// "Allergy or Vegan", for the line the List shows when the filter hides every
// booking of the day.
export function tagNames(list, chosen) {
  const want = liveTagIds(list, chosen);
  const names = allTags(list).filter(function (t) { return want.indexOf(t.id) >= 0; }).map(function (t) { return t.label; });
  if (names.length < 2) return names.join("");
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}
