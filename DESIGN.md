# DESIGN.md

The visual system of **Me Gustas Tú Bookings** — the token scales, the surface
and colour rules, hover/press/motion, and the accessibility contract. Extracted
from `CLAUDE.md` in v17.13.0.

**Read this when you are about to change how something LOOKS or BEHAVES on
screen**: adding a control, a badge, a banner, a modal, an icon, an animation,
a colour, or anything a screen reader has to describe. `CLAUDE.md` keeps the
architecture, the data rules and the gotchas, and points here.

## Why it moved out

`CLAUDE.md` is auto-loaded into every session, and 57% of it had become the
visual system — 817 of 1,436 lines. Every one of those lines was earned, and
none of them is needed to answer "how does the booking optimizer decide a
table" or "why does that write get refused". Splitting the file is not a
demotion of the design rules; it is the recognition that they are consulted at
a different moment than the rest.

**That split has one hazard, and it is the whole reason this file opens with
the paragraph below.** A rule nobody loads is a rule nobody follows. So the
non-negotiables — the ones that ship a bug when unseen — stayed in `CLAUDE.md`
under "Design system", and the *enforcement* is not a document at all: seven of
these rules are `npm run check:style` (`scripts/check-style-invariants.mjs`),
the fill/ink pairings are `tests/contrast.test.js`, the stylesheet's own
integrity is `tests/stylesheet.test.js`, and the accessibility wiring is
`tests/a11y.test.js`. **If you find yourself writing a rule here that a test
could hold instead, write the test.** Everything below that is not enforced is
either a judgement (which needs the reasoning, hence the length) or a
measurement someone had to take live.

## How to read the long entries

Most sections carry more history than a style guide normally would, and the
history is the load-bearing part. Nearly every rule here is the residue of a
specific shipped defect — a light-mode fill at 1.8:1, a stray `*/` that deleted
a CSS rule, a `scale(1.08)` on an 820px card that moved the button out from
under the cursor. The number and the story are what stop the rule being
"simplified" back into the bug. When a rule looks fussy, the sentence
explaining why is usually the one to read.

---

