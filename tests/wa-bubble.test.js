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
import { MessageBubble } from "../src/components/whatsapp/MessageBubble.jsx";

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
