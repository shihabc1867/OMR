/* live.js - live camera scan: draws a box on the 4 black squares, offers "Read & Submit" when they are locked,
 * and after each submit goes back to the camera by itself.
 * API: LiveCam.open({ aspect, mode, title, onShot(canvas, who) -> Promise<result>, onClose }) -> Promise<{error}|null>
 *      result = { fail:'text' } | { review:true } | { name, id, correct, wrong, blank, score, warn }
 */
(function (root) {
  'use strict';
  const $ = s => document.querySelector(s);
  const WORK = 640, NEED = 3, MINAREA = 0.08, RESULT_MS = 2500;
  let S = null;

  function polyArea(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s) / 2;
  }
  const status = (t, cls) => { const e = $('#lvStat'); e.textContent = t; e.className = 'lvStat' + (cls ? ' ' + cls : ''); };

  async function open(o) {
    if (S) close();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { error: 'Live camera is not available here (it needs a secure https page).' };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) { return { error: 'Could not start the camera: ' + (e && e.message ? e.message : e) + ' — allow camera permission and try again.' }; }
    const vid = $('#lvVid'), cv = $('#lvCv');
    S = { o, stream, vid, cv, work: document.createElement('canvas'), pause: false, busy: false, stable: 0, prev: null, miss: 0, needGap: false, ready: false, timer: 0, resT: 0 };
    S.wctx = S.work.getContext('2d', { willReadFrequently: true });
    vid.srcObject = stream; try { await vid.play(); } catch (e) { /* autoplay is fine with muted */ }
    $('#lvTitle').textContent = o.title ? 'Live scan — ' + o.title : 'Live scan';
    $('#lvRes').hidden = true; $('#lvGo').hidden = true;
    $('#lvAuto').checked = localStorage.getItem('omr_live_auto') === '1';
    $('#lvName').value = ''; $('#lvId').value = '';
    const tr = stream.getVideoTracks()[0], caps = tr && tr.getCapabilities ? tr.getCapabilities() : {};
    S.torch = false; $('#lvTorch').hidden = !caps.torch;
    $('#liveOv').classList.add('on'); document.body.style.overflow = 'hidden';
    status('Point the camera at the sheet — all 4 black squares must be visible.');
    tick();
    return null;
  }

  function close() {
    if (!S) return;
    const s = S; S = null;
    clearTimeout(s.timer); clearTimeout(s.resT);
    s.stream.getTracks().forEach(t => t.stop()); s.vid.srcObject = null;
    $('#liveOv').classList.remove('on'); document.body.style.overflow = '';
    if (s.o.onClose) s.o.onClose();
  }

  function tick() {
    if (!S) return;
    const s = S, v = s.vid;
    if (s.pause || s.busy || v.readyState < 2 || !v.videoWidth) { s.timer = setTimeout(tick, 120); return; }
    const k = Math.min(1, WORK / Math.max(v.videoWidth, v.videoHeight)), w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
    if (s.work.width !== w || s.work.height !== h) { s.work.width = w; s.work.height = h; }
    s.wctx.drawImage(v, 0, 0, w, h);
    let q = null;
    try {
      const gray = OMR.toGray(s.wctx.getImageData(0, 0, w, h).data, w, h);
      q = s.o.mode === 'page' ? OMR.findPage(gray, w, h) : OMR.findMarkers(gray, w, h, s.o.aspect);
    } catch (e) { q = null; }
    update(q, w, h);
    if (S === s) s.timer = setTimeout(tick, 50);
  }

  function update(q, w, h) {
    const s = S; let state = 'none';
    if (!q) {
      s.stable = 0; s.prev = null; s.miss++;
      if (s.miss >= 5) s.needGap = false;            // the old sheet has left the picture
    } else {
      s.miss = 0;
      const diag = Math.hypot(w, h);
      // movement: every corner against the nearest corner of the last frame (order-independent)
      const moved = s.prev ? Math.max.apply(null, q.map(p => Math.min.apply(null, s.prev.map(r => Math.hypot(p[0] - r[0], p[1] - r[1]))))) / diag : 1;
      s.prev = q; s.stable = moved < 0.02 ? s.stable + 1 : 1;
      const inside = q.every(p => p[0] > w * 0.01 && p[0] < w * 0.99 && p[1] > h * 0.01 && p[1] < h * 0.99);
      if (s.needGap) state = 'gap';
      else if (!inside || polyArea(q) < MINAREA * w * h) state = 'small';
      else if (s.stable < NEED) state = 'moving';
      else state = 'locked';
    }
    const was = s.ready; s.ready = state === 'locked';
    $('#lvGo').hidden = !s.ready;
    if (state === 'none') status(s.needGap ? 'Saved. Remove this sheet and show the next one.' : 'Squares not found — show the whole sheet, hold steady, use good light.', s.needGap ? 'ok' : 'bad');
    else if (state === 'gap') status('Saved. Remove this sheet and show the next one.', 'ok');
    else if (state === 'small') status('Move closer / keep all 4 squares inside the screen.', 'warn');
    else if (state === 'moving') status('Hold steady…', 'warn');
    else status('✔ 4 squares found. Tap “Read & Submit”' + ($('#lvAuto').checked ? ' (auto)' : '') + '.', 'ok');
    draw(q, w, h, state);
    if (s.ready && !was) { if (navigator.vibrate) navigator.vibrate(40); if ($('#lvAuto').checked) shoot(); }
  }

  function draw(q, w, h, state) {
    const s = S, cv = s.cv, vid = s.vid, cw = vid.clientWidth, ch = vid.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, cw, ch);
    const vw = vid.videoWidth, vh = vid.videoHeight, sc = Math.min(cw / vw, ch / vh), ox = (cw - vw * sc) / 2, oy = (ch - vh * sc) / 2, f = sc * vw / w;
    if (!q || state === 'gap') {                                  // guide corners
      const m = 0.1, L = 26, X0 = ox + vw * sc * m, X1 = ox + vw * sc * (1 - m), Y0 = oy + vh * sc * m, Y1 = oy + vh * sc * (1 - m);
      x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 3; x.lineCap = 'round'; x.beginPath();
      [[X0, Y0, 1, 1], [X1, Y0, -1, 1], [X1, Y1, -1, -1], [X0, Y1, 1, -1]].forEach(c => { x.moveTo(c[0] + c[2] * L, c[1]); x.lineTo(c[0], c[1]); x.lineTo(c[0], c[1] + c[3] * L); });
      x.stroke(); return;
    }
    const col = state === 'locked' ? '#22c55e' : '#f59e0b', P = q.map(p => [ox + p[0] * f, oy + p[1] * f]);
    x.beginPath(); P.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath();
    x.fillStyle = state === 'locked' ? 'rgba(34,197,94,.14)' : 'rgba(245,158,11,.10)'; x.fill();
    x.lineWidth = 4; x.lineJoin = 'round'; x.strokeStyle = col; x.stroke();
    x.fillStyle = col; P.forEach(p => { x.beginPath(); x.arc(p[0], p[1], 8, 0, 6.2832); x.fill(); });
  }

  async function shoot() {
    const s = S; if (!s || s.busy || !s.ready) return;
    s.busy = true; s.ready = false; $('#lvGo').hidden = true; status('Reading the sheet…', 'warn');
    const v = s.vid, c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    let r;
    try { r = await s.o.onShot(c, { name: $('#lvName').value.trim(), id: $('#lvId').value.trim() }); } catch (e) { r = { fail: 'Error: ' + (e && e.message ? e.message : e) }; }
    if (S !== s) return;
    s.busy = false; s.stable = 0; s.prev = null;
    if (r && r.review) { close(); return; }                       // something needs a look: the app shows the normal review screen
    if (!r || r.fail) { status((r && r.fail) || 'Could not read the sheet — try again.', 'bad'); return; }
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    s.needGap = true; $('#lvName').value = ''; $('#lvId').value = '';
    s.lastRid = r.rid; $('#lvEdit').hidden = !(r.rid && s.o.onEdit);
    $('#lvRName').textContent = (r.name || 'Unknown') + (r.id ? ' · ' + r.id : '');
    $('#lvRScore').textContent = r.score; $('#lvRDet').textContent = 'Correct ' + r.correct + ' · Wrong ' + r.wrong + ' · Blank ' + r.blank;
    $('#lvRWarn').textContent = r.warn || ''; $('#lvRes').hidden = false; s.pause = true;
    const bar = $('#lvBar'); bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth; bar.style.transition = 'width ' + RESULT_MS + 'ms linear'; bar.style.width = '0%';
    s.resT = setTimeout(resume, RESULT_MS);
  }
  function resume() {
    const s = S; if (!s) return; clearTimeout(s.resT);
    $('#lvRes').hidden = true; s.pause = false; s.stable = 0; s.prev = null; s.miss = 0;
    status('Ready for the next sheet.', 'ok');
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#lvClose').onclick = close;
    $('#lvGo').onclick = shoot;
    $('#lvNext').onclick = resume;
    $('#lvEdit').onclick = () => { if (!S || !S.lastRid) return; clearTimeout(S.resT); $('#lvBar').style.transition = 'none'; const n = S.o.onEdit(S.lastRid); if (n) $('#lvRName').textContent = (n.name || 'Unknown') + (n.id ? ' · ' + n.id : ''); };
    $('#lvAuto').onchange = e => { try { localStorage.setItem('omr_live_auto', e.target.checked ? '1' : '0'); } catch (x) { /* ignore */ } };
    $('#lvTorch').onclick = () => {
      if (!S) return; const tr = S.stream.getVideoTracks()[0]; S.torch = !S.torch;
      tr.applyConstraints({ advanced: [{ torch: S.torch }] }).catch(() => { S.torch = !S.torch; });
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });
  });

  root.LiveCam = { open, close, isOpen: () => !!S };
})(window);
