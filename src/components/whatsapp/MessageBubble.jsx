// src/components/whatsapp/MessageBubble.jsx
// One chat bubble in a conversation thread. Incoming = left/light; outgoing =
// right/accent-blue with a delivery-status caption. The "auto" tag marks the
// language-matched auto-acknowledgment. Translucent white/black overlays on the
// saturated blue bubble are theme-invariant (same convention as the atoms).
//
// v18.8.0: a message with `media` draws it above its caption.
//   · a PHOTO is a thumbnail (THUMB square, cropped; the viewer shows it whole),
//     fetched once the bubble is in view, opening the photo viewer on a tap;
//   · a VOICE NOTE or AUDIO is a Play button, fetched on the press and then a
//     native <audio controls>;
//   · a DOCUMENT is a row (its name and size) that opens in a new tab, or is
//     saved when the browser could not show it safely (`opensInline`).
// The file is past Meta's keep after 7 days (received) or 30 (sent), computed
// from the message's time without a request (`mediaExpired`), and the bubble
// says so. The thumbnail's box is the same size before and after it loads, so a
// photo arriving never moves the thread under the reader.

import { useEffect, useRef, useState } from "react";
import { formatClockTime, mediaLabel, fileSizeLabel } from "../../lib/whatsapp";
import { opensInline } from "../../lib/wa-backend";
import { useWaMedia } from "../../hooks/useWaMedia";
import { R, T, FW, IC, SP, H } from "../../lib/constants";
import { OutlineChip } from "../atoms";
import { RetryIcon, PlayIcon, FileIcon, PhotoIcon } from "./WaIcons";

// The thumbnail's side: about a third of a tablet thread, under the bubble's
// 78% cap on a 375px phone.
const THUMB = 240;

const TOO_LARGE = "Too large to open here — open WhatsApp on the phone";
const GONE = "no longer on WhatsApp";

// A state line inside the bubble: an icon and a sentence, in the bubble's own
// ink (`currentColor`), muted by opacity so it reads the same on both bubbles.
function MediaNote({ icon, children, action }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: SP.snug, fontSize: T.body, flexWrap: "wrap" }}>
      <span style={{ opacity: 0.75, display: "flex" }}>{icon}</span>
      <span style={{ opacity: 0.85 }}>{children}</span>
      {action}
    </div>
  );
}

function RetryChip({ onRetry, autoFocus }) {
  return (
    <OutlineChip as="button" tone="danger" onClick={onRetry} autoFocus={autoFocus} className="mgt-hover-scale mgt-press"
      style={{ padding: "0 6px" }}><RetryIcon size={IC.inline} />Retry</OutlineChip>
  );
}

// Was this press made with focus on the control pressed? Then focus follows the
// press to whatever replaces the control (/code-review: the Play button gives
// way to the player or to the failure line, and focus fell to <body>).
function pressedWithFocus(e) {
  return typeof document !== "undefined" && document.activeElement === e.currentTarget;
}

// The ROUND control a voice note starts from, in the bubble's ink.
const roundBtn = {
  width: H.control, height: H.control, minWidth: H.control, borderRadius: "50%",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "transparent", color: "inherit", border: "1.5px solid currentColor", padding: 0, cursor: "pointer",
};

