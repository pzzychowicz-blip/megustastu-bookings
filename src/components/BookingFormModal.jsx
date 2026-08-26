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
//   onRequestDelete(bookingId)             show the SAME confirm-delete overlay
//                                          the List's Delete uses (v17.10.0)
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

import { useRef, useState, useMemo } from "react";
import { KITCHEN_TABLE_LIMIT, BLOCK_BG, BLOCK_INK, S, BTN, R, hoursFor, INDOOR, OUTDOOR, T, FW, H, IC } from "../lib/constants";
import {
  getDur, toMins, toTime,
  trialFits, findTimes, formatSugg,
  getKitchenLoad, findKitchenFriendlyTimes,
  optimizerActiveFor
} from "../lib/booking-logic";
import { normalizePhone, formatPhone, hasRealPhone, customerIndex, searchCustomers, searchGuestsByName, matchCustomerFor, identityKey, findPhoneOverlaps } from "../lib/customers";
import { Overlay, ModalTitle, Fld, InlineAlert, OutlineChip, Section, TBadge, Toggle, mkInp, mkArea, mkSel, mkBtn, mkSolidBtn, AutoHeight, Reveal, Presence } from "./atoms";
import { AvailBanner } from "./AvailBanner";
import { AlertPanel, AlertRow } from "./AlertPanel";
import { AssignIcon, ChevronDownIcon, ChevronRightIcon, StarIcon, WaitIcon, StatusIcon, NoShowIcon, DoubleCheckIcon, ClashIcon, ClosedIcon, AlertIcon } from "./Icons";
import { useDeferredCompute } from "../hooks/useDeferredCompute";

// v16.3.0: weekday names for the "Repeat weekly" hint (UTC getUTCDay order).
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// v17.12.0: the id the error message renders under and the invalid field points
// at. A module const, not an export — a plain const export from a component
// file trips `react-refresh/only-export-components`, which is a lint ERROR and
// a hard CI gate. Only one modal is ever mounted at a time, so a fixed id
// cannot collide; useId() would be the answer if that stopped being true.
const FORM_ERROR_ID = "mgt-form-error";

