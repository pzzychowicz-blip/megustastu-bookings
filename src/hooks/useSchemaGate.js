// src/hooks/useSchemaGate.js
//
// v18.6.0 — the minimum schema gate's one reader and one writer
// (lib/schema.js has the reasoning and the rule for raising `SCHEMA`).
//
// Reads `/schema` (`{v: N}`) and tells lib/schema.js, which the writers ask.
// Returns `blocked`: the database is ahead of this build and the gate is
// enforced, so App shows the "refresh this device" card.
//
// And it ANNOUNCES this build's number when the stored one is lower, through
// `writeWithRev` like every other single node (`schema` + `schemaRev`; the rule
// also refuses a number that is not higher). Silent: nobody pressed anything.
// Two devices refreshed at once both try; one is refused by the rev, and the
// other's echo brings the number to both. Never before the first read, and
// once per page load (the note at the call says what happened without that).
import { useState, useEffect, useRef } from "react";
import { ref, onValue } from "firebase/database";
import { db, isDevDb } from "../firebase";
import { attachRev, writeWithRev } from "../lib/revGuard";
import { dbError } from "../lib/dbError";
import { SCHEMA, SCHEMA_ENFORCE_KEY, storedSchemaOf, schemaBehind, shouldAnnounce, mayAnnounceFrom, configureSchemaGate, setStoredSchema } from "../lib/schema";

// Enforced everywhere except DEV Firebase, where it is advisory unless this
// browser has set the local flag. localStorage can throw (private mode).
function readEnforce() {
  if (!isDevDb) return true;
  try { return window.localStorage.getItem(SCHEMA_ENFORCE_KEY) === "1"; } catch { return false; }
}

export function useSchemaGate() {
  const [blocked, setBlocked] = useState(false);
  const revRef = useRef(0);
  const announced = useRef(false);

  useEffect(function () {
    const enforce = readEnforce();
    // A Vercel preview reads the number and never raises it (lib/schema.js).
    const announce = enforce && mayAnnounceFrom(import.meta.env.VITE_DEPLOY_ENV);
    configureSchemaGate({ enforce: enforce });
    const offRev = attachRev("schema", revRef);
    const off = onValue(ref(db, "schema"), function (snap) {
      const stored = storedSchemaOf(snap.val());
      setStoredSchema(stored);
      setBlocked(enforce && schemaBehind(stored, SCHEMA));
      // ONCE per page load. A refused announce is rolled back locally, and
      // the rollback arrives here as the old number again: without the flag
      // that is a loop (measured on DEV before the rules were deployed there:
      // 99 refused writes in a few seconds). A device that lost the rev to
      // another gets that device's number by the echo, so it has no need to
      // try twice either.
      if (!announced.current && shouldAnnounce(stored, SCHEMA, announce)) {
        announced.current = true;
        writeWithRev("schema", { v: SCHEMA }, revRef, function () {
          // Refused: another device announced first, or the rules are not
          // deployed yet. Either way this build writes as before.
        });
      }
    }, dbError("schema"));
    return function () { off(); offRev(); };
  }, []);

  return { blocked: blocked };
}
