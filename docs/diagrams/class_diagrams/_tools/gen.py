# -*- coding: utf-8 -*-
"""Sinh Model Class Diagram (.puml) cho tung chuc nang trong SDS."""
import json, io, re, os, sys, unicodedata

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r'C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5'
OUT_ROOT = os.path.join(ROOT, 'docs', 'diagrams', 'class_diagrams')

sds = json.load(io.open(os.path.join(HERE, 'sds.json'), encoding='utf-8'))
sch = json.load(io.open(os.path.join(HERE, 'schema.json'), encoding='utf-8'))
MODELS, ENUMS = sch['models'], sch['enums']
CURATED = json.load(io.open(os.path.join(HERE, 'curated.json'), encoding='utf-8'))

MODULE_SLUG = {
    1: '01_auth_user_account',
    2: '02_attraction_discovery_reviews',
    3: '03_partner_attraction_management',
    4: '04_ticket_product_reservation',
    5: '05_booking_payment_refund',
    6: '06_staff_operations',
    7: '07_support_messaging',
    8: '08_admin_moderation',
    9: '09_ai_weather_newsletter',
}

# Composition: moi model con chi duoc thuoc DUNG MOT lop toan the (rang buoc UML).
# Quan he toi cac lop khac cua cung model con phai la Association.
COMPOSITION_PARENT = {
    'UserProfile': 'User',
    'PartnerProfile': 'User',
    'EmailVerificationToken': 'User',
    'PasswordResetToken': 'User',
    'AuthSession': 'User',
    'OAuthAccount': 'User',
    'UserRoleMembership': 'User',
    'FavoriteAttraction': 'User',
    'AttractionImage': 'Attraction',
    'AttractionCategory': 'Attraction',
    'TicketProduct': 'Attraction',
    'SpecialDate': 'Attraction',
    'AttractionDailyStock': 'Attraction',
    'StaffAttractionAssignment': 'Attraction',
    'TimeSlot': 'TicketProduct',
    'DailyStock': 'TicketProduct',
    'TimeSlotStock': 'TimeSlot',
    'TicketInstance': 'Booking',
    'Payment': 'Booking',
    'RefundTransaction': 'RefundRequest',
    'PartnerSettlementItem': 'PartnerSettlement',
    'SupportMessage': 'SupportTicket',
}

TYPE_MAP = {
    'String': 'String', 'Int': 'Int', 'Float': 'Float', 'Boolean': 'Boolean',
    'DateTime': 'DateTime', 'Decimal': 'Decimal', 'Json': 'Json', 'BigInt': 'BigInt',
    'Bytes': 'Bytes',
}

HASHED_FIELDS = {'token', 'tokenHash', 'passwordHash'}

# Model chi do middleware nap (protect / requirePartner). Khong duoc keo vao so do
# qua buoc noi lai do thi - chi giu khi chuc nang that su doc/ghi chung.
MIDDLEWARE_ONLY = {'AuthSession', 'PartnerProfile', 'UserRoleMembership'}

# Method thuc su chuyen trang thai vong doi -> da bao ham viec doi `status`.
IMPLIES_STATUS = {
    'submitForReview', 'reject', 'suspend', 'archive', 'restore', 'approve',
    'markProcessed', 'markSucceeded', 'markFailed', 'markPaid', 'complete',
    'cancel', 'close', 'resolve', 'checkIn', 'hide', 'unhide', 'consume',
    'revoke', 'reactivate', 'activate', 'deactivate', 'unsubscribe', 'resubscribe',
    'startProcessing', 'reconcile',
}

FALLBACK_LOG = []
_NESTED_CACHE = {}


def camel(name):
    return name[0].lower() + name[1:]


def slugify(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^A-Za-z0-9]+', '-', s).strip('-').lower()
    return s


KNOWN_OPS = {'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
             'findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'}


def ops_for(model, text, fn=None):
    """SDS viet ca dang `prisma.x.update(...)` lan `x.update(...)` trong $transaction([...]).
    Truyen fn de tinh them cac lan ghi long tu loi goi cua model cha."""
    c = camel(model)
    found = set()
    for m in re.finditer(r'(?:(?:prisma|tx)\.)?\b' + re.escape(c) + r'\.(\w+)', text):
        if m.group(1) in KNOWN_OPS:
            found.add(m.group(1))
    if fn is not None:
        found |= nested_writes(fn).get(model, (set(), {}))[0]
    return found


