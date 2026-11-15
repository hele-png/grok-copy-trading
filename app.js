/* Grok Copy Trading PWA — renders only data from data/data.json */
const REFRESH_MS = 45000;
const START = {
  status: "INICIANDO",
  mode: "PAPER",
  capital_start: 500,
  equity: 500,
  cash: 500,
  pnl_usd: 0,
  pnl_pct: 0,
  multiplier: 1,
  open_positions: 0,
  max_positions: 4,
  equity_points: [],
  session: { seen: 0, copied: 0, rejected: 0, fills: 0, halted: false },
  bots: [
    { id: "watcher", name: "Watcher", status: "iniciando", value: "3 wallets", detail: "sondeo de compras en Solana" },
    { id: "copier", name: "Copier", status: "iniciando", value: "0 copiados", detail: "0 vistos · 0 rechazados" },
    { id: "executor", name: "Executor", status: "iniciando", value: "0 abiertas", detail: "0 fills paper" },
    { id: "risk", name: "Risk", status: "iniciando", value: "0.00% DD", detail: "stop −12% · TP +25% · trailing 15% · ventana 21:00–07:30" },
  ],
  traders: [
    { name: "frank", wallet: "498g1rVnFcnjBjpfw1xyqA1WvgQXUU8RWuELjxkjAayQ", short: "498g…AayQ", status: "iniciando" },
    { name: "Unipcs", wallet: "2heJbC32Tpfcb3nbUb5ER61K11FGZVfVGtVnDm6LDogF", short: "2heJ…DogF", status: "iniciando" },
    { name: "Decu", wallet: "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9", short: "4vw5…9Ud9", status: "iniciando" },
  ],
  activity: [],
  fills: [],
  screen: "data/screen.jpg",
  screen_caption: "Tablero de estado (aún no hay captura de escritorio)",
  note: "Sin data.json: se muestra el capital de partida.",
};

const ICONS = {
  watcher: '<svg viewBox="0 0 24 24"><path d="M12 5c-5 0-8.5 4.2-9.7 6.2a1.5 1.5 0 0 0 0 1.6C3.5 14.8 7 19 12 19s8.5-4.2 9.7-6.2a1.5 1.5 0 0 0 0-1.6C20.5 9.2 17 5 12 5zm0 11.2A4.2 4.2 0 1 1 16.2 12 4.2 4.2 0 0 1 12 16.2zm0-6.4A2.2 2.2 0 1 0 14.2 12 2.2 2.2 0 0 0 12 9.8z"/></svg>',
  copier: '<svg viewBox="0 0 24 24"><path d="M8 7.5A1.5 1.5 0 0 1 9.5 6h9A1.5 1.5 0 0 1 20 7.5v11A1.5 1.5 0 0 1 18.5 20h-9A1.5 1.5 0 0 1 8 18.5zm-3.5 9V5.5A1.5 1.5 0 0 1 6 4h10v1.5H6.5v11z"/></svg>',
  executor: '<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19.2 12z"/></svg>',
  risk: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6.2v5.3c0 4.3 2.9 7.4 7 8.8 4.1-1.4 7-4.5 7-8.8V6.2z"/></svg>',
};


let data = START;
let displayedEquity = null;
let liveTicks = [];
let demoState = null;

let range = "1H";
let deferredPrompt = null;

function money(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pct(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "+";
  return sign + Math.abs(n).toFixed(digits) + "%";
}
function initials(name) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function setStatus(status) {
  const el = document.getElementById("status-pill");
  const label = document.querySelector(".status-label");
  const key = (status || "INICIANDO").toUpperCase();
  el.className = "status-pill " + (key === "LIVE" ? "live" : key === "OFFLINE" ? "offline" : "iniciando");
  label.textContent = key === "LIVE" ? "LIVE" : key;
}

function currentEquity(d) {
  if (demoState && demoState.equity != null) return Number(demoState.equity);
  return Number(d && d.equity);
}

function currentPnl(d) {
  const start = Number((d && d.capital_start) || 500);
  const eq = currentEquity(d);
  const usd = eq - start;
  return { usd, pct: start ? (usd / start) * 100 : 0, mult: start ? eq / start : 1 };
}

function tweenNumber(from, to, ms, onTick, onDone) {
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    onTick(from + (to - from) * ease(p));
    if (p < 1) requestAnimationFrame(step);
    else if (onDone) onDone();
  };
  requestAnimationFrame(step);
}

