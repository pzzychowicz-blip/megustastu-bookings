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

import { useState, useEffect, useRef } from "react";
import { RemindersTabContent } from "./Reminders";
import { ShortcutsContent } from "./Shortcuts";
import { LayoutTabContent } from "./LayoutSettings";
import { CustomersTabContent } from "./CustomersSettings";
import { Toggle, Section, Collapsible, AutoHeight, Reveal, mkBtn, mkInp } from "./atoms";
import { BTN } from "../lib/constants";

// v16.3.0: weekday labels for the Standing-bookings rule rows (UTC getUTCDay order).
const RULE_WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── SETTINGS_TABS — the ONE tab list (v16.0.0 follow-up) ────────────────────
// v17.1.0: the list (and CogIcon) moved to SettingsChrome.jsx so App/ViewTools
// can import them WITHOUT pulling this whole (now lazy-loaded) module into the
// startup chunk. Re-exported here for back-compat; still exactly ONE list.
import { SETTINGS_TABS } from "./SettingsChrome";
export { SETTINGS_TABS, CogIcon } from "./SettingsChrome";

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
      border: "1px solid var(--border-soft)",
      // v16.2.0: on a narrow screen (iPhone 12 mini, 375px) the 5 tabs' combined
      // min-content width used to force the whole modal wider than the viewport
      // (content cut off on both edges). Making the tab row its own horizontal
      // scroller gives it min-width:0, so the modal collapses back to viewport
      // width and the tabs scroll independently instead. Buttons don't shrink
      // (flex-shrink 0) — they keep full-label width and overflow to scroll.
      overflowX: "auto",
      WebkitOverflowScrolling: "touch",
      scrollbarWidth: "none"
    }}>
      {tabs.map((t) => {
        const active = t.id === current;
        return (
          <button
            key={t.id}
            className="mgt-hover-scale"
            onClick={() => onSelect(t.id)}
            style={{
              flex: "1 0 0%",
              whiteSpace: "nowrap",
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

// v17.0.0: blur-commit text field for the Restaurant section (settings/general).
// Local draft while typing; commits on blur or Enter so every keystroke isn't a
// revGuard CAS write. The draft re-syncs when the committed value changes (a
// remote save from another device). mkInp returns a STYLE OBJECT (Bookings
// convention — no prop passthrough).
function GsTextField({ label, value, onCommit, width }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>{label}</div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{ ...mkInp(), width: width || 180, boxSizing: "border-box" }} />
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
function MiniStepper({ value, onDec, onInc, disableDec, disableInc, fmt }) {
  // v16.3.0: fmt is now optional (defaults to the HH:00 time format used by the
  // Opening-hours editor); the Standing-bookings horizon passes a plain number.
  const fmtFn = fmt || ((n) => String(((n % 24) + 24) % 24).padStart(2, "0") + ":00");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button onClick={onDec} disabled={disableDec} className={disableDec ? undefined : "mgt-hover-scale"}
        style={{ ...MINI_STEP_BTN, opacity: disableDec ? 0.4 : 1, cursor: disableDec ? "not-allowed" : "pointer" }}>−</button>
      <span style={{ minWidth: 46, textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{fmtFn(value)}</span>
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

export function GeneralTabContent({ appVersion, isDark, onToggleDark, appWidth = 1600, onSetAppWidth = () => {}, reduceMotion = false, onToggleReduceMotion = () => {}, planGestures = true, onTogglePlanGestures = () => {}, tlSettings = null, onSetTlSetting = () => {}, weekHours, onSaveDayHours = () => {}, onSaveAllDays = () => {}, weekRange, splitHour, shiftsEnabled, onSaveShifts = () => {}, optimizerCutoff, optimizerAutoSwitch, onSaveOptimizer = () => {}, bookingDefaults, onSaveBookingDefaults = () => {}, generalSettings, onSaveGeneralSettings = () => {}, onBackup, recurring, onSetRecurringEnabled = () => {}, onSetRecurringHorizon = () => {}, onUpdateRule = () => {}, onRemoveRule = () => {} }) {
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
  // v16.1.0: booking-defaults (duration tiers + running-late thresholds).
  // Defensive fallback mirrors the hook's DEFAULT_BOOKING_DEFAULTS seed.
  const bd = bookingDefaults && typeof bookingDefaults === "object"
    ? bookingDefaults
    : { tiers: [{ max: 1, dur: 90 }, { max: 4, dur: 90 }], restDur: 120, lateEnabled: true, lateWarnMin: 15, lateNoShowMin: 20, freeSoonEnabled: true };
  const tiers = Array.isArray(bd.tiers) ? bd.tiers : [];
  // v17.0.0: general settings (settings/general). Defensive fallback mirrors
  // the hook's DEFAULT_GENERAL_SETTINGS seed.
  const gs = generalSettings && typeof generalSettings === "object"
    ? generalSettings
    : { restaurantName: "Me Gustas Tú", currency: "€", phonePrefix: "+", regularMin: 2, lateCollapseMax: 2, waitMatchWin: 90, undoSecs: 10, defaultBookingSize: 2, defaultWalkinSize: 2 };
  // v17.2.0: per-device Timeline zoom/follow settings (App's tlSettings).
  const tl = tlSettings && typeof tlSettings === "object"
    ? tlSettings
    : { followZoom: 4, defaultZoom: 1, followLead: 30, maxZoom: 5 };
  const minsLabel = (n) => n + " min";
  const guestsLabel = (n) => "≤ " + n;
  // Tier-list edits: the hook's sanitizer re-sorts/dedupes/clamps, so these
  // just describe intent. Stepper bounds keep each `max` strictly between its
  // neighbours (1…19 at the edges), matching the sanitizer's invariants.
  // v16.1.1: armed two-tap confirm on the tier × — a mis-tap mid-service
  // shouldn't silently drop a duration tier. First tap arms the row ("Remove?");
  // a second tap within ARM_MS removes it. Auto-disarms on timeout, on any other
  // tier edit, or when a different row arms. (No booking data is at stake — tiers
  // only affect NEW bookings — so a light confirm, not a modal/undo.)
  const [armedTier, setArmedTier] = useState(null);
  const [armedRule, setArmedRule] = useState(null); // v16.3.0: armed delete for a standing-booking rule id
  const armTimer = useRef(null);
  const disarmTier = () => { if (armTimer.current) { clearTimeout(armTimer.current); armTimer.current = null; } setArmedTier(null); };
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);
  // armedTier is an INDEX, so if the tier count changes out from under us (a
  // concurrent remote bookingDefaults save on another device) the armed row would
  // shift — disarm on any count change so a second tap can't hit the wrong tier.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { disarmTier(); }, [tiers.length]);
  const saveTiers = (next) => onSaveBookingDefaults({ tiers: next });
  const updateTier = (i, patch) => { disarmTier(); saveTiers(tiers.map((t, j) => (j === i ? { ...t, ...patch } : t))); };
  const removeTier = (i) => saveTiers(tiers.filter((_, j) => j !== i));
  const armTierRemove = (i) => {
    if (armedTier === i) { disarmTier(); removeTier(i); return; }
    setArmedTier(i);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => { armTimer.current = null; setArmedTier(null); }, 3000);
  };
  const addTier = () => {
    disarmTier();
    const last = tiers[tiers.length - 1];
    const max = last ? last.max + 1 : 1;
    saveTiers(tiers.concat([{ max: max, dur: last ? last.dur : bd.restDur }]));
  };
  const canAddTier = tiers.length < 6 && (tiers.length === 0 || tiers[tiers.length - 1].max < 19);
  const restFrom = (tiers.length ? tiers[tiers.length - 1].max : 0) + 1;
  const durSummary = tiers.map((t) => t.dur).concat([bd.restDur]).join(" / ") + " min";
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
        {/* v17.0.0 correction: per-device max app width. The 1.08 hover lift
            overflowed the viewport when the fixed 1600 exceeded the screen —
            now tunable per device (localStorage, same contract as the theme). */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>App width</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Maximum content width on this device. Lower it if the app overflows your screen.
            </div>
          </div>
          <MiniStepper value={appWidth} fmt={(v) => v + " px"}
            disableDec={appWidth <= 900} disableInc={appWidth >= 2400}
            onDec={() => onSetAppWidth(appWidth - 50)} onInc={() => onSetAppWidth(appWidth + 50)} />
        </div>
        {/* v17.1.0: per-device animation kill-switch for weak tablets — applies
            the same instant-transitions rule as the OS reduced-motion setting
            (index.html; useFlip honors it in JS). localStorage, theme pattern. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Reduce animations</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Turns off transitions and wipes on this device. Helps on slower tablets.
            </div>
          </div>
          <Toggle on={reduceMotion} onClick={onToggleReduceMotion} />
        </div>
        {/* v17.1.2: per-device Plan-view gesture switch (localStorage, theme
            pattern) — gates wheel/pinch zoom, drag pan and double-tap reset. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Plan zoom &amp; pan</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Scroll/pinch to zoom, drag to pan and double-tap to reset in the Plan view, on this device.
            </div>
          </div>
          <Toggle on={planGestures} onClick={onTogglePlanGestures} />
        </div>
        {/* v17.2.0: per-device Timeline zoom/follow settings (localStorage,
            theme pattern — App's tlSettings/onSetTlSetting). Zoom values step
            0.5; the Follow/default zooms are capped by Max zoom (App clamps
            them down when Max zoom is lowered). */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ textAlign: "left", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Timeline zoom</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Zoom and Follow behaviour of the timeline, on this device.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", textAlign: "left" }}>Zoom when opening the app</div>
              <MiniStepper value={tl.defaultZoom} fmt={(v) => v + "×"}
                disableDec={tl.defaultZoom <= 1} disableInc={tl.defaultZoom >= tl.maxZoom}
                onDec={() => onSetTlSetting("defaultZoom", tl.defaultZoom - 0.5)}
                onInc={() => onSetTlSetting("defaultZoom", tl.defaultZoom + 0.5)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", textAlign: "left" }}>Zoom when Follow turns on</div>
              <MiniStepper value={tl.followZoom} fmt={(v) => v + "×"}
                disableDec={tl.followZoom <= 1} disableInc={tl.followZoom >= tl.maxZoom}
                onDec={() => onSetTlSetting("followZoom", tl.followZoom - 0.5)}
                onInc={() => onSetTlSetting("followZoom", tl.followZoom + 0.5)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", textAlign: "left" }}>Time shown behind the now-line</div>
              <MiniStepper value={tl.followLead} fmt={(v) => v + " min"}
                disableDec={tl.followLead <= 0} disableInc={tl.followLead >= 120}
                onDec={() => onSetTlSetting("followLead", tl.followLead - 15)}
                onInc={() => onSetTlSetting("followLead", tl.followLead + 15)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", textAlign: "left" }}>Maximum zoom (+ button)</div>
              <MiniStepper value={tl.maxZoom} fmt={(v) => v + "×"}
                disableDec={tl.maxZoom <= 2} disableInc={tl.maxZoom >= 10}
                onDec={() => onSetTlSetting("maxZoom", tl.maxZoom - 0.5)}
                onInc={() => onSetTlSetting("maxZoom", tl.maxZoom + 0.5)} />
            </div>
          </div>
        </div>
      </Section>
      {/* v17.0.0: Restaurant identity — name / currency / phone prefix.
          Firebase-shared (settings/general, the 6th settings node). Text
          fields commit on BLUR (or Enter) so every keystroke isn't a CAS
          write; the hook's sanitizer trims/caps and restores a default on
          an emptied field. */}
      <Collapsible
        title="Restaurant"
        subtitle="Name, currency and phone prefix. Shared across all devices."
        summary={gs.restaurantName}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
          <GsTextField label="Restaurant name" value={gs.restaurantName} width={260}
            onCommit={(v) => onSaveGeneralSettings({ restaurantName: v })} />
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <GsTextField label="Currency symbol" value={gs.currency} width={80}
              onCommit={(v) => onSaveGeneralSettings({ currency: v })} />
            <GsTextField label="Phone prefix" value={gs.phonePrefix} width={100}
              onCommit={(v) => onSaveGeneralSettings({ phonePrefix: v })} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
            The name shows in the header and on the printed day sheet; the currency on deposits; the prefix seeds the phone field on new bookings.
          </div>
        </div>
      </Collapsible>
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
      {/* v16.1.0: Default booking durations — three party-size tiers with
          EDITABLE band boundaries. Firebase-shared (settings/bookingDefaults).
          Only NEW bookings pick up a change; existing ones keep their stored
          duration. The hook's sanitizer enforces t1Max < t2Max; the steppers
          disable at the same bounds so an invalid value can't be set. */}
      <Collapsible
        title="Booking durations"
        subtitle="Default length of new bookings by party size. Shared across all devices."
        summary={durSummary}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
          {/* Editable tier list + the catch-all row. Fixed-width first column
              so every row's "stay for" stepper aligns vertically. */}
          {tiers.map((t, i) => {
            const minMax = i > 0 ? tiers[i - 1].max + 1 : 1;
            const maxMax = i < tiers.length - 1 ? tiers[i + 1].max - 1 : 19;
            return (
              <div key={i} style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ width: 150 }}>
                  <HourStepper label="Parties up to" value={t.max} fmt={guestsLabel}
                    disableDec={t.max <= minMax} disableInc={t.max >= maxMax}
                    onDec={() => updateTier(i, { max: t.max - 1 })} onInc={() => updateTier(i, { max: t.max + 1 })} />
                </div>
                <HourStepper label="stay for" value={t.dur} fmt={minsLabel}
                  disableDec={t.dur <= 15} disableInc={t.dur >= 360}
                  onDec={() => updateTier(i, { dur: t.dur - 15 })} onInc={() => updateTier(i, { dur: t.dur + 15 })} />
                <button
                  onClick={() => armTierRemove(i)}
                  className="mgt-hover-scale"
                  title={armedTier === i ? "Tap again to remove" : "Remove this tier"}
                  style={{ ...HOUR_STEP_BTN, height: 32, marginBottom: 3, ...(armedTier === i
                    ? { width: "auto", padding: "0 10px", fontSize: 12, fontWeight: 700, background: "var(--danger-bg)", color: "var(--danger-text)", border: "1px solid var(--danger-border)" }
                    : { width: 32, fontSize: 15, color: "var(--danger-text)" }) }}>{armedTier === i ? "Remove?" : "×"}</button>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ width: 150, height: 38, display: "flex", alignItems: "center", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
              {tiers.length ? "Larger parties (" + restFrom + "+)" : "All parties"}
            </div>
            <HourStepper label="stay for" value={bd.restDur} fmt={minsLabel}
              disableDec={bd.restDur <= 15} disableInc={bd.restDur >= 360}
              onDec={() => onSaveBookingDefaults({ restDur: bd.restDur - 15 })} onInc={() => onSaveBookingDefaults({ restDur: bd.restDur + 15 })} />
          </div>
          <div>
            <button
              onClick={addTier}
              disabled={!canAddTier}
              className={canAddTier ? "mgt-hover-scale" : undefined}
              style={{
                background: "var(--bg-stepper)", border: "1px solid var(--border-soft)", borderRadius: 10,
                padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "var(--accent)",
                cursor: canAddTier ? "pointer" : "not-allowed", opacity: canAddTier ? 1 : 0.4,
                boxShadow: "var(--shadow-input)"
              }}>+ Add tier</button>
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
            {tiers.map((t, i) => ((i > 0 ? tiers[i - 1].max + 1 : 1) === t.max ? String(t.max) : (i > 0 ? tiers[i - 1].max + 1 : 1) + "–" + t.max) + " guests → " + t.dur + " min").concat([restFrom + "+ → " + bd.restDur + " min"]).join(" · ") + ". Applies to new bookings only."}
          </div>
        </div>
      </Collapsible>
      {/* v16.1.0: Running late — amber highlight for a confirmed booking past
          its time, then a one-tap "No show" offer. Firebase-shared
          (settings/bookingDefaults, same node as the durations). */}
      <Section style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Running late</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Highlight confirmed bookings past their time and offer a one-tap no-show. Shared across all devices.
            </div>
          </div>
          <Toggle on={bd.lateEnabled} onClick={() => onSaveBookingDefaults({ lateEnabled: !bd.lateEnabled })} />
        </div>
        <AutoHeight>{bd.lateEnabled ? (
          <div style={{ marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap" }}>
            <HourStepper label="Highlight after" value={bd.lateWarnMin} fmt={minsLabel}
              disableDec={bd.lateWarnMin <= 5} disableInc={bd.lateWarnMin >= bd.lateNoShowMin - 5}
              onDec={() => onSaveBookingDefaults({ lateWarnMin: bd.lateWarnMin - 5 })} onInc={() => onSaveBookingDefaults({ lateWarnMin: bd.lateWarnMin + 5 })} />
            <HourStepper label="Offer no-show after" value={bd.lateNoShowMin} fmt={minsLabel}
              disableDec={bd.lateNoShowMin <= bd.lateWarnMin + 5} disableInc={bd.lateNoShowMin >= 120}
              onDec={() => onSaveBookingDefaults({ lateNoShowMin: bd.lateNoShowMin - 5 })} onInc={() => onSaveBookingDefaults({ lateNoShowMin: bd.lateNoShowMin + 5 })} />
          </div>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginTop: 12 }}>
            Off — late bookings are not highlighted.
          </div>
        )}</AutoHeight>
      </Section>
      {/* v17.0.0 round 7: Alert banners — master switches for the other in-flow
          banners, matching the Running-late toggle above (Patryk: every banner
          adjustable the same way). Firebase-shared (settings/bookingDefaults). */}
      <Section style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Overlap warnings</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Warn when an overstaying seated party runs into the next booking on its table, with a one-tap reassign. Shared across all devices.
            </div>
          </div>
          <Toggle on={bd.overlapWarnEnabled !== false} onClick={() => onSaveBookingDefaults({ overlapWarnEnabled: bd.overlapWarnEnabled === false })} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Reshuffle suggestions</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Suggest a table reshuffle when the day's layout could seat parties more efficiently. Shared across all devices.
            </div>
          </div>
          <Toggle on={bd.reshuffleSuggestEnabled !== false} onClick={() => onSaveBookingDefaults({ reshuffleSuggestEnabled: bd.reshuffleSuggestEnabled === false })} />
        </div>
      </Section>
      {/* v16.3.0: Table turns — predict which seated tables free up in the next
          ~15 min (Summary "freeing soon" line + timeline countdown pills).
          Firebase-shared (settings/bookingDefaults). */}
      <Section style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Table turns</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Show which seated tables are about to free up (a "freeing soon" line and a timeline countdown). Shared across all devices.
            </div>
          </div>
          <Toggle on={bd.freeSoonEnabled !== false} onClick={() => onSaveBookingDefaults({ freeSoonEnabled: bd.freeSoonEnabled === false })} />
        </div>
        {/* v16.3.0 correction: prediction window — how far ahead "freeing soon"
            looks. Revealed only while the feature is on. 5–60 min, 5-min steps. */}
        <AutoHeight>{bd.freeSoonEnabled !== false ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>Predict up to</span>
            <MiniStepper value={(bd.freeSoonWindow || 15)} fmt={(n) => n + " min"}
              disableDec={(bd.freeSoonWindow || 15) <= 5} disableInc={(bd.freeSoonWindow || 15) >= 60}
              onDec={() => onSaveBookingDefaults({ freeSoonWindow: (bd.freeSoonWindow || 15) - 5 })}
              onInc={() => onSaveBookingDefaults({ freeSoonWindow: (bd.freeSoonWindow || 15) + 5 })} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>ahead</span>
          </div>
        ) : null}</AutoHeight>
      </Section>
      {/* v16.3.0: Standing bookings — the recurring-rule manager. Rules are
          CREATED from the booking form ("Repeat weekly"); here staff pause /
          delete them and set the generation horizon. */}
      {recurring ? (
        <Section style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ textAlign: "left", flex: "1 1 200px" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Standing bookings</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
                Weekly repeat bookings, auto-created for the next few weeks. Create one with "Repeat weekly" on the booking form. Shared across all devices.
              </div>
            </div>
            <Toggle on={recurring.enabled !== false} onClick={() => onSetRecurringEnabled(recurring.enabled === false)} />
          </div>
          <AutoHeight>{recurring.enabled !== false ? (
            <div style={{ marginTop: 12 }}>
              {(recurring.rules || []).length === 0 ? (
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>No standing bookings yet.</div>
              ) : (recurring.rules || []).map(function (r) {
                const armed = armedRule === r.id;
                return (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", marginBottom: 6, borderRadius: 10, background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", opacity: r.active !== false ? 1 : 0.5 }}>{(r.name || "(no name)") + " · " + r.size + " pax"}</div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{"Every " + (RULE_WD[r.weekday] || "?") + " at " + r.time + (r.active === false ? " · paused" : "")}</div>
                    </div>
                    <Toggle on={r.active !== false} onClick={() => onUpdateRule(r.id, { active: r.active === false })} />
                    <button
                      onClick={() => { if (armed) { onRemoveRule(r.id); setArmedRule(null); } else setArmedRule(r.id); }}
                      className="mgt-hover-scale mgt-press"
                      style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 10px", background: BTN.del, opacity: armed ? 1 : 0.85 })}>{armed ? "Confirm?" : "Delete"}</button>
                  </div>
                );
              })}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>Generate ahead</span>
                <MiniStepper value={(recurring.horizonWeeks || 4)} fmt={(n) => String(n)}
                  disableDec={(recurring.horizonWeeks || 4) <= 1} disableInc={(recurring.horizonWeeks || 4) >= 12}
                  onDec={() => onSetRecurringHorizon((recurring.horizonWeeks || 4) - 1)} onInc={() => onSetRecurringHorizon((recurring.horizonWeeks || 4) + 1)} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>{"week" + ((recurring.horizonWeeks || 4) !== 1 ? "s" : "")}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8 }}>Deleting a rule leaves already-created future bookings in place — cancel those individually if needed.</div>
            </div>
          ) : (
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginTop: 12 }}>Off — no new standing bookings are generated.</div>
          )}</AutoHeight>
        </Section>
      ) : null}
      {/* v17.0.0: Preferences — the remaining ex-hard-coded knobs from the
          configurability pass. Firebase-shared (settings/general). */}
      <Collapsible
        title="Preferences"
        subtitle="Regulars threshold, banner collapse, waitlist match window, undo timing. Shared across all devices."
        summary={"Regular at " + gs.regularMin + "+"}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
          <HourStepper label="“Regular” from (completed visits)" value={gs.regularMin} fmt={(n) => String(n)}
            disableDec={gs.regularMin <= 1} disableInc={gs.regularMin >= 50}
            onDec={() => onSaveGeneralSettings({ regularMin: gs.regularMin - 1 })}
            onInc={() => onSaveGeneralSettings({ regularMin: gs.regularMin + 1 })} />
          {/* v17.1.0: one threshold for ALL three rows banners (late / overlap / waitlist). */}
          <HourStepper label="Collapse banners above" value={gs.lateCollapseMax} fmt={(n) => n + (n === 1 ? " row" : " rows")}
            disableDec={gs.lateCollapseMax <= 1} disableInc={gs.lateCollapseMax >= 20}
            onDec={() => onSaveGeneralSettings({ lateCollapseMax: gs.lateCollapseMax - 1 })}
            onInc={() => onSaveGeneralSettings({ lateCollapseMax: gs.lateCollapseMax + 1 })} />
          <HourStepper label="Waitlist match window (± wanted time)" value={gs.waitMatchWin} fmt={(n) => "±" + n + " min"}
            disableDec={gs.waitMatchWin <= 15} disableInc={gs.waitMatchWin >= 240}
            onDec={() => onSaveGeneralSettings({ waitMatchWin: gs.waitMatchWin - 15 })}
            onInc={() => onSaveGeneralSettings({ waitMatchWin: gs.waitMatchWin + 15 })} />
          <HourStepper label="Undo toast stays for" value={gs.undoSecs} fmt={(n) => n + " s"}
            disableDec={gs.undoSecs <= 5} disableInc={gs.undoSecs >= 60}
            onDec={() => onSaveGeneralSettings({ undoSecs: gs.undoSecs - 5 })}
            onInc={() => onSaveGeneralSettings({ undoSecs: gs.undoSecs + 5 })} />
          {/* v17.2.0: starting party sizes of the new-booking / walk-in forms
              (were hard-coded 2). Only the form's INITIAL value — steppers in
              the forms still adjust per booking. */}
          <HourStepper label="New booking starts at" value={gs.defaultBookingSize} fmt={(n) => n + (n === 1 ? " guest" : " guests")}
            disableDec={gs.defaultBookingSize <= 1} disableInc={gs.defaultBookingSize >= 20}
            onDec={() => onSaveGeneralSettings({ defaultBookingSize: gs.defaultBookingSize - 1 })}
            onInc={() => onSaveGeneralSettings({ defaultBookingSize: gs.defaultBookingSize + 1 })} />
          <HourStepper label="Walk-in starts at" value={gs.defaultWalkinSize} fmt={(n) => n + (n === 1 ? " guest" : " guests")}
            disableDec={gs.defaultWalkinSize <= 1} disableInc={gs.defaultWalkinSize >= 20}
            onDec={() => onSaveGeneralSettings({ defaultWalkinSize: gs.defaultWalkinSize - 1 })}
            onInc={() => onSaveGeneralSettings({ defaultWalkinSize: gs.defaultWalkinSize + 1 })} />
        </div>
      </Collapsible>
      {/* v16.3.0 correction: Backup lives at the BOTTOM of the General tab —
          download a JSON snapshot of every collection + all settings to this
          device (the Firebase free plan has no auto-backups). */}
      {onBackup ? (
        <Section style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ textAlign: "left", flex: "1 1 200px" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Backup</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
                Download a JSON copy of all bookings, waitlist, reminders and settings to this device. There are no automatic backups — save one periodically. Restoring is manual (keep the file safe).
              </div>
            </div>
            <button
              onClick={onBackup}
              className="mgt-hover-scale mgt-press"
              style={mkBtn({ fontSize: 13, minHeight: 40, padding: "8px 16px", background: BTN.nav })}>⬇ Download backup</button>
          </div>
        </Section>
      ) : null}
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
  appWidth,
  onSetAppWidth,
  reduceMotion,
  onToggleReduceMotion,
  planGestures,
  onTogglePlanGestures,
  tlSettings,
  onSetTlSetting,
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
  bookingDefaults,
  onSaveBookingDefaults,
  generalSettings,
  onSaveGeneralSettings,
  onBackup,
  recurring,
  onSetRecurringEnabled,
  onSetRecurringHorizon,
  onUpdateRule,
  onRemoveRule,
  layout,
  onSaveLayout,
  bookings,
  waitlist,
  onDeleteCustomer,
  reminders,
  onAddReminder,
  onEditReminder,
  onDeleteReminder,
  onToggleReminder
}) {
  let content;
  if (tab === "general") {
    content = <GeneralTabContent appVersion={appVersion} isDark={isDark} onToggleDark={onToggleDark} appWidth={appWidth} onSetAppWidth={onSetAppWidth} reduceMotion={reduceMotion} onToggleReduceMotion={onToggleReduceMotion} planGestures={planGestures} onTogglePlanGestures={onTogglePlanGestures} tlSettings={tlSettings} onSetTlSetting={onSetTlSetting} weekHours={weekHours} onSaveDayHours={onSaveDayHours} onSaveAllDays={onSaveAllDays} weekRange={weekRange} splitHour={splitHour} shiftsEnabled={shiftsEnabled} onSaveShifts={onSaveShifts} optimizerCutoff={optimizerCutoff} optimizerAutoSwitch={optimizerAutoSwitch} onSaveOptimizer={onSaveOptimizer} bookingDefaults={bookingDefaults} onSaveBookingDefaults={onSaveBookingDefaults} generalSettings={generalSettings} onSaveGeneralSettings={onSaveGeneralSettings} onBackup={onBackup} recurring={recurring} onSetRecurringEnabled={onSetRecurringEnabled} onSetRecurringHorizon={onSetRecurringHorizon} onUpdateRule={onUpdateRule} onRemoveRule={onRemoveRule} />;
  } else if (tab === "layout") {
    content = <LayoutTabContent layout={layout} onSaveLayout={onSaveLayout} bookings={bookings} />;
  } else if (tab === "customers") {
    // v16.0.0: customer management (phone-derived index; delete-all-data).
    content = <CustomersTabContent bookings={bookings} waitlist={waitlist} onDeleteCustomer={onDeleteCustomer} regularMinDefault={generalSettings ? generalSettings.regularMin : 2} />;
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
        tabs={SETTINGS_TABS}
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

// CogIcon moved to SettingsChrome.jsx (v17.1.0 — see the re-export above).
