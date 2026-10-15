// api/wa-prune.js
//
// WhatsApp backend — the nightly message prune (v18.8.0 phase 7). The
// restaurant keeps a customer's messages for `settings/admin.waRetentionDays`
// (12 months by default, the period the privacy notice states), and this
// deletes what is older. Vercel Cron calls it every day at 04:00 UTC
// (`vercel.json`'s `crons`), on each project's production deployment: the
// sandbox's prunes DEV, the restaurant's prunes PROD.
//
//   GET  Authorization: Bearer <CRON_SECRET>
//
// **The secret is the only gate, and it is the first thing asked.** Vercel sends
// `CRON_SECRET` as a bearer token when the variable is set on the project, so
// nobody else can make this delete anything. With no secret configured the
// answer is 503 (and the cron does nothing, loudly, in the logs): an endpoint
// that deletes must never run open because a variable was forgotten. A wrong
// or missing token is 401. Compared in constant time.
//
// What goes, against `cutoff = now − retention`:
//   · a conversation whose last message is older than the cutoff, with its
//     messages. Re-checked at the moment of the delete (a transaction), so a
//     message that arrived while the prune ran keeps its thread. The customer
//     who writes again a year later gets the one-time auto-reply again, which
//     is acceptable after a year (decided 2026-10-14).
//   · in a live conversation, each message older than the cutoff.
// A message's age is its own `ts`. One with no readable `ts` stays in a live
// conversation (its age is unknown) and goes with a deleted one (it belongs to
// nothing then). A conversation with no readable `lastMessageAt` is never
// deleted. Only threads that can hold an old message are read: a conversation
// created inside the window cannot. And of a live thread only its old messages
// are read (`readOldMessages`, a query on the indexed `ts`), since after the
// first year every regular customer's thread began before the cutoff, and
// reading each whole every night would cost the restaurant's entire history
// to delete a day's worth (/code-review). A thread that is going is read whole.
//
// **The messages go BEFORE the conversation** (/code-review). The prune finds
// a thread through its conversation row, so a conversation deleted first and
// messages that then failed to delete would be kept for ever, past the period
// the privacy notice states. In this order a failure leaves the conversation,
// and the next night finds it again: its messages, or its now-empty thread.
// The cost is one race: a thread that comes alive in the moment between the
// read and the transaction keeps its row and loses a message with no readable
// `ts`, which no writer in this app produces.
//
// Deletes go per conversation and per message, never a whole node: this runs
// through firebase-admin, which bypasses the rules, so nothing but this code
// limits what it can remove. It answers the counts and logs one line.

import crypto from "node:crypto";
import { env } from "./_lib/env.js";
import { readWaRetentionDays, readAllConversations, readMessageNode, readOldMessages, removeConversationIf, removeMessages } from "./_lib/rtdb.js";
import { retentionDaysOf } from "../src/lib/retention.js";

const DAY_MS = 86400000;
const finite = (v) => typeof v === "number" && Number.isFinite(v);

// Is this conversation over? Its last message is older than the cutoff.
export function conversationExpired(conv, cutoff) {
  return !!conv && finite(conv.lastMessageAt) && conv.lastMessageAt < cutoff;
}

// Can it hold a message older than the cutoff? Only if it began before it (or
// says nothing about when it began).
export function mayHoldOld(conv, cutoff) {
  return conversationExpired(conv, cutoff) || !(conv && finite(conv.createdAt) && conv.createdAt >= cutoff);
}

// The child keys of one conversation's messages to delete. `all`: the thread is
// going, so everything goes except a message that is provably recent (one that
// arrived while the prune ran).
export function staleMessageIds(node, cutoff, all) {
  return Object.keys(node || {}).filter(function (k) {
    const m = node[k];
    const ts = m && typeof m === "object" ? m.ts : undefined;
    return all ? !(finite(ts) && ts >= cutoff) : finite(ts) && ts < cutoff;
  });
}

function bearerMatches(header, secret) {
  const want = Buffer.from("Bearer " + secret);
  const got = Buffer.from(String(header || ""));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export default async function handler(req, res) {
  const secret = env("CRON_SECRET", "");
  if (!secret) { res.status(503).json({ error: "CRON_SECRET is not set" }); return; }
  if (!bearerMatches(req.headers && req.headers["authorization"], secret)) { res.status(401).json({ error: "unauthorized" }); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }

  const now = Date.now();
  let days, conversations;
  try {
    days = retentionDaysOf(await readWaRetentionDays());
    conversations = await readAllConversations();
  } catch (e) {
    console.error("[wa-prune] could not read the database:", e && e.message);
    res.status(500).json({ error: "could not read the database" });
    return;
  }
  const cutoff = now - days * DAY_MS;
  const out = { days, cutoff, conversations: 0, messages: 0, read: 0, errors: 0 };

  for (const key of Object.keys(conversations)) {
    const conv = conversations[key];
    if (!mayHoldOld(conv, cutoff)) continue;
    try {
      const expired = conversationExpired(conv, cutoff);
      const node = expired ? await readMessageNode(key) : await readOldMessages(key, cutoff);
      out.read++;
      const ids = staleMessageIds(node, cutoff, expired);
      await removeMessages(key, ids);
      out.messages += ids.length;
      if (expired && await removeConversationIf(key, function (cur) { return conversationExpired(cur, cutoff); })) {
        out.conversations++;
      }
    } catch (e) {
      out.errors++;
      console.error("[wa-prune] " + key + ":", e && e.message);
    }
  }

  console.log("[wa-prune] kept " + days + " days (before " + new Date(cutoff).toISOString() + "): removed "
    + out.conversations + " conversation(s) and " + out.messages + " message(s), read " + out.read + " thread(s), " + out.errors + " error(s)");
  res.status(out.errors ? 500 : 200).json(Object.assign({ ok: out.errors === 0 }, out));
}
