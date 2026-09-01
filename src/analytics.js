// ---------- Deterministic analytics engine (the "tool") ----------
// All numbers the AI sees are computed here, in code, never guessed by the model.
export function computeAnalytics(trades) {
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return isNaN(n) ? 0 : n; };
  const key = (t) => {
    const m = String(t.time || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return { d: `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`, h: parseInt(m[4]), mins: parseInt(m[4])*60+parseInt(m[5]), s: (parseInt(m[4])*3600)+(parseInt(m[5])*60)+parseInt(m[6]||0) };
    return { d: t.date || "", h: null, mins: null, s: null };
  };
  const enriched = trades.map((t) => ({ ...t, pnlN: num(t.result), qtyN: Math.abs(num(t.size)), k: key(t) }));
  const agg = (list) => {
    const n = list.length; if (!n) return null;
    const wins = list.filter((t) => t.pnlN > 0);
    const net = list.reduce((a, t) => a + t.pnlN, 0);
    return { n, net: Math.round(net * 100) / 100, winRate: Math.round(100 * wins.length / n), avgWin: wins.length ? Math.round(wins.reduce((a,t)=>a+t.pnlN,0)/wins.length) : 0, avgLoss: (n-wins.length) ? Math.round(list.filter(t=>t.pnlN<=0).reduce((a,t)=>a+t.pnlN,0)/(n-wins.length)) : 0 };
  };
  const groupBy = (fn) => { const g = {}; enriched.forEach((t) => { const k = fn(t); if (k===null||k===undefined||k==="") return; (g[k]=g[k]||[]).push(t); }); return Object.fromEntries(Object.entries(g).map(([k,v])=>[k, agg(v)])); };
  // streaks
  let streak=0, worstStreak=0, run=0, worstRun=0;
  enriched.forEach((t)=>{ if(t.pnlN<0){streak++;run+=t.pnlN; if(streak>worstStreak){worstStreak=streak;} if(run<worstRun)worstRun=run;} else {streak=0;run=0;} });
  // revenge: entry within 2 min of a losing close (needs seconds; approximate via sequence order)
  let revenge = { count: 0, net: 0 };
  for (let i=1;i<enriched.length;i++){
    const prev=enriched[i-1], cur=enriched[i];
    if (prev.pnlN<0 && prev.k.d===cur.k.d && cur.k.mins!==null && prev.k.mins!==null && cur.k.mins-prev.k.mins>=0 && cur.k.mins-prev.k.mins<=2) { revenge.count++; revenge.net+=cur.pnlN; }
  }
  revenge.net = Math.round(revenge.net*100)/100;
  // size after win vs loss
  let aw=[], al=[];
  for (let i=1;i<enriched.length;i++){ (enriched[i-1].pnlN>0?aw:al).push(enriched[i].qtyN); }
  const avg=(a)=>a.length?Math.round(10*a.reduce((x,y)=>x+y,0)/a.length)/10:null;
  return {
    total: agg(enriched),
    byDay: groupBy((t)=>t.k.d||t.date),
    byInstrument: groupBy((t)=>t.instrument),
    byDirection: groupBy((t)=>t.direction),
    byHour: groupBy((t)=>t.k.h===null?"":String(t.k.h).padStart(2,"0")+":00"),
    worstStreak: { losses: worstStreak, drawdown: Math.round(worstRun*100)/100 },
    quickReentriesAfterLoss: revenge,
    avgSizeAfterWin: avg(aw), avgSizeAfterLoss: avg(al),
  };
}
