// api/_lib/coexist-core.js
//
// WhatsApp backend — COEXISTENCE (v18.9.0): the restaurant number runs the
// WhatsApp Business app on the phone AND the Cloud API (MGT) at once. Meta then
// sends four more webhook fields to the same URL, beside `messages`:
//
//   smb_app_state_sync  — the phone's address book: a contact added, edited or
//                         removed (and every contact once, on request, after
//                         onboarding)
//   smb_message_echoes  — a message staff sent FROM THE PHONE
//   history             — the chats the phone already held, imported once
//   account_update      — the connection itself: disconnected, reconnected, …
//
// api/wa-inbound.js dispatches on `change.field` and hands each of these to a
// handler here; the simulator (api/wa-sim-inbound.js, `event`) builds the same
// Meta-shaped `value`s and calls the same handlers, so a simulated contact or
// history import is stored exactly as Meta's would be.
//
// Every handler is IDEMPOTENT — keyed by wamid or by phone key — because the
// webhook's retry rule (500 when everything failed, so Meta redelivers) assumes
// a redelivery rewrites the same records rather than adding new ones.

import { env } from "./env.js";
import { readWaLink } from "./rtdb.js";

// The fields this file handles. `messages` is not among them: it stays in
// api/wa-inbound.js, which owns the async parse.
export const COEXIST_FIELDS = ["smb_app_state_sync", "smb_message_echoes", "history", "account_update"];

// ── The number guard ─────────────────────────────────────────────────────────
// numberIsOurs(phoneNumberId, envId, linkId) — may this change be stored?
//
// One Meta app can hold several numbers, and the sandbox app does: Meta's test
// number AND the rehearsal's number. Without a guard every number's customers,
// contacts and history would land in one inbox. The allowed set is the
// configured number (META_PHONE_NUMBER_ID) plus the one Embedded Signup
// connected (`waLink.phoneNumberId`). The second is not a convenience: the
// contact and history syncs are requested during onboarding, minutes BEFORE
// anyone can set the env var to the new id and redeploy, and they are requested
// once — a sync dropped for a wrong number is a sync lost.
//
//   · no phone-number id on the change → allowed (account_update carries none;
//     the simulator's fake webhook carries none on purpose)
//   · nothing configured at all → allowed: the mock sandbox and the local
//     harness, where there is no real number to protect
//   · otherwise allowed only when it is one of the two
export function numberIsOurs(phoneNumberId, envId, linkId) {
  if (!phoneNumberId) return true;
  if (!envId && !linkId) return true;
  const id = String(phoneNumberId);
  return (!!envId && id === String(envId)) || (!!linkId && id === String(linkId));
}

// makeNumberGuard() → async (value) => boolean, for one webhook delivery.
// `waLink` is read at most ONCE per delivery, and only when the env id did not
// already answer — so the common case (the configured number) costs no read.
// A failed read throws to the caller, which counts the change as an error: a
// delivery that could not be checked is one Meta should send again.
export function makeNumberGuard(readLink = readWaLink) {
  let link; // undefined = not read yet
  return async function isOurs(value) {
    const meta = value && value.metadata;
    const pid = meta && typeof meta === "object" ? meta.phone_number_id : null;
    const envId = env("META_PHONE_NUMBER_ID", null);
    if (!pid || (envId && String(pid) === String(envId))) return true;
    if (link === undefined) link = (await readLink()) || null;
    return numberIsOurs(pid, envId, link && link.phoneNumberId);
  };
}
