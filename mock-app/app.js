/* SmartPath Live mock. Uses a generated demo PDF and verified anchors, not the SmartPath backend/Grok. */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {fixture:null, zoom:.85, selectedAnchorId:null, selectedConceptId:null,
    extensionOnline:false, voice:true, mode:'teach', running:false, paused:false,
    token:0, stepIndex:0, pending:new Map(), lastEvent:null};
  const modeDescriptions = {
    teach:'Follow a narrated walkthrough of the source material.',
    explore:'Click a highlighted passage, then ask for an explanation.',
    guide:'Find weaker concepts and jump to their source evidence.'
  };
  const anchors = () => state.fixture.anchors;
  const nodes = () => state.fixture.graph.nodes;
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
    if (window.SmartPathSpeech) return window.SmartPathSpeech.cancel(reason || 'stop');
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    return {ok:true, reason: reason || 'stop'};
  }
  function allowSpeech(source) {
    if (window.SmartPathSpeech) window.SmartPathSpeech.allow(source || 'user');
  }
  function setPageLabel() {
    const viewport=$('pdf-viewport');const pages=[...viewport.querySelectorAll('.pdf-page-wrap')];
    const origin=viewport.getBoundingClientRect().top+20;
    let best=0,bestDistance=Infinity;
    pages.forEach((el,i)=>{const distance=Math.abs(el.getBoundingClientRect().top-origin);if(distance<bestDistance){bestDistance=distance;best=i;}});
    $('page-label').textContent=`Page ${best+1} of ${pages.length}`;
  }
  function renderPages(){
    const wrap=$('pdf-pages');wrap.replaceChildren();
    state.fixture.pages.forEach(page=>{
      const container=document.createElement('div');container.className='pdf-page-wrap';container.id=`page-${page.pageIndex}`;
      container.style.width=`${Math.round(612*state.zoom)}px`;
      const image=document.createElement('img');image.src=page.image;image.alt=`Actual rendered PDF page ${page.pageIndex+1}`;
      container.append(image);
      anchors().filter(a=>a.pageIndex===page.pageIndex).forEach(a=>{
        const r=a.rects[0],b=document.createElement('button');
        b.type='button';b.className='pdf-anchor';b.dataset.anchorId=a.id;b.dataset.active=String(state.selectedAnchorId===a.id);
        b.setAttribute('aria-label',`Highlight source passage: ${a.quote}`);
        b.setAttribute('aria-pressed',String(state.selectedAnchorId===a.id));
        b.style.left=`${r.x*100}%`;b.style.top=`${r.y*100}%`;
        b.style.width=`${Math.max(r.width*100,3)}%`;b.style.height=`${Math.max(r.height*100,2)}%`;
        if(state.selectedAnchorId===a.id)b.classList.add('active');
        b.addEventListener('click',event=>{
          if(event.isTrusted && state.running)pauseLesson('You interacted with the document.');
          selectAnchor(a.id,true);
        });container.append(b);
      });
      const sticker=document.createElement('span');sticker.className='page-sticker';sticker.textContent=`${page.pageIndex+1} / ${state.fixture.pages.length}`;container.append(sticker);
      wrap.append(container);
    });setPageLabel();
  }
  function selectAnchor(id,showExplanation=false){
    const a=findAnchor(id);if(!a)return false;
    state.selectedAnchorId=id;
    document.querySelectorAll('[data-anchor-id]').forEach(el=>{
      const match=el.dataset.anchorId===id;el.classList.toggle('active',match);el.dataset.active=String(match);el.setAttribute('aria-pressed',String(match));
    });
    const target=document.querySelector(`[data-anchor-id="${CSS.escape(id)}"]`);
    if(target)target.scrollIntoView({behavior:'smooth',block:'center'});
    $('selected-page-caption').textContent=`Source: page ${a.pageIndex+1}`;
    if(showExplanation){caption(`Page ${a.pageIndex+1} · ${findNode(a.conceptId)?.label||'Concept'}`,a.quote);}
    emit('source_selected',{anchorId:id,conceptId:a.conceptId,pageIndex:a.pageIndex});return true;
  }
  function renderGraph(){
    const canvas=$('graph-nodes');canvas.replaceChildren();const svg=$('graph-links');svg.replaceChildren();
    state.fixture.graph.relationships.forEach(edge=>{
      const a=findNode(edge.source),b=findNode(edge.target);if(!a||!b)return;
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',a.x+12);line.setAttribute('y1',a.y+6);line.setAttribute('x2',b.x+12);line.setAttribute('y2',b.y+6);
      svg.append(line);
    });
    nodes().forEach(n=>{
      const btn=document.createElement('button');btn.type='button';btn.className='graph-node';
      btn.dataset.conceptId=n.id;btn.dataset.active=String(state.selectedConceptId===n.id);
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
  }
  function focusConcept(id,selectSource=false){
    const n=findNode(id);if(!n)return false;state.selectedConceptId=id;
    document.querySelectorAll('[data-concept-id]').forEach(el=>{
      const match=el.dataset.conceptId===id;el.classList.toggle('active',match);
      el.dataset.active=String(match);el.setAttribute('aria-pressed',String(match));
    });
    $('focused-concept').textContent=n.label;
    $('graph-summary').textContent=`${n.type} · confidence ${Math.round(n.confidence*100)}% · source page ${n.pageIndex+1}. Connected nodes are related concepts, not verified prerequisites.`;
    if(selectSource && n.anchorId)selectAnchor(n.anchorId);
    emit('concept_focused',{conceptId:id});return true;
  }
  function renderProgress(){
    const list=$('progress-list');list.replaceChildren();
    nodes().filter(n=>n.id!=='addresses').forEach(n=>{
      const item=document.createElement('div');item.className='progress-item';
      const heading=document.createElement('div');heading.className='progress-head';
      const label=document.createElement('span');label.textContent=n.label;
      const pct=document.createElement('span');pct.textContent=`${Math.round(n.confidence*100)}%`;
      heading.append(label,pct);const track=document.createElement('div');track.className='progress-track';
      const bar=document.createElement('i');bar.style.width=`${n.confidence*100}%`;track.append(bar);
      item.append(heading,track);list.append(item);
    });
  }
  function showQuiz(){
    const q=state.fixture.quiz;$('quiz-question').textContent=q.question;
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
    state.token++;state.running=false;state.paused=false;cancelVoice('stop');$('lesson-strip').hidden=true;
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
    if(state.running){toast('A lesson is already in progress.');return;}
    state.token++;const token=state.token;allowSpeech('lesson');state.running=true;state.paused=false;state.stepIndex=0;
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
  function handlePrompt(text){
    const q=text.trim();if(!q)return;
    const lower=q.toLowerCase();$('prompt').value='';
    if(/stop|cancel/.test(lower)){stopLesson();return;}
    if(/pause/.test(lower)){pauseLesson();return;}
    if(/resume|continue/.test(lower)){resumeLesson();return;}
    allowSpeech('prompt');
    if(/quiz|test me|check understanding/.test(lower)){showQuiz();return;}
    if(/teach|walk me|start lesson|from scratch|ldr/.test(lower)&& !/what does|why does|explain this/.test(lower)){startLesson();return;}
    if(/review|weak|study next/.test(lower)){
      const weak=[...nodes()].sort((a,b)=>a.confidence-b.confidence)[0];focusConcept(weak.id,true);
      const msg=`Your lowest-confidence concept is ${weak.label} (${Math.round(weak.confidence*100)}%). I moved to its source evidence on page ${weak.pageIndex+1}.`;
      caption('Guide Mode · Fixture recommendation',msg);speak(msg);return;
    }
    if(/explain|what does|why|how|simpler|example/.test(lower)){
      const id=state.selectedAnchorId||'ldr_instruction';selectAnchor(id);
      const example=id==='pointer_register'||id==='pointer_distinction'?'The register contains x4000, an address. To get 7, you must read Memory[x4000].':'LDR takes the base address in R2, adds the offset, then loads the value stored at that memory address.';
      caption('Explore Mode · Fixture explanation',example);speak(example);return;
    }
    caption('Mock dataset only','This standalone mock demonstrates the SmartPath Live interface with one verified LC-3 lesson. It does not call Grok or generate open-ended AI answers.');
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
    $('open-doc').addEventListener('click',()=>{state.selectedAnchorId=null;renderPages();$('pdf-viewport').scrollTop=0;});
    $('reset-graph').addEventListener('click',()=>{state.selectedConceptId=null;renderGraph();$('focused-concept').textContent='Your learning map';$('graph-summary').textContent='Choose a node to see where it appears in the PDF.';});
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
    $('zoom-out').addEventListener('click',()=>changeZoom(-.1));$('zoom-in').addEventListener('click',()=>changeZoom(.1));
    $('pdf-viewport').addEventListener('scroll',()=>setPageLabel(),{passive:true});
    $('pdf-viewport').addEventListener('wheel',e=>{if(e.isTrusted&&state.running)pauseLesson('You scrolled the document.');},{passive:true});
    $('voice-toggle').addEventListener('click',()=>{
      const next = window.SmartPathSpeech ? !window.SmartPathSpeech.isEnabled() : !state.voice;
      if (window.SmartPathSpeech) window.SmartPathSpeech.setEnabled(next);
      state.voice=next;$('voice-toggle').setAttribute('aria-pressed',String(state.voice));
      $('voice-toggle').textContent=state.voice?'◖))':'◖';
      $('voice-toggle').title=state.voice?'Spoken narration on. Captions stay visible.':'Spoken narration off. Captions stay visible.';
      toast(state.voice?'Speech enabled':'Speech muted. Captions stay on.');
    });
    $('mic-button').addEventListener('click',()=>{
      const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!SpeechRecognition){toast('Speech recognition is not available in this browser. Use text input.');return;}
      const sr=new SpeechRecognition();sr.lang='en-US';sr.interimResults=false;sr.maxAlternatives=1;
      caption('Listening','Listening for one voice command…');
      sr.onresult=e=>{const text=e.results[0][0].transcript;$('prompt').value=text;handlePrompt(text);};
      sr.onerror=e=>toast(`Microphone unavailable: ${e.error}. Use text input.`);
      try{sr.start();}catch(e){toast('Could not start microphone. Use text input.');}
    });
  }
  function changeZoom(delta){state.zoom=Math.max(.55,Math.min(1.45,Math.round((state.zoom+delta)*100)/100));$('zoom-label').textContent=`${Math.round(state.zoom*100)}%`;renderPages();if(state.selectedAnchorId)selectAnchor(state.selectedAnchorId);}
  async function init(){
    try{
      const response=await fetch('/fixtures/demo.json',{cache:'no-store'});
      if(!response.ok)throw new Error(`Fixture HTTP ${response.status}`);
      state.fixture=await response.json();
      if(!state.fixture.pages.length || !state.fixture.anchors.length)throw new Error('Mock document is incomplete');
      renderPages();renderGraph();renderProgress();setupEvents();
      emit('app_ready',{documentId:state.fixture.document.id});
      setTimeout(()=>{if(!state.extensionOnline){$('extension-status').textContent='Extension not detected · app-only mode';}},1200);
    }catch(error){caption('Could not load fixture',error.message);console.error(error);}
  }
  init();
})();
