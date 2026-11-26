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
import { seatingClosed, reshuffleOffer, bookAgainOffered } from "./booking-logic";

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

// ── Gates (v18.4.5) ──────────────────────────────────────────────────────────
// A row that works only where something is switched on names the gate, and the
// SAME tag decides whether the Shortcuts tab lists it (`shortcutShown` there
// asks the same two questions of Settings' props). One tag, so a key cannot be
// listed where it does nothing.
export const SHORTCUT_GATES = {
  whatsapp: (K) => !!(K.hasModule && K.hasModule("whatsapp")),
  sandbox: (K, env) => !!(env && env.sandbox),
};

export const SHORTCUT_LAYERS = [
  // ── Global, even over a modal (v16.4.0): they never close what is open ──────
  // Shift +/− is matched on every key value the physical keys give under Shift
  // across layouts: US "+", ES/DE "*", and "_" everywhere.
  { name: "always", rows: [
    { id: "darkMode", keys: ["d"], shift: true, caps: ["⇧D"], label: "Toggle dark / light mode", run: () => hit((K) => K.onToggleDark()) },
    { id: "widthUp", keys: ["+", "=", "*"], shift: true, caps: ["⇧+"], label: "Adjust app width (±50 px)", run: () => hit((K) => K.onSetAppWidth(K.appWidth + 50)) },
    { id: "widthDown", keys: ["_", "-"], shift: true, caps: ["⇧−"], label: "Adjust app width (±50 px)", run: () => hit((K) => K.onSetAppWidth(K.appWidth - 50)) },
    { id: "help", keys: ["?"], caps: ["?"], label: "Show this help", run: () => hit((K) => K.setShowSettings(true)) },
  ] },

  // ── Settings is the TOP layer: ←/→ cycle its tabs, N adds a reminder ────────
  // The cycle runs over the VISIBLE tabs (capability and module gates), or an
  // arrow lands on a tab the render side refuses to show.
  { name: "settings", active: (K) => K.topModalId === "settings", rows: [
    { id: "settingsTabs", keys: ["ArrowLeft", "ArrowRight"], caps: ["←", "→"], label: "Switch between tabs", run: (K, ev, env) => {
      const tabs = env.settingsTabs();
      let cur = tabs.indexOf(K.settingsTab); if (cur < 0) cur = 0;
      const next = ev.key === "ArrowLeft" ? (cur - 1 + tabs.length) % tabs.length : (cur + 1) % tabs.length;
      return hit((K2) => K2.setSettingsTab(tabs[next]));
    } },
    { id: "newReminder", keys: ["n"], caps: ["N"], label: "New reminder (Reminders tab)", when: (K) => K.settingsTab === "reminders", run: () => hit((K) => K.openNewReminder()) },
  ] },

  // ── The preferred-table picker: C clears, and no other letter gets past ─────
  { name: "prefpicker", active: (K) => !!K.showPrefPicker, terminal: true, rows: [
    { id: "clearPreferred", keys: ["c"], caps: ["C"], label: "Clear preferred tables", run: (K) => {
      const prefs = Array.isArray(K.form && K.form.preferredTables) ? K.form.preferredTables : [];
      if (prefs.length === 0) return SWALLOW;
      return hit((K2) => K2.setForm((f) => Object.assign({}, f, { preferredTables: [] })));
    } },
  ] },

  // ── The booking form is the TOP layer ───────────────────────────────────────
  // A / P / C in new and edit; B (book again) and H (history) only when editing.
  { name: "form", active: (K) => K.topModalId === "form", rows: [
    { id: "formAssign", keys: ["a"], caps: ["A"], label: "Manual table assignment", run: () => hit((K) => K.setManualTarget(K.editId || "__new__")) },
    { id: "formPreferred", keys: ["p"], caps: ["P"], label: "Preferred tables", run: () => hit((K) => K.setShowPrefPicker(true)) },
    { id: "formClear", keys: ["c"], caps: ["C"], label: "Clear tables assignment", run: clearFormTables },
    { id: "bookAgain", keys: ["b"], caps: ["B"], label: "Book Again (edit only, seated / completed)", when: (K) => !!K.editId, run: (K) => {
      const cur = editing(K);
      if (!bookAgainOffered(cur)) return SWALLOW;
      return hit((K2) => K2.bookAgain(cur));
    } },
    { id: "history", keys: ["h"], caps: ["H"], label: "View history (edit only)", when: (K) => !!K.editId, run: (K) => {
      const cur = editing(K);
      if (!cur || !cur.history || cur.history.length === 0) return SWALLOW;
      return hit((K2) => K2.setShowHistory(true));
    } },
  ] },

  // ── Everything below is suppressed while ANY modal is open ──────────────────
  { name: "search", stop: (K) => !!K.anyModal, rows: [
    { id: "find", keys: ["/"], caps: ["/"], label: "Find a booking (any date)", run: () => hit((K) => K.setShowSearch(true)) },
  ] },

  // ── List view: ↑/↓ move the focus ring, the letters act on the focused card ─
  // Ahead of the global letters, so D deletes only while a card is focused and
  // S seats it rather than toggling the Summary.
  { name: "list", active: (K) => K.view === "list", rows: [
    { id: "listMove", keys: ["ArrowDown", "ArrowUp"], caps: ["↑", "↓"], label: "Select previous / next booking", run: (K, ev) => {
      const list = K.listDay || [];
      if (!list.length) return TAKEN;
      const down = ev.key === "ArrowDown";
      const idx = list.findIndex((b) => b.id === K.selectedListId);
      const ni = idx < 0 ? (down ? 0 : list.length - 1) : (down ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1));
      const id = list[ni].id;
      return hit((K2) => { K2.setSelectedListId(id); K2.bumpListFocus(); });
    } },
    { id: "listAssign", keys: ["a"], caps: ["A"], label: "Assign tables", when: (K) => !!selected(K), run: (K) => { const sel = selected(K); return hit((K2) => K2.setManualTarget(sel.id)); } },
    { id: "listEdit", keys: ["e"], caps: ["E"], label: "Edit booking", when: (K) => !!selected(K), run: (K) => { const sel = selected(K); return hit((K2) => K2.openEdit(sel)); } },
    // A PENDING card can only be confirmed or cancelled, so S and C do nothing
    // on it; and S does nothing on a day whose close has passed, where the
    // auto-complete would flip the booking straight back (`seatingClosed`, the
    // predicate the popup, the List card and the edit form ask).
    { id: "listSeat", keys: ["s"], caps: ["S"], label: "Mark seated", when: (K) => !!selected(K), run: (K) => {
      const sel = selected(K);
      if (sel.status === "pending" || seatingClosed(sel.date, K.today, K.nowMins)) return TAKEN;
      return hit((K2) => K2.updateStatus(sel.id, "seated"));
    } },
    // v18.4.5: C before ⇧C, the order the Shortcuts tab lists them in (the tab
    // is drawn from these rows). The first matching row decides, so the plain
    // row says "no Shift" itself where it used to rely on ⇧C standing above it.
    { id: "listComplete", keys: ["c"], caps: ["C"], label: "Mark completed", when: (K, ev) => !ev.shiftKey && !!selected(K), run: (K) => {
      const sel = selected(K);
      if (sel.status === "pending") return TAKEN;
      return hit((K2) => K2.updateStatus(sel.id, "completed"));
    } },
    { id: "listCancel", keys: ["c"], shift: true, caps: ["⇧C"], label: "Cancel booking", when: (K) => !!selected(K), run: (K) => { const sel = selected(K); return hit((K2) => K2.updateStatus(sel.id, "cancelled")); } },
    // v18.19.0: B books the selected guest again (a seated or completed card,
    // `bookAgainOffered`, the answer every Book again door asks); on any other
    // card the key is taken and does nothing, as S is on a pending one.
    { id: "listBookAgain", keys: ["b"], caps: ["B"], label: "Book again (seated / completed)", when: (K) => !!selected(K), run: (K) => {
      const sel = selected(K);
      if (!bookAgainOffered(sel)) return TAKEN;
      return hit((K2) => K2.bookAgain(sel));
    } },
    // Through App's `requestDelete`, which carries the bookingDelete gate.
    { id: "listDelete", keys: ["d"], caps: ["D"], label: "Delete booking", when: (K) => !!selected(K), run: (K) => { const sel = selected(K); return hit((K2) => K2.requestDelete(sel.id)); } },
  ] },

  // ── Global ─────────────────────────────────────────────────────────────────
  { name: "global", rows: [
    { id: "viewTimeline", keys: ["t"], caps: ["T"], label: "Timeline view", run: () => goView("timeline") },
    { id: "viewList", keys: ["l"], caps: ["L"], label: "List view", run: () => goView("list") },
    { id: "viewPlan", keys: ["p"], caps: ["P"], label: "Plan (floor) view", run: () => goView("plan") },
    { id: "today", keys: ["d"], caps: ["D"], label: "Jump to today", run: (K, ev, env) => hit((K2) => K2.goToDate(env.today)) },
    { id: "prevDay", keys: ["ArrowLeft"], caps: ["←"], label: "Previous / next day", run: () => hit((K) => K.goToDate(stepDate(K.viewDate, -1))) },
    { id: "nextDay", keys: ["ArrowRight"], caps: ["→"], label: "Previous / next day", run: () => hit((K) => K.goToDate(stepDate(K.viewDate, 1))) },
    // v18.16.0: with a Timeline block focused, N books on that table right after
    // that booking (`K.openNewAfter`, which opens the plain form when the day has
    // no such time left). Above the plain N, which is what the key is everywhere
    // else. `env.focusedBlock` is the hook's reading of the DOM.
    { id: "newAfter", keys: ["n"], caps: ["N"], label: "New booking after the focused one (Timeline)", when: (K, ev, env) => K.view === "timeline" && !!env.focusedBlock, run: (K, ev, env) => hit((K2) => K2.openNewAfter(env.focusedBlock.id, env.focusedBlock.tableId)) },
    { id: "newBooking", keys: ["n"], caps: ["N"], label: "New booking", run: () => hit((K) => K.openNew()) },
    // v18.19.0: with a Timeline block focused, B books that guest again (seated or
    // completed, `bookAgainOffered`). Taken and ignored on any other block, so it
    // never falls through to a global B.
    { id: "bookAgainFocused", keys: ["b"], caps: ["B"], label: "Book again: the focused booking (Timeline, seated / completed)", when: (K, ev, env) => K.view === "timeline" && !!env.focusedBlock, run: (K, ev, env) => {
      const b = (K.bookings || []).find((x) => x.id === env.focusedBlock.id);
      if (!bookAgainOffered(b)) return TAKEN;
      return hit((K2) => K2.bookAgain(b));
    } },
    { id: "walkin", keys: ["w"], caps: ["W"], label: "Walk-in", run: () => hit((K) => K.openWalkin()) },
    { id: "summary", keys: [SUMMARY_KEY], caps: ["S"], label: "Toggle Summary panel", run: () => hit((K) => K.setSummaryOpen((o) => !o)) },
    { id: "more", keys: [WEEK_KEY], caps: ["M"], label: "Open More (Week / Month)", run: () => hit((K) => K.setShowWeek(true)) },
    // I opens the WhatsApp inbox: gated on the MODULE, like the toolbar button.
    { id: "inbox", keys: ["i"], caps: ["I"], label: "Open WhatsApp inbox", gate: "whatsapp", run: () => hit((K) => K.setShowInbox(true)) },
    // X opens the simulator: sandbox builds only.
    { id: "simulator", keys: ["x"], caps: ["X"], label: "Open WhatsApp simulator", gate: "sandbox", run: () => hit((K) => K.setShowSim(true)) },
  ] },

  // ── Timeline only ──────────────────────────────────────────────────────────
  // F and O act on TODAY only. R acts on the Reshuffle button's days, today and
  // every later one (v18.18.0 commit 16), by asking the button's own rule,
  // `reshuffleOffer`, so the key and the button cannot disagree. All three take
  // the key either way.
  { name: "timeline", active: (K) => K.view === "timeline", rows: [
    { id: "follow", keys: ["f"], caps: ["F"], label: "Toggle Follow (today only)", run: (K, ev, env) => {
      if (!isToday(K, env)) return SWALLOW;
      return hit((K2) => {
        if (!K2.followNow) { K2.setFollowNow(true); if (K2.timelineZoom < K2.tlFollowZoom) K2.setTimelineZoom(K2.tlFollowZoom); }
        else K2.setFollowNow(false);
      });
    } },
    { id: "zoomIn", keys: ["+", "="], caps: ["="], label: "Zoom in (unshifted — ⇧+ is app width)", run: () => hit((K) => K.setTimelineZoom((z) => Math.min(K.tlMaxZoom, z + 0.5))) },
    { id: "zoomOut", keys: ["-"], caps: ["−"], label: "Zoom out", run: () => hit((K) => K.setTimelineZoom((z) => Math.max(1, z - 0.5))) },
    { id: "zoomReset", keys: ["0"], caps: ["0"], label: "Reset zoom to 1×", run: () => hit((K) => { K.setTimelineZoom(1); K.setFollowNow(false); }) },
    { id: "optimiser", keys: ["o"], caps: ["O"], label: "Toggle Optimiser (today)", run: (K, ev, env) => (isToday(K, env) ? hit((K2) => K2.setAutoOptimizer((p) => !p)) : SWALLOW) },
    // v18.18.0 commit 15: through App's `openReshuffle`, the one door, which
    // asks Move tables before the confirm opens. Commit 16: wherever the button
    // shows, whatever the Optimiser switch says.
    { id: "reshuffle", keys: ["r"], caps: ["R"], label: "Reshuffle (today and later days)", run: (K, ev, env) => (reshuffleOffer({ viewDate: K.viewDate, today: env.today, autoOptimizer: K.autoOptimizer }) ? hit((K2) => K2.openReshuffle()) : SWALLOW) },
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
      if (row.gate && !SHORTCUT_GATES[row.gate](K, env)) continue;
      if (row.when && !row.when(K, ev, env)) continue;
      return row.run(K, ev, env);
    }
    if (layer.terminal) return null;
  }
  return null;
}

