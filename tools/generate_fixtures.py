#!/usr/bin/env python3
"""Generate a source-grounded demo PDF, page renderings, and exact PDF anchors.
No external services, graph server, or credentials are required.
"""
from pathlib import Path
import json, hashlib
import fitz
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'mock-app' / 'assets'
FIX = ROOT / 'mock-app' / 'fixtures'
ASSETS.mkdir(parents=True, exist_ok=True)
FIX.mkdir(parents=True, exist_ok=True)
PDF = ASSETS / 'lc3-pointers-demo.pdf'
W,H=612,792
c=canvas.Canvas(str(PDF), pagesize=(W,H))

def line(txt,x,y,size=12,bold=False,color='#334155'):
    c.setFillColor(HexColor(color)); c.setFont('Helvetica-Bold' if bold else 'Helvetica',size); c.drawString(x,y,txt)
def header(n,title,subtitle):
    c.setFillColor(HexColor('#0f172a')); c.rect(0,H-72,W,72,fill=1,stroke=0)
    line('SMARTPATH LIVE   /   LC-3 FIELD GUIDE',46,H-33,10,True,'#5eead4')
    line(f'{n:02d}  {title}',46,H-56,18,True,'#ffffff')
    line(subtitle,46,H-112,12,False,'#64748b')
    c.setStrokeColor(HexColor('#cbd5e1')); c.line(46,48,W-46,48)
    line('CS 2110  |  Demonstration-only learning document',46,30,9,False,'#94a3b8')
def bar(y,txt):
    c.setFillColor(HexColor('#ccfbf1'));c.roundRect(44,y-14,W-88,34,6,fill=1,stroke=0)
    line(txt,58,y,13,True,'#0f766e')
def code(y,rows):
    c.setFillColor(HexColor('#172033'));c.roundRect(48,y-(len(rows)*31+26),W-96,len(rows)*31+28,10,fill=1,stroke=0)
    for i,v in enumerate(rows): line(v,70,y-25-i*31,14,True,'#b4f7e7')

def pageend(): c.showPage()

header(1,'Memory: addresses and values','Start here before you think about pointers.')
line('Every memory location has an address.',52,629,16,True)
line('An address identifies a location; the value lives at that location.',52,599,12)
bar(545,'A memory address is not the data stored there.')
line('Example memory snapshot',52,490,14,True)
line('Address',78,447,12,True);line('Value',305,447,12,True)
for j,(a,b) in enumerate([('x4000','7'),('x4001','12'),('x4002','-3')]):
    y=418-j*42
    c.setFillColor(HexColor('#f1f5f9' if j%2==0 else '#ffffff'));c.roundRect(54,y-11,500,34,4,fill=1,stroke=0)
    line(a,78,y,12,True);line(b,305,y,12)
line('Memory[x4000] = 7',52,235,15,True,'#0f766e')
line('x4000 names the box. The number 7 is stored inside the box.',52,205,12)
line('This distinction drives how LD, LDR, and STR work.',52,169,12)
pageend()

header(2,'Pointers: a register holds an address','An LC-3 register can store a memory location, not just data.')
line('A pointer is a value interpreted as a memory address.',52,626,15,True)
line('When R2 stores x4000, R2 points to memory location x4000.',52,592,12)
bar(532,'R2 = x4000')
line('Register R2',82,471,13,True)
line('x4000',87,437,17,True,'#0f766e')
line('points to',271,437,12,False,'#64748b')
line('Memory address x4000',367,471,13,True)
line('Value: 7',392,437,17,True,'#0f766e')
line('R2 contains the address x4000, NOT the number 7.',52,339,13,True)
line('Dereferencing means reading memory at the stored address.',52,311,12)
line('LDR uses a base register plus a signed offset to calculate an address.',52,263,12)
line('That is why you must understand pointers before LDR.',52,227,12)
pageend()

header(3,'LDR: follow the pointer','Base + offset -> effective address -> read value.')
line('LDR uses a register value to locate data in memory.',52,626,15,True)
line('Format: LDR DR, BaseR, offset6',52,597,12)
code(567,['AND R1, R1, #0','LDR R1, R2, #0'])
bar(410,'LDR R1, R2, #0')
line('Given: R2 = x4000 and Memory[x4000] = 7',52,343,12,True)
line('Effective address = R2 + 0 = x4000',52,310,12)
line('Load value at x4000 into R1 -> R1 becomes 7.',52,279,12,True,'#0f766e')
line('LDR reads memory at the address stored in a base register.',52,230,12)
line('By contrast, LD uses a PC-relative address, not BaseR.',52,196,12)
pageend()

header(4,'STR: write through the pointer','The matching store instruction reverses the data direction.')
line('STR writes a register value into a memory location.',52,626,15,True)
line('Format: STR SR, BaseR, offset6',52,596,12)
code(570,['STR R1, R2, #0'])
bar(440,'STR R1, R2, #0')
line('Given: R1 = 9 and R2 = x4000',52,363,12,True)
line('Effective address = R2 + 0 = x4000',52,331,12)
line('Memory[x4000] becomes 9.',52,299,14,True,'#0f766e')
line('LDR: memory -> register',52,234,13,True)
line('STR: register -> memory',52,201,13,True)
line('Both use base-plus-offset addressing.',52,166,12)
pageend()
c.save()

