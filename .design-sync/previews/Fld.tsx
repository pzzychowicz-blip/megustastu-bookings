import { Fld, Section, InlineAlert, mkInp, mkSel, mkStep, T, FW, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

export const SingleControls = () => (
  <Surface>
    <Section style={{ marginBottom: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SP.wide }}>
        <Fld label="Customer name" req>{(id, attrs) => <input id={id} {...attrs} style={mkInp()} defaultValue="Marco Bianchi" />}</Fld>
        <Fld label="Phone number">{(id, attrs) => <input id={id} {...attrs} type="tel" style={mkInp()} defaultValue="+39 347 555 0192" />}</Fld>
        <Fld label="Seating preference">{(id, attrs) => (
          <select id={id} {...attrs} style={mkSel()} defaultValue="out">
            <option value="auto">Auto (recommended)</option><option value="out">Outdoor</option><option value="in">Indoor</option>
          </select>)}</Fld>
        <Fld label="Deposit (€)">{(id, attrs) => <input id={id} {...attrs} type="number" style={mkInp()} defaultValue="20" />}</Fld>
      </div>
    </Section>
  </Surface>
);

export const InvalidWithMessage = () => (
  <Surface>
    <Section style={{ marginBottom: 0 }}>
      <div id="form-err" style={{ marginBottom: SP.base }}>
        <InlineAlert>Customer name is required.</InlineAlert>
      </div>
      <Fld label="Customer name" req invalid describedBy="form-err">{(id, attrs) => <input id={id} {...attrs} style={mkInp()} defaultValue="" />}</Fld>
    </Section>
  </Surface>
);

export const CompositeGroup = () => (
  <Surface>
    <Section style={{ marginBottom: 0 }}>
      <Fld label="Number of guests">
        <div style={{ display: "flex", alignItems: "center", gap: SP.base }}>
          <button style={mkStep()} aria-label="Fewer guests">−</button>
          <span style={{ fontSize: T.title, fontWeight: FW.bold, minWidth: 24, textAlign: "center" }}>6</span>
          <button style={mkStep()} aria-label="More guests">+</button>
        </div>
      </Fld>
    </Section>
  </Surface>
);