function MediaPhoto({ phoneKey, msg, onOpenPhoto }) {
  const boxRef = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (seen || !el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const m = useWaMedia(phoneKey, msg, seen || typeof IntersectionObserver === "undefined");
  // A Retry pressed with focus hands it on to the photo once it is here: the
  // chip leaves with the failure, and focus would fall to <body> (/code-review).
  const [handOn, setHandOn] = useState(false);
  if (m.status === "expired") return <MediaNote icon={<PhotoIcon size={IC.chrome} />}>{"Photo — " + GONE}</MediaNote>;
  if (m.status === "toolarge") return <MediaNote icon={<PhotoIcon size={IC.chrome} />}>{TOO_LARGE}</MediaNote>;
  if (m.status === "error") {
    return <MediaNote icon={<PhotoIcon size={IC.chrome} />} action={<RetryChip onRetry={(e) => { setHandOn(pressedWithFocus(e)); m.retry(); }} />}>Couldn’t load the photo</MediaNote>;
  }
  const box = { width: THUMB, height: THUMB, maxWidth: "100%", borderRadius: R.inset, display: "block" };
  if (m.status !== "ready") {
    return (
      <div ref={boxRef} role="img" aria-label="Photo, loading" style={Object.assign({}, box, {
        display: "flex", alignItems: "center", justifyContent: "center", background: "var(--wa-media-wait)",
      })}><span style={{ opacity: 0.6, display: "flex" }}><PhotoIcon size={IC.chrome} /></span></div>
    );
  }
  return (
    <button
      /* @no-lift a 240px photo scaled 8% grows 19px past the bubble it sits in; the press dip and the pointer say it opens */
      className="mgt-press" autoFocus={handOn} onClick={() => { if (onOpenPhoto) onOpenPhoto(msg); }}
      aria-label="Open photo" title="Open photo"
      style={{ padding: 0, border: 0, background: "var(--wa-media-wait)", borderRadius: R.inset, cursor: onOpenPhoto ? "zoom-in" : "default", display: "block" }}>
      {/* v18.8.0 follow-up: the photo fades in over the waiting box's own fill
          (`.mgt-appear`, --t-move ease-out, the timeline ghosts' entrance),
          where it replaced the box in one frame. A keyframe on mount and not
          an opacity transition on `onLoad`: a blob decodes before the first
          paint, so the transition measured as never starting. A photo already
          downloaded still stands as the box for a frame first (the
          IntersectionObserver gate above), so this replaces that flash rather
          than animating history. No way out to animate: a photo leaves only
          with its whole thread. */}
      <img className="mgt-appear" src={m.url} alt="" draggable="false" style={Object.assign({}, box, { objectFit: "cover" })} />
    </button>
  );
}

function MediaAudio({ phoneKey, msg }) {
  const [want, setWant] = useState(false);
  // Focus follows a press made with focus on the button: to the player once it
  // arrives (once, then it is the user's again), or to Retry if it fails.
  const [handOn, setHandOn] = useState(false);
  const m = useWaMedia(phoneKey, msg, want);
  const label = mediaLabel(msg.media);
  if (m.status === "expired") return <MediaNote icon={<PlayIcon size={IC.chrome} />}>{label + " — " + GONE}</MediaNote>;
  if (m.status === "toolarge") return <MediaNote icon={<PlayIcon size={IC.chrome} />}>{TOO_LARGE}</MediaNote>;
  if (m.status === "error") {
    return <MediaNote icon={<PlayIcon size={IC.chrome} />} action={<RetryChip autoFocus={handOn} onRetry={(e) => { setHandOn(pressedWithFocus(e)); m.retry(); }} />}>{"Couldn’t load the " + label.toLowerCase()}</MediaNote>;
  }
  if (m.status === "ready") {
    return <audio controls autoPlay src={m.url} aria-label={label} style={{ width: THUMB, maxWidth: "100%", display: "block" }}
      ref={(el) => { if (el && handOn) { el.focus(); setHandOn(false); } }} />;
  }
  // Not `disabled` while it loads: Chrome blurs a focused control that becomes
  // disabled (measured in phase 8), so the press would drop focus on <body>.
  // `aria-disabled` says it, and the press does nothing.
  const loading = m.status === "loading";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: SP.base }}>
      <button className={loading ? "mgt-nopress" : "mgt-hover-scale mgt-press"}
        // Mounted again by Retry, which hands focus on through it to the player.
        autoFocus={handOn}
        onClick={(e) => { if (loading) return; setHandOn(pressedWithFocus(e)); setWant(true); }}
        aria-disabled={loading ? "true" : undefined}
        aria-label={"Play " + label.toLowerCase()} title={"Play " + label.toLowerCase()}
        style={Object.assign({}, roundBtn, { opacity: loading ? 0.6 : 1, cursor: loading ? "default" : "pointer" })}><PlayIcon size={IC.chrome} /></button>
      <span style={{ fontSize: T.body, fontWeight: FW.medium }}>{loading ? "Loading…" : label}</span>
    </div>
  );
}