def _balanced(text, start, open_ch, close_ch):
    """Tra ve noi dung tu sau ky tu mo den ky tu dong tuong ung (khop long nhau)."""
    if start >= len(text) or text[start] != open_ch:
        return None, start
    depth, i = 0, start
    while i < len(text):
        if text[i] == open_ch:
            depth += 1
        elif text[i] == close_ch:
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i + 1
        i += 1
    return text[start + 1:], len(text)


def _top_level_pairs(blob):
    """Tach `field: value` o cap ngoai cung; bo qua object/array long nhau."""
    out, depth, buf = [], 0, ''
    for ch in blob:
        if ch in '{[(':
            depth += 1
        elif ch in '}])':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(buf)
            buf = ''
        else:
            buf += ch
    out.append(buf)
    return out


def _pairs_of(blob):
    """{field: value} o cap ngoai cung cua mot khoi data."""
    out = {}
    for seg in _top_level_pairs(blob):
        fm = re.match(r'\s*(\w+)\s*(?::\s*(.*))?$', seg.strip(), re.S)
        if fm and fm.group(1) != 'where':
            out[fm.group(1)] = (fm.group(2) or '').strip()
    return out


def _obj_after(text):
    """Object dau tien trong mot doan; chiu duoc ca `status === 'X' ? {..} : {..}`."""
    i = text.find('{')
    return _balanced(text, i, '{', '}')[0] if i >= 0 else None


def _data_blob(call):
    """Khoi data cua mot loi goi, doc theo cau truc chu khong tim chuoi tho.

    Phai boc lop ngoai truoc roi moi lay khoa `data`/`update`, neu khong mot
    `data:` hoac `update:` nam long ben trong se bi hieu nham la cua loi goi nay.
    """
    outer = _obj_after(call)
    if outer is None:
        return None
    pairs = _pairs_of(outer)
    if 'data' in pairs:                       # create/update/updateMany
        return _obj_after(pairs['data'])
    if 'update' in pairs and 'create' in pairs:   # upsert -> nhanh doi trang thai
        return _obj_after(pairs['update'])
    return outer                              # dang rut gon trong $transaction


MW_GUARDS = ('protect', 'requireAuth', 'requirePartner', 'requireApprovedPartner',
             'requireRole', 'requireAdmin', 'requireStaff', 'optionalAuth')


def strip_middleware(text):
    """Bo phan do middleware thuc hien. SDS viet hai kieu:
    `Middleware: protect loads User/AuthSession; ...` va `protect: prisma.authSession.findUnique(...)`.
    Model chi xuat hien o day thi khong phai thanh phan cua chuc nang."""
    out = re.sub(r'Middleware:[^.]*\.', ' ', text)
    pat = re.compile(r'\b(?:' + '|'.join(MW_GUARDS) + r')\s*:\s*(?:prisma|tx)\.\w+\.\w+\(')
    while True:
        m = pat.search(out)
        if not m:
            return out
        _, end = _balanced(out, m.end() - 1, '(', ')')
        out = out[:m.start()] + ' ' + out[end:]


def _calls(model, text, ops):
    c = camel(model)
    pat = re.compile(r'(?:(?:prisma|tx)\.)?\b' + re.escape(c) + r'\.(?:' + '|'.join(ops) + r')\(')
    for m in pat.finditer(text):
        call, _ = _balanced(text, m.end() - 1, '(', ')')
        if call is not None:
            yield call


