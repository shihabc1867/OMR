/* omr-core.js v2 - generic OMR engine (runs in the browser and in Node)
 *
 * Idea: template = 4 reference corners + the centre of every option bubble of every question + bubble size.
 *  1. Build a template from a photo of a BLANK sheet: find corners -> straighten -> detect bubbles -> group into questions
 *  2. Scan a student's sheet: find corners -> straighten to the same size -> measure the darkness of every bubble
 */
(function (root) {
  'use strict';

  // ---------- The app's own 100-question sheet (landscape, 4 columns x 25 rows, options a b c d) ----------
  const C = { W: 1440, H: 1066, ROWS: 25, COLS: 4, OPT: 4, MK: 44, GX0: 152, COLW: 356, GY0: 66, RH: 38, BDX: 40, BR: 15 };
  const MARKERS = [[34, 26], [1406, 26], [1406, 1040], [34, 1040]]; // TL, TR, BR, BL
  function bubble(q, o) {
    const c = Math.floor(q / C.ROWS), r = q % C.ROWS;
    return [C.GX0 + c * C.COLW + o * C.BDX, C.GY0 + r * C.RH];
  }
  function builtinTemplate() {
    const groups = [];
    for (let q = 0; q < C.ROWS * C.COLS; q++) { const pts = []; for (let o = 0; o < C.OPT; o++) pts.push(bubble(q, o)); groups.push({ pts }); }
    return { id: 'builtin', name: 'Built-in sheet (100 questions)', W: C.W, H: C.H, ref: MARKERS, align: 'markers', rx: C.BR, ry: C.BR, labels: ['a', 'b', 'c', 'd'], groups, builtin: true };
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
  // Separable box filter on a binary mask. needAll=true -> erosion, false -> dilation
  function boxPass(src, w, h, r, horiz, needAll) {
    const out = new Uint8Array(w * h), lines = horiz ? h : w, len = horiz ? w : h, ls = horiz ? w : 1, es = horiz ? 1 : w;
    const p = new Int32Array(len + 1), full = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * ls;
      for (let i = 0; i < len; i++) p[i + 1] = p[i] + src[base + i * es];
      for (let i = 0; i < len; i++) {
        const i0 = i - r, i1 = i + r;
        if (needAll) { if (i0 >= 0 && i1 < len && p[i1 + 1] - p[i0] === full) out[base + i * es] = 1; }
        else { const x0 = Math.max(0, i0), x1 = Math.min(len - 1, i1); if (p[x1 + 1] - p[x0] > 0) out[base + i * es] = 1; }
      }
    }
    return out;
  }
  // Opening = erosion then dilation: removes thin lines/text strokes/page borders and keeps solid blocks (the black squares)
  function openMask(m, w, h, r) {
    let t = boxPass(m, w, h, r, true, true); t = boxPass(t, w, h, r, false, true);
    t = boxPass(t, w, h, r, true, false); return boxPass(t, w, h, r, false, false);
  }
  function markerCands(gray, w, h, half, factor) {
    const big = Math.max(w, h), mask = adaptiveMask(gray, w, h, half, factor);
    const r = Math.max(1, Math.min(4, Math.round(big * 0.0012))), op = openMask(mask, w, h, r);
    const minS = Math.max(6, big * 0.0045), maxS = big * 0.14, cands = [];
    for (const k of components(op, w, h, false)) {
      const bw = k.maxx - k.minx + 1, bh = k.maxy - k.miny + 1;
      if (bw < minS || bh < minS || bw > maxS || bh > maxS) continue;
      const ar = bw / bh; if (ar < 0.55 || ar > 1.8) continue;
      const fill = k.cnt / (bw * bh); if (fill < 0.55) continue;
      // Corner test: a (possibly rotated) square has corners that stick out of the circle of equal area; a filled answer bubble does not
      { const cx = k.sx / k.cnt, cy = k.sy / k.cnt; let md = 0;
        for (let y = k.miny; y <= k.maxy; y++) for (let x = k.minx; x <= k.maxx; x++) if (op[y * w + x]) { const d = (x - cx) * (x - cx) + (y - cy) * (y - cy); if (d > md) md = d; }
        const sz = Math.min(bw, bh), need = sz >= 20 ? 1.15 : sz >= 12 ? 1.08 : 0;   // tiny blurry squares have no reliable corners
        if (need && Math.sqrt(md) / Math.sqrt(k.cnt / Math.PI) < need) continue; }
      // Isolation: a corner square has plain paper around it (no big dark neighbours)
      const pad = Math.max(3, Math.round(Math.max(bw, bh) * 0.5)), x0 = Math.max(0, k.minx - pad), x1 = Math.min(w - 1, k.maxx + pad), y0 = Math.max(0, k.miny - pad), y1 = Math.min(h - 1, k.maxy + pad);
      let ink = 0, tot = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (x >= k.minx && x <= k.maxx && y >= k.miny && y <= k.maxy) continue;
        tot++; if (op[y * w + x]) ink++;
      }
      const iso = tot ? 1 - ink / tot : 1;   // soft test: page border lines / text next to a square lower the score but do not reject it
      if (iso < 0.35) continue;
      cands.push({ x: k.sx / k.cnt, y: k.sy / k.cnt, area: k.cnt, fill, iso });
    }
    cands.sort((a, b) => b.area * b.fill * b.iso * b.iso - a.area * a.fill * a.iso * a.iso);
    // Keep the candidates that sit at the outer corners of the pattern (the sheet's squares are extreme points) plus the largest few
    const pick = new Set(cands.slice(0, 6)), by = [c => c.x + c.y, c => c.x - c.y, c => -c.x - c.y, c => c.y - c.x];
    by.forEach(f => cands.slice().sort((a, b) => f(b) - f(a)).slice(0, 4).forEach(c => pick.add(c)));
    return Array.from(pick);
  }
  // aspect (optional): expected long/short side ratio of the 4 markers; used to reject wrong combinations
  function pickQuad(top, w, h, aspect) {
    let best = null, bs = 0;
    for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++)
      for (let c = b + 1; c < top.length; c++) for (let d = c + 1; d < top.length; d++) {
        const q = [top[a], top[b], top[c], top[d]], areas = q.map(t => t.area);
        const mn = Math.min.apply(null, areas), mx = Math.max.apply(null, areas);
        if (mn < mx * 0.4) continue;
        const pts = orderQuad(q.map(t => [t.x, t.y]));
        const pa = polyArea(pts);
        if (!isConvex(pts) || pa < 0.03 * w * h) continue;
        const d01 = dist(pts[0], pts[1]), d12 = dist(pts[1], pts[2]), d23 = dist(pts[2], pts[3]), d30 = dist(pts[3], pts[0]);
        if (d01 / d23 > 2.2 || d23 / d01 > 2.2 || d12 / d30 > 2.2 || d30 / d12 > 2.2) continue;
        let asOK = 1;
        if (aspect) {
          const L = (d01 + d23) / 2, S = (d12 + d30) / 2, as = Math.max(L, S) / Math.min(L, S);
          if (Math.abs(as - aspect) / aspect > 0.55) continue;
          asOK = 1 - Math.abs(as - aspect) / aspect;
        }
        const iso = (q[0].iso + q[1].iso + q[2].iso + q[3].iso) / 4;
        // A sheet's four squares form a near-rectangle: opposite sides about equal (perspective allows some difference)
        const par = Math.min(d01, d23) / Math.max(d01, d23) * Math.min(d12, d30) / Math.max(d12, d30);
        const sc = pa * Math.pow(mn / mx, 3) * Math.pow(par, 4) * asOK * iso * iso;
        if (sc > bs) { bs = sc; best = pts; }
      }
    return best;
  }
  function findMarkers(gray, w, h, aspect) {
    const big = Math.max(w, h);
    // Several thresholds / window sizes: the first one that gives four consistent squares wins
    const tries = [[big / 16, 0.55], [big / 16, 0.7], [big / 10, 0.45], [big / 24, 0.8], [big / 8, 0.35]];
    for (const t of tries) {
      const q = pickQuad(markerCands(gray, w, h, Math.max(15, Math.round(t[0])), t[1]), w, h, aspect);
      if (q) return q;
    }
    return null;
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
  function alignPhoto(gray, w, h, mode, aspect) {
    // 'manual' templates also try the corner squares / paper edges (the template then carries its own reference points)
    if (mode === 'markers' || mode === 'auto' || mode === 'manual') { const m = findMarkers(gray, w, h, aspect); if (m) return { pts: m, how: 'markers' }; }
    if (mode === 'page' || mode === 'auto' || mode === 'manual') { const p = findPage(gray, w, h); if (p) return { pts: p, how: 'page' }; }
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
  // Share of a disc (radius rin * bubble radius) that is THICK ink: a pixel counts only when at least 75% of the (2e+1)x(2e+1) block around it is ink.
  // Printed letters, ring arcs, thin ticks, dust and pen specks are only a few pixels wide and vanish; a filled-in bubble stays.
  function thickFrac(g, W, H, cx, cy, rx, ry, rin, cut) {
    const e = Math.max(1, Math.round(0.14 * rx)), hx = Math.ceil(rin * rx), hy = Math.ceil(rin * ry), X = Math.round(cx), Y = Math.round(cy), need = Math.ceil(0.75 * (2 * e + 1) * (2 * e + 1));
    let tot = 0, thick = 0;
    for (let dy = -hy; dy <= hy; dy++) for (let dx = -hx; dx <= hx; dx++) {
      const ex = dx / (rin * rx), ey = dy / (rin * ry); if (ex * ex + ey * ey > 1) continue;
      tot++; let k = 0;
      for (let j = -e; j <= e; j++) { const yy = Y + dy + j; if (yy < 0 || yy >= H) continue; for (let i = -e; i <= e; i++) { const xx = X + dx + i; if (xx >= 0 && xx < W && g[yy * W + xx] < cut) k++; } }
      if (k >= need) thick++;
    }
    return tot ? thick / tot : 0;
  }
  // The printed ring is the best guide to where a bubble really is in the photo (bent page, small print shifts, lens bend).
  // Try small shifts and keep the one where the ring is darkest (the ring is still there when the bubble is filled in).
  function recentre(g, W, H, cx, cy, rx, ry) {
    const lim = 0.32, st = 0.1, ang = 18, rad = [0.85, 0.95, 1.05];
    let best = null, none = 0, nn = 0;
    for (let oy = -lim; oy <= lim + 1e-9; oy += st) for (let ox = -lim; ox <= lim + 1e-9; ox += st) {
      let s = 0, n = 0;
      for (let a = 0; a < ang; a++) { const t = a * 2 * Math.PI / ang, ct = Math.cos(t), sn = Math.sin(t);
        for (let k = 0; k < rad.length; k++) { const x = Math.round(cx + (ox + rad[k] * ct) * rx), y = Math.round(cy + (oy + rad[k] * sn) * ry); if (x >= 0 && y >= 0 && x < W && y < H) { s += g[y * W + x]; n++; } } }
      if (!n) continue; s /= n;
      if (Math.abs(ox) < 1e-6 && Math.abs(oy) < 1e-6) none = s;
      if (!best || s < best.s) best = { s, ox, oy };
      nn += s;
    }
    if (!best) return [cx, cy];
    return best.s < none - 6 ? [cx + best.ox * rx, cy + best.oy * ry] : [cx, cy];      // only move when the ring clearly fits better
  }
  // Per bubble, measured on the INNER disc only (half the bubble radius), so the printed ring, a slightly shifted grid or a bent page never counts:
  //   paper = the local paper brightness around the bubble (40th percentile of a ring outside it: robust to shadows and neighbours)
  //   ink   = a pixel at least 60% darker than that paper (pen-black, not grey), and THICK: at least 75% of the pixels around it (a ~5x5 block) are ink too. Only a really filled-in bubble gets there;
  //           light pencil, ghost marks, smudges, shadows, dust, thin ticks and the printed letters inside the bubbles do not.
  //   fill  = share of the inner disc that is thick ink,  core = share of the very centre that is thick ink (a real mark covers the centre;
  //           specks, thin ticks and ring arcs do not),  dark = how much darker the inner disc is than the paper
  // The sheet-wide median is subtracted from both (removes printed letters inside every bubble).
  function sampleBubbles(g, W, H, tpl) {
    const dk = [], fl = [], rw = [], cr = [];
    tpl.groups.forEach(gr => {
      const d = [], f = [], r = [], c = [];
      gr.pts.forEach(p0 => {
        const p = recentre(g, W, H, p0[0], p0[1], tpl.rx, tpl.ry);
        const paper = Math.max(1, statPct(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 1.35, 1.9, 0.4));
        const n = collect(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 0, 0.5), cut = paper * 0.4;
        let sum = 0; for (let i = 0; i < n; i++) sum += BUF[i];
        const dd = n ? Math.max(0, 1 - (sum / n) / paper) : 0;
        d.push(dd); f.push(thickFrac(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 0.5, cut)); r.push(dd); c.push(thickFrac(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 0.3, cut));
      });
      dk.push(d); fl.push(f); rw.push(r); cr.push(c);
    });
    // Remove what every EMPTY bubble already shows (printed letters / numbers inside the bubbles). The level is taken per option column
    // (the printed 'a' can be heavier than the printed 'c'), but never more than 0.15 above the sheet-wide median, so a column that
    // most students marked cannot cancel out its own marks.
    const norm = m => {
      const flat = [], cols = []; m.forEach(r => r.forEach((v, o) => { flat.push(v); (cols[o] = cols[o] || []).push(v); }));
      const all = med(flat), base = cols.map(c => Math.min(med(c), all + 0.15));
      return m.map(r => r.map((v, o) => Math.min(1, Math.max(0, v - base[o]) / Math.max(0.2, 1 - base[o]))));
    };
    return { dark: norm(dk), fill: norm(fl), raw: rw, core: norm(cr) };
  }
  function sampleTemplate(g, W, H, tpl) { return sampleBubbles(g, W, H, tpl).dark; }
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
  // darkness -> list of marked options per question (simple version, kept for compatibility)
  function decide(dark, thr) {
    return dark.map(row => {
      const mx = Math.max.apply(null, row);
      if (mx < thr) return [];
      const lim = Math.max(thr, mx * 0.45), res = [];
      row.forEach((d, o) => { if (d >= lim) res.push(o); });
      return res;
    });
  }
  // Strict reading of every question - only real ink counts.
  //  touched bubble = the inner disc has thick ink (fill >= thr, default 30%), the centre has thick ink (core >= 45%) AND the disc is really dark (raw >= 40%, and clearly darker than the empty bubbles: dark >= 40%)
  //  full mark      = touched, the inner disc is at least fillMin covered AND really dark (raw darkness >= fullRaw)
  //  A question is INVALID (counted wrong) when it has a partly filled bubble, more than one touched bubble, or 3+ touched (shadow / scribble).
  // returns { sel: [[options]], bad: [bool], partial: [[options]] }
  function analyze(dark, fill, o, raw, core) {
    o = o || {};
    const thr = o.thr || 0.3, fillMin = o.fillMin || 0.7, touch = Math.max(0.25, o.touch || thr), fullRaw = o.fullRaw || 0.5, coreMin = o.coreMin || 0.45, rawMin = o.rawMin || 0.4, darkMin = o.darkMin || 0.4;
    const sel = [], bad = [], partial = [];
    dark.forEach((row, q) => {
      const s = [], p = [];
      row.forEach((d, i) => {
        const f = fill && fill[q] ? fill[q][i] : d;
        const cc = core && core[q] ? core[q][i] : 1, rr = raw && raw[q] ? raw[q][i] : d + 0.4;
        if (f >= touch && cc >= coreMin && rr >= rawMin && d >= darkMin) { s.push(i); if (f < fillMin || rr < fullRaw) p.push(i); }
      });
      sel.push(s); partial.push(p); bad.push(p.length > 0 || s.length > 1);
    });
    return { sel, bad, partial };
  }

  // ---------- Scan ----------
  // opts: {pts (manual 4 corners in sheet order TL,TR,BR,BL), rot}
  // Older hand-aligned sheet types have no stored corner-square positions. Here we find the 4 squares in the photo, straighten the
  // photo roughly on them, detect the bubbles, and work out (by voting on scale + shift) how the template's bubbles map onto the
  // detected ones. That tells us where the squares sit in template coordinates.
  function inferMk(gray, w, h, tpl) {
    const m = findMarkers(gray, w, h);
    if (!m) return null;
    const W = tpl.W, H = tpl.H, P = [];
    tpl.groups.forEach(g => g.pts.forEach(p => P.push(p)));
    const mkRough = [[-0.04 * W, -0.04 * H], [1.04 * W, -0.04 * H], [1.04 * W, 1.04 * H], [-0.04 * W, 1.04 * H]];
    const phLand = dist(m[0], m[1]) > dist(m[1], m[2]), tLand = W > H, base = phLand !== tLand ? 1 : 0;
    let best = null;
    for (const r of [base, (base + 2) % 4]) {
      const qq = [0, 1, 2, 3].map(i => m[(i + r) % 4]), Hr = homography(mkRough, qq);
      if (!Hr) continue;
      const gR = warpGray(gray, w, h, Hr, W, H);
      let det = null; for (const sv of [0.85, 0.95, 0.75]) { det = detectBubbles(gR, W, H, sv); if (det && det.list.length >= 0.3 * P.length) break; }
      if (!det || det.list.length < 0.3 * P.length) continue;
      const D = det.list.map(b => [b.x, b.y]);
      // vote for (scale x, scale y, shift x, shift y):  detected = S * template + t
      const BIN = 5, R = 320, NB = Math.floor(2 * R / BIN) + 1, hist = new Int32Array(NB * NB);
      let bv = 0, bsx = 1, bsy = 1, btx = 0, bty = 0;
      // The squares lie just outside the bubble block on every side (margin between -1% and 14% of the sheet size): this rules out
      // answers that are off by a whole column/row block (the blocks look identical)
      let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
      P.forEach(p => { if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0]; if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1]; });
      for (let sx = 0.8; sx <= 1.32; sx += 0.04) for (let sy = 0.8; sy <= 1.32; sy += 0.04) {
        hist.fill(0);
        const txLo = Math.max(mkRough[0][0] - sx * (bx0 + 0.01 * W), mkRough[1][0] - sx * (bx1 + 0.14 * W)), txHi = Math.min(mkRough[0][0] - sx * (bx0 - 0.14 * W), mkRough[1][0] - sx * (bx1 - 0.01 * W));
        const tyLo = Math.max(mkRough[0][1] - sy * (by0 + 0.01 * H), mkRough[2][1] - sy * (by1 + 0.14 * H)), tyHi = Math.min(mkRough[0][1] - sy * (by0 - 0.14 * H), mkRough[2][1] - sy * (by1 - 0.01 * H));
        if (txLo > txHi || tyLo > tyHi) continue;
        for (let i = 0; i < D.length; i++) for (let j = 0; j < P.length; j++) {
          const tx = D[i][0] - sx * P[j][0], ty = D[i][1] - sy * P[j][1];
          if (tx < txLo || tx > txHi || ty < tyLo || ty > tyHi || tx < -R || tx > R || ty < -R || ty > R) continue;
          const k = Math.floor((ty + R) / BIN) * NB + Math.floor((tx + R) / BIN); hist[k]++;
        }
        for (let k = 0; k < hist.length; k++) if (hist[k] > bv) { bv = hist[k]; bsx = sx; bsy = sy; btx = (k % NB) * BIN - R + BIN / 2; bty = Math.floor(k / NB) * BIN - R + BIN / 2; }
      }
      // refine: match nearest points, least squares per axis, tighter each round
      let sx = bsx, sy = bsy, tx = btx, ty = bty, cnt = 0;
      for (const gate of [9, 7, 5, 4]) {
        const ax = [], ay = [];
        for (let j = 0; j < P.length; j++) {
          const ex = sx * P[j][0] + tx, ey = sy * P[j][1] + ty; let bd = gate * gate + 1, bi = -1;
          for (let i = 0; i < D.length; i++) { const d2 = (D[i][0] - ex) * (D[i][0] - ex) + (D[i][1] - ey) * (D[i][1] - ey); if (d2 < bd) { bd = d2; bi = i; } }
          if (bi >= 0) { ax.push([P[j][0], D[bi][0]]); ay.push([P[j][1], D[bi][1]]); }
        }
        cnt = ax.length; if (cnt < 8) break;
        const fit1 = pr => { let n = pr.length, sp = 0, sd = 0, spp = 0, spd = 0; pr.forEach(v => { sp += v[0]; sd += v[1]; spp += v[0] * v[0]; spd += v[0] * v[1]; }); const den = n * spp - sp * sp; if (Math.abs(den) < 1e-9) return null; const a = (n * spd - sp * sd) / den; return [a, (sd - a * sp) / n]; };
        const fx = fit1(ax), fy = fit1(ay); if (!fx || !fy) break;
        sx = fx[0]; tx = fx[1]; sy = fy[0]; ty = fy[1];
      }
      if (cnt < 0.4 * P.length || sx < 0.6 || sy < 0.6) continue;
      // Rows (and options) repeat, so the vote can be off by whole rows/options. Try small whole-pitch shifts and keep the best fit.
      const firsts = tpl.groups.map(g => g.pts[0][1]).sort((p, q) => p - q), dys = [];
      for (let i = 1; i < firsts.length; i++) { const d = firsts[i] - firsts[i - 1]; if (d > 2) dys.push(d); }
      const pitchY = dys.length ? dys.slice().sort((p, q) => p - q)[Math.floor(dys.length / 4)] : 0;
      const dxs = tpl.groups.filter(g => g.pts.length > 1).map(g => g.pts[1][0] - g.pts[0][0]).sort((p, q) => p - q), pitchX = dxs.length ? dxs[Math.floor(dxs.length / 2)] : 0;
      const evalAt = (txv, tyv) => {
        const mk = mkRough.map(p => [(p[0] - txv) / sx, (p[1] - tyv) / sy]), Hm = homography(mk, qq);
        return Hm ? { mk, f: fitScore(warpGray(gray, w, h, Hm, W, H), W, H, tpl) } : { mk, f: -1 };
      };
      let cur = evalAt(tx, ty), cty = ty, ctx = tx;
      if (pitchY > 4) {
        // Printed sheets have about the same margin above the first row and below the last row: pick the whole-row shift that makes them equal
        let by0 = 1e9, by1 = -1e9; P.forEach(p => { if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1]; });
        let bk = 0, bd = 1e18;
        for (let k = -4; k <= 4; k++) {
          const mkY = mkRough.map(p => (p[1] - (ty + k * pitchY * sy)) / sy), top = by0 - (mkY[0] + mkY[1]) / 2, bot = (mkY[2] + mkY[3]) / 2 - by1;
          const d = Math.abs(top - bot) + (top < 0 || bot < 0 ? 1e6 : 0); if (d < bd) { bd = d; bk = k; }
        }
        cty = ty + bk * pitchY * sy; cur = evalAt(tx, cty);
      }
      if (pitchX > 4) { for (let k = -2; k <= 2; k++) { if (!k) continue; const e = evalAt(tx + k * pitchX * sx, cty); if (e.f > cur.f + 0.004) { cur = e; } } }
      // final polish: small shifts (rough-image pixels) that improve how well the bubbles line up
      { let ex = tx, ey = cty;
        for (const step of [6, 3, 1.5]) for (let it = 0; it < 4; it++) {
          let moved = false;
          for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) { const e = evalAt(ex + dx, ey + dy); if (e.f > cur.f + 0.002) { cur = e; ex += dx; ey += dy; moved = true; } }
          if (!moved) break;
        } }
      if (!best || cur.f > best.f + 0.02) best = { mk: cur.mk, f: cur.f };   // the first orientation (upright) wins unless the other is clearly better
    }
    return best && best.f >= 0.2 ? best : null;
  }
  function scanTpl(rgba, w, h, tpl, opts) {
    opts = opts || {};
    const gray = toGray(rgba, w, h);
    let q, Hm, g, how = 'manual', rot = 0, fit = null, ambiguous = false, learned = null;
    if (opts.pts) {
      q = opts.pts; Hm = homography(tpl.ref, q);
      if (!Hm) return { found: false };
      g = warpGray(gray, w, h, Hm, tpl.W, tpl.H); fit = fitScore(g, tpl.W, tpl.H, tpl);
    } else {
      // Reference points in template space: the corner squares (tpl.mk, saved with the sheet type) or the template corners
      let mode = tpl.align;
      if (mode === 'manual' && !tpl.mk) {                        // old hand-placed template: try to work out where the squares are
        const inf = inferMk(gray, w, h, tpl);
        if (inf) { tpl.mk = inf.mk; learned = inf.mk; mode = 'markers'; } else mode = 'none';
      }
      const mref = tpl.mk || tpl.ref;
      const ra = dist(mref[0], mref[1]) + dist(mref[3], mref[2]), rb = dist(mref[1], mref[2]) + dist(mref[0], mref[3]);
      const a = alignPhoto(gray, w, h, mode === 'none' ? 'x' : mode, Math.max(ra, rb) / Math.min(ra, rb));
      if (!a) return { found: false };
      how = a.how;
      var refUse = (a.how === 'markers') ? mref : tpl.ref;
      const pts = a.pts, phLand = dist(pts[0], pts[1]) > dist(pts[1], pts[2]), tLand = dist(refUse[0], refUse[1]) > dist(refUse[1], refUse[2]);
      const base = phLand !== tLand ? 1 : 0;
      const cands = typeof opts.rot === 'number' ? [opts.rot] : [base, (base + 2) % 4];
      let best = null, second = null;
      for (const r of cands) {
        const qq = [0, 1, 2, 3].map(i => pts[(i + r) % 4]), HH = homography(refUse, qq);
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
    const sm = sampleBubbles(g, tpl.W, tpl.H, tpl);
    return { found: true, how, rot, fit, ambiguous, quad: q, warped, dark: sm.dark, fill: sm.fill, raw: sm.raw, core: sm.core, learned };
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

  // Find hollow circles on the straightened blank sheet.
  // Method: the bright INSIDE of every bubble is a small, separate "hole" in the ink mask. Looking for the holes (instead of the
  // outlines) keeps neighbouring bubbles apart even when their outlines almost touch, and printed letters inside the bubble do not matter.
  function detectBubbles(g, W, H, sens) {
    const ink = adaptiveMask(g, W, H, Math.max(15, Math.round(W / 30)), sens || 0.85);
    const inv = new Uint8Array(W * H);
    for (let i = 0; i < inv.length; i++) inv[i] = ink[i] ? 0 : 1;
    const lo = W * 0.005, hi = W * 0.045, cand = [];
    const run = (x, y, dx, dy) => { let n = 0; x += dx; y += dy; while (n < 14 && x >= 0 && y >= 0 && x < W && y < H && ink[y * W + x]) { n++; x += dx; y += dy; } return n; };
    for (const k of components(inv, W, H, false)) {
      const bw = k.maxx - k.minx + 1, bh = k.maxy - k.miny + 1;
      if (bw < lo || bh < lo || bw > hi || bh > hi) continue;
      const ar = bw / bh; if (ar < 0.5 || ar > 2) continue;
      const fill = k.cnt / (bw * bh); if (fill < 0.3 || fill > 0.95) continue;
      const cx = (k.minx + k.maxx) / 2, cy = (k.miny + k.maxy) / 2;
      // The hole must be surrounded by ink all around (a real outline), not just a gap between letters
      let hitN = 0, tot = 0;
      for (let a = 0; a < 24; a++) {
        const t = a * Math.PI / 12, px = Math.round(cx + (bw / 2 + 1.5) * Math.cos(t)), py = Math.round(cy + (bh / 2 + 1.5) * Math.sin(t));
        let yes = 0;
        for (let dy = -2; dy <= 2 && !yes; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = px + dx, yy = py + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && ink[yy * W + xx]) { yes = 1; break; } }
        hitN += yes; tot++;
      }
      if (hitN / tot < 0.85) continue;
      // Outline thickness (average ink run on the four sides)
      const th = (run(k.maxx, Math.round(cy), 1, 0) + run(k.minx, Math.round(cy), -1, 0) + run(Math.round(cx), k.miny, 0, -1) + run(Math.round(cx), k.maxy, 0, 1)) / 4;
      const t = Math.max(1, th);
      cand.push({ x: cx, y: cy, w: bw + 2 * t + 2, h: bh + 2 * t + 2 });
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
      const row = dy <= 0.35 * mh && dx >= 1.05 * mw && dx <= 6 * mw, col = dx <= 0.35 * mw && dy >= 1.05 * mh && dy <= 6 * mh;
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
    return { id: meta.id, name: meta.name, W: base.W, H: base.H, ref: base.ref, align: meta.align || 'auto', mk: meta.mk || null, rx: bub.rx, ry: bub.ry, labels: meta.labels, groups };
  }

  root.OMR = {
    C, MARKERS, bubble, builtinTemplate, toGray, homography, orderQuad, findMarkers, findPage, alignPhoto,
    warpRGBA, warpGray, sampleTemplate, sampleBubbles, fitScore, decide, analyze, scanTpl, templateBase, detectBubbles, buildGroups, makeTemplate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OMR;
})(typeof self !== 'undefined' ? self : globalThis);
