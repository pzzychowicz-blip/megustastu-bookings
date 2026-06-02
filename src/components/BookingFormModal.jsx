// src/components/BookingFormModal.jsx
//
// Phase E1 (v14.1.12): The booking form modal extracted from BookingApp.
// First component-shape extraction since Phase B5. Mirrors the controlled-
// component pattern established by WalkinForm: form draft + lifecycle live
// in the parent, this component renders the view and fires callbacks.
//
// Props:
//   form, setForm, editId, error           form draft (controlled)
//   bookings, liveBookings, tableBlocks    data for availability + edit lookups
//   autoOptimizer, isMobile                runtime context
//   onSave                                 kitchen-load wrapper around doSave
//   onClose                                close form modal
//   onClearSwap                            clear swapAffected state
//   onBookAgain(sourceBooking)             open new-booking form pre-filled
//   onOpenPrefPicker                       show PrefPickerModal
//   onOpenManualAssign(targetIdOrNew)      show ManualModal; "__new__" or editId
//   onOpenHistory                          show HistoryPopup
//   onRequestCancel(bookingId)             show confirm-cancel overlay
//
// The component reads no React hooks — it's a pure render function whose
// outputs depend only on its props. Derivations (formAvail, tablesBtn,
// kitchenSection, etc.) compute fresh each render, matching pre-E1 semantics.
//
// What stays in BookingApp:
//   • form / editId / error / swapAffected / etc. state
//   • doSave / save / openNew / openEdit / bookAgain / manualAssign /
//     doCancelBooking handlers
//   • formRef mirror effect + auto-clear-error effect
//   • delModal / manualModal / prefPickerModal / historyPopup mounts
//     (manualModal and prefPickerModal are triggered FROM this component
//     via callback props, but RENDERED by BookingApp — same vertical
//     ordering as today, no z-index changes)
//   • manualBooking IIFE (feeds the stayed-in-parent ManualModal)

import { OPEN, CLOSE, KITCHEN_TABLE_LIMIT, BLOCK_BG, S, BTN } from "../lib/constants";
import {
  getDur, toMins, toTime,
  trialFits, findTimes, formatSugg,
  getKitchenLoad, findKitchenFriendlyTimes,
  optimizerActiveFor
} from "../lib/booking-logic";
import { Overlay, Fld, Section, TBadge, AvailBanner, mkInp, mkBtn } from "./atoms";