def nested_writes(fn):
    """SDS viet nested write: `user.update({ data: { profile: { update: {...} } } })`
    hoac `user.create({ data: { profile: { create: {...} } } })`. Khi do model con
    moi la thu bi thay doi, khong phai model cha. Tra ve {Model: (ops, fields)}."""
    key = fn['no']
    if key in _NESTED_CACHE:
        return _NESTED_CACHE[key]
    res = {}
    text = fn['query_text']
    for parent in MODELS:
        rel_of = {f['name']: f['type'] for f in MODELS[parent]['fields'] if f['isModelRef']}
        if not rel_of:
            continue
        for call in _calls(parent, text, ['create', 'update', 'updateMany', 'upsert']):
            blob = _data_blob(call)
            if not blob:
                continue
            for k, v in _pairs_of(blob).items():
                if k not in rel_of or not v.startswith('{'):
                    continue
                inner = _balanced(v, 0, '{', '}')[0] or ''
                child = rel_of[k]
                ops, flds = res.setdefault(child, (set(), {}))
                ipairs = _pairs_of(inner)
                for op in ('create', 'update', 'upsert', 'deleteMany', 'delete'):
                    if op not in ipairs:
                        continue
                    ops.add(op)
                    sub = _obj_after(ipairs[op])
                    if not sub:
                        continue
                    spairs = _pairs_of(sub)
                    if op == 'upsert' and 'update' in spairs:
                        # nested upsert: nhanh doi trang thai nam sau mot cap nua
                        ops.add('update')
                        sub = _obj_after(spairs['update']) or sub
                        spairs = _pairs_of(sub)
                    flds.update(spairs)
    _NESTED_CACHE[key] = res
    return res


def written_calls(model, fn):
    """Tra ve DANH SACH cac lan update, moi lan la mot dict {field: value}.

    Phai tach theo tung loi goi: `status` va `refundRequired` co the thuoc hai
    nhanh nghiep vu khac nhau, gop chung lai se lam mat mot hanh dong.
    """
    calls = []
    rel_names = {f['name'] for f in MODELS[model]['fields'] if f['isModelRef']}
    real = {f['name'] for f in MODELS[model]['fields']}
    for call in _calls(model, fn['query_text'], ['updateMany', 'update', 'upsert']):
        blob = _data_blob(call)
        if blob is None:
            continue
        d = {}
        for k, v in _pairs_of(blob).items():
            if v.startswith('{') and k in rel_names:
                continue
            if k in real:
                d[k] = v
        if d:
            calls.append(d)
    ops, nf = nested_writes(fn).get(model, (set(), {}))
    if ops & {'update', 'upsert'}:
        d = {k: v for k, v in nf.items() if k in real and not (v.startswith('{') and k in rel_names)}
        if d:
            calls.append(d)
    return calls


def written_fields(model, fn):
    """field -> gia tri, lay tu data:{...} cua update/upsert (khong tinh create),
    cong them cac lan ghi long trong loi goi cua model cha."""
    fields = {}
    rel_names = {f['name'] for f in MODELS[model]['fields'] if f['isModelRef']}
    for call in _calls(model, fn['query_text'], ['updateMany', 'update', 'upsert']):
        blob = _data_blob(call)
        if blob is None:
            continue
        for k, v in _pairs_of(blob).items():
            # Chi bo qua khi la ghi long xuong model con. Con `{ increment: 1 }`
            # van la thay doi cua chinh field nay, phai giu.
            if v.startswith('{') and k in rel_names:
                continue
            fields[k] = v
    ops, nf = nested_writes(fn).get(model, (set(), {}))
    if ops & {'update', 'upsert'}:
        fields.update({k: v for k, v in nf.items() if not v.startswith('{')})
    # Chi giu key la field co that cua model. SDS hay viet `data: profileUpdate`
    # (bien) nen co the lot vao nhung ten nhu 'create'/'update'.
    real = {f['name'] for f in MODELS[model]['fields']}
    return {k: v for k, v in fields.items() if k in real}


