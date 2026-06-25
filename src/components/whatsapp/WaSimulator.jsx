// src/components/whatsapp/WaSimulator.jsx
//
// SANDBOX-ONLY message simulator panel. Stands in for the WhatsApp webhook + LLM
// by injecting mock inbound messages into DEV Firebase via the useWhatsApp
// savers, so they flow through the real listener path into the inbox. Mounted
// only when WA_SANDBOX (the dev server, or a deployed sandbox build with
// VITE_FB_TARGET=dev — see src/lib/waSandbox.js), so it can never appear in a
// real production build.
//
// Two ways to drive it: one-click canned scenarios (covering every UI state) and
// a free-form custom message. Utilities seed/clear the WA-SIM sample bookings
// (which the linked cancel/modify + Regular-chip scenarios reference) and reset
// the conversations/messages nodes.

import { useState, useEffect } from "react";
import { Overlay, Fld, Section, Toggle, mkInp, mkBtn } from "../atoms";
import { S, BTN } from "../../lib/constants";
import { sortConversations } from "../../lib/whatsapp";
import { SCENARIOS, seedSampleBookings, clearWaSimBookings, simulateBurst } from "../../lib/wa-sim-scenarios";
import { simulateInbound } from "../../lib/wa-sim";
import { backendEnabled, setBackendEnabled, backendHealth, WA_BACKEND_URL } from "../../lib/wa-backend";

