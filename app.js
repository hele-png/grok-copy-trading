"use strict";
/* CopyBot · Grok Copy Trading — paper dashboard. Only real data from data/data.json.
   The DEMO mode is clearly labelled "SIMULADO" and never touches real data. */

const REFRESH_MS = 30000;
const SEEN_KEY = "copybot-seen-v6";
const HINT_KEY = "copybot-install-closed";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q = new URLSearchParams(location.search);
const TEST = Q.has("test") || Q.has("shot");

const state = {
  real: null,          // last real payload
  view: null,          // what is rendered (real or demo copy)
  demo: false,
  range: "1D",
  posSeg: "open",
  feedFilter: "all",
  tab: "home",
  shownEquity: null,
  chartPts: null,      // last sampled chart points [[x,y]...]
  tzOffset: "+01:00",
  lastLoadOk: 0,
};

/* ---------------- formatting ---------------- */
const SUB = "₀₁₂₃₄₅₆₇₈₉";
function money(n, d = 2) {
  if (n == null || !isFinite(n)) return "—";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return (n < 0 ? "−$" : "$") + s;
}
function signedMoney(n) { if (n == null || !isFinite(n)) return "—"; return (n >= 0 ? "+" : "−") + money(Math.abs(n)); }
function pct(n, d = 2) { if (n == null || !isFinite(n)) return "—"; return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(d) + "%"; }
function price(p) {
  if (p == null || !isFinite(p)) return "n/d";
  if (p >= 1) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (p >= 0.001) return "$" + p.toPrecision(4).replace(/0+$/, "");
  const s = p.toFixed(20); const m = s.match(/^0\.(0+)(\d{1,4})/);
  if (!m) return "$" + p.toExponential(3);
  const z = m[1].length; const zs = String(z).split("").map((c) => SUB[+c]).join("");
  return "$0.0" + zs + m[2].replace(/0+$/, "");
}
function cls(n) { return n > 0.000001 ? "up" : n < -0.000001 ? "dn" : "flat"; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function parseTs(t) {
  if (!t) return null;
  let s = String(t);
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += state.tzOffset;
  const d = new Date(s); return isNaN(d) ? null : d;
}
function ago(t) {
  const d = parseTs(t); if (!d) return "";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return Math.floor(s) + " s";
  if (s < 3600) return Math.floor(s / 60) + " min";
  if (s < 86400) return Math.floor(s / 3600) + " h";
  return Math.floor(s / 86400) + " d";
}
function hhmm(t) {
  const d = parseTs(t); if (!d) return "";
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
}
function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* deterministic, muted avatar colours (no neon) */
function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function avatar(name, size = "", verified = false) {
  const h = hue(name || "?");
  const init = String(name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  const ver = verified ? '<span class="ver"><svg viewBox="0 0 10 10"><path d="M2.5 5.2 4.2 6.8 7.5 3.4"/></svg></span>' : "";
  return `<span class="av ${size}" style="background:hsl(${h} 32% 26%);color:hsl(${h} 70% 82%)">${esc(init)}${ver}</span>`;
}

const TYPE = {
  buy: { t: "Compra", c: "b" },
  tp_partial: { t: "TP1 +30%", c: "g" },
  tp2: { t: "TP2 +60%", c: "g" },
  trailing_exit: { t: "Trailing", c: null },
  stop_loss: { t: "Stop loss", c: "r" },
  breakeven_stop: { t: "Stop breakeven", c: null },
  time_exit: { t: "Sin movimiento", c: null },
  mirror_exit: { t: "Vendió el trader", c: null },
  session_close: { t: "Cierre 07:30", c: null },
};
const ROUTE = { curve: "Curva pump.fun", graduated: "Graduado", curva: "Curva pump.fun", graduado: "Graduado", "curve-non-sol": "Curva sin SOL", "curva-no-sol": "Curva sin SOL" };
function typeTag(type, pnl) {
  const m = TYPE[type] || { t: type, c: null };
  const c = m.c || (pnl > 0 ? "g" : pnl < 0 ? "r" : "");
  return `<span class="tag ${c}">${esc(m.t)}</span>`;
}
const isSell = (t) => t && t !== "buy" && TYPE[t];

/* ---------------- number tween ---------------- */
function tween(from, to, ms, tick) {
  if (from == null || Math.abs(to - from) < 0.005) { tick(to); return; }
  const t0 = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  (function f(now) {
    const k = Math.min(1, (now - t0) / ms);
    tick(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(f);
  })(t0);
}

/* ---------------- hero ---------------- */
function renderHero(d) {
  const eq = Number(d.equity);
  const start = Number(d.capital_start) || 500;
  const prev = state.shownEquity;
  const elI = $("#bal-int"), elD = $("#bal-dec");
  tween(prev, eq, 900, (v) => {
    const s = money(v); const i = s.lastIndexOf(".");
    elI.textContent = s.slice(0, i); elD.textContent = s.slice(i);
  });
  if (prev != null && Math.abs(eq - prev) > 0.005) {
    const b = $(".balance"); b.classList.remove("flash-up", "flash-dn"); void b.offsetWidth;
    b.classList.add(eq > prev ? "flash-up" : "flash-dn");
  }
  state.shownEquity = eq;
  const pnl = eq - start, p = (pnl / start) * 100;
  $("#bal-delta").innerHTML = `<span class="${cls(pnl)}">${signedMoney(pnl)} (${pct(p)})</span><span class="d-when">desde ${money(start, 0)}</span>`;
  $("#cash").textContent = money(Number(d.cash));
  $("#pos-count").textContent = `${d.open_positions ?? 0} / ${d.max_positions ?? 6}`;
}

/* ---------------- chart ---------------- */
const RANGES = { "1H": 3600e3, "4H": 4 * 3600e3, "1D": 86400e3, "1W": 7 * 86400e3, ALL: Infinity };
function series(d) {
  const pts = (d.equity_points || []).map((p) => ({ t: parseTs(p.t)?.getTime(), v: Number(p.v) })).filter((p) => p.t && isFinite(p.v));
  const now = Math.max(Date.now(), parseTs(d.built_at)?.getTime() || 0);
  pts.push({ t: now, v: Number(d.equity) });
  pts.sort((a, b) => a.t - b.t);
  return pts;
}
function valueAt(pts, t) { let v = pts[0]?.v; for (const p of pts) { if (p.t <= t) v = p.v; else break; } return v; }
function renderChart(d, animate = true) {
  const box = $("#chart"), svg = $("#chart-svg");
  const W = Math.max(200, box.clientWidth), H = box.clientHeight || 180;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const all = series(d);
  const tEnd = all[all.length - 1].t;
  const span = RANGES[state.range];
  const tStart = isFinite(span) ? Math.max(tEnd - span, Math.min(all[0].t, tEnd - 60e3)) : all[0].t;
  const v0 = valueAt(all, tStart);
  const inR = all.filter((p) => p.t > tStart);
  const pts = [{ t: tStart, v: v0 }, ...inR];
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (hi - lo < 0.5) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
  const padY = 18, padX = 2;
  const X = (t) => padX + ((t - tStart) / Math.max(1, tEnd - tStart)) * (W - padX * 2 - 8);
  const Y = (v) => padY + (1 - (v - lo) / (hi - lo)) * (H - padY * 2);
  // sample as step function (equity moves in discrete fills)
  const N = 96, sampled = [];
  for (let i = 0; i < N; i++) {
    const t = tStart + ((tEnd - tStart) * i) / (N - 1);
    sampled.push([X(t), Y(valueAt(pts, t))]);
  }
  const neg = Number(d.equity) < v0 - 0.005;
  box.classList.toggle("neg", neg);
  $("#chart-area").setAttribute("fill", neg ? "url(#area-neg)" : "url(#area-pos)");
  const base = $("#chart-base"); base.setAttribute("x2", W); base.setAttribute("y1", Y(v0)); base.setAttribute("y2", Y(v0));
  const draw = (arr) => {
    let dl = `M${arr[0][0].toFixed(1)},${arr[0][1].toFixed(1)}`;
    for (let i = 1; i < arr.length; i++) dl += `L${arr[i][0].toFixed(1)},${arr[i - 1][1].toFixed(1)}L${arr[i][0].toFixed(1)},${arr[i][1].toFixed(1)}`;
    $("#chart-line").setAttribute("d", dl);
    $("#chart-area").setAttribute("d", dl + `L${arr[arr.length - 1][0].toFixed(1)},${H}L${arr[0][0].toFixed(1)},${H}Z`);
    const e = arr[arr.length - 1]; $("#chart-dot").style.transform = `translate3d(${e[0]}px,${e[1]}px,0)`;
  };
  const prev = state.chartPts;
  if (animate && prev && prev.length === N) {
    const t0 = performance.now();
    (function f(now) {
      const k = Math.min(1, (now - t0) / 650), e = 1 - Math.pow(1 - k, 3);
      draw(sampled.map((p, i) => [prev[i][0] + (p[0] - prev[i][0]) * e, prev[i][1] + (p[1] - prev[i][1]) * e]));
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  } else draw(sampled);
  state.chartPts = sampled;
  $("#chart-dot").classList.add("on");
  // fill markers
  const fills = (d.fills || []).map((f) => ({ ...f, tt: parseTs(f.ts)?.getTime() })).filter((f) => f.tt && f.tt > tStart);
  $("#chart-marks").innerHTML = fills.map((f) => {
    const c = f.type === "buy" ? "#6E7DFF" : Number(f.pnl_usd) >= 0 ? "#2FD36B" : "#FF5A5F";
    return `<g class="mk"><circle cx="${X(f.tt).toFixed(1)}" cy="${Y(valueAt(pts, f.tt)).toFixed(1)}" r="4" fill="${c}"/></g>`;
  }).join("");
  const nb = fills.filter((f) => f.type === "buy").length, ns = fills.length - nb;
  $("#chart-note").textContent = fills.length ? `${plural(nb, "compra", "compras")} · ${plural(ns, "venta", "ventas")} en este rango` : "Sin operaciones en este rango";
  state.chartMap = { X, Y, pts, tStart, tEnd, W };
}
function setupScrub() {
  const box = $("#chart"); let tip = null;
  const move = (e) => {
    const m = state.chartMap; if (!m) return;
    const r = box.getBoundingClientRect(); const x = Math.max(0, Math.min(r.width, (e.touches ? e.touches[0].clientX : e.clientX) - r.left));
    const t = m.tStart + (x / r.width) * (m.tEnd - m.tStart); const v = valueAt(m.pts, t);
    if (!tip) { tip = document.createElement("div"); tip.className = "scrub-tip"; box.appendChild(tip); }
    tip.style.left = Math.max(40, Math.min(r.width - 40, x)) + "px";
    tip.textContent = `${money(v)} · ${new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })}`;
  };
  const end = () => { if (tip) { tip.remove(); tip = null; } };
  box.addEventListener("pointerdown", move); box.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") move(e); });
  box.addEventListener("pointerup", end); box.addEventListener("pointerleave", end); box.addEventListener("pointercancel", end);
}

/* ---------------- trades grouping ---------------- */
function groupTrades(d) {
  const groups = []; const openBy = {};
  for (const f of d.fills || []) {
    const k = f.mint + "|" + f.trader;
    if (f.type === "buy") { const g = { key: k, symbol: f.symbol, trader: f.trader, mint: f.mint, route: f.route, cost: Number(f.usd) || 0, pnl: 0, out: 0, exits: [], opened: f.ts, sig: f.solscan }; groups.push(g); openBy[k] = g; }
    else if (isSell(f.type)) { const g = openBy[k]; if (!g) continue; g.pnl += Number(f.pnl_usd) || 0; g.out += Number(f.usd) || 0; g.exits.push(f); g.closed = f.ts; }
  }
  const openMints = new Set((d.positions || []).map((p) => p.mint + "|" + p.trader));
  for (const g of groups) g.isOpen = openMints.has(g.key);
  return groups;
}
function renderTopTrades(d) {
  const g = groupTrades(d).filter((x) => x.exits.length).sort((a, b) => b.pnl - a.pnl).slice(0, 8);
  const s = d.session || {};
  $("#sess-sub").textContent = s.seen != null ? `${s.seen} vistas · ${s.copied} ${s.copied === 1 ? "copiada" : "copiadas"}` : "";
  $("#top-trades").innerHTML = g.length ? g.map((x) => `
    <div class="tt press">
      <div class="tt-top">${avatar(x.trader, "sm")}<span>${esc(x.trader)}</span></div>
      <div class="tt-pnl">${avatar(x.symbol, "sm")}<span class="${cls(x.pnl)}">${signedMoney(x.pnl)}</span></div>
    </div>`).join("") : `<div class="tt-empty">Aún no hay operaciones cerradas en esta sesión.</div>`;
}
function renderPositions(d) {
  const groups = groupTrades(d);
  const open = d.positions || [];
  const closed = groups.filter((g) => !g.isOpen && g.exits.length).reverse();
  $("#seg-open-n").textContent = open.length; $("#seg-closed-n").textContent = closed.length;
  $("#pos-seg").dataset.on = state.posSeg;
  $$("#pos-seg button").forEach((b) => b.classList.toggle("is-on", b.dataset.seg === state.posSeg));
  const el = $("#positions");
  if (state.posSeg === "open") {
    el.innerHTML = open.length ? open.map((p) => {
      const val = (Number(p.qty) || 0) * (Number(p.last_price) || 0);
      const ch = p.entry ? ((p.last_price / p.entry) - 1) * 100 : null;
      return `<div class="row press">${avatar(p.symbol, "", true)}
        <div class="row-main"><div class="row-t">${esc(p.symbol)} ${p.route ? `<span class="tag">${esc(ROUTE[p.route] || p.route)}</span>` : ""}</div>
        <div class="row-s">${esc(p.trader)} · entrada ${price(p.entry)} · stop ${price(p.stop)}</div></div>
        <div class="row-r"><div class="row-v">${money(val)}</div><div class="row-p ${cls(ch)}"><span class="tri"></span>${ch == null ? "—" : Math.abs(ch).toFixed(2) + "%"}</div></div></div>`;
    }).join("") : `<div class="empty"><b>Sin posiciones abiertas</b>El bot entra cuando una wallet compra y el token pasa los filtros.</div>`;
  } else {
    el.innerHTML = closed.length ? closed.map((g) => {
      const p = g.cost ? (g.pnl / g.cost) * 100 : 0; const last = g.exits[g.exits.length - 1];
      return `<div class="row press">${avatar(g.symbol, "", true)}
        <div class="row-main"><div class="row-t">${esc(g.symbol)} ${typeTag(last.type, g.pnl)}</div>
        <div class="row-s">${esc(g.trader)} · ${money(g.cost)} → ${money(g.out)} · ${hhmm(g.closed)}</div></div>
        <div class="row-r"><div class="row-v ${cls(g.pnl)}">${signedMoney(g.pnl)}</div><div class="row-p ${cls(p)}"><span class="tri"></span>${Math.abs(p).toFixed(2)}%</div></div></div>`;
    }).join("") : `<div class="empty"><b>Aún no hay operaciones cerradas</b></div>`;
  }
}

/* ---------------- feed ---------------- */
function feedItem(a, isNew) {
  const when = `<span class="when">${ago(a.ts)}</span>`;
  const sig = a.signature ? `<a href="https://solscan.io/tx/${esc(a.signature)}" target="_blank" rel="noopener" class="link" style="font-size:12px">Solscan ↗</a>` : "";
  const route = a.route ? `<span>${esc(ROUTE[a.route] || a.route)}</span>` : "";
  if (a.kind === "trade") {
    const pnl = Number(a.pnl_usd);
    const right = a.type === "buy" ? `<div class="row-v">${money(Number(a.usd))}</div><div class="row-s">a ${price(a.price)}</div>`
      : `<div class="row-v ${cls(pnl)}">${signedMoney(pnl)}</div><div class="row-p ${cls(pnl)}">${pct(Number(a.pnl_pct))}</div>`;
    return `<div class="fi${isNew ? " is-new" : ""}">${avatar(a.trader, "md")}
      <div class="fi-body"><div class="fi-head">${esc(a.trader)} ${typeTag(a.type, pnl)} ${when}</div>
      <div class="fi-card">${avatar(a.token, "md", true)}<div class="row-main"><div class="row-t">${esc(a.token)}</div><div class="row-s">${a.type === "buy" ? "Compra paper" : "Venta " + money(Number(a.usd))}</div></div><div class="row-r">${right}</div></div>
      <div class="fi-meta"><span>${hhmm(a.ts)}</span>${route}${sig}</div></div></div>`;
  }
  const ok = a.passed;
  const reasons = (a.reasons || []).join(" · ");
  const up = a.pct_up != null ? `<span class="mut">${pct(Number(a.pct_up), 1)} desde su entrada</span>` : "";
  return `<div class="fi${isNew ? " is-new" : ""}">${avatar(a.trader, "md")}
    <div class="fi-body"><div class="fi-head">${esc(a.trader)} <span class="tag ${ok ? "g" : ""}">${ok ? "Copiada" : "Rechazada"}</span> ${when}</div>
    <div class="fi-line">${avatar(a.token, "sm")}<span class="tk">${esc(a.token)}</span><span class="mut">${price(Number(a.price))}</span>${up}</div>
    ${!ok && reasons ? `<div class="fi-why">${esc(reasons)}</div>` : ""}
    <div class="fi-meta"><span>${hhmm(a.ts)}</span>${a.liquidity_usd != null ? `<span>liq. ${money(Number(a.liquidity_usd), 0)}</span>` : ""}${ok && a.usd ? `<span>tamaño ${money(Number(a.usd))}</span>` : ""}${route}${sig}</div></div></div>`;
}
let seenFeed = null;
function renderFeed(d) {
  const items = d.activity || [];
  const prevSeen = seenFeed; seenFeed = new Set(items.map((a) => a.kind + a.ts + a.trader + a.token + a.type));
  const isNew = (a) => prevSeen && !prevSeen.has(a.kind + a.ts + a.trader + a.token + a.type);
  const f = state.feedFilter;
  const list = items.filter((a) => f === "all" || (f === "trades" ? (a.kind === "trade" || a.passed) : (a.kind === "decision" && !a.passed)));
  $("#feed").innerHTML = list.length ? list.map((a) => feedItem(a, isNew(a))).join("") : `<div class="empty"><b>Nada por aquí todavía</b>Las decisiones aparecen en cuanto el bot ve una compra.</div>`;
  $("#home-feed").innerHTML = items.length ? items.slice(0, 4).map((a) => feedItem(a, isNew(a))).join("") : `<div class="empty"><b>Esperando señales</b>El monitor vigila las wallets cada pocos segundos.</div>`;
  const rb = (d.session || {}).rejected_by_reason || {};
  const ents = Object.entries(rb).sort((a, b) => b[1] - a[1]);
  $("#feed-summary").innerHTML = ents.map(([k, v]) => `<span class="rc"><b>${v}</b>${esc(k)}</span>`).join("");
  $("#feed-summary").hidden = !ents.length || f === "trades";
  $$("#feed-tabs button").forEach((b, i) => { b.classList.toggle("is-on", b.dataset.f === f); if (b.dataset.f === f) $("#feed-tabs .tabs-ink").style.transform = `translateX(${i * 100}%)`; });
  if (prevSeen && items.some(isNew) && state.tab !== "feed") $("#feed-badge").hidden = false;
}

/* ---------------- wallets + agents ---------------- */
function renderWallets(d) {
  const tr = [...(d.traders || [])].sort((a, b) => (parseTs(b.last_activity)?.getTime() || 0) - (parseTs(a.last_activity)?.getTime() || 0));
  $("#wallets-lead").textContent = `${plural(tr.length, "wallet", "wallets")} de Solana vigiladas · ordenadas por actividad`;
  $("#wallets").innerHTML = tr.map((t, i) => {
    const last = parseTs(t.last_activity); const fresh = last && Date.now() - last.getTime() < 15 * 60e3;
    return `<a class="row press" href="https://solscan.io/account/${esc(t.wallet)}" target="_blank" rel="noopener">
      <span class="rank">${i + 1}</span>${avatar(t.name, "", true)}
      <div class="row-main"><div class="row-t">${esc(t.name)} <span class="live-dot ${fresh ? "" : "idle"}"></span></div>
      <div class="row-s">${esc(t.short)} · ${t.activity_error ? "sin datos" : last ? "hace " + ago(t.last_activity) : "sin actividad"}</div></div>
      <div class="row-r"><div class="row-v ${t.copied ? "up" : ""}">${t.copied || 0} <span class="sub">${t.copied === 1 ? "copiada" : "copiadas"}</span></div><div class="row-s">${t.rejected || 0} rech.</div></div></a>`;
  }).join("") || `<div class="empty">Sin wallets</div>`;
  const NAMES = { watcher: "Vigilante", copier: "Copiador", executor: "Ejecutor", risk: "Riesgo" };
  $("#agents").innerHTML = (d.bots || []).map((b) => `<div class="agent"><div class="agent-h"><span>${esc(NAMES[b.id] || b.name)}</span><span class="live-dot ${/vivo/.test(b.status) ? "" : "idle"}"></span></div>
    <div class="agent-v">${esc(String(b.value).replace(/^1 copiados$/, "1 copiada").replace(/^(\d+) copiados$/, "$1 copiadas"))}</div><div class="agent-d">${esc(b.detail)}</div></div>`).join("");
}
function renderAccount(d) {
  const s = d.session || {};
  $("#profile-stats").innerHTML = `<span><b>${(d.traders || []).length}</b>wallets</span><span><b>${s.seen ?? 0}</b>vistas</span><span><b>${s.copied ?? 0}</b>${s.copied === 1 ? "copiada" : "copiadas"}</span><span><b>${s.rejected ?? 0}</b>rechazadas</span>`;
  const pnl = Number(d.pnl_usd);
  const stats = [
    ["Balance", money(Number(d.equity))], ["Efectivo", money(Number(d.cash))],
    ["PnL total", `<span class="${cls(pnl)}">${pct(Number(d.pnl_pct))}</span>`], ["Multiplicador", (Number(d.multiplier) || 1).toFixed(3) + "x"],
    ["Posiciones", `${d.open_positions ?? 0} / ${d.max_positions ?? 6}`], ["Sesión", esc(s.id || "—")],
    ["PnL realizado", `<span class="${cls(s.realized_pnl)}">${signedMoney(Number(s.realized_pnl || 0))}</span>`], ["Estado", s.halted ? '<span class="dn">Parado</span>' : '<span class="up">Operando</span>'],
  ];
  $("#account-stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><div class="label">${k}</div><div class="v">${v}</div></div>`).join("");
}
function renderStatus(d) {
  const pill = $("#status-pill");
  const hb = parseTs(d.heartbeat); const age = hb ? (Date.now() - hb.getTime()) / 1000 : Infinity;
  let c = "is-wait", t = "Conectando";
  if (d.status === "LIVE" && age < 300) { c = "is-live"; t = "En vivo"; }
  else if (d.status === "LIVE") { c = "is-off"; t = "Sin señal"; }
  else if (d.status === "INICIANDO") { t = "Iniciando"; }
  else if (d.status) { c = "is-off"; t = String(d.status).charAt(0) + String(d.status).slice(1).toLowerCase(); }
  pill.className = "status-pill " + c; pill.querySelector("b").textContent = t;
  const foot = `Datos reales del monitor y de la RPC de Solana · actualizado ${hhmm(d.built_at)} (hora de Madrid)`;
  ["#foot-home", "#foot-feed", "#foot-account"].forEach((s) => ($(s).textContent = foot));
}

/* ---------------- render ---------------- */
function render(d, { animate = true } = {}) {
  state.view = d;
  $("#app").classList.remove("is-loading");
  renderStatus(d); renderHero(d); renderChart(d, animate); renderTopTrades(d); renderPositions(d); renderFeed(d); renderWallets(d); renderAccount(d);
}

/* ---------------- toasts ---------------- */
const ICONS = {
  buy: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  win: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7"/></svg>',
  loss: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
};
function toast(f, { demo = false } = {}) {
  const host = $("#toasts");
  while (host.children.length >= 2) dismiss(host.firstElementChild, 0, -1);
  const pnl = Number(f.pnl_usd);
  const kind = f.type === "buy" ? "buy" : pnl >= 0 ? "win" : "loss";
  const el = document.createElement("div");
  el.className = "toast " + kind;
  const title = f.type === "buy" ? `Compra ${esc(f.symbol)}` : `${esc((TYPE[f.type] || {}).t || "Venta")} · ${esc(f.symbol)}`;
  const val = f.type === "buy" ? money(Number(f.usd)) : signedMoney(pnl);
  el.innerHTML = `<div class="t-ico">${ICONS[kind]}</div><div class="t-main"><div class="t-t">${title}${demo ? ' <span class="tag y">SIMULADO</span>' : ""}</div>
    <div class="t-s">copiando a ${esc(f.trader)}${f.type !== "buy" && f.pnl_pct != null ? " · " + pct(Number(f.pnl_pct), 1) : ""}</div></div>
    <div class="t-v ${f.type === "buy" ? "" : cls(pnl)}">${val}</div><div class="t-bar"><i style="animation-duration:4500ms"></i></div>`;
  host.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
  let timer = setTimeout(() => dismiss(el, 0, -1), 4500);
  // swipe in any direction to dismiss; tap opens Actividad
  let sx = 0, sy = 0, dx = 0, dy = 0, drag = false;
  el.addEventListener("pointerdown", (e) => { drag = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; el.classList.add("dragging"); el.setPointerCapture(e.pointerId); clearTimeout(timer); el.querySelector(".t-bar i").style.animationPlayState = "paused"; });
  el.addEventListener("pointermove", (e) => { if (!drag) return; dx = e.clientX - sx; dy = Math.min(0, e.clientY - sy); el.style.transform = `translate3d(${dx}px,${dy}px,0)`; el.style.opacity = String(1 - Math.min(0.8, (Math.abs(dx) + Math.abs(dy)) / 260)); });
  const up = () => {
    if (!drag) return; drag = false; el.classList.remove("dragging");
    if (Math.abs(dx) > 70) dismiss(el, Math.sign(dx), 0);
    else if (dy < -30) dismiss(el, 0, -1);
    else if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { dismiss(el, 0, -1); showTab("feed"); }
    else { el.style.transform = ""; el.style.opacity = ""; timer = setTimeout(() => dismiss(el, 0, -1), 2500); }
  };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  if (navigator.vibrate) try { navigator.vibrate(f.type === "buy" ? 12 : [10, 40, 10]); } catch {}
}
function dismiss(el, sx, sy) {
  if (!el || el.dataset.gone) return; el.dataset.gone = "1";
  el.classList.add("out"); el.style.transform = `translate3d(${sx * 110}%,${sy * 130}%,0)`; el.style.opacity = "0";
  setTimeout(() => el.remove(), 300);
}
function getSeen() { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "null") || []); } catch { return new Set(); } }
function processFills(d) {
  const fills = d.fills || [];
  let primed = true; try { primed = localStorage.getItem(SEEN_KEY) != null; } catch {}
  const seen = getSeen(); const fresh = [];
  for (const f of fills) if (!seen.has(f.id)) { seen.add(f.id); fresh.push(f); }
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-400))); } catch {}
  // on very first open only show fills from the last 5 minutes
  const show = primed ? fresh : fresh.filter((f) => Date.now() - (parseTs(f.ts)?.getTime() || 0) < 5 * 60e3);
  show.slice(-3).forEach((f, i) => setTimeout(() => toast(f), i * 650));
}

