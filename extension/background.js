import { isStudyOrigin, isStudyUrl } from './lib/bridge.js';

const BADGE_COLOR = '#0f766e';

function enablePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(enablePanel);
chrome.runtime.onStartup.addListener(enablePanel);
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll().then(() => chrome.contextMenus.create({ id: 'smartpath-explain', title: 'Explain in SmartPath Live', contexts: ['selection'] })).catch(console.error);
});

const MOCK=['http://localhost:5173','http://127.0.0.1:5173'], IMPORT_URL='http://localhost:5173/#import', MAX=25*1024*1024;
const SERVER='http://localhost:5173';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const panel=text=>chrome.runtime.sendMessage({type:'panel_status',text}).catch(()=>{});

async function remember(tabId, patch) {
  const stored = await chrome.storage.session.get('runs');
  const runs = { ...(stored.runs || {}) };
  const key = String(tabId);
  runs[key] = { ...(runs[key] || {}), ...patch, updatedAt: Date.now() };
  await chrome.storage.session.set({ runs });
  return runs[key];
}

async function forget(tabId) {
  const stored = await chrome.storage.session.get('runs');
  const runs = { ...(stored.runs || {}) };
  delete runs[String(tabId)];
  await chrome.storage.session.set({ runs });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  forget(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading' && tab.url && !isStudyUrl(tab.url)) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    forget(tabId).catch(() => {});
  }
});

