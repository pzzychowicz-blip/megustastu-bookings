import { TBadge, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

const OUT = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const IN = ["10", "11", "12", "13"];

export const AllTables = () => (
  <Surface>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.snug }}>{OUT.map((t) => <TBadge key={t} id={t} />)}</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.snug, marginTop: SP.base }}>{IN.map((t) => <TBadge key={t} id={t} />)}</div>
  </Surface>
);

export const JoinedTables = () => (
  <Surface>
    <div style={{ display: "flex", gap: SP.snug }}><TBadge id="6" /><TBadge id="7" /></div>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", gap: SP.snug }}><TBadge id="4" /><TBadge id="11" /></div>
  </Surface>
);
