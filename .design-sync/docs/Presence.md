---
category: Motion
keywords: [animation, enter, exit]
---
The generic enter/exit wrapper: renders `children` with `inClass`; on `show={false}` swaps to `outClass` and unmounts after `outMs` (default `EXIT_MS`, derived from the motion tokens — don't type a number). `tag` picks the element (default `div`). The app's pairs: `mgt-slide-in` / `mgt-slide-out` (a button sliding in beside another), `mgt-slide-in-r` / `mgt-slide-out-r`, `mgt-toast-in` / `mgt-toast-out`.

```jsx
const { Presence, mkBtn, BTN } = window.MGTBookings;
<Presence show={late} inClass="mgt-slide-in" outClass="mgt-slide-out" tag="span">
  <button style={mkBtn({ background: BTN.orange })}>No show</button>
</Presence>
```
