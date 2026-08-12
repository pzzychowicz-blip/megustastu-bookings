// src/components/ListView.jsx
// List-view rendering of the day's bookings — sorted by status (seated first,
// then confirmed, completed, cancelled), then by time. Each booking renders
// as a card with name, status badge, party size, time range, table chips,
// optional notes, and action buttons (Assign / Edit / Delete + status changers).
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
import { S, BLOCK_BG, BLOCK_INK, STATUS_COLORS, BTN, R, T, FW } from "../lib/constants";
import { toMins, toTime, isLocked, statusOrder, lateMins, stayedMins } from "../lib/booking-logic";
import { noShowMap, normalizePhone } from "../lib/customers";
import { SmallTag, SBadge, TBadge, mkBtn, Collapsible, useFlip } from "./atoms";
import { AssignIcon, ChevronRightIcon, StarIcon } from "./Icons";

// v15.8.0: module-level status-change detection (mirrors TimelineView) so a card
// that changes status plays a colour wipe of its OLD status colour. Keyed by id,
// expires by timestamp; single list on screen so module scope is safe.
let __listPrev = null;
const __listAnims = {};

// v17.1.0 perf: React.memo — all function props are App's stable VA wrappers,
// data props change identity only on real change (memoized in BookingApp).
export const ListView = memo(function ListView({
  bookings, date, onEdit, onStatus, onDelete, onManual,
  nowMins = 0, warnings = {},
  late = {}, onNoShow = () => {},
  selectedId = null, onSelect = () => {}, focusReq = 0,
  showFinished = false, onToggleFinished = () => {},
  onNew = null, onWalkin = null,
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
    function go() {
      const root = rootRef.current;
      const el = root ? root.querySelector('[data-flip-id="' + selectedId + '"]') : null;
      if (el) el.scrollIntoView({ block: "center", behavior: behavior });
    }
    const raf = requestAnimationFrame(go);
    const timers = [120, 300, 550, 850].map(function (ms) { return setTimeout(go, ms); });
    return function () { cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq]);

  // v17.8.0: an empty day used to be one grey sentence centred in ~500px of
  // nothing, with the only useful action (+ New) at the far top of the screen.
  // A first-shift host learned nothing from it. It now says what the day is and
  // offers the two things you can actually do with an empty one — the same two
  // actions the header carries, put where the user is already looking.
  if (!day.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "32px 16px" }}>
        <div style={{ fontSize: T.lead, fontWeight: FW.semi, color: S.text }}>Nothing booked for this day yet.</div>
        <div style={{ fontSize: T.body, color: S.muted, textAlign: "center", maxWidth: 340 }}>
          Take a reservation, or seat someone who has just walked in.
        </div>
        {onNew || onWalkin ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 2 }}>
            {onNew ? (
              <button className="mgt-hover-scale" onClick={onNew}
                style={mkBtn({ background: "var(--accent)", padding: "8px 18px" })}>New booking</button>
            ) : null}
            {onWalkin ? (
              <button className="mgt-hover-scale" onClick={function () { onWalkin(null); }}
                style={mkBtn({ background: "var(--app-walkin)", padding: "8px 18px" })}>Walk-in</button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderCard(b) {
        // v14 p1 (Issue 2 fix): end-time label is pinned to the scheduled plan
        // (time + duration) while the guest is within plan; once they overstay,
        // syncLiveDurations bumps b.duration to elapsed and the label starts
        // tracking live time from that moment on.
        // v14 p1 follow-up: the duration TAG is separate from end-time — it
        // shows actual minutes since seating (live, min 15) so staff can see
        // how long the party has been at the table regardless of the planned end.
        const elapsedMin = b.status === "seated" ? Math.max(15, nowMins - toMins(b.time)) : 0;
        const liveDur = b.status === "seated" ? Math.max(elapsedMin, b.duration || 90) : b.duration;
        const end = toTime(toMins(b.time) + liveDur);
        const warn = warnings[b.id];
        // v16.1.0: running-late state ("warn"/"noshow") from App's lateMap —
        // amber border + "N min late" tag; at "noshow" a one-tap No show button.
        // Seated-overstay warnings keep precedence over the late highlight.
        const lateSt = late[b.id] || null;
        const sc = STATUS_COLORS[b.status];
        const useStatusColor = b.status === "seated" || b.status === "completed" || b.status === "cancelled";
        // v17.0.0: a pending card keeps the strong (upcoming) background but
        // carries the yellow status border — the spec's List marker for pending.
        const isPending = b.status === "pending";
        const cardBg = useStatusColor ? "var(--bg-card-dim)" : "var(--bg-card-strong)";
        const cardBrd = warn
          ? (warn.overdue ? "var(--card-overdue-border)" : "var(--card-warn-border)")
          : lateSt
            ? "var(--card-late-border)"   // v17.0.0 round 10: yellow, not the amber due-soon edge
            : b._conflict
              ? "var(--card-conflict-border)"
              : (useStatusColor || isPending) ? sc.border : "var(--border-card-plain)";
        const cardBrdW = (warn || lateSt) ? "3px" : (useStatusColor || isPending) ? "3px" : "1px";

        // v17.6.0: the same "how long were they here" number survives the visit.
        // Seated shows the LIVE elapsed minutes (green, still running); completed
        // shows the settled stay from stayedMins() in a muted slate, so the two
        // read as different states at a glance rather than one number that stops
        // moving. stayedMins returns null when the stay isn't knowable (a direct
        // confirmed→completed keeps its scheduled duration) — then no tag at all,
        // which is the point: never assert a stay that didn't happen.
        const stayed = b.status === "completed" ? stayedMins(b) : null;
        const durationTag = b.status === "seated" ? (
          <SmallTag label={elapsedMin + " min"} style={{ background: "var(--app-success-solid)", color: "var(--text-on-accent)", border: "none" }} />
        ) : stayed != null ? (
          <SmallTag label={"stayed " + stayed + " min"} style={{ background: "var(--bg-soft)", color: "var(--text-secondary)", border: "1px solid var(--border-soft)" }} />
        ) : null;

        const warnEl = warn ? (
          <div style={{
            fontSize: T.body, fontWeight: FW.bold, marginBottom: 8,
            padding: "6px 10px", borderRadius: R.pill,
            background: warn.overdue ? "var(--danger-bg)" : "var(--warn-bg)",
            color: warn.overdue ? "var(--danger-text)" : "var(--warn-text)",
            border: "1px solid " + (warn.overdue ? "var(--danger-border)" : "var(--warn-border)")
          }}>
            {warn.overdue
              ? "Overdue — next booking (" + warn.next + ") at " + warn.nextTime + " is waiting"
              : "Next booking (" + warn.next + ") at " + warn.nextTime + " in " + warn.gap + " min"}
          </div>
        ) : null;

        const conflictEl = (b._conflict && b.status !== "completed") ? (
          <div style={{
            fontSize: T.body, color: "var(--danger-text)", fontWeight: FW.bold, marginBottom: 8,
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            borderRadius: R.pill, padding: "6px 10px"
          }}>
            No table assigned — use manual assignment.
          </div>
        ) : null;

        const manualTag = (b._manual && !isLocked(b)) ? (
          <SmallTag label="manual" style={{ background: "var(--tag-flag)", color: "var(--text-on-accent)", border: "1px solid var(--border-glass)" }} />
        ) : null;
        const lockedTag = b._locked ? (
          <SmallTag label="locked" style={{ background: "var(--tag-flag)", color: "var(--text-on-accent)", border: "1px solid var(--border-glass)" }} />
        ) : null;
        const prefTag = (b.preferredTables && b.preferredTables.length > 0) ? (
          <SmallTag label={<><StarIcon size={10} />{b.preferredTables.join("+")}</>} style={{ background: "var(--tag-flag)", color: "var(--text-on-accent)", border: "1px solid var(--border-glass)" }} />
        ) : null;
        // v16.0.0: repeat no-show offender chip (same threshold as the timeline ⚠).
        const noShowCt = nsMap[normalizePhone(b.phone)] || 0;
        // v17.8.0: solid, like every other tag in this row. The pale-fill +
        // colour-matched-border + bold-coloured-text combination these three
        // carried is the generic badge shape, and it sat inches from `manual`
        // / `locked` / `★` / the seated `N min`, which are all solid-with-white.
        // One row, two label systems. Solid wins because it is the app's own
        // v17.7.0 status-label decision, already applied everywhere else.
        // The ⚠ goes with it: an amber fill plus an amber warning glyph is the
        // same signal twice (the banner restyle dropped its glyphs for this).
        const noShowTag = noShowCt >= 2 ? (
          <SmallTag label={"no-show ×" + noShowCt} style={{ background: "var(--app-warn-solid)", color: "var(--text-on-accent)", border: "1px solid var(--border-glass)" }} />
        ) : null;
        // v16.1.0: running-late tag (minutes past the booked time).
        const lateTag = lateSt ? (
          <SmallTag label={lateMins(b, nowMins) + " min late"} style={{ background: "var(--app-warn-solid)", color: "var(--text-on-accent)", border: "1px solid var(--border-glass)" }} />
        ) : null;
        // v16.3.0: deposit chip (suggest/green tokens — a prepaid booking).
        const depositTag = (Number(b.deposit) || 0) > 0 ? (
          <SmallTag label={(currency || "€") + b.deposit + " deposit"} style={{ background: "var(--app-success-solid)", color: "var(--text-on-accent)", border: "1px solid var(--border-glass)" }} />
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
        const statusBtns = (b.status === "pending" ? ["confirmed"] : ["confirmed", "seated", "completed"])
          .filter((s) => s !== b.status)
          .map((s) => (
            <button
              key={s}
              className="mgt-hover-scale"
              style={mkBtn({ background: BLOCK_BG[s], color: BLOCK_INK[s] || "var(--text-on-accent)", textTransform: "capitalize", display: "inline-flex", alignItems: "center", gap: 6 })}
              onClick={() => onStatus(b.id, s)}
            >
              <ChevronRightIcon size={12} />{s}
            </button>
          ));
        const cancelBtn = b.status !== "cancelled" ? (
          <button
            key="cancelled"
            className="mgt-hover-scale"
            style={mkBtn({ background: BLOCK_BG.cancelled, textTransform: "capitalize", display: "inline-flex", alignItems: "center", gap: 6 })}
            onClick={() => onStatus(b.id, "cancelled")}
          >
            <ChevronRightIcon size={12} />cancelled
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
            className="mgt-card-hover"
            onClick={() => onSelect(b.id)}
            style={{
              /* The resting fill goes through a CUSTOM PROPERTY rather than
                 `background`, because an inline `background` beats a stylesheet
                 `background-color` (the same Fix-2 specificity rule that makes
                 mkBtn's inline shadow un-overridable). Declared inline, consumed
                 by `.mgt-card-hover` in index.html, so the hover tint is a plain
                 CSS state change with nothing to fight — and no React hover state
                 re-rendering a memoized list on every pointer move. */
              "--card-bg": cardBg,
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
                <span style={{ fontSize: T.body, color: S.text, fontWeight: FW.bold }}>{b.size + " pax"}</span>
                {manualTag}
                {lockedTag}
                {prefTag}
                {noShowTag}
                {lateTag}
                {depositTag}
                {durationTag}
              </div>
              <span style={{ fontSize: T.lead, fontWeight: FW.bold, color: S.text }}>{b.time + "–" + end}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              {(b.tables || []).map((t) => <TBadge key={t} id={t} />)}
              {phonEl}
            </div>
            {notesEl}
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button className="mgt-hover-scale" style={mkBtn({ background: BTN.tables, display: "inline-flex", alignItems: "center", gap: 6 })} onClick={() => onManual(b.id)}><AssignIcon size={14} />Assign</button>
              <button className="mgt-hover-scale" style={mkBtn({ background: BTN.edit })} onClick={() => onEdit(b)}>Edit</button>
              {statusBtns}
              <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
                {/* v16.1.0: one-tap No show once past the no-show threshold. */}
                {lateSt === "noshow" ? (
                  <button className="mgt-hover-scale" style={mkBtn({ background: BTN.orange })} onClick={() => onNoShow(b.id)}>No show</button>
                ) : null}
                {cancelBtn}
                <button className="mgt-hover-scale" style={mkBtn({ background: BTN.del })} onClick={() => onDelete(b.id)}>Delete</button>
              </div>
            </div>
            </div>
          </div>
        );
  }

  return (
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div ref={flipRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {finished.map(renderCard)}
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}
);
