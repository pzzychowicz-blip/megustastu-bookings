import { SBadge, SizeRing, TBadge, T, FW, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

const STATUSES = ["pending", "confirmed", "seated", "completed", "cancelled"];

export const AllStatuses = () => (
  <Surface>
    <div style={{ display: "flex", gap: SP.base, flexWrap: "wrap" }}>
      {STATUSES.map((s) => <SBadge key={s} status={s} />)}
    </div>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", gap: SP.base, flexWrap: "wrap" }}>
      {STATUSES.map((s) => <SBadge key={s} status={s} />)}
    </div>
  </Surface>
);

export const InACardHeader = () => (
  <Surface>
    <div style={{ display: "flex", alignItems: "center", gap: SP.base, background: "var(--bg-card-strong)", border: "1px solid var(--border-card)", borderRadius: 14, padding: "10px 14px" }}>
      <span style={{ fontSize: T.title, fontWeight: FW.bold, fontVariantNumeric: "tabular-nums" }}>20:30</span>
      <span style={{ fontSize: T.title, fontWeight: FW.semi, flex: 1 }}>Lucía Hernández</span>
      <SizeRing n={4} rim="var(--chip-neutral-border)" />
      <SBadge status="seated" />
      <TBadge id="5A" />
    </div>
  </Surface>
);
