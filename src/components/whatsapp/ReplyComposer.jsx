// src/components/whatsapp/ReplyComposer.jsx
// The reply box at the bottom of a conversation: a horizontally-scrolling row of
// quick-reply template chips (with an EN/ES toggle defaulting to the detected
// conversation language) above a textarea + Send. Disabled when the 24h service
// window has expired. Enter sends; Shift+Enter inserts a newline.
//
// v18.8.0: **Attach** (the paperclip) sends a photo or a PDF, with whatever is
// typed as its caption, as ONE message. The picked file shows as a chip above
// the box (✕ removes it) and goes when Send is pressed. A photo is shrunk here
// first (`shrinkPhoto`, lib/wa-attach.js); a PDF over the cap, or any other kind
// of file, is refused here with a sentence. Only where sends go through the
// server (`onSendMedia` is null otherwise: the sandbox's client mock).
//
// The file belongs to the THREAD it was picked in (`threadKey`). This component
// is not remounted when another conversation is opened, so a file kept in plain
// state would follow the user to the next customer and be sent there. Every
// piece of attachment state carries its key and is read only for its own.

import { useState, useRef, useEffect, useImperativeHandle } from "react";
import { Reveal, mkSolidBtn, InlineAlert } from "../atoms";
import { CloseIcon } from "../Icons";
import { TemplatesIcon, PaperclipIcon, FileIcon } from "./WaIcons";
import { R, T, FW, M, H, IC, SP, REVEAL_EXIT_MS } from "../../lib/constants";
import { fileSizeLabel, WA_CAPTION_MAX } from "../../lib/whatsapp";
import { attachKind, attachRefusal, shrinkPhoto } from "../../lib/wa-attach";

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

  // EN/ES switch — eases its active highlight (`background-color`/`color`) on
  // `M.tap`, the same curve as its hover lift's `transform`.
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
// v18.2.0 (W5): a touch screen, by the stylesheet's own test. Read once — a
// device does not stop being a touch screen while the inbox is open.
const TOUCH = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(hover: none), (pointer: coarse)").matches;

// The round button beside the box: Insert template and Attach.
const sideBtn = (on) => ({
  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
  background: on ? "var(--accent)" : "var(--wa-row-bg)",
  border: "1px solid " + (on ? "var(--accent)" : "var(--wa-bubble-in-border)"),
  borderRadius: R.pill, padding: SP.mid, cursor: "pointer",
  color: on ? "var(--text-on-accent)" : "var(--text-primary)",
  minHeight: H.touch, minWidth: H.touch, boxShadow: "var(--shadow-btn)",
  transition: "background-color " + M.tap + ", color " + M.tap + ", transform " + M.tap,
});

// The picked file, above the box. A photo shows itself small; a PDF its name.
function AttachChip({ att, busy, onRemove }) {
  const photo = att.kind === "image";
  const name = photo ? "Photo" : att.name;
  return (
    <div role="group" aria-label={"Attached: " + name} style={{
      display: "flex", alignItems: "center", gap: SP.base, maxWidth: 360, minWidth: 0,
      padding: SP.snug, paddingLeft: SP.base, borderRadius: R.inset,
      background: "var(--wa-row-bg)", border: "1px solid var(--wa-bubble-in-border)",
      color: "var(--text-primary)",
    }}>
      {photo
        ? <img src={att.url} alt="" style={{ width: H.control, height: H.control, objectFit: "cover", borderRadius: R.inset, flexShrink: 0 }} />
        : <span style={{ display: "flex", flexShrink: 0 }}><FileIcon size={IC.chrome} /></span>}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: T.body, fontWeight: FW.semi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <span style={{ display: "block", fontSize: T.small, color: "var(--text-muted)" }}>{busy ? "Sending…" : fileSizeLabel(att.size)}</span>
      </span>
      <button className="mgt-hover-scale mgt-press" onClick={onRemove} disabled={busy}
        aria-label={photo ? "Remove the photo" : "Remove " + att.name} title="Remove"
        style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", minWidth: H.touch, minHeight: H.touch, background: "transparent", border: "none", borderRadius: R.pill, color: "var(--text-muted)", cursor: busy ? "default" : "pointer" }}>
        <CloseIcon size={IC.control} />
      </button>
    </div>
  );
}

