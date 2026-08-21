// src/components/WaitlistPanel.jsx
//
// v16.0.0 — Waitlist panel. Overlay listing the viewed day's waiting entries
// first-come-first-served (createdAt asc). Each row: name · phone · pax ·
// added-at, plus a live fits-now indicator (derived by BookingApp via
// trialFits — see the `availability` prop; NOT persisted). Actions:
//   Book   — parent pre-fills the new-booking form from the entry and stores
//            its id; on successful save the entry is removed (returnOf-style).
//   Remove — two-tap inline confirm (first tap arms, second deletes).
//
// Props:
//   entries        — the day's waiting entries, sorted createdAt asc (parent)
//   availability   — { [entryId]: {tables:[…], time:"HH:MM"} | null }
//   date           — the viewed date (title only)
//   onBook(entry)  — open the pre-filled booking form
//   onRemove(id)   — delete the entry
//   onClose()      — close the panel

import { useState } from "react";
import { S, BTN, BLOCK_BG, R, T, FW } from "../lib/constants";
import { formatPhone } from "../lib/customers";
import { Overlay, ModalTitle, mkBtn, AutoHeight } from "./atoms";

function addedLabel(ts){
  if(!ts) return "";
  const d=new Date(ts);
  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}

export function WaitlistPanel({ entries, availability, date, onBook, onRemove, onClose }){
  const [confirmId,setConfirmId]=useState(null);

  const rows=entries.map(function(w,i){
    const avail=availability[w.id]||null;
    // v17.8.0: text, not a pill. WaitAvailBanner already prints this exact fact
    // ("… — table free · 19:30") as plain green text one surface away, and the
    // row here ALSO turns its border green when `avail` — so the pill was the
    // third encoding of one signal, in the pale-fill + matching-border + bold-
    // coloured-text shape that reads as a stock badge.
    const fitChip=avail?<span
      style={{fontSize: T.small,fontWeight: FW.bold,color:"var(--success-text)",whiteSpace:"nowrap",flexShrink:0}}>{"Table free"+(avail.time?" · "+avail.time:"")}</span>:<span
      style={{fontSize: T.small,fontWeight: FW.medium,color:S.muted,whiteSpace:"nowrap",flexShrink:0}}>waiting</span>;
    const arming=confirmId===w.id;
    return (
      <div
        key={w.id}
        style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 12px",borderRadius:R.card,background:"var(--bg-soft)",border:"1px solid "+(avail?"var(--suggest-border)":"var(--border-soft)"),marginBottom:8,boxShadow:"var(--shadow-input)"}}><span
          style={{fontSize: T.body,fontWeight: FW.bold,color:S.text,minWidth:20,textAlign:"center",opacity:0.6}}>{"#"+(i+1)}</span><div style={{flex:1,minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><span style={{fontSize: T.lead,fontWeight: FW.bold,color:S.text}}>{w.name||"(no name)"}</span><span style={{fontSize: T.body,fontWeight: FW.bold,color:S.text}}>{w.size+" pax"}</span>{fitChip}</div><div style={{fontSize: T.body,color:S.muted,marginTop:2}}>{(w.phone?formatPhone(w.phone)+"  ·  ":"")+"added "+addedLabel(w.createdAt)+(w.prefTime?"  ·  wants "+w.prefTime:"")}</div>{w.notes?<div style={{fontSize: T.body,color:S.muted,marginTop:2,fontStyle:"italic"}}>{w.notes}</div>:null}</div><div style={{display:"flex",gap:6,flexShrink:0}}><button
            className="mgt-hover-scale"
            style={mkBtn({fontSize: T.body,background:"var(--app-success-solid)",minHeight:36})}
            onClick={function(){onBook(w);}}>Book</button><button
            className="mgt-hover-scale mgt-press"
            style={mkBtn({fontSize: T.body,background:arming?BTN.del:BTN.cancel,minHeight:36})}
            onClick={function(){if(arming){onRemove(w.id);setConfirmId(null);}else setConfirmId(w.id);}}>{arming?"Confirm?":"Remove"}</button></div></div>
    );
  });

  const footerEl=(
    <div style={{display:"flex",justifyContent:"flex-end"}}><button
        className="mgt-hover-scale mgt-press"
        style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
        onClick={onClose}>Done</button></div>
  );

  // v17.10.0: the title pill follows the button that opens it (ModalTitle's
  // colour rule), and that badge is now the pending amber.
  return (
    <Overlay onClose={onClose} footer={footerEl}><AutoHeight><ModalTitle marginBottom={16} background={BLOCK_BG.pending}>{"Waitlist — "+date}</ModalTitle>{rows.length?rows:<div
        style={{textAlign:"center",padding:"24px 0",color:S.muted,fontSize: T.lead}}>No one on the waitlist for this day.</div>}<div style={{fontSize: T.small,color:S.muted,textAlign:"center",marginTop:10}}>First come, first served — "Table free" means a table currently fits this party.</div></AutoHeight></Overlay>
  );
}
