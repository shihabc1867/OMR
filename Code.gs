/**
 * OMR Scanner - Google Apps Script backend (accounts, groups, shared data)
 *
 * Setup: paste this code, then Deploy -> New deployment -> Web app (Execute as: Me, Who has access: Anyone).
 * After changing the code always use Deploy -> Manage deployments -> Edit -> New version.
 *
 * The ONE admin account is created automatically the first time the app talks to this script:
 *   ID       : ADMIN_ID       (Project Settings -> Script properties; default "admin")
 *   Password : ADMIN_PASSWORD (Script property; default "admin1234")  -> change it after the first login!
 * Passwords are stored only as salted hashes. Login tokens are signed and expire after 30 days.
 */

// Your spreadsheet (from its URL: .../spreadsheets/d/<SHEET_ID>/edit)
const SHEET_ID = '1CCDfETvb3VlHGNlpNHafKjKe9PmcuJxAyI8B_47kpTA';

const DEFAULT_ADMIN_ID = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin1234';

const HEAD = {
  Users: ['id', 'name', 'salt', 'hash', 'role', 'canUpload', 'created'],
  Groups: ['gid', 'seq', 'name', 'createdBy', 'created'],
  Members: ['gid', 'uid', 'role', 'joined'],
  Requests: ['rid', 'gid', 'from', 'to', 'status', 'time'],
  WS: ['wid', 'settings', 'logo', 'updated'],
  Keys: ['id', 'name', 'tplId', 'answers', 'updated', 'wid', 'by'],
  Templates: ['id', 'name', 'json', 'updated', 'by'],
  Results: ['id', 'time', 'keyId', 'keyName', 'student', 'correct', 'wrong', 'blank', 'total', 'negative', 'timerCut', 'timerOn', 'final', 'wrongQs', 'sel', 'studentId', 'bad', 'wid', 'by'],
  Activity: ['time', 'uid', 'name', 'wid', 'action', 'detail']
};

// Columns that must stay text (a mobile number like 01711... would otherwise lose its leading zero, a numeric-looking salt would be damaged)
const TEXTCOLS = { Users: [1, 2, 3, 4], Members: [1, 2], Requests: [1, 2, 3, 4], Results: [1, 3, 5, 16, 19], Keys: [1, 2, 6, 7], Groups: [1, 3], WS: [1], Templates: [1], Activity: [2, 4, 6] };

