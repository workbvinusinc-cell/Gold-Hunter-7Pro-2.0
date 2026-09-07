import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { CONFIG, assertConfig } from './config.js';
import { ExnessBroker } from './broker.js';
import { ExecutionEngine } from './execution-engine.js';

const app=express();
const server=http.createServer(app);
const wss=new WebSocketServer({server,path:'/ws'});
app.use(express.json());

function originAllowed(origin){
  if(CONFIG.frontendOrigin==='*') return true;
  return !origin || origin===CONFIG.frontendOrigin;
}

app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(originAllowed(origin)){
    res.setHeader('Access-Control-Allow-Origin',origin||CONFIG.frontendOrigin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
  }
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/',(req,res)=>res.json({service:'xauusd-hft-backend',ok:true,ts:Date.now()}));
app.get('/health',(req,res)=>res.status(200).json({ok:true,service:'xauusd-hft',ts:Date.now(),liveTrading:CONFIG.liveTrading}));

let broker,engine;
async function boot(){
  assertConfig();
  broker=new ExnessBroker();
  engine=new ExecutionEngine(broker);
  wss.on('connection',(ws,req)=>{
    const origin=req.headers.origin;
    if(!originAllowed(origin)){ws.close(1008,'Origin not allowed');return;}
    engine.addClient(ws);
    ws.on('message',raw=>{
      try{
        const msg=JSON.parse(raw.toString());
        if(msg.type==='control') engine.control(msg);
        else if(msg.type==='heartbeat') ws.send(JSON.stringify({type:'heartbeat',ts:Date.now()}));
      }catch{}
    });
  });
  const state=await broker.connect();
  console.log('MetaApi/Exness connected:',state.connectedToBroker,'spec:',state.specification?.symbol);
  console.log('LIVE_TRADING:',CONFIG.liveTrading);
}

server.listen(CONFIG.port,CONFIG.host,()=>console.log(`HFT server listening on ${CONFIG.host}:${CONFIG.port}`));
boot().catch(err=>{console.error('BOOT FAILED:',err);process.exitCode=1;});
process.on('SIGINT',async()=>{await engine?.shutdown();process.exit(0);});
process.on('SIGTERM',async()=>{await engine?.shutdown();process.exit(0);});
