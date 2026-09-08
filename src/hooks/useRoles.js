// src/hooks/useRoles.js
//
// v18.0.0 phase 3 — `/roles` + `/invites`, and the one question the rest of the
// app asks: `can("bookingDelete")`.
//
// Two keyed collections, so this is the `/vouchers` shape rather than the
// `/waitlist` one, and for the same reason: two admins editing DIFFERENT
// people write disjoint paths and Firebase merges them, while a per-child
// `updatedAt`/`baseUpdatedAt` CAS refuses a stale device whatever its clock
// says. Both go through `lib/write-path.js`, which is already generic over "a
// list of things with ids".
//
// ── `enforceRoles` LIVES HERE, not in a hook of its own ─────────────────────
// `settings/admin` is a ninth settings node with the standard rev pair, and it
// would normally get a `useAdminSettings.js` beside the other eight. It does
// not, because `can()` is meaningless without the flag and the flag is
// meaningless without `can()` — splitting them would mean every consumer wiring
// two hooks together in the right order to ask one question. One hook returns
// one answer.
//
// ── WHAT THE SERVER ENFORCES, AND WHAT THIS ONLY HIDES ──────────────────────
// SEVEN capabilities are refused by the rules as well (`RULE_ENFORCED` in
// lib/roles.js): `settingsAdmin`, `settingsWrite`, `bookingDelete`, and the
// four v18.0.0 phase 3 added — `reminderManage`, `recurringManage`,
// `hoursEdit`, `layoutEdit`. Every other gate in this app is a UI gate — it covers the real threat, which is a
// member of staff tapping the wrong thing, and it is not a security boundary.
// The Admin tab prints that distinction on screen rather than implying a
// guarantee it does not have.
//
// ── THE FIRST ADMIN CANNOT BE MADE HERE ─────────────────────────────────────
// With `/roles` empty nobody holds `settingsAdmin`, and `settingsAdmin` is what
// the rules require to write `/roles` — so the bootstrap is a Firebase console
// step, documented in `database.rules.README.md`. A "first user becomes admin"
// rule is tempting and is a hole the moment the node is ever emptied.

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ref, onValue, update } from "firebase/database";
import { db } from "../firebase";
import { dbError, describeWriteError } from "../lib/dbError";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { buildPatch, patchSignature, isDuplicatePatch } from "../lib/write-path";
import {
  can as canFor, isAdminEntry, levelGrants, sanitizeRole, sanitizeRoles,
  sanitizeInvite, sanitizeInvites, normalizeEmail, wouldRemoveOwnAdmin,
  applyInviteFields, userRows,
} from "../lib/roles";
import { sanitizeModules, withModule, moduleOn, DEFAULT_MODULES } from "../lib/modules";

// The flag's node. `v` is the presence marker every settings node carries —
// RTDB drops an all-default object, and the scalar keeps the node present once
// written (the priorities lesson).
export const DEFAULT_ADMIN_SETTINGS = { v: 1, enforceRoles: false, modules: DEFAULT_MODULES };

export function sanitizeAdminSettings(s) {
  const src = s && typeof s === "object" ? s : {};
  return {
    v: 1,
    // `=== true` and not a truthiness test, because this is the same predicate
    // the RULES use (`.val() !== true`). A client that read `"false"` as on
    // while the server read it as off would hide controls the database was
    // still accepting — the disagreement this whole phase exists to prevent.
    enforceRoles: src.enforceRoles === true,
    // v18.0.0 phase 4. A new FIELD on an existing node, so there is no rules
    // change: `settings/admin` is already admin-only to write, unconditionally,
    // and carries no `.validate`. A new NODE would have needed both a CAS and
    // its own `.write` grant (CLAUDE.md's rule of law) — which is the reason
    // the registry lives here and not at `/modules`.
    //
    // NOTE `sanitizeModules` resolves each module through its own
    // `defaultEnabled` rather than to `false`, so the node written before a
    // module existed reads that module at its default. Absent `modules`
    // entirely — the production state on the day this deploys — is every module
    // at its default, which is the shipped behaviour unchanged.
    modules: sanitizeModules(src.modules),
  };
}

