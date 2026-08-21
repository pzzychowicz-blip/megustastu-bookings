// src/hooks/useUserPrefs.js
//
// v17.6.0: PER-USER preferences — the 8th `settings` node, and the first one
// that is NOT restaurant-wide. Everything under `settings/*` until now was
// shared config (hours, layout, durations…); this node is keyed by the signed-in
// account's uid, so a user's setup follows them to any device instead of every
// device having to be configured by hand.
//
//   settings/users/{uid}/prefs      the object below
//   settings/users/{uid}/prefsRev   the revGuard CAS sibling
//
// This is the documented exception to CLAUDE.md's "only restaurant-wide config
// belongs in a settings node" rule — see the "Per-user preferences" section
// there before adding anything here.
//
// ── What syncs, and what deliberately does NOT ───────────────────────────────
// Syncs (Patryk's call): theme · reduceMotion · planGestures · navLocked ·
// splitEnabled — all judgements about how the app should behave.
//
// Stays per-device in localStorage: **app width** (a property of the monitor —
// a value that fits a 27" desktop overflows a tablet, and App already
// auto-picks from window.innerWidth on first use), the **four Timeline zoom
// values** (comfortable zoom depends on physical screen size) and the **saved
// split layout** (which two views + the divider ratio; the on/off master
// switch above does sync). Don't "finish the job" by moving these — they were
// excluded on purpose.
//
// ── Device fallback (the migration story) ────────────────────────────────────
// Each setting KEEPS its existing localStorage-backed useState initializer in
// App, so first paint and the signed-out shell are unchanged. Then:
//   • a field PRESENT in the node overrides local state on load;
//   • a field ABSENT is seeded from this device's current value and written up,
//     so an existing device's setup becomes that user's starting point rather
//     than being silently reset to defaults on first login.
// `null` is therefore meaningful here: it means "this user has never expressed
// a preference", which is why sanitize keeps nulls instead of coercing them to
// booleans. A sanitize that returned `false` for an absent field would wipe
// every device's settings on first login — the whole point of the fallback.
//
// ── localStorage stays, and it is load-bearing ───────────────────────────────
// App still mirrors every synced value to localStorage on write. index.html's
// no-flash script reads `mgt-theme` and `mgt-reduce-motion` BEFORE React mounts
// and long before Firebase or auth resolve; drop the mirror and every load
// flashes the wrong theme. localStorage is the pre-mount cache, the node is the
// source of truth.
//
// Write-guard/CAS shape mirrors useBookingDefaults exactly: `loaded` ref refuses
// writes until the initial read completes, revGuard rejects a stale device's
// overwrite server-side, and onValue passes dbError (a listener without one is
// a silent failure — see the Gotchas table).

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { dbError } from "../lib/dbError";

// `null` for every field = "never set by this user" (see the device-fallback
// note above). `v:1` is the presence marker — RTDB drops an all-null object,
// and the scalar keeps the node present once written (the priorities lesson).
export const DEFAULT_USER_PREFS = {
  v: 1,
  theme: null,          // "dark" | "light" | null (null = follow the OS)
  reduceMotion: null,   // boolean | null
  planGestures: null,   // boolean | null
  navLocked: null,      // boolean | null
  splitEnabled: null    // boolean | null
};

