// src/components/TagListEditor.jsx
//
// v18.5.0 — the tag list's editor, a collapsible "Tags" section at the top of
// Settings → Customers (Patryk's placement, 2026-10-08: tags are about guests,
// so they are edited where guests are, as a voucher setting is edited where
// vouchers are).
//
// Two short lists, guest tags and occasion tags, each a column of name boxes
// with a remove × and an add row under them. EVERY decision is `lib/tags.js`'s
// (`addTag` / `renameTag` / `removeTag`, and the one name check behind the
// first two); this file holds drafts and shows the sentence a refusal returns.
//
// ── IT IS A DRAFTING SURFACE ────────────────────────────────────────────────
// A name box commits on blur or Enter, `GsTextField`'s shape, so closing
// Settings mid-edit would drop the edit silently. Each box reports its own
// dirtiness to `SettingsContent`'s aggregator by id (`onDirty`), and clears it
// on unmount, exactly as the General tab's fields do. A REFUSED name stays in
// its box, and stays dirty: the box is showing something that was not saved.
//
// ── REMOVE IS TWO TAPS, AND THE BUTTON DOES NOT MOVE ────────────────────────
// The duration tier's shape (Settings → General): the quiet × (`mkRemoveX`),
// then "Confirm — remove" in the one solid red, in a slot that reserves the
// armed width so the row wraps the same at rest and armed. What removing does
// to bookings is said UNDER the row while armed, never above it, or the second
// tap would land on the sentence (src/CLAUDE.md's Gotchas row on a
// browser-drawn control and its layout twin).
//
// An account without `settingsWrite` sees the two lists as plain chips. The
// Customers tab is open to it; the list's rule is not.
//
// Props:
//   tagList                 — { v, guest, occasion } (useTagSettings)
//   onSave(nextList) → bool — the hook's saveTagList
//   tagError, onClearError  — the sentence a refused WRITE left, and its ✕
//   canEdit                 — can("settingsWrite")
//   onDirty(id, on)         — SettingsContent's reportDirty

import { useState, useEffect, useRef, useId } from "react";
import { T, FW, SP, H, IC, BTN } from "../lib/constants";
import {
  TAG_KINDS, TAG_KIND_LABEL, TAG_LABEL_MAX, TAG_LIST_MAX,
  addTag, renameTag, removeTag, tagIdFor,
} from "../lib/tags";
import { genId, countLabel } from "../lib/booking-logic";
import { Collapsible, InlineAlert, OutlineChip, Reveal, mkInp, mkBtn, mkDangerBtn, mkRemoveX } from "./atoms";
import { CloseIcon, TrashIcon } from "./Icons";

// Where each kind lives, in the words the form and the Customers list bear out.
const KIND_NOTE = {
  guest: "About the guest. They follow the guest to every booking, and are erased with the customer.",
  occasion: "About one visit. They stay on that booking and are not carried to the next.",
};
const KIND_ONE = { guest: "guest tag", occasion: "occasion tag" };

// A name box, wide enough for the longest tag (24 characters) in mkInp's type.
const NAME_W = 230;
// The remove slot's ARMED width, the duration tier's number (Settings.jsx's
// TIER_ARMED_W: "Confirm — remove" with its trash mark at T.body and 10px
// padding, 152.1px measured). Re-measure with that one.
const ARMED_W = 153;
const ARM_MS = 3000;

