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
//  loadStalled     — v17.5.1: the first read has exceeded the 15s watchdog, so
//                    the "⟳ Loading bookings…" toast becomes a NAMED failure
//                    with a Reload button. The two are mutually exclusive.
//  readError       — v17.5.1 {path,code,message,at} | null — the last listener
//                    cancellation reported by lib/dbError.js, so the toast can
//                    print the real Firebase code instead of spinning
//  hasConnected    — v17.5.1: has a handshake EVER completed? Separates
//                    "connected but no data" from "never reached the database"
//  resyncing       — the v15.2.0 freshness-gate banner flag
//  reconnectShown  — "✓ Reconnected" flag
//  syncFix         — v15.6.1 "Resolved a table conflict after syncing."
//  waitAddedShown  — v16.0.0 "Added to the waitlist."
//  undoInfo        — {snapshot, kind:"cancel"|"delete"|"edit", noShow} | null
//                    (v17.4.0 general undo); drives the Undo pill + its label
//  onUndo          — App's undoLastAction()
//  undoNote        — extra clause appended to the undo label (v17.4.0). The
//                    undo pill outranks the `reshuffled` toast in the one-slot
//                    priority below, so without this the "Tables re-optimised."
//                    confirmation would be swallowed on every edit/delete —
//                    the only cue that the optimizer moved OTHER bookings.
//                    App passes it when a reshuffle actually happened.
//  dragMsg         — v17.0.0 {text, good} | null (timeline drag&drop feedback)
//  reshuffled      — the post-save flag
//  reshuffledMsg   — "Tables re-optimised." / "Booking saved." (computed in
//                    App — it reads optimizerActiveFor(viewDate, autoOptimizer))
//  loadShown       — the 6s "Firebase connected" banner flag (NOT a loaded
//                    signal — see the loadBannerShown gotcha in CLAUDE.md)
//  loadMsg         — "Firebase connected — N bookings loaded."

import { mkBtn, Toast } from "./atoms";
import { BTN, R } from "../lib/constants";

const toastShadow="0 6px 20px rgba(0,0,0,0.18)";

// ── v17.8.0: ONE toast surface ───────────────────────────────────────────────
// These nine toasts used to be nine hand-written style objects, each a
// saturated tint behind a 2px ring in its own semantic colour. Two problems.
// They shouted — a 2px ring plus a full-surface wash is the loudest treatment
// in the app, spent on messages that are mostly ambient ("Firebase connected").
// And they were nine independent definitions of the same object, so the
// vocabulary drifted: font weight alternated 600/700 with no rule behind it.
//
// Now every toast is the SAME pane — the one the connection popover already
// uses (`--bg-ac-menu`, a 1px border, `--shadow-sheet`'s weight) — and the
// semantic colour is carried by a leading dot. That is not just quieter, it is
// the same signal in the same shape as the header's connection dot, which is
// where a user has already learned to read this app's status colours.
//
// `tone` is deliberately drawn from the STATUS dot tokens for anything
// connection-shaped, so "Reconnected" and the header dot are literally the
// same green.
function toast(tone, body, opts) {
  // `busy` is a behaviour flag, not a style — destructured OUT so it can never
  // reach the style object (React would warn about an unknown CSS property and
  // the DOM would carry a junk attribute). Everything else in `opts` IS style.
  const { busy, ...styleOverrides } = opts || {};
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 9, textAlign: "left",
      background: "var(--bg-ac-menu)",
      border: "1px solid var(--border-card)",
      borderRadius: R.card,
      padding: "9px 14px",
      fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
      boxShadow: toastShadow,
      ...styleOverrides
    }}>
      <span
        aria-hidden="true"
        className={busy ? "mgt-dot-pulse" : undefined}
        style={{ width: 8, height: 8, borderRadius: "50%", background: tone, flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>{body}</span>
    </div>
  );
}

