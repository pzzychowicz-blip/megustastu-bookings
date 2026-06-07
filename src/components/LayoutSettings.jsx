// src/components/LayoutSettings.jsx
// v15.0.0: Settings → Layout tab — the restaurant's physical table layout (each
// table's capacity + zone) + the kitchen limit. Firebase-shared via useLayout
// (settings/layout). Fully controlled: each change calls onSaveLayout with the
// next config; the Firebase echo re-renders. v15.0.0 ships capacity + zone editing
// of the existing tables; add/remove tables + join-groups/combos arrive in Phase 4.

import { Section } from "./atoms";

// Compact ±1 stepper (no label) — mirrors Settings.jsx's MiniStepper contract.
const STEP_BTN = {
  background: "var(--bg-stepper)", border: "1px solid var(--border-soft)",
  borderRadius: 8, width: 30, height: 30, fontSize: 17, fontWeight: 600,
  color: "var(--text-primary)",
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  boxShadow: "var(--shadow-input)"
};
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

// One table row: id · capacity stepper · Indoor/Outdoor zone pill. Zone tint uses
// the shared --tbl-ind-rgb / --tbl-out-rgb tokens so it flips with the theme.
function TableRow({ table, onCap, onZone }) {
  const cap = Number.isFinite(table.capacity) ? table.capacity : 2;
  const indoor = table.zone === "indoor";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--border-soft)" }}>
      <span style={{ width: 44, fontSize: 13, fontWeight: 700, color: "var(--text-primary)", flexShrink: 0 }}>{table.id}</span>
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>cap</span>
      <Stepper value={cap} disableDec={cap <= 1} disableInc={cap >= 20}
        onDec={() => onCap(cap - 1)} onInc={() => onCap(cap + 1)} />
      <button onClick={() => onZone(indoor ? "outdoor" : "indoor")} className="mgt-hover-scale"
        style={{
          marginLeft: "auto", border: "1px solid var(--border-soft)", borderRadius: 8,
          padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0,
          background: indoor ? "rgba(var(--tbl-ind-rgb),0.18)" : "rgba(var(--tbl-out-rgb),0.18)",
          color: "var(--text-primary)", boxShadow: "var(--shadow-input)"
        }}>
        {indoor ? "Indoor" : "Outdoor"}
      </button>
    </div>
  );
}

export function LayoutTabContent({ layout, onSaveLayout = () => {} }) {
  const tables = (layout && Array.isArray(layout.tables)) ? layout.tables : [];
  const kitchenLimit = layout && Number.isFinite(layout.kitchenLimit) ? layout.kitchenLimit : 3;
  const totalSeats = tables.reduce((a, t) => a + (Number(t.capacity) || 0), 0);
  const indoorCount = tables.filter((t) => t.zone === "indoor").length;
  const outdoorCount = tables.length - indoorCount;

  function updateTable(id, patch) {
    onSaveLayout({ ...layout, tables: tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }

  return (
    <div>
      <Section style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Tables</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)", marginTop: 2 }}>
          Each table's capacity and zone. Shared across all devices.
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginTop: 4, marginBottom: 2 }}>
          {outdoorCount} outdoor · {indoorCount} indoor · {totalSeats} seats total
        </div>
        {tables.map((t) => (
          <TableRow key={t.id} table={t}
            onCap={(c) => updateTable(t.id, { capacity: c })}
            onZone={(z) => updateTable(t.id, { zone: z })} />
        ))}
      </Section>
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
