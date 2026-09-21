import { InlineAlert, ALERT_TONES, LateIcon, OfflineIcon, CheckIcon, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

export const Danger = () => (
  <Surface>
    <InlineAlert>No tables available at this time — see suggestions below.</InlineAlert>
  </Surface>
);

export const AllRoles = () => (
  <Surface>
    <div style={{ display: "flex", flexDirection: "column", gap: SP.base }}>
      <InlineAlert>Customer name is required.</InlineAlert>
      <InlineAlert {...ALERT_TONES.warn} icon={LateIcon}>Kitchen is busy at 20:00 — three tables start then.</InlineAlert>
      <InlineAlert {...ALERT_TONES.success} icon={CheckIcon}>Table 5A is free from 21:15.</InlineAlert>
      <InlineAlert {...ALERT_TONES.offline} icon={OfflineIcon}>Working offline — changes will sync when the connection returns.</InlineAlert>
    </div>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", flexDirection: "column", gap: SP.base }}>
      <InlineAlert>Please set a date.</InlineAlert>
      <InlineAlert {...ALERT_TONES.warn} icon={LateIcon}>Kitchen is busy at 20:00.</InlineAlert>
    </div>
  </Surface>
);
