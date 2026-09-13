// src/hooks/useVoucherDefaults.js
//
// v18.0.0 phase 1 — `settings/voucherDefaults`, the 9th settings node.
// A copy of `useBookingDefaults`'s shape: loaded ref, revGuard CAS
// (`voucherDefaultsRev`), `clampStep` sanitising.
//
// ── WHY THIS IS ITS OWN NODE AND NOT A FIELD ON settings/general ────────────
// Two reasons, and the first is Patryk's: a voucher setting should be edited
// where vouchers are, and storing it somewhere else invites the "why is this in
// General?" question forever. The second is that it will not stay at one field
// — value presets, code format, printed terms text and whether expiry blocks or
// merely warns all belong in the same place, and `settings/general` has the
// documented history of turning into a grab bag when config with no home lands
// there.
//
// **The name is `voucherDefaults`, not `vouchers`**, because `/vouchers` is
// already the collection. That is the repo's own precedent: `/bookings` has
// `settings/bookingDefaults` and deliberately not `settings/bookings`. Two paths
// a character apart, one holding records and one holding config, is a trap this
// codebase already declined once.
//
// Model: `{ v, expiryMonths }`. `v:1` is the presence marker — RTDB drops empty
// objects, the v15.9.0 priorities lesson.
//
// `expiryMonths: 0` means **never expires**, which is why the clamp floor is 0
// and not 1. It is a real position on the stepper rather than an accident: a
// restaurant may issue vouchers with no expiry, and `expiryFrom` already
// returns null for a non-positive month count.

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { clampStep } from "../lib/clamp";
import { dbError } from "../lib/dbError";
// v18.0.0 session 8: the activity log.
import { settingsWriteEntry } from "../lib/activity";
import { emitActivity } from "../lib/activitySink";

// 12 months is the plan's decision, and it is a SETTING rather than a rule
// precisely because the right answer is a legal question: Spanish consumer law
// may set a minimum validity for gift vouchers. The app enforces whatever this
// says, so a wrong guess costs one click to correct and never a release.
export const DEFAULT_VOUCHER_DEFAULTS = {
  v: 1,
  expiryMonths: 12,
};

export const EXPIRY_MIN = 0;    // 0 = never expires
export const EXPIRY_MAX = 60;   // five years — beyond any plausible voucher
export const EXPIRY_STEP = 1;

export function sanitizeVoucherDefaults(src) {
  const d = DEFAULT_VOUCHER_DEFAULTS;
  const s = src && typeof src === "object" ? src : {};
  return {
    v: 1,
    expiryMonths: clampStep(s.expiryMonths, d.expiryMonths, EXPIRY_MIN, EXPIRY_MAX, EXPIRY_STEP),
  };
}

export function useVoucherDefaults() {
  const [voucherDefaults, setVD] = useState(DEFAULT_VOUCHER_DEFAULTS);
  const loaded = useRef(false);
  const revRef = useRef(0);

  useEffect(function () { return attachRev("settings/voucherDefaults", revRef); }, []);

  useEffect(function () {
    const unsub = onValue(ref(db, "settings/voucherDefaults"), function (snap) {
      const val = snap.val();
      if (val && typeof val === "object") setVD(sanitizeVoucherDefaults(val));
      // Node absent (first run): keep the defaults.
      loaded.current = true;
    }, dbError("settings/voucherDefaults"));
    return unsub;
  }, []);

  function saveVoucherDefaults(partial) {
    if (!loaded.current) {
      console.warn("[SAFE] Refused to write voucher defaults — initial read has not completed yet.");
      return;
    }
    const prev = voucherDefaults;
    const next = sanitizeVoucherDefaults({ ...prev, ...(partial || {}) });
    setVD(next);
    writeWithRev("settings/voucherDefaults", next, revRef, undefined, function () {
      const entry = settingsWriteEntry("settings/voucherDefaults", prev, next);
      if (entry) emitActivity([entry]);
    });
  }

  return { voucherDefaults, saveVoucherDefaults };
}
