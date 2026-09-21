---
category: Forms
keywords: [switch, toggle, setting]
---
The on/off switch (48×26, iOS style). It is a `role="switch"` with `aria-checked`. `label` is REQUIRED and names what the switch CONTROLS — never its state ("Automatic dark mode", not "On"). `disabled` dims it to 0.4 and takes it out of the tab order; say why in the row beside it. Settings rows put the label text on the left and the Toggle hard right.

```jsx
const { Toggle, T, FW, SP } = window.MGTBookings;
<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: SP.wide }}>
  <span style={{ fontSize: T.body, fontWeight: FW.medium }}>Reduce animations</span>
  <Toggle on={reduce} onClick={() => setReduce(!reduce)} label="Reduce animations" />
</div>
```
