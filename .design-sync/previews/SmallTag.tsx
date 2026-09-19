import { SmallTag, StarIcon, DepositIcon, LockIcon, IC, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

const TAG = { background: "var(--bg-veil)", color: "var(--text-secondary)" };

export const WithIcons = () => (
  <Surface>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.snug }}>
      <SmallTag label={<><StarIcon size={IC.inline} /> 5A · 5B</>} style={TAG} />
      <SmallTag label={<><DepositIcon size={IC.inline} /> €30 deposit</>} style={TAG} />
      <SmallTag label={<><LockIcon size={IC.inline} /> manual</>} style={TAG} />
    </div>
  </Surface>
);

export const TextOnly = () => (
  <Surface>
    <div style={{ display: "flex", flexWrap: "wrap", gap: SP.snug }}>
      <SmallTag label="Repeats weekly" style={TAG} />
      <SmallTag label="Terrace" style={{ background: "var(--accent)", color: "var(--text-on-accent)" }} />
    </div>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", gap: SP.snug }}>
      <SmallTag label={<><StarIcon size={IC.inline} /> i2</>} style={TAG} />
      <SmallTag label="Repeats weekly" style={TAG} />
    </div>
  </Surface>
);
