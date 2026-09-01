import { FB, FM, T } from "./theme.js";

// ---------------- Small UI pieces ----------------
export function Chip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 15px", borderRadius: 999, cursor: "pointer",
        fontFamily: FB, fontSize: 13.5, fontWeight: 500,
        border: `1px solid ${active ? "transparent" : T.border}`,
        background: active ? T.amber : "transparent",
        color: active ? "#0A0704" : T.muted, transition: "all .15s",
      }}
    >
      {label}
    </button>
  );
}

export function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 130 }}>
      <span style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: T.muted }}>{label}</span>
      {children}
    </label>
  );
}

export const inputStyle = {
  background: T.soft, border: `1px solid ${T.border}`, borderRadius: 12,
  padding: "10px 12px", color: T.text, fontFamily: FB,
  fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
};

export function Spinner({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: T.muted, fontFamily: FM, fontSize: 13, padding: "14px 0" }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: T.amber, animation: "pulse 1s infinite" }} />
      {label}
    </div>
  );
}