export function BookingFormModal({
  form, setForm, editId, error,
  bookings, liveBookings, tableBlocks,
  autoOptimizer, isMobile,
  onSave, onClose, onClearSwap, onBookAgain,
  onOpenPrefPicker, onOpenManualAssign, onOpenHistory, onRequestCancel,
}){
  // ── Build form ─────────────────────────────────────────────────────────────
  // Pre-E1, these all lived inline in BookingApp's body. Moved here because
  // they exist only to feed the form modal JSX below.
  const inp=mkInp;
  const formCols=isMobile?"1fr":"1fr 1fr";
  const auto=getDur(Number(form.size));
  const dur=form.customDur||auto;

  // ── Real-time availability check (trial optimization) ──
  // Pre-E1's showForm guard is dropped — this component is only mounted when
  // the parent has showForm=true.
  const formAvail=(function(){
    if(!form.time) return null;
    const sm=toMins(form.time);
    if(sm<OPEN*60||sm>CLOSE*60) return null;
    const size=Number(form.size)||2;
    const d=form.customDur||getDur(size);
    const mt=Array.isArray(form.manualTables)&&form.manualTables.length>0?form.manualTables:null;
    if(mt) return {ok:true,tables:mt,sugg:null};
    const noResh=!optimizerActiveFor(form.date,autoOptimizer);
    const tables=trialFits(liveBookings,form.date,form.time,size,form.preference||"auto",d,tableBlocks,editId,form.preferredTables,noResh);
    if(tables) return {ok:true,tables:tables,sugg:null};
    const sugg=findTimes(form.date,size,form.preference,liveBookings,d,sm,tableBlocks,editId,noResh);
    return {ok:false,tables:null,sugg:formatSugg(sugg,sm)};
  })();

  const tablesBtn=(function(){
    const mt=Array.isArray(form.manualTables)&&form.manualTables.length>0?form.manualTables:null;
    const previewTbls=mt?null:(formAvail&&formAvail.ok?formAvail.tables:null);
    const prefs=form.preferredTables||[];
    const hasPref=prefs.length>0;
    const prefBtn=<button
      className="mgt-hover-scale"
      style={mkBtn({background:hasPref?"#0d9488":"#64748b",fontSize:12,padding:"6px 10px"})}
      onClick={function(){onOpenPrefPicker();}}>{hasPref?"★ "+prefs.join("+"):"★ Preferred"}</button>;
    if(editId){
      const cur=bookings.find(function(b){return b.id===editId;});
      const curPrefStr=cur&&Array.isArray(cur.preferredTables)?cur.preferredTables.slice().sort().join(","):"";
      const formPrefStr=Array.isArray(form.preferredTables)?form.preferredTables.slice().sort().join(","):"";
      const prefTblChanged=curPrefStr!==formPrefStr;
      const changed=cur&&(form.time!==cur.time||Number(form.size)!==cur.size||form.date!==cur.date||form.preference!==cur.preference||(form.customDur&&form.customDur!==cur.duration)||prefTblChanged);
      const hardChanged=cur&&(form.time!==cur.time||Number(form.size)!==cur.size||form.date!==cur.date||form.preference!==cur.preference||prefTblChanged);
      const cleared=!!form._clearManual;
      const curTbl=cur&&cur.tables&&cur.tables.length>0?cur.tables:null;
      const isManual=cur&&(cur._manual||cur._locked)&&curTbl;
      const showTbl=mt||(isManual&&!hardChanged&&!cleared?curTbl:((changed||cleared)?null:curTbl));
      const showClearManual=isManual&&!mt&&!cleared;
      const leftEls=[
        <span key="lbl" style={{fontSize:13,color:"var(--text-secondary)",fontWeight:600}}>Tables</span>];
      if(showTbl) showTbl.forEach(function(id){leftEls.push(<TBadge key={id} id={id} />);});
      else if(previewTbls){previewTbls.forEach(function(id){leftEls.push(<TBadge key={id} id={id} />);});leftEls.push(<span key="auto" style={{fontSize:11,color:S.muted,fontStyle:"italic"}}>(auto)</span>);}
      if((changed||cleared)&&!mt&&curTbl) leftEls.push(<span key="prev" style={{fontSize:11,color:S.muted,fontStyle:"italic"}}>{"was: "+curTbl.join(", ")}</span>);
      if(mt) leftEls.push(<button
        key="clrmt"
        className="mgt-hover-scale"
        style={mkBtn({fontSize:12,background:BTN.clear})}
        onClick={function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});onClearSwap();}}>Clear</button>);
      if(showClearManual) leftEls.push(<button
        key="clrman"
        className="mgt-hover-scale"
        style={mkBtn({fontSize:12,background:BTN.clear})}
        onClick={function(){setForm(function(f){return Object.assign({},f,{manualTables:[],_clearManual:true});});onClearSwap();}}>Clear</button>);
      return (
        <Section><div
            style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><div
              style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flex:1,minWidth:0}}>{leftEls}</div><div style={{display:"flex",gap:6,flexShrink:0}}><button
                className="mgt-hover-scale"
                style={mkBtn({background:BTN.tables})}
                onClick={function(){onOpenManualAssign(editId);}}>= Assign</button>{prefBtn}</div></div></Section>
      );
    }
    const leftEls=[<span key="lbl" style={{fontSize:13,color:"var(--text-secondary)",fontWeight:600}}>Tables</span>];
    if(mt) mt.forEach(function(id){leftEls.push(<TBadge key={id} id={id} />);});
    else if(previewTbls){previewTbls.forEach(function(id){leftEls.push(<TBadge key={id} id={id} />);});leftEls.push(<span key="auto" style={{fontSize:11,color:S.muted,fontStyle:"italic"}}>(auto)</span>);}
    if(mt) leftEls.push(<button
      key="clrmt"
      className="mgt-hover-scale"
      style={mkBtn({fontSize:12,background:BTN.clear})}
      onClick={function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});onClearSwap();}}>Clear</button>);
    return (
      <Section><div
          style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><div
            style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flex:1,minWidth:0}}>{leftEls}</div><div style={{display:"flex",gap:6,flexShrink:0}}><button
              className="mgt-hover-scale"
              style={mkBtn({background:BTN.tables})}
              onClick={function(){onOpenManualAssign("__new__");}}>= Assign</button>{prefBtn}</div></div></Section>
    );
  })();

  const availBanner=formAvail&&!formAvail.ok?<AvailBanner
    msg={"No tables available"+(form.preference!=="auto"?" ("+form.preference+" preference)":"")+"."}
    sugg={formAvail.sugg}
    onTapTime={function(t){setForm(function(f){return Object.assign({},f,{time:t});});}} />:null;

  // Pre-E1's showForm guard is dropped — component is only mounted when showForm=true.
  const kitchenLoad=form.time?getKitchenLoad(bookings,form.date,form.time,form.customDur||getDur(Number(form.size)||2),editId):null;
  const kitchenStarts=kitchenLoad?kitchenLoad.starts+1:1;
  const kitchenGuests=kitchenLoad?kitchenLoad.guests+(Number(form.size)||2):Number(form.size)||2;
  const kitchenBusy=kitchenLoad&&kitchenStarts>=KITCHEN_TABLE_LIMIT;
  const kitchenSugg=kitchenBusy?findKitchenFriendlyTimes(bookings,form.date,Number(form.size)||2,form.preference||"auto",form.customDur||getDur(Number(form.size)||2),form.time,editId,tableBlocks):null;
  function renderKitchenTimes(arr){
    if(!arr||!arr.length) return null;
    return arr.map(function(r){return (
      <span
        key={r.timeStr}
        className="mgt-hover-scale"
        onClick={function(){setForm(function(f){return Object.assign({},f,{time:r.timeStr});});}}
        style={{cursor:"pointer",padding:"3px 8px",borderRadius:6,fontWeight:600,fontSize:12,background:r.hasTables?"rgba(220,252,231,0.8)":"rgba(254,249,195,0.8)",color:r.hasTables?"#166534":"#854d0e",border:"1px solid "+(r.hasTables?"rgba(134,239,172,0.5)":"rgba(253,230,138,0.5)"),boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>{r.timeStr}</span>
    );});
  }
  const kitchenSection=kitchenLoad?<div
    style={{padding:"10px 14px",borderRadius:14,border:"2px solid "+(kitchenBusy?"var(--warn-border)":"var(--border-soft)"),background:kitchenBusy?"var(--warn-bg)":"var(--bg-soft)",marginBottom:14,fontSize:13,color:kitchenBusy?"var(--warn-text)":S.muted}}><div
      style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span><span style={{fontWeight:700}}>Starting at this time: </span>{kitchenStarts+" booking"+(kitchenStarts!==1?"s":"")+" · "+kitchenGuests+" guest"+(kitchenGuests!==1?"s":"")}</span>{kitchenBusy?<span
        style={{fontWeight:700,color:"var(--text-required)",fontSize:13,padding:"4px 12px",borderRadius:8,border:"1.5px solid rgba(220,38,38,0.4)",flexShrink:0}}>Kitchen busy</span>:null}</div>{kitchenSugg&&(kitchenSugg.before.length||kitchenSugg.after.length)?<div style={{marginTop:8}}><div style={{fontSize:11,color:S.muted,marginBottom:6}}><span
          style={{background:"rgba(220,252,231,0.8)",color:"#166534",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}}>green</span>= tables available  <span
          style={{background:"rgba(254,249,195,0.8)",color:"#854d0e",padding:"2px 6px",borderRadius:6,fontSize:10,fontWeight:600}}>yellow</span>= kitchen ok, tables tight</div>{kitchenSugg.before.length?<div style={{marginBottom:4}}><span style={{fontWeight:700,fontSize:12}}>Before: </span><span style={{display:"inline-flex",gap:4,flexWrap:"wrap"}}>{renderKitchenTimes(kitchenSugg.before)}</span></div>:null}{kitchenSugg.after.length?<div><span style={{fontWeight:700,fontSize:12}}>After: </span><span style={{display:"inline-flex",gap:4,flexWrap:"wrap"}}>{renderKitchenTimes(kitchenSugg.after)}</span></div>:null}</div>:
    kitchenBusy?<div style={{marginTop:6,fontSize:12,color:"var(--danger-text)"}}>No kitchen-friendly alternatives found nearby.</div>:null}</div>:null;

  const quickStatusBtns=editId?<Section><div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}><span style={{fontSize:13,color:"var(--text-secondary)",fontWeight:600,marginRight:4}}>Status:</span>{["confirmed","seated","completed","cancelled"].filter(function(s){return s!==form.status;}).map(function(s){return (
        <button
          key={s}
          className="mgt-hover-scale"
          style={mkBtn({background:BLOCK_BG[s],textTransform:"capitalize",minHeight:40})}
          onClick={function(){if(s==="cancelled"){onRequestCancel(editId);return;}setForm(function(f){return Object.assign({},f,{status:s});});}}>{"> "+s}</button>
      );})}</div></Section>:null;

  const historyBtn=(function(){
    if(!editId) return null;
    const cur=bookings.find(function(b){return b.id===editId;});
    if(!cur||!cur.history||!cur.history.length) return null;
    return (
      <button
        onClick={function(){onOpenHistory();}}
        className="mgt-hover-scale"
        style={mkBtn({fontSize:12,background:"#64748b",padding:"8px 16px",minHeight:36})}>{"History ("+cur.history.length+")"}</button>
    );
  })();
  // v14: Book Again button — visible only in Edit Booking modal when status is
  // seated or completed. One tap closes the edit modal and opens a new-booking
  // form pre-filled with this customer's details (name, phone, size, preference,
  // preferred tables, original time). Staff must still pick a date.
  const bookAgainBtn=(function(){
    if(!editId) return null;
    const cur=bookings.find(function(b){return b.id===editId;});
    if(!cur) return null;
    if(cur.status!=="seated"&&cur.status!=="completed") return null;
    return (
      <button
        onClick={function(){onBookAgain(cur);}}
        className="mgt-hover-scale"
        style={mkBtn({fontSize:12,background:"rgba(22,101,52,0.8)",padding:"8px 16px",minHeight:36})}>Book Again</button>
    );
  })();
  // v14: "return guest" banner at top of form when this is a Book Again creation.
  // v14 p1: reads src.scheduledTime so the displayed time matches the confirmed
  // plan, not the seated-shifted time.
  const returnOfBanner=(function(){
    if(editId||!form.returnOf) return null;
    const src=bookings.find(function(b){return b.id===form.returnOf;});
    if(!src) return null;
    const srcTime=src.scheduledTime||src.time;
    return (
      <div
        style={{background:"var(--suggest-bg)",border:"2px solid var(--suggest-border)",borderRadius:14,padding:"10px 14px",marginBottom:10,fontSize:13,fontWeight:600,color:"var(--success-text)",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>{"Return guest — re-booking from "+src.name+" ("+src.date+" at "+srcTime+"). Please set a date."}</div>
    );
  })();

  const errorEl=error?<div
    style={{color:"var(--danger-text)",fontSize:13,padding:"10px 14px",background:"var(--danger-bg)",borderRadius:14,border:"2px solid var(--danger-border)",marginBottom:14}}>{error}</div>:null;

  const resetDurBtn=form.customDur?<button
    key="rd"
    className="mgt-hover-scale"
    style={mkBtn({fontSize:12,background:BTN.reset})}
    onPointerDown={function(){setForm(function(f){return Object.assign({},f,{customDur:null});})}}>Reset</button>:null;
  const endTime=form.time?toTime(toMins(form.time)+dur):"--";

  // ── The form modal itself ──
  return (
    <Overlay onClose={function(){onClose();}}><div style={{textAlign:"center",marginBottom:16}}><div
        style={{fontSize:16,fontWeight:700,color:"var(--text-on-accent)",display:"inline-block",padding:"8px 16px",borderRadius:12,background:form.returnOf?"rgba(22,101,52,0.8)":"rgba(0,122,255,0.75)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>{editId?"Edit booking":(form.returnOf?"New booking (Book Again)":"New booking")}</div></div>{returnOfBanner}<Section><div style={{display:"grid",gridTemplateColumns:formCols,gap:12}}><Fld label="Customer name" req={true}><input
            value={form.name}
            onChange={function(e){setForm(function(f){return Object.assign({},f,{name:e.target.value});});}}
            placeholder="Full name"
            className="mgt-hover-scale"
            style={inp()} /></Fld><Fld label="Phone number"><input
            type="tel"
            value={form.phone}
            onChange={function(e){setForm(function(f){return Object.assign({},f,{phone:e.target.value});});}}
            onFocus={function(e){const el=e.target;if(!el.value) setForm(function(f){return Object.assign({},f,{phone:"+"});});setTimeout(function(){el.selectionStart=el.selectionEnd=el.value.length;},0);}}
            placeholder="+34 600 000 000"
            className="mgt-hover-scale"
            style={inp()} /></Fld></div></Section><Section><div style={{display:"grid",gridTemplateColumns:formCols,gap:12}}><Fld label="Date"><input
            type="date"
            value={form.date}
            onChange={function(e){setForm(function(f){return Object.assign({},f,{date:e.target.value});});}}
            className="mgt-hover-scale"
            style={inp()} /></Fld><Fld label="Time"><input
            type="time"
            value={form.time}
            onChange={function(e){setForm(function(f){return Object.assign({},f,{time:e.target.value});});}}
            min={String(OPEN).padStart(2, "0") + ":00"}
            max={String(CLOSE).padStart(2, "0") + ":00"}
            className="mgt-hover-scale"
            style={inp()} /></Fld><Fld label="Seating preference"><select
            value={form.preference}
            onChange={function(e){setForm(function(f){return Object.assign({},f,{preference:e.target.value});});}}
            className="mgt-hover-scale"
            style={inp()}><option value="auto">Auto (recommended)</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option></select></Fld><Fld label="Number of guests"><div style={{display:"flex",alignItems:"center",gap:6}}><button
              className="mgt-hover-scale"
              style={{background:"var(--bg-stepper)",border:"1px solid var(--border-soft)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"var(--shadow-input)"}}
              onPointerDown={function(e){e.preventDefault();const v=Math.max(1,(Number(form.size)||2)-1);setForm(function(f){return Object.assign({},f,{size:v});});}}>-</button><span
              style={{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}}>{String(Number(form.size)||2)}</span><button
              className="mgt-hover-scale"
              style={{background:"var(--bg-stepper)",border:"1px solid var(--border-soft)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"var(--shadow-input)"}}
              onPointerDown={function(e){e.preventDefault();const v=Math.min(25,(Number(form.size)||2)+1);setForm(function(f){return Object.assign({},f,{size:v});});}}>+</button></div></Fld><Fld label="Duration"><div style={{display:"flex",alignItems:"center",gap:6}}><button
              className="mgt-hover-scale"
              style={{background:"var(--bg-stepper)",border:"1px solid var(--border-soft)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"var(--shadow-input)"}}
              onPointerDown={function(e){e.preventDefault();const v=Math.max(15,Math.min(480,dur-15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}}>-</button><span
              style={{minWidth:56,textAlign:"center",fontSize:15,fontWeight:700,color:S.text}}>{dur+" min"}</span><button
              className="mgt-hover-scale"
              style={{background:"var(--bg-stepper)",border:"1px solid var(--border-soft)",borderRadius:12,width:42,height:42,fontSize:22,cursor:"pointer",color:S.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"var(--shadow-input)"}}
              onPointerDown={function(e){e.preventDefault();const v=Math.max(15,Math.min(480,dur+15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}}>+</button><span style={{fontSize:13,color:S.text,marginLeft:4}}>{"End: "+endTime}</span>{resetDurBtn}</div></Fld></div></Section>{kitchenSection}{tablesBtn}{availBanner}{quickStatusBtns}<Section><Fld label="Notes"><textarea
          value={form.notes}
          onChange={function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});}}
          rows={2}
          placeholder="Allergies, special requests..."
          className="mgt-hover-scale"
          style={Object.assign({},inp(),{resize:"vertical"})} /></Fld></Section>{errorEl}<div
      style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:18,flexWrap:"wrap"}}><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{historyBtn}{bookAgainBtn}</div><div style={{display:"flex",gap:8}}><button
          className="mgt-hover-scale"
          style={mkBtn({minHeight:44,padding:"10px 18px",background:BTN.cancel})}
          onClick={function(){onClose();}}>Cancel</button>{(function(){
          // v14 p1 (Issue 3): Save is disabled when date is empty. Prevents the
          // dd.mm.yyyy placeholder state from being submitted (esp. via Book Again
          // where we intentionally clear the date to force staff to pick one).
          const canSave=!!form.date;
          return (
            <button
              disabled={!canSave}
              onClick={onSave}
              className="mgt-hover-scale"
              style={{background:canSave?"rgba(0,122,255,0.8)":"rgba(180,180,190,0.4)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:14,padding:"10px 22px",cursor:canSave?"pointer":"not-allowed",fontSize:14,fontWeight:600,color:"var(--text-on-accent)",minHeight:44,boxShadow:canSave?"0 2px 8px rgba(0,122,255,0.25), inset 0 1px 1px rgba(255,255,255,0.2)":"none"}}>Save booking</button>
          );
        })()}</div></div></Overlay>
  );
}