function renderHero(d, { tween = true } = {}) {
  const target = currentEquity(d);
  const el = document.getElementById("balance");
  const pnl = currentPnl(d);
  const mul = document.getElementById("multiplier");
  mul.textContent = pnl.mult.toFixed(2) + "x";
  mul.className = "multiplier" + (pnl.mult > 1.0005 ? " up" : pnl.mult < 0.9995 ? " down" : "");
  const pill = document.getElementById("pnl-pill");
  pill.textContent = pct(pnl.pct);
  pill.className = "pnl-pill " + (pnl.pct < 0 ? "neg" : "pos");
  const usd = document.getElementById("pnl-usd");
  usd.textContent = (pnl.usd < 0 ? "−" : "+") + money(Math.abs(pnl.usd));
  if (target == null || Number.isNaN(target)) return;
  const skip = displayedEquity == null || !tween || isShot() || Math.abs(target - displayedEquity) < 0.005;
  if (skip) {
    displayedEquity = target;
    el.textContent = money(target);
    return;
  }
  const from = displayedEquity;
  el.classList.remove("flash-up", "flash-down");
  void el.offsetWidth;
  el.classList.add(target > from ? "flash-up" : "flash-down");
  tweenNumber(from, target, 700, (v) => {
    displayedEquity = v;
    el.textContent = money(v);
  }, () => {
    displayedEquity = target;
    el.textContent = money(target);
    el.classList.remove("flash-up", "flash-down");
  });
}

function parseTime(t) {
  if (t == null || t === "") return null;
  if (typeof t === "number" && Number.isFinite(t)) return t < 1e12 ? t * 1000 : t;
  const s = String(t).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  const naive = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isNaN(naive.getTime()) ? null : naive.getTime();
}

function extraTicks() {
  if (demoState) return demoState.ticks || [];
  return liveTicks;
}

function mergedPoints(d) {
  const base = (demoState && demoState.points) ? demoState.points : ((d && d.equity_points) || []);
  return base.concat(extraTicks());
}

function pointsForRange(points, key) {
  const pts = (points || [])
    .map((p) => ({ t: typeof p.t === "number" ? p.t : parseTime(p.t), v: Number(p.v), source: p.source }))
    .filter((p) => p.t != null && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  const now = Date.now();
  const span = { "1H": 3600e3, "4H": 4 * 3600e3, "1D": 24 * 3600e3, "1W": 7 * 24 * 3600e3, "ALL": 24 * 3600e3 }[key] || 24 * 3600e3;
  const cut = now - span;
  if (!pts.length) return [];
  const last = pts[pts.length - 1];
  const inRange = pts.filter((p) => p.t >= cut);
  const before = [...pts].reverse().find((p) => p.t < cut);
  let out = before ? [{ ...before, t: cut }, ...inRange] : inRange.slice();
  if (!out.length) out = [{ t: last.t, v: last.v, source: last.source }];
  if (out[out.length - 1].t < now - 250) {
    out.push({ t: now, v: out[out.length - 1].v, source: "live-now" });
  }
  return { pts: out, cut, now, span };
}

function smoothPath(pts, w, h, padX, padY) {
  if (pts.length === 1) {
    const y = padY + (h - padY * 2) / 2;
    const t0 = pts[0].t, t1 = pts[0].t;
    return { d: `M ${padX} ${y} L ${w - padX} ${y}`, min: pts[0].v, max: pts[0].v, t0, t1, ys: [y], xs: [w / 2] };
  }
  const vs = pts.map((p) => p.v);
  let min = Math.min(...vs);
  let max = Math.max(...vs);
  if (min === max) {
    min = min * 0.98;
    max = max * 1.02 || 1;
  } else {
    const pad = (max - min) * 0.18;
    min -= pad;
    max += pad;
  }
  const ts = pts.map((p) => p.t);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const span = Math.max(t1 - t0, 1);
  const xy = pts.map((p) => ({
    x: padX + ((p.t - t0) / span) * (w - padX * 2),
    y: padY + (1 - (p.v - min) / (max - min)) * (h - padY * 2),
  }));
  const n = xy.length;
  const dx = [];
  const dy = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xy[i + 1].x - xy[i].x || 1;
    dy[i] = xy[i + 1].y - xy[i].y;
    m[i] = dy[i] / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else t[i] = (m[i - 1] + m[i]) / 2;
  }
  t[n - 1] = m[n - 2];
  let d = `M ${xy[0].x.toFixed(2)} ${xy[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = xy[i].x + dx[i] / 3;
    const c1y = xy[i].y + (t[i] * dx[i]) / 3;
    const c2x = xy[i + 1].x - dx[i] / 3;
    const c2y = xy[i + 1].y - (t[i + 1] * dx[i]) / 3;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${xy[i + 1].x.toFixed(2)} ${xy[i + 1].y.toFixed(2)}`;
  }
  return { d, min, max, t0, t1, xs: xy.map((p) => p.x), ys: xy.map((p) => p.y) };
}