// ── What the Shortcuts tab lists (v18.4.5) ───────────────────────────────────
// Settings → Shortcuts draws these sections from the rows above: each row's
// `caps` (the keycaps as printed) and `label`. It was a second list, typed by
// hand in Shortcuts.jsx, held to this one by nothing but the I and X gates.
// A section is one or more layers, in the order given; rows of a section that
// share a label and a gate are one line with their caps side by side (← and → are two
// rows here and one line there). Every row has a label and every layer is in
// exactly one section: tests/shortcuts.test.js fails otherwise, so a new key
// cannot be left off the tab.
const DOC_SECTIONS = [
  { title: "Navigation", layers: ["global", "search", "always"] },
  { title: "Timeline", layers: ["timeline"] },
  { title: "List view", layers: ["list"] },
  { title: "Edit / New Booking", layers: ["form"] },
  { title: "Preferred Table picker", layers: ["prefpicker"] },
  { title: "Settings", layers: ["settings"] },
];

// Rows → the tab's lines: rows that share a label AND a gate are one line with
// their caps side by side. A gated key must not join an ungated line, or it is
// listed where it does nothing.
function docRows(rows, out = []) {
  rows.forEach((row) => {
    const line = out.find((r) => r.label === row.label && r.when === row.gate);
    if (line) { line.keys = line.keys.concat(row.caps); return; }
    const doc = { keys: row.caps.slice(), label: row.label };
    if (row.gate) doc.when = row.gate;
    out.push(doc);
  });
  return out;
}

