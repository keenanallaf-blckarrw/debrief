// Beta unlock code for premium testers.
//
// This is a convenience gate, not a security boundary: anything shipped to the
// browser can be read by anyone who opens devtools. Keep the real code out of
// git by setting VITE_PREMIUM_CODE at build time, and move the check server-side
// once there is a backend to check against.
export const PREMIUM_CODE = import.meta.env.VITE_PREMIUM_CODE || "DEMO";
