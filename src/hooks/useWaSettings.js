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
// WA_SANDBOX gate: like every other WA listener (see useWhatsApp's PROD-leak
// note), this attaches nothing in a non-sandbox build — the WhatsApp settings
// tab is hidden there too, so there is nothing to read and nothing to write.

import { useState, useRef, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { dbError } from "../lib/dbError";
import { WA_SANDBOX } from "../lib/waSandbox";

export const DEFAULT_WA_SETTINGS = {
  v: 1,
  autoArchiveOnComplete: true,
};

function sanitizeWa(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    v: 1,
    // Default-ON convention (see CLAUDE.md): only an explicit `false` disables.
    autoArchiveOnComplete: src.autoArchiveOnComplete !== false,
  };
}

export function useWaSettings() {
  const [waSettings, setWa] = useState(DEFAULT_WA_SETTINGS);
  const loaded = useRef(false);
  const revRef = useRef(0);
  useEffect(function () {
    if (!WA_SANDBOX) return;
    return attachRev("settings/whatsapp", revRef);
  }, []);

  useEffect(function () {
    if (!WA_SANDBOX) return;
    const unsub = onValue(ref(db, "settings/whatsapp"), function (snap) {
      const val = snap.val();
      if (val && typeof val === "object") setWa(sanitizeWa(val));
      // Node absent (first run): keep the defaults — no seeding write, so a
      // fresh install is a no-op until staff actually changes something.
      loaded.current = true;
    }, dbError("settings/whatsapp"));
    return unsub;
  }, []);

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
