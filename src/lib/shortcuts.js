// src/lib/shortcuts.js
//
// v18.4.4 (ROADMAP #15) — the letter, symbol and arrow shortcuts as a TABLE.
//
// They were one keydown handler in `hooks/useKeyboardShortcuts.js`: about
// seventy `if`s read top to bottom, where the position of a branch was its
// precedence and nothing could run it without a window. Escape and Enter became
// tables in v17.14.0 (`escapeAction`, `MODAL_ENTER_ORDER`, still in the hook);
// this is the rest.
//
// `resolveShortcut(ev, K, env)` is PURE: it reads the hook's context `K` and
// decides. It returns
//   · null                      the key is not ours, or is swallowed untouched
//   · { prevent, act }          `prevent` → the hook calls preventDefault();
//                               `act` → a function the hook calls with K, or
//                               null when the key is taken and does nothing
// so the only two things the old handler could do — prevent the default and
// call something on K — are the two fields, and a test can ask for both.
//
// ── How the table is read ────────────────────────────────────────────────────
// LAYERS, in order — the old handler's sections, top to bottom. For each:
//   · `stop(K)` true      → nothing below this point runs (the "a modal is
//                           open" wall between the form's keys and the rest)
//   · `active(K)` false   → the layer is skipped
//   · rows, in order: the first whose key (and `shift`, and `when`) matches
//     DECIDES. Its `run` answers, and a null answer still ends the lookup —
//     that is the old `return` after a branch that matched and did nothing.
//     A row whose `when` is false is simply not there, and the key falls on.
//   · `terminal`          → no row matched, and the key still goes no further
//                           (the preferred-table picker swallows every letter)
//
// A key is matched case-insensitively when it is one character ("d" is D and
// d), and exactly otherwise ("ArrowLeft"). `shift: true` REQUIRES Shift; a row
// without it does not look at Shift at all, so order is what puts Shift+C
// (cancel) ahead of C (complete).
//
// ── What moved, and what did not ─────────────────────────────────────────────
// Behaviour is unchanged: the old handler and this table were run side by side
// over random keys and states before the old one was deleted (REFACTOR_LOG,
// v18.4.4). The reads stay `K.<name>`, because `tests/modal-stack.test.js`
// checks every name read off K against the object App passes in, and it reads
// this file now as well as the hook.
//
// `env` is what is not App's: `sandbox` (the WA_SANDBOX build constant),
// `today` (the wall clock's date, asked once per key) and `settingsTabs`, a
// function giving the visible Settings tab ids — the hook supplies it from
// `visibleTabs`, which lives in a component file this module must not import.

import { VIEW_ORDER } from "./constants";
import { stepDate } from "./day";
import { seatingClosed } from "./booking-logic";

// v14.6.0: "S" toggles the Summary panel. In List view with a booking focused,
// S marks it Seated instead — that row is in an earlier layer. Rebind here and
// in the Shortcuts tab's row.
export const SUMMARY_KEY = "s";
// v14.7.0 / v14.9.0: "M" opens the Week / Month popover ("More"). Its own keys
// (W/M, ←/→, ↑/↓, T, Enter) live in WeekView.
export const WEEK_KEY = "m";

// `prevent` with an action, `prevent` alone, and neither.
const hit = (act) => ({ prevent: true, act });
const TAKEN = { prevent: true, act: null };
const SWALLOW = null;

const editing = (K) => (K.editId ? K.bookings.find((b) => b.id === K.editId) : undefined);
const selected = (K) => {
  const list = K.listDay || [];
  return K.selectedListId ? list.find((b) => b.id === K.selectedListId) : null;
};
const isToday = (K, env) => K.viewDate === env.today;

// T / L / P. App's `pickView` (K.goView) is the one place that knows the split
// rules; the fallback keeps the single-view behaviour if the ctx ever lacks it.
const goView = (v) => hit((K) => {
  if (K.goView) { K.goView(v); return; }
  if (K.view !== v) K.bumpSlide(VIEW_ORDER.indexOf(v) > VIEW_ORDER.indexOf(K.view) ? "mgt-view-in-right" : "mgt-view-in-left");
  K.setView(v);
});

// C in the booking form: clear the tables. Mirrors the form's three Clear
// buttons — hand-picked tables first; else, when editing a booking somebody
// placed and not yet marked cleared, mark it. Otherwise the key does nothing,
// and still goes no further.
function clearFormTables(K) {
  const picked = Array.isArray(K.form && K.form.manualTables) ? K.form.manualTables.length : 0;
  if (picked > 0) {
    return hit((K2) => {
      K2.setForm((f) => Object.assign({}, f, { manualTables: [] }));
      K2.setSwapAffected(null);
    });
  }
  if (!K.editId) return SWALLOW;
  const cur = editing(K);
  const placed = cur && (cur._manual || cur._locked) && cur.tables && cur.tables.length > 0;
  if (!placed || (K.form && K.form._clearManual)) return SWALLOW;
  return hit((K2) => {
    K2.setForm((f) => Object.assign({}, f, { manualTables: [], _clearManual: true }));
    K2.setSwapAffected(null);
  });
}

