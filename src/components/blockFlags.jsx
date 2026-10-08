// src/components/blockFlags.jsx
//
// v18.4.0 — the flags a booking's block carries, as ONE list. It was a
// module-private function in TimelineView.jsx (v18.2.0 phase 22), read by the
// block that draws them and by `chipRoomFor`, which counts them. The printed
// timeline (TimelineSheet.jsx) draws the same flags, so the list moved here
// rather than gaining a second copy: a flag added to one grid and not the
// other is the defect phase 22 removed between the block and its chip.
//
// Rail order, left to right. `keep` is the DROP priority (1 is dropped last)
// that `visibleRail` (lib/block-layout.js) reads; `tests/block-layout.test.js`
// holds its fixture to this function.
//
// v18.4.6: `legend` is what the flag MEANS, in the few words a printed key has
// room for. On screen a flag explains itself on hover (`title`, which carries
// the booking's own figures); paper has no hover, so the printed timeline's
// key lists each flag it drew (TimelineSheet.jsx). It is on the entry, not in
// a table beside the sheet, so a flag added here cannot print unexplained.
// The zone slot has three meanings and so three legends.
//
// A .jsx file with a plain function export and no component: the entries carry
// JSX icons, and TimelineView may not export a non-component beside its own
// (react-refresh/only-export-components).

import { IC } from "../lib/constants";
import { isLocked, countLabel, offZone, offZoneLabel } from "../lib/booking-logic";
import { money } from "../lib/vouchers";
import { StarIcon, LockIcon, NoShowIcon, DepositIcon, OverlapIcon, IndoorIcon, OutdoorIcon, AlertIcon } from "./Icons";

export function railFlagsOf(b, noShows, warn, currency) {
  const depositAmt = Number(b.deposit) || 0;
  const zone = b.preference === "indoor" || b.preference === "outdoor" ? b.preference : null;
  const hasPrefT = b.preferredTables && b.preferredTables.length > 0;
  return [
    depositAmt > 0
      ? { k: "dep", keep: 2, legend: "Deposit paid", title: "Deposit " + money(depositAmt, currency), icon: <DepositIcon size={IC.control} /> } : null,
    // v18.3.1: seated outside the zone it asked for (a preference is a wish
    // now), the zone mark gives way to the alert mark, in the same slot, at the
    // same size, in the same BlockFlag (Patryk: a flag like the others). Warning
    // ink cannot sit on the block's status fill, so the mark says it instead.
    zone
      ? { k: "zone", keep: 3, legend: offZone(b) ? "Not seated in the zone asked for" : (zone === "indoor" ? "Prefers indoor" : "Prefers outdoor"), title: offZone(b) ? offZoneLabel(b) : (zone === "indoor" ? "Prefers indoor" : "Prefers outdoor"),
          icon: offZone(b) ? <AlertIcon size={IC.control} /> : zone === "indoor" ? <IndoorIcon size={IC.control} /> : <OutdoorIcon size={IC.control} /> } : null,
    hasPrefT
      ? { k: "pref", keep: 6, legend: "Asked for particular tables", title: "Preferred tables: " + b.preferredTables.join(", "), icon: <StarIcon size={IC.control} /> } : null,
    isLocked(b)
      ? { k: "lock", keep: 5, legend: "Locked to its tables", title: "Locked to these tables — the optimiser will not move it", icon: <LockIcon size={IC.control} /> } : null,
    noShows >= 2
      ? { k: "ns", keep: 4, legend: "2 or more past no-shows", title: countLabel(noShows, "past no-show", "past no-shows") + " on this number", icon: <NoShowIcon size={IC.control} /> } : null,
    warn && warn.overdue
      ? { k: "over", keep: 1, legend: "Overstaying", title: "Overstaying — " + warn.next + " needs this table at " + warn.nextTime, icon: <OverlapIcon size={IC.control} /> } : null
  ].filter(Boolean);
}
