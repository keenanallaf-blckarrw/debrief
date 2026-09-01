import { useState } from "react";
import { MARKETS, STRATEGIES } from "./constants.js";
import { FD, FM, T } from "./theme.js";
import { Chip, Field, inputStyle } from "./ui.jsx";

// ---------------- Onboarding ----------------
export default function Onboarding({ onDone }) {
  const [name, setName] = useState("");
  const [markets, setMarkets] = useState([]);
  const [strats, setStrats] = useState([]);
  const [desc, setDesc] = useState("");
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "88px 24px 56px" }}>
      <div style={{ fontFamily: FM, color: T.amber, fontSize: 12, letterSpacing: 3, textTransform: "uppercase", marginBottom: 18, fontWeight: 500 }}>Debrief</div>
      <h1 style={{ fontFamily: FD, fontSize: 52, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05, margin: "0 0 16px", color: T.text }}>
        Know exactly<br />what you did.
      </h1>
      <p style={{ color: T.muted, fontSize: 18, lineHeight: 1.55, marginBottom: 48, maxWidth: 480, fontWeight: 400 }}>
        Debrief reads your trades and grades your process against your own rules. No signals. No opinions. Just an honest mirror.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        <Field label="What should we call you">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </Field>

        <div>
          <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: T.muted, marginBottom: 10, fontWeight: 500 }}>Markets you trade</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {MARKETS.map((m) => <Chip key={m} label={m} active={markets.includes(m)} onClick={() => toggle(markets, setMarkets, m)} />)}
          </div>
        </div>

        <div>
          <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: T.muted, marginBottom: 10, fontWeight: 500 }}>Your strategy stack</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {STRATEGIES.map((s) => <Chip key={s} label={s} active={strats.includes(s)} onClick={() => toggle(strats, setStrats, s)} />)}
          </div>
        </div>

        <Field label="Your rules, in your own words">
          <textarea style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="e.g. I wait for SMT divergence between ES and NQ, then enter on a 61.8 fib retrace of the displacement leg. Stop below the swing. No trades in the first 5 minutes." />
        </Field>

        <button
          onClick={() => name && markets.length && strats.length && onDone({ name, markets, strats, desc })}
          style={{
            alignSelf: "flex-start", padding: "15px 30px", borderRadius: 980, border: "none", cursor: "pointer",
            background: T.amber, color: "#0A0704", fontFamily: FD, fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em",
            opacity: name && markets.length && strats.length ? 1 : 0.35,
            transition: "opacity .2s, transform .15s",
          }}
        >
          Start my journal
        </button>
      </div>
    </div>
  );
}