// ── v17.14.0: the four boolean prefs, described once ────────────────────────
// App had these written out three times each — a `useState` initializer reading
// localStorage, a toggle handler writing it, and a branch of the seeding effect
// doing both again — twelve near-identical blocks differing only in a key name
// and in which way round the default goes.
//
// `store` is that second difference, and it is the house convention rather than
// an accident: only the NON-DEFAULT value is ever written, so an absent key
// means the default. `"whenOn"` is the default-OFF shape (store "1" when true),
// `"whenOff"` the default-ON one (store "0" when false).
//
// `clears` is a second localStorage key to drop when the pref goes false —
// turning Split View off must also forget the saved split layout, or it comes
// back the moment the feature is re-enabled.
//
// `theme` is deliberately NOT here. It is a tri-state string with a `?theme=`
// override that must skip both the apply and the seed branches, and folding
// those into a table would hide the one pref whose special cases have bitten.
export const PREF_SPEC = {
  reduceMotion: { ls: "mgt-reduce-motion",  store: "whenOn"  },
  planGestures: { ls: "mgt-plan-gestures",  store: "whenOff" },
  navLocked:    { ls: "mgt-nav-lock",       store: "whenOn"  },
  splitEnabled: { ls: "mgt-split-enabled",  store: "whenOff", clears: "mgt-split" },
};
export const PREF_NAMES = Object.keys(PREF_SPEC);

// What a stored string means. Absent (null) is the default, which is the whole
// point of storing only the non-default value.
export function readPrefValue(store,raw){
  return store === "whenOn" ? raw === "1" : raw !== "0";
}
// What to store for a value: a string, or null meaning "remove the key".
export function prefLocalValue(store,v){
  return store === "whenOn" ? (v ? "1" : null) : (v ? null : "0");
}

// Tri-state: true / false / null. Anything that isn't a real boolean reads as
// null ("not set"), never as false — see the device-fallback note.
function triBool(v){
  return v === true ? true : v === false ? false : null;
}

export function sanitizeUserPrefs(raw){
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    v: 1,
    theme: src.theme === "dark" ? "dark" : src.theme === "light" ? "light" : null,
    reduceMotion: triBool(src.reduceMotion),
    planGestures: triBool(src.planGestures),
    navLocked: triBool(src.navLocked),
    splitEnabled: triBool(src.splitEnabled)
  };
}

export function useUserPrefs(uid){
  const [userPrefs, setUP] = useState(DEFAULT_USER_PREFS);
  // False until the first snapshot for THIS uid lands. App gates its
  // apply-the-server-values effect on this, so it can tell "no preferences yet"
  // (seed from the device) apart from "not loaded yet" (do nothing).
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const loaded = useRef(false);
  const revRef = useRef(0);
  // The node path is per-uid, so BOTH the rev subscription and the listener
  // must re-attach when the signed-in account changes.
  const path = uid ? "settings/users/" + uid + "/prefs" : null;

  useEffect(function(){
    if(!path) return undefined;
    return attachRev(path, revRef);
  }, [path]);

  useEffect(function(){
    // No uid: subscribe to nothing and stay unloaded, so saveUserPrefs refuses
    // and App's seeding effect never fires. Leaking a previous account's
    // preferences is not a risk here — App renders BookingApp with
    // `key={user.uid}`, so an account switch remounts the whole subtree and
    // this hook starts from DEFAULT_USER_PREFS again.
    if(!path) return undefined;
    loaded.current = false;
    const unsub = onValue(ref(db, path), function(snap){
      const val = snap.val();
      // An ABSENT node is not an error — it's a user who has never saved
      // preferences. App's seeding effect turns that into a write of whatever
      // this device already had.
      setUP(val && typeof val === "object" ? sanitizeUserPrefs(val) : DEFAULT_USER_PREFS);
      loaded.current = true;
      setPrefsLoaded(true);
    }, dbError(path));
    return unsub;
  }, [path]);

  // Guarded write. Accepts a PARTIAL update, merges with current state,
  // sanitizes, applies locally for a snappy UI, then writes the whole object
  // (the onValue echo re-applies the same values).
  function saveUserPrefs(partial){
    if(!path){
      console.warn("[SAFE] Refused to write user prefs — no signed-in uid.");
      return;
    }
    if(!loaded.current){
      console.warn("[SAFE] Refused to write user prefs — initial read has not completed yet.");
      return;
    }
    const next = sanitizeUserPrefs({ ...userPrefs, ...(partial || {}) });
    setUP(next);
    writeWithRev(path, next, revRef);
  }

  return { userPrefs, prefsLoaded, saveUserPrefs };
}
