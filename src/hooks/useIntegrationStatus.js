// src/hooks/useIntegrationStatus.js
//
// What `/api/wa-config` answers: which server-side keys are set (a boolean per
// key, never a value), the two modes, and since v18.9.0 whether
// META_PHONE_NUMBER_ID names the number Embedded Signup connected. Moved out of
// AdminSettings.jsx in v18.9.0, when Settings → WhatsApp's "Business app
// connection" section became its second reader: one fetch, one meaning of
// "unknown", rather than two copies of both.

import { useState, useEffect } from "react";
import { auth } from "../firebase";

// v18.0.0 phase 5: the status this section used to say was "coming". THREE
// states, not two, and the third is the point — `null` means "we could not ask",
// which is what `npm run dev` produces (no serverless runtime) and what a
// deployment without the functions produces. A panel about secrets must not
// render "not set" for a key it never managed to enquire about: that is a false
// negative pointing at a configuration problem that may not exist, in the one
// place someone goes to diagnose exactly that.
export function useIntegrationStatus() {
  const [status, setStatus] = useState(null);   // null = unknown, else the payload
  const [failed, setFailed] = useState(false);
  useEffect(function () {
    let cancelled = false;
    (async function () {
      try {
        const user = auth.currentUser;
        if (!user) { if (!cancelled) setFailed(true); return; }
        const token = await user.getIdToken();
        const res = await fetch("/api/wa-config", { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (!cancelled) { setStatus(data); setFailed(false); }
      } catch {
        // Deliberately quiet: on the dev server this request ALWAYS fails, and a
        // console error every time the Admin tab opens would train the one person
        // who reads this console to ignore it.
        if (!cancelled) setFailed(true);
      }
    })();
    return function () { cancelled = true; };
  }, []);
  return { status, failed };
}
