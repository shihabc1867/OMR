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
  // Per bubble: darkness = 1 - (inner brightness / surrounding paper brightness) and fill = share of the inner disc that is inked.
  // "Inked" is judged against the bubble's own darkest level (half way between paper and its darkest part, at least 18% below paper),
  // so a light pencil mark that is completely filled still reads as 100% while a half shaded / ticked / dotted bubble reads as partial.
  // The sheet-wide median is subtracted from both (removes printed letters inside bubbles etc.)
  function sampleBubbles(g, W, H, tpl) {
    const dk = [], fl = [], rw = [];
    tpl.groups.forEach(gr => {
      const d = [], f = [];
      gr.pts.forEach(p => {
        const ring = Math.max(1, statPct(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 1.35, 1.9, 0.65));
        const n = collect(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 0, 0.7);
        let fr = 0;
        if (n) {
          const v = BUF.subarray(0, n), sorted = Float32Array.from(v).sort(), low = sorted[Math.floor(n * 0.05)];
          const cut = ring - Math.max(0.5 * (ring - low), 0.18 * ring);
          let ink = 0; for (let i = 0; i < n; i++) if (v[i] < cut) ink++;
          fr = ink / n;
        }
        const inner = statMean(g, W, H, p[0], p[1], tpl.rx, tpl.ry, 0, 0.5);
        d.push(Math.max(0, 1 - inner / ring)); f.push(fr);
      });
      dk.push(d); fl.push(f); rw.push(d.slice());
    });
    const norm = (m, scale) => { const flat = []; m.forEach(r => r.forEach(v => flat.push(v))); const base = med(flat), k = scale ? 1 / Math.max(0.2, 1 - base) : 1; return m.map(r => r.map(v => Math.min(1, Math.max(0, v - base) * k))); };
    return { dark: norm(dk, false), fill: norm(fl, true), raw: rw };
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
  // Strict reading of every question.
  //  touched bubble = anything inked (fill >= touch) or dark enough (dark >= thr)
  //  full mark      = touched, the inner disc is at least fillMin covered AND it is dark enough (raw darkness >= fullRaw; a faint grey wash is not a full mark)
  //  A question is INVALID (counted wrong) when it has a partly filled bubble or more than one touched bubble.
  // returns { sel: [[options]], bad: [bool], partial: [[options]] }
  function analyze(dark, fill, o, raw) {
    o = o || {};
    const thr = o.thr || 0.18, fillMin = o.fillMin || 0.7, touch = o.touch || 0.25, fullRaw = o.fullRaw || 0.45;
    const sel = [], bad = [], partial = [];
    dark.forEach((row, q) => {
      const s = [], p = [];
      row.forEach((d, i) => {
        const f = fill && fill[q] ? fill[q][i] : d;
        if (f >= touch || d >= thr) { s.push(i); const rr = raw && raw[q] ? raw[q][i] : d + 0.15;
          if (f < fillMin || rr < fullRaw) p.push(i); }
      });
      sel.push(s); partial.push(p); bad.push(p.length > 0 || s.length > 1);
    });
    return { sel, bad, partial };
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
      // Reference points in template space: the corner squares (tpl.mk, saved when the sheet type was created) or the template corners
      const mref = tpl.mk || tpl.ref;
      const ra = dist(mref[0], mref[1]) + dist(mref[3], mref[2]), rb = dist(mref[1], mref[2]) + dist(mref[0], mref[3]);
      let mode = tpl.align;
      if (mode === 'manual' && !tpl.mk) mode = 'none';          // old hand-placed template: only manual corners are known
      let a = alignPhoto(gray, w, h, mode === 'none' ? 'x' : mode, Math.max(ra, rb) / Math.min(ra, rb));
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
    return { found: true, how, rot, fit, ambiguous, quad: q, warped, dark: sm.dark, fill: sm.fill, raw: sm.raw };
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
