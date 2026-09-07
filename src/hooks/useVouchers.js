// src/hooks/useVouchers.js
//
// v18.0.0 phase 1 — the `/vouchers` collection: listener + guarded writes.
//
// This is the `/bookings` shape, not the `/waitlist` one, and the choice is
// forced by the data rather than preferred. `/vouchers/{CODE}` is a KEYED
// OBJECT whose key is the voucher number, so:
//
//   * uniqueness is a property of the storage — two devices issuing the same
//     number race on one path and the rules refuse the second;
//   * a per-child `updatedAt`/`baseUpdatedAt` CAS applies, exactly as it does
//     to `/bookings/$bid`, so a stale device is refused server-side whatever
//     its wall clock says;
//   * two devices touching DIFFERENT vouchers write disjoint paths and Firebase
//     merges them, instead of racing on one node.
//
// So the write is a multi-path `update()` of changed children, built by
// `lib/write-path.js` — which is already generic over "a list of things with
// ids". The only adaptation is that a voucher's id IS its code (`withId` /
// `stripId` below).
//
// ── WHAT THIS DELIBERATELY DOES NOT HAVE ─────────────────────────────────────
// The v15.2.0 client-side freshness gate and the v15.4.0 retry queue live in
// `usePersistence.js`, wired to that hook's heartbeat, and are NOT replicated
// here. Vouchers are low-contention (a handful of writes a week against
// bookings' constant traffic) and the protection that actually closed the
// 2026-07-05 incident is the SERVER-side CAS, which this node has in full. A
// refused write therefore surfaces as a banner the person who made it can act
// on, rather than being replayed silently — which for money is the better of
// the two behaviours anyway.
//
// ── AND WHAT IT HAS NO ROUTE TO AT ALL ───────────────────────────────────────
// There is NO delete. Not "there is no button for it" — there is no function.
// A voucher is VOIDED (`status: "void"`), which keeps the child, and therefore
// the key, and therefore the number, occupied forever. Deleting one would free
// its number for the generator to re-issue, which is the single thing the whole
// model exists to prevent. See the header of `lib/vouchers.js`.

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ref, onValue, update } from "firebase/database";
import { db } from "../firebase";
import { dbError, describeWriteError } from "../lib/dbError";
import { buildPatch, patchSignature, isDuplicatePatch } from "../lib/write-path";
import {
  normalizeCode, codeSet, validateIssue, applyRedemption,
  sanitizeVoucher, sanitizeVouchers, voucherIndex,
} from "../lib/vouchers";

// write-path.js keys everything off `id`; a voucher's identity is its code.
function withId(v) { return Object.assign({}, v, { id: v.code }); }
function stripId(v) { const c = Object.assign({}, v); delete c.id; return c; }

