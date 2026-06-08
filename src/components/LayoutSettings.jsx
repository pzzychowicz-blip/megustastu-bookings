// src/components/LayoutSettings.jsx
// v15.0.0: Settings → Layout tab — the restaurant's physical table layout (each
// table's capacity + zone) + the kitchen limit. Firebase-shared via useLayout
// (settings/layout). Fully controlled: each change calls onSaveLayout with the
// next config; the Firebase echo re-renders. v15.0.0 ships capacity + zone editing
// of the existing tables; add/remove tables + join-groups/combos arrive in Phase 4.

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

  return (
    <div>
      <Collapsible
        title="Tables"
        subtitle="Each table's capacity and zone. Shared across all devices."
        summary={tables.length + " tables · " + totalSeats + " seats"}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 2 }}>
          {outdoorCount} outdoor · {indoorCount} indoor · {totalSeats} seats total
        </div>
        {tables.map((t) => (
          <TableRow key={t.id} table={t}
            onCap={(c) => updateTable(t.id, { capacity: c })}
            onZone={(z) => updateTable(t.id, { zone: z })} />
        ))}
      </Collapsible>
      <Collapsible
        title="Combos"
        subtitle="Joined tables for larger parties. Edit a combo's seat count; the optimizer uses these caps."
        summary={(autoCount + mega.length) + " combos"}
      >
        {joinGroups.map(function (group, gi) {
          const runs = contiguousRuns(group);
          if (!runs.length) return null;
          return (
            <div key={gi} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 2 }}>
                {group.join(" · ")}
              </div>
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
        {mega.length ? (
          <div style={{ marginTop: 8, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>
              Cross-group combos · {mega.length}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {mega.map(function (mc, i) {
                return (
                  <span key={i} style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", background: "var(--bg-stepper)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "3px 8px" }}>
                    {mc.ids.join("+")} · {mc.cap}
                  </span>
                );
              })}
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-faint)", marginTop: 8 }}>
              Editing cross-group combos and join-groups (and adding/removing tables) is set in config — UI for these arrives in a later update.
            </div>
          </div>
        ) : null}
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
