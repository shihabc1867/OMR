/**
 * OMR Scanner - Google Apps Script backend
 * Setup: open a Google Sheet -> Extensions -> Apps Script, paste this code, then
 * Deploy -> New deployment -> Web app (Execute as: Me, Who has access: Anyone).
 * Set the admin PIN: Project Settings -> Script properties -> ADMIN_PIN
 * (if it is not set, the default PIN is 1234).
 */

const KEYS_HEADERS = ['id', 'name', 'tplId', 'answers', 'updated'];
const TPL_HEADERS = ['id', 'name', 'json', 'updated'];
const RES_HEADERS = ['id', 'time', 'keyId', 'keyName', 'student', 'correct', 'wrong', 'blank', 'total', 'negative', 'timerCut', 'timerOn', 'final', 'wrongQs', 'sel'];

function props_() { return PropertiesService.getScriptProperties(); }
function pin_() { return String(props_().getProperty('ADMIN_PIN') || '1234'); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function settings_() { const s = props_().getProperty('SETTINGS'); return s ? JSON.parse(s) : {}; }

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
function findRow_(sh, id) {
  const n = sh.getLastRow();
  if (n < 2) return -1;
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}
function upsert_(sh, id, vals) {
  const r = findRow_(sh, id);
  if (r < 0) sh.appendRow(vals); else sh.getRange(r, 1, 1, vals.length).setValues([vals]);
}
function remove_(sh, id) { const r = findRow_(sh, id); if (r > 0) sh.deleteRow(r); }
// Prevent spreadsheet formula injection
function safe_(v) { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }

function doGet(e) {
  try {
    if ((e.parameter.action || 'bootstrap') !== 'bootstrap') return out_({ ok: false, error: 'unknown action' });
    const ks = sheet_('Keys', KEYS_HEADERS), ts = sheet_('Templates', TPL_HEADERS), rs = sheet_('Results', RES_HEADERS);
    const keys = ks.getLastRow() < 2 ? [] : ks.getRange(2, 1, ks.getLastRow() - 1, 4).getValues()
      .map(r => ({ id: String(r[0]), name: String(r[1]), tplId: String(r[2] || 'builtin'), answers: JSON.parse(r[3] || '{}') }));
    const templates = ts.getLastRow() < 2 ? [] : ts.getRange(2, 1, ts.getLastRow() - 1, 3).getValues().map(r => JSON.parse(r[2]));
    let results = [];
    if (rs.getLastRow() > 1) {
      const n = Math.min(500, rs.getLastRow() - 1), start = rs.getLastRow() - n + 1;
      results = rs.getRange(start, 1, n, RES_HEADERS.length).getValues().map(r => ({
        id: String(r[0]), t: Number(r[1]), keyId: String(r[2]), keyName: String(r[3]), student: String(r[4]),
        c: r[5], w: r[6], b: r[7], total: r[8], neg: r[9], tim: r[10], timer: r[11] === true || r[11] === 'TRUE', fin: r[12],
        wrongQs: String(r[13] || '').split(' ').filter(Boolean).map(Number), sel: JSON.parse(r[14] || '[]')
      }));
    }
    return out_({ ok: true, keys, templates, settings: settings_(), results });
  } catch (err) { return out_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const b = JSON.parse(e.postData.contents), a = b.action;
    const admin = ['saveKey', 'deleteKey', 'saveSettings', 'deleteResult', 'saveTemplate', 'deleteTemplate'];
    if (admin.indexOf(a) >= 0 && String(b.pin) !== pin_()) return out_({ ok: false, error: 'PIN does not match the server ADMIN_PIN' });

    if (a === 'saveKey') {
      const k = b.key;
      upsert_(sheet_('Keys', KEYS_HEADERS), k.id, [k.id, safe_(k.name), k.tplId || 'builtin', JSON.stringify(k.answers), new Date()]);
    } else if (a === 'deleteKey') {
      remove_(sheet_('Keys', KEYS_HEADERS), b.id);
    } else if (a === 'saveTemplate') {
      const t = b.template, json = JSON.stringify(t);
      if (json.length > 49000) return out_({ ok: false, error: 'template too large for one cell' });
      upsert_(sheet_('Templates', TPL_HEADERS), t.id, [t.id, safe_(t.name), json, new Date()]);
    } else if (a === 'deleteTemplate') {
      remove_(sheet_('Templates', TPL_HEADERS), b.id);
    } else if (a === 'saveSettings') {
      const s = b.settings || {};
      props_().setProperty('SETTINGS', JSON.stringify({ per: Number(s.per), neg: Number(s.neg), timerPct: Number(s.timerPct), thr: Number(s.thr) }));
      if (b.newPin) props_().setProperty('ADMIN_PIN', String(b.newPin));
    } else if (a === 'saveResult') {
      const r = b.result;
      upsert_(sheet_('Results', RES_HEADERS), r.id, [r.id, r.t, r.keyId, safe_(r.keyName), safe_(r.student),
        r.c, r.w, r.b, r.total, r.neg, r.tim, !!r.timer, r.fin, (r.wrongQs || []).join(' '), JSON.stringify(r.sel)]);
    } else if (a === 'deleteResult') {
      remove_(sheet_('Results', RES_HEADERS), b.id);
    } else {
      return out_({ ok: false, error: 'unknown action' });
    }
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
