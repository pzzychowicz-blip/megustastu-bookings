// src/hooks/useWaMedia.js
//
// v18.8.0 — the file of one WhatsApp message with media, for the bubble and the
// photo viewer. `want` says when to fetch: a photo once its bubble is in view,
// a voice note or a document once it is pressed. The download and the blob
// URL are `fetchMedia`'s (lib/wa-backend.js), shared per message and given back
// when the caller unmounts or stops wanting it.
//
// Returns `{status, url, type, retry}`, `status` one of:
//   "none"     — the message has no media
//   "expired"  — past Meta's keep (7 days received, 30 sent), computed from the
//                message's own time without a request; or the server said 410
//   "idle"     — not wanted yet
//   "loading"  — wanted, not here yet
//   "ready"    — `url` is a blob URL, `type` its content type
//   "toolarge" — 413: open WhatsApp on the phone
//   "error"    — anything else; `retry()` tries again
//
// No state is set synchronously in the effect: "loading" is DERIVED (the last
// answer belongs to another key), so the effect's only setState is the fetch's
// answer.

import { useEffect, useState } from "react";
import { fetchMedia, releaseMedia } from "../lib/wa-backend";
import { mediaExpired } from "../lib/whatsapp";

export function useWaMedia(phoneKey, msg, want) {
  const [attempt, setAttempt] = useState(0);
  const [got, setGot] = useState(null);
  const media = msg ? msg.media : null;
  const msgId = msg ? msg.id : "";
  const expired = !!media && mediaExpired(msg);
  const key = phoneKey + "/" + msgId + "#" + attempt;
  const active = !!(want && media && !expired && phoneKey && msgId);

  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    fetchMedia(phoneKey, msgId).then(
      (v) => { if (live) setGot({ key, status: "ready", url: v.url, type: v.type }); },
      (e) => { if (live) setGot({ key, status: (e && e.kind) || "error", message: e && e.message }); },
    );
    return () => { live = false; releaseMedia(phoneKey, msgId); };
  }, [active, phoneKey, msgId, key]);

  const retry = () => setAttempt((n) => n + 1);
  if (!media) return { status: "none", retry };
  if (expired) return { status: "expired", retry };
  if (!want) return { status: "idle", retry };
  if (!got || got.key !== key) return { status: "loading", retry };
  return Object.assign({ retry }, got);
}
