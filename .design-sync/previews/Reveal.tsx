import { useState } from "react";
import { Reveal, InlineAlert, Section, mkBtn, BTN, T, FW, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

// Open by default so the card shows content; the button collapses it and
// brings it back, which is the point of the component.
function Demo({ dark = false }: { dark?: boolean }) {
  const [show, setShow] = useState(true);
  return (
    <Surface dark={dark}>
      <button style={mkBtn({ background: BTN.nav, marginBottom: SP.base })} onClick={() => setShow(!show)}>
        {show ? "Hide the error" : "Show the error"}
      </button>
      <Reveal show={show}>
        <InlineAlert>No tables available at this time — see suggestions below.</InlineAlert>
      </Reveal>
      <div style={{ fontSize: T.body, color: "var(--text-secondary)", marginTop: SP.base }}>The field below slides up and down with it — nothing snaps.</div>
    </Surface>
  );
}

export const ErrorMessage = () => <Demo />;

export const DisclosureBody = () => {
  const [open, setOpen] = useState(true);
  return (
    <Surface>
      <Section style={{ marginBottom: 0 }}>
        <button style={mkBtn({ background: "var(--app-btn-slate)" })} onClick={() => setOpen(!open)} aria-expanded={open}>Past visits (3)</button>
        <Reveal show={open}>
          <div style={{ display: "flex", flexDirection: "column", gap: SP.tight, marginTop: SP.base, fontSize: T.body }}>
            <span><b style={{ fontWeight: FW.semi }}>12 Sep</b> · 4 guests · 5A</span>
            <span><b style={{ fontWeight: FW.semi }}>29 Aug</b> · 2 guests · i2</span>
            <span><b style={{ fontWeight: FW.semi }}>3 Aug</b> · 4 guests · 5A · 5B</span>
          </div>
        </Reveal>
      </Section>
    </Surface>
  );
};

export const DarkTheme = () => <Demo dark />;
