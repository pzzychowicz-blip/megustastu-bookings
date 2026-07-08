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
//       notes, active, skipDates:[…ISO dates…], createdAt
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

const DEFAULT_RECURRING = { v: 1, enabled: true, horizonWeeks: 4, rules: [] };

function clampInt(n, def, min, max) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

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
    createdAt: Number(r.createdAt) || Date.now()
  };
}

function sanitizeRecurring(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    v: 1,
    enabled: src.enabled !== false,
    horizonWeeks: clampInt(src.horizonWeeks, 4, 1, 12),
    rules: Array.isArray(src.rules) ? src.rules.map(sanitizeRule).filter(Boolean) : []
  };
}

export function useRecurring({ setWriteWarning }) {
  const [recurring, setRecurring] = useState(DEFAULT_RECURRING);
  const recurringRef = useRef(DEFAULT_RECURRING);   // mirror for updater-free saves
  const loaded = useRef(false);
  const revRef = useRef(0);

  function saveRecurring(next, isSilent) {
    if (!loaded.current) {
      console.warn("[SAFE] Refused to write recurring — initial read has not completed yet.");
      if (!isSilent) setWriteWarning("Refused to write: Firebase not yet connected. If this persists, reload the page.");
      return;
    }
    const computed = sanitizeRecurring(typeof next === "function" ? next(recurringRef.current) : next);
    recurringRef.current = computed;
    setRecurring(computed);
    writeWithRev("recurring", computed, revRef, function () {
      if (!isSilent) setWriteWarning("Couldn't save — this device's data was out of date and has been refreshed. Please redo the change.");
    });
  }

  useEffect(function () {
    const unsub = onValue(ref(db, "recurring"), function (snap) {
      const val = snap.val();
      const next = sanitizeRecurring(val);
      recurringRef.current = next;
      setRecurring(next);
      loaded.current = true;
    });
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
  function addSkipDate(id, date, isSilent) {
    saveRecurring(function (prev) {
      return Object.assign({}, prev, { rules: prev.rules.map(function (r) {
        if (r.id !== id) return r;
        if ((r.skipDates || []).indexOf(date) !== -1) return r;
        return Object.assign({}, r, { skipDates: (r.skipDates || []).concat([date]) });
      }) });
    }, isSilent);
  }
  function setEnabled(on) { saveRecurring(function (prev) { return Object.assign({}, prev, { enabled: !!on }); }); }
  function setHorizon(weeks) { saveRecurring(function (prev) { return Object.assign({}, prev, { horizonWeeks: clampInt(weeks, 4, 1, 12) }); }); }

  return { recurring, saveRecurring, addRule, updateRule, removeRule, addSkipDate, setEnabled, setHorizon };
}