function isLossFill(f) {
  return f && f.type !== "buy" && Number(f.pnl_pct) < 0;
}

function fillLabel(type) {
  return ({
    buy: "Copiado",
    tp_partial: "TP parcial",
    trailing_exit: "Trailing",
    stop_loss: "Stop",
    session_close: "Cierre",
  })[type] || type || "Fill";
}

function projectFill(fill, scale, w, h, padX, padY) {
  const t = parseTime(fill.ts);
  const v = Number(fill.equity);
  if (t == null || !Number.isFinite(v) || t < scale.t0 - 1000 || t > scale.t1 + 1000) return null;
  const span = Math.max(scale.t1 - scale.t0, 1);
  const range = scale.max - scale.min || 1;
  return {
    x: padX + ((t - scale.t0) / span) * (w - padX * 2),
    y: padY + (1 - (v - scale.min) / range) * (h - padY * 2),
  };
}

function markerSvg(fills, scale, w, h, padX, padY, extraClass) {
  return (fills || []).map((f) => {
    const pt = projectFill(f, scale, w, h, padX, padY);
    if (!pt) return "";
    const color = isLossFill(f) ? "#ff4d4f" : "#00d26a";
    const cls = extraClass || "fill-mark";
    return `<g class="${cls}">
      <circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="6.2" fill="${color}" fill-opacity="0.22"></circle>
      <circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="3.6" fill="${color}" stroke="#000" stroke-width="1.1"></circle>
    </g>`;
  }).join("");
}

