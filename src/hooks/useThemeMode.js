// src/hooks/useThemeMode.js
// v14.2.0: Dark-mode theming hook — ported from MGT Scheduling (its v0.11.0),
// keeping the shared cross-app contract identical:
//   useThemeMode(explicitPref) -> isDark
// `explicitPref` is true | false | undefined:
//   true      -> force dark
//   false     -> force light
//   undefined -> follow the OS `prefers-color-scheme` live
//
// The hook writes `document.documentElement.dataset.theme` ("dark"|"light"),
// so a theme flip is ONE DOM attribute change — zero React re-renders of the
// tree. Only `isDark` (the return value) lives in React, for the Settings
// Toggle's `on` state.
//
// In Bookings the preference is per-device localStorage (there is no Firebase
// settings node): BookingApp derives `explicitPref` via readThemePref() and
// the Settings toggle writes the key. The no-flash inline script in index.html
// paints the correct theme BEFORE React mounts — the hook alone runs too late
// to prevent the wrong-theme flash.

import { useEffect, useState } from "react";

export function useThemeMode(explicitPref) {
  // Initial state mirrors the effect's resolution -> no first-render mismatch
  // between the rendered Toggle and the DOM theme attribute.
  const [isDark, setIsDark] = useState(function () {
    if (explicitPref === true) return true;
    if (explicitPref === false) return false;
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(function () {
    function apply(dark) {
      setIsDark(dark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    }
    // Explicit override -> write it, don't listen for OS changes.
    if (explicitPref === true || explicitPref === false) {
      apply(explicitPref);
      return;
    }
    // Follow system live.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    apply(mq.matches);
    function onChange(e) { apply(e.matches); }
    mq.addEventListener("change", onChange);
    return function () { mq.removeEventListener("change", onChange); };
  }, [explicitPref]);

  return isDark;
}
