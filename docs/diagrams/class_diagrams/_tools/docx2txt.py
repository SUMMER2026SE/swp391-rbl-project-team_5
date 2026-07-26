import sys, zipfile, re
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def para_text(p):
    parts = []
    for node in p.iter():
        if node.tag == W + 't':
            parts.append(node.text or '')
        elif node.tag == W + 'tab':
            parts.append('\t')
        elif node.tag in (W + 'br', W + 'cr'):
            parts.append(' ')
    return ''.join(parts)

def style_of(p):
    pPr = p.find(W + 'pPr')
    if pPr is None:
        return ''
    s = pPr.find(W + 'pStyle')
    return s.get(W + 'val') if s is not None else ''

def render(el, out):
    for child in el:
        if child.tag == W + 'p':
            t = para_text(child).strip()
            st = style_of(child)
            if not t:
                continue
            m = re.match(r'Heading(\d)', st or '')
            if m:
                out.append('#' * int(m.group(1)) + ' ' + t)
            else:
                out.append(t)
        elif child.tag == W + 'tbl':
            for row in child.findall(W + 'tr'):
                cells = []
                for tc in row.findall(W + 'tc'):
                    ct = ' '.join(para_text(p).strip() for p in tc.findall(W + 'p'))
                    cells.append(ct.strip())
                out.append('| ' + ' | '.join(cells) + ' |')
            out.append('')

path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    xml = z.read('word/document.xml')
root = ET.fromstring(xml)
body = root.find(W + 'body')
out = []
render(body, out)
sys.stdout.reconfigure(encoding='utf-8')
print('\n'.join(out))