async function forwardControl(message) {
  if (message.command === 'stop') stopAll().catch(() => {}); // P2: cancel imports, offscreen audio, debugger
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isStudyUrl(tab.url || '')) {
    return { ok: false, error: 'Open the local SmartPath study tab first' };
  }
  let status;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: 'get_status' });
  } catch {
    return { ok: false, error: 'Could not connect to content script. Reload localhost:5173.' };
  }
  if (!status?.studyTab || !isStudyOrigin(status.origin)) {
    return { ok: false, error: 'This tab is not the SmartPath study workspace' };
  }
  const stored = await chrome.storage.session.get('runs');
  const known = stored.runs?.[String(tab.id)];
  if (message.command !== 'stop' && known?.documentId && status.documentId && known.documentId !== status.documentId) {
    return { ok: false, error: 'Document changed. Stop and start again.' };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'control',
      command: message.command,
      prompt: typeof message.prompt === 'string' ? message.prompt : '',
      tabId: tab.id,
    });
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'content_hello' || message?.type === 'smartpath_status') {
    const tabId = sender.tab?.id;
    const href = sender.tab?.url || message.href || message.state?.href || '';
    if (!tabId || !isStudyUrl(href)) {
      sendResponse({ ok: false, error: 'not a study tab' });
      return undefined;
    }
    const origin = message.origin || message.state?.origin || '';
    if (origin && !isStudyOrigin(origin)) {
      sendResponse({ ok: false, error: 'origin rejected' });
      return undefined;
    }
    const patch = message.type === 'content_hello'
      ? { origin: message.origin, href, studyTab: true, phase: 'observing' }
      : { ...(message.state || {}), href, studyTab: true };
    remember(tabId, patch).then(() => {
      chrome.action.setBadgeText({ text: 'ON', tabId }).catch(() => {});
      sendResponse({ ok: true, tabId });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'get_detection') {
    Promise.all([chrome.tabs.query({}), chrome.storage.session.get('runs')]).then(([tabs, stored]) => {
      const runs = stored.runs || {};
      const studyTabs = tabs.filter((tab) => isStudyUrl(tab.url || '')).map((tab) => ({
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        windowId: tab.windowId,
        run: runs[String(tab.id)] || null,
      }));
      sendResponse({ ok: true, studyTabs });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'control_from_panel') {
    forwardControl(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return undefined;
});

chrome.commands.onCommand.addListener((command) => {
  const mapped = command === 'stop-lesson' ? 'stop' : command === 'pause-lesson' ? 'pause' : null;
  if (!mapped) return;
  forwardControl({ command: mapped, prompt: '' }).catch(() => {});
});

// ---- F16: explicit context-menu activation; activeTab grants temporary access, explain.js is never a declared content script.
chrome.contextMenus.onClicked.addListener(async (info,tab)=>{
  if(info.menuItemId!=='smartpath-explain'||!tab?.id)return;
  const target={tabId:tab.id,frameIds:[info.frameId||0]};
  try{
    await chrome.scripting.executeScript({target,func:t=>{window.__smartpathExplainText=t;},args:[String(info.selectionText||'').slice(0,1000)]});
    await chrome.scripting.executeScript({target,files:['explain.js']});
  }catch(err){panel('Could not explain on this page (browser-protected pages are not allowed): '+(err.message||err));}
});

// ---- F09: import an http(s) PDF. Bytes live only in worker memory; session storage holds per-tab state so a restart fails cleanly.
const pending=new Map(); let fetching=false, fetchAbort=null;
const LOGIN='This PDF needs a signed-in session. SmartPath never uses your cookies or bypasses access controls: download the file and use the workspace "Import PDF" button.';
async function clearImports(msg){
  fetchAbort?.abort(); pending.clear();
  const keys=Object.keys(await chrome.storage.session.get(null)).filter(k=>k.startsWith('imp_'));
  if(keys.length){await chrome.storage.session.remove(keys);if(msg)panel(msg);}
}
clearImports('Import interrupted (the extension restarted). Try again.').catch(()=>{}); // stale state from a previous worker lifetime
async function fetchPdf(url){
  const u=new URL(url);
  if(!/^https?:$/.test(u.protocol))throw new Error('Only http(s) PDFs can be imported. For local files use the workspace "Import PDF" button.');
  if(!await chrome.permissions.contains({origins:[u.origin+'/*']}))throw new Error('Permission for this site was not granted.');
  fetchAbort=new AbortController();
  const r=await fetch(url,{credentials:'omit',signal:fetchAbort.signal});
  if(r.status===401||r.status===403)throw new Error(LOGIN);
  if(!r.ok)throw new Error(`The server returned ${r.status}.`);
  if(new URL(r.url).origin!==u.origin)throw new Error('The PDF redirected to another site; not following it.');
  if(/text\/html/i.test(r.headers.get('content-type')||''))throw new Error(LOGIN);
  if(+r.headers.get('content-length')>MAX)throw new Error('PDF is larger than the 25 MB limit.');
  const chunks=[];let total=0;const rd=r.body.getReader();
  for(;;){const {done,value}=await rd.read();if(done)break;total+=value.length;
    if(total>MAX){fetchAbort.abort();throw new Error('PDF is larger than the 25 MB limit.');}chunks.push(value);}
  const bytes=new Uint8Array(total);let o=0;for(const c of chunks){bytes.set(c,o);o+=c.length;}
  if(String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw new Error('That URL did not return a PDF file.');
  let b64='';for(let i=0;i<total;i+=0x8000)b64+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
  let name='document.pdf';try{name=decodeURIComponent(u.pathname.split('/').pop())||name;}catch{}
  return {name:name.slice(0,120),b64:btoa(b64)};
}
async function startImport(url){
  if(fetching||pending.size)return {ok:false,error:'An import is already in progress.'};
  fetching=true;
  try{
    panel('Fetching the PDF (no cookies are sent)…');
    const {name,b64}=await fetchPdf(url);
    const tab=await chrome.tabs.create({url:IMPORT_URL});
    pending.set(tab.id,{name,url,b64});
    await chrome.storage.session.set({['imp_'+tab.id]:{stage:'queued',name,t:Date.now()}});
    deliver(tab.id);
    return {ok:true};
  }catch(err){return {ok:false,error:fetchAbort?.signal.aborted&&!/limit/.test(err.message)?'Import cancelled.':err.message||String(err)};}
  finally{fetching=false;}
}
async function deliver(tabId){  // content script queues the payload until the page's app_ready, then relays import_result
  for(let i=0;i<40;i++){
    const p=pending.get(tabId);if(!p)return;
    try{
      const r=await chrome.tabs.sendMessage(tabId,{type:'import_pdf',name:p.name,sourceUrl:p.url,bytesBase64:p.b64});
      pending.delete(tabId);
      if(!r?.ok){await chrome.storage.session.remove('imp_'+tabId);return panel('Workspace refused the import: '+(r?.error||'unknown'));}
      await chrome.storage.session.set({['imp_'+tabId]:{stage:'sent',name:p.name,t:Date.now()}});
      return panel('Sent to the workspace, waiting for it to open the PDF…');
    }catch{await sleep(500);}   // content script not loaded yet
  }
  pending.delete(tabId);await chrome.storage.session.remove('imp_'+tabId);
  panel('The workspace tab never became ready. Open localhost:5173 and try again.');
}

// ---- F17: optional `debugger` permission, localhost mock only, enabled per session by the user.
const attached=new Set();
async function detach(tabId){if(attached.delete(tabId))await chrome.debugger.detach({tabId}).catch(()=>{});}
async function cdpClick(sender,{x,y}){
  const tabId=sender.tab?.id;
  if(sender.frameId!==0||!MOCK.includes(new URL(sender.tab.url).origin))throw new Error('CDP is limited to the SmartPath mock tab.');
  if(!(await chrome.storage.session.get('cdp')).cdp||!await chrome.permissions.contains({permissions:['debugger']}))throw new Error('Real-input mode is off.');
  if(![x,y].every(n=>Number.isFinite(n)&&n>=0&&n<=20000))throw new Error('Bad coordinates.');
  await chrome.debugger.attach({tabId},'1.3');attached.add(tabId);
  try{
    const ev=(type,extra)=>chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type,x,y,button:'left',...extra});
    await ev('mouseMoved',{buttons:0});await ev('mousePressed',{buttons:1,clickCount:1});await ev('mouseReleased',{buttons:0,clickCount:1});
  }finally{await detach(tabId);}   // banner only while a click is in flight
}
async function offscreen(msg){
  if(!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)
    await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['AUDIO_PLAYBACK'],justification:'Play the AI explanation aloud'});
  return chrome.runtime.sendMessage(msg);
}
async function stopAll(){offscreen({type:'off_stop'}).catch(()=>{});await clearImports();await Promise.all([...attached].map(detach));}
chrome.debugger.onDetach.addListener(s=>attached.delete(s.tabId));
chrome.tabs.onRemoved.addListener(id=>{pending.delete(id);chrome.storage.session.remove('imp_'+id).catch(()=>{});detach(id);});

// ---- F16 AI: background does the fetch (no page CORS); consent is remembered per origin for this browser session.
const senderOrigin=s=>{try{return new URL(s.url).origin;}catch{return '';}};
async function explainAsk(m){
  const ac=new AbortController(), timer=setTimeout(()=>ac.abort(),30000);
  try{
    const r=await fetch(SERVER+'/api/live/v1/p2/explain',{method:'POST',credentials:'omit',signal:ac.signal,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({source:'web',text:String(m.text||'').slice(0,2000),context:String(m.context||'').slice(0,2000),title:String(m.title||'').slice(0,200),
        style:['simpler','example'].includes(m.style)?m.style:'normal'})});
    const j=await r.json().catch(()=>({}));
    if(r.status===503&&j.ai===false)return {kind:'noai'};
    if(r.ok&&j.ai)return {kind:'ai',text:String(j.text||''),quotes:Array.isArray(j.quotes)?j.quotes.slice(0,3).map(String):[]};
    return {kind:'error',error:String(j.error||`Server returned ${r.status}`)};
  }catch(err){return err.name==='AbortError'?{kind:'error',error:'The AI request timed out after 30 seconds.'}:{kind:'down'};}
  finally{clearTimeout(timer);}
}
// P2 messages; master's listener above owns content_hello/smartpath_status/get_detection/control_from_panel.
chrome.runtime.onMessage.addListener((m,sender,send)=>{
  if(sender.tab&&m?.type==='explain_tts'){offscreen({type:'off_play',server:SERVER,text:String(m.text||'').slice(0,2000)}).then(send,e=>send({ok:false,error:String(e.message||e)}));return true;}
  if(sender.tab&&m?.type==='explain_tts_stop'){offscreen({type:'off_stop'}).then(send,()=>send({ok:false}));return true;}
  if(sender.tab&&m?.type==='explain_ask'){explainAsk(m).then(send);return true;}
  if(sender.tab&&m?.type==='explain_consent_get'){chrome.storage.session.get('consent').then(r=>send({consent:!!r.consent?.[senderOrigin(sender)]}));return true;}
  if(sender.tab&&m?.type==='explain_consent_set'){chrome.storage.session.get('consent').then(r=>chrome.storage.session.set({consent:{...r.consent,[senderOrigin(sender)]:true}})).then(()=>send({ok:true}),e=>send({ok:false,error:String(e)}));return true;}
  const fromPanel=!sender.tab, done=p=>p.then(send,e=>send({ok:false,error:e.message||String(e)}));
  if(fromPanel&&m?.type==='import_start'){done(startImport(String(m.url)));return true;}
  if(fromPanel&&m?.type==='cdp_set'){done((async()=>{
    if(m.enabled&&!await chrome.permissions.contains({permissions:['debugger']}))throw new Error('debugger permission not granted');
    await chrome.storage.session.set({cdp:!!m.enabled});if(!m.enabled)await stopAll();return {ok:true};})());return true;}
  if(!fromPanel&&m?.type==='cdp_click'){done(cdpClick(sender,m).then(()=>({ok:true})));return true;}
  if(!fromPanel&&m?.type==='import_result'){
    chrome.storage.session.remove('imp_'+sender.tab.id).catch(()=>{});
    panel(m.ok?`● Imported ${String(m.name||'PDF').slice(0,80)}${m.pageCount?` (${m.pageCount} pages)`:''} into SmartPath Live`:'Import failed: '+String(m.error||'unknown error').slice(0,200));
  }
});

// Cursor Tutor (/tutor/) companion: tutor-content.js asks for live AI through the extension, like clicky's own worker did.
// Same unified server as P2 (server/p2_server.py ports optional-ai-proxy's /health, /ask, /classify under /api).
chrome.runtime.onMessage.addListener((m,sender,send)=>{
  if(sender.id!==chrome.runtime.id||!sender.tab||!['health','ask','classify'].includes(m?.kind))return false;
  if(!/^http:\/\/localhost:5173\/tutor\//.test(sender.tab.url||''))return false;
  const go=m.kind==='health'
    ?fetch(SERVER+'/api/health',{credentials:'omit'}).then(r=>r.ok?r.json():{live:false}).then(j=>({ok:true,live:j.live===true}))
    :fetch(SERVER+'/api/'+m.kind,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(m.kind==='ask'?m.request:{text:String(m.text||'')})})
      .then(async r=>{if(!r.ok)throw new Error(`Server returned ${r.status}`);return {ok:true,...await r.json()};});
  go.then(send,e=>send({ok:false,error:String(e.message||e)}));
  return true;
});
