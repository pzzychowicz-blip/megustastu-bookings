// src/components/NotificationStrip.jsx
// v17.8.0 — ONE pane for every in-flow notification.
//
// ── The problem it solves ────────────────────────────────────────────────────
// Six independent banners could be live at once — offline, write-error,
// inefficiency, overlap warnings, running-late, waitlist-table-free, plus the
// reminder rows — each its own pane with its own margin, stacked. On a busy
// evening (which is exactly when several of them fire together) they pushed the
// timeline off the bottom of the tablet: the alerts displaced the thing the
// alerts are about. Each one was dismissible, but dismissing costs the taps a
// host does not have between parties.
//
// v17.8.0's earlier pass made them all LOOK like one system. This makes them
// BE one: a single pane whose collapsed height is one row, no matter how many
// notifications are live. That is the property that matters — the cost of a bad
// evening stops scaling with how bad it is.
//
// ── Contract ─────────────────────────────────────────────────────────────────
// App builds `sections`, ordered by severity (see ORDER at the call site):
//   { id, tone, title, count, node }
// `node` is the section's already-rendered body — the banner components still
// own their own rows, actions and per-row Reveal lifecycle, unchanged. This
// component owns only the pane, the collapse, and the separators.
//
// Collapsed, it shows the FIRST section (highest severity) plus "+N more". The
// section list is pre-sorted by App rather than here so severity stays one
// decision in one place, next to the flags that produce it.
//
// `startOpen` comes from settings/general.lateCollapseMax, which used to mean
// "collapse a banner with more than N rows". It now means the same thing about
// the strip as a whole, so the setting keeps working and gains reach.

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Reveal } from "./atoms";
import { useRevealRows } from "../hooks/useRevealRows";
import { R, M, T, FW, IC } from "../lib/constants";
import { ChevronDownIcon } from "./Icons";

// ── The strip's own geometry, exported because three other files depend on it ─
// A section BODY (the banner rows, the reminder rows, AppBanners' one-liners)
// has to start its text on the same left edge as the section TITLE above it,
// which means every one of them needs this arithmetic: the pane's padding, plus
// the width of the mark, plus the gap after it.
//
// v17.8.0 fix: it was a literal `31` hard-coded in AppBanners, BannerRows and
// useReminders, each with its own comment deriving it as 14 + 8 + 9 — correct
// while the mark was an 8px dot, and silently wrong the moment the same release
// made it a 15px icon. Measured after that change: section titles at x=55, row
// text at x=48. Nobody would catch a 7px drift by reading, and no test could,
// because the number was three copies of a calculation rather than one export.
//
// So the numbers live here, next to the styles that actually use them, and the
// callers import the total. Change PAD_X / MARK / GAP and every body follows.
export const NOTIF_PAD_X = 14;   // the pane's horizontal padding
// v17.14.0 (/code-review follow-up): the lid's radius is the pane's MINUS the
// 1px border it sits inside. See the note at its use.
const LID_R = "calc(" + R.card + " - 1px)";
const NOTIF_MARK = 15;           // SectionMark's icon box
const NOTIF_GAP = 9;             // the flex gap between mark and title
export const NOTIF_GUTTER = NOTIF_PAD_X + NOTIF_MARK + NOTIF_GAP;

// One section's mark. `fallbackDot` keeps the old 8px dot for a section that
// has no icon yet, so adding a section without one degrades to the previous
// design instead of rendering a hole. The dot is deliberately NOT what
// NOTIF_GUTTER measures — a section without an icon is the exception, and the
// bodies must stay aligned with the majority that have one.
function SectionMark({ icon: Icon, tone, size, fallbackDot }) {
  if (!Icon) {
    if (!fallbackDot) return null;
    return <span aria-hidden="true" style={{
      width: 8, height: 8, borderRadius: "50%", backgroundColor: tone, flexShrink: 0,
      transition: "background-color " + M.move
    }} />;
  }
  return (
    <span aria-hidden="true" style={{
      display: "inline-flex", alignItems: "center", color: tone, flexShrink: 0,
      transition: "color " + M.move
    }}><Icon size={size} /></span>
  );
}

