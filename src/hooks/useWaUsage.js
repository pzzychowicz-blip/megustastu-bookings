// src/hooks/useWaUsage.js
//
// v18.10.0 — what Settings → WhatsApp → Messages and cost shows: Meta's own
// count of this month's and last month's messages (`/api/wa-usage`). Asked ON
// DEMAND, when the section opens and when Refresh is pressed, never on mount:
// every ask is a Graph call with the restaurant's token, and a counter nobody
// opened has nothing to show.
//
// `{ status, data, error, load }`:
//   status  "idle" (not asked yet) · "loading" · "done" · "error"
//   data    the server's answer, kept through a later failed ask so the figures
//           already on screen stay there while the error says why they are old
//   error   the sentence to show, or null
// An answer that arrives after the section unmounted is dropped.

import { useState, useRef, useEffect, useCallback } from "react";
import { usageViaBackend } from "../lib/wa-backend";

export function useWaUsage() {
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const live = useRef(true);
  const asking = useRef(0);
  useEffect(function () {
    live.current = true;
    return function () { live.current = false; };
  }, []);
  const load = useCallback(function () {
    // Only the latest ask may answer: a Refresh pressed while one is out must
    // not be overwritten by the older reply arriving second.
    const n = ++asking.current;
    setStatus("loading");
    setError(null);
    usageViaBackend().then(function (d) {
      if (!live.current || n !== asking.current) return;
      setData(d);
      setStatus("done");
    }, function (e) {
      if (!live.current || n !== asking.current) return;
      setError((e && e.message) || "could not reach the server");
      setStatus("error");
    });
  }, []);
  return { status, data, error, load };
}