/* ---------------- load ---------------- */
let loading = false;
async function load() {
  if (loading) return; loading = true;
  try {
    const r = await fetch("data/data.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const m = String(d.built_at || "").match(/([+-]\d\d:\d\d)$/); if (m) state.tzOffset = m[1];
    state.real = d; state.lastLoadOk = Date.now();
    if (!state.demo) { render(d); processFills(d); }
  } catch (e) {
    const pill = $("#status-pill"); pill.className = "status-pill is-off"; pill.querySelector("b").textContent = "Sin conexión";
    if (!state.view) { $("#app").classList.remove("is-loading"); $("#home-feed").innerHTML = `<div class="empty"><b>No se pudieron cargar los datos</b>Desliza hacia abajo para reintentar.</div>`; }
  } finally { loading = false; }
}

/* ---------------- tabs ---------------- */
function showTab(name, { instant = false } = {}) {
  if (!$("#view-" + name)) name = "home";
  const same = state.tab === name; state.tab = name;
  const v = $("#view-" + name);
  if (same) { v.scrollTo({ top: 0, behavior: "smooth" }); return; }
  $$(".view").forEach((x) => x.classList.toggle("is-active", x === v));
  $$(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.tab === name));
  if (name === "feed") $("#feed-badge").hidden = true;
  $("#app").classList.toggle("scrolled", v.scrollTop > 4);
  if (history.replaceState) history.replaceState(null, "", location.pathname + location.search + (name === "home" ? "" : "#" + name));
}
function setupUI() {
  $$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  $$("[data-goto]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.goto)));
  $$("#ranges button").forEach((b) => b.addEventListener("click", () => {
    state.range = b.dataset.range; $$("#ranges button").forEach((x) => x.classList.toggle("is-on", x === b));
    if (state.view) renderChart(state.view, true);
  }));
  $$("#pos-seg button").forEach((b) => b.addEventListener("click", () => { state.posSeg = b.dataset.seg; if (state.view) renderPositions(state.view); }));
  $$("#feed-tabs button").forEach((b) => b.addEventListener("click", () => { state.feedFilter = b.dataset.f; if (state.view) renderFeed(state.view); }));
  $$(".view").forEach((v) => v.addEventListener("scroll", () => { if (v.classList.contains("is-active")) $("#app").classList.toggle("scrolled", v.scrollTop > 4); }, { passive: true }));
  window.addEventListener("resize", () => { if (state.view) { state.chartPts = null; renderChart(state.view, false); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  // install card (inline, closes for good)
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let closed = false; try { closed = localStorage.getItem(HINT_KEY) === "1"; } catch {}
  if (!standalone && !closed) $("#install-card").hidden = false;
  $("#install-close").addEventListener("click", () => { $("#install-card").hidden = true; try { localStorage.setItem(HINT_KEY, "1"); } catch {} });
  setupPTR(); setupScrub(); setupDemo();
  const h = location.hash.replace("#", ""); if (h) showTab(h, { instant: true });
}

/* ---------------- pull to refresh ---------------- */
function setupPTR() {
  const ptr = $("#ptr"); let y0 = null, dy = 0, v = null;
  document.addEventListener("touchstart", (e) => { v = $(".view.is-active"); if (v.scrollTop <= 0 && !e.target.closest(".toast,.chart,.hscroll")) { y0 = e.touches[0].clientY; dy = 0; } else y0 = null; }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy <= 0) { dy = 0; return; }
    const k = Math.min(90, dy * 0.45);
    v.style.transition = "none"; v.style.transform = `translate3d(0,${k}px,0)`;
    ptr.style.opacity = String(Math.min(1, k / 50)); ptr.style.transform = `translate3d(0,${k - 26}px,0) rotate(${k * 4}deg)`;
  }, { passive: true });
  document.addEventListener("touchend", async () => {
    if (y0 == null) return; y0 = null;
    const go = dy * 0.45 > 55;
    v.style.transition = ""; ptr.style.transition = "transform .3s, opacity .3s";
    if (go) {
      v.style.transform = "translate3d(0,44px,0)"; ptr.classList.add("spinning"); ptr.style.transform = "translate3d(0,14px,0)";
      if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
      await Promise.all([load(), new Promise((r) => setTimeout(r, 600))]);
    }
    v.style.transform = ""; ptr.classList.remove("spinning"); ptr.style.opacity = "0"; ptr.style.transform = "";
    setTimeout(() => { ptr.style.transition = ""; }, 320);
  });
}

/* ---------------- DEMO (simulado, never touches real data) ---------------- */
let demoTimers = [];
function setupDemo() {
  $("#demo-btn").addEventListener("click", startDemo);
  $("#demo-stop").addEventListener("click", stopDemo);
}
function startDemo() {
  if (!state.real || state.demo) return;
  state.demo = true; $("#demo-chip").hidden = false; $("#demo-bar").hidden = false; $("#demo-btn").disabled = true;
  const d = JSON.parse(JSON.stringify(state.real));
  d.fills = d.fills || []; d.activity = d.activity || []; d.equity_points = d.equity_points || []; d.positions = d.positions || [];
  showTab("home");
  const base = Number(d.equity), size = Math.round(base * 0.08 * 100) / 100;
  const p0 = 0.0000412, sym = "DEMO", trader = (d.traders && d.traders[0] && d.traders[0].name) || "Decu", mint = "DEMO-simulado";
  let eq = base; const qty = size / p0;
  const iso = (ms) => { const x = new Date(ms + 3600e3 * (parseInt(state.tzOffset) || 0)); return x.toISOString().slice(0, 19); };
  const step = (type, px, frac) => {
    const now = Date.now(), ts = iso(now);
    let f;
    if (type === "buy") {
      f = { id: "demo-buy-" + now, type, symbol: sym, usd: size, pnl_usd: 0, trader, ts, mint, route: "curve" };
      d.positions = [{ mint, symbol: sym, trader, entry: p0, qty, last_price: px, stop: p0 * 0.85, route: "curve" }];
      d.open_positions = 1; d.cash = Number(d.cash) - size;
    } else {
      const q = qty * frac, usd = q * px, pnl = q * (px - p0);
      eq += pnl; d.cash = Number(d.cash) + usd;
      f = { id: "demo-" + type + now, type, symbol: sym, usd, pnl_usd: pnl, pnl_pct: (px / p0 - 1) * 100, trader, ts, mint, route: "curve" };
      if (type === "trailing_exit") { d.positions = []; d.open_positions = 0; } else d.positions[0].last_price = px;
    }
    d.equity = eq; d.pnl_usd = eq - d.capital_start; d.pnl_pct = (d.pnl_usd / d.capital_start) * 100; d.multiplier = eq / d.capital_start;
    d.fills = [...d.fills, f]; d.equity_points = [...d.equity_points, { t: ts, v: eq }];
    d.activity = [{ kind: "trade", ts, type, trader, token: sym, usd: f.usd, price: px, pnl_usd: f.pnl_usd, pnl_pct: f.pnl_pct, route: "curve" }, ...d.activity];
    state.range = "1H"; $$("#ranges button").forEach((x) => x.classList.toggle("is-on", x.dataset.range === "1H"));
    render(d); toast(f, { demo: true });
  };
  const plan = [["buy", p0, 0, 300], ["tp_partial", p0 * 1.34, 0.5, 2600], ["tp2", p0 * 1.66, 0.25, 5200], ["trailing_exit", p0 * 1.41, 0.25, 7800]];
  demoTimers = plan.map(([t, px, fr, ms]) => setTimeout(() => step(t, px, fr), ms));
  demoTimers.push(setTimeout(stopDemo, 13000));
}
function stopDemo() {
  demoTimers.forEach(clearTimeout); demoTimers = [];
  if (!state.demo) return;
  state.demo = false; $("#demo-chip").hidden = true; $("#demo-bar").hidden = true; $("#demo-btn").disabled = false;
  if (state.real) render(state.real);
}

/* ---------------- boot ---------------- */
setupUI();
load();
setInterval(load, REFRESH_MS);
setInterval(() => { if (state.view && !state.demo) { renderChart(state.view, false); renderFeed(state.view); renderWallets(state.view); renderStatus(state.view); } }, 15000);
if ("serviceWorker" in navigator && !TEST) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").then((reg) => {
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {}));
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!hadController || reloaded) return; reloaded = true; location.reload(); });
}
