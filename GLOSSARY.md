# GLOSSARY.md

The vocabulary of **MGT Bookings** — one name per thing, so a
conversation about the app doesn't spend half its time establishing what is
being pointed at.

Three columns throughout: **what you see** on screen · the **correct term**
(with the code identifier, so the row is greppable) · **what it does**.

**This file names things. It does not decide them.**
[`DESIGN.md`](DESIGN.md) owns the visual system and the reasoning behind every
treatment; [`CLAUDE.md`](CLAUDE.md) owns the architecture, the data rules and
the gotchas. Where a row here summarises one of them, those files win — this is
an index into them, and a third answer living here would be the exact defect
both of them warn about.

**Keep it current the way you keep `ROADMAP.md` current**: a version that adds a
user-visible surface adds its row here, in the same PR. A glossary that lags is
worse than none, because it is quoted with confidence.

Sections 1–11 are all **the shipped app** as of v18.0.0 phase 5. Section 10 was
the **WhatsApp sandbox** for eight versions, and the distinction it carried —
"real code you can read, none of it in the app the restaurant runs" — mattered
more than any other in this file. It is gone: the module is merged, and what
replaces it is a weaker but still real line. WhatsApp is **shipped and switched
off**, so its surfaces exist in the build and are absent from a restaurant whose
admin has not enabled the module. The one thing still not shipped is the
**simulator** (§10, `WaSimulator.jsx`), which is DEV-only by construction.

---

## 1. Views and navigation

| What you see | Correct term | What it does |
|---|---|---|
| The **T · L · P** buttons in the header | **view switcher** (`ViewSwitcher.jsx`) | Switches the main view. Right-click or press-and-hold opens the split menu. |
| Horizontal grid, one row per table, bookings as coloured bars | **Timeline view** (`TimelineView.jsx`) | The service view — the whole day at a glance, Gantt-style. |
| Vertical stack of booking cards | **List view** (`ListView.jsx`) | Sorted cards with full detail and per-booking actions. |
| Top-down drawing of the room | **Plan view** (`PlanView.jsx`) | The floor plan, filled by occupancy at a chosen minute. |
| Two views at once, with a draggable divider | **split view** (`SplitLayout.jsx`, `split` state) | Tablet/desktop only (≥600px). The same view can never fill both panes. |
| The two-step popup that sets a split up | **split menu** (`SplitMenu.jsx`) | Direction, then which second view. |
| Corner brackets around one pane | **focused pane** | Which half the keyboard acts on. |
| ‹ date › row under the header | **date-nav row** (`<nav aria-label="Date">`) | Previous day · viewed date · next day. The viewed date is a **date field**, so it names its weekday. |
| The date currently on screen | **viewed date** (`viewDate`) | Distinct from **today** — most notifications are today-only, clashes are not. |
| "Fri 11/09/2026" — a date pill that names its weekday | **date field** (`DateField`, `atoms.jsx`) | A native date input with its weekday inside the same pill (v18.0.0 session 7): the header's viewed date and the booking form's Date field. No date, no weekday. Its focus ring is drawn on the pill, not on the input inside it. |
| Pinned header and nav that don't scroll away | **fixed shell** (`shellFixed`) | One layout mode behind both "Lock navigation" and split view. |
| A pill that appears at the top-left on Tab | **skip link** (`.mgt-skip`) | Jumps keyboard focus past the header to the bookings. |

---

## 2. Booking statuses

Five statuses, one flag. `StatusIcon` (`Icons.jsx`) is the single source of the
mark for each — the List card, the edit form's Status row, the quick-status
popup, the timeline block and (v17.15.7) the floor-plan table all read it, so
they cannot drift.

| What you see | Correct term | What it does |
|---|---|---|
| "Pending — awaiting confirmation", hourglass, pale amber | **pending** | Booked but unconfirmed. Its only forward status is Confirmed; seated/completed are hidden everywhere. |
| "Confirmed", tick, amber | **confirmed** | Booked and expected. Occupies its table, counts for the optimiser and late-tracking. |
| "Seated", chair, green | **seated** | The party is at the table. Never reshuffled by the optimiser. |
| "Completed", double tick, grey-green | **completed** | The visit ended. **The table counts as free everywhere** — any new availability check must exclude completed. |
| "Cancelled", ✕, muted | **cancelled** | Called off. Folds into the finished section. |
| Amber "no-show ×N" tag | **no-show** (`noShow` flag, `isNoShow()`) | A **flag on a cancelled booking**, not a sixth status. Counted per phone number. |
| The single-word status word on a List card | **status badge** (`SBadge`) | A solid tag carrying the status. |
| Row of status buttons on a card or popup | **status changers** | Move a booking one step. Each carries its own `StatusIcon`. |

---

## 3. The notification strip

Every in-flow notification shares **one pane**. Collapsed height is one row
however many fire — that is the whole point of it.

