import { StatusIcon, BLOCK_BG, BLOCK_INK, IC, T, FW, SP, R, RIM_SOLID } from "megustastu-bookings";

const STATUSES = ["pending", "confirmed", "seated", "completed", "cancelled"];

// The five marks on the fills they are drawn on (BLOCK_BG with its BLOCK_INK),
// as a timeline block or floor-plan table carries them, plus the bare mark at
// the three role sizes.
function Panel({ dark }: { dark: boolean }) {
  return (
    <div data-theme={dark ? "dark" : undefined}
      style={{ flex: "1 1 300px", background: "var(--bg-app)", color: "var(--text-primary)", fontFamily: "var(--font-app)", borderRadius: R.card, padding: SP.section, display: "flex", flexDirection: "column", gap: SP.base }}>
      {STATUSES.map((s) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: SP.wide }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 128, padding: "4px 10px", borderRadius: R.pill, background: BLOCK_BG[s], color: BLOCK_INK[s] || "var(--text-on-accent)", border: RIM_SOLID, fontSize: T.body, fontWeight: FW.semi, textTransform: "capitalize" }}>
            <StatusIcon status={s} size={IC.control} />{s}
          </span>
          <span style={{ display: "inline-flex", alignItems: "flex-end", gap: SP.base, color: "var(--text-primary)" }}>
            <StatusIcon status={s} size={IC.inline} />
            <StatusIcon status={s} size={IC.control} />
            <StatusIcon status={s} size={IC.chrome} />
          </span>
        </div>
      ))}
    </div>
  );
}

export const AllStatuses = () => (
  <div style={{ display: "flex", gap: SP.wide, flexWrap: "wrap" }}>
    <Panel dark={false} />
    <Panel dark />
  </div>
);