function renderChart(d) {
  const svg = document.getElementById("equity-chart");
  const cap = document.getElementById("chart-empty");
  const packed = pointsForRange(mergedPoints(d), range);
  const pts = packed.pts || packed;
  const w = 390, h = 196, padX = 0, padY = 14;
  const fills = demoState && demoState.fills
    ? demoState.fills
    : (d.fills || []).filter((f) => !f.demo);
  if (!pts.length) {
    const y = h / 2;
    svg.innerHTML = `
      <defs>
        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00d26a" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#00d26a" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M ${padX} ${y} L ${w - padX} ${y} L ${w - padX} ${h} L ${padX} ${h} Z" fill="url(#eqFill)"/>
      <path d="M ${padX} ${y} L ${w - padX} ${y}" fill="none" stroke="#00d26a" stroke-width="2" stroke-linecap="round"/>
    `;
    return;
  }
  // Scale x against the selected window so new time extends the line honestly.
  const t0 = packed.cut != null ? packed.cut : pts[0].t;
  const t1 = packed.now != null ? packed.now : pts[pts.length - 1].t;
  const vs = pts.map((p) => p.v);
  let min = Math.min(...vs);
  let max = Math.max(...vs);
  if (min === max) {
    min = min * 0.98;
    max = max * 1.02 || 1;
  } else {
    const pad = (max - min) * 0.18;
    min -= pad;
    max += pad;
  }
  const spanT = Math.max(t1 - t0, 1);
  const xy = pts.map((p) => ({
    x: padX + ((p.t - t0) / spanT) * (w - padX * 2),
    y: padY + (1 - (p.v - min) / (max - min)) * (h - padY * 2),
  }));
  // Monotone cubic through time-window coordinates
  const n = xy.length;
  let dpath;
  if (n === 1) {
    dpath = `M ${xy[0].x.toFixed(2)} ${xy[0].y.toFixed(2)} L ${w - padX} ${xy[0].y.toFixed(2)}`;
  } else {
    const dx = [], dy = [], m = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = xy[i + 1].x - xy[i].x || 1;
      dy[i] = xy[i + 1].y - xy[i].y;
      m[i] = dy[i] / dx[i];
    }
    const sl = [m[0]];
    for (let i = 1; i < n - 1; i++) sl[i] = (m[i - 1] * m[i] <= 0) ? 0 : (m[i - 1] + m[i]) / 2;
    sl[n - 1] = m[n - 2];
    dpath = `M ${xy[0].x.toFixed(2)} ${xy[0].y.toFixed(2)}`;
    for (let i = 0; i < n - 1; i++) {
      const c1x = xy[i].x + dx[i] / 3;
      const c1y = xy[i].y + (sl[i] * dx[i]) / 3;
      const c2x = xy[i + 1].x - dx[i] / 3;
      const c2y = xy[i + 1].y - (sl[i + 1] * dx[i]) / 3;
      dpath += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${xy[i + 1].x.toFixed(2)} ${xy[i + 1].y.toFixed(2)}`;
    }
  }
  const lastX = xy[xy.length - 1].x;
  const lastY = xy[xy.length - 1].y;
  const firstX = xy[0].x;
  const area = `${dpath} L ${lastX.toFixed(2)} ${h} L ${firstX.toFixed(2)} ${h} Z`;
  const winScale = { t0, t1, min, max };
  const areaPath = area;
  svg.innerHTML = `
    <defs>
      <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#00d26a" stop-opacity="0.28"/>
        <stop offset="80%" stop-color="#00d26a" stop-opacity="0.03"/>
        <stop offset="100%" stop-color="#00d26a" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#eqFill)"></path>
    <path id="eq-line" d="${dpath}" fill="none" stroke="#00d26a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    ${markerSvg(fills, winScale, w, h, padX, padY)}
    <circle class="end-dot-pulse" cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="6" fill="#00d26a" fill-opacity="0.35"></circle>
    <circle cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="3.2" fill="#00d26a"></circle>
  `;
  if (cap) cap.textContent = "";
}

function renderLiveEvent(fill, { demo = false } = {}) {
  const el = document.getElementById("live-event");
  if (!el) return;
  if (!fill) {
    if (!demo) {
      el.hidden = true;
      el.innerHTML = "";
    }
    return;
  }
  const loss = isLossFill(fill);
  const title = `${fillLabel(fill.type)} ${fill.symbol || "?"}`;
  const bits = [];
  if (fill.usd != null) bits.push(money(fill.usd));
  if (fill.type !== "buy" && fill.pnl_pct != null) bits.push(pct(fill.pnl_pct));
  if (fill.trader) bits.push(fill.trader);
  const link = (!demo && fill.solscan)
    ? `<a href="${esc(fill.solscan)}" target="_blank" rel="noopener noreferrer">Solscan</a>`
    : "";
  const kicker = demo ? `<div class="toast-kicker">DEMO · simulado</div>` : "";
  el.className = "live-event" + (loss ? " neg" : "") + (demo ? " demo" : "");
  el.innerHTML = `
    <span class="pulse-dot"></span>
    <div class="live-event-main">
      ${kicker}
      <div class="live-event-title">${esc(title)}</div>
      <div class="live-event-meta">${esc(bits.join(" · "))}</div>
    </div>
    ${link}
  `;
  el.hidden = false;
}

function renderBots(target, bots) {
  const el = document.getElementById(target);
  el.innerHTML = (bots || []).map((b) => {
    const st = (b.status || "").replace(/\s+/g, "-");
    return `<article class="bot">
      <div class="bot-icon ${b.id}">${ICONS[b.id] || ""}</div>
      <div class="bot-main">
        <div class="bot-name">${esc(b.name)}</div>
        <div class="bot-detail">${esc(b.detail || "")}</div>
      </div>
      <div class="bot-right">
        <div class="bot-value">${esc(b.value || "")}</div>
        <div class="bot-status ${st}">${esc(b.status || "")}</div>
      </div>
    </article>`;
  }).join("");
}

function renderTraders(target, traders) {
  const el = document.getElementById(target);
  el.innerHTML = (traders || []).map((t) => {
    const ago = t.last_activity_ago || (t.activity_error ? "actividad no verificada" : "sin dato on-chain");
    const human = t.last_activity_human || "";
    const stats = (t.copied != null) ? `${t.copied} copiados · ${t.rejected || 0} rechazados` : "";
    return `<article class="trader">
      <div class="trader-top">
        <div class="avatar">${esc(initials(t.name))}</div>
        <div>
          <div class="trader-name">${esc(t.name)}</div>
          <div class="trader-addr">${esc(t.short || "")}</div>
        </div>
      </div>
      <div class="trader-meta">
        <div class="trader-ago">${esc(ago)}</div>
        <div class="trader-human">${esc(human)}</div>
        <div class="trader-stats">${esc(stats)} · ${esc(t.status || "")}</div>
      </div>
    </article>`;
  }).join("");
}

function renderActivity(target, items, emptyNote) {
  const el = document.getElementById(target);
  if (!items || !items.length) {
    el.innerHTML = `<div class="empty">${esc(emptyNote || "Sin trades en esta sesión")}</div>`;
    return;
  }
  el.innerHTML = items.map((it) => {
    const copied = it.type === "copied" || it.passed === true || it.type === "buy";
    const rejected = it.type === "rejected" || it.passed === false;
    const tag = copied && it.kind === "decision" ? "copy" : rejected ? "reject" : "trade";
    const tagLabel = it.kind === "decision" ? (copied ? "COPIADO" : "RECHAZADO") : (it.type || "TRADE");
    const bits = [];
    if (it.trader) bits.push(it.trader);
    if (it.usd != null) bits.push(money(it.usd));
    if (it.liquidity_usd != null) bits.push("liq. " + money(it.liquidity_usd, 0));
    if (it.market_cap != null) bits.push("mcap " + money(it.market_cap, 0));
    if (it.pct_up != null) bits.push(pct(it.pct_up));
    if (it.reasons && it.reasons.length) bits.push(it.reasons[0]);
    return `<article class="act">
      <div class="act-top">
        <div class="act-token"><span class="tag ${tag}">${esc(tagLabel)}</span>${esc(it.token || "?")}</div>
        <div class="act-ago">${esc(it.ago || it.ts_human || "")}</div>
      </div>
      <div class="act-row">${esc(bits.join(" · "))}</div>
    </article>`;
  }).join("");
}

function renderAccount(d) {
  const el = document.getElementById("account-stats");
  const s = d.session || {};
  el.innerHTML = [
    ["Equity", money(d.equity)],
    ["Cash", money(d.cash)],
    ["PnL", pct(d.pnl_pct)],
    ["Multiplicador", (Number(d.multiplier) || 1).toFixed(2) + "x"],
    ["Posiciones", `${d.open_positions || 0} / ${d.max_positions || 4}`],
    ["Sesión", s.id || "sin sesión"],
    ["Vistos", String(s.seen ?? 0)],
    ["Copiados", String(s.copied ?? 0)],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${esc(v)}</b></div>`).join("");
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SEEN_KEY = "copybot-seen-fills";
const PRIMED_KEY = "copybot-fills-primed";

function getSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500))); } catch {}
}

