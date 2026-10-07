// src/components/Shortcuts.jsx
// Keyboard-shortcut cheatsheet shown in the Settings → Shortcuts tab.
// Pure presentational, no state, no hooks. Single source of truth for the
// app's shortcut documentation — when a new shortcut is added in BookingApp's
// keyboard handler, the row goes here so the Settings tab reflects it.
//
// `ShortcutRow` renders one row: 1+ keycaps on the left, a label on the
// right. Keycaps are separated by " / " when alternates exist
// (e.g. + and = both zoom in).
//
// `ShortcutsContent` renders the full sectioned cheatsheet — Navigation,
// Timeline, Edit / New Booking, Preferred Table picker, Manual Table
// Assignment, Settings, Universal.
//
// Phase B3 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original. The earlier comment claiming this is shared with a standalone
// "?" popup was outdated — the "?" key now opens the Settings modal directly,
// so the dual-use claim has been removed.

import { Fragment } from "react";
import { Kbd, Section } from "./atoms";
import { T, FW } from "../lib/constants";
import { WA_SANDBOX } from "../lib/waSandbox";

// ── One row: keycap(s) + label ────────────────────────────────────────────────
export function ShortcutRow({ keys, label, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}>
      <div style={{ minWidth: 108, display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
        {keys.map((k, i) => (
          <Fragment key={i}>
            {i > 0 ? (
              <span style={{ fontSize: T.small, color: "var(--text-muted)", margin: "0 2px" }}>/</span>
            ) : null}
            <Kbd k={k} />
          </Fragment>
        ))}
      </div>
      <span style={{ fontSize: T.body, color: "var(--text-primary)" }}>{label}</span>
    </div>
  );
}

// ── Full sectioned cheatsheet ────────────────────────────────────────────────
// Sections array is module-local (this file owns the canonical list). Adding
// a new shortcut = adding a row here AND wiring the key in BookingApp's
// keyboard handler. Both must be kept in sync manually for now.
//
// v18.2.0 (the design critique, S8): a row or section whose key only works
// behind a gate carries `when`, and is listed only where the key works — the
// SAME gate its row in `lib/shortcuts.js` checks. "X · Open WhatsApp simulator" was
// listed in production, where X does nothing (the simulator is `WA_SANDBOX`
// only), and so were "I · Open WhatsApp inbox" and the whole inbox section for
// a restaurant whose WhatsApp module is off, which is how it ships.
const SHORTCUT_SECTIONS = [
  { title: "Navigation", rows: [
    { keys: ["T"],       label: "Timeline view" },
    { keys: ["L"],       label: "List view" },
    { keys: ["P"],       label: "Plan (floor) view" },
    { keys: ["D"],       label: "Jump to today" },
    { keys: ["←", "→"],  label: "Previous / next day" },
    { keys: ["N"],       label: "New booking" },
    { keys: ["W"],       label: "Walk-in" },
    { keys: ["S"],       label: "Toggle Summary panel" },
    { keys: ["M"],       label: "Open More (Week / Month)" },
    { keys: ["/"],       label: "Find a booking (any date)" },
    { keys: ["⇧D"], label: "Toggle dark / light mode" },
    { keys: ["⇧+", "⇧−"], label: "Adjust app width (±50 px)" },
    { keys: ["I"],       label: "Open WhatsApp inbox", when: "whatsapp" },
    { keys: ["X"],       label: "Open WhatsApp simulator", when: "sandbox" },
    { keys: ["?"],       label: "Show this help" },
  ]},
  { title: "Timeline", rows: [
    { keys: ["F"],       label: "Toggle Follow (today only)" },
    { keys: ["="],       label: "Zoom in (unshifted — ⇧+ is app width)" },
    { keys: ["−"],       label: "Zoom out" },
    { keys: ["0"],       label: "Reset zoom to 1×" },
    { keys: ["O"],       label: "Toggle Optimiser (today)" },
    { keys: ["R"],       label: "Reshuffle (today, optimiser OFF)" },
  ]},
  { title: "List view", rows: [
    { keys: ["↑", "↓"], label: "Select previous / next booking" },
    { keys: ["A"],       label: "Assign tables" },
    { keys: ["E"],       label: "Edit booking" },
    { keys: ["S"],       label: "Mark seated" },
    { keys: ["C"],       label: "Mark completed" },
    { keys: ["⇧C"], label: "Cancel booking" },
    { keys: ["D"],       label: "Delete booking" },
  ]},
  { title: "WhatsApp Inbox", when: "whatsapp", rows: [
    { keys: ["←", "→"],   label: "Switch Inbox / Archived" },
    { keys: ["↑", "↓"],   label: "Select previous / next conversation" },
    { keys: ["S"],        label: "Toggle multi-select" },
    { keys: ["T"],        label: "Edit templates" },
    { keys: ["E"],        label: "Insert a template (show or hide)" },
    { keys: ["A"],        label: "Accept draft, else toggle Needs action" },
    { keys: ["D"],        label: "Dismiss draft" },
    { keys: ["C"],        label: "Focus the reply box" },
    { keys: ["/"],        label: "Focus search" },
    { keys: ["⌫"],        label: "Archive (Inbox; selection in select mode)" },
    { keys: ["R"],        label: "Restore (Archived; selection in select mode)" },
  ]},
  { title: "More popover (Week / Month)", rows: [
    { keys: ["W", "M"], label: "Week / Month view" },
    { keys: ["↑", "↓"], label: "Move day focus" },
    { keys: ["←", "→"], label: "Prev / next (week, or day in Month)" },
    { keys: ["T"],       label: "This week / month (today)" },
    { keys: ["Enter"],   label: "Open the focused day" },
  ]},
  { title: "Edit / New Booking", rows: [
    { keys: ["A"],       label: "Manual table assignment" },
    { keys: ["P"],       label: "Preferred tables" },
    { keys: ["C"],       label: "Clear tables assignment" },
    { keys: ["B"],       label: "Book Again (edit only, seated / completed)" },
    { keys: ["H"],       label: "View history (edit only)" },
  ]},
  { title: "Preferred Table picker", rows: [
    { keys: ["C"],       label: "Clear preferred tables" },
  ]},
  { title: "Manual Table Assignment", rows: [
    { keys: ["S"],       label: "Toggle Swap busy" },
    { keys: ["C"],       label: "Clear selected tables" },
  ]},
  { title: "Settings", rows: [
    { keys: ["\u2190", "\u2192"], label: "Switch between tabs" },
    { keys: ["N"],       label: "New reminder (Reminders tab)" },
  ]},
  { title: "Universal", rows: [
    { keys: ["Esc"],     label: "Close current window (or clear the List selection)" },
    { keys: ["Enter"],   label: "Confirm primary action" },
  ]},
];

// Is the key behind this `when` live here? Module-private: a component file
// that also exports a plain function is a hard lint error
// (`react-refresh/only-export-components`), so the test reads the source.
function shortcutShown(when, whatsappOn) {
  if (when === "sandbox") return WA_SANDBOX;
  if (when === "whatsapp") return whatsappOn === true;
  return true;
}

// v18.2.0 (S8): each section is a `Section` card with a title in the
// Collapsible header's type — the shape of every other Settings tab. This was
// the one tab drawn on the bare sheet, with blue uppercase headings of its own.
export function ShortcutsContent({ whatsappOn = false }) {
  const sections = SHORTCUT_SECTIONS
    .filter(function (sec) { return shortcutShown(sec.when, whatsappOn); })
    .map(function (sec) { return { title: sec.title, rows: sec.rows.filter(function (r) { return shortcutShown(r.when, whatsappOn); }) }; });
  return (
    <div>
      {sections.map((sec, si) => (
        <Section key={sec.title} style={si === sections.length - 1 ? { marginBottom: 0 } : null}>
          <div style={{ fontSize: T.lead, fontWeight: FW.semi, color: "var(--text-primary)", marginBottom: 6 }}>
            {sec.title}
          </div>
          <div>
            {sec.rows.map((r, ri) => (
              <ShortcutRow key={ri} keys={r.keys} label={r.label} last={ri === sec.rows.length - 1} />
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}
