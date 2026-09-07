/* HFT dashboard bridge: browser is dashboard/control only. Execution belongs to backend. */
(function(){
  const cfg=window.HFT_CONFIG||{};
  const base=(cfg.backendBaseUrl||'').replace(/\/$/,'');
  if(!base){
    console.error('HFT backend URL is not configured. Edit frontend/config.js.');
    return;
  }
  const WS_URL=base.replace(/^http:/,'ws:').replace(/^https:/,'wss:')+'/ws';
  let ws=null,retry=1000,heartbeat=null;
  window.HFT_BACKEND={connected:false,enabled:false,backendBaseUrl:base};
  function send(o){try{if(ws&&ws.readyState===1)ws.send(JSON.stringify(o));}catch{}}
  function statusText(s){
    try{
      const p=document.getElementById('priceMain'); if(p&&s.mid)p.textContent=Number(s.mid).toFixed(2);
      const conn=document.getElementById('connStatus'); if(conn){conn.textContent=s.brokerReady?'EXNESS STREAM':'BACKEND WAIT';conn.className=s.brokerReady?'status-on':'status-wait';}
      const badge=document.getElementById('modeBadge'); if(badge){badge.textContent=s.liveTrading?'HFT LIVE':'HFT DEMO';badge.className=s.liveTrading?'badge badge-live':'badge badge-demo';}
    }catch{}
  }
  function connect(){
    try{ws=new WebSocket(WS_URL);}catch{return;}
    ws.onopen=()=>{
      window.HFT_BACKEND.connected=true; retry=1000;
      send({type:'control',action:'status'});
      try{addSignal('info','HFT backend connected — Exness tick stream active',null);}catch{}
      clearInterval(heartbeat);
      heartbeat=setInterval(()=>send({type:'heartbeat',ts:Date.now()}),240000);
    };
    ws.onclose=()=>{window.HFT_BACKEND.connected=false;clearInterval(heartbeat);setTimeout(connect,retry);retry=Math.min(10000,retry*1.7);};
    ws.onerror=()=>{};
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return};
      if(m.type==='status'){window.HFT_BACKEND.enabled=m.enabled;statusText(m);}
      else if(m.type==='control'){window.HFT_BACKEND.enabled=m.enabled;}
      else if(m.type==='signal'){try{addSignal(m.signal.dir==='BUY'?'buy':'sell',`HFT ${m.signal.dir} Q${Math.round(m.signal.quality)} — ${m.signal.reason}`,m.signal.price);}catch{}}
      else if(m.type==='order'){try{addSignal(m.ok?'buy':'warn',m.ok?`HFT ORDER ${m.mode} ${m.signal.dir} ${m.lots}L · ${Number(m.latencyMs).toFixed(1)}ms`:`HFT ORDER FAILED — ${m.error}`,m.signal.price);}catch{}}
      else if(m.type==='rejection'){try{addSignal('warn',`HFT rejected: ${m.reason}`,null);}catch{}}
    };
  }
  const install=()=>{
    try{
      window.startBot=function(){window.botOn=true;if(typeof syncBotButtons==='function')syncBotButtons();send({type:'control',action:'start'});try{addSignal('info','HFT ENGINE STARTED — backend is now authoritative',null);}catch{}};
      window.stopBot=function(){window.botOn=false;if(typeof syncBotButtons==='function')syncBotButtons();send({type:'control',action:'stop'});try{addSignal('warn','HFT ENGINE STOPPED — no new entries',null);}catch{}};
      window._executeLiveTrade=async function(){try{addSignal('warn','Legacy browser execution blocked: HFT backend is authoritative',null);}catch{}};
      window.runStrategy=function(){};
      window.connect=connect;
      try{localStorage.removeItem('pabotBrokerXAU');}catch{}
      connect();
    }catch(e){console.error('HFT bridge install failed',e)}
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,500));else setTimeout(install,500);
})();
