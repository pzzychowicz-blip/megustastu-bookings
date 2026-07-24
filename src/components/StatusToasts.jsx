// ── StatusToasts ─────────────────────────────────────────────────────────────
// v17.3.4: extracted VERBATIM from App.jsx (de-monolith extraction #2 — the
// v15.8.0 "Notification layout" floating layer). Renders the TRANSIENT status
// toasts (loading / resync / reconnect / sync-fix / wait-added / undo / drag /
// reshuffled / load) absolutely positioned over the top-centre of mainView, so
// they never reflow the grid. All STATE stays in BookingApp (the Phase D3
// locked decision — this component is rendering only); App mounts it inside
// the position:relative wrapper around <SlideView>{mainView}</SlideView>.
//
// v15.8.0 rules preserved:
//  • The toasts share ONE slot — only the highest-priority active one shows
//    (array order below = priority), overlapping in a 1-cell grid (gridArea
//    1/1) so a swap crossfades in place.
//  • The container is ALWAYS mounted (each Toast self-manages its in/out
//    lifecycle, so the container must outlive a toast's out-animation) —
//    empty + pointerEvents:none when idle, so it never blocks toolbar/grid
//    taps. z<modal (1000) / <quick-status popup (300).
//  • v17.1.2: width:fit-content — the Undo pill (and every toast) hugs its
//    text instead of stretching the 360px column; long text still wraps at
//    the container's maxWidth.
//
// Props (all scalars/strings/small objects — no derivations in here):
//  bookingsReady   — usePersistence: false until the first bookings snapshot
//  resyncing       — the v15.2.0 freshness-gate banner flag
//  reconnectShown  — "✓ Reconnected" flag
//  syncFix         — v15.6.1 "Resolved a table conflict after syncing."
//  waitAddedShown  — v16.0.0 "Added to the waitlist."
//  undoInfo        — v16.3.0 {snapshot, noShow} | null; drives the Undo pill
//  onUndo          — undoCancel()
//  dragMsg         — v17.0.0 {text, good} | null (timeline drag&drop feedback)
//  reshuffled      — the post-save flag
//  reshuffledMsg   — "Tables re-optimised." / "Booking saved." (computed in
//                    App — it reads optimizerActiveFor(viewDate, autoOptimizer))
//  loadShown       — the 6s "Firebase connected" banner flag (NOT a loaded
//                    signal — see the loadBannerShown gotcha in CLAUDE.md)
//  loadMsg         — "Firebase connected — N bookings loaded."

import { mkBtn, Toast } from "./atoms";
import { BTN } from "../lib/constants";

const toastShadow="0 6px 20px rgba(0,0,0,0.18)";

