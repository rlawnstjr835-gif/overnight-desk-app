/* Overnight Desk iPhone app (STEP 10). Plan B: polls JSON under d/{DATA_PATH}/ every 15 s.
   The data path comes from #d= once and lives in localStorage. Every FOMO link is a coin_url/profile_url
   produced by links.py on the desk (inside the JSON); this file never builds a FOMO URL. */
(function () {
  "use strict";
  const LS_KEY = "overnight_desk_data_path";
  const PATH_RE = /^[A-Za-z0-9_-]{32,128}$/;
  const POLL_MS = 15000, SCREEN_MS = 15000;
  const COLORS = { Scanner: "#64d2ff", Analyst: "#ffd60a", Brain: "#bf5af2", Executor: "#00d35a", Risk: "#ff6b9a" };
  const BOTS = ["Scanner", "Analyst", "Brain", "Executor", "Risk"];
  const LAYERS = ["Mint authority", "Freeze authority", "Dev wallet", "Top 10", "Liquidity", "Pool age", "Bundles", "Delegations"];
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const S = { path: null, state: null, chart: null, activity: null, bots: null, settings: null, range: "LIVE",
              lastOk: 0, fails: 0, retryAt: 0, buf: 0, base: null };

  const esc = (s) => String(s ?? "").replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  const fin = (x) => typeof x === "number" && Number.isFinite(x);
  function money(n, sign) {
    if (!fin(n)) return "–";
    const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? "-$" : sign ? "+$" : "$") + s;
  }
  function pct(n) { return fin(n) ? (n >= 0 ? "+" : "") + n.toFixed(2) + "%" : "–"; }
  function price(p) {
    if (!fin(p)) return "–";
    if (p >= 1) return "$" + p.toFixed(4);
    const z = Math.max(2, -Math.floor(Math.log10(p)) + 3);
    return "$" + p.toFixed(Math.min(z, 12));
  }
  function usdK(n) { if (!fin(n)) return "–"; return n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(0); }
  function hhmm(ts) { if (!ts) return ""; const d = new Date(ts * 1000); return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }); }
  function fomoLink(url, label) { return url ? `<a class="fomo" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || "Open on FOMO")}</a>` : ""; }
  function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 1800); }

  /* ---------- data path (plan B) */
  function pathFrom(str) {
    if (!str) return null;
    const i = str.indexOf("#");
    const h = i >= 0 ? str.slice(i + 1) : str;
    const m = /(?:^|[&?])d=([A-Za-z0-9_-]+)/.exec(h);
    const d = m ? m[1] : (PATH_RE.test(h) ? h : null);
    return d && PATH_RE.test(d) ? d : null;
  }
  function resolvePath() {
    const fromHash = pathFrom(location.hash);
    if (fromHash) {
      try { localStorage.setItem(LS_KEY, fromHash); } catch (e) {}
      history.replaceState(null, "", location.pathname + location.search);   // the secret leaves the address bar
      return fromHash;
    }
    try { const s = localStorage.getItem(LS_KEY); if (s && PATH_RE.test(s)) return s; } catch (e) {}
    return null;
  }
  const base = () => S.base || new URL("d/" + S.path + "/", new URL(".", location.href)).href;
  async function getJSON(name) {
    const r = await fetch(base() + name + (name.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  /* ---------- odometer: changed digits roll 600 ms ease-out, 30 ms stagger */
  function odometer(el, text) {
    if (reduced || !el.dataset.v || el.dataset.v.length !== text.length) {
      el.innerHTML = [...text].map((c) => /\d/.test(c) ? `<span class="d"><span class="col"><span>${c}</span></span></span>` : `<span>${esc(c)}</span>`).join("");
      el.dataset.v = text; return;
    }
    const old = el.dataset.v; el.dataset.v = text;
    const cells = el.children; let k = 0;
    [...text].forEach((c, i) => {
      if (c === old[i] || !/\d/.test(c) || !cells[i] || !cells[i].classList.contains("d")) { if (cells[i] && !cells[i].classList.contains("d")) cells[i].textContent = c; return; }
      const col = cells[i].firstChild, from = +old[i], to = +c;
      const seq = []; for (let n = from; ; n = (n + 1) % 10) { seq.push(n); if (n === to) break; }
      col.style.transition = "none"; col.innerHTML = seq.map((n) => `<span>${n}</span>`).join(""); col.style.transform = "translateY(0)";
      void col.offsetHeight;
      col.style.transition = `transform 600ms cubic-bezier(.2,.8,.2,1) ${k++ * 30}ms`;
      col.style.transform = `translateY(-${(seq.length - 1) * 1.08}em)`;
      setTimeout(() => { col.style.transition = "none"; col.innerHTML = `<span>${to}</span>`; col.style.transform = "none"; }, 650 + k * 30);
    });
  }

  /* ---------- states */
  function setOffline(on) {
    const el = $("offline");
    if (!on) { el.hidden = true; return; }
    const n = Math.max(0, Math.round((S.retryAt - Date.now()) / 1000));
    el.textContent = `Desk offline · retrying in ${n}s · last update ${S.lastOk ? hhmm(S.lastOk / 1000) : "never"}`;
    el.hidden = false;
  }
  setInterval(() => { if (!$("offline").hidden) setOffline(true); }, 1000);

  /* ---------- HOME */
  function renderHome() {
    const st = S.state; if (!st) return;
    $("paper-badge").hidden = st.mode === "LIVE";
    odometer($("balance"), money(st.balance));
    const t = $("today"); t.textContent = pct(st.today_pct); t.classList.toggle("neg", fin(st.today_pct) && st.today_pct < 0);
    $("mult").textContent = fin(st.multiplier) ? st.multiplier.toFixed(2) + "×" : "–"; $("mult").hidden = false;
    const m = $("market"); m.hidden = false; m.textContent = (st.market && st.market.text) || "Green market"; m.classList.toggle("red", st.market && st.market.color === "red");
    $("example-tag").hidden = !st.example;
    $("bell-dot").hidden = !(S.activity && S.activity.rows && S.activity.rows.length && S.activity.rows[0].ts > (+localStorage.getItem("desk_seen") || 0));
    renderChart(); renderLive(); renderCarousel();
    const rows = (S.activity && S.activity.rows) || [];
    $("home-activity").innerHTML = rows.length ? rows.slice(0, 5).map(rowHTML).join("") : `<div class="empty">Nothing yet tonight</div>`;
  }
  function chartView() {
    const c = S.chart || {}; const now = Date.now() / 1000;
    const win = { "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800 }[S.range];
    if (S.range === "LIVE") return { points: c.points || [], start: c.start, marks: c.marks || [] };
    let pts = (c.all || []).slice();
    if (win) pts = pts.filter((p) => p.t >= now - win);
    if (pts.length === 1) pts = [{ t: now - (win || 3600), y: pts[0].y }, pts[0]];
    return { points: pts, start: pts.length ? pts[0].y : c.start, marks: (c.marks || []).filter((mk) => !win || mk.t >= now - win) };
  }
  function renderChart() {
    const v = chartView();
    const map = window.DeskChart.drawLine($("chart"), v.points, fin(v.start) ? v.start : 0);
    const hasTrades = (v.marks || []).length > 0;
    $("chart-empty").hidden = hasTrades || !(S.state);
    const box = $("chart-marks"); box.innerHTML = "";
    if (!map) return;
    const placed = []; // a later mark moves up a row, never overlaps
    (v.marks || []).forEach((mk) => {
      const x = map.X(mk.t), w = 14 + 6.6 * String(mk.text).length, hgt = 18;
      const cx = Math.min(map.w - w / 2 - 2, Math.max(w / 2 + 2, x));
      let y = map.Y(mk.y) - 8;
      const hit = (yy) => placed.some((r) => Math.abs(r.x - cx) < (r.w + w) / 2 + 2 && Math.abs(r.y - yy) < hgt + 2);
      let guard = 0; while (hit(y) && guard++ < 12) y -= hgt + 2;
      if (y < 18) { y = map.Y(mk.y) + 26; guard = 0; while (hit(y) && guard++ < 12) y += hgt + 2; }
      placed.push({ x: cx, y, w });
      const el = document.createElement("div"); el.className = "mark " + mk.kind; el.textContent = mk.text;
      el.style.left = cx + "px"; el.style.top = y + "px";
      box.appendChild(el);
    });
  }
  function renderLive() {
    const L = (S.state && S.state.live) || {};
    const age = L.frame_ts ? Date.now() / 1000 - L.frame_ts : Infinity;
    $("live-dot").classList.toggle("hot", age < 5);
    $("live-label").textContent = L.paused ? "Paused · private" : age < 5 ? "Live · Bot's computer" : L.frame_ts ? "Last frame " + hhmm(L.frame_ts) : "Last frame";
    const lane = $("live-lane");
    if (L.lane) { const bot = L.lane.split(" ")[0]; lane.textContent = L.lane; lane.style.color = COLORS[bot] || "#fff"; }
    else { lane.textContent = "Idle"; lane.style.color = ""; }
    const lo = $("live-order");
    if (L.last_order) {
      const ck = L.last_order.checks || {};
      const c = (k) => `<span class="chk ${ck[k] === true ? "ok" : ck[k] === false ? "no" : ""}">${k}${ck[k] === true ? " ✓" : ck[k] === false ? " ✕" : " n/a"}</span>`;
      lo.innerHTML = `<span>${esc(L.last_order.text)}</span><span class="checks">${c("screen")}${c("api")}${c("chain")}</span>`;
      lo.hidden = false;
    } else lo.hidden = true;
  }
  /* double-buffered frame: load into the hidden <img>, swap only when it has decoded */
  function refreshScreen() {
    if (!S.path && !S.base) return;
    const next = S.buf ? $("live-a") : $("live-b"), cur = S.buf ? $("live-b") : $("live-a");
    const img = new Image();
    img.onload = () => { next.src = img.src; next.classList.add("show"); cur.classList.remove("show"); S.buf ^= 1; $("live-ph").hidden = true; $("viewer-img").src = img.src; };
    img.onerror = () => {};
    img.src = base() + "screen.jpg?t=" + Date.now();
  }
  function botCard(name) {
    const b = (S.bots && S.bots[name]) || { feed: [] }; const col = COLORS[name];
    let body = "";
    const feed = (n) => `<div class="feed">${(b.feed || []).slice(0, n).map((d) => d.ok ? `<div class="pass"><b>${esc(d.symbol)}</b> ${esc(d.text)}</div>` : `<div class="kill"><b>${esc(d.symbol)}</b> · ${esc(d.text)}</div>`).join("") || `<div>Waiting…</div>`}</div>`;
    if (name === "Scanner") body = feed(4);
    if (name === "Analyst") {
      const L = b.layers || [];
      body = `<div class="ring-row">${window.DeskChart.ring(b.score)}<div style="flex:1"><div class="strips">${LAYERS.map((_, i) => `<i class="strip ${L[i] === true ? "g" : L[i] === false ? "r" : ""}"></i>`).join("")}</div>` +
        `<div>${fin(b.social) && b.social ? "Social +" + b.social : "Social: off"}</div></div></div>`;
    }
    if (name === "Brain") body = `<div class="big">${fin(b.size) ? money(b.size) + " · " + (b.pct || 0).toFixed(1) + "% of cash" : "–"}</div><div>${esc(b.rule || "80+ = full size")} · under 80 = half size</div>`;
    if (name === "Executor") body = `<div class="bar">${esc(b.bar || "Idle")}</div>`;
    if (name === "Risk") body = `<div class="pills"><span class="pill mono redp">stop -${b.stop_pct ?? 25}%</span><span class="pill mono greenp">trail ${b.trail_pct ?? 40}%</span></div>`;
    return `<div class="bc"><div class="bc-h"><i class="sw" style="background:${col}"></i>${name}<span class="cnt">${esc(b.label || "")}</span></div><div class="bc-body">${body}</div></div>`;
  }
  function renderCarousel() {
    const run = BOTS.filter((n) => S.bots && S.bots[n] && S.bots[n].running).length;
    $("bots-running").textContent = `Bots · ${run} running`;
    $("carousel").innerHTML = BOTS.map(botCard).join("");
  }
  function rowHTML(r) {
    const icon = { bought: "B", copied: "C", sold: "S", stopped: "!", rejected: "×" }[r.kind] || "•";
    const v = String(r.value || "");
    const cls = r.kind === "sold" ? "pos" : r.kind === "stopped" ? "neg" : r.kind === "rejected" ? "mut" : "";
    return `<div class="row" data-open="${esc(r.open)}" data-mint="${esc(r.mint)}"><div class="ri ${esc(r.kind)}">${icon}</div>` +
      `<div class="rt"><b>${esc(r.title)}</b><small>${esc(r.subtitle)} · ${hhmm(r.ts)}</small></div>` +
      `<div class="rv"><span class="${cls}">${esc(v)}</span><small>${fomoLink(r.coin_url)}</small></div></div>`;
  }

  /* ---------- BOTS TAB */
  function renderBots() {
    $("bots-list").innerHTML = BOTS.map((name) => {
      const b = (S.bots && S.bots[name]) || { feed: [] };
      const locked = name === "Risk" && b.locked;
      return `<div class="bt"><div class="bt-h"><i class="sdot ${b.running ? "on" : ""}"></i><b style="color:${COLORS[name]}">${name}</b>` +
        `<span class="today2">${esc(b.label || "")}</span><button class="switch ${b.paused ? "" : "on"} ${locked ? "locked" : ""}" data-pause="${name}" aria-label="Pause ${name}"></button></div>` +
        `<div style="margin-top:8px">${(b.feed || []).slice(0, 20).map((d) => `<div class="dec"><span class="t">${hhmm(d.ts)}</span><span class="s"><b style="color:#fff;font-weight:500">${esc(d.symbol || "")}</b> ${esc(d.text)}</span>${fomoLink(d.coin_url, "FOMO")}</div>`).join("") || `<div class="empty" style="padding:12px 0">No decisions yet tonight</div>`}</div>` +
        `<div class="more"><button class="link" data-settings="${name.toLowerCase()}">Settings</button></div></div>`;
    }).join("");
  }

  /* ---------- ACTIVITY TAB */
  function renderActivity() {
    const rows = (S.activity && S.activity.rows) || [];
    $("activity-list").innerHTML = rows.length ? rows.map(rowHTML).join("") : `<div class="empty">Nothing yet tonight</div>`;
    if (rows.length) try { localStorage.setItem("desk_seen", String(rows[0].ts)); } catch (e) {}
  }

  /* ---------- COPY PICKS (cards: Profile, last buy, Copy on desk switch; the last 7 lists) */
  function picksHTML(p) {
    const cards = p.cards || [];
    const ok = (u) => typeof u === "string" && /^https:\/\/fomo\.family\//.test(u);
    let h = `<div class="group" id="picks-cards">`;
    if (!cards.length) h += `<div class="cell">No picks list yet<span class="v">${p.step15 ? "" : "STEP 15 first"}</span></div>`;
    cards.forEach((c) => {
      const sw = p.step15 ? `<button class="sw ${c.copy_on ? "on" : ""}" data-copy="/copy ${c.copy_on ? "off" : "on"} @${esc(c.handle)}" aria-label="Copy on desk"></button>`
                          : `<span class="v">copy after STEP 15</span>`;
      h += `<div class="cell pick"><div><b>#${esc(c.rank)} @${esc(c.handle)}</b><div class="note">7d ${money(c.pnl_7d)} · 30d ${money(c.pnl_30d)} · ${esc(c.trades || 0)} trades</div>` +
        `<div>${ok(c.profile) ? `<a class="link" href="${esc(c.profile)}" target="_blank" rel="noopener noreferrer">Profile</a>` : ""}` +
        `${ok(c.last_buy) ? ` · <a class="link" href="${esc(c.last_buy)}" target="_blank" rel="noopener noreferrer">Last buy</a>` : ""}</div></div>` +
        `<div class="cell-r">Copy on desk ${sw}</div></div>`;
    });
    h += `</div>`;
    const l7 = p.last7 || [];
    if (l7.length) h += `<div class="gt">Last 7 lists</div><div class="group">` + l7.map((l) =>
      `<div class="cell"><span>${esc(new Date(l.ts * 1000).toLocaleDateString("ko-KR", {timeZone: "Asia/Seoul"}))}</span><span class="v">${(l.handles || []).map((x) => "@" + esc(x.handle)).join(" · ")}</span></div>`).join("") + `</div>`;
    return h;
  }

  /* ---------- ACCOUNT TAB */
  function renderAccount() {
    const st = S.state || {}; const g = (S.settings && S.settings.groups) || [];
    const n = st.notifier || {};
    const cmd = (c) => `<button class="link" data-copy="${esc(c)}">Copy “${esc(c)}”</button>`;
    let h = `<div class="gt">Mode</div><p class="warn">LIVE trades real cash on FOMO. New coins can go to 0 in minutes. Only put in what you can lose.</p><div class="group"><div class="cell">Desk<div class="seg"><button data-mode="PAPER" class="${st.mode !== "LIVE" ? "on" : ""}">PAPER</button><button data-mode="LIVE" class="${st.mode === "LIVE" ? "on" : ""}">LIVE</button></div></div>` +
      `<div class="cell">Cash<span class="v">${money(st.cash)}</span></div></div>` +
      `<p class="note">PAPER until STEP 15 passes. Plan B: changes go through Telegram; LIVE needs you to type LIVE there.</p>` +
      `<div class="group">` +
      (st.profile_url ? `<a class="cell" href="${esc(st.profile_url)}" target="_blank" rel="noopener noreferrer">Your FOMO profile<span class="v">›</span></a>` : "") +
      `<button class="cell" style="width:100%" id="invite">Invite a friend<span class="v">›</span></button></div>` +
      `<div class="gt">Pushes</div><div class="group"><div class="cell">Telegram<span class="v ${n.telegram ? "pos" : ""}">${n.telegram ? "connected" : "not connected"}</span></div>` +
      `<div class="cell">Web push<span class="v">plan B: Telegram only</span></div>` +
      `<div class="cell"><button class="link" data-copy="/status">Send test push</button><span class="v">sends /status in Telegram</span></div></div>` +
      `<div class="gt">Copy picks</div><div class="group"><div class="cell">Every<div class="seg">${["off", "24h", "12h", "6h"].map((e) => `<button class="${(st.picks || {}).every === e ? "on" : ""}" data-copy="/set picks.every to ${e}">${e}</button>`).join("")}</div></div>` +
      `<div class="cell">Time<span class="v">${esc((st.picks || {}).time || "21:30")}</span></div></div>` +
      picksHTML(st.picks || {}) +
      `<div class="gt">Vault</div><div class="group"><div class="cell">Vault<span class="v">${((st.vault || {}).mode || "files") === "files" ? "files · not on iPhone" : "plugin" + ((st.vault || {}).status ? " · " + esc(st.vault.status) : "")}</span></div></div>`;
    g.filter((x) => x.name !== "desk" || true).forEach((grp) => {
      h += `<div class="gt" id="set-${esc(grp.name)}">${esc(grp.name[0].toUpperCase() + grp.name.slice(1))}</div><div class="group">` +
        grp.items.map((it) => {
          const short = it.key.split(".")[1];
          const lab = (ctl) => `<div class="setting" data-set="${esc(it.key)}"><div class="lab"><span class="k">${esc(short)}</span>${ctl}</div>`;
          if ((it.kind === "float" || it.kind === "int") && fin(it.min) && fin(it.max)) {
            const step = it.kind === "int" ? 1 : (it.max - it.min) > 100 ? 1 : (it.max - it.min) > 10 ? 0.1 : 0.05;
            return lab(`<input type="number" inputmode="decimal" value="${esc(it.value)}" min="${it.min}" max="${it.max}" step="${step}" data-key="${esc(it.key)}" data-kind="${it.kind}">`) +
              `<input type="range" min="${it.min}" max="${it.max}" step="${step}" value="${esc(it.value)}" data-key="${esc(it.key)}" data-kind="${it.kind}">` +
              `<div class="rng"><span>${esc(it.min)}</span><span>${esc(it.max)}</span></div></div>`;
          }
          if (it.kind === "choice" && it.key !== "desk.mode")
            return lab(`<div class="seg">${(it.choices || []).map((c) => `<button class="${String(it.value) === c ? "on" : ""}" data-copy="/set ${esc(it.key)} to ${esc(c)}">${esc(c)}</button>`).join("")}</div>`) + `</div>`;
          if (it.kind === "bool")
            return lab(`<button class="sw ${it.value ? "on" : ""}" data-copy="/set ${esc(it.key)} to ${it.value ? "false" : "true"}" aria-label="${esc(short)}"></button>`) + `</div>`;
          if (it.kind === "time")
            return lab(`<input type="time" value="${esc(it.value)}" data-key="${esc(it.key)}" data-kind="time">`) + `</div>`;
          return lab(`<span class="mut" style="font-family:var(--mono);font-size:13px">${esc(it.value === "" ? "not set" : it.value)}</span>`) + `</div>`;
        }).join("") + `</div>`;
    });
    h += `<div class="gt">Watch</div><div class="group"><div class="cell">Watch in Grok Bot<span class="v">ask Grok Bot for a computer preview</span></div></div>`;
    $("account").innerHTML = h;
  }

  /* ---------- COIN + AUDIT screens */
  function openScreen(id, html) { const el = $(id); el.innerHTML = `<button class="back" data-back="${id}">‹ Back</button>` + html; el.hidden = false; el.scrollTop = 0; }
  async function openCoin(mint) {
    openScreen("screen-coin", `<div class="empty">Loading…</div>`);
    let c; try { c = await getJSON("coin/" + mint + ".json"); } catch (e) { openScreen("screen-coin", e.message === "404" ? `<div class="empty">No data for this coin yet</div>` : `<div class="empty err">Can't reach the desk data · go back and try again</div>`); return; }
    const paper = !S.state || S.state.mode !== "LIVE";
    const age = fin(c.age_h) ? (c.age_h < 1 ? Math.round(c.age_h * 60) + "m old" : Math.round(c.age_h) + "h old") : "";
    const sh = c.shield ? `<span class="shield ${c.shield === "8/8" ? "" : "bad"}">🛡 ${esc(c.shield)}</span>` : "";
    const pos = c.position;
    openScreen("screen-coin",
      `<div class="coin-h"><h1>${esc(c.name || c.symbol)}</h1>${sh}${paper ? `<span class="pill paper">PAPER</span>` : ""}</div>` +
      `<div class="coin-sub">${esc(c.symbol)} · Solana${age ? " · " + age : ""}</div>` +
      `<div class="price num">${price(c.price)}</div>` +
      `<div class="${fin(c.since_entry_pct) && c.since_entry_pct < 0 ? "neg" : "pos"}" style="font-weight:600">${fin(c.since_entry_pct) ? (c.since_entry_pct >= 0 ? "▲ " : "▼ ") + Math.abs(c.since_entry_pct).toFixed(1) + "% since entry" : ""}</div>` +
      `<canvas class="candles" id="coin-candles"></canvas><div id="coin-nocandles" class="empty" hidden>No 1-minute prices yet</div>` +
      `<div class="stats"><div class="stat"><small>Market cap</small><b>${usdK(c.market_cap)}</b></div><div class="stat"><small>Liquidity</small><b>${usdK(c.liquidity)}</b></div><div class="stat"><small>Holders</small><b>${fin(c.holders) ? c.holders.toLocaleString() : "–"}</b></div></div>` +
      (pos ? `<div class="list"><div class="row"><div class="rt"><b>Your position · ${money(pos.size_usd)} in · ${esc(pos.bot)}</b><small>${pos.open ? "open" : "closed · " + esc(pos.exit_reason || "") + " · " + money(pos.pnl_usd, true)}</small></div></div></div>` : "") +
      `<div class="btns"><a class="btn primary" href="${esc(c.coin_url)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` +
      (pos && pos.open ? `<button class="btn red" data-sell="${esc(c.mint)}" data-sym="${esc(c.symbol)}">Sell now</button>` : "") + `</div>`);
    requestAnimationFrame(() => { const ok = window.DeskChart.drawCandles($("coin-candles"), c.candles, c.exit_line); $("coin-nocandles").hidden = ok; $("coin-candles").hidden = !ok; });
  }
  async function openAudit(mint) {
    openScreen("screen-audit", `<div class="empty">Loading…</div>`);
    let a; try { a = await getJSON("audit/" + mint + ".json"); } catch (e) { openScreen("screen-audit", e.message === "404" ? `<div class="empty">No audit for this coin</div>` : `<div class="empty err">Can't reach the desk data · go back and try again</div>`); return; }
    const L = LAYERS.map((name, i) => (a.layers || []).find((x) => x.n === i + 1) || { n: i + 1, name, value: "not checked", pass: null });
    openScreen("screen-audit",
      `<div class="coin-h"><h1>${esc(a.symbol)}</h1>${fin(a.score) ? `<span class="pill">score ${a.score}</span>` : ""}</div>` +
      `<div class="coin-sub">${esc(a.reason || "")}</div>` +
      `<div class="discs">${L.map((x, i) => `<div class="disc"><div class="c" data-i="${i}" data-p="${x.pass === true ? "g" : x.pass === false ? "r" : ""}">${i + 1}</div><b>${esc(x.value)}</b><small>${esc(x.name)}</small></div>`).join("")}</div>` +
      `<div class="social">${a.social ? "Social +" + a.social.pts + (fin(a.social.u15) ? ` · ${a.social.u15} accounts in 15m` : "") + (fin(a.social.smart) ? ` · ${a.social.smart} top traders hold` : "") : "Social: off"}</div>` +
      `<div class="btns"><a class="btn primary" href="${esc(a.coin_url)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a></div>`);
    // cyan beam reads each layer, then green check or red
    const discs = [...document.querySelectorAll("#screen-audit .disc .c")];
    discs.forEach((d, i) => setTimeout(() => {
      d.classList.add("scan");
      setTimeout(() => { d.classList.remove("scan"); const p = d.dataset.p; if (p) { d.classList.add(p); d.textContent = p === "g" ? "✓" : "✕"; } }, reduced ? 0 : 520);
    }, reduced ? 0 : i * 420));
  }
  function sellSheet(mint, sym) {
    let part = 100;
    const draw = () => {
      $("sheet").innerHTML = `<h3>Sell ${esc(sym)}</h3><div class="opts">${[25, 50, 100].map((p) => `<button class="${p === part ? "on" : ""}" data-part="${p}">${p}%</button>`).join("")}</div>` +
        `<div class="cmd">/sell ${esc(sym)} ${part}</div><button class="btn red full" data-confirm-sell>Confirm sell</button>` +
        `<p class="note" style="margin:10px 0 0;padding:0">Plan B: copies the command for Telegram; the desk asks “Sell ${part}% of ${esc(sym)} now?”, you answer yes, Executor clicks it.</p>`;
    };
    draw(); $("sheet").hidden = false; $("sheet-bg").hidden = false;
    $("sheet").onclick = (e) => {
      const b = e.target.closest("[data-part]"); if (b) { part = +b.dataset.part; draw(); return; }
      if (e.target.closest("[data-confirm-sell]")) { copy(`/sell ${sym} ${part}`); closeSheet(); }
    };
  }
  function closeSheet() { $("sheet").hidden = true; $("sheet-bg").hidden = true; }
  function copy(text) {
    const done = () => toast("Copied · paste it in Telegram");
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
  }

  /* ---------- polling */
  async function poll() {
    try {
      const [st, ch, ac, bt, se] = await Promise.all([getJSON("state.json"), getJSON("chart.json"), getJSON("activity.json"), getJSON("bots.json"), getJSON("settings.json")]);
      S.state = st; S.chart = ch; S.activity = ac; S.bots = bt; S.settings = se;
      S.lastOk = Date.now(); S.fails = 0; setOffline(false);
      document.body.classList.remove("loading");
      renderAll();
    } catch (e) {
      S.fails++; S.retryAt = Date.now() + POLL_MS;
      document.body.classList.remove("loading");
      if (!S.state) renderAll();      // keep the last good numbers; never a made-up one
      setOffline(true);
    }
  }
  function renderAll() {
    if (S.state) renderHome(); else { $("chart-empty").hidden = false; $("home-activity").innerHTML = `<div class="empty">Nothing yet tonight</div>`; renderCarousel(); }
    renderBots(); renderActivity(); renderAccount();
  }

  /* ---------- events */
  function tab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + name));
    document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    window.scrollTo(0, 0);
    if (name === "activity") renderActivity();
  }
  function wire() {
    document.querySelector(".tabbar").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) tab(b.dataset.tab); });
    $("nav-avatar").onclick = () => tab("account");
    $("nav-title").onclick = () => tab("bots");
    $("nav-bell").onclick = () => tab("activity");
    $("nav-search").onclick = () => { const s = $("search-box"); s.hidden = !s.hidden; if (!s.hidden) $("search-input").focus(); };
    $("search-input").oninput = (e) => {
      const q = e.target.value.trim().toLowerCase(); const seen = new Set(); const out = [];
      ((S.activity && S.activity.rows) || []).concat((S.state && S.state.positions) || []).forEach((r) => {
        const sym = (r.symbol || (r.title || "").split(" ").slice(1).join(" ") || "").toLowerCase();
        if (q && r.mint && !seen.has(r.mint) && (sym.includes(q) || r.mint.toLowerCase().startsWith(q))) { seen.add(r.mint); out.push(r); }
      });
      $("search-results").innerHTML = out.slice(0, 8).map((r) => `<div class="row" data-open="coin" data-mint="${esc(r.mint)}"><div class="rt"><b>${esc(r.symbol || r.title)}</b><small>${esc(r.mint)}</small></div></div>`).join("") || (q ? `<div class="empty">No coin tonight matches</div>` : "");
    };
    $("ranges").onclick = (e) => { const b = e.target.closest("[data-range]"); if (!b) return; S.range = b.dataset.range; $("ranges").querySelectorAll(".range").forEach((x) => x.classList.toggle("on", x === b)); renderChart(); };
    $("live-frame").onclick = () => { if (!$("viewer-img").src) return; const u = S.state && S.state.live && S.state.live.coin_url; const a = $("viewer-fomo"); if (u) { a.href = u; a.hidden = false; } else a.hidden = true; $("screen-viewer").hidden = false; };
    $("viewer-close").onclick = () => ($("screen-viewer").hidden = true);
    $("sheet-bg").onclick = closeSheet;
    document.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      const back = e.target.closest("[data-back]"); if (back) { $(back.dataset.back).hidden = true; return; }
      const row = e.target.closest("[data-open]"); if (row && row.dataset.mint) { row.dataset.open === "audit" ? openAudit(row.dataset.mint) : openCoin(row.dataset.mint); return; }
      const sell = e.target.closest("[data-sell]"); if (sell) { sellSheet(sell.dataset.sell, sell.dataset.sym); return; }
      const cp = e.target.closest("[data-copy]"); if (cp) { copy(cp.dataset.copy.startsWith("/") ? cp.dataset.copy : "/" + cp.dataset.copy); return; }
      const md = e.target.closest("[data-mode]"); if (md) { copy(md.dataset.mode === "LIVE" ? "/live" : "/paper"); return; }
      const pz = e.target.closest("[data-pause]"); if (pz) { if (pz.classList.contains("locked")) { toast("Risk can't pause with a position open"); return; } copy(`/pause ${pz.dataset.pause}`); return; }
      const st = e.target.closest("[data-settings]"); if (st) { tab("account"); const g = $("set-" + st.dataset.settings); if (g) g.scrollIntoView(); return; }
      if (e.target.closest("#invite")) {
        const u = S.state && S.state.signup_url; if (!u) return;
        if (navigator.share) navigator.share({ title: "FOMO", url: u }).catch(() => {});
        else if (navigator.clipboard) navigator.clipboard.writeText(u).then(() => toast("Link copied"), () => toast("Link copied"));
      }
    });
    document.addEventListener("input", (e) => {
      const k = e.target.dataset && e.target.dataset.key; if (!k) return;
      document.querySelectorAll(`[data-key="${k}"]`).forEach((x) => { if (x !== e.target) x.value = e.target.value; });
    });
    document.addEventListener("change", (e) => {
      const el = e.target, k = el.dataset && el.dataset.key; if (!k) return;
      if (el.dataset.kind === "time") { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(el.value)) { toast("Use HH:MM"); return; } copy(`/set ${k} to ${el.value}`); return; }
      const v = Number(el.value), lo = Number(el.min), hi = Number(el.max);
      const bad = !Number.isFinite(v) || v < lo || v > hi || (el.dataset.kind === "int" && !Number.isInteger(v));
      if (bad) {
        toast(`Out of range: ${k.split(".")[1]} is ${lo} to ${hi}${el.dataset.kind === "int" ? ", whole numbers" : ""}`);
        const it = ((S.settings && S.settings.groups) || []).flatMap((g) => g.items).find((x) => x.key === k);
        document.querySelectorAll(`[data-key="${k}"]`).forEach((x) => { x.value = it ? it.value : x.defaultValue; x.classList.add("bad"); setTimeout(() => x.classList.remove("bad"), 1200); });
        return;
      }
      copy(`/set ${k} to ${v}`);
    });
    $("ob-go").onclick = () => {
      const p = pathFrom($("ob-input").value.trim());
      if (!p) { $("ob-err").hidden = false; return; }
      try { localStorage.setItem(LS_KEY, p); } catch (e) {}
      $("onboard").hidden = true; start(p);
    };
    window.addEventListener("resize", () => { if (S.state) renderChart(); });
  }
  let timers = [];
  function start(path) {
    S.path = path; timers.forEach(clearInterval);
    poll(); refreshScreen();
    timers = [setInterval(poll, POLL_MS), setInterval(refreshScreen, SCREEN_MS)];
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { poll(); refreshScreen(); } });
  }
  function init() {
    wire();
    const q = new URLSearchParams(location.search);
    if (q.get("data")) { S.base = new URL(q.get("data"), location.href).href; start("local"); }   // local preview / screenshots only
    else {
      const p = resolvePath();
      if (p) start(p);
      else { document.body.classList.remove("loading"); $("onboard").hidden = false; }
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
