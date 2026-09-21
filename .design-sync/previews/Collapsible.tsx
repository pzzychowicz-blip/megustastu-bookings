import { Collapsible, Toggle, T, FW, SP, mkStep } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

const DAYS = [["Mon", "13:00–22:00"], ["Tue", "13:00–22:00"], ["Wed", "Closed"], ["Thu", "13:00–22:00"], ["Fri", "13:00–23:00"], ["Sat", "13:00–23:00"], ["Sun", "13:00–22:00"]];

export const Collapsed = () => (
  <Surface>
    <Collapsible title="Opening hours" subtitle="Per weekday. A closed day blocks new bookings." summary="6 days · 13:00–23:00">
      <div />
    </Collapsible>
    <Collapsible title="Running late" summary="after 15 min" style={{ marginBottom: 0 }}>
      <div />
    </Collapsible>
  </Surface>
);

export const Open = () => (
  <Surface>
    <Collapsible title="Opening hours" subtitle="Per weekday. A closed day blocks new bookings." summary="6 days · 13:00–23:00" defaultOpen style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: SP.snug }}>
        {DAYS.map(([d, h]) => (
          <div key={d} style={{ display: "flex", alignItems: "center", gap: SP.wide }}>
            <span style={{ width: 40, fontSize: T.body, fontWeight: FW.semi }}>{d}</span>
            <span style={{ flex: 1, fontSize: T.body, color: h === "Closed" ? "var(--text-faint)" : "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{h}</span>
            <button style={mkStep()} aria-label={"Earlier close on " + d}>−</button>
            <button style={mkStep()} aria-label={"Later close on " + d}>+</button>
          </div>
        ))}
      </div>
    </Collapsible>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <Collapsible title="Preferences" subtitle="Party-size defaults for the booking form." defaultOpen style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: T.body, fontWeight: FW.medium }}>Suggest joined tables for 7+</span>
        <Toggle on={true} onClick={() => {}} label="Suggest joined tables for 7+" />
      </div>
    </Collapsible>
  </Surface>
);
