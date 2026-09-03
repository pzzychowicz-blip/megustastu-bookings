// src/components/ListView.jsx
// List-view rendering of the day's bookings — sorted by status (seated first,
// then confirmed, completed, cancelled), then by time. Each booking renders
// as a card with name, status badge, party size, time range, table chips,
// optional notes, and action buttons (Assign + the status changers + Delete).
// v17.10.0: the CARD ITSELF opens the edit form — there is no Edit button.
//
// Pure presentational, no hooks. All state lives in BookingApp.
//
// The "live duration" tag (only on seated bookings) shows actual elapsed
// minutes since seating (min 15) — this is separate from the end-time label,
// which is pinned to the scheduled plan until a guest overstays. See the
// inline comments preserved from v14 p1 inside the map for the original
// design rationale.
//
// Phase B4 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// Behaviour, output markup, and all inline styles are byte-identical to the
// original.
//
// Phase C1 (v15-refactor): `statusOrder` moved to booking-logic.js. The
// inline `liveDur` / `elapsedMin` calculations stay here — they have
// different semantics from TimelineView's `liveBarDur` (end-time pinned to
// plan vs live bar width) and aren't shared.
//
// v15.1.0: completed + cancelled cards moved behind a controlled Collapsible
// ("Completed & cancelled"), collapsed by default for a cleaner day view.
// The open state (`showFinished`) lives in BookingApp — NOT here — so the
// List keyboard model (↑/↓ over listDaySorted + per-card shortcuts) can
// exclude the hidden cards while the disclosure is closed. The card JSX is
// unchanged, just hoisted into renderCard() so both groups share it.

import { useEffect, useMemo, useRef, useState, memo } from "react";
import { S, BLOCK_BG, BLOCK_INK, STATUS_COLORS, BTN, R, T, FW, IC, SP } from "../lib/constants";
import { toMins, toTime, isLocked, statusOrder, lateMins, liveBarDur, stayedMins, describeBooking, seatingClosed } from "../lib/booking-logic";
import { EmptyDay } from "./EmptyDay";
import { noShowMap, identityKey } from "../lib/customers";
import { SBadge, TBadge, SizeRing, mkBtn, Collapsible, Reveal, useFlip, InlineAlert, ALERT_TONES } from "./atoms";
import { AssignIcon, CloseIcon, NoShowIcon, StarIcon, StatusIcon, OverlapIcon, LockIcon, DepositIcon, ClashIcon } from "./Icons";

// ── The card's flag rail (v17.15.5) ──────────────────────────────────────────
// The same facts TimelineBlock draws on its right-hand rail, in the same order
// (deposit → preferred → locked → repeat-no-show), with the same icons at the
// same IC.control size — so a booking reads the same left-to-right whichever
// view you are in. Before this the card said them as seven solid coloured
// pills printing words, and a host moving between the two views had to learn
// both vocabularies for one booking.
//
// WHAT THE CARD KEEPS THAT THE BLOCK CANNOT. A 36px block has room for a glyph
// and nothing else, so the deposit AMOUNT, the no-show COUNT and the preferred
// TABLE IDS live only in its hover title. The card has the width, so they stay
// on screen: this is icon + its number, not the block's bare icon. Dropping
// them to match would be levelling down — the same mistake v17.9.0 caught when
// it dimmed the one legible element on a block to match the illegible ones.
//
// THE FILL IS WHAT GOES, and DESIGN.md's rule is what sends it. "Match whatever
// sits next to you" is why these were solid: they shared a row with four other
// solid tags. The row is icon-led text throughout now, so the same rule points
// the other way, and each flag's INK carries what its fill used to — warn for
// the two problems, success for money taken, secondary for the plain facts.
// All four pairings against --bg-card-strong / --bg-card-dim are measured and
// registered in tests/contrast.test.js (6.73–9.69:1, both themes); a tone
// chosen by hand is exactly what that registry exists to catch.
const FLAG = {
  display: "inline-flex", alignItems: "center", gap: SP.tight,
  fontSize: T.small, fontWeight: FW.semi, whiteSpace: "nowrap"
};
const FLAG_NEUTRAL = "var(--text-secondary)";
const FLAG_WARN = "var(--warn-text)";
const FLAG_SUCCESS = "var(--success-text)";
// v17.15.5 (/code-review): the clash flag is DANGER, not warn. The card's
// border for a clash is `--card-overdue-border` (red), so drawing the marker
// in the same amber as `no-show ×N` and `N min late` said two different things
// about one booking's severity — and flattened the most severe state on the
// card into the two lesser ones. Registered in tests/contrast.test.js like its
// three siblings (8.31:1 light, 6.73:1 dark).
const FLAG_DANGER = "var(--danger-text)";

