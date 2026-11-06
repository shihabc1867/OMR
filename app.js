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
  const DEF = { pin: '1234', per: 1, neg: 0.25, timerPct: 3, thr: 0.18, fillPct: 70, url: '' };
  let S = Object.assign({}, DEF, LS.get('omr_settings', {}));
  let customTpls = LS.get('omr_templates', []);   // [{id,name,W,H,ref,align,rx,ry,labels,groups}]
  let keys = LS.get('omr_keys', {});              // id -> {id,name,tplId,answers:{ "1":optIndex }}
  let results = LS.get('omr_results', []);
  let keyState = { id: '', tplId: 'builtin', answers: {} };
  let sc = { sel: null };
  let submitted = false, timerOn = false, pinOK = false;
  const builtin = OMR.builtinTemplate();
  const allTpls = () => [builtin].concat(customTpls);
  const getTpl = id => allTpls().find(t => t.id === id) || null;
  const labelOf = (tpl, o) => (tpl.labels && tpl.labels[o]) || String.fromCharCode(65 + o);
  const saveSettings = () => LS.set('omr_settings', S);
  const saveKeys = () => LS.set('omr_keys', keys);
  const saveResults = () => LS.set('omr_results', results);
  const saveTpls = () => LS.set('omr_templates', customTpls);

  // ---------- tabs ----------
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.id === 'v-' + b.dataset.v));
    if (b.dataset.v === 'res') renderResults();
    if (b.dataset.v === 'scan') fillSelects();
    if (b.dataset.v === 'tpl') renderTplList();
  });

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
  }
  keyCv.onclick = ev => {
    const tpl = keyTpl(), h = hit(keyCv, ev, tpl); if (!h) return;
    const q = String(h[0] + 1);
    if (keyState.answers[q] === h[1]) delete keyState.answers[q]; else keyState.answers[q] = h[1];
    renderKey();
  };
  $('#keySel').onchange = () => {
    const id = $('#keySel').value;
    keyState = id && keys[id] ? { id, tplId: keys[id].tplId, answers: Object.assign({}, keys[id].answers) } : { id: '', tplId: $('#keyTpl').value || 'builtin', answers: {} };
    $('#keyName').value = id ? keys[id].name : ''; fillSelects(); renderKey();
  };
  $('#keyTpl').onchange = () => { keyState = { id: '', tplId: $('#keyTpl').value, answers: {} }; renderKey(); };
  $('#keyClear').onclick = () => { keyState.answers = {}; renderKey(); };

  function requirePin() {
    if (pinOK) return true;
    const p = prompt('Enter admin PIN');
    if (p === null) return false;
    if (p === S.pin) { pinOK = true; return true; }
    alert('Wrong PIN'); return false;
  }
  $('#keySave').onclick = async () => {
    const msg = $('#keyMsg'); msg.className = 'msg';
    if (!Object.keys(keyState.answers).length) { msg.textContent = 'Set the answer for at least one question.'; return; }
    if (!requirePin()) return;
    const id = keyState.id || 'k' + Date.now();
    const name = $('#keyName').value.trim() || 'Answer key ' + (Object.keys(keys).length + 1);
    keys[id] = { id, name, tplId: keyState.tplId, answers: Object.assign({}, keyState.answers) };
    keyState.id = id; $('#keyName').value = name; saveKeys(); fillSelects(); renderKey();
    msg.className = 'msg ok'; msg.textContent = '✔ Saved on this device.';
    const r = await api('saveKey', { key: keys[id] });
    if (r && !r.ok) { msg.className = 'msg'; msg.textContent = 'Saved on this device, but not on the server: ' + (r.error || 'error'); }
    else if (r) msg.textContent = '✔ Saved (also on the server).';
  };
  $('#keyDel').onclick = () => {
    const id = keyState.id;
    if (!id) { $('#keyMsg').className = 'msg'; $('#keyMsg').textContent = 'Select a saved answer key first.'; return; }
    if (!confirm('Delete this answer key?') || !requirePin()) return;
    delete keys[id]; saveKeys(); keyState = { id: '', tplId: 'builtin', answers: {} }; $('#keyName').value = '';
    fillSelects(); renderKey(); api('deleteKey', { id });
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
    smsg('Scanning…', true);
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
  function runScan() {
    const tpl = scanTplObj(), p = sc.photo;
    const r = OMR.scanTpl(p.rgba, p.w, p.h, tpl, { pts: sc.pts || undefined, rot: sc.pts ? undefined : sc.rot });
    if (!r.found) {
      smsg('Could not find the sheet corners automatically. Place the four handles on the sheet corners.');
      const quad = sc.lastQuad || insetQuad(p.w, p.h);
      openCorners(p, quad, cornerHint(tpl), pts => { sc.pts = pts; sc.lastQuad = pts; runScan(); });
      return;
    }
    learnMarkers(tpl, p, r);
    sc.rot = r.rot; sc.res = r; sc.lastQuad = r.quad; const A = OMR.analyze(r.dark, r.fill, { thr: S.thr, fillMin: (S.fillPct || 70) / 100 }, r.raw);
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

  function compute(sel, key, tOn, bad) {
    let c = 0, w = 0, b = 0; const wrongQs = [], qs = Object.keys(key.answers).map(Number).sort((a, z) => a - z);
    qs.forEach(q => {
      const s = sel[q - 1] || [];
      if (bad && bad.has(q - 1)) { w++; wrongQs.push(q); }
      else if (!s.length) b++; else if (s.length === 1 && s[0] === key.answers[q]) c++; else { w++; wrongQs.push(q); }
    });
    const total = qs.length * S.per, neg = w * S.neg, tim = tOn ? total * S.timerPct / 100 : 0;
    return { c, w, b, n: qs.length, total, neg, tim, fin: Math.max(0, c * S.per - neg - tim), wrongQs };
  }
  function showResult(r) {
    $('#rC').textContent = r.c; $('#rW').textContent = r.w; $('#rB').textContent = r.b;
    $('#rM').textContent = fmt(r.total); $('#rN').textContent = '− ' + fmt(r.neg);
    $('#rT').textContent = timerOn ? '− ' + fmt(r.tim) : '0';
    $('#rF').textContent = fmt(r.fin) + ' / ' + fmt(r.total);
    $('#rS').textContent = '+' + fmt(S.per) + ' per correct, −' + fmt(S.neg) + ' per wrong (multiple or partly filled marks count as wrong)';
    $('#resBox').hidden = false;
  }
  let syncT = null;
  function refreshResult() {
    if (!submitted) return; const key = keys[$('#scanKey').value]; if (!key) return;
    renderScan(); showResult(compute(sc.sel, key, timerOn, sc.bad)); storeRecord();
  }
  function storeRecord() {
    const key = keys[$('#scanKey').value], r = compute(sc.sel, key, timerOn, sc.bad);
    const rec = Object.assign({ id: sc.rid, t: Date.now(), keyId: key.id, keyName: key.name, student: $('#stuName').value.trim() || 'Unknown', sel: sc.sel.map(s => s.slice()), bad: Array.from(sc.bad || []), timer: timerOn }, r);
    const i = results.findIndex(x => x.id === rec.id);
    if (i >= 0) { rec.t = results[i].t; results[i] = rec; } else results.unshift(rec);
    saveResults(); clearTimeout(syncT); syncT = setTimeout(() => api('saveResult', { result: rec }), 800);
  }
  $('#submitBtn').onclick = () => {
    if (!sc.sel) return; if (!keys[$('#scanKey').value]) { smsg('Choose an answer key.'); return; }
    if (!sc.rid) sc.rid = 'r' + Date.now();
    submitted = true; refreshResult(); $('#resBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ---------- results tab ----------
  function renderResults() {
    const L = $('#resList');
    if (!results.length) { L.innerHTML = '<p class="hint">No results yet.</p>'; return; }
    L.innerHTML = results.slice().sort((a, b) => b.t - a.t).map(r =>
      `<div class="item"><div><b>${esc(r.student)}</b><small>${esc(r.keyName)} • ${esc(new Date(r.t).toLocaleString())}<br>Correct ${r.c} • Wrong ${r.w} • Blank ${r.b}${r.timer ? ' • Timer penalty' : ''}${r.wrongQs && r.wrongQs.length ? '<br>Wrong Q: ' + esc(r.wrongQs.join(', ')) : ''}</small></div>
      <div style="text-align:right"><b class="ok">${fmt(r.fin)}/${fmt(r.total)}</b><br><button class="b red sm" data-del="${esc(r.id)}">Delete</button></div></div>`).join('');
    L.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (!confirm('Delete this result?') || !requirePin()) return;
      results = results.filter(r => r.id !== b.dataset.del); saveResults(); renderResults(); api('deleteResult', { id: b.dataset.del });
    });
  }
  $('#resCsv').onclick = () => {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = [['Time', 'Student', 'Answer key', 'Correct', 'Wrong', 'Unanswered', 'Total marks', 'Wrong penalty', 'Timer penalty', 'Score', 'Wrong questions']];
    results.slice().sort((a, b) => a.t - b.t).forEach(r => rows.push([new Date(r.t).toLocaleString(), r.student, r.keyName, r.c, r.w, r.b, r.total, r.neg, r.tim, r.fin, (r.wrongQs || []).join(' ')]));
    download(new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), 'omr-results.csv');
  };
  $('#resSync').onclick = async () => { await pull(true); renderResults(); };

  // ---------- sheet types (templates) ----------
  function renderTplList() {
    $('#tplList').innerHTML = allTpls().map(t => {
      const ks = {}; t.groups.forEach(g => ks[g.pts.length] = (ks[g.pts.length] || 0) + 1);
      const opt = Object.keys(ks).map(k => ks[k] + '×' + k).join(', ');
      return `<div class="item"><div><b>${esc(t.name)}</b><small>${t.groups.length} questions • options: ${opt} • alignment: ${esc(t.align)}</small></div>
      ${t.builtin ? '' : `<button class="b red sm" data-dt="${esc(t.id)}">Delete</button>`}</div>`;
    }).join('');
    document.querySelectorAll('[data-dt]').forEach(b => b.onclick = () => {
      const id = b.dataset.dt;
      if (Object.keys(keys).some(k => keys[k].tplId === id)) { alert('Delete the answer keys that use this sheet type first.'); return; }
      if (!confirm('Delete this sheet type?') || !requirePin()) return;
      customTpls = customTpls.filter(t => t.id !== id); saveTpls(); renderTplList(); fillSelects(); api('deleteTemplate', { id });
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
    if (!requirePin()) return;
    const name = $('#wName').value.trim() || 'Sheet ' + (customTpls.length + 1);
    const maxK = Math.max.apply(null, wiz.groups.map(g => g.pts.length)), lab = $('#wLab').value;
    const labels = []; for (let o = 0; o < maxK; o++) labels.push(lab === '1' ? String(o + 1) : String.fromCharCode((lab === 'a' ? 97 : 65) + o));
    const tpl = OMR.makeTemplate(wiz.base, { rx: wiz.rx, ry: wiz.ry }, wiz.groups, { id: 't' + Date.now(), name, align: wiz.mk ? (wiz.align === 'page' ? 'auto' : 'markers') : (wiz.align || 'manual'), mk: wiz.mk || null, labels });
    customTpls.push(tpl);
    if (!saveTpls()) { customTpls.pop(); m.textContent = 'Could not save (device storage is full).'; return; }
    fillSelects(); renderTplList();
    wiz = null; $('#wizEdit').hidden = true; $('#wizStart').hidden = false; $('#wName').value = '';
    wmsg('✔ Sheet type “' + name + '” saved. Now create an answer key for it in the Answer Key tab.', true);
    const r = await api('saveTemplate', { template: tpl });
    if (r && !r.ok) wmsg('Saved on this device, but not on the server: ' + (r.error || 'error'));
  };

  // ---------- settings ----------
  function fillSettings() { $('#sPer').value = S.per; $('#sNeg').value = S.neg; $('#sTim').value = S.timerPct; $('#sThr').value = S.thr; $('#sFill').value = S.fillPct; $('#sUrl').value = S.url; }
  $('#sSave').onclick = async () => {
    const m = $('#sMsg'); m.className = 'msg';
    if ($('#sPin').value !== S.pin) { m.textContent = 'Wrong admin PIN.'; return; }
    const per = parseFloat($('#sPer').value), neg = parseFloat($('#sNeg').value), tp = parseFloat($('#sTim').value), thr = parseFloat($('#sThr').value), fp = parseFloat($('#sFill').value);
    if ([per, neg, tp, thr, fp].some(isNaN) || fp < 30 || fp > 95 || per < 0 || neg < 0 || tp < 0 || tp > 100 || thr < 0.03 || thr > 0.6) { m.textContent = 'Please enter valid values.'; return; }
    const np = $('#sNewPin').value.trim(), oldPin = S.pin;
    S = Object.assign(S, { per, neg, timerPct: tp, thr, fillPct: fp, url: $('#sUrl').value.trim() });
    if (np) S.pin = np;
    saveSettings(); pinOK = true; updateTimerBtn(); refreshResult();
    $('#sNewPin').value = ''; $('#sPin').value = '';
    m.className = 'msg ok'; m.textContent = '✔ Saved.';
    if (S.url) {
      const r = await api('saveSettings', { pin: oldPin, newPin: np || undefined, settings: { per, neg, timerPct: tp, thr } });
      if (r && !r.ok) { m.className = 'msg'; m.textContent = 'Saved on this device, but not on the server: ' + (r.error || 'error'); }
      else if (r) m.textContent = '✔ Saved (also on the server).';
    }
  };

  // ---------- Apps Script sync ----------
  async function api(action, payload) {
    if (!S.url) return null;
    try {
      const res = await fetch(S.url, { method: 'POST', body: JSON.stringify(Object.assign({ action, pin: S.pin }, payload)) });
      return await res.json();
    } catch (e) { return { ok: false, error: 'network problem' }; }
  }
  async function pull(loud) {
    if (!S.url) { if (loud) alert('No Apps Script URL is set in Settings.'); return; }
    try {
      const r = await (await fetch(S.url + (S.url.includes('?') ? '&' : '?') + 'action=bootstrap')).json();
      if (!r.ok) throw new Error(r.error || 'error');
      (r.templates || []).forEach(t => { if (!customTpls.some(x => x.id === t.id)) customTpls.push(t); }); saveTpls();
      (r.keys || []).forEach(k => keys[k.id] = k); saveKeys();
      if (r.settings) { ['per', 'neg', 'timerPct', 'thr'].forEach(f => { if (typeof r.settings[f] === 'number') S[f] = r.settings[f]; }); saveSettings(); fillSettings(); updateTimerBtn(); }
      const have = new Set(results.map(x => x.id)); (r.results || []).forEach(x => { if (!have.has(x.id)) results.push(x); }); saveResults();
      fillSelects(); renderKey(); renderTplList();
    } catch (e) { if (loud) alert('Could not fetch from the server: ' + e.message); }
  }

  // ---------- install (PWA) ----------
  let dip = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => { if (dip) { dip.prompt(); await dip.userChoice; dip = null; $('#installBtn').hidden = true; } };
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $('#iosHint').hidden = false;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

  // ---------- start ----------
  fillSettings(); fillSelects(); updateTimerBtn(); renderKey(); renderTplList(); pull(false);
  window.__omr = { get state() { return { S, keys, results, sc, keyState, customTpls, wiz }; } }; // for debugging / tests
})();
