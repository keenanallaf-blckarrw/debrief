import { useStore } from "./store";

// Free → Pro. Free gets the full journal, auto-import, rule grading, the
// Account Guard, trade charts and a short AI debrief per session. Pro adds the
// deep analytics, period debriefs, Ask your coach and the Playbook decoder.
//
// The unlock code is a beta convenience, not a lock: anything in the browser
// can be read by a determined person. Set VITE_PRO_CODE when building to change
// it; the real check belongs on a server once accounts exist.

export const PRO_CODE = String(import.meta.env.VITE_PRO_CODE || import.meta.env.VITE_PREMIUM_CODE || "DEMO").toUpperCase();

export function usePro(): boolean {
  return useStore((s) => s.data.settings.plan === "pro");
}

export function checkCode(code: string): boolean {
  return code.trim().toUpperCase() === PRO_CODE;
}

export const PRO_FEATURES = [
  "Deep analytics: your edge by hour, weekday, trade number and hold time",
  "Behavior tracking: revenge re-entries, sizing up after losses, tilt streaks",
  "AI debriefs of a whole week or month, not just one session",
  "Ask your coach anything about your own trading",
  "The Playbook decoder: your real strategy, written from your fills",
];
