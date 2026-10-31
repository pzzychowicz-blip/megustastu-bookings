// src/hooks/useShellPrefs.js
//
// v18.13.2: what this device and this account have set the shell to, out of
// BookingApp, in `useSettingsPanel`'s shape: the statements moved verbatim and in
// their original order, the hook returns plain per-render values and functions,
// and App destructures them at the call.
//
//   themePref, isDark, onToggleDark, onToggleAutoTheme      the theme
//   appWidth, onSetAppWidth                                 App width
//   reduceMotion, planGestures, planAvail, navLocked,
//   splitEnabled, and their onToggle*                       the five PREF_SPEC booleans
//   swEnabled, onToggleSw                                   the offline shell's switch
//   tlSettings, onSetTlSetting                              Timeline zoom and follow
//   split, focusedPane, setFocusedPane, applySplit,
//   fitTimeline, confirmSplit, swapSides, toggleSplitDir,
//   exitSplit, setSplitRatio, splitSideBySideOk             Split View
//   shellFixed                                              the fixed shell's one flag
//
// `pickView` stays in App: it is a view switch first and reads `view` and
// `bumpSlide`, so it takes `applySplit`, `fitTimeline` and `setFocusedPane` from
// here. App's mount effect sets `<body>`'s baseline style and sits above this hook's
// call, so it still runs before the `shellFixed` effect here (effects fire in
// declaration order). **Never pass the returned object as a prop**: it is new every
// render, and a memoised view would re-render with it.
//
// The offline shell's effect below is the registration. Its `bookingsReady` gate is
// load-bearing: read the `mgt-service-worker` skill before changing it.

import { useState, useRef, useEffect } from "react";
import { VIEW_ORDER, SPLIT_DIVIDER_PX } from "../lib/constants";
import { readSwEnabled, setSwEnabled, applyServiceWorker } from "../lib/serviceWorker";
import { useThemeMode } from "./useThemeMode";
import { PREF_SPEC, PREF_NAMES, readPrefValue, prefLocalValue } from "./useUserPrefs";

// ── v17.9.0: DEV-only theme override ──────────────────────────────────────────
// Since v17.6.0 the theme follows the signed-in ACCOUNT (settings/users/{uid}/
// prefs), and that overrides both localStorage["mgt-theme"] and OS emulation. So
// looking at dark mode meant toggling it in Settings — i.e. WRITING to the real
// user's saved preferences to inspect a colour. v17.8.0's contrast pass avoided
// that by computing ratios against the token values instead, which is sound, and
// is not the same thing as looking at the screen.
//
// `?theme=dark` / `?theme=light` forces the theme for one page load. It is inert
// in production twice over: Vite strips the `import.meta.env.DEV` branch from the
// bundle, and index.html's no-flash script (which has no import.meta.env of its
// own) gates on hostname.
//
// The NON-write is the whole point. While an override is live the prefs-seeding
// effect skips its theme branch and onToggleDark skips saveUserPrefs, so a theme
// check leaves the signed-in user's node exactly as it found it.
function devThemeOverride(){
  if(!import.meta.env.DEV) return undefined;
  try{
    const v=new URLSearchParams(window.location.search).get("theme");
    if(v==="dark") return true;
    if(v==="light") return false;
  }catch{/* ignore */}
  return undefined;
}
// Read once at module load: the override is a property of how the page was
// opened, so it cannot change without a reload.
const DEV_THEME_FORCED=devThemeOverride()!==undefined;

// ── v14.2.0: Dark-mode preference reader ──────────────────────────────────────
// Per-device theme lives in localStorage["mgt-theme"]. Returns the explicit
// preference for useThemeMode: true (dark) | false (light) | undefined (follow
// the OS live — which is also what "auto", v18.0.0's Automatic dark mode, reads as). MUST
// mirror the no-flash inline script in index.html — same key,
// same value convention ("dark"/"light"), and since v17.9.0 the same
// ?theme= override, which wins over the stored key at both sites.
export function readThemePref(){
  const forced=devThemeOverride();
  if(forced!==undefined) return forced;
  try{
    const v=localStorage.getItem("mgt-theme");
    if(v==="dark") return true;
    if(v==="light") return false;
  }catch{/* ignore */}
  return undefined;
}

