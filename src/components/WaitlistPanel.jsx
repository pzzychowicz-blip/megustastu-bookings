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
// v18.2.0 phase 41 (S6, reached live): Remove is `mkDangerBtn` — the danger
// tint at rest, solid red once armed as "Confirm — remove". It was
// `BTN.cancel` at rest and `BTN.del` armed, two tokens with ONE value
// (rgba(211,58,58,.75)), so every row carried a solid red Remove and arming
// changed only the word. Book and Remove name their party, in the "table
// free" banner's shape, because N rows of bare "Book" are N identical names.
// (Phase 62, Patryk: every destructive button is solid red at rest now, the
// trash mark before Remove; arming changes only the label.)
// The row's text takes a 160px flex BASIS, where it was `flex: 1` (a zero
// one): a wrapping line is packed by basis, so the buttons never wrapped and
// took their width out of the text instead — 129px of it on a 375px phone,
// and 67px once the armed "Confirm — remove" widened the group (measured:
// "Table free · 18:30" slid under Book). Now the buttons drop under the text
// on a phone and keep to the right edge (`marginLeft: auto`); the tablet's
// 563px row holds 160px of text beside the armed group, so it is unchanged.
//
// v18.2.0 phase 51: the group RESERVES its armed width (`ACTIONS_W`). Phase
// 41's basis let the line wrap on the group's CURRENT width, and arming widens
// Remove 77 → 140px, so between about 405 and 468px (a 430px iPhone) the group
// sat beside the text at rest and wrapped a line down when armed: Remove moved
// 27px under the finger and the second tap landed on the text. Reserved, the
// row wraps the same way in both states: under the text on every phone, beside
// it on the tablet, and arming grows Remove leftwards into space that was
// already empty. Nothing else moves either — the text keeps its width, where it
// lost 63px and re-wrapped (Patryk's pick over keeping it 321px at rest).
//
// v18.3.2 (O3): a party LEAVES the way it arrives. A row removed here, or by
// another device, used to blink out while the rows below jumped up; now each
// row sits in a `Reveal` and folds away on --t-shift (385ms), the WhatsApp
// list's fold, while the rows below follow it up. A new row still arrives at
// full height (`instantIn`), as that list's do: Patryk's call there, repeated
// for this panel on 2026-09-30, was that a row growing open as well is too
// much movement. The leaving row is drawn from `Reveal`'s cached children, so
// it looks exactly as it last did (armed "Confirm — remove" included), holds
// its place (`placeLeaving`) and is `inert` until it is gone. The numbers
// follow the live rows at once, so for the length of a fold two rows can read
// "#2": the leaving one keeps the number it had. The empty line is the other
// half of the same swap and rides the same curve, so removing the last party
// is one move from a row to the sentence rather than a fold and then a jump
// (measured: the text under it travelled 1.2px), and a party arriving
// replaces the sentence in one frame, the way the row itself arrives.
//
// Props:
//   entries        — the day's waiting entries, sorted createdAt asc (parent)
//   availability   — { [entryId]: {tables:[…], time:"HH:MM"} | null }
//   date           — the viewed date (title only)
//   onBook(entry)  — open the pre-filled booking form
//   onRemove(id)   — delete the entry
//   onClose()      — close the panel

import { useState } from "react";
import { S, BLOCK_BG, R, T, FW, IC, SP, ROW_FOLD } from "../lib/constants";
import { formatPhone } from "../lib/customers";
import { formatDay } from "../lib/day";
import { guestsLabel } from "../lib/booking-logic";
import { useRevealRows } from "../hooks/useRevealRows";
import { useLeavingOrder } from "../hooks/useLeavingOrder";
import { Overlay, ModalTitle, mkBtn, mkDangerBtn, AutoHeight, Reveal } from "./atoms";
import { TrashIcon, IndoorIcon, OutdoorIcon } from "./Icons";


// The button group's ARMED width: Book (60.3) + the 6px gap + "Confirm —
// remove" with its trash mark (160.1; 140.1 before phase 62 gave it the mark) =
// 226.4, measured at T.body in the app's font (San Francisco on the Mac),
// rounded up. Every pixel above it is a pixel of text on the
// tablet: 5% of slack cost the first DEV row a fourth line. A system font that
// sets the label wider takes the difference out of the text when armed; it
// cannot re-wrap the group on a phone, where a 440px screen leaves 29px before
// the row would share its line. Re-measure if the labels, T.body or mkBtn's
// padding change.
const ACTIONS_W = 227;

// v18.2.0 phase 68: a party's zone, in the List card's flag look (its FLAG).
const ZONE_FLAG = { display: "inline-flex", alignItems: "center", gap: SP.tight, fontSize: T.small, fontWeight: FW.semi, whiteSpace: "nowrap", color: "var(--text-secondary)" };

function addedLabel(ts){
  if(!ts) return "";
  const d=new Date(ts);
  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}

