import { Section, Fld, mkInp, T, FW, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

export const FieldGroup = () => (
  <Surface>
    <Section style={{ marginBottom: 0 }}>
      <div style={{ fontSize: T.lead, fontWeight: FW.semi, marginBottom: SP.base }}>Deposit</div>
      <Fld label="Amount (€)">{(id, attrs) => <input id={id} {...attrs} type="number" style={mkInp()} defaultValue="30" />}</Fld>
      <div style={{ fontSize: T.small, color: "var(--text-faint)", marginTop: SP.snug }}>Shown on the booking as a banknote flag.</div>
    </Section>
  </Surface>
);

export const Stacked = () => (
  <Surface>
    <Section><div style={{ fontSize: T.body }}>Tuesday · 38 covers across 14 bookings</div></Section>
    <Section style={{ marginBottom: 0 }}><div style={{ fontSize: T.body, color: "var(--text-secondary)" }}>Lunch 13:00–16:00 · Dinner 19:00–22:00</div></Section>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <Section style={{ marginBottom: 0 }}>
      <div style={{ fontSize: T.lead, fontWeight: FW.semi, marginBottom: SP.tight }}>Notes</div>
      <div style={{ fontSize: T.body, color: "var(--text-secondary)" }}>Anniversary. Window table if possible.</div>
    </Section>
  </Surface>
);