// → [{ title, rows: [{ keys, label, when? }] }], `when` being the row's gate.
export function shortcutDocs() {
  return DOC_SECTIONS.map((sec) => {
    const rows = [];
    sec.layers.forEach((name) => docRows(SHORTCUT_LAYERS.find((l) => l.name === name).rows, rows));
    return { title: sec.title, layers: sec.layers, rows };
  });
}

// ── The keys handled OUTSIDE this table (v18.18.0) ──────────────────────────
// The inbox and the More popover have their own key handlers, the table picker
// its own, and Escape / Enter are the hook's two modal tables. Their keys were
// written in Shortcuts.jsx; they are data here so a control's hover description
// and the Shortcuts tab read ONE list (`keyHint`). Each row is shaped like a
// table row (`id`, `caps`, `label`), with no `keys` or `run`: these rows decide
// nothing. A section's `when` is the gate the whole section is listed behind.
// W and M are two rows with one label, so each has an id and they still print
// as one line.
export const OWN_SHORTCUT_SECTIONS = [
  { title: "WhatsApp Inbox", when: "whatsapp", rows: [
    { id: "inboxTabs", caps: ["←", "→"], label: "Switch Inbox / Archived" },
    { id: "inboxMove", caps: ["↑", "↓"], label: "Select previous / next conversation" },
    { id: "inboxSelect", caps: ["S"], label: "Toggle multi-select" },
    { id: "inboxTemplates", caps: ["T"], label: "Edit templates" },
    { id: "inboxInsert", caps: ["E"], label: "Insert a template (show or hide)" },
    { id: "inboxAccept", caps: ["A"], label: "Accept draft, else toggle Needs action" },
    { id: "inboxDismiss", caps: ["D"], label: "Dismiss draft" },
    { id: "inboxReply", caps: ["C"], label: "Focus the reply box" },
    { id: "inboxSearch", caps: ["/"], label: "Open search" },
    { id: "inboxArchive", caps: ["H"], label: "Archive (Inbox; selection in select mode)" },
    { id: "inboxRestore", caps: ["R"], label: "Restore (Archived; selection in select mode)" },
  ] },
  { title: "More popover (Week / Month)", rows: [
    { id: "moreWeek", caps: ["W"], label: "Week / Month view" },
    { id: "moreMonth", caps: ["M"], label: "Week / Month view" },
    // v18.18.0 (Patryk): WeekView's handler always took S for Stats, and the
    // tab never listed it; the row is here so the Stats button can name it.
    { id: "moreStats", caps: ["S"], label: "Stats view" },
    { id: "moreMove", caps: ["↑", "↓"], label: "Move day focus" },
    { id: "morePrevNext", caps: ["←", "→"], label: "Prev / next (week, or day in Month)" },
    { id: "moreToday", caps: ["T"], label: "This week / month (today)" },
    { id: "moreOpen", caps: ["Enter"], label: "Open the focused day" },
  ] },
  { title: "Manual Table Assignment", rows: [
    { id: "manualSwap", caps: ["S"], label: "Toggle Swap busy" },
    { id: "manualClear", caps: ["C"], label: "Clear selected tables" },
  ] },
  { title: "Universal", rows: [
    { id: "close", caps: ["Esc"], label: "Close current window (or clear the List selection)" },
    { id: "confirm", caps: ["Enter"], label: "Confirm primary action" },
  ] },
];

