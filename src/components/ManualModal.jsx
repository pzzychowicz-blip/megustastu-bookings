// src/components/ManualModal.jsx
// Modal for manually assigning tables to a booking. Used in two places:
//
//   1. Editing an existing booking — `onSave` persists to Firebase via
//      `manualAssign` in BookingApp, including any swap-busy reassignments.
//
//   2. The "manual" preference path in the new-booking form — `onSave` only
//      updates the form's draft state (manualTables + swapAffected); the
//      booking itself is saved later when the user submits the form.
//
// Swap-busy mode lets the host take tables from existing non-seated
// bookings — those bookings will then be rescued via the auto optimizer in
// `manualAssign`. Seated bookings are never swappable (host is responsible
// for not dispossessing seated guests).
//
// Keyboard shortcuts (scoped to this modal — handler unbinds on close):
//   S     → toggle Swap busy (clears selection if turning on)
//   C     → clear selected tables
//   Enter → primary action (Assign / Swap & Assign) when selection is valid
// S/C are suppressed when focus is on an input/textarea/select. Modifier
// keys (Ctrl/Meta/Alt) always pass through so OS shortcuts keep working.
//
// Phase B2 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original. The internal `getCapOf` helper is preserved here unchanged; it
// will be promoted to booking-logic.js in Phase C.

import { useState, useEffect } from "react";
import { S, BTN, VALID_COMBOS, ALL_TABLES } from "../lib/constants";
import {
  toMins, toTime, overlaps, canAssign, getBlockSlots, getBusy
} from "../lib/booking-logic";
import { Overlay, Toggle, mkBtn } from "./atoms";
import { TableGrid } from "./TableGrid";

