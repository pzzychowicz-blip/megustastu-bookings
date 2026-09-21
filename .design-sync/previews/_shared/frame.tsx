// Shared by the preview cards — not a component of the design system.
//
// The card page paints a plain white body, but every MGT Bookings surface is
// TRANSLUCENT over the app background (`--bg-app`): cards, sections and
// sheets are frosted glass. Rendered straight onto white they look washed
// out, so each preview sits on this frame, which paints the page the app
// actually has. `dark` puts the subtree in the dark theme — `[data-theme="dark"]`
// in index.css is an attribute selector, so it re-themes any element, not
// just <html>.
export function Surface({ dark = false, pad = 16, children, style }: {
  dark?: boolean; pad?: number; children?: any; style?: any;
}) {
  return (
    <div
      data-theme={dark ? "dark" : undefined}
      style={{
        background: "var(--bg-app)", color: "var(--text-primary)",
        fontFamily: "var(--font-app)", padding: pad, borderRadius: 10,
        ...(style || {}),
      }}
    >
      {children}
    </div>
  );
}

// A fixed "today" for every preview, so the cards render the same on any day.
export const DAY = "2026-09-26";
