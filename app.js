/* app.js - OMR Scanner: UI, templates (any sheet), answer keys, scoring, Apps Script sync */
(function () {
  'use strict';
  const C = OMR.C;
  const $ = s => document.querySelector(s);
  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const fmt = x => String(Math.round(x * 100) / 100);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  // ---------- state ----------
  const DEF = { per: 1, neg: 0.25, timerPct: 3, thr: 0.3, fillPct: 70, passPct: 40, secPass: 40 };
  const oldSet = LS.get('omr_settings', {});                         // settings of the older single-user version
  const DEV = Object.assign({ thr: oldSet.thr || DEF.thr, fillPct: oldSet.fillPct || DEF.fillPct }, LS.get('omr_device', {}));   // this phone only
  if (!DEV.dv || DEV.dv < 2) { DEV.thr = DEF.thr; DEV.dv = 2; LS.set('omr_device', DEV); }       // v2: the new, stricter ink detection needs its own default strictness
  let WSS = { per: DEF.per, neg: DEF.neg, timerPct: DEF.timerPct, passPct: DEF.passPct, secPass: DEF.secPass, header: { l1: '', l2: '', l3: '', l4: 'Result Sheet' } };   // rules + heading of the open workspace
  let WLOGO = '';
  let S = Object.assign({}, DEF);                                     // merged view used by the scanner/scoring code
  const applyS = () => { S = Object.assign({}, DEF, { per: WSS.per, neg: WSS.neg, timerPct: WSS.timerPct, passPct: WSS.passPct, secPass: WSS.secPass }, { thr: DEV.thr, fillPct: DEV.fillPct }); };
  let A = LS.get('omr_auth', null);                                   // { url, token, user }
  let dir = LS.get('omr_dir', { users: [], groups: [], requests: [] });
  let wsId = '';
  let customTpls = LS.get('omr_templates', []);   // sheet types shared by the admin: [{id,name,W,H,ref,align,rx,ry,labels,groups}]
  let keys = {};                                  // answer keys of the open workspace: id -> {id,name,tplId,answers:{ "1":optIndex }}
  let results = [];
  let paperImages = {};                            // question pictures of the open workspace: id -> data URL
  let papers = {};                                 // question papers of the open workspace: id -> {id,name,tplId,keyId,ls,head,qs,logo,updated,by}
  let keyState = { id: '', tplId: 'builtin', answers: {} };
  let sc = { sel: null };
  let submitted = false, timerOn = false, liveMode = false;   // liveMode: the last scan came from the live camera, so "Next student" reopens it
  const builtin = OMR.builtinTemplate();
  const allTpls = () => [builtin].concat(customTpls);
  const getTpl = id => allTpls().find(t => t.id === id) || null;
  const labelOf = (tpl, o) => (tpl.labels && tpl.labels[o]) || String.fromCharCode(65 + o);
  const wsKey = id => 'omr_w_' + id;
  const saveWsCache = () => { if (wsId) LS.set(wsKey(wsId), { keys, results, settings: WSS, logo: WLOGO, papers });
    try { LS.set('omr_pi_' + wsId, paperImages); } catch (e) { /* too big for this phone's storage: pictures are fetched again from the server */ } };
  const saveSettings = () => { LS.set('omr_device', DEV); saveWsCache(); };
  const saveKeys = saveWsCache, saveResults = saveWsCache;
  const saveTpls = () => LS.set('omr_templates', customTpls);
  const isAdmin = () => !!(A && A.user && A.user.role === 'admin');
  const canUp = () => !!(A && A.user && (A.user.role === 'admin' || A.user.canUpload));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  function normWss(s) {
    s = s || {}; const h = s.header || {};
    return { per: num(s.per, DEF.per), neg: num(s.neg, DEF.neg), timerPct: num(s.timerPct, DEF.timerPct), passPct: num(s.passPct, DEF.passPct), secPass: num(s.secPass, DEF.secPass),
      header: { l1: h.l1 || '', l2: h.l2 || '', l3: h.l3 || '', l4: h.l4 == null ? 'Result Sheet' : h.l4 } };
  }
  function toast(t) {
    let e = $('#toast');
    if (!e) { e = document.createElement('div'); e.id = 'toast'; e.style.cssText = 'position:fixed;left:12px;right:12px;bottom:18px;background:#0f172a;color:#fff;padding:10px 14px;border-radius:10px;z-index:90;font-size:14px;display:none'; document.body.appendChild(e); }
    e.textContent = t; e.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { e.style.display = 'none'; }, 4500);
  }

  // ---------- tabs ----------
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.id === 'v-' + b.dataset.v));
    if (b.dataset.v === 'qp' && window.Paper) Paper.show();
    if (b.dataset.v === 'res') renderResults();
    if (b.dataset.v === 'scan') fillSelects();
    if (b.dataset.v === 'tpl') renderTplList();
    if (b.dataset.v === 'grp') { renderGroups(); pullDir(); }
    if (b.dataset.v === 'prof') { renderProfile(); pullDir(); }
    if (b.dataset.v === 'adm') loadAdmin();
    if (b.dataset.v === 'set') fillWsForm();
  });
  function gotoTab(v) { const b = document.querySelector('nav button[data-v="' + v + '"]'); if (b) b.click(); }

  // ---------- zoom ----------
  document.querySelectorAll('.zoom').forEach(z => {
    const lv = [1, 1.6, 2.4, 3.4]; let i = 0;
    z.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
      i = Math.max(0, Math.min(lv.length - 1, i + Number(b.dataset.d)));
      document.getElementById(z.dataset.for).style.width = lv[i] * 100 + '%';
    });
  });

  // ---------- drawing ----------
  function drawBuiltinSheet(ctx) {
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, C.W, C.H);
    // four black corner squares (used to straighten the photo)
    ctx.fillStyle = '#000';
    OMR.MARKERS.forEach(p => ctx.fillRect(p[0] - C.MK / 2, p[1] - C.MK / 2, C.MK, C.MK));
    // dashed lines between the four column blocks
    ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.setLineDash([22, 14]);
    for (let c = 1; c < C.COLS; c++) {
      const x = C.GX0 + c * C.COLW - 144;
      ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, C.H - 12); ctx.stroke();
    }
    ctx.setLineDash([]);
    // bubbles with the option letter inside, question number on the left
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#222'; ctx.textBaseline = 'middle';
    for (let q = 0; q < C.ROWS * C.COLS; q++) {
      for (let o = 0; o < C.OPT; o++) {
        const p = OMR.bubble(q, o);
        ctx.beginPath(); ctx.arc(p[0], p[1], C.BR, 0, 7); ctx.stroke();
        ctx.fillStyle = '#666'; ctx.textAlign = 'center'; ctx.font = '19px ' + FONT;
        ctx.fillText(String.fromCharCode(97 + o), p[0], p[1] + 1);
      }
      const p0 = OMR.bubble(q, 0);
      ctx.fillStyle = '#111'; ctx.textAlign = 'right'; ctx.font = 'bold 22px ' + FONT;
      ctx.fillText(String(q + 1), p0[0] - C.BR - 22, p0[1] + 1);
    }
    ctx.restore();
  }
  function drawGenericSheet(ctx, tpl) {
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tpl.W, tpl.H);
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.strokeRect(3, 3, tpl.W - 6, tpl.H - 6);
    const r = Math.max(tpl.rx, tpl.ry);
    ctx.lineWidth = Math.max(1.5, r / 8); ctx.strokeStyle = '#334155';
    tpl.groups.forEach((g, q) => {
      g.pts.forEach((p, o) => {
        ctx.beginPath(); ctx.ellipse(p[0], p[1], tpl.rx, tpl.ry, 0, 0, 7); ctx.stroke();
        ctx.fillStyle = '#94a3b8'; ctx.font = Math.round(r * 1.05) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(labelOf(tpl, o), p[0], p[1] + 1);
      });
      const a = g.pts[0], b = g.pts[1] || [a[0] + 1, a[1]];
      const vertical = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]);
      ctx.fillStyle = '#0f172a'; ctx.font = 'bold ' + Math.round(r * 1.25) + 'px ' + FONT; ctx.textBaseline = 'middle';
      if (vertical) { ctx.textAlign = 'center'; ctx.fillText(String(q + 1), a[0], a[1] - tpl.ry * 2.1); }
      else { ctx.textAlign = 'right'; ctx.fillText(String(q + 1), a[0] - tpl.rx * 1.7, a[1] + 1); }
    });
    ctx.restore();
  }
  function drawTemplate(ctx, tpl) { if (tpl.builtin) drawBuiltinSheet(ctx); else drawGenericSheet(ctx, tpl); }
  function ell(ctx, tpl, p, fill, stroke, dash, extra) {
    ctx.save(); ctx.beginPath(); ctx.ellipse(p[0], p[1], tpl.rx + (extra || 4), tpl.ry + (extra || 4), 0, 0, 7);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.lineWidth = 3; ctx.strokeStyle = stroke; if (dash) ctx.setLineDash([5, 4]); ctx.stroke(); ctx.restore();
  }
  function hit(cv, ev, tpl) {
    const r = cv.getBoundingClientRect();
    const x = (ev.clientX - r.left) * cv.width / r.width, y = (ev.clientY - r.top) * cv.height / r.height;
    const lim = Math.max(tpl.rx, tpl.ry) * 1.6; let best = null, bd = lim * lim;
    for (let q = 0; q < tpl.groups.length; q++) { const pts = tpl.groups[q].pts; for (let o = 0; o < pts.length; o++) {
      const d = (pts[o][0] - x) * (pts[o][0] - x) + (pts[o][1] - y) * (pts[o][1] - y);
      if (d < bd) { bd = d; best = [q, o]; } } }
    return best;
  }

  // ---------- photo loading ----------
  function loadPhoto(file, maxDim) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        URL.revokeObjectURL(u);
        const k = Math.min(1, (maxDim || 1800) / Math.max(im.naturalWidth, im.naturalHeight));
        const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0, w, h);
        res({ cv, w, h, rgba: cx.getImageData(0, 0, w, h).data });
      };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not open the image')); };
      im.src = u;
    });
  }

  // ---------- corner editor ----------
  let cornerCb = null, cornerState = null;
  function openCorners(photo, quad, hint, cb) {
    const ov = $('#cornerOv'), cv = $('#cornerCv');
    const dispW = Math.min(window.innerWidth - 24, 760), k = dispW / photo.w;
    cv.width = Math.round(photo.w * k); cv.height = Math.round(photo.h * k);
    cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';
    cornerState = { photo, k, pts: quad.map(p => [p[0], p[1]]), drag: -1 };
    cornerCb = cb; $('#cornerHint').textContent = hint; ov.classList.add('on'); ov.scrollTop = 0;
    drawCorners();
  }
  const NAMES = ['TL', 'TR', 'BR', 'BL'];
  function drawCorners() {
    const st = cornerState, cv = $('#cornerCv'), x = cv.getContext('2d'), k = st.k;
    x.clearRect(0, 0, cv.width, cv.height); x.drawImage(st.photo.cv, 0, 0, cv.width, cv.height);
    x.lineWidth = 2; x.strokeStyle = '#22d3ee'; x.beginPath();
    st.pts.forEach((p, i) => { if (i) x.lineTo(p[0] * k, p[1] * k); else x.moveTo(p[0] * k, p[1] * k); }); x.closePath(); x.stroke();
    st.pts.forEach((p, i) => {
      x.beginPath(); x.arc(p[0] * k, p[1] * k, 14, 0, 7); x.fillStyle = 'rgba(34,211,238,.25)'; x.fill(); x.stroke();
      x.beginPath(); x.moveTo(p[0] * k - 20, p[1] * k); x.lineTo(p[0] * k + 20, p[1] * k); x.moveTo(p[0] * k, p[1] * k - 20); x.lineTo(p[0] * k, p[1] * k + 20); x.stroke();
      x.fillStyle = '#fff'; x.font = 'bold 13px ' + FONT; x.fillText(NAMES[i], p[0] * k + 16, p[1] * k - 16);
    });
    if (st.drag >= 0) { // loupe
      const p = st.pts[st.drag], R = 60, lx = p[0] * k < cv.width / 2 ? cv.width - R - 8 : R + 8, ly = R + 8, z = 3, sr = R / z;
      x.save(); x.beginPath(); x.arc(lx, ly, R, 0, 7); x.clip(); x.fillStyle = '#000'; x.fillRect(lx - R, ly - R, 2 * R, 2 * R);
      x.drawImage(st.photo.cv, p[0] - sr, p[1] - sr, 2 * sr, 2 * sr, lx - R, ly - R, 2 * R, 2 * R); x.restore();
      x.strokeStyle = '#22d3ee'; x.beginPath(); x.arc(lx, ly, R, 0, 7); x.moveTo(lx - 12, ly); x.lineTo(lx + 12, ly); x.moveTo(lx, ly - 12); x.lineTo(lx, ly + 12); x.stroke();
    }
  }
  (function () {
    const cv = $('#cornerCv');
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / cornerState.k * (cv.width / r.width), (e.clientY - r.top) / cornerState.k * (cv.width / r.width)]; };
    cv.addEventListener('pointerdown', e => {
      if (!cornerState) return; const p = pos(e); let bi = -1, bd = Infinity;
      cornerState.pts.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]) * cornerState.k; if (d < bd) { bd = d; bi = i; } });
      if (bd < 60) { cornerState.drag = bi; cv.setPointerCapture(e.pointerId); cornerState.pts[bi] = p; drawCorners(); }
    });
    cv.addEventListener('pointermove', e => { if (cornerState && cornerState.drag >= 0) { cornerState.pts[cornerState.drag] = pos(e); drawCorners(); } });
    const up = () => { if (cornerState) { cornerState.drag = -1; drawCorners(); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    $('#cornerRot').onclick = () => { const p = cornerState.pts; cornerState.pts = [p[1], p[2], p[3], p[0]]; drawCorners(); };
    $('#cornerCancel').onclick = () => { $('#cornerOv').classList.remove('on'); cornerState = null; cornerCb = null; };
    $('#cornerOk').onclick = () => { const pts = cornerState.pts.map(p => [p[0], p[1]]), cb = cornerCb; $('#cornerOv').classList.remove('on'); cornerState = null; cornerCb = null; if (cb) cb(pts); };
  })();
  const quadMove = (a, b) => Math.max.apply(null, a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));
  const insetQuad = (w, h) => [[w * 0.1, h * 0.08], [w * 0.9, h * 0.08], [w * 0.9, h * 0.92], [w * 0.1, h * 0.92]];
  function cornerHint(tpl) {
    if (tpl.align === 'markers') return 'Drag each handle onto the centre of the matching black corner square (TL = top-left of the SHEET, etc.). Use “Rotate corner labels” if the sheet is turned.';
    if (tpl.align === 'page') return 'Drag each handle to the matching corner of the paper (TL = top-left of the SHEET, etc.). Use “Rotate corner labels” if the sheet is turned.';
    return 'Drag each handle to the same four reference points you used when you created this sheet type (usually the paper corners).';
  }

  // ---------- selects ----------
  function fillSelects() {
    const ids = Object.keys(keys);
    const ks = $('#keySel');
    ks.innerHTML = '<option value="">＋ New answer key</option>' + ids.map(id => `<option value="${esc(id)}">${esc(keys[id].name)} (${Object.keys(keys[id].answers).length} Q)</option>`).join('');
    ks.value = keyState.id;
    const kt = $('#keyTpl');
    kt.innerHTML = allTpls().map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    kt.value = keyState.tplId; kt.disabled = !!keyState.id;
    const ss = $('#scanKey'), cur = ss.value;
    ss.innerHTML = ids.length ? ids.map(id => { const t = getTpl(keys[id].tplId); return `<option value="${esc(id)}">${esc(keys[id].name)} — ${esc(t ? t.name : 'missing sheet type')}</option>`; }).join('')
      : '<option value="">— save an answer key first —</option>';
    if (cur && keys[cur]) ss.value = cur;
  }

  // ---------- answer key tab ----------
  const keyCv = $('#keyCv');
  function keyTpl() { return getTpl(keyState.tplId) || builtin; }
  function renderKey() {
    const tpl = keyTpl(); keyCv.width = tpl.W; keyCv.height = tpl.H;
    const x = keyCv.getContext('2d'); drawTemplate(x, tpl);
    const qs = Object.keys(keyState.answers);
    qs.forEach(q => {
      const g = tpl.groups[q - 1]; if (!g || !g.pts[keyState.answers[q]]) return;
      const p = g.pts[keyState.answers[q]];
      x.beginPath(); x.ellipse(p[0], p[1], tpl.rx - 1, tpl.ry - 1, 0, 0, 7); x.fillStyle = '#111'; x.fill();
    });
    $('#keyCount').textContent = 'Answers set: ' + qs.length + ' of ' + tpl.groups.length + ' questions';
    secNote();
  }
  // ---------- sections of an answer key (optional): e.g. Bangla 1-15, English 16-50 ----------
  const MAXSEC = 6;
  const secList = () => (keyState.sections = keyState.sections || []);
  const rangeText = a => { const o = []; let i = 0; while (i < a.length) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; o.push(j > i ? a[i] + '–' + a[j] : String(a[i])); i = j + 1; } return o.join(', '); };
  function secValidate(L, n) {
    const clean = [];
    for (let i = 0; i < L.length; i++) {
      const t = L[i], f = t.from, e = t.to, nm = String(t.name || '').trim() || 'Section ' + (i + 1);
      if (!(f >= 1 && e >= 1)) return { error: 'Section ' + (i + 1) + ': enter the first and the last question number (or remove the section with ✕).' };
      if (f > e) return { error: 'Section “' + nm + '”: the first question must not come after the last.' };
      if (e > n) return { error: 'Section “' + nm + '”: this sheet has only ' + n + ' questions.' };
      clean.push({ name: nm, from: f, to: e });
    }
    clean.sort((a, b) => a.from - b.from);
    for (let i = 1; i < clean.length; i++) if (clean[i].from <= clean[i - 1].to) return { error: 'Sections “' + clean[i - 1].name + '” and “' + clean[i].name + '” overlap.' };
    return { clean };
  }
  function renderSecs() {
    const L = secList(), n = keyTpl().groups.length, v = x => (x == null ? '' : x);
    $('#secList').innerHTML = L.map((t, i) => `<div class="secrow" data-i="${i}"><input data-f="name" value="${esc(t.name || '')}" placeholder="Section name"><input data-f="from" type="number" min="1" max="${n}" inputmode="numeric" placeholder="From" value="${v(t.from)}"><input data-f="to" type="number" min="1" max="${n}" inputmode="numeric" placeholder="To" value="${v(t.to)}"><button class="b red sm" data-rm="${i}" title="Remove">✕</button></div>`).join('');
    secNote();
  }
  function secNote() {
    const L = secList(), m = $('#secNote'); if (!m) return;
    if (!L.length) { m.textContent = ''; return; }
    const v = secValidate(L, keyTpl().groups.length), c = v.clean || [];
    const out = Object.keys(keyState.answers).map(Number).filter(q => !c.some(t => q >= t.from && q <= t.to)).sort((a, b) => a - b);
    m.style.color = v.error ? '#b45309' : '';
    m.textContent = (v.error ? '⚠ ' + v.error + ' ' : '') + (!v.error && out.length ? 'Answered questions not in any section (counted only in the total): ' + rangeText(out) + '.' : '');
  }
  $('#secAdd').onclick = () => {
    const L = secList(), n = keyTpl().groups.length;
    if (L.length >= MAXSEC) { toast('At most ' + MAXSEC + ' sections.'); return; }
    const last = L.reduce((a, t) => Math.max(a, t.to || 0), 0);
    if (last >= n) { toast('All ' + n + ' questions are already in sections.'); return; }
    const top = Math.max.apply(null, [0].concat(Object.keys(keyState.answers).map(Number))) || n;      // the first section suggests "all answered questions"; just change the numbers
    L.push({ name: 'Section ' + (L.length + 1), from: last + 1, to: last < top ? top : n }); renderSecs();
  };
  $('#secList').addEventListener('input', e => {
    const row = e.target.closest('.secrow'); if (!row) return; const t = secList()[Number(row.dataset.i)]; if (!t) return;
    const f = e.target.dataset.f; if (f === 'name') t.name = e.target.value; else { const x = parseInt(e.target.value, 10); t[f] = isNaN(x) ? null : x; }
    secNote();
  });
  $('#secList').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; secList().splice(Number(b.dataset.rm), 1); renderSecs(); });
  const rememberSecs = (id, sec) => { const m = LS.get('omr_secs', {}); if (sec && sec.length) m[id] = sec; else delete m[id]; LS.set('omr_secs', m); };

  keyCv.onclick = ev => {
    const tpl = keyTpl(), h = hit(keyCv, ev, tpl); if (!h) return;
    const q = String(h[0] + 1);
    if (keyState.answers[q] === h[1]) delete keyState.answers[q]; else keyState.answers[q] = h[1];
    renderKey();
  };
  $('#keySel').onchange = () => {
    const id = $('#keySel').value;
    keyState = id && keys[id] ? { id, tplId: keys[id].tplId, answers: Object.assign({}, keys[id].answers), sections: (keys[id].sections || []).map(t => Object.assign({}, t)) } : { id: '', tplId: $('#keyTpl').value || 'builtin', answers: {}, sections: [] };
    $('#keyName').value = id ? keys[id].name : ''; fillSelects(); renderSecs(); renderKey();
  };
  $('#keyTpl').onchange = () => { keyState = { id: '', tplId: $('#keyTpl').value, answers: {}, sections: [] }; renderSecs(); renderKey(); };
  $('#keyClear').onclick = () => { keyState.answers = {}; renderKey(); };

  $('#keySave').onclick = async () => {
    const msg = $('#keyMsg'); msg.className = 'msg';
    if (!Object.keys(keyState.answers).length) { msg.textContent = 'Set the answer for at least one question.'; return; }
    const sv = secValidate(secList(), keyTpl().groups.length); if (sv.error) { msg.textContent = sv.error; return; }
    const id = keyState.id || 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    const name = $('#keyName').value.trim() || 'Answer key ' + (Object.keys(keys).length + 1);
    keys[id] = { id, name, tplId: keyState.tplId, answers: Object.assign({}, keyState.answers), sections: sv.clean };
    keyState.id = id; keyState.sections = sv.clean.map(t => Object.assign({}, t)); rememberSecs(id, sv.clean); $('#keyName').value = name; saveKeys(); fillSelects(); renderSecs(); renderKey();
    msg.className = 'msg ok'; msg.textContent = '✔ Saved on this phone — sharing…';
    const r = await queue('saveKey', { wid: wsId, key: keys[id] }, 'key:' + id);
    if (r.ok) msg.textContent = '✔ Saved' + (wsId.indexOf('g:') === 0 ? ' and shared with the group.' : '.');
    else if (r.error === 'offline') msg.textContent = '✔ Saved on this phone. It will be uploaded when the internet is back.';
    else { msg.className = 'msg'; msg.textContent = 'Saved on this phone, but the server said: ' + r.error; }
  };
  $('#keyDel').onclick = () => {
    const id = keyState.id;
    if (!id) { $('#keyMsg').className = 'msg'; $('#keyMsg').textContent = 'Select a saved answer key first.'; return; }
    if (!confirm('Delete this answer key?' + (wsId.indexOf('g:') === 0 ? ' It will be deleted for the whole group.' : ''))) return;
    delete keys[id]; saveKeys(); rememberSecs(id, null); keyState = { id: '', tplId: 'builtin', answers: {}, sections: [] }; $('#keyName').value = '';
    fillSelects(); renderSecs(); renderKey(); queue('deleteKey', { wid: wsId, id }, 'key:' + id);
  };
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  $('#sheetDl').onclick = () => {
    const cv = document.createElement('canvas'); cv.width = C.W * 2; cv.height = C.H * 2;
    const cx = cv.getContext('2d'); cx.scale(2, 2); drawBuiltinSheet(cx);
    cv.toBlob(b => download(b, 'omr-sheet.png'), 'image/png');
  };

  // ---------- scan tab ----------
  const scanCv = $('#scanCv');
  const smsg = (t, ok) => { const m = $('#scanMsg'); m.textContent = t; m.className = 'msg' + (ok ? ' ok' : ''); };
  $('#camBtn').onclick = () => $('#camIn').click();
  $('#galBtn').onclick = () => $('#galIn').click();
  $('#camIn').onchange = $('#galIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleFile(f); };
  const scanTplObj = () => { const k = keys[$('#scanKey').value]; return k ? getTpl(k.tplId) : null; };

  async function handleFile(file) {
    const key = keys[$('#scanKey').value];
    if (!key) { smsg('Choose an answer key first (create one in the Answer Key tab).'); return; }
    if (!getTpl(key.tplId)) { smsg('This answer key uses a sheet type that is not on this device. Open the Settings tab and refresh from the server, or re-create the sheet type.'); return; }
    smsg('Scanning…', true); liveMode = false;
    try { const p = await loadPhoto(file, 2200); sc = { photo: p, rot: undefined, pts: null, manual: new Set(), rid: null }; setTimeout(runScan, 30); }
    catch (e) { smsg('Error: ' + e.message); }
  }
  // An older sheet type that was saved without the corner-square positions: after one good manual alignment,
  // find the squares in this photo, express them in template coordinates and keep them, so the next scan lines up by itself.
  function learnMarkers(tpl, p, r) {
    try {
      if (tpl.builtin || tpl.mk || r.how !== 'manual' || !(r.fit >= 0.25)) return;
      const m = OMR.findMarkers(OMR.toGray(p.rgba, p.w, p.h), p.w, p.h);
      const Hi = OMR.homography(r.quad, tpl.ref);
      if (!m || !Hi) return;
      const ap = q => { const d = Hi[6] * q[0] + Hi[7] * q[1] + 1; return [(Hi[0] * q[0] + Hi[1] * q[1] + Hi[2]) / d, (Hi[3] * q[0] + Hi[4] * q[1] + Hi[5]) / d]; };
      const t = OMR.orderQuad(m.map(ap)), W = tpl.W, H = tpl.H;
      if (t.some(q => q[0] < -0.35 * W || q[0] > 1.35 * W || q[1] < -0.35 * H || q[1] > 1.35 * H)) return;
      let ar = 0; for (let i = 0; i < 4; i++) { const u = t[i], v = t[(i + 1) % 4]; ar += u[0] * v[1] - v[0] * u[1]; }
      if (Math.abs(ar) / 2 < 0.5 * W * H) return;
      tpl.mk = t; if (tpl.align !== 'page') tpl.align = 'markers';
      if (saveTpls()) setTimeout(() => smsg('✔ Corner squares learned for this sheet type — next time the photo will line up automatically.', true), 50);
    } catch (e) { /* ignore */ }
  }
  function runScan(live) {
    const tpl = scanTplObj(), p = sc.photo;
    const r = OMR.scanTpl(p.rgba, p.w, p.h, tpl, { pts: sc.pts || undefined, rot: sc.pts ? undefined : sc.rot });
    if (!r.found) {
      if (live) return false;                  // live camera: just try again with the next frame
      smsg('Could not find the sheet corners automatically. Place the four handles on the sheet corners.');
      const quad = sc.lastQuad || insetQuad(p.w, p.h);
      openCorners(p, quad, cornerHint(tpl), pts => { sc.pts = pts; sc.lastQuad = pts; runScan(); });
      return false;
    }
    if (r.learned && !tpl.builtin) { tpl.mk = r.learned; tpl.align = 'markers'; if (saveTpls()) setTimeout(() => smsg('✔ Corner squares learned for this sheet type — scanning now lines up automatically.', true), 50); }
    else learnMarkers(tpl, p, r);
    sc.rot = r.rot; sc.res = r; sc.lastQuad = r.quad; const A = OMR.analyze(r.dark, r.fill, { thr: S.thr, fillMin: (S.fillPct || 70) / 100 }, r.raw, r.core);
    sc.sel = A.sel; sc.bad = new Set(); A.bad.forEach((b, q) => { if (b) sc.bad.add(q); }); sc.manual = new Set();
    sc.img = new ImageData(r.warped, tpl.W, tpl.H);
    submitted = false; $('#resBox').hidden = true; scanCv.width = tpl.W; scanCv.height = tpl.H;
    $('#scanArea').hidden = false; updateTimerBtn(); renderScan();
    const n = sc.sel.filter(s => s.length).length, nb = sc.bad.size;
    if (r.fit < 0.1) smsg('⚠ The sheet does not seem to line up with the template (alignment ' + r.fit.toFixed(2) + '). Try “Adjust corners” or “Rotate”, or retake the photo.');
    else if (r.ambiguous) smsg('✔ Scanned (' + n + ' questions marked). Orientation was hard to tell — if the circles look wrong, tap “Rotate”.', true);
    else if (n < 3) smsg('⚠ Very few marks detected. Check the sheet type and orientation (“Rotate”), lighting, or lower the detection threshold in Settings.');
    else if (nb) smsg('✔ Scan complete — ' + n + ' questions have marks. ⚠ ' + nb + ' question(s) have multiple or partly filled marks (orange) and will count as wrong. Tap a bubble to correct it, then Submit.', true);
    else smsg('✔ Scan complete — ' + n + ' questions have marks. Fix any bubble by tapping it, then Submit.', true);
    $('#scanWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }
  $('#rotBtn').onclick = () => { if (sc.photo) { sc.pts = null; sc.rot = ((sc.rot || 0) + 1) % 4; runScan(); } };
  $('#cornBtn').onclick = () => {
    if (!sc.photo) return; const tpl = scanTplObj();
    openCorners(sc.photo, sc.lastQuad || insetQuad(sc.photo.w, sc.photo.h), cornerHint(tpl), pts => { sc.pts = pts; sc.lastQuad = pts; runScan(); });
  };
  function renderScan() {
    const tpl = scanTplObj(), x = scanCv.getContext('2d'); x.putImageData(sc.img, 0, 0);
    const key = submitted ? keys[$('#scanKey').value] : null;
    for (let q = 0; q < tpl.groups.length; q++) {
      const s = sc.sel[q] || [], a = key ? key.answers[q + 1] : undefined, g = tpl.groups[q];
      s.forEach(o => {
        let f = 'rgba(96,165,250,.40)', st = '#2563eb';
        if (sc.bad.has(q)) { f = 'rgba(251,191,36,.45)'; st = '#d97706'; }
        if (key && a !== undefined) {
          if (!sc.bad.has(q) && s.length === 1 && o === a) { f = 'rgba(74,222,128,.45)'; st = '#16a34a'; } else { f = 'rgba(248,113,113,.45)'; st = '#dc2626'; }
        }
        ell(x, tpl, g.pts[o], f, st, sc.manual.has(q + '-' + o));
      });
      if (key && a !== undefined && g.pts[a] && !(!sc.bad.has(q) && s.length === 1 && s[0] === a)) ell(x, tpl, g.pts[a], null, '#16a34a', true);
    }
  }
  scanCv.onclick = ev => {
    if (!sc.sel) return; const tpl = scanTplObj(), h = hit(scanCv, ev, tpl); if (!h) return;
    const s = sc.sel[h[0]], i = s.indexOf(h[1]), k = h[0] + '-' + h[1];
    sc.bad.delete(h[0]); // the person has checked this question by hand
    if (i >= 0) { s.splice(i, 1); sc.manual.delete(k); } else { s.push(h[1]); sc.manual.add(k); }
    renderScan(); refreshResult();
  };

  // ---------- scoring ----------
  function updateTimerBtn() {
    const b = $('#timerBtn'); b.textContent = '⏱ Second Timer (−' + fmt(S.timerPct) + '%)' + (timerOn ? ' ✔' : ''); b.classList.toggle('on', timerOn);
  }
  $('#timerBtn').onclick = () => { timerOn = !timerOn; updateTimerBtn(); refreshResult(); };
  $('#scanKey').onchange = () => { if ($('#scanArea').hidden === false) { $('#scanArea').hidden = true; sc = { sel: null }; submitted = false; } };

  const secPct = () => (S.secPass == null ? 40 : S.secPass);
  // Result of every section of the key: correct / wrong / blank and marks (negative marking applied). Fails when the section percent is below the section pass mark.
  function computeSections(sel, key, bad) {
    const L = key && key.sections; if (!L || !L.length) return [];
    return L.map(t => {
      let c = 0, w = 0, b = 0, n = 0;
      for (let q = t.from; q <= t.to; q++) {
        if (key.answers[q] === undefined) continue; n++;
        const s = (sel && sel[q - 1]) || [];
        if (bad && bad.has(q - 1)) w++;
        else if (!s.length) b++; else if (s.length === 1 && s[0] === key.answers[q]) c++; else w++;
      }
      const total = n * S.per, neg = w * S.neg, fin = c * S.per - neg, pct = total ? fin / total * 100 : 0;
      return { name: t.name, from: t.from, to: t.to, c, w, b, n, total, neg, fin, pct, fail: n > 0 && pct < secPct() };
    });
  }
  function compute(sel, key, tOn, bad) {
    let c = 0, w = 0, b = 0; const wrongQs = [], qs = Object.keys(key.answers).map(Number).sort((a, z) => a - z);
    qs.forEach(q => {
      const s = sel[q - 1] || [];
      if (bad && bad.has(q - 1)) { w++; wrongQs.push(q); }
      else if (!s.length) b++; else if (s.length === 1 && s[0] === key.answers[q]) c++; else { w++; wrongQs.push(q); }
    });
    const total = qs.length * S.per, neg = w * S.neg, tim = tOn ? total * S.timerPct / 100 : 0;
    return { c, w, b, n: qs.length, total, neg, tim, fin: c * S.per - neg - tim, wrongQs, secs: computeSections(sel, key, bad) };          // may be negative: shown as it is
  }
  function showResult(r) {
    $('#rC').textContent = r.c; $('#rW').textContent = r.w; $('#rB').textContent = r.b;
    $('#rM').textContent = fmt(r.total); $('#rN').textContent = '− ' + fmt(r.neg);
    $('#rT').textContent = timerOn ? '− ' + fmt(r.tim) : '0';
    $('#rF').textContent = fmt(r.fin) + ' / ' + fmt(r.total);
    $('#rS').textContent = '+' + fmt(S.per) + ' per correct, −' + fmt(S.neg) + ' per wrong (multiple or partly filled marks count as wrong)';
    const secs = r.secs || [], f = isFail(r);
    $('#rSecs').innerHTML = secs.map(t => `<div class="sr${t.fail ? ' bad' : ''}"><b>${esc(t.name)}</b> (Q${t.from}–${t.to})${t.fail ? ' — <b>FAILED</b> (below ' + fmt(secPct()) + '%)' : ''}<br>Correct ${t.c} • Wrong ${t.w} • Blank ${t.b} • <b>${fmt(t.fin)} / ${fmt(t.total)}</b> (${p1(t.pct)}%)</div>`).join('');
    $('#rF').classList.toggle('bad', f);
    const st = $('#rStat'); st.textContent = f ? 'FAILED — below ' + fmt(passPct()) + '% of the total marks' : 'Passed'; st.style.color = f ? '#dc2626' : '#0f766e';
    $('#resBox').hidden = false;
  }

  // ---------- live camera scan ----------
  // The camera shows a box on the 4 black squares. When they are locked the person taps "Read & Submit" (or Auto-submit does it).
  // A clean sheet is saved at once and the camera keeps running; anything doubtful opens the normal review screen.
  $('#liveBtn').onclick = async () => {
    const key = keys[$('#scanKey').value];
    if (!key) { smsg('Choose an answer key first (create one in the Answer Key tab).'); return; }
    const tpl = getTpl(key.tplId);
    if (!tpl) { smsg('This answer key uses a sheet type that is not on this device. Open the Settings tab and refresh from the server, or re-create the sheet type.'); return; }
    const m = tpl.mk || tpl.ref, ra = Math.hypot(m[0][0] - m[1][0], m[0][1] - m[1][1]) + Math.hypot(m[3][0] - m[2][0], m[3][1] - m[2][1]),
      rb = Math.hypot(m[1][0] - m[2][0], m[1][1] - m[2][1]) + Math.hypot(m[0][0] - m[3][0], m[0][1] - m[3][1]);
    smsg('', true);
    const err = await LiveCam.open({ aspect: Math.max(ra, rb) / Math.min(ra, rb), mode: tpl.align === 'page' ? 'page' : 'markers', title: key.name, onShot: liveShot, onEdit: id => { const r = editStudent(id); return r ? { name: r.student, id: r.sid } : null; } });
    if (err && err.error) smsg(err.error); else liveMode = true;
  };
  async function liveShot(frame, who) {
    // keep the photo at most 2200 px, like a normal photo
    const k = Math.min(1, 2200 / Math.max(frame.width, frame.height)); let cv = frame;
    if (k < 1) { cv = document.createElement('canvas'); cv.width = Math.round(frame.width * k); cv.height = Math.round(frame.height * k); cv.getContext('2d').drawImage(frame, 0, 0, cv.width, cv.height); }
    const p = { cv, w: cv.width, h: cv.height, rgba: cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data };
    $('#stuName').value = who.name; $('#stuId').value = who.id;
    sc = { photo: p, rot: undefined, pts: null, manual: new Set(), rid: null };
    if (!runScan(true)) return { fail: 'Could not read the sheet — hold steady and try again.' };
    const r = sc.res, n = sc.sel.filter(s => s.length).length;
    if (!(r.fit >= 0.1) || r.ambiguous || n < 3 || sc.bad.size) { LiveCam.close(); return { review: true }; }   // doubtful: show the review screen (message is already set)
    $('#submitBtn').onclick();
    const out = { rid: sc.rid, name: stuNow().name, id: stuNow().id, correct: $('#rC').textContent, wrong: $('#rW').textContent, blank: $('#rB').textContent, score: $('#rF').textContent };
    const w = $('#scanMsg').textContent, notes = [], rec = results.find(x => x.id === out.rid);
    if (w.indexOf('already has a result') > 0) notes.push(w.replace(/^⚠\s*/, ''));
    if (rec) { if (isFail(rec)) notes.push('FAILED (below ' + fmt(passPct()) + '%)'); secsOf(rec).filter(t => t.fail).forEach(t => notes.push('Failed section: ' + t.name)); }
    if (notes.length) out.warn = notes.join(' • ');
    sc = { sel: null }; submitted = false; $('#scanArea').hidden = true; $('#resBox').hidden = true; $('#stuName').value = ''; $('#stuId').value = '';
    smsg('Saved: ' + out.score + ' (' + (out.name || 'Unknown') + '). Live camera is on.', true);
    return out;
  }
  let syncT = null;
  function refreshResult() {
    if (!submitted) return; const key = keys[$('#scanKey').value]; if (!key) return;
    renderScan(); showResult(compute(sc.sel, key, timerOn, sc.bad)); storeRecord();
  }
  const stuNow = () => sc.stu || { name: $('#stuName').value.trim(), id: $('#stuId').value.trim() };
  const onStu = () => { if (submitted && sc.sel) { sc.stu = { name: $('#stuName').value.trim(), id: $('#stuId').value.trim() }; storeRecord(); } };
  $('#stuName').oninput = onStu; $('#stuId').oninput = onStu;
  function storeRecord() {
    const key = keys[$('#scanKey').value], r = compute(sc.sel, key, timerOn, sc.bad);
    const rec = Object.assign({ id: sc.rid, t: Date.now(), keyId: key.id, keyName: key.name, student: stuNow().name || 'Unknown', sid: stuNow().id, sel: sc.sel.map(s => s.slice()), bad: Array.from(sc.bad || []), timer: timerOn }, r);
    const i = results.findIndex(x => x.id === rec.id);
    if (i >= 0) { rec.t = results[i].t; results[i] = rec; } else results.unshift(rec);
    saveResults(); clearTimeout(syncT); syncT = setTimeout(() => queue('saveResult', { wid: wsId, result: rec }, 'res:' + rec.id), 600);
  }
  $('#submitBtn').onclick = () => {
    if (!sc.sel) return; if (!keys[$('#scanKey').value]) { smsg('Choose an answer key.'); return; }
    if (!sc.rid) sc.rid = 'r' + Date.now();
    sc.stu = { name: $('#stuName').value.trim(), id: $('#stuId').value.trim() };
    const dup = sc.stu.id && results.some(x => x.keyId === keys[$('#scanKey').value].id && x.sid === sc.stu.id && x.id !== sc.rid);
    submitted = true; refreshResult(); $('#resBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (dup) smsg('⚠ Roll/ID ' + sc.stu.id + ' already has a result for this answer key (duplicate). Delete the older one in Results if it is a mistake.');
  };
  $('#nextBtn').onclick = () => {
    $('#scanArea').hidden = true; $('#resBox').hidden = true; sc = { sel: null }; submitted = false;
    $('#stuName').value = ''; $('#stuId').value = ''; smsg('Ready for the next sheet.', true); window.scrollTo({ top: 0, behavior: 'smooth' });
    if (liveMode) $('#liveBtn').click();       // back to the live camera
  };
  $('#stuPdf').onclick = () => { const r = results.find(x => x.id === sc.rid); if (r) pdfStudents([r], t => smsg(t, true)); };

  // ---------- results tab ----------
  const passPct = () => (S.passPct == null ? 40 : S.passPct);
  const pctOf = r => (r.total ? r.fin / r.total * 100 : 0);
  const isFail = r => pctOf(r) < passPct();
  const p1 = x => String(Math.round(x * 10) / 10);
  const nameOf = r => r.student || 'Unknown';
  // sections of a saved result: worked out again from the key (so a later change of the sections or pass mark applies); the copy saved with the result is the fallback
  function secsOf(r) {
    const key = keys[r.keyId];
    if (key && key.sections && key.sections.length && r.sel) return computeSections(r.sel, key, new Set(r.bad || []));
    return (r.secs || []).map(t => Object.assign({}, t, { fail: t.n > 0 && t.pct < secPct() }));
  }
  const secLines = r => secsOf(r).map(t => '<br><span style="' + (t.fail ? 'color:#dc2626;font-weight:700' : '') + '">' + esc(t.name) + ': ' + t.c + ' correct • ' + t.w + ' wrong • ' + t.b + ' blank = ' + fmt(t.fin) + '/' + fmt(t.total) + ' (' + p1(t.pct) + '%)' + (t.fail ? ' — FAILED' : '') + '</span>').join('');
    function ranked(keyId) {
    // Highest score first; same score -> fewer wrong answers first; still equal -> the sheet scanned earlier first. Every student gets his own rank.
    const L = results.filter(r => r.keyId === keyId).sort((x, y) => y.fin - x.fin || x.w - y.w || y.c - x.c || x.t - y.t);
    return L.map((r, i) => ({ r, rank: i + 1, n: L.length }));
  }
  function resKeyIds() {
    const seen = {}, out = [];
    results.slice().sort((x, y) => y.t - x.t).forEach(r => { if (!seen[r.keyId]) { seen[r.keyId] = 1; out.push({ id: r.keyId, name: r.keyName }); } });
    return out;
  }
  function selKeyIds() { const v = $('#resKey').value; return v ? [v] : resKeyIds().map(k => k.id); }
  function fillResKey() {
    const sel = $('#resKey'), cur = sel.value, ks = resKeyIds();
    sel.innerHTML = '<option value="">All answer keys</option>' + ks.map(k => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('');
    sel.value = ks.some(k => k.id === cur) ? cur : '';
  }
  $('#resKey').onchange = () => renderResults();
  $('#resDelAll').onclick = () => {
    const kid = $('#resKey').value, list = results.filter(r => !kid || r.keyId === kid);
    if (!list.length) { toast('No results to delete.'); return; }
    const what = kid ? 'all ' + list.length + ' result(s) of “' + (list[0].keyName || 'this answer key') + '”' : 'ALL ' + list.length + ' result(s) of every answer key';
    if (!confirm('Delete ' + what + '?' + (wsId.indexOf('g:') === 0 ? '\nThey will be deleted for the whole group.' : '') + '\n\nThis cannot be undone.')) return;
    const ids = {}; list.forEach(r => { ids[r.id] = 1; });
    results = results.filter(r => !ids[r.id]); saveResults(); renderResults();
    outbox = outbox.filter(o => !(o.key && /^res:/.test(o.key) && ids[o.key.slice(4)]));
    queue('deleteResults', { wid: wsId, keyId: kid || '' }, 'resall:' + (kid || '*'));
    toast('Results deleted.');
  };
  // results saved by older versions were cut at 0: work out the real (negative) total again
  function fixNeg() { results.forEach(r => { if (!r || r.fin !== 0 || r.c == null) return; const per = r.n ? r.total / r.n : S.per, f = r.c * per - (r.neg || 0) - (r.tim || 0); if (f < -1e-9) r.fin = Math.round(f * 1e4) / 1e4; }); }
  function editStudent(id) {
    const r = results.find(x => x.id === id); if (!r) return null;
    const n = prompt('Student name', r.student && r.student !== 'Unknown' ? r.student : ''); if (n === null) return null;
    const s = prompt('Roll / ID', r.sid || ''); if (s === null) return null;
    r.student = n.trim() || 'Unknown'; r.sid = s.trim();
    saveResults(); queue('saveResult', { wid: wsId, result: r }, 'res:' + r.id); renderResults();
    if (r.sid && results.some(x => x.keyId === r.keyId && x.sid === r.sid && x.id !== r.id)) toast('⚠ Roll/ID ' + r.sid + ' already has another result for this answer key.');
    return r;
  }
  function renderResults() {
    fixNeg(); fillResKey();
    const L = $('#resList');
    if (!results.length) { L.innerHTML = '<p class="hint">No results yet.</p>'; return; }
    L.innerHTML = selKeyIds().map(kid => {
      const R = ranked(kid); if (!R.length) return '';
      const fails = R.filter(x => isFail(x.r)).length;
      return `<div class="grp">${esc(R[0].r.keyName)} — ${R.length} student(s)${fails ? ', ' + fails + ' below ' + fmt(passPct()) + '%' : ''}</div>` + R.map(({ r, rank }) =>
        `<div class="item${isFail(r) ? ' fail' : ''}"><div><span class="rk">${rank}</span><b>${esc(nameOf(r))}</b>${r.sid ? ' • ID ' + esc(r.sid) : ''}<small>Correct ${r.c} • Wrong ${r.w} • Blank ${r.b}${r.timer ? ' • Timer penalty' : ''} • ${p1(pctOf(r))}%${isFail(r) ? ' • FAILED' : ''}${secLines(r)}<br>${esc(new Date(r.t).toLocaleString())}${r.by ? ' • by ' + esc(r.by) : ''}${r.wrongQs && r.wrongQs.length ? '<br>Wrong Q: ' + esc(r.wrongQs.join(', ')) : ''}</small></div>
        <div style="text-align:right"><b class="ok">${fmt(r.fin)}/${fmt(r.total)}</b><br><button class="b alt sm" data-edit="${esc(r.id)}">✏️ Edit</button> <button class="b alt sm" data-pdf="${esc(r.id)}">PDF</button> <button class="b red sm" data-del="${esc(r.id)}">Delete</button></div></div>`).join('');
    }).join('');
    L.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (!confirm('Delete this result?' + (wsId.indexOf('g:') === 0 ? ' It will be deleted for the whole group.' : ''))) return;
      results = results.filter(r => r.id !== b.dataset.del); saveResults(); renderResults(); queue('deleteResult', { wid: wsId, id: b.dataset.del }, 'res:' + b.dataset.del);
    });
    L.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editStudent(b.dataset.edit));
    L.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => { const r = results.find(x => x.id === b.dataset.pdf); if (r) pdfStudents([r], pdfMsg); });
  }

  // ---------- result sheets: downloadable PDF files ----------
  function needReport() {
    return new Promise(res => {
      if (window.Report) return res(true);
      const s = document.createElement('script'); s.src = 'report.js'; s.onload = () => res(!!window.Report); s.onerror = () => res(false); document.head.appendChild(s);
    });
  }
  const NO_REPORT = 'The PDF file maker (report.js, part 2) is not installed on the website yet.';
  const pdfMsg = t => { const m = $('#pdfMsg'); m.textContent = t || ''; };
  const rowColor = (r, rank) => (isFail(r) ? '#e11d1d' : rank <= 3 ? '#5b8f2a' : '#000');
  const tick = () => new Promise(r => setTimeout(r, 0));
  const safeName = s => String(s || '').replace(/[^\w\u0980-\u09FF.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'file';
  function answersOf(r) {
    const key = keys[r.keyId]; if (!key) return null;
    const tpl = getTpl(key.tplId), lab = (tpl && tpl.labels) || ['A', 'B', 'C', 'D', 'E', 'F'], bad = new Set(r.bad || []), wr = new Set(r.wrongQs || []), failAll = isFail(r), fsec = secsOf(r).filter(t => t.fail);
    return Object.keys(key.answers).map(Number).sort((x, y) => x - y).map(q => {
      const s = (r.sel && r.sel[q - 1]) || [];
      return { q, mine: s.length ? s.map(i => lab[i] || i + 1).join('+') : '–', good: lab[key.answers[q]] || key.answers[q], wrong: wr.has(q), multi: bad.has(q - 1), answered: s.length > 0, red: failAll || fsec.some(t => q >= t.from && q <= t.to) };
    });
  }
  const secHeads = r => secsOf(r).map(t => ({ name: t.name, total: t.total }));
  const secCells = r => secsOf(r).map(t => ({ fin: t.fin, fail: t.fail }));
  async function pdfMerit(msg) {
    const ids = selKeyIds().filter(k => ranked(k).length); if (!ids.length) { alert('No results to put in the PDF.'); return; }
    if (!(await needReport())) { msg(NO_REPORT); return; }
    msg('Creating PDF…'); const logo = await Report.loadImage(WLOGO), doc = new Report.Doc();
    for (const kid of ids) {
      const R = ranked(kid); await tick();
      Report.merit({ header: WSS.header, logo, caption: R[0].r.keyName, secHeads: secHeads(R[0].r), rows: R.map(({ r, rank }) => ({ rank, id: r.sid || '', name: nameOf(r), pos: r.c, neg: r.w, total: r.fin, secs: secCells(r), color: rowColor(r, rank) })) }, c => doc.add(c));
    }
    download(doc.blob(), 'Merit-list' + (ids.length === 1 ? '-' + safeName(ranked(ids[0])[0].r.keyName) : '') + '.pdf');
    msg('✔ PDF downloaded (' + doc.pages() + ' page' + (doc.pages() > 1 ? 's' : '') + ').');
  }
  async function pdfStudents(list, msg) {
    if (!list.length) { alert('No results to put in the PDF.'); return; }
    if (!(await needReport())) { msg(NO_REPORT); return; }
    msg('Creating PDF…'); const logo = await Report.loadImage(WLOGO), doc = new Report.Doc();
    for (let i = 0; i < list.length; i++) {
      const r = list[i], me = ranked(r.keyId).find(x => x.r.id === r.id), rank = me ? me.rank : 1, f = isFail(r), col = rowColor(r, rank);
      const secs = secsOf(r), c0 = f ? '#e11d1d' : '#000';
      const lines = [
        { t: 'Merit position: ' + rank + ' of ' + (me ? me.n : 1), color: col, bold: true },
        { t: f ? 'Result: FAILED — below the pass mark (' + fmt(passPct()) + '% of the total marks)' : 'Result: Passed', color: c0, bold: true },
        { t: 'Total marks: ' + fmt(r.fin) + ' / ' + fmt(r.total) + '  (' + p1(pctOf(r)) + '%)', color: col },
        { t: 'Total — Correct ' + r.c + '     Wrong ' + r.w + '     Unanswered ' + r.b, color: c0 },
        { t: 'Wrong-answer penalty: − ' + fmt(r.neg) + (r.timer ? '     Second Timer penalty: − ' + fmt(r.tim) : ''), color: c0 }
      ];
      if (secs.length) {
        lines.push({ t: 'Section-wise result', color: c0, bold: true });
        secs.forEach(t => lines.push({ t: t.name + ' (Q' + t.from + '–' + t.to + '):  Correct ' + t.c + '   Wrong ' + t.w + '   Blank ' + t.b + '   Marks ' + fmt(t.fin) + ' / ' + fmt(t.total) + ' (' + p1(t.pct) + '%)' + (t.fail ? '   FAILED (below ' + fmt(secPct()) + '%)' : ''), color: (f || t.fail) ? '#e11d1d' : '#000', bold: t.fail }));
      }
      await tick(); msg('Creating PDF… ' + (i + 1) + ' / ' + list.length);
      Report.student({ header: WSS.header, logo, caption: r.keyName, secHeads: secHeads(r), row: { rank, id: r.sid || '', name: nameOf(r), pos: r.c, neg: r.w, total: r.fin, secs: secCells(r), color: col }, lines, answers: answersOf(r) }, c => doc.add(c));
    }
    download(doc.blob(), (list.length === 1 ? 'Result-' + safeName(list[0].sid || list[0].student) : 'All-results') + '.pdf');
    msg('✔ PDF downloaded (' + doc.pages() + ' page' + (doc.pages() > 1 ? 's' : '') + ').');
  }
  $('#pdfAll').onclick = () => pdfMerit(pdfMsg);
  $('#pdfEach').onclick = () => { const all = []; selKeyIds().forEach(kid => ranked(kid).forEach(x => all.push(x.r))); pdfStudents(all, pdfMsg); };
  $('#resCsv').onclick = () => {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const all = []; selKeyIds().forEach(kid => ranked(kid).forEach(x => all.push(x)));
    const names = []; all.forEach(({ r }) => secsOf(r).forEach(t => { if (names.indexOf(t.name) < 0) names.push(t.name); }));
    const head = ['Rank', 'Name', 'Roll/ID', 'Answer key', 'Time', 'Correct', 'Wrong', 'Unanswered', 'Total marks', 'Wrong penalty', 'Timer penalty', 'Score', 'Percent', 'Status', 'Scanned by', 'Wrong questions'];
    names.forEach(n => head.push(n + ' correct', n + ' wrong', n + ' blank', n + ' marks', n + ' percent', n + ' status'));
    const rows = [head];
    all.forEach(({ r, rank }) => {
      const row = [rank, nameOf(r), r.sid || '', r.keyName, new Date(r.t).toLocaleString(), r.c, r.w, r.b, r.total, r.neg, r.tim, r.fin, p1(pctOf(r)), isFail(r) ? 'Fail' : 'Pass', r.by || '', (r.wrongQs || []).join(' ')];
      const sc2 = secsOf(r); names.forEach(n => { const t = sc2.find(x => x.name === n); if (t) row.push(t.c, t.w, t.b, t.fin, p1(t.pct), t.fail ? 'Fail' : 'Pass'); else row.push('', '', '', '', '', ''); });
      rows.push(row);
    });
    download(new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), 'omr-results.csv');
  };
  $('#resSync').onclick = async () => { await pullWs(true); renderResults(); };

  // ---------- sheet types (templates) ----------
  function renderTplList() {
    $('#tplList').innerHTML = allTpls().map(t => {
      const ks = {}; t.groups.forEach(g => ks[g.pts.length] = (ks[g.pts.length] || 0) + 1);
      const opt = Object.keys(ks).map(k => ks[k] + '×' + k).join(', ');
      return `<div class="item"><div><b>${esc(t.name)}</b><small>${t.groups.length} questions • options: ${opt} • alignment: ${esc(t.align)}</small></div>
      ${t.builtin || !canUp() || !(isAdmin() || !t.by || t.by === A.user.id) ? '' : `<button class="b red sm" data-dt="${esc(t.id)}">Delete</button>`}</div>`;
    }).join('');
    document.querySelectorAll('[data-dt]').forEach(b => b.onclick = () => {
      const id = b.dataset.dt;
      if (Object.keys(keys).some(k => keys[k].tplId === id)) { alert('Delete the answer keys that use this sheet type first.'); return; }
      if (!confirm('Delete this sheet type for everyone?')) return;
      customTpls = customTpls.filter(t => t.id !== id); saveTpls(); renderTplList(); fillSelects(); queue('deleteTemplate', { id }, 'tpl:' + id);
    });
  }

  // template wizard
  let wiz = null, wizHist = [];
  const wmsg = (t, ok) => { const m = $('#wizMsg'); m.textContent = t; m.className = 'msg' + (ok ? ' ok' : ''); };
  $('#wizCam').onclick = () => $('#wizCamIn').click();
  $('#wizGal').onclick = () => $('#wizGalIn').click();
  $('#wizCamIn').onchange = $('#wizGalIn').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    wmsg('Loading photo…', true);
    try {
      const p = await loadPhoto(f, 2200);
      const a = OMR.alignPhoto(OMR.toGray(p.rgba, p.w, p.h), p.w, p.h, 'auto');
      wiz = { photo: p, auto: a, pts: a ? a.pts : insetQuad(p.w, p.h), how: a ? a.how : 'manual', sens: 0.85, list: [], rx: 10, ry: 10 };
      wmsg(a ? 'Found the sheet (' + (a.how === 'markers' ? 'corner squares' : 'paper edges') + '). Check the four corners, then tap Done.' : 'Could not find the sheet automatically — place the four handles on the sheet corners.', true);
      openCorners(p, wiz.pts, a ? (a.how === 'markers' ? 'Handles should sit on the centres of the black corner squares.' : 'Handles should sit on the four paper corners.') + ' TL = top-left of the SHEET.' : 'Place the handles on the four corners of the sheet. TL = top-left of the SHEET.', pts => {
        const moved = !wiz.auto || quadMove(pts, wiz.auto.pts) > 4;
        wiz.pts = pts; wiz.align = moved ? 'manual' : wiz.auto.how; wizBuild(true);
      });
    } catch (err) { wmsg('Error: ' + err.message); }
  };
  function wizOpts() { return { k: +$('#wK').value || 0, transpose: $('#wDir').value === '1', numbering: $('#wNum').value }; }
  // Find the black corner squares in the blank photo and express them in template coordinates,
  // so the scanner can line the sheet up on the squares even if the template corners were placed somewhere else.
  function wizMarkers() {
    try {
      const p = wiz.photo, m = OMR.findMarkers(OMR.toGray(p.rgba, p.w, p.h), p.w, p.h);
      const Hi = OMR.homography(wiz.pts, wiz.base.ref);
      if (!m || !Hi) return null;
      const ap = q => { const d = Hi[6] * q[0] + Hi[7] * q[1] + 1; return [(Hi[0] * q[0] + Hi[1] * q[1] + Hi[2]) / d, (Hi[3] * q[0] + Hi[4] * q[1] + Hi[5]) / d]; };
      const t = OMR.orderQuad(m.map(ap)), W = wiz.base.W, H = wiz.base.H;
      if (t.some(q => q[0] < -0.35 * W || q[0] > 1.35 * W || q[1] < -0.35 * H || q[1] > 1.35 * H)) return null;
      let ar = 0; for (let i = 0; i < 4; i++) { const u = t[i], v = t[(i + 1) % 4]; ar += u[0] * v[1] - v[0] * u[1]; }
      if (Math.abs(ar) / 2 < 0.5 * W * H) return null;
      return t;
    } catch (e) { return null; }
  }
  function wizBuild(detect) {
    const p = wiz.photo;
    wiz.base = OMR.templateBase(p.rgba, p.w, p.h, wiz.pts, 1200);
    wiz.mk = wizMarkers();
    if (!wiz.base) { wmsg('The corners are not valid. Adjust them and try again.'); return; }
    if (detect) {
      const det = OMR.detectBubbles(wiz.base.gray, wiz.base.W, wiz.base.H, wiz.sens);
      wiz.list = det ? det.list.map(b => ({ x: b.x, y: b.y })) : []; wiz.rx = det ? det.rx : wiz.base.W * 0.012; wiz.ry = det ? det.ry : wiz.base.W * 0.012;
      wizHist = [];
      $('#wMsg').textContent = det ? '' : 'No bubbles found. Use a clear, well-lit photo of a BLANK sheet, raise the sensitivity, or add bubbles by tapping.';
    }
    $('#wizStart').hidden = true; $('#wizEdit').hidden = false; wmsg('');
    wizRegroup(); $('#wizEdit').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function wizRegroup() {
    wiz.groups = wiz.list.length ? OMR.buildGroups(wiz.list, wiz.rx, wiz.ry, wizOpts()) : [];
    const ks = {}; wiz.groups.forEach(g => ks[g.pts.length] = (ks[g.pts.length] || 0) + 1);
    const odd = Object.keys(ks).length > 1;
    $('#wizInfo').textContent = wiz.list.length + ' bubbles → ' + wiz.groups.length + ' questions (' + Object.keys(ks).map(k => ks[k] + '×' + k + ' options').join(', ') + ')' + (odd ? ' ⚠ Questions have different option counts — check for missed/extra bubbles, or set “Options per question”.' : '');
    wizRender();
  }
  function wizRender() {
    const cv = $('#wizCv'), b = wiz.base; cv.width = b.W; cv.height = b.H;
    const x = cv.getContext('2d'); x.putImageData(new ImageData(b.warped, b.W, b.H), 0, 0);
    const lab = $('#wLab').value, name = o => lab === '1' ? String(o + 1) : String.fromCharCode((lab === 'a' ? 97 : 65) + o);
    const r = Math.max(wiz.rx, wiz.ry);
    x.lineWidth = 2.5; x.strokeStyle = '#dc2626';
    wiz.groups.forEach((g, q) => {
      g.pts.forEach((p, o) => { x.beginPath(); x.ellipse(p[0], p[1], wiz.rx + 3, wiz.ry + 3, 0, 0, 7); x.stroke(); });
      const a = g.pts[0], w = g.pts[1] || [a[0] + 1, a[1]], vertical = Math.abs(w[1] - a[1]) > Math.abs(w[0] - a[0]);
      x.font = 'bold ' + Math.round(r * 1.1) + 'px ' + FONT; x.textBaseline = 'middle'; x.lineWidth = 4; x.strokeStyle = '#fff'; x.fillStyle = '#b91c1c';
      const tx = vertical ? a[0] : a[0] - wiz.rx * 1.6, ty = vertical ? a[1] - wiz.ry * 2.1 : a[1];
      x.textAlign = vertical ? 'center' : 'right'; x.strokeText(String(q + 1), tx, ty); x.fillText(String(q + 1), tx, ty); x.lineWidth = 2.5; x.strokeStyle = '#dc2626';
    });
    wiz._name = name;
  }
  ['wK', 'wDir', 'wNum'].forEach(id => $('#' + id).onchange = () => { if (wiz && wiz.base) wizRegroup(); });
  $('#wLab').onchange = () => { if (wiz && wiz.base) wizRender(); };
  $('#wSens').onchange = () => { if (wiz && wiz.base) { wiz.sens = +$('#wSens').value; wizBuild(true); } };
  $('#wizCv').onclick = ev => {
    if (!wiz || !wiz.base) return;
    const cv = $('#wizCv'), r = cv.getBoundingClientRect();
    const x = (ev.clientX - r.left) * cv.width / r.width, y = (ev.clientY - r.top) * cv.height / r.height;
    const lim = Math.max(wiz.rx, wiz.ry) * 1.3; let bi = -1, bd = lim * lim;
    wiz.list.forEach((b, i) => { const d = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y); if (d < bd) { bd = d; bi = i; } });
    wizHist.push(wiz.list.slice());
    if (bi >= 0) wiz.list.splice(bi, 1); else wiz.list.push({ x, y });
    wizRegroup();
  };
  $('#wUndo').onclick = () => { if (wizHist.length) { wiz.list = wizHist.pop(); wizRegroup(); } };
  $('#wCorn').onclick = () => {
    openCorners(wiz.photo, wiz.pts, 'Adjust the four corner handles. TL = top-left of the SHEET.', pts => {
      const moved = !wiz.auto || quadMove(pts, wiz.auto.pts) > 4; wiz.pts = pts; wiz.align = moved ? 'manual' : wiz.auto.how; wizBuild(true);
    });
  };
  $('#wCancel').onclick = () => { wiz = null; $('#wizEdit').hidden = true; $('#wizStart').hidden = false; wmsg(''); };
  $('#wSave').onclick = async () => {
    const m = $('#wMsg'); m.className = 'msg';
    if (!wiz || wiz.groups.length < 2) { m.textContent = 'Fewer than 2 questions were found. Fix the bubbles first.'; return; }
    if (!canUp()) { m.textContent = 'Only the admin (or a user the admin allowed) can add sheet types.'; return; }
    const name = $('#wName').value.trim() || 'Sheet ' + (customTpls.length + 1);
    const maxK = Math.max.apply(null, wiz.groups.map(g => g.pts.length)), lab = $('#wLab').value;
    const labels = []; for (let o = 0; o < maxK; o++) labels.push(lab === '1' ? String(o + 1) : String.fromCharCode((lab === 'a' ? 97 : 65) + o));
    const tpl = OMR.makeTemplate(wiz.base, { rx: wiz.rx, ry: wiz.ry }, wiz.groups, { id: 't' + Date.now(), name, align: wiz.mk ? (wiz.align === 'page' ? 'auto' : 'markers') : (wiz.align || 'manual'), mk: wiz.mk || null, labels });
    customTpls.push(tpl);
    if (!saveTpls()) { customTpls.pop(); m.textContent = 'Could not save (device storage is full).'; return; }
    fillSelects(); renderTplList();
    wiz = null; $('#wizEdit').hidden = true; $('#wizStart').hidden = false; $('#wName').value = '';
    wmsg('✔ Sheet type “' + name + '” saved. Now create an answer key for it in the Answer Key tab.', true);
    tpl.by = A.user.id;
    const r = await queue('saveTemplate', { template: tpl }, 'tpl:' + tpl.id);
    if (r.ok) wmsg('✔ Sheet type “' + name + '” saved and available to every user. Now create an answer key for it in the Answer Key tab.', true);
    else if (r.error === 'offline') wmsg('✔ Saved on this phone; it will be uploaded when the internet is back.', true);
    else wmsg('Saved on this phone, but the server said: ' + r.error);
  };

  // ---------- settings ----------
  // ---------- network + outbox (changes are kept on the phone until the server has them) ----------
  let outbox = LS.get('omr_out', []), flushing = null;
  const trErr = e => (e === 'network' ? 'Cannot reach the server. Check the internet connection and the secret key.' : e);
  async function apiTo(url, action, payload) {
    if (!url) return { ok: false, error: 'The secret key is missing.' };
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action, token: A && A.token }, payload)) });
      const r = await res.json();
      if (r && r.ok === false && r.error === 'AUTH' && action !== 'login') sessionExpired();
      return r;
    } catch (e) { return { ok: false, error: 'network' }; }
  }
  const api = (action, payload) => apiTo(A && A.url, action, payload);
  function queue(action, payload, key) {
    if (key) outbox = outbox.filter(o => o.key !== key);
    outbox.push({ action, payload, key }); LS.set('omr_out', outbox);
    return flush();
  }
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      let last = { ok: true };
      while (outbox.length && A && A.token) {
        const it = outbox[0], r = await api(it.action, it.payload);
        if (r && r.error === 'network') { last = { ok: false, error: 'offline' }; break; }
        if (r && r.error === 'AUTH') { last = { ok: false, error: 'AUTH' }; break; }
        const i = outbox.indexOf(it); if (i >= 0) outbox.splice(i, 1); LS.set('omr_out', outbox);
        if (r && r.ok === false) { toast('Not saved on the server: ' + r.error); last = r; }
      }
      return last;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  // ---------- log in / new user ----------
  const amsg = (t, ok) => { const m = $('#aMsg'); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); };
  // Secret key = server address + secret, written as  OMR.<deployment id>.<secret>.<check>  (an old-style server address is still accepted)
  const KEYRE = /^https:\/\/script\.google\.com\/macros\/s\/([\w-]+)\/exec\/?$/;
  const kchk = s => { let n = 0; for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 1296; return ('0' + n.toString(36)).slice(-2); };
  function makeKey(url, secret) { const m = KEYRE.exec(String(url || '')); if (!m) return ''; const body = 'OMR.' + m[1] + '.' + (secret || ''); return body + '.' + kchk(body); }
  function parseKey(s) {
    s = String(s || '').trim().replace(/\s+/g, '');
    if (!s) return { error: 'Paste the secret key your admin gave you (tap “Secret key” below).' };
    if (/^https?:\/\//i.test(s)) return { url: s, secret: '' };
    const p = s.split('.');
    if (p.length !== 4 || p[0] !== 'OMR' || !/^[\w-]+$/.test(p[1]) || !/^[A-Za-z0-9]*$/.test(p[2]) || p[3] !== kchk(p[0] + '.' + p[1] + '.' + p[2])) return { error: 'This secret key does not look right. Copy the whole key again.' };
    return { url: 'https://script.google.com/macros/s/' + p[1] + '/exec', secret: p[2] };
  }
  let linkNote = '';
  (function keyFromLink() {      // login link:  .../index.html#k=<key>
    const m = /[#?&]k=([^&]+)/.exec((location.hash || '') + (location.search || '')); if (!m) return;
    let k = ''; try { k = decodeURIComponent(m[1]); } catch (e) { k = m[1]; }
    const pk = parseKey(k); history.replaceState(null, '', location.pathname);
    if (pk.error) { linkNote = pk.error; return; }
    const same = A && A.url === pk.url;
    A = { url: pk.url, appKey: pk.secret, token: same ? A.token : '', user: same ? A.user : null }; LS.set('omr_auth', A);
    linkNote = same ? '' : 'Secret key saved. Now enter your ID and password.';
  })();
  function showAuth(msg) {
    const k = A && A.url ? (makeKey(A.url, A.appKey) || A.url) : (oldSet.url || '');
    $('#aKey').value = k; $('#aKeyBox').open = !k; $('#aKeySum').textContent = k ? 'Secret key ✔ saved on this phone' : 'Secret key';
    $('#authOv').classList.add('on'); amsg(msg || linkNote || '', !msg && !!linkNote); linkNote = '';
  }
  function sessionExpired() {
    if (!A || !A.token) return; A.token = ''; LS.set('omr_auth', A);
    showAuth('Your login has ended. Please log in again.');
  }
  const authTab = up => { $('#aIn').hidden = up; $('#aUp').hidden = !up; $('#aTabIn').classList.toggle('on', !up); $('#aTabUp').classList.toggle('on', up); amsg(''); };
  $('#aTabIn').onclick = () => authTab(false); $('#aTabUp').onclick = () => authTab(true);
  $('#aLogin').onclick = async () => {
    const pk = parseKey($('#aKey').value), id = $('#aId').value.trim(), pw = $('#aPw').value;
    if (pk.error) { amsg(pk.error); $('#aKeyBox').open = true; return; }
    if (!id || !pw) { amsg('Enter your ID and password.'); return; }
    amsg('Logging in…', true);
    const r = await apiTo(pk.url, 'login', { id, password: pw, appKey: pk.secret });
    if (!r.ok) { amsg(trErr(r.error)); return; }
    A = { url: pk.url, appKey: pk.secret, token: r.token, user: r.user }; LS.set('omr_auth', A); $('#aPw').value = '';
    await startSession(r.defaultPassword);
  };
  $('#aPw').onkeydown = e => { if (e.key === 'Enter') $('#aLogin').click(); };
  $('#aReg').onclick = async () => {
    const pk = parseKey($('#aKey').value), name = $('#aName').value.trim(), mob = $('#aMob').value.trim();
    if (pk.error) { amsg(pk.error); $('#aKeyBox').open = true; return; }
    if (!name || !mob) { amsg('Enter your name and mobile number.'); return; }
    amsg('Creating your account…', true);
    const r = await apiTo(pk.url, 'register', { name, mobile: mob, appKey: pk.secret });
    if (!r.ok) { amsg(trErr(r.error)); return; }
    const c = $('#aCred'); c.hidden = false;
    c.innerHTML = 'Your ID: <b>' + esc(r.id) + '</b><br>Your password: <b>' + esc(r.password) + '</b><br><span class="hint">Write these down or take a screenshot. You can change the password after logging in.</span><br><button class="b" id="aGo">Continue to log in</button>';
    $('#aGo').onclick = () => { $('#aId').value = r.id; $('#aPw').value = r.password; authTab(false); amsg('Tap “Log in”.', true); };
    amsg('Account created.', true);
  };
  $('#logoutBtn').onclick = () => {
    if (outbox.length && !confirm('Some changes are not uploaded yet and will be lost. Log out anyway?')) return;
    if (!outbox.length && !confirm('Log out?')) return;
    Object.keys(localStorage).forEach(k => { if (/^omr_(w_|ws_|dir|out|keys|results)/.test(k)) localStorage.removeItem(k); });
    LS.set('omr_auth', { url: A ? A.url : '', appKey: A ? A.appKey || '' : '' }); location.reload();
  };

  // ---------- workspaces (my own, or a group) ----------
  const personalWid = () => 'u:' + A.user.id;
  const groupLabel = g => g.label + (g.name ? ' — ' + g.name : '');
  const isMemberOf = g => g.members.some(m => m.id === A.user.id);
  const myGroups = () => dir.groups.filter(isMemberOf);
  function wsLabel(wid) {
    if (A && wid === personalWid()) return 'My workspace';
    const g = dir.groups.find(x => 'g:' + x.gid === wid); return g ? groupLabel(g) : wid;
  }
  function fillWsSel() {
    const s = $('#wsSel'); if (!A || !A.user) { s.hidden = true; return; }
    const gs = dir.groups.filter(g => isAdmin() || isMemberOf(g));
    s.innerHTML = '<option value="' + esc(personalWid()) + '">👤 My workspace</option>' + gs.map(g => `<option value="g:${esc(g.gid)}">👥 ${esc(groupLabel(g))}</option>`).join('');
    s.value = wsId; s.hidden = false;
  }
  function loadWs(wid) {
    wsId = wid; LS.set('omr_ws_' + A.user.id, wid); lastSig = '';
    const c = LS.get(wsKey(wid), null) || {};
    keys = c.keys || {}; results = c.results || []; papers = c.papers || {}; paperImages = LS.get('omr_pi_' + wsId, {}) || {}; WSS = normWss(c.settings); WLOGO = c.logo || ''; logoDraft = null; applyS();
    keyState = { id: '', tplId: 'builtin', answers: {}, sections: [] }; sc = { sel: null }; submitted = false;
    $('#keyName').value = ''; $('#scanArea').hidden = true; $('#resBox').hidden = true;
    fillSelects(); renderSecs(); renderKey(); updateTimerBtn(); fillWsForm(); renderResults();
    if (window.Paper && Paper.reset) { Paper.reset(); }
  }
  $('#wsSel').onchange = async () => { const v = $('#wsSel').value; await flush(); loadWs(v); pullWs(true); };
  let lastSig = '';
  async function pullWs(loud) {
    if (!A || !A.token || !wsId) return;
    await flush();
    if (outbox.length) { if (loud) toast('Waiting to upload your changes…'); return; }
    const wid = wsId, r = await api('wsSync', { wid });
    if (!r || !r.ok) { if (loud) toast(trErr(r && r.error)); return; }
    if (wid !== wsId || outbox.length) return;
    const nk = {}; r.keys.forEach(k => { nk[k.id] = k; });
    { const sm = LS.get('omr_secs', {}); let ch = false;      // sections: use the server's copy; if the server does not return the field, keep this phone's copy
      Object.keys(nk).forEach(id => { const k = nk[id];
        if (Array.isArray(k.sections)) { if (JSON.stringify(sm[id] || []) !== JSON.stringify(k.sections)) { if (k.sections.length) sm[id] = k.sections; else delete sm[id]; ch = true; } }
        else if (sm[id] && sm[id].length) k.sections = sm[id]; });
      if (ch) LS.set('omr_secs', sm); }
    const np = {}; (r.papers || []).forEach(p => { np[p.id] = p; });
    const ni = {}; (r.images || []).forEach(m => { ni[m.id] = m.data; });
    const nset = normWss(r.settings), sig = JSON.stringify([nk, r.results, nset, r.logo, np, Object.keys(ni).sort()]);
    if (sig === lastSig) { if (loud) toast('Up to date.'); return; }
    const setChanged = JSON.stringify(nset) !== JSON.stringify(WSS) || r.logo !== WLOGO;
    lastSig = sig; keys = nk; papers = np; paperImages = ni; results = r.results; WSS = nset; WLOGO = r.logo || ''; applyS(); saveWsCache();
    if (keyState.id && !keys[keyState.id]) { keyState = { id: '', tplId: 'builtin', answers: {}, sections: [] }; $('#keyName').value = ''; renderSecs(); }
    fillSelects(); renderKey(); updateTimerBtn(); if (setChanged && !logoDraft && !$('#v-set').classList.contains('on')) fillWsForm();
    if ($('#v-res').classList.contains('on')) renderResults();
    if (submitted) refreshResult();
    if (window.Paper && Paper.refresh) Paper.refresh();
  }
  async function pullDir() {
    if (!A || !A.token) return false;
    const r = await api('bootstrap', {}); if (!r || !r.ok) return false;
    dir = { users: r.users, groups: r.groups, requests: r.requests }; LS.set('omr_dir', dir);
    A.user = r.user; LS.set('omr_auth', A);
    const pend = new Set(outbox.filter(o => o.action === 'saveTemplate').map(o => o.payload.template.id));
    const keep = customTpls.filter(t => pend.has(t.id) && !r.templates.some(s => s.id === t.id));
    customTpls = r.templates.concat(keep); saveTpls();
    renderUserBits(); fillWsSel(); fillSelects();
    ['grp', 'prof', 'tpl'].forEach(v => { if ($('#v-' + v).classList.contains('on')) ({ grp: renderGroups, prof: renderProfile, tpl: renderTplList })[v](); });
    return true;
  }
  function renderUserBits() {
    const u = A && A.user; $('#userPill').textContent = u ? u.name : ''; $('#userPill').hidden = !u;
    $('#navTpl').hidden = !canUp(); $('#navAdm').hidden = !isAdmin();
    const n = u ? dir.requests.filter(q => q.to === u.id).length : 0;
    $('#navGrp').innerHTML = 'Groups' + (n ? '<span class="badge">' + n + '</span>' : '');
    const on = document.querySelector('nav button.on'); if (on && on.hidden) gotoTab('key');
  }
  function migrateLegacy() {
    if (!canUp()) return;
    const lk = LS.get('omr_keys', null), lr = LS.get('omr_results', null);
    if (lk && Object.keys(lk).length && !Object.keys(keys).length && wsId === personalWid()) {
      keys = lk; results = lr || []; saveWsCache();
      Object.keys(keys).forEach(id => queue('saveKey', { wid: wsId, key: keys[id] }, 'key:' + id));
      results.forEach(r => queue('saveResult', { wid: wsId, result: r }, 'res:' + r.id));
      localStorage.removeItem('omr_keys'); localStorage.removeItem('omr_results');
      toast('Your earlier answer keys and results were moved to your workspace.');
    }
    customTpls.forEach(t => { if (!t.by) queue('saveTemplate', { template: t }, 'tpl:' + t.id); });
  }
  async function startSession(defPw) {
    $('#authOv').classList.remove('on');
    wsId = ''; loadWs(LS.get('omr_ws_' + A.user.id, '') || personalWid());
    renderUserBits(); migrateLegacy();
    await pullDir();
    if (wsId.indexOf('g:') === 0 && !dir.groups.some(g => 'g:' + g.gid === wsId)) loadWs(personalWid());
    fillWsSel(); renderUserBits(); pullWs(false);
    if (defPw) setTimeout(() => alert('You are using the default admin password. Please change it now: Profile → Change password.'), 300);
  }

  // ---------- Settings tab (rules + heading of the open workspace, and this phone) ----------
  let logoDraft = null;
  function fillWsForm() {
    $('#sPer').value = WSS.per; $('#sNeg').value = WSS.neg; $('#sTim').value = WSS.timerPct; $('#sPass').value = WSS.passPct; $('#sSecPass').value = WSS.secPass;
    $('#hL1').value = WSS.header.l1; $('#hL2').value = WSS.header.l2; $('#hL3').value = WSS.header.l3; $('#hL4').value = WSS.header.l4;
    showLogo();
    $('#sThr').value = DEV.thr; $('#sFill').value = DEV.fillPct;
    $('#wsNote').textContent = A && A.user ? 'These rules and the result sheet heading apply to: ' + wsLabel(wsId) + (wsId.indexOf('g:') === 0 ? ' (every member of the group can change them).' : '.') : '';
  }
  function showLogo() {
    const lg = logoDraft != null ? logoDraft : WLOGO, p = $('#logoPrev');
    p.hidden = !lg; if (lg) p.src = lg; $('#logoDel').hidden = !lg;
  }
  function resizeLogo(file) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        URL.revokeObjectURL(u); let side = 240, out = '';
        for (let t = 0; t < 6; t++) {
          const k = Math.min(1, side / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
          out = cv.toDataURL('image/jpeg', 0.85); if (out.length < 44000) break; side = Math.round(side * 0.75);
        }
        res(out);
      };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not open the image')); };
      im.src = u;
    });
  }
  $('#logoIn').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { logoDraft = await resizeLogo(f); showLogo(); $('#sMsg').className = 'msg'; $('#sMsg').textContent = 'Logo chosen — tap “Save for this workspace”.'; }
    catch (err) { $('#sMsg').textContent = err.message; }
  };
  $('#logoDel').onclick = () => { logoDraft = ''; showLogo(); };
  $('#sSave').onclick = async () => {
    const m = $('#sMsg'); m.className = 'msg';
    const per = parseFloat($('#sPer').value), neg = parseFloat($('#sNeg').value), tp = parseFloat($('#sTim').value), pp = parseFloat($('#sPass').value), sp = parseFloat($('#sSecPass').value);
    if ([per, neg, tp, pp, sp].some(isNaN) || pp < 0 || pp > 100 || sp < 0 || sp > 100 || per < 0 || neg < 0 || tp < 0 || tp > 100) { m.textContent = 'Please enter valid values.'; return; }
    WSS = normWss({ per, neg, timerPct: tp, passPct: pp, secPass: sp, header: { l1: $('#hL1').value.trim(), l2: $('#hL2').value.trim(), l3: $('#hL3').value.trim(), l4: $('#hL4').value.trim() } });
    if (logoDraft != null) WLOGO = logoDraft; logoDraft = null;
    applyS(); saveWsCache(); updateTimerBtn(); refreshResult(); fillWsForm();
    m.className = 'msg ok'; m.textContent = '✔ Saved on this phone — sharing…';
    const r = await queue('saveWs', { wid: wsId, settings: WSS, logo: WLOGO }, 'ws:' + wsId);
    if (r.ok) m.textContent = '✔ Saved' + (wsId.indexOf('g:') === 0 ? ' and shared with the group.' : '.');
    else if (r.error === 'offline') m.textContent = '✔ Saved on this phone. It will be uploaded when the internet is back.';
    else { m.className = 'msg'; m.textContent = 'Saved on this phone, but the server said: ' + r.error; }
  };
  $('#dSave').onclick = () => {
    const m = $('#dMsg'), thr = parseFloat($('#sThr').value), fp = parseFloat($('#sFill').value);
    if (isNaN(thr) || isNaN(fp) || thr < 0.03 || thr > 0.6 || fp < 30 || fp > 95) { m.className = 'msg'; m.textContent = 'Please enter valid values.'; return; }
    DEV.thr = thr; DEV.fillPct = fp; applyS(); saveSettings(); refreshResult(); m.className = 'msg ok'; m.textContent = '✔ Saved on this phone.';
  };

  // ---------- Groups tab ----------
  const act = async (action, payload, okMsg, msgEl) => {
    const r = await api(action, payload);
    if (msgEl) { msgEl.className = 'msg' + (r.ok ? ' ok' : ''); msgEl.textContent = r.ok ? okMsg : trErr(r.error); } else if (!r.ok) toast(trErr(r.error));
    if (r.ok) await pullDir();
    return r;
  };
  function userDatalist() {
    let d = $('#dlUsers'); if (!d) { d = document.createElement('datalist'); d.id = 'dlUsers'; document.body.appendChild(d); }
    d.innerHTML = dir.users.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  }
  function renderGroups() {
    if (!A || !A.user) return; userDatalist();
    const inc = dir.requests.filter(q => q.to === A.user.id);
    $('#invIn').innerHTML = inc.length ? inc.map(q => `<div class="item"><div><b>${esc(q.glabel || 'A group')}${q.gname ? ' — ' + esc(q.gname) : ''}</b><small>${esc(q.fromName)} (${esc(q.from)}) invited you</small></div>
      <div><button class="b sm" data-acc="${esc(q.rid)}">Accept</button> <button class="b red sm" data-dec="${esc(q.rid)}">Decline</button></div></div>`).join('') : '<p class="hint">No invitations.</p>';
    $('#invIn').querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => { await act('respond', { rid: b.dataset.acc, accept: true }); renderGroups(); });
    $('#invIn').querySelectorAll('[data-dec]').forEach(b => b.onclick = async () => { await act('respond', { rid: b.dataset.dec, accept: false }); renderGroups(); });
    const gs = isAdmin() ? dir.groups.slice() : myGroups(), L = $('#grpList');      // the admin sees every group here
    const canDel = g => isAdmin() || g.members.some(m => m.id === A.user.id && m.role === 'owner');
    L.innerHTML = gs.length ? gs.map(g => `<div class="card"><b>${esc(groupLabel(g))}</b>${'g:' + g.gid === wsId ? '<span class="chip g">open now</span>' : ''}
      <div class="hint">Members</div>${g.members.map(m => `<div class="act">${esc(m.name)} • ${esc(m.id)}${m.role === 'owner' ? ' ★' : ''}</div>`).join('')}
      ${dir.requests.filter(q => q.gid === g.gid).map(q => `<div class="act">⏳ Waiting: ${esc(q.toName)} (${esc(q.to)}), invited by ${esc(q.fromName)}</div>`).join('')}
      ${isMemberOf(g) ? `<div class="sm2" style="margin-top:8px"><input list="dlUsers" placeholder="ID (mobile) of the user to invite" data-inv="${esc(g.gid)}"><button class="b sm" data-send="${esc(g.gid)}">Send request</button></div>` : '<div class="hint">You are not a member of this group (admin view).</div>'}
      <button class="b alt sm" data-use="${esc(g.gid)}" style="margin-top:8px">Open this group</button>
      ${isMemberOf(g) ? `<button class="b alt sm" data-ren="${esc(g.gid)}" style="margin-top:8px">Rename</button>
      <button class="b alt sm" data-leave="${esc(g.gid)}" style="margin-top:8px">Leave</button>` : ''}
      ${canDel(g) ? `<button class="b red sm" data-delgrp="${esc(g.gid)}" data-gn="${esc(groupLabel(g))}" style="margin-top:8px">🗑 Delete group</button>` : ''}<div class="msg" data-gm="${esc(g.gid)}"></div></div>`).join('')
      : '<div class="card"><p class="hint">You are not in any group yet. Create one above, or accept an invitation.</p></div>';
    L.querySelectorAll('[data-send]').forEach(b => b.onclick = async () => {
      const gid = b.dataset.send, inp = L.querySelector('[data-inv="' + gid + '"]'), msg = L.querySelector('[data-gm="' + gid + '"]');
      if (!inp.value.trim()) { msg.className = 'msg'; msg.textContent = 'Type or pick the user ID first.'; return; }
      const r = await act('invite', { gid, to: inp.value.trim() }); renderGroups();
      const m2 = $('#grpList').querySelector('[data-gm="' + gid + '"]'); if (m2) { m2.className = 'msg' + (r.ok ? ' ok' : ''); m2.textContent = r.ok ? 'Request sent. The user must accept it.' : trErr(r.error); }
    });
    L.querySelectorAll('[data-use]').forEach(b => b.onclick = async () => { await flush(); loadWs('g:' + b.dataset.use); fillWsSel(); pullWs(true); gotoTab('key'); });
    L.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => {
      const g = gs.find(x => x.gid === b.dataset.ren), n = prompt('Group name', g.name); if (n === null) return;
      await act('renameGroup', { gid: g.gid, name: n }); renderGroups();
    });
    L.querySelectorAll('[data-delgrp]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete the group “' + b.dataset.gn + '”?\n\nIts members are removed and ALL its answer keys, results and question papers are deleted for everybody. Personal workspaces are not touched.\n\nThis cannot be undone.')) return;
      const gid = b.dataset.delgrp, wid = 'g:' + gid;
      outbox = outbox.filter(o => !(o.payload && o.payload.wid === wid)); LS.set('omr_out', outbox);      // nothing more to upload to a group that is going away
      await flush();
      const r = await act('deleteGroup', { gid });
      if (r.ok) { try { localStorage.removeItem(wsKey(wid)); localStorage.removeItem('omr_pi_' + wid); } catch (e) { /* ignore */ } if (wsId === wid) loadWs(personalWid()); fillWsSel(); renderGroups(); toast('Group deleted.'); }
    });
    L.querySelectorAll('[data-leave]').forEach(b => b.onclick = async () => {
      if (!confirm('Leave this group? You will no longer see its answer keys and results.')) return;
      const gid = b.dataset.leave; await flush();
      const r = await act('leaveGroup', { gid }); if (r.ok) { if (wsId === 'g:' + gid) loadWs(personalWid()); fillWsSel(); renderGroups(); }
    });
  }
  $('#gCreate').onclick = async () => {
    const r = await act('createGroup', { name: $('#gName').value.trim() }, '✔ Group created. Invite members below.', $('#gMsg'));
    if (r.ok) { $('#gName').value = ''; renderGroups(); }
  };

  // ---------- secret key card (admin) ----------
  let keyInfo = null;
  async function renderKeyCard() {
    const card = $('#keyCard'); card.hidden = !isAdmin(); if (!isAdmin() || !A || !A.url) return;
    if (!keyInfo) { const r = await api('getAppKey', {}); if (!r || !r.ok) { $('#kyMsg').textContent = r && r.error ? trErr(r.error) : ''; return; } keyInfo = { secret: r.secret, required: r.required }; }
    const key = makeKey(A.url, keyInfo.secret); $('#kyVal').value = key || 'The server address is not a standard Google Apps Script address, so a key cannot be made. Share the address itself.'; $('#kyReq').checked = !!keyInfo.required;
  }
  const kmsg = (t, ok) => { const m = $('#kyMsg'); m.textContent = t; m.className = 'msg' + (ok ? ' ok' : ''); };
  async function copyText(t, what) {
    try { await navigator.clipboard.writeText(t); kmsg('✔ ' + what + ' copied.', true); } catch (e) { window.prompt('Copy this ' + what + ':', t); }
  }
  $('#kyCopy').onclick = () => { const k = $('#kyVal').value; if (/^OMR\./.test(k)) copyText(k, 'key'); };
  $('#kyLink').onclick = () => { const k = $('#kyVal').value; if (/^OMR\./.test(k)) copyText(location.origin + location.pathname + '#k=' + encodeURIComponent(k), 'login link'); };
  $('#kyReq').onchange = async e => {
    const on = e.target.checked;
    if (on && !confirm('From now on nobody can log in or sign up without the secret key.\n\nMake sure you have already sent the key (or login link) to your users. People who are already logged in are not affected.\n\nTurn it on?')) { e.target.checked = false; return; }
    const r = await api('setKeyRequired', { value: on });
    if (r && r.ok) { keyInfo.required = on; kmsg(on ? '✔ Secret key is now required.' : '✔ Secret key is no longer required.', true); } else { e.target.checked = !on; kmsg(trErr(r && r.error)); }
  };
  $('#kyNew').onclick = async () => {
    if (!confirm('Make a new key? The old key (and any login link you sent) stops working for new logins and sign-ups. Send the new key to your users afterwards.')) return;
    const r = await api('newAppKey', {});
    if (r && r.ok) { keyInfo.secret = r.secret; A.appKey = r.secret; LS.set('omr_auth', A); renderKeyCard(); kmsg('✔ New key made. Send it to your users.', true); } else kmsg(trErr(r && r.error));
  };

  // ---------- Profile tab ----------
  function renderProfile() {
    if (!A || !A.user) return; userDatalist();
    const u = A.user; $('#pName').textContent = u.name; $('#pRole').textContent = u.role === 'admin' ? 'Admin' : (u.canUpload ? 'User • can upload sheets' : 'User');
    $('#pRole').className = 'chip ' + (u.role === 'admin' ? 'a' : u.canUpload ? 'g' : ''); $('#pId').textContent = 'ID: ' + u.id;
    const gs = dir.groups.filter(g => isAdmin() || isMemberOf(g)), cur = $('#invGroup').value;
    $('#invGroup').innerHTML = gs.length ? gs.map(g => `<option value="${esc(g.gid)}">${esc(groupLabel(g))}</option>`).join('') : '<option value="">— you are not in a group —</option>';
    if (cur && gs.some(g => g.gid === cur)) $('#invGroup').value = cur;
    const q = $('#uSearch').value.trim().toLowerCase(), g = dir.groups.find(x => x.gid === $('#invGroup').value);
    const L = dir.users.filter(x => !q || x.name.toLowerCase().indexOf(q) >= 0 || x.id.toLowerCase().indexOf(q) >= 0);
    $('#uList').innerHTML = L.length ? L.map(x => {
      const isMem = g && g.members.some(m => m.id === x.id), pend = g && dir.requests.some(r => r.gid === g.gid && r.to === x.id);
      const inv = g && x.id !== u.id && !isMem ? (pend ? '<span class="hint">invited</span>' : `<button class="b sm" data-inv="${esc(x.id)}">Invite</button>`) : '';
      const adm = isAdmin() && x.role !== 'admin' ? `<label class="hint" style="display:inline-block;margin:0 6px 0 0"><input type="checkbox" style="width:auto" data-up="${esc(x.id)}" ${x.canUpload ? 'checked' : ''}> can upload sheets</label><button class="b alt sm" data-rp="${esc(x.id)}">Reset password</button> <button class="b red sm" data-du="${esc(x.id)}" data-dn="${esc(x.name)}">Delete</button>` : '';
      return `<div class="item"><div><b>${esc(x.name)}</b>${x.role === 'admin' ? '<span class="chip a">Admin</span>' : x.canUpload ? '<span class="chip g">uploader</span>' : ''}<small>ID ${esc(x.id)}</small></div><div style="text-align:right">${inv}${adm}</div></div>`;
    }).join('') : '<p class="hint">No users found.</p>';
    $('#uList').querySelectorAll('[data-inv]').forEach(b => b.onclick = async () => {
      const r = await act('invite', { gid: $('#invGroup').value, to: b.dataset.inv }); if (r.ok) { toast('Request sent.'); renderProfile(); }
    });
    $('#uList').querySelectorAll('[data-up]').forEach(c => c.onchange = async () => { await act('setUpload', { id: c.dataset.up, value: c.checked }); renderProfile(); });
    $('#uList').querySelectorAll('[data-rp]').forEach(b => b.onclick = async () => {
      if (!confirm('Create a new password for this user?')) return;
      const r = await api('resetPassword', { id: b.dataset.rp }); if (r.ok) alert('New password: ' + r.password + '\nGive it to the user. They can change it after logging in.'); else toast(trErr(r.error));
    });
    renderKeyCard();
    $('#uList').querySelectorAll('[data-du]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete the user “' + b.dataset.dn + '” (ID ' + b.dataset.du + ')?\n\nTheir account, group memberships and their own workspace data (answer keys, results, question papers) will be deleted. Data inside groups stays.\n\nThis cannot be undone.')) return;
      const r = await api('deleteUser', { id: b.dataset.du });
      if (r && r.ok) { toast('User deleted.'); await pullDir(); renderProfile(); } else toast(trErr(r && r.error));
    });
  }
  $('#uSearch').oninput = renderProfile; $('#invGroup').onchange = renderProfile;
  $('#pwSave').onclick = async () => {
    const m = $('#pwMsg'), o = $('#pwOld').value, n = $('#pwNew').value;
    if (!o || n.length < 6) { m.className = 'msg'; m.textContent = 'Enter your current password and a new one (6+ characters).'; return; }
    const r = await api('changePassword', { oldPassword: o, newPassword: n });
    if (r.ok) { A.token = r.token; LS.set('omr_auth', A); $('#pwOld').value = ''; $('#pwNew').value = ''; m.className = 'msg ok'; m.textContent = '✔ Password changed.'; }
    else { m.className = 'msg'; m.textContent = trErr(r.error); }
  };

  // ---------- Admin tab ----------
  async function loadAdmin() {
    if (!isAdmin()) return;
    $('#admGroups').innerHTML = '<p class="hint">Loading…</p>';
    const r = await api('overview', {}); if (!r.ok) { $('#admGroups').innerHTML = '<p class="msg">' + esc(trErr(r.error)) + '</p>'; return; }
    const lab = {}; r.groups.forEach(g => { lab['g:' + g.gid] = groupLabel(g); });
    $('#admGroups').innerHTML = r.groups.length ? r.groups.map(g => `<div class="item"><div><b>${esc(groupLabel(g))}</b><small>${g.members.map(m => esc(m.name)).join(', ')}<br>${g.keys} answer key(s) • ${g.results} result(s)${g.last ? ' • last activity ' + esc(new Date(g.last).toLocaleString()) : ''}</small></div>
      <div><button class="b sm" data-open="${esc(g.gid)}">Open</button><br><button class="b red sm" data-delg="${esc(g.gid)}" data-gn="${esc(groupLabel(g))}" style="margin-top:6px">Delete</button></div></div>`).join('') : '<p class="hint">No groups yet.</p>';
    $('#admGroups').querySelectorAll('[data-open]').forEach(b => b.onclick = async () => { await flush(); loadWs('g:' + b.dataset.open); fillWsSel(); pullWs(true); gotoTab('res'); });
    $('#admGroups').querySelectorAll('[data-delg]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete the group “' + b.dataset.gn + '”?\n\nIts members are removed from it and ALL its answer keys, results and question papers are deleted for everybody. People\'s personal workspaces are not touched.\n\nThis cannot be undone.')) return;
      const gid = b.dataset.delg, rr = await api('deleteGroup', { gid });
      if (rr && rr.ok) { if (wsId === 'g:' + gid) loadWs(personalWid()); await pullDir(); fillWsSel(); renderGroups(); loadAdmin(); toast('Group deleted.'); } else toast(trErr(rr && rr.error));
    });
    $('#admAct').innerHTML = r.activity.length ? r.activity.map(x => `<div class="act">${esc(new Date(x.t).toLocaleString())} • <b>${esc(x.name)}</b> ${esc(x.action)}${x.detail ? ' — ' + esc(x.detail) : ''}<br><span class="hint">${esc(lab[x.wid] || (x.wid ? 'personal workspace' : 'account'))}</span></div>`).join('') : '<p class="hint">Nothing yet.</p>';
  }
  $('#admRef').onclick = loadAdmin;

  // ---------- install (PWA) ----------
  let dip = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => { if (dip) { dip.prompt(); await dip.userChoice; dip = null; $('#installBtn').hidden = true; } };
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $('#iosHint').hidden = false;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

  // ---------- start ----------
  applyS(); fillSelects(); updateTimerBtn(); renderKey(); renderTplList();
  if (A && A.token && A.user) startSession(false); else showAuth('');
  setInterval(() => { if (A && A.token && !document.hidden) { pullWs(false); if ((setInterval.n = (setInterval.n || 0) + 1) % 3 === 0) pullDir(); } }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && A && A.token) { pullWs(false); pullDir(); } });
  // ---------- bridge for paper.js (question papers) ----------
  window.OMRApp = {
    tpls: allTpls, getTpl, papers: () => papers, isGroup: () => wsId.indexOf('g:') === 0, me: () => (A && A.user) || null,
    canUp, gotoTab, resizeLogo, needReport, download, wsLogo: () => WLOGO, wsHead: () => WSS.header,
    images: () => paperImages,
    savePaper(p, imgs) { papers[p.id] = p; (imgs || []).forEach(m => { paperImages[m.id] = m.data; }); saveWsCache(); return queue('savePaper', { wid: wsId, paper: p, images: imgs || [] }, 'paper:' + p.id); },
    deletePaper(id) { delete papers[id]; saveWsCache(); queue('deletePaper', { wid: wsId, id }, 'paper:' + id); },
    saveKey(k) { const old = keys[k.id]; if (old && old.sections && k.sections === undefined) k = Object.assign({}, k, { sections: old.sections }); keys[k.id] = k; saveKeys(); fillSelects(); renderKey(); return queue('saveKey', { wid: wsId, key: k }, 'key:' + k.id); }
  };
  window.__omr = { get state() { return { S, keys, results, sc, keyState, customTpls, wiz }; } }; // for debugging / tests
})();
