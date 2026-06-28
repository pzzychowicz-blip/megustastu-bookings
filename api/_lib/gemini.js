// api/_lib/gemini.js
//
// WhatsApp backend — LLM intent classification (the real version of what the
// sandbox simulator pre-baked as `parse`). Phase 1b design decisions:
//   · Provider: Gemini 3 Flash on the Google AI Studio free tier (Q4).
//   · Strict JSON out: {intent,name,size,date,time,notes,language,confidence,
//     ambiguity} — intent enum new_booking|cancel|modify|question|other.
//   · NEVER invents data — missing fields are null, not guesses (prompt rule).
//   · 5s timeout (AbortController). Timeout / malformed JSON / API error all
//     return null → the message is saved WITHOUT a draft (Phase 1a failure
//     modes) and staff handles it manually. Parsing must never block delivery.
//   · Every parse is logged (message in, JSON out) — the "parsing drift"
//     mitigation from Phase 1a §12: review the log monthly, adjust the prompt.
//
// Mock mode (WA_LLM_MODE=mock, the default): a deterministic keyword parser so
// the full pipeline runs with zero network/key. It is intentionally simple —
// it exists to exercise the plumbing, not to be smart.
//
// REST, not SDK: one fetch to generativelanguage.googleapis.com with
// responseMimeType+responseSchema keeps us dependency-free and pinned to the
// documented wire format. GEMINI_MODEL overrides the model id — confirm the
// exact current string in AI Studio (the local harness exposes GET /dev/models
// to list what the key can see).

import { env, llmMode } from "./env.js";
import { mergeDraft, WA_PARSE_TEXT_LEN } from "../../src/lib/whatsapp.js";

// flash-lite normally answers in <1s; this generous cap catches the occasional
// free-tier latency spike while still failing gracefully (timeout → null →
// message saved with no draft, staff handles it). Since the async-parse change
// (2026-06-13) this no longer holds up the webhook response — wa-inbound
// answers Meta first and runs the parse post-response (Vercel waitUntil), so
// the cap only bounds how long a draft can lag behind its message.
const TIMEOUT_MS = 15000;

// The strict response schema (Gemini "controlled generation"). Mirrors
// draftData on the conversation + language detection.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING", enum: ["new_booking", "cancel", "modify", "question", "other"] },
    name: { type: "STRING", nullable: true },
    size: { type: "INTEGER", nullable: true },
    date: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    time: { type: "STRING", nullable: true, description: "HH:MM 24h" },
    notes: { type: "STRING", nullable: true },
    preference: { type: "STRING", enum: ["auto", "indoor", "outdoor"], nullable: true, description: "Seating preference if the customer states one, else auto" },
    language: { type: "STRING", description: "ISO 639-1 of the customer's message, e.g. es, en" },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    ambiguity: { type: "STRING", nullable: true },
  },
  required: ["intent", "language", "confidence"],
};

function buildPrompt(text, { todayIso, weekday, hoursLine, existingDraft }) {
  // Draft-aware mode: when the conversation already has a PENDING draft from
  // earlier messages, the model receives it and returns the MERGED update —
  // follow-up details fill gaps, corrections overwrite, confidence re-assessed.
  // This is what frees staff from manually editing low/medium drafts.
  const draftBlock = existingDraft ? [
    "",
    "A booking draft already exists from the customer's EARLIER messages in this conversation:",
    JSON.stringify(existingDraft),
    "The new message below may add missing details, correct earlier fields, or change the request entirely.",
    "Return the FULL UPDATED draft for the whole conversation:",
    "- keep fields the customer did not change,",
    "- apply corrections (the newest statement wins),",
    "- re-assess confidence and ambiguity for the MERGED result (it can improve or worsen),",
    "- the draft is NOT yet a confirmed booking: corrections/refinements to it KEEP the draft's current intent (do NOT switch to modify — modify is only for changing an already-confirmed booking),",
    "- if the request changed entirely (e.g. the customer now cancels), change the intent accordingly,",
    "- if the new message adds NO booking-relevant content at all (a pure acknowledgement: thanks, ok, emojis, smalltalk), return intent 'other' with null fields — do NOT echo the draft back; the existing draft is kept automatically.",
  ] : [];
  return [
    "You classify a WhatsApp message sent by a customer to a small restaurant in the Canary Islands and extract booking details.",
    "Customers write mostly in Spanish or English, informally, with typos.",
    "",
    "Context:",
    "- Today is " + todayIso + " (" + weekday + "). Resolve relative dates (manana/tomorrow, weekday names = the NEXT such day) to YYYY-MM-DD.",
    "- " + (hoursLine || "The restaurant serves lunch and dinner, roughly 13:00-22:00."),
    "- Party sizes are 1-20 guests.",
    ...draftBlock,
    "",
    "Rules:",
    "- intent: new_booking (wants a table), cancel (cancel an existing booking), modify (change an existing booking: size/time/date/notes, including running late), question (asks something, no booking change), other (anything else: wrong number, spam, emojis, thanks).",
    "- NEVER invent or guess a value the customer did not state. Missing -> null. Do not default the party size or time.",
    "- time is 24h HH:MM. \"8pm\"/\"a las 9 de la noche\" -> 20:00/21:00. A vague time (\"evening\", \"sobre las 9\") -> null time + describe in ambiguity.",
    "- confidence: high = every extracted field was explicit; medium = one field inferred; low = multiple vague/unclear fields.",
    "- ambiguity: one short sentence describing what is unclear, else null.",
    "- name: only if the customer states their own name.",
    "- notes: special requests verbatim-ish (allergy, birthday, wheelchair...), else null.",
    "- preference: 'outdoor' if the customer asks to sit outside (terrace/terraza/fuera/afuera/patio/exterior), 'indoor' if they ask to sit inside (dentro/interior/adentro/inside). If they don't clearly state a seating area, use 'auto'. NEVER guess.",
    "- language: of the message itself.",
    "",
    "Customer message:",
    JSON.stringify(text),
  ].join("\n");
}

