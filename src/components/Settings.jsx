// src/components/Settings.jsx
// The Settings modal shell — tab dispatcher (`SettingsContent`), tab bar
// (`TabBar`), General tab body (`GeneralTabContent`), and the cog/gear icon
// (`CogIcon`) used as the Settings trigger in TimelineView's legend row.
//
// Tabs: General · Reminders · Shortcuts. The Settings modal itself (the
// Overlay, the close button, the title bar) lives in App.jsx — this file
// only renders the body inside that modal.
//
// The Reminders and Shortcuts tab bodies are imported from sibling files so
// each feature has its own home: Reminders.jsx for the list/edit/toggle UI,
// Shortcuts.jsx for the keyboard cheatsheet.
//
// Phase B3 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Phase B5: visible version label bumped 14.1 → 14.1.1 (file-split refactor
// complete; no behavioural change — the patch version reflects that).

import { RemindersTabContent } from "./Reminders";
import { ShortcutsContent } from "./Shortcuts";

// ── Tab bar — pill-shaped tabs with active tab lifted in white ──────────────
// Reusable enough for future modals to import; lives here for now because
// only the Settings modal uses it. If a second consumer appears later, this
// could move to atoms.jsx painlessly.
export function TabBar({ tabs, current, onSelect }) {
  return (
    <div style={{
      display: "flex", gap: 4, padding: 4,
      borderRadius: 12,
      background: "rgba(240,243,248,0.8)",
      marginBottom: 16,
      border: "1px solid rgba(210,218,230,0.6)"
    }}>
      {tabs.map((t) => {
        const active = t.id === current;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "none",
              background: active ? "rgba(255,255,255,0.95)" : "transparent",
              color: active ? "#007AFF" : "#5a6474",
              fontWeight: active ? 700 : 600,
              fontSize: 13,
              cursor: "pointer",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s"
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── General tab — version line + visible copyright credit ───────────────────
// Reserved for future app-level toggles (default view, sound preference,
// etc.). The version label is hardcoded; bumped at the end of each shipping
// phase (currently 14.1.1 — end of B5, file-split refactor complete).
export function GeneralTabContent() {
  return (
    <div style={{ padding: "28px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6474", letterSpacing: "0.02em" }}>
        version 14.1.1
      </div>
      <div style={{ fontSize: 11, fontWeight: 500, color: "#8a94a3", letterSpacing: "0.02em", marginTop: 8 }}>
        © 2026 Patryk Zychowicz — MGT Booking System
      </div>
    </div>
  );
}

// ── Settings modal body — tab bar + active tab content ──────────────────────
// Tab state lives in BookingApp (so it persists across modal close/reopen if
// desired — currently it's reset on close by the parent). Reminder list
// state and handlers are also threaded from BookingApp.
export function SettingsContent({
  tab, setTab,
  reminders,
  onAddReminder,
  onEditReminder,
  onDeleteReminder,
  onToggleReminder
}) {
  let content;
  if (tab === "general") {
    content = <GeneralTabContent />;
  } else if (tab === "reminders") {
    content = (
      <RemindersTabContent
        reminders={reminders}
        onAdd={onAddReminder}
        onEdit={onEditReminder}
        onDelete={onDeleteReminder}
        onToggle={onToggleReminder}
      />
    );
  } else {
    content = <ShortcutsContent />;
  }
  return (
    <div>
      <TabBar
        tabs={[
          { id: "general",   label: "General" },
          { id: "reminders", label: "Reminders" },
          { id: "shortcuts", label: "Shortcuts" },
        ]}
        current={tab}
        onSelect={setTab}
      />
      {content}
    </div>
  );
}

// ── Cog (gear) icon — 20×20 SVG, used as Settings trigger ───────────────────
// Stroke inherits from the parent button's `color` via currentColor, so the
// trigger button controls its own colour.
export function CogIcon() {
  return (
    <svg
      width={20} height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
