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
import { BTN } from "../lib/constants";

export function AppBanners({isOnline,writeWarning,onDismissWarning,ineffShow,onDismissIneff,onReshuffle}){
  const offlineBanner=!isOnline?<div
    style={{background:"var(--app-offline-bg)",border:"2px solid var(--app-offline-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"var(--app-offline-text)",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>⚠ Working offline — your changes are saved locally and will sync when the connection returns. Keep this tab open.</div>:null;
  const writeWarningBanner=writeWarning?<div
    style={{background:"var(--danger-bg)",border:"2px solid var(--danger-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:700,color:"var(--danger-text)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}><span>{"⚠ "+writeWarning}</span><button
            className="mgt-hover-scale"
            style={mkBtn({fontSize:12,background:"var(--app-btn-slate-dim)",minHeight:32,padding:"4px 12px"})}
            onClick={onDismissWarning}>Dismiss</button></div>:null;
  const ineffBanner=ineffShow?<div
    style={{background:"var(--warn-bg)",border:"2px solid var(--warn-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"var(--warn-text)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}><span>Tables could be reshuffled for better efficiency.</span><div style={{display:"flex",gap:6}}><button
        onClick={onDismissIneff}
        className="mgt-hover-scale"
        style={mkBtn({fontSize:13,minHeight:36,padding:"6px 14px",background:BTN.dismiss})}>Dismiss</button><button
        onClick={onReshuffle}
        className="mgt-hover-scale"
        style={{background:BTN.orange,color:"var(--text-on-accent)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:600,minHeight:36,boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>Reshuffle</button></div></div>:null;
  return <>
    <Reveal show={!isOnline}>{offlineBanner}</Reveal>
    <Reveal show={!!writeWarning}>{writeWarningBanner}</Reveal>
    <Reveal show={ineffShow}>{ineffBanner}</Reveal>
  </>;
}
