// tests/shortcuts-tab.test.js — v18.2.0, the design critique's S8: the
// Shortcuts tab lists a key only where the key works, on the cards every other
// Settings tab uses.
//
// Measured before: "X · Open WhatsApp simulator" was listed in production,
// where X does nothing (`useKeyboardShortcuts` checks `WA_SANDBOX`); and the
// tab was the only one drawn on the bare sheet, with blue uppercase headings.
// The same sweep found "I · Open WhatsApp inbox" and the eleven-row inbox
// section listed for a restaurant whose WhatsApp module is off, which is how
// the module ships.
//
// `ShortcutsContent` is a pure function with no hooks, so it is CALLED and its
// element tree read — React elements are plain objects — the way
// tests/error-boundary.test.js reads its boundary; nothing is mounted.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { resolveShortcut } from "../src/lib/shortcuts";

vi.mock("../src/lib/waSandbox", () => ({ WA_SANDBOX: false }));
const { ShortcutsContent } = await import("../src/components/Shortcuts.jsx");

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

// Every string under an element tree, in order — enough to ask which rows and
// which section titles the sheet renders.
function textsOf(node, out = []) {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textsOf(n, out)); return out; }
  const p = node.props || {};
  if (typeof p.label === "string") out.push(p.label);
  textsOf(p.children, out);
  return out;
}

describe("a key is listed only where it works", () => {
  it("a production build without WhatsApp: no simulator, no inbox", () => {
    const t = textsOf(ShortcutsContent({ whatsappOn: false }));
    expect(t).not.toContain("Open WhatsApp simulator");
    expect(t).not.toContain("Open WhatsApp inbox");
    expect(t).not.toContain("WhatsApp Inbox");
    expect(t).toContain("Timeline view");
    expect(t).toContain("Navigation");
  });

  it("a production build with WhatsApp on: the inbox, still no simulator", () => {
    const t = textsOf(ShortcutsContent({ whatsappOn: true }));
    expect(t).toContain("Open WhatsApp inbox");
    expect(t).toContain("WhatsApp Inbox");
    expect(t).toContain("Edit templates");
    expect(t).not.toContain("Open WhatsApp simulator");
  });

  it("uses the keyboard handler's own two gates, not a guess at them", () => {
    // v18.4.4: the handler's gates are rows in lib/shortcuts.js, so they are
    // asked rather than read: X needs the sandbox flag, I needs the module.
    const K = (on) => ({ hasModule: (id) => on && id === "whatsapp" });
    const env = (sandbox) => ({ sandbox, today: "2026-01-01", settingsTabs: () => [] });
    expect(resolveShortcut({ key: "x" }, K(true), env(false))).toBe(null);
    expect(resolveShortcut({ key: "x" }, K(false), env(true))).not.toBe(null);
    expect(resolveShortcut({ key: "i" }, K(false), env(true))).toBe(null);
    expect(resolveShortcut({ key: "i" }, K(true), env(false))).not.toBe(null);
    expect(read("hooks/useKeyboardShortcuts.js")).toContain("sandbox:WA_SANDBOX");
    const sc = read("components/Shortcuts.jsx");
    expect(sc).toMatch(/if \(when === "sandbox"\) return WA_SANDBOX;/);
    expect(sc).toMatch(/if \(when === "whatsapp"\) return whatsappOn === true;/);
    expect(sc).toMatch(/\{ keys: \["X"\],\s*label: "Open WhatsApp simulator", when: "sandbox" \}/);
    expect(sc).toMatch(/\{ keys: \["I"\],\s*label: "Open WhatsApp inbox", when: "whatsapp" \}/);
    expect(sc).toMatch(/\{ title: "WhatsApp Inbox", when: "whatsapp", rows: \[/);
  });

  it("Settings hands the sheet the module's state", () => {
    expect(read("components/Settings.jsx")).toMatch(/content = <ShortcutsContent whatsappOn=\{typeof hasModule === "function" && hasModule\("whatsapp"\)\} \/>;/);
  });
});

describe("the tab looks like the others", () => {
  it("draws each section as a Section card, titled like a Collapsible header", () => {
    const sc = read("components/Shortcuts.jsx");
    expect(sc).toMatch(/<Section key=\{sec\.title\}/);
    expect(sc).toMatch(/fontSize: T\.lead, fontWeight: FW\.semi, color: "var\(--text-primary\)", marginBottom: 6/);
    expect(sc, "the blue uppercase heading is gone").not.toMatch(/textTransform: "uppercase"/);
  });

  it("leaves no hairline under a card's last row", () => {
    const tree = ShortcutsContent({ whatsappOn: false });
    const cards = tree.props.children;
    for (const card of cards) {
      const rows = card.props.children[1].props.children;
      expect(rows[rows.length - 1].props.last).toBe(true);
      expect(rows.slice(0, -1).every((r) => r.props.last === false)).toBe(true);
    }
  });
});