| What you see | Correct term | What it does |
|---|---|---|
| The single pane above the view | **notification strip** (`NotificationStrip.jsx`) | Holds every in-flow notification. `role="region"`, not a live region. |
| One titled block inside it | **section** (`notifSections` in `App.jsx`) | `{id, tone, tint, icon, title, count, node}`. Severity order is decided in App, not in the strip. |
| The always-visible top row | **lid** | Worst section's title + the tally. Press it to expand. |
| "⧉2 ⏳1" on the right | **tally** | Icon + count per live section. Stays visible when the strip opens. |
| "+2 more" | **overflow count** | How many sections the collapsed lid isn't naming. |
| Amber "Running late" rows | **Running late** section (`LateBanner.jsx`) | Confirmed bookings past their time today. Offers No show. |
| Amber "Overlap warnings" rows | **Overlap warnings** section (`OverlapBanner.jsx`) | A **seated** party overstaying into the next booking. A prediction. |
| Red "Double-booked" / "Double-bookings" rows | **clash** section (`ClashBanner.jsx`, `findClashes`) | Two bookings genuinely on one table. **Not** an overlap warning — the schedule is already wrong. Offers Assign. |
| Green "Waitlist — table free" rows | **waitlist availability** section (`WaitAvailBanner.jsx`) | A waiting party a table now fits. Offers Book. |
| "Reminder(s)" rows | **reminder banner** (`useReminders.jsx`) | A reminder inside its fire window. Snooze / Done. |
| "Working offline" | **offline section** (`appBannerSections`) | The socket is down; edits queue. |
| "Couldn't save" | **write-error section** | A write was refused. Carries either a transient warning with a **Dismiss**, or a **parked write** with **Retry** and **Discard**. |
| "P3 Smoke Test, 19:30 — not saved, and undone", with **Retry** / **Discard** | **parked write** (`parkedWrites`, `usePersistence.js`) | A change whose automatic retries ran out. It is kept and named instead of dropped: **Retry** runs a fresh round of attempts on resynced data, **Discard** accepts the loss. The change is already undone on screen — the banner names it so you know what to redo. |
| "Couldn't load bookings" | **load-failure section** | The initial read failed. Permanent until reload. |
| "Closed this day" | **closed-day section** | The viewed weekday has no opening hours. Suppresses the empty-day prompt. |
| "Tables could be reshuffled" | **inefficiency section** | The optimiser could do better. Offers Reshuffle. |
| The ✕ on a row | **row dismissal** (`useDismissals.js`) | Session-only. Late/overlap/waitlist reset on a date change; clash prunes against live pairs instead. |

---

## 4. Labels and chips

`DESIGN.md` fixes this as **three treatments, and context decides which** — a
fourth shape (pale fill + matching border + third-shade text) is banned.

| What you see | Correct term | What it does |
|---|---|---|
| Solid fill, white text — `manual`, `locked`, `★`, `no-show ×2`, `N min late` | **solid tag** | Used where a tag competes inside a busy row. Neutral `--border-glass` rim. |
| No fill, 2px border, text in the same hue — "N visits", "N no-shows" | **outline chip** (`OutlineChip`, `atoms.jsx`) | A count or a disclosure standing alone. Border is derived from its ink via `color-mix`. |
| The same, but clickable (▸/▾) — "Regular · N past visits" | **chip button** (`OutlineChip as="button"`) | A disclosure. Reveals past bookings / no-shows. |
| Coloured text, no fill, no border — "Table free · HH:MM", "This device" | **text treatment** | Where the colour carries itself unaided. |
| Red message inside a form: "Text is required." | **inline alert** (`InlineAlert`, `atoms.jsx`) | A strip section, inside a modal. `role="alert"` wrapper stays mounted; only the child is conditional. |
| Tinted panel with a mark, a heading and a list under it — the Blocked list, a guest's Past bookings / No-shows, the kitchen-busy notice | **alert panel** (`AlertPanel` + `AlertRow`, `AlertPanel.jsx`) | The notification strip's section shape for a titled LIST, as `InlineAlert` is for one sentence. Picks a `role` from `ALERT_TONES`, which supplies tone AND tint as one decision. |
| The coloured pill at the top of a modal | **title pill** (`ModalTitle`) | An `<h2>` that also names the dialog. Create/act surfaces wear their action's colour; configure/read surfaces wear neutral grey. |
| Small mark at the top of a section | **section mark** (`SectionMark`) | The section's icon at header size. |

---

## 5. The timeline

| What you see | Correct term | What it does |
|---|---|---|
| One coloured bar | **block** (`TimelineBlock`) | One booking. Reads left-to-right: identity, then status. |
| The fixed-width strip of marks at the block's right | **flag rail** (`railFlags`) | `StatusIcon` leads, then the flags below. Every item is `flexShrink: 0`. |
| Banknote mark | **deposit flag** (`DepositIcon`) | A deposit was taken. Amount is in the hover title. |
| Star | **preferred flag** (`StarIcon`) | The booking has preferred tables. |
| Padlock | **locked flag** (`LockIcon`) | The optimiser will not move it. Every walk-in and every drag-drop sets this. |
| Crossed circle | **repeat-no-show flag** (`NoShowIcon`) | 2+ past no-shows on that phone number. |
| Two offset bars | **overstaying flag** (`OverlapIcon`) | This party is sitting into the next booking's slot. |
| Two overlapping squares | **double-booked marker** (`ClashIcon`) | Another booking claims this table now. Outranks the overstay warning. |
| 5px stripe inside a red-bordered block | **clash band** (`ClashBand`) | Spans the exact minutes both bookings claim. Its right edge is the minute the earlier booking ends. |
| The dark "20:30" pill on a block | **start-time chip** | Shown only when *every* confirmed block that day has room (`chipRoomFor`). |
| The `=` handle at the block's right edge | **assign handle** (`AssignIcon`) | Opens manual table assignment. A real `<button>`, sibling to the block's button wrapper. |
| Dimmed, semi-transparent block | **waitlist ghost** (`WaitGhost`, `waitGhosts`) | A waiting party a table would fit. Tap to book. Dashed at 0.4 when it needs a re-optimise. |
| Faint tail after a block | **turnaround tail** | The `TURN_BUFFER` minutes the table stays unavailable. |
| Vertical line that moves | **now-line** | Current time. |
| "13:00" labels across the top | **hour pill** (`--tl-hour-pill`, `hourLabel()`) | The grid header. Same pill the block's start-time chip uses. |
| "Follow" / "Following" button | **follow** (`followNow`) | Auto-scrolls and zooms to the current time. Today only. |
| "Optimiser: ON/OFF" button | **optimiser toggle** | See §8 on the spelling. |

---

