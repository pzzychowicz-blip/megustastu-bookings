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
import { LayoutTabContent } from "./LayoutSettings";
import { Toggle, Section, Collapsible, AutoHeight, Reveal } from "./atoms";

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

// ── General tab — dark-mode · per-weekday hours · shifts · optimizer · version ──
// The version string arrives as a prop from App.jsx (sourced from
// __APP_SIGNATURE__.version). v15.0.0: opening hours are PER-WEEKDAY — they arrive
// as `weekHours` (keys 0–6) with onSaveDayHours(weekdayKey, patch) / onSaveAllDays
// writers, edited via the DayHoursRow list below. `weekRange` ({minOpen,maxClose})
// bounds the single global shift split + optimizer cutoff steppers.

// Whole-hour stepper — still used for the Afternoon/Evening split + the optimizer
// cutoff (both single global hours). Fully controlled by props (the Firebase echo
// re-renders it); disabled at the bounds so an invalid value can't be set.
const HOUR_STEP_BTN = {
  background: "var(--bg-stepper)", border: "1px solid var(--border-soft)",
  borderRadius: 10, width: 38, height: 38, fontSize: 20, fontWeight: 600,
  color: "var(--text-primary)",
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  boxShadow: "var(--shadow-input)"
};
// `fmt` (v15.0.0): optional value→label formatter. Defaults to the modulo-24
// clock label; the optimizer cutoff passes its own so it can show "24:00" (the
// full-day endpoint) distinctly from "00:00".
function HourStepper({ label, value, onDec, onInc, disableDec, disableInc, fmt }) {
  const display = fmt ? fmt(value) : String(value % 24).padStart(2, "0") + ":00";
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
          {display}
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

// v15.0.0: compact stepper for the per-weekday hours editor (no label row, so 7
// rows stay scannable). Same disabled / hover-scale contract as HourStepper.
const MINI_STEP_BTN = {
  background: "var(--bg-stepper)", border: "1px solid var(--border-soft)",
  borderRadius: 8, width: 30, height: 30, fontSize: 17, fontWeight: 600,
  color: "var(--text-primary)",
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  boxShadow: "var(--shadow-input)"
};
function MiniStepper({ value, onDec, onInc, disableDec, disableInc }) {
  const fmt = (n) => String(((n % 24) + 24) % 24).padStart(2, "0") + ":00";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button onClick={onDec} disabled={disableDec} className={disableDec ? undefined : "mgt-hover-scale"}
        style={{ ...MINI_STEP_BTN, opacity: disableDec ? 0.4 : 1, cursor: disableDec ? "not-allowed" : "pointer" }}>−</button>
      <span style={{ minWidth: 46, textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{fmt(value)}</span>
      <button onClick={onInc} disabled={disableInc} className={disableInc ? undefined : "mgt-hover-scale"}
        style={{ ...MINI_STEP_BTN, opacity: disableInc ? 0.4 : 1, cursor: disableInc ? "not-allowed" : "pointer" }}>+</button>
    </div>
  );
}

// One weekday row in the Opening-hours editor: label · Open/Closed pill · (when
// open) compact open–close steppers · "copy → all" action (always shown, so a
// closed day can also be copied across the week). Fully controlled — each change
// calls onChange(patch); the Firebase echo re-renders. Bounds mirror sanitizeDay
// (open 6–22, close (open+1)–25).
function DayHoursRow({ label, day, onChange, onCopyAll }) {
  const closed = day && day.closed === true;
  const o = day && Number.isFinite(day.open) ? day.open : 13;
  const c = day && Number.isFinite(day.close) ? day.close : 22;
  const pill = {
    border: "1px solid var(--border-soft)", borderRadius: 8, padding: "4px 10px",
    fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0,
    boxShadow: "var(--shadow-input)"
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--border-soft)" }}>
      <span style={{ width: 40, fontSize: 13, fontWeight: 700, color: "var(--text-primary)", flexShrink: 0 }}>{label}</span>
      <button onClick={() => onChange({ closed: !closed })} className="mgt-hover-scale"
        style={{ ...pill, background: closed ? "var(--bg-stepper)" : "rgba(52,199,89,0.16)", color: closed ? "var(--text-muted)" : "var(--success-text)" }}>
        {closed ? "Closed" : "Open"}
      </button>
      {closed ? (
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>No service this day</span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <MiniStepper value={o} disableDec={o <= 6} disableInc={o >= c - 1}
            onDec={() => onChange({ open: o - 1 })} onInc={() => onChange({ open: o + 1 })} />
          <span style={{ color: "var(--text-faint)", fontWeight: 700 }}>–</span>
          <MiniStepper value={c} disableDec={c <= o + 1} disableInc={c >= 25}
            onDec={() => onChange({ close: c - 1 })} onInc={() => onChange({ close: c + 1 })} />
        </div>
      )}
      <button onClick={onCopyAll} className="mgt-hover-scale" title="Copy this day's hours to all days"
        style={{ ...pill, marginLeft: "auto", background: "var(--bg-stepper)", color: "var(--accent)", fontWeight: 600 }}>
        copy → all
      </button>
    </div>
  );
}

export function GeneralTabContent({ appVersion, isDark, onToggleDark, weekHours, onSaveDayHours = () => {}, onSaveAllDays = () => {}, weekRange, splitHour, shiftsEnabled, onSaveShifts = () => {}, optimizerCutoff, optimizerAutoSwitch, onSaveOptimizer = () => {} }) {
  // v15.0.0: the shift split + optimizer cutoff are single GLOBAL values, so their
  // stepper bounds use the STABLE week range (min-open … max-close across open days),
  // never a single day's hours.
  const wr = weekRange && typeof weekRange === "object" ? weekRange : { minOpen: 13, maxClose: 22 };
  const wrMin = wr.minOpen, wrMax = wr.maxClose;
  const wh = weekHours && typeof weekHours === "object" ? weekHours : {};
  const sp = typeof splitHour === "number" ? splitHour : 17;
  const se = shiftsEnabled !== false;
  const oc = typeof optimizerCutoff === "number" ? optimizerCutoff : 15;
  const oas = optimizerAutoSwitch !== false;
  const hhLabel = (n) => String(((n % 24) + 24) % 24).padStart(2, "0") + ":00";
  // v15.0.0 (cutoff range): the optimizer cutoff is a single GLOBAL switch-off
  // hour, independent of opening hours — selectable across the whole day
  // (00:00–24:00). Its own formatter shows 24 as "24:00" (the full-day endpoint),
  // distinct from "00:00". Endpoints are meaningful: 0 = off all day, 24 = on all day.
  const cutoffLabel = (n) => String(n).padStart(2, "0") + ":00";
  const cutoffNote =
    oc >= 24 ? "Optimizer keeps reshuffling all day, then resets at the start of the next day."
    : oc <= 0 ? "Optimizer stays off all day; resume it manually (timeline control or the “o” key)."
    : "Optimizer stops reshuffling today's bookings at " + cutoffLabel(oc) + "; resumes at the start of the next day.";
  // Compact collapsed summary for the Opening-hours disclosure: a shared window if
  // every open day matches, else "Varies", plus a count of closed days.
  const dayCfgs = [0, 1, 2, 3, 4, 5, 6].map((d) => wh[d]);
  const openCfgs = dayCfgs.filter((d) => d && d.closed !== true);
  const closedCount = 7 - openCfgs.length;
  let hoursSummary;
  if (openCfgs.length === 0) {
    hoursSummary = "All closed";
  } else {
    const o0 = Number.isFinite(openCfgs[0].open) ? openCfgs[0].open : 13;
    const c0 = Number.isFinite(openCfgs[0].close) ? openCfgs[0].close : 22;
    const uniform = openCfgs.every((d) => (Number.isFinite(d.open) ? d.open : 13) === o0 && (Number.isFinite(d.close) ? d.close : 22) === c0);
    hoursSummary = (uniform ? hhLabel(o0) + "–" + hhLabel(c0) : "Varies") + (closedCount > 0 ? " · " + closedCount + " closed" : "");
  }
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
      {/* v14.4.0 / v15.0.0: Per-weekday opening-hours editor — Firebase-shared
          (settings/operatingHours). Each day sets its own booking window + timeline
          range, or is marked Closed. "copy → all" pushes one day's config to all 7.
          Displayed Mon→Sun; stored by JS weekday index (0=Sun). */}
      <Collapsible
        title="Opening hours"
        subtitle="Per day of the week. Shared across all devices. Sets the booking window and the timeline range."
        summary={hoursSummary}
      >
        {[[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]].map(function (entry) {
          const idx = entry[0], lbl = entry[1];
          return (
            <DayHoursRow key={idx} label={lbl} day={wh[idx]}
              onChange={(patch) => onSaveDayHours(idx, patch)}
              onCopyAll={() => onSaveAllDays(wh[idx])} />
          );
        })}
      </Collapsible>
      {/* v14.6.0: Shifts — on/off toggle + the Afternoon/Evening split hour for
          the day Summary. Firebase-shared (settings/dayShifts). */}
      <Section style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Shifts</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Split the day Summary into Afternoon / Evening. Shared across all devices.
            </div>
          </div>
          <Toggle on={se} onClick={() => onSaveShifts({ enabled: !se })} />
        </div>
        <Reveal show={se}>{se ? (
          <div style={{ marginTop: 14 }}>
            <HourStepper
              label="Afternoon / Evening split" value={sp}
              disableDec={sp <= wrMin + 1} disableInc={sp >= wrMax - 1}
              onDec={() => onSaveShifts({ split: sp - 1 })} onInc={() => onSaveShifts({ split: sp + 1 })}
            />
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginTop: 10 }}>
              Afternoon {hhLabel(wrMin)}–{hhLabel(sp)} · Evening {hhLabel(sp)}–{hhLabel(wrMax)}
            </div>
          </div>
        ) : null}</Reveal>
      </Section>
      {/* v15.0.0: Auto-optimizer — the master auto-switch + the editable daily
          cutoff hour. Firebase-shared (settings/optimizer). When the switch is
          off the optimizer is fully manual (no cutoff auto-off, no overnight
          auto-on); it then only changes via the timeline toggle or the "o" key. */}
      <Section style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Auto-optimizer</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Automatically stops reshuffling at a daily cutoff and resumes overnight. Shared across all devices.
            </div>
          </div>
          <Toggle on={oas} onClick={() => onSaveOptimizer({ autoSwitch: !oas })} />
        </div>
        <AutoHeight>{oas ? (
          <div style={{ marginTop: 14 }}>
            <HourStepper
              label="Daily cutoff" value={oc} fmt={cutoffLabel}
              disableDec={oc <= 0} disableInc={oc >= 24}
              onDec={() => onSaveOptimizer({ cutoff: oc - 1 })} onInc={() => onSaveOptimizer({ cutoff: oc + 1 })}
            />
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginTop: 10 }}>
              {cutoffNote}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginTop: 12 }}>
            Manual only — the optimizer changes only when you toggle it (timeline control or the “o” key).
          </div>
        )}</AutoHeight>
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
  weekHours,
  onSaveDayHours,
  onSaveAllDays,
  weekRange,
  splitHour,
  shiftsEnabled,
  onSaveShifts,
  optimizerCutoff,
  optimizerAutoSwitch,
  onSaveOptimizer,
  layout,
  onSaveLayout,
  bookings,
  reminders,
  onAddReminder,
  onEditReminder,
  onDeleteReminder,
  onToggleReminder
}) {
  let content;
  if (tab === "general") {
    content = <GeneralTabContent appVersion={appVersion} isDark={isDark} onToggleDark={onToggleDark} weekHours={weekHours} onSaveDayHours={onSaveDayHours} onSaveAllDays={onSaveAllDays} weekRange={weekRange} splitHour={splitHour} shiftsEnabled={shiftsEnabled} onSaveShifts={onSaveShifts} optimizerCutoff={optimizerCutoff} optimizerAutoSwitch={optimizerAutoSwitch} onSaveOptimizer={onSaveOptimizer} />;
  } else if (tab === "layout") {
    content = <LayoutTabContent layout={layout} onSaveLayout={onSaveLayout} bookings={bookings} />;
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
          { id: "layout",    label: "Layout" },
          { id: "reminders", label: "Reminders" },
          { id: "shortcuts", label: "Shortcuts" },
        ]}
        current={tab}
        onSelect={setTab}
      />
      {/* v15.8.0: tab body eases its height (AutoHeight) + crossfades on switch
          (key+mgt-fade-in) — the modal card follows the eased height. */}
      <AutoHeight>
        <div key={tab} className="mgt-fade-in">{content}</div>
      </AutoHeight>
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
