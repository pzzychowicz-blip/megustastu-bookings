// src/components/FoldRows.jsx
//
// v18.14.0 (correction 32, Patryk): a list somebody adds to and removes from, on a
// surface with no FLIP. A row that went in a frame took everything under it with it
// (182px on the People list), so here a row opens and folds on ROW_FOLD and what sits
// below slides. Unlike the List's cards, a newcomer eases open too: those arrive at
// full height because FLIP slides the rest, and nothing here does.
//
//   items     the live rows
//   idOf      item → its stable id
//   children  (item, index) → the row. A leaving row draws the last copy, inert.
//   gap       for chips in a flex row: that row's gap, and they open sideways
//
// `useLeavingOrder` keeps a leaving row in its place, and the row returns an array, so
// a parent's flex or grid sees each row as its own child.

import { ROW_FOLD } from "../lib/constants";
import { useRevealRows } from "../hooks/useRevealRows";
import { useLeavingOrder } from "../hooks/useLeavingOrder";
import { Reveal, RowSlot } from "./atoms";

export function FoldRows({ items, idOf, gap, children }) {
  const ids = items.map(idOf);
  const { renderIds, openIds } = useRevealRows(ids, undefined, gap == null ? { speed: ROW_FOLD } : undefined);
  const order = useLeavingOrder(ids, renderIds);
  return order.map(function (id) {
    const at = ids.indexOf(id);
    const row = at < 0 ? null : children(items[at], at);
    return gap == null
      ? <Reveal key={id} show={openIds.has(id)} speed={ROW_FOLD} inert={at < 0}>{row}</Reveal>
      : <RowSlot key={id} show={openIds.has(id)} gap={gap}>{row}</RowSlot>;
  });
}
