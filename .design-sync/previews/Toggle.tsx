import { useState } from "react";
import { Toggle, Section, T, FW, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

function Row({ label, hint, on, disabled = false }: { label: string; hint?: string; on: boolean; disabled?: boolean }) {
  const [v, setV] = useState(on);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: SP.wide, padding: "8px 0" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: T.body, fontWeight: FW.medium, color: "var(--text-primary)" }}>{label}</div>
        {hint ? <div style={{ fontSize: T.small, color: "var(--text-faint)", marginTop: 2 }}>{hint}</div> : null}
      </div>
      <Toggle on={v} onClick={() => setV(!v)} label={label} disabled={disabled} />
    </div>
  );
}

export const OnAndOff = () => (
  <Surface>
    <div style={{ display: "flex", gap: SP.section, alignItems: "center" }}>
      <Toggle on={true} onClick={() => {}} label="Example on" />
      <Toggle on={false} onClick={() => {}} label="Example off" />
      <Toggle on={true} onClick={() => {}} label="Example disabled" disabled />
    </div>
  </Surface>
);

export const SettingsRows = () => (
  <Surface>
    <Section style={{ marginBottom: 0 }}>
      <Row label="Reduce animations" hint="This device only" on={false} />
      <Row label="Automatic dark mode" hint="Follows the system appearance" on={true} />
      <Row label="Dark mode" hint="Controlled by Automatic dark mode" on={true} disabled />
    </Section>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <Section style={{ marginBottom: 0 }}>
      <Row label="Split view" on={true} />
      <Row label="Lock navigation" on={false} />
    </Section>
  </Surface>
);
