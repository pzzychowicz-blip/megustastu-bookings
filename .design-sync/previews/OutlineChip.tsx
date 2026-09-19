import { OutlineChip, ChevronRightIcon, IC, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

export const Tones = () => (
  <Surface>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.snug }}>
      <OutlineChip tone="success">3 visits</OutlineChip>
      <OutlineChip tone="warn">1 no-show</OutlineChip>
      <OutlineChip tone="danger">Kitchen busy</OutlineChip>
      <OutlineChip tone="neutral">On the waitlist</OutlineChip>
    </div>
  </Surface>
);

export const SmallSize = () => (
  <Surface>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.snug }}>
      <OutlineChip tone="success" size="small">Regular · 5 past visits</OutlineChip>
      <OutlineChip tone="warn" size="small">2 no-shows</OutlineChip>
    </div>
  </Surface>
);

export const AsDisclosureButton = () => (
  <Surface>
    <OutlineChip as="button" tone="success" size="small" aria-expanded="false">
      Regular · 5 past visits <ChevronRightIcon size={IC.inline} />
    </OutlineChip>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", gap: SP.snug }}>
      <OutlineChip tone="success">3 visits</OutlineChip>
      <OutlineChip tone="warn">1 no-show</OutlineChip>
      <OutlineChip tone="neutral">No phone</OutlineChip>
    </div>
  </Surface>
);
