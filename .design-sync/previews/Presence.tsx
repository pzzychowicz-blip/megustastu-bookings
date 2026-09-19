import { useState } from "react";
import { Presence, Toggle, mkBtn, BTN, T, FW, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

// The late-banner row: a No-show button slides in beside the name once the
// party is late enough to offer it.
export const SlideInButton = () => {
  const [late, setLate] = useState(true);
  return (
    <Surface>
      <div style={{ display: "flex", alignItems: "center", gap: SP.wide, marginBottom: SP.wide }}>
        <Toggle on={late} onClick={() => setLate(!late)} label="Party is late" />
        <span style={{ fontSize: T.body, color: "var(--text-secondary)" }}>Party is late</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: SP.base }}>
        <span style={{ fontSize: T.body, fontWeight: FW.semi, flex: 1 }}>Familia Pérez · 20:15 · 18 min late</span>
        <Presence show={late} inClass="mgt-slide-in" outClass="mgt-slide-out" tag="span">
          <button style={mkBtn({ background: BTN.orange })}>No show</button>
        </Presence>
      </div>
    </Surface>
  );
};

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", alignItems: "center", gap: SP.base }}>
      <span style={{ fontSize: T.body, fontWeight: FW.semi, flex: 1 }}>Sophie Martin · 21:00 · 22 min late</span>
      <Presence show={true} inClass="mgt-slide-in" outClass="mgt-slide-out" tag="span">
        <button style={mkBtn({ background: BTN.orange })}>No show</button>
      </Presence>
    </div>
  </Surface>
);
