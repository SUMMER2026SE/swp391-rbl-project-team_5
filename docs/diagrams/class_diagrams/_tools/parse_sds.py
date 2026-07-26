import re, json, sys, io

sys.stdout.reconfigure(encoding='utf-8')
src = io.open('sds.md', encoding='utf-8').read().split('\n')

modules = []
funcs = []
cur_mod = None
cur_fn = None
section = None

for line in src:
    m = re.match(r'^## (\d+)\. (.+)$', line)
    if m and cur_mod is not None or (m and line.startswith('## ')):
        # only inside II. Code Designs
        pass
    if re.match(r'^# II\. Code Designs', line):
        cur_mod = 'START'
        continue
    if cur_mod is None:
        continue
    m = re.match(r'^## (\d+)\. (.+?)\s*$', line)
    if m:
        cur_mod = {'no': int(m.group(1)), 'name': m.group(2), 'desc': ''}
        modules.append(cur_mod)
        cur_fn = None
        continue
    m = re.match(r'^### (\d+)\.(\d+) (.+?)\s*$', line)
    if m:
        cur_fn = {
            'module_no': int(m.group(1)), 'no': m.group(1) + '.' + m.group(2),
            'idx': int(m.group(2)), 'name': m.group(3),
            'specs': [], 'queries': [], 'models_row': '',
        }
        funcs.append(cur_fn)
        section = None
        continue
    m = re.match(r'^#### ([a-d])\. (.+?)\s*$', line)
    if m:
        section = m.group(1)
        continue
    if cur_fn is None:
        if isinstance(cur_mod, dict) and line.strip() and not line.startswith('#'):
            cur_mod['desc'] += line.strip()
        continue
    if line.startswith('|'):
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if section == 'b':
            cur_fn['specs'].append(cells)
            if cells and cells[0].startswith('Prisma Model'):
                cur_fn['models_row'] = ' || '.join(cells[1:])
        elif section == 'd':
            cur_fn['queries'].append(cells)

for f in funcs:
    row = ''
    for cells in f['specs']:
        if cells and cells[0].lower().startswith('prisma model'):
            row = cells[1] if len(cells) > 1 else ''
            f['models_detail'] = ' | '.join(cells[1:])
    f['models'] = [x.strip() for x in re.split(r'[,;/]| và ', row) if x.strip() and re.match(r'^[A-Z][A-Za-z]+$', x.strip())]
    f['query_text'] = ' '.join(c[0] for c in f['queries'] if c)
    f['query_purpose'] = ' '.join(c[1] for c in f['queries'] if len(c) > 1)

json.dump({'modules': modules, 'funcs': funcs}, io.open('sds.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('modules:', len(modules), 'funcs:', len(funcs))
for mo in modules:
    fs = [f for f in funcs if f['module_no'] == mo['no']]
    print(f"  {mo['no']}. {mo['name']}  ({len(fs)} fn)")
