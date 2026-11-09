// tests/whatsapp-describe.test.js
//
// `describeConversation` — the accessible name of one conversation row
// (17.15.0-wa-sandbox). It is the module's counterpart to `describeBooking`,
// and it is tested for the same reason: it is the ONLY place three of the
// row's five signals exist as words at all. Unread is a coloured dot, the
// intent is an icon, archived is an icon; a change that silently drops one of
// those clauses takes the information away from the only users who had it, and
// nothing on screen moves.

import { describe, it, expect } from "vitest";
import { describeConversation, formatPhone, linkedStatus } from "../src/lib/whatsapp.js";

const CONV = {
  phoneKey: "34622334455",
  phone: "+34622334455",
  lastMessageAt: Date.now(),
  lastMessageSnippet: "Could we move our booking a bit earlier?",
};
// FIXTURE NOTE, and it is the point of this file's second test: `normalizePhone`
// does NOT strip a leading "+", so a booking stored as "+34622334455" does not
// match a conversation keyed "34622334455". The two must agree, exactly as they
// do in the live data. Written the other way this test passes vacuously — the
// name falls back to the number and every assertion about a MATCHED customer
// silently checks nothing.
const BOOKINGS = [
  { id: "b1", name: "Tom Richards", phone: "34622334455", date: "2026-07-19", time: "20:30", size: 3, status: "completed" },
];

describe("describeConversation", () => {
  it("names an unmatched conversation by its number and does not repeat it", () => {
    const s = describeConversation(CONV, { bookings: [] });
    // v18.2.0 (W4): FORMATTED, as the row and the conversation header now
    // show it — they showed the raw key, and the header added the formatted
    // one beside it.
    expect(s.startsWith("+34 622334455")).toBe(true);
    // The number is the NAME here, so it must not also appear as the phone
    // clause — the "say it twice" case the function guards.
    expect(s.split("+34 622334455").length - 1).toBe(1);
    expect(s).not.toContain("+34622334455");
  });

  it("names a matched customer, then their number", () => {
    const s = describeConversation(CONV, { bookings: BOOKINGS });
    expect(s.startsWith("Tom Richards,")).toBe(true);
    // The spoken number is the conversation's own `phone` (its display form),
    // not the normalized key it is matched by — those differ, and the row shows
    // the readable one.
    expect(s).toContain(formatPhone(CONV.phone));
  });

  it("speaks the three signals that are otherwise only a dot or an icon", () => {
    const unread = describeConversation({ ...CONV, unread: true }, { bookings: [] });
    expect(unread).toContain("unread");
    const archived = describeConversation({ ...CONV, archived: true }, { bookings: [] });
    expect(archived).toContain("archived");
    const cancel = describeConversation({ ...CONV, draftData: { intent: "cancel" } }, { bookings: [] });
    expect(cancel).toContain("requesting to cancel");
  });

  it("uses the IntentBanner's own wording, so spoken and printed cannot drift", () => {
    expect(describeConversation({ ...CONV, draftData: { intent: "modify" } }, {})).toContain("requesting changes");
    expect(describeConversation({ ...CONV, draftStatus: "accepted" }, {})).toContain("booking confirmed");
    expect(describeConversation({ ...CONV, draftStatus: "parsed", draftData: { intent: "new_booking" } }, {}))
      .toContain("draft booking");
  });

  it("states one thing about the draft, not two", () => {
    // A parsed cancel request is a cancellation, not also a "draft booking":
    // the clauses are a chain and only the first match speaks.
    const s = describeConversation({ ...CONV, draftStatus: "parsed", draftData: { intent: "cancel" } }, {});
    expect(s).toContain("requesting to cancel");
    expect(s).not.toContain("draft booking");
  });

  it("speaks the snippet in full — the visual ellipsis is a width limit", () => {
    const long = "x".repeat(300);
    expect(describeConversation({ ...CONV, lastMessageSnippet: long }, {})).toContain(long);
  });

  it("never opens with an empty segment when the matched booking has no name", () => {
    // A walk-in can be saved without a name, so `match.name` is "" — and
    // `join(", ")` on an empty first part yields ", 34600111222, hola", i.e. a
    // label that begins with a comma and names nobody.
    const nameless = [{ id: "w1", name: "", phone: "34600111222", date: "2026-08-01", time: "20:00", size: 2, status: "completed" }];
    const s = describeConversation({ phoneKey: "34600111222", phone: "34600111222", lastMessageSnippet: "hola" }, { bookings: nameless });
    expect(s.startsWith(",")).toBe(false);
    expect(s).toBe("34600111222, hola");
  });

  it("survives the empty cases rather than composing a name out of undefined", () => {
    expect(describeConversation(null, {})).toBe("");
    expect(describeConversation({ phoneKey: "34600000000" }, {})).toBe("34600000000");
    // No opts at all — the row renders before `bookings` has loaded.
    expect(describeConversation(CONV)).toContain("+34 622334455");
  });
});

// v18.16.0. Reproduced on DEV on 2026-11-09: a linked booking cancelled from its own
// card, and the row still drew a green tick titled "Booking confirmed" and said so
// aloud, because both read `draftStatus === "accepted"`, which never moves again.
describe("a linked booking is described by its status now, not by the draft that made it", () => {
  const linked = { ...CONV, draftStatus: "accepted", acceptedBookingId: "bk1" };
  const at = (status) => [{ id: "bk1", name: "Tom Richards", phone: "34622334455", date: "2026-07-19", time: "20:30", size: 3, status }];
  it("the status of the booking it names", () => {
    for (const status of ["pending", "confirmed", "seated", "completed", "cancelled"]) {
      expect(linkedStatus(linked, at(status))).toBe(status);
      expect(describeConversation(linked, { bookings: at(status) })).toContain("booking " + status);
    }
  });
  it("a cancelled booking is no longer spoken as confirmed", () => {
    expect(describeConversation(linked, { bookings: at("cancelled") })).not.toContain("booking confirmed");
  });
  it("a booking that is gone leaves nothing to mark or say", () => {
    expect(linkedStatus(linked, [])).toBe(null);
    // The fixture's snippet says "our booking", so the clause is matched whole.
    expect(describeConversation(linked, { bookings: [] })).not.toMatch(/, booking (pending|confirmed|seated|completed|cancelled),/);
  });
  it("a conversation linked by phone, with no accepted draft, is marked too", () => {
    expect(linkedStatus({ ...CONV, acceptedBookingId: "bk1" }, at("seated"))).toBe("seated");
  });
  it("an accepted draft from before conversations stored a booking id keeps its mark", () => {
    expect(linkedStatus({ ...CONV, draftStatus: "accepted" }, [])).toBe("confirmed");
  });
  it("nothing linked, nothing said", () => {
    expect(linkedStatus(CONV, at("confirmed"))).toBe(null);
    expect(linkedStatus(null, [])).toBe(null);
  });
  it("a new draft waiting speaks before the booking already made, as the row draws it", () => {
    const s = describeConversation({ ...linked, draftStatus: "parsed", draftData: { intent: "new_booking" } }, { bookings: at("confirmed") });
    expect(s).toContain("draft booking");
    expect(s).not.toContain("booking confirmed");
  });
});
