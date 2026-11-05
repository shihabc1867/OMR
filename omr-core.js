/* omr-core.js v2 - generic OMR engine (runs in the browser and in Node)
 *
 * Idea: template = 4 reference corners + the centre of every option bubble of every question + bubble size.
 *  1. Build a template from a photo of a BLANK sheet: find corners -> straighten -> detect bubbles -> group into questions
 *  2. Scan a student's sheet: find corners -> straighten to the same size -> measure the darkness of every bubble
 */
(function (root) {
  'use strict';

  // ---------- The app's own 100-question sheet ----------
  const C = { W: 1000, H: 1450, ROWS: 25, COLS: 4, OPT: 4, MK: 40, GX0: 80, COLW: 205, GY0: 235, RH: 46, BX0: 50, BDX: 38, BR: 13 };
  const MARKERS = [[50, 50], [950, 50], [950, 1400], [50, 1400]]; // TL, TR, BR, BL
  function bubble(q, o) {
    const c = Math.floor(q / C.ROWS), r = q % C.ROWS;
    return [C.GX0 + c * C.COLW + C.BX0 + o * C.BDX, C.GY0 + r * C.RH];
  }
  function builtinTemplate() {
    const groups = [];
    for (let q = 0; q < C.ROWS * C.COLS; q++) { const pts = []; for (let o = 0; o < C.OPT; o++) pts.push(bubble(q, o)); groups.push({ pts }); }
    return { id: 'builtin', name: 'Built-in sheet (100 questions)', W: C.W, H: C.H, ref: MARKERS, align: 'markers', rx: C.BR, ry: C.BR, labels: ['A', 'B', 'C', 'D'], groups, builtin: true };
  }

  // ---------- Small helpers ----------
  const med = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  function toGray(rgba, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
    return g;
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function polyArea(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s) / 2;
  }
  function isConvex(p) {
    let pos = 0, neg = 0;
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 0) pos++; else neg++;
    }
    return pos === 4 || neg === 4;
  }
  // Orders 4 points clockwise, starting from the top-left corner of the photo
  function orderQuad(p) {
    const cx = p.reduce((s, t) => s + t[0], 0) / 4, cy = p.reduce((s, t) => s + t[1], 0) / 4;
    const s = p.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let k = 0;
    for (let i = 1; i < 4; i++) if (s[i][0] + s[i][1] < s[k][0] + s[k][1]) k = i;
    return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]];
  }
  function solve8(A, b) {
    const n = 8, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      const t = M[c]; M[c] = M[p]; M[p] = t;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  // src -> dst perspective matrix (4 point pairs)
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve8(A, b);
    return h ? h.concat([1]) : null;
  }

  // ---------- Image processing ----------
  function adaptiveMask(g, w, h, half, factor) {
    const iw = w + 1, I = new Float64Array(iw * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * iw + x + 1] = I[y * iw + x + 1] + row; }
    }
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        const s = I[y1 * iw + x1] - I[y0 * iw + x1] - I[y1 * iw + x0] + I[y0 * iw + x0];
        if (g[y * w + x] < (s / ((x1 - x0) * (y1 - y0))) * factor) mask[y * w + x] = 1;
      }
    }
    return mask;
  }
  function components(mask, w, h, eight) {
    const seen = new Uint8Array(w * h), stack = new Int32Array(w * h), out = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue;
      let sp = 0, minx = w, maxx = 0, miny = h, maxy = 0, cnt = 0, sx = 0, sy = 0;
      let sTL = 1e9, sBR = -1e9, dTR = -1e9, dBL = 1e9, tl = null, br = null, tr = null, bl = null;
      stack[sp++] = i; seen[i] = 1;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p / w) | 0;
        cnt++; sx += x; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        const s = x + y, d = x - y;
        if (s < sTL) { sTL = s; tl = [x, y]; } if (s > sBR) { sBR = s; br = [x, y]; }
        if (d > dTR) { dTR = d; tr = [x, y]; } if (d < dBL) { dBL = d; bl = [x, y]; }
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue; if (!eight && dx && dy) continue;
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
          }
        }
      }
      out.push({ minx, maxx, miny, maxy, cnt, sx, sy, tl, tr, br, bl });
    }
    return out;
  }

  // ---------- Corner detection 1: black corner markers ----------
  function findMarkers(gray, w, h) {
    const mask = adaptiveMask(gray, w, h, Math.max(15, Math.round(Math.max(w, h) / 16)), 0.55);
    const big = Math.max(w, h), minS = big * 0.012, maxS = big * 0.14, cands = [];
    for (const k of components(mask, w, h, false)) {
      const bw = k.maxx - k.minx + 1, bh = k.maxy - k.miny + 1;
      if (bw < minS || bh < minS || bw > maxS || bh > maxS) continue;
      const ar = bw / bh; if (ar < 0.55 || ar > 1.8) continue;
      const fill = k.cnt / (bw * bh); if (fill < 0.65) continue;
      cands.push({ x: k.sx / k.cnt, y: k.sy / k.cnt, area: k.cnt, fill });
    }
    cands.sort((a, b) => b.area * b.fill - a.area * a.fill);
    const top = cands.slice(0, 7);
    let best = null, bs = 0;
    for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++)
      for (let c = b + 1; c < top.length; c++) for (let d = c + 1; d < top.length; d++) {
        const q = [top[a], top[b], top[c], top[d]], areas = q.map(t => t.area);
        const mn = Math.min.apply(null, areas), mx = Math.max.apply(null, areas);
        if (mn < mx * 0.35) continue;
        const pts = orderQuad(q.map(t => [t.x, t.y]));
        if (!isConvex(pts) || polyArea(pts) < 0.06 * w * h) continue;
        const d01 = dist(pts[0], pts[1]), d12 = dist(pts[1], pts[2]), d23 = dist(pts[2], pts[3]), d30 = dist(pts[3], pts[0]);
        if (d01 / d23 > 2 || d23 / d01 > 2 || d12 / d30 > 2 || d30 / d12 > 2) continue;
        const sc = areas.reduce((s, t) => s + t, 0) * (mn / mx);
        if (sc > bs) { bs = sc; best = pts; }
      }
    return best;
  }

  // ---------- Corner detection 2: paper edges (light paper on a darker background) ----------
  function findPage(gray, w, h) {
    const k = Math.max(1, Math.round(Math.max(w, h) / 400)), sw = Math.floor(w / k), sh = Math.floor(h / k);
    const s = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let t = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) t += gray[(y * k + j) * w + x * k + i];
      s[y * sw + x] = t / (k * k);
    }
    const hist = new Float64Array(256);
    for (let i = 0; i < s.length; i++) hist[s[i]]++;
    const tot = s.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = tot - wB; if (!wF) break;
      sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    const mask = new Uint8Array(sw * sh);
    for (let i = 0; i < s.length; i++) mask[i] = s[i] > thr ? 1 : 0;
    let big = null;
    for (const c of components(mask, sw, sh, false)) if (!big || c.cnt > big.cnt) big = c;
    if (!big || big.cnt < 0.12 * sw * sh) return null;
    const q = [big.tl, big.tr, big.br, big.bl].map(p => [(p[0] + 0.5) * k, (p[1] + 0.5) * k]);
    if (!isConvex(q)) return null;
    const area = polyArea(q);
    if (area < 0.12 * w * h || big.cnt * k * k < 0.7 * area) return null;
    return orderQuad(q);
  }

  // mode: 'markers' | 'page' | 'auto' | 'manual'
  function alignPhoto(gray, w, h, mode) {
    if (mode === 'markers' || mode === 'auto') { const m = findMarkers(gray, w, h); if (m) return { pts: m, how: 'markers' }; }
    if (mode === 'page' || mode === 'auto') { const p = findPage(gray, w, h); if (p) return { pts: p, how: 'page' }; }
    return null;
  }

  // ---------- Straightening (perspective warp) ----------
  function warpRGBA(src, w, h, H, OW, OH) {
    const out = new Uint8ClampedArray(OW * OH * 4);
    const h0 = H[0], h1 = H[1], h2 = H[2], h3 = H[3], h4 = H[4], h5 = H[5], h6 = H[6], h7 = H[7], h8 = H[8];
    let o = 0;
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++, o += 4) {
      const d = h6 * x + h7 * y + h8, u = (h0 * x + h1 * y + h2) / d, v = (h3 * x + h4 * y + h5) / d;
      if (!(u >= 0 && v >= 0 && u < w - 1 && v < h - 1)) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; continue; }
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = (y0 * w + x0) * 4, j = i + w * 4;
      for (let k = 0; k < 3; k++) out[o + k] = (src[i + k] * (1 - fx) + src[i + 4 + k] * fx) * (1 - fy) + (src[j + k] * (1 - fx) + src[j + 4 + k] * fx) * fy;
      out[o + 3] = 255;
    }
    return out;
  }
  function warpGray(src, w, h, H, OW, OH) {
    const out = new Uint8Array(OW * OH);
    const h0 = H[0], h1 = H[1], h2 = H[2], h3 = H[3], h4 = H[4], h5 = H[5], h6 = H[6], h7 = H[7], h8 = H[8];
    let o = 0;
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++, o++) {
      const d = h6 * x + h7 * y + h8, u = (h0 * x + h1 * y + h2) / d, v = (h3 * x + h4 * y + h5) / d;
      if (!(u >= 0 && v >= 0 && u < w - 1 && v < h - 1)) { out[o] = 255; continue; }
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = y0 * w + x0;
      out[o] = (src[i] * (1 - fx) + src[i + 1] * fx) * (1 - fy) + (src[i + w] * (1 - fx) + src[i + w + 1] * fx) * fy;
    }
    return out;
  }

  // ---------- Measuring bubble darkness (elliptical regions) ----------
  const BUF = new Float32Array(80000);
  function collect(g, W, H, cx, cy, rx, ry, n0, n1) {
    const x0 = Math.max(0, Math.floor(cx - n1 * rx)), x1 = Math.min(W - 1, Math.ceil(cx + n1 * rx));
    const y0 = Math.max(0, Math.floor(cy - n1 * ry)), y1 = Math.min(H - 1, Math.ceil(cy + n1 * ry));
    const a = n0 * n0, b = n1 * n1; let n = 0;
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / ry, dy2 = dy * dy;
      for (let x = x0; x <= x1; x++) { const dx = (x - cx) / rx, d = dx * dx + dy2; if (d >= a && d <= b && n < BUF.length) BUF[n++] = g[y * W + x]; }
    }
    return n;
  }
  function statMean(g, W, H, cx, cy, rx, ry, n0, n1) {
    const n = collect(g, W, H, cx, cy, rx, ry, n0, n1); if (!n) return 255;
    let s = 0; for (let i = 0; i < n; i++) s += BUF[i]; return s / n;
  }
  function statPct(g, W, H, cx, cy, rx, ry, n0, n1, p) {
    const n = collect(g, W, H, cx, cy, rx, ry, n0, n1); if (!n) return 255;
    const v = BUF.subarray(0, n); v.sort(); return v[Math.min(n - 1, Math.floor(p * n))];
  }
  // Per bubble: darkness = 1 - (inner brightness / surrounding paper brightness); then the sheet-wide median is subtracted (removes printed letters inside bubbles etc.)
  function sampleTemplate(g, W, H, tpl) {
    const raw = tpl.groups.map(gr => gr.pts.map(p => {
      const inner = statMean(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 0, 0.5);
      const ring = statPct(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 1.35, 1.9, 0.65);
      return Math.max(0, 1 - inner / Math.max(ring, 1));
    }));
    const flat = []; raw.forEach(r => r.forEach(v => flat.push(v)));
    const base = med(flat);
    return raw.map(r => r.map(v => Math.max(0, v - base)));
  }
  // Alignment quality: do the printed (dark) bubble outlines land where the template says?
  function fitScore(g, W, H, tpl) {
    const all = []; tpl.groups.forEach(gr => gr.pts.forEach(p => all.push(p)));
    const st = Math.max(1, Math.floor(all.length / 150)); let s = 0, n = 0;
    for (let i = 0; i < all.length; i += st) {
      const p = all[i];
      const o = statMean(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 0.85, 1.15);
      const ref = statPct(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 1.4, 1.9, 0.65);
      s += Math.max(0, 1 - o / Math.max(ref, 1)); n++;
    }
    return n ? s / n : 0;
  }
  // darkness -> list of marked options per question
  function decide(dark, thr) {
    return dark.map(row => {
      const mx = Math.max.apply(null, row);
      if (mx < thr) return [];
      const lim = Math.max(thr, mx * 0.45), res = [];
      row.forEach((d, o) => { if (d >= lim) res.push(o); });
      return res;
    });
  }

  // ---------- Scan ----------
  // opts: {pts (manual 4 corners in sheet order TL,TR,BR,BL), rot}
  function scanTpl(rgba, w, h, tpl, opts) {
    opts = opts || {};
    const gray = toGray(rgba, w, h);
    let q, Hm, g, how = 'manual', rot = 0, fit = null, ambiguous = false;
    if (opts.pts) {
      q = opts.pts; Hm = homography(tpl.ref, q);
      if (!Hm) return { found: false };
      g = warpGray(gray, w, h, Hm, tpl.W, tpl.H); fit = fitScore(g, tpl.W, tpl.H, tpl);
    } else {
      const a = alignPhoto(gray, w, h, tpl.align);
      if (!a) return { found: false };
      how = a.how;
      const pts = a.pts, phLand = dist(pts[0], pts[1]) > dist(pts[1], pts[2]), tLand = tpl.W > tpl.H;
      const base = phLand !== tLand ? 1 : 0;
      const cands = typeof opts.rot === 'number' ? [opts.rot] : [base, (base + 2) % 4];
      let best = null, second = null;
      for (const r of cands) {
        const qq = [0, 1, 2, 3].map(i => pts[(i + r) % 4]), HH = homography(tpl.ref, qq);
        if (!HH) continue;
        const gg = warpGray(gray, w, h, HH, tpl.W, tpl.H), f = fitScore(gg, tpl.W, tpl.H, tpl);
        const c = { r, q: qq, Hm: HH, g: gg, f };
        if (!best || f > best.f + 0.02) { second = best; best = c; } else if (!second) second = c;
      }
      if (!best) return { found: false };
      q = best.q; Hm = best.Hm; g = best.g; rot = best.r; fit = best.f;
      ambiguous = !!(second && Math.abs(best.f - second.f) < 0.03 && cands.length > 1);
    }
    const warped = warpRGBA(rgba, w, h, Hm, tpl.W, tpl.H);
    return { found: true, how, rot, fit, ambiguous, quad: q, warped, dark: sampleTemplate(g, tpl.W, tpl.H, tpl) };
  }

  // ---------- Building a template from a photo of a blank sheet ----------
  // pts: 4 corners in the photo (TL,TR,BR,BL); W: canonical width
  function templateBase(rgba, w, h, pts, W) {
    W = W || 1200;
    const asp = (dist(pts[0], pts[3]) + dist(pts[1], pts[2])) / (dist(pts[0], pts[1]) + dist(pts[3], pts[2]));
    const Hh = Math.max(300, Math.min(2600, Math.round(W * asp)));
    const ref = [[0, 0], [W, 0], [W, Hh], [0, Hh]], Hm = homography(ref, pts);
    if (!Hm) return null;
    const warped = warpRGBA(rgba, w, h, Hm, W, Hh);
    return { W, H: Hh, ref, warped, gray: toGray(warped, W, Hh) };
  }

  // True when the empty centre of a component is fully enclosed by it (cannot be reached from outside its bounding box)
  function closedRing(mask, W, H, k) {
    const x0 = Math.max(0, k.minx - 1), x1 = Math.min(W - 1, k.maxx + 1), y0 = Math.max(0, k.miny - 1), y1 = Math.min(H - 1, k.maxy + 1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, seen = new Uint8Array(bw * bh), st = [];
    const push = (x, y) => { const i = (y - y0) * bw + (x - x0); if (!seen[i] && !mask[y * W + x]) { seen[i] = 1; st.push(x, y); } };
    for (let x = x0; x <= x1; x++) { push(x, y0); push(x, y1); }
    for (let y = y0; y <= y1; y++) { push(x0, y); push(x1, y); }
    while (st.length) {
      const y = st.pop(), x = st.pop();
      if (x > x0) push(x - 1, y); if (x < x1) push(x + 1, y); if (y > y0) push(x, y - 1); if (y < y1) push(x, y + 1);
    }
    // Enclosed empty pixels in the central area (a small printed letter inside the bubble is allowed)
    const w0 = k.maxx - k.minx + 1, h0 = k.maxy - k.miny + 1;
    const ax = k.minx + Math.floor(w0 * 0.3), bx = k.maxx - Math.floor(w0 * 0.3), ay = k.miny + Math.floor(h0 * 0.3), by = k.maxy - Math.floor(h0 * 0.3);
    let empty = 0, tot = 0;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { tot++; if (!seen[(y - y0) * bw + (x - x0)] && !mask[y * W + x]) empty++; }
    return tot > 0 && empty / tot >= 0.25;
  }

  // Find hollow circles on the straightened blank sheet
  function detectBubbles(g, W, H, sens) {
    const m1 = adaptiveMask(g, W, H, Math.max(15, Math.round(W / 30)), sens || 0.85);
    const m2 = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!m1[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) m2[yy * W + xx] = 1; } }
    }
    const lo = W * 0.008, hi = W * 0.05, cand = [];
    for (const k of components(m2, W, H, true)) {
      const bw = k.maxx - k.minx + 1, bh = k.maxy - k.miny + 1;
      if (bw < lo || bh < lo || bw > hi || bh > hi) continue;
      const ar = bw / bh; if (ar < 0.4 || ar > 2.5) continue;
      if (k.cnt / (bw * bh) > 0.9) continue;
      // Hollow check: the middle area must be mostly empty
      const cx0 = k.minx + Math.floor(bw * 0.3), cx1 = k.maxx - Math.floor(bw * 0.3), cy0 = k.miny + Math.floor(bh * 0.3), cy1 = k.maxy - Math.floor(bh * 0.3);
      let dark = 0, n = 0;
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) { n++; if (m1[y * W + x]) dark++; }
      if (n && dark / n > 0.45) continue;
      if (!closedRing(m2, W, H, k)) continue; // letters such as S, C, H, L are open shapes; a bubble outline is a closed ring
      cand.push({ x: (k.minx + k.maxx) / 2, y: (k.miny + k.maxy) / 2, w: bw, h: bh });
    }
    if (cand.length < 4) return null;
    // Dominant size (histogram peak)
    const cnt = {};
    cand.forEach(b => { const s = Math.round(Math.max(b.w, b.h) / 2); cnt[s] = (cnt[s] || 0) + 1; });
    let bestS = 0, bestC = -1;
    Object.keys(cnt).forEach(k => { k = +k; const c = (cnt[k - 1] || 0) + cnt[k] + (cnt[k + 1] || 0); if (c > bestC) { bestC = c; bestS = k * 2; } });
    let keep = cand.filter(b => { const s = Math.max(b.w, b.h); return s >= bestS * 0.75 && s <= bestS * 1.33; });
    if (keep.length < 4) return null;
    // Tighter size match around the median (rejects printed letters such as O, P, B, D)
    const mw = med(keep.map(b => b.w)), mh = med(keep.map(b => b.h));
    keep = keep.filter(b => Math.abs(b.w - mw) <= 0.2 * mw && Math.abs(b.h - mh) <= 0.2 * mh);
    // Grid support: a real option bubble has a same-size neighbour in its row or column at a plausible spacing
    const sup = keep.filter(b => keep.some(o => {
      if (o === b) return false;
      const dx = Math.abs(o.x - b.x), dy = Math.abs(o.y - b.y);
      const row = dy <= 0.35 * mh && dx >= 1.25 * mw && dx <= 6 * mw, col = dx <= 0.35 * mw && dy >= 1.25 * mh && dy <= 6 * mh;
      return row || col;
    }));
    if (sup.length < 4) return null;
    keep = sup;
    return { list: keep, rx: Math.max(3, (med(keep.map(b => b.w)) - 3.5) / 2), ry: Math.max(3, (med(keep.map(b => b.h)) - 3.5) / 2) };
  }

  // Group bubbles into questions.
  // o: {transpose (options run top->bottom), numbering: 'col'|'row'|'block', k (options per question; auto if omitted)}
  function buildGroups(list, rx, ry, o) {
    o = o || {};
    const tr = !!o.transpose, mode = o.numbering || 'col', hh = tr ? rx : ry, hw = tr ? ry : rx;
    const P = list.map(b => tr ? [b.y, b.x] : [b.x, b.y]).sort((a, b) => a[1] - b[1]);
    const rows = [];
    for (const p of P) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(p[1] - r.y) <= hh * 0.9) { r.p.push(p); r.y += (p[1] - r.y) / r.p.length; } else rows.push({ y: p[1], p: [p] });
    }
    rows.forEach(r => r.p.sort((a, b) => a[0] - b[0]));
    let split = Infinity;
    if (!o.k) {
      const gaps = []; rows.forEach(r => { for (let i = 1; i < r.p.length; i++) gaps.push(r.p[i][0] - r.p[i - 1][0]); });
      if (gaps.length) {
        gaps.sort((a, b) => a - b);
        const lowv = gaps[Math.floor(gaps.length * 0.2)], within = gaps.filter(g => g <= lowv * 1.5);
        split = within[within.length >> 1] * 1.7;
      }
    }
    const raw = [];
    rows.forEach((r, ri) => {
      const push = a => { if (a.length >= 2) raw.push({ pts: a, x0: a[0][0], x1: a[a.length - 1][0], y: r.y, row: ri }); };
      if (o.k) { for (let i = 0; i < r.p.length; i += o.k) push(r.p.slice(i, i + o.k)); }
      else {
        let cur = [r.p[0]];
        for (let i = 1; i < r.p.length; i++) { if (r.p[i][0] - r.p[i - 1][0] > split) { push(cur); cur = []; } cur.push(r.p[i]); }
        push(cur);
      }
    });
    if (!raw.length) return [];
    let order;
    if (mode === 'row') order = raw;
    else {
      const wm = med(raw.map(g => g.x1 - g.x0)), tol = Math.max(hw * 2, wm * 0.5);
      const cols = [];
      raw.slice().sort((a, b) => a.x0 - b.x0).forEach(g => {
        const c = cols[cols.length - 1];
        if (c && g.x0 - c.x <= tol) c.g.push(g); else cols.push({ x: g.x0, g: [g] });
      });
      cols.forEach(c => c.g.sort((a, b) => a.y - b.y));
      if (mode === 'col') order = [].concat.apply([], cols.map(c => c.g));
      else {
        const blocks = [], allD = [];
        cols.forEach(c => {
          const d = []; for (let i = 1; i < c.g.length; i++) d.push(c.g[i].y - c.g[i - 1].y);
          d.forEach(v => allD.push(v));
          const pitch = med(d) || 1; let cur = [c.g[0]];
          for (let i = 1; i < c.g.length; i++) {
            if (c.g[i].y - c.g[i - 1].y > pitch * 1.8) { blocks.push({ x: c.x, top: cur[0].y, bot: cur[cur.length - 1].y, g: cur }); cur = []; }
            cur.push(c.g[i]);
          }
          blocks.push({ x: c.x, top: cur[0].y, bot: cur[cur.length - 1].y, g: cur });
        });
        const gp = med(allD) || 1, bh = med(blocks.map(b => b.bot - b.top)), bandTol = Math.max(bh * 0.5, gp * 2);
        blocks.sort((a, b) => a.top - b.top);
        const bands = [];
        blocks.forEach(b => { const bd = bands[bands.length - 1]; if (bd && b.top - bd.top <= bandTol) bd.b.push(b); else bands.push({ top: b.top, b: [b] }); });
        order = [];
        bands.forEach(bd => bd.b.sort((a, b) => a.x - b.x).forEach(b => b.g.forEach(g => order.push(g))));
      }
    }
    const r1 = v => Math.round(v * 10) / 10;
    return order.map(g => ({ pts: g.pts.map(p => tr ? [r1(p[1]), r1(p[0])] : [r1(p[0]), r1(p[1])]) }));
  }

  function makeTemplate(base, bub, groups, meta) {
    return { id: meta.id, name: meta.name, W: base.W, H: base.H, ref: base.ref, align: meta.align || 'auto', rx: bub.rx, ry: bub.ry, labels: meta.labels, groups };
  }

  root.OMR = {
    C, MARKERS, bubble, builtinTemplate, toGray, homography, orderQuad, findMarkers, findPage, alignPhoto,
    warpRGBA, warpGray, sampleTemplate, fitScore, decide, scanTpl, templateBase, detectBubbles, buildGroups, makeTemplate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OMR;
})(typeof self !== 'undefined' ? self : globalThis);