function props_() { return PropertiesService.getScriptProperties(); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(m) { throw new Error(m); }

function sh_(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID), headers = HEAD[name];
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); (TEXTCOLS[name] || []).forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); }); sh.appendRow(headers); sh.setFrozenRows(1); }
  else if (sh.getLastColumn() < headers.length) sh.getRange(1, 1, 1, headers.length).setValues([headers]);   // older sheet: add the new header cells
  return sh;
}
function rows_(name) {
  const sh = sh_(name), n = sh.getLastRow();
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, HEAD[name].length).getValues();
}
function findRow_(sh, id, col) {
  const n = sh.getLastRow();
  if (n < 2) return -1;
  const v = sh.getRange(2, col || 1, n - 1, 1).getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]) === String(id)) return i + 2;
  return -1;
}
function upsert_(name, id, vals) {
  const sh = sh_(name), r = findRow_(sh, id);
  if (r < 0) { sh.appendRow(vals); return true; }
  sh.getRange(r, 1, 1, vals.length).setValues([vals]); return false;
}
function remove_(name, id) { const sh = sh_(name), r = findRow_(sh, id); if (r > 0) sh.deleteRow(r); }
// Prevent spreadsheet formula injection
function safe_(v) { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function bool_(v) { return v === true || v === 'TRUE' || v === 'true'; }

// ---------- security ----------
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function hash_(salt, pw) {
  let h = salt + ':' + pw;
  for (let i = 0; i < 300; i++) h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  return h;
}
function secret_() {
  let s = props_().getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props_().setProperty('SECRET', s); }
  return s;
}
function sign_(msg) { return hex_(Utilities.computeHmacSha256Signature(msg, secret_())); }
function token_(u) {
  const p = u.id + '|' + (Date.now() + 30 * 86400000);
  return Utilities.base64EncodeWebSafe(p) + '.' + sign_(p + '|' + String(u.hash).slice(0, 16));
}
function userRow_(r) { return { id: String(r[0]), name: String(r[1]), salt: String(r[2]), hash: String(r[3]), role: String(r[4]), canUpload: bool_(r[5]) }; }
function user_(id) {
  const rs = rows_('Users');
  for (let i = 0; i < rs.length; i++) if (String(rs[i][0]) === String(id)) return userRow_(rs[i]);
  return null;
}
function pub_(u) { return { id: u.id, name: u.name, role: u.role, canUpload: u.role === 'admin' || u.canUpload }; }
function auth_(b) {
  const t = String(b.token || ''), i = t.indexOf('.');
  if (i < 0) fail_('AUTH');
  let p;
  try { p = Utilities.newBlob(Utilities.base64DecodeWebSafe(t.slice(0, i))).getDataAsString(); } catch (e) { fail_('AUTH'); }
  const parts = p.split('|'), u = user_(parts[0]);
  if (!u || Number(parts[1]) < Date.now() || sign_(p + '|' + u.hash.slice(0, 16)) !== t.slice(i + 1)) fail_('AUTH');
  return u;
}
function newPassword_() {
  const al = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = '';
  for (let i = 0; i < 8; i++) s += al.charAt(Math.floor(Math.random() * al.length));
  return s;
}
function setPassword_(id, pw) {
  const sh = sh_('Users'), r = findRow_(sh, id);
  if (r < 0) fail_('User not found');
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  sh.getRange(r, 3, 1, 2).setValues([[salt, hash_(salt, pw)]]);
}
function ensureFormats_() {   // once: make the ID/phone columns of sheets created by older versions plain text
  if (props_().getProperty('FMT1')) return;
  Object.keys(TEXTCOLS).forEach(function (n) { const sh = sh_(n); TEXTCOLS[n].forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); }); });
  props_().setProperty('FMT1', '1');
}
function ensureAdmin_() {
  ensureFormats_();
  const rs = rows_('Users');
  for (let i = 0; i < rs.length; i++) if (String(rs[i][4]) === 'admin') return;
  const id = String(props_().getProperty('ADMIN_ID') || DEFAULT_ADMIN_ID), pw = String(props_().getProperty('ADMIN_PASSWORD') || DEFAULT_ADMIN_PASSWORD);
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  sh_('Users').appendRow([id, 'Admin', salt, hash_(salt, pw), 'admin', true, new Date()]);
}
function log_(u, wid, action, detail) {
  sh_('Activity').appendRow([Date.now(), u.id, u.name, wid || '', action, String(detail || '').slice(0, 300)]);
}

// ---------- groups ----------
function letters_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function isMember_(gid, uid) {
  const rs = rows_('Members');
  for (let i = 0; i < rs.length; i++) if (String(rs[i][0]) === String(gid) && String(rs[i][1]) === String(uid)) return true;
  return false;
}
function canWs_(u, wid) {
  wid = String(wid || '');
  if (u.role === 'admin') return true;
  if (wid === 'u:' + u.id) return true;
  if (wid.indexOf('g:') === 0) return isMember_(wid.slice(2), u.id);
  return false;
}
function needWs_(u, wid) {
  if (!canWs_(u, wid)) fail_('You do not have access to this workspace');
  if (String(wid).indexOf('g:') === 0) {
    const gs = rows_('Groups');
    if (!gs.some(function (r) { return String(r[0]) === String(wid).slice(2); })) fail_('Group not found');
  }
}

