// src/hooks/useWaSettings.js
//
// WhatsApp module settings — a `settings/whatsapp` node, modelled exactly on
// useGeneralSettings (the newest of the settings hooks): loaded-ref write guard
// + revGuard CAS on `whatsappRev`, per CLAUDE.md's rule of law that any NEW
// persisted node ships with a rev pair.
//
// Restaurant-wide, NOT per-device: auto-archiving a conversation changes what
// every device's inbox shows, so it belongs with the shared settings nodes and
// not in localStorage.
//
//   autoArchiveOnComplete — when a conversation's LINKED booking reaches
//     "completed", archive the conversation (useWhatsApp's effect). Default ON;
//     the sanitize therefore uses the default-on `!== false` idiom, so an
//     absent field reads as enabled.
//
// v18.0.0 phase 5 — the gate is the MODULE, not WA_SANDBOX. Like every other WA
// listener (see useWhatsApp's note), this attaches nothing while the module is
// off: the WhatsApp settings tab is hidden then too, so there is nothing to read
// and nothing to write. The change from the sandbox flag is what lets an admin
// switching the module on in PRODUCTION actually attach the listener — under
// WA_SANDBOX a production build could never have read this node at all.

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { dbError } from "../lib/dbError";

export const DEFAULT_WA_SETTINGS = {
  v: 1,
  autoArchiveOnComplete: true,
  // Epoch (ms) from which auto-archive applies. 0 = not yet established; the
  // hook stamps it once, on the first load that ever sees this node. See the
  // effect below for why it exists.
  autoArchiveSince: 0,
};

function sanitizeWa(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const since = Number(src.autoArchiveSince);
  return {
    v: 1,
    // Default-ON convention (see CLAUDE.md): only an explicit `false` disables.
    autoArchiveOnComplete: src.autoArchiveOnComplete !== false,
    autoArchiveSince: Number.isFinite(since) && since > 0 ? since : 0,
  };
}

export function useWaSettings({ enabled } = {}) {
  const on = enabled === true;
  const [waSettings, setWa] = useState(DEFAULT_WA_SETTINGS);
  const loaded = useRef(false);
  // State mirror of `loaded`: the epoch effect below has to RE-RUN once the
  // first snapshot lands, and a ref flip does not re-render or re-fire effects.
  const [loadedState, setLoadedState] = useState(false);
  const revRef = useRef(0);
  useEffect(function () {
    if (!on) return;
    return attachRev("settings/whatsapp", revRef);
    // `on` IS a dependency now and was not when the gate was WA_SANDBOX: a
    // build-time constant never changes, so `[]` was right; a module switch
    // flips at runtime, and without this the listener would never attach for
    // the admin who just turned WhatsApp on until they reloaded the app.
  }, [on]);

  useEffect(function () {
    if (!on) return;
    const unsub = onValue(ref(db, "settings/whatsapp"), function (snap) {
      const val = snap.val();
      if (val && typeof val === "object") setWa(sanitizeWa(val));
      // Node absent (first run): keep the defaults. The only write a fresh
      // install makes on its own is the auto-archive epoch below.
      loaded.current = true;
      setLoadedState(true);
    }, dbError("settings/whatsapp"));
    return unsub;
  }, [on]);

  // ── The auto-archive epoch ──────────────────────────────────────────────────
  // Without this, the very first load after the feature ships sees every
  // historical conversation whose linked booking is already "completed" and
  // archives the lot in one unattended burst — a bulk mutation nobody asked for
  // and cannot preview. A purely client-side "first pass" heuristic can't fix
  // it either: a device opened tomorrow would see a booking another device
  // completed five minutes ago as equally historical.
  //
  // So the cutoff is stored, shared and established exactly once: the first
  // client to load a node without it stamps `now`. From then on every device
  // agrees, and the effect in useWhatsApp only archives bookings whose last
  // change is at or after that instant. revGuard's CAS settles a race between
  // two devices stamping simultaneously — the loser rolls back and re-reads.
  const seeded = useRef(false);
  useEffect(function () {
    if (!on || !loadedState || seeded.current) return;
    seeded.current = true;
    if (waSettings.autoArchiveSince > 0) return; // already established by some device
    saveWaSettings({ autoArchiveSince: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot after load; saveWaSettings is a fresh closure each render
  }, [on, loadedState]);

  // Guarded write; accepts a PARTIAL update (the useGeneralSettings contract).
  function saveWaSettings(partial) {
    if (!loaded.current) {
      console.warn("[SAFE] Refused to write WhatsApp settings — initial read has not completed yet.");
      return;
    }
    const next = sanitizeWa({ ...waSettings, ...(partial || {}) });
    setWa(next);
    writeWithRev("settings/whatsapp", next, revRef);
  }

  return { waSettings, saveWaSettings };
}