// v17.0.0 correction: per-device max app width (px). localStorage like the
// theme — screen size is a device property, not restaurant config. The 1.08
// hover-scale lift overflowed the viewport at a fixed 1600 on smaller
// monitors, so the width is a Settings→General stepper (900–2400, step 50).
// Round 3: no stored value → default to THIS screen's width minus 150px
// margins each side (rounded to 50), so the app fills the browser out of the
// box without ever overflowing it.
const APP_WIDTH_MIN=900, APP_WIDTH_MAX=2400;

function readAppWidth(){
  try{
    const v=parseInt(localStorage.getItem("mgt-appwidth"),10);
    if(Number.isFinite(v)&&v>=APP_WIDTH_MIN&&v<=APP_WIDTH_MAX) return v;
  }catch{/* ignore */}
  const w=Math.round((window.innerWidth-300)/50)*50;
  return Math.max(APP_WIDTH_MIN,Math.min(APP_WIDTH_MAX,w));
}

// v17.5.0: the persisted Split View, per device. Restored on load so a split
// survives a reload/redeploy — losing your layout on every refresh would make
// the feature not worth setting up.
const SPLIT_KEY="mgt-split";   // also PREF_SPEC.splitEnabled.clears — keep in step
// v17.14.0: read one of the boolean prefs off this device, per its
// PREF_SPEC convention. The try/catch is the same one the four initializers
// each carried; the default on a throw is the pref's own default, which is
// exactly what an absent key means.
function readPrefLS(name){
  const spec=PREF_SPEC[name];
  try{return readPrefValue(spec.store,localStorage.getItem(spec.ls));}
  catch{return readPrefValue(spec.store,null);}
}
// Validate HARD, and return null on anything unexpected: a hand-edited or
// half-written key must never be able to wedge the app in a broken layout, and
// the same view appearing twice would collide on the singleton per-view state
// (timelineZoom / selectedListId / showFinished).
function readSplit(){
  try{
    if(!readPrefLS("splitEnabled")) return null;   // master switch off — v17.14.0: was a
    // second hand-written read of the same key, which is the drift PREF_SPEC exists to stop.
    if(typeof window!=="undefined"&&window.innerWidth<600) return null; // tablet/desktop only
    const s=JSON.parse(localStorage.getItem(SPLIT_KEY)||"null");
    if(!s||typeof s!=="object") return null;
    if(VIEW_ORDER.indexOf(s.a)===-1||VIEW_ORDER.indexOf(s.b)===-1||s.a===s.b) return null;
    if(s.dir!=="v"&&s.dir!=="h") return null;
    const r=Number(s.ratio);
    return {a:s.a,b:s.b,dir:s.dir,ratio:Number.isFinite(r)&&r>=0.2&&r<=0.8?r:0.5};
  }catch{return null;}
}

// ── v17.11.0: a Timeline needs horizontal room, and a side-by-side split
// halves exactly the dimension it needs most ────────────────────────────────
// The `winW < 600` gate above already says "a view needs room, and a Timeline in
// a ~180px pane is unusable". That reasoning is about the PANE and was only ever
// applied to the WINDOW. Measured live at 1280px in a 50/50 side-by-side split:
// the Timeline's own scroller is **371px against a 2896px grid — 13% of the
// service visible at once**.
//
// Scrolling a timeline is normal; that is not the complaint. The complaint is
// that a half-width Timeline can show you the whole day OR readable blocks and
// never both, and the view exists to do both — "where does the evening stand" is
// the question it answers.
//
// The number is derived, not chosen. Measured on the live DOM, a pane loses
// ~124px to the table-label column (58) and the card's own padding and gutters
// before the grid starts. On the reference 10-hour day a 90-minute booking is
// 15% of the grid, and v17.9.1's own width budget says a block needs 138px
// (NAME_MIN 55 + the assign handle 41 + the size ring 24 + v17.11.0's status
// mark 18) before its guest name renders at all. 138 / 0.15 = 920px of grid,
// + 124 = 1044. Rounded up to the divider-inclusive figure below.
//
// A STACKED split is always fine — it halves the height, and fewer visible table
// rows is what scrolling is for.
const MIN_TL_PANE=1050;
// `tlPane` is "a" or "b" — which side the Timeline is on. Pure, so the menu, the
// view-switcher and the repair effect all ask the same question one way.
function tlPaneOk(appW,dir,ratio,tlPane){
  if(dir!=="v") return true;
  const share=tlPane==="a"?ratio:1-ratio;
  return (appW-SPLIT_DIVIDER_PX)*share>=MIN_TL_PANE;
}