## 6. The floor plan

| What you see | Correct term | What it does |
|---|---|---|
| The drawn room | **floor plan** (`layout.floorPlan`) | Tables, walls and doors, in cm. |
| One drawn table | **table glyph** (`TableGlyph`, `FloorGlyphs.jsx`) | Shape, size, rotation, per-side chairs. Operable — Enter/Space when it has an `onClick`. |
| The colour filling a table | **occupancy fill** | seated · confirmed · pending · free · blocked, at the selected minute. |
| The small white mark under a table's id | **status mark** (`StatusIcon`, v17.15.7) | The occupant's status as a SHAPE, so the fill is never the only signal. Drawn only where the fill names a status — never on blocked, free or resetting. |
| Diagonal hatching | **blocked** | A table block covers this minute. |
| The scrolling ruler under a fixed centre marker | **time axis** (`TimeAxis.jsx`) | Scrub the day. Snaps to 15 min on idle; tap to scroll a time to centre. |
| The pill in the middle of the header row | **selected-time badge** | The minute the fills are drawn for. Sits exactly on the axis's centre marker. |
| "Now" button | **now button** | Jumps the selection to the current minute and re-centres the tape. Today only. |
| seated / confirmed / pending swatches, top right | **legend** | What the fills mean. Each chip carries its status mark, because the room draws one. The three are the complete set a table can show. |
| "free in about N minutes" pill | **freeing-soon pill** (`freeingSoon`, `freeSoonWindow`) | A table about to turn over. |
| Dashed muted outline | **resetting** | The table is inside its turnaround buffer. |
| "Walk-in here" in the tap popover | **walk-in shortcut** | Offered on **free** tables today only. |

---

## 7. Modals, popovers and toasts

The distinction is load-bearing: a **modal** is a dialog (scrim, focus trap,
`role="dialog"`); a **popup** is not, and must not claim to be.

| What you see | Correct term | What it does |
|---|---|---|
| Blurred backdrop + centred card | **modal** (`Overlay`, `atoms.jsx`) | Every modal in the app — see the note below. |
| Full-screen sheet on a phone | **sheet** | `Overlay`'s `<600px` branch. No scrim, so no backdrop-click — the footer button is the only exit. |
| Buttons pinned at the modal's bottom | **footer slot** (`footer={…}`) | Body scrolls above it. |
| A saturated button that commits or destroys — Save booking, Seat, Block, Delete, Discard, No show | **solid button** (`mkSolidBtn`, v17.15.0) | `mkBtn`'s counterpart for an action with consequences. `background` is required, so nobody answers the colour question by accident. Twelve hand-written copies before it, which had already produced one live disagreement: "No show" wore two different oranges. |
| Which surface Escape closes | **modal stack** (`useModalStack.js`, `MODAL_Z`) | One ordered stack replacing eighteen visibility booleans. `MODAL_Z` **is** the z-order as data; `topModal()` is what Escape acts on. Read state as `modalOpen.<id>`, write via `setModalFns.<id>` — both generated from `MODAL_Z`, so a surface without a rank has no setter and no Escape action, and `tests/modal-stack.test.js` fails the build. |
| Small popup over a block or table | **quick-status popup** (`QuickStatusPopup.jsx`) | Right-click / press-and-hold. Status changes during service. Paints `--tl-popup-scrim`, not `--scrim`. |
| "Note — Maria López" over a party just seated | **seat note** (`SeatNoteModal.jsx`, modal id `seatnote`) | A booking's notes, put in front of whoever seats the party (v18.0.0 session 7). Raised by every seat — the quick-status popup, the List card, the S key and the form's Save — never by a walk-in. One button, Done. |
| The booking form | **booking form** (`BookingFormModal.jsx`) | New and edit. Controlled — state lives in `BookingApp`. |
| The walk-in form | **walk-in form** (`WalkinForm.jsx`) | |
| Table picker with Swap busy | **manual assign** (`ManualModal.jsx`) | Pin a booking to chosen tables. |
| From/To over a table | **table block editor** (`BlockModal.jsx`) | Makes a table unavailable for a window. |
| Search over all dates | **find a booking** (`SearchPanel.jsx`) | `/` shortcut. Jumps to the day and focuses the card. |
| Week / Month popover | **More** (`WeekView.jsx`) | `M`. Opened from Summary's More button. |
| "That table is still occupied" before a party is seated | **seat-clash confirm** (`SeatClashModal.jsx`, modal id `seatclash`) | Asked when the table you are seating a party onto still has a seated party at it (v18.0.0 session 8). Three answers — *Complete them & seat* · *Seat anyway* · *Back* — because refusing outright is wrong (most evenings the previous party has left and nobody tapped Complete) and seating silently is the bug. Escape and the backdrop mean Back. Raised from both seating doors through `seatClashParties` |
| Per-booking audit trail | **history popup** (`HistoryPopup.jsx`) | |
| Dot + popover in the header | **connection status** (`ConnectionStatus.jsx`) | Green/amber/red. Lists connected devices and the signed-in email; holds Log out and Reconnect now. |
| Floating message, bottom centre | **status toast** (`StatusToasts.jsx`) | **One slot** — the highest-priority live toast only, crossfading in place. `role="status"`. |
| "Booking cancelled · Undo" | **undo pill** | The one toast you act on. `undoSecs` in settings. |
| "Nothing booked for this day yet" + two buttons | **empty-day prompt** (`EmptyDay.jsx`) | Renders **nothing** on a closed day — the strip's closed-day section is that case's empty state. |
| "MGT Bookings hit an error" + Try again / Reload app | **error screen** (`ErrorBoundary.jsx`, v17.16.0) | What the app shows instead of a white screen when a render throws. Deliberately **not** a modal: there is no app behind it to dim, so it is a plain centred card on `--bg-app` with no scrim and no `Overlay`. Not a live region either — it moves focus instead. |

