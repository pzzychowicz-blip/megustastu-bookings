// src/lib/day-notes.js
//
// v18.18.0 (Patryk): the day's notes, listed first in the opened Summary, so
// "who has an allergy tonight" is one glance at the panel rather than a walk
// through every card. Each entry carries the booking it belongs to, by name,
// time, size and tables, and a tap on it opens that booking.
//
// WHICH bookings: the date's bookings that are not cancelled and have a note or
// a tag (Patryk, 2026-11-19: "Tags and notes, all bookings"). That is the day
// sheet's set (`DaySheet.jsx`, its Notes column): a finished party stays,
// because the list is the day's record as well as what is still to come, and a
// cancelled one goes, because nobody is coming. A tag with no note is in it
// ("Allergy" is the note that matters most at the table, `seatNoteFor`'s
// reason), and a note that is only whitespace is not a note.
//
// WHAT each entry says is what the day sheet prints, in the same order:
//   - `tags`: `tagLine(bookingTags(b, guestTags, tagList))`, the guest tags
//     first, then the occasion tags ("Allergy, VIP · Birthday"), read through
//     the one function every tag surface reads (`tests/guest-tags.test.js`).
//   - `note`: the note itself, trimmed.
//   - `time`: the BOOKED time, `scheduledTime || time`. The seated shift moves
//     `time` to the minute a party sat down, and staff know a party by its
//     booking ("the 20:30 López party"), the reasoning `seatNoteFor` uses.
//
// ORDER: by that time, then by id, so two parties booked for one minute keep
// their places from one render to the next. Sorted by the time it SHOWS, so the
// list never reads out of order beside its own figures (the day sheet sorts by
// the shifted `time` while printing the booked one, which can).
//
// `booking` is the stored row, for the tap: `VA.onEdit` opens the form on it.

import { bookingTags, tagLine } from "./customers";

export function dayNotes(bookings, date, guestTags, tagList) {
  const out = [];
  (bookings || []).forEach(function (b) {
    if (!b || b.date !== date || b.status === "cancelled") return;
    const note = typeof b.notes === "string" ? b.notes.trim() : "";
    const tags = tagLine(bookingTags(b, guestTags, tagList));
    if (!note && !tags) return;
    out.push({
      id: b.id,
      time: b.scheduledTime || b.time || "",
      name: b.name || "",
      size: Number(b.size) || 0,
      tables: Array.isArray(b.tables) ? b.tables.slice() : [],
      tags: tags,
      note: note,
      booking: b,
    });
  });
  return out.sort(function (a, b) {
    return a.time.localeCompare(b.time) || String(a.id).localeCompare(String(b.id));
  });
}
