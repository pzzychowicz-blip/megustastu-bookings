// Shared by the icon previews — not a component of the design system.
//
// One card per icon: the three role sizes of the IC scale (inline 12, control
// 14, chrome 18), then the icon where it actually lives — on a labelled pill
// button and an icon-only round one — in the light theme and the dark. Icons
// draw in currentColor, so each row sets `color` rather than the icon.
import { IC, T, FW, SP, R, BTN, mkBtn } from "megustastu-bookings";

function Panel({ dark, Icon, label }: { dark: boolean; Icon: any; label: string }) {
  const sizes: Array<[number, string]> = [[IC.inline, "inline"], [IC.control, "control"], [IC.chrome, "chrome"]];
  return (
    <div data-theme={dark ? "dark" : undefined}
      style={{ flex: "1 1 260px", background: "var(--bg-app)", color: "var(--text-primary)", fontFamily: "var(--font-app)", borderRadius: R.card, padding: SP.section }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: SP.gutter, marginBottom: SP.wide }}>
        {sizes.map(([s, name]) => (
          <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: SP.tight }}>
            <Icon size={s} />
            <span style={{ fontSize: T.micro, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{s + " · " + name}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: SP.base, flexWrap: "wrap" }}>
        <button style={mkBtn({ background: BTN.nav, display: "inline-flex", alignItems: "center", gap: 6 })}>
          <Icon size={IC.control} />{label}
        </button>
        <button aria-label={label} title={label} style={mkBtn({ background: "var(--app-btn-grey)", width: 40, height: 40, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" })}>
          <Icon size={IC.chrome} />
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: T.body, fontWeight: FW.semi, color: "var(--text-secondary)" }}>
          <Icon size={IC.inline} />{label}
        </span>
      </div>
    </div>
  );
}

export function IconCard({ Icon, label }: { Icon: any; label: string }) {
  return (
    <div style={{ display: "flex", gap: SP.wide, flexWrap: "wrap" }}>
      <Panel dark={false} Icon={Icon} label={label} />
      <Panel dark Icon={Icon} label={label} />
    </div>
  );
}
