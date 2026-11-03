// Plays Deepgram TTS (fetched from the local SmartPath server) outside any web page, so site CSP can't block the audio.
let audio=null, gen=0;
const stop=()=>{gen++;if(audio){audio.pause();URL.revokeObjectURL(audio.src);audio=null;}};
chrome.runtime.onMessage.addListener((m,s,send)=>{
  if(s.id!==chrome.runtime.id||!String(m?.type).startsWith('off_'))return;
  if(m.type==='off_stop'){stop();send({ok:true});return;}
  if(m.type==='off_play'){
    stop();const me=gen;
    (async()=>{
      const r=await fetch(m.server+'/api/live/v1/p2/tts',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:String(m.text||'').slice(0,2000)})});
      if(!r.ok)throw new Error(r.status===503?'Voice is not configured on the server':`TTS failed (${r.status})`);
      const url=URL.createObjectURL(await r.blob());
      if(me!==gen){URL.revokeObjectURL(url);return;}   // stopped/replaced while downloading
      audio=new Audio(url);audio.onended=()=>{if(me===gen)stop();};
      await audio.play();
    })().then(()=>send({ok:true}),e=>send({ok:false,error:String(e.message||e)}));
    return true;
  }
});
