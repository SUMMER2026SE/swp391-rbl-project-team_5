# -*- coding: utf-8 -*-
import json, io, os, sys
sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r'C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5'
OUT = os.path.join(ROOT, 'docs', 'diagrams', 'class_diagrams')

report = json.load(io.open(os.path.join(HERE, 'report.json'), encoding='utf-8'))
sds = json.load(io.open(os.path.join(HERE, 'sds.json'), encoding='utf-8'))
mods = {m['no']: m for m in sds['modules']}

by_mod = {}
for r in report:
    by_mod.setdefault(r['module'], []).append(r)

rows = []
for no in sorted(by_mod):
    items = by_mod[no]
    d = items[0]['dir']
    m = mods[no]
    lines = [
        '# Module {}. {}'.format(no, m['name']),
        '',
        m['desc'].strip(),
        '',
        'Model Class Diagram cho {} chuc nang. Quy tac ve: [../README.md](../README.md).'.format(len(items)),
        '',
        '| # | Chuc nang | Model trong so do | Diagram |',
        '|---|---|---|---|',
    ]
    for it in items:
        lines.append('| {} | {} | {} | [PNG]({}.png) · [PUML]({}.puml) |'.format(
            it['no'], it['name'], ', '.join('`%s`' % x for x in it['models']), it['file'], it['file']))
    lines.append('')
    io.open(os.path.join(OUT, d, 'README.md'), 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    rows.append('| {} | {} | {} | [{}]({}/README.md) |'.format(no, m['name'], len(items), d, d))

print('\n'.join(rows))
