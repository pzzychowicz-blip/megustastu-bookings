// src/hooks/useRecurring.js
//
// v16.3.0 — Recurring / standing bookings. The 7th persisted collection,
// Firebase node `recurring` (a whole-node OBJECT, not an array), guarded by the
// revGuard CAS (`recurringRev`) per the v16.0.0 "rule of law" for new nodes.
// Cloned from useWaitlist's shape (loaded-ref write-guard + ref-mirror save —
// set() OUTSIDE the updater, the sync-echo gotcha).
//
// Node shape:
//   { v:1, enabled:true, horizonWeeks:4, rules:[ {
//       id, name, phone, size, weekday(0-6, UTC getUTCDay), time, preference,
//       notes, active, skipDates:[…ISO dates…], createdAt, startDate?
//   } … ] }
// `v:1` is the presence marker (RTDB drops empty objects — the priorities
// lesson). `enabled` is the master switch (the generator no-ops when false).
// Per-rule `active` pauses one rule. `skipDates` are occurrence dates the staff
// deleted — the generator must never regenerate them.
//
// Occurrences are NOT stored here — they are normal /bookings/{id} children
// stamped with recurringId + recurringDate, created by the generator effect in
// BookingApp (idempotent, cross-device-safe via the per-$id updatedAt CAS).

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { genId } from "../lib/booking-logic";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { dbError } from "../lib/dbError";
// v18.0.0 session 8: the activity log.
import { settingsWriteEntry } from "../lib/activity";
import { emitActivity } from "../lib/activitySink";

// v16.3.0 correction: standing bookings default OFF — the feature (and the
// booking-form "Repeat weekly" toggle) stays hidden until staff enable it in
// Settings. Absent/legacy node ⇒ off (sanitize requires `enabled === true`).
const DEFAULT_RECURRING = { v: 1, enabled: false, horizonWeeks: 4, rules: [] };

function clampInt(n, def, min, max) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeRule(r) {
  if (!r || typeof r !== "object") return null;
  return {
    id: r.id || genId(),
    name: r.name || "",
    phone: r.phone || "",
    size: clampInt(r.size, 2, 1, 40),
    weekday: clampInt(r.weekday, 0, 0, 6),
    time: r.time || "20:00",
    preference: r.preference || "auto",
    notes: r.notes || "",
    active: r.active !== false,
    skipDates: Array.isArray(r.skipDates) ? r.skipDates.filter(Boolean) : [],
    createdAt: Number(r.createdAt) || Date.now(),
    // v18.3.3: the first date the rule books (the date "Repeat weekly" was
    // ticked on). Absent on older rules, which `ruleStart` (lib/recurring.js)
    // derives from their first booking instead. A whitelist, so it must be
    // listed here or the next write to `recurring` deletes it.
    ...(ISO_DAY.test(r.startDate || "") ? { startDate: r.startDate } : {})
  };
}

function sanitizeRecurring(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    v: 1,
    enabled: src.enabled === true,
    horizonWeeks: clampInt(src.horizonWeeks, 4, 1, 12),
    rules: Array.isArray(src.rules) ? src.rules.map(sanitizeRule).filter(Boolean) : []
  };
}

// v18.6.0 round 2: how often a refused rule removal is tried again, and the
// wait before the first retry (the second waits twice that, the third three
// times: 300, 600, 900 ms).
export const REMOVE_RETRIES = 3;
export const REMOVE_RETRY_MS = 300;

