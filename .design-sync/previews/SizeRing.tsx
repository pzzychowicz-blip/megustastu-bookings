import { SizeRing, BLOCK_BG, BLOCK_INK, T, FW, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

// On a booking block: the default rim, white digit (the block's own ink).
function Block({ status, name, n }: { status: string; name: string; n: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: SP.snug, background: BLOCK_BG[status], color: BLOCK_INK[status], borderRadius: 6, padding: "6px 8px", width: 200 }}>
      <span style={{ fontSize: T.body, fontWeight: FW.semi, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      <SizeRing n={n} />
    </div>
  );
}

export const OnBookingBlocks = () => (
  <Surface>
    <div style={{ display: "flex", flexDirection: "column", gap: SP.snug }}>
      <Block status="confirmed" name="Sophie Martin" n={2} />
      <Block status="pending" name="Familia Pérez" n={6} />
      <Block status="seated" name="Marco Bianchi" n={4} />
    </div>
  </Surface>
);

export const OnACard = () => (
  <Surface>
    <div style={{ display: "flex", alignItems: "center", gap: SP.base, fontSize: T.title, fontWeight: FW.semi }}>
      Lucía Hernández <SizeRing n={4} rim="var(--chip-neutral-border)" />
    </div>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", alignItems: "center", gap: SP.base, fontSize: T.title, fontWeight: FW.semi }}>
      Ana Ruiz <SizeRing n={3} rim="var(--chip-neutral-border)" />
    </div>
  </Surface>
);
