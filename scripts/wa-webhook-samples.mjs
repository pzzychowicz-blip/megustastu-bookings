// scripts/wa-webhook-samples.mjs
//
// Builders for Meta-Cloud-API-shaped webhook payloads, used two ways:
//   · from a shell, to curl the local harness (see the examples at bottom)
//   · conceptually mirrored by src/lib/wa-backend.js (the client builds the
//     same shape for the Sim panel's Backend mode)
//
// Shape reference: one entry → one change → value{ contacts[], messages[] }
// for inbound texts, or value{ statuses[] } for delivery receipts. The
// timestamp is unix SECONDS (the webhook handler multiplies by 1000) — pass
// `agoMs` to back-date a message (e.g. to simulate an expired 24h window).
//
// Run directly to print a payload:
//   node scripts/wa-webhook-samples.mjs text "+34611222333" "Hola, mesa para 2?"
//   node scripts/wa-webhook-samples.mjs status "+34611222333" wamid.X delivered

export function textMessagePayload({ phone, text, name, agoMs = 0, wamid }) {
  const waId = String(phone).replace(/^\+/, "");
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA_ID_SAMPLE",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "34600000000", phone_number_id: "PHONE_NUMBER_ID_SAMPLE" },
          contacts: [{ wa_id: waId, profile: { name: name || "Sample Customer" } }],
          messages: [{
            from: waId,
            id: wamid || ("wamid.SAMPLE." + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
            timestamp: String(Math.floor((Date.now() - agoMs) / 1000)),
            type: "text",
            text: { body: text },
          }],
        },
      }],
    }],
  };
}

export function statusPayload({ phone, wamid, status }) {
  const waId = String(phone).replace(/^\+/, "");
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA_ID_SAMPLE",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "34600000000", phone_number_id: "PHONE_NUMBER_ID_SAMPLE" },
          statuses: [{
            id: wamid,
            status, // sent | delivered | read | failed
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: waId,
          }],
        },
      }],
    }],
  };
}

// ── CLI: print a payload for curl ─────────────────────────────────────────────
//   curl -s -X POST http://localhost:3999/api/wa-inbound \
//     -H 'Content-Type: application/json' \
//     -d "$(node scripts/wa-webhook-samples.mjs text '+34611222333' 'Hola, ¿mesa para 4 el sábado a las 21h?')"
import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , kind, phone, a, b] = process.argv;
  if (kind === "text") console.log(JSON.stringify(textMessagePayload({ phone, text: a || "Hola" })));
  else if (kind === "status") console.log(JSON.stringify(statusPayload({ phone, wamid: a, status: b || "delivered" })));
  else console.log("usage: node scripts/wa-webhook-samples.mjs text <phone> <text> | status <phone> <wamid> <status>");
}