export function useRecurring({ setWriteWarning }) {
  const [recurring, setRecurring] = useState(DEFAULT_RECURRING);
  const recurringRef = useRef(DEFAULT_RECURRING);   // mirror for updater-free saves
  const loaded = useRef(false);
  const revRef = useRef(0);
  // v18.6.0 /code-review: false once the hook has unmounted (a sign-out or an
  // account switch), so `removeRules`' retry timer does not write from a dead
  // closure. Set inside the effect, not by the initializer (the StrictMode
  // mounted-ref lesson).
  const alive = useRef(false);
  useEffect(function () { alive.current = true; return function () { alive.current = false; }; }, []);

  // Returns true when the write was dispatched, false when refused by the
  // loaded-guard (/code-review: delBooking gates a recurring-occurrence delete
  // on addSkipDate's success so the generator can never resurrect it).
  // v18.6.0: `onRefused`, when given, hears a server refusal INSTEAD of the
  // banner (`removeRules` retries with it and lets the last attempt fall
  // through to the banner).
  function saveRecurring(next, isSilent, onRefused) {
    if (!loaded.current) {
      console.warn("[SAFE] Refused to write recurring — initial read has not completed yet.");
      if (!isSilent) setWriteWarning("Refused to write: not connected to the server yet. If this persists, reload the page.");
      return false;
    }
    // Captured ABOVE the mirror assignment below — one line later and `prev`
    // and `computed` are the same object.
    const prev = recurringRef.current;
    const computed = sanitizeRecurring(typeof next === "function" ? next(prev) : next);
    recurringRef.current = computed;
    setRecurring(computed);
    writeWithRev("recurring", computed, revRef, function () {
      if (onRefused) { onRefused(); return; }
      if (!isSilent) setWriteWarning("Couldn't save — this device's data was out of date and has been refreshed. Please redo the change.");
    }, function () {
      const entry = settingsWriteEntry("recurring", prev, computed, { auto: isSilent === true });
      if (entry) emitActivity([entry]);
    });
    return true;
  }

  useEffect(function () {
    const unsub = onValue(ref(db, "recurring"), function (snap) {
      const val = snap.val();
      const next = sanitizeRecurring(val);
      recurringRef.current = next;
      setRecurring(next);
      loaded.current = true;
    },dbError("recurring"));
    return unsub;
  }, []);
  useEffect(function () { return attachRev("recurring", revRef); }, []);

  // ── CRUD ────────────────────────────────────────────────────────────────────
  function addRule(fields) {
    const rule = sanitizeRule(Object.assign({ id: genId(), createdAt: Date.now(), active: true, skipDates: [] }, fields));
    saveRecurring(function (prev) { return Object.assign({}, prev, { rules: prev.rules.concat([rule]) }); });
    return rule;
  }
  function updateRule(id, patch) {
    saveRecurring(function (prev) {
      return Object.assign({}, prev, { rules: prev.rules.map(function (r) { return r.id === id ? Object.assign({}, r, patch) : r; }) });
    });
  }
  function removeRule(id) {
    saveRecurring(function (prev) { return Object.assign({}, prev, { rules: prev.rules.filter(function (r) { return r.id !== id; }) }); });
  }
  // v18.5.1: several at once, in one write, and the answer returned. v18.6.0:
  // Delete customer calls it once the anonymise has landed (it pauses them
  // first, `setRulesActive` below).
  //
  // v18.6.0 round 2: a refused removal is tried again, by itself (Patryk,
  // 2026-10-10). By then the customer's bookings are anonymised, so a rule left
  // behind is a paused rule still holding the name and the phone, and the
  // banner's "redo the change" had nothing to redo it with but Settings.
  // Reproduced on DEV with one removal sent on a stale rev: the rule came back
  // paused 58 ms after the write, and stayed. The refusal means another device
  // wrote `recurring` in the same moment; the SDK has rolled the mirror and the
  // rev back by the time the refusal is heard (measured: the echo 1 ms before
  // it), and the wait covers the case where it has not, in which the retry is
  // refused again and counts as a try. After `REMOVE_RETRIES` the banner, as
  // before. A page closed in between leaves the paused rule (ROADMAP).
  function removeRules(ids) { return removeAttempt(ids, 0); }
  function removeAttempt(ids, n) {
    return saveRecurring(function (prev) {
      return Object.assign({}, prev, { rules: prev.rules.filter(function (r) { return ids.indexOf(r.id) === -1; }) });
    }, false, n >= REMOVE_RETRIES ? undefined : function () {
      setTimeout(function () { if (alive.current) removeAttempt(ids, n + 1); }, REMOVE_RETRY_MS * (n + 1));
    });
  }
  // v18.6.0: several rules paused or resumed in one write, and the answer
  // returned. Delete customer pauses the guest's rules before it anonymises
  // their bookings and removes them only once that write has landed
  // (`planCustomerDelete`, lib/delete-undo.js).
  function setRulesActive(ids, active) {
    return saveRecurring(function (prev) {
      return Object.assign({}, prev, { rules: prev.rules.map(function (r) { return ids.indexOf(r.id) === -1 ? r : Object.assign({}, r, { active: !!active }); }) });
    });
  }
  function addSkipDate(id, date, isSilent) {
    return saveRecurring(function (prev) {
      return Object.assign({}, prev, { rules: prev.rules.map(function (r) {
        if (r.id !== id) return r;
        if ((r.skipDates || []).indexOf(date) !== -1) return r;
        return Object.assign({}, r, { skipDates: (r.skipDates || []).concat([date]) });
      }) });
    }, isSilent);
  }
  function setEnabled(on) { saveRecurring(function (prev) { return Object.assign({}, prev, { enabled: !!on }); }); }
  function setHorizon(weeks) { saveRecurring(function (prev) { return Object.assign({}, prev, { horizonWeeks: clampInt(weeks, 4, 1, 12) }); }); }

  return { recurring, saveRecurring, addRule, updateRule, removeRule, removeRules, setRulesActive, addSkipDate, setEnabled, setHorizon };
}