def pick_attributes(model, fn, selected, hints=()):
    """hints: ten field xuat hien trong tham so cua cac method se hien thi -
    phai hien thuoc tinh do, neu khong method tham chieu toi thu khong ve."""
    spec = MODELS[model]['fields']
    text = fn['query_text'] + ' ' + fn['query_purpose'] + ' ' + fn.get('models_detail', '')
    ov = CURATED.get('attributes', {}).get(model, {})
    # Khoa chinh ghep (@@id) luon phai hien du: bang noi ma giau mot nua khoa
    # thi khong con y nghia dinh danh.
    forced = set(ov.get('always', [])) | set(hints) | set(MODELS[model].get('compositeId', []))
    scalars = [f for f in spec if not f['isModelRef'] and not f['list']]
    by_name = {f['name']: f for f in scalars}

    keep = []
    for f in scalars:
        n = f['name']
        if f['id'] or n in forced:
            keep.append(n)
            continue
        if re.search(r'\b' + re.escape(n) + r'\b', text):
            keep.append(n)
            continue
        # FK tro toi model khac cung duoc chon
        for rf in MODELS[model]['fields']:
            if rf['isModelRef'] and rf['relation'] and n in (rf['relation']['fields'] or []):
                if rf['type'] in selected:
                    keep.append(n)
                    break

    keep = list(dict.fromkeys(keep))

    # Moi class phai co it nhat 2 thuoc tinh nghiep vu (khong phai khoa/FK) neu schema co,
    # neu khong so do chi toan khoa va khong noi len dieu gi.
    def is_key(n):
        return n == 'id' or n.endswith('Id')

    def biz_count():
        return len([n for n in keep if not is_key(n)])

    if biz_count() < 2:
        for pool in (
            [f for f in scalars if f['isEnum'] or f['type'] == 'Boolean'],
            [f for f in scalars if f['name'] in ('name', 'title', 'subject', 'code', 'email')],
            [f for f in scalars if not is_key(f['name']) and f['name'] not in ('createdAt', 'updatedAt')],
            [f for f in scalars if not is_key(f['name'])],
        ):
            for f in pool:
                if biz_count() >= 2:
                    break
                if f['name'] not in keep:
                    keep.append(f['name'])
            if biz_count() >= 2:
                break

    # Thu tu: ID -> FK -> nghiep vu -> trang thai -> thoi gian -> audit;
    # trong cung nhom giu nguyen thu tu khai bao trong schema.prisma.
    pos = {f['name']: i for i, f in enumerate(scalars)}

    def rank(n):
        f = by_name[n]
        if f['id']:
            bucket = 0
        elif n.endswith('Id'):
            bucket = 1
        elif f['isEnum'] or f['type'] == 'Boolean' or n == 'status':
            bucket = 3
        elif n in ('createdAt', 'updatedAt'):
            bucket = 5
        elif f['type'] == 'DateTime':
            bucket = 4
        else:
            bucket = 2
        return (bucket, pos[n])

    keep.sort(key=rank)
    keep = keep[: int(ov.get('max', 8))]

    lines = []
    for n in keep:
        f = by_name[n]
        t = TYPE_MAP.get(f['type'], f['type'])
        marks = []
        if f['id'] and f['default'] == 'uuid()':
            marks.append('UUID')
        elif f['default'] == 'uuid()':
            marks.append('UUID')
        if f['unique']:
            marks.append('unique')
        if n in HASHED_FIELDS:
            marks.append('hashed')
        suffix = ' {' + ', '.join(marks) + '}' if marks else ''
        if f['optional']:
            suffix += ' [0..1]'
        dv = f['default']
        if dv and not f['id'] and dv not in ('uuid()', 'now()', 'cuid()', 'autoincrement()'):
            val = dv.strip('"')
            # literal chuoi phai giu nhay kep de phan biet voi hang so enum
            if f['type'] == 'String':
                val = '"%s"' % val
            suffix += ' = ' + val
        lines.append('  -{}: {}{}'.format(n, t, suffix))
    return lines


