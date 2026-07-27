# -*- coding: utf-8 -*-
"""Audit 108 class diagram theo quy tac UML nguoi dung dat ra."""
import os, re, io, json, sys, collections

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r'C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5'
DIAG = os.path.join(ROOT, 'docs', 'diagrams', 'class_diagrams')
sch = json.load(io.open(os.path.join(HERE, 'schema.json'), encoding='utf-8'))
CURATED = json.load(io.open(os.path.join(HERE, 'curated.json'), encoding='utf-8'))
MODELS, ENUMS = sch['models'], sch['enums']

ATTR_RE = re.compile(r'^([-+#~])(\w+): ([A-Za-z][\w]*)((?: \{[^}]*\})?(?: \[[\d.*]+\])?(?: = .+)?)$')
METH_RE = re.compile(r'^(?:\{static\} )?([-+#~])(\w+)\(([^)]*)\): ([A-Za-z][\w]*)$')
REL_RE = re.compile(r'^(\w+) "([^"]+)" (\*--|o--|--|\.\.>|--\|>|\.\.\|>) "([^"]+)" (\w+)(?: : (\w+))?$')
VALID_CARD = re.compile(r'^(\d+|\*|0\.\.1|0\.\.\*|1\.\.\*|\d+\.\.\d+)$')

issues = collections.defaultdict(list)
files = []
for dp, _, fns in os.walk(DIAG):
    for f in sorted(fns):
        if f.endswith('.puml'):
            files.append(os.path.join(dp, f))

