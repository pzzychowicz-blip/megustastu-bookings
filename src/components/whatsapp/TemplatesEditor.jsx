// src/components/whatsapp/TemplatesEditor.jsx
// Modal for editing the quick-reply templates (EN/ES label + text). Edits are
// staged locally; "Save all" commits the list back up to Firebase. Uses the
// shared Overlay (with the v14.4.1 pinned-footer slot) so the primary actions
// stay reachable on tall lists.

import { useState } from "react";
import { Overlay, Fld, mkInp, mkBtn } from "../atoms";
import { S, BTN } from "../../lib/constants";

export function TemplatesEditor({ templates, onSave, onClose }) {
  const [list, setList] = useState(() => templates.slice().map((t) => Object.assign({}, t)));
  const [editing, setEditing] = useState(null); // template id, or "__new__"
  const [form, setForm] = useState({ key: "", labelEn: "", labelEs: "", textEn: "", textEs: "" });

  function openEdit(t) { setEditing(t.id); setForm({ key: t.key, labelEn: t.labelEn, labelEs: t.labelEs, textEn: t.textEn, textEs: t.textEs }); }
  function openNew() { setEditing("__new__"); setForm({ key: "", labelEn: "", labelEs: "", textEn: "", textEs: "" }); }
  function saveEdit() {
    const f = form;
    if (!f.labelEn.trim() && !f.labelEs.trim()) return;
    if (!f.textEn.trim() && !f.textEs.trim()) return;
    if (editing === "__new__") {
      const newT = { id: "t" + Date.now().toString(36), key: f.key || "custom", labelEn: f.labelEn || f.labelEs, labelEs: f.labelEs || f.labelEn, textEn: f.textEn || f.textEs, textEs: f.textEs || f.textEn };
      setList(list.concat([newT]));
    } else {
      setList(list.map((t) => (t.id === editing ? Object.assign({}, t, { key: f.key, labelEn: f.labelEn, labelEs: f.labelEs, textEn: f.textEn, textEs: f.textEs }) : t)));
    }
    setEditing(null);
  }
  function removeT(id) { setList(list.filter((t) => t.id !== id)); }

  const rows = list.map((t) => (
    <div key={t.id} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--wa-row-bg)", border: "1px solid var(--wa-bubble-in-border)", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>{t.labelEn + " / " + t.labelEs}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>{"EN: " + t.textEn}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{"ES: " + t.textEs}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          <button className="mgt-hover-scale" style={mkBtn({ fontSize: 11, minHeight: 30, padding: "4px 10px", background: BTN.edit })} onClick={() => openEdit(t)}>Edit</button>
          <button className="mgt-hover-scale" style={mkBtn({ fontSize: 11, minHeight: 30, padding: "4px 10px", background: BTN.del })} onClick={() => removeT(t.id)}>Delete</button>
        </div>
      </div>
    </div>
  ));

  const editFooter = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "8px 16px", background: "var(--app-btn-slate)" })} onClick={() => setEditing(null)}>Cancel</button>
      <button onClick={saveEdit} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "8px 16px", background: S.accent })}>Save template</button>
    </div>
  );
  const listFooter = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button className="mgt-hover-scale" style={mkBtn({ minHeight: 44, padding: "10px 18px", background: "var(--app-btn-slate)" })} onClick={onClose}>Close</button>
      <button onClick={() => onSave(list)} className="mgt-hover-scale" style={mkBtn({ minHeight: 44, padding: "10px 22px", background: S.accent })}>Save all</button>
    </div>
  );

  return (
    <Overlay onClose={onClose} footer={editing ? editFooter : listFooter}>
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>Quick-reply templates</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>Used as one-tap chips in the reply composer.</div>
      {editing ? (
        <div style={{ padding: "14px", borderRadius: 12, background: "var(--wa-row-active-bg)", border: "1px solid var(--wa-row-active-border)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>{editing === "__new__" ? "New template" : "Edit template"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Fld label="Label (EN)"><input className="mgt-hover-scale" value={form.labelEn} onChange={(e) => setForm(Object.assign({}, form, { labelEn: e.target.value }))} style={mkInp()} placeholder="Confirm" /></Fld>
            <Fld label="Label (ES)"><input className="mgt-hover-scale" value={form.labelEs} onChange={(e) => setForm(Object.assign({}, form, { labelEs: e.target.value }))} style={mkInp()} placeholder="Confirmar" /></Fld>
            <Fld label="Text (EN)" style={{ gridColumn: "1 / -1" }}><textarea className="mgt-hover-scale" value={form.textEn} onChange={(e) => setForm(Object.assign({}, form, { textEn: e.target.value }))} rows={2} style={Object.assign({}, mkInp(), { resize: "vertical" })} placeholder="Your booking is confirmed..." /></Fld>
            <Fld label="Text (ES)" style={{ gridColumn: "1 / -1" }}><textarea className="mgt-hover-scale" value={form.textEs} onChange={(e) => setForm(Object.assign({}, form, { textEs: e.target.value }))} rows={2} style={Object.assign({}, mkInp(), { resize: "vertical" })} placeholder="Su reserva está confirmada..." /></Fld>
          </div>
        </div>
      ) : (
        <div>
          {rows}
          <button onClick={openNew} className="mgt-hover-scale" style={mkBtn({ minHeight: 40, padding: "8px 14px", background: S.accent })}>+ Add template</button>
        </div>
      )}
    </Overlay>
  );
}
