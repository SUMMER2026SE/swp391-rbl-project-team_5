# -*- coding: utf-8 -*-
"""Chen 108 Model Class Diagram PNG vao dung cho placeholder trong SDS docx."""
import io, os, re, json, struct, sys, zipfile, shutil

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = r'C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5'
DIAG = os.path.join(ROOT, 'docs', 'diagrams', 'class_diagrams')
SRC = r'C:\Users\Lenovo\Desktop\Group5_VietTicketTravel_SDS_final.docx'
DST = r'C:\Users\Lenovo\Desktop\Group5_VietTicketTravel_SDS_final_with_class_diagrams.docx'

EMU_PER_IN = 914400
MAX_W = int(6.5 * EMU_PER_IN)   # be ngang vung noi dung (12240 - 2*1440 twips)
MAX_H = int(8.0 * EMU_PER_IN)   # chua het chieu cao trang, con cho cho heading
MIN_DPI = 150                   # khong phong to vuot muc nay, neu khong in ra se ro

report = json.load(io.open(os.path.join(HERE, 'report.json'), encoding='utf-8'))
by_no = {r['no']: r for r in report}
skipped = {s['no']: s for s in json.load(io.open(os.path.join(HERE, 'skipped.json'), encoding='utf-8'))}

# Chuc nang khong thao tac tren model nao -> ghi mot dong giai thich thay vi so do rong.
NOTE = (
    '<w:p><w:pPr><w:spacing w:after="160" w:before="80"/></w:pPr>'
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="Arial" w:hAnsi="Arial"/>'
    '<w:i w:val="1"/><w:color w:val="111111"/></w:rPr>'
    '<w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
)


def png_size(path):
    with open(path, 'rb') as f:
        f.read(16)
        w, h = struct.unpack('>II', f.read(8))
    return w, h


def fit(w_px, h_px):
    """Vua kho trang nhung KHONG phong to qua muc lam vo net khi in."""
    aspect = h_px / float(w_px)
    w = min(MAX_W, int(w_px / float(MIN_DPI) * EMU_PER_IN))
    h = int(w * aspect)
    if h > MAX_H:
        h = MAX_H
        w = int(h / aspect)
    return w, h


DRAWING = (
    '<w:p><w:pPr><w:spacing w:after="160" w:before="80"/><w:jc w:val="center"/></w:pPr>'
    '<w:r><w:drawing>'
    '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    '<wp:extent cx="{cx}" cy="{cy}"/>'
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
    '<wp:docPr id="{did}" name="Picture {did}" descr="{desc}"/>'
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="{did}" name="{fname}"/><pic:cNvPicPr/></pic:nvPicPr>'
    '<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    '</pic:pic></a:graphicData></a:graphic>'
    '</wp:inline></w:drawing></w:r></w:p>'
)

PARA_RE = re.compile(
    r'<w:p\b[^>]*>(?:(?!</w:p>).)*?\[CLASS DIAGRAM PLACEHOLDER - ([^\]]+)\](?:(?!</w:p>).)*?</w:p>',
    re.S)

zin = zipfile.ZipFile(SRC)
doc = zin.read('word/document.xml').decode('utf-8')
rels = zin.read('word/_rels/document.xml.rels').decode('utf-8')

state = {'n': 0, 'note': 0, 'rid': 1000, 'did': 2000}
new_rels = []
media = []       # (arcname, srcpath)
missing = []


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def repl(m):
    label = m.group(1).strip()          # vd: "1.2 Verify Email"
    no = label.split(' ', 1)[0]
    if no in skipped:
        state['note'] += 1
        return NOTE.format(text=esc(
            'Chức năng này không đọc hoặc ghi trên bất kỳ model lưu trữ nào — dữ liệu được lấy '
            'trực tiếp từ API thời tiết bên ngoài và không được lưu vào cơ sở dữ liệu, '
            'nên không có Model Class Diagram.'))
    item = by_no.get(no)
    if not item:
        missing.append(label)
        return m.group(0)
    png = os.path.join(DIAG, item['dir'], item['file'] + '.png')
    if not os.path.exists(png):
        missing.append(label)
        return m.group(0)
    state['n'] += 1
    state['rid'] += 1
    state['did'] += 1
    rid = 'rId%d' % state['rid']
    arc = 'media/class_%s.png' % no.replace('.', '_')
    cx, cy = fit(*png_size(png))
    new_rels.append(
        '<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/'
        '2006/relationships/image" Target="%s"/>' % (rid, arc))
    media.append(('word/' + arc, png))
    return DRAWING.format(cx=cx, cy=cy, did=state['did'], rid=rid,
                          fname=esc(item['file'] + '.png'),
                          desc=esc(label + ' - Model Class Diagram'))


doc2 = PARA_RE.sub(repl, doc)
rels2 = rels.replace('</Relationships>', ''.join(new_rels) + '</Relationships>')

print('placeholder thay bang anh:', state['n'], '| thay bang ghi chu:', state['note'])
print('khong tim thay diagram:', missing)
print('con lai CLASS placeholder:', doc2.count('CLASS DIAGRAM PLACEHOLDER'))
print('SEQUENCE placeholder giu nguyen:', doc2.count('SEQUENCE DIAGRAM PLACEHOLDER'))

if os.path.exists(DST):
    os.remove(DST)
zout = zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    if it.filename == 'word/document.xml':
        zout.writestr(it, doc2.encode('utf-8'))
    elif it.filename == 'word/_rels/document.xml.rels':
        zout.writestr(it, rels2.encode('utf-8'))
    else:
        zout.writestr(it, zin.read(it.filename))
for arc, path in media:
    zout.write(path, arc)
zout.close()
zin.close()
print('da ghi:', DST, os.path.getsize(DST), 'bytes')