export const SHORTCUT_LAYERS = [
  // ── Global, even over a modal (v16.4.0): they never close what is open ──────
  // Shift +/− is matched on every key value the physical keys give under Shift
  // across layouts: US "+", ES/DE "*", and "_" everywhere.
  { name: "always", rows: [
    { keys: ["d"], shift: true, run: () => hit((K) => K.onToggleDark()) },
    { keys: ["+", "=", "*"], shift: true, run: () => hit((K) => K.onSetAppWidth(K.appWidth + 50)) },
    { keys: ["_", "-"], shift: true, run: () => hit((K) => K.onSetAppWidth(K.appWidth - 50)) },
    { keys: ["?"], run: () => hit((K) => K.setShowSettings(true)) },
  ] },

  // ── Settings is the TOP layer: ←/→ cycle its tabs, N adds a reminder ────────
  // The cycle runs over the VISIBLE tabs (capability and module gates), or an
  // arrow lands on a tab the render side refuses to show.
  { name: "settings", active: (K) => K.topModalId === "settings", rows: [
    { keys: ["ArrowLeft", "ArrowRight"], run: (K, ev, env) => {
      const tabs = env.settingsTabs();
      let cur = tabs.indexOf(K.settingsTab); if (cur < 0) cur = 0;
      const next = ev.key === "ArrowLeft" ? (cur - 1 + tabs.length) % tabs.length : (cur + 1) % tabs.length;
      return hit((K2) => K2.setSettingsTab(tabs[next]));
    } },
    { keys: ["n"], when: (K) => K.settingsTab === "reminders", run: () => hit((K) => K.openNewReminder()) },
  ] },

  // ── The preferred-table picker: C clears, and no other letter gets past ─────
  { name: "prefpicker", active: (K) => !!K.showPrefPicker, terminal: true, rows: [
    { keys: ["c"], run: (K) => {
      const prefs = Array.isArray(K.form && K.form.preferredTables) ? K.form.preferredTables : [];
      if (prefs.length === 0) return SWALLOW;
      return hit((K2) => K2.setForm((f) => Object.assign({}, f, { preferredTables: [] })));
    } },
  ] },

  // ── The booking form is the TOP layer ───────────────────────────────────────
  // A / P / C in new and edit; B (book again) and H (history) only when editing.
  { name: "form", active: (K) => K.topModalId === "form", rows: [
    { keys: ["a"], run: () => hit((K) => K.setManualTarget(K.editId || "__new__")) },
    { keys: ["p"], run: () => hit((K) => K.setShowPrefPicker(true)) },
    { keys: ["c"], run: clearFormTables },
    { keys: ["b"], when: (K) => !!K.editId, run: (K) => {
      const cur = editing(K);
      if (!cur || (cur.status !== "seated" && cur.status !== "completed")) return SWALLOW;
      return hit((K2) => K2.bookAgain(cur));
    } },
    { keys: ["h"], when: (K) => !!K.editId, run: (K) => {
      const cur = editing(K);
      if (!cur || !cur.history || cur.history.length === 0) return SWALLOW;
      return hit((K2) => K2.setShowHistory(true));
    } },
  ] },

  // ── Everything below is suppressed while ANY modal is open ──────────────────
  { name: "search", stop: (K) => !!K.anyModal, rows: [
    { keys: ["/"], run: () => hit((K) => K.setShowSearch(true)) },
  ] },

  // ── List view: ↑/↓ move the focus ring, the letters act on the focused card ─
  // Ahead of the global letters, so D deletes only while a card is focused and
  // S seats it rather than toggling the Summary.
  { name: "list", active: (K) => K.view === "list", rows: [
    { keys: ["ArrowDown", "ArrowUp"], run: (K, ev) => {
      const list = K.listDay || [];
      if (!list.length) return TAKEN;
      const down = ev.key === "ArrowDown";
      const idx = list.findIndex((b) => b.id === K.selectedListId);
      const ni = idx < 0 ? (down ? 0 : list.length - 1) : (down ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1));
      const id = list[ni].id;
      return hit((K2) => { K2.setSelectedListId(id); K2.bumpListFocus(); });
    } },
    { keys: ["a"], when: (K) => !!selected(K), run: (K) => { const sel = selected(K); return hit((K2) => K2.setManualTarget(sel.id)); } },
    { keys: ["e"], when: (K) => !!selected(K), run: (K) => { const sel = selected(K); return hit((K2) => K2.openEdit(sel)); } },
    // A PENDING card can only be confirmed or cancelled, so S and C do nothing
    // on it; and S does nothing on a day whose close has passed, where the
    // auto-complete would flip the booking straight back (`seatingClosed`, the
    // predicate the popup, the List card and the edit form ask).
    { keys: ["s"], when: (K) => !!selected(K), run: (K) => {
      const sel = selected(K);
      if (sel.status === "pending" || seatingClosed(sel.date, K.today, K.nowMins)) return TAKEN;
      return hit((K2) => K2.updateStatus(sel.id, "seated"));
    } },
    { keys: ["c"], shift: true, when: (K) => !!selected(K), run: (K) => { const sel = selected(K); return hit((K2) => K2.updateStatus(sel.id, "cancelled")); } },
    { keys: ["c"], when: (K) => !!selected(K), run: (K) => {
      const sel = selected(K);
      if (sel.status === "pending") return TAKEN;
      return hit((K2) => K2.updateStatus(sel.id, "completed"));
    } },
    // Through App's `requestDelete`, which carries the bookingDelete gate.
    { keys: ["d"], when: (K) => !!selected(K), run: (K) => { const sel = selected(K); return hit((K2) => K2.requestDelete(sel.id)); } },
  ] },

  // ── Global ─────────────────────────────────────────────────────────────────
  { name: "global", rows: [
    { keys: ["t"], run: () => goView("timeline") },
    { keys: ["l"], run: () => goView("list") },
    { keys: ["p"], run: () => goView("plan") },
    { keys: ["d"], run: (K, ev, env) => hit((K2) => K2.goToDate(env.today)) },
    { keys: ["n"], run: () => hit((K) => K.openNew()) },
    { keys: ["w"], run: () => hit((K) => K.openWalkin()) },
    // I opens the WhatsApp inbox: gated on the MODULE, like the toolbar button.
    { keys: ["i"], when: (K) => !!(K.hasModule && K.hasModule("whatsapp")), run: () => hit((K) => K.setShowInbox(true)) },
    // X opens the simulator: sandbox builds only.
    { keys: ["x"], when: (K, ev, env) => !!env.sandbox, run: () => hit((K) => K.setShowSim(true)) },
    { keys: [SUMMARY_KEY], run: () => hit((K) => K.setSummaryOpen((o) => !o)) },
    { keys: [WEEK_KEY], run: () => hit((K) => K.setShowWeek(true)) },
    { keys: ["ArrowLeft"], run: () => hit((K) => K.goToDate(stepDate(K.viewDate, -1))) },
    { keys: ["ArrowRight"], run: () => hit((K) => K.goToDate(stepDate(K.viewDate, 1))) },
  ] },

  // ── Timeline only ──────────────────────────────────────────────────────────
  // F, O and R act on TODAY only, and take the key either way.
  { name: "timeline", active: (K) => K.view === "timeline", rows: [
    { keys: ["f"], run: (K, ev, env) => {
      if (!isToday(K, env)) return SWALLOW;
      return hit((K2) => {
        if (!K2.followNow) { K2.setFollowNow(true); if (K2.timelineZoom < K2.tlFollowZoom) K2.setTimelineZoom(K2.tlFollowZoom); }
        else K2.setFollowNow(false);
      });
    } },
    { keys: ["+", "="], run: () => hit((K) => K.setTimelineZoom((z) => Math.min(K.tlMaxZoom, z + 0.5))) },
    { keys: ["-"], run: () => hit((K) => K.setTimelineZoom((z) => Math.max(1, z - 0.5))) },
    { keys: ["0"], run: () => hit((K) => { K.setTimelineZoom(1); K.setFollowNow(false); }) },
    { keys: ["o"], run: (K, ev, env) => (isToday(K, env) ? hit((K2) => K2.setAutoOptimizer((p) => !p)) : SWALLOW) },
    { keys: ["r"], run: (K, ev, env) => (isToday(K, env) && !K.autoOptimizer ? hit((K2) => K2.setConfirmReshuffle(true)) : SWALLOW) },
  ] },
];

function keyOf(ev) {
  const k = ev.key;
  return typeof k === "string" && k.length === 1 ? k.toLowerCase() : k;
}

// ev: { key, shiftKey }. See the header for K, env and the answer.
export function resolveShortcut(ev, K, env) {
  const key = keyOf(ev);
  for (let i = 0; i < SHORTCUT_LAYERS.length; i++) {
    const layer = SHORTCUT_LAYERS[i];
    if (layer.stop && layer.stop(K)) return null;
    if (layer.active && !layer.active(K)) continue;
    for (let j = 0; j < layer.rows.length; j++) {
      const row = layer.rows[j];
      if (!row.keys.includes(key)) continue;
      if (row.shift && !ev.shiftKey) continue;
      if (row.when && !row.when(K, ev, env)) continue;
      return row.run(K, ev, env);
    }
    if (layer.terminal) return null;
  }
  return null;
}
