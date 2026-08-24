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
import { describeConversation, formatPhone } from "../src/lib/whatsapp.js";

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
    expect(s.startsWith("+34622334455")).toBe(true);
    // The number is the NAME here, so it must not also appear as the phone
    // clause — the "say it twice" case the function guards.
    expect(s.split("+34622334455").length - 1).toBe(1);
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

  it("survives the empty cases rather than composing a name out of undefined", () => {
    expect(describeConversation(null, {})).toBe("");
    expect(describeConversation({ phoneKey: "34600000000" }, {})).toBe("34600000000");
    // No opts at all — the row renders before `bookings` has loaded.
    expect(describeConversation(CONV)).toContain("+34622334455");
  });
});