// write-path.js keys everything off `id`; a role row's identity is its uid.
function roleWithId(r) { return Object.assign({}, r, { id: r.uid }); }
function stripId(x) { const c = Object.assign({}, x); delete c.id; return c; }

export function useRoles({ uid, userEmail, setWriteWarning }) {
  const [roles, setRoles] = useState([]);
  const [invites, setInvites] = useState([]);
  const [adminSettings, setAdminSettings] = useState(DEFAULT_ADMIN_SETTINGS);
  const rolesRef = useRef([]);        // mirrors — see the updater-side-write gotcha
  const invitesRef = useRef([]);
  const rolesLoaded = useRef(false);
  const invitesLoaded = useRef(false);
  const adminLoaded = useRef(false);
  const adminRef = useRef(DEFAULT_ADMIN_SETTINGS);   // mirror — see `writeAdmin`
  const adminRevRef = useRef(0);
  const lastStampRef = useRef(0);
  const lastPatchSigRef = useRef(null);
  const [ready, setReady] = useState(false);

  // ── The write path, shared by both collections ────────────────────────────
  // Computed from the REF, then `setState` and the write as PLAIN STATEMENTS.
  // Firebase fires local listeners synchronously on a write, so a write inside
  // a setState updater lands its echo mid-update and StrictMode re-applies the
  // queued updater on the echo state — CLAUDE.md's own gotcha row, whose last
  // exception v17.16.10 removed.
  //
  // Returns TRUE if a write was dispatched (or there was nothing to write) so a
  // caller never reports success over a write that never left the device.
  const saveKeyed = useCallback(function (node, mirrorRef, setter, loadedRef, next) {
    if (!loadedRef.current) {
      console.warn("[SAFE] Refused to write " + node + " — initial read has not completed yet.");
      setWriteWarning("Refused to write: not connected to the server yet. If this persists, reload the page.");
      return false;
    }
    const prev = mirrorRef.current;
    const computed = (typeof next === "function") ? next(prev) : next;
    if (!Array.isArray(computed)) return false;

    // NO empty-collection guard here, and that is deliberate rather than an
    // omission. `/roles` legitimately reaches zero rows — it starts there, and
    // an admin removing the last invited person is an ordinary action. The
    // guard exists on `bookings` and `vouchers` because an empty write there
    // destroys records that cannot be reconstructed; a role row is one line an
    // admin retypes. What protects this node is the per-child CAS plus the
    // rule that an admin cannot remove their own admin.
    mirrorRef.current = computed;
    setter(computed);

    const built = buildPatch(prev.map(roleWithId), computed.map(roleWithId), lastStampRef.current, Date.now());
    lastStampRef.current = built.lastStamp;
    const ids = Object.keys(built.patch);
    if (!ids.length) return true;

    const patch = {};
    ids.forEach(function (id) {
      patch[id] = built.patch[id] === null ? null : stripId(built.patch[id]);
    });

    // StrictMode's double-invoked dispatch: identical content AND identical
    // consumed base within the window is the same write, and re-sending it
    // would be refused by the CAS.
    const sig = patchSignature(patch);
    const nowMs = Date.now();
    if (isDuplicatePatch(sig, lastPatchSigRef.current, nowMs)) return true;
    lastPatchSigRef.current = { sig: sig, at: nowMs };

    update(ref(db, node), patch).catch(function (err) {
      console.warn(describeWriteError(node, err));
      setWriteWarning("Couldn't save that change — this device's data was out of date, or you do not have permission. Please reload and try again.");
    });
    return true;
  }, [setWriteWarning]);

  const saveRoles = useCallback(function (next) {
    return saveKeyed("roles", rolesRef, setRoles, rolesLoaded, next);
  }, [saveKeyed]);

  const saveInvites = useCallback(function (next) {
    return saveKeyed("invites", invitesRef, setInvites, invitesLoaded, next);
  }, [saveKeyed]);

  // ── Listeners ─────────────────────────────────────────────────────────────
  // The third argument is not optional in this codebase: without it a failed
  // read fires NOTHING — no console line, no state change — which is how the
  // v17.5.1 tablet outage was misattributed for a whole release cycle.
  useEffect(function () {
    const unsub = onValue(ref(db, "roles"), function (snap) {
      const arr = sanitizeRoles(snap.val());
      rolesRef.current = arr;
      setRoles(arr);
      rolesLoaded.current = true;
      setReady(true);
    }, dbError("roles"));
    return unsub;
  }, []);

  useEffect(function () {
    const unsub = onValue(ref(db, "invites"), function (snap) {
      const arr = sanitizeInvites(snap.val());
      invitesRef.current = arr;
      setInvites(arr);
      invitesLoaded.current = true;
    }, dbError("invites"));
    return unsub;
  }, []);

  useEffect(function () { return attachRev("settings/admin", adminRevRef); }, []);

  useEffect(function () {
    const unsub = onValue(ref(db, "settings/admin"), function (snap) {
      const val = snap.val();
      // Node ABSENT is the production state on the day this deploys, and it
      // must read as OFF — the same thing `.val() !== true` does in the rules.
      const next = val && typeof val === "object" ? sanitizeAdminSettings(val) : DEFAULT_ADMIN_SETTINGS;
      // The mirror is assigned on the line ABOVE its setState, which is the
      // invariant every mirrored writer in this app depends on: a set site that
      // forgets it hands the next `writeAdmin` a stale base, and since that
      // write is a whole-node replace the staleness would not be a skipped
      // field — it would be the OTHER switch reverting.
      adminRef.current = next;
      setAdminSettings(next);
      adminLoaded.current = true;
    }, dbError("settings/admin"));
    return unsub;
  }, []);

  // ── The one gate ──────────────────────────────────────────────────────────
  const myEntry = useMemo(function () {
    return roles.find(function (r) { return r.uid === uid; }) || null;
  }, [roles, uid]);

  const enforceRoles = adminSettings.enforceRoles;

  // Memoised on the two things it reads, so a consumer can put `can` in a dep
  // array and a `React.memo`'d view that takes it as a prop is not defeated on
  // every render — the identity-only-props rule `hoursSig` exists for.
  const can = useCallback(function (cap) {
    return canFor(myEntry, cap, enforceRoles);
  }, [myEntry, enforceRoles]);

  const isAdmin = useMemo(function () { return isAdminEntry(myEntry); }, [myEntry]);

  const rows = useMemo(function () { return userRows(roles, invites); }, [roles, invites]);

  // ── Writing a role ────────────────────────────────────────────────────────
  // `fields` is a partial merged onto the stored row, so a caller changes a
  // level without having to restate a person's extras.
  //
  // The last-admin refusal is checked HERE as well as in the rules, and the two
  // ask the identical question through `wouldRemoveOwnAdmin` rather than two
  // predicates that merely agree today. A client-only check would be a
  // suggestion; a rule-only one would let the panel offer a control that fails.
  const setRole = useCallback(function (targetUid, fields) {
    if (!targetUid) return { ok: false, error: "No user." };
    const stored = rolesRef.current.find(function (r) { return r.uid === targetUid; }) || null;
    const merged = sanitizeRole(Object.assign({}, stored, fields, { uid: targetUid }), targetUid);
    if (wouldRemoveOwnAdmin(uid, targetUid, stored, merged)) {
      return { ok: false, error: "You can't remove your own admin access — ask another admin to do it." };
    }
    const ok = saveRoles(function (prev) {
      return prev.map(function (r) { return r.uid === targetUid ? merged : r; })
        .concat(stored ? [] : [merged]);
    });
    return ok ? { ok: true } : { ok: false, error: "Couldn't save that change." };
  }, [saveRoles, uid]);

  // Ticking one cell in the capability grid. `on` is the QUESTION THE SCREEN
  // ASKS — "should this person have this capability?" — never which map to
  // write. That decision is made here, from the person's level, and it is the
  // whole reason a deny and an extra can never both be set for one capability:
  //
  //   the level grants it   → `on` clears a deny,  `!on` writes one
  //   the level does not    → `on` writes an extra, `!on` clears it
  //
  // Both maps are rewritten on every tick, so a row that somehow acquired both
  // (a console edit, a row written before this shipped) is repaired by the next
  // tick rather than carrying a contradiction the reader cannot see. It still
  // writes only `/roles/{uid}` — never the role map, which is a constant in
  // code for the reason at the top of `lib/roles.js`.
  const setCapability = useCallback(function (targetUid, cap, on) {
    const stored = rolesRef.current.find(function (r) { return r.uid === targetUid; }) || null;
    if (!stored) return { ok: false, error: "That person has not signed in yet." };
    const extras = Object.assign({}, stored.extras);
    const denies = Object.assign({}, stored.denies);
    delete extras[cap];
    delete denies[cap];
    if (levelGrants(stored.role, cap)) {
      if (!on) denies[cap] = true;
    } else if (on) {
      extras[cap] = true;
    }
    return setRole(targetUid, { extras: extras, denies: denies });
  }, [setRole]);

  const removeUser = useCallback(function (targetUid) {
    const stored = rolesRef.current.find(function (r) { return r.uid === targetUid; }) || null;
    if (!stored) return { ok: false, error: "No such user." };
    if (wouldRemoveOwnAdmin(uid, targetUid, stored, null)) {
      return { ok: false, error: "You can't remove your own admin access — ask another admin to do it." };
    }
    const ok = saveRoles(function (prev) {
      return prev.filter(function (r) { return r.uid !== targetUid; });
    });
    return ok ? { ok: true } : { ok: false, error: "Couldn't remove that person." };
  }, [saveRoles, uid]);

  // ── Invitations ───────────────────────────────────────────────────────────
  // The id is derived from the EMAIL, not minted at random, so two admins
  // inviting the same person concurrently write the same path and the second is
  // refused by the CAS instead of creating a duplicate row. Same reasoning as
  // the deterministic recurring-occurrence ids.
  const inviteUser = useCallback(function (email, role, extras) {
    const e = normalizeEmail(email);
    if (!e || e.indexOf("@") < 0) return { ok: false, error: "Enter an email address." };
    if (rolesRef.current.some(function (r) { return normalizeEmail(r.email) === e; })) {
      return { ok: false, error: "That person already has an account here." };
    }
    const rec = sanitizeInvite({
      email: e, role: role, extras: extras || {},
      createdAt: Date.now(), createdBy: userEmail || "",
    }, inviteIdFor(e));
    const ok = saveInvites(function (prev) {
      return prev.filter(function (i) { return i.id !== rec.id; }).concat([rec]);
    });
    return ok ? { ok: true } : { ok: false, error: "Couldn't send that invitation." };
  }, [saveInvites, userEmail]);

  const withdrawInvite = useCallback(function (inviteId) {
    return saveInvites(function (prev) {
      return prev.filter(function (i) { return i.id !== inviteId; });
    });
  }, [saveInvites]);

  // An admin's one tap: put the invitation's level onto the stub, and withdraw
  // the invitation. TWO collections, so two writes — they cannot be one atomic
  // patch, and the ORDER matters: apply first, withdraw second. If the second
  // fails the invitation simply shows again, which is a re-tap; the other order
  // would lose the invitation with nothing applied.
  const applyInvite = useCallback(function (targetUid, invite) {
    const res = setRole(targetUid, applyInviteFields(invite));
    if (res.ok) withdrawInvite(invite.id);
    return res;
  }, [setRole, withdrawInvite]);

  // ── Self-registration ─────────────────────────────────────────────────────
  // Fires once, on first sign-in, and writes a row that grants NOTHING: the
  // rules refuse a stub carrying a `role` or any `extras`. Its whole purpose is
  // to make the account visible in the panel so an admin can act on it.
  //
  // Guarded on `ready` so it cannot race the initial read and write a duplicate
  // — and idempotent anyway, because the rule requires `!data.exists()`.
  useEffect(function () {
    if (!ready || !uid || !userEmail) return;
    if (rolesRef.current.some(function (r) { return r.uid === uid; })) return;
    const stub = sanitizeRole({
      uid: uid, email: userEmail, name: "",
      addedAt: Date.now(), addedBy: uid,
    }, uid);
    // NOTE the stub carries neither `extras` nor `denies`: `sanitizeRole`
    // returns `{}` for both and RTDB drops an empty object, so the child is
    // absent — which is exactly what the self-registration rule requires
    // (`extras === null`). A stub that arrived carrying either map would be
    // refused, and it would deserve to be: that is the self-promotion hole.
    // Written straight rather than through `saveRoles`: the diff-write would
    // work, but a refusal here is EXPECTED and routine (the row exists on every
    // sign-in after the first, and the rule refuses a second write), and
    // routing it through the shared path would raise the red banner for it.
    const stamped = Object.assign({}, stub, { updatedAt: Date.now(), baseUpdatedAt: 0 });
    delete stamped.id;
    update(ref(db, "roles"), { [uid]: stamped }).catch(function () {
      /* Already registered, or not permitted — both are ordinary. */
    });
  }, [ready, uid, userEmail]);

  // ── Writing the node ──────────────────────────────────────────────────────
  // `settings/admin` is a WHOLE-NODE write under the rev CAS, so every writer
  // must send the whole node — and v18.0.0 phase 4 is where that stopped being
  // free. `setEnforceRoles` used to build its payload from its own argument
  // alone (`sanitizeAdminSettings({ enforceRoles: on })`), which was correct
  // while the node held one field and would have SILENTLY RESET `modules` to
  // its defaults on the next toggle of an unrelated switch. So both writers go
  // through here, and the payload is a MERGE onto what is stored.
  //
  // The mirror is `adminRef` rather than the `adminSettings` state, for the
  // reason every other writer in this app reads a ref: two switches tapped in
  // one render would both build on the same stale value and the second would
  // undo the first.
  const writeAdmin = useCallback(function (fields, failMsg) {
    if (!adminLoaded.current) {
      console.warn("[SAFE] Refused to write settings/admin — initial read has not completed yet.");
      return false;
    }
    const next = sanitizeAdminSettings(Object.assign({}, adminRef.current, fields));
    adminRef.current = next;
    setAdminSettings(next);
    writeWithRev("settings/admin", next, adminRevRef, function () {
      setWriteWarning(failMsg);
    });
    return true;
  }, [setWriteWarning]);

  // ── The enforcement flag ──────────────────────────────────────────────────
  const setEnforceRoles = useCallback(function (on) {
    return writeAdmin({ enforceRoles: on },
      "Couldn't change role enforcement — you may not have permission, or another device changed it first.");
  }, [writeAdmin]);

  // ── The module registry ───────────────────────────────────────────────────
  // `withModule` applies one switch to the stored map, so an admin turning
  // WhatsApp on does not restate what vouchers is set to.
  const setModuleEnabled = useCallback(function (id, on) {
    return writeAdmin({ modules: withModule(adminRef.current.modules, id, on) },
      "Couldn't change that module — you may not have permission, or another device changed it first.");
  }, [writeAdmin]);

  // The gate the app asks, shaped like `can` for the same reason: memoised on
  // the one thing it reads, so a `React.memo`'d view taking it as a prop is not
  // defeated on every render.
  const modules = adminSettings.modules;
  const hasModule = useCallback(function (id) {
    return moduleOn(modules, id);
  }, [modules]);

  return {
    can, isAdmin, myEntry, enforceRoles, setEnforceRoles,
    modules, hasModule, setModuleEnabled,
    roles, invites, rows, rolesReady: ready,
    setRole, setCapability, removeUser, inviteUser, withdrawInvite, applyInvite,
  };
}

// An RTDB key may not contain `.` `$` `#` `[` `]` `/`, and an email contains a
// dot in every real case — so the address is encoded rather than used raw.
// Deterministic, which is the point: the same address always names the same
// invitation path.
export function inviteIdFor(email) {
  return "e_" + normalizeEmail(email).replace(/[.$#[\]/@]/g, "_");
}