export function StatusToasts({bookingsReady,resyncing,reconnectShown,syncFix,waitAddedShown,undoInfo,onUndo,dragMsg,reshuffled,reshuffledMsg,loadShown,loadMsg}){
  // v15.8.0: the status toasts share ONE slot — only the highest-priority
  // active one is shown (order below), so they never stack vertically. When the
  // top one changes, the old floats out as the new floats in; they overlap in
  // the same grid cell (gridArea 1/1) so the swap is a crossfade in place.
  const statusToasts=[
    {key:"loading",on:!bookingsReady,node:<div
      style={{background:"linear-gradient(var(--app-offline-bg),var(--app-offline-bg)),var(--bg-ac-menu)",border:"2px solid var(--app-offline-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:700,color:"var(--app-offline-text)",boxShadow:toastShadow}}>⟳ Loading bookings…</div>},
    {key:"resync",on:resyncing,node:<div
      style={{background:"linear-gradient(var(--app-offline-bg),var(--app-offline-bg)),var(--bg-ac-menu)",border:"2px solid var(--app-offline-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:700,color:"var(--app-offline-text)",boxShadow:toastShadow}}>⟳ Syncing the latest data — this device may have been asleep. Your changes are saved and will finish syncing in a moment.</div>},
    {key:"reconnect",on:reconnectShown,node:<div
      style={{background:"linear-gradient(var(--app-reconnect-bg),var(--app-reconnect-bg)),var(--bg-ac-menu)",border:"2px solid var(--app-reconnect-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--app-reconnect-text)",boxShadow:toastShadow}}>✓ Reconnected — changes synced.</div>},
    {key:"syncfix",on:syncFix,node:<div
      style={{background:"linear-gradient(var(--app-saved-bg),var(--app-saved-bg)),var(--bg-ac-menu)",border:"2px solid var(--app-saved-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--app-saved-text)",boxShadow:toastShadow}}>Resolved a table conflict after syncing.</div>},
    {key:"waitadded",on:waitAddedShown,node:<div
      style={{background:"linear-gradient(var(--suggest-bg),var(--suggest-bg)),var(--bg-ac-menu)",border:"2px solid var(--suggest-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--success-text)",boxShadow:toastShadow}}>Added to the waitlist.</div>},
    {key:"undo",on:!!undoInfo,node:<div
      style={{background:"linear-gradient(var(--bg-sheet),var(--bg-sheet)),var(--bg-ac-menu)",border:"2px solid var(--border-sheet)",borderRadius:14,padding:"8px 10px 8px 14px",fontSize:13,fontWeight:600,color:"var(--text-primary)",boxShadow:toastShadow,display:"flex",alignItems:"center",gap:10,pointerEvents:"auto"}}><span>{undoInfo&&undoInfo.noShow?"Marked no-show":"Booking cancelled"}</span><button
        onClick={function(e){e.stopPropagation();onUndo();}}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({fontSize:12,minHeight:30,padding:"4px 12px",background:BTN.nav})}>Undo</button></div>},
    {key:"dragmsg",on:!!dragMsg,node:<div
      style={dragMsg&&dragMsg.good
        ?{background:"linear-gradient(var(--suggest-bg),var(--suggest-bg)),var(--bg-ac-menu)",border:"2px solid var(--suggest-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--success-text)",boxShadow:toastShadow}
        :{background:"linear-gradient(var(--warn-bg),var(--warn-bg)),var(--bg-ac-menu)",border:"2px solid var(--warn-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--warn-text)",boxShadow:toastShadow}}>{dragMsg?dragMsg.text:""}</div>},
    {key:"reshuffled",on:reshuffled,node:<div
      style={{background:"linear-gradient(var(--app-saved-bg),var(--app-saved-bg)),var(--bg-ac-menu)",border:"2px solid var(--app-saved-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--app-saved-text)",boxShadow:toastShadow}}>{reshuffledMsg}</div>},
    {key:"load",on:loadShown,node:<div
      style={{background:"linear-gradient(var(--suggest-bg),var(--suggest-bg)),var(--bg-ac-menu)",border:"2px solid var(--suggest-border)",borderRadius:14,padding:"10px 14px",fontSize:13,fontWeight:600,color:"var(--success-text)",boxShadow:toastShadow}}>{loadMsg}</div>},
  ];
  const topToastKey=(statusToasts.find(function(t){return t.on;})||{}).key;
  // Floating layer — absolutely positioned over the TOP-CENTRE of mainView so the
  // toast lands in the empty gap of the timeline toolbar (between the
  // Optimizer/Reshuffle group on the left and the Follow/zoom group on the right)
  // — more at-a-glance, and it tracks mainView's position. Anchored to the
  // relative wrapper around mainView at App's render site; works in all views.
  return <div
    style={{position:"absolute",top:0,left:0,right:0,zIndex:60,display:"flex",justifyContent:"center",alignItems:"flex-start",padding:"7px 12px 0",pointerEvents:"none"}}><div
    style={{width:"100%",maxWidth:360,display:"grid",justifyItems:"center",textAlign:"center"}}>{statusToasts.map(function(t){return <Toast key={t.key} show={t.key===topToastKey} style={{gridArea:"1 / 1",width:"fit-content",justifySelf:"center"}}>{t.node}</Toast>;})}</div></div>;
}