export function BookingFormModal({
  form, setForm, editId, error, errorField,
  bookings, liveBookings, tableBlocks,
  autoOptimizer, isMobile,
  onSave, onSavePending, onSaveConfirm, onClose, onClearSwap, onBookAgain,
  onOpenPrefPicker, onOpenManualAssign, onOpenHistory, onRequestCancel, onRequestDelete,
  onAddToWaitlist, standingEnabled,
  currency = "€", regularMin = 2, // v17.0.0: settings/general
}){
  // ── Build form ─────────────────────────────────────────────────────────────
  // Pre-E1, these all lived inline in BookingApp's body. Moved here because
  // they exist only to feed the form modal JSX below.
  const inp=mkInp;
  // v15.8.0 cont.4: status-button click flashes the clicked status colour across the
  // Status section (mirrors the List card wipe). `k` re-keys the overlay so the
  // mgt-wipe-ltr keyframe replays on every click (even re-picking the same status).
  const [statusFlash,setStatusFlash]=useState(null);
  const flashTimer=useRef(null);
  function flashStatus(s){
    setStatusFlash({color:BLOCK_BG[s],k:Date.now()});
    if(flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current=setTimeout(function(){setStatusFlash(null);},800); // v15.9.0: outlives the 760ms wipe
  }
  // ── v16.0.0: customer layer — phone autocomplete + recognition chips ────────
  // Customers are DERIVED from the bookings list (src/lib/customers.js) — no
  // separate collection. The dropdown opens while the phone field is focused
  // and the typed digits match known customers; selecting fills name+phone and
  // (new bookings only) pre-fills size/preference from the latest booking, the
  // same fields Book Again pre-fills.
  const [phoneFocus,setPhoneFocus]=useState(false);
  // v17.3.0: tap-vs-scroll disambiguation for the autocomplete rows. Now that the
  // dropdowns scroll (maxHeight), selecting on `onTouchStart` made a swipe-scroll
  // immediately pick a row — rows past the fold were unreachable on touch. Instead
  // we RECORD the touch start, only select on `onTouchEnd` if the finger barely
  // moved (a tap, not a scroll), and suppress the synthesized mouse event that
  // follows a touch. `acRowSelect(fn)` returns the shared handler bundle so both
  // dropdowns reuse it. React makes touch listeners passive, so we never rely on
  // preventDefault — native scroll is left free.
  const acTouch=useRef({x:0,y:0,scroll:false,ts:0});
  function acRowHandlers(select){
    return {
      // Desktop: mousedown beats the input's blur (which would unmount the list).
      // Guard: ignore the synthesized mousedown that follows a touch (within 600ms).
      onMouseDown:function(e){ if(Date.now()-acTouch.current.ts<600) return; e.preventDefault(); select(); },
      onTouchStart:function(e){ const t=e.touches&&e.touches[0]; acTouch.current={x:t?t.clientX:0,y:t?t.clientY:0,scroll:false,ts:Date.now()}; },
      onTouchMove:function(e){ const t=e.touches&&e.touches[0]; if(t&&(Math.abs(t.clientX-acTouch.current.x)+Math.abs(t.clientY-acTouch.current.y))>12) acTouch.current.scroll=true; },
      onTouchEnd:function(){ acTouch.current.ts=Date.now(); if(!acTouch.current.scroll) select(); },
    };
  }
  // v16.3.0 perf: memoised — rebuilt only when the bookings list changes, not on
  // every keystroke (the form draft lives in the parent, so EVERY field edit
  // re-renders this component).
  const custIdx=useMemo(function(){return customerIndex(bookings);},[bookings]);
  const phoneMatches=phoneFocus&&hasRealPhone(form.phone)
    ?searchCustomers(custIdx,form.phone,20).filter(function(c){
      // hide an exact already-applied selection so the dropdown closes itself
      return !(normalizePhone(form.phone)===c.phone&&form.name===c.name);
    })
    :[];
  function pickCustomer(c){
    const latest=c.bookings[0];
    setForm(function(f){
      const next={name:c.name,phone:c.rawPhone};
      if(!editId){ // Book-Again-style prefill only for NEW bookings
        next.size=latest.size||f.size;
        next.preference=latest.preference||f.preference;
        next.preferredTables=Array.isArray(latest.preferredTables)?latest.preferredTables:f.preferredTables;
      }
      return Object.assign({},f,next);
    });
    setPhoneFocus(false);
  }
  // v16.4.0: NAME-field autocomplete — searches guests by name across BOTH tiers
  // (phone customers + phone-less bookings, per-booking, NEVER merged — see
  // searchGuestsByName). Mirrors the phone dropdown; only shown for NEW bookings
  // (an edit already has its customer). A phone-less pick fills only the name.
  // v17.10.0: the `!editId` gate is GONE. It made the name dropdown a
  // new-bookings-only feature, and an edit form arrives PRE-FILLED — which is
  // exactly the case the reopen fix below is about. A pick while editing fills
  // the name (and the phone, for a phone row) and nothing else: `size` /
  // `preference` / `preferredTables` belong to the booking you are editing, and
  // the `!editId&&latest` guard inside pickGuest already draws that line.
  const [nameFocus,setNameFocus]=useState(false);
  const nameMatches=(nameFocus&&String(form.name||"").trim().length>=2)
    ?searchGuestsByName(bookings,custIdx,form.name,20).filter(function(r){
      // Don't offer the booking you are editing as somebody to link yourself to.
      // Only when it is the row's ONLY booking — a GROUP row that happens to be
      // led by this booking still represents other visits and is a real target.
      if(editId&&r.isPhoneless&&r.count===1&&r.latest&&r.latest.id===editId) return false;
      // Hide an exact already-applied PHONE-customer selection (name+phone both
      // match = this row is what's in the form) so a refocused dropdown isn't
      // noise. Phone-LESS rows are deliberately NOT self-hidden (/code-review):
      // an exact-typed name would hide ALL of them and forfeit their Book-Again
      // prefill — and with two same-name phone-less guests you couldn't switch
      // rows. Picking still closes the dropdown via setNameFocus(false).
      return !(!r.isPhoneless&&r.name===form.name&&normalizePhone(form.phone)===r.phone);
    })
    :[];
  function pickGuest(r){
    const latest=r.latest;
    setForm(function(f){
      const next={name:r.name};
      if(!r.isPhoneless) next.phone=r.rawPhone;
      // v17.10.0: picking a PHONE-LESS guest is the join. This click is the only
      // place a `guestId` is ever minted, because it is the only moment someone
      // who can see both bookings asserts they are the same person — see the
      // never-merge discussion in customers.js → searchGuestsByName.
      //
      // A row that already carries a guestId is an existing group, so the draft
      // just adopts it and there is nothing to write back. An UNJOINED row mints
      // `"g"+<that booking's id>` and records the booking in `guestSeed`, which
      // doSave consumes to stamp the source in the SAME write as the new
      // booking. Deriving the id from data both devices already hold is what
      // makes two clients joining concurrently converge instead of forking the
      // guest in two (the recurring-occurrence-id reasoning).
      //
      // BOTH keys are assigned on EVERY pick, never only on the phone-less
      // branch (/code-review). A pick REPLACES who this booking is for, so the
      // previous pick's keys cannot be allowed to survive it: tap a phone-less
      // guest by mistake, then tap the phone customer you meant, and a
      // conditional assignment leaves the stranger's `guestId` on the draft —
      // the new booking is saved under the phone customer AND joined to the
      // stranger, whose booking `guestSeed` then stamps to match. Two unrelated
      // customers fused, permanently: nothing in the UI can remove a guestId
      // (doSaveEdit's `f.guestId||b.guestId||null` can only ever add one).
      next.guestId=(r.isPhoneless&&latest)?(r.guestId||("g"+latest.id)):null;
      next.guestSeed=(r.isPhoneless&&latest&&!r.guestId)?latest.id:null;
      if(!editId&&latest){ // Book-Again-style prefill (new bookings only)
        next.size=latest.size||f.size;
        next.preference=latest.preference||f.preference;
        next.preferredTables=Array.isArray(latest.preferredTables)?latest.preferredTables:f.preferredTables;
      }
      return Object.assign({},f,next);
    });
    setNameFocus(false);
  }
  // Recognition chips: teal "Regular · X past visits" (the WA module's visual
  // language) + no-show chips — neutral at 1, amber warning at 2+.
  // v16.0.0 follow-up: the chips are CLICKABLE (buttons, ▸/▾ suffix) and reveal
  // the matching past-bookings list — the WA ConversationView Regular-chip
  // disclosure, ported: Regular → regularBookings, no-show → noShowBookings.
  // `chipHist` is keyed by the normalized phone at click time, so editing the
  // phone (a different customer) closes the panel by itself — no effect needed.
  // v17.10.0: resolved on phone OR guestId, so a JOINED phone-less guest earns
  // the same Regular / no-show chips a phone customer does — which is the whole
  // point of the guest identity. matchCustomerFor unions the two keys; see
  // customers.js.
  const custMatch=(hasRealPhone(form.phone)||form.guestId)
    ?matchCustomerFor({phone:form.phone,guestId:form.guestId},bookings,editId)
    :null;
  const [chipHist,setChipHist]=useState(null); // {key,which:"regular"|"noshow"} | null
  // The disclosure panel is keyed by the identity it was opened for, so changing
  // the phone (or picking a different guest) closes it by itself — no effect
  // needed. v17.10.0: that key is now the resolved identity, not the phone
  // alone, or the panel would never self-close for a phone-less guest.
  const phoneKeyNow=identityKey({phone:form.phone,guestId:form.guestId})||"";
  const histWhich=chipHist&&chipHist.key===phoneKeyNow?chipHist.which:null;
  function toggleChipHist(which){
    setChipHist(histWhich===which?null:{key:phoneKeyNow,which:which});
  }
  // v17.8.0: OUTLINE chips, matching the Customers tab — no fill, a 2px border
  // in the semantic hue, the text in the same family. They are standalone
  // disclosures above a form field rather than tags packed into a status row,
  // so the border alone carries the colour and the fill was a third copy of it.
  // v17.9.0: `gap` is new — the disclosure marker is now an SVG sibling rather
  // than a " ▾" tacked onto the label string, so the space has to be real.
  // v17.15.0: the shared `OutlineChip`, `as="button"` for the disclosure kind.
  // `chipBase` was the second hand-written copy of it (CustomersSettings had the
  // other), and the two disagreed on their colour SOURCE: border from the
  // --suggest/--warn families, text from --success-text/--warn-text. A tone is
  // one decision now. `size="small"` keeps this chip's wider inset and T.small —
  // it sits in a form beside inputs, not in a dense settings row.
  const chipMark=function(which){return histWhich===which?<ChevronDownIcon size={IC.inline} />:<ChevronRightIcon size={IC.inline} />;};
  const regularChip=custMatch&&custMatch.regularCount>=1?<OutlineChip
    key="reg" tone="success" as="button" size="small" type="button" className="mgt-hover-scale mgt-press"
    onClick={function(){toggleChipHist("regular");}}><span>{custMatch.regularCount>=(regularMin||2)?"Regular · "+custMatch.regularCount+" past visits":custMatch.regularCount+" past visit"+(custMatch.regularCount!==1?"s":"")}</span>{chipMark("regular")}</OutlineChip>:null;
  const noShowChip=custMatch&&custMatch.noShowCount>=1?(custMatch.noShowCount>=2?<OutlineChip
    key="ns" tone="warn" as="button" size="small" type="button" className="mgt-hover-scale mgt-press"
    onClick={function(){toggleChipHist("noshow");}}><span>{"No-show ×"+custMatch.noShowCount}</span>{chipMark("noshow")}</OutlineChip>:<OutlineChip
    key="ns" tone="neutral" as="button" size="small" type="button" className="mgt-hover-scale mgt-press"
    onClick={function(){toggleChipHist("noshow");}}><span>1 no-show</span>{chipMark("noshow")}</OutlineChip>):null;
  // Disclosure panel — the WA pastListBody, on app tokens (suggest family for
  // Regular, warn family for no-shows). Top 5 rows like WA; a muted "+N earlier"
  // tail when there are more. Reveal (below) eases it open/closed; its cached-
  // children fallback animates the collapse when the panel goes null.
  // v17.15.2: both panels are `AlertPanel` — the notification strip's section
  // shape. They were the banned label treatment (a pale semantic fill PLUS a
  // border in the matching hue PLUS bold text in a third shade), and the fill
  // and border were carrying the ROLE while the title carried it a third time.
  //
  // `histTk` collapses to a role name, which is the point of ALERT_TONES: the
  // two hand-paired token triples were the place a mismatch could hide, and one
  // of them — warn — was measurably a different HUE per theme until this
  // version's second commit. The rows keep --text-primary; only the title is
  // tinted, exactly as a strip section heads its own body.
  //
  // The marks come from the status vocabulary rather than being chosen for
  // these panels: past bookings ARE completed visits (DoubleCheckIcon, the
  // completed mark) and no-shows are no-shows (NoShowIcon, which the chip that
  // discloses this panel already wears).
  function histPanel(which){
    const histList=custMatch?(which==="regular"?custMatch.regularBookings:custMatch.noShowBookings):null;
    if(!histList||!histList.length) return null;
    const noshow=which==="noshow";
    return <AlertPanel
      role={noshow?"warn":"success"}
      icon={noshow?NoShowIcon:DoubleCheckIcon}
      title={noshow?"No-shows":"Past bookings"}
      count={histList.length}
      style={{marginTop:8}}>
      {histList.slice(0,5).map(function(b,i){return <AlertRow key={b.id} first={i===0}>{(b.date||"?")+" · "+(b.scheduledTime||b.time)+" · "+b.size+" pax · "+b.status}</AlertRow>;})}
      {histList.length>5?<AlertRow style={{color:S.muted}}>{"+ "+(histList.length-5)+" earlier"}</AlertRow>:null}
    </AlertPanel>;
  }
  // v17.8.0: ONE Reveal PER PANEL, not one Reveal shared by both. Switching
  // Regular → No-shows never changed `show`, so the swap happened inside an
  // already-open box: the rows were replaced in a single frame and the box's
  // height snapped to the new list — the one transition in this area that was
  // missing, and the more visible of the two because the panels differ in
  // height. Two Reveals make the switch what it actually is (one disclosure
  // closing while the other opens) and both ends ride the atom the rest of the
  // app already uses. They animate on the same curve over the same duration, so
  // the container height interpolates straight from one panel's to the other's
  // with no bulge in between.
  const regPanel=histWhich==="regular"?histPanel("regular"):null;
  const nsPanel=histWhich==="noshow"?histPanel("noshow"):null;
  // v17.4.0 — SAME-PHONE double-booking warning. Same customer (matched on the
  // normalized phone, the customers.js identity primitive), same DATE, and the
  // two time windows OVERLAP → an amber advisory row under the chips. Advisory
  // only: it never blocks Save — a real party legitimately books twice (two
  // tables at once, a party splitting), and staff decide. Cancelled/completed
  // are excluded (a completed earlier visit isn't a double-booking), as is the
  // booking being edited. Cheap: one filter over `bookings` keyed on the four
  // fields that can change it.
  const dupPhone=useMemo(function(){
    return findPhoneOverlaps(bookings,{phone:form.phone,date:form.date,time:form.time,
      size:form.size,dur:form.customDur,excludeId:editId});
  },[bookings,form.phone,form.date,form.time,form.size,form.customDur,editId]);
  // v17.15.2: an AlertPanel. The sentence is the section TITLE (it states the
  // fault) and the clashing bookings are its rows — the division every strip
  // section makes. ClashIcon rather than a generic warning mark: this IS the
  // double-booking the strip's own Double-booked section reports, seen from
  // inside the form that is about to create one.
  const dupWarn=dupPhone.length?<AlertPanel role="warn" icon={ClashIcon} style={{marginTop:8}}
    title={"This phone already has "+(dupPhone.length>1?dupPhone.length+" overlapping bookings":"an overlapping booking")+" on "+form.date+":"}>
    {dupPhone.slice(0,3).map(function(b,i){return <AlertRow key={b.id} first={i===0}>{(b.time||"?")+"–"+toTime(toMins(b.time)+(b.duration||90))+" · "+b.size+" pax"+((b.tables||[]).length?" · "+b.tables.join("+"):"")}</AlertRow>;})}
    {dupPhone.length>3?<AlertRow>{"+ "+(dupPhone.length-3)+" more"}</AlertRow>:null}
  </AlertPanel>:null;
  // The container stays mounted while ANY of the three can render, so the
  // dupWarn Reveal below can animate its collapse instead of being torn out
  // with its parent (it is often the only content, for a first-time guest).
  const custChips=(regularChip||noShowChip||dupPhone.length)?<div style={{paddingTop:8}}>
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{regularChip}{noShowChip}</div>
    <Reveal show={!!regPanel}>{regPanel}</Reveal>
    <Reveal show={!!nsPanel}>{nsPanel}</Reveal>
    <Reveal show={!!dupWarn}>{dupWarn}</Reveal>
  </div>:null;
  // Dropdown rows use onMouseDown/onTouchStart (fire BEFORE the input's blur)
  // so the tap lands before phoneFocus flips false. Opaque sheet token per the
  // popover rule (a translucent card reads see-through over form content).
  const phoneDropdown=phoneMatches.length?<div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,zIndex:30,background:"var(--bg-ac-menu)",border:"1px solid var(--border-sheet)",borderRadius:R.card,boxShadow:"var(--shadow-sheet)",overflowX:"hidden",overflowY:"auto",maxHeight:264}}>{phoneMatches.map(function(c){return (
    <div
      key={c.phone}
      className="mgt-ac-row"
      {...acRowHandlers(function(){pickCustomer(c);})}
      style={{padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid var(--border-soft)"}}><div style={{flex:1,minWidth:0}}><div style={{fontSize: T.body,fontWeight: FW.semi,color:S.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name||"(no name)"}</div><div style={{fontSize: T.small,color:S.muted}}>{formatPhone(c.phone)}</div></div><div style={{display:"flex",gap:4,flexShrink:0}}>{/* v17.15.0: these were the banned shape in full — pale semantic fill PLUS a
              border in the matching hue PLUS bold text in a third shade. They are
              the same counts as the Customers tab's chips, so they are now the
              same chip. */}{c.visits>0?<OutlineChip tone="success">{c.visits+" visit"+(c.visits!==1?"s":"")}</OutlineChip>:null}{c.noShowCount>0?<OutlineChip tone="warn">{c.noShowCount+" no-show"+(c.noShowCount!==1?"s":"")}</OutlineChip>:null}</div></div>
  );})}</div>:null;
  // v16.4.0: name-search dropdown — same opaque-sheet chrome as phoneDropdown.
  // Each row shows the phone (or "no phone") + last date so two same-name
  // phone-less guests are visually distinguishable (they are separate rows).
  const nameDropdown=nameMatches.length?<div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,zIndex:30,background:"var(--bg-ac-menu)",border:"1px solid var(--border-sheet)",borderRadius:R.card,boxShadow:"var(--shadow-sheet)",overflowX:"hidden",overflowY:"auto",maxHeight:264}}>{nameMatches.map(function(r){return (
    <div
      key={r.key}
      className="mgt-ac-row"
      {...acRowHandlers(function(){pickGuest(r);})}
      style={{padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid var(--border-soft)"}}><div style={{flex:1,minWidth:0}}><div style={{fontSize: T.body,fontWeight: FW.semi,color:S.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.name||"(no name)"}</div><div style={{fontSize: T.small,color:S.muted}}>{(r.isPhoneless?"no phone":formatPhone(r.phone))+(r.latestDate?"  ·  last "+r.latestDate:"")+(r.count>1?"  ·  "+r.count+" bookings":"")}</div></div>{r.isPhoneless?<span style={{fontSize: T.micro,fontWeight: FW.bold,color:"var(--text-secondary)",background:"var(--bg-input)",border:"1px solid var(--border-soft)",borderRadius:R.pill,padding:"2px 6px",flexShrink:0}}>no phone</span>:null}</div>
  );})}</div>:null;

  const formCols=isMobile?"1fr":"1fr 1fr";
  const auto=getDur(Number(form.size));
  const dur=form.customDur||auto;
  // v15.0.0: per-weekday hours for THIS booking's date (which may differ from the
  // viewed day) — drives the time min/max + a closed-day notice.
  const fh=hoursFor(form.date);
  // /code-review: hours SIGNATURE for the scan deps — hoursFor reads the live
  // WEEK_HOURS binding, so a Settings hours change on another device changes fh
  // WITHOUT any form.* dep changing; keying the deferred scans on this string
  // re-checks availability instead of leaving a stale banner until the next
  // input nudge.
  const hoursSig=fh.closed?"closed":fh.open+"-"+fh.close;

  // ── Real-time availability check (trial optimization) ──
  // Pre-E1's showForm guard is dropped — this component is only mounted when
  // the parent has showForm=true.
  // v16.3.0 perf: the trial optimisation (trialFits) and especially the full-day
  // suggestion scan (findTimes = trialFits per quarter-slot) are the heaviest
  // computations in the app — on a day with an unplaceable booking (optimise's
  // retry pass ~70ms per trial) they froze form-open for seconds. Perf phase 2:
  // useDeferredCompute runs them POST-PAINT (the modal opens instantly, the
  // banner eases in when the result lands ~a frame later; ⏳ cue past ~150ms) and
  // only when the actual scan inputs change — never on name/notes keystrokes or
  // the 15s tick. liveBookings is referentially stable across keystrokes since
  // App's v16.3.0 useMemo. `value` is null while (re-)checking — the banner
  // collapses rather than showing a stale answer (Patryk-chosen).
  const availScan=useDeferredCompute(function(){
    if(!form.time) return null;
    if(fh.closed) return null; // closed day → no availability to compute
    const sm=toMins(form.time);
    if(sm<fh.open*60||sm>fh.close*60) return null;
    const size=Number(form.size)||2;
    const d=form.customDur||getDur(size);
    const mt=Array.isArray(form.manualTables)&&form.manualTables.length>0?form.manualTables:null;
    if(mt) return {ok:true,tables:mt,sugg:null};
    const noResh=!optimizerActiveFor(form.date,autoOptimizer);
    const tables=trialFits(liveBookings,form.date,form.time,size,form.preference||"auto",d,tableBlocks,editId,form.preferredTables,noResh);
    if(tables) return {ok:true,tables:tables,sugg:null};
    const sugg=findTimes(form.date,size,form.preference,liveBookings,d,sm,tableBlocks,editId,noResh);
    return {ok:false,tables:null,sugg:formatSugg(sugg,sm)};
  },[form.time,form.date,form.size,form.customDur,form.preference,form.manualTables,form.preferredTables,liveBookings,tableBlocks,editId,autoOptimizer,hoursSig]);
  const formAvail=availScan.value;

  const tablesBtn=(function(){
    const mt=Array.isArray(form.manualTables)&&form.manualTables.length>0?form.manualTables:null;
    const previewTbls=mt?null:(formAvail&&formAvail.ok?formAvail.tables:null);
    const prefs=form.preferredTables||[];
    const hasPref=prefs.length>0;
    const prefBtn=<button
      className="mgt-hover-scale"
      style={mkBtn({background:hasPref?"var(--btn-tables)":BTN.nav,fontSize: T.body,padding:"6px 10px",display:"inline-flex",alignItems:"center",gap:6})}
      onClick={function(){onOpenPrefPicker();}}><StarIcon size={IC.inline} />{hasPref?prefs.join("+"):"Preferred"}</button>;
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
        <span key="lbl" style={{fontSize: T.body,color:"var(--text-secondary)",fontWeight: FW.medium}}>Tables</span>];
      if(showTbl) showTbl.forEach(function(id){leftEls.push(<TBadge key={id} id={id} />);});
      else if(previewTbls){previewTbls.forEach(function(id){leftEls.push(<TBadge key={id} id={id} />);});leftEls.push(<span key="auto" style={{fontSize: T.small,color:S.muted,fontStyle:"italic"}}>(auto)</span>);}
      if((changed||cleared)&&!mt&&curTbl) leftEls.push(<span key="prev" style={{fontSize: T.small,color:S.muted,fontStyle:"italic"}}>{"was: "+curTbl.join(", ")}</span>);
      if(mt) leftEls.push(<button
        key="clrmt"
        className="mgt-hover-scale mgt-press"
        style={mkBtn({fontSize: T.body,background:BTN.clear})}
        onClick={function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});onClearSwap();}}>Clear</button>);
      if(showClearManual) leftEls.push(<button
        key="clrman"
        className="mgt-hover-scale mgt-press"
        style={mkBtn({fontSize: T.body,background:BTN.clear})}
        onClick={function(){setForm(function(f){return Object.assign({},f,{manualTables:[],_clearManual:true});});onClearSwap();}}>Clear</button>);
      return (
        <Section><div
            style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><div
              style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flex:1,minWidth:0}}>{leftEls}</div><div style={{display:"flex",gap:6,flexShrink:0}}><button
                className="mgt-hover-scale"
                style={mkBtn({background:BTN.tables,display:"inline-flex",alignItems:"center",gap:6})}
                onClick={function(){onOpenManualAssign(editId);}}><AssignIcon size={IC.control} />Assign</button>{prefBtn}</div></div></Section>
      );
    }
    const leftEls=[<span key="lbl" style={{fontSize: T.body,color:"var(--text-secondary)",fontWeight: FW.medium}}>Tables</span>];
    if(mt) mt.forEach(function(id){leftEls.push(<TBadge key={id} id={id} />);});
    else if(previewTbls){previewTbls.forEach(function(id){leftEls.push(<TBadge key={id} id={id} />);});leftEls.push(<span key="auto" style={{fontSize: T.small,color:S.muted,fontStyle:"italic"}}>(auto)</span>);}
    if(mt) leftEls.push(<button
      key="clrmt"
      className="mgt-hover-scale mgt-press"
      style={mkBtn({fontSize: T.body,background:BTN.clear})}
      onClick={function(){setForm(function(f){return Object.assign({},f,{manualTables:[]});});onClearSwap();}}>Clear</button>);
    return (
      <Section><div
          style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><div
            style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",flex:1,minWidth:0}}>{leftEls}</div><div style={{display:"flex",gap:6,flexShrink:0}}><button
              className="mgt-hover-scale"
              style={mkBtn({background:BTN.tables,display:"inline-flex",alignItems:"center",gap:6})}
              onClick={function(){onOpenManualAssign("__new__");}}><AssignIcon size={IC.control} />Assign</button>{prefBtn}</div></div></Section>
    );
  })();

  // v16.0.0: when nothing fits, offer the waitlist (new bookings only — an
  // edited booking already exists; waitlisting it would double-track the party).
  const availBanner=formAvail&&!formAvail.ok?<><AvailBanner
    msg={"No tables available"+(form.preference!=="auto"?" ("+form.preference+" preference)":"")+"."}
    sugg={formAvail.sugg}
    onTapTime={function(t){setForm(function(f){return Object.assign({},f,{time:t});});}} />{!editId&&onAddToWaitlist?<div style={{display:"flex",justifyContent:"center",marginTop:-4,marginBottom:12}}><button
      className="mgt-hover-scale"
      /* v17.10.0: pending amber — the waitlist's colour, see App's badge. */
      style={mkBtn({fontSize: T.body,background:BLOCK_BG.pending,minHeight:40,padding:"8px 16px",display:"inline-flex",alignItems:"center",gap:6})}
      onClick={function(){onAddToWaitlist();}}><WaitIcon size={IC.control} />Add to waitlist</button></div>:null}</>:null;
  // v15.0.0: closed-day notice — the chosen date falls on a weekday marked Closed
  // (Settings → General → Opening hours). doSave blocks the write; this explains why.
  // v17.15.2: an AlertPanel, and it takes ClosedIcon — the same mark the strip's
  // own "Closed this day" section wears for the same fact about the same day.
  // The centred text went with the border: a strip section is left-aligned
  // under its mark, and this is one sentence with no rows, which is exactly the
  // one-line shape the strip already has a precedent for.
  const closedBanner=fh.closed?<AlertPanel role="warn" icon={ClosedIcon} style={{marginBottom:12}}
    title={"Closed on "+["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date(form.date).getUTCDay()]+"s — bookings can't be saved for this date. Open that day in Settings, or pick another date."} />:null;

  // Pre-E1's showForm guard is dropped — component is only mounted when showForm=true.
  const kitchenLoad=form.time?getKitchenLoad(bookings,form.date,form.time,form.customDur||getDur(Number(form.size)||2),editId):null;
  const kitchenStarts=kitchenLoad?kitchenLoad.starts+1:1;
  const kitchenGuests=kitchenLoad?kitchenLoad.guests+(Number(form.size)||2):Number(form.size)||2;
  const kitchenBusy=kitchenLoad&&kitchenStarts>=KITCHEN_TABLE_LIMIT;
  // v16.3.0 perf: deferred like formAvail — a per-quarter-slot day scan that must
  // not run at mount-paint time nor on unrelated keystrokes (name/notes/phone).
  // getKitchenLoad/kitchenBusy above stay synchronous (cheap, O(day)) so the
  // "Starting at this time: N bookings · N guests" line renders instantly; only
  // the suggested-times chips arrive post-paint.
  const kitchenScan=useDeferredCompute(function(){
    return kitchenBusy?findKitchenFriendlyTimes(bookings,form.date,Number(form.size)||2,form.preference||"auto",form.customDur||getDur(Number(form.size)||2),form.time,editId,tableBlocks):null;
  },[kitchenBusy,bookings,form.date,form.size,form.preference,form.customDur,form.time,editId,tableBlocks,hoursSig]);
  const kitchenSugg=kitchenScan.value;
  // v16.3.0 perf phase 2: the ⏳ cue — shown while a deferred scan is pending.
  // Its Reveal's ~300ms ease is the natural grace: a fast scan unmounts it
  // having barely opened (imperceptible sliver), a slow scan shows it fully.
  // One shared row covers both scans; it sits in the availBanner's slot region.
  const availChecking=availScan.pending||(kitchenBusy&&kitchenScan.pending);
  const checkingRow=<div style={{background:"var(--bg-soft)",border:"1px solid var(--border-soft)",borderRadius:R.card,padding:"10px 14px",marginBottom:12,fontSize: T.body,fontWeight: FW.medium,color:"var(--text-muted)",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><span aria-hidden="true" className="mgt-dot-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--text-muted)", flexShrink: 0 }} />Checking table availability…</div>;
  // v17.8.0 review fix: these two colours are hex literals ON PURPOSE, and must
  // stay that way. The chip FILLS below are hard-coded pale green / pale yellow
  // — deliberately theme-invariant, like the timeline's BLOCK_BG. The token
  // sweep swapped the text to --success-text / --status-pending-text, which
  // INVERT between themes (#166534 -> #86efac, #854d0e -> #fde047), so in dark
  // mode pale-green chips carried light-green text at about 1.3:1. Triage rule:
  // a token may only be used where the SURFACE UNDER it flips too. It doesn't
  // here, so neither may the text.
  const KTXT_OK="#166534", KTXT_TIGHT="#854d0e";   /* @fixed-fill */
  function renderKitchenTimes(arr){
    if(!arr||!arr.length) return null;
    return arr.map(function(r){return (
      <span
        key={r.timeStr}
        className="mgt-hover-scale"
        onClick={function(){setForm(function(f){return Object.assign({},f,{time:r.timeStr});});}}
        style={{cursor:"pointer",padding:"2px 8px",borderRadius:R.pill,fontWeight: FW.semi,fontSize: T.body,background:r.hasTables?"rgba(220,252,231,0.8)":"rgba(254,249,195,0.8)", /* @fixed-fill */ color:r.hasTables?KTXT_OK:KTXT_TIGHT,border:"1px solid "+(r.hasTables?"rgba(134,239,172,0.5)":"rgba(253,230,138,0.5)"),boxShadow:"var(--shadow-flat)"}}>{r.timeStr}</span>
    );});
  }
  // v15.8.0 cont.4: the kitchen suggestion sub-panel (the part that appears when the
  // kitchen is busy) eases in/out via Reveal — the same effect as the Summary panel.
  const kitchenSugBlock=(kitchenSugg&&(kitchenSugg.before.length||kitchenSugg.after.length))?<div style={{marginTop:8}}><div style={{fontSize: T.small,color:S.muted,marginBottom:6}}><span
          style={{background:"rgba(220,252,231,0.8)", /* @fixed-fill */ color:KTXT_OK,padding:"2px 6px",borderRadius:R.pill,fontSize: T.micro,fontWeight: FW.semi}}>green</span>= tables available  <span
          style={{background:"rgba(254,249,195,0.8)", /* @fixed-fill */ color:KTXT_TIGHT,padding:"2px 6px",borderRadius:R.pill,fontSize: T.micro,fontWeight: FW.semi}}>yellow</span>= kitchen ok, tables tight</div>{kitchenSugg.before.length?<div style={{marginBottom:4}}><span style={{fontWeight: FW.bold,fontSize: T.body}}>Before: </span><span style={{display:"inline-flex",gap:4,flexWrap:"wrap"}}>{renderKitchenTimes(kitchenSugg.before)}</span></div>:null}{kitchenSugg.after.length?<div><span style={{fontWeight: FW.bold,fontSize: T.body}}>After: </span><span style={{display:"inline-flex",gap:4,flexWrap:"wrap"}}>{renderKitchenTimes(kitchenSugg.after)}</span></div>:null}</div>:
    (kitchenBusy?<div style={{marginTop:6,fontSize: T.body,color:"var(--danger-text)"}}>No kitchen-friendly alternatives found nearby.</div>:null);
  // v17.15.2. Two things happened here, and only the FIRST is the pane sweep.
  //
  // (1) The BUSY state was the banned semantic triple and is now an AlertPanel.
  //     The CALM state deliberately is not: --bg-soft with a neutral border is
  //     an information panel, not a notice, and the whole point of the strip
  //     shape is that it means "something needs your attention".
  //
  // (2) The "Kitchen busy" chip was an OutlineChip written by hand — 2px-ish
  //     border, pill radius, transparent fill, bold semantic text — with its
  //     ink from --text-required and its border from a hand-written
  //     rgba(220,38,38,0.4). That is the border-and-ink-from-unrelated-families
  //     defect v17.15.0 removed from the two real chips, surviving here because
  //     nothing scans for a chip that never imported the atom. It was also a
  //     THEME-INVARIANT ink (#dc2626) on a fill that inverts, the same fault as
  //     the offline section: measured 4.11:1 in light and 2.86:1 in dark,
  //     below AA in both and worst in dark. `tone="danger"` gives 7.08 / 7.27
  //     with the border derived from the ink.
  const kitchenBody=<><div
      style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}><span><span style={{fontWeight: FW.bold}}>Starting at this time: </span>{kitchenStarts+" booking"+(kitchenStarts!==1?"s":"")+" · "+kitchenGuests+" guest"+(kitchenGuests!==1?"s":"")}</span>{kitchenBusy?<OutlineChip tone="danger" size="small">Kitchen busy</OutlineChip>:null}</div><Reveal show={!!kitchenSugBlock}>{kitchenSugBlock}</Reveal></>;
  const kitchenSection=kitchenLoad?(kitchenBusy
    ?<AlertPanel role="warn" icon={AlertIcon} title="Kitchen may be busy" style={{marginBottom:14}}>
      <AlertRow first>{kitchenBody}</AlertRow>
     </AlertPanel>
    :<div style={{padding:"10px 14px",borderRadius:R.card,border:"1px solid var(--border-soft)",background:"var(--bg-soft)",marginBottom:14,fontSize: T.body,color:S.muted}}>{kitchenBody}</div>):null;

  // v17.6.0: which statuses the edit form offers.
  //
  //   • pending   → only ">Confirmed" (the v17.0.0 gating rule: a pending
  //                 booking's ONLY forward status is confirmed; Cancel/Delete
  //                 stay reachable elsewhere for the decline flow).
  //   • otherwise → confirmed / seated / completed / cancelled, as before, PLUS
  //                 ">Pending" — but only while the party has NOT sat down.
  //                 Walking a confirmed (or a revived cancelled) booking back to
  //                 "awaiting confirmation" is a real thing; offering it on a
  //                 seated or completed visit would contradict a physical fact
  //                 that already happened.
  //
  // The trailing filter drops the booking's CURRENT status, so no row ever
  // offers a no-op button.
  const statusTargets=(function(){
    if(form.status==="pending") return ["confirmed"];
    const base=["confirmed","seated","completed","cancelled"];
    const sat=form.status==="seated"||form.status==="completed";
    return (sat?base:base.concat(["pending"])).filter(function(s){return s!==form.status;});
  })();
  const quickStatusBtns=editId?<Section style={{position:"relative"}}>{statusFlash?(
        <div key={statusFlash.k} className="mgt-wipe-ltr" style={{position:"absolute",inset:0,borderRadius:R.card,pointerEvents:"none",zIndex:0,background:statusFlash.color,opacity:0.5}} />
      ):null}<div style={{position:"relative",zIndex:1,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}><span style={{fontSize: T.body,color:"var(--text-secondary)",fontWeight: FW.medium,marginRight:4}}>Status:</span>{statusTargets.map(function(s){return (
        // v17.10.0: the per-status mark, from the ONE source in Icons.jsx that
        // this row, the List card and the quick-status popup all read.
        <button
          key={s}
          className="mgt-hover-scale"
          style={mkBtn({background:BLOCK_BG[s],color:BLOCK_INK[s]||"var(--text-on-accent)",textTransform:"capitalize",minHeight:H.control,display:"inline-flex",alignItems:"center",gap:6})}
          onClick={function(){flashStatus(s);if(s==="cancelled"){onRequestCancel(editId);return;}setForm(function(f){return Object.assign({},f,{status:s});});}}><StatusIcon status={s} size={IC.control} />{s}</button>
      );})}</div></Section>:null;

  const historyBtn=(function(){
    if(!editId) return null;
    const cur=bookings.find(function(b){return b.id===editId;});
    if(!cur||!cur.history||!cur.history.length) return null;
    return (
      <button
        onClick={function(){onOpenHistory();}}
        className="mgt-hover-scale"
        style={mkBtn({fontSize: T.body,background:"var(--app-btn-slate)",padding:"8px 16px",minHeight:36})}>{"History ("+cur.history.length+")"}</button>
    );
  })();
  // v14: Book Again button — visible only in Edit Booking modal when status is
  // seated or completed. One tap closes the edit modal and opens a new-booking
  // form pre-filled with this customer's details (name, phone, size, preference,
  // preferred tables, original time). Staff must still pick a date.
  // v17.10.0: Delete, in the form. It existed only on the List card, so deleting
  // a booking you had open meant closing the form, finding the card again and
  // deleting from there — and in Timeline or Plan there was no route to it at
  // all without switching view. Edit mode only: there is nothing to delete on a
  // new booking.
  //
  // It raises the SAME confirm overlay the List's Delete raises (App's
  // confirmDel) rather than a second dialog of its own — one armed confirm for
  // one irreversible action, and Firebase's free plan has no backups. App closes
  // the form on the delete path.
  const deleteBtn=editId?(
    <button
      onClick={function(){onRequestDelete(editId);}}
      className="mgt-hover-scale mgt-press"
      style={mkBtn({fontSize: T.body,background:BTN.del,padding:"8px 16px",minHeight:36})}>Delete</button>
  ):null;
  const bookAgainBtn=(function(){
    if(!editId) return null;
    const cur=bookings.find(function(b){return b.id===editId;});
    if(!cur) return null;
    if(cur.status!=="seated"&&cur.status!=="completed") return null;
    return (
      <button
        onClick={function(){onBookAgain(cur);}}
        className="mgt-hover-scale"
        style={mkBtn({fontSize: T.body,background:"var(--app-success-solid)",padding:"8px 16px",minHeight:36})}>Book again</button>
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
        /* v17.8.0 correction (Patryk): was a filled card banner — pale green
           fill + matching border + bold green text, i.e. the exact three-copies-
           of-one-signal shape CLAUDE.md bans, and the generic "AI wrote this"
           alert box. It is now the OUTLINE PILL used by the Regular / N-past-
           visits chips it sits directly above, so the two read as one family:
           no fill, a 2px border in the semantic hue, text in the same family.
           Copy trimmed — the old sentence restated "re-booking" after a title
           that already says Book again — but "set a date" STAYS. Book Again
           deliberately clears the date to force a deliberate choice, and the
           Save button is disabled until one is set with nothing on screen
           explaining why. That clause is the explanation, not decoration. */
        /* Centred under the title pill it belongs to. `inline-flex` alone
           left-aligns, because the banner is a sibling of the title's centred
           wrapper rather than inside it — so it needs `width:fit-content` plus
           auto side margins to shrink-wrap AND centre. */
        style={{display:"flex",width:"fit-content",margin:"0 auto 10px",alignItems:"center",border:"2px solid var(--suggest-border)",borderRadius:R.pill,padding:"2px 10px",fontSize: T.small,fontWeight: FW.bold,color:"var(--success-text)"}}>{"Return guest · "+src.name+" · "+src.date+" "+srcTime+" — set a date"}</div>
    );
  })();

  // v17.12.0: the message is announced, and the field that caused it points at
  // it. Two separate wirings, and they need opposite mount strategies.
  //
  // The `role="alert"` wrapper is ALWAYS rendered, even with no error. An alert
  // is announced when its CONTENT changes, and a region that arrives already
  // holding its first message is the live-region pitfall this version keeps
  // running into (see notifAnnounce in App). An empty div is a block box with
  // no content, padding or margin, so it costs nothing visually — verified
  // against the footer layout, which is a fragment.
  //
  // Assertive rather than polite because this fires in response to pressing
  // Save: the user is waiting on exactly this answer.
  // v17.15.0: the shared InlineAlert. `id` stays on the element itself, because
  // that is what `aria-describedby` names — `Fld` emits the reference only when
  // the caller says the field is invalid, and a describedby aimed at an id not
  // in the tree is the dangling reference the atom exists to avoid.
  // v17.15.0: eased, in BOTH directions. The alert appears and disappears while
  // the modal is open and being read — pressing Save raises it, typing into the
  // field clears it — so it is exactly the case the in-and-out rule is about,
  // and it was snapping the footer (and the card above it) by its own height.
  // `Reveal` caches its last truthy child, which is what makes the exit animate
  // once `error` is already null. The `role="alert"` div stays OUTSIDE it and
  // permanently mounted: a live region announces a change to its CONTENT, so a
  // region that arrives holding its message says nothing.
  const errorEl=<div role="alert"><Reveal show={!!error}>{error?
    <InlineAlert id={FORM_ERROR_ID} style={{marginBottom:14}}>{error}</InlineAlert>
  :null}</Reveal></div>;
  // Gated on `error` as well as the field name, so the id handed to
  // aria-describedby can only ever name an element that is on screen.
  function invalidField(name){return !!error&&errorField===name;}

  const resetDurBtn=form.customDur?<button
    key="rd"
    className="mgt-hover-scale mgt-press"
    style={mkBtn({fontSize: T.body,background:BTN.reset})}
    onPointerDown={function(){setForm(function(f){return Object.assign({},f,{customDur:null});})}}>Reset</button>:null;
  const endTime=form.time?toTime(toMins(form.time)+dur):"--";

  // v14.4.1: action row pinned to the modal bottom via Overlay's `footer` slot.
  // errorEl rides above the buttons so a save/availability error stays visible
  // without scrolling. marginTop dropped — the footer region's borderTop+padding
  // provides the separation now.
  // v17.0.0: pending flow. New bookings get a left-aligned "Save pending"
  // (saves the booking with status=pending — still awaiting confirmation).
  // Editing a booking whose PERSISTED status is pending gets "Save&confirm"
  // to the right of Save booking; it slides out to the RIGHT (Presence,
  // mgt-slide-*-r) the moment the draft status leaves "pending" (the >Confirmed
  // status button), per spec.
  const origPendingBooking=editId?bookings.find(function(b){return b.id===editId&&b.status==="pending";}):null;
  const footerEl=(
    <>
      {errorEl}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{historyBtn}{bookAgainBtn}{deleteBtn}{(function(){
        if(editId) return null;
        const canSave=!!form.date;
        return (
          <button
            disabled={!canSave}
            onClick={onSavePending}
            className="mgt-hover-scale"
            /* v17.8.0: demoted from a solid amber pill to the OUTLINE treatment
               (CLAUDE.md's second label shape — no fill, 2px border in the
               semantic hue, text in the same family). It used to be one of three
               equally loud saturated pills in this footer, so the row had no
               primary at all at the highest-stakes moment in the app. It is an
               ALTERNATIVE save, not the main one, and it should look like it.
               The amber pair here is a legitimate use of --status-pending-*:
               both the text token and the sheet under it flip with the theme,
               unlike the banned case where a flipping token sits on a fixed fill. */
            style={{background:"transparent",border:"2px solid "+(canSave?"rgba(var(--status-pending-rgb),0.55)":"var(--border-soft)"),borderRadius:R.pill,padding:"8px 16px",cursor:canSave?"pointer":"not-allowed",fontSize: T.lead,fontWeight: FW.semi,color:canSave?"var(--status-pending-text)":"var(--text-faint)",minHeight:44}}>Save pending</button>
        );
      })()}</div><div style={{display:"flex",gap:8}}><button
        className="mgt-hover-scale"
        /* v17.8.0: was BTN.cancel — the RED one. In this app "cancel" means
           cancel the BOOKING, which is why that token is red; this button closes
           the FORM. CLAUDE.md names this exact trap and names the fix, and it
           was sitting two buttons away from a red-adjacent amber and a blue
           primary, so the footer read as three warnings. --app-btn-slate is the
           documented neutral dialog secondary. */
        style={mkBtn({minHeight:44,padding:"10px 18px",background:"var(--app-btn-slate)"})}
        onClick={function(){onClose();}}>Back</button>{(function(){
        // v14 p1 (Issue 3): Save is disabled when date is empty. Prevents the
        // dd.mm.yyyy placeholder state from being submitted (esp. via Book Again
        // where we intentionally clear the date to force staff to pick one).
        const canSave=!!form.date;
        return (
          <button
            disabled={!canSave}
            onClick={onSave}
            className="mgt-hover-scale"
            style={mkSolidBtn(canSave?S.accent:"var(--btn-disabled)",{cursor:canSave?"pointer":"not-allowed",color:canSave?"var(--text-on-accent)":"var(--btn-disabled-ink)",boxShadow:canSave?"var(--shadow-btn-accent)":"none"})}>Save booking</button>
        );
      })()}{origPendingBooking?(
        <Presence show={form.status==="pending"} inClass="mgt-slide-in-r" outClass="mgt-slide-out-r" tag="span">
          <button
            disabled={!form.date}
            onClick={onSaveConfirm}
            className="mgt-hover-scale"
            style={mkSolidBtn(form.date?"var(--app-success-solid)":"var(--btn-disabled)",{cursor:form.date?"pointer":"not-allowed",color:form.date?"var(--text-on-accent)":"var(--btn-disabled-ink)",boxShadow:form.date?"var(--shadow-btn-success)":"none"})}>Save&confirm</button>
        </Presence>
      ):null}</div></div>
    </>
  );

  // ── The form modal itself ──
  return (
    <Overlay onClose={function(){onClose();}} footer={footerEl}><AutoHeight><ModalTitle marginBottom={16} background={form.returnOf?"var(--app-success-solid)":"var(--app-new)"}>{editId?"Edit booking":(form.returnOf?"Book again":"New booking")}</ModalTitle>{returnOfBanner}{closedBanner}<Section><div style={{display:"grid",gridTemplateColumns:formCols,gap:12}}><Fld label="Customer name" req={true} invalid={invalidField("name")} describedBy={FORM_ERROR_ID}>{function(fid,reqAttrs){return <div style={{position:"relative"}}><input
            id={fid}
            {...reqAttrs}
            value={form.name}
            /* v17.10.0: the dropdown reopens on TYPING and on CLICK, not only on
               focus. Picking a row calls preventDefault on mousedown so the input
               keeps DOM focus, and the pick handler then clears this flag — so the
               field ends up focused with the list closed and NO further `focus`
               event can ever fire. Typing more did nothing; you had to tab away
               and come back. That is the whole of "the suggestions only work the
               first time you type something in". */
            onChange={function(e){setNameFocus(true);setForm(function(f){return Object.assign({},f,{name:e.target.value});});}}
            onFocus={function(){setNameFocus(true);}}
            onClick={function(){setNameFocus(true);}}
            onBlur={function(){setNameFocus(false);}}
            placeholder="Full name"
            className="mgt-hover-scale"
            style={inp()} />{nameDropdown}</div>;}}</Fld><Fld label="Phone number">{function(fid){return <div style={{position:"relative"}}><input
            id={fid}
            type="tel"
            value={form.phone}
            /* Same reopen fix as the name field above. */
            onChange={function(e){setPhoneFocus(true);setForm(function(f){return Object.assign({},f,{phone:e.target.value});});}}
            onFocus={function(e){setPhoneFocus(true);const el=e.target;if(!el.value) setForm(function(f){return Object.assign({},f,{phone:"+"});});setTimeout(function(){el.selectionStart=el.selectionEnd=el.value.length;},0);}}
            onClick={function(){setPhoneFocus(true);}}
            onBlur={function(){setPhoneFocus(false);}}
            placeholder="+34 600 000 000"
            className="mgt-hover-scale"
            style={inp()} />{phoneDropdown}</div>;}}</Fld></div><Reveal show={!!custChips}>{custChips}</Reveal></Section><Section><div style={{display:"grid",gridTemplateColumns:formCols,gap:12}}><Fld label="Date" invalid={invalidField("date")} describedBy={FORM_ERROR_ID}>{function(fid,attrs){return <input
            id={fid}
            {...attrs}
            type="date"
            value={form.date}
            onChange={function(e){setForm(function(f){return Object.assign({},f,{date:e.target.value});});}}
            className="mgt-hover-scale"
            style={inp()} />;}}</Fld><Fld label="Time" invalid={invalidField("time")} describedBy={FORM_ERROR_ID}>{function(fid,attrs){return <input
            id={fid}
            {...attrs}
            type="time"
            value={form.time}
            onChange={function(e){setForm(function(f){return Object.assign({},f,{time:e.target.value});});}}
            min={String(fh.open).padStart(2, "0") + ":00"}
            max={fh.close >= 24 ? "23:59" : String(fh.close).padStart(2, "0") + ":00"}
            className="mgt-hover-scale"
            style={inp()} />;}}</Fld><Fld label="Seating preference">{function(fid){return <select
            id={fid}
            value={form.preference}
            onChange={function(e){setForm(function(f){return Object.assign({},f,{preference:e.target.value});});}}
            className="mgt-hover-scale"
            style={mkSel()}><option value="auto">Auto (recommended)</option>{INDOOR.length>0?<option value="indoor">Indoor</option>:null}{OUTDOOR.length>0?<option value="outdoor">Outdoor</option>:null}</select>;}}</Fld><Fld label="Number of guests"><div style={{display:"flex",alignItems:"center",gap:6}}><button
              className="mgt-hover-scale"
              style={{background:"var(--bg-stepper)",border:"1px solid var(--border-soft)",borderRadius:R.pill,width:H.control,height:H.control,fontSize: T.display,cursor:"pointer",color:S.text,fontWeight: FW.semi,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"var(--shadow-input)"}}
              onPointerDown={function(e){e.preventDefault();const v=Math.max(1,(Number(form.size)||2)-1);setForm(function(f){return Object.assign({},f,{size:v});});}}>-</button><span
              style={{minWidth:56,textAlign:"center",fontSize: T.lead,fontWeight: FW.bold,color:S.text}}>{String(Number(form.size)||2)}</span><button
              className="mgt-hover-scale"
              style={{background:"var(--bg-stepper)",border:"1px solid var(--border-soft)",borderRadius:R.pill,width:H.control,height:H.control,fontSize: T.display,cursor:"pointer",color:S.text,fontWeight: FW.semi,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"var(--shadow-input)"}}
              onPointerDown={function(e){e.preventDefault();const v=Math.min(25,(Number(form.size)||2)+1);setForm(function(f){return Object.assign({},f,{size:v});});}}>+</button></div></Fld><Fld label="Duration"><div style={{display:"flex",alignItems:"center",gap:6}}><button
              className="mgt-hover-scale"
              style={{background:"var(--bg-stepper)",border:"1px solid var(--border-soft)",borderRadius:R.pill,width:H.control,height:H.control,fontSize: T.display,cursor:"pointer",color:S.text,fontWeight: FW.semi,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"var(--shadow-input)"}}
              onPointerDown={function(e){e.preventDefault();const v=Math.max(15,Math.min(480,dur-15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}}>-</button><span
              style={{minWidth:56,textAlign:"center",fontSize: T.lead,fontWeight: FW.bold,color:S.text}}>{dur+" min"}</span><button
              className="mgt-hover-scale"
              style={{background:"var(--bg-stepper)",border:"1px solid var(--border-soft)",borderRadius:R.pill,width:H.control,height:H.control,fontSize: T.display,cursor:"pointer",color:S.text,fontWeight: FW.semi,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"var(--shadow-input)"}}
              onPointerDown={function(e){e.preventDefault();const v=Math.max(15,Math.min(480,dur+15));setForm(function(f){return Object.assign({},f,{customDur:v===auto?null:v});});}}>+</button><span style={{fontSize: T.body,color:S.text,marginLeft:4}}>{"End: "+endTime}</span>{resetDurBtn}</div></Fld></div></Section><Reveal show={!!kitchenLoad}>{kitchenSection}</Reveal>{tablesBtn}<Reveal show={availChecking}>{checkingRow}</Reveal><Reveal show={!!(formAvail&&!formAvail.ok)}>{availBanner}</Reveal>{quickStatusBtns}<Section><Fld label="Notes">{function(fid){return <textarea
          id={fid}
          value={form.notes}
          onChange={function(e){setForm(function(f){return Object.assign({},f,{notes:e.target.value});});}}
          rows={2}
          placeholder="Allergies, special requests..."
          className="mgt-hover-scale"
          style={mkArea()} />;}}</Fld>{/* v16.3.0: deposit / prepayment amount (€). Empty = none. */}<Fld label={"Deposit (" + (currency || "€") + ")"}>{function(fid){return <input
          id={fid}
          type="number"
          min={0}
          step={5}
          value={form.deposit}
          onChange={function(e){setForm(function(f){return Object.assign({},f,{deposit:e.target.value});});}}
          placeholder="0"
          className="mgt-hover-scale"
          style={inp()} />;}}</Fld></Section>{/* v16.3.0 correction: "Repeat weekly" only shows when standing bookings are ON in Settings (new bookings only). */}{!editId&&standingEnabled?(
        <Section>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize: T.lead,fontWeight: FW.semi,color:"var(--text-primary)"}}>Repeat weekly</div>
              <div style={{fontSize: T.body,fontWeight: FW.regular,color:"var(--text-faint)",marginTop:2}}>
                {"Create a standing booking every "+(WEEKDAY_NAMES[new Date(form.date).getUTCDay()]||"week")+(form.time?" at "+form.time:"")+". Manage it in Settings → General → Standing bookings."}
              </div>
            </div>
            <Toggle on={!!form.repeatWeekly} onClick={function(){setForm(function(f){return Object.assign({},f,{repeatWeekly:!f.repeatWeekly});});}} />
          </div>
        </Section>
      ):null}</AutoHeight></Overlay>
  );
}
