/* report.js - result sheets drawn on canvas and saved as a real PDF file (no libraries, works offline). */
(function (root) {
  'use strict';
  const PW = 1240, PH = 1754, M = 70;              // A4 layout units (150 per inch); the canvas is drawn SC times bigger so zooming into the PDF stays sharp
  let SC = 2.4;                                      // 2.4 -> 360 dpi (2976 x 4210 pixels per page)
  const GREEN = '#5b8f2a', RED = '#e11d1d', BLACK = '#000';
  const FF = '"Times New Roman","Noto Serif Bengali","Noto Sans Bengali","Nirmala UI","Kohinoor Bangla","Liberation Serif",serif';
  const font = (sz, b) => (b ? 'bold ' : '') + sz + 'px ' + FF;
  const fmt = x => String(Math.round(x * 100) / 100);
  const pad2 = n => String(n).padStart(2, '0');

  function newPage() {
    let c = document.createElement('canvas'), x = null;
    for (; SC >= 1; SC = Math.max(1, SC - 0.6)) { c.width = Math.round(PW * SC); c.height = Math.round(PH * SC); x = c.getContext('2d'); if (x) break; if (SC <= 1) break; }   // a phone that cannot make a canvas this big gets a smaller one
    x.setTransform(SC, 0, 0, SC, 0, 0); x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH); x.textBaseline = 'middle'; x.textAlign = 'center';
    return { c, x };
  }
  function fit(x, text, maxW, size, bold, min) {
    let s = size; x.font = font(s, bold);
    while (s > (min || 16) && x.measureText(text).width > maxW) { s -= 2; x.font = font(s, bold); }
    return s;
  }

  // Logo on the left, up to four lines of text beside/under it. Returns the y below the header.
  function header(x, h, logo, caption) {
    h = h || {};
    const L = 160, top = 50, hasLogo = !!logo, cx = PW / 2;
    const logoR = M + L + 16;                          // right edge of the logo area
    if (hasLogo) {
      const k = Math.min(L / logo.width, L / logo.height), w = logo.width * k, hh = logo.height * k;
      x.drawImage(logo, M, top + (L - hh) / 2, w, hh);
    }
    const lines = [
      { t: h.l1, size: 46, color: BLACK },
      { t: h.l2, size: 40, color: BLACK },
      { t: h.l3 || caption || '', size: 40, color: '#d6339a' },
      { t: h.l4, size: 40, color: '#2f4aa0', ul: true }
    ].filter(l => l.t && String(l.t).trim());
    let y = top + 30;
    lines.forEach(l => {
      // The text is centred on the PAGE. A line that runs beside the logo gets symmetric room (so it never touches the logo); lines below the logo use the full width.
      const maxW = hasLogo && y - l.size < top + L ? 2 * (cx - logoR) : PW - 2 * M;
      const s = fit(x, l.t, maxW, l.size, true); x.fillStyle = l.color; x.textAlign = 'center'; x.fillText(l.t, cx, y);
      if (l.ul) { const w = x.measureText(l.t).width; x.fillRect(cx - w / 2, y + s * 0.55, w, 3); }
      y += s + 18;
    });
    return Math.max(y, hasLogo ? top + L : 0) + 20;
  }

  const COLS = [
    { k: 'rank', w: 110, t: ['Merit', 'List'] }, { k: 'id', w: 150, t: ['ID No.'] }, { k: 'name', w: 470, t: ['Name'] },
    { k: 'pos', w: 125, t: ['Positive'] }, { k: 'neg', w: 125, t: ['Negative'] }, { k: 'total', w: 120, t: ['Total'] }
  ];
  const HEAD_H = 90, ROW_H = 50;
  const cellsOf = r => ({ rank: pad2(r.rank), id: r.id || '', name: r.name || '', pos: pad2(r.pos), neg: pad2(r.neg), total: fmt(r.total) });

  function tableHead(x, y) {
    x.lineWidth = 2; x.strokeStyle = '#000'; x.fillStyle = '#000'; let cx = M;
    COLS.forEach(c => {
      x.strokeRect(cx, y, c.w, HEAD_H); x.textAlign = 'center';
      const s = Math.min(30, fit(x, c.t[0], c.w - 12, 30, true, 18));
      x.font = font(s, true);
      if (c.t.length === 2) { x.fillText(c.t[0], cx + c.w / 2, y + HEAD_H / 2 - 17); x.fillText(c.t[1], cx + c.w / 2, y + HEAD_H / 2 + 17); }
      else x.fillText(c.t[0], cx + c.w / 2, y + HEAD_H / 2);
      cx += c.w;
    });
    return y + HEAD_H;
  }
  function tableRow(x, y, row) {
    const v = cellsOf(row); let cx = M; x.lineWidth = 2; x.strokeStyle = '#000';
    COLS.forEach(c => {
      x.strokeRect(cx, y, c.w, ROW_H); x.fillStyle = row.color || BLACK; x.textAlign = 'center';
      fit(x, String(v[c.k]), c.w - 14, 30, false, 16);
      x.fillText(String(v[c.k]), cx + c.w / 2, y + ROW_H / 2 + 2);
      cx += c.w;
    });
    return y + ROW_H;
  }
  function pageNo(pages) {
    if (pages.length < 2) return;
    pages.forEach((p, i) => { p.x.font = font(22, false); p.x.fillStyle = '#64748b'; p.x.textAlign = 'center'; p.x.fillText('Page ' + (i + 1) + ' of ' + pages.length, PW / 2, PH - 34); });
  }

  // opts: { header, logo, caption, rows:[{rank,id,name,pos,neg,total,color}] }  -> adds canvases through sink(canvas)
  function merit(opts, sink) {
    const pages = []; let p = newPage(); pages.push(p);
    let y = header(p.x, opts.header, opts.logo, opts.caption) + 10;
    y = tableHead(p.x, y);
    opts.rows.forEach(r => {
      if (y + ROW_H > PH - M - 30) { p = newPage(); pages.push(p); y = tableHead(p.x, M); }
      y = tableRow(p.x, y, r);
    });
    pageNo(pages); pages.forEach(q => sink(q.c));
  }

  // opts: { header, logo, caption, row, lines:[{t,color}], answers:[{q,mine,good,wrong,multi,answered}] }
  function student(opts, sink) {
    const pages = []; let p = newPage(); pages.push(p);
    let x = p.x;
    let y = header(x, opts.header, opts.logo, opts.caption) + 10;
    y = tableHead(x, y); y = tableRow(x, y, opts.row) + 36;
    x.textAlign = 'left';
    (opts.lines || []).forEach(l => { x.font = font(30, !!l.bold); x.fillStyle = l.color || BLACK; x.fillText(l.t, M, y); y += 44; });
    if (opts.answers && opts.answers.length) {
      y += 14; x.font = font(32, true); x.fillStyle = BLACK; x.fillText('Answer details', M, y); y += 48;
      const A = opts.answers, cols = 5, cw = (PW - 2 * M) / cols, rh = 34;
      let i = 0;
      while (i < A.length) {
        const per = Math.max(1, Math.floor((PH - M - 60 - y) / rh)), chunk = A.slice(i, i + per * cols), n = Math.ceil(chunk.length / cols);
        chunk.forEach((a, j) => {
          const col = Math.floor(j / n), row = j % n, tx = M + col * cw, ty = y + row * rh;
          const wr = a.wrong; x.textAlign = 'left'; x.font = font(24, false); x.fillStyle = wr ? RED : BLACK;
          x.fillText(a.q + '. ' + a.mine + (a.multi ? '*' : '') + (wr ? '  ✗ (' + a.good + ')' : a.answered ? '  ✓' : ''), tx, ty);
        });
        i += chunk.length; y += n * rh + 16;
        if (i < A.length) { p = newPage(); pages.push(p); x = p.x; y = M; }
      }
      x.font = font(22, false); x.fillStyle = '#64748b'; x.textAlign = 'left';
      x.fillText('✗ = wrong (correct answer in brackets)   * = multiple or partly filled marks, counted wrong', M, Math.min(y + 10, PH - 60));
    }
    pageNo(pages); pages.forEach(q => sink(q.c));
  }

  // ---------- PDF writer: every canvas becomes one A4 page (JPEG image) ----------
  function Doc() { this.imgs = []; }
  Doc.prototype.add = function (canvas) {
    const b64 = canvas.toDataURL('image/jpeg', 0.95).split(',')[1], bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    this.imgs.push({ u, w: canvas.width, h: canvas.height }); canvas.width = 0; canvas.height = 0;
  };
  Doc.prototype.pages = function () { return this.imgs.length; };
  Doc.prototype.blob = function () {
    const enc = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
    const parts = [], offs = []; let pos = 0;
    const push = u => { parts.push(u); pos += u.length; };
    const n = this.imgs.length, PWpt = 595.28, PHpt = 841.89;
    push(enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
    const obj = (id, body) => { offs[id] = pos; push(enc(id + ' 0 obj\n' + body + '\nendobj\n')); };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + this.imgs.map((_, i) => (3 + 3 * i) + ' 0 R').join(' ') + '] /Count ' + n + ' >>');
    this.imgs.forEach((im, i) => {
      const pid = 3 + 3 * i, cid = pid + 1, iid = pid + 2, content = 'q ' + PWpt + ' 0 0 ' + PHpt + ' 0 0 cm /Im0 Do Q';
      obj(pid, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PWpt + ' ' + PHpt + '] /Resources << /XObject << /Im0 ' + iid + ' 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ' + cid + ' 0 R >>');
      obj(cid, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      offs[iid] = pos;
      push(enc(iid + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.u.length + ' >>\nstream\n'));
      push(im.u); push(enc('\nendstream\nendobj\n'));
    });
    const total = 3 + 3 * n, xr = pos;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(enc(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF\n'));
    return new Blob(parts, { type: 'application/pdf' });
  };

  function loadImage(src) {
    return new Promise(res => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  }

  root.Report = { merit, student, Doc, loadImage, GREEN, RED, BLACK };
})(window);
