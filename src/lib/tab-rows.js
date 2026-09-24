// src/lib/tab-rows.js
// How Settings' tab bar lays out its tabs (v18.2.0, the design critique's S1:
// every tab in view). Pure, so the rule is testable without a DOM; TabBar
// measures the widths and applies the answer.
//
// One natural row when it fits. Otherwise a grid of the FEWEST rows whose equal
// cells hold the widest label, which balances them: nine tabs on a 375px phone
// are 3 × 3 (Patryk's choice over two tight rows), and on a 700px window 5 + 4.
// A plain wrap gave 4 + 4 + a lonely Admin on the phone and 7 + 2 at 700px,
// with the last row's tabs stretched to 306px each.
//
// The chosen tab is BOLD and the others semibold, so the one-row question
// carries the most any single label gains in bold. Only one tab is chosen at a
// time, and this way choosing a different one can never flip the layout.
//
//   semi, bold  each label's text width at rest and when chosen, px
//   inner       the bar's content width
//   gap         between tabs
//   rowPad      a tab's two side paddings in the natural row
//   cellPad     the same inside a grid cell
//
// Returns 0 for one natural row, else the grid's column count.
export function tabColumns(semi, bold, inner, gap, rowPad, cellPad) {
  const n = semi.length;
  if (!n) return 0;
  let row = gap * (n - 1), extra = 0, widest = 0;
  for (let i = 0; i < n; i++) {
    row += semi[i] + rowPad;
    extra = Math.max(extra, bold[i] - semi[i]);
    widest = Math.max(widest, bold[i]);
  }
  if (row + extra <= inner) return 0;
  for (let rows = 2; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    if ((inner - gap * (cols - 1)) / cols >= widest + cellPad) return cols;
  }
  return 1;
}
