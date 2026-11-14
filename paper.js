/* paper.js - question paper maker
 *  - 1-100 questions by hand or pasted all at once (sorted by their numbers), correct answers marked by tap
 *  - heading lines with their own bold / italic / underline / size / font, logo
 *  - questions: English font Times New Roman + Bangla font SutonnyOMJ (install it, or add the font file in the app), default 12 pt
 *  - inside a question:  <b>bold</b> <i>italic</i> <u>underline</u>  and maths between dollar signs: $x^{2}$ $\frac{a}{b}$ $\sqrt{x}$ $\alpha$ ...
 *  - an image per question
 *  - options: very short -> one line, medium -> two per line, long -> one per line
 *  - A4 PDF; "shrink to fit" keeps up to 60 questions on one page and more on two
 *  - "Save" also makes an answer key linked to the chosen OMR sheet type; papers live in the open workspace (shared in a group)
 */
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  const BN = '০১২৩৪৫৬৭৮৯';
  const toBn = s => String(s).replace(/[0-9]/g, d => BN[d]);
  const MAXQ = 100, PT = 150 / 72;                       // 1 pt = 2.083 px on the 150 dpi page canvas
  const LS_STYLES = {
    abcd: { name: '(a) (b) (c) (d)', l: ['a', 'b', 'c', 'd', 'e', 'f'] },
    ABCD: { name: '(A) (B) (C) (D)', l: ['A', 'B', 'C', 'D', 'E', 'F'] },
    bn: { name: '(ক) (খ) (গ) (ঘ)', l: ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ'], bn: true },
    bnum: { name: '(১) (২) (৩) (৪)', l: ['১', '২', '৩', '৪', '৫', '৬'], bn: true }
  };
  const optIndex = ch => { for (const L of [['a', 'b', 'c', 'd', 'e', 'f'], ['A', 'B', 'C', 'D', 'E', 'F'], ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ']]) { const i = L.indexOf(ch); if (i >= 0) return i; } return -1; };

  // ---------- paste parser ----------
  // Question lines start with a number (1. 1) ১। Q1. প্রশ্ন ১:), option lines with a letter ((a) a) A. ক) ...), several options may share a line.
  // "Ans: b" / "উত্তর: খ" lines, or a * ✓ after an option, mark the correct answer. Questions are put in the order of their numbers.
  const RE_Q = /^\s*(?:(?:Q(?:uestion)?|প্রশ্ন)\s*\.?\s*)?([0-9০-৯]{1,3})\s*[.)\]।:\-–](?![0-9০-৯])\s*(.*)$/i;
  const RE_O = /^\s*[(\[]?\s*([a-fA-Fক-চ])\s*[)\].।:]\s*(.*)$/;
  const RE_A = /^\s*(?:ans(?:wer)?|উত্তর|সঠিক\s*উত্তর)\s*[:\-=.]?\s*[(\[]?\s*([a-fA-Fক-চ])\s*[)\]]?\s*\.?\s*$/i;
  const RE_MARK = /\s*(?:\*+|✓|✔|\((?:ans|correct)\))\s*$/i;

  function splitInline(line, expect) {                  // expect = index of the option that should come next (0 = a/A/ক)
    expect = expect || 0;
    const re = /(^|\s)[(\[]?([a-fA-Fক-চ])[)\].।](?=\s|$)/g, hits = []; let m;
    while ((m = re.exec(line))) hits.push({ s: m.index + m[1].length, e: re.lastIndex, k: optIndex(m[2]) });
    const st = hits.findIndex(h => h.k === expect && (expect === 0 || h.s === 0)); if (st < 0) return null;
    const chain = [hits[st]];
    for (let i = st + 1; i < hits.length; i++) if (hits[i].k === expect + chain.length) chain.push(hits[i]);
    if (chain.length < 2) return null;
    const o = chain.map((h, i) => line.slice(h.e, i + 1 < chain.length ? chain[i + 1].s : line.length).trim());
    return { pre: line.slice(0, chain[0].s).trim(), o };
  }

  function parse(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const first = lines.find(l => l.trim());
    const numbered = !!(first && RE_Q.test(first));
    const out = []; let cur = null, blank = false;
    const start = (t, n) => { cur = { t: t || '', o: [], a: -1, n: n }; out.push(cur); };
    const addOpt = s => {
      if (!cur) start('');
      let t = String(s || '').trim();
      if (RE_MARK.test(t) && t.replace(RE_MARK, '')) { t = t.replace(RE_MARK, '').trim(); cur.a = cur.o.length; }
      cur.o.push(t);
    };
    const addText = s => {
      s = String(s || '').trim(); if (!s) return;
      if (!cur) { start(s); return; }
      if (cur.o.length) cur.o[cur.o.length - 1] += ' ' + s; else cur.t += (cur.t ? ' ' : '') + s;
    };
    function feed(line) {
      const sp = splitInline(line, cur ? cur.o.length : 0);
      if (sp) { if (sp.pre) addText(sp.pre); sp.o.forEach(addOpt); return; }
      const a = RE_A.exec(line); if (a && cur) { const k = optIndex(a[1]); if (k >= 0) cur.a = k; return; }
      const o = RE_O.exec(line); if (o) { addOpt(o[2]); return; }
      addText(line);
    }
    lines.forEach(raw => {
      const line = raw.trim();
      if (!line) { blank = true; return; }
      const q = numbered ? RE_Q.exec(line) : null;
      if (q) { start('', Number(String(q[1]).replace(/[০-৯]/g, c => BN.indexOf(c)))); blank = false; feed(q[2]); return; }
      if (!numbered && cur && cur.o.length && (blank || !(RE_O.test(line) || splitInline(line) || RE_A.test(line)))) { start(''); }
      blank = false; feed(line);
    });
    let res = out.map(q => ({ t: q.t.trim(), o: q.o.map(s => s.trim()), a: q.a < q.o.length ? q.a : -1, n: q.n })).filter(q => q.t || q.o.length);
    // put them in the order of their numbers (only when every question has its own number)
    if (numbered && res.length > 1 && res.every(q => q.n > 0) && new Set(res.map(q => q.n)).size === res.length) res = res.slice().sort((x, y) => x.n - y.n);
    return res.map(q => ({ t: q.t, o: q.o, a: q.a })).slice(0, MAXQ);
  }

  // ---------- fonts ----------
  const DEF_F = { en: 'Times New Roman', bn: 'SutonnyOMJ' };
  const FALL = ['Sutonny OMJ', 'SutonnyOMJ', 'Noto Serif Bengali', 'Noto Sans Bengali', 'Nirmala UI', 'Kohinoor Bangla', 'Liberation Serif'];
  function stack(a, b) { const seen = {}; return [a, b].concat(FALL).filter(n => n && !seen[n] && (seen[n] = 1)).map(n => '"' + n + '"').join(',') + ',serif'; }
  const fnt = (F, px, b, i, fam) => (i ? 'italic ' : '') + (b ? 'bold ' : '') + Math.round(px * 100) / 100 + 'px ' + stack(fam || F.en, F.bn);

  // ---------- rich text: <b> <i> <u>, $maths$ ----------
  function tokenize(src) {
    const out = []; let b = 0, i = 0, u = 0, w = '', k = 0; src = String(src == null ? '' : src);
    const flush = () => { if (w) { out.push({ k: 'w', s: w, b, i, u }); w = ''; } };
    while (k < src.length) {
      const ch = src[k];
      if (ch === '<') { const m = /^<(\/?)([biu])>/i.exec(src.slice(k, k + 4)); if (m) { flush(); const on = m[1] ? 0 : 1, t = m[2].toLowerCase(); if (t === 'b') b = on; else if (t === 'i') i = on; else u = on; k += m[0].length; continue; } }
      if (ch === '\\' && src[k + 1] === '$') { w += '$'; k += 2; continue; }
      if (ch === '$') { const e = src.indexOf('$', k + 1); if (e > k) { flush(); out.push({ k: 'm', s: src.slice(k + 1, e), b, i, u }); k = e + 1; continue; } }
      if (ch === '\n') { flush(); out.push({ k: 'nl' }); k++; continue; }
      if (/\s/.test(ch)) { flush(); if (!out.length || out[out.length - 1].k !== 'sp') out.push({ k: 'sp', b, i, u }); k++; continue; }
      w += ch; k++;
    }
    flush(); return out;
  }

  const SYM = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω', times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', degree: '°', circ: '°', sum: '∑', int: '∫', angle: '∠', therefore: '∴', because: '∵', perp: '⊥', parallel: '∥', in: '∈', subset: '⊂', cup: '∪', cap: '∩', partial: '∂', nabla: '∇', ldots: '…', prime: '′' };

  function mparse(s) {
    let i = 0;
    function seq(end) { const o = []; while (i < s.length && s[i] !== end) { const n = atom(); if (n) o.push(n); } return o; }
    function group() { i++; const r = seq('}'); i++; return r; }
    function arg() {
      while (s[i] === ' ') i++;
      if (s[i] === '{') return group();
      if (i >= s.length) return [];
      const n = atom(); return n ? [n] : [];
    }
    function atom() {
      const ch = s[i];
      if (ch === '{') return { t: 'g', b: group() };
      if (ch === '\\') {
        i++; const m = /^[A-Za-z]+/.exec(s.slice(i));
        if (!m) { const c = s[i++] || ''; return c === ' ' ? null : { t: 'c', s: c }; }
        i += m[0].length; const nm = m[0];
        if (nm === 'frac') { const a = arg(), b = arg(); return { t: 'f', n: a, d: b }; }
        if (nm === 'sqrt') { if (s[i] === '[') { const e = s.indexOf(']', i); i = e < 0 ? s.length : e + 1; } return { t: 'r', b: arg() }; }
        if (SYM[nm]) return { t: 'c', s: SYM[nm], sym: true };
        return { t: 'c', s: nm, sym: true };
      }
      if (ch === '^' || ch === '_') { i++; return { t: ch === '^' ? 'sup' : 'sub', b: arg() }; }
      i++; return { t: 'c', s: ch };
    }
    return seq();
  }
  function fold(ns) {
    const o = [];
    ns.forEach(n => {
      if (n.t === 'sup' || n.t === 'sub') {
        const p = o[o.length - 1];
        if (p && p.t === 's' && !p[n.t]) p[n.t] = n.b;
        else if (p && p.t !== 's') { const s = { t: 's', base: p }; s[n.t] = n.b; o[o.length - 1] = s; }
        else { const s = { t: 's', base: null }; s[n.t] = n.b; o.push(s); }
      } else o.push(n);
    });
    return o;
  }
  // every box: { w, a (above baseline), d (below), draw(ctx, x, baselineY) }
  function mseq(ctx, nodes, fs, F, st) {
    const bs = fold(nodes).map(n => mnode(ctx, n, fs, F, st));
    let w = 0, a = fs * 0.75, d = fs * 0.22; bs.forEach(b => { w += b.w; a = Math.max(a, b.a); d = Math.max(d, b.d); });
    return { w, a, d, draw(c, x, y) { let cx = x; bs.forEach(b => { b.draw(c, cx, y); cx += b.w; }); } };
  }
  function mnode(ctx, n, fs, F, st) {
    if (n.t === 'g') return mseq(ctx, n.b, fs, F, st);
    if (n.t === 'c') {
      const ch = n.s; if (ch === ' ') return { w: 0, a: 0, d: 0, draw() { } };
      const ital = /^[A-Za-z]$/.test(ch) && !n.sym, op = ch.length === 1 && '+-−=<>≤≥≠≈×÷±∓→←'.indexOf(ch) >= 0, pad = op ? fs * 0.2 : 0;
      ctx.font = fnt(F, fs, st.b, ital || st.i); const w = ctx.measureText(ch).width + 2 * pad;
      return { w, a: fs * 0.75, d: fs * 0.22, draw(c, x, y) { c.font = fnt(F, fs, st.b, ital || st.i); c.fillText(ch, x + pad, y); } };
    }
    if (n.t === 's') {
      const bb = n.base ? mnode(ctx, n.base, fs, F, st) : { w: 0, a: fs * 0.75, d: fs * 0.22, draw() { } }, sf = fs * 0.7;
      const sp = n.sup ? mseq(ctx, n.sup, sf, F, st) : null, sb = n.sub ? mseq(ctx, n.sub, sf, F, st) : null;
      const up = Math.max(bb.a * 0.62, fs * 0.42), dn = fs * 0.24 + (bb.d > fs * 0.3 ? bb.d * 0.5 : 0), sw = Math.max(sp ? sp.w : 0, sb ? sb.w : 0) + fs * 0.04;
      return { w: bb.w + sw, a: Math.max(bb.a, sp ? up + sp.a : 0), d: Math.max(bb.d, sb ? dn + sb.d : 0), draw(c, x, y) { bb.draw(c, x, y); if (sp) sp.draw(c, x + bb.w, y - up); if (sb) sb.draw(c, x + bb.w, y + dn); } };
    }
    if (n.t === 'f') {
      const ff = fs * 0.88, nb = mseq(ctx, n.n, ff, F, st), db = mseq(ctx, n.d, ff, F, st), ax = fs * 0.3, gap = fs * 0.14, w = Math.max(nb.w, db.w) + fs * 0.24;
      return { w, a: ax + gap + nb.d + nb.a, d: Math.max(fs * 0.2, db.a + db.d + gap - ax), draw(c, x, y) {
        const ay = y - ax; c.fillRect(x + fs * 0.05, ay - fs * 0.03, w - fs * 0.1, Math.max(1, fs * 0.06));
        nb.draw(c, x + (w - nb.w) / 2, ay - gap - nb.d); db.draw(c, x + (w - db.w) / 2, ay + gap + db.a);
      } };
    }
    if (n.t === 'r') {
      const bb = mseq(ctx, n.b, fs, F, st), rw = fs * 0.6, top = bb.a + fs * 0.2;
      return { w: rw + bb.w + fs * 0.12, a: top + fs * 0.08, d: bb.d, draw(c, x, y) {
        c.lineWidth = Math.max(1.2, fs * 0.06); c.strokeStyle = '#000'; c.lineJoin = 'miter'; c.beginPath();
        c.moveTo(x, y - top * 0.38); c.lineTo(x + rw * 0.22, y - top * 0.44); c.lineTo(x + rw * 0.45, y + bb.d); c.lineTo(x + rw, y - top); c.lineTo(x + rw + bb.w + fs * 0.1, y - top); c.stroke();
        bb.draw(c, x + rw + fs * 0.02, y);
      } };
    }
    return { w: 0, a: 0, d: 0, draw() { } };
  }

  // lay a text out in lines no wider than maxW (use a huge maxW for "natural" width); returns { lines, w, h, fs, F }
  function rich(ctx, src, fs, maxW, F) {
    const items = tokenize(src).map(at => {
      if (at.k === 'nl') return { t: 'nl', w: 0, a: 0, d: 0 };
      if (at.k === 'm') { const bx = mseq(ctx, mparse(at.s), fs, F, { b: at.b, i: at.i }); return { t: 'm', w: bx.w, a: bx.a, d: bx.d, bx }; }
      ctx.font = fnt(F, fs, at.b, at.i);
      return { t: at.k, s: at.s, w: ctx.measureText(at.k === 'sp' ? ' ' : at.s).width, a: fs * 0.8, d: fs * 0.25, b: at.b, i: at.i, u: at.u };
    });
    const lines = []; let cur = { items: [], w: 0 };
    const push = () => { while (cur.items.length && cur.items[cur.items.length - 1].t === 'sp') cur.w -= cur.items.pop().w; lines.push(cur); cur = { items: [], w: 0 }; };
    let i = 0;
    while (i < items.length) {
      const it = items[i];
      if (it.t === 'nl') { push(); i++; continue; }
      if (it.t === 'sp') { if (cur.items.length) { cur.items.push(it); cur.w += it.w; } i++; continue; }
      let j = i, uw = 0; while (j < items.length && items[j].t !== 'sp' && items[j].t !== 'nl') { uw += items[j].w; j++; }
      const unit = items.slice(i, j);
      if (cur.w + uw > maxW && cur.items.length) push();
      if (uw > maxW && unit.length === 1 && unit[0].t === 'w') {          // a single very long word: break it
        const it0 = unit[0]; let piece = '', pw = 0; ctx.font = fnt(F, fs, it0.b, it0.i);
        for (const ch of it0.s) {
          const cw = ctx.measureText(ch).width;
          if (piece && cur.w + pw + cw > maxW) { cur.items.push(Object.assign({}, it0, { s: piece, w: pw })); cur.w += pw; piece = ''; pw = 0; push(); }
          piece += ch; pw += cw;
        }
        if (piece) { cur.items.push(Object.assign({}, it0, { s: piece, w: pw })); cur.w += pw; }
      } else { unit.forEach(x => cur.items.push(x)); cur.w += uw; }
      i = j;
    }
    push();
    if (lines.length > 1 && !lines[lines.length - 1].items.length) lines.pop();
    let y = 0, w = 0;
    lines.forEach(ln => {
      let a = fs * 0.8, d = fs * 0.25; ln.items.forEach(x => { a = Math.max(a, x.a); d = Math.max(d, x.d); });
      ln.lh = Math.max(fs * 1.36, a + d + fs * 0.16); ln.base = (ln.lh - (a + d)) / 2 + a; ln.top = y; y += ln.lh; w = Math.max(w, ln.w);
    });
    return { lines, w, h: y, fs, F };
  }
  function drawRich(ctx, L, x, y) {
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#000';
    L.lines.forEach(ln => {
      let cx = x; const by = y + ln.top + ln.base;
      ln.items.forEach(it => {
        if (it.t === 'm') it.bx.draw(ctx, cx, by);
        else {
          if (it.t === 'w') { ctx.font = fnt(L.F, L.fs, it.b, it.i); ctx.fillText(it.s, cx, by); }
          if (it.u) ctx.fillRect(cx, by + L.fs * 0.12, it.w, Math.max(1, L.fs * 0.055));
        }
        cx += it.w;
      });
    });
  }

  // ---------- A4 page drawing (canvas, 150 dpi) ----------
  const PW = 1240, PH = 1754, M = 64, GUT = 40, MINPT = 6.5;
  let SC = 2.4, useSC = 2.4;                             // pages are drawn SC times bigger than the layout units (2.4 -> 360 dpi): sharp when zoomed; the on-screen preview uses less
  const DEF_HS = { l1: { b: 1, i: 0, u: 0, sz: 21, f: '' }, l2: { b: 1, i: 0, u: 0, sz: 17, f: '' }, l3: { b: 1, i: 0, u: 0, sz: 17, f: '' }, l4: { b: 1, i: 0, u: 1, sz: 17, f: '' }, info: { b: 0, i: 0, u: 0, sz: 13, f: '' } };
  const HCOL = { l1: '#000', l2: '#000', l3: '#d6339a', l4: '#2f4aa0', info: '#000' };
  const hstyle = (hs, k) => Object.assign({}, DEF_HS[k], (hs || {})[k] || {});

  function newPage() {
    const c = document.createElement('canvas'); let x = null;
    for (; useSC >= 1; useSC = Math.max(1, useSC - 0.6)) { c.width = Math.round(PW * useSC); c.height = Math.round(PH * useSC); x = c.getContext('2d'); if (x) break; if (useSC <= 1) break; }
    x.setTransform(useSC, 0, 0, useSC, 0, 0); x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH); x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    return { c, x };
  }
  // logo on the left, the heading lines centred on the page, then a rule. Returns the y below the heading.
  function drawHeader(x, paper, logo) {
    const h = paper.head || {}, F = paper.F || DEF_F, L = 150, top = 46, hasLogo = !!logo;
    if (hasLogo) { const k = Math.min(L / logo.width, L / logo.height); x.drawImage(logo, M, top + (L - logo.height * k) / 2, logo.width * k, logo.height * k); }
    const x0 = hasLogo ? M + L + 20 : M, maxW = 2 * (PW / 2 - x0); let y = top;
    x.textAlign = 'center';
    ['l1', 'l2', 'l3', 'l4', 'info'].forEach(k => {
      const t = h[k]; if (!t || !String(t).trim()) return;
      const st = hstyle(paper.hs, k); let px = st.sz * PT;
      x.font = fnt(F, px, st.b, st.i, st.f); while (px > 14 && x.measureText(t).width > maxW) { px -= 1; x.font = fnt(F, px, st.b, st.i, st.f); }
      x.fillStyle = HCOL[k]; const base = y + px * 0.88; x.fillText(t, PW / 2, base);
      if (st.u) { const w = x.measureText(t).width; x.fillRect(PW / 2 - w / 2, base + px * 0.12, w, Math.max(2, px * 0.07)); }
      y += px * 1.3 + (k === 'info' ? 6 : 8);
    });
    x.textAlign = 'left'; y = Math.max(y, hasLogo ? top + L : 0) + 6;
    x.fillStyle = '#000'; x.fillRect(M, y, PW - 2 * M, 3);
    return y + 18;
  }

  // One question as a block (positions relative to its top-left). S = { fs, F, st, imgs }
  function layoutQ(ctx, q, i, S, colW, nw) {
    const fs = S.fs, F = S.F, st = S.st, gap = Math.round(fs * 0.7), parts = [];
    const tl = rich(ctx, q.t || '', fs, colW - nw, F); let y = tl.h;
    const num = (st.bn ? toBn(i + 1) : String(i + 1)) + '.';
    const img = q.img && S.imgs && S.imgs[q.img];
    if (img) {
      const mw = (colW - nw) * Math.min(100, Math.max(15, q.iw || 60)) / 100, k = Math.min(mw / img.width, 700 / img.height, 1.6), iw = img.width * k, ih = img.height * k;
      parts.push({ x: nw, y: y + fs * 0.2, img, iw, ih }); y += ih + fs * 0.5;
    }
    const n = (q.o || []).length, avail = colW - nw, g = fs * 1.3;
    if (n) {
      const lab = j => '(' + st.l[j] + ') ' + (q.o[j] || ''), nat = q.o.map((t, j) => rich(ctx, lab(j), fs, 1e9, F)), W = nat.map(l => l.w);
      if (nat.every(l => l.lines.length === 1) && W.reduce((a, b) => a + b, 0) + g * (n - 1) <= avail) {             // very short: one line
        let cx = nw; nat.forEach((l, j) => { parts.push({ x: cx, y, L: l }); cx += W[j] + g; }); y += Math.max.apply(null, nat.map(l => l.h));
      } else if (n > 1 && nat.every(l => l.lines.length === 1) && Math.max.apply(null, W) <= (avail - g) / 2) {   // medium: two per line
        const half = (avail - g) / 2 + g;
        for (let r = 0; r < n; r += 2) { let rh = 0; for (let c = 0; c < 2 && r + c < n; c++) { parts.push({ x: nw + c * half, y, L: nat[r + c] }); rh = Math.max(rh, nat[r + c].h); } y += rh; }
      } else {                                                                                                          // long: one per line
        q.o.forEach((t, j) => { const l = rich(ctx, lab(j), fs, avail, F); parts.push({ x: nw, y, L: l }); y += l.h; });
      }
    }
    return { h: y + gap, gap, draw(c, X, Y) {
      c.font = fnt(F, fs, true); c.fillStyle = '#000'; c.textBaseline = 'alphabetic'; c.fillText(num, X, Y + (tl.lines[0] ? tl.lines[0].top + tl.lines[0].base : fs));
      drawRich(c, tl, X + nw, Y);
      parts.forEach(p => { if (p.img) c.drawImage(p.img, X + p.x, Y + p.y, p.iw, p.ih); else drawRich(c, p.L, X + p.x, Y + p.y); });
    } };
  }
  const numW = (ctx, F, fs, total) => { ctx.font = fnt(F, fs, true); return Math.ceil(ctx.measureText(total >= 100 ? '000.' : '00.').width) + 8; };

  // place every question into the columns at this size; returns placements or null
  function flow(ctx, qs, S, cols, colW) {
    const nw = numW(ctx, S.F, S.fs, qs.length), place = []; let k = 0, y = cols[0].top;
    for (let i = 0; i < qs.length; i++) {
      const b = layoutQ(ctx, qs[i], i, S, colW, nw);
      if (y + b.h - b.gap > cols[k].bottom && y > cols[k].top) { k++; if (k >= cols.length) return null; y = cols[k].top; }
      if (y + b.h - b.gap > cols[k].bottom) return null;
      place.push({ b, col: cols[k], y }); y += b.h;
    }
    return place;
  }

  // paper: { head, hs, F:{en,bn}, fs (pt), fit, ls, qs, name }; logo: <img>|null; imgs: {id: <img>}.   Returns { pages:[canvas], pt, note }
  function render(paper, logo, imgs, scale) {
    useSC = scale || SC;
    const st = LS_STYLES[paper.ls] || LS_STYLES.abcd, qs = paper.qs || [], F = Object.assign({}, DEF_F, paper.F || {});
    const maxPt = Math.min(30, Math.max(MINPT, Number(paper.fs) || 12)), fit = paper.fit !== false;
    const p1 = newPage(), x = p1.x, pages = [p1], hy = drawHeader(x, Object.assign({}, paper, { F }), logo), colW = (PW - 2 * M - GUT) / 2;
    const colsFor = P => { const cols = []; for (let p = 0; p < P; p++) for (let c = 0; c < 2; c++) cols.push({ p, x: M + c * (colW + GUT), top: p === 0 ? hy : M + 44, bottom: PH - M - 34 }); return cols; };
    const attempt = (pt, P) => { const cols = colsFor(P), pl = flow(x, qs, { fs: pt * PT, F, st, imgs: imgs || {} }, cols, colW); return pl ? { pl, pt, P, cols } : null; };
    let found = null, note = '';
    const base = qs.length > 60 ? 2 : 1;
    if (!fit) { for (let P = 1; P <= 14 && !found; P++) found = attempt(maxPt, P); }
    else {
      for (let P = base; P <= base + 8 && !found; P++) {
        found = attempt(maxPt, P);
        if (!found) { let best = attempt(MINPT, P); if (best) { let lo = MINPT, hi = maxPt; for (let k = 0; k < 9; k++) { const mid = (lo + hi) / 2, t = attempt(mid, P); if (t) { best = t; lo = mid; } else hi = mid; } found = best; } }
      }
    }
    if (!found) return { pages: [p1.c], pt: 0, note: 'The questions are too long to fit — shorten some of them.' };
    if (fit && found.P > base) note = 'These questions need ' + found.P + ' pages even at the smallest readable text. Shorten some questions to fit ' + base + '.';
    else if (fit && found.pt < maxPt - 0.01) note = 'Text size reduced from ' + maxPt + ' pt to ' + (Math.floor(found.pt * 10) / 10) + ' pt to fit ' + found.P + ' page' + (found.P > 1 ? 's' : '') + '.';
    for (let p = 1; p < found.P; p++) pages.push(newPage());
    const small = '22px "Times New Roman","Noto Serif Bengali",serif';
    pages.forEach((pg, p) => {
      const c = pg.x, top = p === 0 ? hy : M + 44; c.fillStyle = '#94a3b8'; c.fillRect(M + colW + GUT / 2 - 1, top, 2, PH - M - 34 - top);
      c.font = small; c.textAlign = 'center'; c.fillStyle = '#64748b';
      if (p > 0) { c.fillText((paper.name || '') + ' — continued', PW / 2, M - 8); c.fillRect(M, M + 26, PW - 2 * M, 2); }
      if (found.P > 1) c.fillText('Page ' + (p + 1) + ' of ' + found.P, PW / 2, PH - 40);
      c.textAlign = 'left';
    });
    found.pl.forEach(it => it.b.draw(pages[it.col.p].x, it.col.x, it.y));
    return { pages: pages.map(p => p.c), pt: found.pt, note };
  }

  // one question on its own canvas (live preview in the editor)
  function renderOne(paper, i, imgs, width) {
    const st = LS_STYLES[paper.ls] || LS_STYLES.abcd, F = Object.assign({}, DEF_F, paper.F || {}), fs = (Number(paper.fs) || 12) * PT;
    const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = width || 536; c.height = 10;
    const b = layoutQ(x, paper.qs[i], i, { fs, F, st, imgs: imgs || {} }, c.width, numW(x, F, fs, paper.qs.length));
    c.width = width || 536; c.height = Math.ceil(b.h - b.gap + 8); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.textBaseline = 'alphabetic'; b.draw(x, 0, 2);
    return c;
  }

  root.Paper = { parse, render, renderOne, rich, toBn, LS_STYLES, DEF_HS, _splitInline: splitInline, _tokenize: tokenize, _mparse: mparse };

  // ======================= editor UI =======================
  if (typeof document === 'undefined' || !document.querySelector('#v-qp')) return;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const App = () => root.OMRApp;
  const blankQ = () => ({ t: '', o: ['', '', '', ''], a: -1 });
  const blankPaper = () => ({ id: '', name: '', tplId: 'builtin', keyId: '', ls: 'abcd', logo: '', fs: 12, fit: true, F: Object.assign({}, DEF_F), hs: {}, head: { l1: '', l2: '', l3: '', l4: 'Question Paper', info: '' }, qs: [], images: {} });
  let cur = blankPaper(), dirty = false, lastField = null, custom = [];     // custom = names of fonts the user added
  const msg = (t, ok) => { const m = $('#qpMsg'); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); };
  const label = j => '(' + (LS_STYLES[cur.ls] || LS_STYLES.abcd).l[j] + ')';
  const touch = () => { dirty = true; };
  const BASEF = ['Times New Roman', 'SutonnyOMJ', 'Arial', 'Noto Sans Bengali', 'Courier New'];
  const fontNames = () => BASEF.concat(custom.filter(n => BASEF.indexOf(n) < 0));

  // ---- fonts added by the user (kept in the phone's IndexedDB) ----
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('omr_fonts', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbAll = async () => { const d = await idb(); return new Promise(res => { const out = [], c = d.transaction('f').objectStore('f').openCursor(); c.onsuccess = () => { const cu = c.result; if (cu) { out.push({ name: cu.key, data: cu.value }); cu.continue(); } else res(out); }; c.onerror = () => res(out); }); };
  const idbPut = async (k, v) => { const d = await idb(); return new Promise(res => { const t = d.transaction('f', 'readwrite'); t.objectStore('f').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); }); };
  async function addFont(name, data) { const ff = new FontFace(name, data); await ff.load(); document.fonts.add(ff); if (custom.indexOf(name) < 0) custom.push(name); }
  async function restoreFonts() { try { const all = await idbAll(); for (const f of all) { try { await addFont(f.name, f.data); } catch (e) { /* skip a broken font */ } } await document.fonts.ready; fillFontSel(); renderHead(); applyFontCss(); pvAll(); } catch (e) { /* no IndexedDB: fonts just have to be installed */ } }
  $('#qpFontBtn').onclick = () => $('#qpFontIn').click();
  $('#qpFontIn').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let name = f.name.replace(/\.[^.]+$/, '').replace(/[^\w \-]/g, '').trim(); if (/sutonny/i.test(name)) name = 'SutonnyOMJ';
    name = (prompt('Name of this font', name) || '').trim(); if (!name) return;
    try {
      const data = await f.arrayBuffer(); await addFont(name, data.slice(0));
      if (/sutonny/i.test(name) && name !== 'Sutonny OMJ') { try { await addFont('Sutonny OMJ', data.slice(0)); } catch (x) { /* ignore */ } }
      await idbPut(name, data); fillFontSel(); renderHead(); applyFontCss(); pvAll(); msg('✔ Font “' + name + '” added on this phone. Choose it in the font lists.', true);
    } catch (er) { msg('This file could not be used as a font. Use a .ttf, .otf or .woff file.'); }
  };
  function fillFontSel() {
    ['#qpFEn', '#qpFBn'].forEach(id => { const s = $(id); s.innerHTML = fontNames().map(n => `<option>${esc(n)}</option>`).join(''); });
    $('#qpFEn').value = cur.F.en; $('#qpFBn').value = cur.F.bn;
  }
  function applyFontCss() { const css = stack(cur.F.en, cur.F.bn); $('#qpList').style.fontFamily = css; $('#qpPaste').style.fontFamily = css; }

  // ---- images ----
  // The picture saved in the shared paper is small (it has to fit in a spreadsheet cell). The sharp original stays in this phone's IndexedDB
  // and is used here for the preview and the PDF, so the pictures in the PDF stay sharp when zoomed.
  const imgEls = {};
  const idbI = () => new Promise((res, rej) => { const r = indexedDB.open('omr_imgs', 1); r.onupgradeneeded = () => r.result.createObjectStore('i'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const bigPut = async (k, v) => { try { const d = await idbI(); return await new Promise(res => { const t = d.transaction('i', 'readwrite'); t.objectStore('i').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); }); } catch (e) { return false; } };
  const bigGet = async k => { try { const d = await idbI(); return await new Promise(res => { const q = d.transaction('i').objectStore('i').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } };
  const loadEl = d => new Promise(res => { if (imgEls[d]) { res(imgEls[d]); return; } const im = new Image(); im.onload = () => { imgEls[d] = im; res(im); }; im.onerror = () => res(null); im.src = d; });
  const dataImg = async id => { const d = cur.images[id]; if (!d) return null; const big = await bigGet(id); return (big && await loadEl(big)) || await loadEl(d); };
  async function imgMap() { const m = {}; for (const q of cur.qs) if (q.img && !m[q.img]) { const im = await dataImg(q.img); if (im) m[q.img] = im; } return m; }
  let bigURL = '';
  function shrinkImage(file) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('This file is not a picture.')); };
      im.onload = () => {
        URL.revokeObjectURL(u);
        const kb = Math.min(1, 1600 / Math.max(im.width, im.height)), cb = document.createElement('canvas'); cb.width = Math.max(1, Math.round(im.width * kb)); cb.height = Math.max(1, Math.round(im.height * kb));
        const xb = cb.getContext('2d'); xb.fillStyle = '#fff'; xb.fillRect(0, 0, cb.width, cb.height); xb.drawImage(im, 0, 0, cb.width, cb.height); bigURL = cb.toDataURL('image/jpeg', 0.88);
        for (const side of [760, 620, 500, 400, 320, 240]) for (const q of [0.78, 0.62, 0.48, 0.36]) {
          const k = Math.min(1, side / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
          const d = c.toDataURL('image/jpeg', q); if (d.length <= 44000) { res(d); return; }
        }
        rej(new Error('This picture is too detailed. Use a smaller or simpler picture.'));
      };
      im.src = u;
    });
  }
  $('#qpImgIn').onchange = async e => {
    const f = e.target.files[0], i = Number(e.target.dataset.i); e.target.value = ''; if (!f || !cur.qs[i]) return;
    try { const d = await shrinkImage(f), id = 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); cur.images[id] = d; if (bigURL) await bigPut(id, bigURL); cur.qs[i].img = id; cur.qs[i].iw = cur.qs[i].iw || 60; touch(); refreshQ(i); } catch (er) { msg(er.message); }
  };

  // ---- heading ----
  function renderHead() {
    $('#qpName').value = cur.name; $('#qpLs').value = cur.ls; $('#qpFs').value = cur.fs; $('#qpFit').checked = cur.fit !== false;
    ['l1', 'l2', 'l3', 'l4', 'info'].forEach(k => {
      $('#qpH_' + k).value = cur.head[k] || ''; const st = hstyle(cur.hs, k), box = $('#qpHS_' + k);
      box.innerHTML = ['b', 'i', 'u'].map(s => `<button class="sb${st[s] ? ' on' : ''}" data-k="${k}" data-s="${s}" style="${s === 'b' ? 'font-weight:700' : s === 'i' ? 'font-style:italic' : 'text-decoration:underline'}">${s.toUpperCase()}</button>`).join('') +
        `<input type="number" min="6" max="40" step="0.5" value="${st.sz}" data-k="${k}" data-s="sz"> pt <select data-k="${k}" data-s="f"><option value="">Paper font</option>${fontNames().map(n => `<option${st.f === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    });
    const p = $('#qpLogoPrev'); p.hidden = !cur.logo; if (cur.logo) p.src = cur.logo; $('#qpLogoDel').hidden = !cur.logo;
    $('#qpFEn').value = cur.F.en; $('#qpFBn').value = cur.F.bn;
  }
  $('#v-qp').addEventListener('click', e => { const b = e.target.closest('.hs .sb'); if (!b) return; const k = b.dataset.k, s = b.dataset.s; cur.hs[k] = Object.assign({}, hstyle(cur.hs, k)); cur.hs[k][s] = cur.hs[k][s] ? 0 : 1; b.classList.toggle('on', !!cur.hs[k][s]); touch(); });
  $('#v-qp').addEventListener('change', e => { const t = e.target; if (!t.closest('.hs')) return; const k = t.dataset.k, s = t.dataset.s; cur.hs[k] = Object.assign({}, hstyle(cur.hs, k)); cur.hs[k][s] = s === 'sz' ? Math.min(40, Math.max(6, Number(t.value) || DEF_HS[k].sz)) : t.value; touch(); });

  // ---- question list ----
  const hasRich = q => !!q.img || /[$<\\]/.test((q.t || '') + (q.o || []).join(''));
  function qHtml(q, i) {
    const opts = q.o.map((t, j) => `<div class="qo"><button class="ob${q.a === j ? ' on' : ''}" data-act="ans" data-o="${j}" title="Tap = correct answer">${esc(label(j))}</button><input data-f="o" data-o="${j}" value="${esc(t)}" placeholder="Option ${j + 1}"></div>`).join('');
    const im = q.img && cur.images[q.img] ? `<div class="qimg"><img src="${cur.images[q.img]}" alt=""><select data-act="iw" title="Picture size"><option value="30"${q.iw == 30 ? ' selected' : ''}>Small</option><option value="50"${q.iw == 50 ? ' selected' : ''}>Medium</option><option value="60"${!q.iw || q.iw == 60 ? ' selected' : ''}>Large</option><option value="100"${q.iw == 100 ? ' selected' : ''}>Full width</option></select><button class="b red sm" data-act="rmimg">Remove picture</button></div>` : '';
    return `<div class="qi" data-i="${i}"><div class="qh"><b>${i + 1}</b><span class="qa">${q.a >= 0 ? 'Answer: ' + esc(label(q.a)) : 'no answer marked'}</span><span><button class="b alt sm" data-act="mv" title="Move to another number">⇅</button><button class="b alt sm" data-act="up">↑</button><button class="b alt sm" data-act="dn">↓</button><button class="b red sm" data-act="del">✕</button></span></div>` +
      `<textarea data-f="t" rows="${Math.max(2, Math.min(7, Math.ceil((q.t || '').length / 38)))}" placeholder="Question ${i + 1}">${esc(q.t)}</textarea>${im}${opts}` +
      `<div class="qh"><span><button class="b alt sm" data-act="addo">＋ option</button> <button class="b alt sm" data-act="delo">－ option</button> <button class="b alt sm" data-act="img">🖼 Picture</button></span></div><canvas class="qpv" data-pv="${i}" hidden></canvas></div>`;
  }
  function renderQs() {
    $('#qpList').innerHTML = cur.qs.map(qHtml).join('') || '<p class="hint">No questions yet. Tap “Add question”, set the number of questions above, or paste them all at once.</p>';
    $('#qpCount').value = cur.qs.length; tplNote(); pvAll();
  }
  function refreshQ(i) { const e = $('#qpList [data-i="' + i + '"]'); if (e) { e.outerHTML = qHtml(cur.qs[i], i); pvOne(i); } }
  const pvT = {};
  function pvSched(i) { clearTimeout(pvT[i]); pvT[i] = setTimeout(() => pvOne(i), 350); }
  async function pvOne(i) {
    const cv = $('#qpList canvas[data-pv="' + i + '"]'), q = cur.qs[i]; if (!cv || !q) return;
    if (!hasRich(q)) { cv.hidden = true; return; }
    try { const c = renderOne(cur, i, await imgMap()); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); cv.hidden = false; } catch (e) { cv.hidden = true; }
  }
  const pvAll = () => { cur.qs.forEach((q, i) => { if (hasRich(q)) pvOne(i); }); };

  function tplNote() {
    const tpl = App().getTpl(cur.tplId), n = tpl ? tpl.groups.length : 0, mo = Math.max.apply(null, [0].concat(cur.qs.map(q => q.o.length)));
    let t = tpl ? 'This sheet reads ' + n + ' question(s), ' + (tpl.labels ? tpl.labels.length : '?') + ' options each.' : 'Sheet type not found on this device.';
    if (tpl && cur.qs.length > n) t += ' ⚠ The paper has ' + cur.qs.length + ' questions, so answers after question ' + n + ' will not be graded.';
    if (tpl && tpl.labels && mo > tpl.labels.length) t += ' ⚠ Some questions have more options than the sheet.';
    $('#qpTplNote').textContent = t;
  }
  function fillTpl() { const s = $('#qpTpl'); s.innerHTML = App().tpls().map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''); if (!App().getTpl(cur.tplId)) cur.tplId = 'builtin'; s.value = cur.tplId; }
  function fillSel() {
    const P = App().papers(), ids = Object.keys(P).sort((a, b) => (P[b].updated || 0) - (P[a].updated || 0)), s = $('#qpSel');
    s.innerHTML = '<option value="">＋ New question paper</option>' + ids.map(id => `<option value="${esc(id)}">${esc(P[id].name)} (${(P[id].qs || []).length} Q${P[id].by ? ' · ' + esc(P[id].by) : ''})</option>`).join('');
    s.value = cur.id && P[cur.id] ? cur.id : '';
    $('#qpShare').textContent = App().isGroup() ? '👥 Papers saved here are shared with every member of this group.' : 'Papers saved here are private to your workspace. Switch to a group (top right) to share them.';
  }
  function load(id) {
    const p = id && App().papers()[id];
    if (p) {
      cur = Object.assign(blankPaper(), JSON.parse(JSON.stringify(p)));
      cur.head = Object.assign({ l1: '', l2: '', l3: '', l4: '', info: '' }, cur.head); cur.hs = cur.hs || {}; cur.F = Object.assign({}, DEF_F, cur.F || {}); cur.fs = Number(cur.fs) || 12; cur.fit = cur.fit !== false;
      cur.qs = (cur.qs || []).map(q => ({ t: q.t || '', o: (q.o || []).slice(), a: typeof q.a === 'number' ? q.a : -1, img: q.img || undefined, iw: q.iw || undefined })); cur.ls = cur.ls || 'abcd';
      cur.images = {}; const all = App().images(); cur.qs.forEach(q => { if (q.img && all[q.img]) cur.images[q.img] = all[q.img]; else q.img = undefined; });
    } else {
      cur = blankPaper(); const w = App().wsHead(); cur.head = { l1: w.l1 || '', l2: w.l2 || '', l3: '', l4: 'Question Paper', info: '' }; cur.logo = App().wsLogo();
    }
    dirty = false; fillTpl(); fillFontSel(); renderHead(); applyFontCss(); renderQs(); fillSel(); $('#qpPrev').innerHTML = ''; msg('');
  }

  // ---- toolbar: bold / italic / underline / maths / symbols ----
  const SYMS = ['α', 'β', 'γ', 'θ', 'λ', 'μ', 'π', 'σ', 'φ', 'ω', 'Δ', 'Σ', 'Ω', '°', '±', '×', '÷', '≤', '≥', '≠', '≈', '∞', '→', '√', '∠', '∴', '²', '³', '½'];
  $('#qpTb').innerHTML = '<button data-t="b"><b>B</b></button><button data-t="i"><i>I</i></button><button data-t="u"><u>U</u></button><span class="sep"></span>' +
    '<button data-t="sup" title="Power">x²</button><button data-t="sub" title="Subscript">x₂</button><button data-t="frac" title="Fraction">a⁄b</button><button data-t="sqrt" title="Square root">√x</button><span class="sep"></span>' + SYMS.map(s => `<button data-c="${s}">${s}</button>`).join('');
  document.addEventListener('focusin', e => { const t = e.target; if (t.closest && t.closest('#qpList') && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.dataset.f))) lastField = t; });
  $('#qpTb').addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });      // keep the cursor in the question
  $('#qpTb').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const f = lastField; if (!f || !document.body.contains(f)) { msg('Tap inside a question or option first, then use these buttons.'); return; }
    const a = f.selectionStart, z = f.selectionEnd, sel = f.value.slice(a, z), t = b.dataset.t; let ins = '', s0 = -1, s1 = -1;
    if (b.dataset.c) ins = b.dataset.c;
    else if (t === 'b' || t === 'i' || t === 'u') { ins = '<' + t + '>' + sel + '</' + t + '>'; if (!sel) { s0 = s1 = a + 3; } }
    else if (t === 'sup') { ins = '$' + (sel || 'x') + '^{2}$'; s0 = a + ins.length - 3; s1 = s0 + 1; }
    else if (t === 'sub') { ins = '$' + (sel || 'x') + '_{1}$'; s0 = a + ins.length - 3; s1 = s0 + 1; }
    else if (t === 'frac') { ins = '$\\frac{' + (sel || 'a') + '}{b}$'; s0 = a + 7; s1 = s0 + (sel || 'a').length; }
    else if (t === 'sqrt') { ins = '$\\sqrt{' + (sel || 'x') + '}$'; s0 = a + 8; s1 = s0 + (sel || 'x').length; }
    f.focus(); f.setRangeText(ins, a, z, 'end'); if (s0 >= 0) f.setSelectionRange(s0, s1);
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // ---- events ----
  $('#qpSel').onchange = () => { if (dirty && !confirm('Discard the changes you made to this paper?')) { fillSel(); return; } load($('#qpSel').value); };
  $('#qpName').oninput = e => { cur.name = e.target.value; touch(); };
  ['l1', 'l2', 'l3', 'l4', 'info'].forEach(k => { $('#qpH_' + k).oninput = e => { cur.head[k] = e.target.value; touch(); }; });
  $('#qpLs').onchange = e => { cur.ls = e.target.value; touch(); renderQs(); };
  $('#qpTpl').onchange = e => { cur.tplId = e.target.value; touch(); tplNote(); };
  const setFs = v => { cur.fs = Math.min(30, Math.max(6, Math.round(v * 2) / 2 || 12)); $('#qpFs').value = cur.fs; touch(); pvAll(); };
  $('#qpFs').onchange = e => setFs(Number(e.target.value)); $('#qpFsM').onclick = () => setFs(cur.fs - 0.5); $('#qpFsP').onclick = () => setFs(cur.fs + 0.5);
  $('#qpFit').onchange = e => { cur.fit = e.target.checked; touch(); };
  $('#qpFEn').onchange = e => { cur.F.en = e.target.value; touch(); applyFontCss(); pvAll(); };
  $('#qpFBn').onchange = e => { cur.F.bn = e.target.value; touch(); applyFontCss(); pvAll(); };
  $('#qpNewTpl').onclick = () => { if (App().canUp()) App().gotoTab('tpl'); else msg('Only the admin (or a user the admin allowed) can add new sheet types. Ask the admin, or pick an existing one.'); };
  $('#qpLogoBtn').onclick = () => $('#qpLogoIn').click();
  $('#qpLogoIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { cur.logo = await App().resizeLogo(f); touch(); renderHead(); } catch (er) { msg(er.message); } };
  $('#qpLogoWs').onclick = () => { const l = App().wsLogo(); if (!l) { msg('No workspace logo yet (Settings tab). Use “Add logo” instead.'); return; } cur.logo = l; touch(); renderHead(); };
  $('#qpLogoDel').onclick = () => { cur.logo = ''; touch(); renderHead(); };

  $('#qpAdd').onclick = () => { if (cur.qs.length >= MAXQ) { msg('Maximum ' + MAXQ + ' questions.'); return; } cur.qs.push(blankQ()); touch(); renderQs(); const t = $('#qpList').lastElementChild; if (t) t.scrollIntoView({ block: 'center' }); };
  $('#qpCount').onchange = e => {
    let n = Math.round(Number(e.target.value)); if (!(n >= 0)) n = cur.qs.length; n = Math.min(MAXQ, n);
    if (n < cur.qs.length && cur.qs.slice(n).some(q => q.t || q.o.some(Boolean)) && !confirm('Remove questions ' + (n + 1) + '–' + cur.qs.length + '?')) { e.target.value = cur.qs.length; return; }
    while (cur.qs.length < n) cur.qs.push(blankQ()); cur.qs.length = n; touch(); renderQs();
  };
  $('#qpPasteBtn').onclick = () => {
    const got = Paper.parse($('#qpPaste').value);
    if (!got.length) { msg('Could not find any question. Start each question with a number (1. 2. 3.) and each option with a letter ((a) (b) (c) (d) or ক) খ) গ) ঘ)).'); return; }
    const rep = $('#qpRep').checked; if (rep && cur.qs.length && !confirm('Replace the ' + cur.qs.length + ' existing question(s)?')) return;
    const base = rep ? [] : cur.qs, room = MAXQ - base.length, add = got.slice(0, room);
    cur.qs = base.concat(add); touch(); renderQs(); $('#qpPaste').value = '';
    const marked = add.filter(q => q.a >= 0).length;
    msg('✔ ' + add.length + ' question(s) added in number order' + (got.length > room ? ' (only ' + MAXQ + ' allowed — the rest was left out)' : '') + (marked ? ', ' + marked + ' answer(s) picked up.' : '. Now tap the correct option of each question.'), true);
  };
  $('#qpList').addEventListener('input', e => {
    const t = e.target, box = t.closest('.qi'); if (!box) return; const i = Number(box.dataset.i), q = cur.qs[i]; if (!q) return;
    if (t.dataset.f === 't') q.t = t.value; else if (t.dataset.f === 'o') q.o[Number(t.dataset.o)] = t.value; touch(); pvSched(i);
  });
  $('#qpList').addEventListener('change', e => { const t = e.target; if (t.dataset.act !== 'iw') return; const i = Number(t.closest('.qi').dataset.i); cur.qs[i].iw = Number(t.value); touch(); pvOne(i); });
  $('#qpList').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return; const box = b.closest('.qi'), i = Number(box.dataset.i), q = cur.qs[i], a = b.dataset.act;
    if (a === 'ans') { const j = Number(b.dataset.o); q.a = q.a === j ? -1 : j; touch(); refreshQ(i); }
    else if (a === 'del') { if ((q.t || q.o.some(Boolean)) && !confirm('Delete question ' + (i + 1) + '?')) return; cur.qs.splice(i, 1); touch(); renderQs(); }
    else if (a === 'up' && i > 0) { [cur.qs[i - 1], cur.qs[i]] = [cur.qs[i], cur.qs[i - 1]]; touch(); renderQs(); }
    else if (a === 'dn' && i < cur.qs.length - 1) { [cur.qs[i + 1], cur.qs[i]] = [cur.qs[i], cur.qs[i + 1]]; touch(); renderQs(); }
    else if (a === 'mv') { const n = Number(prompt('Move question ' + (i + 1) + ' to number (1–' + cur.qs.length + ')', i + 1)); if (!(n >= 1 && n <= cur.qs.length) || n - 1 === i) return; const [m] = cur.qs.splice(i, 1); cur.qs.splice(n - 1, 0, m); touch(); renderQs(); const t = $('#qpList [data-i="' + (n - 1) + '"]'); if (t) t.scrollIntoView({ block: 'center' }); }
    else if (a === 'addo') { if (q.o.length >= 6) return; q.o.push(''); touch(); refreshQ(i); tplNote(); }
    else if (a === 'delo') { if (q.o.length <= 2) return; q.o.pop(); if (q.a >= q.o.length) q.a = -1; touch(); refreshQ(i); tplNote(); }
    else if (a === 'img') { const inp = $('#qpImgIn'); inp.dataset.i = i; inp.click(); }
    else if (a === 'rmimg') { q.img = undefined; touch(); refreshQ(i); }
  });

  // ---- save / delete ----
  function snapshot() {
    const qs = cur.qs.map(q => { const o = { t: q.t.trim(), o: q.o.map(s => s.trim()), a: q.a }; if (q.img && cur.images[q.img]) { o.img = q.img; o.iw = q.iw || 60; } return o; });
    return { id: cur.id, name: cur.name.trim(), tplId: cur.tplId, keyId: cur.keyId, ls: cur.ls, logo: cur.logo, head: cur.head, hs: cur.hs, F: cur.F, fs: cur.fs, fit: cur.fit, qs, updated: Date.now() };
  }
  $('#qpSave').onclick = async () => {
    const p = snapshot();
    if (!p.name) { msg('Give the paper a name first.'); return; }
    if (!p.qs.length) { msg('Add at least one question.'); return; }
    if (JSON.stringify(p).length - (p.logo || '').length > 48000) { msg('This paper is too big to save (about 48 KB of text). Split it into two papers.'); return; }
    if (!p.id) p.id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    const imgs = []; p.qs.forEach(q => { if (q.img && !imgs.some(m => m.id === q.img)) imgs.push({ id: q.img, data: cur.images[q.img] }); });
    const tpl = App().getTpl(p.tplId) || App().getTpl('builtin'), lim = tpl.groups.length, ans = {};
    p.qs.forEach((q, i) => { if (q.a >= 0 && i < lim && q.a < tpl.labels.length) ans[String(i + 1)] = q.a; });
    if (Object.keys(ans).length) {
      p.keyId = p.keyId || 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      await App().saveKey({ id: p.keyId, name: p.name, tplId: p.tplId, answers: ans });
    }
    cur.id = p.id; cur.keyId = p.keyId; cur.name = p.name; dirty = false;
    const by = App().me(); p.by = by ? by.name : '';
    msg('✔ Saved on this phone — sharing…', true); fillSel();
    const r = await App().savePaper(p, imgs);
    const keyTxt = p.keyId ? ' Answer key “' + p.name + '” (' + Object.keys(ans).length + ' answers) is ready in the Scan tab.' : ' No answers marked yet, so no answer key was made.';
    if (r.ok) msg('✔ Saved' + (App().isGroup() ? ' and shared with the group.' : '.') + keyTxt, true);
    else if (r.error === 'offline') msg('✔ Saved on this phone. It will be uploaded when the internet is back.' + keyTxt, true);
    else msg('Saved on this phone, but the server said: ' + r.error);
  };
  $('#qpDel').onclick = () => {
    if (!cur.id || !App().papers()[cur.id]) { msg('Select a saved paper first.'); return; }
    if (!confirm('Delete this question paper?' + (App().isGroup() ? ' It will be deleted for the whole group.' : '') + ' Its answer key stays in the Answer Key tab.')) return;
    App().deletePaper(cur.id); load(''); msg('Paper deleted.', true);
  };

  // ---- preview / PDF ----
  async function build(scale) {
    const p = snapshot(); if (!p.qs.length) { msg('Add at least one question first.'); return null; }
    try { await document.fonts.ready; } catch (e) { /* ignore */ }
    const logo = p.logo ? await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = p.logo; }) : null;
    return render(p, logo, await imgMap(), scale);
  }
  $('#qpPrevBtn').onclick = async () => {
    msg('Preparing preview…', true); await new Promise(r => setTimeout(r, 30));
    const r = await build(1.4); if (!r) return; const box = $('#qpPrev'); box.innerHTML = '';
    r.pages.forEach(c => { c.style.cssText = 'width:100%;height:auto;border:1px solid #cbd5e1;border-radius:6px;margin-bottom:10px;background:#fff'; box.appendChild(c); });
    msg(r.note || '✔ ' + r.pages.length + ' page(s), text size ' + (Math.floor(r.pt * 10) / 10) + ' pt.', !r.note); box.scrollIntoView({ behavior: 'smooth' });
  };
  $('#qpPdf').onclick = async () => {
    if (!(await App().needReport())) { msg('The PDF file maker (report.js) is not installed on the website yet.'); return; }
    msg('Creating PDF (sharp, 360 dpi — this can take a few seconds)…', true); await new Promise(r => setTimeout(r, 30)); const r = await build(); if (!r) return;
    const doc = new Report.Doc(); r.pages.forEach(c => doc.add(c));
    App().download(doc.blob(), (cur.name.trim() || 'question-paper').replace(/[\\/:*?"<>|]+/g, '_') + '.pdf');
    msg(r.note || '✔ PDF ready (' + doc.pages() + ' page' + (doc.pages() > 1 ? 's' : '') + ', text ' + (Math.floor(r.pt * 10) / 10) + ' pt).', !r.note);
  };

  root.Paper.refresh = () => { if (!root.OMRApp) return; const P = App().papers(); if (dirty) { fillSel(); fillTpl(); return; } load(cur.id && P[cur.id] ? cur.id : ''); };
  root.Paper.show = () => { if (!dirty && !cur.id) load(''); else { fillTpl(); fillSel(); } };
  root.Paper.reset = () => load('');
  root.Paper._cur = () => cur;
  load('');
  restoreFonts();
})(typeof window !== 'undefined' ? window : globalThis);
