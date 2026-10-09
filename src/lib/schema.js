// src/lib/schema.js
//
// v18.6.0 — the minimum schema gate.
//
// Every read in this app goes through a whitelist (`sanitize` for a booking,
// `sanitizeRule`, `sanitizeVoucher`, the settings hooks' own), and every write
// replaces the child or the node whole. So a device still running an older
// build DELETES any field a newer build added, on its next write to that
// record: a v18.4.10 device dropped `tags`, `guestTags` and `guestTagsAt`
// (measured on that version's own code, v18.5.0's /code-review), and v18.3.3
// had the same shape with a rule's `startDate`. The only defence was a deploy
// step, "refresh every device".
//
// The gate makes that step enforced. `SCHEMA` is this build's number. The
// database stores the highest number any build has announced (`/schema`, with
// its rev pair). A build that reads a HIGHER number than its own refuses every
// write it would whitelist (bookings, the rev-paired nodes, vouchers, roles
// and invites) and shows the "refresh this device" card until it is reloaded.
//
// RAISE `SCHEMA` BY ONE in the same commit as any change to what is stored:
// a new per-booking field, a new key in a rule, a voucher or a settings node,
// or a key removed. `tests/schema.test.js` pins the stored keys to the number
// and fails until both move together. Do NOT raise it for a release that
// stores nothing new: every device on the previous build stops writing the
// moment the first refreshed device announces the number.
//
// What it cannot do: protect against builds from BEFORE v18.6.0, which do not
// read the number. The release after this one is the first it covers.
//
// A rollback locks everyone out: if a build that announced N is reverted, the
// builds at N-1 refuse to write until `/schema` is lowered by hand in the
// Firebase console (the rule refuses a lower number from any client).
//
// A VERCEL PREVIEW NEVER ANNOUNCES (v18.6.0 /code-review). A preview of a pull
// request is a production build on the restaurant's PROD database. Announcing
// from one would raise the number for a build that is not merged: every device
// in the restaurant would stop writing the moment somebody signed in to the
// preview, and stay stopped until the merge and a refresh (or a console edit,
// if the branch were dropped). A preview still READS the number and is blocked
// by a higher one like any build. `mayAnnounceFrom` below; the environment's
// name comes from vite.config.js.
//
// ON DEV FIREBASE THE GATE IS ADVISORY (Patryk, 2026-10-09). The DEV project
// is shared by every worktree and by the sandbox deployment, so a feature
// branch that raised the number would stop all of them until it merged. There
// a lower build logs one warning and keeps writing, and no build announces its
// number. `localStorage["mgt.schemaEnforce"] = "1"` turns the full behaviour on
// for one browser, which is how the card and the refusal are tested.
export const SCHEMA = 1;

export const SCHEMA_ENFORCE_KEY = "mgt.schemaEnforce";

// ── Pure ─────────────────────────────────────────────────────────────────────
// The stored node is `{v: N}`. Anything else (absent, a build that never
// announced) reads as 0: nothing is ahead of this build.
export function storedSchemaOf(val) {
  const n = val && typeof val === "object" ? val.v : null;
  return typeof n === "number" && isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
// Is the database ahead of a build at `own`?
export function schemaBehind(stored, own) {
  return typeof stored === "number" && stored > own;
}
// Should a build at `own` announce its number? Only once the stored one has
// been READ (`stored` is null until then: announcing over an unread node is the
// write-before-load this repo forbids), and only where the gate is enforced.
export function shouldAnnounce(stored, own, enforce) {
  return enforce === true && typeof stored === "number" && stored < own;
}
// May a build made in this deployment environment announce at all? Everything
// but a Vercel preview: "production", and "" for a build made anywhere else.
export function mayAnnounceFrom(deployEnv) {
  return deployEnv !== "preview";
}

// ── The live binding the writers ask ─────────────────────────────────────────
// Module state, as the operating hours and the layout are: the four writers
// are in three hooks and a lib, and none of them renders.
let stored = null;      // null until `/schema` has been read
let enforce = true;     // false on DEV Firebase unless the local flag is set
let warned = false;

export function configureSchemaGate(opts) { enforce = !(opts && opts.enforce === false); }
export function setStoredSchema(n) { stored = n; }
export function schemaEnforced() { return enforce; }

// Asked by every gated writer before it dispatches. `what` names the write for
// the console line.
export function writesBlocked(what) {
  if (!schemaBehind(stored, SCHEMA)) return false;
  if (!enforce) {
    if (!warned) {
      warned = true;
      console.warn("[schema] this build is at schema " + SCHEMA + " and the database is at " + stored + ". Advisory on DEV: writing anyway. In production this device would refuse to write until refreshed.");
    }
    return false;
  }
  console.warn("[SAFE] Refused to write " + (what || "data") + " — this build is at schema " + SCHEMA + ", the database is at " + stored + ". Refresh this device.");
  return true;
}

// Tests only.
export function resetSchemaGate() { stored = null; enforce = true; warned = false; }
