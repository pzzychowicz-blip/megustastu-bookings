// src/components/SpecialDayModal.jsx — v18.10.0
//
// The editor for one SPECIAL DAY (lib/special-days.js): a date or a run of
// dates that is closed, or open with its own hours, plus an optional note.
// Opened from Settings › General › Opening hours › Special days (Add, or a
// row's Edit) and from the Summary's "Hours for this day" on the date being
// viewed. Both doors need `hoursEdit`, which App asks before opening it.
//
// What it decides is lib/special-days.js: `specialDayRefusal` is asked on Save
// and its sentence shown under the fields; `affectedBookings` names the
// bookings already made that the new hours leave outside them. Those are KEPT
// (Patryk, 2026-10-18), so the list says so and the Save button says it too
// ("Save, keep 3 bookings"): pressing it is the confirmation.
//
// A drafting surface: it reports dirtiness up (`onDirty`, BlockModal's
// contract) so App's discard guard covers Cancel, Escape and the backdrop.

import { useState, useEffect } from "react";
import { S, T, FW, IC, H } from "../lib/constants";
import { formatDay } from "../lib/day";
import { hourLabel } from "../lib/time-grid";
import { countLabel } from "../lib/booking-logic";
import { specialDayRefusal, affectedBookings, clampHours, rangeLabel, SPECIAL_NOTE_MAX } from "../lib/special-days";
import { Overlay, ModalTitle, Section, Fld, DateField, InlineAlert, Reveal, AutoHeight, SEG_TRACK, segStyle, mkBtn, mkSolidBtn, mkDangerBtn, mkInp, mkSel } from "./atoms";
import { AlertPanel, AlertRow } from "./AlertPanel";
import { ClosedIcon, TrashIcon } from "./Icons";

const ERROR_ID = "mgt-special-day-error";
// What a refused write says (/code-review): `onSave` / `onRemove` answer false
// when nothing was written (the hours have not loaded yet, which passes; a
// missing permission, which App's refusal names on its own), and the button
// that did nothing must say so rather than sit there.
const NOT_SAVED = "Not saved: the opening hours could not be written just now. Try again in a moment.";
// How many of the bookings it leaves outside the hours are named one by one.
const NAMED_MAX = 6;
const OPEN_HOURS = Array.from({ length: 17 }, (_, i) => 6 + i);      // 06–22

function closeLabel(h) {
  return hourLabel(h) + (h === 24 ? " (midnight)" : h > 24 ? " (next day)" : "");
}

