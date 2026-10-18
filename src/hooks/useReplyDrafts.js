// src/hooks/useReplyDrafts.js — v18.10.0
// One account's WhatsApp reply drafts on this device, {phoneKey: {text, at}},
// kept current as they are typed (here or in another tab). The store and why it
// is this device only: src/lib/wa-reply-drafts.js.

import { useSyncExternalStore } from "react";
import { subscribeDrafts, draftsOf } from "../lib/wa-reply-drafts";

const NONE = Object.freeze({});

export function useReplyDrafts(uid) {
  return useSyncExternalStore(subscribeDrafts, () => draftsOf(uid), () => NONE);
}
