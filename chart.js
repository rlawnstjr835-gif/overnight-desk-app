/* Hand-drawn <canvas> charts, devicePixelRatio aware. No library. */
(function () {
  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 360, h = canvas.clientHeight || 200;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  /* points [{t,y}], start = night-start balance. Returns {x(t), y(v)} for marks. */
  function drawLine(canvas, points, start, opts) {
    const { ctx, w, h } = setup(canvas);
    const pad = { t: 34, b: 10, l: 0, r: 0 };
    const pts = (points || []).filter((p) => Number.isFinite(p.y));
    if (pts.length < 2) return null;
    let lo = Math.min(start, ...pts.map((p) => p.y)), hi = Math.max(start, ...pts.map((p) => p.y));
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const X = (t) => pad.l + ((t - t0) / Math.max(1e-9, t1 - t0)) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    const color = (opts && opts.color) || "#00d35a";
    // dashed start line
    ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(235,235,245,0.3)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(start)); ctx.lineTo(w, Y(start)); ctx.stroke(); ctx.restore();
    // gradient under the line
    const g = ctx.createLinearGradient(0, pad.t, 0, h);
    g.addColorStop(0, color + "55"); g.addColorStop(1, color + "00");
    ctx.beginPath(); ctx.moveTo(X(pts[0].t), Y(pts[0].y));
    pts.forEach((p) => ctx.lineTo(X(p.t), Y(p.y)));
    ctx.lineTo(X(pts[pts.length - 1].t), h); ctx.lineTo(X(pts[0].t), h); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.moveTo(X(pts[0].t), Y(pts[0].y));
    pts.forEach((p) => ctx.lineTo(X(p.t), Y(p.y)));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    const last = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(X(last.t), Y(last.y), 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    return { X, Y, w, h, t0, t1 };
  }

  /* candles [{t,o,h,l,c}], exit = orange dashed line */
  function drawCandles(canvas, candles, exit) {
    const { ctx, w, h } = setup(canvas);
    const cs = (candles || []).filter((c) => Number.isFinite(c.h));
    if (!cs.length) return false;
    let lo = Math.min(...cs.map((c) => c.l)), hi = Math.max(...cs.map((c) => c.h));
    if (Number.isFinite(exit)) { lo = Math.min(lo, exit); hi = Math.max(hi, exit); }
    if (hi - lo < 1e-15) { hi *= 1.01; lo *= 0.99; }
    const pad = 12, Y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad);
    const step = w / Math.max(cs.length, 20), bw = Math.max(1.5, step * 0.6);
    cs.forEach((c, i) => {
      const x = w - (cs.length - i - 0.5) * step;
      const up = c.c >= c.o, col = up ? "#00d35a" : "#ff453a";
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
    });
    if (Number.isFinite(exit)) {
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#ff9f0a"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, Y(exit)); ctx.lineTo(w, Y(exit)); ctx.stroke(); ctx.restore();
    }
    return true;
  }

  function ring(score) {
    const s = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
    const col = s >= 70 ? "#00d35a" : "#ff453a", r = 24, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 56 56"><circle cx="28" cy="28" r="${r}" fill="none" stroke="#2c2c2e" stroke-width="5"/>` +
      `<circle cx="28" cy="28" r="${r}" fill="none" stroke="${Number.isFinite(score) ? col : "#2c2c2e"}" stroke-width="5" stroke-linecap="round" ` +
      `stroke-dasharray="${(c * s) / 100} ${c}" transform="rotate(-90 28 28)"/>` +
      `<text x="28" y="33" text-anchor="middle" fill="#fff" font-size="15" font-weight="600" font-family="-apple-system">${Number.isFinite(score) ? Math.round(s) : "–"}</text></svg>`;
  }

  window.DeskChart = { drawLine, drawCandles, ring };
})();
