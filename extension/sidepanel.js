const statusEl=document.getElementById('status');
const logEl=document.getElementById('log');
const allowed = url=> /^http:\/\/(localhost|127\.0\.0\.1):5173\//.test(url||'');
async function send(command,prompt=''){
 try{
   const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
   if(!tab || !allowed(tab.url)){statusEl.textContent='Open the local SmartPath Live study tab first';return;}
   const result=await chrome.tabs.sendMessage(tab.id,{type:'control',command,prompt});
   statusEl.textContent=result?.ok?`● ${command} sent to the live workspace`:'Command not accepted';
 }catch(err){statusEl.textContent='Could not connect to content script. Reload localhost:5173.';logEl.textContent=String(err);}
}
function bind(id,command){document.getElementById(id).addEventListener('click',()=>send(command,document.getElementById('prompt').value));}
for(const [id,command] of [['teach','teach'],['quiz','quiz'],['pause','pause'],['resume','resume'],['stop','stop'],['submit','ask']])bind(id,command);
document.getElementById('stop').addEventListener('click',()=>chrome.runtime.sendMessage({type:'stop'}).catch(()=>{})); // cancels pending import + CDP
chrome.runtime.onMessage.addListener(msg=>{if(msg?.type==='smartpath_status')statusEl.textContent=`● AI cursor: ${msg.status}`;else if(msg?.type==='panel_status')statusEl.textContent=msg.text;});
chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{
 statusEl.textContent=allowed(tab?.url)?'● Active SmartPath mock tab detected':'Open http://localhost:5173 first';
 if(allowed(tab?.url))chrome.tabs.sendMessage(tab.id,{type:'get_status'}).then(r=>{if(r?.ok)statusEl.textContent=`● AI cursor: ${r.status}`;}).catch(()=>{});
});

// ---- F09 entry: PDF tab -> "Open in SmartPath Live" (permission request must run synchronously in the click gesture)
const $=id=>document.getElementById(id), say=t=>{statusEl.textContent=t;};
let cur=null;
const isPdf=u=>{try{const x=new URL(u);return /^(https?|file):$/.test(x.protocol)&&/\.pdf$/i.test(x.pathname);}catch{return false;}};
async function refresh(){
  [cur]=await chrome.tabs.query({active:true,currentWindow:true}).catch(()=>[]);
  $('imp').hidden=!isPdf(cur?.url);$('agent').hidden=!allowed(cur?.url)||!cdpOn;
}
$('import').addEventListener('click',()=>{
  if(!isPdf(cur?.url))return say('This tab is not a PDF.');
  const u=new URL(cur.url);
  if(u.protocol==='file:')return say('Local PDFs: use the Import PDF button in the workspace (or enable "Allow access to file URLs" for this extension and try again).');
  chrome.permissions.request({origins:[u.origin+'/*']}).then(ok=>{
    if(!ok){say('Permission denied. Nothing was fetched or opened.');return;}
    say('Starting import…');return chrome.runtime.sendMessage({type:'import_start',url:cur.url}).then(r=>{if(!r?.ok)say(r?.error||'Import failed');});
  }).catch(e=>say('Import failed: '+(e.message||e)));
});
// ---- F17: optional debugger permission + user-approved agent actions
let cdpOn=false;
const cdpUi=()=>{$('cdp').textContent=cdpOn?'Disable real-input mode (CDP)':'Enable real-input mode (CDP)';refresh();};
chrome.storage.session.get('cdp').then(r=>{cdpOn=!!r.cdp;cdpUi();}).catch(()=>{});
$('cdp').addEventListener('click',()=>{
  const want=!cdpOn;
  (want?chrome.permissions.request({permissions:['debugger']}):Promise.resolve(true)).then(ok=>{
    if(!ok){say('Debugger permission denied. Real-input mode stays off.');return;}
    return chrome.runtime.sendMessage({type:'cdp_set',enabled:want}).then(r=>{
      if(!r?.ok){say(r?.error||'Could not change mode');return;}
      cdpOn=want;cdpUi();say(want?'Real-input mode on (localhost mock only).':'Real-input mode off.');
      if(!want)chrome.permissions.remove({permissions:['debugger']}).catch(()=>{});
    });
  }).catch(e=>say('Could not change mode: '+(e.message||e)));
});
$('actgo').addEventListener('click',()=>{
  $('confirmtxt').textContent=`Click '${$('act').selectedOptions[0].text}' on localhost:5173 with a real browser click?`;$('confirm').hidden=false;
});
$('cancel').addEventListener('click',()=>{$('confirm').hidden=true;say('Cancelled. Nothing was clicked.');});
$('approve').addEventListener('click',async()=>{
  $('confirm').hidden=true;
  try{
    await refresh();
    if(!allowed(cur?.url))return say('Open the local SmartPath Live study tab first');
    say('Moving the AI cursor…');
    const r=await chrome.tabs.sendMessage(cur.id,{type:'agent_action',action:$('act').value});
    say(r?.ok?`● Done: ${$('act').selectedOptions[0].text} clicked and the UI change was verified`:'Not done: '+(r?.error||'unknown error'));
  }catch(e){say('Could not reach the workspace tab. Reload localhost:5173.');logEl.textContent=String(e);}
});
chrome.tabs.onActivated.addListener(refresh);chrome.tabs.onUpdated.addListener((id,c)=>{if(c.url||c.status==='complete')refresh();});
refresh();

// AI status from the local server's health route
fetch('http://localhost:5173/api/live/v1/p2/health',{credentials:'omit',signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(h=>{
  $('ai').textContent=(h.ai?`AI: on (${h.model})`:'AI: off — set the key in server/.env')+' · '+(h.voice?`Voice: on (${h.voiceProvider})`:'Voice: off');
}).catch(()=>{$('ai').textContent='AI: server not running (python server/p2_server.py)';});
