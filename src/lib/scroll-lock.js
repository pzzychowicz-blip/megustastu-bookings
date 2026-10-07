// src/lib/scroll-lock.js
// v18.4.2 — `lockPageScroll(doc)` → `unlock()`: the page behind a full-screen
// surface does not scroll while it is open. Two callers: `Overlay` (a phone's
// sheet only; it checks the width itself) and the WhatsApp `InboxPanel` (every
// width). The lock itself knows nothing about width.
//
// It is a COUNT and a class, not a saved value. Until this version each
// Overlay read `body.style.overflow` when it mounted, wrote "hidden", and wrote
// the value it had read back when it unmounted. Two things made that value
// stale, and a stale "hidden" is a page nobody can scroll until a reload:
//   - two sheets at once (the discard confirm over the booking form). The
//     confirm mounts second and reads the form's "hidden". When both close, the
//     form restores "auto" and then the confirm restores "hidden". Measured in
//     the iOS 27 Simulator (the home-screen app, "Lock navigation" off): after
//     Discard, `body.style.overflow` read "hidden" with no dialog on screen,
//     and the page would not scroll back to its header;
//   - the shell changing its own value under an open sheet. Settings read
//     "hidden" ("Lock navigation" on), the toggle was switched off in it, the
//     shell wrote "auto", and closing Settings wrote "hidden" back (same run:
//     "auto" then "hidden" 50ms apart, the page 1189 tall in an 894 window).
// A class on <html> cannot go stale: the shell keeps the only inline value
// (BookingApp's two effects), the rule in index.css overrides it while the
// count is above zero, and the order the sheets close in no longer matters.

const CLASS = "mgt-scroll-lock";
let locks = 0;

export function lockPageScroll(doc) {
  const root = doc ? doc.documentElement : null;
  if (!root) return function () {};
  if (locks++ === 0) root.classList.add(CLASS);
  let released = false;
  return function () {
    if (released) return;
    released = true;
    if (--locks === 0) root.classList.remove(CLASS);
  };
}
