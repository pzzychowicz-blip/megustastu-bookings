import { useState } from "react";
import { SearchField, DateField, mkInp, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

function Live({ initial, placeholder, dark = false }: { initial: string; placeholder: string; dark?: boolean }) {
  const [q, setQ] = useState(initial);
  return (
    <Surface dark={dark}>
      <SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder={placeholder} ariaLabel="Search bookings" />
    </Surface>
  );
}

export const WithQuery = () => <Live initial="Lucía" placeholder="Name or phone" />;

export const Empty = () => <Live initial="" placeholder="Name or phone" />;

export const BesideADateField = () => (
  <Surface>
    <div style={{ display: "flex", gap: SP.base }}>
      <div style={{ flex: 2 }}><SearchField value="table 5A" onChange={() => {}} onClear={() => {}} placeholder="Search the log" ariaLabel="Search the activity log" /></div>
      <div style={{ flex: 1 }}><DateField value="2026-09-26" onChange={() => {}} style={mkInp()} inputProps={{ "aria-label": "From" }} /></div>
    </div>
  </Surface>
);

export const DarkTheme = () => <Live initial="+34 612" placeholder="Name or phone" dark />;
