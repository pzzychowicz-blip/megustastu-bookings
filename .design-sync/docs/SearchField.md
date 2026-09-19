---
category: Forms
keywords: [search, input, clear]
---
A search pill that owns its clear button (a real `<button>` named "Clear search", shown only while there is text). Use it for every search box — never style a bare `<input type="search">` and never give a search input `.mgt-hover-scale` (the hover lift would move the browser's own clear button out from under the cursor). It is 42px tall, the same as `mkInp()`, so it lines up with a `DateField` on one row.

```jsx
const { SearchField } = window.MGTBookings;
<SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")}
  placeholder="Name or phone" ariaLabel="Search bookings" />
```