## Style tokens
- All colours, spacing, button styles, badge styles, **corner radii**, **motion** and **type** flow through `src/lib/constants.js` exports (`S`, `BTN`, `BLOCK_BG`, `BLOCK_INK`, `STATUS_COLORS`, `TBL`, `R`, `M`, `T`, `FW`).
- **`R` = the v17.7.0 pill-radius scale** (`R.pill`/`auth`/`sheet`/`card`/`inset` → the `--r-*` tokens in `src/index.css`'s `:root`; radii are theme-agnostic, so they are NOT duplicated into the dark block). Assign **by role, never by the old number** — the same `12` meant "control" in one file and "card" in another. `--r-pill` is `999px` because CSS clamps an oversized radius to half the box, so one token is a true pill at every control height. **No new `borderRadius: <number>` literal.** **v17.8.0: ENFORCED, not described** — `npm run check:style` (`scripts/check-style-invariants.mjs`, a CI gate after lint) fails on any bare numeric radius unless its line carries an inline `/* @canvas */`. **The 26 genuine exceptions are marked at their sites**, so an exemption is visible where you are reading rather than in a paragraph three files away — timeline blocks + their manual-assign handle, folded corner and hour strip (7) · TimeAxis ticks, heat bar and now-marker (4) · WeekView's calendar cells and covers bars (5) · the Toggle track, `Kbd` and the safe-area `calc()` (3) · Summary's progress track+fill pair (2) · the two table-picker cells (2) · the split divider (1) · LayoutSettings' alignment indents (2). **v17.10.2 refreshed this count, which had drifted from a documented 17 while the code reached 26** — an exemption list that drifts is how a rule quietly stops meaning anything, which is the whole reason the markers are at their sites. Note the grep says 27: one hit is `constants.js`'s own PROSE about the marker, not an exemption. **Grep for the marker on a line that also carries an exempted property**, or the doc drifts again in the other direction.
  **Hard rule for any box holding WRAPPING or SCROLLING text (v17.7.1): its radius must be ≤ its horizontal padding.** A rounded box is narrowest at its top and bottom edges, so a radius past the padding clips the first/last visible line — and no vertical-centring trick saves it, because centring stops applying the moment the content overflows (that is exactly how the v17.7.0 `mkArea` fix passed QA and still shipped a bug: it was only ever tested with short content). Pills are for SINGLE-LINE controls, where the text is centred by line-height and never reaches the curve. Multi-line ⇒ `R.inset` (10px, inside mkInp's 12px padding) — see `mkArea`, and the chat bubble / reply composer in the WA sandbox. **A `<select>` needs the same clearance on its RIGHT** (v17.8.0 `mkSel`): its arrow is painted inside the padding box against `padding-right`, so mkInp's 12px lands it inside the pill's 21.5px cap. Text is immune — it spans enough height that the curve has receded behind it, which is exactly why the LEFT 12px looks right and the right 12px doesn't.
- **`T` = the v17.8.0 type scale, `FW` the weight scale.** Six role-named steps
  (`micro`/`small`/`body`/`lead`/`title`/`display`) and four named weights.
  Assign by role, never by the old number. **No new `fontSize:`/`fontWeight:`
  literal** — `npm run check:style` fails on one unless the line carries
  `/* @canvas */`. Before this there were 497 size literals in THIRTEEN values
  and sixteen distinct size/weight combinations on the app's emptiest screen,
  nine of the sizes between 9 and 18px where 11→12 is a ratio of 1.09 — below
  the threshold at which a reader perceives a step. The result is many type
  styles and no hierarchy, which does not look broken, it looks flat.
  **The two halves are one change.** There was no regular weight: 93 of 95
  elements were 500+. When everything is semibold, weight cannot carry
  emphasis, so size carries all of it, so sizes multiply and crowd. `FW.regular`
  on descriptive text is what lets the scale have six steps instead of thirteen.
  When merging sizes, **collapse DOWNWARD** — a size that shrinks cannot
  overflow its box; a size that grows can, in ways a mechanical sweep cannot be
  verified against.
- **`SP` = the v17.9.0 spacing scale, `H` the control-height scale — and these
  two are LINTED, not tokenised.** That difference from `R`/`T`/`FW` is
  deliberate and worth understanding before "finishing the job" by sweeping
  tokens through. `R` and `T` are SEMANTIC: `borderRadius: 12` genuinely did not
  say whether it meant "control" or "card", so only a role name could
  disambiguate it. `gap: 8` is not ambiguous; it is eight pixels. So spacing
  stays readable literals and `npm run check:style` is the contract — it parses
  every `padding`/`gap`/`margin` and every `height`/`minHeight` in the 24–56px
  control range, and fails on anything off the scale. `SP` and `H` are exported
  from `constants.js` for computed cases and shared style objects.
  **The audit that motivated this overstated it, and the correction is the
  lesson.** "97 distinct padding strings" sounds like chaos; the underlying
  numbers were already an even 2px progression, and the real defect was eight
  values nobody chose (1, 3, 5, 7, 9, 11, 17, 20, 22) sitting beside their
  on-scale neighbours — `"5px 11px"` in three files, `"9px 14px"` next to
  `"8px 14px"`. The other 89 strings are different paddings for different boxes.
  Forcing them into an invented role vocabulary would have been 84 judgement
  calls, each invisible until someone opened that one screen. **Count the
  DISTINCT VALUES, not the distinct strings, before deciding a scale is missing.**
  Snap DOWNWARD, as `T` does. `H` is mostly v17.8.0's sizing rule written down
  (44 is a floor, not a target); `/* @canvas */` exempts genuine layout
  dimensions — the Toggle track, table-picker cells, the timeline hour strip,
  WeekView's calendar cell, alignment indents, safe-area `calc()`.

- **`--rim-solid` / `--rim-solid-strong` = the v17.13.0 rim tokens.** The
  hairline white edge on a theme-INVARIANT solid fill — a `BLOCK_BG` block, an
  `--app-*-solid` button, a `BTN.*` pill. `RIM_SOLID` in `constants.js` is the
  whole `1px solid var(--rim-solid)` declaration, because that is the shape all
  26 hand-written copies took. **Not `--border-glass`**, which means the same
  thing on a surface that FLIPS (0.3 light / 0.14 dark) and is right there and
  wrong here. Both are declared in `:root` only, and that is the mechanism:
  a token is theme-invariant when you decline to redeclare it, which is the
  property `SIZE_RING`'s old "a literal because BLOCK_BG is theme-invariant"
  comment was reaching for and missed.

- **The colour rule (v17.13.0), `check:style` Rule 7.** No `rgb()`/`rgba()`
  with a numeric first argument and no hex anywhere in `src/`, unless the line
  carries `/* @fixed-fill */` or `/* @shadow */`. `rgba(var(--tbl-out-rgb),0.8)`
  is a token reference, not a literal, and is untouched. Comments and devtools
  `%c` styling are excluded structurally, not by marker. **The marker is shared
  with Rule 2 deliberately** — "is the surface under this theme-invariant" is
  one question about one line — so marking a colour also blesses a white inset
  on that line; read the whole line before marking it. 23 deliberate literals
  remain and each says so at its site: the kitchen chips in both forms, the
  print sheet, and white on a saturated block or badge.

- **`@fixed-fill` is a QUESTION, not a label (v17.13.0 `/code-review`).** Before
  marking a line, answer it literally: *what is the fill directly under this
  colour, and is that fill the same in both themes?* Marking to mean "I looked
  and it seems fine" is how the first use of the rule went wrong —
  `ManualModal`'s idle swap panel is `S.bg`, i.e. `"transparent"`, so the rim
  sits on the modal sheet and flips; the white 0.5 literal measures 1.00:1
  against the light sheet and the marker would have certified it forever. Where
  the fill is behind a ternary, read BOTH branches. Where it is a token, check
  whether that token is redeclared in the dark block. If the answer is "it
  flips", the fix is a token that flips with it, not a marker.

- **The icon and motion rules (v17.13.0), Rules 8 and 9.** No numeric
  `size={n}` or `{ size = n }` on an icon — but never `size: <number>` in an
  object, which in this app is a PARTY size. No hand-written duration/curve; a
  TIME must precede the easing keyword, or the rule would report `M.resize`'s
  own `var(--t-shift) linear`. `M.easeOut` is the one escape hatch (`WAAPI`
  cannot read a CSS var) and carries `/* @motion */`. **Both were adopted at
  100% compliance**, which is the argument for adopting them: a rule at zero
  debt guards the next edit, a rule against a backlog gets muted.

- **The weight ratchet (v17.13.0).** `FW.regular + FW.medium` must stay at or
  above 30% of all `FW.` references (`tests/style-check.test.js`); it is 32.5%.
  The criterion behind the pass that got it there: **a run coloured as
  secondary must not also be weighted as primary.** It is a ratchet and not a
  per-line rule on purpose — a quiet section heading (muted colour, bold,
  letterspaced) is a legitimate device, there are ~17 of them, and a rule with
  a 24% exemption rate teaches people to type the marker instead of thinking.

- **`IC` = the v17.9.1 icon-size scale** (`inline` 12 · `control` 14 · `chrome` 18,
  in `constants.js`). The last unscaled axis, and the tell was not the COUNT of
  sizes (eight, between 10 and 18) but that **one control wore four of them** —
  `CloseIcon` rendered at 12, 13, 14 and 15 in different corners. Assign by role:
  a mark inside a text run or dense row · the standard mark ON a control · header
  and nav furniture where the icon IS the button. The 2px/4px gaps are the point;
  13→14 was never perceptible. No new numeric `size={n}` on an icon. (The
  timeline note dog-ear stays a hard-coded 8px inline SVG — a decorative marker
  drawn in place, not a member of the set.)

- **A checker with a blind spot still prints OK, which is worse than no checker
  (v17.9.0).** The first spacing rule required the property to be preceded by
  `{` or `,`, to skip CSS inside string literals. That condition is FALSE for a
  key in a multi-line style object — i.e. most of the codebase — so the rule saw
  almost nothing and `check:style` reported clean. Exactly the v17.8.0
  marker-placement shape: worthless precisely where it was meant to bite, while
  carrying the authority of having passed. **Reading the script cannot catch
  this; running it against known-bad input can.** `tests/style-check.test.js`
  now does, and `check-style-invariants.mjs` takes an optional directory
  argument so a fixture can be pointed at it. Any new rule gets a fixture in
  that file, both a violating case and a legitimate one.

- **An exemption marker must live INSIDE the style object (v17.8.0).**
  Appending `/* @canvas */` to the end of a line that ends in `>` or `/>` puts
  it in JSX **children** position, where React renders it as literal text —
  eight of them shipped, printing comment syntax across the Plan view's ruler
  and the Stats popover's bars. Worse, `check:style` only asked whether the
  marker was PRESENT, so the sites it was meant to bless were the sites it
  broke and it reported OK on all of them. Rule 0 now rejects the placement.
  **A checker that cannot see its own annotation is worth less than none**,
  because it also carries the authority of having passed.
- **44px is a FLOOR, not a target (v17.8.0).** The tap-target pass applied
  Apple's figure to every small control and overshot: a 44px circle beside a
  40px date field made the date-nav row stop reading as chrome. Toolbar chrome
  (timeline zoom cluster, Find/Settings, the connection dot, Summary's More)
  sits at **36**; `mkBtn`'s **40** remains the app-wide standard; genuine 44s
  are reserved for decision surfaces where a mis-tap costs something — modal
  footers and the quick-status popup. Size by what a mistake costs, not by one
  number from a guideline.
- **A literal is invisible to a token audit (v17.8.0).** The contrast pass
  measured every `--token` and still missed four fills carrying white text —
  TableGrid's selected (2.31), blocked (3.13) and swap (~1.4, white on bright
  yellow) cells, and ManualModal's swap panel (2.62) — because they were
  `rgba(...)` literals, not tokens. The same sweep found **fifteen hard-coded
  copies of token VALUES** across ten files, several of them copies of a value
  from before that same pass retuned it. **Grep the value, not the name**, and
  remember an audit that enumerates tokens has a blind spot exactly the size of
  the literals.
- **A fill that carries TEXT is chosen for its contrast against its ink, per
  theme. Alpha is for decoration (v17.8.0).** An `rgba(hue, 0.8)` fill
  composites toward what is BEHIND it, so one token lands somewhere different
  in each theme. The app shipped eight versions of fills declared in `:root`
  only, under a comment asserting they were theme-invariant; in light mode
  "Save pending" was 1.83:1, the Follow button 1.82:1, the inactive View buttons
  1.94:1 and the outdoor table pill 2.15:1, while every one of them passed in
  dark. **Dark mode is the easy case; light is where a saturated fill washes
  out.** `tests/contrast.test.js` measures every fill/ink pair in both themes
  and fails on an unregistered text-bearing fill. Small bold labels take 4.5:1;
  buttons take 3:1. `BLOCK_INK` pairs each block fill with its ink.
  **The amber pair is a RECORDED EXEMPTION, not a pass**: confirmed sits at
  2.9:1 and pending at 1.8:1 with white ink, because both alternatives were
  tried and are worse — darkening the fills destroys the matched-intensity pair
  v17.0.0 engineered, and dark ink (shipped for exactly one commit) reads as
  DISABLED next to the white-inked seated and cancelled blocks, so a status
  change looked like a state change. `tests/contrast.test.js` marks them
  `role: "exempt"`, prints the number every run, and still fails if either drops
  below a recorded floor — **an accepted contrast is not a licence to keep
  going.** What made it defensible is that the one piece of *information* on a
  block, the start time, moved onto its own opaque `--tl-hour-pill` chip —
  the same pill the hour ruler uses — so it is legible on every fill instead of
  being tinted by it.
  **v17.9.0 found that claim was not being measured.** The registry entry
  measures `--tl-hour-pill` over the PAGE (4.73 light) — that is the *ruler's*
  pill. The block chip is the same token over a saturated block and, until
  v17.9.0, at `opacity: 0.8`: 3.72–4.62:1 across all ten status×theme cases,
  below AA in every one, while the file reported the token as passing. So the
  exemption's whole justification rested on a composite nothing measured — the
  v17.8.0 lesson recurring one level down. **A token's number is not the
  screen's number wherever that token is reused over something else.** The chip
  is now full-strength (5.15–6.10:1) and quieted by `FW.medium` instead, and the
  test reads the opacity back out of `TimelineView.jsx` rather than assuming it.
  **Opacity conflates QUIET with FAINT; weight separates them** — and the chip
  was only ever "too loud" relative to a NAME sitting at 1.86–2.97:1, so dimming
  it was levelling down to the illegible element rather than fixing it.
- **A literal duplicate of a token is a token that cannot be fixed (v17.8.0).**
  TimelineView's Follow button held a hard-coded copy of `--app-btn-grey`'s
  value and was the one secondary button the contrast pass could not reach; the
  booking-form footer held two more, one of them a copy of
  `--app-success-solid` from *before* that same pass retuned it. Grep the token's
  VALUE, not just its name, when retuning one.
  **It then happened again in the commit that wrote this rule** (v17.8.0 review
  fix): the Optimizer button, eight lines below the Follow button, held the same
  `rgba(120,130,150,.55)` and stayed at 1.94:1; ReminderEditor's inactive
  Once/Weekly/weekday buttons held `…,0.45` and were left at **1.70:1**, the
  worst text contrast in the app *after* a pass whose whole subject was contrast.
  Writing the lesson into a comment beside one copy is not the same as running
  the grep. **Fixing one copy of a literal does not fix the literal** — when you
  retune a token, the very next command is a repo-wide search for its old value.
- **Two names for one concept is how a thing hides from its own audit
  (v17.8.0).** The inactive View button is `--app-btn-grey`, not `--btn-nav`, so
  a coverage check written around the `--btn-*` prefix walked straight past the
  control staff look at on every screen. When writing a check that enumerates
  tokens by prefix, enumerate what is actually THERE and diff it.
  A **third** family then hid from the same check: the timeline's own
  `--tl-*-pill` / `--tl-*-badge` fills, one of which (`--tl-now-pill`) was below
  the bar in dark. The one that matters is `--tl-hour-pill` — the amber blocks
  are a *recorded exemption* on the grounds that the start time moved onto that
  pill, so the exemption's entire justification was resting on a fill nothing
  measured. It passed, at 4.73:1, **by luck**. When a check's verdict becomes an
  argument for accepting something else, everything that argument leans on has
  to be inside the check.

  **Corollary for pill-shaped controls (v17.8.0): `--r-pill` clamps to half the SHORTER side, so only a SQUARE box is a circle.** An icon button sized by `minHeight` + horizontal padding is ~30×40 and renders as a vertical egg — which is what the three Split-View tools were, one row above the perfectly round 34×34 🔍/⚙ pair. A single-glyph button gets explicit equal `width`/`height` and `padding: 0` (and `min-*` is not enough — a flex row will stretch it back).
- Reusable JSX atoms in `src/components/atoms.jsx`: `Overlay`, `Fld`, `Section`, `TBadge`, `AvailBanner`, `Toggle`, `mkInp`, `mkBtn`.
- New UI composes from atoms, not redefining them. Add new atoms there if needed.
- **`mkBtn` already sets `boxShadow`, so `Object.assign`-ing another one REPLACES it** — a
  property, not a shadow list. `ViewSwitcher`'s split-pane marker silently stripped
  the button's `--shadow-btn` this way (v17.8.0 review fix); the fix is one
  comma-separated value, `"inset 0 -3px 0 …, var(--shadow-btn)"`. Same trap for
  any property `mkBtn`/`mkInp` already own.
- **`mkInp` / `mkBtn` return *style objects*** (not JSX) — usage is `<input style={mkInp()}>` /
  `<button style={mkBtn({...})}>`. (Note: the sibling Scheduling app's equivalents return JSX;
  Bookings differs. Don't assume a `className`/prop passthrough — it isn't there.)
- Prefer the **`Toggle` atom** (`Toggle({ on, onClick })`) over `<input type="checkbox">` for
  booleans (native checkbox is fine only for multi-select grids / native forms).

---

## UI / style rules

- Translucent / glass, iOS-inspired surfaces; rounded corners; the shared accent (`#007AFF`).
- **`--bg-app` is ONE flat tint per theme (v17.9.0), not a gradient.** It was six
  near-identical desaturated blues spanning a MEASURED 3.86 L\* in light and 4.00
  in dark — at the edge of visibility across a viewport, so the app paid six
  stops for something nobody could see. The shipped value is the mean of the six
  it replaced, which is why the change is invisible and the diff is a deletion.
  A 2-stop candidate at ~8 L\* was built and compared side by side in the real
  app (three live iframes, one parameter apart — the surfaces are translucent
  glass, so the backdrop tints every card and a swatch comparison answers a
  different question); Patryk chose flat. **If a gradient is ever wanted here
  again, ~8 L\* is the bar.** A backdrop either commits to being seen or commits
  to being a surface.
- **One app font (v16.0.0):** the stack lives in `src/index.css` as `--font-app` (body sets it; App.jsx/LoginScreen wrappers read the token). `input, textarea, select, button { font-family: inherit }` is load-bearing — form controls do NOT inherit font per the CSS spec (the Notes textarea used to render monospace). Never re-introduce an inline font-family literal; the only deliberate exception is the `Kbd` keycap atom (monospace).
- Every modal uses the **`Overlay` atom** (owns blur + mobile-sheet / desktop-card branching).
- **Popovers/dialogs use the opaque sheet token**, not the translucent card token (a card token at ~0.45 opacity reads see-through for a dialog).
- ≤4 simultaneous `backdrop-filter: blur()` (see perf gotcha above).
- **Keyboard focus is a designed state (v17.8.0).** One `:focus-visible` rule in
  `src/index.css` + a `--focus-ring` token per theme. Before this the app had NO
  focus rule at all and a focused button computed `outline: none` — in the one
  app here that is explicitly keyboard-driven. **`outline-offset: 2px` is what
  makes a single colour enough**: the ring lands on the page background instead
  of the control's own fill, so it never has to survive being drawn over a
  saturated accent pill. Don't add an inner hairline for that case — mkBtn's and
  mkInp's inline `boxShadow` beats a stylesheet `box-shadow` on most controls, so
  it would apply inconsistently or not at all (tried and removed). The offset
  needs 2px of room: a control flush inside an `overflow:hidden` scroller has its
  ring clipped, the same trap as the hover-lift and fixed by the same
  `padding-inline` gutters. **Nothing else in the app may wear a plain outline** —
  `ViewSwitcher`'s split-pane marker was `outline: 2px solid white` and became
  indistinguishable from focus the moment a real ring existed; it is an inset
  underline now.

- **A status button carries its OWN mark, from ONE source (v17.10.0).** Every
  button that moves a booking to another status used to be prefixed with the
  same `ChevronRightIcon` — ">Confirmed", ">Seated", ">Completed" — which marks
  "there is more this way", not what the button does; four buttons in a row, one
  glyph, no information. Worse, the quick-status popup (the one reached on the
  timeline and the floor plan, i.e. **during service**) carried no marks at all,
  so the same five decisions looked different in three places. `StatusIcon`
  (`Icons.jsx`) is now the single source all three read — the List card, the edit
  form's Status row, the popup. **It is exported as a COMPONENT, not as the bare
  map**: a plain const export from that file breaks Fast Refresh
  (`react-refresh/only-export-components` is a lint ERROR and CI gates on zero),
  and a call site should ask for "the mark for this status" rather than hold a
  table it can index wrongly. Adding a status means adding a row there, nowhere
  else. Four of the six marks were already drawn — `CheckIcon`, `CloseIcon`,
  `WaitIcon` (the hourglass already means waiting, which is what
  awaiting-confirmation is) and `NoShowIcon`; only **seated** and **completed**
  needed new shapes. Sizing: `IC.control`, not `IC.inline` — these are marks ON
  a control, and `Assign` sat in the same List row at `IC.control` already.
- **A control's LABEL is not selectable text (v17.10.1).** One rule in
  `src/index.css` — `button, [role="button"] { user-select: none;
  -webkit-touch-callout: none }` — because a long-press is TWO gestures at once:
  ours, and the OS starting a text selection. The quick-status popup opens under
  the finger that is still pressed, so on Android the selection landed on its own
  buttons (Copy / Share / DeepL across "Cancelled"). Both properties are set
  although only Android showed it: `user-select` is what Chrome reads,
  `-webkit-touch-callout` is Safari's, and neither platform should differ here.
  **Scoped to controls, never to a container** — inputs, textareas and divs keep
  selection, and `ListView`'s card is a `<div>` whose phone number staff select
  and copy to ring a party (the reason v17.10.0 taught that card's click handler
  to stand down mid-selection). Two testing traps, both of which produced a
  falsely clean result first time: a hold past **800ms** is the drag-arm handoff
  and dismisses the popup *by design*, so probe at ~600ms and sample state
  *during* the press; and block coordinates move on reload, so derive them from
  `getBoundingClientRect()` rather than hard-coding. Guarded by a DECLARATION
  assertion in `tests/stylesheet.test.js`, **not** a `CRITICAL_SELECTORS` entry —
  that list matches selectors, and both `button` and `[role="button"]` already
  appear in other preludes, so either entry would have passed with the rule gone.

- **v17.9.0: no control wears a typographic mark.** Dismiss, confirm, disclose,
  navigate, rename, print, download, assign, "preferred" and the status
  chevrons are all SVG from `Icons.jsx` — and so is every flag on a timeline
  block, which the first pass exempted and the second pass did not. The two
  text categories that remain (prose arrows inside sentences, keycap labels)
  are listed at `Icons.jsx` in the file-structure block — read that before
  adding a glyph to a button. Also note the traps it records: an HTML entity is
  invisible to a glyph grep, **copy that describes a glyph has to change when
  the glyph does**, and **check for a reuse before drawing** — three of the
  block's markers needed only two new icons, because one of them renders the
  same data the notification strip already had a mark for.

- **Chrome sits with what it acts on, not with other chrome (v17.9.0).**
  `ViewTools.jsx` is **gone**. v17.0.0 round 8 created it to give all three views
  ONE copy of Find-a-booking and Settings, and that goal still holds — but it
  grouped them by *appearance* (two 36px circles) into a toolbar that belonged to
  neither. They are now two buttons in App's header sharing one `CHROME_BTN`
  module const: **Settings leads the title block**, because the two lines beside
  it are the restaurant's configuration read back (name · tables · hours), and
  **Find-a-booking joins the action cluster** between "+ New" and the connection
  dot, because finding a booking is something you do, like adding one. The header
  is no less shared across views than the date-nav row was, so nothing regressed.
  `CHROME_BTN` lives in `App.jsx` rather than `atoms.jsx` for the `time-grid.js`
  reason — both call sites are in that one file, and exporting a style nothing
  else reads is distance, not sharing.

- **The waitlist is a PENDING thing, so it wears the pending amber (v17.10.0).**
  Its chrome — the ⏳ count badge in the date-nav row, both "Add to waitlist"
  buttons, and the Waitlist panel's title pill — used to share `--btn-orange`
  with No show / Reassign / Reshuffle / the swap family, i.e. the burnt orange
  that means *something has gone wrong or needs undoing*. A party waiting for a
  table has not gone wrong. The green "table free" signals stay green: those say
  an opportunity opened, which is the opposite of "still waiting".
  **The contrast cost is real and was chosen with the numbers on screen.** This
  fill under white ink is `tests/contrast.test.js`'s recorded amber exemption,
  and that exemption's stated justification — a block's meaning is carried by
  colour, position and width, and the one part that is information moved onto an
  opaque chip — **does not stretch to a button whose label is its only content**
  (1.82:1 light / 2.20:1 dark). All three candidates were built into the running
  app and compared side by side in both themes: an outline (amber border + amber
  text, the `Save pending` shape, no exemption needed), a solid fill with dark
  amber ink (3.76 / 3.12, clears the 3:1 button bar), and this. Patryk chose this,
  informed. The note now lives beside `EXEMPT_FLOOR` so the record says what it
  actually blesses; the floors still gate a regression.
- **Accent = primary action or current selection. Nothing else (v17.8.0).** It is
  not for identity and not for decoration. `--tbl-out-rgb` used to be byte-identical
  to `--accent`, so nine outdoor table pills painted the accent on every screen at
  all times and nothing could outrank a table label; outdoor is teal now. Before
  reaching for accent, check the hue is actually free — the app's slots are green
  seated/success, amber confirmed/pending, burnt orange warn, red danger, purple
  indoor, teal outdoor, graphite `--tag-flag` for booking flags.

- **Notifications are ONE surface (v17.8.0).** Every in-flow banner
  (`BannerRows` + Late/Overlap/WaitAvail, `AppBanners`, the reminder banner) and
  every floating toast (`StatusToasts`) uses the same pane: a soft semantic
  tint, a **1px** border, `R.card`, and the colour carried by a leading 8px
  **dot** — the connection popover's device. Never a 2px ring around a
  saturated wash, and **never a card inside a card**: banner rows are
  transparent and hairline-separated (`--border-soft`), because a fill+border
  row inside a fill+border container is what made these read as bolted-on alert
  boxes. Connection-shaped toasts use the header dot's own `--status-*` tokens
  so the same event is the same colour everywhere. No ⚠/⏰/⟳ glyphs — a glyph
  plus a coloured dot plus coloured text is three signals for one message.
  **All of them now live in ONE `NotificationStrip` pane** whose collapsed height
  is one row however many fire; adding a new in-flow notification means adding a
  section to App's `notifSections` in severity order, never a new pane.
  **v17.15.0 extends that to modals: an in-form error is a strip SECTION too.**
  `InlineAlert` (`atoms.jsx`) is the strip's section shape — tinted pane, the
  mark in the tone colour, the message in the same tone, no border — so a fault
  looks the same whether it fires on the main screen or inside a form. It is a
  one-line section with no separate title, on the strip's own precedent that a
  single live section drops the generic lid rather than adding a redundant
  sub-header. The three copies it replaced were all the BANNED fourth shape
  (pale fill + matching border + third-shade text). **Its tone is
  `--danger-text`, not the strip's `--status-offline`** — measured before
  copying, because `--status-offline` is `#ff3b30` in both themes while
  `--danger-bg` inverts: 3.03:1 in light against 4.31:1 in dark, below AA and a
  42% swing. `--danger-text` gives 7.09:1 / 8.05:1, and `AppBanners`' two danger
  sections were corrected to match. The pairing is a registered `FILLS` entry
  now. **v17.15.2 registered the warn, suggest and offline panes**, which is
  what that sentence asked for — and finding them is what turned up the offline
  section still on `--status-offline` at **3.13:1 light / 3.90:1 dark**, below
  AA in *both*, the third section to wear that token and the one v17.15.0
  missed. Neither the coverage guard (its prefixes miss `--danger-bg`) nor
  `check:style` (it sees literals, not token pairings) can see this class of
  fault, so the registry is the only thing that can. Add the next pane there
  when you add the pane.

- **A semantic pane picks a ROLE, not two tokens** (v17.15.2). `ALERT_TONES`
  (`atoms.jsx`) names `danger` · `warn` · `success` · `offline`, each a
  `{ tone, tint }` pair. The pairing is the thing that goes wrong: two tokens
  that must agree are one decision, and hand-pairing them put `--status-offline`
  on `--danger-bg` at three separate call sites, all below AA, all looking
  perfectly reasonable. Exactly the move `CHIP_TONES` made for `OutlineChip` one
  release earlier.

- **The banned shape has TWO shipped replacements, and which one you use is
  decided by whether the notice has rows.** `InlineAlert` (`atoms.jsx`) is one
  sentence; **`AlertPanel` + `AlertRow`** (`AlertPanel.jsx`, v17.15.2) is a
  titled list — tinted pane, no border, mark and title in the tone, transparent
  rows separated by hairlines and indented to `NOTIF_GUTTER` so row text starts
  under the TITLE rather than under the mark. Both are the notification strip's
  section shape, so a fault looks the same wherever it fires. `AlertPanel` is
  not in `atoms.jsx` because it imports the strip's geometry and the strip
  imports atoms; that is also why `AvailBanner` moved to its own file.

  It is **not** `BannerRows`, which is bound to `useRevealRows`, an
  arrival/departure lifecycle for rows that come and go while you watch. These
  lists are static inside a `Reveal` that animates the whole panel.

- **The warn ink is hue 30 in BOTH themes** (v17.15.2). It was `#9a3412` in
  light — hue 15, one point of lightness from `--danger-text`'s hue 0 — against
  `#fdba74` in dark, hue 31 with ten points of lightness. Warn and danger were
  twice as separable in dark as in light, so **which role a colour meant
  depended on the theme**; reported as "No-shows is orange in dark and red in
  light". Light is now `#8a4b0a`, the dark ink's own hue. `--app-warn-solid`
  follows it: it was the same hex, it is theme-invariant, and App's "Kitchen may
  be busy" pairs that solid with a `--warn-text` heading in the same modal. One
  role, one hue, whatever treatment carries it.

- **Three label treatments (v17.8.0), and context decides which.** **SOLID**
  where a tag competes inside a busy row (ListView's `manual`/`locked`/`★`/the
  seated counter, the reminder's time chip). **OUTLINE** — no fill, a **2px**
  border in the semantic hue, text in the same family — where a chip stands
  alone as a count or a disclosure (Customers' visits/no-shows,
  `BookingFormModal`'s Regular/no-show buttons). **TEXT** where the colour
  carries itself unaided.
  **v17.15.0: an outline chip's border is DERIVED from its text**, not chosen
  beside it — `--chip-<role>-border` is `color-mix(in srgb, var(--<role>-text)
  50%, transparent)`. The border and the text are the same statement at two
  volumes, so they are one decision. Before this the border came from
  `--suggest-border` / `--warn-border` and the text from `--success-text` /
  `--warn-text`, two families never required to agree: in light that is a pale
  mint ring around dark forest text, in dark the two nearly converge, and the
  chip read as a different component per theme. The tokens are declared ONCE —
  each references an ink that already flips, so a dark override would re-create
  the hand-maintained pair. Build chips with `OutlineChip` (`atoms.jsx`);
  `as="button"` is the disclosure kind. **v17.15.2: build one with `OutlineChip`
  or it will drift, and nothing will tell you.** The booking form's
  "Kitchen busy" chip was this component written out by hand — pill radius,
  transparent fill, semantic bold text — and it carried BOTH faults the atom
  exists to prevent: its ink and its border came from unrelated families
  (`--text-required` against a hand-written `rgba(220,38,38,0.4)`), and that ink
  is theme-INVARIANT on a fill that inverts, measuring 4.11:1 in light and
  **2.86:1 in dark**. It survived v17.15.0 because **nothing scans for a chip
  that never imported the atom** — that sweep found the two that had.
  **And v17.15.2 then made the same mistake in its own formatting-dependent
  form.** Its first pass located the banned panes with a grep matching
  `--warn-bg` and `--warn-border` on ONE LINE, so `WalkinForm`'s kitchen panel,
  which spells them on two, carried both faults through the very commit that
  fixed its twin in the booking form. **Audit a SHAPE with a brace-balanced scan
  of the whole style object, never a line grep** — the script is in v17.15.2's
  `REFACTOR_LOG.md` entry.
  The banned shape is the fourth one: pale semantic fill
  *plus* a matching border *plus* bold text in a third shade, which encodes one
  signal three times. The outline chip drops the fill and earns its extra border
  pixel; do not "restore" the fill.
- The SOLID/TEXT pair in full: **solid** — the fill carries the colour, text is `--text-on-accent`,
  the rim is neutral `--border-glass` (the v17.7.0 status-label decision:
  `SBadge`, `manual`, `locked`, `★`, the seated `N min`); or **plain text** —
  the colour carries itself, no fill, no border. The third shape — pale
  semantic fill + border in the matching hue + bold text in a third shade of
  it — is banned. It encodes one signal three times and is the stock badge
  every framework ships. **Which of the two you pick is decided by context,
  not taste: match whatever sits next to you.** ListView's `no-show ×N` /
  `N min late` / `€N deposit` share a row with four solid tags, so they are
  solid; `Table free · HH:MM`, `This device` and the reminder banner's time sit
  among plain text (and each already has a plain-text twin elsewhere — the
  waitlist string is printed verbatim by `WaitAvailBanner`), so they are text.
  Clickable chips are the documented exception: `BookingFormModal`'s
  Regular/no-show disclosures are buttons and a fill is their affordance.
  Watch the copy when you strip a chip — dropping the waitlist pill left the
  panel's footnote describing "a green chip" that no longer existed.

- **`--suggest-bg` is a CHIP fill, `--suggest-bg-soft` is the pane fill.** At
  banner size the 0.8-alpha chip green outshouted the amber "Running late" pane
  above it, inverting the hierarchy. A suggestion must never be louder than a
  warning.

- **Every modal is a real dialog (v17.9.1).** `Overlay` carries `role="dialog"` +
  `aria-modal="true"`, focuses its own container on open (`tabIndex -1`, not the
  first control — focusing an input pops the tablet keyboard, focusing the first
  button puts a destructive action one Enter away), restores focus to the opener
  on close, and traps Tab. **Escape is deliberately NOT handled there** —
  `useKeyboardShortcuts` owns the app-wide Escape z-order chain. The accessible
  NAME is resolved **from the DOM**, not a prop: `#mgt-modal-title` (rendered by
  `ModalTitle`, which is an `<h2>`), else the first heading in the subtree, else
  a generic label. A prop was written and thrown away — it would need to stay
  correct at twelve call sites, and **`aria-labelledby` pointing at an id that is
  not in the tree leaves the dialog NAMELESS, strictly worse than not trying.**

- **`prefers-reduced-motion` and the manual toggle are different intents
  (v17.9.1).** The OS query gets transforms and keyframes killed but keeps a
  120ms colour/opacity cross-fade — WCAG 2.3.3 is about vestibular triggers and
  asks for LESS motion, not none, and this app says a lot with motion. The
  per-device "Reduce animations" toggle keeps the TOTAL kill: its job is weak
  tablet hardware, where the cheapest frame is no frame.

- **A modal that REPLACES its body must reset its scroll port, in the click
  handler (v17.9.1).** `Overlay` exposes one via `useOverlayScroll()` (a context,
  because it owns four scroll ports and only it knows which is mounted). Settings
  calls it when switching tabs. Doing it in a **layout effect instead removes the
  jump but kills the height animation** — writing `scrollTop` forces a
  synchronous layout, and there it lands after `AutoHeight` has already set the
  new height, so the transition has nothing to animate from. Reset while the OLD
  content is still mounted.

### Theming / dark mode (mechanism shipped v14.2.0 — ported from Scheduling; see `MGT_Bookings_dark-mode_PORT_INSTRUCTIONS.md`)
- **Where the CSS lives (v17.15.1):** every rule and token below is in
  **`src/index.css`**, imported by `src/main.jsx`. It was an inline `<style>`
  in `index.html` until v17.15.1, when it moved so the service worker could
  cache it (navigations are network-first, `/assets/*` is cache-first). Only
  the no-flash boot script is still inline there, pinned in the CSP by hash.
- Light + dark via CSS custom properties: `:root` (light) + `[data-theme="dark"]` overrides in `src/index.css`; `<html data-theme="…">` set via `document.documentElement.dataset.theme`. A theme flip is **one DOM attribute change — zero React re-render** of the tree.
- **Hook:** `useThemeMode(explicitPref) → isDark` (`src/hooks/useThemeMode.js`) writes `data-theme` and follows the OS live when pref is `undefined` — the shared Scheduling contract, unchanged. A no-flash inline script in `index.html` paints the theme before React mounts (the hook alone runs too late).
- **v17.9.0: a DEV-only `?theme=dark` / `?theme=light` override, and it is the
  FOURTH site in the theme-key contract** (`readThemePref`, the Settings toggle,
  the no-flash script, the override — same key, same `"dark"`/`"light"`
  convention at every one). It exists because v17.6.0 made the theme follow the
  signed-in ACCOUNT, which overrides both `localStorage` and OS emulation — so
  there was no way to LOOK at dark mode without writing to a real user's saved
  settings. **The non-write is the feature**, enforced at both write sites: the
  prefs-seeding effect skips its theme branch entirely (both halves — the `else`
  is the dangerous one, because `themePref` holds the FORCED value and would
  write "I chose light" up for a user who chose dark), and `onToggleDark` skips
  `saveUserPrefs`. It is inert in production twice over: Vite strips the
  `import.meta.env.DEV` branch, and the no-flash script (which has no
  `import.meta.env`) gates on hostname. The override had to be honoured in the
  no-flash script too — painting the stored theme and correcting it a frame
  later in React is exactly the flash that script exists to prevent.
- **Persistence is per-device `localStorage["mgt-theme"]`** (`"dark"|"light"|`absent), NOT Firebase (theme is per-device by design; the `settings/operatingHours` node added v14.4.0 is restaurant-wide config only). `readThemePref()` (module scope in `App.jsx`) feeds the hook; the Settings General-tab `Toggle` (`onToggleDark`) writes the key. The no-flash script reads the SAME key — **keep the value convention in sync across all three.**
- **No rgba/hex literals in JS — every colour references `var(--…)`.** Migrated token-by-token in waves. **v14.2.0:** core `S` set + app background (`--bg-app`). **v14.2.1:** `constants.js` colour sets — `STATUS_COLORS` + `TBL` as **RGB-channel triplets** composed `rgba(var(--…-rgb), a)`; `BLOCK_BG` + `BTN` direct tokens (theme-invariant saturated fills; only status-chip **text** flips). **v14.2.2:** `atoms.jsx` + the full **modal/form subsystem** (every `Overlay` modal, `Section`, inputs, steppers, `Toggle`, `Kbd`, the Settings `TabBar`, in-modal banners) — surfaces + their text flip together (coupling: the shared `Overlay` backs 7 modals, so a dark sheet needs dark-themed content). Then **v14.2.3** `TimelineView` · **v14.2.4** `ListView` · **v14.2.5** the main-screen banners in `App.jsx` (offline/reconnect/load/overlap/reshuffle) completed the migration — **every in-app surface is now themed** (timeline/list canvas included; the login screen followed in v14.4.0).
- **Token families** (`src/index.css`): surfaces `--bg-sheet`/`-sheet-mobile`/`-soft`/`-input`/`-stepper`/`-tabbar`/`-tab-active`/`-card`; borders `--border-sheet`/`-soft`/`-input`/`-kbd`/`-glass`; `--scrim`; semantic text `--text-primary`/`-secondary`/`-muted`/`-faint`/`-required`/`-on-accent` + `--warn-text`/`--danger-text`/`--success-text`; banner trios `--warn-*`/`--danger-*`/`--suggest-*` (bg+border+text move together); shadows `--shadow-sheet`/`-soft`/`-input`/`-btn`. **Dialog sheets use the near-opaque `--bg-sheet`** (dark = 0.85), per the opaque-popover rule. `ReminderEditor` has its **own** modal (not `Overlay`) — theme its scrim/card directly.
- The PDF/print path stays light regardless of in-app theme (currently no in-app PDF/export exists; keep it light if one is added).

### Hover affordance — COMPLETE (v14.3.0 → v14.3.2; see `MGT_Bookings_hover-scale_PORT_INSTRUCTIONS.md`)
- Shared `.mgt-hover-scale` utility in `src/index.css`: `scale(1.08)`, `120ms ease`, opaque theme-aware `--bg-hover-card` (`#ffffff` light / `rgb(50,50,53)` dark, both theme blocks), the `:hover:not(:disabled)` guard, reuses `--shadow-soft`.
- **A colour token may only sit on a surface that flips with it (v17.8.0 review fix).** The
  `--*-text` tokens INVERT between themes (`--success-text` `#166534`→`#86efac`,
  `--status-pending-text` `#854d0e`→`#fde047`). Painted on a **hard-coded** pale
  fill — which is theme-invariant by intent, like `BLOCK_BG` — that inverts the
  text out from under itself: the kitchen-suggestion chips in
  `BookingFormModal`/`WalkinForm` shipped light-green text on pale green at
  ~1.3:1 in dark mode. Those six sites are deliberately **back on hex literals**
  (`KTXT_OK`/`KTXT_TIGHT`), and that is the correct answer, not debt. **Triage a
  colour exactly like a shadow: ask whether the SURFACE UNDER it flips.** If it
  doesn't, the thing on top must not either.
- **The shadow scale is a 2×2, and v17.10.1 filled the missing cell.** Ask two
  questions: does the element read as RAISED, and does its own fill FLIP with
  the theme? Raised + flipping fill ⇒ `--shadow-btn`. Raised + fixed fill ⇒
  **`--shadow-btn-solid`**. Not raised ⇒ `--shadow-flat` either way (it has no
  inset, so the fill question does not arise). Recessed ⇒ **`--shadow-well`**.
  Floating ⇒ `--shadow-popover`; a card on `--bg-card`/`--bg-soft` ⇒
  `--shadow-card`; a text field ⇒ `--shadow-input`.
  **`--shadow-btn-solid` is the only `--shadow-*` whose INSET is identical in
  both themes**, and that is its entire content: the highlight sits on the
  element's own theme-invariant fill (`BLOCK_BG`, `--app-*-solid`, `BTN.*`), so
  tuning it per theme would be wrong; the DROP still deepens, because it lands
  on the page. It replaced **three spellings of one intent** across 14 sites
  (`0 2px 6px/0.12` ×11, `0 1px 4px/0.1` ×2, `0 1px 3px/0.15` ×1), none of
  which deepened for dark — modal footer buttons sat at 0.12 beside siblings at
  0.35. **`--shadow-btn-accent` / `--shadow-btn-success`** are the one deliberate
  exception to theme-splitting: a primary button glowing in its OWN hue is not
  elevation, so they are identical in both themes.
  **Count the DISTINCT VALUES before deciding a scale is missing** — and note
  that `--shadow-flat`'s own comment says "anything that should read as raised
  takes `--shadow-btn`", which is right for the elements it was written about
  (all on flipping fills) and was NOT the answer for these.

- **`--shadow-flat` is elevation over a fill that does NOT flip (v17.10.0).**
  Every other `--shadow-*` token leads with a white inset highlight — that is
  what makes a control look raised — and a highlight tuned for light and dimmed
  for dark is *wrong* on a fill that is identical in both themes (the v17.8.0
  white-inset-over-fixed-fill rule). So this one carries no inset. It is still
  theme-split, because the shadow falls on the PAGE and the page does flip.
  It absorbed the last of the ROADMAP's ~18 accumulated `0 1px Npx
  rgba(0,0,0,0.0x)` literals; the rest went to `--shadow-btn` (raised pills whose
  fill flips), `--shadow-card` (cards on `--bg-card` / `--bg-soft`) and
  `--shadow-popover` (floating surfaces — `StatusToasts`, matching the
  quick-status popup). **Triage each site by one question: does the ELEMENT's own
  fill flip with the theme?** A MIX counts as "no" — `BLOCK_BG[status]` spans
  three invariant fills and two that flip, so `SBadge` and the timeline's status
  swatch take `--shadow-flat`. Genuine remaining exceptions are **rings and
  glows** (`0 0 0 3px …`: the connection dot, the focus and selection rings),
  which are not drop shadows at all.
  **And a literal can hide behind a `const`** — `StatusToasts`' `toastShadow`
  survived the first pass because the sweep grepped `boxShadow: "0 …`. Grep the
  VALUE's shape, not the property it ends up on; same lesson as an HTML entity
  being invisible to a glyph scan.
- **`--shadow-input` is for RECESSED fields, `--shadow-btn` for RAISED controls.**
  The input token leads with an inset white highlight, which is what makes a
  field look sunken. Settings had ~20 BUTTONS wearing `--shadow-input` (fixed
  v17.8.0), and that one mismatch is most of why that modal never quite looked
  like the rest of the app despite sharing its palette and radii. Text inputs
  and `<select>`s keep it.
- **One stepper: `mkStep(size)` in atoms.** Settings and LayoutSettings each held
  a private, byte-identical copy before v17.8.0.
- **v17.8.0: shadow literals are allowed ONLY over theme-invariant fills — and `npm run check:style` enforces it.** The script resolves the nearest governing `background` above a white-inset shadow and fails when it is a theme token; `/* @fixed-fill */` marks the one site whose fill is beyond a line-scanner's reach. The white-inset literals it was written for are **down to two** as of v17.10.1 (TimelineView's drag lift and the `Kbd` keycap, both marked `/* @shadow */`) — the figure of 22 recorded here was true in v17.8.0 and is not any more. **Plain dark drop-shadow literals are no longer unchecked either**: v17.8.0 called them "a consistency nit, not a bug class" and predicted a noisy rule, and both halves failed. They were three spellings of one intent, none deepening for dark — a black shadow cannot invert out from under itself, but it can be invisible on the wrong ground. `check:style` **Rule 6** now matches a drop-shadow-shaped VALUE anywhere on a line (not the `boxShadow` property — that is how a literal behind a `const` escaped v17.10.0's sweep) with a NON-ZERO blur (so rings and focus glows are excluded by construction). Anchoring is load-bearing: unanchored, the pattern slides and flags `0 0 0 2px rgba(…)` as a shadow. The `--shadow-*` tokens are not cosmetic — light carries `inset 0 1px 1px rgba(255,255,255,0.6)`, dark drops it to `0.05` — so a hard-coded white inset ships a light-mode highlight into dark, 3–8× too bright. That was 24 call sites. The exception is real: TimelineView's blocks sit on `BLOCK_BG` fills, which are deliberately theme-invariant, so a fixed white inset is correct there in both themes (same reasoning as their `borderRadius` exemption). Triage by asking whether the SURFACE UNDER the shadow flips with the theme.
- **THE HOVER LIFT IS FOR CONTROLS, NOT FOR CONTAINERS OF CONTROLS (v17.9.1).**
  `scale(1.08)` is a PROPORTION — 3px on a 40px button, but ~30px on an 820px
  List card, which slid that card's own Edit and Delete buttons out from under
  the cursor between aiming and clicking (measured: Edit −24px, Delete +31px) so
  clicks landed on the card instead. Any surface that HOLDS click targets gets
  **`.mgt-ac-row`** instead: a background tint, no transform. One class covers
  autocomplete rows, the List card, the Summary panel and the notification
  strip's lid; both colours arrive as custom properties (`--row-bg`,
  `--row-bg-hover`) **because every one of those surfaces sets its resting fill
  INLINE and an inline `background` beats a stylesheet `background-color`** — a
  plain rule silently never applies. Symptom to recognise: "I have to move the
  pointer off and back on before the buttons work."
  **Routing the fill through `--row-bg` makes the class LOAD-BEARING, not
  decoration** — it now supplies the *background* of four surfaces, so dropping it
  conditionally drops their fill. `Summary` did exactly that (class withheld while
  open) and rendered fully transparent, measured `rgba(0, 0, 0, 0)`. A custom
  property is only a value; the rule that reads it is what paints. `.mgt-ac-row`
  is in `tests/stylesheet.test.js`'s CRITICAL_SELECTORS for that reason.
  **v17.10.0 walked into the inline-background trap this rule is written about,
  in the `Collapsible` header.** The header carried `background:"transparent"`
  inline; the hover rule matched, the element reported `:hover`, and the computed
  fill stayed `rgba(0,0,0,0)`. Reading the source shows nothing wrong — the class
  is there, the property is set, the rule exists. **Only reading the computed
  background while actually hovering catches it.** When you add `.mgt-ac-row` to
  an existing element, DELETE its inline `background`, don't just add `--row-bg`.
  Two more geometry notes from that header, since it is the first `.mgt-ac-row`
  surface that had to grow a padding box: a tint needs padding to read as a row
  rather than a hairline band, and the matching negative margin is what keeps the
  resting layout put — **verify that by measuring, not by arithmetic**. And
  `width:100%` plus negative horizontal margins is over-constrained (the browser
  silently drops one side), while dropping `width` entirely does NOT work on a
  `<button>` even with `display:flex`, because it keeps its shrink-to-fit
  intrinsic sizing — the header collapsed to its text, 213px instead of 337.
  `calc(100% + 20px)` + `border-box` is the spelling that holds.
- **The third affordance: `.mgt-glyph`, for SVG (v17.9.1).** Floor-plan tables can
  take neither of the other two — `.mgt-hover-scale` sets a CSS `transform`, which
  **REPLACES an element's `transform` presentation attribute**, so `TableGlyph`'s
  own `translate(x,y) rotate(r)` vanishes and the table teleports to the plan
  origin; `.mgt-ac-row`'s `background-color` paints nothing on a shape. So: a
  **halo** (`--glyph-halo`, theme-split like `--shadow-*`) on hover, applied to the
  SHAPE so chairs and the id pill stay flat, plus `.mgt-press`'s dim on `:active`.
  It is applied INSIDE `TableGlyph`, gated on the table being interactive, which is
  what makes PlanView and the plan editor agree without either knowing about it.
  **v17.12.0 shipped that exact teleport for one commit, through a door nobody was
  watching: `role="button"`.** `src/index.css` holds three rules keyed on
  `[role="button"]`, and until v17.12.0 all three matched NOTHING — the seven-pass
  review recorded that as finding m2 and read it as housekeeping that would come
  good when blocks became buttons. It does come good for a `<div>`. Two of the
  three are the teleport for a `<g>`: `:active { transform: scale(0.96) }` deletes
  the table's position, and the shared `transition: transform` makes it FLY to the
  origin and back for as long as the button is held — measured, (554,243) →
  (313,176), computed transform `matrix(0.96,0,0,0.96,0,0)` — taking the click
  target out from under the pointer, so left-click stops working on the floor plan
  entirely. Both rules now carry `:not(.mgt-glyph)`, in the SELECTOR rather than as
  a class on the element: `.mgt-nopress` means "this control is inert and a press
  animation would be a lie", which a plan table is not. `user-select: none`, the
  third rule, deliberately still applies. Guarded by a DECLARATION assertion in
  `tests/stylesheet.test.js` — `[role="button"]` appears in several preludes, so a
  selector list cannot see the `:not()` half being simplified away.
  **The rule to carry: giving an SVG element an ARIA role subscribes it to every
  shared rule written for that role, and a shared rule in this app is usually a
  transform.** Check what the role already matches before adding it.
  **Why not `brightness()` for the hover, when the press uses exactly that:
  `brightness` multiplies channels, which is hue-safe only until one CLIPS, and a
  saturated fill clips almost at once.** Measured on the blocked-table orange: 1.35
  still orange, 1.6 plainly YELLOW — hovering a table made it look like a different
  status. Darkening cannot clip. **A filter that is safe in one direction is not
  automatically safe in the other**, and on any surface whose fill carries meaning,
  prefer an effect that adds something over one that modifies the colour.
- **Animate only the range that is VISIBLE (v17.9.1).** `AutoHeight` inside a
  scroll port eased its full height change — and Settings' General→Layout swap
  (2226px → 321px in a 611px port) spent 22 of 25 frames below the fold, because
  the modal card is `height: auto` under a `maxHeight` and cannot move until the
  box drops under the port. The card then did all 222px of its travel in three
  frames, which is what "it jumps" meant. The change now runs over the clamped
  range `min(prev,cap) → min(next,cap)` and retakes the true height afterwards;
  **every height at or above the port looks identical**, so both jumps are free.
  **When motion reads as a jump, measure what FRACTION of the animated range is on
  screen before touching the curve or the duration** — the easing may be perfect.
  **v17.10.0 applied it to the OBSERVER path too, which v17.9.1 had asserted was
  "already served correctly".** It was not: opening a Settings → Layout section
  spent 700ms of an 864ms animation below the fold with the port clipped, for
  165ms of visible travel. Both paths now share one pure `clampRange(live, next,
  cap)` (exported and tested — the arithmetic has been wrong twice), and `cap`
  gained the port's `scrollTop`, since the ceiling is where the box's bottom
  reaches the bottom of what is on screen **now** — v17.9.1 could read that as
  zero only because a tab swap resets the port's scroll first. **The General tab
  is why this hid for a version**: its content already overflows at rest, so the
  card is pinned at its max and the same wrong animation had nothing to spoil.
  "It only happens in one tab" was a clue about VISIBILITY, not about scope.
  A third branch falls out — when both ends are above the ceiling nothing can
  move, so the box takes the new height outright instead of clipping the port for
  385ms to ease to it.
  Three sub-traps are recorded at the component: the port is elastic so its ceiling
  must be probed rather than read, `transitionend` BUBBLES and `AutoHeight` nests
  (a child's transition was ending the parent's), and a ResizeObserver comparing
  content height against the box height breaks the moment those stop being equal.
- **v17.7.0: the hover rule no longer sets `border-radius`.** It used to hard-set `12px`, which squared off every pill the moment the pointer touched it. The declaration was **deleted**, not set to `inherit` — `inherit` resolves against the PARENT's radius, so a bare element inside a square parent would go square, which is the opposite of the intent. Each element now keeps its own resting radius on hover. Do not re-add a radius here. **Consequence: any `.mgt-hover-scale` element MUST set its own `borderRadius`** — the rule still applies an OPAQUE `--bg-hover-card`, so a radius-less element renders that background as a hard-edged rectangle on hover. `ConnectionStatus`'s dot button (transparent, no radius) was the FIRST case and got `borderRadius: R.pill`; **`CustomersSettings`' customer row was the second**, squaring off inside its own rounded card on hover until it got `R.card`. It has been called a one-off twice now. Treat a missing radius on a `.mgt-hover-scale` element as a bug by default, and grep the class when auditing.
- **v17.8.0: `.mgt-hover-scale` and `.mgt-press` share ONE `transition` declaration.** They are designed to compose (~30 elements carry both), they had equal specificity (0,1,0), and `transition` is a **shorthand** — so `.mgt-press`, declared later, REPLACED the hover rule's list instead of adding to it. Every element with both classes had no transform transition at all and snapped to `scale(1.08)` instead of easing: the reminder banner's Snooze/Done, the whole timeline zoom cluster, every banner ✕, the form's customer chips. Broken since v15.8.0 and invisible because the `filter` dim `.mgt-press` added still worked; v17.8.0's universal press-scale doubled it by adding a press dip that also snapped. **Two shorthand declarations of one property cannot merge — so don't have two.** One selector list, one declaration, covering every property either class animates; source order then cannot matter. Same trap applies to any future composable pair.
  **And to INLINE styles, the third copy of it** (v17.8.0 review fix): an inline `transition` beats both the class rule and `button {}`, so **any `.mgt-hover-scale` element with an inline `transition` must list `transform`** or its hover lift and its press dip both snap. Settings' TabBar named three properties and dropped the fourth — in the same commit that documented the class-level version. Grep `transition:` under `src/` when auditing.
- **v17.8.0: a stylesheet has no syntax errors, only rules that silently don't exist.** A stray `*/` after an already-closed comment left two lines of prose loose in the stylesheet; CSS error recovery folds that text into the NEXT rule's *selector*, so `.mgt-press:active` was dropped outright and the press dim died app-wide. The build says nothing, lint says nothing, and the source reads fine at a glance. **Verify a CSS change by walking the live CSSOM** — `[...document.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>/yourClass/.test(r.cssText))` — for the rule you think you wrote. Reading the file cannot catch this class of bug.
- **v15.1.0: the `:hover` rule is wrapped in `@media (hover: hover) and (pointer: fine)`.** iOS Safari makes `:hover` STICKY after a tap — unguarded, the last-tapped element stayed scaled 1.08, and full-width form inputs (Date/Time in the booking form) visibly overflowed their Section on phones. Touch devices get no hover lift at all; mouse/trackpad behaviour unchanged. The guard is part of the shared contract — **ported to MGT Scheduling in its v15.1.1** (2026-06-16); keep the two in sync.
- Opt-in per element via `className="mgt-hover-scale"`. Because `mkInp`/`mkBtn` return style objects, put the class **directly on the call-site element**, not via a prop.
- **In Bookings the lift is `transform: scale(1.08)` ONLY.** Every tagged surface uses `mkBtn`/`mkInp` (inline `background`+`boxShadow`+`borderRadius`), which beat the hover rule at higher specificity (Fix 2), so each keeps its own colour/shadow/radius and only scales. `--bg-hover-card`/`--shadow-soft` still apply to a bare (background-less) element — see the radius consequence above. Disabled controls stay flat via `:not(:disabled)`; for non-`disabled` "blocked" controls (TableGrid busy cells) the class is withheld instead (`className={blocked ? undefined : ...}`).
- **`Overlay` gained an optional pinned-`footer` slot (v14.4.1).** Pass `footer={…}` and the action buttons render fixed at the modal bottom while `children` scroll above (desktop = flex-column card with a `minHeight:0` scroll body; mobile = sticky bottom bar with safe-area padding). Omitting `footer` keeps the original single-scroll behaviour (back-compat for read-only popups like `HistoryPopup`). **All action modals pass `footer`** — the 5 component modals, the inline App.jsx confirm dialogs (delete/cancel/kitchen/reshuffle/reminder-del) + the Settings modal, and `ReminderEditor` (its own z-250 modal, restructured to the same scroll-body + pinned-footer shape). Blur budget unchanged (one card renders → scrim blur(8) + card blur(20) = 2). The Hover-scale Fix-4 inner-scroller is still NOT used — the footer region has its own padding, so hover-lifts don't clip there.
- **Fix-3 timeline (`TimelineView`):** pad the *scroller* (`padding:8`), NOT the inner grid — the grid is `pct()`-positioned against the inner width, so padding the inner div shifts every block. `labelCol` mirrors the scroller's `paddingTop:8` so rows stay aligned (verified: row-top delta 0).
- **Coverage:** v14.3.0 header chrome · v14.3.1 ListView cards+buttons, TimelineView controls+blocks, Settings tabs · v14.3.2 `Toggle` atom + every modal's buttons/steppers/cells/inputs + App.jsx confirm-dialog & banner buttons.

### Accessibility — the second half of the interface (v17.12.0)

Until v17.12.0 this app was **bimodal**, and the split fell exactly along *did
anyone ever see it fail*. Measured on one build in one moment: 6 of 6 rendered
font sizes on the type scale, 1 backdrop-blur of an allowed 4, 0 craft-detector
findings, a 12.5:1 focus ring, no horizontal scroll at 320px — and **0**
landmarks, **0** headings above `h2`, **0** live regions, **0** named form
fields, **0** bookings reachable by keyboard in any of the three views.

That is not carelessness and reading it that way produces the wrong fix. Every
rule in this file was earned by an **observed** failure. Accessibility defects
are the ones nobody sees: they cause no incident, so they generate no lesson, so
they never entered the loop that produced everything else here. The answer is to
ship the fixes and then **mechanise the standard**, which is what
`tests/a11y.test.js` does — it landed in v17.13.0, not v17.14.0 as this line
said, because Patryk moved the gate ahead of the modal stack.

**A live region must already exist in the DOM when its content changes.** A
region that arrives *holding* its first message announces nothing. This decides
where each one lives, and the two notification surfaces needed opposite answers:
`StatusToasts` takes `role="status"` on its own container because that container
has been always-mounted since v15.8.0 (for the unrelated reason that each `Toast`
outlives its out-animation), while `NotificationStrip` mounts only when it has
something to say — so the strip is a `role="region"` landmark and the
announcement is `notifAnnounce`, an always-mounted hidden region in `App`. Same
rule puts the booking form's `role="alert"` wrapper permanently in the tree with
only its child conditional.

**`role="button"` makes its children PRESENTATIONAL — never put it on a container
of controls.** The List card holds Assign, four status changers and Delete;
labelling it a button would have hidden all six, trading one unreachable card for
six unreachable controls. It is a `role="listitem"` in a `role="list"`, focusable
and operable. A timeline block is a **leaf**, so `role="button"` is right there
and its flags' meaning goes into the name. `role="grid"`/`row` is the pattern
built for rows-with-controls and was the first choice for List — it fails because
a grid's children must be rows and the "Completed & cancelled" `Collapsible` sits
between the cards.

**The timeline block was NOT a leaf, and the first pass shipped the rule it had
just written.** The block carries the manual-assign handle, so `role="button"` on
the block hid it. The fix is the general one: **the role goes on an inner wrapper
holding everything the button-press means, and the nested control is that
wrapper's SIBLING.** That is free here — the wrapper takes the `1 1 0%` the name
group took against the handle, and the name group keeps that basis inside it, so
the flex distribution is arithmetically unchanged. Ask "does this element contain
anything clickable" before the role, not after; the answer was four elements
further down the same JSX.

**And a role is not only a label — it SUBSCRIBES the element to every shared rule
written for that role.** `[role="button"]` matched nothing in this app until
v17.12.0, so three CSS rules were dormant; two of them are transform-based and
teleported every floor-plan table (see the `.mgt-glyph` note in the hover
section). Grep the role before adding it.

**Announce the SELECTION by moving real focus, not with
`aria-activedescendant`.** That attribute needs a container that holds DOM focus
and publishes its active descendant; this app's arrow keys are served by a
**global window listener** that works with nothing focused at all. `ListView`'s
↑/↓ now moves actual focus (once, synchronously — see the rAF note below), which
the platform announces with no relationship to keep in sync.

**One roving tab stop per list.** Ten cards × ~6 controls each would put ~70 stops
between the top of List and anything after it. The selected card holds the stop,
or the first card when nothing is selected, so the list is always enterable.

**A shared component is only shared if nothing is allowed outside it.**
`Overlay` has carried `role="dialog"`, `aria-modal`, a DOM-resolved name, a
focus trap and focus restore since v17.9.1 — and `ReminderEditor` had none of
them, because it was never on `Overlay` at all. Its stated reason was structural
and sounded convincing (it renders at z=250, Overlay's scrim is 200) and was
false: the discard confirm sits at z=260 on `Overlay`, by wrapping it in a
positioned div. **That is the general shape — a surface leaves the shared
component for a plausible reason that nobody re-checks, and takes every
invisible guarantee with it.** So the gate is on the STRUCTURE, not the roles:
`var(--scrim)` may appear in exactly one file. Asserting "every modal has a
dialog role" would have caught nothing here, because the file was not a modal
that forgot its role. A modal that must sit above another gets a positioned
wrapper with a higher z-index; the popups paint `--tl-popup-scrim`, since a
popup is not a dialog and must not claim to be one.

**SVG breaks the focus rule in two ways, and both are invisible in source.**
A browser paints **no `outline` on a `<g>`** (it does on the shape child), and
**`:focus-visible` never matches an SVG element in Chrome** — two consecutive
real Tab presses leave the group matching `:focus` only. Plain `:focus` is not
the fallback, because a real click focuses the group too and would leave a ring
behind every table tap. Hence `[data-kbd]` (set in `App.jsx` on Tab/arrow
keydown, cleared on `pointerdown`) plus a ring on `.mgt-glyph-shape`. **Measure
an SVG focus indicator live; do not reason about it.**

**Making something focusable makes the browser SCROLL IT INTO VIEW on
mousedown — so content must be focusable by keyboard, not by pointer.** This is
the one regression v17.12.0 shipped and had to fix. Measured: pressing a floor-plan
table scrolled the view **40px**, pressing a timeline block scrolled it **1000–2000px
sideways**, pressing a List card moved it **297px**. The element travels out from
under the finger between press and release, so the click lands somewhere else and
the popover/form never opens — which is exactly "the Plan does nothing when I tap
a table". `onMouseDown` → `preventDefault()` suppresses **only** the focus (and
native drag/selection); it does not cancel the `click`, and it does not touch
pointer events, so a `pointerdown`-armed pan, drag threshold or touch hold is
unaffected. Keyboard focus is untouched. **`ListView`'s card is deliberately NOT
given this**, because `preventDefault` on mousedown also kills text selection and
staff select the phone number off that card; its click opens a modal that covers
the scroll anyway. **A synthetic click cannot reproduce this** — the tool's
mousedown and mouseup are back-to-back, so the focus-scroll lands after the click;
it needs the ~100ms gap of a real finger.

**`inert` removes a subtree from the accessibility tree as well as the tab
order.** So a live region inside an inert region goes SILENT — which is why
`notifAnnounce` is a sibling *after* `</main>` rather than inside it.

**That rule was written and then broken in the same version, one level down.**
`inert` went on `<main>`, and `<main>` also contains `StatusToasts` — the app's
OTHER live region, the one carrying the connection dropping and a write failing.
Every toast was silent behind every modal, and the Undo pill inside that layer
stopped being clickable. `inert` now sits on the two CONTENT children (the
notification strip's wrapper and a wrapper around `SlideView`), never on `<main>`
itself. **The test is not "is this behind the dialog in the DOM" but "is this the
page behind the dialog"** — a floating status layer pinned above it is not.

Modals render inline as siblings of `<main>`, so the marks go on siblings rather
than one wrapper: a wrapper div would re-parent the `shellFixed` flex column.
`SlideView`'s wrapper is the exception that proves it — that one MUST carry
`flex:1; minHeight:0; display:flex; flexDirection:column`, because `SlideView`'s
`fill` resolves against its parent. `anyModal` is ONE derivation in `App` (it was
the same 17-term expression twice in `useKeyboardShortcuts`, and `inert` would
have made it three).

**`aria-describedby` must never dangle.** An id that is not in the tree is worse
than no description — the same trade `Overlay` refuses when it resolves its name
from the DOM. `Fld` emits it only alongside `aria-invalid`, and only when the
caller says the field is invalid, which in the booking form means the message is
rendered. Same reasoning bans `aria-modal` on the connection popover: it has no
focus trap, so it must not claim one.

**Anything gated on `requestAnimationFrame` needs a non-rAF path.** rAF does not
fire in a hidden or occluded tab. `ListView`'s focus-on-selection was written
inside the same rAF as its scroll and silently never ran, while the scroll — which
also has timers — worked. It is synchronous now, with one 120ms retry.

**v17.13.0: this section has a gate.** `tests/a11y.test.js` asserts the wirings
above are still present — landmarks and one `<h1>`, the three live regions and
where each has to live, `inert` never on `<main>`, `Fld`'s association on both
shapes, bookings reachable in all three views, the List card explicitly not a
button, pointer-focus suppression, and the connection popover claiming
`haspopup` but not `aria-modal`. It reads SOURCE, so it cannot claim the app is
accessible and must not be read that way; what it claims is that the decisions
here have not been quietly undone — which matters because **every one of them
is invisible when it is removed.** Live measurement is still the method for
anything new. Its own first run produced two false positives and both were
comments explaining the very absence being asserted, which is why it strips
them (`scripts/strip-comments.mjs`).

**A finding is a measurement with a date on it.** Two of the seven-pass review's
items needed no code at all: m1's clipped focus ring was fixed by v17.10.2 before
the fix was attempted, and m2 was closed by giving timeline blocks `role="button"`.
Re-run anything measured against an older release before acting on it.

**And m2 was not only closed by that — it was a warning.** "`[role="button"]`
matches nothing" is the same sentence as "no element in this app is currently
subscribed to those three rules", and the review's own note said so: *if C1 is
fixed by adding `role="button"` to blocks, this rule starts applying*. It read as
a benefit and it is one for a `<div>`. For the floor plan's `<g>` it shipped the
v17.9.1 teleport — see the `.mgt-glyph` note in the hover section. **A dormant
rule is a rule whose behaviour has never been observed**; treat "this selector
matches nothing yet" as a thing to go and read, not as a footnote.

**The skip link (v17.14.0).** v17.12.0's landmarks are the *programmatic*
bypass; this is the one a sighted keyboard user can take, and it needed a look
rather than only a wiring. It is a focus-revealed pill in the app's own chrome
vocabulary (`--r-pill`, `--accent`, `--text-on-accent`, `--shadow-btn-accent`)
pinned to the viewport corner, invisible until Tab reaches it — the only new
chrome in this version, and it costs nothing on screen until someone needs it.

Three of its rules are about a control that can be **present and useless**, and
none of them is visible in review:

- **Hide it by TRANSLATION.** `display:none` and `visibility:hidden` both make
  an element unfocusable, so the link could never be reached while looking
  perfectly correct in the source.
- **The target must be able to hold focus.** Following a fragment link moves
  focus to the target only if it can take it, so `<main>` carries
  `tabIndex={-1}` — `-1`, so it never joins the tab order. Without it the
  browser scrolls and the next Tab starts from the header again, which looks
  exactly like the link working.
- **It sits outside anything that goes `inert`.** A skip link inside an inert
  subtree is silently unfocusable, one element along from the live-region rule
  above.

`main:focus { outline: none }` because the ring belongs on the link you pressed,
not as a browser default drawn around a full-width region — which reads as the
whole page being selected. Both `.mgt-skip` selectors are in
`CRITICAL_SELECTORS`: losing either fails silently in opposite directions.

**A disabled control still has to say what it is (v17.14.0).** WCAG 1.4.3
exempts inactive components, and this app used that exemption to ship a
"Save booking" label at **1.30:1** — not dim, gone: an empty grey pill. The
exemption is about not forcing a *contrast bar* on a disabled control; it is not
a licence to delete the label. `--btn-disabled-ink` is per-theme, and the reason
is the general one: **`--btn-disabled` is `:root`-only and composites toward
whatever is behind it, so its effective colour flips with the theme even though
its declaration does not.** An ink that inverts the same way the composite does
(`--text-muted` was the obvious candidate) does not fix that — it swaps which
theme is broken: 4.59:1 light but 2.30:1 dark, against white's 1.30 / 6.42.
Measured live at 5.14:1 light and 4.60:1 dark, so it is no longer an exemption.

### Press feedback — universal, opt-OUT (v17.8.0)
Every `button` dips to `scale(0.96)` on `:active`; `.mgt-hover-scale` buttons dip
to `1.02` from their lifted `1.08` so the travel stays proportional. Both are in
`src/index.css` next to the hover rule.

- **The specificity is load-bearing.** `.mgt-hover-scale:hover` is (0,2,0), so a
  plain `button:active` (0,1,1) LOSES and the press is invisible on desktop —
  a mouse user is always hovering the button they press. The shipped selector is
  `button:active:not(:disabled):not(.mgt-nopress)` = (0,3,1). Don't "simplify" it.
- **`.mgt-nopress` is the opt-out**, for controls that are inert but NOT
  `disabled` (TableGrid's blocked cells) — animating a tap that does nothing is
  a lie about what happened. Same principle as withholding the hover lift there.
- **iOS needs the touch listener.** Safari only delivers `:active` when a touch
  listener exists somewhere on the document; the empty passive one in
  `index.html`'s boot script is the only reason this works on the tablets.
  Remove it and the whole effect silently becomes desktop-only.
- Inline transforms still win by design (TimelineView's drag `translateY`).
- **v17.10.1: the PLATFORM tap highlight is suppressed, and the app owns 100% of
  its press feedback.** Chrome's Android default `-webkit-tap-highlight-color` is
  `rgba(51,181,229,0.4)` — Holo blue — and it is painted as a **rectangle over
  the border box, ignoring `border-radius`**, so every pill in the app flashed a
  blue rectangle on touch. Killed on `:root` (the property inherits). It was also
  the only feedback the two non-`<button>` tap targets had, so both gained the
  app's own language, and **which one they get is the v17.9.1 rule again**:
  `.mgt-ac-row:active` gives a **tint** to containers of controls (List card,
  Summary, autocomplete rows, the strip's lid) — a scale there would shrink the
  card under the button you were aiming at, because **`:active` matches
  ANCESTORS of the pressed element**; `.mgt-blk:active` gives the **dip** to the
  timeline block and waitlist ghost, which are leaf controls. Target `.mgt-blk`
  rather than widening the rule to `.mgt-hover-scale` — several containers of
  controls carry that class too.
- The older `.mgt-press` brightness dim stays and composes — `filter` and
  `transform` are orthogonal.

### Motion — two curves, three durations (v17.8.0)

Tokens in `src/index.css`'s `:root` (theme-agnostic, so NOT duplicated into the
dark block, same as the radii); JS reads them through **`M`** in
`lib/constants.js`. **No new easing or duration literal** — `grep -rn "ms ease\|ms linear\|cubic-bezier" src/` must come back empty apart from `M`'s own
WAAPI values.

**The split is by DIRECTION, not by element.** `--ease-out` (cubic-out,
`0.33,1,0.68,1`) for everything that arrives, opens, moves, or answers a finger;
`--ease-in`, its exact mirror, only for things leaving — an exit accelerates away because the eye
has already moved on. Before this the app had five curves (`ease`, `ease-out`,
`ease-in-out`, `linear`, Material's `.4,0,.2,1`) picked per site over eight
versions, so a modal's scrim faded `linear` while the toast inside it used
Material's curve while the button on it used `ease`: three materials in one
glance.

Durations by **what is moving**: `--t-tap` 145ms (a control answering your
finger), `--t-move` 240ms (something arriving or leaving), `--t-shift` 385ms
(geometry — heights, widths, positions).

**`--t-reveal` 520ms (v17.15.0) is a DISCLOSURE**, and it is its own token
rather than a bigger `--t-shift` because the two ask different things of the
eye. A block repositioning is something you WATCH ARRIVE, and 385ms is already
generous. A disclosure is something you READ AS IT ARRIVES: the content is new,
several lines tall, and the motion is the only thing saying it came out of the
header you just pressed rather than being dumped on the page. Reported as "too
snappy", which is the complaint of being handed something before you are looking
at it. `Reveal` is the only consumer — the Summary, the finished fold, all ~15
Settings sections and the notification strip's LID; nothing geometric moved.

**Read "under your finger" as load-bearing.** The list above said "the
notification strip", and that component holds TWO `Reveal`s: the lid's body,
which you pressed, and the pane itself, which arrives because a booking went
late or because you changed the day. Nobody pressed the second, so it is not a
disclosure at all — it is `--t-move`'s own definition, "something arriving or
leaving" — and at 520ms it outlasted the 240ms view slide by more than double,
so a date change slid sideways and then went on rising: one event read as two.
`Reveal` therefore takes a **`speed`** naming an entry of the `M` scale, still
defaulting to `"reveal"`; the strip's pane is the one caller that opts out
(v17.15.0). A NAME rather than a number, because the CSS timing and the unmount
hold must come from the same entry — the two halves this version found wrong in
six places. **When a shared component serves two kinds of change, say which one
each call site is.**

**The curve was a quint (`0.22,1,0.36,1`) for one version and it was wrong for
travel.** A quint spends ~90% of the distance in the first third of the time —
right for a press dip, where the eye only registers arrival; wrong for anything
crossing a distance. The toggle knob proved it: the transition was applied and
correct, and the 21px slide still read as a teleport. **Diagnose "it jumps" by
sampling the intermediate positions before touching the duration** — the value
may be fine and the curve the fault. Corollary: `--t-tap` is for a control
*acknowledging* a tap. Anything that TRAVELS (a knob, a pane, a block) takes
`--t-move` or `--t-shift`, however small the control is. Two more sit outside the scale on purpose: `--t-status`,
which exists *because* TimelineView and PlanView must agree on it (a shared
number needs a shared name), and `--t-wipe`, which TimelineView's
`__statusAnims.until` window depends on.

Three exceptions, all real, and the first two are the same idea. `.mgt-dot-pulse`
keeps `ease-in-out` — a loop has no arrival and no departure, so neither
direction curve applies; it is a breath, not a move. **`M.resize`
(`--t-shift linear`) is `AutoHeight`, and only `AutoHeight`** (v17.8.0): a box
conforming to content that already changed is not travelling either, so there is
no arrival to decelerate into and ease-out only front-loads — cubic-out covers
70% of a height change in the first third of the time, then crawls, which is
exactly what "jumpy" describes. **The tell for both: ask whether anything is
going anywhere.** If nothing is, a direction curve is describing a motion that
isn't happening. Third, **`useFlip` keeps literal numbers because WAAPI cannot
read a CSS var** (it resolves to nothing and the animation silently runs
linear), which is why `M.dur`/`M.easeOut` exist and are the only values here
that can drift.

**Never `transition: all`** — it animates layout properties too and you cannot
tell what moves by reading it. Name the properties.

**An exit has two halves, and nothing in the language connects them** (v17.15.0).
A `*-out` keyframe class has a duration; a JS timeout decides when to unmount.
When the timeout is shorter the exit is not broken in any way a reviewer can
see — it plays part way and the node blinks out at whatever opacity it reached.
It was wrong in six places at once, by five different hand-typed numbers, and
measured live: closing the booking form ran `mgt-scrim-out` (240ms) and
unmounted it at `currentTime` 167, so the scrim vanished at 70% of its own fade
while still plainly visible. **The hold is derived, never typed** — `EXIT_MS`
and `REVEAL_EXIT_MS` in `lib/constants.js` sit beside the tokens they follow,
every primitive takes them as its default, and `tests/motion.test.js` fails the
build if a hold stops outlasting its animation, if `M.dur` drifts from
src/index.css, or if a component passes a literal `outMs` again. Exactly ONE site
had it right beforehand and said so in a comment nobody had propagated — the
same shape as v17.14.0's five hand-written modal lists.

**`useFlip` measures relative to its CONTAINER, not the viewport** (v17.15.0).
It re-measures only when its deps change, so anything that moves the whole
container without changing them — the notification strip appearing — leaves its
baseline holding pre-shift coordinates, and the next unrelated edit animates
every element by that stale offset. Measured on the timeline: collapse the strip
(blocks move 105px, zero FLIP calls), add a booking, and all five blocks play
`translateY(-46px) → 0` with four of them still on the same table. Container-
relative is also what the hook MEANS: it animates a row change, which is
movement inside the container; a whole-container move is the page reflowing
around it, which the browser has already drawn.

### Adding motion to something that has none

- **Fading in to an element's own opacity** is `.mgt-appear`, not
  `.mgt-fade-in`. It has no `to` (an omitted endpoint resolves to the element's
  computed value, so the timeline's waitlist ghost lands on its 0.55/0.4 without
  the rule knowing that number) and **no fill-mode** — `both` would pin the
  animated properties forever, which on a `.mgt-hover-scale` element means the
  lift never applies again. For the same reason it animates opacity only:
  nothing may own `transform`, because the hover and press rules do.
- **Fix the exit at the same time as the entrance, always.** A one-way
  transition is the app's most common motion defect and the least visible one:
  it looks finished. Before adding an enter animation, decide what the exit is —
  and if the answer is "the node just unmounts", that is the bug, not the
  design. The three surfaces v17.15.0 left one-way are recorded in `ROADMAP.md`
  with the reason (each needs two copies of a stateful view mounted at once).
- **An element that must animate OUT needs its content held.** `Reveal` already
  caches its last truthy children for exactly this — pass `null` and it fades
  out what it was showing. Corollary that bit once: it only caches **truthy**
  children, so a parent must pass `null`, not a live-but-empty component (that
  is why App's strip mount site is `{notifSections.length ? <Strip…/> : null}`).
- **One `Reveal` cannot animate a SWAP.** Two disclosures sharing a Reveal
  (`show={!!panel}`, content chosen by which one is open) never change `show`
  when you switch between them, so the rows are replaced in a single frame and
  the height snaps. Give each its own Reveal: the switch is then what it really
  is, one closing while the other opens, and because both ride the same curve
  for the same duration the container height interpolates straight from A to B
  with no bulge. `BookingFormModal`'s Regular / No-shows chips, v17.8.0.
- **A list whose items animate out must remember ORDER, not content.**
  `useRevealRows` keeps departed ids alive but its `renderIds` is
  arrival-ordered. If the list is sorted by anything else, a departing item's
  remembered index **ties** with whatever shifted up into its place, and the tie
  falls through to arrival order — so it visibly jumps before it collapses. Sort
  departed items half a step above their replacement (`rank - 0.5`).
- **A REPLACEMENT is not a change, and a per-item lifecycle cannot tell them
  apart.** `useRevealRows` holds a departed id mounted so it can collapse and
  mounts a newcomer closed so it can ease open — right for an item arriving or
  resolving while you watch, wrong for a list swapped wholesale, where it shows
  the OLD list for the length of its collapse and passes through a combined
  state belonging to neither side. Measured on the notification strip across a
  date change: half a second of the previous day's notifications, and 70px of
  height travelled to finish 2px away. Pass a `resetKey` (v17.15.0) so the
  lifecycle re-seeds as it does on first mount, and animate the box ONCE from
  the old height to the new. **Retiming cannot fix a replacement animated as a
  change** — the wobble was the visible half, the stale content was the half
  that mattered.
- **A gesture owns ONE axis.** If two things move at once on different axes,
  no duration or curve reconciles them — co-timing them perfectly is what makes
  the diagonal *clean*, not what removes it (v17.15.0 shipped that intermediate
  state and it was reported again). A date change drives both the view's
  entrance and the notification strip's height, so it fades rather than slides
  and keeps the vertical axis it cannot avoid: measured across 19→26 August it
  moves the grid −98, +100, +51 and −151px, and the two upward ones read as the
  grid heading for a top corner. The T/L/P switch keeps the horizontal slide,
  because the strip sits outside the view and a view switch moves nothing
  vertically. **Before choosing a duration, ask which axis the gesture owns.**
- **A one-shot is not `AutoHeight`.** That atom's observer chases its content
  every frame and clips the overflow, which is right for a Settings tab and
  wrong for any box whose contents animate by design — there, every in-place
  change gets clipped by a box following it. For a height change that happens
  on a known event, use one WAAPI shot: it runs only then, and with the default
  `fill: none` it leaves no inline height to get stuck.
- **Not everything that appears needs an animation** — but check the claim
  against what shipped. This bullet named the empty-day state as the example
  until v17.15.0 gave it a `Reveal` in the same version whose docs pass left the
  sentence standing. The reasoning was that `SlideView` is already animating the
  whole view on a date change; what it missed is that the prompt also appears
  and disappears *without* a navigation, when the last booking of a day is
  cancelled or the first is made, and there it was the only in-flow surface left
  changing the page height in one frame.

---
