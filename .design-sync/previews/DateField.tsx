import { useState } from "react";
import { DateField, Fld, Section, mkInp, SP, H, T } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

function Live({ initial, dark = false }: { initial: string; dark?: boolean }) {
  const [v, setV] = useState(initial);
  return (
    <Surface dark={dark}>
      <Section style={{ marginBottom: 0 }}>
        <Fld label="Date">{(id, attrs) => <DateField value={v} onChange={(e) => setV(e.target.value)} style={mkInp()} inputProps={{ id, ...attrs }} />}</Fld>
      </Section>
    </Surface>
  );
}

export const InAForm = () => <Live initial="2026-09-26" />;

export const HeaderChrome = () => (
  <Surface>
    <div style={{ display: "flex", alignItems: "center", gap: SP.base }}>
      <DateField value="2026-10-02" onChange={() => {}} inputProps={{ "aria-label": "Viewed date" }}
        style={{ ...mkInp(), width: "auto", height: H.chrome, padding: "6px 12px", fontSize: T.lead }} />
    </div>
  </Surface>
);

export const DarkTheme = () => <Live initial="2026-12-31" dark />;