export function ReplyComposer({ onSend, disabled, templates, convLang, onSendMedia, threadKey, ref }) {
  // The text is kept PER THREAD, like the attachment below: this component is
  // not remounted when the conversation changes, so one string followed you to
  // the next customer, and since v18.8.0 that string can be a photo's caption.
  // Each thread keeps its own draft, as WhatsApp does.
  const [drafts, setDrafts] = useState({});
  const txt = drafts[threadKey] || "";
  // `next` is a string or an updater; `key` defaults to the open thread.
  function setTxt(next, key) {
    const k = key === undefined ? threadKey : key;
    setDrafts((d) => {
      const v = typeof next === "function" ? next(d[k] || "") : next;
      const out = Object.assign({}, d);
      if (v) out[k] = v; else delete out[k];
      return out;
    });
  }
  const [tplOpen, setTplOpen] = useState(false);
  // Attachment state, each piece keyed to the thread it belongs to.
  const [attState, setAttState] = useState(null);   // {key, blob, url?, name, size, mime, kind}
  const [noteState, setNoteState] = useState(null); // {key, text}: a refusal or a failed send
  const [busyKey, setBusyKey] = useState(null);     // the thread a send is in flight for
  const [readyKey, setReadyKey] = useState(null);   // the thread a photo is being shrunk for
  const areaRef = useRef(null);
  const fileRef = useRef(null);
  const threadRef = useRef(threadKey);
  useEffect(() => { threadRef.current = threadKey; }, [threadKey]);
  const att = attState && attState.key === threadKey ? attState : null;
  const note = noteState && noteState.key === threadKey ? noteState.text : "";
  const busy = busyKey !== null && busyKey === threadKey;
  const preparing = readyKey !== null && readyKey === threadKey;
  const canAttach = !!onSendMedia && !disabled;
  // A photo's preview URL is given back once the chip has folded away.
  useEffect(() => {
    const url = attState && attState.url;
    if (!url) return undefined;
    return () => { setTimeout(() => URL.revokeObjectURL(url), REVEAL_EXIT_MS); };
  }, [attState]);

  const caption = txt.trim();
  const captionLong = !!att && caption.length > WA_CAPTION_MAX;

  async function send() {
    if (att) {
      if (busy || captionLong || !onSendMedia) return;
      const key = threadKey;
      setBusyKey(key);
      setNoteState(null);
      try {
        const r = await onSendMedia(att.blob, { mime: att.mime, filename: att.kind === "document" ? att.name : "", caption });
        setAttState((cur) => (cur && cur.key === key ? null : cur));
        // The text was this thread's caption, wherever you are now.
        setTxt("", key);
        // The customer has it, and the thread does not (the server could not
        // store it): said here, so nobody sends it a second time.
        if (r && r.stored === false) setNoteState({ key, text: "Sent to the customer, but it could not be saved in this thread. Don’t send it again." });
      } catch (e) {
        // The server says "send failed: <Meta's reason>"; the sentence already says it.
        const why = e && e.message ? e.message.replace(/^send failed:\s*/i, "") : "unknown error";
        setNoteState({ key, text: "Couldn’t send: " + why + ". The file is still attached." });
      } finally {
        setBusyKey((cur) => (cur === key ? null : cur));
      }
      return;
    }
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
  // v18.8.0 phase 8: the draft card's "Suggest these" puts its reply in here
  // the way a template chip does (after what is typed, then the focus), so
  // staff read it and press Send themselves. No deps: the handle is rebuilt
  // each render, so it always writes to the open thread.
  useImperativeHandle(ref, () => ({ insert: insertTemplate }));
  async function onPick(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = ""; // so picking the same file again still fires
    if (!f) return;
    const key = threadKey;
    const refusal = attachRefusal(f);
    if (refusal) { setNoteState({ key, text: refusal }); return; }
    setNoteState(null);
    if (attachKind(f) === "pdf") {
      setAttState({ key, blob: f, name: f.name || "document.pdf", size: f.size, mime: "application/pdf", kind: "document" });
      // The caption is what comes next, as after a photo.
      if (areaRef.current) areaRef.current.focus();
      return;
    }
    setReadyKey(key);
    try {
      const blob = await shrinkPhoto(f);
      setAttState({ key, blob, url: URL.createObjectURL(blob), name: f.name || "photo.jpg", size: blob.size, mime: "image/jpeg", kind: "image" });
    } catch {
      setNoteState({ key, text: "This photo could not be read. Try another, or send it from WhatsApp on the phone." });
    } finally {
      setReadyKey((cur) => (cur === key ? null : cur));
    }
    if (threadRef.current === key && areaRef.current) areaRef.current.focus();
  }
  function removeAtt() {
    setAttState(null);
    setNoteState(null);
  }
  // E → toggle the quick-reply template chips (handled here so the composer owns
  // its own state; only fires when not typing in an input/textarea).
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      // Letters only, for the same two reasons as InboxPanel's copy — see the
      // note there. Both shortcuts here happen to BE letters, so the narrower
      // test costs nothing today and stops the next non-letter shortcut added
      // to this handler from being silently unreachable on a Spanish keyboard.
      if (e.shiftKey && /^[a-z]$/.test(k)) return;
      if (k === "e") { e.preventDefault(); setTplOpen((v) => !v); }
      // C → focus the reply box (no-op when the window is closed / disabled).
      else if (k === "c" && !disabled && areaRef.current) { e.preventDefault(); areaRef.current.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled]);
  const canSend = !disabled && !busy && !preparing && (att ? !captionLong : !!txt.trim());
  const sayLong = captionLong ? "A caption can be up to " + WA_CAPTION_MAX.toLocaleString("en") + " characters; this one has " + caption.length.toLocaleString("en") + "." : "";
  const alertText = note || sayLong;
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
      {/* v18.8.0: the picked file, and why one was refused or failed. The
          alert region is always mounted, so a sentence arriving in it is read
          out (the live-region rule); its contents ease in and out. */}
      <Reveal show={!!att}>
        {att ? <div style={{ paddingBottom: SP.base, minWidth: 0 }}><AttachChip att={att} busy={busy} onRemove={removeAtt} /></div> : null}
      </Reveal>
      <div role="alert">
        <Reveal show={!!alertText}>
          {alertText ? <InlineAlert style={{ marginBottom: SP.base }}>{alertText}</InlineAlert> : null}
        </Reveal>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <button
          onClick={() => setTplOpen((v) => !v)}
          aria-pressed={tplOpen}
          // v18.2.0 (W2): "Insert template" — it shows the chips that put one
          // into this reply. The header's button, which EDITS them, had the
          // same name and icon.
          aria-label="Insert template"
          title="Insert template (E)"
          className="mgt-hover-scale mgt-press"
          style={sideBtn(tplOpen)}
        ><TemplatesIcon size={IC.chrome} /></button>
        {onSendMedia ? (
          <button
            onClick={() => { if (fileRef.current) fileRef.current.click(); }}
            disabled={!canAttach || busy || preparing}
            aria-label="Attach a photo or a PDF"
            title="Attach a photo or a PDF"
            className="mgt-hover-scale mgt-press"
            style={Object.assign(sideBtn(false), { opacity: canAttach ? 1 : 0.6, cursor: canAttach ? "pointer" : "not-allowed" })}
          ><PaperclipIcon size={IC.chrome} /></button>
        ) : null}
        {/* The picker itself: never focused or seen, the button above opens it. */}
        {onSendMedia ? <input /* @no-lift never rendered: the hidden file picker the paperclip opens */ ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onPick} /> : null}
        {/* Named for the same reason as the inbox search: the placeholder is
            the only text near this control and it disappears once you type. */}
        <textarea /* @no-lift a full-width text field, the inbox-search reason one control over */
          ref={areaRef}
          aria-label={att ? "Caption" : "Reply message"}
          value={txt}
          // A refusal or a failed send leaves when you type, as InlineAlert
          // does in a form: it is about what you did, and you are moving on.
          onChange={(e) => { setTxt(e.target.value); if (note) setNoteState(null); }}
          onKeyDown={onKey}
          // v18.2.0 (W5): the Enter / Shift+Enter hint only where there is a
          // keyboard to press them on — on a touch screen it spent two lines of
          // a phone's composer on keys the on-screen keyboard does not have.
          // index.css's own touch query (`hover: none`, `pointer: coarse`).
          placeholder={disabled ? "Conversation closed" : att ? "Add a caption (optional)" : preparing ? "Preparing the photo…" : (TOUCH ? "Type a reply…" : "Type a reply... (Enter to send, Shift+Enter for new line)")}
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
          style={mkSolidBtn(canSend ? "var(--wa-green-dark)" : "var(--btn-default)", { padding: "10px 18px", cursor: canSend ? "pointer" : "not-allowed", fontSize: T.body, minHeight: H.touch, boxShadow: "var(--shadow-btn)" })}
        >{busy ? "Sending…" : "Send"}</button>
      </div>
    </div>
  );
}