export function WaSimulator({ ctx, onClose }) {
  const [status, setStatus] = useState("Ready.");
  // Backend mode: scenarios/sends go through the LOCAL Phase-1b backend
  // (scripts/wa-backend-dev.mjs on :3999) instead of client-side Firebase
  // writes. Persisted per-device; health is re-checked on open + on toggle.
  const [backendOn, setBackendOn] = useState(backendEnabled());
  const [health, setHealth] = useState(null); // null=unknown/down, object=alive
  useEffect(() => {
    let alive = true;
    backendHealth().then((h) => { if (alive) setHealth(h); });
    return () => { alive = false; };
  }, [backendOn]);
  function toggleBackend() {
    const next = !backendOn;
    setBackendEnabled(next);
    setBackendOn(next);
    setStatus(next ? "Backend mode ON — messages go through the local /api pipeline." : "Backend mode OFF — client-side simulator writes.");
  }
  const [form, setForm] = useState({
    phone: "+34600999111", language: "es", intent: "new_booking",
    size: 2, date: new Date().toISOString().slice(0, 10), time: "20:00", confidence: "high", text: "",
  });

  // ── Reply as customer — continue an existing conversation from the customer
  // side, so staff-reply ⇄ customer-reply reads like a real WhatsApp exchange.
  // Manual text always works (client mode = message-only inbound, draft/links
  // untouched; Backend mode = real webhook + server re-parse). ✨ Suggest asks
  // the harness's /dev/customer-reply to draft the customer's next message
  // (Gemini, key stays server-side) into the field for editing before sending.
  const [custKey, setCustKey] = useState("");
  const [custText, setCustText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const custList = sortConversations(ctx.conversations || [], false)
    .concat(sortConversations(ctx.conversations || [], true));
  const effectiveKey = custKey && custList.some((c) => c.phoneKey === custKey)
    ? custKey
    : (custList.length ? custList[0].phoneKey : "");
  const custConv = custList.find((c) => c.phoneKey === effectiveKey) || null;

  function custLabel(c) {
    const who = c.profileName || c.phone || c.phoneKey;
    const snippet = (c.lastMessageSnippet || "").slice(0, 32);
    return (c.archived ? "📦 " : "") + who + " · " + snippet;
  }
  function sendAsCustomer() {
    if (!custConv || !custText.trim()) return;
    simulateInbound({ phone: custConv.phone || custConv.phoneKey, language: custConv.language, text: custText.trim() }, ctx);
    setStatus("Customer replied" + (backendOn ? " via backend" : "") + " → " + (custConv.profileName || custConv.phone || custConv.phoneKey));
    setCustText("");
  }
  async function suggestReply() {
    if (!custConv || suggesting) return;
    setSuggesting(true);
    setStatus("✨ Asking Gemini for the customer's next message…");
    try {
      const history = ((ctx.messagesMap || {})[custConv.phoneKey] || []).map((m) => ({ direction: m.direction, text: m.text }));
      const res = await fetch(WA_BACKEND_URL + "/dev/customer-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: custConv.language, history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
      setCustText(data.text || "");
      setStatus("✨ Suggestion ready — edit if you like, then send.");
    } catch (e) {
      setStatus("⚠ Suggest failed: " + e.message + " (is the harness running? npm run wa:backend)");
    } finally {
      setSuggesting(false);
    }
  }

  function runScenario(s) { s.run(ctx); setStatus("Sent" + (backendOn ? " via backend" : "") + " → " + s.label); }
  function sendCustom() {
    const parse = {
      intent: form.intent,
      size: Number(form.size) || null,
      date: form.date || null,
      time: form.time || null,
      confidence: form.confidence,
    };
    simulateInbound({ phone: form.phone, language: form.language, text: form.text || "(simulated message)", parse }, ctx);
    setStatus("Sent custom → " + form.phone + " · " + form.intent);
  }
  function onSeed() { const n = seedSampleBookings(ctx); setStatus(n > 0 ? "Seeded " + n + " WA-SIM booking(s)." : "Sample bookings already present."); }
  function onClearBookings() { clearWaSimBookings(ctx); setStatus("Cleared WA-SIM bookings."); }
  function onClearConvos() { ctx.clearAllWaData(); setStatus("Cleared all conversations + messages."); }
  function onBurst() { const n = simulateBurst(ctx); setStatus("Burst: " + n + " messages (ongoing follow-ups + new)."); }

  const upd = (k) => (e) => setForm(Object.assign({}, form, { [k]: e.target.value }));
  const groups = SCENARIOS.reduce((acc, s) => { (acc[s.group] = acc[s.group] || []).push(s); return acc; }, {});

  const footer = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</span>
      <button className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "8px 18px", background: "var(--app-btn-slate)" })} onClick={onClose}>Close</button>
    </div>
  );

  return (
    <Overlay onClose={onClose} footer={footer}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>🧪 WhatsApp Simulator</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 7, background: "var(--wa-sim-accent)", color: "var(--text-on-accent)", letterSpacing: "0.04em" }}>DEV</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>Injects mock inbound messages into the DEV Firebase inbox. Never shown in production.</div>

      {/* Backend mode targets the LOCAL harness (:3999), which only exists in the
          dev server — hide it in a deployed sandbox so the toggle can't mislead.
          Online the panel runs in client-side sim mode (writes DEV Firebase). */}
      {import.meta.env.DEV ? (
      <Section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>Backend mode (local Phase-1b pipeline)</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {backendOn
                ? (health
                  ? "Harness alive on " + WA_BACKEND_URL + " — llm=" + health.llm + " · send=" + health.send + " · db " + (health.db === "configured" ? "✓" : "✗ not configured")
                  : "⚠ Harness NOT reachable — run `npm run wa:backend` first.")
                : "OFF — scenarios write Firebase client-side (original simulator)."}
            </div>
          </div>
          <Toggle on={backendOn} onClick={toggleBackend} />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>ON: scenarios POST a Meta-shaped webhook to /api/wa-inbound (server parses — pre-baked drafts/links don't apply) and replies go through /api/wa-send.</div>
      </Section>
      ) : null}

      <Section>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8 }}>Reply as customer</div>
        {custList.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No conversations yet — fire a scenario first.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Fld label="Conversation">
              <select className="mgt-hover-scale" value={effectiveKey} onChange={(e) => setCustKey(e.target.value)} style={mkInp()}>
                {custList.map((c) => <option key={c.phoneKey} value={c.phoneKey}>{custLabel(c)}</option>)}
              </select>
            </Fld>
            <Fld label="The customer's message">
              <textarea className="mgt-hover-scale" value={custText} onChange={(e) => setCustText(e.target.value)} rows={2} style={Object.assign({}, mkInp(), { resize: "vertical" })} placeholder={custConv && custConv.language === "en" ? "Type as the customer…" : "Escribe como el cliente…"} />
            </Fld>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="mgt-hover-scale" disabled={suggesting} onClick={suggestReply} style={mkBtn({ minHeight: 38, padding: "8px 12px", background: "var(--wa-sim-accent)" })}>{suggesting ? "✨ Thinking…" : "✨ Suggest reply"}</button>
              <button className="mgt-hover-scale" onClick={sendAsCustomer} style={mkBtn({ minHeight: 38, padding: "8px 14px", background: S.accent })}>Send as customer</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Arrives as a real inbound (window resets, unread). ✨ asks Gemini (via the local harness) to write the customer's next message — edit before sending.</div>
          </div>
        )}
      </Section>

      <Section>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8 }}>Sample data</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="mgt-hover-scale" style={mkBtn({ minHeight: 38, padding: "8px 12px", background: BTN.today })} onClick={onSeed}>Seed sample bookings</button>
          <button className="mgt-hover-scale" style={mkBtn({ minHeight: 38, padding: "8px 12px", background: BTN.del })} onClick={onClearBookings}>Clear WA-SIM bookings</button>
          <button className="mgt-hover-scale" style={mkBtn({ minHeight: 38, padding: "8px 12px", background: BTN.del })} onClick={onClearConvos}>Clear conversations</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>Seed first — the linked cancel/modify and Regular-chip scenarios reference these bookings.</div>
      </Section>

      <Section>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8 }}>Busy moment</div>
        <button className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "9px 14px", background: "var(--wa-sim-accent)", width: "100%" })} onClick={onBurst}>🌊 Simulate a burst (ongoing + new)</button>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>Moves the open conversations forward (a draft adds a detail, a confirmed booking asks to change, an unhandled request gets a nudge) and adds a couple of new ones.</div>
      </Section>

      {Object.keys(groups).map((g) => (
        <Section key={g}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8 }}>{g}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {groups[g].map((s) => (
              <div key={s.id}>
                <button className="mgt-hover-scale" style={mkBtn({ minHeight: 38, padding: "8px 12px", background: "var(--btn-default)", width: "100%", textAlign: "left" })} onClick={() => runScenario(s)}>{s.label}</button>
                {s.note ? <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "3px 2px 0" }}>{s.note}</div> : null}
              </div>
            ))}
          </div>
        </Section>
      ))}

      <Section>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 10 }}>Custom message</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Fld label="Phone"><input className="mgt-hover-scale" value={form.phone} onChange={upd("phone")} style={mkInp()} placeholder="+34600000000" /></Fld>
          <Fld label="Language">
            <select className="mgt-hover-scale" value={form.language} onChange={upd("language")} style={mkInp()}>
              <option value="es">ES</option><option value="en">EN</option>
            </select>
          </Fld>
          <Fld label="Intent">
            <select className="mgt-hover-scale" value={form.intent} onChange={upd("intent")} style={mkInp()}>
              <option value="new_booking">new_booking</option>
              <option value="cancel">cancel</option>
              <option value="modify">modify</option>
              <option value="question">question</option>
              <option value="other">other</option>
            </select>
          </Fld>
          <Fld label="Confidence">
            <select className="mgt-hover-scale" value={form.confidence} onChange={upd("confidence")} style={mkInp()}>
              <option value="high">high</option><option value="medium">medium</option><option value="low">low</option>
            </select>
          </Fld>
          <Fld label="Size"><input className="mgt-hover-scale" type="number" value={form.size} onChange={upd("size")} style={mkInp()} /></Fld>
          <Fld label="Date"><input className="mgt-hover-scale" type="date" value={form.date} onChange={upd("date")} style={mkInp()} /></Fld>
          <Fld label="Time"><input className="mgt-hover-scale" type="time" value={form.time} onChange={upd("time")} style={mkInp()} /></Fld>
          <Fld label="Message" style={{ gridColumn: "1 / -1" }}><textarea className="mgt-hover-scale" value={form.text} onChange={upd("text")} rows={2} style={Object.assign({}, mkInp(), { resize: "vertical" })} placeholder="What the customer typed…" /></Fld>
        </div>
        <button className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "9px 16px", background: S.accent, marginTop: 10 })} onClick={sendCustom}>Send custom message</button>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>Intent question/other → message only (no draft). Size/date/time apply to new_booking.</div>
      </Section>
    </Overlay>
  );
}
