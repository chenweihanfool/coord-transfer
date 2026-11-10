/* ==========================================================================
 * 坐標轉換引擎 — 忠實移植國土測繪中心 TRANSFN1.FOR (成大測量系 1993/1996/2001)
 *   1. Helmert 4 參數 / Affine 6 參數 最小二乘轉換
 *   2. 最小二乘配置 (least squares collocation, 線性協方差函數) 殘差內插
 *   3. 原程式輸出檔 (*.out, AFFINE6.OUT, HELMERT4.OUT, resid.ne, interp.in,
 *      interp.out, chkdist.00x) 逐字重現
 * 「相容模式」會照原程式把中間檔 (resid.ne / interp.in) 取至 mm 再進行配置，
 * 以確保與 t.exe 結果逐位一致。
 * ======================================================================== */
const Engine = (() => {
  'use strict';

  /* ---------------- Fortran 風格格式化 ---------------- */
  function fF(x, w, d) {
    if (!isFinite(x)) return '*'.repeat(w);
    let s = Math.abs(x).toFixed(d);
    // 原程式編譯器：四捨五入後為 0 時不印負號
    if (x < 0 && Number(s) !== 0) s = '-' + s;
    if (s.length > w) s = s.replace(/^(-?)0\./, '$1.');
    if (s.length > w) return '*'.repeat(w);
    return s.padStart(w);
  }
  function fE(x, w, d) {
    if (!isFinite(x)) return '*'.repeat(w);
    let mant, ex;
    if (x === 0) { mant = '0'.repeat(d); ex = 0; }
    else {
      const t = Math.abs(x).toExponential(d - 1); // "1.01872e-6"
      const [m, e] = t.split('e');
      mant = m.replace('.', '');
      ex = parseInt(e, 10) + 1;
    }
    let s = '0.' + mant + 'E' + (ex < 0 ? '-' : '+') + String(Math.abs(ex)).padStart(2, '0');
    if (x < 0) s = '-' + s;
    if (s.length > w) s = s.replace(/^(-?)0\./, '$1.');
    if (s.length > w) return '*'.repeat(w);
    return s.padStart(w);
  }
  const fI = (n, w) => { const s = String(n); return s.length > w ? '*'.repeat(w) : s.padStart(w); };
  const fA = (s, w) => (String(s) + ' '.repeat(w)).slice(0, w);
  const r3 = x => { const v = Number(x.toFixed(3)); return v === 0 ? 0 : v; };

  /* ---------------- 解析 ---------------- */
  // .inp：PTNAME(A8) IP(I1) NC EC XC YC
  function parseInp(text) {
    const rows = [];
    String(text).split(/\r?\n/).forEach((line, idx) => {
      const raw = line.replace(/\u001a/g, '');
      if (!raw.trim()) return;
      const t = raw.trim().split(/[\s,]+/);
      if (t.length < 4) return;
      const ip = parseInt(t[1], 10);
      if (!(ip >= 0 && ip <= 9)) return;
      const nums = t.slice(2).map(Number);
      if (nums.slice(0, 2).some(v => !isFinite(v))) return;
      rows.push({ name: t[0].slice(0, 8), ip, n1: nums[0], e1: nums[1],
        n2: isFinite(nums[2]) ? nums[2] : 0, e2: isFinite(nums[3]) ? nums[3] : 0, line: idx + 1 });
    });
    return rows;
  }
  function writeInp(rows) {
    return rows.map(r => {
      let s = fA(r.name, 8) + ' ' + fI(r.ip, 1) + ' ' + fF(r.n1, 14, 3) + ' ' + fF(r.e1, 14, 3);
      if (r.ip < 7) s += ' ' + fF(r.n2, 14, 3) + ' ' + fF(r.e2, 14, 3);
      return s;
    }).join('\r\n') + '\r\n';
  }

  // NECEXE 重測系統 .COA 界址點坐標檔
  //   首行：段代碼 ...；之後每行 I5 + 旗標(1) + N(F16) + E(F15) + 旗標(1)
  function parseCOA(text) {
    const lines = String(text).split(/\r?\n/);
    let header = null; const rows = []; const bad = [];
    const re = /^(.{5})(.)(\s*\d{6,7}\.\d+?)(\d{5,6}\.\d+)(.?)\s*$/;
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      if (header === null && /^[A-Za-z]{2}\d{4}/.test(line.trim())) { header = line; return; }
      let m = null;
      if (line.length >= 37 && /^\s*\d+$/.test(line.slice(0, 5))) {
        const nS = line.slice(6, 22), eS = line.slice(22, 37);
        if (/^\s*\d+\.\d+$/.test(nS) && /^\s*\d+\.\d+$/.test(eS))
          m = { no: line.slice(0, 5).trim(), f1: line[5], nS, eS, f2: line.slice(37) };
      }
      if (!m) { const g = re.exec(line); if (g) m = { no: g[1].trim(), f1: g[2], nS: g[3], eS: g[4], f2: g[5] }; }
      if (!m) { bad.push(i + 1); return; }
      const dN = (m.nS.split('.')[1] || '').length, dE = (m.eS.split('.')[1] || '').length;
      rows.push({ name: m.no, f1: m.f1, f2: m.f2, n: Number(m.nS), e: Number(m.eS), wN: m.nS.length, wE: m.eS.length, dN, dE });
    });
    return { header: header || '', rows, bad };
  }
  function writeCOA(coa, coords, decimals) {
    const out = [];
    if (coa.header) out.push(coa.header);
    coa.rows.forEach((r, i) => {
      const c = coords[i];
      // decimals：先取至指定位數，再以原檔小數位數 (補 0) 輸出，維持定寬欄位
      const rd = (v, d) => decimals != null ? Number(v.toFixed(Math.min(decimals, d))) : v;
      out.push(fI(r.name, 5) + r.f1 + fF(rd(c.n, r.dN), r.wN, r.dN) + fF(rd(c.e, r.dE), r.wE, r.dE) + r.f2);
    });
    return out.join('\r\n') + '\r\n';
  }

  // 多點文字/CSV：自動判斷分隔與欄位
  function splitTable(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { rows: [], delim: ',' };
    const sample = lines.slice(0, 20).join('\n');
    let delim = /\t/.test(sample) ? '\t' : /,/.test(sample) ? ',' : /;/.test(sample) ? ';' : 'ws';
    const rows = lines.map(l => delim === 'ws' ? l.trim().split(/\s+/) : l.split(delim).map(s => s.trim().replace(/^"(.*)"$/, '$1')));
    return { rows, delim };
  }
  function guessColumns(rows) {
    const nCol = Math.max(...rows.slice(0, 50).map(r => r.length));
    const body = rows.slice(0, 200);
    const stat = [];
    for (let c = 0; c < nCol; c++) {
      let num = 0, nLike = 0, eLike = 0, txt = 0, tot = 0;
      body.forEach(r => {
        const v = r[c]; if (v == null || v === '') return; tot++;
        const x = Number(v);
        if (isFinite(x)) { num++; if (x > 2.3e6 && x < 2.9e6) nLike++; else if (x > 1.0e5 && x < 4.0e5) eLike++; }
        else txt++;
      });
      stat.push({ c, num, nLike, eLike, txt, tot });
    }
    const pick = key => { let best = -1, bv = 0; stat.forEach(s => { if (s[key] > bv) { bv = s[key]; best = s.c; } }); return best; };
    const nc = pick('nLike'), ec = pick('eLike');
    let name = -1, bt = 0;
    stat.forEach(s => { if (s.c !== nc && s.c !== ec && s.txt > bt) { bt = s.txt; name = s.c; } });
    if (name < 0) name = (nc === 0 || ec === 0) ? -1 : 0;
    const hasHeader = rows.length > 1 && nc >= 0 && !isFinite(Number(rows[0][nc]));
    return { name, n: nc, e: ec, hasHeader, nCol };
  }

  /* ---------------- 線性代數 ---------------- */
  function symInverse(N) { // Cholesky 逆矩陣 (對稱正定)
    const n = N.length, L = N.map(r => r.slice());
    for (let j = 0; j < n; j++) {
      let s = L[j][j];
      for (let k = 0; k < j; k++) s -= L[j][k] * L[j][k];
      if (!(s > 1e-8 * Math.abs(N[j][j])) || s <= 0) throw new Error('法方程式奇異，控制點幾何不足（點重複或共線）。');
      L[j][j] = Math.sqrt(s);
      for (let i = j + 1; i < n; i++) {
        let t = L[i][j];
        for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k];
        L[i][j] = t / L[j][j];
      }
      for (let k = j + 1; k < n; k++) L[j][k] = 0;
    }
    const inv = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let c = 0; c < n; c++) {
      const y = new Array(n).fill(0);
      for (let i = 0; i < n; i++) { let t = i === c ? 1 : 0; for (let k = 0; k < i; k++) t -= L[i][k] * y[k]; y[i] = t / L[i][i]; }
      for (let i = n - 1; i >= 0; i--) { let t = y[i]; for (let k = i + 1; k < n; k++) t -= L[k][i] * inv[k][c]; inv[i][c] = t / L[i][i]; }
    }
    return inv;
  }

  // 原程式 SINV + DMFSD（壓縮上三角對稱矩陣求逆，1-based），逐步重現以確保參數逐位一致
  function DMFSD(A, n, eps) {
    let ier = 0, kpiv = 0, dpiv = 0;
    for (let k = 1; k <= n; k++) {
      kpiv += k;
      let ind = kpiv;
      const lend = k - 1;
      const tol = Math.abs(eps * A[kpiv]);
      for (let i = k; i <= n; i++) {
        let dsum = 0;
        for (let l = 1; l <= lend; l++) dsum += A[kpiv - l] * A[ind - l];
        dsum = A[ind] - dsum;
        if (i === k) {
          if (dsum - tol <= 0) {
            if (dsum <= 0) return -1;
            if (ier <= 0) ier = k - 1;
          }
          dpiv = Math.sqrt(dsum);
          A[kpiv] = dpiv;
          dpiv = 1 / dpiv;
        } else A[ind] = dsum * dpiv;
        ind += i;
      }
    }
    return ier;
  }
  function SINV(A, n, eps) {
    const ier = DMFSD(A, n, eps);
    if (ier < 0) return ier;
    let ipiv = n * (n + 1) / 2, ind = ipiv, min;
    for (let i = 1; i <= n; i++) {
      const din = 1 / A[ipiv];
      A[ipiv] = din;
      min = n;
      const kend = i - 1, lanf = n - kend;
      if (kend > 0) {
        let j = ind;
        for (let k = 1; k <= kend; k++) {
          let work = 0;
          min--;
          let lhor = ipiv, lver = j;
          for (let l = lanf; l <= min; l++) { lver++; lhor += l; work += A[lver] * A[lhor]; }
          A[j] = -work * din;
          j -= min;
        }
      }
      ipiv -= min;
      ind--;
    }
    for (let i = 1; i <= n; i++) {
      ipiv += i;
      let j = ipiv;
      for (let k = i; k <= n; k++) {
        let work = 0, lhor = j;
        for (let l = k; l <= n; l++) { const lver = lhor + k - i; work += A[lhor] * A[lver]; lhor += l; }
        A[j] = work;
        j += k;
      }
    }
    return ier;
  }

  // 原程式 subroutine inv (nter=1 → 解向量)；壓縮上三角, L=C*(C-1)/2+R, 1-based
  function invSolve(a, b, lc, tol) {
    let is = 0;
    for (let ic = 1; ic <= lc; ic++) {
      const ic0 = ic * (ic - 1) / 2;
      let icr = ic0 + ic;
      const ai = a[icr];
      icr = ic0 + 1;
      if (ic !== 1) {
        a[icr] = a[1] * a[icr];
        for (let jc = 2; jc <= ic; jc++) {
          const jc1 = jc - 1, jc0 = jc * jc1 / 2;
          let sum = 0;
          for (let kr = 1; kr <= jc1; kr++) sum += a[jc0 + kr] * a[ic0 + kr];
          icr = ic0 + jc;
          a[icr] = a[icr] - sum;
          if (jc === ic) break;
          a[icr] = a[jc0 + jc] * a[icr];
        }
      }
      if (a[icr] > tol * ai) a[icr] = 1 / Math.sqrt(a[icr]);
      else { is++; a[icr] = 0; }
    }
    // reduce
    b[1] = a[1] * b[1];
    let jc0 = 0;
    for (let jc = 2; jc <= lc; jc++) {
      const jc1 = jc - 1; jc0 += jc1;
      let sum = 0;
      for (let kr = 1; kr <= jc1; kr++) sum += a[jc0 + kr] * b[kr];
      b[jc] = a[jc0 + jc] * (b[jc] - sum);
    }
    // solve
    const lc2 = lc + 2;
    for (let j = 2; j <= lc; j++) {
      const jc = lc2 - j, jc1 = jc - 1, j0 = jc * jc1 / 2;
      b[jc] = a[j0 + jc] * b[jc];
      const x = -b[jc];
      for (let kr = 1; kr <= jc1; kr++) b[kr] += x * a[j0 + kr];
    }
    b[1] = a[1] * b[1];
    return is;
  }

  /* ---------------- 轉換模型 ---------------- */
  const covf = (c, a, d) => (d > a ? 0 : c * (1 - d / a));
  const varOfIp = ip => ip === 1 ? 0 : ip === 2 ? 0.05 ** 2 : 0.10 ** 2;

  function collocComponent(refs, vals, varr) {
    const n = refs.length;
    const ave = vals.reduce((s, v) => s + v, 0) / n;
    const l = vals.map(v => v - ave);
    const cov0 = l.reduce((s, v) => s + v * v, 0) / n;
    const c = cov0; // filternoise = 0
    let distmax = 0;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n - 1; j++) {
      const d = Math.sqrt((refs[j].x - refs[i].x) ** 2 + (refs[j].y - refs[i].y) ** 2);
      if (d > distmax) distmax = d;
    }
    if (distmax > 20000) distmax = 20000;
    const a = distmax * 1e-3;
    const A = new Float64Array(n * (n + 1) / 2 + 1);
    const loc = (i, j) => { const l1 = Math.min(i, j), m = Math.max(i, j); return m * (m - 1) / 2 + l1; };
    for (let i = 1; i <= n; i++) for (let j = i; j <= n; j++) {
      const d = Math.sqrt((refs[i - 1].x - refs[j - 1].x) ** 2 + (refs[i - 1].y - refs[j - 1].y) ** 2) * 1e-3;
      A[loc(i, j)] = (a > 0 ? covf(c, a, d) : 0) + (i === j ? varr[i - 1] : 0);
    }
    const b = new Float64Array(n + 2);
    for (let i = 1; i <= n; i++) b[i] = l[i - 1];
    const is = invSolve(A, b, n, 1e-12);
    return { c, a, ave, std: Math.sqrt(vals.reduce((s, v) => s + v * v, 0) / n), w: Array.from(b.slice(1, n + 1)), singular: is, distmax };
  }

  /**
   * fit(rows, opt) — rows 為 .inp 列 (含待求點亦可)，ip<7 為控制點。
   * opt: { npar: 4|6, colloc: bool, compat: bool, origin: {n,e} }
   */
  function fit(rows, opt = {}) {
    const npar = opt.npar === 4 ? 4 : 6;
    const compat = opt.compat !== false;
    const ctrl = rows.filter(r => r.ip < 7);
    if (!ctrl.length) throw new Error('沒有控制點 (IP<7)。');
    const o = opt.origin || { n: rows[0].n1, e: rows[0].e1 };
    const nc0 = o.n, ec0 = o.e;
    const N = Array.from({ length: npar }, () => new Array(npar).fill(0));
    const U = new Array(npar).fill(0);
    ctrl.forEach(p => {
      const dn = p.n1 - nc0, de = p.e1 - ec0;
      const A = npar === 4 ? [[dn, de, 1, 0], [de, -dn, 0, 1]] : [[dn, de, 1, 0, 0, 0], [0, 0, 0, dn, de, 1]];
      const L = [p.n2 - nc0, p.e2 - ec0];
      for (let i = 0; i < npar; i++)
        for (let j = 0; j < npar; j++) { N[i][j] += A[0][i] * A[0][j]; N[i][j] += A[1][i] * A[1][j]; }
      for (let i = 0; i < npar; i++) { U[i] += A[0][i] * L[0]; U[i] += A[1][i] * L[1]; }
    });
    const df = 2 * ctrl.length - npar;
    if (df < 0) throw new Error(`控制點數不足：${ctrl.length} 點無法解算 ${npar} 參數（至少需要 ${npar / 2} 點）。`);
    let Q;
    if (compat) {
      const AA = new Float64Array(npar * (npar + 1) / 2 + 1);
      for (let i = 1; i <= npar; i++) for (let j = 1; j <= i; j++) AA[i * (i - 1) / 2 + j] = N[j - 1][i - 1];
      if (SINV(AA, npar, 1e-8) < 0) throw new Error('法方程式奇異，控制點幾何不足（點重複或共線）。');
      Q = Array.from({ length: npar }, () => new Array(npar).fill(0));
      for (let i = 1; i <= npar; i++) for (let j = i; j <= npar; j++) Q[i - 1][j - 1] = Q[j - 1][i - 1] = AA[j * (j - 1) / 2 + i];
    } else Q = symInverse(N);
    const X = Q.map(r => { let s = 0; for (let j = 0; j < npar; j++) s += r[j] * U[j]; return s; });
    const model = { npar, compat, nc0, ec0, X, Q, df, nctrl: ctrl.length };
    const residuals = [];
    let vv = 0;
    ctrl.forEach(p => {
      const t = affine(model, p.n1, p.e1);
      if (p.ip < 6) {
        const vn = t.n - p.n2, ve = t.e - p.e2;
        vv += vn * vn + ve * ve;
        residuals.push({ name: p.name, ip: p.ip, vn, ve, fn: t.n, fe: t.e, p });
      }
    });
    model.vv = vv;
    model.sd0 = df > 1 ? Math.sqrt(vv / df) : 0;
    model.sigLegacy = X.map((_, i) => model.sd0 * Q[i][i]);       // 原程式列印值 SD0*Qii
    model.sig = X.map((_, i) => model.sd0 * Math.sqrt(Q[i][i]));   // 正確中誤差
    model.residuals = residuals;
    model.warnings = [];
    if (df <= 1) model.warnings.push(`自由度 ${df}：控制點數恰好足夠解算，無法評估精度。`);
    // 最小二乘配置
    model.colloc = null;
    if (opt.colloc !== false && residuals.length >= 2) {
      const refs = residuals.map(r => ({
        name: r.name, ip: r.ip,
        x: compat ? r3(r.p.n2) : r.p.n2, y: compat ? r3(r.p.e2) : r.p.e2,
        vn: compat ? r3(-r.vn) : -r.vn, ve: compat ? r3(-r.ve) : -r.ve,
      }));
      const n = refs.length;
      const varr = new Array(n).fill(0);
      if (compat) for (let k = 0; k < n - 1; k++) varr[k + 1] = varOfIp(refs[k].ip); // 原程式索引位移
      else for (let k = 0; k < n; k++) varr[k] = varOfIp(refs[k].ip);
      const cn = collocComponent(refs, refs.map(r => r.vn), varr);
      const ce = collocComponent(refs, refs.map(r => r.ve), varr);
      model.colloc = { refs, n: cn, e: ce };
      if (cn.a <= 0) model.warnings.push('配置相關距離為 0（控制點不足 3 點），配置改正量為 0。');
    }
    return model;
  }

  function affine(m, n, e) {
    const dn = n - m.nc0, de = e - m.ec0, X = m.X;
    if (m.npar === 4) return { n: dn * X[0] + de * X[1] + X[2] + m.nc0, e: -dn * X[1] + de * X[0] + X[3] + m.ec0 };
    return { n: dn * X[0] + de * X[1] + X[2] + m.nc0, e: dn * X[3] + de * X[4] + X[5] + m.ec0 };
  }
  function collocAt(m, x, y) {
    const C = m.colloc; if (!C) return { dn: 0, de: 0 };
    const one = comp => {
      if (!(comp.a > 0)) return 0;
      let s = 0;
      for (let j = 0; j < C.refs.length; j++) {
        const d = Math.sqrt((x - C.refs[j].x) ** 2 + (y - C.refs[j].y) ** 2) * 1e-3;
        s += covf(comp.c, comp.a, d) * comp.w[j];
      }
      return s + comp.ave;
    };
    return { dn: one(C.n), de: one(C.e) };
  }
  // 正算：得 { an, ae (仿射), dn, de (配置改正), n, e (成果) }
  function forward(m, n, e, useColloc = true, compat = m.compat) {
    const t = affine(m, n, e);
    if (!useColloc || !m.colloc) return { an: t.n, ae: t.e, dn: 0, de: 0, n: t.n, e: t.e };
    const x = compat ? r3(t.n) : t.n, y = compat ? r3(t.e) : t.e;
    const c = collocAt(m, x, y);
    return { an: t.n, ae: t.e, dn: c.dn, de: c.de, n: compat ? r3(x + c.dn) : x + c.dn, e: compat ? r3(y + c.de) : y + c.de };
  }
  // 反算 (迭代反解正算模型)
  function inverse(m, n, e, useColloc = true) {
    const X = m.X;
    const J = m.npar === 4 ? [[X[0], X[1]], [-X[1], X[0]]] : [[X[0], X[1]], [X[3], X[4]]];
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    const solve = (rn, re) => ({ dn: (J[1][1] * rn - J[0][1] * re) / det, de: (-J[1][0] * rn + J[0][0] * re) / det });
    let s = { n: n - (affine(m, n, e).n - n), e: e - (affine(m, n, e).e - e) };
    let it = 0;
    for (; it < 30; it++) {
      const f = forward(m, s.n, s.e, useColloc, false);
      const d = solve(n - f.n, e - f.e);
      s.n += d.dn; s.e += d.de;
      if (Math.abs(d.dn) < 1e-7 && Math.abs(d.de) < 1e-7) break;
    }
    const f = forward(m, s.n, s.e, useColloc, false);
    return { n: s.n, e: s.e, an: f.an, ae: f.ae, dn: f.dn, de: f.de, iter: it + 1 };
  }
  const swapRows = rows => rows.map(r => r.ip < 7 ? { ...r, n1: r.n2, e1: r.e2, n2: r.n1, e2: r.e1 } : { ...r });

  /* ---------------- 幾何檢核 ---------------- */
  function hull(pts) {
    const p = pts.map(q => [q.e, q.n]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function inHull(h, n, e) {
    if (h.length < 3) return false;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length];
      if ((b[0] - a[0]) * (n - a[1]) - (b[1] - a[1]) * (e - a[0]) < -1e-9) return false;
    }
    return true;
  }
  function geomChecker(ctrlPts) { // ctrlPts: [{n,e,name}]
    const h = hull(ctrlPts);
    return (n, e) => {
      let best = Infinity, who = '';
      ctrlPts.forEach(c => { const d = Math.hypot(c.n - n, c.e - e); if (d < best) { best = d; who = c.name; } });
      return { nearest: best, nearestName: who, inside: inHull(h, n, e) };
    };
  }

  /* ---------------- 原程式輸出檔 ---------------- */
  const ATAN1 = (dx, dy) => {
    const PI = 3.1415926535898;
    if (dx === 0) return dy < 0 ? 3 * PI / 2 : dy === 0 ? 0 : PI / 2;
    let a = Math.atan(dy / dx);
    if (dx < 0) a += PI; else if (a < 0) a += 2 * PI;
    return a;
  };
  const RADDMS1 = az => {
    let ak = az * 57.29577951308;
    const id1 = Math.trunc(ak);
    const im1 = Math.trunc((ak - id1) * 60);
    const s1 = (((ak - id1) * 60) - im1) * 60;
    return id1 + im1 / 100 + s1 / 10000;
  };

  function distChecks(ctrl) {
    const out = []; let dppm = 0;
    for (let i = 0; i < ctrl.length; i++) for (let j = i + 1; j < ctrl.length; j++) {
      const a = ctrl[i], b = ctrl[j];
      const d1 = Math.hypot(a.n1 - b.n1, a.e1 - b.e1), d2 = Math.hypot(a.n2 - b.n2, a.e2 - b.e2);
      const dd = d1 - d2;
      const valid = Math.abs(dd) > 1e-5;
      if (valid) dppm = d2 / dd;
      out.push({ from: a.name, to: b.name, d1, d2, dd, ratio: dppm, valid });
    }
    return out;
  }
  function azChecks(ctrl) {
    const out = [];
    for (let i = 0; i < ctrl.length; i++) for (let j = i + 1; j < ctrl.length; j++) {
      const a = ctrl[i], b = ctrl[j];
      const z1 = ATAN1(b.n1 - a.n1, b.e1 - a.e1), z2 = ATAN1(b.n2 - a.n2, b.e2 - a.e2);
      out.push({ from: a.name, to: b.name, z1: RADDMS1(z1), z2: RADDMS1(z2), dz: RADDMS1(z1 - z2) * 10000, dzRad: z1 - z2 });
    }
    return out;
  }

  function legacyFiles(rows, model, baseName = 'trans') {
    const ctrl = rows.filter(r => r.ip < 7);
    const L = [];
    const dash48 = ' ' + '-'.repeat(48), dash78 = '-'.repeat(78);
    L.push('', '    NAME' + ' '.repeat(11) + ' VX' + ' '.repeat(11) + ' VY', dash48);
    model.residuals.forEach(r => L.push('   ' + fA(r.name, 8) + '   ' + fF(r.vn, 10, 6) + '   ' + fF(r.ve, 10, 6)));
    L.push(dash48);
    if (model.df > 1) {
      L.push('', '    SUM OF [VV] =' + fF(model.vv, 10, 4), '    DEGREE OF FREEDOM =' + fI(model.df, 4));
      L.push('    STANDARD ERROR =' + fF(model.sd0, 10, 4) + ' [M]', '', '');
      L.push(dash48);
    }
    model.X.forEach((x, i) => L.push('   A(' + (i + 1) + ')=' + fF(x, 20, 11) + '    +-' + fE(model.sigLegacy[i], 12, 6)));
    L.push(dash48, ' ', '', '\f');
    const chk = { '000': [], '001': [], '002': [], '003': [], '004': [] };
    const hdrD = ['', '   FROM  ' + ' '.repeat(8) + '  TO   ' + '   ' + '  GPS  ' + ' '.repeat(6) + ' GROUND  ' + ' DIFFERENCE ' + '  ' + '1/ PPM   TEST  ', dash78];
    if (ctrl.length > 1) {
      L.push('', '', '', '   DISTANCE  CHECK : ', ...hdrD);
      ['001', '002', '003', '004'].forEach(k => chk[k].push(...hdrD));
      distChecks(ctrl).forEach(d => {
        const s = ' ' + fA(d.from, 8) + ' ---> ' + fA(d.to, 8) + fF(d.d1, 13, 4) + fF(d.d2, 13, 4) + ' ' + fF(d.dd, 8, 4) + '  ' + fF(d.ratio, 10, 1);
        L.push(s);
        const q = Math.abs(d.ratio);
        chk[q < 5000 ? '000' : q < 10000 ? '001' : q < 15000 ? '002' : q < 20000 ? '003' : '004'].push(s);
      });
      L.push(dash78);
      L.push('', '   AZIMUTH   CHECK : ', '', '   FROM  ' + ' '.repeat(8) + '  TO   ' + '   ' + '  GPS  ' + ' '.repeat(6) + ' GROUND  ' + 'DIFFERENCE(SEC)' + '  TEST ', dash78);
      azChecks(ctrl).forEach(z => L.push(' ' + fA(z.from, 8) + ' ---> ' + fA(z.to, 8) + fF(z.z1, 13, 6) + fF(z.z2, 13, 6) + ' ' + fF(z.dz, 8, 2)));
      L.push(dash78, ' ', '', '\f');
    }
    const files = {};
    files[baseName + '.inp'] = writeInp(rows);
    files[baseName + '.out'] = L.join('\r\n') + '\r\n';
    // AFFINE6.OUT / HELMERT4.OUT
    const T = ['', '  NAME' + ' '.repeat(11) + 'N_COORD' + ' '.repeat(8) + 'E_COORD' + ' '.repeat(7) + 'TR_XCOORD' + ' '.repeat(6) + 'TR_YCOORD', ' ' + '-'.repeat(75)];
    const interpIn = [], targets = [];
    rows.forEach(r => {
      if (r.ip < 9) {
        const t = affine(model, r.n1, r.e1);
        T.push(' ' + fA(r.name, 8) + ' ' + fI(r.ip, 1) + ' ' + fF(r.n1, 14, 4) + ' ' + fF(r.e1, 14, 4) + ' ' + fF(t.n, 14, 4) + ' ' + fF(t.e, 14, 4));
        interpIn.push(fA(r.name, 8) + fF(t.n, 15, 3) + fF(t.e, 15, 3));
        targets.push({ r, t });
      }
    });
    T.push(' ' + '-'.repeat(75), ' ', '', '\f');
    files[model.npar === 4 ? 'HELMERT4.OUT' : 'AFFINE6.OUT'] = T.join('\r\n') + '\r\n';
    const R = ['station wt   Ngrid   Egrid     Ngps    Egps    Nv    Ev', ' ' + '-'.repeat(78)];
    model.residuals.forEach(r => R.push(fA(r.name, 8) + fI(r.ip, 2) + fF(r.p.n2, 13, 3) + fF(r.p.e2, 13, 3) + fF(r.fn, 13, 3) + fF(r.fe, 13, 3) + fF(-r.vn, 8, 3) + fF(-r.ve, 8, 3)));
    files['resid.ne'] = R.join('\r\n') + '\r\n';
    files['interp.in'] = interpIn.join('\r\n') + '\r\n';
    if (model.colloc) {
      const O = ['     name    ntran(m)  etran(m)  ndef(m) edef(m)   ninterp(m)   einterp(m)'];
      targets.forEach(({ r, t }) => {
        const x = model.compat ? r3(t.n) : t.n, y = model.compat ? r3(t.e) : t.e;
        const c = collocAt(model, x, y);
        O.push(fA(r.name, 8) + fF(x, 13, 3) + fF(y, 13, 3) + fF(c.dn, 7, 3) + fF(c.de, 7, 3) + fF(x + c.dn, 13, 3) + fF(y + c.de, 13, 3));
      });
      files['interp.out'] = O.join('\r\n') + '\r\n';
    }
    Object.keys(chk).forEach(k => { files['chkdist.' + k] = chk[k].length ? chk[k].join('\r\n') + '\r\n' : ''; });
    return files;
  }

  return { fF, fE, fI, fA, r3, parseInp, writeInp, parseCOA, writeCOA, splitTable, guessColumns,
    fit, affine, forward, inverse, collocAt, swapRows, geomChecker, hull, distChecks, azChecks, legacyFiles };
})();
if (typeof module !== 'undefined') module.exports = Engine;
