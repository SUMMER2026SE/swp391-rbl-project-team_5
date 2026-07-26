# -*- coding: utf-8 -*-
"""Soi chat luong mo hinh, khong chi cu phap."""
import os, re, io, json, sys, collections

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r'C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5'
DIAG = os.path.join(ROOT, 'docs', 'diagrams', 'class_diagrams')
sch = json.load(io.open(os.path.join(HERE, 'schema.json'), encoding='utf-8'))
MODELS = sch['models']
ENUMS = sch['enums']

issues = collections.defaultdict(list)
files = []
for dp, _, fns in os.walk(DIAG):
    for f in sorted(fns):
        if f.endswith('.puml'):
            files.append(os.path.join(dp, f))

SETTER = re.compile(r'^\+(set|change)([A-Z]\w*)\((\w+): (\w+)\): void$')

for path in files:
    name = os.path.basename(path)
    t = io.open(path, encoding='utf-8').read()
    for c in re.finditer(r'class (\w+) <<model>> \{\n(.*?)\n\}', t, re.S):
        cname, body = c.group(1), c.group(2)
        attrs, meths, sep = [], [], False
        for line in body.split('\n'):
            s = line.strip()
            if s == '--':
                sep = True
                continue
            if s:
                (meths if sep else attrs).append(s)

        # 1. setter tra hinh: set<Field>(field: T) trung ten thuoc tinh
        for m in meths:
            g = SETTER.match(m)
            if g and g.group(1) == 'set':
                # bat MOI set<X>(x: T) co tham so trung ten thuoc tinh, ke ca
                # truong hop setActive <-> isActive (kieu dat ten khac nhau)
                param = g.group(3)
                if any(a.startswith('-' + param + ':') for a in attrs):
                    issues['setter_tra_hinh'].append((name, cname, m))

        # 2. changeStatus chi thua khi trong cung class da co method CHUYEN TRANG THAI
        #    vong doi. Method chi bat/tat co phu (clearRejection, updateDraft...) thay
        #    doi field khac nen changeStatus van la mot thay doi rieng, khong phai thua.
        IMPLIES_STATUS = {
            'submitForReview', 'reject', 'suspend', 'archive', 'restore', 'approve',
            'markProcessed', 'markSucceeded', 'markFailed', 'markPaid', 'complete',
            'cancel', 'close', 'resolve', 'checkIn', 'hide', 'unhide', 'consume',
            'revoke', 'reactivate', 'activate', 'deactivate', 'unsubscribe',
            'resubscribe', 'startProcessing', 'reconcile',
        }
        lifecycle = [m for m in meths
                     if re.match(r'^\+(\w+)', m) and re.match(r'^\+(\w+)', m).group(1) in IMPLIES_STATUS]
        if any(m.startswith('+changeStatus(') for m in meths) and lifecycle:
            issues['changeStatus_thua'].append((name, cname, lifecycle))

        # 3. class chi co id/FK. AttractionCategory duoc mien: schema chi co 2 FK.
        biz = [a for a in attrs if not re.match(r'^-(id|\w+Id): ', a)]
        if not biz and cname != 'AttractionCategory':
            issues['class_toan_khoa'].append((name, cname, attrs))

        # 7. hang so enum mac dinh phai ton tai trong enum do
        for a in attrs:
            g = re.match(r'^-(\w+): (\w+).* = ([A-Za-z_]\w*)$', a)
            if g and g.group(2) in sch['enums']:
                if g.group(3) not in sch['enums'][g.group(2)]:
                    issues['hang_so_enum_khong_ton_tai'].append((name, cname, a))

        # 8. {static} chi dung cho factory tra ve chinh model
        for m in meths:
            if m.startswith('{static}'):
                if not m.rstrip().endswith(': ' + cname):
                    issues['static_khong_phai_factory'].append((name, cname, m))
            else:
                if m.rstrip().endswith(': ' + cname):
                    issues['factory_thieu_static'].append((name, cname, m))

        # 4. default kieu String khong dat trong nhay kep
        for a in attrs:
            g = re.match(r'^-(\w+): String.*= (.+)$', a)
            if g and not g.group(2).startswith('"'):
                issues['default_string_khong_nhay'].append((name, cname, a))

        # 5. trung ten phuong thuc trong cung class
        base = [re.sub(r'\(.*', '', m.replace('{static} ', '')) for m in meths]
        dup = [x for x, n in collections.Counter(base).items() if n > 1]
        if dup:
            issues['trung_ten_phuong_thuc'].append((name, cname, dup))

        # 6. thuoc tinh vua optional vua co default
        for a in attrs:
            if '[0..1]' in a and ' = ' in a:
                issues['optional_va_default'].append((name, cname, a))

    # 9. quan he trung lap y het nhau
    rels = [l.strip() for l in t.split('\n') if re.match(r'^\w+ "', l.strip())]
    for r, n in collections.Counter(rels).items():
        if n > 1:
            issues['quan_he_trung_lap'].append((name, r, n))

    # 10. so do chi co mot lop -> khong the hien quan he nao
    ncls = len(re.findall(r'class \w+ <<model>>', t))
    if ncls < 2:
        issues['so_do_mot_lop'].append((name, ncls))

print('Kiem tra', len(files), 'file\n')
total = 0
for k in sorted(issues):
    v = issues[k]
    total += len(v)
    print('[%s] %d truong hop' % (k, len(v)))
    for x in v[:5]:
        print('    ', x)
    if len(v) > 5:
        print('     ... con', len(v) - 5)
    print()
print('TONG:', total)