// An icon-bearing flag. `role="img"` + `aria-label` for TimelineBlock's own
// reason: every icon in Icons.jsx is `aria-hidden` (correctly — an icon beside
// its own label must not be announced twice), so without a role and a label on
// the wrapper the fact simply leaves the accessibility tree.
//
// The label is the FULL phrase, not the compact visible text, and that is not
// the Label-in-Name trap v17.15.4 recorded: these are not operable controls, so
// there is no name for a voice-control user to say and nothing to match. The
// visible "×3" is a compact rendering for the eye; "3 past no-shows on this
// number" is the same fact said properly. A CONTROL in this row would have to
// lead with its visible text.
function CardFlag({ title, ink, children }) {
  return (
    <span role="img" aria-label={title} title={title} style={{ ...FLAG, color: ink }}>
      {children}
    </span>
  );
}

// A text-only flag — `manual`, `N min late`, and the duration counter. These
// three have NO counterpart on a timeline block (late is an amber BORDER there,
// the duration is the block's live width, and `manual` is not drawn at all), so
// they get no mark: an icon that means something in one view and nothing in the
// other is worse than no icon. `LateIcon` exists and is the notification
// strip's Running-late mark — it was considered here and left out for exactly
// that reason, so please do not re-litigate it without also putting it on the
// block. No role: the text IS the label.
function TextFlag({ ink, children }) {
  return <span style={{ ...FLAG, color: ink }}>{children}</span>;
}

// v15.8.0: module-level status-change detection (mirrors TimelineView) so a card
// that changes status plays a colour wipe of its OLD status colour. Keyed by id,
// expires by timestamp; single list on screen so module scope is safe.
let __listPrev = null;
const __listAnims = {};

// v17.10.0: the card is now a click target (it opens the edit form), so EVERY
// control inside it has to stop the event on its way out or it does its own job
// AND opens the form. This wrapper exists so that is one visible word per
// handler rather than a stopPropagation line each — a control that forgets it
// fails in a way that looks like the form opening at random.
function stopped(fn) {
  return function (e) { e.stopPropagation(); fn(e); };
}

// v17.10.0 /code-review fix: a drag that ENDS a text selection is not a click on
// the card. The card opens the edit form now, and the row it opens from prints
// the guest's phone as plain text — which staff select and copy to ring a party.
// Press-drag-release over that text fires `click` on the card, so copying a
// number opened a modal over the selection, and if the form was mid-edit the
// unsaved-changes guard fired on the way back out.
//
// The selection has to be INSIDE this card: a stale selection elsewhere on the
// page (the day header, a banner) must not make cards unclickable, which is what
// a bare `getSelection().toString()` check would do.
function endsASelection(el) {
  const sel = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return false;
  return el.contains(sel.anchorNode) || el.contains(sel.focusNode);
}

