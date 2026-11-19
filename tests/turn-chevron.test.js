// tests/turn-chevron.test.js — v18.14.0 (correction 30, Patryk)
//
// A disclosure's chevron is one drawing that turns. Five of them were a ternary of two
// icons, which swaps in a frame while the panel beside it eases, and a new one would be
// the same two lines, so the shape itself is what fails here.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { stripComments } from "../scripts/strip-comments.mjs";

function componentFiles(dir = "src/components") {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return componentFiles(path);
    return path.endsWith(".jsx") ? [path] : [];
  });
}
const sources = componentFiles().map((path) => [path, stripComments(readFileSync(path, "utf8")).join("\n")]);

describe("a disclosure's chevron", () => {
  it("is never two icons swapped by a ternary", () => {
    const swapped = sources.filter(([, src]) => /\?\s*<Chevron\w+Icon[^>]*\/>\s*:\s*<Chevron\w+Icon/.test(src)).map(([path]) => path);
    expect(swapped).toEqual([]);
  });
  it("turns on the notification strip's speed", () => {
    const atoms = sources.find(([path]) => path.endsWith("/atoms.jsx"))[1];
    const mark = atoms.slice(atoms.indexOf("export function TurnChevron"), atoms.indexOf("export function RowSlot"));
    expect(mark).toContain('transition: "transform " + M.move');
    expect(mark).toContain("(open ? (flip ? 180 : 90) : 0)");
  });
  it("is used by the five that swapped", () => {
    ["BookingFormModal", "CustomersSettings", "Summary", "VouchersSettings", "whatsapp/ConversationView"].forEach((name) => {
      const src = sources.find(([path]) => path.endsWith("/" + name + ".jsx"))[1];
      expect(src, name).toContain("<TurnChevron open={");
    });
  });
});

// v18.18.0 (Patryk, item 5): three chevrons that stood still while their lists
// opened, the inbox's WhatsApp mark and the two pickers. Each turns with its own
// `open`, and none of them draws the still mark any more.
describe("a list's chevron", () => {
  const src = (name) => sources.find(([path]) => path.endsWith("/" + name + ".jsx"))[1];
  it("turns on the inbox's WhatsApp mark, the country-code picker and the time-zone picker", () => {
    ["whatsapp/InboxPanel", "CountryPicker", "TimeZonePicker"].forEach((name) => {
      expect(src(name), name).toContain("<TurnChevron open={open} flip size={IC.inline} />");
      expect(src(name), name).not.toContain("<ChevronDownIcon");
    });
  });
  it("on the mark, reads the menu's own state: the menu's trigger may be a function of `open`", () => {
    expect(src("whatsapp/ConversationMenu")).toContain('{trigger ? (typeof trigger === "function" ? trigger(open) : trigger) : (');
    expect(src("whatsapp/InboxPanel")).toContain("trigger={(open) => (");
  });
  it("on a picker that opens upward, starts pointing up and turns down", () => {
    expect(src("CountryPicker")).toContain('const CHEVRON_UP = { transform: "rotate(180deg)" };');
    expect(src("CountryPicker")).toContain('style={Object.assign({ color: S.muted, display: "flex" }, above ? CHEVRON_UP : null)}><TurnChevron open={open} flip size={IC.inline} />');
  });
});
