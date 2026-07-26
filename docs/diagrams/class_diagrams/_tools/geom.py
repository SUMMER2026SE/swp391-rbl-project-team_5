# -*- coding: utf-8 -*-
"""Do hinh hoc tren ban SVG: phat hien chong chu, chu de len khung, chu tran canvas."""
import os, re, io, sys, json, collections
from xml.etree import ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, 'svg')
SVGNS = '{http://www.w3.org/2000/svg}'

issues = collections.defaultdict(list)
files = []
for dp, _, fns in os.walk(SVG):
    for f in sorted(fns):
        if f.endswith('.svg'):
            files.append(os.path.join(dp, f))


def text_box(el):
    """Hop bao quanh mot <text>. PlantUML luon dat x,y (y = baseline)."""
    try:
        x = float(el.get('x'))
        y = float(el.get('y'))
    except (TypeError, ValueError):
        return None
    fs = float(el.get('font-size', '14').replace('px', ''))
    txt = ''.join(el.itertext())
    if not txt.strip():
        return None
    # PlantUML ghi be rong thuc trong textLength -> dung so that, khong uoc luong
    tl = el.get('textLength')
    w = float(tl) if tl else len(txt) * fs * 0.6
    return (x, y - fs * 0.80, x + w, y + fs * 0.22, txt)


def overlap(a, b, pad=0.0):
    return not (a[2] - pad <= b[0] + pad or b[2] - pad <= a[0] + pad or
                a[3] - pad <= b[1] + pad or b[3] - pad <= a[1] + pad)


for path in files:
    name = os.path.basename(path)
    root = ET.parse(path).getroot()
    vb = root.get('viewBox')
    if vb:
        _, _, VW, VH = [float(v) for v in vb.split()]
    else:
        VW = float(re.sub(r'[^\d.]', '', root.get('width', '0')) or 0)
        VH = float(re.sub(r'[^\d.]', '', root.get('height', '0')) or 0)

    texts = [t for t in (text_box(e) for e in root.iter(SVGNS + 'text')) if t]
    rects = []
    for e in root.iter(SVGNS + 'rect'):
        try:
            x, y = float(e.get('x')), float(e.get('y'))
            w, h = float(e.get('width')), float(e.get('height'))
        except (TypeError, ValueError):
            continue
        if w > 40 and h > 30:          # khung class, bo qua o nho
            rects.append((x, y, x + w, y + h))

    # 1. hai chuoi de len nhau
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            a, b = texts[i], texts[j]
            if overlap(a[:4], b[:4], pad=1.0):
                issues['chong_chu'].append((name, a[4][:40], b[4][:40]))

    # 2. nhan quan he (chu nam ngoai moi khung) de len khung class
    for t in texts:
        inside = [r for r in rects if t[0] >= r[0] - 2 and t[2] <= r[2] + 2
                  and t[1] >= r[1] - 2 and t[3] <= r[3] + 2]
        if inside:
            continue
        for r in rects:
            if overlap(t[:4], r, pad=1.0):
                issues['nhan_de_len_khung_class'].append((name, t[4][:40]))
                break

    # 3. chu tran ra ngoai canvas
    for t in texts:
        if t[0] < -1 or t[1] < -1 or t[2] > VW + 1 or t[3] > VH + 1:
            issues['chu_tran_canvas'].append((name, t[4][:40],
                                              (round(t[0]), round(t[2]), round(VW))))

print('Do', len(files), 'so do\n')
total = 0
for k in sorted(issues):
    v = issues[k]
    total += len(v)
    per = collections.Counter(x[0] for x in v)
    print('[%s] %d truong hop / %d so do' % (k, len(v), len(per)))
    for x in v[:10]:
        print('    ', x)
    if len(v) > 10:
        print('     ... con', len(v) - 10)
    print('   so do bi nhieu nhat:', per.most_common(5))
    print()
print('TONG:', total)
json.dump({k: v for k, v in issues.items()},
          io.open(os.path.join(HERE, 'geom.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
