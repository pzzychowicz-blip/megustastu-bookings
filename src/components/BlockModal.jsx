// src/components/BlockModal.jsx
// Modal for blocking off a single table on a single date for a specific
// time range. Two view states:
//
//   • view  — list any existing blocks for this table+date with an
//             "Unblock" button per row, plus "+ Add block" to enter add mode.
//   • add   — From / To time inputs and a "Block" button to create a new
//             block.
//
// The component holds only its own UI state. Persistence is delegated to
// the parent via `onSave` / `onRemove`. Default time range is the full
// service window (OPEN to GRID_CLOSE).
//
// Phase B2 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original.

import { useState } from "react";
import { S, BTN, TBL, OPEN, GRID_CLOSE } from "../lib/constants";
import { toMins, isIn } from "../lib/booking-logic";
import { Overlay, Section, Fld, mkBtn, mkInp } from "./atoms";

export function BlockModal({ tableId, date, blocks = [], onSave, onRemove, onClose }) {
  if (!tableId) return null;
  const existing = blocks.filter((bl) => bl.tableId === tableId && bl.date === date);
  const indoor = isIn(tableId);
  const tc = indoor ? TBL.ind : TBL.out;
  const [mode, setMode] = useState(existing.length > 0 ? "view" : "add");
  const [from, setFrom] = useState(OPEN + ":00");
  const [to, setTo] = useState(GRID_CLOSE + ":00");

  function handleSave() {
    if (!from || !to || toMins(to) <= toMins(from)) return;
    onSave({ tableId, date, allDay: false, from, to });
  }

  // ── View mode: existing blocks listed with Unblock buttons ───────────────
  if (mode === "view" && existing.length > 0) {
    return (
      <Overlay onClose={onClose}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8,
            background: tc.bg, color: tc.text, border: "1px solid " + tc.border
          }}>
            {tableId}
          </span>
          <span style={{ fontSize: 17, fontWeight: 700, color: S.text }}>
            {"Table " + tableId + " — " + date}
          </span>
        </div>
        {existing.map((bl, i) => {
          const label = bl.allDay ? OPEN + ":00 – " + GRID_CLOSE + ":00" : bl.from + " – " + bl.to;
          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", borderRadius: 14,
              background: "rgba(254,226,226,0.65)",
              border: "2px solid rgba(252,165,165,0.55)",
              marginBottom: 8
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#991b1b" }}>Blocked</div>
                <div style={{ fontSize: 13, color: "#991b1b" }}>{label}</div>
              </div>
              <button
                onClick={() => onRemove(bl)}
                style={mkBtn({ background: BTN.del, fontSize: 12 })}
              >
                Unblock
              </button>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button
            style={mkBtn({ minHeight: 40, padding: "8px 16px", background: "#64748b" })}
            onClick={() => setMode("add")}
          >
            + Add block
          </button>
          <button
            style={mkBtn({ minHeight: 40, padding: "8px 16px", background: BTN.cancel })}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </Overlay>
    );
  }

  // ── Add mode: From / To inputs ───────────────────────────────────────────
  return (
    <Overlay onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8,
          background: tc.bg, color: tc.text, border: "1px solid " + tc.border
        }}>
          {tableId}
        </span>
        <span style={{ fontSize: 17, fontWeight: 700, color: S.text }}>
          {"Block table " + tableId}
        </span>
      </div>
      <div style={{ fontSize: 13, color: S.muted, marginBottom: 16 }}>{date}</div>
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Fld label="From">
            <input
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              min={OPEN + ":00"}
              max={GRID_CLOSE + ":00"}
              style={mkInp()}
            />
          </Fld>
          <Fld label="To">
            <input
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              min={OPEN + ":00"}
              max={GRID_CLOSE + ":00"}
              style={mkInp()}
            />
          </Fld>
        </div>
      </Section>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <button
          style={mkBtn({ minHeight: 44, padding: "10px 18px", background: BTN.cancel })}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          style={{
            background: "rgba(153,27,27,0.85)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 14, padding: "10px 22px", cursor: "pointer",
            fontSize: 14, fontWeight: 600, color: "#fff", minHeight: 44,
            boxShadow: "0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)"
          }}
        >
          Block
        </button>
      </div>
    </Overlay>
  );
}
