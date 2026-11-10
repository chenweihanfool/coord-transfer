# -*- coding: utf-8 -*-
"""
坐標轉換工具 — 建置腳本
  python build.py          產生 docs/坐標轉換工具.html、docs/index.html、docs/latest.json、tests/test.html
說明：
  * 參數庫由 sections.json 指定的參數資料夾 (.inp) 讀入並嵌入 HTML。
  * 版本號與版本歷程寫在 src/version.json，發佈新版前請先更新。
"""
import glob
import hashlib
import json
import os
import re
import sys
from datetime import date

import shpread

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
DIST = os.path.join(HERE, 'docs')   # GitHub Pages 發佈目錄
TESTS = os.path.join(HERE, 'tests')


def read_text(path):
    raw = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'cp950', 'big5', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('latin-1')


def parse_inp(text):
    ctrl, samples = [], []
    for line in text.splitlines():
        t = re.split(r'[\s,]+', line.strip())
        if len(t) < 4:
            continue
        try:
            ip = int(t[1])
            nums = [float(x) for x in t[2:6]]
        except ValueError:
            continue
        if ip < 7 and len(nums) >= 4:
            ctrl.append([t[0][:8], ip] + nums[:4])
        elif ip < 9:
            samples.append([t[0][:8], ip] + nums[:2])
    return ctrl, samples


def js_json(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


def build_library(cfg_path):
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    root = os.path.normpath(os.path.join(HERE, cfg['root']))
    sets = []
    for s in cfg['sets']:
        f = os.path.join(root, s['file'])
        ctrl, samples = parse_inp(read_text(f))
        notes = [s.get('note', '')] if s.get('note') else []
        readme = os.path.join(os.path.dirname(f), '說明.txt')
        if os.path.exists(readme):
            notes.append('說明.txt：' + read_text(readme).strip().replace('\r\n', ' / '))
        hist = []
        if s.get('history'):
            for h in sorted(glob.glob(os.path.join(root, s['history']))):
                if '經緯度' in h:
                    continue
                hc, _ = parse_inp(read_text(h))
                label = os.path.basename(os.path.dirname(h))
                hist.append({'label': label, 'file': os.path.relpath(h, root).replace('\\', '/'), 'points': hc})
        npar = s.get('npar') or (6 if len(ctrl) >= 3 else 4)
        sets.append({
            'id': s['id'], 'name': s['name'], 'sections': s.get('sections', []),
            'note': '\n'.join(notes), 'file': s['file'], 'npar': npar, 'colloc': True,
            'points': ctrl, 'samples': samples, 'history': hist,
        })
    log = ''
    if cfg.get('log') and os.path.exists(os.path.join(root, cfg['log'])):
        log = read_text(os.path.join(root, cfg['log']))
    bounds = []
    if cfg.get('boundaries'):
        bounds = shpread.load_boundaries([os.path.normpath(os.path.join(HERE, b)) for b in cfg['boundaries']], tol=1.0)
    lib = {'sets': sets, 'log': log, 'bounds': bounds}
    digest = hashlib.sha1(js_json(lib).encode('utf-8')).hexdigest()[:10]
    lib['hash'] = digest
    lib['built'] = date.today().isoformat()
    return lib, root


def build_tests(root):
    cases = []
    for interp in sorted(glob.glob(os.path.join(root, '**', 'interp.out'), recursive=True)):
        d = os.path.dirname(interp)
        inps = [p for p in glob.glob(os.path.join(d, '*.inp')) if '經緯度' not in p]
        outs = [p for p in glob.glob(os.path.join(d, '*.out')) if os.path.basename(p).lower() != 'interp.out']
        if not inps or not outs:
            continue
        inp = inps[0]
        base = os.path.splitext(os.path.basename(inp))[0]
        out = next((o for o in outs if os.path.splitext(os.path.basename(o))[0] == base), outs[0])
        out_txt = read_text(out)
        npar = 4 if 'A(5)' not in out_txt else 6
        aff = os.path.join(d, 'HELMERT4.OUT' if npar == 4 else 'AFFINE6.OUT')
        cases.append({
            'label': os.path.relpath(d, root).replace('\\', '/'), 'npar': npar,
            'inp': read_text(inp), 'out': out_txt,
            'aff': read_text(aff) if os.path.exists(aff) else '',
            'resid': read_text(os.path.join(d, 'resid.ne')),
            'interp': read_text(interp),
        })
    return cases


def main():
    ver = json.load(open(os.path.join(SRC, 'version.json'), encoding='utf-8'))
    lib, root = build_library(os.path.join(HERE, 'sections.json'))
    engine = open(os.path.join(SRC, 'engine.js'), encoding='utf-8').read()
    app = open(os.path.join(SRC, 'app.js'), encoding='utf-8').read()
    tpl = open(os.path.join(SRC, 'template.html'), encoding='utf-8').read()
    html = (tpl.replace('/*__ENGINE__*/', engine)
               .replace('/*__APP__*/', app)
               .replace('__VERSION_JSON__', js_json(ver))
               .replace('__LIBRARY_JSON__', js_json(lib))
               .replace('__APP_VERSION__', ver['version']))
    os.makedirs(DIST, exist_ok=True)
    out_name = '坐標轉換工具.html'
    with open(os.path.join(DIST, out_name), 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    with open(os.path.join(DIST, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)   # Pages 首頁＝線上版工具
    latest = {'version': ver['version'], 'date': ver['date'], 'file': out_name,
              'notes': ver['changelog'][0]['items'] if ver.get('changelog') else []}
    with open(os.path.join(DIST, 'latest.json'), 'w', encoding='utf-8') as f:
        json.dump(latest, f, ensure_ascii=False, indent=2)
    # 測試頁
    cases = build_tests(root)
    test_tpl = open(os.path.join(SRC, 'test.template.html'), encoding='utf-8').read()
    os.makedirs(TESTS, exist_ok=True)
    with open(os.path.join(TESTS, 'test.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(test_tpl.replace('/*__ENGINE__*/', engine).replace('__CASES__', js_json(cases)))
    print(f"v{ver['version']}  sections={len(lib['bounds'])}  sets={len(lib['sets'])}  points={sum(len(s['points']) for s in lib['sets'])}  "
          f"tests={len(cases)}  html={len(html)//1024}KB")


if __name__ == '__main__':
    sys.exit(main())