function showToast(fill, { demo = false } = {}) {
  const box = document.getElementById("toasts");
  if (!box || isShot()) return;
  const liveToasts = () => [...box.children].filter((el) => !el.classList.contains("out"));
  while (liveToasts().length >= 2) dismissToast(liveToasts().pop(), { dy: -80 });
  const loss = isLossFill(fill);
  const el = document.createElement("div");
  el.className = "toast " + (loss ? "neg" : "pos");
  const title = `${fillLabel(fill.type)} ${fill.symbol || "?"}`;
  const bits = [];
  if (fill.usd != null) bits.push(money(fill.usd));
  if (fill.type !== "buy" && fill.pnl_pct != null) bits.push(pct(fill.pnl_pct));
  if (fill.trader) bits.push(fill.trader);
  el.innerHTML = `
    ${demo ? '<span class="toast-kicker">DEMO</span>' : ""}
    <span class="toast-title">${esc(title)}</span>
    <span class="toast-meta">${esc(bits.join(" · "))}</span>
  `;
  box.prepend(el);
  let timer = setTimeout(() => dismissToast(el, { dy: -90 }), 3500);
  const cancelTimer = () => { clearTimeout(timer); timer = null; };
  attachToastGestures(el, cancelTimer);
}

function dismissToast(el, dir) {
  if (!el || el.classList.contains("out")) return;
  el.classList.add("out");
  el.style.pointerEvents = "none";
  el.style.position = "absolute";
  el.style.left = "0";
  el.style.right = "0";
  const dx = (dir && dir.dx) || 0;
  const dy = (dir && dir.dy) || -90;
  el.style.transition = "transform 0.28s ease, opacity 0.28s ease";
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  el.style.opacity = "0";
  setTimeout(() => el.remove(), 280);
}

