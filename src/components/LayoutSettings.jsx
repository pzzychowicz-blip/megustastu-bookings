// src/components/LayoutSettings.jsx
// v15.0.0: Settings → Layout tab — the restaurant's physical table layout, fully
// editable and Firebase-shared via useLayout (settings/layout). Fully controlled:
// each change calls onSaveLayout with the next config; the Firebase echo re-renders.
//   • Tables  — add / remove / rename (id) · capacity · zone. Remove/rename of a
//     table referenced by an active FUTURE booking warns (orphan safety; we don't
//     migrate stored bookings). Rename remaps every combo reference so combos survive.
//   • Combos  — editable join-groups (reorder/add/remove/new) whose contiguous
//     sub-runs become auto-combos (per-run seat-cap override), plus cross-group
//     "mega" combos (add/edit-cap/remove). All derived into VALID_COMBOS by buildLayout.
//   • Kitchen limit.

import { useState } from "react";
import { Section, Collapsible } from "./atoms";
import { contiguousRuns, comboKey } from "../lib/constants";

// Compact ±1 stepper (no label) — mirrors Settings.jsx's MiniStepper contract.
const STEP_BTN = {
  background: "var(--bg-stepper)", border: "1px solid var(--border-soft)",
  borderRadius: 8, width: 30, height: 30, fontSize: 17, fontWeight: 600,
  color: "var(--text-primary)",
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  boxShadow: "var(--shadow-input)"
};
// Small circular remove (×) button — used by the editable combo rows.
const X_BTN = {
  background: "var(--danger-bg)", border: "1px solid var(--danger-border)",
  borderRadius: 8, width: 28, height: 28, fontSize: 16, fontWeight: 700,
  color: "var(--danger-text)", lineHeight: 1,
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  cursor: "pointer", boxShadow: "var(--shadow-input)"
};
// Editable join-group chip + its micro reorder/remove buttons.
const GCHIP = {
  display: "inline-flex", alignItems: "center", gap: 1,
  background: "var(--bg-stepper)", border: "1px solid var(--border-soft)",
  borderRadius: 8, padding: "2px 4px", boxShadow: "var(--shadow-input)"
};
const GCHIP_BTN = {
  background: "transparent", border: "none", padding: 0, width: 18, height: 22,
  fontSize: 14, fontWeight: 700, color: "var(--text-muted)", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1
};
// An "available table" chip in the add-to-group / new-group pickers.
const PICK_CHIP = {
  fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "4px 9px", cursor: "pointer",
  border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--text-on-accent)",
  boxShadow: "var(--shadow-input)"
};
// Small text input — table id (rename / add).
const TXT_INP = {
  background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: 8,
  padding: "6px 9px", fontSize: 13, fontWeight: 700, color: "var(--text-primary)",
  width: 70, boxSizing: "border-box", boxShadow: "var(--shadow-input)"
};
// Accent action button (Add / Rename / confirm).
const ACT_BTN = {
  border: "1px solid var(--accent)", borderRadius: 8, padding: "6px 12px",
  fontSize: 13, fontWeight: 700, background: "var(--accent)", color: "var(--text-on-accent)",
  boxShadow: "var(--shadow-input)", cursor: "pointer"
};
// A table id is joined into combo keys with "|" (comboKey), so it must be
// non-empty AND must not contain that separator — otherwise the key can't be
// split back to the right ids (comboCaps overrides + rename remap would corrupt).
const idOk = (s) => s.length > 0 && s.indexOf("|") < 0;
function Stepper({ value, onDec, onInc, disableDec, disableInc, width = 30 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button onClick={onDec} disabled={disableDec} className={disableDec ? undefined : "mgt-hover-scale"}
        style={{ ...STEP_BTN, opacity: disableDec ? 0.4 : 1, cursor: disableDec ? "not-allowed" : "pointer" }}>−</button>
      <span style={{ minWidth: width, textAlign: "center", fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{value}</span>
      <button onClick={onInc} disabled={disableInc} className={disableInc ? undefined : "mgt-hover-scale"}
        style={{ ...STEP_BTN, opacity: disableInc ? 0.4 : 1, cursor: disableInc ? "not-allowed" : "pointer" }}>+</button>
    </div>
  );
}

export function LayoutTabContent({ layout, onSaveLayout = () => {}, bookings = [] }) {
  const tables = (layout && Array.isArray(layout.tables)) ? layout.tables : [];
  const kitchenLimit = layout && Number.isFinite(layout.kitchenLimit) ? layout.kitchenLimit : 3;
  const totalSeats = tables.reduce((a, t) => a + (Number(t.capacity) || 0), 0);
  const indoorCount = tables.filter((t) => t.zone === "indoor").length;
  const outdoorCount = tables.length - indoorCount;

  function updateTable(id, patch) {
    onSaveLayout({ ...layout, tables: tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }

  // ── Add / remove / rename tables (editor C) ───────────────────────────────
  // Orphan safety: a booking stores its assigned table ids in `tables:[…]`, so
  // removing or renaming a table that an active FUTURE booking references would
  // leave that booking pointing at a table that no longer exists. We don't migrate
  // stored bookings (out of scope) — we WARN, with the count, before committing.
  const todayISO = new Date().toISOString().slice(0, 10);
  function orphanCount(id) {
    return bookings.filter(function (b) {
      return b && b.date >= todayISO && b.status !== "cancelled" && b.status !== "completed" &&
        Array.isArray(b.tables) && b.tables.indexOf(id) >= 0;
    }).length;
  }
  const idSet = {}; tables.forEach(function (t) { idSet[t.id] = true; });

  const [editId, setEditId] = useState(null);   // table id being renamed
  const [editVal, setEditVal] = useState("");
  const [pendingRemove, setPendingRemove] = useState(null); // id awaiting remove-confirm
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [newCap, setNewCap] = useState(2);
  const [newZone, setNewZone] = useState("outdoor");

  function startEdit(id) { setPendingRemove(null); setEditId(id); setEditVal(id); }
  function cancelEdit() { setEditId(null); setEditVal(""); }
  // Rename remaps EVERY reference (tables + joinGroups + comboCaps keys + megaCombos)
  // so the table's combos survive the rename instead of silently dropping.
  function commitEdit(oldId) {
    const nid = editVal.trim();
    if (!idOk(nid) || (nid !== oldId && idSet[nid])) return; // invalid: empty, contains "|", or collision
    if (nid !== oldId) {
      const rmap = function (x) { return x === oldId ? nid : x; };
      const cc = {};
      Object.keys(layout.comboCaps || {}).forEach(function (k) {
        cc[comboKey(k.split("|").map(rmap))] = layout.comboCaps[k];
      });
      onSaveLayout({
        ...layout,
        tables: tables.map(function (t) { return t.id === oldId ? { ...t, id: nid } : t; }),
        joinGroups: (layout.joinGroups || []).map(function (g) { return g.map(rmap); }),
        comboCaps: cc,
        megaCombos: (layout.megaCombos || []).map(function (m) { return { ...m, ids: m.ids.map(rmap) }; })
      });
    }
    cancelEdit();
  }
  function removeTable(id) {
    setPendingRemove(null);
    // A layout needs ≥1 table — removing the last one would sanitize down to an
    // empty `tables` and reset the whole layout to DEFAULT_LAYOUT (the MGT default),
    // silently replacing the user's config. Block it here (the × is also disabled).
    if (tables.length <= 1) return;
    // sanitizeLayout + buildLayout drop the table's combos / cluster / group + any
    // mega referencing it, so we only need to drop the table itself here.
    onSaveLayout({ ...layout, tables: tables.filter(function (t) { return t.id !== id; }) });
  }
  function addTable() {
    const nid = newId.trim();
    if (!idOk(nid) || idSet[nid]) return;
    onSaveLayout({ ...layout, tables: tables.concat([{ id: nid, capacity: newCap, zone: newZone }]) });
    setAdding(false); setNewId(""); setNewCap(2); setNewZone("outdoor");
  }
  const newIdTrim = newId.trim();
  const newIdValid = idOk(newIdTrim) && !idSet[newIdTrim];
  const editTrim = editVal.trim();
  const editValid = idOk(editTrim) && (editTrim === editId || !idSet[editTrim]);

  // v15.0.0 Phase 4: combo config (derived into VALID_COMBOS by buildLayout). The
  // editor exposes the within-group ("auto") combo seat counts — the part a venue
  // actually tunes ("2+3 really seats 5"). An override writes comboCaps[key]; the
  // optimizer picks it up live. Cross-group "mega" combos are shown read-only.
  const capOf = {};
  tables.forEach((t) => { capOf[t.id] = Number(t.capacity) || 0; });
  const joinGroups = (layout && Array.isArray(layout.joinGroups)) ? layout.joinGroups : [];
  const comboCaps = (layout && layout.comboCaps && typeof layout.comboCaps === "object") ? layout.comboCaps : {};
  const mega = (layout && Array.isArray(layout.megaCombos)) ? layout.megaCombos : [];
  const autoCount = joinGroups.reduce((a, g) => a + contiguousRuns(g).length, 0);

  function setComboCap(key, cap) {
    onSaveLayout({ ...layout, comboCaps: { ...comboCaps, [key]: cap } });
  }

  // ── Cross-group (mega) combo editing ──────────────────────────────────────
  // Each mega combo's cap is editable; rows can be removed; new ones added via
  // a multi-select of ≥2 tables. Dedupe by comboKey against EVERY existing combo
  // (auto runs + other megas) so a mega can't shadow an auto-combo / duplicate
  // another mega (buildLayout appends megas without dedup).
  const existingKeys = {};
  joinGroups.forEach(function (g) {
    contiguousRuns(g).forEach(function (run) { existingKeys[comboKey(run)] = true; });
  });
  mega.forEach(function (mc) { existingKeys[comboKey(mc.ids)] = true; });

  function setMegaCap(i, cap) {
    onSaveLayout({ ...layout, megaCombos: mega.map(function (mc, idx) { return idx === i ? { ...mc, cap: cap } : mc; }) });
  }
  function removeMega(i) {
    onSaveLayout({ ...layout, megaCombos: mega.filter(function (_, idx) { return idx !== i; }) });
  }

  // Add-combo draft (local). Toggling a table re-defaults the cap to the new sum;
  // the user can then nudge it before adding.
  const [addIds, setAddIds] = useState([]);
  const [addCap, setAddCap] = useState(2);
  function toggleAdd(id) {
    const next = addIds.indexOf(id) >= 0 ? addIds.filter(function (x) { return x !== id; }) : addIds.concat([id]);
    setAddIds(next);
    setAddCap(Math.max(1, next.reduce(function (a, x) { return a + (capOf[x] || 0); }, 0)));
  }
  const addKey = comboKey(addIds);
  const addDup = addIds.length >= 2 && existingKeys[addKey];
  const canAdd = addIds.length >= 2 && !addDup;
  function addMega() {
    if (!canAdd) return;
    // Preserve table (config) order in the stored ids for a stable label.
    const ordered = tables.map(function (t) { return t.id; }).filter(function (id) { return addIds.indexOf(id) >= 0; });
    onSaveLayout({ ...layout, megaCombos: mega.concat([{ ids: ordered, cap: addCap }]) });
    setAddIds([]);
    setAddCap(2);
  }

  // ── Join-group editing ────────────────────────────────────────────────────
  // Join-groups are the ordered physical runs; their contiguous sub-runs become
  // the auto-combos shown below each group. Edits write the whole joinGroups array
  // through onSaveLayout (sanitize dedupes a table across groups + drops empties).
  // A table can live in only ONE group, so the add/new pickers offer only the
  // currently-ungrouped tables. `pickFor` = the group index whose add-picker is open.
  const [pickFor, setPickFor] = useState(null);
  const ungrouped = tables.map(function (t) { return t.id; }).filter(function (id) {
    return !joinGroups.some(function (g) { return g.indexOf(id) >= 0; });
  });
  function moveInGroup(gi, idx, dir) {
    const g = joinGroups[gi].slice();
    const j = idx + dir;
    if (j < 0 || j >= g.length) return;
    const t = g[idx]; g[idx] = g[j]; g[j] = t;
    onSaveLayout({ ...layout, joinGroups: joinGroups.map(function (x, k) { return k === gi ? g : x; }) });
  }
  function removeFromGroup(gi, id) {
    setPickFor(null);
    const next = joinGroups
      .map(function (g, k) { return k === gi ? g.filter(function (x) { return x !== id; }) : g; })
      .filter(function (g) { return g.length > 0; });
    onSaveLayout({ ...layout, joinGroups: next });
  }
  function removeGroup(gi) {
    setPickFor(null);
    onSaveLayout({ ...layout, joinGroups: joinGroups.filter(function (_, k) { return k !== gi; }) });
  }
  function addToGroup(gi, id) {
    setPickFor(null);
    onSaveLayout({ ...layout, joinGroups: joinGroups.map(function (g, k) { return k === gi ? g.concat([id]) : g; }) });
  }
  function newGroupFrom(id) {
    setPickFor(null);
    onSaveLayout({ ...layout, joinGroups: joinGroups.concat([[id]]) });
  }

  return (
    <div>
      <Collapsible
        title="Tables"
        subtitle="Each table's id, capacity and zone. Shared across all devices."
        summary={tables.length + " tables · " + totalSeats + " seats"}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 2 }}>
          {outdoorCount} outdoor · {indoorCount} indoor · {totalSeats} seats total
        </div>
        {tables.map(function (t) {
          const cap = Number.isFinite(t.capacity) ? t.capacity : 2;
          const indoor = t.zone === "indoor";
          const editing = editId === t.id;
          const confirming = pendingRemove === t.id;
          const orph = confirming ? orphanCount(t.id) : 0;
          // Computed once per row (orphanCount re-filters all bookings) — v15.0.1.
          const renameOrph = editing && editTrim !== t.id && editValid ? orphanCount(t.id) : 0;
          return (
            <div key={t.id} style={{ padding: "8px 0", borderTop: "1px solid var(--border-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {editing ? (
                  <input value={editVal} autoFocus style={{ ...TXT_INP }}
                    onChange={function (e) { setEditVal(e.target.value); }}
                    onKeyDown={function (e) { if (e.key === "Enter" && editValid) commitEdit(t.id); if (e.key === "Escape") cancelEdit(); }} />
                ) : (
                  <span style={{ width: 44, fontSize: 13, fontWeight: 700, color: "var(--text-primary)", flexShrink: 0 }}>{t.id}</span>
                )}
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>cap</span>
                <Stepper value={cap} disableDec={cap <= 1} disableInc={cap >= 20}
                  onDec={function () { updateTable(t.id, { capacity: cap - 1 }); }} onInc={function () { updateTable(t.id, { capacity: cap + 1 }); }} />
                <button onClick={function () { updateTable(t.id, { zone: indoor ? "outdoor" : "indoor" }); }} className="mgt-hover-scale"
                  style={{
                    marginLeft: "auto", border: "1px solid var(--border-soft)", borderRadius: 8,
                    padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0,
                    background: indoor ? "rgba(var(--tbl-ind-rgb),0.18)" : "rgba(var(--tbl-out-rgb),0.18)",
                    color: "var(--text-primary)", boxShadow: "var(--shadow-input)"
                  }}>
                  {indoor ? "Indoor" : "Outdoor"}
                </button>
                {editing ? (
                  <>
                    <button onClick={function () { commitEdit(t.id); }} disabled={!editValid} className={editValid ? "mgt-hover-scale" : undefined}
                      title="Save name" style={{ ...ACT_BTN, padding: "5px 10px", opacity: editValid ? 1 : 0.4, cursor: editValid ? "pointer" : "not-allowed" }}>✓</button>
                    <button onClick={cancelEdit} className="mgt-hover-scale" title="Cancel" style={X_BTN}>×</button>
                  </>
                ) : (
                  <>
                    <button onClick={function () { startEdit(t.id); }} className="mgt-hover-scale" title="Rename table"
                      style={{ ...GCHIP_BTN, width: 26, height: 26, fontSize: 14, border: "1px solid var(--border-soft)", borderRadius: 8, background: "var(--bg-stepper)", boxShadow: "var(--shadow-input)" }}>✎</button>
                    <button onClick={function () { setEditId(null); setPendingRemove(t.id); }} disabled={tables.length <= 1}
                      className={tables.length <= 1 ? undefined : "mgt-hover-scale"}
                      title={tables.length <= 1 ? "A layout needs at least one table" : "Remove table"}
                      style={{ ...X_BTN, opacity: tables.length <= 1 ? 0.4 : 1, cursor: tables.length <= 1 ? "not-allowed" : "pointer" }}>×</button>
                  </>
                )}
              </div>
              {editing && renameOrph > 0 ? (
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--warn-text)", marginTop: 4 }}>
                  {renameOrph} upcoming booking{renameOrph === 1 ? " still references" : "s still reference"} “{t.id}” — they won’t follow the rename.
                </div>
              ) : null}
              {/* Why the ✓ is disabled — mirrors the Add form's messages (v15.0.1). */}
              {editing && editTrim && editTrim.indexOf("|") >= 0 ? (
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--warn-text)", marginTop: 4 }}>A table id can’t contain “|”.</div>
              ) : editing && editTrim && editTrim !== t.id && idSet[editTrim] ? (
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--warn-text)", marginTop: 4 }}>A table “{editTrim}” already exists.</div>
              ) : null}
              {confirming ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6, padding: "6px 8px", borderRadius: 8, background: "var(--warn-bg)", border: "1px solid var(--warn-border)" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--warn-text)" }}>
                    {orph > 0
                      ? orph + " upcoming booking" + (orph === 1 ? " uses “" : "s use “") + t.id + "”. Remove anyway?"
                      : "Remove table “" + t.id + "”?"}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button onClick={function () { setPendingRemove(null); }} className="mgt-hover-scale"
                      style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, background: "var(--bg-stepper)", color: "var(--text-primary)", cursor: "pointer", boxShadow: "var(--shadow-input)" }}>Cancel</button>
                    <button onClick={function () { removeTable(t.id); }} className="mgt-hover-scale"
                      style={{ border: "1px solid var(--danger-border)", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, background: "var(--danger-bg)", color: "var(--danger-text)", cursor: "pointer", boxShadow: "var(--shadow-input)" }}>{orph > 0 ? "Remove anyway" : "Remove"}</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {/* Add a table */}
        {adding ? (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input value={newId} autoFocus placeholder="id" style={{ ...TXT_INP }}
              onChange={function (e) { setNewId(e.target.value); }}
              onKeyDown={function (e) { if (e.key === "Enter" && newIdValid) addTable(); if (e.key === "Escape") { setAdding(false); setNewId(""); } }} />
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>cap</span>
            <Stepper value={newCap} disableDec={newCap <= 1} disableInc={newCap >= 20}
              onDec={function () { setNewCap(Math.max(1, newCap - 1)); }} onInc={function () { setNewCap(Math.min(20, newCap + 1)); }} />
            <button onClick={function () { setNewZone(newZone === "indoor" ? "outdoor" : "indoor"); }} className="mgt-hover-scale"
              style={{
                border: "1px solid var(--border-soft)", borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: newZone === "indoor" ? "rgba(var(--tbl-ind-rgb),0.18)" : "rgba(var(--tbl-out-rgb),0.18)",
                color: "var(--text-primary)", boxShadow: "var(--shadow-input)"
              }}>
              {newZone === "indoor" ? "Indoor" : "Outdoor"}
            </button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button onClick={addTable} disabled={!newIdValid} className={newIdValid ? "mgt-hover-scale" : undefined}
                style={{ ...ACT_BTN, opacity: newIdValid ? 1 : 0.4, cursor: newIdValid ? "pointer" : "not-allowed" }}>Add</button>
              <button onClick={function () { setAdding(false); setNewId(""); }} className="mgt-hover-scale" title="Cancel" style={X_BTN}>×</button>
            </div>
            {newIdTrim && newIdTrim.indexOf("|") >= 0 ? (
              <div style={{ width: "100%", fontSize: 11, fontWeight: 600, color: "var(--warn-text)" }}>A table id can’t contain “|”.</div>
            ) : newIdTrim && idSet[newIdTrim] ? (
              <div style={{ width: "100%", fontSize: 11, fontWeight: 600, color: "var(--warn-text)" }}>A table “{newIdTrim}” already exists.</div>
            ) : null}
          </div>
        ) : (
          <button onClick={function () { setAdding(true); }} className="mgt-hover-scale"
            style={{ marginTop: 10, ...ACT_BTN, background: "var(--bg-stepper)", color: "var(--text-primary)", border: "1px solid var(--border-soft)" }}>+ Add table</button>
        )}
      </Collapsible>
      <Collapsible
        title="Combos"
        subtitle="Joined tables for larger parties. Edit a combo's seat count; the optimizer uses these caps."
        summary={(autoCount + mega.length) + " combos"}
      >
        <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-faint)", marginBottom: 10 }}>
          Join-groups are adjacent tables that can be pushed together. Reorder with ‹ ›, remove with ×; the seat counts below update automatically.
        </div>
        {joinGroups.map(function (group, gi) {
          const runs = contiguousRuns(group);
          const last = group.length - 1;
          return (
            <div key={gi} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                {group.map(function (id, idx) {
                  return (
                    <span key={id} style={GCHIP}>
                      <button onClick={function () { moveInGroup(gi, idx, -1); }} disabled={idx === 0}
                        title="Move left" style={{ ...GCHIP_BTN, opacity: idx === 0 ? 0.3 : 1, cursor: idx === 0 ? "default" : "pointer" }}>‹</button>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", padding: "0 2px" }}>{id}</span>
                      <button onClick={function () { moveInGroup(gi, idx, 1); }} disabled={idx === last}
                        title="Move right" style={{ ...GCHIP_BTN, opacity: idx === last ? 0.3 : 1, cursor: idx === last ? "default" : "pointer" }}>›</button>
                      <button onClick={function () { removeFromGroup(gi, id); }} title="Remove from group"
                        style={{ ...GCHIP_BTN, color: "var(--danger-text)", fontSize: 15 }}>×</button>
                    </span>
                  );
                })}
                <button onClick={function () { setPickFor(pickFor === gi ? null : gi); }} className="mgt-hover-scale"
                  title="Add a table to this group" disabled={!ungrouped.length}
                  style={{ ...GCHIP_BTN, width: 26, height: 26, fontSize: 18, color: "var(--accent)", border: "1px solid var(--border-soft)", borderRadius: 8, background: "var(--bg-stepper)", boxShadow: "var(--shadow-input)", opacity: ungrouped.length ? 1 : 0.3, cursor: ungrouped.length ? "pointer" : "not-allowed" }}>+</button>
                <button onClick={function () { removeGroup(gi); }} className="mgt-hover-scale" title="Remove whole group"
                  style={{ ...X_BTN, marginLeft: "auto" }}>×</button>
              </div>
              {pickFor === gi ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "2px 0 8px" }}>
                  {ungrouped.length ? ungrouped.map(function (id) {
                    return (
                      <button key={id} onClick={function () { addToGroup(gi, id); }} className="mgt-hover-scale" style={PICK_CHIP}>{id}</button>
                    );
                  }) : <span style={{ fontSize: 11, color: "var(--text-faint)" }}>No ungrouped tables.</span>}
                </div>
              ) : null}
              {runs.map(function (run) {
                const key = comboKey(run);
                const sum = run.reduce(function (a, id) { return a + (capOf[id] || 0); }, 0);
                const overridden = comboCaps[key] != null;
                const cap = overridden ? comboCaps[key] : sum;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid var(--border-soft)" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{run.join(" + ")}</span>
                    {overridden && cap !== sum ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>sum {sum}</span>
                    ) : null}
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>seats</span>
                      <Stepper value={cap} disableDec={cap <= 1} disableInc={cap >= 60}
                        onDec={function () { setComboCap(key, cap - 1); }} onInc={function () { setComboCap(key, cap + 1); }} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div style={{ paddingTop: 8, borderTop: "1px solid var(--border-soft)", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>Ungrouped</span>
            {ungrouped.length ? (
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-faint)" }}>tap to start a new group</span>
            ) : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {ungrouped.length ? ungrouped.map(function (id) {
              return (
                <button key={id} onClick={function () { newGroupFrom(id); }} className="mgt-hover-scale" style={PICK_CHIP}>{id}</button>
              );
            }) : <span style={{ fontSize: 11, color: "var(--text-faint)" }}>none — every table is in a group</span>}
          </div>
        </div>
        <div style={{ marginTop: 8, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>
            Cross-group combos · {mega.length}
          </div>
          {mega.map(function (mc, i) {
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid var(--border-soft)" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{mc.ids.join(" + ")}</span>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>seats</span>
                  <Stepper value={mc.cap} disableDec={mc.cap <= 1} disableInc={mc.cap >= 60}
                    onDec={function () { setMegaCap(i, mc.cap - 1); }} onInc={function () { setMegaCap(i, mc.cap + 1); }} />
                  <button onClick={function () { removeMega(i); }} className="mgt-hover-scale" title="Remove combo" style={X_BTN}>×</button>
                </div>
              </div>
            );
          })}

          {/* Add a cross-group combo: pick ≥2 tables + a seat count. */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6, textAlign: "center" }}>
              Add a combo
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 8 }}>
              {tables.map(function (t) {
                const on = addIds.indexOf(t.id) >= 0;
                return (
                  <button key={t.id} onClick={function () { toggleAdd(t.id); }} className="mgt-hover-scale"
                    style={{
                      fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "5px 10px", cursor: "pointer",
                      border: on ? "1px solid var(--accent)" : "1px solid var(--border-soft)",
                      background: on ? "var(--accent)" : "var(--bg-stepper)",
                      color: on ? "var(--text-on-accent)" : "var(--text-primary)",
                      boxShadow: "var(--shadow-input)"
                    }}>
                    {t.id}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>seats</span>
              <Stepper value={addCap} disableDec={addCap <= 1} disableInc={addCap >= 60}
                onDec={function () { setAddCap(Math.max(1, addCap - 1)); }} onInc={function () { setAddCap(Math.min(60, addCap + 1)); }} />
              <button onClick={addMega} disabled={!canAdd} className={canAdd ? "mgt-hover-scale" : undefined}
                style={{
                  border: "1px solid var(--accent)", borderRadius: 8, padding: "6px 14px",
                  fontSize: 13, fontWeight: 700, background: "var(--accent)", color: "var(--text-on-accent)",
                  boxShadow: "var(--shadow-input)", opacity: canAdd ? 1 : 0.4, cursor: canAdd ? "pointer" : "not-allowed"
                }}>
                Add combo
              </button>
            </div>
            {addDup ? (
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--warn-text)", textAlign: "center", marginTop: 6 }}>
                That combo already exists.
              </div>
            ) : addIds.length === 1 ? (
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-faint)", textAlign: "center", marginTop: 6 }}>
                Pick at least 2 tables.
              </div>
            ) : null}
          </div>

        </div>
      </Collapsible>
      <Section style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Kitchen limit</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
              Max simultaneous booking starts before a kitchen-load warning.
            </div>
          </div>
          <Stepper value={kitchenLimit} disableDec={kitchenLimit <= 1} disableInc={kitchenLimit >= 20}
            onDec={() => onSaveLayout({ ...layout, kitchenLimit: kitchenLimit - 1 })}
            onInc={() => onSaveLayout({ ...layout, kitchenLimit: kitchenLimit + 1 })} />
        </div>
      </Section>
    </div>
  );
}