export function useVouchers({ setWriteWarning, userEmail }) {
  const [vouchers, setVouchers] = useState([]);
  const vouchersRef = useRef([]);          // mirror — see the updater-side-write gotcha
  const vouchersLoaded = useRef(false);
  const firstLoadCount = useRef(null);     // null until the first read lands
  const lastStampRef = useRef(0);
  const lastPatchSigRef = useRef(null);

  // ── The write path ──────────────────────────────────────────────────────────
  // Returns TRUE if a write was dispatched (or there was nothing to write) and
  // FALSE if it was refused, so a caller never flashes "saved" over a write that
  // never left the device — the v15.4.0 lesson, where `flash()` fired
  // unconditionally.
  //
  // Computed from the REF, then `setState` and the write as plain statements.
  // Firebase fires local listeners synchronously on a write, so a write inside a
  // setState updater lands its echo mid-update and StrictMode re-applies the
  // queued updater on the echo state. That is CLAUDE.md's own gotcha row and
  // v17.16.10 (CT-2A-09) removed the last exception to it.
  const saveVouchers = useCallback(function (next, isSilent) {
    if (!vouchersLoaded.current) {
      console.warn("[SAFE] Refused to write vouchers — initial read has not completed yet.");
      if (!isSilent) setWriteWarning("Refused to write: not connected to the server yet. If this persists, reload the page.");
      return false;
    }
    const prev = vouchersRef.current;
    const computed = (typeof next === "function") ? next(prev) : next;
    if (!Array.isArray(computed)) return false;

    // The mandatory empty-collection guard. A voucher list that has gone empty
    // would null every child — and a nulled child frees its number.
    if (computed.length === 0 && firstLoadCount.current !== null && firstLoadCount.current > 0) {
      console.warn("[SAFE] Refused to write an empty vouchers node.");
      if (!isSilent) setWriteWarning("Refused to write: that would have removed every voucher. Reload the page and try again.");
      return false;
    }

    vouchersRef.current = computed;
    setVouchers(computed);

    const built = buildPatch(prev.map(withId), computed.map(withId), lastStampRef.current, Date.now());
    lastStampRef.current = built.lastStamp;
    const ids = Object.keys(built.patch);
    if (!ids.length) return true; // nothing actually changed — no write to make

    const patch = {};
    ids.forEach(function (id) {
      // A null would be a deletion, and this hook has no route to one — see the
      // header. If the diff ever produces one it is a bug in a caller, so it is
      // dropped here rather than sent.
      if (built.patch[id] === null) {
        console.warn("[SAFE] Refused to delete voucher " + id + " — vouchers are voided, never deleted.");
        return;
      }
      patch[id] = stripId(built.patch[id]);
    });
    if (!Object.keys(patch).length) return true;

    // StrictMode's double-invoked dispatch: identical content + identical
    // consumed base within the window is the same write, and re-sending it
    // would be refused by the CAS.
    const sig = patchSignature(patch);
    const nowMs = Date.now();
    if (isDuplicatePatch(sig, lastPatchSigRef.current, nowMs)) return true;
    lastPatchSigRef.current = { sig: sig, at: nowMs };

    update(ref(db, "vouchers"), patch).catch(function (err) {
      console.warn(describeWriteError("vouchers", err));
      if (!isSilent) setWriteWarning("Couldn't save the voucher — this device's data was out of date. It has been refreshed; please redo the change.");
    });
    return true;
  }, [setWriteWarning]);

  // ── The listener ────────────────────────────────────────────────────────────
  useEffect(function () {
    // The third argument is not optional in this codebase: without it a failed
    // read fires NOTHING — no console line, no state change — which is how the
    // v17.5.1 tablet outage was misattributed for a whole release cycle.
    const unsub = onValue(ref(db, "vouchers"), function (snap) {
      const arr = sanitizeVouchers(snap.val());
      vouchersRef.current = arr;
      setVouchers(arr);
      if (firstLoadCount.current === null) firstLoadCount.current = arr.length;
      vouchersLoaded.current = true;
    }, dbError("vouchers"));
    return unsub;
  }, []);

  // ── Issuing ─────────────────────────────────────────────────────────────────
  // `code` blank → generate; filled → normalise and use it. One normaliser
  // serves both paths and every redemption lookup.
  //
  // Returns `{ ok, code, error }`. The three refusals are DISTINCT on purpose —
  // "that is not a usable number" and "that number is already in use" are
  // different failures and staff can act on the difference. A duplicate is
  // caught here from the loaded set AND, independently, by the create-only rule
  // server-side; this one is the fast, specific message, not the guarantee.
  const issueVoucher = useCallback(function ({ code, value, notes, expiresAt }) {
    // The decision is `validateIssue` in lib/vouchers.js — pure and tested,
    // because whether a number may be issued is logic the restaurant acts on.
    // This function is the dispatch around it.
    const v = validateIssue({ code: code, value: value, taken: codeSet(vouchersRef.current) });
    if (!v.ok) return v;

    const rec = sanitizeVoucher({
      code: v.code,
      value: v.value,
      remaining: v.value,
      notes: notes || "",
      status: "open",
      origin: v.origin,
      issuedAt: Date.now(),
      issuedBy: userEmail || "",
      expiresAt: expiresAt === undefined ? null : expiresAt,
      redemptions: {},
    }, v.code);

    const ok = saveVouchers(function (prev) {
      // Belt-and-braces against a replay landing on a code that arrived in the
      // meantime: filter first, so the concat can never duplicate a child.
      return prev.filter(function (x) { return x.code !== v.code; }).concat([rec]);
    });
    return ok ? { ok: true, code: v.code } : { ok: false, error: "Couldn't save the voucher." };
  }, [saveVouchers, userEmail]);

  // ── Redeeming ───────────────────────────────────────────────────────────────
  // The ledger is keyed by BOOKING, which is what makes this idempotent by
  // construction: a replay writes the same child with the same amount.
  //
  // `remaining` is RECOMPUTED from `value - redeemedTotal(ledger)` rather than
  // decremented, and that is the other half of the same property. A decrement
  // applied twice is wrong; a recompute applied twice gives the same answer. It
  // also means the balance can never silently disagree with the entries it is
  // supposed to be a total of.
  const redeemVoucher = useCallback(function (code, bookingId, amount) {
    const c = normalizeCode(code);
    if (!c || !bookingId) return false;
    const at = Date.now();
    return saveVouchers(function (prev) {
      return prev.map(function (v) {
        return v.code === c ? applyRedemption(v, bookingId, amount, at, userEmail || "") : v;
      });
    });
  }, [saveVouchers, userEmail]);

  // ── Voiding ─────────────────────────────────────────────────────────────────
  // `voidVoucher` is the closest thing to a delete that exists, and it is not
  // one: the child stays, so the number stays taken.
  //
  // /code-review v18.0.0: `unredeemVoucher` and `updateVoucher` lived here and
  // were called by nothing — two unreferenced WRITE paths into a money
  // collection, reading as supported operations while never having run against
  // the live database. Removed rather than wired up: giving them a caller would
  // be building a feature out of a review finding. The pure `removeRedemption`
  // stays in `lib/vouchers.js` with its tests, because it documents the inverse
  // property; what went is the write wrapper. See ROADMAP for the open question
  // it leaves — what should happen to the ledger when a completed booking is
  // walked back.
  const voidVoucher = useCallback(function (code, on) {
    const c = normalizeCode(code);
    if (!c) return false;
    return saveVouchers(function (prev) {
      return prev.map(function (v) {
        return v.code === c ? sanitizeVoucher(Object.assign({}, v, { status: on === false ? "open" : "void" }), c) : v;
      });
    });
  }, [saveVouchers]);

  // Memoised: a fresh object every render would defeat every downstream
  // React.memo it is passed to — the identity-only-props rule that `hoursSig`
  // and `layoutSig` exist for.
  const vouchersByCode = useMemo(function () { return voucherIndex(vouchers); }, [vouchers]);

  return {
    vouchers,
    vouchersByCode,
    vouchersLoaded: vouchersLoaded,
    issueVoucher,
    redeemVoucher,
    voidVoucher,
  };
}