function attachToastGestures(el, cancelTimer) {
  let x0 = 0, y0 = 0, t0 = 0, lastX = 0, lastY = 0, lastT = 0, tracking = false, pid = null;
  const pos = (e) => {
    if (e.touches && e.touches[0]) return e.touches[0];
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0];
    return e;
  };
  const down = (e) => {
    const p = pos(e);
    tracking = true;
    x0 = lastX = p.clientX;
    y0 = lastY = p.clientY;
    t0 = lastT = Date.now();
    el.style.transition = "none";
    if (e.pointerId != null && el.setPointerCapture) {
      try { el.setPointerCapture(e.pointerId); pid = e.pointerId; } catch {}
    }
  };
  const move = (e) => {
    if (!tracking) return;
    const p = pos(e);
    lastX = p.clientX; lastY = p.clientY; lastT = Date.now();
    const dx = lastX - x0, dy = lastY - y0;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.opacity = String(Math.max(0.15, 1 - Math.hypot(dx, dy) / 150));
    if (e.cancelable) e.preventDefault();
  };
  const up = (e) => {
    if (!tracking) return;
    tracking = false;
    const p = pos(e);
    const x = p.clientX != null ? p.clientX : lastX;
    const y = p.clientY != null ? p.clientY : lastY;
    const dx = x - x0, dy = y - y0;
    const dt = Math.max(16, Date.now() - t0);
    const vx = dx / dt * 1000, vy = dy / dt * 1000;
    const dist = Math.hypot(dx, dy);
    const fling = Math.abs(vx) > 550 || vy < -450;
    const far = Math.abs(dx) > 72 || dy < -36;
    if (dist < 8) {
      cancelTimer();
      dismissToast(el, { dy: -90 });
      return;
    }
    if (far || fling) {
      cancelTimer();
      const side = Math.abs(dx) > Math.abs(dy) || Math.abs(vx) > Math.abs(vy);
      const outX = side ? (dx >= 0 ? 420 : -420) : 0;
      const outY = side ? 0 : (dy < 0 || vy < 0 ? -280 : 280);
      dismissToast(el, { dx: outX, dy: outY });
    } else {
      el.style.transition = "transform 0.22s ease, opacity 0.22s ease";
      el.style.transform = "translate(0,0)";
      el.style.opacity = "1";
    }
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

function vibrateFor(fills) {
  if (!navigator.vibrate) return;
  try {
    const loss = fills.some(isLossFill);
    navigator.vibrate(loss ? [30, 40, 40] : 40);
  } catch {}
}

function processFills(fills) {
  const real = (fills || []).filter((f) => f && f.id && !f.demo);
  const seen = getSeen();
  let primed = false;
  try { primed = localStorage.getItem(PRIMED_KEY) === "1"; } catch {}
  if (!primed) {
    real.forEach((f) => seen.add(f.id));
    saveSeen(seen);
    try { localStorage.setItem(PRIMED_KEY, "1"); } catch {}
    return;
  }
  const fresh = real.filter((f) => !seen.has(f.id))
    .sort((a, b) => (parseTime(a.ts) || 0) - (parseTime(b.ts) || 0));
  for (const f of fresh) {
    seen.add(f.id);
    showToast(f, { demo: false });
  }
  if (fresh.length) {
    saveSeen(seen);
    vibrateFor(fresh);
  }
}

function render(d) {
  setStatus(d.status);
  renderHero(d, { tween: true });
  renderChart(d);
  const cap = document.getElementById("screen-caption");
  cap.textContent = d.screen_caption || d.built_at_human || "";
  const img = document.getElementById("live-screen");
  const src = (d.screen || "data/screen.jpg").replace(/^\//, "") + "?t=" + encodeURIComponent(d.built_at || Date.now());
  if (!img.dataset.locked) img.src = src;
  const latest = (d.latest_fill && !d.latest_fill.demo) ? d.latest_fill : (d.fills || []).filter((f) => !f.demo).slice(-1)[0] || null;
  if (!demoPlaying) renderLiveEvent(latest);
  renderBots("bots", d.bots);
  renderBots("bots-page", d.bots);
  renderTraders("copy-grid", d.traders);
  renderTraders("agents-wallets", d.traders);
  const s = d.session || {};
  document.getElementById("session-counts").textContent =
    `${s.seen ?? 0} vistos · ${s.copied ?? 0} copiados · ${s.rejected ?? 0} rechazados`;
  document.getElementById("activity-summary").textContent =
    `${s.seen ?? 0} vistos · ${s.copied ?? 0} copiados · ${s.rejected ?? 0} rechazados`;
  const empty = "Todavía no hay trades ni decisiones. El monitor no ha escrito fills.";
  renderActivity("activity", d.activity, empty);
  renderActivity("activity-page", d.activity, empty);
  renderAccount(d);
}

async function load() {
  try {
    const r = await fetch("data/data.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("http " + r.status);
    data = await r.json();
  } catch (e) {
    if (data === START) {
      data = { ...START, note: "No se pudo leer data/data.json. Se muestra el capital de partida (500 USDC)." };
    }
  }
  render(data);
  processFills(data.fills || []);
}

function showTab(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("view-active"));
  const view = document.getElementById("view-" + name);
  if (view) view.classList.add("view-active");
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  const url = new URL(location.href);
  url.searchParams.set("tab", name);
  history.replaceState(null, "", url);
  window.scrollTo(0, 0);
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => showTab(t.dataset.tab));
  });
  document.querySelectorAll(".ranges button").forEach((b) => {
    b.addEventListener("click", () => {
      range = b.dataset.range;
      document.querySelectorAll(".ranges button").forEach((x) => x.classList.toggle("active", x === b));
      renderChart(data);
    });
  });
  const q = new URLSearchParams(location.search).get("tab");
  if (q && document.getElementById("view-" + q)) showTab(q);
}