def pick_methods(model, fn, ops):
    key = model
    table = CURATED.get('methods', {})
    per_fn = CURATED.get('fnMethods', {}).get(fn['no'], {}).get(model)
    if per_fn:
        return ['  ' + m for m in per_fn]
    base = table.get(key, {})
    out = []
    has_create = bool(ops & {'create', 'createMany', 'upsert'})
    has_update = bool(ops & {'update', 'updateMany', 'upsert'})
    has_delete = bool(ops & {'delete', 'deleteMany'})
    has_read = bool(ops & {'findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'})
    if has_create and base.get('create'):
        out.append('{static} +' + base['create'])
    if has_update:
        upd = base.get('update', {})
        nulls = CURATED.get('updateNull', {}).get(model, {})
        wf = written_fields(model, fn)
        bools = CURATED.get('updateBool', {}).get(model, {})
        opsmap = CURATED.get('updateOp', {}).get(model, {})
        matched = []
        for call in written_calls(model, fn):
            per_call = []
            for f, meth in upd.items():
                if f not in call:
                    continue
                val = call[f].strip().rstrip(',').rstrip('}').strip()
                # `{ increment: n }` va `{ decrement: n }` la hai hanh dong nguoc chieu
                if f in opsmap:
                    op = re.search(r'\b(increment|decrement)\b', call[f])
                    if op and op.group(1) in opsmap[f]:
                        per_call.append(opsmap[f][op.group(1)])
                        continue
                if f in bools and val in ('true', 'false'):
                    # ghi true/false -> dung ten noi ro y dinh thay vi setter
                    per_call.append(bools[f][val])
                    continue
                if val == 'null':
                    # ghi null = xoa/reset, KHONG phai hanh dong thuan.
                    alt = nulls.get(f)
                    if alt:
                        per_call.append(alt)
                    continue
                per_call.append(meth)
            # Chi bo changeStatus khi trong CUNG lan update do da co mot method
            # chuyen trang thai vong doi (no da bao ham viec doi status). Cac method
            # chi bat/tat co phu nhu clearRefundFlag KHONG duoc nuot changeStatus.
            if any(re.match(r'\w+', m).group(0) in IMPLIES_STATUS for m in per_call):
                per_call = [m for m in per_call if not m.startswith('changeStatus(')]
            matched += per_call
        if not matched:
            # SDS khong cho biet field nao bi ghi (vd `data: updateData`, hoac mo ta
            # bang van xuoi). Doan bua se cho ra method sai nghia -> khong ve gi ca.
            FALLBACK_LOG.append((fn['no'], fn['name'], model, sorted(wf)))
        out += ['+' + m for m in matched]
    if has_read:
        out += ['+' + m for m in base.get('check', [])]
    if has_delete and base.get('delete'):
        out.append('+' + base['delete'])
    if not out:
        out = ['+' + m for m in base.get('fallback', ['isActive(): Boolean'])]
    seen, ded = set(), []
    for m in out:
        if m not in seen:
            seen.add(m)
            ded.append(m)
    return ['  ' + m for m in ded[:5]]


def edges(selected):
    e = set()
    for a in selected:
        for f in MODELS[a]['fields']:
            if f['isModelRef'] and f['type'] in selected and f['type'] != a:
                e.add(tuple(sorted((a, f['type']))))
    return e


def _soft_pairs():
    return {tuple(sorted(ex['pair'])) for ex in CURATED.get('extraRelations', [])}


def schema_neighbours(m):
    out = set()
    for f in MODELS[m]['fields']:
        if f['isModelRef'] and f['type'] != m:
            out.add(f['type'])
    for a, b in _soft_pairs():
        if a == m:
            out.add(b)
        elif b == m:
            out.add(a)
    return out - MIDDLEWARE_ONLY


def shortest_bridge(selected):
    """Duong di ngan nhat noi hai cum roi rac, tra ve cac model trung gian can them."""
    comps = {}
    for m in selected:
        comps.setdefault(_root(selected, m), []).append(m)
    groups = list(comps.values())
    if len(groups) < 2:
        return []
    start, goal = set(groups[0]), set(m for g in groups[1:] for m in g)
    prev, frontier, seen = {}, list(start), set(start)
    while frontier:
        nxt = []
        for cur in frontier:
            for nb in schema_neighbours(cur):
                if nb in seen:
                    continue
                seen.add(nb)
                prev[nb] = cur
                if nb in goal:
                    path, node = [], cur
                    while node not in start:
                        path.append(node)
                        node = prev[node]
                    return list(reversed(path))
                nxt.append(nb)
        frontier = nxt
    return []


def _root(selected, m):
    e = edges(selected) | {p for p in _soft_pairs()
                           if p[0] in selected and p[1] in selected}
    parent = {x: x for x in selected}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in e:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return find(m)


def components(selected):
    e = edges(selected) | {p for p in _soft_pairs()
                           if p[0] in selected and p[1] in selected}
    parent = {m: m for m in selected}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in e:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return {find(m) for m in selected}