export function WaitlistPanel({ entries, availability, date, onBook, onRemove, onClose }){
  const [confirmId,setConfirmId]=useState(null);
  // v18.3.2 (O3): the rows drawn — the live ones, and any still folding away —
  // in the order they hold on screen (the header).
  const ids=entries.map(function(w){return w.id;});
  const {renderIds,openIds}=useRevealRows(ids,date,{speed:ROW_FOLD,instantIn:true});
  const order=useLeavingOrder(ids,renderIds);

  function rowFor(w,i){
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
    const who=w.name||"(no name)";
    const party=who+", "+guestsLabel(w.size);
    return (
      <div
        style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 12px",borderRadius:R.card,background:"var(--bg-soft)",border:"1px solid "+(avail?"var(--suggest-border)":"var(--border-soft)"),marginBottom:8,boxShadow:"var(--shadow-input)"}}><span
          style={{fontSize: T.body,fontWeight: FW.bold,color:S.text,minWidth:20,textAlign:"center",opacity:0.6}}>{"#"+(i+1)}</span><div style={{flex:"1 1 160px",minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><span style={{fontSize: T.lead,fontWeight: FW.bold,color:S.text}}>{who}</span><span style={{fontSize: T.body,fontWeight: FW.bold,color:S.text}}>{guestsLabel(w.size)}</span>{/* v18.2.0 phase 68 (L-1): the
            zone the party asked for, in the List card's flag look (mark +
            word, secondary ink) — the match now honours it, and the row says
            so. Absent means no preference. */}{w.preference==="indoor"||w.preference==="outdoor"?<span style={ZONE_FLAG}>{w.preference==="indoor"?<IndoorIcon size={IC.control} />:<OutdoorIcon size={IC.control} />}{w.preference==="indoor"?"Indoor":"Outdoor"}</span>:null}{fitChip}</div><div style={{fontSize: T.body,color:S.muted,marginTop:2}}>{(w.phone?formatPhone(w.phone)+"  ·  ":"")+"added "+addedLabel(w.createdAt)+(w.prefTime?"  ·  wants "+w.prefTime:"")}</div>{w.notes?<div style={{fontSize: T.body,color:S.muted,marginTop:2,fontStyle:"italic"}}>{w.notes}</div>:null}</div><div style={{display:"flex",gap:6,flexShrink:0,marginLeft:"auto",justifyContent:"flex-end",minWidth:ACTIONS_W}}><button
            className="mgt-hover-scale"
            aria-label={"Book ("+party+")"}
            style={mkBtn({fontSize: T.body,background:"var(--app-success-solid)",minHeight:36})}
            onClick={function(){onBook(w);}}>Book</button><button
            className="mgt-hover-scale mgt-press"
            aria-label={(arming?"Confirm — remove (":"Remove (")+party+")"}
            style={mkDangerBtn({fontSize: T.body,minHeight:36})}
            onClick={function(){if(arming){onRemove(w.id);setConfirmId(null);}else setConfirmId(w.id);}}><TrashIcon size={IC.control} />{arming?"Confirm — remove":"Remove"}</button></div></div>
    );
  }

  // A leaving row passes no children: `Reveal` draws the ones it cached, i.e.
  // the row exactly as it last looked, and `inert` keeps its buttons out of
  // reach while it folds. Its bottom margin sits inside the Reveal, so the gap
  // under it folds with it.
  const at={};
  entries.forEach(function(w,i){at[w.id]=i;});
  const rows=order.map(function(id){
    const i=at[id];
    return <Reveal key={id} show={openIds.has(id)} speed={ROW_FOLD} inert={i===undefined}>{i===undefined?null:rowFor(entries[i],i)}</Reveal>;
  });
  // The empty line opens once no row is OPEN. On the commit the last party
  // leaves, its row is still open (useRevealRows closes it in an effect), so the
  // line mounts closed and eases open beside the fold: one swap. It is not
  // rendered at all while anyone is waiting, so a party arriving replaces it
  // in the same frame, as the row itself arrives: measured with the line on a
  // `show` of its own, it folded for 385ms under the new row and the card grew
  // by a row and shrank back.
  const noneOpen=!order.some(function(id){return openIds.has(id);});

  const footerEl=(
    <div style={{display:"flex",justifyContent:"flex-end"}}><button
        className="mgt-hover-scale mgt-press"
        style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
        onClick={onClose}>Done</button></div>
  );

  // v17.10.0: the title pill follows the button that opens it (ModalTitle's
  // colour rule), and that badge is now the pending amber.
  return (
    <Overlay onClose={onClose} footer={footerEl}><AutoHeight><ModalTitle marginBottom={16} background={BLOCK_BG.pending}>{"Waitlist — "+formatDay(date)}</ModalTitle>{rows}{/* v18.3.2 (O3): its own Reveal on
        the rows' speed, so the last party leaving and this line arriving are
        one swap (DESIGN.md: one Reveal cannot animate a swap), and gone at once
        when a party arrives (`noneOpen`, above). */}{entries.length?null:<Reveal show={noneOpen} speed={ROW_FOLD}><div
        style={{textAlign:"center",padding:"24px 0",color:S.muted,fontSize: T.lead}}>No one on the waitlist for this day.</div></Reveal>}<div style={{fontSize: T.small,color:S.muted,textAlign:"center",marginTop:10}}>First come, first served — "Table free" means a table currently fits this party.</div></AutoHeight></Overlay>
  );
}
