import re, json, io, sys
sys.stdout.reconfigure(encoding='utf-8')

PATH = r'C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5\vietticket-travel\backend\prisma\schema.prisma'
src = io.open(PATH, encoding='utf-8').read()

enums = {}
for m in re.finditer(r'^enum (\w+) \{(.*?)^\}', src, re.S | re.M):
    vals = [v.strip() for v in m.group(2).split('\n') if v.strip() and not v.strip().startswith('//')]
    enums[m.group(1)] = vals

models = {}
for m in re.finditer(r'^model (\w+) \{(.*?)^\}', src, re.S | re.M):
    name, body = m.group(1), m.group(2)
    fields, uniques, compositeId = [], [], []
    for line in body.split('\n'):
        s = line.strip()
        if not s or s.startswith('//'):
            continue
        if s.startswith('@@'):
            u = re.match(r'@@unique\(\[([^\]]+)\]', s)
            if u:
                uniques.append([x.strip() for x in u.group(1).split(',')])
            i = re.match(r'@@id\(\[([^\]]+)\]', s)
            if i:
                compositeId.extend(x.strip() for x in i.group(1).split(','))
            continue
        fm = re.match(r'(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$', s)
        if not fm:
            continue
        fname, ftype, isList, isOpt, attrs = fm.group(1), fm.group(2), bool(fm.group(3)), bool(fm.group(4)), fm.group(5)
        rel = re.search(r'@relation\((.*)\)', attrs)
        relinfo = None
        if rel:
            inner = rel.group(1)
            rname = re.match(r'"([^"]+)"', inner.strip())
            f = re.search(r'fields:\s*\[([^\]]+)\]', inner)
            r = re.search(r'references:\s*\[([^\]]+)\]', inner)
            od = re.search(r'onDelete:\s*(\w+)', inner)
            relinfo = {
                'name': rname.group(1) if rname else None,
                'fields': [x.strip() for x in f.group(1).split(',')] if f else [],
                'references': [x.strip() for x in r.group(1).split(',')] if r else [],
                'onDelete': od.group(1) if od else None,
            }
        dflt = re.search(r'@default\((\w+\([^)]*\)|[^)]*)\)', attrs)
        fields.append({
            'name': fname, 'type': ftype, 'list': isList, 'optional': isOpt,
            'id': '@id' in attrs, 'unique': '@unique' in attrs,
            'default': dflt.group(1) if dflt else None,
            'updatedAt': '@updatedAt' in attrs,
            'relation': relinfo,
            'isModelRef': None,
        })
    models[name] = {'fields': fields, 'compositeUnique': uniques, 'compositeId': compositeId}

for mn, mv in models.items():
    for f in mv['fields']:
        f['isModelRef'] = f['type'] in models
        f['isEnum'] = f['type'] in enums

json.dump({'models': models, 'enums': enums}, io.open('schema.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('models:', len(models), 'enums:', len(enums))
