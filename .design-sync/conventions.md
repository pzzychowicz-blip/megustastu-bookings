# MGT Bookings — how to design with this system

MGT Bookings is the staff-only booking app of Me Gustas Tú, a restaurant in the Canary Islands. Staff run it mid-service on tablets and phones, so every screen is read at a glance and tapped with one hand. Design with the real components and tokens below. Don't imitate them with new CSS.

**Styling is inline style objects built from the token scales** on `window.MGTBookings`: `R` (radius), `T` (font size), `FW` (weight), `SP` (spacing), `H` (control height), `IC` (icon size), `M` (motion), `BTN` (button fills), `S` (core colours). Colours are CSS custom properties from `styles.css` (`var(--text-primary)`, `var(--bg-card)` …). Never use a hex or rgb literal.

**Theme.** Light by default. Dark is `data-theme="dark"` on any ancestor, and every token flips with it. Paint a page with `var(--bg-app)`. Text is `var(--text-primary)`, then `var(--text-secondary)`, then `var(--text-muted)`. Put a colour token only on a surface that flips with it.

**Controls.** `mkBtn({ background: BTN.nav })` is the pill button and `mkSolidBtn("var(--app-new)")` the primary action. Fields: `mkInp()`, `mkSel()`, `mkArea()`, and `mkStep()` for − / + steppers. All of them return style objects to spread into `style`. Label every field with `Fld`. Group a form in `Section` cards. `Toggle` is the on/off switch.

**Booking status is never colour alone.** pending yellow · confirmed amber · seated green · completed grey · cancelled red. Fill with `BLOCK_BG[status]`, draw the ink with `BLOCK_INK[status]`, and always add the mark: `SBadge` for a label, or `StatusIcon` inside a block.

**Tables.** Outdoor ids are teal and indoor ids purple (`TBL.out` / `TBL.ind`); draw an id with `TBadge`. The party size goes in a `SizeRing`.

**Modals** are always `Overlay`: a `ModalTitle` first, and the action row in `footer`. Animate the close with `ModalPresence`. Never hand-build a scrim or a blurred card. At most four `backdrop-filter` blurs may be on screen at once, and an `Overlay` already uses two. Colour the title by what the modal does: `var(--app-new)` for a new booking, `var(--app-walkin)` for a walk-in, `var(--accent)` for table assignment, `var(--app-btn-grey-strong)` for settings and read-only.

**Messages.** A refused action keeps its field looking normal and says why in an `InlineAlert` (tones in `ALERT_TONES`). A passing confirmation is a toast. Use the app's plain wording: "Customer name is required.", "No tables available at this time — see suggestions below."

**Icons** are 24-grid line icons drawn in `currentColor`. Size them by role: `IC.inline` 12 in text, `IC.control` 14 on a control, `IC.chrome` 18 in the header. An icon-only button needs an `aria-label`.

**Motion.** Anything that appears also leaves. Wrap it in `Reveal`, `Presence` or `AutoHeight`, never a hard cut.

**Screens.** `TimelineView`, `ListView`, `PlanView`, `WeekView`, `BookingFormModal`, `TableGrid`, `MessageBubble`. Each takes every booking the app holds and filters to its own date; their docs give the booking shape. Times are 24-hour ("19:45–21:15"), and money is shown in €.
