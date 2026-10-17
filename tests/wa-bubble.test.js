// tests/wa-bubble.test.js
//
// v18.9.0 (coexistence) — what a chat bubble says about where a message came
// from and what happened to it since: a reply typed on the restaurant phone
// says "phone" where a reply from MGT says how far it got, and offers no Retry;
// an edited message says "edited"; a deleted one shows the line that replaced
// its text, in italic. `MessageBubble` holds no hooks of its own (its media
// blocks do, and a text message draws none), so it is CALLED here and its
// element tree read, without a DOM.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MessageBubble } from "../src/components/whatsapp/MessageBubble.jsx";
import { threadDayLabel, threadItems } from "../src/lib/whatsapp.js";
import { formatDay } from "../src/lib/day.js";
import { BellIcon } from "../src/components/Icons.jsx";
import { MuteIcon } from "../src/components/whatsapp/WaIcons.jsx";
import { stripComments } from "../scripts/strip-comments.mjs";

// Every string the tree renders, in order, and every element's props.
function walk(node, out = { text: [], props: [] }) {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") { out.text.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  if (node.props) {
    out.props.push(node.props);
    walk(node.props.children, out);
  }
  return out;
}
const render = (msg, extra) => walk(MessageBubble(Object.assign({ msg, phoneKey: "+34600111222", onRetry: () => {} }, extra)));
const base = { id: "m1", text: "Hola", ts: Date.UTC(2026, 9, 15, 12, 0) };

describe("MessageBubble — coexistence (v18.9.0)", () => {
  it("a reply from the phone says phone, not its status, and offers no Retry even when marked failed", () => {
    const r = render(Object.assign({}, base, { direction: "out", source: "phone", status: "failed" }));
    expect(r.text).toContain("· phone");
    expect(r.text).not.toContain("· failed");
    expect(r.text).not.toContain("Retry");
  });
  it("a reply from MGT keeps its status and its Retry", () => {
    const r = render(Object.assign({}, base, { direction: "out", status: "failed" }));
    expect(r.text).toContain("· failed");
    expect(r.text).toContain("Retry");
    expect(r.text).not.toContain("· phone");
  });
  it("an edited message says edited, on either side", () => {
    expect(render(Object.assign({}, base, { direction: "in", editedAt: 5 })).text).toContain("· edited");
    expect(render(Object.assign({}, base, { direction: "out", source: "phone", editedAt: 5 })).text).toContain("· edited");
    expect(render(Object.assign({}, base, { direction: "in" })).text).not.toContain("· edited");
  });
  it("a deleted message shows its line in italic, says nothing of an edit, and draws no media", () => {
    const r = render(Object.assign({}, base, {
      direction: "in", text: "Message deleted by the customer", revokedAt: 9, editedAt: 5,
      media: { kind: "image", mediaId: "1" },
    }));
    expect(r.text).toContain("Message deleted by the customer");
    expect(r.text).not.toContain("· edited");
    expect(r.props.some((p) => p.style && p.style.fontStyle === "italic")).toBe(true);
    expect(r.props.some((p) => p.msg && p.msg.media)).toBe(false);
  });
});

// v18.9.0 (Patryk, 2026-10-16): the thread says which day its messages are
// from, as WhatsApp on the phone does, because an imported history puts months
// of messages in one thread and a bubble says only its time.
describe("the thread's day separators (v18.9.0)", () => {
  // Local noon on a day, so the test reads the same in every time zone.
  const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
  const TODAY = "2026-10-16";

  it("labels today, yesterday, and any other day in the house date", () => {
    expect(threadDayLabel("2026-10-16", TODAY)).toBe("Today");
    expect(threadDayLabel("2026-10-15", TODAY)).toBe("Yesterday");
    expect(threadDayLabel("2026-10-14", TODAY)).toBe(formatDay("2026-10-14", { today: TODAY }));
    // Another year carries its year, as the house date always does.
    expect(threadDayLabel("2025-12-31", TODAY)).toBe(formatDay("2025-12-31", { today: TODAY }));
    expect(threadDayLabel("2025-12-31", TODAY)).toContain("2025");
    // Yesterday across a month and a year boundary.
    expect(threadDayLabel("2026-09-30", "2026-10-01")).toBe("Yesterday");
    expect(threadDayLabel("2025-12-31", "2026-01-01")).toBe("Yesterday");
  });

  it("labels nothing it cannot read", () => {
    expect(threadDayLabel("", TODAY)).toBe("");
    expect(threadDayLabel(undefined, TODAY)).toBe("");
    expect(threadDayLabel("nonsense", TODAY)).toBe("");
  });

  it("puts one separator before the first message of each day, and none between a day's messages", () => {
    const msgs = [
      { id: "a", ts: at(2026, 9, 6, 9) },
      { id: "b", ts: at(2026, 9, 6, 21) },
      { id: "c", ts: at(2026, 10, 15, 0, 47) },
      { id: "d", ts: at(2026, 10, 16, 8) },
      { id: "e", ts: at(2026, 10, 16, 23, 59) },
    ];
    const items = threadItems(msgs, TODAY);
    expect(items.map((it) => (it.msg ? it.msg.id : "[" + it.label + "]"))).toEqual([
      "[" + formatDay("2026-09-06", { today: TODAY }) + "]", "a", "b",
      "[Yesterday]", "c",
      "[Today]", "d", "e",
    ]);
    // A separator names the message it introduces (it enters with that bubble).
    expect(items.filter((it) => !it.msg).map((it) => it.firstId)).toEqual(["a", "c", "d"]);
  });

  it("keeps a message with no usable time in the day before it, and draws no separator for it", () => {
    const items = threadItems([{ id: "x", ts: 0 }, { id: "a", ts: at(2026, 10, 16, 9) }, { id: "y" }, { id: "b", ts: at(2026, 10, 16, 10) }], TODAY);
    expect(items.map((it) => (it.msg ? it.msg.id : "[" + it.label + "]"))).toEqual(["x", "[Today]", "a", "y", "b"]);
  });

  it("an empty or absent thread draws nothing", () => {
    expect(threadItems([], TODAY)).toEqual([]);
    expect(threadItems(undefined, TODAY)).toEqual([]);
  });

  // The pure tests pass whether or not the thread CALLS the helper: the
  // conversation view must draw its messages through threadItems, never map
  // them straight to bubbles, or the separators are gone with every test green.
  it("the conversation view draws its thread through threadItems", () => {
    const src = stripComments(readFileSync(new URL("../src/components/whatsapp/ConversationView.jsx", import.meta.url), "utf8")).join("\n");
    expect(src).toContain("threadItems(msgsForConv, today)");
    expect(/msgsForConv\.map\(/.test(src)).toBe(false);
  });
});

// MuteIcon draws the app's bell struck through, and copies the bell's paths
// (Icons.jsx may export components only), so a redrawn bell must move both.
describe("the mute icon is the app's bell, struck through (v18.9.0)", () => {
  it("MuteIcon's bell is BellIcon's, plus one slash", () => {
    const paths = (el) => walk(el).props.filter((p) => typeof p.d === "string").map((p) => p.d);
    const bell = paths(BellIcon({}));
    expect(bell.length).toBe(2);
    expect(paths(MuteIcon({}))).toEqual(bell);
    expect(walk(MuteIcon({})).props.filter((p) => p.x1 !== undefined)).toEqual([{ x1: "3", y1: "3", x2: "21", y2: "21" }]);
  });
});
