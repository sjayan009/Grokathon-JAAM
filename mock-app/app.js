/* SmartPath Live mock. Uses a generated demo PDF and verified anchors, not the SmartPath backend/Grok. */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {fixture:null, selectedAnchorId:null, selectedConceptId:null,
    extensionOnline:false, voice:true, mode:'teach', running:false, paused:false,
    token:0, stepIndex:0, pending:new Map(), lastEvent:null, graphUi:{pathIds:[],relatedIds:[]},
    imp:null, active:'demo', rt:0, sel:null, hl:null, aiSeq:0, p2ai:null, p2Muted:false, audio:null, ttsSeq:0, rec:null};
  const modeDescriptions = {
    teach:'Follow a narrated walkthrough of the source material.',
    explore:'Click a highlighted passage, then ask for an explanation.',
    guide:'Find weaker concepts and jump to their source evidence.'
  };
  const anchors = () => state.fixture ? state.fixture.anchors : [];
  const nodes = () => state.fixture ? state.fixture.graph.nodes : [];
  const graphModel = () => globalThis.SmartPathGraphModel;
  const findAnchor = (id) => anchors().find(a => a.id === id);
  const findNode = (id) => nodes().find(n => n.id === id);
  const safeText = (x) => String(x == null ? '' : x);
  const emit = (type,payload={}) => window.postMessage({source:'smartpath-mock-app',type,...payload}, location.origin);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function caption(title,body) { $('caption-title').textContent=title; $('caption-text').textContent=body; }
  function toast(message) {let el=$('toast');el.textContent=message;el.hidden=false;clearTimeout(el._timer);el._timer=setTimeout(()=>el.hidden=true,3400);}
  function speak(text) {
    if (window.SmartPathSpeech) return window.SmartPathSpeech.speak(safeText(text));
    if (!state.voice || !('speechSynthesis' in window)) return {spoken:false, reason:'unavailable'};
    speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(safeText(text));
    utt.lang = 'en-US'; utt.rate = 1.04; utt.pitch = 1;
    speechSynthesis.speak(utt);
    return {spoken:true, reason:'speaking'};
  }
  function cancelVoice(reason) {
    stopAudio();
    if (window.SmartPathSpeech) return window.SmartPathSpeech.cancel(reason || 'stop');
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    return {ok:true, reason: reason || 'stop'};
  }
  function setPageLabel() {
    const viewport=$('pdf-viewport');const pages=[...viewport.querySelectorAll('.pdf-page-wrap')];
    const origin=viewport.getBoundingClientRect().top+20;
    let best=0,bestDistance=Infinity;
    pages.forEach((el,i)=>{const distance=Math.abs(el.getBoundingClientRect().top-origin);if(distance<bestDistance){bestDistance=distance;best=i;}});
    $('page-label').textContent=`Page ${best+1} of ${pages.length}`;
  }
  function allowSpeech(source) {
    if (window.SmartPathSpeech) window.SmartPathSpeech.allow(source || 'user');
  }
  function syncAnchorState(detail){
    state.selectedAnchorId=detail&&detail.anchor?detail.anchor.id:null;
    if(!detail||detail.reason==='cleared'||!detail.anchor){
      $('selected-page-caption').textContent=detail&&detail.ok===false?'Source: could not pinpoint':'Source: ready';
      return;
    }
    const anchor=detail.anchor;
    $('selected-page-caption').textContent=`Source: page ${anchor.pageIndex+1}`;
    emit('source_selected',{anchorId:anchor.id,conceptId:anchor.conceptId,pageIndex:anchor.pageIndex});
  }
  // ---- F09/F18: user-imported PDFs (PDF.js, lazy) + opt-in local OCR (tesseract.js, lazy). PDF text is untrusted data; only textContent is used. ----
  const PDFJS='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',TESS='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const MAX_BYTES=25*1048576,MAX_PAGES=60,scripts={};
  const loadScript=src=>scripts[src]||(scripts[src]=new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.crossOrigin='anonymous';s.onload=res;s.onerror=()=>{delete scripts[src];s.remove();rej(new Error(`Could not load ${new URL(src).host}`));};document.head.append(s);}));
  const demoOnly=()=>{if(state.active!=='import')return false;caption('Demo PDF only','Guided lessons exist only for the demo PDF; no AI service is configured in this mock.');return true;};
  async function importPdf(bytes,name,src){
    if(bytes.length>MAX_BYTES)throw new Error('PDF is larger than the 25 MB limit.');
    if(String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw new Error('File is not a PDF (missing %PDF- header).');
    try{await loadScript(PDFJS);pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;}catch(e){throw new Error(`PDF engine unavailable (${e.message}). The demo document still works.`);}
    let pdf;try{pdf=await pdfjsLib.getDocument({data:bytes}).promise;}catch(e){throw new Error('Could not open this PDF (damaged or password-protected).');}
    if(state.imp)state.imp.pdf.destroy();
    state.imp={name,src,pdf,ocr:{},vision:{},notified:false};
    let item=$('imported-doc');if(!item){item=document.createElement('button');item.type='button';item.className='doc-item';item.id='imported-doc';
      item.append(document.createElement('span'),document.createElement('span'));item.firstChild.textContent='▣';item.lastChild.append(document.createTextNode(''),document.createElement('small'));
      item.addEventListener('click',()=>setActive('import'));$('open-doc').after(item);}
    let host='';try{host=new URL(src).host;}catch(e){}
    item.lastChild.firstChild.textContent=name.slice(0,60);item.lastChild.lastChild.textContent=`${pdf.numPages} pages · Imported${host?' · '+host:''}`;item.setAttribute('aria-label',`Imported document ${name}`);
    setActive('import');return pdf.numPages;
  }
  function setActive(kind){
    state.rt++;state.aiSeq++;stopAudio();if(state.rec)state.rec.stop();state.active=kind;state.sel=null;state.hl=null;const imp=kind==='import';
    if(imp&&state.running)stopLesson();$('quiz-backdrop').hidden=true;
    $('open-doc').classList.toggle('selected',!imp);$('imported-doc')?.classList.toggle('selected',imp);
    $('start-lesson').disabled=imp;$('start-lesson').title=imp?'Guided lessons exist only for the demo PDF':'';$('explain-sel').hidden=!imp;
    $('pdf-viewport').scrollTop=0;syncVoice();
    if(imp){
      window.PdfViewerApi.clearHighlight();state.selectedAnchorId=null;state.selectedConceptId=null;state.graphUi={pathIds:[],relatedIds:[]};
      $('graph-nodes').replaceChildren();$('graph-links').replaceChildren();$('focused-concept').textContent='No concept graph';
      $('graph-summary').textContent='No concept graph for imported documents in mock mode.';$('selected-page-caption').textContent='Source: imported PDF';renderImported();
    }else{
      state.selectedAnchorId=null;window.PdfViewerApi.mount(state.fixture,pdfListeners);renderGraph();$('focused-concept').textContent='Your learning map';$('graph-summary').textContent='Choose a node to see where it appears in the PDF.';$('selected-page-caption').textContent='Source: ready';
    }
  }
  async function renderImported(){
    const imp=state.imp,rt=++state.rt,wrap=$('pdf-pages');wrap.replaceChildren();const n=Math.min(imp.pdf.numPages,MAX_PAGES),dpr=window.devicePixelRatio||1;
    try{
      for(let i=0;i<n;i++){
        const page=await imp.pdf.getPage(i+1);if(rt!==state.rt)return;
        const vp=page.getViewport({scale:window.PdfViewerApi.getZoom()}),c=document.createElement('div');c.className='pdf-page-wrap';c.id=`page-${i}`;c.dataset.pageIndex=String(i);
        c.style.width=`${Math.round(vp.width)}px`;c.style.height=`${Math.round(vp.height)}px`;
        const cv=document.createElement('canvas');cv.width=Math.floor(vp.width*dpr);cv.height=Math.floor(vp.height*dpr);cv.style.cssText='width:100%;height:100%';cv.setAttribute('role','img');cv.setAttribute('aria-label',`Imported PDF page ${i+1}`);
        c.append(cv);wrap.append(c);
        await page.render({canvasContext:cv.getContext('2d'),viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null}).promise;if(rt!==state.rt)return;
        const tc=await page.getTextContent(),tl=document.createElement('div');tl.className='textLayer';tl.style.setProperty('--scale-factor',vp.scale);c.append(tl);
        await pdfjsLib.renderTextLayer({textContentSource:tc,container:tl,viewport:vp}).promise;if(rt!==state.rt)return;
        if(tc.items.reduce((t,it)=>t+(it.str||'').replace(/\s/g,'').length,0)<10)scanBadge(c,i);
        if(imp.ocr[i])addOcr(c,imp.ocr[i]);
        const st=document.createElement('span');st.className='page-sticker';st.textContent=`${i+1} / ${imp.pdf.numPages}`;c.append(st);
        if(state.hl?.pageIndex===i)drawHighlight();setPageLabel();
      }
      if(imp.pdf.numPages>n)caption('Large document truncated',`Rendered the first ${n} of ${imp.pdf.numPages} pages to keep the mock responsive.`);
    }catch(e){if(rt===state.rt)caption('Could not render PDF',e.message);}
  }
  function scanBadge(c,i){
    const b=document.createElement('div');b.className='scan-badge';b.dataset.page=i;const t=document.createElement('b'),note=document.createElement('small'),btn=document.createElement('button');
    t.textContent=state.imp.ocr[i]?'Scanned page · OCR text layer (local)':'Scanned page · no text layer';
    btn.type='button';btn.className='ghost small';btn.textContent='Run OCR (local)';btn.setAttribute('aria-label',`Run local OCR on page ${i+1}`);
    note.textContent='Opt-in: downloads the OCR engine and English language data from a CDN; the page image never leaves your browser.';
    if(state.imp.ocr[i])b.append(t);else{b.append(t,btn);btn.addEventListener('click',()=>runOcr(i,c,b,t,btn));
      if(aiOn()){const ai=document.createElement('button');ai.type='button';ai.className='ghost small';ai.textContent='Read page with AI';ai.setAttribute('aria-label',`Read page ${i+1} with the AI service`);ai.title='Sends this page image to the configured AI service (server-side)';ai.addEventListener('click',()=>readPage('',i));b.append(ai);}
      b.append(note);}
    c.append(b);
  }
  async function runOcr(i,c,b,t,btn){
    const imp=state.imp;btn.disabled=true;caption('Local OCR','Downloading the OCR engine and English language data from the CDN. The page image never leaves your browser.');
    try{
      await loadScript(TESS);const page=await imp.pdf.getPage(i+1),vp=page.getViewport({scale:2}),cv=document.createElement('canvas');cv.width=Math.floor(vp.width);cv.height=Math.floor(vp.height);
      await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;caption('Local OCR','Recognizing text on this page…');
      const {data}=await Tesseract.recognize(cv,'eng');
      const words=(data.words||[]).filter(w=>w.confidence>=60&&safeText(w.text).trim()).map(w=>({t:w.text.trim(),c:Math.round(w.confidence),x:w.bbox.x0/cv.width,y:w.bbox.y0/cv.height,w:(w.bbox.x1-w.bbox.x0)/cv.width,h:(w.bbox.y1-w.bbox.y0)/cv.height}));
      if(!words.length)throw new Error('no confident words');
      imp.ocr[i]=words;if(state.imp===imp&&c.isConnected){addOcr(c,words);t.textContent='Scanned page · OCR text layer (local)';b.replaceChildren(t);}
      caption('OCR complete',`Found ${words.length} words with confidence 60% or higher on page ${i+1}. Select them to explain; answers will note that the source is OCR.`);
    }catch(e){btn.disabled=false;caption('OCR could not read this page',`Couldn't read text on this page; I won't guess source locations. (${e.message})`);}
  }
  function addOcr(c,words){
    const l=document.createElement('div');l.className='ocr-layer';
    words.forEach(w=>{const s=document.createElement('span');s.textContent=w.t;s.dataset.conf=w.c;s.style.cssText=`left:${w.x*100}%;top:${w.y*100}%;width:${w.w*100}%;height:${w.h*100}%;font-size:${w.h*100}cqh`;l.append(s,' ');});
    c.append(l);
  }
  function captureSel(){
    const s=getSelection();if(state.active!=='import'||!s||s.isCollapsed||!s.rangeCount)return;
    const r=s.getRangeAt(0),n=r.commonAncestorContainer,c=(n.nodeType===1?n:n.parentElement)?.closest('.pdf-page-wrap');
    if(!c||!$('pdf-pages').contains(c))return;const text=s.toString().trim();if(!text)return;
    const cr=c.getBoundingClientRect(),clamp=v=>Math.max(0,Math.min(1,v));
    const ow=[...c.querySelectorAll('.ocr-layer span')].filter(sp=>s.containsNode(sp,true));
    const rects=(ow.length?ow.map(sp=>sp.getBoundingClientRect()):[...r.getClientRects()].filter(x=>x.width>1&&x.height>1&&!(x.width>cr.width*.9&&x.height>cr.height*.5))).map(x=>({x:clamp((x.left-cr.left)/cr.width),y:clamp((x.top-cr.top)/cr.height),width:x.width/cr.width,height:x.height/cr.height}));
    state.sel={text:text.slice(0,500),pageIndex:+c.id.slice(5),rects,extractionMethod:ow.length?'ocr':'pdf_text',confidence:ow.length?Math.round(ow.reduce((t,sp)=>t+ +sp.dataset.conf,0)/ow.length):null};
  }
  function drawHighlight(){
    document.querySelectorAll('.sel-hl').forEach(el=>el.remove());const h=state.hl,c=h&&$(`page-${h.pageIndex}`);if(!c)return;
    h.rects.forEach(r=>{const d=document.createElement('div');d.className='sel-hl';d.style.cssText=`left:${r.x*100}%;top:${r.y*100}%;width:${r.width*100}%;height:${r.height*100}%`;c.append(d);});
  }
  const aiOn=()=>!!state.p2ai?.ai;
  async function p2post(path,body){
    const r=await fetch(`/api/live/v1/p2/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let j={};try{j=await r.json();}catch(e){}
    if(!r.ok||j.ai===false)throw new Error(j.error||`AI service HTTP ${r.status}`);return j;
  }
  async function refreshHealth(){
    let h={ai:false};try{const r=await fetch('/api/live/v1/p2/health',{cache:'no-store'});if(r.ok)h=await r.json();}catch(e){}
    state.p2ai=h;syncVoice();const el=$('ai-status');el.textContent=h.ai?`AI: on (${safeText(h.model)})`:'AI: off';el.classList.toggle('online',!!h.ai);
  }
  const NOTICE='Selected text/page images from this document are sent to the configured AI service (server-side) to answer.';
  const noticeOnce=imp=>{if(imp.notified)return '';imp.notified=true;const n=NOTICE+(state.p2ai?.voice?' Recorded audio and answer text are also sent to the voice service through the server.':'');toast(n);return n;};
  // ---- P2 voice (Deepgram via server): spoken answers + voice questions; only while an imported doc is active ----
  const voiceOn=()=>state.active==='import'&&!!state.p2ai?.voice;
  function syncVoice(){const on=voiceOn()?!state.p2Muted:(window.SmartPathSpeech?window.SmartPathSpeech.isEnabled():state.voice),b=$('voice-toggle');b.setAttribute('aria-pressed',String(on));b.textContent=on?'◖))':'◖';}
  function stopAudio(){
    state.ttsSeq++;const a=state.audio;state.audio=null;if(a){a.onended=a.onerror=null;a.pause();URL.revokeObjectURL(a._u);}
    const b=$('stop-audio');if(b)b.hidden=true;
  }
  async function p2say(text){
    stopAudio();if(state.p2Muted||state.active!=='import')return;
    if(!state.p2ai?.voice){allowSpeech('explain');speak(text);return;}
    const seq=++state.ttsSeq,imp=state.imp;noticeOnce(imp);
    try{
      const r=await fetch('/api/live/v1/p2/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:safeText(text).slice(0,2000)})});
      if(!r.ok)throw new Error(`TTS HTTP ${r.status}`);const blob=await r.blob();
      if(seq!==state.ttsSeq||state.p2Muted||state.imp!==imp)return;
      const u=URL.createObjectURL(blob),a=new Audio(u);a._u=u;state.audio=a;a.onended=a.onerror=()=>{if(state.audio===a)stopAudio();};
      $('stop-audio').hidden=false;await a.play();
    }catch(e){if(seq===state.ttsSeq){stopAudio();allowSpeech('explain');speak(text);}}
  }
  function setRec(on){const b=$('mic-button');b.classList.toggle('recording',on);b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',on?'Stop recording':'Start voice input');}
  async function micRecord(){
    if(state.rec){if(state.rec.state==='recording')state.rec.stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Recording is not supported in this browser. Use text input.');return;}
    const imp=state.imp;let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}catch(e){caption('Microphone unavailable',`Couldn't access the microphone (${e.name||'error'}). Text input still works.`);return;}
    stopAudio();cancelVoice();
    const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'].find(m=>MediaRecorder.isTypeSupported(m)),chunks=[];
    const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);state.rec=rec;
    rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
    const timer=setTimeout(()=>{if(rec.state==='recording')rec.stop();},12000);
    rec.onstop=()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());if(state.rec===rec)state.rec=null;setRec(false);
      if(state.imp!==imp||state.active!=='import')return;transcribe(new Blob(chunks,{type:rec.mimeType||mime||'audio/webm'}));};
    rec.start();setRec(true);caption('Listening','Recording… press the mic again to stop (auto-stops after 12 s). '+(noticeOnce(imp)||''));
  }
  async function transcribe(blob){
    if(!blob.size){caption('No audio','Nothing was recorded. Try again or use text input.');return;}
    caption('Transcribing…','Sending your recording to the voice service through the server.');
    try{
      const r=await fetch('/api/live/v1/p2/stt',{method:'POST',headers:{'Content-Type':(blob.type||'audio/webm').split(';')[0]},body:blob});
      const j=await r.json().catch(()=>({}));if(!r.ok||j.voice===false)throw new Error(j.error||`HTTP ${r.status}`);
      const t=safeText(j.transcript).trim();if(!t){caption('Heard nothing',"I couldn't make out any speech. Try again or use text input.");return;}
      toast(`Heard: ${t}`);caption('Heard',`“${t}”`);handlePrompt(t);
    }catch(e){caption('Voice recognition failed',`${e.message}. Text input still works.`);}
  }
  function curPage(){
    const vp=$('pdf-viewport'),o=vp.getBoundingClientRect().top+20;let best=0,bd=Infinity;
    vp.querySelectorAll('.pdf-page-wrap').forEach((el,i)=>{const d=Math.abs(el.getBoundingClientRect().top-o);if(d<bd){bd=d;best=i;}});return best;
  }
  // Page text from the live text/OCR layer, with a char -> (text node, offset) map so quotes can be located exactly.
  function pageText(c){
    const layer=c&&(c.querySelector('.ocr-layer')||c.querySelector('.textLayer'));let text='';const map=[];
    if(layer)layer.querySelectorAll('span').forEach(sp=>{const tn=sp.firstChild;if(!tn||tn.nodeType!==3)return;
      for(let k=0;k<tn.data.length;k++){if(/\s/.test(tn.data[k])){if(text&&!text.endsWith(' ')){text+=' ';map.push([tn,k]);}}else{text+=tn.data[k];map.push([tn,k]);}}
      if(text&&!text.endsWith(' ')){text+=' ';map.push([tn,tn.data.length]);}});
    return {text,map,ocr:!!(c&&c.querySelector('.ocr-layer'))};
  }
  function locate(c,pt,quote){
    const q=safeText(quote).replace(/\s+/g,' ').trim();if(q.length<2)return null;const i=pt.text.indexOf(q);if(i<0)return null;
    const a=pt.map[i],z=pt.map[i+q.length-1],cr=c.getBoundingClientRect(),cl=v=>Math.max(0,Math.min(1,v));let rs;
    if(pt.ocr)rs=[...new Set(pt.map.slice(i,i+q.length).map(m=>m[0].parentElement))].map(sp=>sp.getBoundingClientRect());
    else{const r=document.createRange();r.setStart(a[0],a[1]);r.setEnd(z[0],z[1]+1);rs=[...r.getClientRects()].filter(x=>x.width>1&&x.height>1&&!(x.width>cr.width*.9&&x.height>cr.height*.5));}
    return rs.length?rs.map(x=>({x:cl((x.left-cr.left)/cr.width),y:cl((x.top-cr.top)/cr.height),width:x.width/cr.width,height:x.height/cr.height})):null;
  }
  function localExplain(s,kwOk){
    state.hl={pageIndex:s.pageIndex,rects:s.rects};drawHighlight();const pg=s.pageIndex+1,lower=s.text.toLowerCase(),kw=kwOk&&['ldr','str','pointer','address','memory'].find(k=>new RegExp(`\\b${k}`).test(lower)),a=kw&&anchors().find(x=>x.quote.toLowerCase().includes(kw));
    let body=a?`Your selection on page ${pg} mentions "${kw.toUpperCase()}". From the demo fixture (not your document): ${a.quote}`:`I can point to your selection on page ${pg}, but no AI service is configured in this mock, so I can't explain it.`;
    if(s.extractionMethod==='ocr')body+=` The source text came from OCR (mean confidence ${s.confidence}%) and may contain errors.`;
    caption(`Explore Mode · Imported PDF · Page ${pg}`,body);p2say(body);
    emit('selection_explained',{pageIndex:s.pageIndex,rects:s.rects,extractionMethod:s.extractionMethod,confidence:s.confidence,quote:s.text});
  }
  async function explainSelection(question=''){
    const imp=state.imp,s=state.sel;if(!imp)return;
    if(!aiOn()){if(s)localExplain(s,true);else caption('Select text first','Select some text in the imported PDF, then press Explain selection.');return;}
    const cur=s?s.pageIndex:curPage(),pg=cur+1;let c=$(`page-${cur}`),pt=pageText(c);const vis=imp.vision[cur]||'',ctx=pt.text||vis;
    if(!s&&!ctx){caption('Nothing to explain','Select text, or on a scanned page run OCR or "Read page with AI" first. I won\'t guess.');return;}
    const seq=++state.aiSeq,stale=()=>seq!==state.aiSeq||state.imp!==imp||state.active!=='import',ocr=s?s.extractionMethod==='ocr':pt.ocr;
    if(s){state.hl={pageIndex:cur,rects:s.rects};drawHighlight();}
    caption('Thinking…',noticeOnce(imp)||'Asking the AI service about this passage…');
    try{
      const j=await p2post('explain',{source:ocr?'ocr':'pdf',text:(s?s.text:ctx).slice(0,2000),context:ctx.slice(0,8000),pageIndex:cur,title:imp.name,
        ...(question?{question:question.slice(0,500)}:{}),style:/simpl/i.test(question)?'simpler':/example/i.test(question)?'example':'normal'});
      if(stale())return;
      c=$(`page-${cur}`);pt=pageText(c);const rects=[];(j.quotes||[]).forEach(q=>{const r=c&&locate(c,pt,q);if(r)rects.push(...r);});
      if(rects.length||s){state.hl={pageIndex:cur,rects:rects.length?rects:s.rects};drawHighlight();}
      let body=safeText(j.text);
      if(ocr&&s)body+=` The source text came from OCR (mean confidence ${s.confidence}%) and may contain errors.`;
      if(!s&&!pt.text&&vis)body+=' This text came from AI reading the page image; there are no source rectangles.';
      caption(`Explore Mode · Imported PDF · Page ${pg}`,body);p2say(body);
      emit('selection_explained',{pageIndex:cur,rects:state.hl?.rects||[],extractionMethod:s?s.extractionMethod:(pt.text?(pt.ocr?'ocr':'pdf_text'):'ai_vision'),ai:true});
    }catch(e){
      if(stale())return;
      caption(`Explore Mode · Imported PDF · Page ${pg}`,`The AI service could not answer (${e.message}). I can point to your selection on page ${pg}, but I can't explain it right now.`);p2say('The AI service could not answer. I can point to your selection, but I cannot explain it right now.');
    }
  }
  async function readPage(question='',idx){
    const imp=state.imp;if(!imp||!aiOn())return;const i=idx??state.sel?.pageIndex??curPage(),seq=++state.aiSeq,stale=()=>seq!==state.aiSeq||state.imp!==imp||state.active!=='import';
    caption('Reading page…',noticeOnce(imp)||'Sending this page image to the AI service…');
    try{
      const page=await imp.pdf.getPage(i+1),v1=page.getViewport({scale:1});let scale=Math.min(2,1600/Math.max(v1.width,v1.height)),b64='';
      for(let t=0;t<5;t++){
        const vp=page.getViewport({scale}),cv=document.createElement('canvas');cv.width=Math.floor(vp.width);cv.height=Math.floor(vp.height);
        await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;b64=cv.toDataURL('image/jpeg',.85).split(',')[1];
        if(b64.length*.75<8e6)break;scale*=.6;b64='';
      }
      if(!b64)throw new Error('page image too large');
      const j=await p2post('read-page',{imageBase64:b64,pageIndex:i,...(question?{question:question.slice(0,500)}:{})});
      if(stale())return;
      if(j.readable){
        imp.vision[i]=safeText(j.transcript).slice(0,8000);
        const rb=[j.answer,j.description].map(safeText).filter(Boolean).join(' ');
        caption(`Page ${i+1} · AI read`,rb+' This text came from AI reading the page image; there are no source rectangles, so nothing is highlighted. Ask "explain this page" to continue.');p2say(rb);
      }else{caption("Couldn't read this page",`The AI service couldn't read page ${i+1}; I won't guess.`);p2say(`I couldn't read page ${i+1}, and I won't guess.`);}
      emit('page_read',{pageIndex:i,readable:!!j.readable,extractionMethod:'ai_vision'});
    }catch(e){if(!stale())caption("Couldn't read this page",`AI page reading failed (${e.message}); I won't guess.`);}
  }
  async function importFromMessage(d){
    const reply=(ok,error,pageCount)=>emit('import_result',ok?{ok,pageCount}:{ok,error});
    try{
      if(typeof d.name!=='string'||typeof d.sourceUrl!=='string'||typeof d.bytesBase64!=='string')throw new Error('Malformed import message.');
      if(d.bytesBase64.length>Math.ceil(MAX_BYTES/3)*4+8)throw new Error('PDF is larger than the 25 MB limit.');
      caption('Importing PDF',`Rendering ${d.name.slice(0,80)} in the browser…`);
      let bin;try{bin=atob(d.bytesBase64);}catch(e){throw new Error('PDF data was not valid base64.');}
      const n=await importPdf(Uint8Array.from(bin,ch=>ch.charCodeAt(0)),d.name||'Imported.pdf',d.sourceUrl);
      caption('PDF imported',`${d.name.slice(0,80)} is open. Select text and press Explain selection. Guided lessons exist only for the demo PDF.`);reply(true,null,n);
    }catch(e){caption('Import failed',e.message);reply(false,e.message);}
  }
  async function importFile(file){
    if(!file)return;
    try{const n=await importPdf(new Uint8Array(await file.arrayBuffer()),file.name,'');caption('PDF imported',`${file.name.slice(0,80)} · ${n} pages. Select text and press Explain selection. Guided lessons exist only for the demo PDF.`);}
    catch(e){caption('Import failed',e.message);toast(e.message);}
  }
  function selectAnchor(id,showExplanation=false){
    const result=window.PdfViewerApi.highlightAnchor(id,{scroll:true,explain:showExplanation});
    if(!result.ok){
      $('selected-page-caption').textContent='Source: could not pinpoint';
      return false;
    }
    const a=findAnchor(id);
    if(showExplanation && a && a.conceptId && window.SmartPathGraph)window.SmartPathGraph.focusConcept(a.conceptId);
    if(showExplanation)presentExplanationForAnchor(id,'default');
    return true;
  }
  function renderGraph(){
    const canvas=$('graph-nodes');canvas.replaceChildren();const svg=$('graph-links');svg.replaceChildren();
    state.fixture.graph.relationships.forEach(edge=>{
      const a=findNode(edge.source),b=findNode(edge.target);if(!a||!b)return;
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',a.x+12);line.setAttribute('y1',a.y+6);line.setAttribute('x2',b.x+12);line.setAttribute('y2',b.y+6);
      line.dataset.source=edge.source;line.dataset.target=edge.target;line.dataset.relation=edge.type||'';
      svg.append(line);
    });
    nodes().forEach(n=>{
      const btn=document.createElement('button');btn.type='button';btn.className='graph-node';
      btn.dataset.conceptId=n.id;btn.dataset.confidence=String(n.confidence);
      btn.dataset.active=String(state.selectedConceptId===n.id);
      btn.setAttribute('aria-pressed',String(state.selectedConceptId===n.id));
      btn.style.left=`${n.x+12}%`;btn.style.top=`${n.y+6}%`;
      if(n.id===state.selectedConceptId)btn.classList.add('active');
      const label=document.createElement('span');label.className='node-name';label.textContent=n.label;
      const type=document.createElement('span');type.className='node-type';type.textContent=n.type;
      const conf=document.createElement('span');conf.className='node-confidence';conf.textContent=`${Math.round(n.confidence*100)}%`;
      btn.append(label,type,conf);
      btn.addEventListener('click',event=>{
        if(event.isTrusted&&state.running)pauseLesson('You took control of the graph.');
        focusConcept(n.id,true);
      });
      canvas.append(btn);
    });
    paintGraphFocus();
  }
  function paintGraphFocus(){
    const path=state.graphUi.pathIds;const related=new Set(state.graphUi.relatedIds);
    document.querySelectorAll('.graph-node').forEach(el=>{
      const id=el.dataset.conceptId;const match=id===state.selectedConceptId;const pathIndex=path.indexOf(id);
      el.classList.toggle('active',match);el.dataset.active=String(match);el.setAttribute('aria-pressed',String(match));
      el.classList.toggle('on-path',pathIndex>=0);el.dataset.onPath=String(pathIndex>=0);
      if(pathIndex>=0)el.dataset.pathIndex=String(pathIndex+1);else delete el.dataset.pathIndex;
      const isRelated=related.has(id);el.classList.toggle('related',isRelated);el.dataset.related=String(isRelated);
    });
    document.querySelectorAll('#graph-links line').forEach(line=>{
      let onPath=false;
      for(let i=1;i<path.length;i++){
        const left=path[i-1],right=path[i];
        if((line.dataset.source===left&&line.dataset.target===right)||(line.dataset.source===right&&line.dataset.target===left)){onPath=true;break;}
      }
      line.classList.toggle('on-path',onPath);line.dataset.onPath=String(onPath);
    });
  }
  function focusOptions(selectSourceOrOptions){
    if(typeof selectSourceOrOptions==='boolean')return {selectSource:selectSourceOrOptions};
    return selectSourceOrOptions&&typeof selectSourceOrOptions==='object'?selectSourceOrOptions:{};
  }
  function focusConcept(id,selectSourceOrOptions=false){
    const options=focusOptions(selectSourceOrOptions);const n=findNode(id);if(!n)return false;
    if(!options.preservePath)state.graphUi.pathIds=[];
    if(!options.preserveRelated)state.graphUi.relatedIds=[];
    state.selectedConceptId=id;paintGraphFocus();
    $('focused-concept').textContent=n.label;
    $('graph-summary').textContent=typeof options.summary==='string'?options.summary:`${n.type} · confidence ${Math.round(n.confidence*100)}% · source page ${n.pageIndex+1}. Connected nodes are related concepts, not verified prerequisites.`;
    if(options.selectSource && n.anchorId)selectAnchor(n.anchorId);
    emit('concept_focused',{conceptId:id,path:state.graphUi.pathIds.slice()});return true;
  }
  function getRelatedConceptIds(id){
    const model=graphModel();if(!model||!state.fixture)return [];
    return model.relatedNeighborIds(state.fixture.graph,id);
  }
  function showRelatedConcepts(id){
    const n=findNode(id);if(!n)return null;
    const related=getRelatedConceptIds(id);
    state.graphUi.relatedIds=related.slice();state.graphUi.pathIds=[];
    const labels=related.map(relatedId=>findNode(relatedId)?.label||relatedId);
    const summary=labels.length?`Related to ${labels.join(', ')}. These are related concepts, not prerequisites.`:`No related concepts are linked from ${n.label}.`;
    if(!focusConcept(id,{selectSource:false,preserveRelated:true,summary}))return null;
    return related.slice();
  }
  function showPath(request){
    const model=graphModel();if(!model||!state.fixture)return null;
    let ids=null;
    if(Array.isArray(request)){if(!model.isRelatedWalk(state.fixture.graph,request))return null;ids=request.slice();}
    else if(request&&typeof request.from==='string'&&typeof request.to==='string')ids=model.shortestRelatedPath(state.fixture.graph,request.from,request.to);
    if(!ids||!ids.length)return null;
    state.graphUi.pathIds=ids;state.graphUi.relatedIds=[];
    const labels=ids.map(conceptId=>findNode(conceptId)?.label||conceptId);
    const summary=`Related path: ${labels.join(' → ')}. These links are related concepts, not prerequisites.`;
    if(!focusConcept(ids[ids.length-1],{selectSource:false,preservePath:true,summary}))return null;
    return ids.slice();
  }
  function clearFocus(){
    state.selectedConceptId=null;state.graphUi.pathIds=[];state.graphUi.relatedIds=[];paintGraphFocus();
    $('focused-concept').textContent='Your learning map';
    $('graph-summary').textContent='Choose a node to see where it appears in the PDF.';
    emit('concept_cleared',{});
  }
  function installGraphStyles(){
    if(document.getElementById('smartpath-graph-styles'))return;
    const style=document.createElement('style');style.id='smartpath-graph-styles';
    style.textContent='.graph-node.on-path:not(.active){border-color:#0f766e;box-shadow:0 0 0 3px #99f6e455}.graph-node.related:not(.active){border-color:#5eead4;border-style:dashed}.graph-links line.on-path{stroke:#0f766e;stroke-width:1.6}';
    document.head.append(style);
  }
  function renderProgress(){
    const list=$('progress-list');list.replaceChildren();
    nodes().filter(n=>n.id!=='addresses').forEach(n=>{
      const item=document.createElement('div');item.className='progress-item';item.dataset.progressFor=n.id;item.dataset.confidence=String(n.confidence);
      const heading=document.createElement('div');heading.className='progress-head';
      const label=document.createElement('span');label.textContent=n.label;
      const pct=document.createElement('span');pct.textContent=`${Math.round(n.confidence*100)}%`;
      heading.append(label,pct);const track=document.createElement('div');track.className='progress-track';
      const bar=document.createElement('i');bar.style.width=`${n.confidence*100}%`;track.append(bar);
      item.append(heading,track);list.append(item);
    });
  }
  function showQuiz(){
    if(demoOnly())return;
    const q=state.fixture.quiz;$('quiz-question').textContent=q.question;$('quiz-card').dataset.quizConcept=q.conceptId;
    const wrap=$('quiz-choices');wrap.replaceChildren();$('quiz-feedback').hidden=true;
    q.choices.forEach(choice=>{
      const btn=document.createElement('button');btn.type='button';btn.className='quiz-choice';btn.textContent=`${choice.id}. ${choice.text}`;
      btn.addEventListener('click',()=>{
        const correct=choice.id===q.correctChoice;btn.classList.add(correct?'correct':'incorrect');
        wrap.querySelectorAll('button').forEach(x=>x.disabled=true);
        $('quiz-feedback').hidden=false;
        $('quiz-feedback').textContent=(correct?'Correct. ':'Not quite. ')+q.explanation;
        if(correct){const node=findNode(q.conceptId);node.confidence=Math.min(1,node.confidence+.1);renderProgress();renderGraph();}
        caption('Understanding check',correct?'Nice work. You followed the pointer correctly.':q.explanation);
        emit('quiz_answered',{correct,conceptId:q.conceptId});
      });wrap.append(btn);
    });
    $('quiz-backdrop').hidden=false;emit('quiz_opened');
  }
  function updateProgressIndicator(){
    const steps=state.fixture.lesson.steps;$('lesson-progress').textContent=`${Math.min(state.stepIndex,steps.length)} / ${steps.length}`;
    $('step-dots').replaceChildren();steps.forEach((s,i)=>{const dot=document.createElement('span');if(i<state.stepIndex)dot.classList.add('active');$('step-dots').append(dot);});
    $('pause-btn').hidden=state.paused;$('resume-btn').hidden=!state.paused;
  }
  function pauseLesson(reason='Paused by student'){
    if(!state.running||state.paused)return;
    state.paused=true;cancelVoice('pause');caption('Lesson paused',`${reason} Press Resume to revalidate and continue.`);
    updateProgressIndicator();emit('lesson_paused',{reason});
  }
  function resumeLesson(){
    if(!state.running||!state.paused)return;state.paused=false;updateProgressIndicator();
    caption('Lesson resumed','Rechecking the current source and graph before continuing.');emit('lesson_resumed');
  }
  function stopLesson(){
    state.token++;state.running=false;state.paused=false;cancelVoice('stop');setExplainActions(false);$('lesson-strip').hidden=true;
    caption('Lesson stopped','The AI cursor, queued actions, and narration have been cancelled.');emit('lesson_stopped');
  }
  async function awaitActive(token){
    while(state.paused && token===state.token)await delay(90);
    return token===state.token && state.running;
  }
  async function waitCancellable(ms,token){
    for(let elapsed=0;elapsed<ms;elapsed+=70){if(!await awaitActive(token))return false;await delay(70)}return true;
  }
  function locallyExecute(step){
    if(step.kind==='highlight_pdf'){
      const target=document.querySelector(`[data-anchor-id="${CSS.escape(step.targetId)}"]`);
      if(!target)throw new Error('PDF anchor not in the rendered document');target.click();
    }else if(step.kind==='focus_graph'){
      const target=document.querySelector(`[data-concept-id="${CSS.escape(step.targetId)}"]`);
      if(!target)throw new Error('Graph node not found');target.click();
    }else if(step.kind==='ask_question')$('top-quiz').click();
    else throw new Error('Unrecognized mock step');
  }
  async function extensionExecute(step, token){
    if(!state.extensionOnline){locallyExecute(step);return;}
    const requestId=`${token}-${step.id}-${Date.now()}`;
    const answer=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{state.pending.delete(requestId);reject(new Error('Extension action timed out. Check the extension or reload.'));},3100);
      state.pending.set(requestId,{resolve:(result)=>{clearTimeout(timeout);resolve(result);}});
    });
    emit('action_request',{requestId,step:{kind:step.kind,targetId:step.targetId}});
    const result=await answer;
    if(!result?.ok)throw new Error(result?.error||'Extension could not verify its UI action');
  }
  function verified(step){
    if(step.kind==='highlight_pdf')return state.selectedAnchorId===step.targetId && document.querySelector(`[data-anchor-id="${CSS.escape(step.targetId)}"]`)?.dataset.active==='true';
    if(step.kind==='focus_graph')return state.selectedConceptId===step.targetId && document.querySelector(`[data-concept-id="${CSS.escape(step.targetId)}"]`)?.dataset.active==='true';
    if(step.kind==='ask_question')return !$('quiz-backdrop').hidden;
    return false;
  }
  async function startLesson(){
    if(demoOnly())return;
    if(state.running){toast('A lesson is already in progress.');return;}
    state.token++;const token=state.token;allowSpeech('lesson');setExplainActions(false);state.running=true;state.paused=false;state.stepIndex=0;
    $('lesson-strip').hidden=false;$('lesson-title').textContent=state.fixture.lesson.title;updateProgressIndicator();
    emit('lesson_started',{runId:token,planId:state.fixture.lesson.planId});
    for(const step of state.fixture.lesson.steps){
      if(!await awaitActive(token))return;
      caption(`Teaching · Step ${state.stepIndex+1}`,step.narration);
      emit('step_started',{runId:token,stepId:step.id,narration:step.narration});
      speak(step.narration);
      let actionVerified=false;
      while(!actionVerified){
        if(!await awaitActive(token))return;
        try{
          await extensionExecute(step,token);
          if(token!==state.token)return;
          if(!verified(step))throw new Error('Expected UI state was not verified after the action');
          actionVerified=true;
        }catch(error){
          if(token!==state.token)return;
          // A user-triggered pause may cancel an in-flight cursor animation.
          // Re-observe/replay only the safe idempotent highlight/focus/quiz-open step after Resume.
          if(state.paused || /cancelled or paused/i.test(error.message||'')){
            if(!await awaitActive(token))return;
            continue;
          }
          state.running=false;state.paused=false;cancelVoice('error');updateProgressIndicator();
          caption('Execution stopped safely',error.message);
          emit('lesson_error',{runId:token,stepId:step.id,error:error.message});return;
        }
      }
      state.stepIndex++;updateProgressIndicator();emit('step_verified',{runId:token,stepId:step.id});
      if(step.kind==='ask_question')break;
      if(!await waitCancellable(1350,token))return;
    }
    if(token!==state.token)return;
    state.running=false;state.paused=false;updateProgressIndicator();
    if($('quiz-backdrop').hidden)caption('Lesson complete','You can ask for another explanation or review a weak concept.');
    emit('lesson_completed',{runId:token});
  }
  function speechGeneration(){return window.SmartPathSpeech?window.SmartPathSpeech.generation:null;}
  function speechWasCancelled(generation){
    if(!window.SmartPathSpeech||generation==null)return false;
    return window.SmartPathSpeech.isStopped()||window.SmartPathSpeech.generation!==generation;
  }
  function setExplainActions(visible){const bar=$('caption-actions');if(bar)bar.hidden=!visible;}
  function showExplanation(result){
    const body=result.speechText||result.text;
    caption(result.captionTitle,body);
    const captions=$('captions');
    captions.dataset.grounded=String(Boolean(result.grounded));
    captions.dataset.explanationAnchor=result.anchorId||'';
    setExplainActions(Boolean(result.grounded));
    if(result.grounded&&result.anchorId){
      selectAnchor(result.anchorId,false);
      if(result.conceptId)focusConcept(result.conceptId,{selectSource:false});
      const quote=result.evidence&&result.evidence[0]?result.evidence[0].quote:'';
      $('selected-page-caption').textContent=quote?`Source: page ${result.pageIndex+1} · ${quote}`:`Source: page ${result.pageIndex+1}`;
    }
    const spoken=speak(body);
    emit('explanation_presented',{grounded:Boolean(result.grounded),anchorId:result.anchorId,conceptId:result.conceptId,pageIndex:result.pageIndex,spoken:Boolean(spoken&&spoken.spoken),speechReason:spoken?spoken.reason:null,source:result.source||'fixture'});
  }
  async function maybeUpgradeWithGrok(result,utterance){
    if(!result||!result.grounded)return result;
    if(!window.SmartPathGrok||!window.SmartPathGrok.isEnabled())return result;
    try{
      const live=await window.SmartPathGrok.explainSelection({
        documentId:state.fixture.document.id,
        utterance:utterance||'',
        anchorId:result.anchorId,
        quote:result.evidence[0].quote,
        pageIndex:result.pageIndex,
        reformulation:result.reformulation
      });
      return window.SmartPathExplain.acceptLiveExplanation(live,state.fixture,result)||result;
    }catch(error){return result;}
  }
  async function presentExplanationForAnchor(anchorId,reformulation){
    if(!window.SmartPathExplain){caption('Explanation unavailable','The explanation planner did not load. Captions stay on this page.');return;}
    allowSpeech('explain');
    const generation=speechGeneration();
    const base=window.SmartPathExplain.explainAnchor({fixture:state.fixture,anchorId,reformulation:reformulation||'default'});
    const result=await maybeUpgradeWithGrok(base,'');
    if(speechWasCancelled(generation))return;
    showExplanation(result);
  }
  async function presentUtterance(utterance,reformulation){
    if(!window.SmartPathExplain){caption('Explanation unavailable','The explanation planner did not load. Type a question or use Teach.');return;}
    if(state.running)pauseLesson('You asked about a passage.');
    allowSpeech('explain');
    const generation=speechGeneration();
    const base=window.SmartPathExplain.explainUtterance({fixture:state.fixture,utterance,selectedAnchorId:state.selectedAnchorId,reformulation});
    const result=await maybeUpgradeWithGrok(base,utterance);
    if(speechWasCancelled(generation))return;
    showExplanation(result);
  }
  function routePrompt(text){
    if(window.SmartPathExplain)return window.SmartPathExplain.classifyUtterance(text).intent;
    const lower=text.toLowerCase();
    if(/stop|cancel/.test(lower))return 'stop';
    if(/pause/.test(lower))return 'pause';
    if(/resume|continue/.test(lower))return 'resume';
    if(/quiz|test me|check understanding/.test(lower))return 'quiz_me';
    if(/teach|walk me|start lesson|from scratch|ldr/.test(lower)&&!/what does|why does|explain this/.test(lower))return 'teach_concept';
    if(/review|weak|study next/.test(lower))return 'review_weaknesses';
    if(/explain|what does|why|how|simpler|example/.test(lower))return 'explain_selection';
    return 'unsupported';
  }
  function handlePrompt(text){
    const q=text.trim();if(!q)return;
    state.micEpoch=(state.micEpoch||0)+1;
    const lower=q.toLowerCase();$('prompt').value='';
    if(state.active==='import'){
      if(/stop|cancel/.test(lower)){stopLesson();return;}
      if(/pause/.test(lower)){pauseLesson();return;}
      if(/resume|continue/.test(lower)){resumeLesson();return;}
      if(/figure|image|diagram|picture|chart/.test(lower)&&aiOn())readPage(q);
      else if(/figure|image|diagram|picture|chart/.test(lower))caption('Images not supported',`Reasoning about figures and images is out of scope in this mock. I only use PDF text or opt-in OCR text, so I won't guess.`);
      else if(/explain|what does|what is|why|how|simpler|example|mean/.test(lower))explainSelection(/^explain( this| selection| this page)?$/.test(lower)?'':q);
      else caption('Imported PDF','Guided lessons, quizzes and review exist only for the demo PDF; no AI service is configured in this mock. Select text and ask me to explain it.');
      return;
    }
    const decision=window.SmartPathExplain?window.SmartPathExplain.classifyUtterance(q):{intent:routePrompt(q),reformulation:'default'};
    switch(decision.intent){
      case 'stop':stopLesson();return;
      case 'pause':pauseLesson();return;
      case 'resume':resumeLesson();return;
      case 'quiz_me':allowSpeech('prompt');showQuiz();return;
      case 'teach_concept':
      case 'teach_page':allowSpeech('prompt');startLesson();return;
      case 'review_weaknesses':{
        allowSpeech('prompt');
        const weak=[...nodes()].sort((a,b)=>a.confidence-b.confidence)[0];focusConcept(weak.id,true);
        const msg=`Your lowest-confidence concept is ${weak.label} (${Math.round(weak.confidence*100)}%). I moved to its source evidence on page ${weak.pageIndex+1}.`;
        caption('Guide Mode · Fixture recommendation',msg);speak(msg);return;
      }
      case 'show_related':{
        const conceptId=state.selectedConceptId||findAnchor(state.selectedAnchorId||'')?.conceptId||'pointers';
        const related=showRelatedConcepts(conceptId);const node=findNode(conceptId);
        if(!related||!node){caption('Concept graph','That concept is not in this fixture.');return;}
        const labels=related.map(relatedId=>findNode(relatedId)?.label||relatedId);
        const msg=labels.length?`${node.label} is related to ${labels.join(', ')}. These links are not prerequisites.`:`${node.label} has no related concepts in this fixture.`;
        caption('Concept graph · Related',msg);return;
      }
      case 'explain_selection':allowSpeech('prompt');presentUtterance(q,decision.reformulation);return;
      case 'focus_graph':
      case 'general_question':
      case 'unsupported':
        caption('Mock dataset only','This standalone mock demonstrates the SmartPath Live interface with one verified LC-3 lesson. It does not call Grok or generate open-ended AI answers.');
        return;
      default:{
        caption('Mock dataset only','This standalone mock demonstrates the SmartPath Live interface with one verified LC-3 lesson. It does not call Grok or generate open-ended AI answers.');
        return;
      }
    }
  }
  function commandMessage(event){
    if(event.source!==window || event.origin!==location.origin)return;
    const d=event.data;if(!d||typeof d!=='object')return;
    if(d.source==='smartpath-live-extension'){
      if(d.type==='extension_ready'){state.extensionOnline=true;
        $('extension-status').classList.add('online');$('extension-status').textContent='● Chrome extension connected';return;}
      if(d.type==='action_result'){
        const pending=state.pending.get(d.requestId);
        if(pending){state.pending.delete(d.requestId);pending.resolve(d);}
        return;
      }
      if(d.type==='import_pdf'){importFromMessage(d);return;}
      if(d.type==='focus_concept' && typeof d.conceptId==='string'){focusConcept(d.conceptId,{selectSource:d.selectSource===true});return;}
      if(d.type==='clear_focus'){clearFocus();return;}
      if(d.type==='show_path'){
        if(Array.isArray(d.conceptIds))showPath(d.conceptIds);
        else if(typeof d.from==='string'&&typeof d.to==='string')showPath({from:d.from,to:d.to});
        return;
      }
      if(d.type==='command'){
        const valid=['teach','pause','resume','stop','quiz','ask'];if(!valid.includes(d.command))return;
        if(d.command==='teach')startLesson();else if(d.command==='pause')pauseLesson();
        else if(d.command==='resume')resumeLesson();else if(d.command==='stop')stopLesson();
        else if(d.command==='quiz')showQuiz();else if(d.command==='ask')handlePrompt(safeText(d.prompt));
      }
    }
  }
  function setupEvents(){
    window.addEventListener('message',commandMessage);
    $('start-lesson').addEventListener('click',startLesson);
    $('top-quiz').addEventListener('click',showQuiz);
    $('top-progress').addEventListener('click',()=>handlePrompt('What should I review?'));
    $('open-doc').addEventListener('click',()=>{
      if(state.active==='import'){setActive('demo');return;}
      window.PdfViewerApi.clearHighlight();window.PdfViewerApi.scrollToPage(0,{behavior:'auto'});$('pdf-viewport').scrollTop=0;
    });
    $('import-doc').addEventListener('click',()=>$('pdf-file').click());$('pdf-file').addEventListener('change',e=>{importFile(e.target.files[0]);e.target.value='';});
    $('explain-sel').addEventListener('click',()=>explainSelection());document.addEventListener('selectionchange',captureSel);
    window.addEventListener('smartpath:pdf',e=>{if(state.active==='import'&&e.detail&&e.detail.type==='zoom')renderImported();});
    $('reset-graph').addEventListener('click',()=>clearFocus());
    $('pause-btn').addEventListener('click',()=>pauseLesson());$('resume-btn').addEventListener('click',resumeLesson);
    $('stop-btn').addEventListener('click',stopLesson);$('close-quiz').addEventListener('click',()=>{$('quiz-backdrop').hidden=true;});
    $('send-prompt').addEventListener('click',()=>handlePrompt($('prompt').value));
    $('prompt').addEventListener('keydown',e=>{if(e.key==='Enter')handlePrompt(e.target.value);});
    document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{
      state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('selected',x===b));
      $('mode-description').textContent=modeDescriptions[state.mode];
      if(state.mode==='guide')handlePrompt('What should I review?');
      else if(state.mode==='explore')caption('Explore Mode','Click a passage in the PDF to ask what it means.');
    }));
    $('pdf-viewport').addEventListener('wheel',e=>{if(e.isTrusted&&state.running)pauseLesson('You scrolled the document.');},{passive:true});
    ensureExplainActions();
    $('voice-toggle').addEventListener('click',()=>{
      if(voiceOn()){state.p2Muted=!state.p2Muted;if(state.p2Muted)stopAudio();syncVoice();toast(state.p2Muted?'Spoken answers muted':'Spoken answers on');return;}
      const next = window.SmartPathSpeech ? !window.SmartPathSpeech.isEnabled() : !state.voice;
      if (window.SmartPathSpeech) window.SmartPathSpeech.setEnabled(next);
      state.voice=next;$('voice-toggle').setAttribute('aria-pressed',String(state.voice));
      $('voice-toggle').textContent=state.voice?'◖))':'◖';
      $('voice-toggle').title=state.voice?'Spoken narration on. Captions stay visible.':'Spoken narration off. Captions stay visible.';
      toast(state.voice?'Speech enabled':'Speech muted. Captions stay on.');
    });
    $('stop-audio').addEventListener('click',stopAudio);
    $('mic-button').addEventListener('click',()=>{if(voiceOn())micRecord();else startMicrophone();});
  }
  function micFallback(message){
    const button=$('mic-button');
    button.dataset.micState='unavailable';
    $('prompt').disabled=false;
    toast(message);
    caption('Text input ready',message);
    $('prompt').focus();
  }
  async function startMicrophone(){
    const epoch=state.micEpoch||0;
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    const fail=(message)=>{if((state.micEpoch||0)===epoch)micFallback(message);};
    if(!SpeechRecognition){fail('Speech recognition is not available. Type your question. Spoken explanations still play.');return;}
    try{
      if(navigator.permissions&&navigator.permissions.query){
        const perm=await navigator.permissions.query({name:'microphone'});
        if(perm.state==='denied'){fail('Microphone permission is blocked. Type your question. Spoken explanations still play.');return;}
      }
    }catch(error){/* Some browsers reject the microphone permission name. Recognition still reports denial. */}
    if((state.micEpoch||0)!==epoch)return;
    const sr=new SpeechRecognition();sr.lang='en-US';sr.interimResults=false;sr.maxAlternatives=1;
    $('mic-button').dataset.micState='listening';
    caption('Listening','Listening for one voice command. Text input still works if this fails.');
    sr.onresult=event=>{
      $('mic-button').dataset.micState='idle';
      const text=event.results[0][0].transcript;$('prompt').value=text;handlePrompt(text);
    };
    sr.onerror=event=>{
      $('mic-button').dataset.micState='denied';
      const denied=event.error==='not-allowed'||event.error==='service-not-allowed'||event.error==='audio-capture';
      fail(denied?'Microphone permission failed. Type your question. Spoken explanations still play.':`Microphone unavailable (${event.error}). Type your question. Spoken explanations still play.`);
    };
    try{sr.start();}catch(error){fail('Could not start the microphone. Type your question. Spoken explanations still play.');}
  }
  function ensureExplainActions(){
    if($('caption-actions'))return;
    const host=$('caption-text').parentElement;
    const bar=document.createElement('div');bar.id='caption-actions';bar.hidden=true;
    [['simpler','Simpler'],['example','Example'],['relationship','Relationship']].forEach(([id,label])=>{
      const button=document.createElement('button');button.type='button';button.dataset.reformulation=id;button.textContent=label;
      button.addEventListener('click',()=>{if(state.selectedAnchorId)presentExplanationForAnchor(state.selectedAnchorId,id);});
      bar.append(button);
    });
    host.append(bar);
  }
  async function attachExplanations(fixture){
    if(fixture.explanations&&fixture.explanations.passages)return;
    const response=await fetch('/fixtures/explanations.json',{cache:'no-store'});
    if(!response.ok)throw new Error(`Explanation fixture HTTP ${response.status}`);
    const explanations=await response.json();
    if(explanations.documentId!==fixture.document.id)throw new Error('Explanation fixture document does not match');
    fixture.explanations=explanations;
  }
  const pdfListeners={
    onAnchorClick(anchor,event){
      const user=event.isTrusted;
      if(user&&state.running){pauseLesson('You interacted with the document.');selectAnchor(anchor.id,false);return;}
      selectAnchor(anchor.id,false);
      if(anchor.conceptId&&window.SmartPathGraph)window.SmartPathGraph.focusConcept(anchor.conceptId);
      if(user)presentExplanationForAnchor(anchor.id,'default');
    },
    onHighlight:syncAnchorState,
    onGroundingFailure(){$('selected-page-caption').textContent='Source: could not pinpoint';},
    onVisiblePage(){if(state.active==='import')setPageLabel();}
  };
  async function init(){
    try{
      const response=await fetch('/fixtures/demo.json',{cache:'no-store'});
      if(!graphModel())throw new Error('graph.js must load before app.js');
      if(!response.ok)throw new Error(`Fixture HTTP ${response.status}`);
      state.fixture=await response.json();
      if(!state.fixture.pages.length || !state.fixture.anchors.length)throw new Error('Mock document is incomplete');
      try{await attachExplanations(state.fixture);}catch(error){console.error(error);caption('Explanations unavailable',error.message);}
      if(!window.PdfViewerApi)throw new Error('PDF viewer API failed to load');
      window.PdfViewerApi.mount(state.fixture,pdfListeners);
      renderGraph();renderProgress();setupEvents();refreshHealth();
      if(location.hash==='#import')caption('Importing PDF','Waiting for the extension to hand over the PDF…');
      emit('app_ready',{documentId:state.fixture.document.id});
      setTimeout(()=>{if(!state.extensionOnline){$('extension-status').textContent='Extension not detected · app-only mode';}},1200);
    }catch(error){caption('Could not load fixture',error.message);console.error(error);}
  }
  document.addEventListener('smartpath:focus-concept',event=>{
    const detail=event.detail||{};
    if(typeof detail.conceptId==='string')focusConcept(detail.conceptId,{selectSource:detail.selectSource===true});
  });
  document.addEventListener('smartpath:clear-focus',()=>clearFocus());
  document.addEventListener('smartpath:show-path',event=>{
    const detail=event.detail||{};
    if(Array.isArray(detail.conceptIds))showPath(detail.conceptIds);
    else if(typeof detail.from==='string'&&typeof detail.to==='string')showPath({from:detail.from,to:detail.to});
  });
  installGraphStyles();
  window.SmartPathGraph={
    focusConcept,getRelatedConceptIds,showRelatedConcepts,showPath,clearFocus,
    getFocusedConceptId:()=>state.selectedConceptId
  };
  init();
})();
