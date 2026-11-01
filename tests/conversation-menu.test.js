// tests/conversation-menu.test.js
// v18.14.0 (correction 6): the ⋯ in a conversation's header. What it holds and which row
// a key moves to are pure, so they run here. The rest is read from the source, as the
// suite does for anything that takes a browser: how it behaves, in and out, by tap and by
// key, was measured live and is in REFACTOR_LOG.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { conversationMenuIds } from "../src/lib/whatsapp.js";
import { activatesItself, nextMenuIndex } from "../src/lib/keyboard.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Menu = read("components/whatsapp/ConversationMenu.jsx");
const View = read("components/whatsapp/ConversationView.jsx");
const Inbox = read("components/whatsapp/InboxPanel.jsx");

describe("what the ⋯ holds", () => {
  const both = { recheck: true, mute: true };
  it("a live conversation: Re-check and Not a customer, no Delete", () => {
    expect(conversationMenuIds({}, both)).toEqual(["recheck", "mute"]);
  });
  it("an archived one adds Delete, last, so red is never the row under the thumb", () => {
    expect(conversationMenuIds({ archived: true }, both)).toEqual(["recheck", "mute", "delete"]);
  });
  it("a conversation already muted is not offered it again", () => {
    expect(conversationMenuIds({ archived: true, muted: true }, both)).toEqual(["recheck", "delete"]);
  });
  it("a row with nothing behind it is not drawn, and the header draws no empty ⋯", () => {
    expect(conversationMenuIds({}, { recheck: false, mute: false })).toEqual([]);
    expect(View).toContain("{menuItems.length ? <ConversationMenu");
  });
});

describe("which row a key moves to", () => {
  it("↓ and ↑ wrap", () => {
    expect(nextMenuIndex(0, "ArrowDown", 3)).toBe(1);
    expect(nextMenuIndex(2, "ArrowDown", 3)).toBe(0);
    expect(nextMenuIndex(1, "ArrowUp", 3)).toBe(0);
    expect(nextMenuIndex(0, "ArrowUp", 3)).toBe(2);
  });
  it("from no row, which is where a tap leaves it, ↓ is the first and ↑ the last", () => {
    expect(nextMenuIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextMenuIndex(-1, "ArrowUp", 3)).toBe(2);
  });
  it("Home and End", () => {
    expect(nextMenuIndex(1, "Home", 3)).toBe(0);
    expect(nextMenuIndex(1, "End", 3)).toBe(2);
  });
  it("any other key is not the menu's, so it is left alone", () => {
    expect(nextMenuIndex(0, "Enter", 3)).toBe(null);
    expect(nextMenuIndex(0, "a", 3)).toBe(null);
    expect(nextMenuIndex(0, "ArrowDown", 0)).toBe(null);
  });
  it("Enter on a row is the row's own, not the modal's", () => {
    const row = { tagName: "BUTTON" };
    expect(activatesItself(row)).toBe(true);
  });
});

describe("it is a menu, and says so", () => {
  it("the button announces what it opens", () => {
    expect(Menu).toContain('aria-haspopup="menu"');
    expect(Menu).toContain("aria-expanded={open}");
    expect(Menu).toContain('aria-label="More actions"');
  });
  it("the rows are menuitems Tab leaves rather than walks", () => {
    expect(Menu).toContain('role="menu"');
    expect(Menu).toContain('role="menuitem"');
    expect(Menu).toContain("tabIndex={-1}");
  });
  it("a state on a row is aria-disabled, because Chrome blurs a disabled control", () => {
    expect(Menu).toContain('aria-disabled={it.inactive ? "true" : undefined}');
    expect(Menu).not.toMatch(/(?<!-)disabled=\{/);
    expect(Menu).toMatch(/function pick\(it\) \{\s*if \(it\.inactive\) return;/);
  });
});

describe("how it closes", () => {
  it("focus moves in for a key and not for a tap", () => {
    expect(Menu).toContain("setByKey(e.detail === 0)");
    expect(Menu).toContain("autoFocus={byKey && i === 0}");
  });
  it("focus goes back before the action, because a confirm makes the page inert", () => {
    expect(Menu).toMatch(/close\(true\);\s*it\.onPick\(\);/);
  });
  it("a tap elsewhere closes it, in the capture phase, and Escape stops at the menu", () => {
    expect(Menu).toContain('document.addEventListener("pointerdown", onDown, true)');
    expect(Menu).toContain('window.addEventListener("keydown", onKey, true)');
    expect(Menu).toMatch(/e\.key === "Escape"\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); close\(true\);/);
  });
  it("the inbox's own keys stand down first, or ↓ would change the conversation", () => {
    const at = Inbox.indexOf("function onKey(e) {");
    expect(at).toBeGreaterThan(-1);
    const head = Inbox.slice(at, at + 140);
    expect(head).toContain(`if (document.querySelector('[role="menu"]')) return;`);
    expect(head.indexOf("[role=")).toBeLessThan(head.indexOf('e.key === "Escape"'));
  });
  it("it does not stay open over the next conversation", () => {
    expect(View).toContain("<ConversationMenu key={conv.phoneKey}");
  });
});

describe("how it moves", () => {
  it("from the corner under the ⋯, in and out, with nothing behind it dimmed", () => {
    expect(Menu).toContain('inClass="mgt-pop-in"');
    expect(Menu).toContain('outClass="mgt-pop-out"');
    expect(Menu).toContain('transformOrigin: "top right"');
    expect(Menu).not.toMatch(/PopupShell|scrim/i);
  });
  it("a leaving row takes no tap", () => {
    expect(Menu).toContain('pointerEvents: open ? "auto" : "none"');
  });
  it("the ⋯ turns while the work runs, and the two marks cross-fade", () => {
    expect(Menu).toContain("opacity: busy ? 0 : 1");
    expect(Menu).toContain("opacity: busy ? 1 : 0");
    expect(Menu).toContain('animationPlayState: busy ? "running" : "paused"');
    expect(View).toContain("busy={running}");
  });
});
