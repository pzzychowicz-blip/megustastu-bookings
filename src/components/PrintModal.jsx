// src/components/PrintModal.jsx
//
// v18.4.0 (Patryk) — what to print. The Summary's one Print button opens this:
// the day sheet (the list, DaySheet.jsx), the timeline (the grid,
// TimelineSheet.jsx), or both. The timeline takes a From and a To in whole
// hours; they open on the viewed day's opening hour and on its closing hour, or
// on the end of its last booking where that runs later, which is the range the
// screen's grid draws.
//
// The steppers are ALWAYS drawn and only dimmed for the day sheet, so picking a
// kind never changes the card's height under the finger (`@static-height`).
//
// It holds no draft: nothing here is stored, and Cancel, Escape and the scrim
// all just close it. `onPrint({ kind, from, to, Sheet })` is App's — it mounts
// the sheet and calls `window.print()` inside this click. `Sheet` is
// TimelineSheet, handed up because this file is a lazy chunk and the sheet
// rides in it: App cannot import it without putting it in the startup bundle.
//
// Modal id `print` (MODAL_Z, beside `week`, the Summary's other button).

import { useState } from "react";
import { S, T, FW, H } from "../lib/constants";
import { hourLabel } from "../lib/time-grid";
import { TimelineSheet } from "./TimelineSheet";
import { Overlay, ModalTitle, mkBtn, mkSolidBtn, mkStep, SEG_TRACK, segStyle, PAUSED_FADE } from "./atoms";

const KINDS = [["sheet", "Day sheet"], ["timeline", "Timeline"], ["both", "Both"]];
const SAYS = {
  sheet: "The day's bookings as a list, with phones, deposits and notes.",
  timeline: "The day's grid: every table a row, each booking in its status colour.",
  both: "The list first, then the grid on its own page.",
};

function HourStep({ label, value, min, max, onChange, disabled }) {
  const noDec = disabled || value <= min, noInc = disabled || value >= max;
  return (
    <div role="group" aria-label={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: T.body, fontWeight: FW.medium, color: S.sub, minWidth: 40 }}>{label}</span>
      <button
        onClick={function () { onChange(value - 1); }} disabled={noDec}
        className={noDec ? undefined : "mgt-hover-scale"}
        aria-label={"Earlier " + label.toLowerCase() + " hour"}
        style={{ ...mkStep(H.control), opacity: noDec ? 0.4 : 1, cursor: noDec ? "not-allowed" : "pointer" }}>−</button>
      <span style={{ minWidth: 58, textAlign: "center", fontSize: T.lead, fontWeight: FW.bold, color: S.text, fontVariantNumeric: "tabular-nums" }}>{hourLabel(value)}</span>
      <button
        onClick={function () { onChange(value + 1); }} disabled={noInc}
        className={noInc ? undefined : "mgt-hover-scale"}
        aria-label={"Later " + label.toLowerCase() + " hour"}
        style={{ ...mkStep(H.control), opacity: noInc ? 0.4 : 1, cursor: noInc ? "not-allowed" : "pointer" }}>+</button>
    </div>
  );
}

export function PrintModal({ range, onPrint, onClose }) {
  const [kind, setKind] = useState("sheet");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const grid = kind !== "sheet";
  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button className="mgt-hover-scale mgt-press" onClick={onClose} style={mkBtn({ minHeight: H.touch, padding: "10px 18px", background: "var(--app-btn-slate)" })}>Cancel</button>
      <button className="mgt-hover-scale mgt-press" onClick={function () { onPrint({ kind: kind, from: from, to: to, Sheet: TimelineSheet }); }} style={mkSolidBtn("var(--accent)", { minHeight: H.touch })}>Print</button>
    </div>
  );
  return (
    <Overlay /* @static-height the steppers are always drawn, dimmed for the day sheet, so no choice changes the height */ onClose={onClose} footer={footer}>
      <ModalTitle background="var(--app-btn-grey-strong)">Print</ModalTitle>
      <div role="group" aria-label="What to print" style={{ ...SEG_TRACK, display: "flex", marginBottom: 10 }}>
        {KINDS.map(function (k) {
          return (
            <button key={k[0]} className="mgt-hover-scale" aria-pressed={kind === k[0]}
              onClick={function () { setKind(k[0]); }}
              style={Object.assign(segStyle(kind === k[0]), { flex: 1, minHeight: H.chrome, padding: "6px 14px" })}>{k[1]}</button>
          );
        })}
      </div>
      <div style={{ fontSize: T.body, color: S.muted, marginBottom: 16, minHeight: 32 }}>{SAYS[kind]}</div>
      <div style={{ opacity: grid ? 1 : PAUSED_FADE, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: T.body, fontWeight: FW.semi, color: S.text }}>Hours on the timeline</div>
        <HourStep label="From" value={from} min={range.min} max={to - 1} onChange={setFrom} disabled={!grid} />
        <HourStep label="To" value={to} min={from + 1} max={range.max} onChange={setTo} disabled={!grid} />
      </div>
    </Overlay>
  );
}
