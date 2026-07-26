# -*- coding: utf-8 -*-
"""Vong kiem cuoi: file rac, nhat quan ten/so/module, ngu nghia method vs chuc nang."""
import os, re, io, json, sys, collections

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r'C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5'
DIAG = os.path.join(ROOT, 'docs', 'diagrams', 'class_diagrams')

report = json.load(io.open(os.path.join(HERE, 'report.json'), encoding='utf-8'))
skipped = json.load(io.open(os.path.join(HERE, 'skipped.json'), encoding='utf-8'))
sds = json.load(io.open(os.path.join(HERE, 'sds.json'), encoding='utf-8'))
fns = {f['no']: f for f in sds['funcs']}

issues = collections.defaultdict(list)

# ---- 1. file rac / thieu cap .puml-.png ----
expect = set()
for r in report:
    expect.add(os.path.join(DIAG, r['dir'], r['file'] + '.puml'))
    expect.add(os.path.join(DIAG, r['dir'], r['file'] + '.png'))
found = set()
for dp, dns, fs in os.walk(DIAG):
    if '_tools' in dp:
        continue
    for f in fs:
        if f.endswith(('.puml', '.png')):
            found.add(os.path.join(dp, f))
for p in sorted(found - expect):
    issues['file_rac_khong_thuoc_bo_hien_tai'].append(os.path.relpath(p, DIAG))
for p in sorted(expect - found):
    issues['file_thieu'].append(os.path.relpath(p, DIAG))

# ---- 2. nhat quan: so muc, ten chuc nang, module folder ----
MODULE_SLUG = {1: '01_auth_user_account', 2: '02_attraction_discovery_reviews',
               3: '03_partner_attraction_management', 4: '04_ticket_product_reservation',
               5: '05_booking_payment_refund', 6: '06_staff_operations',
               7: '07_support_messaging', 8: '08_admin_moderation',
               9: '09_ai_weather_newsletter'}
for r in report:
    fn = fns[r['no']]
    path = os.path.join(DIAG, r['dir'], r['file'] + '.puml')
    t = io.open(path, encoding='utf-8').read()
    m = re.search(r'^title (.+?) - Model Class Diagram$', t, re.M)
    if not m:
        issues['thieu_title'].append(r['file'])
    elif m.group(1) != fn['name']:
        issues['title_khac_ten_trong_sds'].append((r['no'], m.group(1), fn['name']))
    if not r['file'].startswith(r['no'].replace('.', '_') + '_'):
        issues['ten_file_khong_khop_so_muc'].append((r['no'], r['file']))
    if r['dir'] != MODULE_SLUG[fn['module_no']]:
        issues['sai_thu_muc_module'].append((r['no'], r['dir']))

# ---- 3. chu ky method phai giong nhau o moi so do ----
sigs = collections.defaultdict(set)
for r in report:
    t = io.open(os.path.join(DIAG, r['dir'], r['file'] + '.puml'), encoding='utf-8').read()
    for c in re.finditer(r'class (\w+) <<model>> \{\n(.*?)\n\}', t, re.S):
        cname = c.group(1)
        for line in c.group(2).split('\n'):
            s = line.strip()
            if s.startswith(('+', '{static}')):
                base = re.sub(r'\(.*', '', s.replace('{static} ', '').lstrip('+'))
                sigs[(cname, base)].add(s)
for k, v in sigs.items():
    if len(v) > 1:
        issues['chu_ky_method_khong_nhat_quan'].append((k, sorted(v)))

# ---- 4. chuc nang chi doc nhung lai co method ghi ----
READ_ONLY = re.compile(r'^(List|View|Get|Search|Lookup|Preview)\b')
WRITE = re.compile(r'^\{static\}|^\+(create|update|delete|remove|issue|open|place|post|add|assign|'
                   r'grant|attach|link|save|subscribe|hold|record|acquire|start|submit|generate)\(')
for r in report:
    fn = fns[r['no']]
    if not READ_ONLY.match(fn['name']):
        continue
    t = io.open(os.path.join(DIAG, r['dir'], r['file'] + '.puml'), encoding='utf-8').read()
    for c in re.finditer(r'class (\w+) <<model>> \{\n(.*?)\n\}', t, re.S):
        for line in c.group(2).split('\n'):
            s = line.strip()
            if s.startswith(('+', '{static}')) and WRITE.match(s):
                issues['chuc_nang_chi_doc_co_method_ghi'].append((r['no'], fn['name'], c.group(1), s))

# ---- 4b. model chi do middleware nap khong duoc xuat hien tren so do ----
import importlib.util
_s = importlib.util.spec_from_file_location('gen', os.path.join(HERE, 'gen.py'))
_g = importlib.util.module_from_spec(_s)
_s.loader.exec_module(_g)
for M in ('AuthSession', 'PartnerProfile', 'UserRoleMembership'):
    for r in report:
        if M not in r['models']:
            continue
        core = _g.strip_middleware(fns[r['no']]['query_text'])
        if not re.search(r'(?:prisma|tx)\.' + _g.camel(M) + r'\.\w+', core):
            issues['model_chi_do_middleware_nap'].append((r['no'], r['name'], M))

# ---- 5. moi chuc nang trong SDS phai co dung 1 so do hoac nam trong danh sach bo qua ----
covered = {r['no'] for r in report} | {s['no'] for s in skipped}
for no in fns:
    if no not in covered:
        issues['chuc_nang_chua_co_so_do'].append(no)
dups = [k for k, v in collections.Counter([r['no'] for r in report]).items() if v > 1]
if dups:
    issues['so_muc_bi_trung'].append(dups)

print('So do:', len(report), '| bo qua:', len(skipped), '| chuc nang SDS:', len(fns), '\n')
total = 0
for k in sorted(issues):
    v = issues[k]
    total += len(v)
    print('[%s] %d' % (k, len(v)))
    for x in v[:8]:
        print('    ', x)
    if len(v) > 8:
        print('     ... con', len(v) - 8)
    print()
print('TONG:', total)
