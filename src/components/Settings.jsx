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
// complete; no behavioural change).
// Phase C1: visible version label bumped 14.1.1 → 14.1.2 (helper
// consolidation + Follow button label fix).
// Phase C2: visible version label bumped 14.1.2 → 14.1.3 (useWinW hook
// extracted; dead-import cleanup in App.jsx).
// Phase C3b.1 (v14.1.6): version label is no longer hardcoded here — it now
// arrives as the `appVersion` prop, sourced from __APP_SIGNATURE__.version
// in App.jsx (single source of truth). Future bumps require only the
// __APP_SIGNATURE__ edit in App.jsx; this file no longer needs touching
// for version changes.

import { RemindersTabContent } from "./Reminders";
import { ShortcutsContent } from "./Shortcuts";
import { Toggle, Section } from "./atoms";

// ── Tab bar — pill-shaped tabs with active tab lifted in white ──────────────
// Reusable enough for future modals to import; lives here for now because
// only the Settings modal uses it. If a second consumer appears later, this
// could move to atoms.jsx painlessly.
export function TabBar({ tabs, current, onSelect }) {
  return (
    <div style={{
      display: "flex", gap: 4, padding: 4,
      borderRadius: 12,
      background: "var(--bg-tabbar)",
      marginBottom: 16,
      border: "1px solid var(--border-soft)"
    }}>
      {tabs.map((t) => {
        const active = t.id === current;
        return (
          <button
            key={t.id}
            className="mgt-hover-scale"
            onClick={() => onSelect(t.id)}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "none",
              background: active ? "var(--bg-tab-active)" : "transparent",
              color: active ? "var(--accent)" : "var(--text-muted)",
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

// ── General tab — dark-mode toggle · opening-hours editor · version line ────
// The version string arrives as a prop from App.jsx (sourced from
// __APP_SIGNATURE__.version). Opening hours (v14.4.0) are Firebase-shared and
// arrive as openHour/closeHour with an onSaveHours(open, close) writer.

// Hour stepper (whole hours only — the service window is on the hour). Each tap
// commits a new {open, close} pair via onSaveHours; the component is fully
// controlled by props (the Firebase echo re-renders it). Disabled at the bounds
// (open 8–21 and < close; close (open+1)–23) so an invalid window can't be set.
const HOUR_STEP_BTN = {
  background: "var(--bg-stepper)", border: "1px solid var(--border-soft)",
  borderRadius: 10, width: 38, height: 38, fontSize: 20, fontWeight: 600,
  color: "var(--text-primary)",
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  boxShadow: "var(--shadow-input)"
};
function HourStepper({ label, value, onDec, onInc, disableDec, disableInc }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={onDec} disabled={disableDec}
          className={disableDec ? undefined : "mgt-hover-scale"}
          style={{ ...HOUR_STEP_BTN, opacity: disableDec ? 0.4 : 1, cursor: disableDec ? "not-allowed" : "pointer" }}
        >
          −
        </button>
        <span style={{ minWidth: 58, textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
          {String(value).padStart(2, "0") + ":00"}
        </span>
        <button
          onClick={onInc} disabled={disableInc}
          className={disableInc ? undefined : "mgt-hover-scale"}
          style={{ ...HOUR_STEP_BTN, opacity: disableInc ? 0.4 : 1, cursor: disableInc ? "not-allowed" : "pointer" }}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function GeneralTabContent({ appVersion, isDark, onToggleDark, openHour, closeHour, onSaveHours = () => {} }) {
  const oh = typeof openHour === "number" ? openHour : 13;
  const ch = typeof closeHour === "number" ? closeHour : 22;
  return (
    <div>
      {/* v14.2.0: Dark-mode toggle. Per-device (localStorage) — flips
          <html data-theme> via useThemeMode in BookingApp. `Toggle` is the
          atom: signature { on, onClick } (NOT checked/onChange). This modal's
          own surfaces are still light in both themes at v14.2.0 (Overlay /
          Section migrate in a later wave), so this row keeps light literals to
          stay readable here for now. */}
      <Section style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Dark mode</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Saved on this device. Defaults to your system setting.
            </div>
          </div>
          <Toggle on={isDark} onClick={onToggleDark} />
        </div>
      </Section>
      {/* v14.4.0: Opening-hours editor — Firebase-shared (settings/operatingHours).
          Sets the booking window (form time min/max) and the timeline grid range. */}
      <Section style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Opening hours</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2, marginBottom: 12 }}>
          Shared across all devices. Sets the booking window and the timeline range.
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <HourStepper
            label="Open" value={oh}
            disableDec={oh <= 8} disableInc={oh >= ch - 1}
            onDec={() => onSaveHours(oh - 1, ch)} onInc={() => onSaveHours(oh + 1, ch)}
          />
          <HourStepper
            label="Close" value={ch}
            disableDec={ch <= oh + 1} disableInc={ch >= 23}
            onDec={() => onSaveHours(oh, ch - 1)} onInc={() => onSaveHours(oh, ch + 1)}
          />
        </div>
      </Section>
      <div style={{ padding: "10px 12px 12px", textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.02em" }}>
          version {appVersion}
        </div>
        <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-faint)", letterSpacing: "0.02em", marginTop: 8 }}>
          © 2026 Patryk Zychowicz — MGT Booking System
        </div>
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
  appVersion,
  isDark,
  onToggleDark,
  openHour,
  closeHour,
  onSaveHours,
  reminders,
  onAddReminder,
  onEditReminder,
  onDeleteReminder,
  onToggleReminder
}) {
  let content;
  if (tab === "general") {
    content = <GeneralTabContent appVersion={appVersion} isDark={isDark} onToggleDark={onToggleDark} openHour={openHour} closeHour={closeHour} onSaveHours={onSaveHours} />;
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
