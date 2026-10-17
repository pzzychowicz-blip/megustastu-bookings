// src/components/whatsapp/PhotoViewer.jsx
//
// v18.8.0 — a photo from a WhatsApp conversation, whole. Opened by tapping its
// thumbnail (MessageBubble), over the inbox. Built on `Overlay` like every
// modal, so it gets the scrim, the phone sheet, focus trap and return, and the
// open and close transition from `ModalPresence` at its mount site. It is an
// entry in the modal stack (`waphoto`, MODAL_Z), so Escape closes it before the
// inbox under it, and the ✕-less footer's Done and the scrim do the same.
//
// It reads the photo through `useWaMedia`, the same blob URL the thumbnail
// already holds, so opening it starts no second download. `photo` is the
// payload App stored: `{phoneKey, msg}`, a snapshot of the message.

import { useWaMedia } from "../../hooks/useWaMedia";
import { formatClockTime, mediaLabel } from "../../lib/whatsapp";
import { S, R, T, FW, SP, IC } from "../../lib/constants";
import { Overlay, AutoHeight, mkBtn } from "../atoms";
import { PhotoIcon } from "./WaIcons";

// The saved file's extension, from what the server says the photo is.
const PHOTO_EXT = { "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

export function PhotoViewer({ photo, onClose }) {
  const msg = photo.msg;
  const m = useWaMedia(photo.phoneKey, msg, true);
  const caption = msg.text && msg.text !== mediaLabel(msg.media) ? msg.text : "";
  // v18.9.0: a photo staff sent from the WhatsApp Business app says so.
  const from = msg.direction === "in" ? "From the customer" : msg.source === "phone" ? "Sent from the phone" : "Sent";
  // `alignItems: center`: a flex row stretches its items to the tallest, so one
  // control taller than 44 made the other as tall too.
  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: SP.base, flexWrap: "wrap" }}>
      {/* A link, because a download needs `href` + `download`. A <button> is
          border-box by default and a link is not, so without `boxSizing` its
          44px floor was the CONTENT's and it measured 66px (Patryk: "gigantic"),
          stretching Done beside it to match. */}
      {m.status === "ready" ? (
        <a className="mgt-hover-scale mgt-press" href={m.url}
          download={"whatsapp-photo-" + msg.id + (PHOTO_EXT[String(m.type || "").split(";")[0].trim()] || ".jpg")}
          style={mkBtn({ minHeight: 44, padding: "10px 18px", boxSizing: "border-box", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" })}>Save photo</a>
      ) : null}
      <button className="mgt-hover-scale mgt-press" onClick={onClose}
        style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })}>Done</button>
    </div>
  );
  let body;
  if (m.status === "ready") {
    body = <img src={m.url} alt={caption || "Photo"} style={{ display: "block", maxWidth: "100%", maxHeight: "70dvh", margin: "0 auto", borderRadius: R.inset }} />;
  } else {
    const line = m.status === "loading" || m.status === "idle" ? "Loading the photo…"
      : m.status === "expired" ? "This photo is no longer on WhatsApp."
        : m.status === "toolarge" ? "Too large to open here — open WhatsApp on the phone." : "Couldn’t load the photo.";
    body = (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: SP.base, paddingTop: SP.xl, paddingBottom: SP.xl, color: S.muted, fontSize: T.body }}>
        <PhotoIcon size={IC.chrome} />
        <span>{line}</span>
      </div>
    );
  }
  return (
    <Overlay onClose={onClose} footer={footer} maxWidth={900}>
      <AutoHeight watch={m.status}>
        <h2 style={{ fontSize: T.title, fontWeight: FW.bold, margin: 0, marginBottom: SP.base, color: S.text }}>
          {"Photo"}<span style={{ fontSize: T.body, fontWeight: FW.regular, color: S.muted }}>{" · " + from + " · " + formatClockTime(msg.ts)}</span>
        </h2>
        {body}
        {caption ? <div style={{ marginTop: SP.base, fontSize: T.lead, color: S.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{caption}</div> : null}
      </AutoHeight>
    </Overlay>
  );
}