function snapshot_(u) {
  const users = rows_('Users').map(function (r) { const x = userRow_(r); return { id: x.id, name: x.name, role: x.role, canUpload: x.canUpload }; });
  const nameOf = {}; users.forEach(function (x) { nameOf[x.id] = x.name; });
  const mem = rows_('Members'), admin = u.role === 'admin', myG = {};
  mem.forEach(function (r) { if (String(r[1]) === u.id) myG[String(r[0])] = 1; });
  const groups = rows_('Groups').filter(function (r) { return admin || myG[String(r[0])]; }).map(function (r) {
    const gid = String(r[0]), seq = Number(r[1]);
    return {
      gid: gid, seq: seq, label: 'Group ' + letters_(seq), name: String(r[2] || ''), createdBy: String(r[3]),
      members: mem.filter(function (m) { return String(m[0]) === gid; }).map(function (m) { return { id: String(m[1]), name: nameOf[String(m[1])] || String(m[1]), role: String(m[2]) }; })
    };
  });
  const gset = {}, ginfo = {};
  groups.forEach(function (g) { gset[g.gid] = 1; });
  rows_('Groups').forEach(function (r) { ginfo[String(r[0])] = { label: 'Group ' + letters_(Number(r[1])), name: String(r[2] || '') }; });
  const requests = rows_('Requests').filter(function (r) {
    return String(r[4]) === 'pending' && (String(r[3]) === u.id || gset[String(r[1])]);
  }).map(function (r) { return { rid: String(r[0]), gid: String(r[1]), from: String(r[2]), fromName: nameOf[String(r[2])] || String(r[2]), to: String(r[3]), toName: nameOf[String(r[3])] || String(r[3]), time: Number(r[5]), glabel: (ginfo[String(r[1])] || {}).label || '', gname: (ginfo[String(r[1])] || {}).name || '' }; });
  const templates = rows_('Templates').map(function (r) { try { const t = JSON.parse(r[2]); t.by = String(r[4] || ''); return t; } catch (e) { return null; } }).filter(Boolean);
  return { user: pub_(u), users: users, groups: groups, requests: requests, templates: templates };
}

function wsData_(wid) {
  const adminId = String(props_().getProperty('ADMIN_ID') || DEFAULT_ADMIN_ID);
  const same = function (w) { return String(w || ('u:' + adminId)) === String(wid); };   // old rows without a workspace belong to the admin
  const keys = rows_('Keys').filter(function (r) { return same(r[5]); }).map(function (r) {
    return { id: String(r[0]), name: String(r[1]), tplId: String(r[2] || 'builtin'), answers: JSON.parse(r[3] || '{}'), by: String(r[6] || '') };
  });
  let rs = rows_('Results').filter(function (r) { return same(r[17]); });
  if (rs.length > 3000) rs = rs.slice(rs.length - 3000);
  const results = rs.map(function (r) {
    return {
      id: String(r[0]), t: Number(r[1]), keyId: String(r[2]), keyName: String(r[3]), student: String(r[4]),
      c: r[5], w: r[6], b: r[7], total: r[8], neg: r[9], tim: r[10], timer: bool_(r[11]), fin: r[12],
      wrongQs: String(r[13] || '').split(' ').filter(Boolean).map(Number), sel: JSON.parse(r[14] || '[]'),
      sid: String(r[15] || ''), bad: String(r[16] || '').split(' ').filter(Boolean).map(Number), by: String(r[18] || '')
    };
  });
  let settings = {}, logo = '';
  const w = rows_('WS');
  for (let i = 0; i < w.length; i++) if (String(w[i][0]) === String(wid)) { try { settings = JSON.parse(w[i][1] || '{}'); } catch (e) { } logo = String(w[i][2] || ''); }
  return { keys: keys, results: results, settings: settings, logo: logo };
}

function num_(v, lo, hi, d) { v = Number(v); return isFinite(v) && v >= lo && v <= hi ? v : d; }
function txt_(v, n) { return String(v == null ? '' : v).slice(0, n); }