def relations(selected):
    rels = []
    done = set()
    for a in selected:
        for f in MODELS[a]['fields']:
            if not f['isModelRef'] or f['type'] not in selected:
                continue
            b = f['type']
            rel = f['relation'] or {}
            if not rel.get('fields'):
                continue  # phia khong giu FK, se duoc xu ly tu phia kia
            child, parent = a, b
            fk_opt = False
            for cf in MODELS[child]['fields']:
                if cf['name'] in rel['fields']:
                    fk_opt = cf['optional']
            back = None
            for bf in MODELS[parent]['fields']:
                if not bf['isModelRef'] or bf['type'] != child:
                    continue
                # phia back-reference khong bao gio giu FK; quan trong voi self-relation
                if (bf['relation'] or {}).get('fields'):
                    continue
                bname = (bf['relation'] or {}).get('name')
                if bname == rel.get('name'):
                    back = bf
                    break
            role = back['name'] if back else camel(child)
            child_card = '0..*' if (back and back['list']) else '0..1'
            parent_card = '0..1' if fk_opt else '1'
            key = (parent, child, role)
            if key in done:
                continue
            done.add(key)
            ck = CURATED.get('relCards', {}).get(parent + '|' + child)
            if ck:
                child_card = ck
            arrow = '*--' if COMPOSITION_PARENT.get(child) == parent else '--'
            rels.append('{} "{}" {} "{}" {} : {}'.format(parent, parent_card, arrow, child_card, child, role))
    # Quan he suy ra tu soft FK (khong khai bao @relation trong Prisma)
    have = edges(selected)
    linked = set(have)
    for ex in CURATED.get('extraRelations', []):
        a, b = ex['pair']
        if a not in selected or b not in selected:
            continue
        if tuple(sorted((a, b))) in have:
            continue
        if ex.get('bridgeOnly'):
            # Soft FK phu (vd Attraction.reviewedById): chi ve khi thieu no thi
            # so do bi tach roi. Ve mac dinh se thanh nhieu o so do khong lien quan.
            if _connected(selected, linked):
                continue
        linked.add(tuple(sorted((a, b))))
        rels.append(ex['line'])
    return rels


def _connected(selected, edge_set):
    if len(selected) < 2:
        return True
    parent = {m: m for m in selected}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in edge_set:
        if a in parent and b in parent:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
    return len({find(m) for m in selected}) == 1


HEADER = """@startuml
title {title} - Model Class Diagram

skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam roundCorner 0
skinparam dpi 170
skinparam defaultFontName Arial
skinparam classFontName Arial
skinparam classAttributeFontName Consolas
skinparam classAttributeIconSize 0
skinparam classBorderColor #263238
skinparam classBackgroundColor #FAFCFD
skinparam classHeaderBackgroundColor #DCEEF8
skinparam ArrowColor #263238
skinparam ArrowThickness 1.2
skinparam linetype ortho
skinparam nodesep 160
skinparam ranksep 140
hide circle
"""