export function ManualModal({ booking, bookings, onSave, onClose, titleText, blocks = [] }) {
  const [selected, setSelected] = useState(booking && booking.tables ? booking.tables.slice() : []);
  const [swapBusy, setSwapBusy] = useState(false);
  if (!booking) return null;

  // ── Derived context (recomputed every render — same as original) ──────────
  const needed = booking.size || 2;
  const s = toMins(booking.time || "13:00");
  const e = s + (booking.duration || 90);
  const otherBookings = bookings.filter((b) =>
    b && b.id !== booking.id && b.date === booking.date && b.status !== "cancelled" && (b.tables || []).length > 0
  );
  const otherSlots = otherBookings.map((b) => ({
    tables: b.tables || [],
    s: toMins(b.time),
    e: toMins(b.time) + (b.duration || 90),
    status: b.status,
    id: b.id,
    name: b.name
  })).concat(
    getBlockSlots(blocks, booking.date).map((sl) => ({ ...sl, status: "blocked", id: "__block__", name: "Blocked" }))
  );
  const busy = getBusy(otherSlots, s, e);
  const seatedBusy = new Set();
  otherSlots.forEach((sl) => {
    if (!overlaps(s, e, sl.s, sl.e)) return;
    if (sl.status === "seated") sl.tables.forEach((id) => seatedBusy.add(id));
  });

  // Compute the capacity of a chosen subset of table ids by looking up the
  // best matching VALID_COMBO and filling any leftover ids with their
  // standalone capacities. Exact-match wins; otherwise greedy on largest
  // contained subset, then sum the remainders as singletons.
  function getCapOf(ids) {
    if (ids.length === 0) return 0;
    const k = ids.slice().sort().join("|");
    const c = VALID_COMBOS.find((x) => x.ids.slice().sort().join("|") === k);
    if (c) return c.cap;
    let bestCap = 0;
    let bestIds = [];
    VALID_COMBOS.forEach((combo) => {
      if (combo.ids.length <= ids.length && combo.ids.every((id) => ids.includes(id)) && combo.cap > bestCap) {
        bestCap = combo.cap;
        bestIds = combo.ids;
      }
    });
    if (bestIds.length > 0) {
      const rem = ids.filter((id) => !bestIds.includes(id));
      return bestCap + rem.reduce((a, id) => {
        const t = ALL_TABLES.find((x) => x.id === id);
        return a + (t ? t.capacity : 0);
      }, 0);
    }
    return ids.reduce((a, id) => {
      const t = ALL_TABLES.find((x) => x.id === id);
      return a + (t ? t.capacity : 0);
    }, 0);
  }

  // Toggle a table on/off. Auto-prunes the selection so the host doesn't
  // accumulate redundant tables once `needed` is met. Refuses i1+i4 without
  // i2 AND i3 (the indoor cluster must be physically contiguous).
  function toggle(id) {
    if (selected.includes(id)) { setSelected(selected.filter((x) => x !== id)); return; }
    if (busy.has(id) && !(swapBusy && !seatedBusy.has(id))) return;
    let next = selected.concat([id]);
    let h1 = next.includes("i1"), h4 = next.includes("i4"), h2 = next.includes("i2"), h3 = next.includes("i3");
    if (h1 && h4 && (!h2 || !h3)) return;
    if (selected.length > 0 && getCapOf(selected) >= needed) {
      let trimmed = selected.slice();
      while (trimmed.length > 0 && getCapOf(trimmed) >= needed) { trimmed = trimmed.slice(1); }
      next = trimmed.concat([id]);
      h1 = next.includes("i1"); h4 = next.includes("i4"); h2 = next.includes("i2"); h3 = next.includes("i3");
      if (h1 && h4 && (!h2 || !h3)) return;
    }
    setSelected(next);
  }

  // Bookings that will lose tables to this swap (informational — actual
  // reassignment runs in manualAssign after the user confirms).
  const affectedBookings = [];
  if (swapBusy && selected.length > 0) {
    otherSlots.forEach((sl) => {
      if (!overlaps(s, e, sl.s, sl.e) || sl.status === "seated") return;
      const taken = sl.tables.filter((id) => selected.includes(id));
      if (taken.length > 0) affectedBookings.push({ name: sl.name, id: sl.id, tables: taken });
    });
  }

  const cap = getCapOf(selected);
  // For conflict-checking, in swap mode we ignore non-seated bookings
  // (because they'll be reassigned away) — only seated bookings still
  // genuinely block us.
  const slotsForConflict = otherSlots.filter((sl) => !swapBusy || sl.status === "seated");
  const conflict = selected.length >= 2 && !canAssign(selected, slotsForConflict, s, e);
  const ok = selected.length > 0 && cap >= needed && !conflict;
  const summaryColor = conflict ? "#991b1b" : ok ? "#166534" : "#9a3412";
  const summaryText = selected.length === 0
    ? "Select tables below."
    : conflict
      ? "Conflict: cannot use these tables together."
      : "Capacity: " + cap + (cap >= needed ? " (fits " + needed + " pax)" : " — need " + needed + " pax");
  const isSwapping = affectedBookings.length > 0;
  const assignLabel = isSwapping ? "Swap & Assign" : "Assign";
  const swapBg = swapBusy ? "rgba(255,237,213,0.6)" : S.bg;
  const swapBrd = "2px solid " + (swapBusy ? "rgba(253,186,116,0.6)" : "rgba(255,255,255,0.5)");
  const swapTitleClr = swapBusy ? "#9a3412" : S.text;
  const swapSubClr = swapBusy ? "#c2410c" : S.text;

  // Internal keyboard shortcuts. The deps array intentionally includes
  // `affectedBookings` and `onSave` even though they may change every render
  // — the listener gets re-registered, but that's the existing behaviour
  // and changing it is out of scope for the structural extraction.
  useEffect(() => {
    function isTyping(el) {
      if (!el) return false;
      const t = el.tagName;
      return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
    }
    function handler(ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const k = ev.key;
      if (k === "Enter") {
        if (isTyping(ev.target) && ev.target.tagName === "TEXTAREA") return;
        if (ok) { ev.preventDefault(); onSave(selected, true, isSwapping ? affectedBookings : null); }
        return;
      }
      if (isTyping(ev.target)) return;
      if (k === "s" || k === "S") {
        ev.preventDefault();
        const next = !swapBusy;
        if (next) setSelected([]);
        setSwapBusy(next);
        return;
      }
      if (k === "c" || k === "C") {
        ev.preventDefault();
        setSelected([]);
        return;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [swapBusy, selected, ok, isSwapping, affectedBookings, onSave]);

  return (
    <Overlay onClose={onClose}>
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{
          fontSize: 16, fontWeight: 700, color: "#fff",
          display: "inline-block", padding: "8px 16px", borderRadius: 12,
          background: "rgba(0,122,255,0.75)",
          border: "1px solid rgba(255,255,255,0.2)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"
        }}>
          {titleText || "Manual table assignment"}
        </div>
      </div>
      <div style={{ fontSize: 13, color: S.text, marginBottom: 4, marginTop: 6, textAlign: "center" }}>
        {booking.name + " · " + booking.size + " pax · " + booking.time + "–" + toTime(e)}
      </div>
      <div style={{
        marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderRadius: 14,
        background: swapBg, border: swapBrd,
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)"
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: swapTitleClr }}>Swap busy</div>
          <div style={{ fontSize: 11, color: swapSubClr, marginTop: 2 }}>
            Reassign confirmed bookings to other tables (not seated)
          </div>
        </div>
        <Toggle
          on={swapBusy}
          onClick={() => {
            const next = !swapBusy;
            if (next) setSelected([]);
            setSwapBusy(next);
          }}
        />
      </div>
      <div style={{ fontSize: 13, color: S.text, marginBottom: 14 }}>
        Tap tables to select / deselect.
      </div>
      <div style={{
        marginBottom: 14, padding: "12px 14px", borderRadius: 14,
        background: "rgba(255,255,255,0.35)",
        border: "2px solid " + (conflict ? "rgba(252,165,165,0.6)" : ok ? "rgba(134,239,172,0.6)" : "rgba(255,255,255,0.5)"),
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 8, flexWrap: "wrap",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)"
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: S.text }}>
            {"Selected: " + (selected.length ? selected.join(" + ") : "none")}
          </div>
          <div style={{ fontSize: 13, color: summaryColor, fontWeight: 500, marginTop: 2 }}>
            {summaryText}
          </div>
        </div>
        {selected.length > 0 ? (
          <button
            style={mkBtn({ fontSize: 12, padding: "6px 12px", background: BTN.clear })}
            onClick={() => setSelected([])}
          >
            Clear
          </button>
        ) : null}
      </div>
      {isSwapping ? (
        <div style={{
          marginTop: 8, padding: "10px 14px", borderRadius: 14,
          background: "rgba(255,237,213,0.65)",
          border: "2px solid rgba(253,186,116,0.55)"
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#9a3412", marginBottom: 4 }}>
            Will reassign:
          </div>
          {affectedBookings.map((ab) => (
            <div key={ab.id} style={{ fontSize: 12, color: "#9a3412" }}>
              {ab.name + " — losing table " + ab.tables.join(", ")}
            </div>
          ))}
        </div>
      ) : null}
      <TableGrid
        selected={selected}
        toggle={toggle}
        busy={busy}
        seatedBusy={seatedBusy}
        swapBusy={swapBusy}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button
          style={mkBtn({ minHeight: 44, padding: "10px 18px", background: BTN.cancel })}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          disabled={!ok}
          onClick={() => { if (ok) onSave(selected, true, isSwapping ? affectedBookings : null); }}
          style={{
            background: ok ? (isSwapping ? BTN.orange : S.accent) : "rgba(180,180,190,0.4)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 14, padding: "10px 20px",
            cursor: ok ? "pointer" : "not-allowed",
            fontSize: 14, fontWeight: 600, color: "#fff", minHeight: 44,
            boxShadow: ok ? "0 2px 6px rgba(0,0,0,0.12), inset 0 1px 1px rgba(255,255,255,0.15)" : "none"
          }}
        >
          {assignLabel}
        </button>
      </div>
    </Overlay>
  );
}
