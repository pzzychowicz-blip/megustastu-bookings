import { ModalTitle, BLOCK_BG, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

export const CreateAndAct = () => (
  <Surface>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.wide, justifyContent: "center" }}>
      <ModalTitle background="var(--app-new)" marginBottom={0}>New booking</ModalTitle>
      <ModalTitle background="var(--app-walkin)" marginBottom={0}>Walk-in</ModalTitle>
      <ModalTitle background="var(--accent)" marginBottom={0}>Assign tables</ModalTitle>
      <ModalTitle background="var(--btn-tables)" marginBottom={0}>Preferred tables</ModalTitle>
      <ModalTitle background={BLOCK_BG.pending} marginBottom={0}>Waitlist</ModalTitle>
    </div>
  </Surface>
);

export const ConfigureAndRead = () => (
  <Surface>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.wide, justifyContent: "center" }}>
      <ModalTitle background="var(--app-btn-grey-strong)" marginBottom={0}>Settings</ModalTitle>
      <ModalTitle background="var(--app-btn-grey-strong)" marginBottom={0}>Find a booking</ModalTitle>
    </div>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.wide, justifyContent: "center" }}>
      <ModalTitle background="var(--app-new)" marginBottom={0}>New booking</ModalTitle>
      <ModalTitle background="var(--app-btn-grey-strong)" marginBottom={0}>Settings</ModalTitle>
    </div>
  </Surface>
);
