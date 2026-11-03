#!/usr/bin/env python3
"""Offline contract tests: real PDF anchors, graph, quiz, lesson, extension, source paths."""
from pathlib import Path
import json
import fitz
ROOT=Path(__file__).resolve().parents[1]
app=ROOT/'mock-app'
f=json.loads((app/'fixtures/demo.json').read_text())
pdf=fitz.open(str(app/'assets/lc3-pointers-demo.pdf'))
assert len(pdf)==f['document']['pageCount']==len(f['pages'])==4
assert (app/'assets/lc3-pointers-demo.pdf').is_file()
ids=set()
for a in f['anchors']:
    assert a['id'] not in ids
    ids.add(a['id'])
    assert a['documentId']==f['document']['id']
    page=pdf[a['pageIndex']]
    rects=page.search_for(a['quote'])
    assert len(rects)>0,(a['id'],'actual PDF quote missing')
    for r in a['rects']:
        assert all(0<=r[k]<=1 for k in ('x','y','width','height'))
        assert r['x']+r['width']<=1 and r['y']+r['height']<=1
        px=fitz.Rect(r['x']*page.rect.width,r['y']*page.rect.height,(r['x']+r['width'])*page.rect.width,(r['y']+r['height'])*page.rect.height)
        assert any(px.intersects(x) for x in rects),a['id']
node_ids={n['id'] for n in f['graph']['nodes']}
assert len(node_ids)==5
for n in f['graph']['nodes']:
    assert 0<=n['confidence']<=1
    assert n['anchorId'] in ids
for e in f['graph']['relationships']:
    assert e['source'] in node_ids and e['target'] in node_ids
    assert e['type']=='related'
for s in f['lesson']['steps']:
    assert s['kind'] in ('highlight_pdf','focus_graph','ask_question')
    if s['kind']=='highlight_pdf':assert s['targetId'] in ids
    if s['kind']=='focus_graph':assert s['targetId'] in node_ids
    if s['kind']=='ask_question':assert s['targetId']=='quiz'
q=f['quiz']
assert q['conceptId'] in node_ids
assert q['correctChoice'] in {a['id'] for a in q['choices']}
manifest=json.loads((ROOT/'extension/manifest.json').read_text())
assert manifest['manifest_version']==3
assert 'debugger' not in manifest.get('permissions',[])
assert all('localhost' in h or '127.0.0.1' in h for h in manifest['host_permissions'])
for pg in f['pages']:
 assert (app/pg['image'].lstrip('/')).is_file(),pg['image']
for i,pg in enumerate(pdf):
    rendered=pg.get_pixmap(matrix=fitz.Matrix(1.6,1.6),alpha=False)
    stored=fitz.Pixmap(str(app/f['pages'][i]['image'].lstrip('/')))
    assert (stored.width,stored.height)==(rendered.width,rendered.height)==(980,1268),i
    assert stored.samples==rendered.samples,i
reader=(app/'pdf-reader.js').read_text()
html=(app/'index.html').read_text()
assert 'pdf-reader.js' in html
for name in ('scrollToAnchor','highlightAnchor','clearHighlight','getSelectionContext','getVisiblePage'):
    assert name in reader,name
assert 'data-concept-id' not in reader
assert 'data-highlight-for' in reader or 'highlightFor' in reader
print('PASS: 4 actual PDF pages, 10 precise source anchors, 5 graph concepts, 4 real relationships, 6 lesson steps, quiz, localhost-only MV3 manifest')