// `initial`: { id: string | null, draft: {from, to, closed, open, close, note} }.
export function SpecialDayModal({ initial, exceptions, bookings, today, onSave, onRemove, onClose, onDirty }) {
  const [draft, setDraft] = useState(initial.draft);
  const [refusal, setRefusal] = useState("");
  const [armed, setArmed] = useState(false);
  const editing = !!initial.id;

  const base = initial.draft;
  const dirty = draft.from !== base.from || draft.to !== base.to || draft.closed !== base.closed ||
    (!draft.closed && (draft.open !== base.open || draft.close !== base.close)) || (draft.note || "") !== (base.note || "");
  useEffect(() => { if (onDirty) onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => { if (onDirty) onDirty(false); }, [onDirty]);

  function change(patch) {
    setRefusal("");
    setArmed(false);
    setDraft((d) => {
      const next = Object.assign({}, d, patch);
      // A first date moved past the last one takes the last one with it: the
      // usual case is one date, edited from its first field.
      if (patch.from && next.to < patch.from) next.to = patch.from;
      if (patch.open !== undefined || patch.close !== undefined) Object.assign(next, clampHours(next.open, next.close));
      return next;
    });
  }

  const affected = affectedBookings(bookings, draft.from && draft.to >= draft.from ? draft : null, today);

  function save() {
    const why = specialDayRefusal(draft, exceptions, initial.id, today);
    if (why) { setRefusal(why); return; }
    if (onSave(initial.id, draft) !== false) onClose(true);
    else setRefusal(NOT_SAVED);
  }

  const saveLabel = affected.length ? "Save, keep " + countLabel(affected.length, "booking", "bookings") : "Save";
  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
      {editing ? (
        <button
          className="mgt-hover-scale"
          style={mkDangerBtn({ minHeight: 44, padding: "10px 18px", marginRight: "auto" })}
          onClick={() => {
            if (!armed) { setArmed(true); return; }
            if (onRemove(initial.id) !== false) onClose(true);
            else { setArmed(false); setRefusal(NOT_SAVED); }
          }}
        ><TrashIcon size={IC.control} />{armed ? "Confirm — remove" : "Remove"}</button>
      ) : null}
      <button
        className="mgt-hover-scale"
        style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })}
        onClick={() => onClose(false)}
      >Cancel</button>
      <button
        className="mgt-hover-scale"
        style={mkSolidBtn("var(--accent)")}
        onClick={save}
      >{saveLabel}</button>
    </div>
  );

  return (
    <Overlay onClose={() => onClose(false)} footer={footer}><AutoHeight>
      <ModalTitle background="var(--app-btn-grey-strong)">{editing ? "Change special day" : "Special day"}</ModalTitle>
      <div style={{ fontSize: T.body, color: S.muted, marginBottom: 14 }}>
        A date or a run of dates with hours that differ from its weekday's.
      </div>
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Fld label="From">{(fid) => (
            <DateField value={draft.from} onChange={(e) => change({ from: e.target.value })}
              style={mkInp()} inputProps={{ id: fid, min: today }} />
          )}</Fld>
          <Fld label="To">{(fid) => (
            <DateField value={draft.to} onChange={(e) => change({ to: e.target.value })}
              style={mkInp()} inputProps={{ id: fid, min: draft.from || today }} />
          )}</Fld>
        </div>
      </Section>
      <Section>
        <Fld label="Hours">
          <div role="group" aria-label="Closed or open" style={{ ...SEG_TRACK, alignSelf: "flex-start", marginBottom: 10 }}>
            {[[true, "Closed"], [false, "Open"]].map(([v, lbl]) => (
              <button key={lbl} type="button" className="mgt-hover-scale" aria-pressed={draft.closed === v}
                onClick={() => change({ closed: v })}
                style={{ ...segStyle(draft.closed === v), padding: "6px 16px", minHeight: H.chrome }}>{lbl}</button>
            ))}
          </div>
          <Reveal show={!draft.closed}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: T.body, color: S.muted }}>
                Opens
                <select value={draft.open} onChange={(e) => change({ open: Number(e.target.value) })} className="mgt-hover-scale" style={mkSel()}>
                  {OPEN_HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: T.body, color: S.muted }}>
                Closes
                <select value={draft.close} onChange={(e) => change({ close: Number(e.target.value) })} className="mgt-hover-scale" style={mkSel()}>
                  {Array.from({ length: 25 - draft.open }, (_, i) => draft.open + 1 + i).map((h) => <option key={h} value={h}>{closeLabel(h)}</option>)}
                </select>
              </label>
            </div>
          </Reveal>
        </Fld>
      </Section>
      <Section>
        <Fld label="Note (optional)">{(fid) => (
          <input id={fid} type="text" value={draft.note || ""} maxLength={SPECIAL_NOTE_MAX}
            placeholder="e.g. Christmas, private event" enterKeyHint="done"
            onChange={(e) => change({ note: e.target.value })}
            className="mgt-hover-scale" style={mkInp()} />
        )}</Fld>
      </Section>
      <Reveal show={affected.length > 0}>
        {affected.length ? (
          <AlertPanel role="warn" icon={ClosedIcon} title={countLabel(affected.length, "booking", "bookings") + " outside these hours"} style={{ marginBottom: 12 }}>
            <AlertRow first>
              <span style={{ color: "var(--warn-text)" }}>
                {affected.length === 1 ? "It stays as it is" : "They stay as they are"}: move or cancel {affected.length === 1 ? "it" : "them"} yourself.
              </span>
            </AlertRow>
            {affected.slice(0, NAMED_MAX).map((b) => (
              <AlertRow key={b.id}>
                <span style={{ color: "var(--warn-text)", fontWeight: FW.semi }}>
                  {formatDay(b.date, { today }) + " " + b.time + " · " + (b.name || "No name") + " · " + countLabel(b.size, "guest", "guests")}
                </span>
              </AlertRow>
            ))}
            {affected.length > NAMED_MAX ? (
              <AlertRow><span style={{ color: "var(--warn-text)" }}>{"and " + countLabel(affected.length - NAMED_MAX, "more")}</span></AlertRow>
            ) : null}
          </AlertPanel>
        ) : null}
      </Reveal>
      <div role="alert">
        <Reveal show={!!refusal}>{refusal ? <InlineAlert id={ERROR_ID}>{refusal}</InlineAlert> : null}</Reveal>
      </div>
      {editing && armed ? (
        <div style={{ fontSize: T.body, color: S.muted, marginTop: 8 }}>
          {rangeLabel(initial.draft, today) + " goes back to its weekday's hours."}
        </div>
      ) : null}
    </AutoHeight></Overlay>
  );
}
