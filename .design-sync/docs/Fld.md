---
category: Forms
keywords: [field, label, form]
---
A labelled form field whose label is genuinely ASSOCIATED with its control. Two shapes:

- **One control** — pass a FUNCTION. It is called with `(id, attrs)`: put `id` on the input and spread `attrs` (it carries `aria-required` / `aria-invalid` / `aria-describedby`). The label gets `htmlFor`.
- **Several controls** (a stepper pair, a row of chips, a list of times) — pass ELEMENTS. The wrapper becomes a `role="group"` named by the label.

`req` adds the red `*` (hidden from screen readers; the control says `aria-required` instead). `invalid` + `describedBy` (the id of the rendered error message) mark the field invalid — only pass them while the message is on screen. The field itself keeps its normal look: the app shows the problem in an `InlineAlert` (e.g. "Customer name is required."), never with a red border.

```jsx
const { Fld, mkInp, mkStep, SP } = window.MGTBookings;
<Fld label="Customer name" req>{(id, attrs) => <input id={id} {...attrs} style={mkInp()} />}</Fld>
<Fld label="Number of guests">
  <div style={{ display: "flex", alignItems: "center", gap: SP.base }}>
    <button style={mkStep()} aria-label="Fewer guests">−</button><span>4</span><button style={mkStep()} aria-label="More guests">+</button>
  </div>
</Fld>
```
