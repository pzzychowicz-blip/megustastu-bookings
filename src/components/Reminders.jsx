// src/components/Reminders.jsx
// The "Reminders" tab body in Settings — header row (count + "+ New
// reminder" button) and the list of reminder cards. Per-reminder edit /
// delete / toggle handlers are wired by SettingsContent which threads them
// through from BookingApp.
//
// `ReminderListItem` renders one card: text, times-and-recurrence summary,
// active toggle, Edit / Delete buttons. Fades to 55% opacity when inactive.
//
// `DAY_SHORT_LABELS` is module-local (used only by the recurrence summary).
// Note: ReminderEditor uses a different `DAY_LABELS` array (longer-form,
// Mon-first ordering) — they're kept separate by design, since one drives a
// summary string and the other drives a clickable day picker.
//
// Phase B3 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original. `var DAY_SHORT_LABELS` (previously a top-level App.jsx constant)
// is co-located here as a module-level `const`.

import { BTN } from "../lib/constants";
import { Toggle, mkBtn } from "./atoms";

// ── Day-of-week labels for recurrence summary ────────────────────────────────
// Sun-first, matching JavaScript Date.getDay() ordering. This is the array
// used to format "Weekly: Mon, Wed, Fri" — sort-by-getDay-index then map.
const DAY_SHORT_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── One reminder card ────────────────────────────────────────────────────────
export function ReminderListItem({ reminder, onEdit, onDelete, onToggle }) {
  const r = reminder;
  const rec = r.recurrence || {};
  let recText = "";
  if (rec.type === "once") {
    recText = "Once on " + rec.date;
  } else if (rec.type === "weekly") {
    const ds = (rec.days || []).slice().sort((a, b) => a - b).map((i) => DAY_SHORT_LABELS[i]);
    recText = "Weekly: " + ds.join(", ");
  }
  const timesText = (r.times || []).join(", ");

  return (
    <div style={{
      background: "var(--bg-soft)",
      border: "1px solid var(--border-soft)",
      borderRadius: 12,
      padding: "12px 14px",
      marginBottom: 8,
      opacity: r.active ? 1 : 0.55,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2, wordBreak: "break-word" }}>
            {r.text}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {timesText + "  ·  " + recText}
          </div>
        </div>
        <Toggle on={r.active} onClick={() => onToggle(r.id)} />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          onClick={() => onEdit(r)}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: BTN.edit })}
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(r.id)}
          className="mgt-hover-scale"
          style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: BTN.del })}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Reminders tab body ───────────────────────────────────────────────────────
// Empty state: dashed-border placeholder with prompt text. List state: stack
// of ReminderListItem cards.
export function RemindersTabContent({ reminders, onAdd, onEdit, onDelete, onToggle }) {
  const list = reminders || [];
  const listEls = list.length === 0 ? (
    <div style={{
      textAlign: "center",
      padding: "28px 14px",
      color: "var(--text-muted)",
      fontSize: 13,
      background: "var(--bg-soft)",
      borderRadius: 12,
      border: "1px dashed var(--border-soft)"
    }}>
      No reminders yet. Click &ldquo;+ New reminder&rdquo; to add one.
    </div>
  ) : (
    <div>
      {list.map((r) => (
        <ReminderListItem
          key={r.id}
          reminder={r}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggle={onToggle}
        />
      ))}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {list.length + " reminder" + (list.length !== 1 ? "s" : "")}
        </div>
        <button
          onClick={onAdd}
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 36, padding: "6px 14px", background: "rgba(0,122,255,0.75)" })}
        >
          + New reminder
        </button>
      </div>
      {listEls}
    </div>
  );
}
