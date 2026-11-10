/* ==========================================================================
 * 坐標轉換工具 — 介面
 * ======================================================================== */
const SELF_HTML = '<!doctype html>\n' + document.documentElement.outerHTML; // 必須最先執行（供自我更新/重新打包）
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VER = JSON.parse($('#ver-data').textContent);
const BUILTIN = JSON.parse($('#lib-data').textContent);
const LS_KEY = 'ct.user.v1';
const E = Engine;

/* ---------------- 儲存 ---------------- */
function loadUser() {
  let u = null;
  try { u = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { /* 無法存取 */ }
  u = u || {};
  u.sets = u.sets || {}; u.hidden = u.hidden || []; u.settings = Object.assign({ compat: true, dec: 3, far: 300, theme: '', updUrl: '', updAuto: true }, u.settings || {});
  u.ui = u.ui || {};
  return u;
}
let USER = loadUser();
function saveUser() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(USER)); return true; }
  catch (e) { toast('無法寫入瀏覽器儲存空間，請改用「匯出自訂資料備份」保存：' + e.message); return false; }
}
const S = () => USER.settings;
const updUrl = () => ((S().updUrl || '').trim() || VER.updateUrl || '');  // 未自訂時使用內建更新來源

/* ---------------- 工具 ---------------- */
function toast(msg, ms = 3500) {
  const d = document.createElement('div'); d.className = 'm'; d.textContent = msg;
  $('#toast').appendChild(d); setTimeout(() => d.remove(), ms);
}
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }
const nowStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const rocDate = () => { const d = new Date(); return `${d.getFullYear() - 1911}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const fx = (x, d) => (x == null || !isFinite(x)) ? '' : Number(x).toFixed(d);
const mm = x => (x == null || !isFinite(x)) ? '' : (x * 1000).toFixed(1);
const cmpVer = (a, b) => { const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0); } return 0; };
function download(name, data, mime = 'text/plain;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function readFileText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch (e) { return new TextDecoder('big5').decode(buf); }
}
function dlg(title, bodyHtml, buttons = [{ label: '關閉' }]) {
  return new Promise(res => {
    const d = $('#dlg');
    $('#dlgTitle').textContent = title; $('#dlgBody').innerHTML = bodyHtml; $('#dlgFoot').innerHTML = '';
    buttons.forEach((b, i) => {
      const el = document.createElement('button'); el.className = 'btn' + (b.pri ? ' pri' : '') + (b.danger ? ' danger' : ''); el.textContent = b.label;
      el.onclick = () => { const v = b.value === undefined ? i : b.value; if (b.onClick && b.onClick() === false) return; res(v); d.close(); };
      $('#dlgFoot').appendChild(el);
    });
    d.onclose = () => res(null);
    d.showModal();
    const inp = d.querySelector('#dlgBody input[type=text]');
    if (inp) { inp.focus(); inp.select(); inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); const p = d.querySelector('#dlgFoot .btn.pri'); if (p) p.click(); } }; }
  });
}
async function ask(title, label, def = '') {
  const v = await dlg(title, `<div class="field"><label>${esc(label)}</label><input type="text" id="askInput" value="${esc(def)}" style="width:100%"></div>`,
    [{ label: '取消', value: null }, { label: '確定', pri: true, value: 'ok' }]);
  return v === 'ok' ? ($('#askInput').value || '').trim() : null;
}
const confirmDlg = (title, html, okLabel = '確定', danger = false) => dlg(title, html, [{ label: '取消', value: false }, { label: okLabel, pri: !danger, danger, value: true }]);

/* ZIP（store, UTF-8 檔名） */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate()), tm = (d.getHours() << 11 | d.getMinutes() << 5 | (d.getSeconds() >> 1));
  Object.entries(files).forEach(([name, content]) => {
    const nb = enc.encode(name), data = typeof content === 'string' ? enc.encode(content) : content, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  });
  const csize = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true);
  e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

/* IndexedDB（存放本檔的檔案控制代碼，供覆寫自我更新） */
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('coord-transfer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => { const tx = r.result.transaction('kv', mode); const q = fn(tx.objectStore('kv')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); };
  });
}
const idbGet = k => idb('readonly', s => s.get(k)).catch(() => null);
const idbSet = (k, v) => idb('readwrite', s => s.put(v, k)).catch(() => null);
const selfName = () => decodeURIComponent((location.pathname.split('/').pop() || '坐標轉換工具.html'));

async function saveHtml(html, { overwrite = true, name } = {}) {
  name = name || selfName();
  if (overwrite && window.showOpenFilePicker && location.protocol === 'file:') {
    try {
      let h = await idbGet('selfHandle');
      if (h && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') h = null;
      }
      if (!h) {
        await dlg('選取本檔以便覆寫', `<p>接下來會開啟檔案選擇視窗，請選取<b>目前正在使用的這個檔案</b>：</p><p class="mono">${esc(decodeURIComponent(location.pathname.replace(/^\//, '')))}</p><p class="muted small">之後更新就不必再選。</p>`, [{ label: '繼續', pri: true }]);
        [h] = await window.showOpenFilePicker({ types: [{ description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } }] });
        if (h.name !== selfName() && !(await confirmDlg('檔名不同', `你選的是「${esc(h.name)}」，目前開啟的是「${esc(selfName())}」。確定要覆寫所選檔案？`))) return false;
        await h.requestPermission({ mode: 'readwrite' });
        await idbSet('selfHandle', h);
      }
      const w = await h.createWritable(); await w.write(html); await w.close();
      return 'written';
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      toast('無法直接覆寫（' + (e.message || e) + '），改為下載新檔。');
    }
  }
  download(name, html, 'text/html;charset=utf-8');
  return 'downloaded';
}

/* ---------------- 參數庫 ---------------- */
const P = a => Array.isArray(a) ? { name: a[0], ip: a[1], n1: a[2], e1: a[3], n2: a[4], e2: a[5], on: true } : Object.assign({ on: true }, a);
const ptsHash = pts => fnv(JSON.stringify(pts.map(p => [p.name, p.ip, p.n1, p.e1, p.n2, p.e2, p.on !== false])));
function builtinSet(id) {
  const b = BUILTIN.sets.find(s => s.id === id); if (!b) return null;
  return { id: b.id, name: b.name, sections: b.sections.slice(), note: b.note || '', npar: b.npar, colloc: b.colloc !== false, file: b.file,
    points: b.points.map(P), samples: (b.samples || []).map(s => ({ name: s[0], n: s[2], e: s[3] })),
    history: (b.history || []).map(h => ({ label: h.label, file: h.file, points: h.points.map(P), builtin: true })), revisions: [], origin: 'builtin' };
}
function allSets() {
  const out = [];
  BUILTIN.sets.forEach(b => {
    if (USER.hidden.includes(b.id)) return;
    const base = builtinSet(b.id);
    const u = USER.sets[b.id];
    if (u) {
      const s = Object.assign({}, base, u, { points: u.points.map(P), history: base.history, samples: base.samples, origin: 'modified' });
      s.builtinChanged = u.baseHash && u.baseHash !== ptsHash(base.points);
      out.push(s);
    } else out.push(base);
  });
  Object.values(USER.sets).forEach(u => {
    if (BUILTIN.sets.some(b => b.id === u.id)) return;
    out.push(Object.assign({ history: [], samples: [], revisions: [] }, u, { points: u.points.map(P), origin: 'user' }));
  });
  return out;
}
const getSet = id => allSets().find(s => s.id === id) || null;
const ctrlRows = set => set.points.filter(p => p.on !== false).map(p => ({ name: p.name, ip: p.ip < 7 ? p.ip : 1, n1: +p.n1, e1: +p.e1, n2: +p.n2, e2: +p.e2 }));
function findSetBySection(code) {
  code = String(code).trim(); if (!code) return null;
  const sets = allSets();
  return sets.find(s => s.id === code) || sets.find(s => (s.sections || []).includes(code)) || sets.find(s => s.name.includes(code)) || null;
}

/* ---------------- 轉換流程 ---------------- */
const ui = Object.assign({ set: '', dir: 'fwd', npar: 6, colloc: true, method: 'swap', inTab: 'single' }, USER.ui);
function saveUi() { USER.ui = ui; saveUser(); }

function ctx() {
  const set = getSet(ui.set);
  return { set, dir: ui.dir, npar: ui.npar, colloc: ui.colloc, method: ui.method, compat: S().compat !== false };
}
const sysIn = c => c.dir === 'fwd' ? 'TWD67' : 'TWD97', sysOut = c => c.dir === 'fwd' ? 'TWD97' : 'TWD67';

function buildRun(c, rowsOverride) {
  let rows = rowsOverride || ctrlRows(c.set);
  if (!rows.filter(r => r.ip < 7).length) throw new Error('此參數組沒有可用的控制點。');
  const iter = c.dir === 'rev' && c.method === 'iter';
  const fitRows = c.dir === 'rev' && !iter ? E.swapRows(rows) : rows;
  const model = E.fit(fitRows, { npar: c.npar, colloc: c.colloc, compat: c.compat });
  const ctrl = rows.filter(r => r.ip < 7);
  const srcPts = ctrl.map(r => c.dir === 'fwd' ? { n: r.n1, e: r.e1, name: r.name } : { n: r.n2, e: r.e2, name: r.name });
  const check = E.geomChecker(srcPts);
  const conv = (n, e) => iter ? E.inverse(model, n, e, c.colloc) : E.forward(model, n, e, c.colloc, c.compat);
  return { model, rows, fitRows, iter, check, conv };
}
function transformTargets(c, targets, rowsOverride) {
  const run = buildRun(c, rowsOverride);
  const far = +S().far || 0;
  const items = targets.map(t => {
    const r = run.conv(t.n, t.e);
    const g = run.check(t.n, t.e);
    return Object.assign({}, t, { inN: t.n, inE: t.e, n: r.n, e: r.e, an: r.an, ae: r.ae, dn: r.dn, de: r.de,
      nearest: g.nearest, nearestName: g.nearestName, inside: g.inside, extrap: !g.inside || (far > 0 && g.nearest > far) });
  });
  let legacy = null;
  if (!run.iter) {
    const tRows = targets.map(t => ({ name: String(t.name).slice(0, 8), ip: 8, n1: t.n, e1: t.e, n2: 0, e2: 0 }));
    legacy = E.legacyFiles(run.fitRows.concat(tRows), run.model, (c.set ? c.set.id : 'trans').replace(/[^\w.-]+/g, '_'));
  }
  return { ctx: c, run, model: run.model, items, legacy, time: nowStr() };
}

/* ---------------- 轉換頁 ---------------- */
function renderSetSelect() {
  const sel = $('#selSet'), sets = allSets();
  const groups = { builtin: [], modified: [], user: [] };
  sets.forEach(s => groups[s.origin].push(s));
  const opt = s => `<option value="${esc(s.id)}">${esc(s.name)}${s.sections && s.sections.length > 1 ? '（' + esc(s.sections[0]) + '–' + esc(s.sections[s.sections.length - 1]) + '）' : ''} · ${s.points.filter(p => p.on !== false).length} 點</option>`;
  sel.innerHTML = (groups.builtin.length ? `<optgroup label="內建參數">${groups.builtin.map(opt).join('')}</optgroup>` : '') +
    (groups.modified.length ? `<optgroup label="已修改的內建參數">${groups.modified.map(opt).join('')}</optgroup>` : '') +
    (groups.user.length ? `<optgroup label="自訂參數">${groups.user.map(opt).join('')}</optgroup>` : '');
  if (!sets.some(s => s.id === ui.set)) ui.set = sets[0] ? sets[0].id : '';
  sel.value = ui.set;
}
function setSeg(id, v) { $$(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); }
function refreshTransHeader() {
  const c = ctx(); const set = c.set;
  setSeg('segDir', ui.dir); setSeg('segPar', ui.npar); $('#chkColloc').checked = ui.colloc;
  $('#revMethodBox').style.display = ui.dir === 'rev' ? '' : 'none'; $('#selRevMethod').value = ui.method;
  ['spN', 'spE'].forEach(k => { $('#' + k + 'Label').textContent = (k === 'spN' ? 'N' : 'E') + '（' + sysIn(c) + '）'; });
  const w = $('#setWarn'); w.innerHTML = '';
  if (!set) { $('#setSummary').textContent = '尚無參數組'; return; }
  try {
    const run = buildRun(c);
    const m = run.model;
    $('#setSummary').innerHTML = `${esc(set.sections && set.sections.length ? '適用：' + set.sections.join('、') + ' 段 · ' : '')}控制點 ${m.nctrl} · 自由度 ${m.df} · σ₀ = ${m.df > 1 ? fx(m.sd0 * 1000, 1) + ' mm' : '—'}`;
    const msgs = m.warnings.slice();
    if (set.note) msgs.unshift(set.note);
    if (set.builtinChanged) msgs.push('內建參數已更新，與你修改過的版本不同，可到「參數管理」比較。');
    if (msgs.length) w.innerHTML = `<div class="note ${m.warnings.length ? 'warn' : ''}">${msgs.map(esc).join('<br>')}</div>`;
  } catch (e) {
    $('#setSummary').textContent = '';
    w.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
  }
}
function bindTransPage() {
  $('#selSet').onchange = e => { ui.set = e.target.value; const s = getSet(ui.set); if (s) { ui.npar = s.npar; ui.colloc = s.colloc !== false; } saveUi(); refreshTransHeader(); };
  $$('#segDir button').forEach(b => b.onclick = () => { ui.dir = b.dataset.v; saveUi(); refreshTransHeader(); });
  $$('#segPar button').forEach(b => b.onclick = () => { ui.npar = +b.dataset.v; saveUi(); refreshTransHeader(); });
  $('#chkColloc').onchange = e => { ui.colloc = e.target.checked; saveUi(); refreshTransHeader(); };
  $('#selRevMethod').onchange = e => { ui.method = e.target.value; saveUi(); };
  $$('#inTabs button').forEach(b => b.onclick = () => { ui.inTab = b.dataset.v; saveUi(); showInTab(); });
  // 單點
  const doSingle = () => {
    const n = parseFloat($('#spN').value), e = parseFloat($('#spE').value);
    if (!isFinite(n) || !isFinite(e)) { toast('請輸入 N、E 坐標'); return; }
    runAndShow('single', [{ name: $('#spName').value.trim() || 'P1', n, e }]);
  };
  $('#btnSingle').onclick = doSingle;
  ['spName', 'spN', 'spE'].forEach(id => $('#' + id).addEventListener('keydown', ev => { if (ev.key === 'Enter') doSingle(); }));
  $('#spN').addEventListener('paste', ev => {
    const t = (ev.clipboardData || window.clipboardData).getData('text').trim();
    const parts = t.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length >= 2) {
      ev.preventDefault();
      const nums = parts.map(Number);
      const ni = nums.findIndex(v => v > 2.3e6 && v < 2.9e6), ei = nums.findIndex(v => v > 1e5 && v < 4e5);
      if (ni >= 0) $('#spN').value = parts[ni]; if (ei >= 0) $('#spE').value = parts[ei];
      const nm = parts.find(p => !isFinite(Number(p)));
      if (nm) $('#spName').value = nm;
    }
  });
  // 多點
  setupDrop('#mtDrop', '#mtFile', async f => { $('#mtText').value = await readFileText(f); MT.fileName = f.name; parseMulti(); });
  let tmr; $('#mtText').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { MT.fileName = ''; parseMulti(); }, 250); });
  $('#btnMulti').onclick = runMulti;
  // COA
  setupDrop('#coaDrop', '#coaFile', async f => { COA.file = f.name; COA.data = E.parseCOA(await readFileText(f)); renderCoaInfo(); });
  $('#btnCoa').onclick = runCoa;
}
function showInTab() {
  setSeg('inTabs', ui.inTab);
  $$('#inTabs button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.inTab));
  $$('[data-in]').forEach(d => d.style.display = d.dataset.in === ui.inTab ? '' : 'none');
}
function setupDrop(dropSel, fileSel, onFile) {
  const d = $(dropSel), f = $(fileSel);
  d.onclick = () => f.click();
  f.onchange = () => { if (f.files[0]) onFile(f.files[0]); f.value = ''; };
  d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('over'); });
  d.addEventListener('dragleave', () => d.classList.remove('over'));
  d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
}