### What `Overlay` actually is

`Overlay` (`atoms.jsx`) is **the component that turns content into a dialog**.
You give it children and it supplies everything a dialog has to have. Not a
styling wrapper — most of what it does is invisible until it's missing.

It owns seven things, and the point is that no call site has to remember any of
them:

| It supplies | Why it can't be left to the call site |
|---|---|
| The **scrim** and its blur | The blur budget is capped at 4 simultaneous instances (a real tablet perf bug at 51). One owner, one count. |
| **Sheet vs card** | `<600px` renders a full-screen sheet that slides up; above that, a centred card that fades and scales. One breakpoint, not twelve. (The WA sandbox adds a third mode — see §10.) |
| `role="dialog"` + `aria-modal` | Without them a screen reader isn't told anything happened. |
| The **accessible name** | Resolved from the DOM — `ModalTitle`'s `<h2>`, else the first heading, else `"Dialog"`. A prop was written and thrown away: it would need to stay correct at twelve call sites, and `aria-labelledby` pointing at a missing id leaves the dialog **nameless**, which is worse than not trying. |
| **Focus in, focus back** | Focuses the dialog container itself — not the first input (pops the tablet keyboard) and not the first button (puts a destructive action one Enter away). Restores focus to the opener on close. |
| The **focus trap** | Tab stays inside. |
| The **pinned footer** (`footer={…}`) | Body scrolls, actions stay put. Mobile gets a sticky bar with safe-area padding. |

**What it deliberately does *not* own: Escape.** `useKeyboardShortcuts` handles
that app-wide, acting on the top of the modal stack via `escapeAction`. So a
guarded close — "Discard unsaved changes?" — must be named there too; wrapping
`onClose` at the mount site is a back door Escape walks straight past.

**Why "every modal uses it" is enforced structurally.** The check is
`var(--scrim)` may appear in **exactly one file** (`tests/a11y.test.js`), not
"every modal has a dialog role". `ReminderEditor` spent eleven versions off
`Overlay` for a plausible-sounding reason — it renders at z=250, the scrim is
200 — which was false: the discard confirm sits at **z=260** on `Overlay` by
wrapping it in a positioned div, because `position` + `z-index` makes a stacking
context. It lost five guarantees nothing on screen reveals. A role-based
assertion would have caught none of it, because the file wasn't a modal that
forgot its role — it was a modal that had left. **To stack above another modal:
wrap `Overlay` in a positioned div. Never hand-write a scrim.**

A **popup** is not this. The quick-status popup and the split menu paint
`--tl-popup-scrim` and have no focus trap — so they must not claim `role="dialog"`,
for the same reason the connection popover carries `aria-haspopup` but not
`aria-modal`. Claiming a guarantee you don't provide is the defect.

---

| "How much of it did this bill use?" | **redeem prompt** (`VoucherRedeemModal.jsx`) | Raised BY a completion, the way the kitchen confirm is raised by a save. Three exits: redeem, complete without using it, or Escape (which completes nothing). |
| The "Gift voucher" field in the booking form | **voucher picker** (`VoucherPicker.jsx`) | Attaches a voucher to a booking. **Attaching is not redeeming** — it writes `booking.voucherCode` and moves no money. |

## 8. Domain concepts

Where the real ambiguity lives.