// inferPreference(text) → "outdoor" | "indoor" | null. Keyword detection of a
// stated seating area, shared by mockParse and the liveParse fallback (the LLM
// is inconsistent about populating the `preference` field even with the schema +
// prompt rule, so we backstop it deterministically from the raw message).
export function inferPreference(text) {
  const t = String(text || "").toLowerCase();
  if (/terraza|terrace|fuera|afuera|outside|outdoor|exterior|patio/.test(t)) return "outdoor";
  if (/dentro|interior|adentro|inside|indoor/.test(t)) return "indoor";
  return null;
}

// ── Mock parser (deterministic, no network) ───────────────────────────────────
export function mockParse(text) {
  const t = String(text || "").toLowerCase();
  // Language: Spanish-specific markers only (accents/inverted punctuation are
  // the strongest signal). Beware substrings shared with English — "reserv"
  // matches "reservation", so booking words are NOT language evidence.
  const es = /[¿¡áéíóúñü]|hola|mesa para|gracias|personas|somos|por favor|quiero|queria|teneis|buenas|noche|manana/.test(t);
  const language = es ? "es" : "en";
  const sizeM = t.match(/(?:para|for|somos|we're|we are)\s+(\d{1,2})/) || t.match(/(\d{1,2})\s*(?:personas|people|pers|pax)/);
  let intent = "other";
  if (/cancel|anular|cancelar/.test(t)) intent = "cancel";
  else if (/cambiar|change|move|instead|en vez|pasar la|running late|llegamos tarde|tarde para/.test(t)) intent = "modify";
  else if (/\?|¿/.test(t) && !/reserv|book|mesa|table/.test(t) && !sizeM) intent = "question";
  else if (/reserv|book|mesa|table|sitio|hueco/.test(t) || sizeM) intent = "new_booking"; // party size alone reads as a booking ask
  else if (/\?|¿/.test(t)) intent = "question";
  const timeM = t.match(/(\d{1,2})[:.](\d{2})/) || t.match(/(\d{1,2})h\b/) || t.match(/a las (\d{1,2})\b/) || t.match(/at (\d{1,2})\s*(?:pm|h|:00)?\b/);
  let time = null;
  if (timeM) {
    let h = parseInt(timeM[1], 10); const m = timeM[2] ? parseInt(timeM[2], 10) : 0;
    if (/pm/.test(t) && h < 12) h += 12;
    if (h >= 1 && h <= 11 && /noche|cena|dinner|evening/.test(t)) h += 12; // evening heuristic
    time = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }
  // Date: today/tomorrow words, else a weekday name → the NEXT such day (UTC).
  const today = new Date();
  let date = null;
  const WEEKDAYS = [["domingo", "sunday"], ["lunes", "monday"], ["martes", "tuesday"], ["miércoles", "miercoles", "wednesday"], ["jueves", "thursday"], ["viernes", "friday"], ["sábado", "sabado", "saturday"]];
  if (/hoy|tonight|esta noche|today/.test(t)) date = today.toISOString().slice(0, 10);
  else if (/mañana|manana|tomorrow/.test(t)) { const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); date = d.toISOString().slice(0, 10); }
  else {
    for (let dow = 0; dow < 7 && !date; dow++) {
      if (WEEKDAYS[dow].some((w) => t.includes(w))) {
        const d = new Date(); const diff = (dow - d.getUTCDay() + 7) % 7 || 7;
        d.setUTCDate(d.getUTCDate() + diff); date = d.toISOString().slice(0, 10);
      }
    }
  }
  const draftIntent = intent === "new_booking" || intent === "cancel" || intent === "modify";
  // Seating preference: only when the customer clearly states an area, else auto.
  const preference = inferPreference(t) || "auto";
  return {
    intent,
    name: null,
    size: draftIntent && sizeM ? parseInt(sizeM[1], 10) : null,
    date: draftIntent ? date : null,
    time: draftIntent ? time : null,
    notes: null,
    preference: draftIntent ? preference : "auto",
    language,
    confidence: sizeM && time && date ? "high" : "medium",
    ambiguity: null,
  };
}

// ── Live parser ───────────────────────────────────────────────────────────────
async function liveParse(text, ctx) {
  const key = env("GEMINI_API_KEY", null);
  if (!key) { console.warn("[gemini] GEMINI_API_KEY missing — falling back to mock parse"); return mockParse(text); }
  // Default benchmarked live (2026-06-05) against this key: gemini-3.1-flash-lite
  // is sub-second and consistently accurate (honors the never-invent rule), and
  // it's the Phase-1b design's stated free-tier choice. Alternatives rejected:
  // gemini-3.5-flash is accurate but its latency swings to ~20s (timeouts);
  // gemini-3-flash-preview always times out; gemini-2.0-flash 429s on free tier.
  // Override with GEMINI_MODEL (confirm availability via the harness /dev/models).
  const model = env("GEMINI_MODEL", "gemini-3.1-flash-lite");
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + key;
  const body = {
    contents: [{ parts: [{ text: buildPrompt(text, ctx) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[gemini] API error " + res.status + " — message saved without draft.", errText.slice(0, 300));
      return null;
    }
    const data = await res.json();
    const jsonText = data && data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
      && data.candidates[0].content.parts[0].text;
    if (!jsonText) { console.warn("[gemini] empty candidates — message saved without draft."); return null; }
    const parsed = JSON.parse(jsonText);
    // Backstop the seating preference: the LLM often leaves it null/auto even when
    // the customer clearly wrote "outside"/"terraza" etc. Infer it from the raw
    // message; never downgrade a stated area Gemini DID return, and fall back to
    // the existing draft's preference (so a follow-up that doesn't mention seating
    // keeps the earlier choice).
    if (parsed && (!parsed.preference || parsed.preference === "auto")) {
      const prev = ctx && ctx.existingDraft && ctx.existingDraft.preference;
      parsed.preference = inferPreference(text) || (prev && prev !== "auto" ? prev : "auto");
    }
    return parsed;
  } catch (e) {
    console.warn("[gemini] " + (e.name === "AbortError" ? "timeout after " + TIMEOUT_MS + "ms" : e.message) + " — message saved without draft.");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// parseMessage(text, {hours, existingDraft}) → parse object or null (= save
// without draft). hours: the settings/operatingHours node or null.
// existingDraft: the conversation's PENDING draftData (draftStatus "parsed") or
// null — when present, live mode lets Gemini merge semantically (see
// buildPrompt) and mock mode applies the shared mechanical mergeDraft rule.
export async function parseMessage(text, { hours, existingDraft } = {}) {
  // Prompt-size guard: only the first WA_PARSE_TEXT_LEN chars reach the LLM —
  // a real booking request fits many times over; oversize input is quota abuse.
  text = String(text == null ? "" : text).slice(0, WA_PARSE_TEXT_LEN);
  const now = new Date();
  const ctx = {
    todayIso: now.toISOString().slice(0, 10),
    weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getUTCDay()],
    hoursLine: hours ? "Operating hours config (per weekday, 24h): " + JSON.stringify(hours) : null,
    existingDraft: existingDraft || null,
  };
  const mode = llmMode();
  let parsed = mode === "live" ? await liveParse(text, ctx) : mockParse(text);
  if (mode !== "live" && existingDraft && parsed) parsed = mergeDraft(existingDraft, parsed);
  // Drift-review log: every parse, message + result, one line each.
  console.log("[wa-parse:" + mode + "] " + JSON.stringify({ text: String(text).slice(0, 200), merged: !!existingDraft, parsed }));
  return parsed;
}

// generateCustomerReply(history, language) → the CUSTOMER's next message, as a
// plain string. Powers the Sim panel's ✨ Suggest (Gemini plays the customer so
// staff-reply ⇄ customer-reply reads like a real exchange). Test tooling: it is
// called by both the local harness's /dev/customer-reply route AND the online
// api/wa-sim-suggest function, so the Gemini key never reaches the client. Plain
// text (no schema), temperature 0.9 for natural variation. Throws on failure
// with an http-ish `.status` so the caller can map it to a response code.
export async function generateCustomerReply(history, language) {
  const key = env("GEMINI_API_KEY", null);
  if (!key) { const e = new Error("GEMINI_API_KEY not set"); e.status = 400; throw e; }
  const model = env("GEMINI_MODEL", "gemini-3.1-flash-lite");
  const langName = language === "en" ? "English" : "Spanish";
  const transcript = (history || []).slice(-12)
    .map((m) => (m.direction === "out" ? "Restaurant: " : "You (customer): ") + m.text)
    .join("\n");
  const prompt = [
    "You are a customer of a small restaurant in the Canary Islands, chatting with the restaurant on WhatsApp.",
    "Here is the conversation so far:",
    "",
    transcript || "(no messages yet — open the conversation naturally)",
    "",
    "Write ONLY your next message as the customer: short, natural, informal " + langName + ", like a real WhatsApp text.",
    "Do not repeat yourself. No quotes, no role labels, no explanations.",
  ].join("\n");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 4000 } }),
      signal: ac.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((data.error && data.error.message) || ("Gemini error " + r.status)); e.status = 502; throw e; }
    const text = data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!text) { const e = new Error("Gemini returned no text"); e.status = 502; throw e; }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

// generateScenarioMessage({ hint }) → one INVENTED, realistic inbound customer
// message for variety beyond the 60 canned scenarios: { message, language, name }.
// Gemini randomly picks a situation across a wide range (new booking of varying
// size/date/time, cancel, modify, running late, a question, a special request,
// occasionally smalltalk/wrong-number), mostly Spanish + some English, informal
// with typos. `hint` optionally steers it. A random diversity seed + temperature
// 1.1 keep repeated calls different. Powers the Sim "🎲 Generate scenario".
const SCENARIO_SCHEMA = {
  type: "OBJECT",
  properties: {
    message: { type: "STRING", description: "the customer's WhatsApp message text" },
    language: { type: "STRING", enum: ["es", "en"] },
    name: { type: "STRING", nullable: true, description: "the sender's first name if they give one, else null" },
  },
  required: ["message", "language"],
};
export async function generateScenarioMessage({ hint } = {}) {
  const key = env("GEMINI_API_KEY", null);
  if (!key) { const e = new Error("GEMINI_API_KEY not set"); e.status = 400; throw e; }
  const model = env("GEMINI_MODEL", "gemini-3.1-flash-lite");
  const seed = Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
  const prompt = [
    "Invent ONE realistic inbound WhatsApp message from a (potential) customer to a small restaurant in the Canary Islands. It is test data for a booking system — make it varied and natural.",
    "Randomly pick the SITUATION from a WIDE range (do NOT default to a plain new booking):",
    "- a new booking: party size 1-20, for today / tomorrow / a named weekday / a date, lunch or dinner, sometimes a vague time;",
    "- a cancellation; a change to an existing booking (size/time/date); running late;",
    "- a question (opening hours, menu, parking, terrace, dog-friendly, allergies, high chair);",
    "- a special request (birthday, wheelchair access, allergy, big group);",
    "- occasionally: smalltalk / thanks, a wrong number, or spam.",
    "Style: MOSTLY Spanish, sometimes English. Informal WhatsApp tone — lowercase, typos, sometimes no greeting, an emoji now and then. Keep it to 1-2 short sentences.",
    "Only include a name if the customer naturally states it.",
    "Diversity seed (meaningless — just use it to make this DIFFERENT from other generations): " + seed,
    "Tester's optional steer: " + (hint && String(hint).trim() ? JSON.stringify(String(hint).trim()) : "none — surprise me"),
  ].join("\n");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCENARIO_SCHEMA, temperature: 1.1, maxOutputTokens: 2000 },
      }),
      signal: ac.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((data.error && data.error.message) || ("Gemini error " + r.status)); e.status = 502; throw e; }
    const jsonText = data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!jsonText) { const e = new Error("Gemini returned no text"); e.status = 502; throw e; }
    const out = JSON.parse(jsonText);
    return { message: String(out.message || "").trim(), language: out.language === "en" ? "en" : "es", name: out.name || null };
  } finally {
    clearTimeout(timer);
  }
}
