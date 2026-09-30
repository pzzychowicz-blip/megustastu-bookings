// src/hooks/useWinH.js
// `useWinH` — React hook that returns the current viewport height in pixels
// and re-renders any consumer when the window is resized. The height sibling
// of useWinW; the single source of truth for "how tall is the screen right
// now".
//
// On the server / pre-hydration, where `window` is not defined, the hook
// seeds at 768 (a reasonable desktop default). After mount, the resize
// listener takes over and reports the real height.
//
// Used by the WhatsApp InboxPanel to derive a `compact` flag (winH <
// INBOX_COMPACT_HEIGHT) so the draft card + composer template chips collapse
// on short screens (tablet) without changing the tall/laptop layout.

import { useState, useEffect } from "react";

export function useWinH(){
  // v18.3.2: destructured, so the lint can see `setH` is a state setter (it
  // could not through `hs[1]`, and asked for it as a dependency).
  const [h, setH] = useState(typeof window !== "undefined" ? window.innerHeight : 768);
  useEffect(function(){
    function onResize(){ setH(window.innerHeight); }
    window.addEventListener("resize", onResize);
    return function(){ window.removeEventListener("resize", onResize); };
  }, []);
  return h;
}
