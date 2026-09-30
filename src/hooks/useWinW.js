// src/hooks/useWinW.js
// `useWinW` — React hook that returns the current viewport width in pixels
// and re-renders any consumer when the window is resized. The single source
// of truth for "how wide is the screen right now" across the app.
//
// On the server / pre-hydration, where `window` is not defined, the hook
// seeds at 1024 (a reasonable desktop default). After mount, the resize
// listener takes over and reports the real width.
//
// Currently used in App.jsx to compute `isMobile = winW < 600` for header
// font size, page padding, the booking form's grid columns, and the
// `isMobile` prop passed down to WalkinForm. Future hooks live alongside
// this file, one hook per file (matching the components/ folder pattern);
// no barrel index — direct imports keep dependencies explicit.
//
// Phase C2 (v15-refactor): extracted verbatim from App.jsx (the local
// `function useWinW(){ … }` block at the top of the file). Style
// intentionally unchanged from the original — `var` retained, function
// declaration retained — so this is a pure structural move with no
// modernisation. JSX-style hook conversion comes in Phase C3.
//
// v18.3.2 (the stale-closure triage): the state is DESTRUCTURED now, as a
// `const`. Read through `ws[1]`, the lint could not tell `setW` was a state
// setter and asked for it as an effect dependency; destructured, it knows a
// setter never changes. No behaviour change.

import { useState, useEffect } from "react";

export function useWinW(){
  const [w,setW]=useState(typeof window!=="undefined"?window.innerWidth:1024);
  useEffect(function(){
    function h(){setW(window.innerWidth);}
    window.addEventListener("resize",h);
    return function(){window.removeEventListener("resize",h);};
  },[]);
  return w;
}
