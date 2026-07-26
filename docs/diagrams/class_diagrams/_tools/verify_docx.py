# -*- coding: utf-8 -*-
import zipfile, re, sys, io
from xml.etree import ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')
DST = r'C:\Users\Lenovo\Desktop\Group5_VietTicketTravel_SDS_final_with_class_diagrams.docx'
SRC = r'C:\Users\Lenovo\Desktop\Group5_VietTicketTravel_SDS_final.docx'

z = zipfile.ZipFile(DST)
names = set(z.namelist())
doc = z.read('word/document.xml').decode('utf-8')
rels = z.read('word/_rels/document.xml.rels').decode('utf-8')

ok = True


def check(cond, msg):
    global ok
    print(('  OK  ' if cond else ' FAIL ') + msg)
    if not cond:
        ok = False


# 1. XML hop le
try:
    ET.fromstring(doc.encode('utf-8'))
    check(True, 'word/document.xml parse duoc')
except Exception as e:
    check(False, 'document.xml loi: %s' % e)

# 2. so luong drawing moi
embeds = re.findall(r'<a:blip r:embed="(rId\d+)"/>', doc)
new_embeds = [e for e in embeds if int(e[3:]) >= 1000]
check(len(new_embeds) == 107, 'so anh class diagram chen vao = %d (mong doi 107)' % len(new_embeds))
check(len(set(new_embeds)) == 107, 'moi anh dung mot rId rieng')

# 3. moi rId phai co relationship tro toi part ton tai
rel_map = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels))
bad = [e for e in new_embeds if 'word/' + rel_map.get(e, 'XXX') not in names]
check(not bad, 'moi r:embed deu tro toi media part ton tai (%d loi)' % len(bad))

# 4. media dung so
media = [n for n in names if n.startswith('word/media/class_')]
check(len(media) == 107, 'so file media class_*.png = %d (mong doi 107)' % len(media))

# 5. khong con placeholder class, con nguyen placeholder sequence
check(doc.count('CLASS DIAGRAM PLACEHOLDER') == 0, 'khong con CLASS placeholder')
check(doc.count('SEQUENCE DIAGRAM PLACEHOLDER') == 108, 'giu nguyen 108 SEQUENCE placeholder')

# 6. docPr id duy nhat
dids = re.findall(r'<wp:docPr id="(\d+)"', doc)
check(len(dids) == len(set(dids)), 'docPr id khong trung nhau')

# 7. noi dung chu khong doi ngoai placeholder
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def texts(path):
    zz = zipfile.ZipFile(path)
    root = ET.fromstring(zz.read('word/document.xml'))
    return [t.text or '' for t in root.iter(W + 't')]


a = [t for t in texts(SRC) if 'CLASS DIAGRAM PLACEHOLDER' not in t]
# 9.8 khong co model -> thay placeholder bang mot dong ghi chu; day la khac biet duy nhat
b = [t for t in texts(DST) if not t.startswith('Chức năng này không đọc hoặc ghi')]
check(a == b, 'ngoai 1 dong ghi chu cho 9.8, van ban khong doi')
check(len(texts(DST)) - len(b) == 1, 'dung 1 dong ghi chu duoc them vao')

# 8. kich thuoc anh nam trong kho trang
sizes = re.findall(r'<wp:extent cx="(\d+)" cy="(\d+)"/>', doc)
over = [(cx, cy) for cx, cy in sizes if int(cx) > 5943600 or int(cy) > 7315200]
check(not over, 'moi anh vua kho trang (%d anh qua kho)' % len(over))

# 9. do phan giai thuc te khi in + khong bop meo ti le
# Doc tung khoi <w:drawing> tron ven de ghep dung anh voi kich thuoc cua chinh no,
# khong ghep theo thu tu (de pass gia).
import struct
bad_dpi, bad_ratio = [], []
for b in re.findall(r'<w:drawing>.*?</w:drawing>', doc, re.S):
    rid = re.search(r'r:embed="(rId\d+)"', b).group(1)
    if int(rid[3:]) < 1000:
        continue                      # anh co san trong ban goc, khong phai cua ta
    cx, cy = map(int, re.search(r'<wp:extent cx="(\d+)" cy="(\d+)"/>', b).groups())
    target = 'word/' + rel_map[rid]
    w_px, h_px = struct.unpack('>II', z.read(target)[16:24])
    dpi = w_px / (cx / 914400.0)
    if dpi < 149:
        bad_dpi.append((round(dpi), target))
    if abs((h_px / float(w_px)) - (cy / float(cx))) > 0.02:
        bad_ratio.append(target)
check(not bad_dpi, 'moi anh dat >=150 DPI khi in (%d anh duoi nguong)' % len(bad_dpi))
check(not bad_ratio, 'khong anh nao bi bop meo ti le (%d loi)' % len(bad_ratio))

print('\n' + ('TAT CA KIEM TRA DAT' if ok else 'CO LOI'))
