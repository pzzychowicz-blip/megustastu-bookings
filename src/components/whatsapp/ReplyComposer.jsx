// src/components/whatsapp/ReplyComposer.jsx
// The reply box at the bottom of a conversation: a horizontally-scrolling row of
// quick-reply template chips (with an EN/ES toggle defaulting to the detected
// conversation language) above a textarea + Send. Disabled when the 24h service
// window has expired. Enter sends; Shift+Enter inserts a newline.

import { useState, useRef, useEffect } from "react";
import { Reveal } from "../atoms";
import { TemplatesIcon } from "./WaIcons";
import { R, T, FW, M } from "../../lib/constants";

// TemplateChips — private to the composer. Tapping a chip inserts its text.
// scrollLang (compact mode): the language switch joins the chips inside ONE
// horizontal scroller (so a narrow screen scrolls across everything incl. the
// switch). Otherwise (laptop) the switch stays pinned right and only the chips
// scroll — preserving the original layout.
function TemplateChips({ templates, convLang, onInsert, scrollLang }) {
  const [outLang, setOutLang] = useState(convLang || "es");
  useEffect(() => { setOutLang(convLang || "es"); }, [convLang]);

  const chipBtns = templates.map((t) => (
    <button
      key={t.id}
      className="mgt-hover-scale"
      onClick={() => onInsert(outLang === "es" ? t.textEs : t.textEn)}
      style={{ flexShrink: 0, background: "var(--wa-row-bg)", border: "1px solid var(--wa-bubble-in-border)", borderRadius: R.pill, padding: "6px 12px", cursor: "pointer", fontSize: T.body, fontWeight: FW.semi, color: "var(--text-primary)", boxShadow: "var(--shadow-btn)", whiteSpace: "nowrap" }}
    >{outLang === "es" ? t.labelEs : t.labelEn}</button>
  ));

  // EN/ES switch — eases its active highlight like the app's Toggle atom
  // (`background-color`/`color` 160ms linear), per the shared toggle CSS.
  const langSwitch = (
    <div style={{ display: "flex", gap: 2, flexShrink: 0, background: "var(--wa-row-bg)", border: "1px solid var(--wa-bubble-in-border)", borderRadius: R.pill, padding: 2 }}>
      {["en", "es"].map((l) => (
        <button
          key={l}
          className="mgt-hover-scale"
          onClick={() => setOutLang(l)}
          style={{ background: outLang === l ? "var(--accent)" : "transparent", color: outLang === l ? "var(--text-on-accent)" : "var(--text-primary)", border: "none", borderRadius: R.pill, padding: "4px 10px", fontSize: T.small, fontWeight: FW.semi, cursor: "pointer", textTransform: "uppercase", transition: "background-color " + M.tap + ", color " + M.tap + ", transform " + M.tap }}
        >{l}</button>
      ))}
    </div>
  );

  // Padding gives the .mgt-hover-scale chips room to scale without being clipped
  // by overflow-x:auto (which also clips the y axis); the matching negative
  // margin keeps the composer's height/layout unchanged.
  // keyed by outLang → the chip set crossfades when toggling EN⇄ES.
  if (scrollLang) {
    return (
      <div key={outLang} className="mgt-fade-in" style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", padding: "8px 8px", margin: "-8px 0", minWidth: 0 }}>
        {chipBtns}
        {langSwitch}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div key={outLang} className="mgt-fade-in" style={{ flex: 1, overflowX: "auto", display: "flex", gap: 6, padding: "8px 8px", margin: "-8px 0" }}>
        {chipBtns}
      </div>
      {langSwitch}
    </div>
  );
}

// NB (lint cleanup, 17.4.1 sync): this used to take a `compact` prop, but the
// only thing it could have driven — TemplateChips' `scrollLang` below — is
// passed UNCONDITIONALLY, so the prop was already dead. Removed rather than
// re-wired: making scrollLang conditional again would change the layout, which
// a lint pass must not do. If the pinned-right language switch is wanted back
// at laptop widths, that's a deliberate UI change — see scrollLang's comment.
export function ReplyComposer({ onSend, disabled, templates, convLang }) {
  const [txt, setTxt] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const areaRef = useRef(null);
  function send() {
    const t = txt.trim();
    if (!t) return;
    onSend(t);
    setTxt("");
  }
  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }
  function insertTemplate(text) {
    setTxt((cur) => (cur ? cur + " " + text : text));
    if (areaRef.current) areaRef.current.focus();
  }
  // E → toggle the quick-reply template chips (handled here so the composer owns
  // its own state; only fires when not typing in an input/textarea).
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "e") { e.preventDefault(); setTplOpen((v) => !v); }
      // C → focus the reply box (no-op when the window is closed / disabled).
      else if (k === "c" && !disabled && areaRef.current) { e.preventDefault(); areaRef.current.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled]);
  const canSend = !disabled && !!txt.trim();
  return (
    <div style={{ borderTop: "1px solid var(--wa-divider)", padding: "10px 12px", background: "var(--wa-list-bg)" }}>
      {/* v15.8.2-wa-sandbox: the Templates trigger became an icon button that
          lives in the input row (left of the textarea). The chip strip reveals
          above the row when toggled.
          The local gridTemplateColumns:minmax(0,1fr) override that used to sit
          here is gone: it was a call-site patch for the Reveal grid ITEM
          refusing to shrink below its content width, which the atom now fixes
          for every caller via minWidth:0 on its inner track. Keeping both would
          leave two mechanisms guarding one failure, and invite someone to
          remove the wrong half. */}
      <Reveal show={tplOpen}>
        <div style={{ paddingBottom: 8, minWidth: 0 }}><TemplateChips templates={templates} convLang={convLang} onInsert={insertTemplate} scrollLang /></div>
      </Reveal>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <button
          onClick={() => setTplOpen((v) => !v)}
          title="Templates"
          className="mgt-hover-scale mgt-press"
          style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: tplOpen ? "var(--accent)" : "var(--wa-row-bg)", border: "1px solid " + (tplOpen ? "var(--accent)" : "var(--wa-bubble-in-border)"), borderRadius: R.pill, padding: "10px", cursor: "pointer", color: tplOpen ? "var(--text-on-accent)" : "var(--text-primary)", minHeight: 44, minWidth: 44, boxShadow: "var(--shadow-btn)", transition: "background-color " + M.tap + ", color " + M.tap + ", transform " + M.tap }}
        ><TemplatesIcon size={18} /></button>
        <textarea
          ref={areaRef}
          value={txt}
          onChange={(e) => setTxt(e.target.value)}
          onKeyDown={onKey}
          placeholder={disabled ? "Conversation closed" : "Type a reply... (Enter to send, Shift+Enter for new line)"}
          disabled={disabled}
          rows={2}
          // NOT a pill, deliberately — R.inset instead (v17.7.0 sweep).
          // This box is `rows={2}` + resize:"none", so it does not grow: a reply
          // longer than two lines SCROLLS, and that is the normal case here (the
          // placeholder itself advertises Shift+Enter for a new line). Once the
          // content overflows, `alignContent:"center"` stops applying — text
          // starts hard at the top, where a --r-pill corner (999px clamps to
          // half of ~55px ≈ 27px) reaches ~26px inward and slices the topmost
          // visible line. mkArea's centring only rescues the SHORT-content case.
          // At R.inset the corner reaches at most 10px, inside the 12px padding,
          // so no line can be clipped at any scroll position.
          style={{ flex: 1, boxSizing: "border-box", background: "var(--bg-input)", border: "1px solid var(--border-input)", borderRadius: R.inset, padding: "10px 12px", fontSize: T.lead, color: "var(--text-primary)", fontWeight: FW.regular, resize: "none", fontFamily: "inherit", minHeight: 44, boxShadow: "var(--shadow-input)", opacity: disabled ? 0.6 : 1 }}
        />
        <button
          onClick={send}
          disabled={!canSend}
          className="mgt-hover-scale mgt-press"
          style={{ background: canSend ? "var(--wa-green-dark)" : "var(--btn-default)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: R.pill, padding: "10px 18px", cursor: canSend ? "pointer" : "not-allowed", fontSize: T.body, fontWeight: FW.semi, color: "var(--text-on-accent)", minHeight: 44, boxShadow: "var(--shadow-btn)" }}
        >Send</button>
      </div>
    </div>
  );
}
