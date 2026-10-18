// src/hooks/useReplyDraft.js — v18.10.0
// One conversation's WhatsApp reply draft on this device, for one account: the
// text typed and not sent, kept current as it is typed (here or in another
// tab). A string, so a component re-renders only when ITS draft changes. The
// store and why it is this device only: src/lib/wa-reply-drafts.js.

import { useSyncExternalStore } from "react";
import { subscribeDrafts, draftTextOf } from "../lib/wa-reply-drafts";

export function useReplyDraft(uid, key) {
  return useSyncExternalStore(subscribeDrafts, () => draftTextOf(uid, key), () => "");
}
