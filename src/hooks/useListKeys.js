// src/hooks/useListKeys.js — v18.19.1
//
// Stable React keys for a list whose items have no id of their own (the size,
// combo and swap rules), so a row's DOM node follows the rule when the rules are
// reordered. Keyed by index, a reorder would leave every node where it was and
// swap the CONTENT under it: a focused grip would end up on another rule, and a
// row's `Reveal` would ease open or shut for a rule that never changed.
//
// `move(from, to)` and `remove(i)` are called beside the save that does the same
// to the list. A list that grows (an add, or another device's) gets new keys at
// its end; one that shrinks without `remove` (another device's delete) drops
// keys from its end, which costs only that a row may re-render as another.
// The keys are STATE, adjusted during render when the length changes, never a
// ref read in render.
import { useState } from "react";
import { moveItem } from "../lib/reorder";

export function useListKeys(count, prefix) {
  const [st, setSt] = useState(function () {
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(prefix + i);
    return { keys: keys, next: count };
  });
  let cur = st;
  if (cur.keys.length !== count) {
    if (count > cur.keys.length) {
      const keys = cur.keys.slice();
      let next = cur.next;
      while (keys.length < count) keys.push(prefix + (next++));
      cur = { keys: keys, next: next };
    } else {
      cur = { keys: cur.keys.slice(0, count), next: cur.next };
    }
    setSt(cur);
  }
  return {
    keys: cur.keys,
    move: function (from, to) { setSt(function (s) { return { keys: moveItem(s.keys, from, to), next: s.next }; }); },
    remove: function (i) { setSt(function (s) { return { keys: s.keys.filter(function (_, k) { return k !== i; }), next: s.next }; }); }
  };
}
