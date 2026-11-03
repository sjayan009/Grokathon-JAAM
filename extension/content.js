/* Runs only on configured local mock origins. Visible overlay + real DOM target activation. */
(() => {
  if (window.__smartpathMockCursorInstalled) return;
  window.__smartpathMockCursorInstalled=true;
  const host = document.createElement('div');
  host.setAttribute('data-smartpath-extension-root','true');
  host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:visible';
  const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML=`<style>
     .cursor{position:fixed;top:0;left:0;display:flex;align-items:center;gap:5px;pointer-events:none;transform:translate3d(25px,25px,0);will-change:transform;z-index:99;filter:drop-shadow(0 4px 10px #0f766e77)}
     .pointer{height:27px;width:23px;display:block;background:linear-gradient(155deg,#22d3ee,#14b8a6);border:1px solid #ccfbf1;clip-path:polygon(0 0,0 90%,31% 71%,49% 100%,62% 93%,43% 63%,83% 57%);transform:rotate(-10deg)}
     .tag{background:#0f2c3a;color:#d8fff6;font:700 10px ui-sans-serif,system-ui,sans-serif;padding:5px 7px;border-radius:7px;border:1px solid #43d2bead;white-space:nowrap;box-shadow:0 7px 15px #0f172a36}
     .ring{position:fixed;width:10px;height:10px;border-radius:999px;background:#14b8a6aa;filter:blur(8px)}
     .acting .tag{background:#0f766e}.paused .tag{background:#7c2d12}
     @media(prefers-reduced-motion:reduce){.cursor{transition:none!important}}
     </style><div class="cursor following" id="cursor"><i class="pointer"></i><span class="tag" id="tag">SmartPath</span></div>`;
  document.documentElement.append(host);
  const pointer=shadow.getElementById('cursor');
  const tag=shadow.getElementById('tag');
  let state='following', last={x:50,y:80}, stopEpoch=0, cdpBusy=false, agentBusy=false, queued=null, importing=null, appReady=false;
  const origin=location.origin;
  const sayStatus=(status)=>chrome.runtime.sendMessage({type:'smartpath_status',status}).catch(()=>{});
  function move(x,y,animate){
    if(!animate)pointer.style.transition='none';
    else pointer.style.transition='transform 390ms cubic-bezier(.18,.87,.19,1)';
    pointer.style.transform=`translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  }
  function setState(next){state=next;pointer.className=`cursor ${next}`;tag.textContent=next==='acting'?'AI is pointing':next==='paused'?'Paused':'SmartPath';sayStatus(next);}
  document.addEventListener('mousemove',e=>{
    if(state==='following'){last={x:e.clientX+18,y:e.clientY+15};move(last.x,last.y,false);}
    else if(state==='acting' && e.isTrusted && !cdpBusy && e.movementX*e.movementX+e.movementY*e.movementY>18*18){
      stopEpoch++;setState('paused');window.postMessage({source:'smartpath-live-extension',type:'command',command:'pause'},origin);
    }
  },{passive:true});
  function targetFor(step){
    if(!step||!['highlight_pdf','focus_graph','ask_question'].includes(step.kind))throw new Error('Unknown action type');
    if(!/^[a-z0-9_-]{1,70}$/.test(String(step.targetId||'')))throw new Error('Invalid target ID');
    const selector=step.kind==='highlight_pdf'?`[data-anchor-id="${step.targetId}"]`:step.kind==='focus_graph'?`[data-concept-id="${step.targetId}"]`:'#top-quiz';
    const matching=document.querySelectorAll(selector);
    if(matching.length!==1)throw new Error(`Expected exactly one target; found ${matching.length}`);
    return matching[0];
  }
  const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  async function perform(d){
    const epoch=stopEpoch;
    try{
      const target=targetFor(d.step);
      target.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});
      await sleep(400);
      if(epoch!==stopEpoch)throw new Error('Action cancelled or paused');
      const r=target.getBoundingClientRect();
      if(r.width<2||r.height<2||r.top>=innerHeight||r.bottom<=0||r.left>=innerWidth||r.right<=0)
        throw new Error('Target is not visible in the viewport');
      setState('acting');move(r.left+r.width/2,r.top+r.height/2,true);
      await sleep(450);
      if(epoch!==stopEpoch)throw new Error('Action cancelled or paused');
      // Browser DOM click on the actual interface control; never a fake success event.
      target.click();await sleep(70);
      const valid = d.step.kind==='ask_question' ? document.getElementById('quiz-backdrop')?.hidden===false :
        target.getAttribute('aria-pressed')==='true' && target.dataset.active==='true';
      if(!valid)throw new Error('Real UI transition did not verify');
      window.postMessage({source:'smartpath-live-extension',type:'action_result',requestId:d.requestId,ok:true},origin);
      setState('following');move(last.x,last.y,true);
    }catch(err){
      window.postMessage({source:'smartpath-live-extension',type:'action_result',requestId:d.requestId,ok:false,error:String(err.message||err)},origin);
      if(state!=='paused')setState('following');
    }
  }
  // F17 agent control: allowlisted mock controls only; each run is user-approved in the side panel. Real CDP click, then real UI-state verification.
  const txt=id=>document.getElementById(id)?.textContent;
  const AGENT={
    quiz:{sel:'#top-quiz',pre:()=>0,ok:()=>document.getElementById('quiz-backdrop')?.hidden===false},
    close_quiz:{sel:'#close-quiz',pre:()=>0,ok:()=>document.getElementById('quiz-backdrop')?.hidden===true},
    reset:{sel:'#reset-graph',pre:()=>0,ok:()=>txt('focused-concept')==='Your learning map'},
    zoom_in:{sel:'#zoom-in',pre:()=>txt('zoom-label'),ok:b=>txt('zoom-label')!==b},
    zoom_out:{sel:'#zoom-out',pre:()=>txt('zoom-label'),ok:b=>txt('zoom-label')!==b}};
  async function agentAct(id){
    const a=AGENT[id],epoch=stopEpoch;
    if(!Object.hasOwn(AGENT,id))throw new Error('Action is not in the allowlist');
    if(agentBusy)throw new Error('Another action is running');
    agentBusy=true;
    try{
      const m=document.querySelectorAll(a.sel);if(m.length!==1)throw new Error(`Expected exactly one target; found ${m.length}`);
      m[0].scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});await sleep(400);
      const r=m[0].getBoundingClientRect();
      if(r.width<2||r.height<2||r.top>=innerHeight||r.bottom<=0||r.left>=innerWidth||r.right<=0)throw new Error('Target is not visible in the viewport');
      if(epoch!==stopEpoch)throw new Error('Action cancelled');
      setState('acting');move(r.left+r.width/2,r.top+r.height/2,true);await sleep(450);
      if(epoch!==stopEpoch)throw new Error('Action cancelled');
      const before=a.pre();cdpBusy=true;
      let res;try{res=await chrome.runtime.sendMessage({type:'cdp_click',x:r.left+r.width/2,y:r.top+r.height/2});}finally{cdpBusy=false;}
      if(!res?.ok)throw new Error(res?.error||'CDP click failed');
      await sleep(150);
      if(!a.ok(before))throw new Error('Real UI transition did not verify (control may be at its limit)');
    }finally{agentBusy=false;if(state!=='paused'){setState('following');move(last.x,last.y,true);}}
  }
  // F09: payload queued until the page says app_ready (fallback timer covers app_ready firing before this script loaded).
  const report=r=>{clearTimeout(importing?.timer);const name=importing?.name;importing=null;chrome.runtime.sendMessage({type:'import_result',name,...r}).catch(()=>{});};
  function flush(){
    if(!queued||!appReady||importing)return;
    const q=queued;queued=null;
    importing={name:q.name,timer:setTimeout(()=>report({ok:false,error:'The workspace did not respond to the import (timed out)'}),30000)};
    window.postMessage({source:'smartpath-live-extension',type:'import_pdf',name:q.name,sourceUrl:q.sourceUrl,bytesBase64:q.bytesBase64},origin);
  }
  setTimeout(()=>{appReady=true;flush();},2000);
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==origin||!event.data||event.data.source!=='smartpath-mock-app')return;
    const d=event.data;
    if(d.type==='app_ready'){window.postMessage({source:'smartpath-live-extension',type:'extension_ready'},origin);appReady=true;flush();}
    else if(d.type==='import_result'){if(importing)report({ok:!!d.ok,error:typeof d.error==='string'?d.error.slice(0,200):undefined,pageCount:Number.isFinite(d.pageCount)?d.pageCount:undefined});}
    else if(d.type==='action_request')perform(d);
    else if(d.type==='lesson_stopped'){stopEpoch++;setState('following');move(last.x,last.y,true);}
    else if(d.type==='lesson_paused'){stopEpoch++;setState('paused');}
    else if(d.type==='lesson_resumed'){stopEpoch++;setState('following');}
    else if(d.type==='lesson_completed'){setState('following');}
  });
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type==='control'&&['teach','pause','resume','stop','quiz','ask'].includes(message.command)){
      if(message.command==='stop'){stopEpoch++;queued=null;setState('following');}
      if(message.command==='pause'){stopEpoch++;setState('paused');}
      window.postMessage({source:'smartpath-live-extension',type:'command',command:message.command,prompt:typeof message.prompt==='string'?message.prompt.slice(0,1000):''},origin);
      sendResponse({ok:true,status:state});return;
    }
    if(message?.type==='agent_action'){
      agentAct(String(message.action)).then(()=>sendResponse({ok:true}),e=>sendResponse({ok:false,error:String(e.message||e)}));return true;
    }
    if(message?.type==='import_pdf'){
      const b=message.bytesBase64;
      if(typeof b!=='string'||b.length>34*1024*1024)sendResponse({ok:false,error:'Invalid or oversized PDF payload'});
      else if(queued||importing)sendResponse({ok:false,error:'An import is already running'});
      else{queued={name:String(message.name||'document.pdf').slice(0,120),sourceUrl:String(message.sourceUrl||'').slice(0,2000),bytesBase64:b};sendResponse({ok:true});flush();}
      return;
    }
    if(message?.type==='get_status'){sendResponse({ok:true,status:state});return;}
  });
  window.postMessage({source:'smartpath-live-extension',type:'extension_ready'},origin);
})();
