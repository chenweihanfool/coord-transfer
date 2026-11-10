# -*- coding: utf-8 -*-
"""讀取段籍圖 shapefile（Polygon，TWD97），簡化後輸出為內嵌用的精簡格式。不需外部套件。"""
import struct


def read_dbf(path):
    b = open(path, 'rb').read()
    n, hlen, rlen = struct.unpack('<IHH', b[4:12])
    fields = []
    for i in range(32, hlen - 1, 32):
        f = b[i:i + 32]
        if f[0] == 0x0D:
            break
        fields.append((f[:11].split(b'\0')[0].decode('ascii'), f[16]))
    recs = []
    for r in range(n):
        o = hlen + r * rlen + 1
        rec = {}
        for name, ln in fields:
            raw = b[o:o + ln].rstrip(b' \0')
            o += ln
            for enc in ('utf-8', 'cp950'):   # 本批資料為 UTF-8；舊版段籍圖常為 Big5
                try:
                    rec[name] = raw.decode(enc).strip()
                    break
                except UnicodeDecodeError:
                    continue
            else:
                rec[name] = raw.decode('cp950', 'replace').strip()
        recs.append(rec)
    return recs


def read_shp(path):
    b = open(path, 'rb').read()
    o, out = 100, []
    while o < len(b):
        _, clen = struct.unpack('>2i', b[o:o + 8])
        o += 8
        rec = b[o:o + clen * 2]
        o += clen * 2
        if struct.unpack('<i', rec[:4])[0] == 0:
            out.append([])
            continue
        nparts, npts = struct.unpack('<2i', rec[36:44])
        parts = list(struct.unpack('<%di' % nparts, rec[44:44 + 4 * nparts])) + [npts]
        base = 44 + 4 * nparts
        xy = struct.unpack('<%dd' % (2 * npts), rec[base:base + 16 * npts])
        rings = []
        for k in range(nparts):
            rings.append([(xy[2 * i], xy[2 * i + 1]) for i in range(parts[k], parts[k + 1])])
        out.append(rings)
    return out


def dp(pts, tol):
    """Douglas-Peucker（迭代版）"""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, z = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[z]
        dx, dy = x2 - x1, y2 - y1
        L = (dx * dx + dy * dy) ** 0.5
        best, bi = -1, -1
        for i in range(a + 1, z):
            x, y = pts[i]
            d = abs(dy * (x - x1) - dx * (y - y1)) / L if L else ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, z)]
    return [p for p, k in zip(pts, keep) if k]


def ring_area(r):
    return sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1)) / 2


def point_in(rings, x, y):
    c = False
    for r in rings:
        j = len(r) - 1
        for i in range(len(r)):
            xi, yi = r[i]
            xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                c = not c
            j = i
    return c


def label_point(rings):
    """取最大外環的質心；若落在多邊形外，改以格網找最遠離邊界的內部點"""
    big = max(rings, key=lambda r: abs(ring_area(r)))
    A = ring_area(big)
    cx = sum((big[i][0] + big[i + 1][0]) * (big[i][0] * big[i + 1][1] - big[i + 1][0] * big[i][1]) for i in range(len(big) - 1)) / (6 * A)
    cy = sum((big[i][1] + big[i + 1][1]) * (big[i][0] * big[i + 1][1] - big[i + 1][0] * big[i][1]) for i in range(len(big) - 1)) / (6 * A)
    if point_in(rings, cx, cy):
        return cx, cy
    xs, ys = [p[0] for p in big], [p[1] for p in big]
    best = None
    for gi in range(1, 20):
        for gj in range(1, 20):
            x = min(xs) + (max(xs) - min(xs)) * gi / 20
            y = min(ys) + (max(ys) - min(ys)) * gj / 20
            if point_in(rings, x, y):
                d = min((x - p[0]) ** 2 + (y - p[1]) ** 2 for r in rings for p in r[::4])
                if best is None or d > best[0]:
                    best = (d, x, y)
    return (best[1], best[2]) if best else (cx, cy)


def load_boundaries(bases, tol=1.0):
    """回傳 [{no, ext, name, town, lab:[e,n], area, rings:[[e0,n0,de1,dn1,...] 整數公尺差分]}]"""
    feats = []
    for base in bases:
        recs, shapes = read_dbf(base + '.dbf'), read_shp(base + '.shp')
        for rec, rings in zip(recs, shapes):
            if not rings:
                continue
            area = sum(ring_area(r) for r in rings)
            lab = label_point(rings)
            enc = []
            for r in rings:
                s = dp(r, tol)
                if len(s) < 4:
                    continue
                flat, px, py = [], 0, 0
                for k, (x, y) in enumerate(s):
                    xi, yi = int(round(x)), int(round(y))
                    if k == 0:
                        flat += [xi, yi]
                    else:
                        if xi == px and yi == py:
                            continue
                        flat += [xi - px, yi - py]
                    px, py = xi, yi
                enc.append(flat)
            feats.append({'no': rec.get('SCNO', ''), 'ext': rec.get('SCNOEXT', ''), 'name': rec.get('SCNAME', ''),
                          'town': rec.get('LDCODE', '') + rec.get('TOWN', ''), 'lab': [round(lab[0]), round(lab[1])],
                          'area': round(abs(area)), 'rings': enc})
    return feats


if __name__ == '__main__':
    import json, os, sys
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    for tol in (0.5, 1.0, 2.0):
        f = load_boundaries([os.path.join(root, 'KC02', 'KC02'), os.path.join(root, 'KC03', 'KC03')], tol)
        s = json.dumps(f, ensure_ascii=False, separators=(',', ':'))
        print(tol, len(f), 'features', sum(len(r) // 2 for x in f for r in x['rings']), 'pts', len(s.encode('utf-8')) // 1024, 'KB')
    sys.stdout.reconfigure(encoding='utf-8')
    for x in f:
        print(x['town'], x['no'], x['ext'], x['name'], x['area'], len(x['rings']))
