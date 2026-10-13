const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{WebSocketServer}=require('ws');
const F={'/':['index.html','text/html;charset=utf-8'],'/manifest.webmanifest':['manifest.webmanifest','application/manifest+json'],'/sw.js':['sw.js','text/javascript'],'/icon-192.png':['icon-192.png','image/png'],'/icon-512.png':['icon-512.png','image/png'],'/icon-maskable-512.png':['icon-maskable-512.png','image/png']};
for(const k in F)F[k][0]=fs.readFileSync(path.join(__dirname,F[k][0]));
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];if(u==='/health')return r.end('ok');const f=F[u];if(!f){r.writeHead(404);return r.end()}r.writeHead(200,{'Content-Type':f[1],'Cache-Control':'no-cache'});r.end(f[0])});
const wss=new WebSocketServer({server:srv,maxPayload:512});
const rooms=new Map(),START=[1,14,27,40],SAFE=new Set([1,14,27,40,9,22,35,48]),AL='ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode=()=>{let c;do{c=Array.from({length:4},()=>AL[crypto.randomInt(AL.length)]).join('')}while(rooms.has(c));return c};
const tx=(w,o)=>w.readyState===1&&w.send(JSON.stringify(o));
const bc=(R,o)=>R.s.forEach(p=>p&&tx(p.ws,o));
const names=R=>R.s.map(p=>p?p.n:0);
const lobby=R=>R.s.forEach((p,i)=>p&&tx(p.ws,{t:'l',c:R.c,me:i,h:R.host,p:names(R)}));
const live=R=>R.s.map((p,i)=>p&&!p.gone?i:-1).filter(i=>i>=0);

function next(R,again){
  R.dice=0;R.mv=[];
  if(!again){do R.turn=(R.turn+1)%4;while(!R.s[R.turn]||R.s[R.turn].gone)}
  bc(R,{t:'t',s:R.turn});
}
function end(R,s){R.on=2;bc(R,{t:'x',s})}

function handle(ws,m){
  const R=ws.R;
  if(m.t==='j'){
    if(R)return;
    let r=null;
    if(m.c){r=rooms.get(String(m.c).toUpperCase());if(!r)return tx(ws,{t:'err',m:'Room not found'})}
    else{
      if(rooms.size>=100)return tx(ws,{t:'err',m:'Server is busy, try again soon'});
      r={c:newCode(),s:[null,null,null,null],host:0,on:0,tk:[],turn:0,dice:0,mv:[]};rooms.set(r.c,r);
    }
    if(r.on)return tx(ws,{t:'err',m:'Game already started'});
    const i=r.s.indexOf(null);
    if(i<0)return tx(ws,{t:'err',m:'Room is full'});
    r.s[i]={ws,n:String(m.n||'Player').slice(0,12),gone:0};ws.R=r;ws.i=i;ws.lc=0;
    if(!m.c)r.host=i;
    return lobby(r);
  }
  if(!R)return;
  const now=Date.now();
  switch(m.t){
    case's':{
      if(ws.i!==R.host||R.on===1)return;
      const hp=R.s[R.host],a=R.s.filter(p=>p&&!p.gone);
      if(a.length<2)return;
      R.s=a.length===2?[null,a[0],null,a[1]]:R.s.map(p=>p&&!p.gone?p:null);
      R.s.forEach((p,i)=>{if(p)p.ws.i=i});R.host=R.s.indexOf(hp);
      R.on=1;R.tk=R.s.map(p=>p&&[-1,-1,-1,-1]);R.turn=live(R)[0];R.dice=0;R.mv=[];
      return R.s.forEach((p,i)=>p&&tx(p.ws,{t:'g',p:names(R),s:R.turn,me:i,h:R.host}));
    }
    case'r':{
      if(R.on!==1||ws.i!==R.turn||R.dice)return;
      const v=crypto.randomInt(1,7);R.dice=v;
      R.mv=[0,1,2,3].filter(k=>{const p=R.tk[R.turn][k];return p<0?v===6:p+v<=56});
      bc(R,{t:'d',s:R.turn,v,m:R.mv});
      if(!R.mv.length)next(R,0);
      return;
    }
    case'm':{
      const s=R.turn,k=m.k|0;
      if(R.on!==1||ws.i!==s||!R.dice||!R.mv.includes(k))return;
      const v=R.dice,t=R.tk[s],p=t[k]<0?0:t[k]+v,cap=[];
      t[k]=p;
      if(p<=50){
        const x=(START[s]+p)%52;
        if(!SAFE.has(x))for(let o=0;o<4;o++)if(o!==s&&R.tk[o])R.tk[o].forEach((q,j)=>{
          if(q>=0&&q<=50&&(START[o]+q)%52===x){R.tk[o][j]=-1;cap.push([o,j])}
        });
      }
      bc(R,{t:'m',s,k,p,c:cap});
      if(t.every(q=>q===56))return end(R,s);
      return next(R,v===6||cap.length>0||p===56);
    }
    case'c':{
      const x=String(m.x||'').trim().slice(0,120);
      if(!x||now-ws.lc<700)return;ws.lc=now;
      return bc(R,{t:'c',s:ws.i,x});
    }
    case'e':{
      if(now-ws.lc<400)return;ws.lc=now;
      return bc(R,{t:'e',s:ws.i,x:m.x|0});
    }
  }
}
function leave(ws){
  const R=ws.R;if(!R)return;
  const i=ws.i;
  if(!R.on)R.s[i]=null;else R.s[i].gone=1;
  const a=live(R);
  if(!a.length){rooms.delete(R.c);return}
  if(R.host===i)R.host=a[0];
  if(!R.on)return lobby(R);
  bc(R,{t:'q',s:i,h:R.host});
  if(R.on!==1)return;
  if(a.length===1)return end(R,a[0]);
  if(R.turn===i)next(R,0);
}
wss.on('connection',ws=>{
  ws.on('pong',()=>ws.dead=0);
  ws.on('message',d=>{let m;try{m=JSON.parse(d)}catch{return}if(m&&typeof m==='object')handle(ws,m)});
  ws.on('close',()=>leave(ws));
});
setInterval(()=>wss.clients.forEach(w=>{if(w.dead)return w.terminate();w.dead=1;w.ping()}),30000);
srv.listen(process.env.PORT||3000,()=>console.log('Ludo server running'));
