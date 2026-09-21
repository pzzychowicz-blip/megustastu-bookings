import { useState } from "react";
import { TableGrid, ModalTitle, R } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

// TableGrid sits directly on a modal's sheet (ManualModal, the walk-in form),
// so the preview paints that sheet rather than the bare page.
function Sheet({ dark = false, title, colour, children }: { dark?: boolean; title: string; colour: string; children: any }) {
  return (
    <Surface dark={dark}>
      <div style={{ maxWidth: 580, margin: "0 auto", background: "var(--bg-sheet)", border: "1px solid var(--border-sheet)", borderRadius: R.sheet, boxShadow: "var(--shadow-sheet)", padding: 24 }}>
        <ModalTitle marginBottom={4} background={colour}>{title}</ModalTitle>
        {children}
      </div>
    </Surface>
  );
}

// The two real mounts: the walk-in form ("Walk-in", its green) and ManualModal
// ("Manual table assignment", the accent).
const WALKIN = { title: "Walk-in", colour: "var(--app-walkin)" };
const MANUAL = { title: "Manual table assignment", colour: "var(--accent)" };

function Picker({ dark = false, modal, initial, busy, seated = [], swap = false }: { dark?: boolean; modal: { title: string; colour: string }; initial: string[]; busy: string[]; seated?: string[]; swap?: boolean }) {
  const [selected, setSelected] = useState<string[]>(initial);
  // ManualModal's rule: a busy table can't be added, except a not-yet-seated
  // one in swap mode. TableGrid itself passes every tap through.
  const takeable = (id: string) => !busy.includes(id) || (swap && !seated.includes(id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : takeable(id) ? [...s, id] : s));
  return (
    <Sheet dark={dark} title={modal.title} colour={modal.colour}>
      <TableGrid selected={selected} toggle={toggle} busy={new Set(busy)} seatedBusy={new Set(seated)} swapBusy={swap} />
    </Sheet>
  );
}

// A walk-in at 20:10: the seated tables are taken, 5B is picked.
export const WalkIn = () => (
  <Picker modal={WALKIN} initial={["5B"]} busy={["i2", "5A", "7", "2", "3"]} />
);

// Assigning an existing booking by hand, swap mode on: a table held by a party
// that has not sat down yet can still be taken (labelled "swap"); a seated
// party's table cannot (labelled "busy", dimmed).
export const ManualAssignSwap = () => (
  <Picker modal={MANUAL} initial={["1A", "1B"]} busy={["i2", "5A", "7", "2", "3", "i3", "4", "6"]} seated={["i2", "5A", "7", "2", "3"]} swap />
);

export const DarkTheme = () => (
  <Picker dark modal={WALKIN} initial={["i2", "i3"]} busy={["5A", "7", "2", "3", "i1"]} />
);
