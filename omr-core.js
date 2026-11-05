/* omr-core.js — ছবি থেকে OMR শনাক্তকরণের মূল লজিক (ব্রাউজার ও Node দুই জায়গাতেই চলে) */
(function (root) {
  'use strict';

  // শিটের ক্যানভাস মাপ ও বৃত্তের অবস্থান (index.html/app.js এর সাথে একই)
  const C = { W: 1000, H: 1450, ROWS: 25, COLS: 4, OPT: 4, MK: 40, GX0: 80, COLW: 205, GY0: 235, RH: 46, BX0: 50, BDX: 38, BR: 13 };
  // কোণার কালো বর্গের কেন্দ্র: TL, TR, BR, BL (ঘড়ির কাঁটার দিকে)
  const MARKERS = [[50, 50], [950, 50], [950, 1400], [50, 1400]];

  // প্রশ্ন q (০-ভিত্তিক), অপশন o (০-৩) এর বৃত্তের কেন্দ্র
  function bubble(q, o) {
    const c = Math.floor(q / C.ROWS), r = q % C.ROWS;
    return [C.GX0 + c * C.COLW + C.BX0 + o * C.BDX, C.GY0 + r * C.RH];
  }

  function toGray(rgba, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
    return g;
  }

  // ---------- জ্যামিতি ----------
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

  // src (শিট) → dst (ছবি) পারস্পেক্টিভ ম্যাট্রিক্স
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
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (z > 0) pos++; else neg++;
    }
    return pos === 4 || neg === 4;
  }
  // চারটি বিন্দুকে ঘড়ির কাঁটার ক্রমে সাজায়, শুরু হয় ছবির উপরের-বাম কোণ থেকে
  function orderQuad(p) {
    const cx = p.reduce((s, t) => s + t[0], 0) / 4, cy = p.reduce((s, t) => s + t[1], 0) / 4;
    const s = p.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let k = 0;
    for (let i = 1; i < 4; i++) if (s[i][0] + s[i][1] < s[k][0] + s[k][1]) k = i;
    return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]];
  }

  // ---------- কোণার কালো বর্গ খোঁজা ----------
  function findMarkers(gray, w, h) {
    const iw = w + 1, I = new Float64Array(iw * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += gray[y * w + x]; I[(y + 1) * iw + x + 1] = I[y * iw + x + 1] + row; }
    }
    const half = Math.max(15, Math.round(Math.max(w, h) / 16));
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        const s = I[y1 * iw + x1] - I[y0 * iw + x1] - I[y1 * iw + x0] + I[y0 * iw + x0];
        if (gray[y * w + x] < (s / ((x1 - x0) * (y1 - y0))) * 0.55) mask[y * w + x] = 1;
      }
    }
    const seen = new Uint8Array(w * h), stack = new Int32Array(w * h), cands = [];
    const big = Math.max(w, h), minS = big * 0.012, maxS = big * 0.14;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue;
      let sp = 0, minx = w, maxx = 0, miny = h, maxy = 0, cnt = 0, sx = 0, sy = 0;
      stack[sp++] = i; seen[i] = 1;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p / w) | 0;
        cnt++; sx += x; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      if (bw < minS || bh < minS || bw > maxS || bh > maxS) continue;
      const ar = bw / bh; if (ar < 0.55 || ar > 1.8) continue;
      const fill = cnt / (bw * bh); if (fill < 0.65) continue;
      cands.push({ x: sx / cnt, y: sy / cnt, area: cnt, fill });
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

  // শিটের মাপে ছবিটি সোজা করা (RGBA)
  function warp(src, w, h, H) {
    const SW = C.W, SH = C.H, out = new Uint8ClampedArray(SW * SH * 4);
    const h0 = H[0], h1 = H[1], h2 = H[2], h3 = H[3], h4 = H[4], h5 = H[5], h6 = H[6], h7 = H[7], h8 = H[8];
    let o = 0;
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++, o += 4) {
        const d = h6 * x + h7 * y + h8, u = (h0 * x + h1 * y + h2) / d, v = (h3 * x + h4 * y + h5) / d;
        if (!(u >= 0 && v >= 0 && u < w - 1 && v < h - 1)) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; continue; }
        const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = (y0 * w + x0) * 4, j = i + w * 4;
        for (let k = 0; k < 3; k++) {
          out[o + k] = (src[i + k] * (1 - fx) + src[i + 4 + k] * fx) * (1 - fy) + (src[j + k] * (1 - fx) + src[j + 4 + k] * fx) * fy;
        }
        out[o + 3] = 255;
      }
    }
    return out;
  }

  // ---------- বৃত্তের কালিমা মাপা ----------
  function meanDisc(g, cx, cy, r0, r1) {
    const x0 = Math.max(0, Math.floor(cx - r1)), x1 = Math.min(C.W - 1, Math.ceil(cx + r1));
    const y0 = Math.max(0, Math.floor(cy - r1)), y1 = Math.min(C.H - 1, Math.ceil(cy + r1));
    const a = r0 * r0, b = r1 * r1;
    let s = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy, d = dx * dx + dy * dy;
      if (d >= a && d <= b) { s += g[y * C.W + x]; n++; }
    }
    return n ? s / n : 255;
  }
  // প্রতিটি বৃত্তের "কালিমা" = ১ − (ভেতরের উজ্জ্বলতা ÷ আশপাশের কাগজের উজ্জ্বলতা)
  function sample(g) {
    const out = [];
    for (let q = 0; q < C.ROWS * C.COLS; q++) {
      const row = [];
      for (let o = 0; o < C.OPT; o++) {
        const p = bubble(q, o);
        const inner = meanDisc(g, p[0], p[1], 0, 7), ring = meanDisc(g, p[0], p[1], 17, 21);
        row.push(Math.max(0, 1 - inner / Math.max(ring, 1)));
      }
      out.push(row);
    }
    return out;
  }
  // কালিমা থেকে দাগ দেওয়া অপশন নির্ধারণ। ফলাফল: প্রতি প্রশ্নে অপশন-সূচকের তালিকা
  function decide(dark, thr) {
    return dark.map(row => {
      const mx = Math.max.apply(null, row);
      if (mx < thr) return [];
      const lim = Math.max(thr, mx * 0.45), res = [];
      row.forEach((d, o) => { if (d >= lim) res.push(o); });
      return res;
    });
  }

  // সম্পূর্ণ পাইপলাইন: ছবি → সোজা করা শিট + কালিমা
  function scan(rgba, w, h, opts) {
    opts = opts || {};
    const gray = toGray(rgba, w, h), pts = findMarkers(gray, w, h);
    let H, found = false, rot = 0, landscape = false;
    if (pts) {
      found = true;
      landscape = dist(pts[0], pts[1]) > dist(pts[1], pts[2]);
      rot = typeof opts.rot === 'number' ? opts.rot : (landscape ? 1 : 0);
      H = homography(MARKERS, [0, 1, 2, 3].map(i => pts[(i + rot) % 4]));
    }
    if (!H) {
      found = false;
      H = homography([[0, 0], [C.W, 0], [C.W, C.H], [0, C.H]], [[0, 0], [w, 0], [w, h], [0, h]]);
    }
    const warped = warp(rgba, w, h, H);
    const dark = sample(toGray(warped, C.W, C.H));
    return { found, rot, landscape, warped, dark, H };
  }

  root.OMR = { C, MARKERS, bubble, toGray, homography, findMarkers, warp, sample, decide, scan };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OMR;
})(typeof self !== 'undefined' ? self : globalThis);
