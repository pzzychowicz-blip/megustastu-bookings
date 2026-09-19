import { useState } from "react";
import { BookingFormModal, EMPTY_FORM } from "megustastu-bookings";
import { ModalStage } from "./_shared/backdrop";
import { ALL_BOOKINGS, TODAY, NOW, DAY_BOOKINGS } from "./_shared/fixtures";

const noop = () => {};

// The form is controlled: App owns `form` and hands the modal `setForm`.
//
// `autoOptimizer` is off. With it on, Save re-plans the whole day, and the form
// previews that pass — the sample day's tables are placed by hand rather than
// by the optimiser, so it would (correctly) announce a move on every edit.
function Form({ dark = false, initial, editId = null }: { dark?: boolean; initial: any; editId?: string | null }) {
  const [form, setForm] = useState(initial);
  return (
    <ModalStage dark={dark} height={900}>
      <BookingFormModal
        form={form} setForm={setForm} editId={editId} error="" errorField={null}
        bookings={ALL_BOOKINGS} liveBookings={ALL_BOOKINGS} tableBlocks={[]}
        autoOptimizer={false} isMobile={false} standingEnabled={true}
        vouchers={[]} vouchersByCode={{}} today={TODAY} nowMins={NOW}
        onSave={noop} onSavePending={noop} onSaveConfirm={noop} onClose={noop} onClearSwap={noop} onBookAgain={noop}
        onOpenPrefPicker={noop} onOpenManualAssign={noop} onOpenHistory={noop}
        onRequestCancel={noop} onRequestDelete={noop} onAddToWaitlist={noop}
      />
    </ModalStage>
  );
}

// Mid-way through taking a phone booking for later tonight.
export const NewBooking = () => (
  <Form initial={{ ...EMPTY_FORM, date: TODAY, name: "Isabel Navarro", phone: "+34 626 118 904", time: "21:30", size: 4, notes: "One guest is coeliac." }} />
);

// Editing a regular's booking — the draft App's openEdit builds from it.
const elena = DAY_BOOKINGS.find((b) => b.id === "b11")!;
export const EditBooking = () => (
  <Form editId="b11" initial={{
    ...EMPTY_FORM, name: elena.name, phone: elena.phone, date: elena.date, time: elena.time, size: elena.size,
    preference: elena.preference, notes: elena.notes, status: elena.status, customDur: null,
    deposit: "", voucherCode: "", manualTables: [], preferredTables: elena.preferredTables.slice(), returnOf: null, guestId: null, guestSeed: null,
  }} />
);

// A caller whose number carries two past no-shows: the form says so as it is typed.
export const RepeatNoShowDark = () => (
  <Form dark initial={{ ...EMPTY_FORM, date: TODAY, name: "Pierre Laurent", phone: "+33 7 81 22 30 45", time: "21:45", size: 2 }} />
);