// Open a fetched document: in the tab opened at the press when there is one,
// else by saving it. A blob URL from this origin is only OPENED for a type that
// cannot run (`opensInline`); anything else is saved under its own name.
function saveFile(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function MediaDocument({ phoneKey, msg }) {
  const [want, setWant] = useState(false);
  const m = useWaMedia(phoneKey, msg, want);
  const winRef = useRef(null);
  const pendingRef = useRef(false);
  const media = msg.media;
  const name = media.filename || "Document";
  // A tab opened AFTER the download would be a popup the browser blocks, so it
  // is opened blank at the press and pointed at the file when it arrives. An
  // installed iPhone/iPad app keeps blob URLs to itself, so there it is saved.
  const standalone = typeof navigator !== "undefined" && navigator.standalone === true;
  useEffect(() => {
    if (!pendingRef.current) return;
    if (m.status === "ready") {
      pendingRef.current = false;
      const w = winRef.current;
      winRef.current = null;
      if (w && !w.closed && opensInline(m.type)) w.location.href = m.url;
      else { if (w && !w.closed) w.close(); saveFile(m.url, media.filename); }
    } else if (m.status !== "loading") {
      pendingRef.current = false;
      const w = winRef.current;
      winRef.current = null;
      if (w && !w.closed) w.close();
    }
  }, [m.status, m.url, m.type, media.filename]);
  function open() {
    if (m.status === "loading") return; // aria-disabled, see the button
    if (m.status === "ready") {
      if (opensInline(m.type) && !standalone) {
        const w = window.open(m.url, "_blank");
        if (!w) saveFile(m.url, media.filename);
      } else saveFile(m.url, media.filename);
      return;
    }
    pendingRef.current = true;
    if (!standalone && opensInline(media.mime)) {
      const w = window.open("", "_blank");
      if (w) { w.opener = null; winRef.current = w; }
    }
    if (m.status === "error") m.retry();
    setWant(true);
  }
  if (m.status === "expired") return <MediaNote icon={<FileIcon size={IC.chrome} />}>{name + " — " + GONE}</MediaNote>;
  if (m.status === "toolarge") return <MediaNote icon={<FileIcon size={IC.chrome} />}>{TOO_LARGE}</MediaNote>;
  const loading = m.status === "loading";
  const size = fileSizeLabel(media.size);
  // `aria-disabled` while it loads, not `disabled`: the same row comes back
  // after a failure to be pressed again, and a disabled one would have
  // dropped the focus that pressed it (/code-review).
  return (
    <button className={loading ? "mgt-nopress" : "mgt-hover-scale mgt-press"} onClick={open}
      aria-disabled={loading ? "true" : undefined}
      aria-label={"Open " + name} title={"Open " + name}
      style={{
        display: "flex", alignItems: "center", gap: SP.base, width: THUMB, maxWidth: "100%", textAlign: "left",
        padding: "6px 10px", minHeight: H.control, borderRadius: R.inset, cursor: loading ? "default" : "pointer",
        background: "transparent", color: "inherit", border: "1.5px solid currentColor",
      }}>
      <span style={{ display: "flex", flexShrink: 0 }}><FileIcon size={IC.chrome} /></span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: T.body, fontWeight: FW.semi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <span style={{ display: "block", fontSize: T.small, opacity: 0.8 }}>
          {loading ? "Opening…" : m.status === "error" ? "Couldn’t open — tap to try again" : (size ? size + " · " : "") + "Open"}
        </span>
      </span>
    </button>
  );
}

function MediaBlock({ phoneKey, msg, onOpenPhoto }) {
  const kind = msg.media.kind;
  if (kind === "image") return <MediaPhoto phoneKey={phoneKey} msg={msg} onOpenPhoto={onOpenPhoto} />;
  if (kind === "audio") return <MediaAudio phoneKey={phoneKey} msg={msg} />;
  return <MediaDocument phoneKey={phoneKey} msg={msg} />;
}

// `isLast` (set by ConversationView for the newest message only) opts the bubble
// into the `mgt-bubble-in` ease — so a freshly-arrived/sent message rises in, but
// opening a thread doesn't cascade-animate the whole history.
export function MessageBubble({ msg, isLast, onRetry, phoneKey, onOpenPhoto }) {
  const incoming = msg.direction === "in";
  const bg = incoming ? "var(--wa-bubble-in)" : "var(--wa-bubble-out)";
  const color = incoming ? "var(--text-primary)" : "var(--text-on-accent)";
  const border = incoming ? "1px solid var(--wa-bubble-in-border)" : "1px solid var(--wa-bubble-out-border)";
  const align = incoming ? "flex-start" : "flex-end";
  const media = msg.media && msg.media.kind ? msg.media : null;
  // The stored text of a media message is its caption, or the label written in
  // its place for a build that cannot draw media ("Photo"); the block draws
  // the label itself, so only a real caption is printed under it.
  const caption = media ? (msg.text && msg.text !== mediaLabel(media) ? msg.text : "") : msg.text;

  // The meta row these three live in sits BELOW the bubble, on the panel — not
  // inside it. They were coloured as if they were inside: white-on-white
  // literals picked against the blue outgoing bubble, rendered over a near-white
  // panel. In light mode "auto · delivered" was invisible and "· failed" nearly
  // so; in dark mode all three read fine, which is why it survived. Same shape
  // as the fills this version made opaque — dark is the easy case.
  // They take the row's own tokens now, and `auto` is TEXT rather than a chip:
  // it sits among plain text and the row is already muted.
  const ackTag = msg.isAutoAck ? (
    <span style={{ fontSize: T.micro, fontWeight: FW.regular, color: "var(--text-muted)", marginLeft: 6, fontStyle: "italic" }}>auto</span>
  ) : null;

  let statusEl = null;
  if (!incoming && msg.status) {
    const map = { sending: "· sending", delivered: "· delivered", read: "· read", failed: "· failed" };
    const statColor = msg.status === "failed" ? "var(--danger-text)" : "var(--text-muted)";
    statusEl = <span style={{ fontSize: T.micro, color: statColor, marginLeft: 4 }}>{map[msg.status] || ""}</span>;
  }

  // Retry affordance for a failed outgoing send (client mock path — see
  // useWhatsApp.handleResend). Only shown when a resend handler is wired, and
  // never on a photo or a PDF (v18.8.0): a resend posts the message's TEXT,
  // which for media is its caption or the word "Photo".
  const retryEl = (!incoming && msg.status === "failed" && onRetry && !media) ? (
    <OutlineChip
      as="button"
      tone="danger"
      onClick={() => onRetry(msg.id)}
      className="mgt-hover-scale mgt-press"
      title="Resend this message"
      style={{ marginLeft: 6, padding: "0 6px" }}
    ><RetryIcon size={IC.inline} />Retry</OutlineChip>
  ) : null;

  return (
    <div className={isLast ? "mgt-bubble-in" : undefined} style={{ display: "flex", justifyContent: align, marginBottom: 8 }}>
      <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: align }}>
        {/* The one DELIBERATE radius literal left in the WA module (v17.7.0
            token sweep). The chat bubble's corner is the module's visual
            identity, not a card: it must not follow --r-card if that token is
            ever retuned, and it cannot be a pill — the bubble wraps to any
            height, and on --r-pill a multi-line bubble's corner curve eats the
            first and last characters (the same trap that produced mkArea). */}
        <div style={{ background: bg, color, border, borderRadius: 14 /* @canvas */, padding: media && media.kind === "image" ? SP.tight : "8px 12px", fontSize: T.lead, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word", boxShadow: "var(--shadow-soft)", opacity: msg.status === "sending" ? 0.7 : 1 }}>
          {media ? <MediaBlock phoneKey={phoneKey} msg={msg} onOpenPhoto={onOpenPhoto} /> : null}
          {caption ? <div style={media ? { marginTop: SP.snug, padding: media.kind === "image" ? "0 8px 4px" : 0 } : undefined}>{caption}</div> : null}
        </div>
        <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: 2, padding: "0 4px", display: "flex", alignItems: "center" }}>
          {formatClockTime(msg.ts)}{ackTag}{statusEl}{retryEl}
        </div>
      </div>
    </div>
  );
}
