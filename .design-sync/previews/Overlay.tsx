import { Overlay, ModalTitle, Fld, Section, DateField, InlineAlert, mkInp, mkArea, mkBtn, mkSolidBtn, mkStep, T, FW, SP } from "megustastu-bookings";
import { ModalStage } from "./_shared/backdrop";

function Footer({ primary, colour }: { primary: string; colour: string }) {
  return (
    <div style={{ display: "flex", gap: SP.base, justifyContent: "flex-end" }}>
      <button style={mkBtn({ background: "var(--app-btn-slate)" })}>Back</button>
      <button style={mkSolidBtn(colour)}>{primary}</button>
    </div>
  );
}

export const FormWithFooter = () => (
  <ModalStage>
    <Overlay onClose={() => {}} footer={<Footer primary="Save booking" colour="var(--app-new)" />}>
      <ModalTitle background="var(--app-new)">New booking</ModalTitle>
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SP.wide }}>
          <Fld label="Customer name" req>{(id, attrs) => <input id={id} {...attrs} style={mkInp()} defaultValue="Lucía Hernández" />}</Fld>
          <Fld label="Phone number">{(id, attrs) => <input id={id} {...attrs} type="tel" style={mkInp()} defaultValue="+34 612 345 678" />}</Fld>
          <Fld label="Date">{(id, attrs) => <DateField value="2026-09-26" onChange={() => {}} style={mkInp()} inputProps={{ id, ...attrs }} />}</Fld>
          <Fld label="Time">{(id, attrs) => <input id={id} {...attrs} type="time" style={mkInp()} defaultValue="20:30" />}</Fld>
        </div>
      </Section>
      <Section>
        <Fld label="Number of guests">
          <div style={{ display: "flex", alignItems: "center", gap: SP.base }}>
            <button style={mkStep()} aria-label="Fewer guests">−</button>
            <span style={{ fontSize: T.title, fontWeight: FW.bold, minWidth: 24, textAlign: "center" }}>4</span>
            <button style={mkStep()} aria-label="More guests">+</button>
          </div>
        </Fld>
      </Section>
      <Fld label="Notes">{(id, attrs) => <textarea id={id} {...attrs} rows={2} style={mkArea()} defaultValue="Birthday — one guest is coeliac." />}</Fld>
    </Overlay>
  </ModalStage>
);

export const RefusedSave = () => (
  <ModalStage>
    <Overlay onClose={() => {}} footer={<Footer primary="Save booking" colour="var(--app-new)" />}>
      <ModalTitle background="var(--app-new)">New booking</ModalTitle>
      <InlineAlert style={{ marginBottom: SP.roomy }}>No tables available at this time — see suggestions below.</InlineAlert>
      <Section style={{ marginBottom: 0 }}>
        <Fld label="Time" invalid describedBy="t-err">{(id, attrs) => <input id={id} {...attrs} type="time" style={mkInp()} defaultValue="20:30" />}</Fld>
      </Section>
    </Overlay>
  </ModalStage>
);

export const ReadOnlyDark = () => (
  <ModalStage dark>
    <div>
      <Overlay onClose={() => {}}>
        <ModalTitle background="var(--app-btn-grey-strong)">Find a booking</ModalTitle>
        <Section style={{ marginBottom: 0 }}>
          <div style={{ fontSize: T.body, color: "var(--text-secondary)" }}>Search by name or phone across every date — upcoming first.</div>
        </Section>
      </Overlay>
    </div>
  </ModalStage>
);