// ── The date swap (v17.15.0) ─────────────────────────────────────────────────
// One movement, on the view slide's own clock. `M.dur`/`M.easeOut` are the raw
// WAAPI pair (a var() in an `animate()` easing resolves to nothing and the
// animation silently runs linear), which is exactly the escape hatch they are
// documented for.
const SWAP = { duration: M.dur.move, easing: M.easeOut };  /* @motion */

export function NotificationStrip({ sections, collapseMax = 2, lidIcon = null, swapKey }) {
  const liveTotal = sections.reduce(function (n, s) { return n + (s.count || 1); }, 0);
  // Initial-only, like BannerRows' own collapse was: a strip the user opened
  // must not slam shut because a seventh late booking arrived.
  const [open, setOpen] = useState(function () { return liveTotal <= collapseMax; });

  // ── Sections ease in and out, on the same lifecycle their ROWS already use ──
  // Without this a resolved notification vanished mid-frame and everything below
  // it jumped up — which is worst in exactly the case the strip exists for, a
  // busy evening where sections come and go while someone is reading one.
  // useRevealRows is the hook LateBanner/Overlap/WaitAvail already share for
  // their rows; applying it one level up means the strip's own contents behave
  // like its contents' contents, and there is one implementation of the pattern.
  //
  // v17.15.0: `swapKey` (the viewed date) is what tells the lifecycle apart
  // from a replacement — see useRevealRows for the measurements. On a change of
  // it the sections do not ease in and out at all; the whole body is swapped in
  // one frame and the geometry is handled once, below.
  const ids = sections.map(function (s) { return s.id; });
  const sig = ids.join(",");
  const { renderIds, openIds } = useRevealRows(ids, swapKey);

  // ── The swap's single move ──────────────────────────────────────────────────
  // With the content replaced in one frame, the only thing left to animate is
  // the box: from the height the day you left needed, to the height this one
  // does. One WAAPI shot, on --t-move, so it starts and ends with the view's
  // 28px horizontal slide and the day changes as ONE movement. Measured before:
  // the pane wandered 70px of height across 1.15s under a 240ms slide, dragging
  // the whole timeline diagonally with it; with no strip on either date the
  // same switch is 28px sideways and zero vertical, which is what it should be.
  //
  // This CANNOT be `AutoHeight`, and the reason is worth keeping: that atom's
  // observer fires every frame while its content is itself animating and eases
  // the box to follow, clipping what overflows. That is right for a Settings
  // tab and wrong here, where the sections' own Reveals animate constantly by
  // design — every notification arriving in place would be clipped mid-reveal
  // by a box chasing it. A one-shot fires only on the swap and touches nothing
  // else.
  //
  // The fade is gated on the rendered TEXT actually differing. "Working
  // offline" is not about the day, and fading it because you pressed Next is
  // motion describing something that did not happen.
  const lidRef = useRef(null);
  const bodyRef = useRef(null);
  const lastH = useRef(0);
  const lastText = useRef("");
  const swapRef = useRef(swapKey);
  useLayoutEffect(function () {
    const body = bodyRef.current;
    // The body is unmounted while the strip is collapsed, and 0 then means
    // "nothing to measure", not "zero tall" — hence the `from > 0` guard, which
    // also covers the first render and the strip arriving from nothing (the
    // outer Reveal owns that one).
    const h = body ? body.offsetHeight : 0;
    const text = (lidRef.current ? lidRef.current.textContent : "") + (body ? body.textContent : "");
    if (swapRef.current !== swapKey) {
      swapRef.current = swapKey;
      const from = lastH.current;
      if (body && body.animate) {
        if (from > 0 && h > 0 && Math.abs(from - h) > 1) {
          body.animate([{ height: from + "px" }, { height: h + "px" }], SWAP);
        }
        if (text !== lastText.current) {
          // Opacity on the two CONTENT boxes, never on the pane: the pane owns
          // the severity tint and its border, and fading those from zero pops
          // the strip's whole surface against the page. The tint itself already
          // cross-fades on --t-move, so it is on this clock too.
          body.animate([{ opacity: 0 }, { opacity: 1 }], SWAP);
          if (lidRef.current && lidRef.current.animate) lidRef.current.animate([{ opacity: 0 }, { opacity: 1 }], SWAP);
        }
      }
    }
    lastH.current = h;
    lastText.current = text;
  });

  // A departed section is gone from `sections` but must keep rendering for the
  // ~350ms its Reveal takes to collapse. Its CONTENT needs no cache here — the
  // Reveal atom already holds its last truthy children for exactly this reason,
  // so passing `null` makes it fade out what it was showing. What Reveal cannot
  // know is WHERE the section belongs: renderIds is arrival-ordered (newcomers
  // are appended), and this list is severity-ordered, so a "Working offline"
  // that arrives while "Running late" is up would otherwise render below it —
  // the one thing about this component that is not allowed to drift.
  //
  // Hence a remembered rank, and nothing else. The effect is keyed on the id
  // SET, so it runs on a membership change and not on every App render, and it
  // lands AFTER the render in which a section departs — which is exactly right:
  // that render still sees the rank the section is fading out from.
  const [rank, setRank] = useState({});
  useEffect(function () {
    setRank(function (prev) {
      const next = Object.assign({}, prev);
      ids.forEach(function (id, i) { next[id] = i; });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id set, see above
  }, [sig]);

  const live = {};
  sections.forEach(function (s, i) { live[s.id] = i; });
  function rankOf(id) {
    if (live[id] !== undefined) return live[id];
    // A departing section holds its OLD index — but the sections below it have
    // already shifted up into it, so the raw index ties with whichever one took
    // its place, and a tie is broken by renderIds, which is arrival-ordered.
    // Measured live: "Running late" jumped from first to second and THEN
    // collapsed. Half a step earlier puts it immediately above its replacement,
    // which is where it visibly was, at every position in the list.
    return rank[id] !== undefined ? rank[id] - 0.5 : Number.MAX_SAFE_INTEGER;
  }
  const orderedIds = renderIds.slice().sort(function (a, b) { return rankOf(a) - rankOf(b); });
  const byId = {};
  sections.forEach(function (s) { byId[s.id] = s; });

  // `sections` is never empty here: the mount site in App passes null instead,
  // so the Reveal wrapping this component fades out its own cached copy rather
  // than collapsing an already-blanked box. Same mechanism, one owner.
  if (!sections.length) return null;
  const top = sections[0];
  const total = liveTotal;
  const multi = orderedIds.length > 1;
  // The live sections in render order — the collapsed tally reads this, so it
  // stays in the same severity order the body uses.
  const ordered = orderedIds.map(function (id) { return byId[id]; }).filter(Boolean);

  return (
    /* v17.12.0: a named region, so the strip is a landmark an assistive-tech
       user can jump straight to instead of arrowing into it from the header.
       It is deliberately NOT a live region: the strip is persistent content,
       and marking the whole pane live would re-read every section each time one
       is dismissed or the body is expanded. The announcement is a composed
       one-sentence summary, carried by an always-mounted hidden region in App —
       see notifAnnounce there for why it cannot live in this file. */
    <div role="region" aria-label="Notifications" style={{
      backgroundColor: top.tint || "var(--app-overlap-bg)",
      // The strip is recoloured by whatever is WORST right now, so its tint and
      // tone change under the reader when a notification arrives or resolves —
      // amber to red as a write fails, back to amber when it recovers. A cut
      // between two saturated tints reads as a flicker; a cross-fade reads as
      // the same object changing state, which is what it is.
      transition: "background-color " + M.move,
      border: "1px solid var(--border-card)",
      borderRadius: R.card,
      marginBottom: 10,
      boxShadow: "var(--shadow-soft)"
      // v17.10.2: `overflow: "hidden"` is GONE from here. It was clipping the
      // lid's focus ring to 1px of the 4 it needs (2px offset + 2px width) —
      // exactly the trap CLAUDE.md documents, recurring at a new site — and,
      // unreported, the hover lift of every button in the expanded body.
      //
      // It was only ever protecting this pane's rounded corners from the lid's
      // full-bleed hover tint, so the lid carries its own radius instead (below)
      // and nothing needs a clip: the body's rows are transparent with hairline
      // separators, and `Reveal` already manages its own overflow while it
      // animates. Do not add it back to fix a corner — round the child.
    }}>
      <button
        ref={lidRef}
        onClick={function () { setOpen(!open); }}
        aria-expanded={open}
        aria-label={open ? "Collapse notifications" : "Expand notifications"}
        // No press-scale: this is a full-width strip header, and a 0.96 dip on
        // something that spans the viewport reads as the page flinching.
        /* v17.9.1 (Patryk): the lid takes the shared row tint. It spans the
           viewport and holds the tally, so it is a container of controls, not a
           control — a tint says "tappable" without moving anything under the
           finger. `--row-bg` stays unset (transparent) so the strip's own
           severity tint shows through and keeps cross-fading.
           v17.9.1 review fix: `--row-bg-hover` must be set for the same reason.
           Left unset it falls back to the class default `--bg-ac-hover`, the
           accent wash — so hovering an amber "running late" or a red strip
           replaced the severity colour with blue, overriding the one signal the
           collapsed lid exists to carry. A neutral white/black veil lightens
           whatever tint is underneath instead of recolouring it. */
        className="mgt-ac-row mgt-nopress"
        style={{
          "--row-bg-hover": "var(--bg-veil)",
          display: "flex", alignItems: "center", gap: NOTIF_GAP, width: "100%",
          border: "none", cursor: "pointer",
          // Its own radius, since the pane no longer clips. Bottom corners go
          // square while the body is open — the lid is then the TOP of a taller
          // surface, not the whole of it.
          //
          // v17.14.0 (/code-review follow-up): LID_R is that radius MINUS the
          // pane's 1px border, which the lid sits inside. An inner surface
          // repeating the outer radius bulges past the curve, showing a
          // sub-pixel sliver of pane at each corner — visible because the lid's
          // hover veil is a different colour from the pane under it. There is no
          // token for "card minus a border", and adding one would put an entry
          // in a shared scale that only ever has this caller.
          borderRadius: open ? LID_R + " " + LID_R + " 0 0" : LID_R,
          padding: "10px " + NOTIF_PAD_X + "px", textAlign: "left"
        }}>
        {/* v17.8.0: an ICON, not the 8px dot. The dot said "something is
            happening", in a colour; the icon says WHICH something and keeps the
            colour, because every glyph is currentColor and takes `tone`. With
            several sections live the lid is the generic bell (it labels the
            container); with one, the strip IS that section, so it wears that
            section's own mark. */}
        <SectionMark
          icon={multi ? lidIcon : top.icon}
          tone={top.tone} size={IC.control} fallbackDot />
        {/* With ONE section live the strip IS that banner, so the lid takes its
            title and mark — a generic lid plus a redundant sub-header would be
            two rows saying one thing. With several it says "Notifications",
            collapsed as well as open: collapsed, the per-category tally on the
            right already names them, and repeating the top one in the title
            drew its icon twice in the same row. */}
        <span style={{ fontSize: T.body, fontWeight: FW.bold, color: top.tone, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color " + M.move }}>
          {multi ? "Notifications" : top.title}
        </span>
        {/* With several sections live, the right side is a per-category tally —
            an icon and a count each, in the same severity order as the body.
            "+2 more" and a bare total told you how much was wrong without
            telling you what; two glyphs and two numbers tell you it is one late
            table and one waiting party, which is the difference between needing
            to expand and not.
            It stays put when the strip OPENS. The first version swapped it for
            the plain total on the grounds that each section then heads itself —
            but that made the lid's contents change under the finger that tapped
            it, and the tally is the one part of the row that is still useful
            while open: the sections scroll, the lid does not, so it stays a
            fixed summary of a body you may be halfway down. */}
        {multi ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {ordered.map(function (s) {
              return (
                <span key={s.id} title={s.title}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, color: s.tone }}>
                  <SectionMark icon={s.icon} tone={s.tone} size={IC.control} fallbackDot />
                  <span style={{ fontSize: T.small, fontWeight: FW.bold, fontVariantNumeric: "tabular-nums" }}>{s.count || 1}</span>
                </span>
              );
            })}
          </span>
        ) : (
          <span style={{
            fontSize: T.small, fontWeight: FW.bold, color: top.tone, opacity: 0.75,
            fontVariantNumeric: "tabular-nums", flexShrink: 0,
            transition: "color " + M.move
          }}>{total}</span>
        )}
        {/* ONE glyph that turns, not two that swap. A ▲/▼ swap is a cut: the
            chevron is gone and a different one is there, with nothing to say
            the two are the same control. Rotating it makes the arrow the thing
            that moves, which is also what the panel below is doing. Matches the
            Collapsible atom's ›, which has turned since v15.8.0. */}
        <span aria-hidden="true" style={{
          fontSize: T.micro, color: top.tone, opacity: 0.6, fontWeight: FW.bold, flexShrink: 0,
          display: "inline-block", lineHeight: 1,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform " + M.move + ", color " + M.move
        }}><ChevronDownIcon size={IC.control} /></span>
      </button>
      <Reveal show={open}>
        {/* .mgt-notif draws the hairlines between sections (index.html). A CSS
            adjacent-sibling rule rather than a per-section borderTop prop, so a
            section never has to know its own position in the list.

            v17.11.0: the expanded body is BOUNDED and scrolls. Collapsed height
            has been one row however many notifications fire since v17.8.0 —
            that was the whole point — but expanding was unbounded, and measured
            live it took 305px of an 860px viewport with only TWO of six sections
            up. Six late bookings and a waitlist would have pushed the timeline
            off the tablet again, which is the failure the strip exists to
            prevent, merely moved one tap away.

            The cap is on the BODY, never on the pane: the lid is a sibling and
            must stay put, which is also what makes this work — v17.8.0 already
            decided the collapsed tally survives expansion "because the sections
            scroll and the lid doesn't". That sentence described an intent the
            code had not yet implemented; this is it.

            No `padding-inline` gutter here, unlike the app's other scrollers.
            The rule (CLAUDE.md) is that a scroll container clips its children's
            hover lift and focus ring at the padding box, and `overflow-y: auto`
            makes the OTHER axis clip too, per spec. But these rows already carry
            their own inset from BannerRows, and it is enough: measured live at
            14px of clearance on the right against a worst case of 5.8px — that
            is 4% of the WIDEST control, a 145px "Assign <name>" button, not the
            36px ✕ it is tempting to size this against — plus 4px for the focus
            ring. Measured, not assumed; re-measure if a wider control is ever
            added to a banner row.
            /code-review fix: `dvh`, not `vh`. The shell is `100dvh` in every
            branch, and on a phone or tablet with a dynamic browser toolbar
            `100vh` is the LARGER viewport — so a `40vh` cap is ~45–50% of what
            is actually on screen, loosest on exactly the devices this exists to
            protect. Matching the shell's unit is what makes "40% of the
            viewport" true rather than approximately true. */}
        <div ref={bodyRef} className="mgt-notif" style={{ maxHeight: "40dvh", overflowY: "auto" }}>
          {orderedIds.map(function (id) {
            const s = byId[id];
            return (
              // A departed id has no live section, so children go null and the
              // Reveal fades out the copy it already holds. That is the atom's
              // documented behaviour, and using it is why nothing here has to
              // cache a node.
              <Reveal key={id} show={openIds.has(id)}>
                {s ? (
                  <>
                    {/* The sub-header is itself Revealed, not conditionally
                        rendered. Going from two sections to one changes three
                        things at once — a section folds away, the survivor
                        loses its own header, and the lid stops saying
                        "Notifications" and takes that section's title. All
                        three key on the RENDERED count, so they happen on one
                        frame, when the departing section is finally pruned.
                        Keying the lid on the live count instead moved the text
                        350ms before the geometry, which is the version that
                        looked broken. */}
                    <Reveal show={orderedIds.length > 1}>
                      <div style={{ display: "flex", alignItems: "center", gap: NOTIF_GAP, padding: "8px " + NOTIF_PAD_X + "px 2px" }}>
                        <SectionMark icon={s.icon} tone={s.tone} size={IC.control} fallbackDot />
                        <span style={{ fontSize: T.body, fontWeight: FW.bold, color: s.tone, flex: 1, minWidth: 0 }}>{s.title}</span>
                        {s.count > 1 ? (
                          <span style={{
                            fontSize: T.small, fontWeight: FW.bold, color: s.tone, opacity: 0.75,
                            fontVariantNumeric: "tabular-nums", flexShrink: 0
                          }}>{s.count}</span>
                        ) : null}
                      </div>
                    </Reveal>
                    {s.node}
                  </>
                ) : null}
              </Reveal>
            );
          })}
        </div>
      </Reveal>
    </div>
  );
}
