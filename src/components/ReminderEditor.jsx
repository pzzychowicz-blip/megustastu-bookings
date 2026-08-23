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

import { S, BTN, R, T, FW, H, IC } from "../lib/constants";
import { validateReminderDraft } from "../lib/reminders";
import { Fld, InlineAlert, ModalTitle, Toggle, mkBtn, mkSolidBtn, mkInp, mkArea, useModalPresence, AutoHeight } from "./atoms";
import { CloseIcon } from "./Icons";

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
  // v15.8.0: symmetric open/close animation via the wrapping <ModalPresence>.
  const { leaving } = useModalPresence();

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
      className={leaving ? "mgt-scrim-out" : "mgt-scrim-in"}
      style={{
        position: "fixed", inset: 0,
        background: "var(--scrim)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 250, padding: 12
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className={leaving ? "mgt-card-out" : "mgt-card-in"} style={{
        background: "var(--bg-sheet)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        borderRadius: R.sheet,
        border: "1px solid var(--border-sheet)",
        width: "100%", maxWidth: 520, maxHeight: "90dvh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxSizing: "border-box",
        boxShadow: "var(--shadow-sheet)"
      }}>
        {/* v14.4.1: body scrolls, action footer (err + buttons) pinned to the
            bottom — mirrors Overlay's `footer` slot (this modal predates it). */}
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "24px", boxSizing: "border-box" }}>
        {/* v15.8.0: AutoHeight eases the body when Recurrence flips once↔weekly. */}
        <AutoHeight>
        {/* v14 p7: header matches New booking / Edit booking pattern —
            centered wrapper + pill-shaped inner with blue background.
            v17.15.0: it IS that pattern now. `ModalTitle` was written in v17.9.1
            to absorb "SEVEN hand-written copies" of this pill, and this was an
            eighth the sweep missed — it renders outside `Overlay`, so a grep of
            Overlay call sites could not see it. Keeps `--app-new`: the pill
            colour rule is that a create/act surface wears its action's own
            colour, and this is the reminder equivalent of + New. It also gains
            an <h2> and the title attribute, which a <div> never had. */}
        <ModalTitle background="var(--app-new)" marginBottom={16}>
          {isNew ? "New reminder" : "Edit reminder"}
        </ModalTitle>

        <Fld label="Text" style={{ marginBottom: 12 }}>{(fid) => (
          <textarea
            id={fid}
            value={draft.text}
            onChange={(e) => updText(e.target.value)}
            rows={2}
            placeholder="e.g. Place order to Coca Cola today"
            className="mgt-hover-scale"
            style={mkArea()}
          />
        )}</Fld>

        <Fld label="Times" style={{ marginBottom: 12 }}>
          <div>
            {draft.times.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <input
                  type="time"
                  aria-label={"Time " + (i + 1)}
                  value={t}
                  onChange={(e) => updTime(i, e.target.value)}
                  className="mgt-hover-scale"
                  style={{ ...mkInp(), flex: 1 }}
                />
                {draft.times.length > 1 ? (
                  <button
                    onClick={() => removeTime(i)}
                    className="mgt-hover-scale"
                    style={mkBtn({ minHeight: 40, minWidth: 40, padding: "0", fontSize: T.title, background: BTN.del, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" })}
                  >
                    <CloseIcon size={IC.control} />
                  </button>
                ) : null}
              </div>
            ))}
            <button
              onClick={addTime}
              className="mgt-hover-scale"
              style={mkBtn({ minHeight: 36, padding: "6px 12px", fontSize: T.body, background: BTN.nav })}
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
              style={mkBtn({ flex: 1, minHeight: 40, background: rec.type === "once" ? S.accent : "var(--app-btn-grey)" })}
            >
              One-off
            </button>
            <button
              onClick={() => setType("weekly")}
              className="mgt-hover-scale"
              style={mkBtn({ flex: 1, minHeight: 40, background: rec.type === "weekly" ? S.accent : "var(--app-btn-grey)" })}
            >
              Weekly
            </button>
          </div>
        </Fld>

        {rec.type === "once" ? (
          <Fld label="Date" style={{ marginBottom: 12 }}>{(fid) => (
            <input
              id={fid}
              type="date"
              value={rec.date || ""}
              min={todayStr}
              onChange={(e) => setDate(e.target.value)}
              className="mgt-hover-scale"
              style={mkInp()}
            />
          )}</Fld>
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
                    style={mkBtn({ flex: 1, minWidth: 48, minHeight: 40, padding: "8px 6px", fontSize: T.body, background: sel ? S.accent : "var(--app-btn-grey)" })}
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
          borderRadius: R.card,
          border: "1px solid var(--border-soft)"
        }}>
          <Toggle on={draft.active} onClick={toggleActive} />
          <span style={{ fontSize: T.body, color: "var(--text-primary)", fontWeight: FW.semi }}>
            {draft.active ? "Active" : "Inactive"}
          </span>
        </div>
        </AutoHeight>
        </div>
        <div style={{ flexShrink: 0, padding: "16px 24px", borderTop: "1px solid var(--border-sheet)", boxSizing: "border-box" }}>
        {/* v17.15.0: the shared InlineAlert — a notification-strip section,
            inside a modal. It was one of three copies of the pale-fill +
            matching-border + third-shade-text shape DESIGN.md bans. */}
        {err ? <InlineAlert style={{ marginBottom: 12 }}>{err}</InlineAlert> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            className="mgt-hover-scale"
            style={mkBtn({ minHeight: H.touch, padding: "10px 18px", background: "var(--app-btn-slate)" })}
          >
            Back
          </button>
          <button
            onClick={() => { if (!err) onSave(); }}
            disabled={!!err}
            className="mgt-hover-scale"
            // v17.15.0: was minHeight 40, the only modal-footer decision button
            // in the app below the 44 floor (H.touch is "decision surfaces only,
            // where a mis-tap costs something: modal footers"). Both buttons in
            // this footer move up together, so the row stays one height.
            style={mkSolidBtn(err ? "var(--btn-disabled)" : "var(--app-success-solid)", {
              cursor: err ? "not-allowed" : "pointer",
              // v17.14.0: muted ink while disabled — see index.html.
              color: err ? "var(--btn-disabled-ink)" : "var(--text-on-accent)",
              boxShadow: err ? "none" : "var(--shadow-btn-success)"
            })}
          >
            Save
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