// ---------- web app ----------
function doGet() { return out_({ ok: true, service: 'OMR Scanner API' }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const b = JSON.parse(e.postData.contents), a = String(b.action || '');
    ensureAdmin_();
    const cache = CacheService.getScriptCache();

    // ----- public -----
    if (a === 'register') {
      const name = txt_(b.name, 60).trim(), id = String(b.mobile || '').replace(/[\s\-+()]/g, '');
      if (!name) fail_('Please enter your name');
      if (!/^\d{7,15}$/.test(id)) fail_('Enter a valid mobile number (digits only)');
      if (user_(id)) fail_('This mobile number is already registered. Log in, or ask the admin to reset your password.');
      const pw = newPassword_(), salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
      sh_('Users').appendRow([id, safe_(name), salt, hash_(salt, pw), 'user', false, new Date()]);
      log_({ id: id, name: name }, '', 'register', '');
      return out_({ ok: true, id: id, password: pw });
    }
    if (a === 'login') {
      const id = String(b.id || '').replace(/[\s\-+()]/g, '').toLowerCase(), key = 'fail:' + id;
      if (Number(cache.get(key) || 0) >= 6) fail_('Too many wrong attempts. Try again in 10 minutes.');
      const rs = rows_('Users'); let u = null;
      for (let i = 0; i < rs.length; i++) if (String(rs[i][0]).toLowerCase() === id) u = userRow_(rs[i]);
      if (!u || hash_(u.salt, String(b.password || '')) !== u.hash) {
        cache.put(key, String(Number(cache.get(key) || 0) + 1), 600);
        fail_('Wrong ID or password');
      }
      cache.remove(key);
      return out_({ ok: true, token: token_(u), user: pub_(u), defaultPassword: u.role === 'admin' && String(b.password) === DEFAULT_ADMIN_PASSWORD });
    }

    // ----- everything below needs a valid login -----
    const u = auth_(b);

    if (a === 'bootstrap') return out_(Object.assign({ ok: true }, snapshot_(u)));

    if (a === 'wsSync') { needWs_(u, b.wid); return out_(Object.assign({ ok: true }, wsData_(String(b.wid)))); }

    if (a === 'changePassword') {
      if (hash_(u.salt, String(b.oldPassword || '')) !== u.hash) fail_('Current password is wrong');
      const np = String(b.newPassword || '');
      if (np.length < 6) fail_('The new password must be at least 6 characters');
      setPassword_(u.id, np);
      const nu = user_(u.id);
      log_(u, '', 'changePassword', '');
      return out_({ ok: true, token: token_(nu) });
    }

    if (a === 'saveKey') {
      needWs_(u, b.wid); const k = b.key || {};
      const ex = rows_('Keys').filter(function (r) { return String(r[0]) === String(k.id); })[0];
      if (ex && String(ex[5] || '') !== String(b.wid) && u.role !== 'admin') fail_('This answer key belongs to another workspace');
      const isNew = upsert_('Keys', k.id, [k.id, safe_(txt_(k.name, 80)), txt_(k.tplId || 'builtin', 60), JSON.stringify(k.answers || {}), new Date(), b.wid, ex ? String(ex[6] || u.name) : u.name]);
      log_(u, b.wid, isNew ? 'saveKey' : 'updateKey', k.name);
      return out_({ ok: true });
    }
    if (a === 'deleteKey') {
      needWs_(u, b.wid);
      const ex = rows_('Keys').filter(function (r) { return String(r[0]) === String(b.id) && String(r[5] || '') === String(b.wid); })[0];
      if (ex) { remove_('Keys', b.id); log_(u, b.wid, 'deleteKey', ex[1]); }
      return out_({ ok: true });
    }

    if (a === 'saveResult') {
      needWs_(u, b.wid); const r = b.result || {};
      const ex = rows_('Results').filter(function (x) { return String(x[0]) === String(r.id); })[0];
      if (ex && String(ex[17] || '') !== String(b.wid) && u.role !== 'admin') fail_('This result belongs to another workspace');
      const isNew = upsert_('Results', r.id, [r.id, r.t, r.keyId, safe_(r.keyName), safe_(r.student), r.c, r.w, r.b, r.total, r.neg, r.tim, !!r.timer, r.fin,
        (r.wrongQs || []).join(' '), JSON.stringify(r.sel), safe_(r.sid), (r.bad || []).join(' '), b.wid, ex ? String(ex[18] || u.name) : u.name]);
      if (isNew) log_(u, b.wid, 'scan', (r.student || '') + (r.sid ? ' (' + r.sid + ')' : '') + ' — ' + r.fin + '/' + r.total);
      return out_({ ok: true });
    }
    if (a === 'deleteResult') {
      needWs_(u, b.wid);
      const ex = rows_('Results').filter(function (x) { return String(x[0]) === String(b.id) && String(x[17] || '') === String(b.wid); })[0];
      if (ex) { remove_('Results', b.id); log_(u, b.wid, 'deleteResult', ex[4]); }
      return out_({ ok: true });
    }

    if (a === 'saveWs') {
      needWs_(u, b.wid); const s = b.settings || {}, h = s.header || {};
      const clean = {
        per: num_(s.per, 0, 100, 1), neg: num_(s.neg, 0, 100, 0.25), timerPct: num_(s.timerPct, 0, 100, 3), passPct: num_(s.passPct, 0, 100, 40),
        header: { l1: txt_(h.l1, 120), l2: txt_(h.l2, 120), l3: txt_(h.l3, 120), l4: txt_(h.l4, 120) }
      };
      upsert_('WS', b.wid, [b.wid, JSON.stringify(clean), txt_(b.logo, 48000), new Date()]);
      log_(u, b.wid, 'saveSettings', '');
      return out_({ ok: true });
    }

    if (a === 'saveTemplate') {
      if (!(u.role === 'admin' || u.canUpload)) fail_('Only the admin (or a user the admin allowed) can upload new sheet types');
      const t = b.template || {}, json = JSON.stringify(t);
      if (json.length > 49000) fail_('template too large for one cell');
      const ex = rows_('Templates').filter(function (r) { return String(r[0]) === String(t.id); })[0];
      if (ex && u.role !== 'admin' && String(ex[4]) !== u.id) fail_('This sheet type was uploaded by someone else');
      const isNew = upsert_('Templates', t.id, [t.id, safe_(t.name), json, new Date(), ex ? String(ex[4]) : u.id]);
      if (isNew) log_(u, '', 'saveTemplate', t.name);
      return out_({ ok: true });
    }
    if (a === 'deleteTemplate') {
      const ex = rows_('Templates').filter(function (r) { return String(r[0]) === String(b.id); })[0];
      if (ex) {
        if (u.role !== 'admin' && String(ex[4]) !== u.id) fail_('Only the admin or the uploader can delete this sheet type');
        remove_('Templates', b.id); log_(u, '', 'deleteTemplate', ex[1]);
      }
      return out_({ ok: true });
    }

    // ----- groups -----
    if (a === 'createGroup') {
      let seq = 0;
      rows_('Groups').forEach(function (r) { if (Number(r[1]) > seq) seq = Number(r[1]); });
      seq++;
      const gid = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
      sh_('Groups').appendRow([gid, seq, safe_(txt_(b.name, 60).trim()), u.id, new Date()]);
      sh_('Members').appendRow([gid, u.id, 'owner', new Date()]);
      log_(u, 'g:' + gid, 'createGroup', 'Group ' + letters_(seq));
      return out_({ ok: true, gid: gid });
    }
    if (a === 'renameGroup') {
      if (!(u.role === 'admin' || isMember_(b.gid, u.id))) fail_('Not allowed');
      const sh = sh_('Groups'), r = findRow_(sh, b.gid);
      if (r < 0) fail_('Group not found');
      sh.getRange(r, 3).setValue(safe_(txt_(b.name, 60).trim()));
      log_(u, 'g:' + b.gid, 'renameGroup', b.name);
      return out_({ ok: true });
    }
    if (a === 'invite') {
      if (!(u.role === 'admin' || isMember_(b.gid, u.id))) fail_('Only group members can invite');
      const to = String(b.to || '').replace(/[\s\-+()]/g, '');
      if (!user_(to)) fail_('No user with this ID');
      if (isMember_(b.gid, to)) fail_('Already a member');
      const dup = rows_('Requests').some(function (r) { return String(r[1]) === String(b.gid) && String(r[3]) === to && String(r[4]) === 'pending'; });
      if (dup) fail_('A request is already pending');
      sh_('Requests').appendRow(['q' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36), b.gid, u.id, to, 'pending', Date.now()]);
      log_(u, 'g:' + b.gid, 'invite', to);
      return out_({ ok: true });
    }
    if (a === 'respond') {
      const sh = sh_('Requests'), r = findRow_(sh, b.rid);
      if (r < 0) fail_('Request not found');
      const v = sh.getRange(r, 1, 1, 6).getValues()[0];
      if (String(v[3]) !== u.id) fail_('This request is not for you');
      if (String(v[4]) !== 'pending') fail_('Already answered');
      sh.getRange(r, 5).setValue(b.accept ? 'accepted' : 'declined');
      if (b.accept && !isMember_(v[1], u.id)) sh_('Members').appendRow([v[1], u.id, 'member', new Date()]);
      log_(u, 'g:' + v[1], b.accept ? 'joinGroup' : 'declineInvite', '');
      return out_({ ok: true });
    }
    if (a === 'leaveGroup') {
      const sh = sh_('Members'), n = sh.getLastRow();
      if (n >= 2) {
        const v = sh.getRange(2, 1, n - 1, 2).getValues();
        for (let i = v.length - 1; i >= 0; i--) if (String(v[i][0]) === String(b.gid) && String(v[i][1]) === u.id) sh.deleteRow(i + 2);
      }
      log_(u, 'g:' + b.gid, 'leaveGroup', '');
      return out_({ ok: true });
    }

    // ----- admin only -----
    if (a === 'setUpload' || a === 'resetPassword' || a === 'overview') {
      if (u.role !== 'admin') fail_('Admin only');
      if (a === 'setUpload') {
        const sh = sh_('Users'), r = findRow_(sh, b.id);
        if (r < 0) fail_('User not found');
        sh.getRange(r, 6).setValue(!!b.value);
        log_(u, '', 'setUpload', b.id + ' = ' + !!b.value);
        return out_({ ok: true });
      }
      if (a === 'resetPassword') {
        const pw = newPassword_(); setPassword_(String(b.id), pw);
        log_(u, '', 'resetPassword', b.id);
        return out_({ ok: true, password: pw });
      }
      const kc = {}, rc = {}, last = {};
      rows_('Keys').forEach(function (r) { const w = String(r[5] || ''); kc[w] = (kc[w] || 0) + 1; });
      rows_('Results').forEach(function (r) { const w = String(r[17] || ''); rc[w] = (rc[w] || 0) + 1; });
      const act = rows_('Activity'), recent = act.slice(Math.max(0, act.length - 200)).reverse().map(function (r) {
        return { t: Number(r[0]), uid: String(r[1]), name: String(r[2]), wid: String(r[3]), action: String(r[4]), detail: String(r[5]) };
      });
      act.forEach(function (r) { const w = String(r[3]); if (Number(r[0]) > (last[w] || 0)) last[w] = Number(r[0]); });
      const groups = snapshot_(u).groups.map(function (g) { const w = 'g:' + g.gid; return Object.assign({}, g, { keys: kc[w] || 0, results: rc[w] || 0, last: last[w] || 0 }); });
      return out_({ ok: true, groups: groups, activity: recent });
    }

    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}