export function StatusToasts({bookingsReady,loadStalled,readError,hasConnected,resyncing,reconnectShown,syncFix,waitAddedShown,undoInfo,onUndo,undoNote,dragMsg,reshuffled,reshuffledMsg,loadShown,loadMsg}){
  // v17.5.1: the first read has not completed within the watchdog window. Say
  // what is actually wrong rather than spinning forever — this toast is the
  // whole reason the Android-tablet outage took two releases to diagnose. It
  // names the Firebase error code when a listener was cancelled, and otherwise
  // distinguishes "never connected" from "connected but no data".
  // v17.8.0: same pane as every other toast; the red STATUS dot carries the
  // alarm instead of a 2px danger ring, and only the title keeps danger-red.
  const stallNode=(
    <div style={{display:"flex",alignItems:"flex-start",gap:9,textAlign:"left",background:"var(--bg-ac-menu)",border:"1px solid var(--border-card)",borderRadius:R.card,padding:"10px 14px",boxShadow:toastShadow,maxWidth:340,pointerEvents:"auto"}}>
      <span aria-hidden="true" style={{width:8,height:8,borderRadius:"50%",background:"var(--status-offline)",flexShrink:0,marginTop:5}} />
      <div style={{minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--danger-text)",marginBottom:3}}>Couldn’t load bookings</div>
        <div style={{fontSize:13,fontWeight:500,lineHeight:1.4,color:"var(--text-primary)"}}>
          {readError
            ? "The database refused the read ("+readError.code+" on /"+readError.path+")."
            : hasConnected
              ? "Connected, but no data has arrived."
              : "Can’t reach the database — no connection has been established."}
        </div>
        <button
          onClick={function(){window.location.reload();}}
          className="mgt-hover-scale mgt-press"
          style={mkBtn({background:BTN.today,marginTop:8,fontSize:12,padding:"5px 12px",minHeight:32})}>Reload</button>
      </div>
    </div>
  );

  // v15.8.0: the status toasts share ONE slot — only the highest-priority
  // active one is shown (order below), so they never stack vertically. When the
  // top one changes, the old floats out as the new floats in; they overlap in
  // the same grid cell (gridArea 1/1) so the swap is a crossfade in place.
  const statusToasts=[
    {key:"loadfail",on:!bookingsReady&&loadStalled,node:stallNode},
    // Connection-shaped toasts borrow the header dot's OWN tokens, so
    // "connecting" and "connected" are literally the same amber and green the
    // user already reads in the connection dot.
    {key:"loading",on:!bookingsReady&&!loadStalled,
      node:toast("var(--status-connecting)","Loading bookings…",{busy:true})},
    {key:"resync",on:resyncing,
      node:toast("var(--status-connecting)","Syncing the latest data — this device may have been asleep. Your changes are saved and will finish syncing in a moment.",{busy:true,maxWidth:340})},
    {key:"reconnect",on:reconnectShown,
      node:toast("var(--status-online)","Reconnected — changes synced.")},
    {key:"syncfix",on:syncFix,
      node:toast("var(--app-saved-text)","Resolved a table conflict after syncing.")},
    {key:"waitadded",on:waitAddedShown,
      node:toast("var(--success-text)","Added to the waitlist.")},
    // The undo pill is the one toast the user ACTS on, so it keeps its trailing
    // button — and a neutral dot, because "booking cancelled" states a fact
    // rather than raising an alarm. pointerEvents:auto because the layer is inert.
    {key:"undo",on:!!undoInfo,node:toast("var(--text-muted)",
      <span style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <span>{(!undoInfo?"":undoInfo.noShow?"Marked no-show":undoInfo.kind==="delete"?"Booking deleted":undoInfo.kind==="edit"?"Booking updated":"Booking cancelled")+(undoInfo&&undoNote?" · "+undoNote:"")}</span>
        <button
          onClick={function(e){e.stopPropagation();onUndo();}}
          className="mgt-hover-scale mgt-press"
          style={mkBtn({fontSize:12,minHeight:30,padding:"4px 12px",background:BTN.nav})}>Undo</button>
      </span>,{pointerEvents:"auto",padding:"7px 10px 7px 14px"})},
    {key:"dragmsg",on:!!dragMsg,
      node:toast(dragMsg&&dragMsg.good?"var(--success-text)":"var(--warn-text)",dragMsg?dragMsg.text:"")},
    {key:"reshuffled",on:reshuffled,
      node:toast("var(--app-saved-text)",reshuffledMsg)},
    {key:"load",on:loadShown,
      node:toast("var(--status-online)",loadMsg)},
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
