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

const AVATAR_COLORS = {
  frank: "#2f6df6",
  Unipcs: "#7c5cff",
  Decu: "#e05a2b",
};

let data = START;
let range = "1D";
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

function renderHero(d) {
  document.getElementById("balance").textContent = money(d.equity);
  const mul = document.getElementById("multiplier");
  mul.textContent = (d.multiplier != null ? Number(d.multiplier).toFixed(2) : "1.00") + "x";
  mul.className = "multiplier" + (d.multiplier > 1 ? " up" : d.multiplier < 1 ? " down" : "");
  const pill = document.getElementById("pnl-pill");
  pill.textContent = pct(d.pnl_pct);
  pill.className = "pnl-pill " + (d.pnl_pct < 0 ? "neg" : "pos");
  const usd = document.getElementById("pnl-usd");
  const abs = money(Math.abs(d.pnl_usd ?? 0));
  usd.textContent = (d.pnl_usd < 0 ? "−" : "+") + abs;
}

function parseTime(t) {
  if (!t) return null;
  const s = String(t);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  const naive = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isNaN(naive.getTime()) ? null : naive.getTime();
}

function pointsForRange(points, key) {
  const pts = (points || [])
    .map((p) => ({ t: parseTime(p.t), v: Number(p.v), source: p.source }))
    .filter((p) => p.t != null && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  const now = Date.now();
  const span = { "1H": 3600e3, "4H": 4 * 3600e3, "1D": 24 * 3600e3, "1W": 7 * 24 * 3600e3, "ALL": 24 * 3600e3 }[key] || 24 * 3600e3;
  const cut = now - span;
  if (!pts.length) {
    // no equity points at all — caller may still draw an empty chart
    return [];
  }
  const last = pts[pts.length - 1];
  const inRange = pts.filter((p) => p.t >= cut);
  const before = [...pts].reverse().find((p) => p.t < cut);
  let out = before ? [{ ...before, t: cut }, ...inRange] : inRange.slice();
  if (!out.length) out = [{ t: cut, v: last.v, source: last.source }];
  if (out[out.length - 1].t < now - 500) {
    out.push({ t: now, v: out[out.length - 1].v, source: out[out.length - 1].source });
  }
  const tmin = Math.min(...out.map((p) => p.t));
  const tmax = Math.max(...out.map((p) => p.t));
  // Same known equity, timestamps collapsed: draw it across the visible window (not invented history).
  if (tmax - tmin < 1000) {
    return [
      { t: cut, v: last.v, source: last.source },
      { t: now, v: last.v, source: last.source },
    ];
  }
  return out;
}

function smoothPath(pts, w, h, padX, padY) {
  if (pts.length === 1) {
    const y = padY + (h - padY * 2) / 2;
    return { d: `M ${padX} ${y} L ${w - padX} ${y}`, min: pts[0].v, max: pts[0].v, ys: [y], xs: [w / 2] };
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
  // Monotone cubic (Fritsch-Carlson) to Bezier
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
  return { d, min, max, xs: xy.map((p) => p.x), ys: xy.map((p) => p.y) };
}

function renderChart(d) {
  const svg = document.getElementById("equity-chart");
  const cap = document.getElementById("chart-empty");
  const pts = pointsForRange(d.equity_points, range);
  const w = 390, h = 188, padX = 2, padY = 14;
  if (!pts.length) {
    const y = h / 2;
    svg.innerHTML = `
      <defs>
        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#32d74b" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="#32d74b" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M ${padX} ${y} L ${w - padX} ${y} L ${w - padX} ${h} L ${padX} ${h} Z" fill="url(#eqFill)"/>
      <path d="M ${padX} ${y} L ${w - padX} ${y}" fill="none" stroke="#32d74b" stroke-width="2.4" stroke-linecap="round"/>
    `;
    cap.textContent = "Sin puntos de equity todavía";
    return;
  }
  const { d: path, ys, xs } = smoothPath(pts, w, h, padX, padY);
  const lastX = xs[xs.length - 1];
  const lastY = ys[ys.length - 1];
  const area = `${path} L ${lastX.toFixed(2)} ${h} L ${xs[0].toFixed(2)} ${h} Z`;
  svg.innerHTML = `
    <defs>
      <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#32d74b" stop-opacity="0.38"/>
        <stop offset="70%" stop-color="#32d74b" stop-opacity="0.05"/>
        <stop offset="100%" stop-color="#32d74b" stop-opacity="0"/>
      </linearGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.2" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <path d="${area}" fill="url(#eqFill)"></path>
    <path d="${path}" fill="none" stroke="#32d74b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"></path>
    <circle cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="3.4" fill="#32d74b"></circle>
  `;
  const flat = pts.every((p) => p.v === pts[0].v);
  cap.textContent = "";
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
    const color = AVATAR_COLORS[t.name] || "#444";
    const ago = t.last_activity_ago || (t.activity_error ? "actividad no verificada" : "sin dato on-chain");
    const human = t.last_activity_human || "";
    const stats = (t.copied != null) ? `${t.copied} copiados · ${t.rejected || 0} rechazados` : "";
    return `<article class="trader">
      <div class="trader-top">
        <div class="avatar" style="background:${color}">${esc(initials(t.name))}</div>
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

function render(d) {
  setStatus(d.status);
  renderHero(d);
  renderChart(d);
  const cap = document.getElementById("screen-caption");
  cap.textContent = d.screen_caption || d.built_at_human || "";
  const img = document.getElementById("live-screen");
  const src = (d.screen || "data/screen.jpg").replace(/^\//, "") + "?t=" + encodeURIComponent(d.built_at || Date.now());
  if (!img.dataset.locked) img.src = src;
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
    // Keep last good payload if we already have one; otherwise start state.
    if (data === START) {
      data = { ...START, note: "No se pudo leer data/data.json. Se muestra el capital de partida (500 USDC)." };
    }
  }
  render(data);
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

function setupInstall() {
  const hint = document.getElementById("install-hint");
  const btn = document.getElementById("install-btn");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const shot = isShot();
  const dismissed = localStorage.getItem("copybot-hint-dismissed") === "1";
  if (!standalone && !dismissed && !shot) {
    hint.hidden = false;
    document.body.classList.add("has-hint");
  }
  document.getElementById("hint-dismiss").addEventListener("click", () => {
    hint.hidden = true;
    document.body.classList.remove("has-hint");
    localStorage.setItem("copybot-hint-dismissed", "1");
  });
  document.getElementById("hint-how").addEventListener("click", () => {
    hint.hidden = true;
    showTab("account");
    document.getElementById("install-card").scrollIntoView({ behavior: "smooth" });
  });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.hidden = false;
    if (!dismissed && !standalone && !isShot()) {
      hint.hidden = false;
      document.body.classList.add("has-hint");
    }
  });
  btn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { if (!isShot()) navigator.serviceWorker.register("sw.js"); });
}

setupTabs();
setupInstall();
load();
setInterval(load, REFRESH_MS);