// One tag: its name box and its remove ×.
function TagRow({ tag, index, kind, tagList, onSave, armed, onArm, onDirty }) {
  const [draft, setDraft] = useState(tag.label);
  const [refusal, setRefusal] = useState(null);
  // A stored label that changes (this box's own save, or a rename on another
  // device) replaces the draft. Adjusted DURING render, the "state from a prop
  // that changed" shape `useRevealRows` uses, not in an effect: a setState in
  // an effect body is the lint rule this codebase keeps clean.
  const [seenLabel, setSeenLabel] = useState(tag.label);
  if (seenLabel !== tag.label) { setSeenLabel(tag.label); setDraft(tag.label); setRefusal(null); }
  const dirtyId = "tag:" + tag.id;
  const dirty = draft !== tag.label;
  useEffect(function () { if (onDirty) onDirty(dirtyId, dirty); }, [dirty, onDirty, dirtyId]);
  useEffect(function () { return function () { if (onDirty) onDirty(dirtyId, false); }; }, [onDirty, dirtyId]);
  const hintId = useId();
  // The line under the row says ONE thing. While the row is armed that is what
  // removing does, even when a rename was refused a moment ago: pressing × on a
  // row whose box holds a refused name blurs the box (the refusal) and arms the
  // row in one tap, and the confirm must not be read under the wrong sentence.
  const refusalShown = !!refusal && !armed;

  function commit() {
    if (draft === tag.label) { setRefusal(null); return; }
    const r = renameTag(tagList, tag.id, draft);
    if (r.refuse) { setRefusal(r.refuse); return; }
    setRefusal(null);
    onSave(r.list);
    // The stored label is the tidied one ("  Vegan " → "Vegan"). When that is
    // what was already stored, `tag.label` does not change and the effect
    // above never re-syncs the box, so put it back here.
    const stored = r.list[kind].find(function (t) { return t.id === tag.id; });
    if (stored) setDraft(stored.label);
  }

  return (
    <div style={{ marginBottom: SP.snug }}>
      <div style={{ display: "flex", alignItems: "center", gap: SP.base, flexWrap: "wrap" }}>
        <input
          value={draft}
          maxLength={TAG_LABEL_MAX}
          aria-label={"Name of " + KIND_ONE[kind] + " " + (index + 1)}
          aria-invalid={refusal ? true : undefined}
          aria-describedby={refusalShown ? hintId : undefined}
          onChange={function (e) { setDraft(e.target.value); if (refusal) setRefusal(null); }}
          onBlur={commit}
          onKeyDown={function (e) { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="mgt-hover-scale"
          style={{ ...mkInp(), width: NAME_W, maxWidth: "100%", boxSizing: "border-box" }} />
        <div style={{ minWidth: ARMED_W, display: "flex" }}>
          {armed ? (
            <button
              onClick={function () { onArm(tag.id); }}
              className="mgt-hover-scale mgt-press"
              aria-label={"Confirm — remove " + tag.label}
              aria-describedby={hintId}
              style={mkDangerBtn({ fontSize: T.body, minHeight: H.compact, padding: "4px 10px" })}><TrashIcon size={IC.control} />Confirm — remove</button>
          ) : (
            <button
              onClick={function () { onArm(tag.id); }}
              className="mgt-hover-scale"
              aria-label={"Remove " + tag.label}
              title="Remove this tag"
              style={mkRemoveX(H.compact)}><CloseIcon size={IC.control} /></button>
          )}
        </div>
      </div>
      {/* One line under the row for whichever applies: why the name was
          refused, or what removing does. Under, so neither moves a control. */}
      <Reveal show={!!refusal || armed}>
        <div id={hintId} style={{ fontSize: T.small, paddingTop: SP.tight, color: refusalShown ? "var(--danger-text)" : "var(--text-muted)", fontWeight: refusalShown ? FW.semi : FW.regular }}>
          {refusalShown ? refusal : "Bookings that carry “" + tag.label + "” stop showing it. Adding the name again later does not bring it back on them."}
        </div>
      </Reveal>
    </div>
  );
}

// The add row under a kind's tags.
function AddTagRow({ kind, tagList, onSave, onDirty }) {
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState(null);
  const full = (tagList[kind] || []).length >= TAG_LIST_MAX;
  const dirtyId = "tag-new:" + kind;
  const dirty = draft.trim() !== "";
  useEffect(function () { if (onDirty) onDirty(dirtyId, dirty); }, [dirty, onDirty, dirtyId]);
  useEffect(function () { return function () { if (onDirty) onDirty(dirtyId, false); }; }, [onDirty, dirtyId]);
  const hintId = useId();

  function add() {
    const r = addTag(tagList, kind, draft, tagIdFor(kind, genId()));
    if (r.refuse) { setRefusal(r.refuse); return; }
    setRefusal(null);
    if (onSave(r.list)) setDraft("");
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: SP.base, flexWrap: "wrap" }}>
        <input
          value={draft}
          maxLength={TAG_LABEL_MAX}
          disabled={full}
          placeholder={full ? "Up to " + TAG_LIST_MAX + " tags" : "New " + KIND_ONE[kind]}
          aria-label={"New " + KIND_ONE[kind]}
          aria-invalid={refusal ? true : undefined}
          aria-describedby={refusal ? hintId : undefined}
          onChange={function (e) { setDraft(e.target.value); if (refusal) setRefusal(null); }}
          onKeyDown={function (e) { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          className="mgt-hover-scale"
          style={{ ...mkInp(), width: NAME_W, maxWidth: "100%", boxSizing: "border-box", opacity: full ? 0.5 : 1 }} />
        <button
          onClick={add}
          disabled={full || !dirty}
          aria-label={"Add " + KIND_ONE[kind]}
          className="mgt-hover-scale mgt-press"
          style={mkBtn({ fontSize: T.body, minHeight: H.compact, padding: "4px 14px", background: BTN.nav, opacity: full || !dirty ? 0.4 : 1, cursor: full || !dirty ? "not-allowed" : "pointer" })}>Add</button>
      </div>
      <Reveal show={!!refusal}>
        <div id={hintId} style={{ fontSize: T.small, paddingTop: SP.tight, color: "var(--danger-text)", fontWeight: FW.semi }}>{refusal}</div>
      </Reveal>
    </div>
  );
}

export function TagListEditor({ tagList, onSave, tagError, onClearError, canEdit, onDirty }) {
  // One row armed at a time, by tag id, disarmed after ARM_MS: the tier's rule.
  const [armedId, setArmedId] = useState(null);
  const armTimer = useRef(null);
  useEffect(function () { return function () { if (armTimer.current) clearTimeout(armTimer.current); }; }, []);
  function disarm() { if (armTimer.current) { clearTimeout(armTimer.current); armTimer.current = null; } setArmedId(null); }
  function arm(id) {
    if (armedId === id) { disarm(); onSave(removeTag(tagList, id).list); return; }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmedId(id);
    armTimer.current = setTimeout(function () { armTimer.current = null; setArmedId(null); }, ARM_MS);
  }

  const counts = TAG_KINDS.map(function (k) { return countLabel((tagList[k] || []).length, k, k); }).join(" · ");

  return (
    <Collapsible
      title="Tags"
      summary={counts}
      subtitle="The tags a booking can carry: who the guest is, and what the visit is for.">
      {/* Always mounted, so a refused write is announced when it arrives. */}
      <div role="alert">
        <Reveal show={!!tagError}>
          <div style={{ display: "flex", alignItems: "center", gap: SP.base, marginTop: SP.wide }}>
            <div style={{ flex: 1, minWidth: 0 }}><InlineAlert>{tagError}</InlineAlert></div>
            <button
              onClick={onClearError}
              aria-label="Dismiss"
              className="mgt-hover-scale"
              style={mkBtn({ fontSize: T.body, minHeight: H.compact, padding: "4px 10px", background: BTN.dismiss })}>Dismiss</button>
          </div>
        </Reveal>
      </div>
      {TAG_KINDS.map(function (kind) {
        const tags = tagList[kind] || [];
        return (
          <div key={kind} role="group" aria-label={TAG_KIND_LABEL[kind]} style={{ marginTop: SP.roomy }}>
            <div style={{ fontSize: T.body, fontWeight: FW.semi, color: "var(--text-primary)" }}>{TAG_KIND_LABEL[kind]}</div>
            <div style={{ fontSize: T.small, color: "var(--text-faint)", marginBottom: SP.base }}>{KIND_NOTE[kind]}</div>
            {canEdit ? (
              <div>
                {tags.map(function (tag, i) {
                  return <TagRow key={tag.id} tag={tag} index={i} kind={kind} tagList={tagList} onSave={onSave} armed={armedId === tag.id} onArm={arm} onDirty={onDirty} />;
                })}
                <AddTagRow kind={kind} tagList={tagList} onSave={onSave} onDirty={onDirty} />
              </div>
            ) : (
              <div style={{ display: "flex", gap: SP.snug, flexWrap: "wrap" }}>
                {tags.length ? tags.map(function (tag) {
                  return <OutlineChip key={tag.id} size="small">{tag.label}</OutlineChip>;
                }) : <span style={{ fontSize: T.body, color: "var(--text-muted)" }}>None.</span>}
              </div>
            )}
          </div>
        );
      })}
      {canEdit ? null : (
        <div style={{ fontSize: T.small, color: "var(--text-faint)", marginTop: SP.wide }}>Changing this list needs the permission to change settings.</div>
      )}
    </Collapsible>
  );
}
