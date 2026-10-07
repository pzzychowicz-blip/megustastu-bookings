// src/hooks/useBackup.js
//
// v18.4.5 (ROADMAP #17) — "Download backup", out of BookingApp. The flow and its
// wording are `runBackup` in lib/backup.js; this keeps what is React's: the
// status line shown under the button, one read at a time, and which open of
// Settings a read belongs to.
//
//   backupStatus      null | {kind: "busy" | "done" | "error", text}
//   doBackup()        Settings' button
//   endBackupOpen()   called when Settings closes: clears the line, and makes a
//                     read still out belong to no open (lib/backup.js,
//                     `backupReportTarget`)
//
// `refused` and `setWriteWarning` are App's. The capability is asked here, as
// the first thing: this is the widest data-protection action in the app (every
// booking, every customer name and every phone number in one file) and the ONE
// gated capability with no rule behind it, since the file is built client-side
// out of reads and `.read` is `auth != null` at the root.

import { useRef, useState } from "react";
import { runBackup, backupReportTarget } from "../lib/backup";
import { saveTextFile } from "../lib/download";
import { todayStr } from "../lib/day";

export function useBackup({ readDatabaseRoot, refused, setWriteWarning, appVersion }) {
  const [backupStatus, setBackupStatus] = useState(null);
  const inFlightRef = useRef(false);
  const openRef = useRef(0);

  function doBackup() {
    if (refused("dataExport")) return;
    // One read at a time: a second tap while the first is out would only
    // download the same file twice.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const open = openRef.current;
    runBackup({
      readRoot: readDatabaseRoot,
      save: saveTextFile,
      appVersion: appVersion,
      day: todayStr(),
      exportedAt: new Date().toISOString(),
      report: function (st) {
        const target = backupReportTarget(st, open === openRef.current);
        if (target === "status") setBackupStatus(st);
        else if (target === "banner") setWriteWarning(st.text);
      },
    }).finally(function () { inFlightRef.current = false; });
  }

  function endBackupOpen() { setBackupStatus(null); openRef.current++; }

  return { backupStatus, doBackup, endBackupOpen };
}
