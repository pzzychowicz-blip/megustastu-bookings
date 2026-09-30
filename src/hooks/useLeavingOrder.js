// src/hooks/useLeavingOrder.js
//
// v18.3.2 (O3) — `useLeavingOrder(liveIds, renderIds)`: the order to draw a
// `useRevealRows` list in, with each row that is folding away kept where it
// was. The arithmetic is `placeLeaving` (lib/leaving-order.js), which needs the
// order drawn LAST time; this hook is only where that is remembered.
//
// It is remembered in state, adjusted during render when the inputs change
// (React's documented "storing information from previous renders" pattern,
// which useRevealRows uses for its resetKey), not in a ref: reading a ref
// during render is what the React Compiler lint warns about, and a ref written
// by an effect would hold the same value one commit later for no gain. The
// stored order is the one computed the last time the inputs changed, which is
// the order on screen, since nothing else moves it.
//
// Callers: WaitlistPanel's rows and ListView's active cards.

import { useState } from "react";
import { placeLeaving } from "../lib/leaving-order";

export function useLeavingOrder(liveIds, renderIds) {
  // Ids are path-safe (`genId()`), so a comma cannot occur inside one.
  const key = liveIds.join(",") + "|" + renderIds.join(",");
  const [placed, setPlaced] = useState(function () {
    return { key: key, order: placeLeaving(liveIds, renderIds, []) };
  });
  if (placed.key === key) return placed.order;
  const order = placeLeaving(liveIds, renderIds, placed.order);
  setPlaced({ key: key, order: order });
  return order;
}
