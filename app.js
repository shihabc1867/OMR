/* app.js — OMR স্ক্যানার: UI, সংরক্ষণ, ফলাফল গণনা, Apps Script সিঙ্ক */
(function () {
  'use strict';
  const C = OMR.C;
  const $ = s => document.querySelector(s);
  const FONT = '"Noto Sans Bengali","Kalpurush","SolaimanLipi","Nirmala UI",system-ui,sans-serif';
  const OPTS = ['ক', 'খ', 'গ', 'ঘ'];
  const BN = '০১২৩৪৫৬৭৮৯';
  const bn = n => String(n).replace(/\d/g, d => BN[d]);
  const fmt = x => bn(Math.round(x * 100) / 100);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };

  // ---------- অবস্থা ----------
  const DEF = { pin: '1234', per: 1, neg: 0.25, timerPct: 3, thr: 0.18, url: '' };
  let S = Object.assign({}, DEF, LS.get('omr_settings', {}));
  let keys = LS.get('omr_keys', {});        // id -> {id,name,answers:{ "1":opt }}
  let results = LS.get('omr_results', []);  // [{id,t,keyId,keyName,student,sel,timer,c,w,b,n,total,neg,tim,fin}]
  let keyState = { id: '', answers: {} };
  let sc = { sel: null };                   // বর্তমান স্ক্যান
  let submitted = false, timerOn = false, pinOK = false;

  const saveSettings = () => LS.set('omr_settings', S);
  const saveKeys = () => LS.set('omr_keys', keys);
  const saveResults = () => LS.set('omr_results', results);

  // ---------- ট্যাব ----------
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.id === 'v-' + b.dataset.v));
    if (b.dataset.v === 'res') renderResults();
    if (b.dataset.v === 'scan') fillKeySelects();
  });

  // ---------- জুম ----------
  document.querySelectorAll('.zoom').forEach(z => {
    const lv = [1, 1.6, 2.4, 3.4]; let i = 0;
    z.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
      i = Math.max(0, Math.min(lv.length - 1, i + Number(b.dataset.d)));
      document.getElementById(z.dataset.for).style.width = lv[i] * 100 + '%';
    });
  });

  // ---------- শিট আঁকা ----------
  function drawSheet(ctx, title) {
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, C.W, C.H);
    ctx.fillStyle = '#000';
    OMR.MARKERS.forEach(p => ctx.fillRect(p[0] - C.MK / 2, p[1] - C.MK / 2, C.MK, C.MK));
    ctx.fillStyle = '#111'; ctx.textAlign = 'center';
    ctx.font = 'bold 34px ' + FONT; ctx.fillText(title || 'OMR উত্তরপত্র', C.W / 2, 105);
    ctx.font = '20px ' + FONT; ctx.textAlign = 'left';
    ctx.fillText('নাম: ______________________________', 110, 160);
    ctx.fillText('রোল: ______________', 640, 160);
    ctx.textAlign = 'center'; ctx.font = 'bold 17px ' + FONT;
    for (let c = 0; c < C.COLS; c++) for (let o = 0; o < C.OPT; o++) ctx.fillText(OPTS[o], OMR.bubble(c * C.ROWS, o)[0], C.GY0 - 34);
    ctx.lineWidth = 2; ctx.strokeStyle = '#222';
    for (let q = 0; q < C.ROWS * C.COLS; q++) for (let o = 0; o < C.OPT; o++) {
      const p = OMR.bubble(q, o); ctx.beginPath(); ctx.arc(p[0], p[1], C.BR, 0, 7); ctx.stroke();
    }
    ctx.textAlign = 'right'; ctx.font = 'bold 16px ' + FONT; ctx.fillStyle = '#111';
    for (let q = 0; q < C.ROWS * C.COLS; q++) { const p = OMR.bubble(q, 0); ctx.fillText(bn(q + 1), p[0] - C.BR - 11, p[1] + 6); }
    ctx.textAlign = 'center'; ctx.font = '16px ' + FONT; ctx.fillStyle = '#444';
    ctx.fillText('বৃত্ত সম্পূর্ণ ভরাট করুন • কোণার চারটি কালো বর্গ ঢাকবেন না • ভাঁজ করবেন না', C.W / 2, 1385);
    ctx.restore();
  }
  function circ(ctx, q, o, fill, stroke, dash) {
    const p = OMR.bubble(q, o);
    ctx.save(); ctx.beginPath(); ctx.arc(p[0], p[1], C.BR + 4, 0, 7);
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = stroke;
    if (dash) ctx.setLineDash([5, 4]); ctx.stroke(); ctx.restore();
  }
  // স্ক্রিনের ট্যাপ → (প্রশ্ন, অপশন)
  function hit(cv, ev) {
    const r = cv.getBoundingClientRect();
    const x = (ev.clientX - r.left) * cv.width / r.width, y = (ev.clientY - r.top) * cv.height / r.height;
    let best = null, bd = 20 * 20;
    for (let q = 0; q < C.ROWS * C.COLS; q++) for (let o = 0; o < C.OPT; o++) {
      const p = OMR.bubble(q, o), d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
      if (d < bd) { bd = d; best = [q, o]; }
    }
    return best;
  }

  // ---------- উত্তরমালা ট্যাব ----------
  const keyCv = $('#keyCv');
  keyCv.width = C.W; keyCv.height = C.H;
  function renderKey() {
    const x = keyCv.getContext('2d');
    drawSheet(x, 'উত্তরমালা' + ($('#keyName').value ? ' — ' + $('#keyName').value : ''));
    const qs = Object.keys(keyState.answers);
    qs.forEach(q => {
      const p = OMR.bubble(q - 1, keyState.answers[q]);
      x.beginPath(); x.arc(p[0], p[1], C.BR - 1, 0, 7); x.fillStyle = '#111'; x.fill();
    });
    $('#keyCount').textContent = 'নির্ধারিত উত্তর: ' + bn(qs.length) + 'টি';
  }
  keyCv.onclick = ev => {
    const h = hit(keyCv, ev); if (!h) return;
    const q = String(h[0] + 1);
    if (keyState.answers[q] === h[1]) delete keyState.answers[q]; else keyState.answers[q] = h[1];
    renderKey();
  };
  $('#keyName').oninput = renderKey;

  function fillKeySelects() {
    const ids = Object.keys(keys);
    const opt = ids.map(id => `<option value="${esc(id)}">${esc(keys[id].name)} (${bn(Object.keys(keys[id].answers).length)} প্রশ্ন)</option>`).join('');
    const ks = $('#keySel'); ks.innerHTML = '<option value="">＋ নতুন উত্তরমালা</option>' + opt; ks.value = keyState.id;
    const ss = $('#scanKey'), cur = ss.value;
    ss.innerHTML = ids.length ? opt : '<option value="">— আগে উত্তরমালা সংরক্ষণ করুন —</option>';
    if (cur && keys[cur]) ss.value = cur;
  }
  $('#keySel').onchange = () => {
    const id = $('#keySel').value;
    keyState = id && keys[id] ? { id, answers: Object.assign({}, keys[id].answers) } : { id: '', answers: {} };
    $('#keyName').value = id ? keys[id].name : '';
    renderKey();
  };
  $('#keyClear').onclick = () => { keyState.answers = {}; renderKey(); };

  function requirePin() {
    if (pinOK) return true;
    const p = prompt('অ্যাডমিন পিন দিন');
    if (p === null) return false;
    if (p === S.pin) { pinOK = true; return true; }
    alert('পিন ভুল'); return false;
  }
  $('#keySave').onclick = async () => {
    const msg = $('#keyMsg');
    if (!Object.keys(keyState.answers).length) { msg.textContent = 'অন্তত একটি প্রশ্নের উত্তর দিন।'; return; }
    if (!requirePin()) return;
    const id = keyState.id || 'k' + Date.now();
    const name = $('#keyName').value.trim() || 'উত্তরমালা ' + bn(Object.keys(keys).length + 1);
    keys[id] = { id, name, answers: Object.assign({}, keyState.answers) };
    keyState.id = id; $('#keyName').value = name; saveKeys(); fillKeySelects(); renderKey();
    msg.className = 'msg ok'; msg.textContent = '✔ সংরক্ষিত হয়েছে।';
    const r = await api('saveKey', { key: keys[id] });
    if (r && !r.ok) { msg.className = 'msg'; msg.textContent = 'ডিভাইসে সংরক্ষিত, কিন্তু সার্ভারে নয়: ' + (r.error || 'ত্রুটি'); }
    else if (r) msg.textContent = '✔ সংরক্ষিত হয়েছে (সার্ভারেও)।';
  };
  $('#keyDel').onclick = async () => {
    const id = keyState.id;
    if (!id) { $('#keyMsg').className = 'msg'; $('#keyMsg').textContent = 'আগে একটি সংরক্ষিত উত্তরমালা নির্বাচন করুন।'; return; }
    if (!confirm('এই উত্তরমালা ডিলিট করবেন?') || !requirePin()) return;
    delete keys[id]; saveKeys(); keyState = { id: '', answers: {} }; $('#keyName').value = '';
    fillKeySelects(); renderKey(); api('deleteKey', { id });
  };
  $('#sheetDl').onclick = () => {
    const cv = document.createElement('canvas'); cv.width = C.W; cv.height = C.H;
    drawSheet(cv.getContext('2d'), 'OMR উত্তরপত্র');
    cv.toBlob(b => download(b, 'omr-sheet.png'), 'image/png');
  };
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- স্ক্যান ----------
  const scanCv = $('#scanCv');
  const smsg = (t, ok) => { const m = $('#scanMsg'); m.textContent = t; m.className = 'msg' + (ok ? ' ok' : ''); };
  $('#camBtn').onclick = () => $('#camIn').click();
  $('#galBtn').onclick = () => $('#galIn').click();
  $('#camIn').onchange = $('#galIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleFile(f); };

  function loadImg(file) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('ছবি খোলা যায়নি')); };
      im.src = u;
    });
  }
  async function handleFile(file) {
    if (!$('#scanKey').value || !keys[$('#scanKey').value]) { smsg('আগে উত্তরমালা নির্বাচন করুন (উত্তরমালা ট্যাবে সংরক্ষণ করুন)।'); return; }
    smsg('স্ক্যান হচ্ছে…', true);
    try {
      const img = await loadImg(file);
      const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const t = document.createElement('canvas'); t.width = w; t.height = h;
      const cx = t.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
      sc = { rgba: cx.getImageData(0, 0, w, h).data, w, h, rot: undefined, manual: new Set(), rid: null };
      setTimeout(runScan, 30);
    } catch (e) { smsg('ত্রুটি: ' + e.message); }
  }
  function runScan() {
    const r = OMR.scan(sc.rgba, sc.w, sc.h, { rot: sc.rot });
    sc.rot = r.rot; sc.warped = r.warped; sc.dark = r.dark; sc.found = r.found;
    sc.sel = OMR.decide(r.dark, S.thr); sc.manual = new Set(); sc.rid = sc.rid || null;
    submitted = false; $('#resBox').hidden = true;
    scanCv.width = C.W; scanCv.height = C.H;
    sc.img = new ImageData(sc.warped, C.W, C.H);
    $('#scanArea').hidden = false; updateTimerBtn(); renderScan();
    const n = sc.sel.filter(s => s.length).length;
    if (!r.found) smsg('⚠ চারটি কোণার কালো বর্গ পাওয়া যায়নি, তাই পুরো ছবিকে শিট ধরা হয়েছে। বৃত্ত না মিললে আরও আলোয়, চার কোণ দেখা যায় এমনভাবে আবার ছবি তুলুন।');
    else if (n < 5) smsg('⚠ খুব কম দাগ শনাক্ত হয়েছে। শিট উল্টো/আড়াআড়ি হলে “↻ ঘোরান” চাপুন, নয়তো ঠিকমতো ছবি তুলুন।');
    else smsg('✔ স্ক্যান সম্পন্ন — ' + bn(n) + 'টি প্রশ্নে দাগ শনাক্ত। বৃত্ত ঠিক না থাকলে ট্যাপ করে ঠিক করুন, তারপর সাবমিট।', true);
    $('#scanWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#rotBtn').onclick = () => { if (sc.rgba) { sc.rot = ((sc.rot || 0) + 2) % 4; runScan(); } };

  function renderScan() {
    const x = scanCv.getContext('2d');
    x.putImageData(sc.img, 0, 0);
    const key = submitted ? keys[$('#scanKey').value] : null;
    for (let q = 0; q < C.ROWS * C.COLS; q++) {
      const s = sc.sel[q], a = key ? key.answers[q + 1] : undefined;
      s.forEach(o => {
        const manual = sc.manual.has(q + '-' + o);
        let f = 'rgba(96,165,250,.40)', st = '#2563eb';
        if (s.length > 1) { f = 'rgba(251,191,36,.45)'; st = '#d97706'; }
        if (key && a !== undefined) {
          if (s.length === 1 && o === a) { f = 'rgba(74,222,128,.45)'; st = '#16a34a'; }
          else { f = 'rgba(248,113,113,.45)'; st = '#dc2626'; }
        }
        circ(x, q, o, f, st, manual);
      });
      if (key && a !== undefined && !(s.length === 1 && s[0] === a)) circ(x, q, a, 'rgba(0,0,0,0)', '#16a34a', true);
    }
  }
  scanCv.onclick = ev => {
    if (!sc.sel) return;
    const h = hit(scanCv, ev); if (!h) return;
    const s = sc.sel[h[0]], i = s.indexOf(h[1]), k = h[0] + '-' + h[1];
    if (i >= 0) { s.splice(i, 1); sc.manual.delete(k); } else { s.push(h[1]); sc.manual.add(k); }
    renderScan(); refreshResult();
  };

  // ---------- ফলাফল ----------
  function updateTimerBtn() {
    const b = $('#timerBtn');
    b.textContent = '⏱ সেকেন্ড টাইমার (−' + bn(S.timerPct) + '%)' + (timerOn ? ' ✔' : '');
    b.classList.toggle('on', timerOn);
  }
  $('#timerBtn').onclick = () => { timerOn = !timerOn; updateTimerBtn(); refreshResult(); };
  $('#scanKey').onchange = () => refreshResult();

  function compute(sel, key, tOn) {
    let c = 0, w = 0, b = 0;
    const qs = Object.keys(key.answers);
    qs.forEach(q => {
      const s = sel[q - 1] || [];
      if (!s.length) b++; else if (s.length === 1 && s[0] === key.answers[q]) c++; else w++;
    });
    const total = qs.length * S.per, neg = w * S.neg, tim = tOn ? total * S.timerPct / 100 : 0;
    return { c, w, b, n: qs.length, total, neg, tim, fin: Math.max(0, c * S.per - neg - tim) };
  }
  function showResult(r) {
    $('#rC').textContent = bn(r.c); $('#rW').textContent = bn(r.w); $('#rB').textContent = bn(r.b);
    $('#rM').textContent = fmt(r.total); $('#rN').textContent = '− ' + fmt(r.neg);
    $('#rT').textContent = timerOn ? '− ' + fmt(r.tim) : '০';
    $('#rF').textContent = fmt(r.fin) + ' / ' + fmt(r.total);
    $('#rS').textContent = 'প্রতি সঠিক +' + fmt(S.per) + ', প্রতি ভুল −' + fmt(S.neg) + ' (একাধিক দাগ = ভুল)';
    $('#resBox').hidden = false;
  }
  let syncT = null;
  function refreshResult() {
    if (!submitted) return;
    const key = keys[$('#scanKey').value]; if (!key) return;
    renderScan(); showResult(compute(sc.sel, key, timerOn));
    storeRecord();
  }
  function storeRecord() {
    const key = keys[$('#scanKey').value], r = compute(sc.sel, key, timerOn);
    const rec = Object.assign({
      id: sc.rid, t: Date.now(), keyId: key.id, keyName: key.name,
      student: $('#stuName').value.trim() || 'অজানা', sel: sc.sel.map(s => s.slice()), timer: timerOn
    }, r);
    const i = results.findIndex(x => x.id === rec.id);
    if (i >= 0) { rec.t = results[i].t; results[i] = rec; } else results.unshift(rec);
    saveResults();
    clearTimeout(syncT); syncT = setTimeout(() => api('saveResult', { result: rec }), 800);
  }
  $('#submitBtn').onclick = () => {
    if (!sc.sel) return;
    const key = keys[$('#scanKey').value];
    if (!key) { smsg('উত্তরমালা নির্বাচন করুন।'); return; }
    if (!sc.rid) sc.rid = 'r' + Date.now();
    submitted = true; refreshResult();
    $('#resBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ---------- ফলাফল তালিকা ----------
  function renderResults() {
    const L = $('#resList');
    if (!results.length) { L.innerHTML = '<p class="hint">এখনো কোনো ফলাফল নেই।</p>'; return; }
    L.innerHTML = results.slice().sort((a, b) => b.t - a.t).map(r =>
      `<div class="item"><div><b>${esc(r.student)}</b><small>${esc(r.keyName)} • ${new Date(r.t).toLocaleString('bn-BD')}<br>সঠিক ${bn(r.c)} • ভুল ${bn(r.w)}${r.timer ? ' • টাইমার কর্তন' : ''}</small></div>
      <div style="text-align:right"><b class="ok">${fmt(r.fin)}/${fmt(r.total)}</b><br><button class="b red sm" data-del="${esc(r.id)}">ডিলিট</button></div></div>`).join('');
    L.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (!confirm('এই ফলাফল ডিলিট করবেন?') || !requirePin()) return;
      results = results.filter(r => r.id !== b.dataset.del); saveResults(); renderResults(); api('deleteResult', { id: b.dataset.del });
    });
  }
  $('#resCsv').onclick = () => {
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = [['সময়', 'পরীক্ষার্থী', 'উত্তরমালা', 'সঠিক', 'ভুল', 'উত্তর দেননি', 'মোট নম্বর', 'ভুলের কর্তন', 'টাইমার কর্তন', 'প্রাপ্ত নম্বর']];
    results.slice().sort((a, b) => a.t - b.t).forEach(r => rows.push([new Date(r.t).toLocaleString(), r.student, r.keyName, r.c, r.w, r.b, r.total, r.neg, r.tim, r.fin]));
    download(new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), 'omr-results.csv');
  };
  $('#resSync').onclick = async () => { await pull(true); renderResults(); };

  // ---------- সেটিং ----------
  function fillSettings() {
    $('#sPer').value = S.per; $('#sNeg').value = S.neg; $('#sTim').value = S.timerPct; $('#sThr').value = S.thr; $('#sUrl').value = S.url;
  }
  $('#sSave').onclick = async () => {
    const m = $('#sMsg'); m.className = 'msg';
    if ($('#sPin').value !== S.pin) { m.textContent = 'অ্যাডমিন পিন ভুল।'; return; }
    const per = parseFloat($('#sPer').value), neg = parseFloat($('#sNeg').value), tp = parseFloat($('#sTim').value), thr = parseFloat($('#sThr').value);
    if ([per, neg, tp, thr].some(isNaN) || per < 0 || neg < 0 || tp < 0 || tp > 100 || thr < 0.03 || thr > 0.6) { m.textContent = 'মানগুলো ঠিকমতো দিন।'; return; }
    const np = $('#sNewPin').value.trim();
    const oldPin = S.pin;
    S = Object.assign(S, { per, neg, timerPct: tp, thr, url: $('#sUrl').value.trim() });
    if (np) S.pin = np;
    saveSettings(); pinOK = true; updateTimerBtn(); refreshResult();
    $('#sNewPin').value = ''; $('#sPin').value = '';
    m.className = 'msg ok'; m.textContent = '✔ সংরক্ষিত হয়েছে।';
    if (S.url) {
      const r = await api('saveSettings', { pin: oldPin, newPin: np || undefined, settings: { per, neg, timerPct: tp, thr } });
      if (r && !r.ok) { m.className = 'msg'; m.textContent = 'ডিভাইসে সংরক্ষিত, কিন্তু সার্ভারে নয়: ' + (r.error || 'ত্রুটি'); }
      else if (r) m.textContent = '✔ সংরক্ষিত হয়েছে (সার্ভারেও)।';
    }
  };

  // ---------- Apps Script সিঙ্ক ----------
  async function api(action, payload) {
    if (!S.url) return null;
    try {
      const res = await fetch(S.url, { method: 'POST', body: JSON.stringify(Object.assign({ action, pin: S.pin }, payload)) });
      return await res.json();
    } catch (e) { return { ok: false, error: 'নেটওয়ার্ক সমস্যা' }; }
  }
  async function pull(loud) {
    if (!S.url) { if (loud) alert('সেটিংয়ে Apps Script URL দেওয়া নেই।'); return; }
    try {
      const r = await (await fetch(S.url + (S.url.includes('?') ? '&' : '?') + 'action=bootstrap')).json();
      if (!r.ok) throw new Error(r.error || 'ত্রুটি');
      (r.keys || []).forEach(k => keys[k.id] = k); saveKeys();
      if (r.settings) { ['per', 'neg', 'timerPct', 'thr'].forEach(f => { if (typeof r.settings[f] === 'number') S[f] = r.settings[f]; }); saveSettings(); fillSettings(); updateTimerBtn(); }
      const have = new Set(results.map(x => x.id));
      (r.results || []).forEach(x => { if (!have.has(x.id)) results.push(x); });
      saveResults(); fillKeySelects(); renderKey();
    } catch (e) { if (loud) alert('সার্ভার থেকে আনা যায়নি: ' + e.message); }
  }

  // ---------- ইনস্টল (PWA) ----------
  let dip = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => { if (dip) { dip.prompt(); await dip.userChoice; dip = null; $('#installBtn').hidden = true; } };
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $('#iosHint').hidden = false;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

  // ---------- শুরু ----------
  fillSettings(); fillKeySelects(); updateTimerBtn();
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(renderKey);
  renderKey();
  pull(false);
  window.__omr = { get state() { return { S, keys, results, sc, keyState }; } }; // ডিবাগ/টেস্টের জন্য
})();
