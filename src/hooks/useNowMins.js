// src/hooks/useNowMins.js
//
// Phase D3 (v14.1.10): Real-time clock tick extracted from BookingApp.
// Owns the wall-clock minute-of-day value (0..1439) and the 15s setInterval
// that updates it. No args; returns just { nowMins }.
//
// Hook signature:
//   const { nowMins } = useNowMins();
//
// Why 15s: the smallest unit consumers care about is one minute (seated-
// duration math is minute-resolution). Ticking every 15s detects a minute
// boundary within at most 15s of crossing it, without four renders per
// minute. Reminders need a tighter cadence than nowMins for snooze-expiry;
// that's handled by the 30s tick inside useReminders.
//
// Why the setter isn't exposed: nothing outside the tick effect writes to
// it. There is no test-clock or fast-forward facility in the app; staff
// use the system clock. Keeping the setter internal makes that explicit.

import { useState, useEffect } from "react";

export function useNowMins(){
  const [nowMins, setNowMins] = useState(function(){
    const d=new Date();
    return d.getHours()*60+d.getMinutes();
  });
  useEffect(function(){
    const t=setInterval(function(){
      const d=new Date();
      setNowMins(d.getHours()*60+d.getMinutes());
    },15000);
    return function(){clearInterval(t);};
  },[]);

  return { nowMins };
}
