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
import { S, BTN } from "../lib/constants";
import { formatPhone } from "../lib/customers";
import { Overlay, mkBtn, AutoHeight } from "./atoms";

function addedLabel(ts){
  if(!ts) return "";
  const d=new Date(ts);
  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}

export function WaitlistPanel({ entries, availability, date, onBook, onRemove, onClose }){
  const [confirmId,setConfirmId]=useState(null);

  const rows=entries.map(function(w,i){
    const avail=availability[w.id]||null;
    const fitChip=avail?<span
      style={{fontSize:11,fontWeight:700,color:"var(--success-text)",background:"var(--suggest-bg)",border:"1px solid var(--suggest-border)",borderRadius:8,padding:"3px 8px",flexShrink:0}}>{"Table free"+(avail.time?" · "+avail.time:"")}</span>:<span
      style={{fontSize:11,fontWeight:600,color:S.muted,background:"var(--bg-soft)",border:"1px solid var(--border-soft)",borderRadius:8,padding:"3px 8px",flexShrink:0}}>waiting</span>;
    const arming=confirmId===w.id;
    return (
      <div
        key={w.id}
        style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 12px",borderRadius:14,background:"var(--bg-soft)",border:"1px solid "+(avail?"var(--suggest-border)":"var(--border-soft)"),marginBottom:8,boxShadow:"var(--shadow-input)"}}><span
          style={{fontSize:13,fontWeight:700,color:S.text,minWidth:20,textAlign:"center",opacity:0.6}}>{"#"+(i+1)}</span><div style={{flex:1,minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><span style={{fontSize:14,fontWeight:700,color:S.text}}>{w.name||"(no name)"}</span><span style={{fontSize:13,fontWeight:700,color:S.text}}>{w.size+" pax"}</span>{fitChip}</div><div style={{fontSize:12,color:S.muted,marginTop:2}}>{(w.phone?formatPhone(w.phone)+"  ·  ":"")+"added "+addedLabel(w.createdAt)+(w.prefTime?"  ·  wants "+w.prefTime:"")}</div>{w.notes?<div style={{fontSize:12,color:S.muted,marginTop:2,fontStyle:"italic"}}>{w.notes}</div>:null}</div><div style={{display:"flex",gap:6,flexShrink:0}}><button
            className="mgt-hover-scale"
            style={mkBtn({fontSize:12,background:"rgba(22,101,52,0.8)",minHeight:36})}
            onClick={function(){onBook(w);}}>Book</button><button
            className="mgt-hover-scale mgt-press"
            style={mkBtn({fontSize:12,background:arming?BTN.del:BTN.cancel,minHeight:36})}
            onClick={function(){if(arming){onRemove(w.id);setConfirmId(null);}else setConfirmId(w.id);}}>{arming?"Confirm?":"Remove"}</button></div></div>
    );
  });

  const footerEl=(
    <div style={{display:"flex",justifyContent:"flex-end"}}><button
        className="mgt-hover-scale mgt-press"
        style={mkBtn({minHeight:44,padding:"10px 18px",background:"#64748b"})}
        onClick={onClose}>Done</button></div>
  );

  return (
    <Overlay onClose={onClose} footer={footerEl}><AutoHeight><div style={{textAlign:"center",marginBottom:16}}><div
          style={{fontSize:16,fontWeight:700,color:"var(--text-on-accent)",display:"inline-block",padding:"8px 16px",borderRadius:12,background:"rgba(0,122,255,0.75)",border:"1px solid rgba(255,255,255,0.2)",boxShadow:"0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.15)"}}>{"Waitlist — "+date}</div></div>{rows.length?rows:<div
        style={{textAlign:"center",padding:"24px 0",color:S.muted,fontSize:14}}>No one on the waitlist for this day.</div>}<div style={{fontSize:11,color:S.muted,textAlign:"center",marginTop:10}}>First come, first served — a green chip means a table currently fits this party.</div></AutoHeight></Overlay>
  );
}
