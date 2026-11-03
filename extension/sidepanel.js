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
chrome.runtime.onMessage.addListener(msg=>{if(msg?.type==='smartpath_status')statusEl.textContent=`● AI cursor: ${msg.status}`;});
chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{
 statusEl.textContent=allowed(tab?.url)?'● Active SmartPath mock tab detected':'Open http://localhost:5173 first';
 if(allowed(tab?.url))chrome.tabs.sendMessage(tab.id,{type:'get_status'}).then(r=>{if(r?.ok)statusEl.textContent=`● AI cursor: ${r.status}`;}).catch(()=>{});
});
