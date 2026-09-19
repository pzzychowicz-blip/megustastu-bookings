import { useState } from "react";
import { AutoHeight, Section, mkBtn, BTN, T, FW, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

const WEEK = [["Mon 21", 24], ["Tue 22", 31], ["Wed 23", 0], ["Thu 24", 29], ["Fri 25", 52], ["Sat 26", 64], ["Sun 27", 41]];

export const TabSwap = () => {
  const [tab, setTab] = useState("week");
  return (
    <Surface>
      <div style={{ display: "flex", gap: SP.snug, marginBottom: SP.base }}>
        <button style={mkBtn({ background: tab === "week" ? "var(--accent)" : BTN.nav })} onClick={() => setTab("week")}>Week</button>
        <button style={mkBtn({ background: tab === "note" ? "var(--accent)" : BTN.nav })} onClick={() => setTab("note")}>Note</button>
      </div>
      <Section style={{ marginBottom: 0 }}>
        <AutoHeight watch={tab}>
          {tab === "week" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: SP.snug }}>
              {WEEK.map(([d, c]) => (
                <div key={d as string} style={{ display: "flex", justifyContent: "space-between", fontSize: T.body }}>
                  <span style={{ fontWeight: FW.semi }}>{d}</span>
                  <span style={{ color: c ? "var(--text-primary)" : "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{c ? c + " covers" : "Closed"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: T.body, color: "var(--text-secondary)" }}>Switching tabs eases the card to its new height instead of jumping.</div>
          )}
        </AutoHeight>
      </Section>
    </Surface>
  );
};
