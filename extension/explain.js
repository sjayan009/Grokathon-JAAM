/* Injected on demand (context menu + activeTab). Closed-shadow popover; the network call is made by the background (page CORS never applies).
   Sent only after per-origin consent: the selection + its enclosing block text (<=2000 chars) + document.title/origin. Page text is untrusted: textContent only. */
(()=>{
  window.__smartpathExplainDismiss?.();
  const text=String(window.__smartpathExplainText||'').slice(0,1000), origin=location.origin;
  const FIX=[[/\bmemory\b/i,'Memory is a long array of numbered cells; each address holds one 16-bit word in LC-3.'],
    [/\baddress(es)?\b/i,'An address is the number that identifies one memory location.'],
    [/\bpointers?\b/i,'A pointer is a value that holds the memory address of another value.'],
    [/\bLDR\b/i,'LDR DR, BaseR, offset6 loads the word at address BaseR + offset into DR.'],
    [/\bSTR\b/i,'STR SR, BaseR, offset6 stores SR into memory at address BaseR + offset.']];
  const NOAI="SmartPath Live can see your selection, but no AI service is configured in this mock, so it can't explain arbitrary text yet.";
  let rect=null, context='';
  try{
    const s=getSelection();
    if(s.rangeCount){
      const r=s.getRangeAt(0);rect=r.getBoundingClientRect();
      const n=r.commonAncestorContainer, el=n.nodeType===1?n:n.parentElement;
      const b=el?.closest('p,li,blockquote,pre,td,th,dd,dt,h1,h2,h3,h4,h5,h6,figcaption,div,section,article');
      if(b&&b!==document.body&&b!==document.documentElement)context=(b.innerText||'').slice(0,2000);
    }
  }catch{}
  const host=document.createElement('div');host.style.cssText='all:initial;position:fixed;z-index:2147483647;';
  const sh=host.attachShadow({mode:'closed'});
  sh.innerHTML=`<style>.p{width:300px;box-sizing:border-box;position:relative;background:#102136;color:#eefcf9;border:1px solid #2dd4bf;border-radius:12px;padding:12px;font:13px/1.5 system-ui,sans-serif;box-shadow:0 10px 30px #0008}
    h4{margin:0 0 6px;font-size:12px;color:#5eead4}.t{font-size:11px;color:#9fb6c6;margin-top:8px}.k{font-size:10px;color:#5eead4;margin-bottom:4px}
    q{display:block;font-size:11px;color:#bfe9e0;margin-top:6px;border-left:2px solid #2dd4bf;padding-left:6px;quotes:none}
    button{font:700 11px system-ui;border-radius:7px;border:1px solid #375a6c;background:#1d384d;color:#ddf5ef;padding:5px 8px;cursor:pointer;margin:8px 6px 0 0}.x{position:absolute;top:6px;right:4px;margin:0}</style>
    <div class="p" role="dialog" aria-label="SmartPath Live explanation"><button class="x" aria-label="Close">✕</button><h4>SmartPath Live</h4><div class="k"></div><div class="b"></div><div class="q"></div><div class="a"></div><div class="t"></div></div>`;
  const $=c=>sh.querySelector('.'+c);
  const x=Math.max(8,Math.min(innerWidth-308,rect?rect.left:innerWidth-324)),y=rect&&rect.height?Math.min(innerHeight-200,rect.bottom+8):24;
  host.style.left=x+'px';host.style.top=Math.max(8,y)+'px';
  let dead=false, cur=0;   // cur = request token; late/stale replies are ignored
  const onKey=e=>{if(e.key==='Escape')dismiss();}, onDown=e=>{if(!e.composedPath().includes(host))dismiss();};
  function dismiss(){dead=true;cur++;hush();host.remove();document.removeEventListener('keydown',onKey,true);document.removeEventListener('mousedown',onDown,true);delete window.__smartpathExplainDismiss;}
  window.__smartpathExplainDismiss=dismiss;
  const ask=chrome.runtime.sendMessage.bind(chrome.runtime);
  const hush=()=>{speechSynthesis.cancel();ask({type:'explain_tts_stop'}).catch(()=>{});};
  async function speak(body){   // Deepgram via offscreen document; browser speechSynthesis if voice is unavailable
    hush();const me=cur;let r;
    try{r=await ask({type:'explain_tts',text:body});}catch{r={ok:false};}
    if(dead||me!==cur){if(dead)hush();return;}
    if(!r?.ok)speechSynthesis.speak(new SpeechSynthesisUtterance(body));
  }
  // view: label, body, quotes[], note, buttons [[label,fn]]
  function view({label,body,quotes=[],note,buttons=[]}){
    if(dead)return;
    $('k').textContent=label;$('b').textContent=body;$('t').textContent=note||'';
    $('q').replaceChildren(...quotes.map(t=>{const e=document.createElement('q');e.textContent='“'+t+'”';return e;}));
    const a=$('a');a.replaceChildren();
    for(const [l,fn] of [...buttons,...(body&&!buttons.noRead?[['Read aloud',()=>speak(body)],['Stop voice',hush]]:[])]){
      const b=document.createElement('button');b.textContent=l;b.onclick=fn;a.append(b);
    }
  }
  const hit=FIX.find(([re])=>re.test(text));
  const fixture=why=>view({label:hit?'Demo fixture explanation':'No explanation available',body:hit?hit[1]:NOAI,
    note:why+" Text-only: SmartPath doesn't annotate this site."});
  async function run(style){
    const me=++cur;hush();
    view({label:'AI explanation',body:'Thinking…',note:'',buttons:[]});
    let r;
    try{r=await ask({type:'explain_ask',text,context,title:`${document.title} (${origin})`,style});}
    catch(e){r={kind:'error',error:String(e.message||e)};}
    if(dead||me!==cur)return;
    if(r?.kind==='ai'){
      view({label:"AI explanation (text-only; SmartPath doesn't annotate this site)",body:String(r.text||''),quotes:(r.quotes||[]).map(String),
        buttons:[['Simpler',()=>run('simpler')],['Example',()=>run('example')]]});
      speak(String(r.text||''));
    }else if(r?.kind==='down')fixture('SmartPath server not running — start `python server/p2_server.py` for AI answers.');
    else if(r?.kind==='noai')fixture('AI not configured on the server.');
    else view({label:'AI request failed',body:String(r?.error||'Unknown error'),note:"Text-only: SmartPath doesn't annotate this site.",buttons:[['Retry',()=>run(style)]]});
  }
  document.addEventListener('keydown',onKey,true);document.addEventListener('mousedown',onDown,true);
  document.documentElement.append(host);
  sh.querySelector('.x').onclick=dismiss;
  ask({type:'explain_consent_get'}).catch(()=>({ok:false})).then(c=>{
    if(dead)return;
    if(c?.consent)return run('normal');
    view({label:'Before sending',body:'Your selection and its paragraph will be sent to your local SmartPath server, which forwards it to the AI service.',
      buttons:Object.assign([['Send',()=>ask({type:'explain_consent_set'}).then(()=>run('normal'),()=>fixture('Could not save your choice.'))],['Cancel',dismiss]],{noRead:true})});
  });
})();