pdf=fitz.open(str(PDF))
anchors_spec = [
 ('memory_definition','memory',0,'Every memory location has an address.'),
 ('memory_example','memory',0,'Memory[x4000] = 7'),
 ('pointer_definition','pointers',1,'A pointer is a value interpreted as a memory address.'),
 ('pointer_register','pointers',1,'R2 = x4000'),
 ('pointer_distinction','pointers',1,'R2 contains the address x4000, NOT the number 7.'),
 ('ldr_definition','ldr',2,'LDR uses a register value to locate data in memory.'),
 ('ldr_instruction','ldr',2,'LDR R1, R2, #0'),
 ('ldr_result','ldr',2,'Load value at x4000 into R1 -> R1 becomes 7.'),
 ('str_instruction','str',3,'STR R1, R2, #0'),
 ('str_result','str',3,'Memory[x4000] becomes 9.'),
]
anchors=[]
for aid,concept,pageidx,quote in anchors_spec:
    pg=pdf[pageidx]
    rectangles=pg.search_for(quote)
    if not rectangles:
        raise ValueError(f'Missing exact PDF text for anchor {aid}: {quote!r}')
    if aid in ['ldr_instruction','str_instruction'] and len(rectangles)>1:
        # Prefer the shaded example callout nearest the center of the page.
        rectangles=[max(rectangles, key=lambda r:r.y0)]
    else:
        rectangles=[rectangles[0]]
    rects=[{'x':round(r.x0/pg.rect.width,6),'y':round(r.y0/pg.rect.height,6),
            'width':round(r.width/pg.rect.width,6),'height':round(r.height/pg.rect.height,6)} for r in rectangles]
    anchors.append({'id':aid,'documentId':'demo-lc3','conceptId':concept,'pageIndex':pageidx,'quote':quote,
                    'rects':rects,'extractionMethod':'pdf_text','confidence':1})

pages=[]
for i,pg in enumerate(pdf):
    png=ASSETS/f'page-{i+1}.png'
    pg.get_pixmap(matrix=fitz.Matrix(1.6,1.6),alpha=False).save(png)
    pages.append({'pageIndex':i,'image':f'/assets/page-{i+1}.png','width':pg.rect.width,'height':pg.rect.height})

concepts=[
 {'id':'memory','label':'Memory','type':'Topic','confidence':.86,'pageIndex':0,'anchorId':'memory_definition','x':18,'y':10},
 {'id':'addresses','label':'Addresses','type':'Definition','confidence':.72,'pageIndex':0,'anchorId':'memory_example','x':54,'y':25},
 {'id':'pointers','label':'Pointers','type':'Subtopic','confidence':.44,'pageIndex':1,'anchorId':'pointer_definition','x':24,'y':47},
 {'id':'ldr','label':'LDR / Load','type':'Example','confidence':.31,'pageIndex':2,'anchorId':'ldr_instruction','x':5,'y':77},
 {'id':'str','label':'STR / Store','type':'Example','confidence':.58,'pageIndex':3,'anchorId':'str_instruction','x':60,'y':79},
]
relationships=[{'source':'memory','target':'addresses','type':'related'},
               {'source':'addresses','target':'pointers','type':'related'},
               {'source':'pointers','target':'ldr','type':'related'},
               {'source':'pointers','target':'str','type':'related'}]
fixture={
 'schemaVersion':'mock-1',
 'document':{'id':'demo-lc3','title':'LC-3: Memory, Pointers & LDR','subject':'Computer Organization','pageCount':len(pdf),
             'pdfUrl':'/assets/lc3-pointers-demo.pdf','sha256':hashlib.sha256(PDF.read_bytes()).hexdigest()},
 'pages':pages,
 'graph':{'graph_id':'graph-demo-lc3','subject':'science','nodes':concepts,'relationships':relationships},
 'anchors':anchors,
 'quiz':{'id':'q-ldr-1','conceptId':'ldr','question':'R2 contains x4000, and Memory[x4000] contains 7. What is R1 after LDR R1, R2, #0?',
         'choices':[{'id':'A','text':'x4000'},{'id':'B','text':'7'},{'id':'C','text':'0'},{'id':'D','text':'The program counter'}],
         'correctChoice':'B','explanation':'LDR computes x4000 + 0 and loads Memory[x4000], which is 7.'},
 'lesson':{'planId':'fixture-ldr-v1','documentId':'demo-lc3','intent':'teach_concept','title':'How LDR uses pointers',
           'steps':[
             {'id':'s1','kind':'highlight_pdf','targetId':'memory_example','narration':'Start with memory. x4000 is an address; the number 7 is stored there.'},
             {'id':'s2','kind':'highlight_pdf','targetId':'pointer_register','narration':'R2 can hold x4000. That means it points at the memory location, not the number 7.'},
             {'id':'s3','kind':'focus_graph','targetId':'pointers','narration':'SmartPath links memory concepts to pointers. Let us focus that idea in the graph.'},
             {'id':'s4','kind':'highlight_pdf','targetId':'ldr_instruction','narration':'LDR R1, R2, #0 uses the address stored in R2, adds zero, and loads the value into R1.'},
             {'id':'s5','kind':'focus_graph','targetId':'ldr','narration':'The LDR node is connected to Pointers in the graph. You are ready for a quick check.'},
             {'id':'s6','kind':'ask_question','targetId':'quiz','narration':'Answer the question to check your understanding.'}
           ]}}
(FIX/'demo.json').write_text(json.dumps(fixture,indent=2),encoding='utf8')
print(f'Generated: {PDF}, {len(pages)} page images, {len(anchors)} exact anchors; SHA256={fixture["document"]["sha256"][:16]}')