for path in files:
    name = os.path.basename(path)
    t = io.open(path, encoding='utf-8').read()
    classes = {}
    for c in re.finditer(r'class (\w+) <<model>> \{\n(.*?)\n\}', t, re.S):
        cname, body = c.group(1), c.group(2)
        attrs, meths, seen_sep = [], [], False
        for line in body.split('\n'):
            s = line.strip()
            if s == '--':
                seen_sep = True
                continue
            if not s:
                continue
            (meths if seen_sep else attrs).append(s)
        classes[cname] = (attrs, meths)

        # R0: khoa chinh ghep (@@id) phai hien du moi thanh phan
        cid = MODELS[cname].get('compositeId') or []
        if cid:
            shown = {m.group(1) for m in re.finditer(r'^-(\w+):', '\n'.join(attrs), re.M)}
            miss = [k for k in cid if k not in shown]
            if miss:
                issues['thieu_thanh_phan_khoa_ghep'].append((name, cname, miss))

        # R1: du 3 phan
        if not attrs:
            issues['class_thieu_thuoc_tinh'].append((name, cname))
        if not meths:
            issues['class_thieu_phuong_thuc'].append((name, cname))

        # R2: cu phap thuoc tinh
        for a in attrs:
            m = ATTR_RE.match(a)
            if not m:
                issues['cu_phap_thuoc_tinh'].append((name, cname, a))
                continue
            fname, ftype = m.group(2), m.group(3)
            real = {f['name']: f for f in MODELS[cname]['fields']}
            if fname not in real:
                issues['thuoc_tinh_khong_co_trong_schema'].append((name, cname, fname))
            elif real[fname]['type'] != ftype:
                issues['sai_kieu_du_lieu'].append((name, cname, fname, ftype, real[fname]['type']))

        # R3: cu phap phuong thuc
        for mm in meths:
            g = METH_RE.match(mm)
            if not g:
                issues['cu_phap_phuong_thuc'].append((name, cname, mm))
                continue
            params = g.group(3).strip()
            if params:
                for p in params.split(', '):
                    if not re.match(r'^\w+: [A-Za-z]\w*$', p):
                        issues['tham_so_thieu_kieu'].append((name, cname, mm, p))
            rt = g.group(4)
            if rt not in ('void', 'Boolean', 'Int', 'String', 'DateTime', 'Decimal', 'Float', 'Json') \
                    and rt not in MODELS and rt not in ENUMS:
                issues['kieu_tra_ve_la'].append((name, cname, mm, rt))

    # R4/R5/R6: quan he
    comp_parents = collections.defaultdict(set)
    for line in t.split('\n'):
        line = line.strip()
        if not REL_RE.match(line):
            if re.match(r'^\w+ "', line):
                issues['cu_phap_quan_he'].append((name, line))
            continue
        g = REL_RE.match(line)
        left, lc, arrow, rc, right, role = g.groups()
        for card, side in ((lc, 'trai'), (rc, 'phai')):
            if not VALID_CARD.match(card):
                issues['multiplicity_khong_hop_le'].append((name, line, card))
        if left not in classes or right not in classes:
            issues['quan_he_toi_class_khong_ve'].append((name, line))
        if not role:
            issues['quan_he_thieu_role_name'].append((name, line))
        if arrow in ('*--', 'o--'):
            # hinh thoi o phia toan the = ve trai; boi so phia toan the phai la 1 hoac 0..1
            if lc not in ('1', '0..1'):
                issues['composite_boi_so_sai'].append((name, line))
            if arrow == '*--':
                comp_parents[right].add(left)
    for child, parents in comp_parents.items():
        if len(parents) > 1:
            issues['part_co_nhieu_composite'].append((name, child, sorted(parents)))

    # doi chieu multiplicity + role name voi schema.prisma
    OVERRIDE = {('User', 'EmailVerificationToken'), ('User', 'PasswordResetToken'),
                ('User', 'UserProfile'), ('User', 'PartnerProfile'),
                ('Booking', 'Reservation'), ('Reservation', 'Booking')}
    SOFT_FK = {tuple(ex['pair']) for ex in CURATED.get('extraRelations', [])}
    SOFT_FK |= {(b, a) for a, b in SOFT_FK}
    for line in t.split('\n'):
        g = REL_RE.match(line.strip())
        if not g:
            continue
        parent, pc, arrow, cc, child, role = g.groups()
        if (parent, child) in SOFT_FK:
            continue
        # tim field FK ben child tro toi parent, khop theo role name cua back-reference
        back = None
        for bf in MODELS[parent]['fields']:
            if bf['isModelRef'] and bf['type'] == child and bf['name'] == role:
                back = bf
        if back is None:
            issues['role_name_khong_khop_schema'].append((name, line))
            continue
        rel_name = (back['relation'] or {}).get('name')
        fk = None
        for cf in MODELS[child]['fields']:
            if cf['isModelRef'] and cf['type'] == parent and (cf['relation'] or {}).get('name') == rel_name and (cf['relation'] or {}).get('fields'):
                fk = cf
        if fk is None or not (fk['relation'] or {}).get('fields'):
            issues['khong_tim_thay_fk'].append((name, line))
            continue
        fk_field = [f for f in MODELS[child]['fields'] if f['name'] in fk['relation']['fields']]
        want_pc = '0..1' if (fk_field and fk_field[0]['optional']) else '1'
        want_cc = '0..*' if back['list'] else '0..1'
        if pc != want_pc:
            issues['multiplicity_phia_toan_the_sai'].append((name, line, 'nen la ' + want_pc))
        if cc != want_cc and (parent, child) not in OVERRIDE:
            issues['multiplicity_phia_con_sai'].append((name, line, 'nen la ' + want_cc))

    # so do khong duoc tach thanh nhieu cum roi rac: moi class phai noi duoc
    # toi phan con lai, neu khong se co class troi lo lung khong quan he nao
    cls_names = list(classes)
    if len(cls_names) > 1:
        parent = {c: c for c in cls_names}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for line in t.split('\n'):
            g = REL_RE.match(line.strip())
            if g and g.group(1) in parent and g.group(5) in parent:
                ra, rb = find(g.group(1)), find(g.group(5))
                if ra != rb:
                    parent[ra] = rb
        comps = {find(c) for c in cls_names}
        if len(comps) > 1:
            groups = collections.defaultdict(list)
            for c in cls_names:
                groups[find(c)].append(c)
            issues['so_do_bi_tach_roi'].append((name, [sorted(v) for v in groups.values()]))

    # thieu quan he giua 2 class co FK truc tiep trong schema
    names = list(classes)
    drawn = set()
    for line in t.split('\n'):
        g = REL_RE.match(line.strip())
        if g:
            drawn.add(tuple(sorted((g.group(1), g.group(5)))))
    for a in names:
        for f in MODELS[a]['fields']:
            if f['isModelRef'] and f['type'] in names and f['type'] != a:
                if tuple(sorted((a, f['type']))) not in drawn:
                    issues['thieu_quan_he'].append((name, a, f['type'], f['name']))

print('Da kiem tra', len(files), 'file .puml\n')
total = 0
for k in sorted(issues):
    v = issues[k]
    total += len(v)
    print('[%s] %d' % (k, len(v)))
    for x in v[:6]:
        print('    ', x)
    if len(v) > 6:
        print('     ... con', len(v) - 6)
    print()
print('TONG SO VAN DE:', total)
