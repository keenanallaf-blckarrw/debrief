import { useState } from "react";
import { computeAnalytics } from "./analytics.js";
import { callClaude } from "./api.js";
import { parseJSON } from "./parsing.js";
import { FD, FM, T } from "./theme.js";
import { Spinner } from "./ui.jsx";

// ---------------- Playbook Tab ----------------
export default function Playbook({ profile, trades, premium, onWantPremium }) {
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!premium) {
    return (
      <div style={{ background: T.panel, border: `1px dashed ${T.amber}66`, borderRadius: 20, padding: 28, textAlign: "center" }}>
        <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>★ The Playbook is a Premium feature</div>
        <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.7, maxWidth: 480, margin: "0 auto 16px" }}>
          Debrief studies every trade you've imported and writes out your strategy as a formal playbook — the entry criteria you actually use, your exit behavior, your risk habits, and the gaps between what you say you do and what your fills show.
        </p>
        <button onClick={onWantPremium} style={{ padding: "11px 24px", borderRadius: 16, border: "none", cursor: "pointer", background: T.amber, color: "#0A0704", fontFamily: FD, fontWeight: 700, fontSize: 14 }}>
          Get Premium
        </button>
      </div>
    );
  }

  const run = async () => {
    setLoading(true);
    setBook(null);
    const compact = trades.map((t) => ({ instrument: t.instrument, direction: t.direction, entry: t.entry, exit: t.exit, result: t.result, emotion: t.emotion, notes: t.notes, date: t.date, time: t.time }));
    const analytics = computeAnalytics(trades);
    const prompt = `You are the playbook engine inside Debrief, a trade journaling app. You never give buy/sell advice.

Trader's stated strategies: ${profile.strats.join(", ")}. Their own description: "${profile.desc || "none"}".

DEEP ANALYTICS (locally computed, trust these numbers): ${JSON.stringify(analytics)}

Their logged trades:
${JSON.stringify(compact.slice(0, 120))}

From their actual behavior, decode their real strategy. Ground every claim in the analytics (size after losses, quick re-entries, hour/day edge, instrument splits). Direct, specific, honest. If the sample is small, note it inside the relevant section.

Respond ONLY with JSON, no markdown fences, exactly this shape (BE COMPACT — respect every word limit):
{"styleName":"a name for their actual style, max 6 words","tagline":"one honest sentence describing how they really trade, max 20 words","sections":[{"title":"Entries","body":"max 60 words"},{"title":"Exits","body":"max 50 words"},{"title":"Risk habits","body":"max 50 words, use the sizing and re-entry numbers"},{"title":"Where the edge lives","body":"max 50 words, use the hour and day numbers"}],"gaps":[{"say":"what they claim, max 12 words","fills":"what the fills show, max 14 words"}],"rules":["rule to formalize, max 14 words","...","..."]}
Max 3 gaps, exactly 3 rules.`;
    try {
      const text = await callClaude(prompt);
      const parsed = parseJSON(text);
      setBook(parsed && parsed.styleName ? parsed : { raw: text });
    } catch (err) {
      setBook({ raw: err.message });
    }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <p style={{ color: T.muted, fontSize: 14, margin: 0, maxWidth: 460, lineHeight: 1.6 }}>
          Your strategy, decoded from what you actually did — including the gaps between what you say and what your fills show.
        </p>
        <button onClick={run} disabled={trades.length < 1}
          style={{ padding: "10px 22px", borderRadius: 980, border: `1px solid ${T.border}`, cursor: trades.length ? "pointer" : "not-allowed", background: T.soft, color: T.text, fontFamily: FD, fontWeight: 600, fontSize: 13.5, opacity: trades.length ? 1 : 0.4 }}>
          Decode my strategy
        </button>
      </div>
      {trades.length < 1 && <p style={{ color: T.muted, fontSize: 13 }}>Log at least one trade first. The more you log, the sharper the playbook.</p>}
      {loading && <Spinner label="Reading your trades, writing your playbook..." />}

      {book && book.raw && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, fontSize: 14.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{book.raw}</div>
      )}

      {book && !book.raw && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 24, padding: "30px 28px" }}>
          <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: T.amber, marginBottom: 12 }}>Your playbook</div>
          <div style={{ fontFamily: FD, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, color: T.text, marginBottom: 8 }}>
            {book.styleName}
          </div>
          {book.tagline && <p style={{ color: T.muted, fontSize: 15, lineHeight: 1.6, margin: "0 0 26px", maxWidth: 540 }}>{book.tagline}</p>}

          {(book.sections || []).map((s, i) => (
            <div key={i} style={{ padding: "18px 0", borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>{s.title}</div>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: T.text, maxWidth: 560 }}>{s.body}</p>
            </div>
          ))}

          {(book.gaps || []).length > 0 && (
            <div style={{ marginTop: 8, padding: "18px 0", borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted, marginBottom: 14 }}>What you say · What your fills show</div>
              {book.gaps.map((g, i) => (
                <div key={i} style={{ marginBottom: i < book.gaps.length - 1 ? 16 : 0 }}>
                  <div style={{ fontSize: 13.5, color: T.muted, fontStyle: "italic", lineHeight: 1.5 }}>"{g.say}"</div>
                  <div style={{ fontSize: 14, color: T.amber, lineHeight: 1.5, marginTop: 3 }}>{g.fills}</div>
                </div>
              ))}
            </div>
          )}

          {(book.rules || []).length > 0 && (
            <div style={{ marginTop: 8, padding: "20px 0 4px", borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: T.muted, marginBottom: 14 }}>Three rules to formalize</div>
              {book.rules.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 16, alignItems: "baseline", marginBottom: 12 }}>
                  <span style={{ fontFamily: FM, fontSize: 13, color: T.amber, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: T.text, lineHeight: 1.45 }}>{r}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
