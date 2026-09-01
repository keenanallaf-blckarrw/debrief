// ---------- Persistent per-user storage ----------
export async function saveAppState(state) {
  try { if (window.storage) await window.storage.set("debrief-state", JSON.stringify(state), false); } catch (e) { console.error("save failed", e); }
}
export async function loadAppState() {
  try { if (window.storage) { const r = await window.storage.get("debrief-state", false); return r ? JSON.parse(r.value) : null; } } catch (e) { return null; }
  return null;
}
