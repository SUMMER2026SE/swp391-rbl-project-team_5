# -*- coding: utf-8 -*-
"""Thu cac bien the bo cuc cho tung so do con chong chu, tim bien the sach."""
import os, re, io, sys, subprocess, tempfile, shutil
from xml.etree import ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r'C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5'
DIAG = os.path.join(ROOT, 'docs', 'diagrams', 'class_diagrams')
JAR = os.path.join(ROOT, 'docs', 'diagrams', 'plantuml.jar')
SVGNS = '{http://www.w3.org/2000/svg}'

TARGETS = sys.argv[1:]

VARIANTS = [
    ('ortho-160-140', True, 160, 140, None),
    ('plain-160-140', False, 160, 140, None),
    ('plain-200-180', False, 200, 180, None),
    ('ortho-240-200', True, 240, 200, None),
    ('plain-lr-180-160', False, 180, 160, 'left to right direction'),
    ('ortho-lr-180-160', True, 180, 160, 'left to right direction'),
]


def boxes(svg_path):
    root = ET.parse(svg_path).getroot()
    out = []
    for el in root.iter(SVGNS + 'text'):
        try:
            x, y = float(el.get('x')), float(el.get('y'))
        except (TypeError, ValueError):
            continue
        fs = float(el.get('font-size', '14').replace('px', ''))
        txt = ''.join(el.itertext())
        if not txt.strip():
            continue
        tl = el.get('textLength')
        w = float(tl) if tl else len(txt) * fs * 0.6
        out.append((x, y - fs * 0.8, x + w, y + fs * 0.22, txt))
    return out


def n_overlap(svg_path):
    ts = boxes(svg_path)
    n = 0
    for i in range(len(ts)):
        for j in range(i + 1, len(ts)):
            a, b = ts[i], ts[j]
            if not (a[2] - 1 <= b[0] + 1 or b[2] - 1 <= a[0] + 1 or
                    a[3] - 1 <= b[1] + 1 or b[3] - 1 <= a[1] + 1):
                n += 1
    return n


def apply_variant(src, ortho, nodesep, ranksep, extra):
    t = io.open(src, encoding='utf-8').read()
    t = re.sub(r'skinparam nodesep \d+', 'skinparam nodesep %d' % nodesep, t)
    t = re.sub(r'skinparam ranksep \d+', 'skinparam ranksep %d' % ranksep, t)
    if not ortho:
        t = t.replace('skinparam linetype ortho\n', '')
    if extra:
        t = t.replace('hide circle\n', 'hide circle\n' + extra + '\n')
    return t


tmp = tempfile.mkdtemp()
for target in TARGETS:
    src = None
    for dp, _, fs in os.walk(DIAG):
        for f in fs:
            if f == target:
                src = os.path.join(dp, f)
    if not src:
        print('khong thay', target)
        continue
    print('\n===', target)
    for label, ortho, ns, rs, extra in VARIANTS:
        p = os.path.join(tmp, label + '.puml')
        io.open(p, 'w', encoding='utf-8', newline='\n').write(
            apply_variant(src, ortho, ns, rs, extra))
        subprocess.run(['java', '-jar', JAR, '-charset', 'UTF-8', '-tsvg', p],
                       capture_output=True)
        svg = p[:-5] + '.svg'
        if os.path.exists(svg):
            print('   %-18s chong chu: %d' % (label, n_overlap(svg)))
shutil.rmtree(tmp, ignore_errors=True)