// → [{ title, when?, rows: [{ keys, label }] }], the own sections as the tab
// draws them.
export function ownShortcutDocs() {
  return OWN_SHORTCUT_SECTIONS.map((sec) => {
    const doc = { title: sec.title, rows: docRows(sec.rows) };
    if (sec.when) doc.when = sec.when;
    return doc;
  });
}

// ── A key, as a hover description ends with it (v18.18.0) ────────────────────
// `keyHint("inbox")` → " (I)": the row's keycaps as the Shortcuts tab prints
// them, in parentheses, with the space before. A control's `title` appends it
// ("Open the WhatsApp inbox" + keyHint("inbox")), so the tooltip names the key
// the table binds and cannot drift from it. An id the tables do not have gives
// "" rather than throwing (this runs in render); tests/shortcuts.test.js fails
// any `keyHint("…")` in src/ whose id is not a row, and check:style Rule 14 fails
// a key typed into a description by hand.
const ROW_BY_ID = {};
SHORTCUT_LAYERS.forEach((l) => l.rows.forEach((r) => { ROW_BY_ID[r.id] = r; }));
OWN_SHORTCUT_SECTIONS.forEach((sec) => sec.rows.forEach((r) => { ROW_BY_ID[r.id] = r; }));

export function keyHint(id) {
  const row = ROW_BY_ID[id];
  return row ? " (" + row.caps.join(" / ") + ")" : "";
}