// v17.2.0: per-device Timeline zoom/follow settings (theme pattern — key absent
// = default). Four localStorage keys: mgt-tl-followzoom (zoom the Follow button
// jumps to, was hard-coded 4), mgt-tl-defaultzoom (zoom on app open, was 1),
// mgt-tl-followlead (minutes of past shown behind the now-line while Following,
// was 30) and mgt-tl-maxzoom (the + button's ceiling, was 5). Per-device on
// purpose — zoom comfort depends on the device's screen, like App width.
const TL_SETTING_BOUNDS={
  followZoom:{key:"mgt-tl-followzoom",def:4,min:1,max:10,step:0.5},
  defaultZoom:{key:"mgt-tl-defaultzoom",def:1,min:1,max:10,step:0.5},
  followLead:{key:"mgt-tl-followlead",def:30,min:0,max:120,step:15},
  maxZoom:{key:"mgt-tl-maxzoom",def:5,min:2,max:10,step:0.5}
};
function readTlNum(b){
  try{
    const v=parseFloat(localStorage.getItem(b.key));
    if(Number.isFinite(v)&&v>=b.min&&v<=b.max&&Math.round(v/b.step)*b.step===v) return v;
  }catch{/* ignore */}
  return b.def;
}
export function readTlSettings(){
  const B=TL_SETTING_BOUNDS;
  const maxZoom=readTlNum(B.maxZoom);
  // followZoom/defaultZoom can never exceed the configured max zoom.
  return {
    maxZoom:maxZoom,
    followZoom:Math.min(maxZoom,readTlNum(B.followZoom)),
    defaultZoom:Math.min(maxZoom,readTlNum(B.defaultZoom)),
    followLead:readTlNum(B.followLead)
  };
}