function isShot() { return new URLSearchParams(location.search).has("shot"); }
function isTest() { return new URLSearchParams(location.search).has("test"); }

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || window.navigator.standalone === true;
}

function hideInstallHint(persist) {
  const hint = document.getElementById("install-hint");
  if (!hint) return;
  hint.classList.remove("is-open");
  hint.hidden = true;
  hint.setAttribute("hidden", "");
  document.body.classList.remove("has-hint");
  if (persist) {
    try { localStorage.setItem("copybot-hint-dismissed", "1"); } catch {}
  }
}

function showInstallHint() {
  if (isStandalone() || isShot()) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem("copybot-hint-dismissed") === "1"; } catch {}
  if (dismissed) return;
  const hint = document.getElementById("install-hint");
  hint.hidden = false;
  hint.removeAttribute("hidden");
  hint.classList.add("is-open");
  document.body.classList.add("has-hint");
}

function setupInstall() {
  const hint = document.getElementById("install-hint");
  const btn = document.getElementById("install-btn");
  if (isStandalone()) {
    hideInstallHint(false);
    return;
  }
  showInstallHint();
  const dismiss = document.getElementById("hint-dismiss");
  const hide = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    hideInstallHint(true);
  };
  ["click", "pointerup", "touchend"].forEach((ev) => {
    dismiss.addEventListener(ev, hide, ev === "touchend" ? { passive: false } : false);
  });
  document.getElementById("hint-how").addEventListener("click", (e) => {
    e.preventDefault();
    hideInstallHint(false);
    showTab("account");
    document.getElementById("install-card").scrollIntoView({ behavior: "smooth" });
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btn) btn.hidden = false;
    showInstallHint();
  });
  if (btn) {
    btn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.hidden = true;
    });
  }
}