// v17.1.0 perf: React.memo — all function props are App's stable VA wrappers,
// data props change identity only on real change (memoized in BookingApp).
export const ListView = memo(function ListView({
  bookings, date, onEdit, onStatus, onDelete, onManual,
  nowMins = 0, today = "", warnings = {},
  // v17.15.5: `clashes[id]` = {names, tables} for a booking double-booked with
  // another — App's `clashMap`, the same memo TimelineView takes.
  late = {}, clashes = {}, onNoShow = () => {},
  selectedId = null, onSelect = () => {}, focusReq = 0,
  showFinished = false, onToggleFinished = () => {},
  // v17.14.0: `emptyWalkin` — one name across all three views, see TimelineView.
  // `isEmpty` comes from App too: the three views used to answer "is this day
  // empty" three ways, and List's answer was the odd one out. See its use below.
  onNew = null, emptyWalkin = null, isEmpty = false,
  // v17.11.0: the viewed day is a closed day. EmptyDay renders nothing then —
  // the strip's `Closed this day` section is the empty state for that case, and
  // offering two buttons the app refuses is worse than offering none.
  dayClosed = false,
  currency = "€"
}) {
  // v17.0.0 round 8 (Patryk): the 🔍/⚙ pair moved OUT to App's date-nav row
  // (ViewTools.jsx) — one home for all three views. List keeps no chrome of its
  // own again; the `searchBar` element and its two buttons are gone.
  const day = bookings
    .filter((b) => b.date === date)
    .sort((a, b) => {
      const sa = statusOrder(a.status);
      const sb = statusOrder(b.status);
      if (sa !== sb) return sa - sb;
      return a.time.localeCompare(b.time);
    });

  // statusOrder already sorts completed/cancelled last, so splitting here
  // preserves the exact visual order the inline list had.
  const active = day.filter((b) => b.status !== "completed" && b.status !== "cancelled");
  const finished = day.filter((b) => b.status === "completed" || b.status === "cancelled");

  // v15.8.0: detect status changes → stamp a wipe of the OLD colour; FLIP the
  // active list so a re-sorted card eases to its new position instead of jumping.
  // v16.4.0 /code-review: this hooks block MUST run before the empty-day early
  // return below (rules of hooks) — it used to sit after it, so adding the
  // day's FIRST booking without a remount (no slide bump) changed the hook
  // count between renders and crashed the view.
  const [, bumpAnim] = useState(0);
  useEffect(function () {
    const prev = __listPrev;
    const now = Date.now();
    if (prev) {
      let changed = false;
      day.forEach(function (b) {
        const p = prev[b.id];
        // v15.9.0: window 700→800ms so it outlives the slowed 760ms wipe keyframe.
        if (p && p !== b.status) { __listAnims[b.id] = { from: p, until: now + 800 }; changed = true; }
      });
      if (changed) { bumpAnim(function (n) { return n + 1; }); setTimeout(function () { bumpAnim(function (n) { return n + 1; }); }, 820); }
    }
    const m = {};
    day.forEach(function (b) { m[b.id] = b.status; });
    __listPrev = m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);
  function listAnimFrom(id) {
    const a = __listAnims[id];
    return a && a.until > Date.now() ? a.from : null;
  }
  const flipRef = useFlip([active.map(function (b) { return b.id; }).join(",")]);
  // v17.3.1: the List's own root — the scroll-into-view lookup below is scoped
  // to it (TimelineView tags its blocks with the same data-flip-id values).
  const rootRef = useRef(null);

  // v16.0.0: repeat no-show offender map (2+ past no-shows on this phone,
  // counted across ALL dates — the full bookings prop, not just `day`).
  // v17.1.0 perf: memoized (walks every booking ever) + moved above the
  // empty-day early return (rules of hooks — the v16.4.0 lesson).
  const nsMap = useMemo(() => noShowMap(bookings), [bookings]);

  // v17.3.1: scroll the focused card into view on a PROGRAMMATIC selection —
  // a search-jump (SearchPanel → App's pendingSelectRef / same-day branch) or
  // ↑/↓ keyboard nav. Keyed on App's `focusReq` counter, NOT on `selectedId`,
  // so clicking a card never yanks the page under the finger/cursor.
  // The card element is found by its existing `data-flip-id` (booking ids are
  // path-safe [0-9a-z], so the attribute selector is safe to build) — scoped to
  // the List's OWN root, because TimelineView tags its blocks with the same
  // attribute and the same ids, and a document-wide query could pick one of
  // those up (e.g. mid view-transition) and scroll to the wrong element.
  // Timing: the target is often NOT in its final position on the first frame —
  // a day-change jump plays through SlideView, and a completed/cancelled target
  // has to wait for the finished fold's ~300ms Reveal to expand (verified live:
  // a single rAF scroll lands the card on screen but off-centre, and a mount
  // that gets cancelled mid-animation can miss entirely). So re-scroll on a
  // short schedule that outlasts both animations; each repeat just re-targets
  // the same card, and the last one wins.
  useEffect(function () {
    if (!focusReq || !selectedId) return;
    const behavior = document.documentElement.dataset.motion === "reduce" ? "auto" : "smooth";
    // /code-review: ONE lookup, used by both the scroll and the focus below.
    // The `data-flip-id` selector was written out twice in this effect, so the
    // contract "a card is identified by its flip id" was asserted in two places
    // and a change to it could move the scroll and the focus to different
    // elements. (`data-bk`'s note in TimelineView is the precedent for that
    // identity changing.)
    function findCard() {
      const root = rootRef.current;
      return root ? root.querySelector('[data-flip-id="' + selectedId + '"]') : null;
    }
    function go() {
      const el = findCard();
      if (el) el.scrollIntoView({ block: "center", behavior: behavior });
    }
    // v17.12.0: the selection also takes REAL DOM focus, once, on the first
    // pass. Before this, ↑/↓ moved a clearly-drawn 3px ring while
    // `document.activeElement` stayed on BODY — so a sighted keyboard user was
    // well served and a screen-reader user was told nothing at all: no focus
    // moved, nothing was announced. Moving actual focus is what makes the card
    // speak, and it needs no ARIA at all beyond the card being focusable.
    //
    // ONCE, not on the repeat schedule: those repeats exist to re-target a
    // SCROLL through two animations, and re-focusing four more times would
    // fight anything the user tabbed to in the meantime. Hence the flag.
    //
    // `preventScroll` because `go()` owns the scrolling — a browser's own
    // focus scroll lands the card at the edge of the viewport, and `go()` wants
    // it centred.
    //
    // NOT scheduled through the rAF below, and that is the point rather than a
    // detail: rAF does not fire at all while the tab is hidden or occluded
    // (CLAUDE.md's own gotcha, earned in the Preview pane), so hanging focus
    // off it makes it silently conditional on the tab being visible. Caught
    // exactly that way here — the scroll fired on its timers and the focus
    // never did. The element exists by the time an effect runs, so the first
    // attempt is synchronous; the 120ms retry covers a card that is still
    // mounting behind a SlideView day-change.
    let focused = false;
    function focusOnce() {
      if (focused) return;
      const el = findCard();
      if (!el || !el.focus) return;
      el.focus({ preventScroll: true });
      // /code-review: latch on SUCCESS, not on the attempt. `focused = true`
      // used to be set BEFORE the call, which disabled the 120ms retry in
      // exactly the case the retry is for — a focus that does not take. The
      // `!el` path already got this right by returning above the assignment;
      // this is the same rule one line further down. A card inside an `inert`
      // subtree is the concrete case: `focus()` is a silent no-op there, and
      // the old form turned that into a permanent one.
      if (document.activeElement === el) focused = true;
    }
    focusOnce();
    const focusRetry = setTimeout(focusOnce, 120);
    const raf = requestAnimationFrame(go);
    const timers = [120, 300, 550, 850].map(function (ms) { return setTimeout(go, ms); });
    return function () { cancelAnimationFrame(raf); clearTimeout(focusRetry); timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq]);

  // v17.8.0's empty-day prompt, moved to EmptyDay.jsx in v17.11.0 so Timeline
  // and Plan share it. A list of nothing has nothing else to draw, so here it is
  // still the whole body; the other two render it above a canvas that is worth
  // keeping. `dayClosed`: this used to offer "New booking" and "Walk-in" on a
  // closed day, both of which the app refuses.
  //
  // v17.14.0 (/code-review follow-up): the CONDITION comes from App now. This
  // used to be `!day.length`, and `day` here includes cancelled bookings while
  // Timeline's and Plan's exclude them — so on a day whose bookings were all
  // cancelled those two showed the prompt and List rendered its card list,
  // which with the finished fold closed is a nearly blank screen with no prompt
  // and no New-booking button: exactly the defect EmptyDay was written to fix.
  // A cancelled booking is not a booked table, so `isEmpty` takes the other two
  // views' reading.
  //
  // It used to return EARLY when there was genuinely nothing to draw, so that a
  // truly empty day rendered the prompt AS the whole body. v17.15.0 removed that
  // branch, because it made the prompt impossible to animate OUT: the branch is
  // taken only while the day IS empty, so the moment a booking lands the whole
  // subtree is replaced in one frame and there is nothing left to collapse. The
  // normal return already produces the identical screen — `active` is empty, the
  // list ROLE is conditional so it announces nothing, and the finished fold is
  // gated on `finished.length` — so the one mount below covers both cases and
  // can ease in and out. It also keeps `flipRef`'s container mounted on an empty
  // day, which the note beside it says is required and the early return broke.

  // v17.12.0: exactly ONE card is in the tab order at a time (the roving
  // tab-stop pattern), because 10 bookings x ~6 controls each would otherwise
  // put ~70 stops between the top of the list and anything after it. The
  // selected card holds it; with nothing selected the first card does, so the
  // list is always enterable from the keyboard.
  //
  // /code-review: resolved against the cards that are actually RENDERED, not
  // against `day`. `Reveal` unmounts the "Completed & cancelled" fold once
  // shut, so a finished booking is a real element only while `showFinished` is
  // on — and naming an unmounted card leaves EVERY rendered card at -1, i.e.
  // the list stops being reachable by keyboard at all. That is the exact
  // opposite of what this line exists to guarantee, and it was two keystrokes
  // away: select a card, press C to complete it, and the selection follows it
  // into the closed fold. A day whose bookings are all completed or cancelled
  // (ROADMAP already records that day as reachable) did it with no keystrokes.
  //
  // `reachable` can be empty two ways: every booking finished with the fold
  // shut, and — since v17.15.0 removed the early return that used to guarantee
  // otherwise — a genuinely empty day, which now renders through here. Both
  // land on `rovingId === null`, which is correct: there is no card to give the
  // tab stop to (/code-review, on a comment that outlived its guarantee).
  const reachable = showFinished ? day : active;
  const rovingId = (selectedId && reachable.some(function (x) { return x.id === selectedId; }))
    ? selectedId
    : (reachable[0] ? reachable[0].id : null);

  function renderCard(b) {
        // v14 p1 (Issue 2 fix): end-time label is pinned to the scheduled plan
        // (time + duration) while the guest is within plan; once they overstay,
        // syncLiveDurations bumps b.duration to elapsed and the label starts
        // tracking live time from that moment on.
        // v14 p1 follow-up: the duration TAG is separate from end-time — it
        // shows actual minutes since seating (live, min 15) so staff can see
        // how long the party has been at the table regardless of the planned end.
        // v17.16.2 (CT-2B-02): this was `nowMins - toMins(b.time)`, mixing an
        // axis measured from TODAY's midnight with one measured from the
        // BOOKING's — so a party an hour in read "15 min" on any past date.
        // For a seated booking that expression IS liveBarDur's seated branch,
        // byte for byte, so this reuses it rather than becoming a fourth copy
        // of the same arithmetic (and inherits its past-close bound for free).
        // The file header's note about `liveDur` differing still holds — that
        // is the END-TIME pinning on the next line, not this.
        const elapsedMin = b.status === "seated" ? Math.max(15, liveBarDur(b, nowMins, today)) : 0;
        const liveDur = b.status === "seated" ? Math.max(elapsedMin, b.duration || 90) : b.duration;
        const end = toTime(toMins(b.time) + liveDur);
        const warn = warnings[b.id];
        // v16.1.0: running-late state ("warn"/"noshow") from App's lateMap —
        // amber border + "N min late" tag; at "noshow" a one-tap No show button.
        // Seated-overstay warnings keep precedence over the late highlight.
        const lateSt = late[b.id] || null;
        // v17.15.5: a double-booking, from App's clashMap.
        const clash = clashes[b.id] || null;
        const sc = STATUS_COLORS[b.status];
        const useStatusColor = b.status === "seated" || b.status === "completed" || b.status === "cancelled";
        // v17.0.0: a pending card keeps the strong (upcoming) background but
        // carries the yellow status border — the spec's List marker for pending.
        const isPending = b.status === "pending";
        const cardBg = useStatusColor ? "var(--bg-card-dim)" : "var(--bg-card-strong)";
        // v17.15.5: a CLASH outranks everything below it, mirroring the block's
        // own precedence (TimelineView's `border`, v17.11.0). The overstay
        // warning and the late timer are PREDICTIONS; a double-booking is the
        // schedule already being wrong, and one of the two parties is going to
        // be turned away. It reuses the overdue red rather than adding a fifth
        // card border colour — the two are told apart by the ClashIcon on the
        // flag row, because making the BORDER the distinguishing signal is the
        // colour-only-status mistake v17.11.0 exists to have fixed.
        const cardBrd = clash
          ? "var(--card-overdue-border)"
          : warn
            ? (warn.overdue ? "var(--card-overdue-border)" : "var(--card-warn-border)")
            : lateSt
              ? "var(--card-late-border)"   // v17.0.0 round 10: yellow, not the amber due-soon edge
              : b._conflict
                ? "var(--card-conflict-border)"
                : (useStatusColor || isPending) ? sc.border : "var(--border-card-plain)";
        const cardBrdW = (clash || warn || lateSt) ? "3px" : (useStatusColor || isPending) ? "3px" : "1px";

        // v17.6.0: the same "how long were they here" number survives the visit.
        // Seated shows the LIVE elapsed minutes (green, still running); completed
        // shows the settled stay from stayedMins() in a muted slate, so the two
        // read as different states at a glance rather than one number that stops
        // moving. stayedMins returns null when the stay isn't knowable (a direct
        // confirmed→completed keeps its scheduled duration) — then no tag at all,
        // which is the point: never assert a stay that didn't happen.
        const stayed = b.status === "completed" ? stayedMins(b) : null;
        // v17.15.5: the live counter keeps its success ink — it is the one
        // number here that is still MOVING, and that was what the green fill
        // said. The settled stay goes neutral, as its muted slate did.
        const durationTag = b.status === "seated" ? (
          <TextFlag ink={FLAG_SUCCESS}>{elapsedMin + " min"}</TextFlag>
        ) : stayed != null ? (
          <TextFlag ink={FLAG_NEUTRAL}>{"stayed " + stayed + " min"}</TextFlag>
        ) : null;

        // v17.15.2 (follow-up): the eleventh and twelfth banned triples. Both
        // are one-line notices inside the card, which is InlineAlert's shape.
        //
        // The mark also does real work here. This row says the same thing the
        // strip's Overlap section says — a seated party predicted to run into
        // the next booking — so it takes OverlapIcon; the row below says the
        // booking has NO table, so it takes AssignIcon, the mark on the control
        // that fixes it. Two different faults that were both a red pill before.
        // The overdue/soon distinction stays a colour because it is a matter of
        // DEGREE within one fault, which is what a tone is for.
        const warnEl = warn ? (
          <InlineAlert
            tone={warn.overdue ? ALERT_TONES.danger.tone : ALERT_TONES.warn.tone}
            tint={warn.overdue ? ALERT_TONES.danger.tint : ALERT_TONES.warn.tint}
            icon={OverlapIcon}
            style={{ marginBottom: 8, padding: "6px 10px" }}>
            {warn.overdue
              ? "Overdue — next booking (" + warn.next + ") at " + warn.nextTime + " is waiting"
              : "Next booking (" + warn.next + ") at " + warn.nextTime + " in " + warn.gap + " min"}
          </InlineAlert>
        ) : null;

        const conflictEl = (b._conflict && b.status !== "completed") ? (
          <InlineAlert icon={AssignIcon} style={{ marginBottom: 8, padding: "6px 10px" }}>
            No table assigned — use manual assignment.
          </InlineAlert>
        ) : null;

        // v17.15.5: `manual` keeps its word and gains no mark — see TextFlag.
        // It renders only when `_manual && !_locked`, which walk-ins and
        // drag-drops never hit (both set `_locked`), so it is a narrow case and
        // a glyph for it would be a glyph nobody learns.
        const manualTag = (b._manual && !isLocked(b)) ? (
          <TextFlag ink={FLAG_NEUTRAL}>manual</TextFlag>
        ) : null;
        const lockedTag = b._locked ? (
          <CardFlag ink={FLAG_NEUTRAL} title="Locked to these tables — the optimiser will not move it">
            <LockIcon size={IC.control} />
          </CardFlag>
        ) : null;
        const prefTag = (b.preferredTables && b.preferredTables.length > 0) ? (
          <CardFlag ink={FLAG_NEUTRAL} title={"Preferred tables: " + b.preferredTables.join(", ")}>
            <StarIcon size={IC.control} />{b.preferredTables.join("+")}
          </CardFlag>
        ) : null;
        // v16.0.0: repeat no-show offender flag (same threshold as the block's).
        const noShowCt = nsMap[identityKey(b)] || 0;
        const noShowTag = noShowCt >= 2 ? (
          <CardFlag ink={FLAG_WARN} title={noShowCt + " past no-shows on this number"}>
            <NoShowIcon size={IC.control} />{"×" + noShowCt}
          </CardFlag>
        ) : null;
        // v16.1.0: running-late flag (minutes past the booked time).
        const lateTag = lateSt ? (
          <TextFlag ink={FLAG_WARN}>{lateMins(b, nowMins, today) + " min late"}</TextFlag>
        ) : null;
        // v16.3.0: deposit — a prepaid booking. The AMOUNT stays visible here;
        // on the block it fits only in the title. v17.9.0's lesson holds: the
        // mark must never be the currency SYMBOL from settings/general, or
        // "money has been taken" is a different shape per restaurant setting.
        const depositTag = (Number(b.deposit) || 0) > 0 ? (
          <CardFlag ink={FLAG_SUCCESS} title={"Deposit " + (currency || "€") + b.deposit}>
            <DepositIcon size={IC.control} />{(currency || "€") + b.deposit}
          </CardFlag>
        ) : null;
        // v17.15.5: the double-booked marker. `findClashes` can return a pair
        // whose `tables` is EMPTY — `canAssign` also rejects a pair when each
        // booking takes two or more tables from one join cluster, and those
        // sets need not intersect — so the table clause is conditional, exactly
        // as TimelineBlock's is. Unreachable in the default layout by
        // pigeonhole, reachable with a join group of four, which is an ordinary
        // Settings → Layout edit.
        const clashTag = clash ? (
          <CardFlag ink={FLAG_DANGER} title={"Double-booked with " + clash.names.join(", ")
            + (clash.tables.length ? " on " + (clash.tables.length === 1 ? "table " : "tables ") + clash.tables.join(", ") : "")}>
            <ClashIcon size={IC.control} />double-booked
          </CardFlag>
        ) : null;

        const notesEl = b.notes ? (
          <div style={{
            fontSize: T.body, color: S.text,
            borderTop: "0.5px solid " + S.border,
            paddingTop: 8, marginTop: 8
          }}>
            {b.notes}
          </div>
        ) : null;

        const phonEl = b.phone ? (
          <span style={{ fontSize: T.body, color: S.text, marginLeft: 4 }}>{b.phone}</span>
        ) : null;

        // v14.4.0: Cancel + Delete are pulled into a right-aligned group (Cancel
        // then Delete); the remaining status changers stay in the left group.
        // v17.0.0: a pending card's only forward status is Confirmed (the
        // right-group Cancel button stays — the decline flow).
        // v17.10.0: each status carries its OWN mark (STATUS_ICON, Icons.jsx)
        // instead of all of them sharing a ChevronRightIcon — which said "there
        // is more this way", not what the button does. IC.control, not
        // IC.inline: these are marks ON a control, and the Assign button beside
        // them in this same row has always been IC.control.
        // v17.16.12: `seated` is dropped once that day's close has passed — the
        // close-time auto-complete would flip it back within one tick, so the
        // button could only ever look broken. See seatingClosed.
        const statusBtns = (b.status === "pending" ? ["confirmed"] : ["confirmed", "seated", "completed"])
          .filter((s) => s !== "seated" || !seatingClosed(b.date, today, nowMins))
          .filter((s) => s !== b.status)
          .map((s) => (
            <button
              key={s}
              className="mgt-hover-scale"
              style={mkBtn({ background: BLOCK_BG[s], color: BLOCK_INK[s] || "var(--text-on-accent)", textTransform: "capitalize", display: "inline-flex", alignItems: "center", gap: 6 })}
              onClick={stopped(() => onStatus(b.id, s))}
            >
              <StatusIcon status={s} size={IC.control} />{s}
            </button>
          ));
        const cancelBtn = b.status !== "cancelled" ? (
          <button
            key="cancelled"
            className="mgt-hover-scale"
            style={mkBtn({ background: BLOCK_BG.cancelled, textTransform: "capitalize", display: "inline-flex", alignItems: "center", gap: 6 })}
            onClick={stopped(() => onStatus(b.id, "cancelled"))}
          >
            <CloseIcon size={IC.control} />cancelled
          </button>
        ) : null;

        const animFrom = listAnimFrom(b.id);
        return (
          <div
            key={b.id}
            data-flip-id={b.id}
            /* v17.9.1: `.mgt-hover-scale` is GONE from the card, and this is a
               CLICK bug, not a taste change. The lift is `scale(1.08)`, which is
               a PROPORTION — on a 40px button it moves things 3px, but this card
               is ~820px wide, so hovering it slid its own buttons sideways by a
               measured 24–31px (Edit left, Delete right), i.e. roughly half a
               button. You aim at Edit, the card lifts as the cursor crosses it,
               Edit moves out from under you, and the click lands on the card.
               Moving the pointer out and back in "fixes" it only because the
               second time the card is already lifted, so what you see is where
               it is.

               Rule this establishes: THE HOVER LIFT IS FOR CONTROLS, NOT FOR
               CONTAINERS OF CONTROLS. A scaling parent moves every target inside
               it, and the bigger the parent the further they move.

               `.mgt-ac-row` already had the answer for a row-shaped surface —
               background swap, no transform — so the card takes that treatment
               (a `--bg-hover-card` tint via the class below) and the BUTTONS
               keep their own 1.08, which is what the effect was designed for. */
            className="mgt-ac-row"
            /* v17.10.0: the card OPENS THE EDIT FORM. It had a pointer cursor and
               (since v17.9.1) a hover tint, both of which promise a click does
               something, and what it did was set an invisible keyboard selection
               — while a button labelled Edit sat inside it repeating what the
               card already looked like it would do. That button is gone.
               It still selects, and the order matters: selecting first means the
               keyboard model (↑/↓, the per-card shortcuts) resumes from the card
               you just opened, so closing the form leaves you where you were.
               `listFocusReq` is deliberately NOT bumped — that counter is for
               PROGRAMMATIC selection (search-jump, arrow nav) and scrolling the
               page under a finger that just tapped is the bug it was added to
               avoid. */
            onClick={(e) => { if (endsASelection(e.currentTarget)) return; onSelect(b.id); onEdit(b); }}
            /* /code-review (v17.12.0): the card is focusable now, and the
               browser focuses on mousedown — which SCROLLS the card into view,
               measured at up to 297px. Timeline and Plan answer that with
               `preventDefault`, and this card deliberately cannot: that also
               kills text selection, and staff select the phone number off this
               card to ring a party (the behaviour `endsASelection` exists to
               protect). Which left the exemption trading one broken interaction
               for another — press on the number to start a drag and the text
               travels 297px out from under the pointer before the selection has
               begun.
               Focusing it OURSELVES with `preventScroll` is the way to have
               both: the browser's focusing steps are a no-op on an element that
               is already focused, so there is nothing left to scroll, and
               mousedown's default action is untouched so the selection drag
               proceeds normally.
               Skipped when the press is on a nested control — those take their
               own focus, and stealing it here would break the button. */
            onMouseDown={(e) => {
              if (e.target.closest("button")) return;
              e.currentTarget.focus({ preventScroll: true });
            }}
            /* v17.12.0 — reachable and announced.

               `role="listitem"`, NOT `role="button"`, and that is the whole
               design decision. A button's children are PRESENTATIONAL in ARIA,
               so labelling this card a button would hide Assign, the status
               changers and Delete from assistive technology — trading an
               unreachable card for six unreachable controls, which is strictly
               worse than what it replaces. `role="grid"`/`row` is the pattern
               built for rows-containing-controls, but a grid's children must be
               rows, and the "Completed & cancelled" Collapsible sits between
               these cards and breaks that structure. So the card stays a list
               item that happens to be focusable and operable.

               The accessible name is composed rather than left to the DOM: read
               as raw text this card is a run of times, tags and button labels,
               and "Marco Silva, 20:00, 4 guests, table 5A, seated" is what a
               host actually needs to hear before deciding whether to act on it.
               The status word is `b.status` itself — the same word SBadge
               prints two lines below — so the spoken and printed vocabulary
               cannot drift.

               Enter and Space match the card's own click, and mirror the `E`
               shortcut that has opened the edit form since v14.4.0. The
               `target === currentTarget` guard is what keeps Enter on a nested
               button (Assign, Delete) from ALSO opening the form — the keyboard
               equivalent of the `stopped()` wrapper every control in here
               already goes through. */
            role="listitem"
            tabIndex={rovingId === b.id ? 0 : -1}
            aria-label={describeBooking(b)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onSelect(b.id);
              onEdit(b);
            }}
            style={{
              /* The resting fill goes through a CUSTOM PROPERTY rather than
                 `background`, because an inline `background` beats a stylesheet
                 `background-color` (the same Fix-2 specificity rule that makes
                 mkBtn's inline shadow un-overridable). Declared inline, consumed
                 by `.mgt-ac-row` in index.html, so the hover tint is a plain CSS
                 state change with nothing to fight — and no React hover state
                 re-rendering a memoized list on every pointer move.
                 `--bg-hover-card` rather than the class's default `--bg-ac-hover`:
                 a card is a surface, so it lifts to the opaque card tint the
                 hover-scale rule uses, not the accent wash a dropdown row takes. */
              "--row-bg": cardBg,
              "--row-bg-hover": "var(--bg-hover-card)",
              border: cardBrdW + " solid " + cardBrd,
              borderRadius: R.card, padding: "14px 16px",
              position: "relative",
              opacity: (b.status === "completed" || b.status === "cancelled") ? 0.75 : 1,
              // v14.4.0: accent ring marks the keyboard-focused card (List shortcuts).
              boxShadow: b.id === selectedId
                ? "0 0 0 3px var(--accent), var(--shadow-card)"
                : "var(--shadow-card)",
              cursor: "pointer"
            }}
          >
            {/* v15.8.0 cont.4: status-change colour wipe — fills the NEW (clicked)
                status colour (green Seated, red Cancelled, …) sweeping left→right
                (direction flipped rtl→ltr in v15.9.0 on request).
                `animFrom` is only the trigger flag; the colour is the new status. */}
            {animFrom ? (
              <div className="mgt-wipe-ltr" style={{
                position: "absolute", inset: 0, borderRadius: R.card, pointerEvents: "none", zIndex: 0,
                background: BLOCK_BG[b.status] || "transparent", opacity: 0.5
              }} />
            ) : null}
            <div style={{ position: "relative", zIndex: 1 }}>
            {conflictEl}
            {warnEl}
            <div style={{
              display: "flex", alignItems: "flex-start", justifyContent: "space-between",
              flexWrap: "wrap", gap: 8
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: FW.bold, fontSize: T.title, color: S.text }}>{b.name}</span>
                <SBadge status={b.status} />
                {/* v17.15.5: the party size as the block's own ring, not
                    "4 pax". The `rim` is the card's, not the block's — see
                    SizeRing: 0.55 white is a measurement taken against a
                    SATURATED fill and is close to invisible on a card. Nothing
                    is lost to a screen reader, because the card's own
                    aria-label comes from `describeBooking`, which says
                    "4 guests" and always has. */}
                <SizeRing n={b.size} rim="var(--chip-neutral-border)" />
                {/* v17.15.5: TimelineBlock's rail order — deposit, preferred,
                    then the exception flags (locked / repeat-no-show), so the
                    two views read the same left-to-right. `manual` sits with
                    `locked` because it is the same fact one notch weaker, and
                    the two counters that have no block counterpart come last. */}
                {depositTag}
                {prefTag}
                {lockedTag}
                {manualTag}
                {noShowTag}
                {clashTag}
                {lateTag}
                {durationTag}
              </div>
              <span style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text }}>{b.time + "–" + end}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              {(b.tables || []).map((t) => <TBadge key={t} id={t} />)}
              {phonEl}
            </div>
            {notesEl}
            {/* v17.10.0: THREE groups. Assign stays left; the status changers are
                pushed right by `marginLeft:auto`; the ways a booking ENDS sit
                hard right after a wider gap. The Edit button is gone — the card
                itself opens the form now (see the card's onClick above), which is
                what the pointer cursor and the hover tint have implied since
                v17.9.1. Every control in here stops propagation, or it would open
                the edit form on its way to doing its own job. */}
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button className="mgt-hover-scale" style={mkBtn({ background: BTN.tables, display: "inline-flex", alignItems: "center", gap: 6 })} onClick={stopped(() => onManual(b.id))}><AssignIcon size={IC.control} />Assign</button>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
                {statusBtns}
              </div>
              <div style={{ display: "flex", gap: 6, marginLeft: 18, flexWrap: "wrap", alignItems: "center" }}>
                {/* v16.1.0: one-tap No show once past the no-show threshold. */}
                {lateSt === "noshow" ? (
                  <button className="mgt-hover-scale" style={mkBtn({ background: BTN.orange, display: "inline-flex", alignItems: "center", gap: 6 })} onClick={stopped(() => onNoShow(b.id))}><NoShowIcon size={IC.control} />No show</button>
                ) : null}
                {cancelBtn}
                <button className="mgt-hover-scale" style={mkBtn({ background: BTN.del })} onClick={stopped(() => onDelete(b.id))}>Delete</button>
              </div>
            </div>
            </div>
          </div>
        );
  }

  return (
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* v17.14.0: a cancelled-only day — empty by the shared reading, but the
          cards below are still worth reaching. See the note at the early
          return above. */}
      {/* v17.15.0: the prompt eases in and out instead of snapping, on the same
          `Reveal` the notification strip uses. The `null` on the false branch is
          load-bearing — `Reveal` caches only TRUTHY children, and that cache is
          what it collapses on the way out. */}
      <Reveal show={isEmpty}>{isEmpty ? <EmptyDay closed={dayClosed} onNew={onNew} onWalkin={emptyWalkin} /> : null}</Reveal>
      {/* v17.12.0: a real list, so the cards are list items and the count is
          announced. Two lists rather than one, because the finished cards live
          inside the Collapsible and a `list` must contain its items directly.

          v17.14.0 (/code-review): the ROLE is conditional, the element is not.
          On a cancelled-only day `active` is empty and this rendered as an empty
          `role="list"` directly under the empty-day prompt, so a screen reader
          heard "Nothing booked for this day yet" and then "Bookings, list, 0
          items" — an announcement contradicting the one before it. Dropping the
          role leaves a plain div, which announces nothing. The element itself
          must stay mounted either way: it carries `flipRef`, and `useFlip`'s
          layout effect bails out entirely on a null container, so unmounting it
          would silently disable the list-reorder animation for the rest of the
          session. */}
      <div ref={flipRef} role={active.length ? "list" : undefined}
        aria-label={active.length ? "Bookings" : undefined}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {active.map(renderCard)}
      </div>
      {finished.length > 0 ? (
        <Collapsible
          title="Completed & cancelled"
          summary={finished.length + (finished.length === 1 ? " booking" : " bookings")}
          open={showFinished}
          onToggle={onToggleFinished}
          style={{ marginBottom: 0 }}
        >
          <div role="list" aria-label="Completed and cancelled bookings" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {finished.map(renderCard)}
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}
);