export function useShellPrefs({
  bookingsReady, flashRefusal, isMobile, prefsLoaded, saveUserPrefs,
  setSplitMenuFor, setTimelineZoom, setView, userPrefs, winW,
}) {
  // v17.10.1: per-device offline shell (see lib/serviceWorker.js). Default ON,
  // so only the non-default "0" is ever stored.
  const [swEnabled, setSwEnabledState] = useState(readSwEnabled);
  const swAppliedRef = useRef(false);
  // v17.10.1: install (or tear down) the offline shell.
  //
  // The `bookingsReady` gate is the safety property, not a detail. A worker is
  // only ever registered on a device where the app has demonstrably booted AND
  // received its first Firebase snapshot — so a build that cannot load its data
  // can never persist itself into a cache and serve itself back. That is the
  // precise shape of the v17.4.0 failure ("⟳ Loading bookings…" forever), and
  // it is the one condition under which caching a shell is provably safe.
  //
  // Disabling is NOT gated the same way: turning it off must work immediately,
  // on any device, in any state.
  useEffect(function(){
    if(!swEnabled){ applyServiceWorker(false); swAppliedRef.current=false; return; }
    if(!bookingsReady||swAppliedRef.current) return;
    swAppliedRef.current=true;
    applyServiceWorker(true);
  },[swEnabled,bookingsReady]);
  // ── v14.2.0: Dark-mode theme state ────────────────────────────────────────
  // themePref (localStorage-backed) feeds useThemeMode, which writes
  // <html data-theme> and returns the resolved isDark. The no-flash script in
  // index.html reads the SAME localStorage key on first paint. Toggling writes
  // the key and updates state — per device, no Firebase (no settings node).
  const [themePref,setThemePref]=useState(readThemePref);
  const isDark=useThemeMode(themePref);
  function onToggleDark(){
    // v18.0.0 session 7: locked while Automatic dark mode is on — Patryk's choice. The
    // switch renders disabled; this guard keeps any other caller from quietly
    // replacing Automatic with a fixed look.
    // /code-review: and it SAYS so. The other caller is ⇧D — global, and listed
    // in Shortcuts — and a bare return there read as a dead key for every
    // account that never chose a theme, which reads as Automatic by default.
    if(themePref===undefined){flashRefusal("Dark mode follows this device while Automatic dark mode is on — turn it off in Settings → App.");return;}
    const next=!isDark;
    // v17.6.0: localStorage stays as the PRE-MOUNT cache — index.html's
    // no-flash script reads this key before React mounts and long before
    // Firebase resolves, so dropping it would flash the wrong theme on every
    // load. The per-user node is the source of truth.
    try{localStorage.setItem("mgt-theme",next?"dark":"light");}catch{/* ignore */}
    setThemePref(next);
    // v17.9.0: under a ?theme= override the toggle still works locally, but it
    // must not persist — the override exists so a theme can be inspected without
    // touching the signed-in user's saved settings.
    if(!DEV_THEME_FORCED) saveUserPrefs({theme:next?"dark":"light"});
  }
  // v18.0.0 session 7: the Automatic dark mode switch (Settings → App) — follow this
  // device's light/dark setting, live. Stored on the account as "auto", NEVER as
  // null: null means "never chosen", and the seeding effect below fills a
  // never-chosen account from the next device to sign in with an explicit
  // value, so Automatic picked on the iPad would be overwritten by the tablet.
  // Turning it OFF keeps the look the device is showing right now, as an explicit
  // choice — the least surprising answer, since nothing on screen changes.
  function onToggleAutoTheme(){
    if(themePref===undefined){
      const dark=isDark;
      try{localStorage.setItem("mgt-theme",dark?"dark":"light");}catch{/* ignore */}
      setThemePref(dark);
      if(!DEV_THEME_FORCED) saveUserPrefs({theme:dark?"dark":"light"});
    }else{
      // localStorage holds "auto" rather than dropping the key: the no-flash
      // script already follows the OS for anything that is not "dark"/"light",
      // and an explicit value reads as a choice to whoever looks next.
      try{localStorage.setItem("mgt-theme","auto");}catch{/* ignore */}
      setThemePref(undefined);
      if(!DEV_THEME_FORCED) saveUserPrefs({theme:"auto"});
    }
  }
  // v17.0.0 correction: per-device app width (see readAppWidth above).
  const [appWidth,setAppWidth]=useState(readAppWidth);
  function onSetAppWidth(next){
    const v=Math.max(APP_WIDTH_MIN,Math.min(APP_WIDTH_MAX,next));
    try{localStorage.setItem("mgt-appwidth",String(v));}catch{/* ignore */}
    setAppWidth(v);
  }
  // v17.1.0: per-device "Reduce animations" (Settings → General). Theme
  // pattern: localStorage["mgt-reduce-motion"]="1" + <html data-motion> —
  // the no-flash script in index.html reads the SAME key pre-mount, the CSS
  // kill-switch keys on the attribute, and atoms.jsx's useFlip checks it for
  // WAAPI animations. Keep all three in sync.
  const [reduceMotion,setReduceMotion]=useState(function(){return readPrefLS("reduceMotion");});
  // v17.10.1: per-device offline shell. localStorage ONLY — deliberately not
  // saveUserPrefs'd: clearing site data is the last-resort escape from a bad
  // worker, and a synced flag would come straight back down and re-enable it.
  function onToggleSw(){
    const next=!swEnabled;
    setSwEnabled(next);        // lib/serviceWorker.js owns the localStorage key
    setSwEnabledState(next);   // /code-review: was setSwEnabled_ — one underscore
                               // apart from the writer above, which is a name
                               // that only tells you it is not the other one.
  }
  // ── v17.14.0: the four boolean prefs, driven by PREF_SPEC ───────────────────
  // The localStorage convention (which value is stored, which key is dropped)
  // lives once in useUserPrefs.js; these two functions are the only place that
  // TOUCHES localStorage for them, and they are shared by the initializers, the
  // toggles and the seeding effect below.
  //
  // `theme` stays written out in full above: it is a tri-state string with a
  // `?theme=` override that must skip both branches, and hiding that in a table
  // is how it would get broken.
  function writePref(name,v){
    const spec=PREF_SPEC[name];
    const str=prefLocalValue(spec.store,v);
    try{
      if(str===null) localStorage.removeItem(spec.ls); else localStorage.setItem(spec.ls,str);
      if(spec.clears&&!v) localStorage.removeItem(spec.clears);
    }catch{/* ignore */}
    // The one DOM side effect any of them has: index.html's boot script reads
    // this attribute, and the motion rules key off it.
    if(name==="reduceMotion"){
      if(v) document.documentElement.dataset.motion="reduce";
      else delete document.documentElement.dataset.motion;
    }
  }
  // Flip a pref: write it locally, set the state, sync it to the account.
  // Returns the new value so a caller can hang its own React side effect off it
  // (only splitEnabled has one — see below).
  function togglePref(name,cur,set){
    const next=!cur;
    writePref(name,next);
    set(next);
    saveUserPrefs({[name]:next});   // v17.6.0: follows the account
    return next;
  }
  function onToggleReduceMotion(){togglePref("reduceMotion",reduceMotion,setReduceMotion);}
  // v17.1.2: per-device "Plan zoom & pan" (Settings → General). Theme pattern:
  // localStorage["mgt-plan-gestures"]="0" only when OFF (absent = on, the
  // default) — gates PlanView's wheel/pinch zoom, drag pan and double-tap reset.
  const [planGestures,setPlanGestures]=useState(function(){return readPrefLS("planGestures");});
  function onTogglePlanGestures(){togglePref("planGestures",planGestures,setPlanGestures);}
  // v18.2.0 phase 21: "Table availability" on the Plan view (Settings → App,
  // beside Plan zoom & pan). Default ON, so the planGestures shape: only "0"
  // is ever stored. Per person, synced — Patryk's choice over restaurant-wide.
  const [planAvail,setPlanAvail]=useState(function(){return readPrefLS("planAvail");});
  function onTogglePlanAvail(){togglePref("planAvail",planAvail,setPlanAvail);}
  // v17.5.0: per-device "Lock navigation" (Settings → General). Theme pattern,
  // but INVERTED vs planGestures because the default is OFF — only the non-
  // default value is ever stored, so localStorage["mgt-nav-lock"]="1" means on
  // and an absent key means off. Drives the `shellFixed` layout below.
  const [navLocked,setNavLocked]=useState(function(){return readPrefLS("navLocked");});
  function onToggleNavLock(){togglePref("navLocked",navLocked,setNavLocked);}
  // v17.5.0: per-device Split View master switch (Settings → General).
  // v17.5.0 correction: default ON (was off), so the RMB / press-and-hold
  // gesture works out of the box. That puts it back on the house convention —
  // key absent = default, only the non-default "0" is stored — same shape as
  // planGestures. (navLocked stays inverted; its default really is off.)
  // While off, the gesture on a view button does nothing at all.
  const [splitEnabled,setSplitEnabled]=useState(function(){return readPrefLS("splitEnabled");});
  function onToggleSplitEnabled(){
    // Only the SWITCH syncs; the saved split LAYOUT (which two views + ratio)
    // stays per-device — PREF_SPEC drops that key, see useUserPrefs.js.
    if(!togglePref("splitEnabled",splitEnabled,setSplitEnabled)) setSplit(null);
    // ^ turning the feature off must also leave any active split. React state,
    //   so it stays here rather than in the table.
  }
  // The active split, or null for a single view. Restored per-device.
  const [split,setSplit]=useState(readSplit);
  // ── v17.6.0: apply the signed-in user's preferences, or seed them ──────────
  // Runs once the account's node has loaded. For each of the synced settings
  // (theme and the PREF_SPEC booleans): a value the user HAS saved overrides this device; a value they
  // have never saved is seeded from whatever this device is currently using and
  // written up, so logging in on a configured device adopts its setup instead
  // of resetting it. localStorage is written alongside, because it is what
  // index.html's no-flash script reads before React mounts.
  //
  // Keyed on `prefsLoaded` alone: it flips false→true exactly once per uid (the
  // hook resets it when the path changes), and re-running on every later
  // snapshot would fight the user's own toggles. Reading the current local
  // values here without depending on them is the point, not an oversight.
  // The current value + setter for each boolean (five since v18.2.0 phase 21),
  // so the seeding loop below can read "what is this device using" and "how
  // do I change it" by name.
  // Rebuilt per render and read only inside the once-per-uid effect.
  const prefState={
    reduceMotion:{value:reduceMotion,set:setReduceMotion},
    planGestures:{value:planGestures,set:setPlanGestures},
    navLocked:{value:navLocked,set:setNavLocked},
    splitEnabled:{value:splitEnabled,set:setSplitEnabled},
    planAvail:{value:planAvail,set:setPlanAvail},
  };
  const seededPrefsRef=useRef(false);
  useEffect(function(){
    if(!prefsLoaded||seededPrefsRef.current) return;
    seededPrefsRef.current=true;
    const seed={};
    // v17.9.0: a ?theme= override skips BOTH branches. Applying the saved theme
    // would defeat the override; seeding from it would write the forced value up
    // as if the user had chosen it. `themePref` currently HOLDS the forced value,
    // so the else-branch is the more dangerous of the two.
    if(DEV_THEME_FORCED){
      /* leave settings/users/{uid}/prefs.theme exactly as found */
    }else if(userPrefs.theme==="dark"||userPrefs.theme==="light"){
      const dark=userPrefs.theme==="dark";
      try{localStorage.setItem("mgt-theme",userPrefs.theme);}catch{/* ignore */}
      setThemePref(dark);
    }else if(userPrefs.theme==="auto"){
      // v18.0.0 session 7: Automatic dark mode, chosen on some device of this account.
      try{localStorage.setItem("mgt-theme","auto");}catch{/* ignore */}
      setThemePref(undefined);
    }else if(themePref!==undefined){
      // Only seed an EXPLICIT device preference. `undefined` means this device
      // follows the OS, which is the absence of a choice — writing it up would
      // freeze the user to whatever the OS happened to say at first login.
      seed.theme=themePref?"dark":"light";
    }
    // v17.14.0: the booleans, one loop over PREF_SPEC. The TRI-STATE
    // semantics are untouched and are the reason this cannot be simplified
    // further: `null` means "this user has never chosen", and a sanitize that
    // returned `false` for an absent field would reset every configured device
    // on first login. Only a real boolean takes the apply branch.
    PREF_NAMES.forEach(function(name){
      const saved=userPrefs[name];
      const st=prefState[name];
      if(saved===true||saved===false){
        writePref(name,saved);
        st.set(saved);
      }else seed[name]=st.value;
    });
    // The one React side effect the table does not carry, for the same reason
    // the toggle keeps it: leaving an active split is state, not storage.
    if(userPrefs.splitEnabled===false) setSplit(null);
    if(Object.keys(seed).length) saveUserPrefs(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per account, when its prefs load: it reads this device's values at that moment, on purpose (above)
  },[prefsLoaded]);
  const [focusedPane,setFocusedPane]=useState("a");
  // One writer for both the state and the key, so they can't drift.
  function applySplit(next){
    setSplit(next);
    try{
      if(next) localStorage.setItem(SPLIT_KEY,JSON.stringify(next));
      else localStorage.removeItem(SPLIT_KEY);
    }catch{/* ignore */}
  }
  // Phones collapse out of a split: the header already wraps to three rows at
  // <600px, and a Timeline in a ~180px pane is unusable. Also covers a desktop
  // window dragged narrow.
  useEffect(function(){
    if(isMobile&&split) applySplit(null);
  },[isMobile,split]);
  // v17.11.0: the width the two panes actually divide — the app is clamped to
  // the per-device App-width setting, so the WINDOW is not what a pane gets.
  const shellW=Math.min(winW,appWidth);
  const tlSide=split?(split.a==="timeline"?"a":split.b==="timeline"?"b":null):null;
  const splitSideBySideOk=tlPaneOk(shellW,"v",0.5,"a");
  // …and the repair: an existing side-by-side split whose Timeline pane has
  // become too narrow — the window was resized, the divider dragged, or the App
  // width setting lowered — turns STACKED rather than being torn down. The
  // phone rule above collapses the split because a phone cannot host one at all;
  // here the split is still perfectly viable, it is only this orientation that
  // is not, so preserving the user's intent is the better repair.
  useEffect(function(){
    if(!split||!tlSide) return;
    if(tlPaneOk(shellW,split.dir,split.ratio,tlSide)) return;
    applySplit(Object.assign({},split,{dir:"h"}));
  },[shellW,split,tlSide]);
  // ── v17.5.0: the fixed shell ────────────────────────────────────────────────
  // Normally <body> is the scrollport (see the mount effect near the top of
  // BookingApp) and the app is a plain `minHeight:100dvh` block that grows.
  // `shellFixed` flips that: the shell becomes a 100dvh flex COLUMN, the header
  // and date rows become flexShrink:0, and an inner region takes the scroll.
  // That is the ONE mechanism behind "lock navigation" — and Split View widens
  // this flag rather than inventing a second layout.
  // Both contributing settings default off, so the default render path is
  // byte-for-byte what shipped in v17.4.2.
  // Split View joins the SAME flag rather than getting its own layout: two
  // independently-scrolling panes need a definite height, which is exactly what
  // the fixed shell provides. Consequence, stated in CLAUDE.md: entering a
  // split pins the nav whether or not "Lock navigation" is on.
  const shellFixed = navLocked || !!split;
  // Body must stop scrolling in that mode or the page gets a second scrollbar
  // outside the fixed shell. Separate from BookingApp's mount-once effect (which
  // establishes the baseline) because that effect is declared long before
  // `navLocked` exists — putting navLocked in ITS dep array would be a TDZ error.
  useEffect(function(){
    document.body.style.overflow=shellFixed?"hidden":"auto";
    return function(){document.body.style.overflow="auto";};
  },[shellFixed]);
  // v17.2.0: per-device Timeline zoom/follow settings (see readTlSettings above).
  // Stored one value per key; a value equal to its default removes the key.
  // Lowering maxZoom clamps followZoom/defaultZoom (and the live zoom) with it.
  const [tlSettings,setTlSettings]=useState(readTlSettings);
  function persistTl(name,v){
    const b=TL_SETTING_BOUNDS[name];
    try{
      if(v===b.def) localStorage.removeItem(b.key);
      else localStorage.setItem(b.key,String(v));
    }catch{/* ignore */}
  }
  function onSetTlSetting(name,next){
    const b=TL_SETTING_BOUNDS[name];
    if(!b) return;
    let v=Math.max(b.min,Math.min(b.max,Math.round(next/b.step)*b.step));
    const out=Object.assign({},tlSettings);
    if(name==="maxZoom"){
      out.maxZoom=v;
      if(out.followZoom>v){out.followZoom=v;persistTl("followZoom",v);}
      if(out.defaultZoom>v){out.defaultZoom=v;persistTl("defaultZoom",v);}
      setTimelineZoom(function(z){return Math.min(z,v);});
    }else{
      if((name==="followZoom"||name==="defaultZoom")&&v>tlSettings.maxZoom) v=tlSettings.maxZoom;
      out[name]=v;
    }
    persistTl(name,v);
    setTlSettings(out);
  }
  // v17.14.0: turn a split stacked when the pane holding the Timeline is too
  // narrow for one. Shared by BOTH branches of App's pickView — the swap branch
  // used to skip this check entirely and lean on the repair effect to reorient
  // the layout a render later, which the user sees as the split visibly
  // flipping after a plain view tap. Asks where the timeline actually ENDS UP,
  // rather than assuming it is the view that was tapped: a swap moves both.
  function fitTimeline(next){
    const tlPane=next.a==="timeline"?"a":next.b==="timeline"?"b":null;
    if(!tlPane) return next;
    if(tlPaneOk(shellW,next.dir,next.ratio,tlPane)) return next;
    return Object.assign({},next,{dir:"h"});
  }
  function confirmSplit(next){
    setSplitMenuFor(null);
    applySplit(next);
    setFocusedPane("a");
    // Keep the single-view state coherent for anything still reading `view`
    // (the search-jump, the keyboard fallback) — pane A is the one it invoked on.
    setView(next.a);
  }
  function swapSides(){
    if(!split) return;
    applySplit(Object.assign({},split,{a:split.b,b:split.a,ratio:1-split.ratio}));
    setFocusedPane(focusedPane==="a"?"b":"a");
  }
  function toggleSplitDir(){ if(split) applySplit(Object.assign({},split,{dir:split.dir==="v"?"h":"v"})); }
  function exitSplit(){ if(split){ setView(split[focusedPane]); applySplit(null); } }
  function setSplitRatio(r){ if(split) applySplit(Object.assign({},split,{ratio:r})); }

  return {
    themePref, isDark, onToggleDark, onToggleAutoTheme,
    appWidth, onSetAppWidth,
    reduceMotion, onToggleReduceMotion,
    planGestures, onTogglePlanGestures,
    planAvail, onTogglePlanAvail,
    navLocked, onToggleNavLock,
    splitEnabled, onToggleSplitEnabled,
    swEnabled, onToggleSw,
    tlSettings, onSetTlSetting,
    split, focusedPane, setFocusedPane, applySplit, fitTimeline,
    confirmSplit, swapSides, toggleSplitDir, exitSplit, setSplitRatio,
    splitSideBySideOk, shellFixed,
  };
}