let demoPlaying = false;
const DEMO_SEQ = [
  { type: "buy", symbol: "DEMO", usd: 40, pnl_pct: 0, trader: "frank", equityDelta: 0 },
  { type: "tp_partial", symbol: "DEMO", usd: 25, pnl_pct: 25, trader: "Unipcs", equityDelta: 20 },
  { type: "stop_loss", symbol: "DEMO", usd: 35.2, pnl_pct: -12, trader: "Decu", equityDelta: -15 },
];

function setupDemo() {
  const btn = document.getElementById("demo-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (demoPlaying) return;
    const startEq = Number(data.equity) || 500;
    const now0 = Date.now();
    const demoStartT = now0 - 14 * 60 * 1000;
    const demoTimes = [now0 - 10 * 60 * 1000, now0 - 5 * 60 * 1000, now0 - 12 * 1000];
    const basePoints = (data.equity_points || [])
      .map((p) => ({ ...p, t: typeof p.t === "number" ? p.t : parseTime(p.t) }))
      .filter((p) => p.t != null && p.t <= demoStartT);
    demoPlaying = true;
    demoState = {
      equity: startEq,
      points: basePoints.concat([{ t: demoStartT, v: startEq, source: "demo-start" }]),
      ticks: [],
      fills: [],
      times: demoTimes,
    };
    btn.disabled = true;
    document.body.classList.add("demo-on");
    showTab("home");
    renderHero(data, { tween: false });
    renderChart(data);
    let i = 0;
    const tick = () => {
      if (i >= DEMO_SEQ.length) {
        setTimeout(() => {
          demoState.equity = startEq;
          renderHero(data, { tween: true });
          setTimeout(() => {
            demoState = null;
            demoPlaying = false;
            document.body.classList.remove("demo-on");
            btn.disabled = false;
            renderHero(data, { tween: true });
            renderChart(data);
            const latest = (data.latest_fill && !data.latest_fill.demo)
              ? data.latest_fill
              : (data.fills || []).filter((f) => !f.demo).slice(-1)[0] || null;
            renderLiveEvent(latest);
          }, 900);
        }, 1400);
        return;
      }
      const step = DEMO_SEQ[i];
      const t = (demoState.times && demoState.times[i]) || Date.now();
      demoState.equity = startEq + DEMO_SEQ.slice(0, i + 1).reduce((s, x) => s + x.equityDelta, 0);
      const fill = {
        ...step,
        demo: true,
        ts: t,
        equity: demoState.equity,
        id: "demo|" + i + "|" + t,
      };
      demoState.fills = (demoState.fills || []).concat([fill]);
      demoState.ticks = (demoState.ticks || []).concat([{ t, v: demoState.equity, source: "demo" }]);
      showToast(fill, { demo: true });
      renderLiveEvent(fill, { demo: true });
      renderHero(data, { tween: true });
      renderChart(data);
      vibrateFor([fill]);
      i += 1;
      setTimeout(tick, 1300);
    };
    tick();
  });
}

function pushLiveTick() {
  if (demoPlaying) return;
  const v = Number(data && data.equity);
  if (!Number.isFinite(v)) return;
  const now = Date.now();
  const last = liveTicks[liveTicks.length - 1];
  if (last && now - (typeof last.t === "number" ? last.t : parseTime(last.t)) < 8000) return;
  liveTicks.push({ t: now, v, source: "live-tick" });
  const keep = 8 * 24 * 3600e3;
  liveTicks = liveTicks.filter((p) => now - (typeof p.t === "number" ? p.t : parseTime(p.t) || 0) < keep);
  renderChart(data);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { if (!isShot() && !isTest()) navigator.serviceWorker.register("sw.js"); });
}

setupTabs();
setupInstall();
setupDemo();
load().then(() => {
  pushLiveTick();
});
setInterval(load, REFRESH_MS);
setInterval(pushLiveTick, 10000);

if (isTest()) {
  window.__copybotTest = {
    showToast,
    dismissToast,
    currentEquity: () => currentEquity(data),
    displayed: () => displayedEquity,
    demoOn: () => !!demoState,
  };
}
