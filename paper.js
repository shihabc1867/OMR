/* paper.js - question paper maker (part 2)
 *  - add 1-100 questions by hand or paste them all at once, mark the correct answers
 *  - heading lines + logo, A4 PDF (up to 60 questions on one page, more on two pages)
 *  - "Save" also makes an answer key linked to the chosen OMR sheet type, so the paper can be graded in the Scan tab
 *  - papers live in the open workspace, so everybody in a group sees them
 */
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  const BN = '০১২৩৪৫৬৭৮৯';
  const toBn = s => String(s).replace(/[0-9]/g, d => BN[d]);
  const MAXQ = 100;
  const LS_STYLES = {
    abcd: { name: '(a) (b) (c) (d)', l: ['a', 'b', 'c', 'd', 'e', 'f'] },
    ABCD: { name: '(A) (B) (C) (D)', l: ['A', 'B', 'C', 'D', 'E', 'F'] },
    bn: { name: '(ক) (খ) (গ) (ঘ)', l: ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ'], bn: true },
    bnum: { name: '(১) (২) (৩) (৪)', l: ['১', '২', '৩', '৪', '৫', '৬'], bn: true }
  };
  const optIndex = ch => { for (const L of [['a', 'b', 'c', 'd', 'e', 'f'], ['A', 'B', 'C', 'D', 'E', 'F'], ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ']]) { const i = L.indexOf(ch); if (i >= 0) return i; } return -1; };

  // ---------- paste parser ----------
  // Question lines start with a number (1. 1) ১। Q1. প্রশ্ন ১:), option lines with a letter ((a) a) A. ক) ...), several options may share a line.
  // "Ans: b" / "উত্তর: খ" lines, or a * ✓ after an option, mark the correct answer.
  const RE_Q = /^\s*(?:(?:Q(?:uestion)?|প্রশ্ন)\s*\.?\s*)?([0-9০-৯]{1,3})\s*[.)\]।:\-–](?![0-9০-৯])\s*(.*)$/i;
  const RE_O = /^\s*[(\[]?\s*([a-fA-Fক-চ])\s*[)\].।:]\s*(.*)$/;
  const RE_A = /^\s*(?:ans(?:wer)?|উত্তর|সঠিক\s*উত্তর)\s*[:\-=.]?\s*[(\[]?\s*([a-fA-Fক-চ])\s*[)\]]?\s*\.?\s*$/i;
  const RE_MARK = /\s*(?:\*+|✓|✔|\((?:ans|correct)\))\s*$/i;

  function splitInline(line) {
    const re = /(^|\s)[(\[]?([a-fA-Fক-চ])[)\].।](?=\s|$)/g, hits = []; let m;
    while ((m = re.exec(line))) hits.push({ s: m.index + m[1].length, e: re.lastIndex, k: optIndex(m[2]) });
    let st = hits.findIndex(h => h.k === 0); if (st < 0) return null;
    const chain = [hits[st]];
    for (let i = st + 1; i < hits.length; i++) if (hits[i].k === chain.length) chain.push(hits[i]);
    if (chain.length < 2) return null;
    const o = chain.map((h, i) => line.slice(h.e, i + 1 < chain.length ? chain[i + 1].s : line.length).trim());
    return { pre: line.slice(0, chain[0].s).trim(), o };
  }

  function parse(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const first = lines.find(l => l.trim());
    const numbered = !!(first && RE_Q.test(first));
    const out = []; let cur = null, blank = false;
    const start = t => { cur = { t: t || '', o: [], a: -1 }; out.push(cur); };
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
      const sp = splitInline(line);
      if (sp) { if (sp.pre) addText(sp.pre); sp.o.forEach(addOpt); return; }
      const a = RE_A.exec(line); if (a && cur) { const k = optIndex(a[1]); if (k >= 0) cur.a = k; return; }
      const o = RE_O.exec(line); if (o) { addOpt(o[2]); return; }
      addText(line);
    }
    lines.forEach(raw => {
      const line = raw.trim();
      if (!line) { blank = true; return; }
      const q = numbered ? RE_Q.exec(line) : null;
      if (q) { start(''); blank = false; feed(q[2]); return; }
      if (!numbered && cur && cur.o.length && (blank || !(RE_O.test(line) || splitInline(line) || RE_A.test(line)))) { start(''); }
      blank = false; feed(line);
    });
    return out.map(q => ({ t: q.t.trim(), o: q.o.map(s => s.trim()), a: q.a < q.o.length ? q.a : -1 })).filter(q => q.t || q.o.length).slice(0, MAXQ);
  }

  // ---------- A4 page drawing (canvas, 150 dpi) ----------
  const PW = 1240, PH = 1754, M = 64, GUT = 40, FSMAX = 30, FSMIN = 16;
  const FF = '"Times New Roman","Noto Serif Bengali","Noto Sans Bengali","Nirmala UI","Kohinoor Bangla","Liberation Serif",serif';
  const font = (s, b) => (b ? 'bold ' : '') + s + 'px ' + FF;
  function newPage() {
    const c = document.createElement('canvas'); c.width = PW; c.height = PH;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH); x.textBaseline = 'top'; x.textAlign = 'left';
    return { c, x };
  }
  function fitText(x, text, maxW, size, bold) {
    let s = size; x.font = font(s, bold);
    while (s > 18 && x.measureText(text).width > maxW) { s -= 2; x.font = font(s, bold); }
    return s;
  }
  // logo on the left, up to four centred lines, then the info line and a rule. Returns the y below the heading.
  function drawHeader(x, h, logo) {
    h = h || {}; const L = 150, top = 46, hasLogo = !!logo;
    if (hasLogo) { const k = Math.min(L / logo.width, L / logo.height); x.drawImage(logo, M, top + (L - logo.height * k) / 2, logo.width * k, logo.height * k); }
    const x0 = hasLogo ? M + L + 20 : M, x1 = PW - M, cx = (x0 + x1) / 2, maxW = x1 - x0;
    const lines = [{ t: h.l1, size: 44, c: '#000' }, { t: h.l2, size: 36, c: '#000' }, { t: h.l3, size: 36, c: '#d6339a' }, { t: h.l4, size: 36, c: '#2f4aa0', ul: true }].filter(l => l.t && String(l.t).trim());
    let y = top; x.textAlign = 'center';
    lines.forEach(l => {
      const s = fitText(x, l.t, maxW, l.size, true); x.fillStyle = l.c; x.fillText(l.t, cx, y);
      if (l.ul) { const w = x.measureText(l.t).width; x.fillRect(cx - w / 2, y + s * 1.12, w, 3); }
      y += s + 14;
    });
    x.textAlign = 'left';
    y = Math.max(y, hasLogo ? top + L : 0) + 4;
    if (h.info && String(h.info).trim()) { const s = fitText(x, h.info, PW - 2 * M, 28, false); x.fillStyle = '#000'; x.textAlign = 'center'; x.fillText(h.info, PW / 2, y); x.textAlign = 'left'; y += s + 12; }
    x.fillStyle = '#000'; x.fillRect(M, y, PW - 2 * M, 3);
    return y + 18;
  }

  function wrap(x, text, maxW) {
    const out = [];
    String(text).split('\n').forEach(par => {
      const words = par.split(/\s+/).filter(Boolean); let line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(w => {
        const t = line ? line + ' ' + w : w;
        if (x.measureText(t).width <= maxW) { line = t; return; }
        if (line) { out.push(line); line = ''; }
        if (x.measureText(w).width <= maxW) { line = w; return; }
        let part = ''; for (const ch of w) { if (part && x.measureText(part + ch).width > maxW) { out.push(part); part = ch; } else part += ch; }
        line = part;
      });
      if (line) out.push(line);
    });
    return out.length ? out : [''];
  }

  // One question as a block of drawing operations (positions relative to the block's top-left)
  function layoutQ(x, q, i, fs, colW, st, nw) {
    const lh = Math.round(fs * 1.36), gap = Math.round(fs * 0.7), ops = [];
    x.font = font(fs, false);
    const tl = wrap(x, q.t || '', colW - nw); let y = 0;
    ops.push({ s: (st.bn ? toBn(i + 1) : String(i + 1)) + '.', x: 0, y: 0, b: true });
    tl.forEach(s => { ops.push({ s, x: nw, y }); y += lh; });
    const n = (q.o || []).length;
    if (n) {
      const O = q.o.map((t, j) => '(' + st.l[j] + ') ' + t), W = O.map(s => x.measureText(s).width), avail = colW - nw, g = fs * 1.3;
      if (W.reduce((a, b) => a + b, 0) + g * (n - 1) <= avail) { let cx = nw; O.forEach((s, j) => { ops.push({ s, x: cx, y }); cx += W[j] + g; }); y += lh; }
      else if (n > 1 && Math.max.apply(null, W) <= (avail - g) / 2) {
        const half = (avail - g) / 2 + g; O.forEach((s, j) => ops.push({ s, x: nw + (j % 2) * half, y: y + Math.floor(j / 2) * lh })); y += Math.ceil(n / 2) * lh;
      } else {
        O.forEach(s => { wrap(x, s, avail).forEach((ln, k) => { ops.push({ s: ln, x: nw + (k ? fs * 1.6 : 0), y }); y += lh; }); });
      }
    }
    return { h: y + gap, ops, gap };
  }

  // Try to place all questions at font size fs into the columns; returns placements or null
  function flow(x, qs, fs, cols, colW, st) {
    x.font = font(fs, true); const nw = Math.ceil(x.measureText(qs.length >= 100 ? '000.' : '00.').width) + 8, place = [];
    let k = 0, y = cols[0].top;
    for (let i = 0; i < qs.length; i++) {
      const b = layoutQ(x, qs[i], i, fs, colW, st, nw);
      if (y + b.h - b.gap > cols[k].bottom && y > cols[k].top) { k++; if (k >= cols.length) return null; y = cols[k].top; }
      if (y + b.h - b.gap > cols[k].bottom) return null;       // one question taller than a whole column
      place.push({ b, col: cols[k], y }); y += b.h;
    }
    return place;
  }

  // paper: { head:{l1..l4,info}, ls, qs:[{t,o,a}], name }; logo: <img> or null.  Up to 60 questions -> 1 page, more -> 2 pages
  function render(paper, logo) {
    const st = LS_STYLES[paper.ls] || LS_STYLES.abcd, qs = paper.qs || [];
    const p1 = newPage(), x = p1.x, pages = [p1];
    const hy = drawHeader(x, paper.head, logo), colW = (PW - 2 * M - GUT) / 2;
    let P = qs.length > 60 ? 2 : 1, found = null, note = '';
    for (; P <= 6 && !found; P++) {
      const cols = [];
      for (let p = 0; p < P; p++) for (let c = 0; c < 2; c++) cols.push({ p, x: M + c * (colW + GUT), top: p === 0 ? hy : M + 44, bottom: PH - M - 34 });
      for (let fs = FSMAX; fs >= FSMIN; fs--) { const pl = flow(x, qs, fs, cols, colW, st); if (pl) { found = { pl, fs, P, cols }; break; } }
    }
    if (!found) return { pages: [p1.c], fs: 0, note: 'The questions are too long to fit — shorten some of them.' };
    if (found.P > (qs.length > 60 ? 2 : 1)) note = 'These questions need ' + found.P + ' pages at the smallest readable text. Shorten some questions to fit ' + (qs.length > 60 ? 2 : 1) + '.';
    for (let p = 1; p < found.P; p++) pages.push(newPage());
    pages.forEach((pg, p) => {
      const cx = pg.x; cx.fillStyle = '#94a3b8';
      cx.fillRect(M + colW + GUT / 2 - 1, p === 0 ? hy : M + 44, 2, PH - M - 34 - (p === 0 ? hy : M + 44));
      if (p > 0) { cx.font = font(22, false); cx.textAlign = 'center'; cx.fillStyle = '#64748b'; cx.fillText((paper.name || '') + ' — continued', PW / 2, M - 6); cx.fillRect(M, M + 26, PW - 2 * M, 2); cx.textAlign = 'left'; }
      if (found.P > 1) { cx.font = font(22, false); cx.textAlign = 'center'; cx.fillStyle = '#64748b'; cx.fillText('Page ' + (p + 1) + ' of ' + found.P, PW / 2, PH - 44); cx.textAlign = 'left'; }
    });
    found.pl.forEach(it => {
      const cx = pages[it.col.p].x;
      it.b.ops.forEach(o => { cx.font = font(found.fs, !!o.b); cx.fillStyle = '#000'; cx.fillText(o.s, it.col.x + o.x, it.y + o.y); });
    });
    return { pages: pages.map(p => p.c), fs: found.fs, note };
  }

  root.Paper = { parse, render, toBn, LS_STYLES, _splitInline: splitInline };

  // ---------- editor UI ----------
  if (typeof document === 'undefined' || !document.querySelector('#v-qp')) return;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const App = () => root.OMRApp;
  const blankQ = () => ({ t: '', o: ['', '', '', ''], a: -1 });
  const blankPaper = () => ({ id: '', name: '', tplId: 'builtin', keyId: '', ls: 'abcd', logo: '', head: { l1: '', l2: '', l3: '', l4: 'Question Paper', info: '' }, qs: [] });
  let cur = blankPaper(), dirty = false;
  const msg = (t, ok) => { const m = $('#qpMsg'); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); };
  const label = (q, j) => '(' + (LS_STYLES[cur.ls] || LS_STYLES.abcd).l[j] + ')';
  const touch = () => { dirty = true; };

  function renderHead() {
    $('#qpName').value = cur.name; $('#qpLs').value = cur.ls;
    ['l1', 'l2', 'l3', 'l4', 'info'].forEach(k => { $('#qpH_' + k).value = cur.head[k] || ''; });
    const p = $('#qpLogoPrev'); p.hidden = !cur.logo; if (cur.logo) p.src = cur.logo; $('#qpLogoDel').hidden = !cur.logo;
  }
  function qHtml(q, i) {
    const opts = q.o.map((t, j) => `<div class="qo"><button class="ob${q.a === j ? ' on' : ''}" data-act="ans" data-o="${j}" title="Tap = correct answer">${esc(label(q, j))}</button><input data-f="o" data-o="${j}" value="${esc(t)}" placeholder="Option ${j + 1}"></div>`).join('');
    return `<div class="qi" data-i="${i}"><div class="qh"><b>${i + 1}</b><span class="qa">${q.a >= 0 ? 'Answer: ' + esc(label(q, q.a)) : 'no answer marked'}</span><span><button class="b alt sm" data-act="up">↑</button><button class="b alt sm" data-act="dn">↓</button><button class="b red sm" data-act="del">✕</button></span></div>` +
      `<textarea data-f="t" rows="${Math.max(2, Math.min(6, Math.ceil((q.t || '').length / 38)))}" placeholder="Question ${i + 1}">${esc(q.t)}</textarea>${opts}` +
      `<div class="qh"><span><button class="b alt sm" data-act="addo">＋ option</button> <button class="b alt sm" data-act="delo">－ option</button></span></div></div>`;
  }
  function renderQs() {
    $('#qpList').innerHTML = cur.qs.map(qHtml).join('') || '<p class="hint">No questions yet. Tap “Add question”, set the number of questions above, or paste them all at once.</p>';
    $('#qpCount').value = cur.qs.length; tplNote();
  }
  function refreshQ(i) { const e = $('#qpList [data-i="' + i + '"]'); if (e) e.outerHTML = qHtml(cur.qs[i], i); }

  function tplNote() {
    const tpl = App().getTpl(cur.tplId), n = tpl ? tpl.groups.length : 0, mo = Math.max.apply(null, [0].concat(cur.qs.map(q => q.o.length)));
    let t = tpl ? 'This sheet reads ' + n + ' question(s), ' + (tpl.labels ? tpl.labels.length : '?') + ' options each.' : 'Sheet type not found on this device.';
    if (tpl && cur.qs.length > n) t += ' ⚠ The paper has ' + cur.qs.length + ' questions, so answers after question ' + n + ' will not be graded.';
    if (tpl && tpl.labels && mo > tpl.labels.length) t += ' ⚠ Some questions have more options than the sheet.';
    $('#qpTplNote').textContent = t;
  }
  function fillTpl() {
    const s = $('#qpTpl'); s.innerHTML = App().tpls().map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    if (!App().getTpl(cur.tplId)) cur.tplId = 'builtin'; s.value = cur.tplId;
  }
  function fillSel() {
    const P = App().papers(), ids = Object.keys(P).sort((a, b) => (P[b].updated || 0) - (P[a].updated || 0)), s = $('#qpSel');
    s.innerHTML = '<option value="">＋ New question paper</option>' + ids.map(id => `<option value="${esc(id)}">${esc(P[id].name)} (${(P[id].qs || []).length} Q${P[id].by ? ' · ' + esc(P[id].by) : ''})</option>`).join('');
    s.value = cur.id && P[cur.id] ? cur.id : '';
    $('#qpShare').textContent = App().isGroup() ? '👥 Papers saved here are shared with every member of this group.' : 'Papers saved here are private to your workspace. Switch to a group (top right) to share them.';
  }
  function load(id) {
    const p = id && App().papers()[id];
    if (p) {
      cur = JSON.parse(JSON.stringify(p));
      cur.head = Object.assign({ l1: '', l2: '', l3: '', l4: '', info: '' }, cur.head); cur.qs = (cur.qs || []).map(q => ({ t: q.t || '', o: (q.o || []).slice(), a: typeof q.a === 'number' ? q.a : -1 })); cur.ls = cur.ls || 'abcd';
    } else {
      cur = blankPaper(); const w = App().wsHead(); cur.head = { l1: w.l1 || '', l2: w.l2 || '', l3: '', l4: 'Question Paper', info: '' }; cur.logo = App().wsLogo();
    }
    dirty = false; fillTpl(); renderHead(); renderQs(); fillSel(); $('#qpPrev').innerHTML = ''; msg('');
  }

  // ---- events ----
  $('#qpSel').onchange = () => { if (dirty && !confirm('Discard the changes you made to this paper?')) { fillSel(); return; } load($('#qpSel').value); };
  $('#qpName').oninput = e => { cur.name = e.target.value; touch(); };
  ['l1', 'l2', 'l3', 'l4', 'info'].forEach(k => { $('#qpH_' + k).oninput = e => { cur.head[k] = e.target.value; touch(); }; });
  $('#qpLs').onchange = e => { cur.ls = e.target.value; touch(); renderQs(); };
  $('#qpTpl').onchange = e => { cur.tplId = e.target.value; touch(); tplNote(); };
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
    msg('✔ ' + add.length + ' question(s) added' + (got.length > room ? ' (only ' + MAXQ + ' allowed — the rest was left out)' : '') + (marked ? ', ' + marked + ' answer(s) picked up.' : '. Now tap the correct option of each question.'), true);
  };
  $('#qpList').addEventListener('input', e => {
    const t = e.target, box = t.closest('.qi'); if (!box) return; const q = cur.qs[Number(box.dataset.i)]; if (!q) return;
    if (t.dataset.f === 't') q.t = t.value; else if (t.dataset.f === 'o') q.o[Number(t.dataset.o)] = t.value; touch();
  });
  $('#qpList').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const box = b.closest('.qi'), i = Number(box.dataset.i), q = cur.qs[i], a = b.dataset.act;
    if (a === 'ans') { const j = Number(b.dataset.o); q.a = q.a === j ? -1 : j; touch(); refreshQ(i); }
    else if (a === 'del') { if ((q.t || q.o.some(Boolean)) && !confirm('Delete question ' + (i + 1) + '?')) return; cur.qs.splice(i, 1); touch(); renderQs(); }
    else if (a === 'up' && i > 0) { [cur.qs[i - 1], cur.qs[i]] = [cur.qs[i], cur.qs[i - 1]]; touch(); renderQs(); }
    else if (a === 'dn' && i < cur.qs.length - 1) { [cur.qs[i + 1], cur.qs[i]] = [cur.qs[i], cur.qs[i + 1]]; touch(); renderQs(); }
    else if (a === 'addo') { if (q.o.length >= 6) return; q.o.push(''); touch(); refreshQ(i); tplNote(); }
    else if (a === 'delo') { if (q.o.length <= 2) return; q.o.pop(); if (q.a >= q.o.length) q.a = -1; touch(); refreshQ(i); tplNote(); }
  });

  // ---- save / delete ----
  function snapshot() {
    const qs = cur.qs.map(q => ({ t: q.t.trim(), o: q.o.map(s => s.trim()), a: q.a }));
    return { id: cur.id, name: cur.name.trim(), tplId: cur.tplId, keyId: cur.keyId, ls: cur.ls, logo: cur.logo, head: cur.head, qs, updated: Date.now() };
  }
  $('#qpSave').onclick = async () => {
    const p = snapshot();
    if (!p.name) { msg('Give the paper a name first.'); return; }
    if (!p.qs.length) { msg('Add at least one question.'); return; }
    if (JSON.stringify(p).length - (p.logo || '').length > 48000) { msg('This paper is too big to save (about 48 KB of text). Split it into two papers.'); return; }
    if (!p.id) p.id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    const tpl = App().getTpl(p.tplId) || App().getTpl('builtin'), lim = tpl.groups.length, ans = {};
    p.qs.forEach((q, i) => { if (q.a >= 0 && i < lim && q.a < tpl.labels.length) ans[String(i + 1)] = q.a; });
    if (Object.keys(ans).length) {
      p.keyId = p.keyId || 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      await App().saveKey({ id: p.keyId, name: p.name, tplId: p.tplId, answers: ans });
    }
    cur.id = p.id; cur.keyId = p.keyId; cur.name = p.name; dirty = false;
    const by = App().me(); p.by = by ? by.name : '';
    msg('✔ Saved on this phone — sharing…', true); fillSel();
    const r = await App().savePaper(p);
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
  async function build() {
    const p = snapshot(); if (!p.qs.length) { msg('Add at least one question first.'); return null; }
    const logo = p.logo ? await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = p.logo; }) : null;
    return render(p, logo);
  }
  $('#qpPrevBtn').onclick = async () => {
    const r = await build(); if (!r) return; const box = $('#qpPrev'); box.innerHTML = '';
    r.pages.forEach(c => { c.style.cssText = 'width:100%;height:auto;border:1px solid #cbd5e1;border-radius:6px;margin-bottom:10px;background:#fff'; box.appendChild(c); });
    msg(r.note || '✔ ' + r.pages.length + ' page(s), text size ' + Math.round(r.fs * 0.48 * 10) / 10 + ' pt.', !r.note); box.scrollIntoView({ behavior: 'smooth' });
  };
  $('#qpPdf').onclick = async () => {
    if (!(await App().needReport())) { msg('The PDF file maker (report.js) is not installed on the website yet.'); return; }
    msg('Creating PDF…', true); const r = await build(); if (!r) return;
    const doc = new Report.Doc(); r.pages.forEach(c => doc.add(c));
    App().download(doc.blob(), (cur.name.trim() || 'question-paper').replace(/[\\/:*?"<>|]+/g, '_') + '.pdf');
    msg(r.note || '✔ PDF ready (' + doc.pages() + ' page' + (doc.pages() > 1 ? 's' : '') + ').', !r.note);
  };

  root.Paper.refresh = () => { if (!root.OMRApp) return; const P = App().papers(); if (dirty) { fillSel(); fillTpl(); return; } load(cur.id && P[cur.id] ? cur.id : ''); };
  root.Paper.show = () => { if (!dirty && !cur.id) load(''); else { fillTpl(); fillSel(); } };
  root.Paper.reset = () => load('');
  load('');
})(typeof window !== 'undefined' ? window : globalThis);
