import { useState } from "react";
import { SlideView, Section, mkBtn, BTN, T, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

const VIEWS = ["Timeline", "List", "Plan"];

export const ViewSwitch = () => {
  const [i, setI] = useState(1);
  const [dir, setDir] = useState("mgt-view-fade");
  function go(n: number) { setDir(n > i ? "mgt-view-in-right" : "mgt-view-in-left"); setI(n); }
  return (
    <Surface>
      <div style={{ display: "flex", gap: SP.snug, marginBottom: SP.base }}>
        {VIEWS.map((v, n) => (
          <button key={v} style={mkBtn({ background: n === i ? "var(--accent)" : BTN.nav })} onClick={() => go(n)}>{v}</button>
        ))}
      </div>
      <SlideView key={i} dir={dir}>
        <Section style={{ marginBottom: 0 }}>
          <div style={{ fontSize: T.body }}>{VIEWS[i]} view — switching views slides it 28px in the direction you moved; a date change only fades.</div>
        </Section>
      </SlideView>
    </Surface>
  );
};
