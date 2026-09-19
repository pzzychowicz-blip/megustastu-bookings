import { Kbd, T, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

const ROWS: [string[], string][] = [
  [["T"], "Timeline view"],
  [["L"], "List view"],
  [["P"], "Plan (floor) view"],
  [["←", "→"], "Previous / next day"],
  [["N"], "New booking"],
  [["W"], "Walk-in"],
  [["/"], "Find a booking (any date)"],
];

function Rows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SP.base }}>
      {ROWS.map(([keys, label]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: SP.wide }}>
          <span style={{ display: "inline-flex", gap: SP.tight, minWidth: 64 }}>{keys.map((k) => <Kbd key={k} k={k} />)}</span>
          <span style={{ fontSize: T.body, color: "var(--text-secondary)" }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

export const ShortcutList = () => <Surface><Rows /></Surface>;

export const DarkTheme = () => <Surface dark><Rows /></Surface>;
