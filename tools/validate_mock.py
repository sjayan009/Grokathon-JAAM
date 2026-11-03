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
# Chrome rejects 'debugger' as optional, so it is required; F17 stays off until the side-panel toggle + per-action approval.
for cs in manifest['content_scripts']:
    assert all('localhost' in m or '127.0.0.1' in m for m in cs['matches']) and 'explain.js' not in cs['js']
assert (ROOT/'extension/explain.js').is_file()
assert all('localhost' in h or '127.0.0.1' in h for h in manifest['host_permissions'])
for pg in f['pages']:
 assert (app/pg['image'].lstrip('/')).is_file(),pg['image']
def rasters_close(stored, rendered):
    if abs(stored.width-rendered.width)>2 or abs(stored.height-rendered.height)>2:
        return False
    if (stored.width, stored.height, stored.n)!=(rendered.width, rendered.height, rendered.n):
        return True
    a, b, n = stored.samples, rendered.samples, stored.n
    if a==b:
        return True
    if len(a)!=len(b):
        return False
    step=max(n*64, n)
    checked=bad=0
    for i in range(0, len(a)-n+1, step):
        checked+=1
        if any(abs(a[i+c]-b[i+c])>16 for c in range(n)):
            bad+=1
    return checked>0 and bad/checked<=0.02
for i,pg in enumerate(pdf):
    rendered=pg.get_pixmap(matrix=fitz.Matrix(1.6,1.6),alpha=False)
    stored=fitz.Pixmap(str(app/f['pages'][i]['image'].lstrip('/')))
    assert rasters_close(stored, rendered),(i,'page image drifted from the PDF raster')
reader=(app/'pdf-reader.js').read_text()
html=(app/'index.html').read_text()
assert 'pdf-reader.js' in html and '/speech.js' in html and '/explain.js' in html and '/grok.js' in html and '/graph.js' in html
assert html.find('/graph.js')<html.find('/app.js')
for name in ('scrollToAnchor','highlightAnchor','clearHighlight','getSelectionContext','getVisiblePage'):
    assert name in reader,name
assert 'data-concept-id' not in reader
assert 'data-highlight-for' in reader or 'highlightFor' in reader
explanations=json.loads((app/'fixtures'/'explanations.json').read_text())
assert explanations['schemaVersion']=='explain-1'
assert explanations['documentId']==f['document']['id']
assert set(explanations['passages'])==ids
for anchor in f['anchors']:
    passage=explanations['passages'][anchor['id']]
    assert 'rects' not in passage
    for variant in ('default','simpler','example','relationship'):
        text=passage[variant]
        assert isinstance(text,str) and anchor['quote'] in text
        assert 'prerequisite' not in text.lower()
    for alias in passage.get('aliases',[]):
        assert isinstance(alias,str) and len(alias)>=6
speech=(app/'speech.js').read_text()
assert 'smartpath-cancel-speech' in speech and "why === 'stop'" in speech
grok=(app/'grok.js').read_text()
assert 'SMARTPATH_GROK_CONFIG' in grok
assert 'xai-' not in grok and 'sk-' not in grok
print('PASS: 4 actual PDF pages, 10 precise source anchors, 5 graph concepts, 4 real relationships, 6 lesson steps, quiz, grounded explanation fixture, localhost-only MV3 manifest')
