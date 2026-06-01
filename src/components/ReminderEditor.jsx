// src/components/ReminderEditor.jsx
// Modal editor for creating or editing a single reminder. Sits on top of the
// Settings overlay using z-index 250 (vs Overlay's 200) — this is why it
// doesn't reuse the shared `Overlay` component from atoms.jsx.
//
// State model: this component is purely presentational — `draft` and
// `setDraft` are owned by BookingApp. Validation runs on every render via
// `validateReminderDraft` so the Save button stays live with field changes.
//
// Recurrence types:
//   • once   — single date + one or more times (must be in the future)
//   • weekly — selected weekdays + one or more times (recurs forever)
// Day picker is shown Mon→Sun (European convention) but the indices stored
// are JavaScript Date.getDay() values (0=Sun … 6=Sat) — the local
// `DAY_LABELS` array handles that mapping.
//
// Phase B3 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original.

import { S, BTN } from "../lib/constants";
import { validateReminderDraft } from "../lib/reminders";
import { Fld, Toggle, mkBtn, mkInp } from "./atoms";

// Mon-first display order; `i` is the underlying getDay() index stored in
// recurrence.days. Sun is at the end (index 0).
const DAY_LABELS = [
  { i: 1, s: "Mon" }, { i: 2, s: "Tue" }, { i: 3, s: "Wed" }, { i: 4, s: "Thu" },
  { i: 5, s: "Fri" }, { i: 6, s: "Sat" }, { i: 0, s: "Sun" },
];

