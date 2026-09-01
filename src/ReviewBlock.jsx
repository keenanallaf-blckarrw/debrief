import { FD, FM, T } from "./theme.js";

// ---------------- Trade Review Card ----------------
export default function ReviewBlock({ review }) {
  if (!review) return null;
  const gradeColor = ["A", "B"].includes(review.grade) ? T.green : review.grade === "C" ? T.amber : T.red;
  return (
    <div style={{ borderLeft: `3px solid ${T.amber}`, background: "rgba(232,163,61,0.05)", padding: "14px 16px", marginTop: 12, borderRadius: "0 10px 10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: FD, fontWeight: 700, fontSize: 22, color: gradeColor }}>{review.grade}</span>
        <span style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted }}>Debrief review</span>
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.6 }}>{review.summary}</p>
      {(review.ruleCheck || []).map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.5, marginBottom: 5 }}>
          <span style={{ color: r.status === "followed" ? T.green : r.status === "broken" ? T.red : T.muted, fontFamily: FM }}>
            {r.status === "followed" ? "✓" : r.status === "broken" ? "✕" : "?"}
          </span>
          <span><strong>{r.rule}:</strong> <span style={{ color: T.muted }}>{r.note}</span></span>
        </div>
      ))}
      {review.question && (
        <p style={{ margin: "10px 0 0", fontSize: 13.5, fontStyle: "italic", color: T.amber }}>↳ {review.question}</p>
      )}
    </div>
  );
}
