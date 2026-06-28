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
import { Kbd } from "./atoms";

// ── One row: keycap(s) + label ────────────────────────────────────────────────
export function ShortcutRow({ keys, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid rgba(180,190,210,0.2)" }}>
      <div style={{ minWidth: 108, display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
        {keys.map((k, i) => (
          <Fragment key={i}>
            {i > 0 ? (
              <span style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 3px" }}>/</span>
            ) : null}
            <Kbd k={k} />
          </Fragment>
        ))}
      </div>
      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</span>
    </div>
  );
}

// ── Full sectioned cheatsheet ────────────────────────────────────────────────
// Sections array is module-local (this file owns the canonical list). Adding
// a new shortcut = adding a row here AND wiring the key in BookingApp's
// keyboard handler. Both must be kept in sync manually for now.
const SHORTCUT_SECTIONS = [
  { title: "Navigation", rows: [
    { keys: ["T"],       label: "Timeline view" },
    { keys: ["L"],       label: "List view" },
    { keys: ["D"],       label: "Jump to today" },
    { keys: ["←", "→"],  label: "Previous / next day" },
    { keys: ["N"],       label: "New booking" },
    { keys: ["W"],       label: "Walk-in" },
    { keys: ["S"],       label: "Toggle Summary panel" },
    { keys: ["M"],       label: "Open More (Week / Month)" },
    { keys: ["I"],       label: "Open WhatsApp inbox" },
    { keys: ["X"],       label: "Open WhatsApp simulator" },
    { keys: ["?"],       label: "Show this help" },
  ]},
  { title: "Timeline", rows: [
    { keys: ["F"],       label: "Toggle Follow (today only)" },
    { keys: ["+", "="],  label: "Zoom in" },
    { keys: ["−"],       label: "Zoom out" },
    { keys: ["0"],       label: "Reset zoom to 1×" },
    { keys: ["O"],       label: "Toggle Optimizer (today)" },
    { keys: ["R"],       label: "Reshuffle (today, optimizer OFF)" },
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
    { keys: ["Esc"],     label: "Close current window" },
    { keys: ["Enter"],   label: "Confirm primary action" },
  ]},
];

export function ShortcutsContent() {
  return (
    <div>
      {SHORTCUT_SECTIONS.map((sec, si) => (
        <div key={si} style={{ marginBottom: si < SHORTCUT_SECTIONS.length - 1 ? 14 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {sec.title}
          </div>
          <div>
            {sec.rows.map((r, ri) => (
              <ShortcutRow key={ri} keys={r.keys} label={r.label} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
