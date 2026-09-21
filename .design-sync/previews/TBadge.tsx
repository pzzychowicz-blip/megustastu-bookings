import { TBadge, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

const OUT = ["1A", "1B", "2", "3", "4", "5A", "5B", "6", "7"];
const IN = ["i1", "i2", "i3", "i4"];

export const AllTables = () => (
  <Surface>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.snug }}>{OUT.map((t) => <TBadge key={t} id={t} />)}</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.snug, marginTop: SP.base }}>{IN.map((t) => <TBadge key={t} id={t} />)}</div>
  </Surface>
);

export const JoinedTables = () => (
  <Surface>
    <div style={{ display: "flex", gap: SP.snug }}><TBadge id="5A" /><TBadge id="5B" /></div>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", gap: SP.snug }}><TBadge id="3" /><TBadge id="i2" /></div>
  </Surface>
);
