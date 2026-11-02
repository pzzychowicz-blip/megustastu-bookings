// src/components/AcMenu.jsx
//
// v18.14.2 — the sheet a suggestion list sits in: `AC_MENU` with `useMenuRoom`,
// so a list that opens above a form's footer stops there. The name and phone
// lists are built as elements in BookingFormModal's render, which cannot take a
// hook per list, and an unbounded one ran its last rows under the Save bar with
// the keyboard up, out of reach of its own scroll.
//
// Mounted only while its list is showing, so it is always "open". `menuRef` is
// for a caller that needs the node as well (VoucherPicker scrolls it into view).
// CountryPicker stays its own: it fades, and its height holds a search box.

import { useRef } from "react";
import { AC_MENU } from "../hooks/useAcRow";
import { useMenuRoom } from "../hooks/useMenuRoom";

export function AcMenu({ menuRef, children }) {
  const own = useRef(null);
  const ref = menuRef || own;
  useMenuRoom(ref, true, AC_MENU.maxHeight);
  return <div ref={ref} style={AC_MENU}>{children}</div>;
}