/* 多點解析 */
const MT = { table: null, map: null, inp: null, useInpCtrl: false, fileName: '' };
function looksInp(text) {
  const ls = text.split(/\r?\n/).filter(l => l.trim()); if (!ls.length) return false;
  const ok = ls.filter(l => { const t = l.trim().split(/\s+/); return (t.length === 4 || t.length === 6) && /^\d$/.test(t[1]) && isFinite(+t[2]) && isFinite(+t[3]); }).length;
  return ok / ls.length >= 0.8;
}
function parseMulti() {
  const text = $('#mtText').value;
  const box = $('#mtMap');
  MT.inp = null; MT.table = null;
  if (!text.trim()) { box.innerHTML = ''; $('#mtInfo').textContent = ''; return; }
  if (looksInp(text)) {
    const rows = E.parseInp(text); MT.inp = rows;
    const nc = rows.filter(r => r.ip < 7).length, nt = rows.filter(r => r.ip >= 7 && r.ip < 9).length;
    box.innerHTML = `<div class="note">偵測為 <b>.inp 格式</b>：控制點 ${nc} 點、待求點 ${nt} 點。</div>` +
      (nc ? `<label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="mtUseCtrl" ${MT.useInpCtrl ? 'checked' : ''}> 使用檔案內控制點計算（不使用上方參數組）</label>` : '');
    const cb = $('#mtUseCtrl'); if (cb) cb.onchange = e => { MT.useInpCtrl = e.target.checked; };
    $('#mtInfo').textContent = `待求點 ${nt} 點`;
    return;
  }
  const tb = E.splitTable(text); MT.table = tb;
  const g = E.guessColumns(tb.rows);
  if (!MT.map || MT.map.nCol !== g.nCol) MT.map = g;
  const m = MT.map;
  const sample = tb.rows[m.hasHeader ? 1 : 0] || [];
  const opts = (sel, allowNone) => (allowNone ? `<option value="-1"${sel < 0 ? ' selected' : ''}>（自動編號）</option>` : '') +
    Array.from({ length: m.nCol }, (_, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>第 ${i + 1} 欄${sample[i] != null ? '：' + esc(String(sample[i]).slice(0, 14)) : ''}</option>`).join('');
  box.innerHTML = `<div class="row">
    <div class="field"><label>點名欄</label><select id="mapName">${opts(m.name, true)}</select></div>
    <div class="field"><label>N 欄</label><select id="mapN">${opts(m.n)}</select></div>
    <div class="field"><label>E 欄</label><select id="mapE">${opts(m.e)}</select></div>
    <label style="display:flex;gap:6px;align-items:center;height:36px"><input type="checkbox" id="mapHdr" ${m.hasHeader ? 'checked' : ''}> 首列為標題</label></div>`;
  ['mapName', 'mapN', 'mapE'].forEach(id => $('#' + id).onchange = e => { m[{ mapName: 'name', mapN: 'n', mapE: 'e' }[id]] = +e.target.value; updMtInfo(); });
  $('#mapHdr').onchange = e => { m.hasHeader = e.target.checked; updMtInfo(); };
  updMtInfo();
}
function multiTargets() {
  if (MT.inp) return MT.inp.filter(r => r.ip >= 7 && r.ip < 9).map((r, i) => ({ name: r.name, n: r.n1, e: r.e1, idx: i }));
  if (!MT.table) return [];
  const m = MT.map, rows = MT.table.rows.slice(m.hasHeader ? 1 : 0);
  const out = [];
  rows.forEach((r, i) => {
    const n = parseFloat(r[m.n]), e = parseFloat(r[m.e]);
    if (!isFinite(n) || !isFinite(e)) return;
    out.push({ name: m.name >= 0 && r[m.name] ? r[m.name] : 'P' + (i + 1), n, e, raw: r, idx: i });
  });
  return out;
}
function updMtInfo() {
  const t = multiTargets(), m = MT.map;
  const total = MT.table ? MT.table.rows.length - (m && m.hasHeader ? 1 : 0) : 0;
  $('#mtInfo').textContent = `可轉換 ${t.length} 點` + (total > t.length ? `（略過 ${total - t.length} 列無法辨識）` : '');
}
function runMulti() {
  parseMulti();
  const t = multiTargets();
  if (!t.length) { toast('沒有可轉換的點，請確認欄位設定'); return; }
  let override = null;
  if (MT.inp && MT.useInpCtrl) override = MT.inp.filter(r => r.ip < 7);
  runAndShow('multi', t, override);
}

/* COA */
const COA = { data: null, file: '' };
function renderCoaInfo() {
  const d = COA.data, box = $('#coaInfo');
  if (!d || !d.rows.length) { box.innerHTML = '<div class="note bad">無法辨識的 COA 檔。</div>'; $('#btnCoa').disabled = true; return; }
  let nmin = Infinity, nmax = -Infinity, emin = Infinity, emax = -Infinity;
  d.rows.forEach(r => { nmin = Math.min(nmin, r.n); nmax = Math.max(nmax, r.n); emin = Math.min(emin, r.e); emax = Math.max(emax, r.e); });
  const code = (d.header.trim().split(/\s+/)[0] || '');
  const secNo = code.replace(/^[A-Za-z]+0*/, '');
  const sug = findSetBySection(secNo);
  box.innerHTML = `<div class="kv"><div>檔案</div><div>${esc(COA.file)}</div><div>段代碼</div><div class="mono">${esc(code || '（無標頭）')}</div>
    <div>界址點數</div><div>${d.rows.length.toLocaleString()}</div><div>N 範圍</div><div class="mono">${fx(nmin, 3)} ～ ${fx(nmax, 3)}</div>
    <div>E 範圍</div><div class="mono">${fx(emin, 3)} ～ ${fx(emax, 3)}</div></div>` +
    (d.bad.length ? `<div class="note warn" style="margin-top:8px">有 ${d.bad.length} 列無法解析（第 ${d.bad.slice(0, 8).join('、')}${d.bad.length > 8 ? '…' : ''} 列），將保留不轉換。</div>` : '') +
    (sug && sug.id !== ui.set ? `<div class="note" style="margin-top:8px">段號 ${esc(secNo)} 對應參數組「${esc(sug.name)}」。<button class="btn sm" id="coaUseSug">改用此參數組</button></div>` : '');
  const b = $('#coaUseSug'); if (b) b.onclick = () => { ui.set = sug.id; ui.npar = sug.npar; ui.colloc = sug.colloc !== false; saveUi(); renderSetSelect(); refreshTransHeader(); renderCoaInfo(); };
  $('#btnCoa').disabled = false;
}
function runCoa() {
  if (!COA.data) return;
  const t = COA.data.rows.map((r, i) => ({ name: r.name, n: r.n, e: r.e, idx: i }));
  runAndShow('coa', t);
}

/* 執行與成果呈現 */
let LAST = null;
function runAndShow(kind, targets, override) {
  const c = ctx();
  if (!c.set && !override) { toast('請先選擇參數組'); return; }
  try {
    const res = transformTargets(c, targets, override);
    res.kind = kind; res.override = !!override;
    if (kind === 'multi') { res.table = MT.table; res.map = MT.map && Object.assign({}, MT.map); res.fileName = MT.fileName; }
    if (kind === 'coa') { res.coa = COA.data; res.fileName = COA.file; }
    LAST = res;
    renderResult(res);
  } catch (e) { console.error(e); toast(e.message || String(e), 6000); }
}
function renderResult(res) {
  const c = res.ctx, m = res.model, d = +S().dec || 3, card = $('#resCard');
  card.style.display = '';
  const ex = res.items.filter(i => i.extrap).length;
  $('#resChips').innerHTML = [
    `<span class="chip acc">${sysIn(c)} → ${sysOut(c)}</span>`,
    `<span class="chip">${res.items.length.toLocaleString()} 點</span>`,
    `<span class="chip">${m.npar} 參數${c.colloc && m.colloc ? ' + 配置' : ''}</span>`,
    `<span class="chip">σ₀ ${m.df > 1 ? fx(m.sd0 * 1000, 1) + ' mm' : '—'}</span>`,
    ex ? `<span class="chip warn">外插 ${ex} 點</span>` : `<span class="chip ok">皆在控制範圍內</span>`,
    (n => n ? `<span class="chip warn">不在所選地段 ${n} 點</span>` : '')(outsideSet(res).length),
  ].join(' ');
  const acts = [];
  if (res.kind === 'coa') acts.push(['COA', '下載 COA']);
  if (res.kind === 'multi' && res.table) acts.push(['csvOrig', 'CSV（原格式）']);
  acts.push(['csv', '成果明細 CSV'], ['txt', 'TXT'], ['report', '轉換報告'], ['print', '列印報告']);
  if (res.legacy) acts.push(['zip', '原程式格式 ZIP']);
  $('#resActions').innerHTML = acts.map(([k, l], i) => `<button class="btn sm${i === 0 ? ' pri' : ''}" data-act="${k}">${l}</button>`).join('');
  $$('#resActions button').forEach(b => b.onclick = () => resultAction(b.dataset.act));

  let html = '';
  if (res.kind === 'single') {
    const it = res.items[0];
    html += `<div class="result-big"><div><div class="lb">N（${sysOut(c)}）</div><div class="v">${fx(it.n, d)}</div></div>
      <div><div class="lb">E（${sysOut(c)}）</div><div class="v">${fx(it.e, d)}</div></div>
      <button class="btn sm" id="btnCopy1">複製</button></div>
      <div class="kv" style="margin-top:14px">
      <div>輸入（${sysIn(c)}）</div><div class="mono">${fx(it.inN, 3)}　${fx(it.inE, 3)}</div>
      <div>${m.npar} 參數轉換</div><div class="mono">${fx(it.an, 4)}　${fx(it.ae, 4)}</div>
      <div>配置改正</div><div class="mono">ΔN ${mm(it.dn)} mm　ΔE ${mm(it.de)} mm</div>
      <div>最近控制點</div><div>${esc(it.nearestName)}（${fx(it.nearest, 1)} m）</div>
      <div>位置</div><div>${it.extrap ? '<span class="chip warn">控制點範圍外（外插），精度可能較差</span>' : '<span class="chip ok">控制點範圍內</span>'}</div></div>`;
  } else {
    const lim = res.showAll ? res.items.length : Math.min(res.items.length, 300);
    html += `<div class="tbl-wrap"><table class="t"><thead><tr><th>#</th><th>點名</th><th class="num">N（${sysIn(c)}）</th><th class="num">E（${sysIn(c)}）</th><th class="num">N（${sysOut(c)}）</th><th class="num">E（${sysOut(c)}）</th><th class="num">配置ΔN mm</th><th class="num">配置ΔE mm</th><th>最近控制點</th><th></th></tr></thead><tbody>` +
      res.items.slice(0, lim).map((it, i) => `<tr${it.extrap ? ' class="hl"' : ''}><td class="muted">${i + 1}</td><td>${esc(it.name)}</td><td class="num">${fx(it.inN, 3)}</td><td class="num">${fx(it.inE, 3)}</td><td class="num"><b>${fx(it.n, d)}</b></td><td class="num"><b>${fx(it.e, d)}</b></td><td class="num">${mm(it.dn)}</td><td class="num">${mm(it.de)}</td><td>${esc(it.nearestName)} <span class="muted">${fx(it.nearest, 0)} m</span></td><td>${it.extrap ? '<span class="chip warn">外插</span>' : ''}</td></tr>`).join('') +
      `</tbody></table></div>` + (lim < res.items.length ? `<div style="margin-top:8px"><button class="btn sm" id="btnShowAll">顯示全部 ${res.items.length.toLocaleString()} 點</button> <span class="muted small">（下載檔案已包含全部成果）</span></div>` : '');
  }
  html += `<details open style="margin-top:14px"><summary>點位分布圖</summary><div style="margin-top:8px">${mapSvg(resultMapData(res))}</div></details>`;
  if (m.warnings.length) html += `<div class="note warn" style="margin-top:12px">${m.warnings.map(esc).join('<br>')}</div>`;
  if (res.override) html += `<div class="note" style="margin-top:12px">本次使用 .inp 檔內的控制點計算。</div>`;
  if (res.run.iter) html += `<div class="note" style="margin-top:12px">反算方式：迭代反解（與正算互逆）。原程式格式檔案僅適用「反向擬合」。</div>`;
  $('#resBody').innerHTML = html;
  const cp = $('#btnCopy1'); if (cp) cp.onclick = () => { navigator.clipboard.writeText(`${fx(res.items[0].n, d)}\t${fx(res.items[0].e, d)}`).then(() => toast('已複製')); };
  const sa = $('#btnShowAll'); if (sa) sa.onclick = () => { res.showAll = true; renderResult(res); };
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function baseName(res) {
  const s = res.ctx.set ? res.ctx.set.id : 'trans';
  const src = res.fileName ? res.fileName.replace(/\.[^.]+$/, '') : s;
  return `${src}_${sysOut(res.ctx)}_${rocDate()}`;
}
function resultAction(k) {
  const res = LAST; if (!res) return;
  const d = +S().dec || 3, bn = baseName(res);
  if (k === 'csv') {
    const head = ['點名', `輸入N(${sysIn(res.ctx)})`, `輸入E(${sysIn(res.ctx)})`, `成果N(${sysOut(res.ctx)})`, `成果E(${sysOut(res.ctx)})`, '轉換N(未配置)', '轉換E(未配置)', '配置dN(m)', '配置dE(m)', '最近控制點', '距離(m)', '範圍'];
    const lines = [head.join(',')].concat(res.items.map(it => [it.name, fx(it.inN, 3), fx(it.inE, 3), fx(it.n, d), fx(it.e, d), fx(it.an, 4), fx(it.ae, 4), fx(it.dn, 4), fx(it.de, 4), it.nearestName, fx(it.nearest, 1), it.extrap ? '外插' : '內插'].map(csvCell).join(',')));
    download(bn + '_明細.csv', '﻿' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  } else if (k === 'csvOrig') {
    const delim = res.table.delim === 'ws' ? ' ' : res.table.delim;
    const rows = res.table.rows.map(r => r.slice());
    res.items.forEach(it => { const r = rows[it.idx + (res.map.hasHeader ? 1 : 0)]; r[res.map.n] = fx(it.n, d); r[res.map.e] = fx(it.e, d); });
    download(bn + '.csv', rows.map(r => r.join(delim)).join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  } else if (k === 'txt') {
    download(bn + '.txt', res.items.map(it => E.fA(it.name, 10) + E.fF(it.n, 15, d) + E.fF(it.e, 15, d)).join('\r\n') + '\r\n');
  } else if (k === 'COA') {
    const dec = $('#selCoaDec').value; const coords = res.items.map(it => ({ n: it.n, e: it.e }));
    download((res.fileName || 'OUT.COA').replace(/(\.[^.]+)?$/, m => '_' + sysOut(res.ctx) + (m || '.COA')), E.writeCOA(res.coa, coords, dec === '' ? null : +dec));
  } else if (k === 'report') {
    download(bn + '_轉換報告.html', reportHtml(res), 'text/html;charset=utf-8');
  } else if (k === 'print') {
    const w = window.open('', '_blank'); if (!w) { toast('瀏覽器擋下了彈出視窗，請改用「轉換報告」下載'); return; }
    w.document.write(reportHtml(res, true)); w.document.close();
  } else if (k === 'zip') {
    const files = Object.assign({}, res.legacy);
    Object.keys(files).forEach(f => { if (files[f] === '') delete files[f]; });
    files[bn + '_成果.txt'] = res.items.map(it => E.fA(it.name, 10) + E.fF(it.n, 15, d) + E.fF(it.e, 15, d)).join('\r\n') + '\r\n';
    files[bn + '_轉換報告.html'] = reportHtml(res);
    download(bn + '.zip', makeZip(files));
  }
}
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/* 轉換報告 */
function modelSection(m, rows, inLab, outLab) {
  const ctrl = rows.filter(r => r.ip < 7);
  const resid = new Map(m.residuals.map(r => [r.p, r]));
  const parNames = m.npar === 4 ? ['a', 'b', 'c', 'd'] : ['a₁', 'a₂', 'a₃', 'b₁', 'b₂', 'b₃'];
  let h = `<h2>控制點與殘差</h2><table><thead><tr><th>點名</th><th>N（${inLab}）</th><th>E（${inLab}）</th><th>N（${outLab}）</th><th>E（${outLab}）</th><th>vN mm</th><th>vE mm</th><th>|v| mm</th></tr></thead><tbody>` +
    ctrl.map(p => { const r = m.residuals.find(x => x.p === p) || resid.get(p); return `<tr><td class="l">${esc(p.name)}</td><td>${fx(p.n1, 3)}</td><td>${fx(p.e1, 3)}</td><td>${fx(p.n2, 3)}</td><td>${fx(p.e2, 3)}</td><td>${r ? mm(r.vn) : ''}</td><td>${r ? mm(r.ve) : ''}</td><td>${r ? mm(Math.hypot(r.vn, r.ve)) : ''}</td></tr>`; }).join('') + `</tbody></table>`;
  if (m.residuals.length > 1) h += `<p class="s">殘差大小（由大到小；門檻線＝max(3σ₀, 30 mm)，超過者以紅色與 ⚠ 標示）</p>` +
    barSvg({ items: m.residuals.map(r => ({ name: r.name, v: Math.hypot(r.vn, r.ve) })), thr: m.df > 1 ? residThr(m) : 0, P: VIZ_LIGHT, W: 940 });
  h += `<h2>轉換參數</h2><p class="s">模型：${m.npar === 4 ? 'Helmert 4 參數 N = a·dN + b·dE + c + N₀，E = a·dE − b·dN + d + E₀' : '仿射 6 參數 N = a₁·dN + a₂·dE + a₃ + N₀，E = b₁·dN + b₂·dE + b₃ + E₀'}；dN = N − N₀，dE = E − E₀，N₀ = ${fx(m.nc0, 3)}，E₀ = ${fx(m.ec0, 3)}</p>
    <table><thead><tr><th>參數</th><th>值</th><th>中誤差 σ₀√Qᵢᵢ</th></tr></thead><tbody>${m.X.map((x, i) => `<tr><td class="l">${parNames[i]}（A(${i + 1})）</td><td>${x.toFixed(11)}</td><td>${m.df > 1 ? m.sig[i].toExponential(4) : '—'}</td></tr>`).join('')}</tbody></table>
    <p class="s">控制點 ${m.nctrl} 點，[vv] = ${m.vv.toFixed(6)} m²，自由度 ${m.df}，單位權中誤差 σ₀ = ${m.df > 1 ? fx(m.sd0, 4) + ' m' : '—（自由度不足）'}</p>`;
  if (m.colloc) {
    const C = m.colloc;
    h += `<h2>最小二乘配置</h2><p class="s">線性協方差函數 C(d) = c·(1 − d/a)（d ≤ a），以控制點殘差內插改正量。</p>
      <table><thead><tr><th>分量</th><th>平均殘差 m</th><th>c（m²）</th><th>相關距離 a（km）</th></tr></thead><tbody>
      <tr><td class="l">N</td><td>${C.n.ave.toFixed(4)}</td><td>${C.n.c.toExponential(4)}</td><td>${C.n.a.toFixed(3)}</td></tr>
      <tr><td class="l">E</td><td>${C.e.ave.toFixed(4)}</td><td>${C.e.c.toExponential(4)}</td><td>${C.e.a.toFixed(3)}</td></tr></tbody></table>`;
  }
  if (ctrl.length > 1 && ctrl.length <= 60) {
    const dc = E.distChecks(ctrl), az = E.azChecks(ctrl);
    h += `<h2>距離與方位檢核（兩坐標組間）</h2><table><thead><tr><th>起點</th><th>終點</th><th>距離（${inLab}）</th><th>距離（${outLab}）</th><th>差 mm</th><th>相對精度</th><th>方位差（″）</th></tr></thead><tbody>` +
      dc.map((x, i) => `<tr><td class="l">${esc(x.from)}</td><td class="l">${esc(x.to)}</td><td>${fx(x.d1, 3)}</td><td>${fx(x.d2, 3)}</td><td>${mm(x.dd)}</td><td>${x.valid ? '1/' + Math.round(Math.abs(x.d2 / x.dd)).toLocaleString() : '—'}</td><td>${(az[i].dzRad * 206264.806).toFixed(1)}</td></tr>`).join('') + `</tbody></table>`;
  }
  return h;
}
function reportHtml(res, autoPrint) {
  const c = res.ctx, m = res.model, d = +S().dec || 3, set = c.set;
  const inLab = sysIn(c), outLab = sysOut(c);
  const fitIn = c.dir === 'rev' && !res.run.iter ? 'TWD97' : 'TWD67', fitOut = fitIn === 'TWD67' ? 'TWD97' : 'TWD67';
  const ex = res.items.filter(i => i.extrap);
  const method = c.dir === 'fwd' ? '正算' : (res.run.iter ? '反算（迭代反解正算模型）' : '反算（交換坐標組重新擬合，同原程式）');
  const css = `body{font:13px/1.55 "Microsoft JhengHei","Noto Sans TC",sans-serif;color:#1d2320;margin:28px;max-width:1000px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:2px solid #1f6f5c;padding-bottom:3px}
    table{border-collapse:collapse;width:100%;font-size:12px;margin:4px 0}th,td{border:1px solid #c9cec7;padding:3px 7px;text-align:right;font-family:Consolas,monospace;white-space:nowrap}th{background:#eef1ed;font-family:inherit;text-align:center}td.l{text-align:left;font-family:inherit}
    .s{color:#4c5650;margin:4px 0}.meta td{text-align:left;font-family:inherit;border:0;padding:2px 12px 2px 0}.warn{background:#fdf3e1}.foot{margin-top:24px;color:#7b857f;font-size:11px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.kpi{border:1px solid #dde1dc;border-radius:8px;padding:8px 12px}.kl{color:#4c5650;font-size:12px}.kv{font-size:22px;font-weight:700;font-family:Consolas,monospace}.ks{color:#7b857f;font-size:11px}svg{margin:6px 0}@media print{body{margin:10mm}h2{break-after:avoid}tr{break-inside:avoid}}`;
  let h = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>坐標轉換報告 ${esc(set ? set.name : '')}</title><style>${css}</style></head><body>
    <h1>坐標轉換報告</h1><table class="meta"><tr><td>參數組</td><td><b>${esc(set ? set.name : '（.inp 檔內控制點）')}</b>${set && set.sections.length ? '（適用 ' + esc(set.sections.join('、')) + ' 段）' : ''}${set && set.origin !== 'builtin' ? '　［已自訂修改］' : ''}</td></tr>
    <tr><td>轉換方向</td><td>${inLab} → ${outLab}　${method}</td></tr><tr><td>模型</td><td>${m.npar === 4 ? 'Helmert 4 參數' : '仿射 6 參數'}${c.colloc && m.colloc ? ' + 最小二乘配置' : '（未配置）'}${c.compat ? '，與原程式逐位相容' : ''}</td></tr>
    <tr><td>點數</td><td>${res.items.length} 點${ex.length ? `，其中 <b>${ex.length}</b> 點位於控制點範圍外（外插）` : ''}</td></tr>
    <tr><td>計算時間</td><td>${esc(res.time)}　坐標轉換工具 v${esc(VER.version)}（演算法：國土測繪中心 TRANSFN1）</td></tr></table>`;
  const maxv = Math.max(0, ...m.residuals.map(r => Math.hypot(r.vn, r.ve)));
  h += kpiHtml([['轉換點數', res.items.length.toLocaleString(), inLab + ' → ' + outLab], ['已知控制點', String(m.nctrl), '自由度 ' + m.df],
    ['單位權中誤差 σ₀', m.df > 1 ? fx(m.sd0 * 1000, 1) + ' <small>mm</small>' : '—', m.df > 1 ? '控制點擬合精度' : '自由度不足'],
    ['範圍外（外插）', String(ex.length), ex.length ? '請特別檢核' : '全部在控制範圍內']]);
  h += `<h2>點位分布圖</h2><p class="s">TWD97 坐標，底圖為段籍圖（灰底為所選參數組的適用地段）。藍色三角形為已知控制點、橙色圓點為轉換點（空心者在控制範圍外）；灰色箭頭為控制點殘差（已放大）。最大殘差 ${mm(maxv)} mm。</p>` + mapSvg(Object.assign(resultMapData(res), { P: VIZ_LIGHT, W: 940 }));
  if (m.warnings.length) h += `<p class="s warn">${m.warnings.map(esc).join('<br>')}</p>`;
  h += modelSection(m, res.run.fitRows, fitIn, fitOut);
  h += `<h2>轉換成果</h2><table><thead><tr><th>#</th><th>點名</th><th>N（${inLab}）</th><th>E（${inLab}）</th><th>N（${outLab}）</th><th>E（${outLab}）</th><th>配置ΔN mm</th><th>配置ΔE mm</th><th>最近控制點</th><th>距離 m</th><th>備註</th></tr></thead><tbody>` +
    res.items.map((it, i) => `<tr${it.extrap ? ' class="warn"' : ''}><td>${i + 1}</td><td class="l">${esc(it.name)}</td><td>${fx(it.inN, 3)}</td><td>${fx(it.inE, 3)}</td><td><b>${fx(it.n, d)}</b></td><td><b>${fx(it.e, d)}</b></td><td>${mm(it.dn)}</td><td>${mm(it.de)}</td><td class="l">${esc(it.nearestName)}</td><td>${fx(it.nearest, 0)}</td><td class="l">${it.extrap ? '外插' : ''}</td></tr>`).join('') + `</tbody></table>`;
  h += `<p class="foot">本報告由「坐標轉換工具」產生。轉換演算法逐步移植自國土測繪中心坐標轉換程式 TRANSFN1（成功大學測量系），已與 t.exe 之輸出逐字比對驗證。</p>`;
  if (autoPrint) h += '<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>';
  return h + '</body></html>';
}

/* ---------------- 參數管理 ---------------- */
let ED = { id: null, draft: null, dirty: false, isNew: false };
const clone = o => JSON.parse(JSON.stringify(o));
function renderSetList() {
  const q = ($('#setSearch').value || '').trim();
  const sets = allSets().filter(s => !q || s.id.includes(q) || s.name.includes(q) || (s.sections || []).some(x => x.includes(q)));
  $('#setList').innerHTML = sets.map(s => `<div class="it${s.id === ED.id ? ' on' : ''}" data-id="${esc(s.id)}"><div class="nm">${esc(s.name)}${s.builtinChanged ? '<span class="dot" title="內建參數已更新"></span>' : ''}</div>
    <div class="small muted">${s.points.filter(p => p.on !== false).length} 點 · ${s.npar} 參數 · ${s.origin === 'builtin' ? '內建' : s.origin === 'modified' ? '<span style="color:var(--warn)">已修改</span>' : '<span style="color:var(--accent)">自訂</span>'}</div></div>`).join('') ||
    '<div class="bd muted">找不到符合的參數組</div>';
  $$('#setList .it').forEach(el => el.onclick = async () => { if (await leaveEditor()) openEditor(el.dataset.id); });
}
async function leaveEditor() {
  if (!ED.dirty) return true;
  return !!(await confirmDlg('尚未儲存', '目前的修改尚未儲存，確定要放棄？', '放棄修改', true));
}
function openEditor(id, draft) {
  const s = draft || getSet(id);
  if (!s) { $('#editor').innerHTML = '<div class="card"><div class="bd muted">請從左側選擇參數組</div></div>'; return; }
  ED = { id: s.id, draft: clone(s), dirty: !!draft, isNew: !!draft && !getSet(s.id), buf: ED.buf, focus: null };
  renderSetList(); renderEditor();
}
function markDirty() { ED.dirty = true; const b = $('#edDirty'); if (b) b.style.display = ''; }
function renderEditor() {
  const s = ED.draft;
  const box = $('#editor');
  box.innerHTML = `
  <div class="card"><div class="hd"><h2>${esc(s.name)}</h2>
    <span class="chip ${s.origin === 'builtin' ? '' : s.origin === 'modified' ? 'warn' : 'acc'}">${s.origin === 'builtin' ? '內建' : s.origin === 'modified' ? '已修改的內建參數' : '自訂'}</span>
    <span class="chip warn" id="edDirty" style="${ED.dirty ? '' : 'display:none'}">未儲存</span><div class="spacer"></div>
    <button class="btn sm pri" id="edSave">儲存為新版本</button><button class="btn sm" id="edDiscard">放棄修改</button></div>
  <div class="bd">
    ${s.builtinChanged ? `<div class="note warn" style="margin-bottom:12px">程式更新後內建參數已變動，與你修改過的版本不同。<button class="btn sm" id="edCmpBuiltin">與新內建版本比較</button></div>` : ''}
    <div class="row">
      <div class="field" style="flex:2 1 220px"><label>名稱</label><input type="text" id="edName" value="${esc(s.name)}"></div>
      <div class="field" style="flex:1 1 140px"><label>代號（ID）</label><input type="text" id="edId" value="${esc(s.id)}" ${ED.isNew ? '' : 'disabled'}></div>
      <div class="field" style="flex:2 1 220px"><label>適用段號（以逗號分隔）</label><input type="text" id="edSecs" value="${esc((s.sections || []).join(','))}"></div>
      <div class="field"><label>預設模型</label><div class="seg" id="edPar"><button data-v="6">6 參數</button><button data-v="4">4 參數</button></div></div>
      <label style="display:flex;gap:6px;align-items:center;height:36px"><input type="checkbox" id="edColloc" ${s.colloc !== false ? 'checked' : ''}> 配置</label>
    </div>
    <div class="field" style="margin-top:10px"><label>備註</label><textarea id="edNote" rows="2" style="font-family:inherit">${esc(s.note || '')}</textarea></div>
  </div></div>
  <div class="card"><div class="hd"><h2>控制點</h2><span id="edStats" class="small"></span><div class="spacer"></div>
    <button class="btn sm" id="edExpInp">匯出 .inp</button><button class="btn sm" id="edExpJson">匯出參數檔 JSON</button><button class="btn sm" id="edExpRpt">參數報告</button></div>
    <div class="bd"><div class="tbl-wrap"><table class="t" id="edTbl"></table></div>
    <details style="margin-top:14px" ${s.points.length ? '' : 'open'}><summary>新增控制點</summary>
      <p class="small muted">每行一點：<span class="mono">點名 N67 E67 N97 E97</span>（逗號、Tab、空白分隔皆可），或直接貼上 .inp 內容（IP=1 的列）。同名點會更新坐標。</p>
      <textarea id="edAdd" rows="5" placeholder="HB149  2704461.069  215163.152  2704666.323  214333.842"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn pri sm" id="edAddBtn">加入</button><span class="small muted" id="edAddInfo"></span></div>
    </details></div></div>
  <div class="card"><div class="hd"><h2>點位分布與殘差</h2><span class="small muted">底圖為段籍圖（TWD97），灰底為本組適用地段；箭頭與長條會隨控制點修改即時更新</span></div><div class="bd"><div id="edMap"></div><div id="edBar" style="margin-top:14px"></div></div></div>
  <div class="card"><div class="hd"><h2>地段細分分析</h2><span class="small muted">評估能否把本組拆成「一段一參數」，以及該在哪裡補點</span><div class="spacer"></div>
    <label class="small" style="display:flex;align-items:center;gap:6px">鄰近範圍 <input type="number" id="edBuf" value="${ED.buf || 300}" min="0" step="50" style="width:90px"> 公尺</label></div>
    <div class="bd" id="edSecAna"></div></div>
  <div class="card"><div class="hd"><h2>版本紀錄</h2><div class="spacer"></div>
    ${s.origin === 'modified' ? '<button class="btn sm danger" id="edRevert">還原為內建版本</button>' : ''}
    ${s.origin === 'user' ? '<button class="btn sm danger" id="edDelete">刪除此參數組</button>' : ''}
    ${s.origin === 'builtin' ? '<button class="btn sm danger" id="edHide">從清單隱藏</button>' : ''}</div>
    <div class="bd" id="edHist"></div></div>`;
  setSeg('edPar', s.npar);
  $$('#edPar button').forEach(b => b.onclick = () => { s.npar = +b.dataset.v; setSeg('edPar', s.npar); markDirty(); recalcEditor(); });
  $('#edColloc').onchange = e => { s.colloc = e.target.checked; markDirty(); };
  $('#edName').oninput = e => { s.name = e.target.value; markDirty(); };
  $('#edId').oninput = e => { s.id = e.target.value.trim(); markDirty(); };
  $('#edSecs').oninput = e => { s.sections = e.target.value.split(/[,，、\s]+/).filter(Boolean); markDirty(); };
  $('#edNote').oninput = e => { s.note = e.target.value; markDirty(); };
  $('#edSave').onclick = saveDraft;
  $('#edDiscard').onclick = async () => { if (!ED.dirty || await confirmDlg('放棄修改', '確定放棄目前未儲存的修改？', '放棄', true)) { const id = ED.isNew ? null : ED.id; ED.dirty = false; openEditor(id || (allSets()[0] || {}).id); } };
  $('#edAddBtn').onclick = addPointsFromText;
  $('#edExpInp').onclick = () => download(`${s.id}.inp`, E.writeInp(ctrlRows(s)));
  $('#edExpJson').onclick = exportParamJson;
  $('#edExpRpt').onclick = () => {
    try {
      const rows = ctrlRows(s); const m = E.fit(rows, { npar: s.npar, colloc: s.colloc !== false, compat: S().compat !== false });
      const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>參數報告 ${esc(s.name)}</title><style>body{font:13px/1.55 "Microsoft JhengHei",sans-serif;margin:28px;max-width:1000px}h1{font-size:20px}h2{font-size:15px;margin:22px 0 6px;border-bottom:2px solid #1f6f5c}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #c9cec7;padding:3px 7px;text-align:right;font-family:Consolas,monospace}th{background:#eef1ed}td.l{text-align:left;font-family:inherit}.s{color:#4c5650}</style></head><body><h1>轉換參數報告：${esc(s.name)}</h1><p class="s">適用段號：${esc((s.sections || []).join('、') || '—')}　產生時間：${nowStr()}　坐標轉換工具 v${esc(VER.version)}</p>${s.note ? `<p class="s">${esc(s.note)}</p>` : ''}${modelSection(m, rows, 'TWD67', 'TWD97')}</body></html>`;
      download(`${s.id}_參數報告.html`, html, 'text/html;charset=utf-8');
    } catch (e) { toast(e.message); }
  };
  const rv = $('#edRevert'); if (rv) rv.onclick = async () => { if (await confirmDlg('還原內建版本', '將刪除你對此參數組的所有修改與版本紀錄，確定？', '還原', true)) { delete USER.sets[s.id]; saveUser(); ED.dirty = false; refreshAll(); openEditor(s.id); toast('已還原為內建版本'); } };
  const dl = $('#edDelete'); if (dl) dl.onclick = async () => { if (await confirmDlg('刪除參數組', `確定刪除「${esc(s.name)}」？此動作無法復原（建議先匯出 JSON 備份）。`, '刪除', true)) { delete USER.sets[s.id]; saveUser(); ED.dirty = false; refreshAll(); openEditor((allSets()[0] || {}).id); } };
  const hd = $('#edHide'); if (hd) hd.onclick = async () => { if (await confirmDlg('隱藏參數組', `「${esc(s.name)}」將不再顯示於清單（可於「版本與更新 → 清除自訂資料」恢復）。`, '隱藏')) { USER.hidden.push(s.id); saveUser(); ED.dirty = false; refreshAll(); openEditor((allSets()[0] || {}).id); } };
  const cb = $('#edCmpBuiltin'); if (cb) cb.onclick = () => showDiff('新內建版本', builtinSet(s.id).points, s.points, () => { s.points = clone(builtinSet(s.id).points); markDirty(); renderEditor(); });
  renderPointTable(); renderHistory(); renderSecAnalysis();
  $('#edBuf').onchange = e => { ED.buf = Math.max(0, +e.target.value || 0); renderSecAnalysis(); };
}
const DIR8 = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
// 地段細分分析：對每個候選地段，統計段內/鄰近控制點、涵蓋率、單獨解算精度，給出建議
function analyzeSections(s, buf) {
  const on = s.points.map((p, i) => ({ p, i })).filter(x => x.p.on !== false);
  const rowOf = x => ({ name: x.p.name, ip: 1, n1: +x.p.n1, e1: +x.p.e1, n2: +x.p.n2, e2: +x.p.e2, _i: x.i });
  let full = null; try { full = E.fit(on.map(rowOf), { npar: s.npar, colloc: false }); } catch (e) { /* */ }
  const vOf = new Map(full ? full.residuals.map(r => [r.p._i, Math.hypot(r.vn, r.ve)]) : []);
  // 控制點所在地段
  const where = new Map(); let outside = 0;
  on.forEach(x => { const at = secsAt(+x.p.n2, +x.p.e2); if (!at.length) outside++; new Set(at.map(f => f.no)).forEach(no => where.set(no, (where.get(no) || 0) + 1)); });
  const cand = Array.from(new Set(setSecNos(s).concat(Array.from(where.keys())))).filter(no => SECS.some(f => f.no === no));
  const rows = cand.map(no => {
    const feats = SECS.filter(f => f.no === no);
    const inside = [], near = [];
    on.forEach(x => {
      const e = +x.p.e2, n = +x.p.n2, d = Math.min(...feats.map(f => distToFeat(f, e, n)));
      if (d === 0) inside.push(x); else if (d <= buf) near.push(x);
    });
    const use = inside.concat(near);
    // 涵蓋率：段內格網取樣點落在控制點凸包內的比例；未涵蓋部分的方位
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    feats.forEach(f => { x0 = Math.min(x0, f.bbox[0]); y0 = Math.min(y0, f.bbox[1]); x1 = Math.max(x1, f.bbox[2]); y1 = Math.max(y1, f.bbox[3]); });
    const G = 28, samp = [];
    for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) { const e = x0 + (x1 - x0) * (a + .5) / G, n = y0 + (y1 - y0) * (b + .5) / G; if (feats.some(f => pipRings(f.rings, e, n))) samp.push([e, n]); }
    let cov = 0, dir = '';
    if (use.length >= 3 && samp.length) {
      const chk = E.geomChecker(use.map(x => ({ n: +x.p.n2, e: +x.p.e2, name: x.p.name })));
      const out = samp.filter(([e, n]) => !chk(n, e).inside);
      cov = 1 - out.length / samp.length;
      if (out.length) {
        const ce = samp.reduce((t, q) => t + q[0], 0) / samp.length, cn = samp.reduce((t, q) => t + q[1], 0) / samp.length;
        const oe = out.reduce((t, q) => t + q[0], 0) / out.length, on2 = out.reduce((t, q) => t + q[1], 0) / out.length;
        const ang = (Math.atan2(oe - ce, on2 - cn) * 180 / Math.PI + 360) % 360;
        dir = DIR8[Math.round(ang / 45) % 8];
      }
    }
    let sub = null; try { if (use.length >= 3) sub = E.fit(use.map(rowOf), { npar: 6, colloc: false }); } catch (e) { /* */ }
    const vs = use.map(x => vOf.get(x.i)).filter(v => v != null);
    const rmsComb = vs.length ? Math.sqrt(vs.reduce((t, v) => t + v * v, 0) / vs.length) : null;
    const sdSub = sub && sub.df > 1 ? sub.sd0 * Math.SQRT2 : null; // σ₀ 為單分量，乘 √2 與點位誤差 |v| 同尺度
    let lv, text;
    if (use.length < 3) { lv = 'bad'; text = `點數不足：至少需 4 點，還差 ${4 - use.length} 點`; }
    else if (use.length === 3) { lv = 'warn'; text = '只有 3 點，能解算但無法檢核，建議再補 1 點以上'; }
    else if (cov < 0.6) { lv = 'warn'; text = `點數夠，但控制點只涵蓋本段 ${Math.round(cov * 100)}%，建議在段的${dir}側補點`; }
    else if (sdSub != null && rmsComb != null && sdSub < rmsComb * 0.8) { lv = 'ok'; text = `建議細分：單獨解算 ±${cm(sdSub)} 公分，優於合併參數的 ±${cm(rmsComb)} 公分`; }
    else { lv = 'ok'; text = '可單獨建立；精度與合併參數相近，不一定需要細分'; }
    if (lv === 'ok' && cov < 0.85 && dir) text += `（${dir}側涵蓋較少）`;
    return { no, feats, inside, near, use, cov, dir, sub, sdSub, rmsComb, lv, text, inSet: setSecNos(s).includes(no) };
  }).sort((a, b) => (b.inSet - a.inSet) || a.no - b.no);
  return { rows, where, outside, total: on.length };
}
function renderSecAnalysis() {
  const box = $("#edSecAna"); if (!box) return;
  const s = ED.draft;
  if (!SECS.length) { box.innerHTML = '<span class="muted">此版本未內建段籍圖。</span>'; return; }
  const A = analyzeSections(s, ED.buf == null ? 300 : ED.buf);
  const chips = Array.from(A.where.entries()).sort((a, b) => b[1] - a[1]).map(([no, k]) => `<span class="chip${setSecNos(s).includes(no) ? ' acc' : ''}">${esc(secLabel(no))} ${k} 點</span>`).join(' ') + (A.outside ? ` <span class="chip">不在任何地段內 ${A.outside} 點</span>` : '');
  const ic = { ok: '✓', warn: '⚠', bad: '✕' }, cls = { ok: 'ok', warn: 'warn', bad: 'bad' };
  box.innerHTML = `<div class="small" style="margin-bottom:8px">控制點所在地段（共 ${A.total} 點；<span style="color:var(--accent)">綠色</span>＝本組適用段）：</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${chips || '<span class="muted">—</span>'}</div>
  <div class="tbl-wrap" style="max-height:none"><table class="t"><thead><tr><th>地段</th><th class="num">段內</th><th class="num">鄰近</th><th class="num">涵蓋率</th><th class="num">單獨解算</th><th class="num">合併參數</th><th>建議</th><th></th></tr></thead><tbody>` +
  A.rows.map((r, i) => `<tr><td><b>${esc(secLabel(r.no))}</b>${r.inSet ? '' : ' <span class="chip">非本組適用段</span>'}</td><td class="num">${r.inside.length}</td><td class="num">${r.near.length}</td>
    <td class="num">${r.use.length >= 3 ? Math.round(r.cov * 100) + '%' : '—'}</td><td class="num">${r.sdSub != null ? '±' + cm(r.sdSub) + ' cm' : '—'}</td><td class="num">${r.rmsComb != null ? '±' + cm(r.rmsComb) + ' cm' : '—'}</td>
    <td style="white-space:normal;min-width:220px"><span class="chip ${cls[r.lv]}">${ic[r.lv]}</span> ${esc(r.text)}</td>
    <td><button class="btn sm" data-sf="${r.no}">在圖上看</button> <button class="btn sm${r.use.length >= 3 ? '' : '" disabled title="點數不足'}" data-sn="${i}">建立此段參數組</button></td></tr>`).join('') + `</tbody></table></div>
  <p class="small muted" style="margin:10px 0 0">段內＝控制點（TWD97）位於段界內；鄰近＝段界外 ${ED.buf == null ? 300 : ED.buf} 公尺內，細分時建議一併納入以免邊緣外插。涵蓋率＝段內面積落在「段內＋鄰近」控制點凸包內的比例。單獨解算＝只用這些點做 6 參數的點位誤差（√2·σ₀）；合併參數＝同一批點在目前整組參數下的殘差均方根。</p>`;
  box.querySelectorAll('[data-sf]').forEach(b => b.onclick = () => { ED.focus = +b.dataset.sf; recalcEditor(); $('#edMap').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  box.querySelectorAll('[data-sn]').forEach(b => b.onclick = async () => {
    if (!(await leaveEditor())) return;
    const r = A.rows[+b.dataset.sn]; let id = String(r.no); if (getSet(id)) id = id + '-細分';
    if (getSet(id)) id = id + '-' + rocDate();
    openEditor(null, { id, name: `${secLabel(r.no)}`, sections: [String(r.no)], note: `由「${s.name}」細分：段內 ${r.inside.length} 點、鄰近 ${r.near.length} 點（${nowStr()}）`,
      npar: 6, colloc: true, points: clone(r.use.map(x => x.p)), history: [], samples: [], revisions: [], origin: 'user' });
    toast('已建立草稿，確認點位後請按「儲存為新版本」');
  });
}
function renderPointTable() {
  const s = ED.draft;
  const tbl = $('#edTbl');
  tbl.innerHTML = `<thead><tr><th>用</th><th>點名</th><th class="num">N67</th><th class="num">E67</th><th class="num">N97</th><th class="num">E97</th><th class="num">vN mm</th><th class="num">vE mm</th><th class="num">|v| mm</th><th></th></tr></thead><tbody>` +
    s.points.map((p, i) => `<tr data-i="${i}" class="${p.on === false ? 'off' : ''}"><td><input type="checkbox" data-k="on" ${p.on !== false ? 'checked' : ''}></td>
    <td><input type="text" class="name" data-k="name" value="${esc(p.name)}" style="width:90px"></td>
    ${['n1', 'e1', 'n2', 'e2'].map(k => `<td><input type="text" data-k="${k}" value="${fx(+p[k], 3)}" style="width:118px"></td>`).join('')}
    <td class="num" data-r="vn"></td><td class="num" data-r="ve"></td><td class="num" data-r="v"></td>
    <td><button class="btn ghost sm danger" data-del="${i}" title="刪除">✕</button></td></tr>`).join('') + '</tbody>';
  tbl.querySelectorAll('input').forEach(inp => {
    inp.onchange = () => {
      const i = +inp.closest('tr').dataset.i, k = inp.dataset.k, p = s.points[i];
      if (k === 'on') { p.on = inp.checked; inp.closest('tr').classList.toggle('off', !inp.checked); }
      else if (k === 'name') p.name = inp.value.trim().slice(0, 8);
      else { const v = parseFloat(inp.value); if (!isFinite(v)) { inp.value = fx(+p[k], 3); return; } p[k] = v; }
      markDirty(); recalcEditor();
    };
  });
  tbl.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { s.points.splice(+b.dataset.del, 1); markDirty(); renderPointTable(); });
  recalcEditor();
}
function recalcEditor() {
  const s = ED.draft, st = $('#edStats'); if (!st) return;
  const rows = $$('#edTbl tbody tr');
  rows.forEach(tr => tr.querySelectorAll('[data-r]').forEach(td => td.textContent = ''));
  try {
    const on = s.points.map((p, i) => ({ p, i })).filter(x => x.p.on !== false);
    const fitRows = on.map(x => ({ name: x.p.name, ip: 1, n1: +x.p.n1, e1: +x.p.e1, n2: +x.p.n2, e2: +x.p.e2, _i: x.i }));
    const m = E.fit(fitRows, { npar: s.npar, colloc: false, compat: S().compat !== false });
    const thr = Math.max(3 * m.sd0, 0.03);
    m.residuals.forEach(r => {
      const tr = rows[r.p._i]; if (!tr) return;
      const v = Math.hypot(r.vn, r.ve);
      tr.querySelector('[data-r=vn]').textContent = mm(r.vn); tr.querySelector('[data-r=ve]').textContent = mm(r.ve); tr.querySelector('[data-r=v]').textContent = mm(v);
      tr.classList.toggle('hl', m.df > 1 && v > thr);
    });
    const maxv = Math.max(0, ...m.residuals.map(r => Math.hypot(r.vn, r.ve)));
    const resByI = new Map(m.residuals.map(r => [r.p._i, r]));
    const mapC = s.points.map((p, i) => { const r = resByI.get(i); if (r) return { name: p.name, n: +p.n2, e: +p.e2, vn: r.vn, ve: r.ve, on: true, bad: m.df > 1 && Math.hypot(r.vn, r.ve) > thr }; return { name: p.name, n: +p.n2, e: +p.e2, on: p.on !== false }; });
    const fF = ED.focus ? SECS.filter(f => f.no === ED.focus) : [], bufM = ED.buf == null ? 300 : ED.buf;
    const focusPts = ED.focus ? mapC.filter(c => Math.min(...fF.map(f => distToFeat(f, c.e, c.n))) <= bufM) : null;
    $('#edMap').innerHTML = mapSvg({ ctrl: mapC, hi: ED.focus ? [ED.focus] : setSecNos(s), fitHi: true, focusPts }) + (ED.focus ? `<div class="small" style="margin-top:6px">正在顯示：<b>${esc(secLabel(ED.focus))}</b> <button class="btn sm" id="edFocusOff">回到整組</button></div>` : '');
    const fo = $('#edFocusOff'); if (fo) fo.onclick = () => { ED.focus = null; recalcEditor(); };
    $('#edBar').innerHTML = m.residuals.length > 1 ? `<div class="small muted" style="margin-bottom:4px">殘差大小（由大到小，紅色＝超過門檻 max(3σ₀, 30 mm)）</div>` + barSvg({ items: m.residuals.map(r => ({ name: r.name, v: Math.hypot(r.vn, r.ve) })), thr: m.df > 1 ? thr : 0 }) : '';
    st.innerHTML = `啟用 ${m.nctrl}/${s.points.length} 點 · 自由度 ${m.df} · σ₀ ${m.df > 1 ? fx(m.sd0 * 1000, 1) + ' mm' : '—'} · 最大殘差 ${mm(maxv)} mm` + (m.warnings.length ? ` <span class="chip warn">${esc(m.warnings[0])}</span>` : '');
  } catch (e) { st.innerHTML = `<span class="chip bad">${esc(e.message)}</span>`; }
}
function parsePointLines(text) {
  const pts = [];
  text.split(/\r?\n/).forEach(l => {
    const t = l.trim().split(/[\s,;\t]+/).filter(Boolean); if (t.length < 5) return;
    let name, nums;
    if (t.length >= 6 && /^\d$/.test(t[1])) { if (+t[1] >= 7) return; name = t[0]; nums = t.slice(2, 6).map(Number); }
    else { name = t[0]; nums = t.slice(1, 5).map(Number); }
    if (nums.some(v => !isFinite(v))) return;
    pts.push({ name: name.slice(0, 8), ip: 1, n1: nums[0], e1: nums[1], n2: nums[2], e2: nums[3], on: true });
  });
  return pts;
}
function addPointsFromText() {
  const s = ED.draft, pts = parsePointLines($('#edAdd').value);
  if (!pts.length) { $('#edAddInfo').textContent = '沒有可辨識的控制點（需 點名 + 4 個坐標）'; return; }
  let add = 0, upd = 0;
  pts.forEach(p => { const k = s.points.findIndex(q => q.name === p.name); if (k >= 0) { s.points[k] = Object.assign(s.points[k], p); upd++; } else { s.points.push(p); add++; } });
  $('#edAdd').value = ''; $('#edAddInfo').textContent = `新增 ${add} 點、更新 ${upd} 點（尚未儲存）`;
  markDirty(); renderPointTable();
}
async function saveDraft() {
  const s = ED.draft;
  if (!s.id) { toast('請輸入代號'); return; }
  if (ED.isNew && getSet(s.id)) { toast('代號已存在，請換一個'); return; }
  try { E.fit(ctrlRows(s), { npar: s.npar, colloc: false }); } catch (e) { if (!(await confirmDlg('參數無法解算', esc(e.message) + '<br>仍要儲存？'))) return; }
  const note = await ask('儲存為新版本', '版本說明（例：新增 HB149 等 5 點已知點）', '');
  if (note === null) return;
  const base = builtinSet(s.id);
  const prev = USER.sets[s.id];
  const revisions = (prev && prev.revisions) || [];
  revisions.push({ ts: nowStr(), note: note || '（未填說明）', points: clone(s.points) });
  USER.sets[s.id] = { id: s.id, name: s.name, sections: s.sections || [], note: s.note || '', npar: s.npar, colloc: s.colloc !== false,
    points: clone(s.points), revisions, baseHash: base ? ptsHash(base.points) : undefined, savedAt: nowStr() };
  if (saveUser()) { ED.dirty = false; toast('已儲存'); refreshAll(); openEditor(s.id); }
}
function renderHistory() {
  const s = ED.draft, box = $('#edHist');
  const items = [];
  (s.history || []).forEach(h => items.push({ label: '解算 ' + h.label, sub: h.file, points: h.points, kind: '內建歷程' }));
  if (s.origin !== 'user' && builtinSet(s.id)) items.push({ label: '內建現行版本', sub: builtinSet(s.id).file || '', points: builtinSet(s.id).points, kind: '內建' });
  (s.revisions || []).forEach(r => items.push({ label: r.ts, sub: r.note, points: r.points, kind: '自訂版本' }));
  box.innerHTML = items.length ? `<table class="t"><thead><tr><th>版本</th><th>說明</th><th class="num">點數</th><th>類型</th><th></th></tr></thead><tbody>` +
    items.slice().reverse().map((h, i) => `<tr><td>${esc(h.label)}</td><td class="small">${esc(h.sub)}</td><td class="num">${h.points.length}</td><td><span class="chip">${h.kind}</span></td>
    <td><button class="btn sm" data-h="${items.length - 1 - i}">比較</button> <button class="btn sm" data-r="${items.length - 1 - i}">載入此版本</button></td></tr>`).join('') + '</tbody></table>' : '<span class="muted">尚無版本紀錄</span>';
  if (BUILTIN.log && s.origin !== 'user') box.innerHTML += `<details style="margin-top:12px"><summary>參數建立歷程（建立歷程.txt）</summary><pre class="log">${esc(BUILTIN.log)}</pre></details>`;
  box.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { const h = items[+b.dataset.h]; showDiff(h.label, h.points, s.points, () => { s.points = clone(h.points); markDirty(); renderEditor(); }); });
  box.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => { const h = items[+b.dataset.r]; if (await confirmDlg('載入版本', `以「${esc(h.label)}」的 ${h.points.length} 點取代目前控制點？（載入後需按「儲存為新版本」才會生效）`, '載入')) { s.points = clone(h.points); markDirty(); renderEditor(); } });
}
function diffPoints(a, b) { // a: 舊, b: 目前
  const A = new Map(a.map(p => [p.name, p])), B = new Map(b.map(p => [p.name, p]));
  const added = b.filter(p => !A.has(p.name)), removed = a.filter(p => !B.has(p.name)), changed = [], toggled = [];
  b.forEach(p => { const q = A.get(p.name); if (!q) return; const d = Math.max(...['n1', 'e1', 'n2', 'e2'].map(k => Math.abs(+p[k] - +q[k]))); if (d > 0.0005) changed.push({ p, q, d }); else if ((p.on !== false) !== (q.on !== false)) toggled.push(p); });
  return { added, removed, changed, toggled };
}
function showDiff(label, oldPts, curPts, onLoad) {
  const d = diffPoints(oldPts, curPts);
  const li = (arr, f) => arr.length ? '<ul>' + arr.map(f).join('') + '</ul>' : '<p class="muted small">無</p>';
  const body = `<p class="small muted">「${esc(label)}」（${oldPts.length} 點）→ 目前編輯中（${curPts.length} 點）</p>
    <h4>目前新增（${d.added.length}）</h4>${li(d.added, p => `<li class="mono">${esc(p.name)}</li>`)}
    <h4>目前缺少（${d.removed.length}）</h4>${li(d.removed, p => `<li class="mono">${esc(p.name)}</li>`)}
    <h4>坐標不同（${d.changed.length}）</h4>${li(d.changed, x => `<li class="mono">${esc(x.p.name)}：最大差 ${mm(x.d)} mm</li>`)}
    <h4>啟用狀態不同（${d.toggled.length}）</h4>${li(d.toggled, p => `<li class="mono">${esc(p.name)}：目前${p.on !== false ? '啟用' : '停用'}</li>`)}`;
  dlg('版本比較', body, [{ label: '關閉' }, { label: '載入該版本', pri: true, onClick: () => { onLoad(); } }]);
}
function exportParamJson() {
  const s = ED.draft;
  let model = null;
  try {
    const m = E.fit(ctrlRows(s), { npar: s.npar, colloc: s.colloc !== false, compat: S().compat !== false });
    model = { npar: m.npar, origin: { n: m.nc0, e: m.ec0 }, coefficients: m.X, sigma: m.sig, sd0: m.sd0, df: m.df,
      formula: m.npar === 4 ? 'N=X0*dN+X1*dE+X2+N0; E=-X1*dN+X0*dE+X3+E0' : 'N=X0*dN+X1*dE+X2+N0; E=X3*dN+X4*dE+X5+E0',
      collocation: m.colloc ? { covariance: 'C(d)=c*(1-d/a), d<=a, d in km', refs: m.colloc.refs.map(r => ({ name: r.name, n: r.x, e: r.y })),
        n: { c: m.colloc.n.c, a: m.colloc.n.a, mean: m.colloc.n.ave, weights: m.colloc.n.w }, e: { c: m.colloc.e.c, a: m.colloc.e.a, mean: m.colloc.e.ave, weights: m.colloc.e.w },
        note: 'correction(P) = mean + Σ C(dist(P,ref_j)) * weight_j，P 為轉換後坐標' } : null };
  } catch (e) { /* 無法解算仍可匯出點位 */ }
  const out = { format: 'coord-transfer-params', formatVersion: 1, exported: nowStr(), appVersion: VER.version,
    set: { id: s.id, name: s.name, sections: s.sections || [], note: s.note || '', npar: s.npar, colloc: s.colloc !== false },
    points: s.points.map(p => ({ name: p.name, ip: p.ip, n67: +p.n1, e67: +p.e1, n97: +p.n2, e97: +p.e2, enabled: p.on !== false })),
    revisions: s.revisions || [], model };
  download(`${s.id}_參數.json`, JSON.stringify(out, null, 2), 'application/json');
}
async function importSetFiles(files) {
  for (const f of files) {
    const text = await readFileText(f);
    let set = null;
    if (/\.json$/i.test(f.name)) {
      try {
        const j = JSON.parse(text);
        if (j.format === 'coord-transfer-params') {
          set = Object.assign({}, j.set, { points: j.points.map(p => ({ name: p.name, ip: p.ip || 1, n1: p.n67, e1: p.e67, n2: p.n97, e2: p.e97, on: p.enabled !== false })), revisions: j.revisions || [] });
        } else if (j.format === 'coord-transfer-backup') { await restoreBackup(j); continue; }
      } catch (e) { toast(f.name + '：JSON 格式錯誤'); continue; }
    } else {
      const rows = E.parseInp(text).filter(r => r.ip < 7);
      if (!rows.length) { toast(f.name + '：找不到控制點'); continue; }
      const id = f.name.replace(/\.[^.]+$/, '');
      set = { id, name: id + ' 段', sections: [id], note: `由 ${f.name} 匯入`, npar: rows.length >= 3 ? 6 : 4, colloc: true, points: rows.map(r => ({ name: r.name, ip: r.ip, n1: r.n1, e1: r.e1, n2: r.n2, e2: r.e2, on: true })), revisions: [] };
    }
    if (!set) { toast(f.name + '：無法辨識'); continue; }
    const exist = getSet(set.id);
    if (exist) {
      const choice = await dlg('參數組已存在', `「${esc(set.id)}」已存在（${esc(exist.name)}）。要以匯入的 ${set.points.length} 點<b>取代</b>其控制點，或<b>另存為新參數組</b>？`,
        [{ label: '取消', value: 'cancel' }, { label: '另存新組', value: 'new' }, { label: '載入到現有參數組', pri: true, value: 'replace' }]);
      if (choice === 'cancel' || choice === null) continue;
      if (choice === 'new') { set.id = set.id + '-' + rocDate(); openEditor(null, Object.assign({ origin: 'user', history: [], samples: [] }, set)); }
      else { const d = clone(exist); d.points = set.points; if (set.name) d.name = set.name; openEditor(null, d); ED.isNew = false; }
      toast('已載入編輯器，確認後請按「儲存為新版本」');
    } else {
      openEditor(null, Object.assign({ origin: 'user', history: [], samples: [] }, set));
      toast('已載入編輯器，確認後請按「儲存為新版本」');
    }
  }
}
function bindParamsPage() {
  $('#setSearch').oninput = renderSetList;
  $('#btnNewSet').onclick = async () => {
    if (!(await leaveEditor())) return;
    const id = await ask('新參數組', '代號（建議用段號，例：392）', ''); if (!id) return;
    if (getSet(id)) { toast('代號已存在'); return; }
    openEditor(null, { id, name: id + ' 段', sections: [id], note: '', npar: 6, colloc: true, points: [], history: [], samples: [], revisions: [], origin: 'user' });
  };
  $('#btnImportSet').onclick = () => $('#importSetFile').click();
  $('#importSetFile').onchange = async e => { const fs = Array.from(e.target.files); e.target.value = ''; if (await leaveEditor()) importSetFiles(fs); };
}

/* ---------------- 版本與更新 ---------------- */
function renderAbout() {
  const userCount = Object.keys(USER.sets).length;
  $('#aboutInfo').innerHTML = `<div class="kv"><div>程式版本</div><div><b>v${esc(VER.version)}</b>（${esc(VER.date)}）</div>
    <div>內建參數庫</div><div>${BUILTIN.sets.length} 組，${BUILTIN.sets.reduce((s, x) => s + x.points.length, 0)} 個控制點（${esc(BUILTIN.built || '')}，#${esc(BUILTIN.hash || '')}）</div>
    <div>自訂/修改</div><div>${userCount} 組${USER.hidden.length ? `，隱藏 ${USER.hidden.length} 組` : ''}</div>
    <div>檔案位置</div><div class="small mono" style="word-break:break-all">${esc(decodeURIComponent(location.href))}</div>
    <div>演算法</div><div class="small">國土測繪中心 TRANSFN1（成大測量系 1993/2001）6/4 參數 + 最小二乘配置，逐步移植並與 t.exe 輸出逐字比對</div></div>`;
  $('#changelog').innerHTML = (VER.changelog || []).map(c => `<h4>v${esc(c.version)} <span class="muted small">${esc(c.date)}</span></h4><ul>${c.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('');
  $('#updUrl').value = updUrl(); $('#updUrl').placeholder = VER.updateUrl || 'https://…/latest.json'; $('#updAuto').checked = !!S().updAuto;
  $('#optCompat').checked = S().compat !== false; $('#optDec').value = String(S().dec || 3); $('#optFar').value = S().far; $('#optTheme').value = S().theme || '';
  let size = 0; try { size = (localStorage.getItem(LS_KEY) || '').length; } catch (e) { /* */ }
  $('#storageInfo').textContent = `自訂資料約 ${(size / 1024).toFixed(1)} KB，存於此瀏覽器（${location.protocol === 'file:' ? '本機檔案' : location.host}）。換電腦或換瀏覽器前請先匯出備份。`;
}
async function checkUpdate(manual) {
  const url = updUrl(), st = $('#updStatus');
  if (!url) { if (manual) st.innerHTML = '<div class="note warn">請先填入更新來源網址。</div>'; return; }
  if (manual) st.innerHTML = '<div class="note">檢查中…</div>';
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    S().lastCheck = Date.now(); saveUser();
    if (cmpVer(j.version, VER.version) > 0) {
      $('#updBadge').style.display = 'inline-block'; $('#updBadge').textContent = `有新版本 v${j.version}`;
      st.innerHTML = `<div class="note ok"><b>有新版本 v${esc(j.version)}</b>（${esc(j.date || '')}）<ul style="margin:6px 0">${(j.notes || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul><button class="btn pri sm" id="btnDoUpd">下載並更新</button></div>`;
      $('#btnDoUpd').onclick = () => doUpdate(j, url);
      showSimpleUpdate(j, url);
    } else if (manual) st.innerHTML = `<div class="note ok">已是最新版本（v${esc(VER.version)}）。</div>`;
  } catch (e) { if (manual) st.innerHTML = `<div class="note bad">檢查失敗：${esc(e.message)}。請確認網址可連線且允許跨來源存取（CORS）。</div>`; }
}
async function doUpdate(j, manifestUrl) {
  try {
    const u = new URL(j.url || j.file, manifestUrl).href;
    const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    await installHtml(html);
  } catch (e) { toast('更新失敗：' + e.message, 6000); }
}
function htmlVersion(html) { const m = /<meta name="app-version" content="([^"]+)"/.exec(html); return m ? m[1] : null; }
async function installHtml(html) {
  if (!/data-app="coord-transfer"/.test(html)) { toast('這不是坐標轉換工具的檔案'); return; }
  const v = htmlVersion(html) || '?';
  const newer = cmpVer(v, VER.version);
  if (newer <= 0 && !(await confirmDlg('版本確認', `檔案版本 v${esc(v)} ${newer === 0 ? '與目前相同' : '比目前舊'}（目前 v${esc(VER.version)}），仍要安裝？`))) return;
  const r = await saveHtml(html, { overwrite: true });
  if (r === 'written') { toast('更新完成，重新載入中…'); setTimeout(() => location.reload(), 800); }
  else if (r === 'downloaded') dlg('已下載新版', `<p>新版 v${esc(v)} 已下載。請用它取代目前的檔案：</p><p class="mono small">${esc(decodeURIComponent(location.pathname.replace(/^\//, '')))}</p><p class="muted small">你的自訂參數存在瀏覽器中，取代檔案後仍會保留（請放在同一台電腦、用同一個瀏覽器開啟）。</p>`);
}
function mergedLibrary() {
  const sets = allSets().map(s => {
    const hist = (s.history || []).map(h => ({ label: h.label, file: h.file, points: h.points.map(p => [p.name, p.ip, +p.n1, +p.e1, +p.n2, +p.e2]) }));
    const b0 = s.origin === 'modified' ? builtinSet(s.id) : null;
    if (b0) hist.push({ label: '修改前內建版本（' + (BUILTIN.built || '') + '）', file: b0.file || '', points: b0.points.map(p => [p.name, p.ip, +p.n1, +p.e1, +p.n2, +p.e2]) });
    (s.revisions || []).forEach(r => hist.push({ label: r.ts + ' ' + r.note, file: '', points: r.points.filter(p => p.on !== false).map(p => [p.name, p.ip, +p.n1, +p.e1, +p.n2, +p.e2]) }));
    return { id: s.id, name: s.name, sections: s.sections || [], note: s.note || '', file: s.file || '', npar: s.npar, colloc: s.colloc !== false,
      points: s.points.filter(p => p.on !== false).map(p => [p.name, p.ip, +p.n1, +p.e1, +p.n2, +p.e2]),
      samples: (s.samples || []).map(x => [x.name, 8, x.n, x.e]), history: hist };
  });
  const lib = { sets, log: BUILTIN.log || '', bounds: BUILTIN.bounds || [] };
  lib.hash = fnv(JSON.stringify(lib)); lib.built = new Date().toISOString().slice(0, 10);
  return lib;
}
async function bakeHtml() {
  const lib = mergedLibrary();
  const json = JSON.stringify(lib).replace(/<\//g, '<\\/');
  const re = /(<script type="application\/json" id="lib-data">)[\s\S]*?(<\/script>)/;
  if (!re.test(SELF_HTML)) { toast('無法定位參數庫區塊'); return; }
  const html = SELF_HTML.replace(re, (_, a, b) => a + json + b);
  const choice = await dlg('產生含目前參數庫的 HTML', `<p>將把 ${lib.sets.length} 組參數（含你的修改；停用的控制點不會帶入）寫入新的 HTML。</p><p class="small muted">「覆寫本檔」後，本機的自訂修改會變成內建參數；「下載新檔」適合分享給同事。</p>`,
    [{ label: '取消', value: null }, { label: '下載新檔', value: 'dl' }, { label: '覆寫本檔', pri: true, value: 'self' }]);
  if (!choice) return;
  if (choice === 'dl') { download(`坐標轉換工具_參數${rocDate()}.html`, html, 'text/html;charset=utf-8'); return; }
  const r = await saveHtml(html, { overwrite: true });
  if (r === 'written') { USER.sets = {}; USER.hidden = []; saveUser(); toast('已寫入，重新載入中…'); setTimeout(() => location.reload(), 800); }
}
function backupObj() { return { format: 'coord-transfer-backup', exported: nowStr(), appVersion: VER.version, user: USER }; }
async function restoreBackup(j) {
  if (!j || j.format !== 'coord-transfer-backup' || !j.user) { toast('不是有效的備份檔'); return; }
  const n = Object.keys(j.user.sets || {}).length;
  const ch = await dlg('匯入備份', `備份時間 ${esc(j.exported)}，含 ${n} 組自訂參數。`, [{ label: '取消', value: null }, { label: '合併', value: 'merge' }, { label: '完全取代', pri: true, value: 'replace' }]);
  if (!ch) return;
  if (ch === 'replace') USER = Object.assign(loadUser(), j.user);
  else { Object.assign(USER.sets, j.user.sets || {}); USER.hidden = Array.from(new Set(USER.hidden.concat(j.user.hidden || []))); }
  saveUser(); refreshAll(); toast('已匯入備份');
}
function applyTheme() { const t = S().theme; if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
function bindAboutPage() {
  $('#updUrl').onchange = e => { S().updUrl = e.target.value.trim(); saveUser(); };
  $('#updAuto').onchange = e => { S().updAuto = e.target.checked; saveUser(); };
  $('#btnCheckUpd').onclick = () => { S().updUrl = $('#updUrl').value.trim(); saveUser(); checkUpdate(true); };
  $('#btnUpdFile').onclick = () => $('#updFile').click();
  $('#updFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) installHtml(await f.text()); };
  $('#btnBakeHtml').onclick = bakeHtml;
  $('#btnBackup').onclick = () => download(`坐標轉換工具_備份_${rocDate()}.json`, JSON.stringify(backupObj(), null, 1), 'application/json');
  $('#btnRestore').onclick = () => $('#restoreFile').click();
  $('#restoreFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { restoreBackup(JSON.parse(await f.text())); } catch (x) { toast('備份檔格式錯誤'); } };
  $('#btnClearUser').onclick = async () => { if (await confirmDlg('清除自訂資料', '將刪除所有自訂/修改的參數組與隱藏設定（計算設定保留）。建議先匯出備份。確定？', '清除', true)) { USER.sets = {}; USER.hidden = []; saveUser(); refreshAll(); toast('已清除'); } };
  $('#optCompat').onchange = e => { S().compat = e.target.checked; saveUser(); refreshTransHeader(); };
  $('#optDec').onchange = e => { S().dec = +e.target.value; saveUser(); if (LAST) renderResult(LAST); };
  $('#optFar').onchange = e => { S().far = +e.target.value || 0; saveUser(); };
  $('#optTheme').onchange = e => { S().theme = e.target.value; saveUser(); applyTheme(); };
  $('#updBadge').onclick = () => showPage('pgAbout');
}

/* ---------------- 段籍圖（KC02 苑裡、KC03 通霄；TWD97，內嵌於參數庫） ---------------- */
const SECS = (BUILTIN.bounds || []).map(f => {
  const rings = f.rings.map(fl => { const r = []; let x = fl[0], y = fl[1]; r.push([x, y]); for (let i = 2; i < fl.length; i += 2) { x += fl[i]; y += fl[i + 1]; r.push([x, y]); } return r; });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  rings.forEach(r => r.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
  return { no: +f.no, code: f.no, ext: f.ext, name: f.name, town: f.town, lab: f.lab, area: f.area, rings, bbox: [x0, y0, x1, y1] };
});
const secName = no => { const f = SECS.find(x => x.no === +no); return f ? f.name : ''; };
const secLabel = no => `${+no} ${secName(no)}`.trim();
const setSecNos = set => (set && set.sections || []).map(Number).filter(isFinite);
function pipRings(rings, e, n) {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > n) !== (yj > n) && e < (xj - xi) * (n - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function secsAt(n, e) { return SECS.filter(f => e >= f.bbox[0] && e <= f.bbox[2] && n >= f.bbox[1] && n <= f.bbox[3] && pipRings(f.rings, e, n)); }
function distToFeat(f, e, n) {
  if (pipRings(f.rings, e, n)) return 0;
  let best = Infinity;
  f.rings.forEach(r => { for (let i = 1; i < r.length; i++) {
    const [ax, ay] = r[i - 1], [bx, by] = r[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(e - ax - t * dx, n - ay - t * dy));
  } });
  return best;
}
// 依 TWD97 坐標找出點所在段號，並檢查是否在所選參數組的適用段內
function secCheck(set, n97, e97) {
  const at = secsAt(n97, e97), nos = setSecNos(set);
  const inSet = !nos.length || !at.length || at.some(f => nos.includes(f.no));
  let alt = null;
  if (!inSet) alt = allSets().find(x => setSecNos(x).some(no => at.some(f => f.no === no)) && x.id !== set.id) || null;
  return { at, inSet, alt };
}

/* ---------------- 視覺化（點位分布圖、殘差長條圖） ---------------- */
// 色彩：類別色 1（藍）＝已知控制點、類別色 2（橙）＝待轉換點；已用 dataviz 驗證器於淺/深色底檢核通過
const VIZ_LIGHT = { c1: '#2a78d6', c2: '#eb6834', ink: '#1d2320', ink2: '#4c5650', ink3: '#7b857f', grid: '#dde1dc', surf: '#ffffff', bad: '#d03b3b' };
const VIZ_CSS = { c1: 'var(--viz-c1)', c2: 'var(--viz-c2)', ink: 'var(--ink)', ink2: 'var(--ink2)', ink3: 'var(--ink3)', grid: 'var(--line)', surf: 'var(--panel)', bad: 'var(--viz-bad)' };
const niceNum = x => { if (!(x > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; };
const cm = v => (v * 100).toFixed(1);

/** 點位分布圖：ctrl [{name,n,e,vn,ve,on}]、targets [{name,n,e,extrap}] */
function mapSvg({ ctrl = [], targets = [], W, P = VIZ_CSS, big = false, targetLabel = '待轉換點', hi = [], fitHi = false, focusPts = null }) {
  W = W || (big ? 720 : 900);
  const all = ctrl.concat(targets).filter(p => isFinite(p.n) && isFinite(p.e));
  if (!all.length) return '';
  const fs = big ? 15 : 12;
  let nmin = Infinity, nmax = -Infinity, emin = Infinity, emax = -Infinity;
  const hiSet = new Set(hi.map(Number)), hiF = SECS.filter(f => hiSet.has(f.no));
  (focusPts || all).forEach(p => { nmin = Math.min(nmin, p.n); nmax = Math.max(nmax, p.n); emin = Math.min(emin, p.e); emax = Math.max(emax, p.e); });
  if (fitHi) hiF.forEach(f => { emin = Math.min(emin, f.bbox[0]); emax = Math.max(emax, f.bbox[2]); nmin = Math.min(nmin, f.bbox[1]); nmax = Math.max(nmax, f.bbox[3]); });
  const dx = Math.max(emax - emin, 60) * 1.16, dy = Math.max(nmax - nmin, 60) * 1.16;
  const ec = (emin + emax) / 2, nc = (nmin + nmax) / 2;
  const legH = big ? 44 : 36, padB = big ? 40 : 34, plotW = W - 24;
  const plotH = Math.max(big ? 300 : 260, Math.min(big ? 620 : 520, plotW * dy / dx));
  const s = Math.min(plotW / dx, plotH / dy), H = legH + plotH + padB;
  const X = e => 12 + plotW / 2 + (e - ec) * s, Y = n => legH + plotH / 2 - (n - nc) * s;
  const o = [];
  o.push(`<svg viewBox="0 0 ${W} ${H.toFixed(0)}" width="100%" style="max-width:${W}px;display:block;font-family:inherit" role="img" aria-label="點位分布圖">`);
  o.push(`<rect x="12" y="${legH}" width="${plotW}" height="${plotH.toFixed(1)}" fill="none" stroke="${P.grid}" stroke-width="1"/>`);
  // 地段界（段籍圖）：所選參數組的適用段以淡灰底強調
  let secVis = [];
  const cid = 'clp' + Math.random().toString(36).slice(2, 9);
  o.push(`<defs><clipPath id="${cid}"><rect x="12" y="${legH}" width="${plotW}" height="${plotH.toFixed(1)}"/></clipPath></defs><g clip-path="url(#${cid})">`);
  if (SECS.length) {
    const vx0 = ec - plotW / 2 / s, vx1 = ec + plotW / 2 / s, vy0 = nc - plotH / 2 / s, vy1 = nc + plotH / 2 / s;
    secVis = SECS.filter(f => f.bbox[2] >= vx0 && f.bbox[0] <= vx1 && f.bbox[3] >= vy0 && f.bbox[1] <= vy1);
    const pathOf = f => f.rings.map(r => { let d = '', lx = null, ly = null; r.forEach(([e, n], i) => { const x = X(e), y = Y(n); if (i && i < r.length - 1 && Math.abs(x - lx) + Math.abs(y - ly) < 0.8) return; d += (d ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1); lx = x; ly = y; }); return d + 'Z'; }).join('');
    secVis.slice().sort((a, b) => hiSet.has(a.no) - hiSet.has(b.no)).forEach(f => {
      const h1 = hiSet.has(f.no);
      o.push(`<path d="${pathOf(f)}" fill="${h1 ? P.ink3 : 'none'}" fill-opacity="${h1 ? 0.12 : 0}" fill-rule="evenodd" stroke="${h1 ? P.ink2 : P.ink3}" stroke-opacity="${h1 ? 0.9 : 0.55}" stroke-width="${h1 ? 1.6 : 0.8}" stroke-linejoin="round"><title>${f.no} ${esc(f.name)}${f.ext !== 'Z' ? '（' + esc(f.ext) + '）' : ''}</title></path>`);
    });
    const byNo = new Map();
    secVis.forEach(f => { const b = byNo.get(f.no); if (!b || f.area > b.area) byNo.set(f.no, f); });
    byNo.forEach(f => {
      const x = X(f.lab[0]), y = Y(f.lab[1]), px = f.area * s * s, h1 = hiSet.has(f.no);
      if (x < 30 || x > W - 30 || y < legH + 12 || y > legH + plotH - 8 || (px < 1800 && !h1)) return;
      const halo = `stroke="${P.surf}" stroke-width="3" paint-order="stroke" stroke-linejoin="round"`;
      o.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${fs + (h1 ? 1 : 0)}" font-weight="700" text-anchor="middle" fill="${h1 ? P.ink : P.ink3}" ${halo}>${f.no}</text>`);
      if (px > 6000 || h1) o.push(`<text x="${x.toFixed(1)}" y="${(y + fs + 1).toFixed(1)}" font-size="${fs - 2}" text-anchor="middle" fill="${h1 ? P.ink2 : P.ink3}" ${halo}>${esc(f.name)}</text>`);
    });
  }
  // 控制範圍（凸包）
  const on = ctrl.filter(c => c.on !== false);
  if (on.length >= 3) {
    const h = E.hull(on);
    o.push(`<polygon points="${h.map(q => X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join(' ')}" fill="${P.c1}" fill-opacity="0.08" stroke="${P.c1}" stroke-opacity="0.45" stroke-width="1"><title>已知控制點涵蓋範圍：範圍內的點轉換最可靠</title></polygon>`);
  }
  // 殘差箭頭
  const vs = on.filter(c => isFinite(c.vn)).map(c => Math.hypot(c.vn, c.ve));
  const maxv = vs.length ? Math.max(...vs) : 0;
  let k = 0;
  if (maxv > 0) k = niceNum((0.09 * Math.min(plotW, plotH)) / (maxv * s));
  const arrow = (x1, y1, x2, y2, col, w = 1.6) => {
    const a = Math.atan2(y2 - y1, x2 - x1), L = Math.hypot(x2 - x1, y2 - y1), hl = Math.min(7, L * 0.45);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>` +
      (L > 3 ? `<path d="M${x2.toFixed(1)},${y2.toFixed(1)} L${(x2 - hl * Math.cos(a - 0.45)).toFixed(1)},${(y2 - hl * Math.sin(a - 0.45)).toFixed(1)} M${x2.toFixed(1)},${y2.toFixed(1)} L${(x2 - hl * Math.cos(a + 0.45)).toFixed(1)},${(y2 - hl * Math.sin(a + 0.45)).toFixed(1)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" fill="none"/>` : '');
  };
  if (k) on.forEach(c => { if (!isFinite(c.vn)) return; const x = X(c.e), y = Y(c.n); o.push(arrow(x, y, x + c.ve * k * s, y - c.vn * k * s, P.ink2)); });
  // 待轉換點
  const many = targets.length > 400, r = many ? 2.2 : big ? 6 : 4.5;
  targets.forEach(t => {
    const x = X(t.e).toFixed(1), y = Y(t.n).toFixed(1), tt = `<title>${esc(t.name)}${t.extrap ? '（範圍外）' : ''}\nN ${fx(t.n, 3)}　E ${fx(t.e, 3)}</title>`;
    o.push(t.extrap ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${P.surf}" stroke="${P.c2}" stroke-width="${many ? 1.2 : 2}">${tt}</circle>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="${P.c2}"${many ? '' : ` stroke="${P.surf}" stroke-width="2"`}>${tt}</circle>`);
  });
  // 已知控制點（三角形）
  const tri = (x, y, sz) => `M${x.toFixed(1)},${(y - sz).toFixed(1)} L${(x + sz * 0.9).toFixed(1)},${(y + sz * 0.6).toFixed(1)} L${(x - sz * 0.9).toFixed(1)},${(y + sz * 0.6).toFixed(1)}Z`;
  const tsz = big ? 9 : 7;
  ctrl.forEach(c => {
    const x = X(c.e), y = Y(c.n), off = c.on === false;
    const tt = `<title>已知點 ${esc(c.name)}${off ? '（不使用）' : ''}${isFinite(c.vn) ? `\n殘差 ${mm(Math.hypot(c.vn, c.ve))} mm（N ${mm(c.vn)}、E ${mm(c.ve)}）` : ''}</title>`;
    o.push(`<path d="${tri(x, y, c.bad ? tsz + 2 : tsz)}" fill="${off ? P.surf : c.bad ? P.bad : P.c1}" stroke="${off ? (c.bad ? P.bad : P.ink3) : P.surf}" stroke-width="${off ? 1.5 : 2}" stroke-linejoin="round">${tt}</path>`);
  });
  const labCtrl = ctrl.length <= (big ? 24 : 32), labT = targets.length <= 12;
  ctrl.forEach(c => { if (c.bad) o.push(`<text x="${(X(c.e) + tsz + 4).toFixed(1)}" y="${(Y(c.n) + fs * 0.35).toFixed(1)}" font-size="${fs + 1}" font-weight="700" fill="${P.ink}">⚠ ${esc(c.name)}</text>`); });
  if (labCtrl) ctrl.filter(c => !c.bad).forEach(c => o.push(`<text x="${(X(c.e) + tsz + 2).toFixed(1)}" y="${(Y(c.n) - 3).toFixed(1)}" font-size="${fs - 1}" fill="${c.on === false ? P.ink3 : P.ink2}">${esc(c.name)}</text>`));
  if (labT) targets.forEach(t => o.push(`<text x="${(X(t.e) + r + 4).toFixed(1)}" y="${(Y(t.n) + fs * 0.35 + 6).toFixed(1)}" font-size="${fs}" font-weight="700" fill="${P.ink}">${esc(t.name)}</text>`));
  o.push('</g>'); // 結束繪圖區裁切
  // 圖例（上方一列）
  let lx = 14; const ly = legH / 2 + 1;
  const leg = (sw, label) => { o.push(sw(lx, ly)); o.push(`<text x="${lx + 16}" y="${ly + fs * 0.35}" font-size="${fs}" fill="${P.ink2}">${label}</text>`); lx += 16 + label.length * fs * 0.98 + 18; };
  if (ctrl.length) leg((x, y) => `<path d="${tri(x + 6, y + 1, 6)}" fill="${P.c1}"/>`, '已知控制點');
  if (targets.length) leg((x, y) => `<circle cx="${x + 6}" cy="${y}" r="5" fill="${P.c2}"/>`, targetLabel);
  if (ctrl.some(c => c.bad)) leg((x, y) => `<path d="${tri(x + 6, y + 1, 6)}" fill="${P.bad}"/>`, '⚠ 偏差較大');
  if (targets.some(t => t.extrap)) leg((x, y) => `<circle cx="${x + 6}" cy="${y}" r="5" fill="${P.surf}" stroke="${P.c2}" stroke-width="2"/>`, '範圍外（誤差可能較大）');
  if (on.length >= 3) leg((x, y) => `<rect x="${x}" y="${y - 6}" width="13" height="12" rx="2" fill="${P.c1}" fill-opacity="0.12" stroke="${P.c1}" stroke-opacity="0.5"/>`, '控制範圍');
  if (secVis.some(f => hiSet.has(f.no))) leg((x, y) => `<rect x="${x}" y="${y - 6}" width="13" height="12" rx="2" fill="${P.ink3}" fill-opacity="0.18" stroke="${P.ink2}" stroke-width="1.4"/>`, '適用地段');
  else if (secVis.length) leg((x, y) => `<rect x="${x}" y="${y - 6}" width="13" height="12" rx="2" fill="none" stroke="${P.ink3}"/>`, '地段界');
  // 比例尺、指北、殘差尺
  const sb = niceNum(dx / 5), sbPx = sb * s, by = legH + plotH + padB * 0.55;
  o.push(`<line x1="14" y1="${by}" x2="${(14 + sbPx).toFixed(1)}" y2="${by}" stroke="${P.ink2}" stroke-width="2"/><line x1="14" y1="${by - 4}" x2="14" y2="${by + 4}" stroke="${P.ink2}" stroke-width="2"/><line x1="${(14 + sbPx).toFixed(1)}" y1="${by - 4}" x2="${(14 + sbPx).toFixed(1)}" y2="${by + 4}" stroke="${P.ink2}" stroke-width="2"/>`);
  o.push(`<text x="${(20 + sbPx).toFixed(1)}" y="${by + fs * 0.35}" font-size="${fs}" fill="${P.ink2}">${sb >= 1000 ? sb / 1000 + ' 公里' : sb + ' 公尺'}</text>`);
  const nx = W - 30, ny = legH + 14;
  o.push(`<path d="M${nx},${ny} l6,16 l-6,-4 l-6,4z" fill="${P.ink2}"/><text x="${nx}" y="${ny + 30}" font-size="${fs}" text-anchor="middle" fill="${P.ink2}" font-weight="700">N</text>`);
  if (k) {
    const refM = niceNum(maxv * 0.6), refPx = refM * k * s, ax = W - 24 - refPx - 210, ay = by;
    o.push(arrow(ax, ay, ax + refPx, ay, P.ink2));
    o.push(`<text x="${(ax + refPx + 8).toFixed(1)}" y="${ay + fs * 0.35}" font-size="${fs}" fill="${P.ink2}">殘差 ${refM * 1000 >= 10 ? (refM * 100).toFixed(0) + ' 公分' : (refM * 1000).toFixed(0) + ' mm'}（箭頭放大 ${k.toLocaleString()} 倍）</text>`);
  }
  o.push('</svg>');
  return o.join('');
}
/** 殘差長條圖：items [{name, v(m)}]，thr 門檻(m) */
function barSvg({ items, thr, W = 900, P = VIZ_CSS, big = false }) {
  if (!items.length) return '';
  const fs = big ? 15 : 12, rowH = big ? 30 : 22, bh = big ? 16 : 12, lw = big ? 110 : 90, top = 24;
  const list = items.slice().sort((a, b) => b.v - a.v);
  const vmax = Math.max(thr || 0, ...list.map(i => i.v)) * 1.12 || 0.01;
  const x0 = lw, x1 = W - 60, sx = v => x0 + (v / vmax) * (x1 - x0), H = top + list.length * rowH + 26;
  const o = [`<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block;font-family:inherit" role="img" aria-label="控制點殘差長條圖">`];
  const step = niceNum(vmax / 5);
  for (let t = 0; t <= vmax + 1e-12; t += step) {
    o.push(`<line x1="${sx(t).toFixed(1)}" y1="${top - 4}" x2="${sx(t).toFixed(1)}" y2="${H - 22}" stroke="${P.grid}" stroke-width="1"/><text x="${sx(t).toFixed(1)}" y="${H - 6}" font-size="${fs - 1}" text-anchor="middle" fill="${P.ink3}">${(t * 1000).toFixed(0)}</text>`);
  }
  o.push(`<text x="${x1 + 8}" y="${H - 6}" font-size="${fs - 1}" fill="${P.ink3}">mm</text>`);
  const labelSet = new Set(list.slice(0, 3).map(i => i.name));
  list.forEach((it, i) => {
    const y = top + i * rowH + (rowH - bh) / 2, w = Math.max(1, sx(it.v) - x0), flag = thr && it.v > thr;
    if (flag) labelSet.add(it.name);
    const rr = Math.min(4, w / 2);
    o.push(`<path d="M${x0},${y} h${(w - rr).toFixed(1)} a${rr},${rr} 0 0 1 ${rr},${rr} v${bh - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${(w - rr).toFixed(1)}z" fill="${flag ? P.bad : P.c1}"><title>${esc(it.name)}：${mm(it.v)} mm${flag ? '（超過門檻）' : ''}</title></path>`);
    o.push(`<text x="${x0 - 8}" y="${y + bh / 2 + fs * 0.35}" font-size="${fs}" text-anchor="end" fill="${P.ink}">${flag ? '⚠ ' : ''}${esc(it.name)}</text>`);
    if (labelSet.has(it.name)) o.push(`<text x="${(x0 + w + 6).toFixed(1)}" y="${y + bh / 2 + fs * 0.35}" font-size="${fs - 1}" fill="${P.ink2}">${mm(it.v)}</text>`);
  });
  if (thr) { const tx = sx(thr).toFixed(1); o.push(`<line x1="${tx}" y1="${top - 6}" x2="${tx}" y2="${H - 22}" stroke="${P.ink2}" stroke-width="1.5"/><text x="${tx}" y="${top - 10}" font-size="${fs - 1}" text-anchor="middle" fill="${P.ink2}">門檻 ${mm(thr)} mm</text>`); }
  o.push('</svg>');
  return o.join('');
}
const residThr = m => Math.max(3 * (m.sd0 || 0), 0.03);
// 所有分布圖一律以 TWD97 繪製（與段籍圖同一坐標系）
function resultMapData(res) {
  const sw = res.ctx.dir === 'rev' && !res.run.iter, fwd = res.ctx.dir === 'fwd';
  const ctrl = res.model.residuals.map(r => ({ name: r.name, n: sw ? r.p.n1 : r.p.n2, e: sw ? r.p.e1 : r.p.e2, vn: r.vn, ve: r.ve }));
  return { ctrl, targets: res.items.map(it => ({ name: it.name, n: fwd ? it.n : it.inN, e: fwd ? it.e : it.inE, extrap: it.extrap })), hi: setSecNos(res.ctx.set) };
}
const pt97 = (res, it) => res.ctx.dir === 'fwd' ? { n: it.n, e: it.e } : { n: it.inN, e: it.inE };
function outsideSet(res) { const set = res.ctx.set; if (!set || !setSecNos(set).length || !SECS.length) return []; return res.items.filter(it => { const q = pt97(res, it); return !secCheck(set, q.n, q.e).inSet; }); }
function kpiHtml(tiles) {
  return `<div class="kpis">${tiles.map(([lab, val, sub]) => `<div class="kpi"><div class="kl">${esc(lab)}</div><div class="kv">${val}</div>${sub ? `<div class="ks">${esc(sub)}</div>` : ''}</div>`).join('')}</div>`;
}

/* ---------------- 簡易模式（給不熟電腦的使用者：大字、三步驟、白話） ---------------- */
const SIM = { res: null, kind: '', saved: '' };
const shortName = s => s.name.replace(/\s*段.*$/, '').trim() || s.id;
const simpleSets = () => allSets().filter(s => (s.sections || []).length || s.origin === 'user');
function simpleCtx() {
  const set = getSet(ui.set);
  return { set, dir: ui.dir, npar: set ? set.npar : 6, colloc: set ? set.colloc !== false : true, method: 'swap', compat: S().compat !== false };
}
function setMode(mode) {
  ui.mode = mode; saveUi();
  document.body.classList.toggle('simple', mode === 'simple');
  if (mode === 'simple') { renderSimple(); setSimpleTab(ui.sTab || 'conv'); } else { renderSetSelect(); refreshTransHeader(); }
  window.scrollTo(0, 0);
}
function applyZoom() { $('#simpleApp').style.zoom = S().zoom || 1; }
function sMsg(cls, html) { return `<div class="s-msg ${cls}">${html}</div>`; }
function renderSimple() {
  const sets = simpleSets();
  if (!sets.some(s => s.id === ui.set) && sets[0]) ui.set = sets[0].id;
  $('#sGrid').innerHTML = sets.map(s => `<button data-id="${esc(s.id)}" class="${s.id === ui.set ? 'on' : ''}">${esc(shortName(s))}<small>${s.sections.length > 1 ? s.sections.length + ' 個段' : '段'}</small></button>`).join('');
  $$('#sGrid button').forEach(b => b.onclick = async () => { if (!(await sPickSet(b.dataset.id))) return; $('#sFind').value = ''; $('#sFindMsg').textContent = ''; });
  $$('#sDir button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.dir));
  const sys = ui.dir === 'fwd' ? 'TWD67' : 'TWD97';
  $('#sNLab').textContent = `N 坐標（${sys}，7 位數）`; $('#sELab').textContent = `E 坐標（${sys}，6 位數）`;
  const set = getSet(ui.set), box = $('#sSetMsg');
  if (!set) { box.innerHTML = ''; return; }
  let m = null; try { m = E.fit(ctrlRows(set), { npar: set.npar, colloc: false }); } catch (e) { /* */ }
  box.innerHTML = !m ? sMsg('bad', '這個地段的參數有問題，無法轉換，請聯絡管理人員。')
    : m.df <= 1 ? sMsg('warn', `已選「${esc(set.name)}」。這個地段的已知點很少（${m.nctrl} 點），成果僅供參考。`)
    : sMsg('info', `已選「${esc(set.name)}」，共有 ${m.nctrl} 個已知控制點。`);
  if (ui.sTab === 'mng') renderSimpleManage();
}
async function sPickSet(id) {
  if (id === ui.set) return true;
  if (SMG.dirty && !(await confirmDlg('還沒儲存', `「${esc((getSet(SMG.id) || {}).name || '')}」的變更還沒儲存，換地段的話變更會不見。確定要換嗎？`, '不存了，換地段', true))) return false;
  SMG.dirty = false; SMG.log = [];
  ui.set = id; saveUi(); renderSimple(); return true;
}
function showSimpleResult(html) { $('#sResStep').style.display = ''; $('#sRes').innerHTML = html; $('#sResStep').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function simpleError(text) { showSimpleResult(sMsg('bad', text)); }
const okN = v => v > 2.3e6 && v < 2.9e6, okE = v => v > 1e5 && v < 4e5;
function simpleSingle() {
  const num = s => parseFloat(String(s).replace(/[，,\s]/g, ''));
  let n = num($('#sN').value), e = num($('#sE').value), note = '';
  if (!isFinite(n) || !isFinite(e)) { simpleError('請把 N 和 E 兩個坐標都填上數字。'); return; }
  if (okE(n) && okN(e)) { [n, e] = [e, n]; $('#sN').value = n; $('#sE').value = e; note = 'N、E 好像填反了，已經自動幫你對調。'; }
  if (!okN(n) || !okE(e)) { simpleError('坐標看起來不對：N 應該是 7 位數（例如 2704461.069），E 應該是 6 位數（例如 215163.152）。請再檢查一次。'); return; }
  const c = simpleCtx();
  if (!c.set) { simpleError('請先在第 1 步選擇地段。'); return; }
  let res; try { res = transformTargets(c, [{ name: 'P1', n, e }]); } catch (x) { simpleError('無法轉換：' + esc(x.message)); return; }
  res.kind = 'single'; SIM.res = res;
  const it = res.items[0], d = +S().dec || 3, out = sysOut(c);
  showSimpleResult((note ? sMsg('info', note) : '') +
    `<p style="margin:0 0 6px;font-size:20px">轉換後的 <b>${out}</b> 坐標：</p>
    <div class="s-res"><div class="k">N</div><div class="v" id="sOutN">${fx(it.n, d)}</div><button data-copy="${fx(it.n, d)}">複製</button>
    <div class="k">E</div><div class="v" id="sOutE">${fx(it.e, d)}</div><button data-copy="${fx(it.e, d)}">複製</button></div>` +
    (it.extrap ? sMsg('warn', '⚠ 這個點在已知控制點的範圍外面，誤差可能比較大，請小心使用。') : sMsg('ok', '✔ 轉換完成。')) +
    (() => { const q = pt97(res, it), k = secCheck(c.set, q.n, q.e); if (k.inSet) return k.at.length ? sMsg('info', `這個點位在「${esc(secLabel(k.at[0].no))}」。`) : '';
      return sMsg('bad', `⚠ 這個點位在「${esc(secLabel(k.at[0].no))}」，不在你選的「${esc(c.set.name)}」裡面。請確認地段有沒有選錯。` + (k.alt ? `<br><button class="s-btn alt" style="margin-top:10px" data-alt="${esc(k.alt.id)}">改用「${esc(k.alt.name)}」重新轉換</button>` : '')); })() +
    `<p style="margin:16px 0 6px;font-size:19px">你的點（橙色）與已知控制點（藍色三角形）的位置：</p>` + mapSvg({ ctrl: resultMapData(res).ctrl, targets: [Object.assign({ name: '你的點', extrap: it.extrap }, pt97(res, it))], big: true, targetLabel: '你的點', hi: setSecNos(c.set) }) +
    `<div class="s-actions"><button class="s-btn alt" id="sPrint">🖨 列印轉換報告</button><button class="s-btn alt" id="sAgain">再轉換一個點</button></div>`);
  $$('#sRes [data-copy]').forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = '已複製 ✓'; setTimeout(() => b.textContent = '複製', 1500); }));
  $('#sPrint').onclick = simplePrint;
  const altB = $('#sRes [data-alt]'); if (altB) altB.onclick = async () => { if (await sPickSet(altB.dataset.alt)) simpleSingle(); };
  $('#sAgain').onclick = () => { $('#sN').value = ''; $('#sE').value = ''; $('#sResStep').style.display = 'none'; $('#sN').focus(); };
}
function simplePrint() {
  const w = window.open('', '_blank');
  if (!w) { download(baseName(SIM.res) + '_轉換報告.html', reportHtml(SIM.res), 'text/html;charset=utf-8'); toast('報告已存到「下載」資料夾，請開啟後列印'); return; }
  w.document.write(reportHtml(SIM.res, true)); w.document.close();
}
async function simpleFile(file) {
  showSimpleResult(sMsg('info', '讀取中，請稍候…'));
  let text;
  try { text = await readFileText(file); } catch (e) { simpleError('這個檔案打不開。'); return; }
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) { simpleError('這個檔案是空的。'); return; }
  let kind = '', targets = [], coa = null, table = null, map = null, notes = [];
  const coaTry = E.parseCOA(text);
  if (coaTry.rows.length && coaTry.rows.length >= (lines.length - (coaTry.header ? 1 : 0)) * 0.8) {
    kind = 'coa'; coa = coaTry; targets = coa.rows.map((r, i) => ({ name: r.name, n: r.n, e: r.e, idx: i }));
    const code = (coa.header.trim().split(/\s+/)[0] || ''), secNo = code.replace(/^[A-Za-z]+0*/, '');
    const sug = secNo && findSetBySection(secNo);
    if (sug && sug.id !== ui.set) { ui.set = sug.id; saveUi(); renderSimple(); notes.push(`依檔案內的段代碼 ${esc(code)}，已自動改選「${esc(sug.name)}」。`); }
  } else if (looksInp(text)) {
    kind = 'inp';
    const rows = E.parseInp(text), t = rows.filter(r => r.ip >= 7 && r.ip < 9);
    targets = (t.length ? t : rows).map((r, i) => ({ name: r.name, n: r.n1, e: r.e1, idx: i }));
  } else {
    kind = 'table'; table = E.splitTable(text); map = E.guessColumns(table.rows);
    if (map.n < 0 || map.e < 0) { simpleError('看不懂這個檔案裡哪一欄是 N、哪一欄是 E。請改用「進階模式」手動指定欄位，或請管理人員協助。'); return; }
    table.rows.slice(map.hasHeader ? 1 : 0).forEach((r, i) => { const n = parseFloat(r[map.n]), e = parseFloat(r[map.e]); if (isFinite(n) && isFinite(e)) targets.push({ name: map.name >= 0 && r[map.name] ? r[map.name] : 'P' + (i + 1), n, e, idx: i }); });
  }
  if (!targets.length) { simpleError('檔案裡找不到可以轉換的坐標。'); return; }
  const c = simpleCtx();
  if (!c.set) { simpleError('請先在第 1 步選擇地段。'); return; }
  let res; try { res = transformTargets(c, targets); } catch (x) { simpleError('無法轉換：' + esc(x.message)); return; }
  Object.assign(res, { kind: kind === 'coa' ? 'coa' : 'multi', coa, table, map, fileName: file.name });
  SIM.res = res; SIM.kind = kind;
  const d = +S().dec || 3, ex = res.items.filter(i => i.extrap).length, out = sysOut(c);
  const prev = res.items.slice(0, 8);
  showSimpleResult(notes.map(n => sMsg('info', n)).join('') +
    sMsg('ok', `✔ 已轉換完成：「${esc(file.name)}」共 <b>${res.items.length.toLocaleString()}</b> 個點，轉成 ${out}。`) +
    (ex ? sMsg('warn', `⚠ 其中 ${ex.toLocaleString()} 個點在已知控制點的範圍外面（下表黃色），誤差可能比較大。`) : '') +
    ((o => o.length ? sMsg('bad', `⚠ 有 ${o.length.toLocaleString()} 個點不在你選的「${esc(c.set.name)}」裡面，請確認地段有沒有選錯。`) : '')(outsideSet(res))) +
    `<div class="s-actions"><button class="s-btn" id="sSave">💾 儲存轉換後的檔案</button><button class="s-btn alt" id="sPrint">🖨 列印轉換報告</button></div><div id="sSaved"></div>
    <table class="s-tbl"><thead><tr><th>點名</th><th>N（${out}）</th><th>E（${out}）</th></tr></thead><tbody>${prev.map(it => `<tr${it.extrap ? ' class="hl"' : ''}><td>${esc(it.name)}</td><td>${fx(it.n, d)}</td><td>${fx(it.e, d)}</td></tr>`).join('')}</tbody></table>
    <p style="margin:18px 0 6px;font-size:19px">點位分布：</p>${mapSvg(Object.assign(resultMapData(res), { big: true }))}
    ${res.items.length > prev.length ? `<p style="color:var(--ink3);font-size:16px">（只顯示前 ${prev.length} 點，儲存的檔案裡有全部 ${res.items.length.toLocaleString()} 點）</p>` : ''}`);
  $('#sSave').onclick = simpleSave; $('#sPrint').onclick = simplePrint;
}
function simpleSave() {
  const res = SIM.res, d = +S().dec || 3, out = sysOut(res.ctx);
  const stem = res.fileName.replace(/\.[^.]+$/, ''), ext = (res.fileName.match(/\.[^.]+$/) || ['.txt'])[0];
  let name, data;
  if (SIM.kind === 'coa') { name = `${stem}_${out}${ext}`; data = E.writeCOA(res.coa, res.items.map(it => ({ n: it.n, e: it.e })), null); }
  else if (SIM.kind === 'table') {
    const delim = res.table.delim === 'ws' ? '  ' : res.table.delim, rows = res.table.rows.map(r => r.slice());
    res.items.forEach(it => { const r = rows[it.idx + (res.map.hasHeader ? 1 : 0)]; r[res.map.n] = fx(it.n, d); r[res.map.e] = fx(it.e, d); });
    name = `${stem}_${out}${ext}`; data = rows.map(r => r.join(delim)).join('\r\n') + '\r\n';
  } else { name = `${stem}_${out}.txt`; data = res.items.map(it => E.fA(it.name, 10) + E.fF(it.n, 15, d) + E.fF(it.e, 15, d)).join('\r\n') + '\r\n'; }
  download(name, data);
  $('#sSaved').innerHTML = sMsg('ok', `已存到電腦的「<b>下載</b>」資料夾，檔名：<br><b style="font-family:var(--mono)">${esc(name)}</b>`);
}
/* 簡易模式：管理已知點 */
let SMG = { id: null, pts: [], dirty: false, log: [], cand: null };
function smEnsure() {
  const set = getSet(ui.set);
  if (!set) return null;
  if (SMG.id !== set.id || !SMG.dirty) SMG = { id: set.id, pts: clone(set.points), dirty: false, log: SMG.id === set.id ? SMG.log : [], cand: null };
  return set;
}
function smFit(pts) {
  const rows = pts.map((p, i) => ({ name: p.name, ip: 1, n1: +p.n1, e1: +p.e1, n2: +p.n2, e2: +p.e2, _i: i })).filter((r, i) => pts[i].on !== false);
  try { return E.fit(rows, { npar: (getSet(ui.set) || {}).npar || 6, colloc: false, compat: S().compat !== false }); } catch (e) { return null; }
}
// 已知點檢核（逐次剔除法）：
//  1. 每個使用中的點，以「不含此點」的其餘點解算，推算其應有坐標，差值即「偏差」
//     門檻＝max(3 cm, 3.7·σ₀·√(1+h))：σ₀ 為其餘點的單位權中誤差，h 為此點位置的槓桿值（邊緣點的推算本來就較不準），
//     3.7 ≈ √χ²(2, 99.9%)，即二維外部學生化殘差檢定
//  2. 超過門檻且最嚴重的一點先列為可疑、暫時排除，再重算其餘點；重複到沒有可疑點為止
//  如此一個錯點不會拉大整體誤差而掩蓋自己，也不會讓其他好點看起來偏差很大。
function smLeverage(m, n, e) {
  const dn = n - m.nc0, de = e - m.ec0;
  const rows = m.npar === 4 ? [[dn, de, 1, 0], [de, -dn, 0, 1]] : [[dn, de, 1, 0, 0, 0], [0, 0, 0, dn, de, 1]];
  let h = 0; rows.forEach(a => { for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) h += a[i] * m.Q[i][j] * a[j]; });
  return h / 2;
}
function smJudge(m, n1, e1, n2, e2) {
  const t = E.affine(m, n1, e1), vn = t.n - n2, ve = t.e - e2;
  const thr = m.df > 1 ? Math.max(0.03, 3.7 * m.sd0 * Math.sqrt(1 + smLeverage(m, n1, e1))) : null;
  return { vn, ve, v: Math.hypot(vn, ve), thr };
}
function smAnalyze(pts) {
  const onIdx = pts.map((p, i) => p.on !== false ? i : -1).filter(i => i >= 0);
  const fitWithout = ex => smFit(pts.map((q, j) => ex.has(j) ? Object.assign({}, q, { on: false }) : q));
  const devFrom = (m, p) => smJudge(m, +p.n1, +p.e1, +p.n2, +p.e2);
  const cap = Math.max(1, Math.floor(onIdx.length * 0.2));
  const flagged = new Set();
  for (let guard = 0; guard < onIdx.length; guard++) {
    let worst = -1, wr = 1;
    onIdx.forEach(i => {
      if (flagged.has(i)) return;
      const m = fitWithout(new Set([...flagged, i])); if (!m || m.df <= 1) return;
      const d = devFrom(m, pts[i]), r = d.v / d.thr;
      if (r > wr) { wr = r; worst = i; }
    });
    if (worst < 0) break;
    flagged.add(worst);
    if (flagged.size >= cap) break;
  }
  const clean = fitWithout(flagged), all = smFit(pts);
  const byI = new Map(all ? all.residuals.map(r => [r.p._i, r]) : []);
  const dev = pts.map((p, i) => {
    let d = null;
    if (p.on !== false && !flagged.has(i)) { const m = fitWithout(new Set([...flagged, i])); if (m) d = devFrom(m, p); }
    else if (clean) d = devFrom(clean, p);
    if (d) { d.bad = flagged.has(i) || (p.on === false && d.thr != null && d.v > d.thr); d.r = byI.get(i); }
    return d;
  });
  return { all, clean, flagged, dev };
}
function renderSimpleManage() {
  const set = smEnsure(); if (!set) return;
  const A = smAnalyze(SMG.pts), m = A.all, dev = A.dev, judge = A.clean && A.clean.df > 1;
  const isBad = d => d && d.bad;
  const nOn = SMG.pts.filter(p => p.on !== false).length, nBad = SMG.pts.filter((p, i) => p.on !== false && isBad(dev[i])).length;
  $('#smSum').innerHTML = !m ? sMsg('bad', `「${esc(set.name)}」目前可用的已知點不夠，無法計算。至少需要 ${set.npar === 4 ? 2 : 3} 個點。`)
    : sMsg(judge && nBad ? 'warn' : 'info', `「${esc(set.name)}」共有 ${SMG.pts.length} 個已知點，使用中 ${nOn} 個。` +
      (judge ? `整體誤差約 ±${cm(A.clean.sd0)} 公分${nBad ? '（不含偏差較大的點）' : ''}。${nBad ? `<br>⚠ 有 ${nBad} 個點和其他點不吻合，請檢查（表中紅字）。` : '<br>✓ 所有使用中的點都吻合良好。'}` : '<br>已知點太少，無法判斷好壞，成果僅供參考。'));
  $('#smMap').innerHTML = mapSvg({ ctrl: SMG.pts.map((p, i) => Object.assign({ name: p.name, n: +p.n2, e: +p.e2, on: p.on !== false, bad: !!(dev[i] && dev[i].bad) }, p.on !== false && dev[i] && dev[i].r ? { vn: dev[i].r.vn, ve: dev[i].r.ve } : {})), big: true, hi: setSecNos(set), fitHi: true }) +
    `<p style="margin:6px 0 0;color:var(--ink3);font-size:16px">灰色箭頭表示每個點的偏差方向與大小（已放大）；空心三角形是停用的點。</p>`;
  const rows = SMG.pts.map((p, i) => ({ p, i, d: dev[i] })).sort((a, b) => (b.d ? b.d.v : 0) - (a.d ? a.d.v : 0));
  $('#smTbl').innerHTML = `<table class="s-pt"><thead><tr><th>點名</th><th>偏差</th><th>狀態</th><th></th></tr></thead><tbody>` + rows.map(({ p, i, d }) => {
    const off = p.on === false, isNew = SMG.log.some(l => l.add === p.name);
    const st = off ? (isBad(d) ? '停用中（確實偏差大）' : '停用中') : !judge || !d || (d.thr == null && !d.bad) ? '無法判斷' : isBad(d) ? '<span class="st-bad">⚠ 偏差較大</span>' : '<span class="st-ok">✓ 吻合良好</span>';
    return `<tr class="${off ? 'off' : ''}"><td><b>${esc(p.name)}</b>${isNew ? ' <small style="color:var(--accent)">（新加入）</small>' : ''}</td><td style="font-family:var(--mono)">${d && judge && (d.thr != null || d.bad) ? cm(d.v) + ' 公分' : '—'}</td><td>${st}</td>
      <td style="text-align:right">${isNew ? `<button data-rm="${i}">移除</button>` : `<button data-tg="${i}">${off ? '恢復使用' : '停用'}</button>`}</td></tr>`;
  }).join('') + '</tbody></table>';
  $$('#smTbl [data-tg]').forEach(b => b.onclick = () => { const p = SMG.pts[+b.dataset.tg]; p.on = p.on === false; SMG.log.push({ txt: (p.on ? '恢復使用 ' : '停用 ') + p.name }); SMG.dirty = true; renderSimpleManage(); });
  $$('#smTbl [data-rm]').forEach(b => b.onclick = () => { const p = SMG.pts.splice(+b.dataset.rm, 1)[0]; SMG.log = SMG.log.filter(l => l.add !== p.name); SMG.dirty = SMG.log.length > 0; renderSimpleManage(); });
  const bar = $('#smBar'), modified = set.origin === 'modified';
  if (SMG.dirty) {
    bar.style.display = 'flex';
    bar.innerHTML = `<b style="flex:1">有 ${SMG.log.length} 項變更還沒儲存</b><button class="s-btn" id="smSave">💾 儲存變更</button><button class="s-btn alt" id="smUndo">放棄變更</button>`;
    $('#smSave').onclick = smSave;
    $('#smUndo').onclick = async () => { if (await confirmDlg('放棄變更', '剛才的變更都不要了嗎？', '不要了', true)) { SMG.dirty = false; SMG.log = []; renderSimpleManage(); } };
  } else if (modified) {
    bar.style.display = 'flex';
    bar.innerHTML = `<span style="flex:1">這個地段的已知點曾經修改過。</span><button class="s-btn alt" id="smReset">復原成原本的已知點</button>`;
    $('#smReset').onclick = async () => { if (await confirmDlg('復原', `要把「${esc(set.name)}」復原成程式內建的已知點嗎？你做過的修改都會清除。`, '復原', true)) { delete USER.sets[set.id]; saveUser(); SMG.id = null; refreshAll(); renderSimple(); toast('已復原'); } };
  } else bar.style.display = 'none';
}
function smTry() {
  const out = $('#smTryRes'), num = id => parseFloat(String($('#' + id).value).replace(/[，,\s]/g, ''));
  const name = $('#smName').value.trim().slice(0, 8);
  let n1 = num('smN1'), e1 = num('smE1'), n2 = num('smN2'), e2 = num('smE2'); const notes = [];
  if (!name) { out.innerHTML = sMsg('bad', '請先填點名。'); return; }
  if (![n1, e1, n2, e2].every(isFinite)) { out.innerHTML = sMsg('bad', '舊坐標和新坐標的 N、E 四個數字都要填。'); return; }
  if (okE(n1) && okN(e1)) { [n1, e1] = [e1, n1]; $('#smN1').value = n1; $('#smE1').value = e1; notes.push('舊坐標的 N、E 好像填反了，已自動對調。'); }
  if (okE(n2) && okN(e2)) { [n2, e2] = [e2, n2]; $('#smN2').value = n2; $('#smE2').value = e2; notes.push('新坐標的 N、E 好像填反了，已自動對調。'); }
  if (![n1, n2].every(okN) || ![e1, e2].every(okE)) { out.innerHTML = sMsg('bad', 'N 應該是 7 位數（例如 2704461.069），E 應該是 6 位數（例如 215163.152），請再檢查。'); return; }
  if (Math.hypot(n1 - n2, e1 - e2) > 2000) notes.push('⚠ 舊、新坐標相差超過 2 公里，請確認沒有填錯欄位。');
  const exist = SMG.pts.findIndex(p => p.name === name);
  const cand = { name, ip: 1, n1, e1, n2, e2, on: true };
  const trial = SMG.pts.slice(); if (exist >= 0) trial[exist] = cand; else trial.push(cand);
  const others = SMG.pts.filter((p, j) => j !== exist);
  const m = smAnalyze(others).clean;
  const d = m ? smJudge(m, n1, e1, n2, e2) : null;
  SMG.cand = { cand, exist };
  const thr = d && d.thr != null ? d.thr : 0.03;
  let verdict;
  if (!m || m.df <= 1) verdict = sMsg('info', '已知點太少，無法判斷這個點準不準，可以直接加入。');
  else if (d.v <= thr) verdict = sMsg('ok', `✓ 這個點和其他已知點吻合，偏差 ${cm(d.v)} 公分，可以放心加入。`);
  else verdict = sMsg('warn', `⚠ 這個點偏差 ${cm(d.v)} 公分，比其他點大很多（一般在 ${cm(thr)} 公分以內），可能是坐標打錯了。請再檢查一次；確定沒錯也可以加入。`);
  out.innerHTML = notes.map(n => sMsg('info', n)).join('') + (exist >= 0 ? sMsg('info', `已經有「${esc(name)}」這個點，加入後會更新它的坐標。`) : '') + verdict +
    `<div class="s-actions"><button class="s-btn" id="smAdd">確定加入</button><button class="s-btn alt" id="smClear">清除重填</button></div>`;
  $('#smAdd').onclick = () => {
    const { cand: c, exist: ex } = SMG.cand;
    if (ex >= 0) SMG.pts[ex] = c; else SMG.pts.push(c);
    SMG.log.push(ex >= 0 ? { txt: '更新 ' + c.name } : { txt: '新增 ' + c.name, add: c.name }); SMG.dirty = true;
    ['smName', 'smN1', 'smE1', 'smN2', 'smE2'].forEach(id => $('#' + id).value = ''); out.innerHTML = sMsg('ok', `已加入「${esc(c.name)}」。記得按下方「儲存變更」。`);
    renderSimpleManage();
  };
  $('#smClear').onclick = () => { ['smName', 'smN1', 'smE1', 'smN2', 'smE2'].forEach(id => $('#' + id).value = ''); out.innerHTML = ''; $('#smName').focus(); };
}
function smSave() {
  const set = getSet(SMG.id); if (!set) return;
  const base = builtinSet(set.id), prev = USER.sets[set.id];
  const note = SMG.log.map(l => l.txt).join('、') + '（簡易模式）';
  const revisions = ((prev && prev.revisions) || []).concat([{ ts: nowStr(), note, points: clone(SMG.pts) }]);
  USER.sets[set.id] = { id: set.id, name: set.name, sections: set.sections || [], note: set.note || '', npar: set.npar, colloc: set.colloc !== false,
    points: clone(SMG.pts), revisions, baseHash: base ? ptsHash(base.points) : undefined, savedAt: nowStr() };
  if (saveUser()) { SMG.dirty = false; SMG.log = []; refreshAll(); renderSimple(); dlg('已儲存', `<p>「${esc(set.name)}」的已知點已經儲存，之後轉換會使用新的設定。</p><p class="muted small">變更內容：${esc(note)}</p>`, [{ label: '好', pri: true }]); }
}
function setSimpleTab(t) {
  ui.sTab = t; saveUi();
  $$('#sTabs button').forEach(b => b.classList.toggle('on', b.dataset.v === t));
  $('#sConv').style.display = t === 'conv' ? '' : 'none'; $('#sMng').style.display = t === 'mng' ? '' : 'none';
  if (t === 'mng') renderSimpleManage();
}

let SIM_UPD = null;
function showSimpleUpdate(j, url) { SIM_UPD = { j, url }; $('#sUpd').style.display = 'flex'; $('#sUpd b').textContent = `有新版本 v${j.version} 可以更新`; }
function bindSimple() {
  $$('#sDir button').forEach(b => b.onclick = () => { ui.dir = b.dataset.v; saveUi(); renderSimple(); });
  $('#sFind').addEventListener('input', e => {
    const v = e.target.value.trim(), msg = $('#sFindMsg');
    if (!v) { msg.textContent = ''; return; }
    const s = simpleSets().find(x => x.sections.includes(v) || x.id === v);
    if (s) { if (s.id !== ui.set) { sPickSet(s.id).then(ok => { msg.innerHTML = ok ? `<b style="color:var(--accent)">→ ${esc(s.name)}</b>` : ''; }); return; } msg.innerHTML = `<b style="color:var(--accent)">→ ${esc(s.name)}</b>`; }
    else msg.innerHTML = '<span style="color:var(--bad)">找不到這個段號</span>';
  });
  $('#sGo').onclick = simpleSingle;
  $$('#sTabs button').forEach(b => b.onclick = () => setSimpleTab(b.dataset.v));
  $('#smTry').onclick = smTry;
  ['smName', 'smN1', 'smE1', 'smN2', 'smE2'].forEach((id, i, a) => $('#' + id).addEventListener('keydown', e => { if (e.key === 'Enter') { if (i < a.length - 1) $('#' + a[i + 1]).focus(); else smTry(); } }));
  $('#sN').addEventListener('keydown', e => { if (e.key === 'Enter') $('#sE').focus(); });
  $('#sE').addEventListener('keydown', e => { if (e.key === 'Enter') simpleSingle(); });
  $('#sN').addEventListener('paste', ev => {
    const t = (ev.clipboardData || window.clipboardData).getData('text');
    const nums = t.split(/[\s,;\t]+/).map(Number).filter(isFinite);
    const n = nums.find(okN), e = nums.find(okE);
    if (n != null && e != null) { ev.preventDefault(); $('#sN').value = n; $('#sE').value = e; }
  });
  const drop = $('#sDrop'), f = $('#sFile');
  drop.onclick = () => f.click();
  f.onchange = () => { if (f.files[0]) simpleFile(f.files[0]); f.value = ''; };
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) simpleFile(e.dataTransfer.files[0]); });
  // 整個視窗都可放檔案，避免拖錯位置時瀏覽器直接開啟檔案
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); if (ui.mode === 'simple' && e.dataTransfer.files[0] && !drop.contains(e.target)) simpleFile(e.dataTransfer.files[0]); });
  $('#sZoomIn').onclick = () => { S().zoom = Math.min(1.6, +(((S().zoom || 1) + 0.15).toFixed(2))); saveUser(); applyZoom(); };
  $('#sZoomOut').onclick = () => { S().zoom = Math.max(0.85, +(((S().zoom || 1) - 0.15).toFixed(2))); saveUser(); applyZoom(); };
  $('#sToAdv').onclick = () => setMode('adv');
  $('#toSimple').onclick = () => setMode('simple');
  $('#sUpdBtn').onclick = () => { if (SIM_UPD) doUpdate(SIM_UPD.j, SIM_UPD.url); };
}

/* ---------------- 主框架 ---------------- */
function showPage(id) {
  $$('#mainTabs button').forEach(b => b.classList.toggle('on', b.dataset.page === id));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === id));
  if (id === 'pgParams' && !ED.id) openEditor(ui.set || (allSets()[0] || {}).id);
  if (id === 'pgAbout') renderAbout();
}
function refreshAll() { renderSetSelect(); refreshTransHeader(); renderSetList(); renderAbout(); }
window.addEventListener('beforeunload', e => { if (ED.dirty || SMG.dirty) { e.preventDefault(); e.returnValue = ''; } });

function init() {
  applyTheme();
  $('#verLabel').textContent = 'v' + VER.version;
  document.title = '坐標轉換工具 v' + VER.version;
  $$('#mainTabs button').forEach(b => b.onclick = () => showPage(b.dataset.page));
  bindTransPage(); bindParamsPage(); bindAboutPage(); bindSimple(); applyZoom();
  renderSetSelect();
  const s0 = getSet(ui.set); if (s0 && USER.ui.npar == null) { ui.npar = s0.npar; ui.colloc = s0.colloc !== false; }
  refreshTransHeader(); showInTab(); renderSetList(); renderAbout();
  setMode(ui.mode === 'adv' ? 'adv' : 'simple');
  // 新版首次開啟
  if (USER.seenVersion && USER.seenVersion !== VER.version) {
    const c = (VER.changelog || []).filter(x => cmpVer(x.version, USER.seenVersion) > 0);
    if (c.length) dlg(`已更新至 v${VER.version}`, `<div class="cl">${c.map(x => `<h4>v${esc(x.version)}</h4><ul>${x.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}</div>`);
  }
  USER.seenVersion = VER.version; saveUser();
  if (S().updAuto && updUrl() && location.protocol === 'file:' && (!S().lastCheck || Date.now() - S().lastCheck > 86400000)) checkUpdate(false);
}
init();
window.__CT = { Engine, allSets, transformTargets, ctx, makeZip, reportHtml: r => reportHtml(r) }; // 除錯用
})();
