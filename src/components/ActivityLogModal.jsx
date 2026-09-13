// src/components/ActivityLogModal.jsx — v18.0.0 session 8 (item 1)
//
// Patryk's first item: a general history, visible to the admin, covering
// changes, deletions and who did them.
//
// ── IT RESOLVES NAMES, IT DOES NOT STORE THEM ───────────────────────────────
// An entry's `text` holds `{b:<id>}` tokens, never a guest's name — see
// `lib/activity.js` for why that makes erasure a property of the shape. This
// component is the other half: `renderText` resolves each token against the
// LIVE bookings list, so an anonymised booking reads "Data removed" here with
// no pass over the log ever having been made, and a renamed guest reads by
// their current name. Only a DELETED booking has no row to resolve against, and
// those entries carry their own `subject.name` as the fallback.
//
// ── A RANGE, AND BY DEFAULT NO RANGE AT ALL ─────────────────────────────────
// v18.0.0 session 11. The feed was a day, because "what happened on Saturday"
// is one question this screen exists to answer — but it was the ONLY question
// it could be asked, so the search box searched a single day and found nothing
// anywhere else. Patryk: *"Search box must search globally (as Find a booking
// does) not by date only. Filtering by date should be one of options."*
//
// So the window is a FROM–TO range whose ends are independently optional, and
// both start empty: the resting question is the whole log, newest first, and a
// day is what you narrow to. One control, because the delete below acts on the
// same range — what you are looking at is exactly what you would remove, and
// two date controls on one panel is where they drift apart.
//
// The listener is mounted only while this modal is open (`useActivityFeed`'s
// `enabled`), which is why the range lives in state up in App rather than here:
// closing the modal must detach the listener, and a range held here would go
// with it.
import { useId, useMemo, useState } from "react";
import { S, T, FW, SP, R, H, IC, BTN } from "../lib/constants";
import { Overlay, ModalTitle, OutlineChip, DateField, SearchField, mkInp, mkSel, mkBtn, mkSolidBtn, AutoHeight } from "./atoms";
import { renderText, activityCsv, activityCsvName } from "../lib/activity";
// v18.0.0 session 11: `isReadableDate` is no longer imported here. Session 10
// had this panel re-ask whether the day was readable so it would not report an
// unasked question as an answer — but with two independently optional dates the
// condition is no longer one predicate over one string, and App is the only
// place that knows whether the QUERY ran. It passes `badDay`/`backwards`
// instead. Restating the test here would have been a second answer to a
// question that now has more than one input.
//
// `addDays` rather than hand-rolled date arithmetic for the quick ranges,
// because `setDate(getDate() - 6)` returns the SAME date on the spring-forward
// day (v17.16.2).
import { todayStr, addDays } from "../lib/day";
import { DownloadIcon } from "./Icons";

// The kinds a person would filter by, in the order they matter during service.
// `session` and `data` are deliberately last: signing in and exporting a backup
// are real entries and nobody opens this screen looking for them.
const KIND_LABEL = {
  booking: "Bookings", voucher: "Vouchers", table: "Tables",
  waitlist: "Waitlist", reminder: "Reminders", standing: "Standing",
  settings: "Settings", people: "People", session: "Sign-in", data: "Data",
};
const KIND_ORDER = [
  "booking", "voucher", "table", "waitlist", "reminder",
  "standing", "settings", "people", "session", "data",
];

