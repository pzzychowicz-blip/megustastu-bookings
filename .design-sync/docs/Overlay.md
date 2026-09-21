---
category: Overlays
keywords: [modal, dialog, sheet, popup]
---
Every modal in MGT Bookings is an `Overlay`. From 600px wide up it is a centred frosted-glass card (max 580px, `R.sheet` corners) over a blurred scrim; below 600px it becomes a full-screen sheet. It carries the whole dialog contract: `role="dialog"`, `aria-modal`, a focus trap, focus restore on close, and an accessible name taken from the first `ModalTitle` (or heading) inside it.

- Start the body with a `ModalTitle`.
- Put the action row in `footer` — it stays pinned to the bottom while the body scrolls. Omit it for read-only popovers.
- `onClose` fires on a scrim click (desktop only; the phone sheet has no scrim, so a footer button must also close it).
- For the closing animation, mount it inside `ModalPresence`.
- Never hand-write a scrim or a blurred card: the app allows at most 4 simultaneous `backdrop-filter` blurs and `Overlay` already spends 2.
- `panel={{ maxWidth, height, background, blur }}` is for the rare dialog that brings its own layout (no padding, no scroll port).

```jsx
const { Overlay, ModalTitle, Fld, mkInp, mkBtn, mkSolidBtn, SP } = window.MGTBookings;
<Overlay onClose={close} footer={
  <div style={{ display: "flex", gap: SP.base, justifyContent: "flex-end" }}>
    <button style={mkBtn({ background: "var(--app-btn-slate)" })} onClick={close}>Back</button>
    <button style={mkSolidBtn("var(--app-new)")} onClick={save}>Save booking</button>
  </div>}>
  <ModalTitle background="var(--app-new)">New booking</ModalTitle>
  <Fld label="Customer name" req>{(id, attrs) => <input id={id} {...attrs} style={mkInp()} />}</Fld>
</Overlay>
```
