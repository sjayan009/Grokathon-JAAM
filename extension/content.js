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
  let state='following', last={x:50,y:80}, stopEpoch=0;
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
    else if(state==='acting' && e.isTrusted && e.movementX*e.movementX+e.movementY*e.movementY>18*18){
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
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==origin||!event.data||event.data.source!=='smartpath-mock-app')return;
    const d=event.data;
    if(d.type==='app_ready')window.postMessage({source:'smartpath-live-extension',type:'extension_ready'},origin);
    else if(d.type==='action_request')perform(d);
    else if(d.type==='lesson_stopped'){stopEpoch++;setState('following');move(last.x,last.y,true);}
    else if(d.type==='lesson_paused'){stopEpoch++;setState('paused');}
    else if(d.type==='lesson_resumed'){stopEpoch++;setState('following');}
    else if(d.type==='lesson_completed'){setState('following');}
  });
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type==='control'&&['teach','pause','resume','stop','quiz','ask'].includes(message.command)){
      if(message.command==='stop'){stopEpoch++;setState('following');}
      if(message.command==='pause'){stopEpoch++;setState('paused');}
      window.postMessage({source:'smartpath-live-extension',type:'command',command:message.command,prompt:typeof message.prompt==='string'?message.prompt.slice(0,1000):''},origin);
      sendResponse({ok:true,status:state});return;
    }
    if(message?.type==='get_status'){sendResponse({ok:true,status:state});return;}
  });
  window.postMessage({source:'smartpath-live-extension',type:'extension_ready'},origin);
})();