function timeOf(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// v18.0.0 session 11: the day, for a list that can now span them. `dd.mm`
// rather than a locale month name — it is the shape the date fields above it
// already show, it sorts visually, and it stays two fixed-width columns so a
// list of a hundred rows lines up.
function dateOf(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0");
}

// The author, as a person would say it: the local part of the email, which is
// what staff call each other. The full address is the `title`, because two
// people can share a first name and the log has to be able to settle that.
function personOf(email) {
  const at = String(email || "").indexOf("@");
  return at > 0 ? String(email).slice(0, at) : (email || "—");
}

export function ActivityLogModal({
  fromDay, toDay, onSetFromDay, onSetToDay, badDay, backwards,
  rows, loading, loadingMore, hasMore, onLoadOlder,
  canClear, clearBusy, clearMsg, onClearRange, onDownload,
  bookings, onOpenBooking, onClose,
}) {
  const [armed, setArmed] = useState(false);
  const warnId = useId();
  const [kinds, setKinds] = useState({});     // {} = everything
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  // v18.0.0 session 11. Entries already carried `auto` and the rows already
  // showed it as a chip, but nothing could filter on it — and "what did a
  // PERSON do" is the question an audit log is opened for. On a busy day the
  // answer was buried under the auto-optimiser's own reshuffles.
  const [peopleOnly, setPeopleOnly] = useState(false);

  // The quick ranges. `addDays(todayStr(), -6)` is six days back INCLUSIVE of
  // today, which is what "last 7 days" means to a person counting shifts.
  // Changing the range DISARMS. The confirm is a promise about a specific
  // window, and leaving it armed across a change would let a second tap delete
  // a range nobody agreed to — the arming pattern's one real failure mode.
  function setRange(a, b) { setArmed(false); onSetFromDay(a); onSetToDay(b); }
  const today = todayStr();
  const oneDay = !!fromDay && fromDay === toDay;
  const allTime = !fromDay && !toDay;
  // Rows only need a date column when the window can hold more than one day —
  // on a single day it would be the same eight characters on every row.
  const showDate = !oneDay;

  // Resolving a token needs a map, and the bookings list is an array. Built
  // once per render of a list that only changes when a booking does.
  const byId = useMemo(function () {
    const m = {};
    (bookings || []).forEach(function (b) { if (b && b.id) m[b.id] = b; });
    return m;
  }, [bookings]);

  const people = useMemo(function () {
    const seen = {};
    (rows || []).forEach(function (r) { if (r.email) seen[r.email] = true; });
    return Object.keys(seen).sort();
  }, [rows]);

  const anyKind = Object.keys(kinds).some(function (k) { return kinds[k]; });

  const shown = useMemo(function () {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter(function (r) {
      if (anyKind && !kinds[r.kind]) return false;
      if (who && r.email !== who) return false;
      if (peopleOnly && r.auto) return false;
      if (!needle) return true;
      // Searched against what is ON SCREEN, tokens resolved — otherwise typing
      // a guest's name finds nothing, which is the first thing anybody tries.
      const text = renderText(r.text, byId, r.subject && r.subject.name);
      return (text + " " + personOf(r.email)).toLowerCase().includes(needle);
    });
  }, [rows, kinds, anyKind, who, peopleOnly, q, byId]);

  function toggleKind(k) {
    setKinds(function (prev) {
      const next = Object.assign({}, prev);
      if (next[k]) delete next[k]; else next[k] = true;
      return next;
    });
  }

  return (
    <Overlay onClose={onClose} footer={
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="mgt-hover-scale" onClick={onClose}
          style={mkBtn({ background: "var(--app-btn-slate)" })}>Done</button>
      </div>
    }>
      {/* A read surface, so the pill takes the neutral — ModalTitle's colour
          rule, and the same one the Settings overlay this opens from wears. */}
      <ModalTitle background="var(--app-btn-grey-strong)">Activity log</ModalTitle>

      {/* v18.0.0 session 11: FROM and TO, each independently clearable. The
          quick chips below are not a third mode — they write the same two
          fields, so there is exactly one place the window is stated and the
          chips are shortcuts to it rather than a parallel control that can
          disagree with what the fields say. */}
      <div style={{ display: "flex", gap: SP.base, flexWrap: "wrap", alignItems: "center", marginBottom: SP.base }}>
        <DateField
          value={fromDay}
          onChange={function (e) { setArmed(false); onSetFromDay(e.target.value); }}
          style={{ ...mkInp(), width: "auto", flex: "0 1 190px" }}
          inputProps={{ "aria-label": "From day (leave empty for no start)" }}
        />
        <span aria-hidden="true" style={{ fontSize: T.body, color: S.muted }}>→</span>
        <DateField
          value={toDay}
          onChange={function (e) { setArmed(false); onSetToDay(e.target.value); }}
          style={{ ...mkInp(), width: "auto", flex: "0 1 190px" }}
          inputProps={{ "aria-label": "To day (leave empty for no end)" }}
        />
      </div>

      <div role="group" aria-label="Quick ranges"
        style={{ display: "flex", gap: SP.tight, flexWrap: "wrap", alignItems: "center", marginBottom: SP.base }}>
        <OutlineChip as="button" tone={oneDay && fromDay === today ? "success" : "neutral"}
          aria-pressed={oneDay && fromDay === today}
          onClick={function () { setRange(today, today); }}>Today</OutlineChip>
        <OutlineChip as="button" tone={fromDay === addDays(today, -6) && toDay === today ? "success" : "neutral"}
          aria-pressed={fromDay === addDays(today, -6) && toDay === today}
          onClick={function () { setRange(addDays(today, -6), today); }}>Last 7 days</OutlineChip>
        <OutlineChip as="button" tone={allTime ? "success" : "neutral"}
          aria-pressed={allTime}
          onClick={function () { setRange("", ""); }}>All time</OutlineChip>
      </div>

      <div style={{ display: "flex", gap: SP.base, flexWrap: "wrap", alignItems: "center", marginBottom: SP.base }}>
        {/* `.mgt-hover-scale` here, like every other control in the app —
            `check:style`'s Rule 10 catches an interactive element without it,
            and it caught this one. `DateField` above needs none because the
            atom carries the class on its own wrapper. `mkSel` rather than
            `mkInp` for the dropdown: a <select> paints its arrow hard against
            padding-right, which on a pill lands it inside the right cap. */}
        <select
          value={who}
          onChange={function (e) { setWho(e.target.value); }}
          aria-label="Filter by person"
          className="mgt-hover-scale"
          style={{ ...mkSel(), width: "auto", flex: "0 1 170px" }}
        >
          <option value="">Everyone</option>
          {people.map(function (p) {
            return <option key={p} value={p}>{personOf(p)}</option>;
          })}
        </select>
        {/* v18.0.0 session 11: the search box WAS the third `.mgt-hover-scale`
            control on this row, and that is exactly what made its clear button
            unclickable — measured, the ✕ responded 21px to the right of where
            it was painted. `SearchField` is that fix; its header carries the
            measurement and the rule it broke. */}
        <SearchField
          value={q}
          onChange={function (e) { setQ(e.target.value); }}
          onClear={function () { setQ(""); }}
          ariaLabel="Search the activity log"
          placeholder="Search…"
          style={{ flex: "1 1 140px" }}
        />
      </div>

      <div role="group" aria-label="Filter by kind"
        style={{ display: "flex", gap: SP.tight, flexWrap: "wrap", marginBottom: SP.base }}>
        {KIND_ORDER.map(function (k) {
          const on = !!kinds[k];
          return (
            <OutlineChip
              key={k} as="button" tone={on ? "success" : "neutral"}
              aria-pressed={on}
              onClick={function () { toggleKind(k); }}
            >{KIND_LABEL[k]}</OutlineChip>
          );
        })}
        {/* Not a kind, so it is separated by a gap rather than sitting in the
            run: every chip to its left narrows WHAT happened, this one narrows
            WHO did it — the same axis as the person dropdown above. */}
        <span aria-hidden="true" style={{ width: SP.wide }} />
        <OutlineChip as="button" tone={peopleOnly ? "success" : "neutral"}
          aria-pressed={peopleOnly}
          onClick={function () { setPeopleOnly(function (v) { return !v; }); }}
        >People only</OutlineChip>
      </div>

      {/* The count, because the list is no longer bounded by a day and "how
          much am I looking at" stops being obvious. It also states when the
          filters are hiding rows — otherwise a narrowed list and a quiet week
          look identical, which is the same confusion the empty states below
          exist to settle. */}
      <div style={{ fontSize: T.micro, color: S.muted, marginBottom: SP.tight }}>
        {loading ? "" : shown.length === rows.length
          ? shown.length + (shown.length === 1 ? " entry" : " entries")
          : shown.length + " of " + rows.length + " shown"}
      </div>

      <AutoHeight watch={fromDay + "·" + toDay + "·" + shown.length + "·" + loading}>
        <div>
          {badDay || backwards ? (
            <div style={{ fontSize: T.body, color: S.muted, padding: SP.wide + "px 0" }}>
              {/* v18.0.0 session 10 (/code-review): a date input CAN be emptied,
                  and App withholds the query until what is typed is readable
                  again, so this must not report an unasked question as an
                  answer. Session 11: empty is now legal — it means "no bound
                  this side" — so only a half-typed date and a backwards range
                  reach here, and they are named separately because an empty
                  list would otherwise look exactly like a quiet week. */}
              {backwards ? "That range ends before it starts." : "Finish typing the date."}
            </div>
          ) : loading ? (
            <div style={{ fontSize: T.body, color: S.muted, padding: SP.wide + "px 0" }}>Loading…</div>
          ) : shown.length === 0 ? (
            <div style={{ fontSize: T.body, color: S.muted, padding: SP.wide + "px 0" }}>
              {rows && rows.length
                ? "Nothing matches those filters."
                : allTime
                  ? "Nothing has been recorded yet."
                  : oneDay
                    ? "Nothing was recorded on this day."
                    : "Nothing was recorded in that range."}
            </div>
          ) : shown.map(function (r) {
            const text = renderText(r.text, byId, r.subject && r.subject.name);
            // A row naming a booking that still exists can open it. One that
            // names a deleted one cannot, and must not look as though it could.
            const first = r.bookings ? Object.keys(r.bookings)[0] : null;
            const live = first && byId[first] ? first : null;
            return (
              <div key={r.id} style={{
                display: "flex", gap: SP.base, alignItems: "baseline",
                padding: "6px 8px", borderRadius: R.inset,
                borderBottom: "1px solid var(--border-soft)",
              }}>
                {showDate ? (
                  <span style={{ fontSize: T.micro, color: S.muted, minWidth: 40, fontVariantNumeric: "tabular-nums" }}>
                    {dateOf(r.at)}
                  </span>
                ) : null}
                <span style={{ fontSize: T.micro, color: S.muted, minWidth: 44, fontVariantNumeric: "tabular-nums" }}>
                  {timeOf(r.at)}
                </span>
                <span title={r.email} style={{ fontSize: T.micro, color: S.muted, minWidth: 76, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {personOf(r.email)}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: T.body, color: S.text }}>
                  {live ? (
                    <button
                      type="button"
                      className="mgt-hover-scale"
                      onClick={function () { onOpenBooking(live); }}
                      style={mkBtn({
                        background: "transparent", border: "none", boxShadow: "none",
                        color: "var(--text-primary)", padding: SP.none, minHeight: 0,
                        fontSize: T.body, fontWeight: FW.regular, textAlign: "left",
                      })}
                    >{text}</button>
                  ) : text}
                </span>
                {r.auto ? <OutlineChip tone="neutral" size="micro">Automatic</OutlineChip> : null}
              </div>
            );
          })}
          {/* v18.0.0 session 11. Offered only when the feed came back FULL, so
              the button's presence is evidence rather than decoration — see
              `hasMore` in useActivityFeed for why it over-reports by one press
              rather than under-reporting by any.

              It is inside the list and not in the footer on purpose: it acts on
              the END of what you are reading, and a control in the pinned
              footer would sit beside Done, where it reads as a second way to
              leave. */}
          {hasMore || loadingMore ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: SP.base }}>
              <button
                type="button"
                className="mgt-hover-scale"
                onClick={onLoadOlder}
                disabled={loadingMore}
                style={mkBtn({ background: "var(--app-btn-slate)", minHeight: H.compact, fontSize: T.body })}
              >{loadingMore ? "Loading…" : "Load older"}</button>
            </div>
          ) : null}
        </div>
      </AutoHeight>

      {/* ── Clearing a range (v18.0.0 session 11) ───────────────────────────
          Patryk: "There must be an option to remove the data. Options should be:
          remove by date or a range of dates."

          It acts on the RANGE and NOT on the filters, and the armed sentence
          says so outright — somebody who has narrowed to Vouchers and presses
          this would otherwise reasonably expect only vouchers to go. It also
          says the clear can reach entries not loaded on screen, because the
          list is capped at a page and the delete is not.

          Requiring a bound is the load-bearing part: this modal OPENS on "all
          time", so a clear that accepted an unbounded range would put "delete
          the entire log" one tap from the resting state of the screen. */}
      {canClear ? (
        <div style={{ marginTop: SP.base, paddingTop: SP.base, borderTop: "1px solid var(--border-soft)" }}>
          {/* The button comes FIRST and the warning appears UNDER it, so arming
              cannot move the thing you are about to press a second time.

              Measured before this order was chosen: with the warning above, the
              first tap pushed the confirm button 50px DOWN the page and the
              second tap landed on the paragraph that had just appeared. That is
              Commit 119's defect — a control sliding out from under the cursor
              between aiming and clicking — reintroduced by a layout rather than
              by a transform, and on a DESTRUCTIVE control, where the failure is
              not "nothing happened" but "something else did".

              The warning is tied to the button with `aria-describedby` rather
              than announced as a live region: a live region created already
              holding its message announces nothing, and the id is emitted only
              while the element it names exists — a describedby pointing at an
              absent id is worse than none (`Fld`'s rule). */}
          <div style={{ display: "flex", gap: SP.base, alignItems: "center", flexWrap: "wrap" }}>
            {/* Download sits BEFORE Clear, and not only for reading order: on
                the free plan there are no backups, so a clear is a one-way door
                and the way to take a copy first should be the control your eye
                reaches first. It exports what is SHOWN — filters, search and
                all — which is the opposite of what Clear does, and the labels
                say which is which. */}
            <button
              type="button"
              className="mgt-hover-scale"
              disabled={!shown.length}
              onClick={function () { onDownload(activityCsv(shown, byId), activityCsvName(fromDay, toDay)); }}
              style={mkBtn({
                background: BTN.nav, fontSize: T.body, minHeight: H.compact,
                display: "inline-flex", alignItems: "center", gap: SP.snug,
                opacity: shown.length ? 1 : 0.5,
              })}
            ><DownloadIcon size={IC.control} />Download {shown.length ? shown.length : ""} shown</button>
            <button
              type="button"
              className="mgt-hover-scale"
              disabled={allTime || clearBusy || !!badDay || !!backwards}
              aria-describedby={armed ? warnId : undefined}
              onClick={function () {
                if (armed) { setArmed(false); onClearRange(); } else setArmed(true);
              }}
              style={mkSolidBtn(BTN.del, {
                fontSize: T.body, minHeight: H.compact, padding: SP.base + "px " + SP.pane + "px",
                opacity: allTime || clearBusy || badDay || backwards ? 0.5 : 1,
              })}
            >{clearBusy ? "Clearing…" : armed ? "Confirm — delete this range" : "Clear this range"}</button>
            {allTime ? (
              <span style={{ fontSize: T.micro, color: S.muted }}>
                Pick a day or a range above to clear.
              </span>
            ) : null}
          </div>
          {clearMsg && !armed ? (
            <div style={{ fontSize: T.body, color: S.muted, marginTop: SP.base }}>{clearMsg}</div>
          ) : null}
          {armed ? (
            <div id={warnId} style={{ fontSize: T.body, fontWeight: FW.bold, color: "var(--danger-text)", marginTop: SP.base }}>
              Permanently deletes every entry from {fromDay || "the beginning"} to {toDay || "now"} — including any
              not loaded here, and whatever the filters above are showing. There are no backups.
              The log will record that this happened. Tap again to confirm.
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ fontSize: T.micro, color: S.muted, marginTop: SP.base }}>
        {/* Said on screen rather than implied, because the database cannot
            enforce it: `.read` is `auth != null` at the root and cascades, so
            every signed-in account can read this node. Hiding the screen is
            what this app can honestly promise, and it says so.

            v18.0.0 session 11: and the second sentence is the honest half of
            the rules having given up their 12-month delete floor. An admin can
            now remove a range on purpose, so "kept for 12 months" is a policy
            the app keeps rather than a guarantee the database enforces. */}
        Kept for 12 months, and an admin can clear a range sooner — a clear is
        itself recorded. Any signed-in account can read this log — it is hidden
        from the app, not from the database.
      </div>
    </Overlay>
  );
}
