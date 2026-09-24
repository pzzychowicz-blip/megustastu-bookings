// tests/wa-inbox-layout.test.js — v18.2.0, the design critique's WhatsApp
// inbox findings (W1–W5), one phase each.
//
// W1, measured on DEV at 375×812: the compact draft bar read "2 pax · 202…",
// the date and time cut off by HIGH / Accept / Dismiss. After: line one is
// "2 pax · 2026-09-25 · 14:00" whole, line two is HIGH, Accept and Dismiss
// together, right-aligned; at 1280×800 (compact too, the tablet is 800 tall)
// it is still one line.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Draft = read("components/whatsapp/DraftCard.jsx");
const Inbox = read("components/whatsapp/InboxPanel.jsx");
const Composer = read("components/whatsapp/ReplyComposer.jsx");
const Shortcuts = read("components/Shortcuts.jsx");
const View = read("components/whatsapp/ConversationView.jsx");

describe("W1 — the draft bar never hides what it asks you to accept", () => {
  it("gives the details a basis of their own content, and no shrink", () => {
    expect(Draft).toMatch(/gap: 8, flex: "1 0 auto", maxWidth: "100%", minWidth: 0, cursor: hasDetail \? "pointer" : "default"/);
    expect(Draft, "flex: 1 with min-width 0 is what let the controls squeeze it").not.toMatch(/gap: 8, flex: 1, minWidth: 0, cursor: hasDetail/);
  });

  it("wraps the controls as ONE group, pushed right, so Accept and Dismiss never split", () => {
    const i = Draft.indexOf('<div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>');
    expect(i).toBeGreaterThan(-1);
    const group = Draft.slice(i, Draft.indexOf("</div>", i));
    expect(group).toMatch(/title=\{confLbl \+ " confidence"\}/);
    expect(group).toMatch(/>Accept<\/button>/);
    expect(group).toMatch(/>Dismiss<\/OutlineChip>/);
  });
});

// W2, measured on DEV: the header's button and the composer's were both
// "Templates" with the same document icon; one opens the editor, the other
// shows the chips that insert one. After: "Edit templates" with the app's edit
// pencil, and "Insert template" with the document.
describe("W2 — two jobs, two names, two marks", () => {
  it("the header's button edits the templates, under the edit pencil", () => {
    // Since W3 it also SAYS so, which is where its name now comes from.
    expect(Inbox).toMatch(/title="Edit templates \(T\)"[^>]*><EditIcon size=\{IC\.inline\} \/>Edit templates<\/button>/);
    expect(Inbox).not.toMatch(/title="Templates"/);
  });

  it("the composer's button inserts one, under the document mark", () => {
    expect(Composer).toMatch(/aria-label="Insert template"\s*title="Insert template \(E\)"/);
    expect(Composer).toMatch(/><TemplatesIcon size=\{IC\.chrome\} \/><\/button>/);
    expect(Composer).not.toMatch(/title="Templates"/);
  });

  it("the keyboard list uses the same two names", () => {
    expect(Shortcuts).toMatch(/\{ keys: \["T"\],\s*label: "Edit templates" \}/);
    expect(Shortcuts).toMatch(/\{ keys: \["E"\],\s*label: "Insert a template \(show or hide\)" \}/);
  });
});

// W3: the simulator flask, Templates and Re-check were icon-only, named by
// `title` alone. That is an accessible name, but the tablets never show a
// tooltip, so a finger never learned what they do. After: icon and word,
// the shape of Archive beside Re-check.
describe("W3 — the words are on the buttons, not in a tooltip", () => {
  it("Re-check says Re-check, and Checking… while it runs", () => {
    expect(View).toMatch(/<RecheckIcon size=\{IC\.inline\} \/><\/span>\s*\{running \? "Checking…" : "Re-check"\}\s*<\/button>/);
    expect(View, "no longer a bare square").not.toMatch(/width: H\.chrome, height: H\.chrome, minHeight: H\.chrome, padding: 0, cursor: running/);
  });

  it("the header's Edit templates and Simulator carry their words", () => {
    expect(Inbox).toMatch(/<FlaskIcon size=\{IC\.inline\} \/>Simulator<\/button>/);
    expect(Inbox).toMatch(/const HEAD_TEXT_BTN = \{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 12px", minHeight: H\.chrome, fontSize: T\.small, flexShrink: 0, lineHeight: 1 \};/);
  });
});