export function ReminderEditor({ draft, setDraft, onSave, onCancel, isNew }) {
  const err = validateReminderDraft(draft);
  const rec = draft.recurrence || {};
  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Field updaters ──────────────────────────────────────────────────────
  // Each one returns a new draft via spread; never mutates the existing one.
  function updText(v) {
    setDraft({ ...draft, text: v });
  }
  function updTime(idx, v) {
    const ts = draft.times.slice();
    ts[idx] = v;
    setDraft({ ...draft, times: ts });
  }
  function addTime() {
    const ts = draft.times.slice();
    ts.push("21:00");
    setDraft({ ...draft, times: ts });
  }
  function removeTime(idx) {
    if (draft.times.length <= 1) return;
    const ts = draft.times.slice();
    ts.splice(idx, 1);
    setDraft({ ...draft, times: ts });
  }
  function setType(t) {
    let newRec;
    if (t === "once") {
      newRec = { type: "once", date: rec.date || todayStr, days: rec.days || [] };
    } else {
      newRec = {
        type: "weekly",
        date: rec.date || todayStr,
        days: rec.days && rec.days.length ? rec.days : [new Date().getDay()]
      };
    }
    setDraft({ ...draft, recurrence: newRec });
  }
  function setDate(v) {
    setDraft({ ...draft, recurrence: { ...rec, date: v } });
  }
  function toggleDay(i) {
    const cur = Array.isArray(rec.days) ? rec.days.slice() : [];
    const idx = cur.indexOf(i);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(i);
    setDraft({ ...draft, recurrence: { ...rec, days: cur } });
  }
  function toggleActive() {
    setDraft({ ...draft, active: !draft.active });
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "var(--scrim)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 250, padding: 12
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: "var(--bg-sheet)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        borderRadius: 20,
        border: "1px solid var(--border-sheet)",
        padding: "22px",
        width: "100%", maxWidth: 520, maxHeight: "90dvh",
        overflowY: "auto", boxSizing: "border-box",
        boxShadow: "0 8px 40px rgba(0,0,0,0.15), inset 0 1px 1px rgba(255,255,255,0.8)"
      }}>
        {/* v14 p7: header matches New booking / Edit booking pattern —
            centered wrapper + pill-shaped inner with blue background. */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: "var(--text-on-accent)",
            display: "inline-block", padding: "8px 16px", borderRadius: 12,
            background: "rgba(0,122,255,0.75)",
            border: "1px solid rgba(255,255,255,0.2)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"
          }}>
            {isNew ? "New reminder" : "Edit reminder"}
          </div>
        </div>

        <Fld label="Text" style={{ marginBottom: 12 }}>
          <textarea
            value={draft.text}
            onChange={(e) => updText(e.target.value)}
            rows={2}
            placeholder="e.g. Place order to Coca Cola today"
            className="mgt-hover-scale"
            style={{ ...mkInp(), resize: "vertical" }}
          />
        </Fld>

        <Fld label="Times" style={{ marginBottom: 12 }}>
          <div>
            {draft.times.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <input
                  type="time"
                  value={t}
                  onChange={(e) => updTime(i, e.target.value)}
                  className="mgt-hover-scale"
                  style={{ ...mkInp(), flex: 1 }}
                />
                {draft.times.length > 1 ? (
                  <button
                    onClick={() => removeTime(i)}
                    className="mgt-hover-scale"
                    style={mkBtn({ minHeight: 40, minWidth: 40, padding: "0", fontSize: 18, background: BTN.del, lineHeight: 1 })}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
            <button
              onClick={addTime}
              className="mgt-hover-scale"
              style={mkBtn({ minHeight: 36, padding: "6px 12px", fontSize: 12, background: BTN.nav })}
            >
              + Add time
            </button>
          </div>
        </Fld>

        <Fld label="Recurrence" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setType("once")}
              className="mgt-hover-scale"
              style={mkBtn({ flex: 1, minHeight: 40, background: rec.type === "once" ? S.accent : "rgba(120,130,150,0.45)" })}
            >
              One-off
            </button>
            <button
              onClick={() => setType("weekly")}
              className="mgt-hover-scale"
              style={mkBtn({ flex: 1, minHeight: 40, background: rec.type === "weekly" ? S.accent : "rgba(120,130,150,0.45)" })}
            >
              Weekly
            </button>
          </div>
        </Fld>

        {rec.type === "once" ? (
          <Fld label="Date" style={{ marginBottom: 12 }}>
            <input
              type="date"
              value={rec.date || ""}
              min={todayStr}
              onChange={(e) => setDate(e.target.value)}
              className="mgt-hover-scale"
              style={mkInp()}
            />
          </Fld>
        ) : null}

        {rec.type === "weekly" ? (
          <Fld label="Days" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {DAY_LABELS.map((d) => {
                const sel = (rec.days || []).indexOf(d.i) >= 0;
                return (
                  <button
                    key={d.i}
                    onClick={() => toggleDay(d.i)}
                    className="mgt-hover-scale"
                    style={mkBtn({ flex: 1, minWidth: 48, minHeight: 40, padding: "8px 6px", fontSize: 12, background: sel ? S.accent : "rgba(120,130,150,0.45)" })}
                  >
                    {d.s}
                  </button>
                );
              })}
            </div>
          </Fld>
        ) : null}

        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
          padding: "10px 12px",
          background: "var(--bg-soft)",
          borderRadius: 12,
          border: "1px solid var(--border-soft)"
        }}>
          <Toggle on={draft.active} onClick={toggleActive} />
          <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>
            {draft.active ? "Active" : "Inactive"}
          </span>
        </div>

        {err ? (
          <div style={{
            color: "var(--danger-text)", fontSize: 13,
            padding: "8px 12px",
            background: "var(--danger-bg)",
            borderRadius: 12,
            border: "1px solid var(--danger-border)",
            marginBottom: 12
          }}>
            {err}
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            className="mgt-hover-scale"
            style={mkBtn({ minHeight: 40, padding: "8px 18px", background: BTN.cancel })}
          >
            Cancel
          </button>
          <button
            onClick={() => { if (!err) onSave(); }}
            disabled={!!err}
            className="mgt-hover-scale"
            style={{
              background: err ? "rgba(180,180,190,0.4)" : "rgba(22,101,52,0.8)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 14,
              padding: "10px 22px",
              cursor: err ? "not-allowed" : "pointer",
              fontSize: 14, fontWeight: 600, color: "var(--text-on-accent)", minHeight: 40,
              boxShadow: err ? "none" : "0 2px 8px rgba(22,101,52,0.2), inset 0 1px 1px rgba(255,255,255,0.15)"
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