def build(fn):
    text = fn['query_text']
    cand = [m for m in fn['models'] if m in MODELS]
    ov = CURATED.get('fnModels', {}).get(fn['no'])
    if ov:
        cand = [m for m in ov if m in MODELS]
        sel = cand
        excluded = []
    else:
        # Bo cau "Middleware: protect loads User/AuthSession; requirePartner loads
        # PartnerProfile..." de model chi do middleware nap khong bi tinh la tham gia.
        core = strip_middleware(text)
        sel, excluded = [], []
        for m in cand:
            c = camel(m)
            if ops_for(m, core) or re.search(r'\b' + re.escape(c) + r'\b', core):
                sel.append(m)
            else:
                excluded.append(m)
        # SDS hay viet tat `include: attractionInclude` nen model duoc doc qua include
        # khong lo ten. Nhung model do VAN tham gia chuc nang -> lay lai neu SDS co
        # liet ke va co quan he truc tiep voi mot model da chon.
        for _ in range(3):
            added = [m for m in excluded
                     if m not in MIDDLEWARE_ONLY
                     and any(tuple(sorted((m, s))) in edges(sel + [m]) for s in sel)]
            if not added:
                break
            for m in added:
                sel.append(m)
                excluded.remove(m)
        if not sel:
            sel = cand[:2]
            excluded = [m for m in cand if m not in sel]
        if len(sel) > 7:   # giu so do doc duoc; uu tien model duoc thao tac truc tiep
            sel.sort(key=lambda m: (0 if ops_for(m, core) else 1, cand.index(m)))
            excluded += sel[7:]
            sel = sel[:7]
            sel.sort(key=cand.index)
        # noi lai do thi: them model trung gian tu danh sach bi loai neu no ket noi 2 cum
        for _ in range(3):
            comps = components(sel)
            if len(comps) <= 1:
                break
            added = None
            # uu tien model SDS co liet ke; neu khong du thi lay chu so huu tu schema
            # MIDDLEWARE_ONLY bi loai khoi CA hai nguon: model do middleware nap
            # khong duoc dung lam cau noi, ke ca khi SDS co liet ke no.
            pool = [m for m in excluded if m not in MIDDLEWARE_ONLY]
            pool += [m for m in MODELS
                     if m not in sel and m not in excluded
                     and m not in MIDDLEWARE_ONLY]
            for m in pool:
                if len(components(sel + [m])) < len(comps):
                    added = m
                    break
            if added:
                if added in excluded:
                    excluded.remove(added)
                sel.append(added)
                continue
            # Khong model don le nao noi duoc -> tim duong di ngan nhat qua nhieu
            # buoc (vd Category -> AttractionCategory -> Attraction -> Booking).
            path = shortest_bridge(sel)
            if not path:
                break
            for m in path:
                if m in excluded:
                    excluded.remove(m)
                sel.append(m)
    sel = list(dict.fromkeys(sel))

    body = []
    for m in sel:
        ops = ops_for(m, text, fn)
        meths = pick_methods(m, fn, ops)
        scalar_names = {f['name'] for f in MODELS[m]['fields'] if not f['isModelRef']}
        hints = {p for line in meths for p in re.findall(r'(\w+):', line)} & scalar_names
        attrs = pick_attributes(m, fn, sel, hints)
        body.append('class {} <<model>> {{'.format(m))
        body += attrs
        body.append('  --')
        body += meths
        body.append('}')
        body.append('')
    rels = relations(sel)
    head = HEADER.format(title=fn['name'])
    # Mot vai so do co nhieu quan he cham cung mot canh class -> nhan multiplicity
    # de len nhau. Noi rong khoang cach rieng cho chung (do bang geom.py).
    lay = CURATED.get('layout', {}).get(fn['no'])
    if lay:
        head = re.sub(r'skinparam nodesep \d+',
                      'skinparam nodesep %d' % lay['nodesep'], head)
        head = re.sub(r'skinparam ranksep \d+',
                      'skinparam ranksep %d' % lay['ranksep'], head)
        if lay.get('direction'):
            head = head.replace('hide circle\n', 'hide circle\n' + lay['direction'] + '\n')
    puml = head + '\n' + '\n'.join(body) + '\n' + '\n'.join(rels) + '\n\n@enduml\n'
    return puml, sel, excluded, rels


def main():
    report = []
    skipped = []
    for fn in sds['funcs']:
        puml, sel, excluded, rels = build(fn)
        if not sel:
            # Khong co model nao tham gia (vd goi API ngoai, khong luu tru).
            # Khong sinh so do rong - se ghi mot dong giai thich trong SDS.
            skipped.append({'no': fn['no'], 'name': fn['name'],
                            'module': fn['module_no'], 'dir': MODULE_SLUG[fn['module_no']]})
            continue
        mod_dir = os.path.join(OUT_ROOT, MODULE_SLUG[fn['module_no']])
        os.makedirs(mod_dir, exist_ok=True)
        base = '{}_{}-model-class-diagram'.format(fn['no'].replace('.', '_'), slugify(fn['name']))
        path = os.path.join(mod_dir, base + '.puml')
        io.open(path, 'w', encoding='utf-8', newline='\n').write(puml)
        report.append({'no': fn['no'], 'name': fn['name'], 'module': fn['module_no'],
                       'dir': MODULE_SLUG[fn['module_no']], 'file': base,
                       'models': sel, 'excluded': excluded, 'rels': rels})
    json.dump(report, io.open(os.path.join(HERE, 'report.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(skipped, io.open(os.path.join(HERE, 'skipped.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('generated', len(report), 'puml files')
    if FALLBACK_LOG:
        print('CANH BAO: method duoc chon tuy tien (khong field nao khop):')
        for r in FALLBACK_LOG:
            print('   %-5s %-34s %-24s ghi=%s' % (r[0], r[1][:34], r[2], r[3]))
    print('bo qua (khong co model):', [s['no'] + ' ' + s['name'] for s in skipped])
    print('so model tren so do: max', max(len(r['models']) for r in report),
          '| so do 1 lop:', len([r for r in report if len(r['models']) < 2]))
    noRel = [r['no'] for r in report if not r['rels'] and len(r['models']) > 1]
    print('no-relation-but-multi-model:', noRel)


if __name__ == '__main__':
    main()
