// src/components/UpdateRequired.jsx
//
// v18.6.0 — the "refresh this device" card (the minimum schema gate,
// lib/schema.js). Shown when the database is ahead of this build: a newer
// version of the app stores something this one does not know, so this device
// would delete it on its next save, and every write is refused until the page
// is reloaded.
//
// It cannot be dismissed (Patryk, 2026-10-09): `onClose` does nothing, so a
// click on the scrim and Escape leave it up, and there is one button. Nothing
// reloads by itself, so an open form is never lost without a tap. A reload
// fetches the new build: `public/sw.js` is network-first for the page.
import { Overlay, mkBtn } from "./atoms";
import { S, T, FW } from "../lib/constants";

function stay() {}

export default function UpdateRequired({ onRefresh }) {
  return (
    <Overlay /* @static-height two fixed sentences, nothing in it changes while it is open */ onClose={stay} footer={
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="mgt-hover-scale" onClick={onRefresh}
          style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--accent)" })}>Refresh</button>
      </div>
    }>
      <h2 style={{ fontSize: T.title, fontWeight: FW.bold, margin: 0, marginBottom: 8, color: S.text }}>This device needs refreshing</h2>
      <div style={{ fontSize: T.lead, color: S.text, marginBottom: 18 }}>
        A newer version of the app is in use on another device. Until this one is refreshed it cannot save anything. Anything not saved yet on this device will be lost.
      </div>
    </Overlay>
  );
}