| What you see | Correct term | What it does |
|---|---|---|
| "Optimiser: ON" in the UI | **optimiser** (UI) / **optimizer** (code) | **A deliberate split.** UI copy is British (`Optimiser`, `Auto-optimiser`); every identifier is American (`autoOptimizer`, `optimizerActiveFor`, `settings/optimizer`). Don't "fix" either side. |
| Tables rearranging themselves | **reshuffle** (`bookingsAfterAction`, `applyOpt`) | The optimiser reassigning tables to fit more in. Never touches seated or `_locked` bookings. |
| "Daily cutoff" in Settings | **cutoff** (`settings/optimizer.cutoff`) | The hour the optimiser stops acting on today. Off at 15:00, back on at the new day. |
| A party that walked in | **walk-in** | `_manual: true, _locked: true` — immune to the optimiser. |
| The ⏳ N badge in the date-nav row | **waitlist** (`useWaitlist.js`) | Parties waiting for a table, FCFS by `createdAt`. |
| A waitlist party matched to a table | **waitlist match** (`placeWaitlist`, `lib/waitlist-match.js`) | **Sequential, not parallel** — each match is held as a synthetic locked booking the next scan sees. |
| "Separation between bookings" | **turnaround buffer** (`TURN_BUFFER`, `padEnd`) | Minutes a table stays unavailable after a party leaves. Off by default. **Placement only** — it never makes an already-booked day report clashes. |
| Tables that can be pushed together | **join group** (`joinGroups`) | Which tables are physically adjacent. A table belongs to at most one. |
| A run of joined tables used as one | **combo** (`VALID_COMBOS`) | **Derived** from join groups, not hand-listed. Every contiguous run of ≥2. |
| A combo spanning two groups | **mega combo** (`megaCombos`) | Declared by hand, appended to the derived list. |
| A table's full run | **cluster** (`CLUSTERS`) | The ≥2 run containing it, else itself. |
| Indoor / outdoor | **zone** (`ZONE_OF`) | Purple indoor, teal outdoor. |
| "Table priorities" in Settings → Layout | **priorities** (`PRIORITIES`) | The optimiser's heuristics as data — size bands, combo rules, anchors, swap rules. |
| Afternoon / Evening | **day shift** (`settings/dayShifts`) | The split hour the summary counts against. |
| The N in "Party of N" | **size** / **covers** | `size` is one booking's party; **covers** is the day's total served. |
| "Default length of new bookings by party size" | **duration tiers** (`DUR_TIERS`) | Size → default duration, plus a catch-all. |
| An amber card border and "N min late" | **running late** (`lateState`) | `null` → `"warn"` → `"noshow"` against the configured thresholds. Today only. |
| A weekly booking | **standing booking** / **recurring rule** (`useRecurring.js`) | The **rule** lives in `recurring`; each generated booking is an **occurrence** in `/bookings` with a deterministic id. Off by default. |
| A returning guest, matched by phone | **customer** (`customerIndex`) | **Derived from bookings** — there is no customers collection. |
| A returning guest with no phone | **linked guest** (`guestId`) | Minted only when a human picks an existing phone-less guest from the name dropdown. Never merges by accident. |
| "Data removed" | **anonymised booking** (`anonymized`) | Deleting a customer keeps the stats and wipes the identity. |
| The green dot / amber dot / red dot | **connection state** | Green connected · amber **connecting** (never handshaked) · red lost. The three are distinct on purpose. |
| Other devices in the popover | **presence** (`usePresence.js`) | Ephemeral, per-connection. A device is "connected" only inside a 150s staleness window. |
| "MGT Bookings" vs "Me Gustas Tú" | **app name** (`APP_NAME`) vs **restaurant name** (`settings/general.restaurantName`) | Two different things, and confusing them has shipped a bug (v17.15.2: the printed day-sheet footer built the app's name out of a restaurant setting). `APP_NAME` is one constant in `lib/constants.js`; the restaurant name is configurable and seeds from the tenant profile. A fallback from one to the other is fine; a **composition** of the two is not. |
| Which restaurant this build is for | **tenant** (`VITE_TENANT`, `src/tenants/<slug>.js`, `profile`) | One module per restaurant, exporting `{ firebaseConfig, profile }` — the profile carries `slug`, `name`, `locale`, `waContext`. Selects the PRODUCTION project only: `import.meta.env.DEV` still forces the one shared DEV sandbox, whatever the tenant. Shown in the boot banner beside the DEV/PROD badge. |

---

| A gift voucher's number | **voucher code** (`normalizeCode`, `lib/vouchers.js`) | The child key of `/vouchers/{CODE}`, so uniqueness is a property of the storage. Generated codes avoid `0/O` and `1/I/L`; a manual code is stored exactly as typed. |
| A voucher that has been taken out of use | **voided** (`status: "void"`) | Not deleted — deleting would free the number for re-issue. **A voucher is never deleted anywhere in the app.** |
| A completed booking whose voucher was never recorded | **unsettled** (`isUnsettled`, `UnsettledBanner.jsx`) | Reached by the close-time auto-complete (nobody is there to answer) or by "Complete without using it". Surfaces as a strip section that clears itself when recorded. |
| What a voucher has left | **remaining** (`remainingOf`) | DERIVED as `value − redeemedTotal(ledger)`, never decremented — which is what makes a replayed redemption idempotent. |
| A voucher used on a visit | **redemption** (`v.redemptions[bookingId]`; `applyRedemption` / `removeRedemption`, `lib/vouchers.js`) | One ledger entry per booking, keyed by the booking's id — so a retried or replayed redemption rewrites the same entry instead of adding a second, and a walk-back removes exactly that one. **Remaining** is derived from these. |

## 9. Settings and admin

Nine tabs, split by **audience**: what the restaurant *is*, then what it
*holds*, then how *you* look at it, then reference — and, since v18.0.0, who may
do what. **A tab can be conditional on two different questions, asked in this
order** by `visibleTabs`: a **module** gate hides it from everybody, admin
included, when the restaurant does not have the feature — Vouchers, WhatsApp
(*does this restaurant have it*); a **capability** gate shows it only to an
account holding one of its capabilities — General, Layout, Reminders, WhatsApp,
Admin (*may you*). Customers, App and Shortcuts are always there.

| What you see | Correct term | What it does |
|---|---|---|
| General · Layout · Customers · Vouchers · Reminders · WhatsApp · App · Shortcuts · Admin | **settings tabs** (`SETTINGS_TABS`, `SettingsChrome.jsx`) | **One list, never duplicated** — the tab bar renders it and the ←/→ nav derives its cycle from it. Since v18.0.0 both read it through **`visibleTabs(can, hasModule)`**, so a gated tab is filtered out of the render *and* the cycle. The module is checked FIRST: off hides the tab from everybody, an admin included. **WhatsApp (v18.0.0 phase 5) is the first tab carrying BOTH gates** — `module: "whatsapp"` and `caps: ["settingsWrite"]` — which is the pair `visibleTabs` was written for. |
| Settings › App › **Automatic dark mode**, above **Dark mode** | **automatic theme** (`theme: "auto"`, `useUserPrefs.js`) | Follows this device's light/dark setting, live. Dark mode is locked while it is on. Saved per account like the theme itself; an account that never chose reads as Automatic. |
| The Vouchers tab body | **vouchers settings** (`VouchersSettings.jsx`) | Issue · search · filter · void, plus the default validity period. Records and their configuration in one place. There is **no delete** — see `CLAUDE.md`. |
| "Default validity", in months | **voucher expiry period** (`settings/voucherDefaults.expiryMonths`) | Seeds `expiresAt` on a newly issued voucher. `0` means never. |
| Opening hours, shifts, durations, late thresholds | **General** | The restaurant's operating rules. Restaurant-wide. |
| Tables, combos, priorities, floor plan | **Layout** (`LayoutSettings.jsx`) | The physical room. |
| Theme, app width, reduce animations, zoom steppers | **App** | Read once by whoever is *holding* the device. Five of eight follow the account. |
| Drag-and-drop room editor | **floor plan editor** (`FloorPlanEditor.jsx`) | Snap-10 canvas, walls, doors, per-side chairs. |
| "Shared across all devices" | **restaurant-wide setting** | The six `settings/*` nodes. |
| "This device only" | **per-device setting** | App width, the four zoom values, the saved split layout — properties of the screen. |
| A setting that follows you to another device | **user preference** (`settings/users/{uid}/prefs`) | Theme · reduce motion · plan gestures · nav lock · split view. Tri-state: `null` means never chosen — and `theme` takes a third value, `"auto"` (the **automatic theme**). |
| The Admin tab body | **Admin** (`AdminSettings.jsx`) | People, their levels, invitations, and the enforcement switch. Admin-only at both layers — the tab is filtered out, and the rules refuse the writes regardless. |
| Staff · Manager · Admin | **level** (`role`, `/roles/{uid}`) | The three named tiers. `staff` runs a service; `manager` owns money and configuration; `admin` also administers the app. An absent level reads as **staff**. The names on screen ARE the code's values — `staff` · `manager` · `admin` — unlike **optimiser** / `optimizer`, this file's one deliberate UI-vs-code split, so there is no second spelling to look for. |
| A single ticked cell on someone's row | **extra** (`/roles/{uid}/extras/{cap}`) | One capability granted to one person **on top of** their level. The map that ADDS; its opposite is a **deny**, so a level is always a floor. |
| A cell switched **off** on someone's row (red ✕) | **deny** (`/roles/{uid}/denies/{cap}`) | One capability taken away from one person, below what their level grants — v18.0.0 phase 3, Patryk's call, because a level that cannot be reduced is a minimum rather than a default. A tick and a deny can never both be set for one capability: `setCapability` clears both maps and picks one from the level, so the screen only asks "should this person have this?". A deny is a present `true`, never `false` — the rules test `.val() !== true`. An admin may not deny their own `settingsAdmin`; that is the last-admin invariant. |
| "Export the data" | **`dataExport`** | The one gated capability with **no rule behind it**, and `CAPABILITIES` says so rather than letting the enforced chip imply otherwise: the backup file is built client-side out of reads, and `.read` is `auth != null` at the root, so gating it server-side would mean restructuring every read in the app. Hiding the button covers the real threat and no more. |
| "Take bookings", "Delete bookings", "Change settings" … | **capability** (`CAPABILITIES`, `src/lib/roles.js`) | The eighteen things the app gates on, in four groups (`CAP_GROUPS`) — Service, Money, Configuration, Data and access. Eighteen because v18.0.0 phase 3 split `settingsWrite` into five: reminders, standing bookings, the opening hours, the floor plan, and what was left. Each split capability kept `manager` as its floor, so the split changed nobody's access on the day it shipped. The UI always asks `can("bookingDelete")`, **never** `role === "admin"`. |
| The "enforced by the server" chip | **rule-enforced capability** (`RULE_ENFORCED`) | **Seven** the database refuses too — `settingsAdmin`, `settingsWrite`, `bookingDelete`, `reminderManage`, `recurringManage`, `hoursEdit`, `layoutEdit`. The other eleven are UI gates and the panel says so. |
| The Capabilities pop-up | **capability grid** (`RolesModal`, `AdminSettings.jsx`) | Pick a person, read their capabilities against all three levels side by side. Only their own column takes a tick. |
| The Modules section | **module registry** (`settings/admin.modules`, `src/lib/modules.js`) | Whole features this restaurant has, or does not: **Gift vouchers** (ships on) and **WhatsApp inbox** (ships off). Off hides every surface of the module from everybody, admin included — the tab, the booking-form picker, the list chips, the redeem modal, the unsettled banner and the printed column — and deletes nothing, so switching it back on restores what was there. Under project-per-restaurant this is the whole of "restaurant B has no WhatsApp". |
| A module switch (`Toggle`) | **module switch** (`moduleOn`, `setModuleEnabled`) | A **module** answers *does this restaurant have it*; a **capability** answers *may this person do it*. They are different questions and compose one way only — `moduleOn` is asked first, so a capability grant can never re-open a switched-off feature. |
| "1 voucher is still open, worth 75 €…" | **hide warning** (`hideWarning`, `src/lib/modules.js`) | Shown before the vouchers switch moves, because an open voucher is money the restaurant owes and hiding it makes a liability invisible. It **refuses nothing** — an admin who has read the number may still switch off — and the toggle does not move until they answer. No open vouchers, no question. |
| The Integrations section | **integrations panel** (`AdminSettings.jsx`) | Names the server-side keys (Meta, Gemini, the service account) and where they live: **the deployment's environment variables, never this database**. `.read` is `auth != null` at the root and read permission cascades down, so a key stored here would be readable by every member of staff. **Since v18.0.0 phase 5 it also says WHETHER each is set**, from `/api/wa-config` — a boolean per key, never a value. **THREE states, and the third is the point**: `· set`, `· not set`, and a bare key name meaning *we could not ask*, which is what a local dev server produces since it runs no serverless functions. A panel about secrets must never render "not set" for a key it never enquired about. |
| "Enforce roles" | **role enforcement** (`settings/admin.enforceRoles`) | Ships **off**, so the app behaves exactly as before until it is switched on. Off is also what makes the rules deploy rolling-safe. |
| A person who has been invited but never signed in | **pending invitation** (`/invites/{id}`) | Waits on the People list. It grants nothing by itself — an admin applies it in one tap once that person signs in. |
| Printable sheet | **day sheet** (`DaySheet.jsx`) | Print-only DOM, hard-coded light. |

---

## 10. The WhatsApp module

> **Merged in v18.0.0 phase 5, and shipped OFF.** For eight versions this note
> said the opposite, and the change is the whole of that phase: the module now
> lives on `main`, and every surface below is gated on
> `settings/admin.modules.whatsapp.enabled` — off by default, so a restaurant
> sees none of it until an admin switches it on in Settings → Admin → Modules.
> The `wa-sandbox` branch survives as the development history and as the home of
> the simulator's own Vercel project against **DEV Firebase**.
>
> **What is still not shipped is the simulator** (`WaSimulator.jsx`, the `X` key
> and the three `api/wa-sim-*` endpoints), which stays behind the build-time
> `WA_SANDBOX` constant. That is the one term in this section that a restaurant
> can never reach.
>
> Verified against the **live `wa-sandbox` branch at `17.15.0-wa-sandbox`**
> (worktree `wa-sync-17-15-0`), not just the snapshot — every `src/` and `api/`
> file in the two is byte-identical, and the branch diverges from `main` in 58
> files. Source of truth: `MGT_WA_Sandbox_MOUNT.md` plus that branch.

### The surfaces

| What you see | Correct term | What it does |
|---|---|---|
| The **WhatsApp** toolbar button, or `I` | **inbox** (`InboxPanel.jsx`) | Opens the module. Two-pane above `INBOX_TWO_PANE_BREAKPOINT`, stacked below; an `Overlay` in `panel` mode. **Both the button and the `I` key are gated on the whatsapp module** (v18.0.0 phase 5) — a shortcut is a second door to the same surface, so gating one and not the other is gating neither. No capability gate: reading and replying is service work, like taking a booking. |
| "Needs action · Conversations · Archived" | **inbox tabs** (`ConversationList.jsx`) | Needs action is the triage view; archived sorts by `archivedAt`, the others by `lastMessageAt`. |
| One line per customer | **conversation row** (`ConversationRow.jsx`) | Name-or-number, snippet, relative time, plus the state marks below. |
| The thread itself | **conversation view** (`ConversationView.jsx`) | Messages, the cards below, Archive / Delete / Restore. |
| One message | **message bubble** (`MessageBubble.jsx`) | Incoming left, outgoing right. Carries the send status. |
| The text box at the bottom | **reply composer** (`ReplyComposer.jsx`) | Send, Templates. Disabled with "Conversation closed" outside the 24-hour window. |
| "Draft booking — parsed from message" | **draft card** (`DraftCard.jsx`) | What the model extracted. Accept · Accept & open · Dismiss. |
| "Customer is requesting changes / to cancel" | **intent banner** (`IntentBanner.jsx`) | A change or cancel request. Apply changes · Mark as handled. |
| "Linked booking" | **linked booking card** (`LinkedBookingCard.jsx`) | The booking this thread is attached to. Open booking · Cancel booking. |
| EN/ES canned replies | **quick-reply templates** (`TemplatesEditor.jsx`) | Per-template label and text in both languages. Edited from INSIDE the inbox, not from the settings tab. |
| Settings › **WhatsApp** | **WhatsApp settings tab** (`WhatsAppTabContent`, `Settings.jsx`) | The module's one restaurant-wide setting: **Archive when the booking is completed**. Needs `settingsWrite` on top of the module, unlike the inbox — changing what the whole restaurant's inbox does is configuration, whereas answering a guest is service. |
| 🧪 icon in the inbox header, or `X` | **simulator** (`WaSimulator.jsx`) | Sandbox-only. Fake inbound messages to drive the pipeline. |

### Conversation state

| What you see | Correct term | What it does |
|---|---|---|
| Bold row, unread dot | **unread** (`conv.unread`) | Cleared by `handleMarkRead`. |
| The Needs-action tab's contents | **needs action** | A live draft or an unhandled intent — something is waiting on a human. |
| "Reading the message…" | **parsing** (`isParsing`, `parsingAt`) | The model has the message. Goes stale after `WA_PARSING_STALE_MS` (90s) so a dropped job can't hang the row forever. |
| "Draft booking parsed" | **draft status `parsed`** (`draftStatus`) | Extracted, awaiting a human. |
| "Booking confirmed" | **draft status `accepted`** | Accepted into a real booking. |
| (row goes quiet) | **draft status `dismissed`** | Rejected by a human. |
| "Archived" | **archived** (`conv.archived`) | Out of the inbox, still readable. Can auto-fire when the linked booking completes. |
| "Conversation closed" | **the 24-hour window** (`WA_WINDOW_MS`, `formatWindow`) | Meta only permits a free-form reply within 24h of the customer's last message. Outside it, the composer is closed. |
| ✓ / ✓✓ / red + **Retry** | **send status** | `sending` → `delivered`, or `failed`. Retry re-sends. |

### The pipeline and its vocabulary

| What you see | Correct term | What it does |
|---|---|---|
| A message appearing by itself | **inbound webhook** (`api/wa-inbound.js`) | Meta posts here. Statuses arrive on the same webhook — there is no `wa-status`. |
| — | **parse** (`parseMessage`, `_lib/gemini.js`) | Gemini turns free text into `{intent, …}`. |
| book / cancel / modify | **intent** (`draftData.intent`) | The three things a customer can want. Drives which card the thread shows. |
| A number on the draft card | **confidence** (`clampConfidence`) | How sure the parse is. |
| Two parses of one thread not fighting | **`mergeDraft`** (`lib/whatsapp.js`) | Folds a new parse into the existing draft rather than replacing it. |
| The automatic "got it" reply | **auto-ack** (`AUTO_ACK_TEXT`) | Sent on inbound so the customer isn't left waiting. |
| "Checking…" / the ↻ button | **re-check** (`api/wa-recheck.js`, `parseThread`) | A **real staff feature, not sim tooling.** Re-reads the last `WA_RECHECK_HISTORY` (12) messages *both directions* and asks what the customer wants **now**, then applies it through the same `applyParse` the webhook uses. |
| `conversations/{phoneKey}` | **phone key** (`phoneKey`) | The normalised phone, used as the RTDB child key. Writes are keyed, never whole-array. |
| — | **`settings/whatsapp`** (`useWaSettings.js`) | `{v, autoArchiveOnComplete}` + revGuard CAS on `whatsappRev`. Its rules pair ships with the module (v18.0.0 phase 5); DEV is permissive, so it worked untouched there beforehand. |

### Simulator-only terms

Everything here is scaffolding. None of it ships.

| What you see | Correct term | What it does |
|---|---|---|
| "Backend mode (local Phase-1b pipeline)" / "Live pipeline (server Gemini)" | **backend mode** (`wa-backend.js`) | ON routes scenarios through the real pipeline; OFF uses canned client-side parses. |
| The 60 preset messages | **scenarios** (`wa-sim-scenarios.js`) | Canned inbound messages. |
| ✨ Suggest reply | **suggested customer reply** (`generateCustomerReply`) | Gemini writes the customer's next message so a thread can continue. |
| 🎲 Generate scenario | **generated scenario** (`api/wa-sim-generate.js`) | Gemini invents a message beyond the canned 60. |
| "Make next staff reply fail" | **forced failure** (`failNextSendRef`) | Makes the failed-bubble + Retry path demonstrable. |
| `__waSim.list()` in the console | **sim console API** (`lib/wa-sim.js`) | |
| "Harness alive on …" | **the harness** (`scripts/wa-backend-dev.mjs`) | Local backend on **:3999**. Re-check needs it running locally or the button reports "backend not running". |

### `panel` mode — how the inbox stopped being an exception

The single biggest 17.15.0-wa-sandbox change, and the one most worth knowing,
because it is §7's `Overlay` lesson playing out a second time.

| What you see | Correct term | What it does |
|---|---|---|
| The 1200px inbox with two scrolling panes | **`panel` mode** (`Overlay({panel})`) | A dialog that **brings its own body**. Overlay keeps the scrim, the card/sheet classes, the mobile full-screen branch and the whole dialog contract, and simply doesn't wrap the children in a padded scroll port. |
| — | **`useDialog`** | The dialog contract — role, name, focus trap, focus restore — extracted from `Overlay` in 17.9.1-wa-sandbox. |

**Why it matters.** Every ordinary `Overlay` branch gives you a padded scrolling
card at `maxWidth` 580, which is right for the twelve modals that are a column
of fields and a footer. The inbox is none of those — 1200px wide, a fixed
`min(900px, 90dvh)` tall, with a body that is a flex column of two
independently-scrolling panes. A padded scroll port around that is exactly
wrong, **so it was bespoke for its whole life — and being bespoke is what left
it, alone among the app's modals, with no role, no accessible name, no focus
trap and no focus restore** until v17.9.1 had to extract `useDialog` to reach
it. In 17.15.0 it became an `Overlay` and `useDialog` went back to having one
caller.

`panel` takes exactly `{maxWidth, height, background, blur}` and **deliberately
refuses arbitrary style**: a caller needing more than a size and a surface is
describing a different component and should have to say so out loud. Omitted —
which is every caller in prod — nothing runs and the four branches are
byte-for-byte what they were.

This is the same shape as `ReminderEditor` in §7: **a surface leaves the shared
component for a plausible reason, and takes every invisible guarantee with it.**
Two surfaces, same defect, found five versions apart.

### Two rules that bite

- **`normalizePhone` / `formatPhone` / `matchCustomerByPhone` are re-exported
  from `src/lib/customers.js`, never re-implemented.** This is the
  *complementarity contract*: one phone-identity primitive across both modules,
  never two. The explicit `.js` extension on that import is load-bearing for
  Node ESM, because the server imports the same file.
- **`useWhatsApp.js` is a consumer of App's form-handoff contract.** It isn't a
  shared file, so a prod change to how the booking form opens breaks it
  silently. Its three form-openers must all go through App's `openForm()` — a
  raw `setForm` reads as dirty immediately and pops "Discard unsaved changes?"
  on an untouched Cancel.

---

## 11. Terms to avoid

The tempting name, and why it's the wrong one.

| Don't say | Say | Why |
|---|---|---|
| error banner | **inline alert** | The looser name; "banner" means an in-flow strip section here. |
| badge / pill (for a count) | **outline chip** | `DESIGN.md` names three treatments; "pill" is the *radius* (`--r-pill`), not a component. |
| toast (for the strip) | **section** | Toasts are the transient floating layer. Strip sections persist. |
| overlap (for two bookings on one table) | **clash** / **double-booking** | An *overlap warning* is a seated party overstaying — a prediction. A clash is the schedule already being wrong. |
| conflict | say which one | `findConflicts` returns ids, `findClashes` returns pairs. Both exist. |
| combo (for a join group) | **join group** | The group is the adjacency; the combo is a run derived from it. |
| status (for no-show) | **flag** | No-show is a flag on a cancelled booking. |
| optimizer (in UI copy) | **optimiser** | And the reverse in code. See §8. |
| dialog (for the quick-status popup) | **popup** | It has no focus trap and must not claim one. |
| "the WhatsApp integration" | **the WhatsApp module** | Shipped since v18.0.0 but **off by default**, so "the restaurant has WhatsApp" is a question about `settings/admin.modules`, not about the build. "Integration" also overstates it — what the restaurant switches on is a module, in the same sense as Gift vouchers. |
| chat / thread | **conversation** | `conversations/{phoneKey}` is the node; every identifier says conversation. |
| status (in the WA module) | say **send status** or **draft status** | Two unrelated lifecycles: `sending/delivered/failed` on a message, `parsed/accepted/dismissed` on a draft. |
| re-check (as sim tooling) | **re-check**, a staff feature | It ships with the module. Only the simulator around it doesn't. |

---

*Names come from `DESIGN.md` and the source. When they disagree, the source is
what ships — fix one of them, don't add a third.*
