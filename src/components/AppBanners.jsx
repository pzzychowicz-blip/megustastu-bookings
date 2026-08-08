// ── AppBanners ───────────────────────────────────────────────────────────────
// v17.3.4: extracted VERBATIM from App.jsx (de-monolith extraction #2 — the
// v15.8.0 "Notification layout" in-flow family). Renders the three PERSISTENT
// simple banners — offline / write-error / inefficiency — each wrapped in its
// own <Reveal> (graceful height ease open AND closed, exactly as at the old
// App render site). The other in-flow banners (Overlap / Late / WaitAvail /
// reminders) were already components and stay mounted by App right after this.
//
// All STATE stays in BookingApp (the Phase D3 locked decision — this component
// is rendering only). `ineffShow` is computed in App (it reads reshuffled /
// inefficient / dismissedIneff / optimizerActiveFor / the Settings master
// switch) and passed as a boolean.
//
// Props:
//  isOnline         — usePersistence connection flag (banner shows when false)
//  writeWarning     — string | null (the red hard-failure banner)
//  onDismissWarning — setWriteWarning(null)
//  ineffShow        — boolean: show the "could be reshuffled" suggestion
//  onDismissIneff   — setDismissedIneff(viewDate)
//  onReshuffle      — setConfirmReshuffle(true)

import { mkBtn, Reveal } from "./atoms";
import { BTN, R } from "../lib/constants";

// v17.8.0: these three are the PERSISTENT half of the same family as the
// BannerRows banners and the status toasts, so they take the same treatment —
// one pane in the app's card language, a 1px border, and a semantic DOT
// carrying the colour instead of a 2px ring around a saturated wash. See
// BannerRows.jsx for the reasoning; the point of doing all of them in one pass
// is that a notification looking like two different things in two places is
// the inconsistency being fixed, and half a fix would preserve it.
function pane(tone, tint, children, extra) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 9,
      background: tint,
      border: "1px solid var(--border-card)",
      borderRadius: R.card,
      padding: "10px 14px", marginBottom: 10,
      fontSize: 13, fontWeight: 600,
      boxShadow: "var(--shadow-soft)",
      ...(extra || null)
    }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: tone, flexShrink: 0 }} />
      {children}
    </div>
  );
}

export function AppBanners({isOnline,writeWarning,onDismissWarning,ineffShow,onDismissIneff,onReshuffle}){
  // The ⚠ glyphs are gone: the dot already says "attention", and a glyph plus a
  // coloured dot plus coloured text is three signals for one message.
  const offlineBanner=!isOnline?pane("var(--status-offline)","var(--app-offline-bg)",
    <span style={{color:"var(--app-offline-text)"}}>Working offline — your changes are saved locally and will sync when the connection returns. Keep this tab open.</span>
  ):null;

  const writeWarningBanner=writeWarning?pane("var(--status-offline)","var(--danger-bg)",
    <>
      <span style={{flex:1,minWidth:0,color:"var(--danger-text)"}}>{writeWarning}</span>
      <button
        className="mgt-hover-scale"
        style={mkBtn({fontSize:12,background:"var(--app-btn-slate-dim)",minHeight:32,padding:"4px 12px"})}
        onClick={onDismissWarning}>Dismiss</button>
    </>
  ):null;

  const ineffBanner=ineffShow?pane("var(--warn-text)","var(--app-overlap-bg)",
    <>
      <span style={{flex:1,minWidth:0,color:"var(--warn-text)"}}>Tables could be reshuffled for better efficiency.</span>
      <div style={{display:"flex",gap:6,flexShrink:0}}><button
        onClick={onDismissIneff}
        className="mgt-hover-scale"
        style={mkBtn({fontSize:13,minHeight:36,padding:"6px 14px",background:BTN.dismiss})}>Dismiss</button><button
        onClick={onReshuffle}
        className="mgt-hover-scale"
        style={{background:BTN.orange,color:"var(--text-on-accent)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:R.pill,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:600,minHeight:36,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Reshuffle</button></div>
    </>
  ,{flexWrap:"wrap"}):null;

  return <>
    <Reveal show={!isOnline}>{offlineBanner}</Reveal>
    <Reveal show={!!writeWarning}>{writeWarningBanner}</Reveal>
    <Reveal show={ineffShow}>{ineffBanner}</Reveal>
  </>;
}
