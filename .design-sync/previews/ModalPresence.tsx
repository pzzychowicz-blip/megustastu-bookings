import { ModalPresence, Overlay, ModalTitle, Section, T, SP, mkBtn } from "megustastu-bookings";
import { ModalStage } from "./_shared/backdrop";

export const OpenModal = () => (
  <ModalStage height={480}>
    <ModalPresence show={true}>
      <Overlay onClose={() => {}} footer={<div style={{ display: "flex", justifyContent: "flex-end" }}><button style={mkBtn({ background: "var(--app-btn-slate)" })}>Done</button></div>}>
        <ModalTitle background="var(--app-btn-grey-strong)">Keyboard shortcuts</ModalTitle>
        <Section style={{ marginBottom: 0 }}>
          <div style={{ fontSize: T.body, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Wrapped in ModalPresence, this sheet slides down (phone) or fades and shrinks (tablet and desktop) when it closes, instead of vanishing.
          </div>
        </Section>
      </Overlay>
    </ModalPresence>
  </ModalStage>
);
