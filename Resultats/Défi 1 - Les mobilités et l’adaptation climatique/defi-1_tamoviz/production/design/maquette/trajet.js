/* Une journée sous canicule : le trajet d'une personne type simulée par MATSim (ou recalculé sur les horaires, RAPTOR), raconté minute par minute le 25 juin 2026.
   Tout l'affichage de la scène est une fonction de l'heure simulée t : avancer, reculer ou sauter dans la frise donne le même rendu.
   Les chapitres (trajet_chapitres.js) s'ouvrent aux moments clés. */
(function(){
'use strict';
const {$,RM,wait,norm}=UI;
const C=window.IDF.cols, LCOL=window.LCOL||{}, MS=window.MSANIM_CANICULE||null;
const S=C.id.map((id,k)=>({n:C.n[k],c:C.c[k],co:C.co[k],m:C.m[k],lat:C.lat[k],lon:C.lon[k],aj:C.aj[k],df:C.df[k],acc:C.acc[k],pop:C.pop[k],pp:C.pp[k],pointe:C.pointe[k],nc:C.nc[k],nv:C.nv[k],nvp:C.nvp[k]}));
const nf=(v,d=0)=>v==null||isNaN(v)?'–':Number(v).toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d}).replace(/[\u202f\u00a0]/g,' ');
const hm=s=>{s=Math.round(s/60)*60;return String(Math.floor(s/3600))+' h '+String(Math.floor(s%3600/60)).padStart(2,'0');};
const dur=m=>{m=Math.round(m);return m>=60?`${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')}`:`${m} min`;};
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
/* minutes à pied et à l'arrêt : le total est arrondi, les deux parties s'additionnent toujours au total */
const split=(p,a)=>{const tot=Math.round(p+a);let P=Math.floor(p),A=Math.floor(a);if(P+A<tot){if(p-P>=a-A)P++;else A++;}if(P+A<tot)P++;return {tot,p:P,a:A};};
window.SPLIT=split;
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lum=h=>{const n=parseInt(h.slice(1),16);return (0.299*(n>>16)+0.587*(n>>8&255)+0.114*(n&255))/255;};

/* températures horaires du 25 juin 2026 à Paris-Montsouris (Météo-France), comme sur le site */
const T25={0:31.7,1:30.2,2:29.7,3:28.6,4:28.4,5:27.2,6:26.5,7:26.7,8:28.2,9:31.1,10:34,11:36,12:37.5,13:38,14:39.6,15:39.6,16:39.9,17:39.9,18:39.6,19:39.1,20:38.3,21:36.4,22:34.2,23:32.9};
const tAt=s=>{const h=Math.floor(s/3600)%24,f=(s%3600)/3600;return T25[h]+(T25[(h+1)%24]-T25[h])*f;};
const heatF=s=>clamp((tAt(s)-25)/14);
const MODE_N={3:'Bus',2:'RER',1:'Métro',0:'Tramway',6:'Téléphérique',7:'Funiculaire'};
const MODE_L={3:'bus',2:'RER',1:'métro',0:'tram',6:'téléphérique',7:'funiculaire'};
const MODE_C={3:'#1d8a5c',2:'#1972d2',1:'#25303b',0:'#7a3ea0',6:'#7a3ea0',7:'#7a3ea0'};
const PROF={actif:{v:1.0,acc:800,tr:300,lab:'active'},senior:{v:0.85,acc:500,tr:200,lab:'de 70 ans'},poussette:{v:0.9,acc:600,tr:250,lab:'avec une poussette'}};
const HEATC=['#fde3a7','#fbb15c','#f57b32','#d9461d','#9e2410'], HOT='#e0582a';
const heatCol=f=>HEATC[Math.min(4,Math.floor(f*5))];
/* seuils des cinq vulnérabilités d'un arrêt (mêmes critères que le site) */
const CRIT=[{l:'Îlot de chaleur',f:s=>s.aj>=10,v:s=>`aléa ${nf(s.aj,1)} sur 17`},{l:'Bus non climatisés',f:s=>s.nc!=null&&s.nc>=.5,v:s=>s.nc==null?'–':`${nf(s.nc*100)} % des bus`},
  {l:'Faible fréquence',f:s=>s.pp!=null&&s.pp<=20,v:s=>`${nf(s.pointe,1)} passages / h`},{l:'Pas de lieu frais',f:s=>s.df==null||s.df>300,v:s=>s.df==null?'aucun':`le plus proche à ${nf(s.df)} m`},
  {l:'Revenus bas',f:s=>s.nvp!=null&&s.nvp<=20,v:s=>s.nv?`${nf(s.nv)} € par an`:'–'}];

/* ---------- lieux : communes (centre pondéré par la population des arrêts) et gares ---------- */
const PL=[];
{
  const g=new Map();
  S.forEach(s=>{if(!s.c)return;const w=s.pop>0?s.pop:1;let a=g.get(s.c);if(!a)g.set(s.c,a={w:0,la:0,lo:0});a.w+=w;a.la+=w*s.lat;a.lo+=w*s.lon;});
  g.forEach((a,c)=>PL.push({lab:c,pt:[a.la/a.w,a.lo/a.w],k:'commune'}));
  const seen=new Set();
  S.forEach(s=>{if(s.m==='bus'||!s.c)return;const lab=s.n===s.c?`${s.n} (gare)`:`${s.n} (${s.c})`;if(seen.has(lab))return;seen.add(lab);PL.push({lab,pt:[s.lat,s.lon],k:'gare'});});
  PL.sort((a,b)=>a.lab.localeCompare(b.lab,'fr'));
}
const findPlace=v=>{const q=norm(String(v||'').trim());if(!q)return null;
  return PL.find(p=>norm(p.lab)===q)||PL.find(p=>p.k==='commune'&&norm(p.lab).startsWith(q))||PL.find(p=>norm(p.lab).startsWith(q))||PL.find(p=>norm(p.lab).includes(q))||null;};
$('#places').innerHTML=PL.map(p=>`<option value="${p.lab.replace(/"/g,'&quot;')}">`).join('');

/* la personne suivie (fiche de l'écran d'ouverture, trajet_profils.js) */
let WHO=window.PROFIL?PROFIL.who():{n:'Nadia',e:'elle',lui:'elle',a:'e',sil:{skin:'#f2cfb1',arm:'#e8b994',hair:'#2a1d17',bun:1}};

/* ---------- moteur d'itinéraires : horaires chargés en arrière-plan dès l'ouverture ---------- */
let ENG=null, engP=null;
function loadEngine(){
  if(engP)return engP;
  return engP=new Promise((res,rej)=>{
    const go=()=>{ENG=window.RaptorEngine.build(window.RP);res(ENG);};
    if(window.RP)return go();
    const s=document.createElement('script');s.src='../../web/data/raptor.js';s.onload=go;s.onerror=rej;document.head.appendChild(s);
  });
}
const dist=(a,b)=>Math.hypot((a[0]-b[0])*73300,(a[1]-b[1])*111320);  /* [lon,lat] en mètres */
/* tracés officiels des lignes : décodés à la demande */
const TRC={};
function traces(key){if(TRC[key])return TRC[key];const raw=(window.TRL||{})[key]||[];
  return TRC[key]=raw.map(e=>{const L=[];let x=e[0],y=e[1];L.push([x/1e5,y/1e5]);for(let i=2;i<e.length;i+=2){x+=e[i];y+=e[i+1];L.push([x/1e5,y/1e5]);}return L;});}
/* projection d'un point sur une polyligne : [distance, abscisse curviligne, index du segment, point projeté] */
function project(L,p){let best=[1e15,0,0,L[0]],acc=0;
  for(let i=1;i<L.length;i++){const a=L[i-1],b=L[i],ax=(b[0]-a[0])*73300,ay=(b[1]-a[1])*111320,l2=ax*ax+ay*ay,
    px=(p[0]-a[0])*73300,py=(p[1]-a[1])*111320,f=l2?Math.max(0,Math.min(1,(px*ax+py*ay)/l2)):0,dx=px-f*ax,dy=py-f*ay,d=Math.hypot(dx,dy),sl=Math.sqrt(l2);
    if(d<best[0])best=[d,acc+f*sl,i,[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]];acc+=sl;}
  return best;}
/* morceau du tracé entre deux arrêts consécutifs, ou null si le tracé ne colle pas */
function piece(key,A,B){const direct=dist(A,B);let best=null;
  for(const L of traces(key)){const pa=project(L,A),pb=project(L,B);if(pa[0]>220||pb[0]>220)continue;
    const len=Math.abs(pb[1]-pa[1]);if(len>direct*2.6+400||len<direct*.6)continue;const sc=pa[0]+pb[0]+len*.02;if(best&&best.sc<=sc)continue;
    const mid=pa[1]<=pb[1]?L.slice(pa[2],pb[2]):L.slice(pb[2],pa[2]).reverse();
    best={sc,pts:[pa[3],...mid,pb[3]]};}
  if(best)return best.pts;
  /* sinon : deux morceaux qui se touchent (jonction de branches) */
  const LS=traces(key);
  for(const L1 of LS){const pa=project(L1,A);if(pa[0]>220)continue;
    for(const L2 of LS){if(L2===L1)continue;const pb=project(L2,B);if(pb[0]>220)continue;
      for(const e1 of [0,L1.length-1])for(const e2 of [0,L2.length-1]){if(dist(L1[e1],L2[e2])>60)continue;
        const p1=e1===0?L1.slice(0,pa[2]).reverse():L1.slice(pa[2]), p2=e2===0?L2.slice(0,pb[2]):L2.slice(pb[2]).reverse();
        const pts=[pa[3],...p1,...p2,pb[3]];let len=0;for(let i=1;i<pts.length;i++)len+=dist(pts[i-1],pts[i]);
        if(len>direct*2.6+400)continue;const sc=pa[0]+pb[0]+len*.02;if(!best||sc<best.sc)best={sc,pts};}}}
  return best?best.pts:null;}

function route(o,d,dep,pr){
  const RP=window.RP, E=window.RaptorEngine;
  const around=(pt,r)=>{const L=[];S.forEach((s,k)=>{const m=Math.hypot((s.lon-pt[1])*73300,(s.lat-pt[0])*111320);if(m<=r)L.push([k,m*1.25/pr.v]);});return L;};
  let src=around(o.pt,pr.acc), near=around(d.pt,pr.acc);
  if(!src.length)src=around(o.pt,1500); if(!near.length)near=around(d.pt,1500);
  if(!src.length||!near.length)return null;
  const bestOf=r=>{let b=-1,t=1e15,e=0;for(const [k,w] of near){if(r.round[k]<0)continue;const a=r.star[k]+w;if(a<t){t=a;b=k;e=w;}}return [b,t,e];};
  let r=E.query(ENG,src,dep,{v:pr.v,maxTransfer:pr.tr,rounds:5,tmax:7200,trace:true});
  let [best,bt,eg]=bestOf(r); if(best<0)return null;
  /* le plus rapide, puis le moins de correspondances parmi les trajets à moins de 5 min de lui */
  for(let k=1;k<5;k++){const rk=E.query(ENG,src,dep,{v:pr.v,maxTransfer:pr.tr,rounds:k,tmax:7200,trace:true});const [b2,t2,e2]=bestOf(rk);
    if(b2>=0&&t2<=bt+300){r=rk;best=b2;bt=t2;eg=e2;break;}}
  const J=E.journey(ENG,r,best); if(!J)return null;
  const P0=[o.pt[1],o.pt[0]], P1=[d.pt[1],d.pt[0]], at=k=>[S[k].lon,S[k].lat];
  const seg=[]; let t=dep;
  const first=J[0].to, aw=(src.find(x=>x[0]===first)||[0,0])[1];
  seg.push({k:'walk',t0:t,t1:t+aw,stop:first,aj:S[first].aj,df:S[first].df,pts:[[...P0,t],[...at(first),t+aw]],to:first}); t+=aw;
  for(const s of J.slice(1)){
    if(s.type==='walk'){const w=s.m*1.25/pr.v, indoor=S[s.from].m==='metro'&&S[s.to].m==='metro';
      seg.push({k:'walk',t0:t,t1:t+w,indoor,aj:S[s.to].aj,df:S[s.to].df,pts:[[...at(s.from),t],[...at(s.to),t+w]],to:s.to,corr:true});t+=w;continue;}
    const P=RP.pat[s.pat], n=P.s.length, bi=P.s.indexOf(s.from), ai=bi+s.stops.length-1;
    if(s.dep>t+1)seg.push({k:'wait',t0:t,t1:s.dep,at:s.from,indoor:P.ty===1,aj:S[s.from].aj,df:S[s.from].df,pts:[[...at(s.from),t],[...at(s.from),s.dep]]});
    /* heures de passage à chaque arrêt de la course retenue */
    let tr=-1; for(let q=0;q<P.n;q++){if(P.t[q*n+bi]===s.dep&&P.a[q*n+ai]===s.arr){tr=q;break;}}
    const st=s.stops.map((z,i)=>[...at(z),tr>=0?(i?P.a[tr*n+bi+i]:P.t[tr*n+bi]):s.dep+(s.arr-s.dep)*i/(s.stops.length-1)]);
    /* entre deux arrêts, le véhicule suit le tracé réel de la ligne ; le temps est réparti selon la distance */
    const key=`${P.ty}|${P.nm}`, pts=[st[0]];
    for(let i=1;i<st.length;i++){const a=st[i-1],b=st[i],pc=piece(key,a,b);
      if(pc&&pc.length>2){const cum=[0];for(let j=1;j<pc.length;j++)cum.push(cum[j-1]+dist(pc[j-1],pc[j]));const T=cum[cum.length-1]||1;
        for(let j=1;j<pc.length-1;j++)pts.push([pc[j][0],pc[j][1],a[2]+(b[2]-a[2])*cum[j]/T]);}
      pts.push(b);}
    const col=LCOL[key]||MODE_C[P.ty]||'#1972d2';
    seg.push({k:'ride',t0:s.dep,t1:s.arr,ty:P.ty,nm:P.nm,cl:P.cl,col,from:s.from,to:s.to,pts,stp:st});
    t=s.arr;
  }
  seg.push({k:'walk',t0:t,t1:t+eg,aj:S[best].aj,df:S[best].df,pts:[[...at(best),t],[...P1,t+eg]],last:true}); t+=eg;
  seg.forEach(g=>{if(g.to!=null&&!g.toN)g.toN=S[g.to].n;if(g.at!=null&&!g.atN)g.atN=S[g.at].n;});
  seg[0].stop=first;
  seg.forEach(g=>{g.out=g.k!=='ride'&&!g.indoor;g.rate=g.out?heatF((g.t0+g.t1)/2)*(g.aj||8)/10:(g.k==='ride'&&g.cl===2?heatF((g.t0+g.t1)/2)*.5:0);});
  return {seg,dep,arr:t,o,d,pr,raptor:true};
}

/* ---------- trajet simulé par MATSim : étapes réelles de l'agent (marche, attente, à bord), lignes calées sur les tracés officiels ---------- */
function fromAgent(a,trip){
  const L=a[trip];if(!L||!L.length)return null;
  const seg=[];
  L.forEach((x,i)=>{
    const nx=L.slice(i+1).find(y=>y.k!=='walk'&&y.k!=='bike');
    if(x.k==='walk'||x.k==='bike'){const st=nx?(nx.s!=null?nx.s:nx.sa):null;
      /* marche le long des rues si la forme OSM est connue ; le temps est réparti selon la distance */
      const W=[x.a,...(x.p||[]),x.b],cw=[0];for(let q=1;q<W.length;q++)cw.push(cw[q-1]+dist(W[q-1],W[q]));const TW=cw[cw.length-1]||1;
      seg.push({k:'walk',t0:x.t0,t1:x.t1,pts:W.map((q,i2)=>[q[0],q[1],x.t0+(x.t1-x.t0)*cw[i2]/TW]),to:st,toN:nx?(nx.sn||nx.na||(st!=null?S[st].n:'')):'',last:!nx,corr:i>0&&!!nx,indoor:!!x.in,
        aj:st!=null?S[st].aj:8,df:st!=null?S[st].df:null,bike:x.k==='bike'});}
    else if(x.k==='wait'){seg.push({k:'wait',t0:x.t0,t1:x.t1,at:x.s,atN:x.sn||(x.s!=null?S[x.s].n:''),indoor:!!x.quai,aj:x.s!=null?S[x.s].aj:8,df:x.s!=null?S[x.s].df:null,
      pts:[[...x.a,x.t0],[...x.a,x.t1]]});}
    else{const key=`${x.ty}|${x.nm}`,pc=piece(key,x.a,x.b),P=pc&&pc.length>1?pc:[x.a,x.b];
      const cum=[0];for(let j=1;j<P.length;j++)cum.push(cum[j-1]+dist(P[j-1],P[j]));const T=cum[cum.length-1]||1;
      const pts=P.map((p,j)=>[p[0],p[1],x.t0+(x.t1-x.t0)*cum[j]/T]);
      seg.push({k:'ride',t0:x.t0,t1:x.t1,ty:x.ty,nm:x.nm,cl:x.noac?2:0,noac:!!x.noac,col:LCOL[key]||MODE_C[x.ty]||'#1972d2',from:x.sa,to:x.sb,toN:x.nb||(x.sb!=null?S[x.sb].n:''),
        pts,stp:[[...x.a,x.t0],[...x.b,x.t1]]});}
  });
  const st0=seg.find(g=>g.k!=='walk');seg[0].stop=st0?(st0.at!=null?st0.at:st0.from):null;
  seg.forEach(g=>{g.out=g.k!=='ride'&&!g.indoor;g.rate=g.out?heatF((g.t0+g.t1)/2)*(g.aj||8)/10:(g.noac?heatF((g.t0+g.t1)/2)*.5:0);});
  const z=seg[seg.length-1].pts.slice(-1)[0];
  return {seg,dep:seg[0].t0,arr:seg[seg.length-1].t1,o:{lab:a.hn,pt:[a.h[1],a.h[0]]},d:{lab:a.wn,pt:[z[1],z[0]]},pr:PROF.actif,agent:a,hc:a.hc,trip};
}

/* marches : tracées à vol d'oiseau (aucun service en ligne) ; la durée vient du calcul d'itinéraire local */

/* ---------- carte : fond clair ou sombre selon le thème ---------- */
const STYLE=d=>`https://tiles.openfreemap.org/styles/${d?'dark':'positron'}`;
let dark=UI.isDark();
const map=new maplibregl.Map({container:'map',style:STYLE(dark),center:[2.35,48.80],zoom:9.2,pitch:0,bearing:0,
  attributionControl:{compact:true},maxPitch:0,pixelRatio:Math.min(window.devicePixelRatio||1,1.5),maxTileCacheSize:120,dragRotate:false,pitchWithRotate:false,touchPitch:false,fadeDuration:0});
/* la carte illustre ; ses informations sont dans les panneaux et la vue « Données » : on ne s'y arrête pas au clavier */
map.getCanvas().setAttribute('tabindex','-1');
const fc=f=>({type:'FeatureCollection',features:f});
const SRC={};  /* dernières données de chaque source, pour les remettre après un changement de fond */
const setSrc=(id,data)=>{SRC[id]=data;const s=map.getSource(id);if(s)s.setData(data);};
let readyRes; const ready=new Promise(r=>readyRes=r);
/* couleur pâlie vers le fond de carte : les morceaux de tracé superposés ne s'additionnent pas, contrairement à la transparence */
function mixC(h,bg,t){const a=parseInt(h.slice(1),16),b=parseInt(bg.slice(1),16),m=(x,y)=>Math.round(x+(y-x)*t);
  const r=m(a>>16,b>>16),g=m(a>>8&255,b>>8&255),bl=m(a&255,b&255);return '#'+((1<<24)+(r<<16)+(g<<8)+bl).toString(16).slice(1);}
function layers(){
  const ink=dark?'#e9eef3':'#25303b', paper=dark?'#1a2129':'#ffffff';
  map.getStyle().layers.forEach(l=>{if(l.type==='symbol'&&/poi|aeroway|transit|airport/.test(l.id))map.setLayoutProperty(l.id,'visibility','none');});
  const add=id=>{if(!map.getSource(id))map.addSource(id,{type:'geojson',data:SRC[id]||fc([])});};
  if(!SRC.net){const net=[];Object.keys(window.TRL||{}).forEach(k=>{const ty=+k.split('|')[0];if(ty>2)return;const c=LCOL[k]||MODE_C[ty];const P={c,ty,l1:mixC(c,'#f3f2ee',.78),l2:mixC(c,'#f3f2ee',.9),d1:mixC(c,'#1a1a1a',.72),d2:mixC(c,'#1a1a1a',.86)};traces(k).forEach(L=>{const Q=L.filter((p,i)=>i%4===0||i===L.length-1);if(Q.length>1)net.push({type:'Feature',properties:P,geometry:{type:'LineString',coordinates:Q}});});});SRC.net=fc(net);}  /* fond allégé : un point sur quatre */
  ['net','isoA','isoN','isoB','stopsC','mC','route','mF','mE','trail','rstops','heat','others','fleet','veh','mR','mS'].forEach(add);
  const L=(o)=>{if(!map.getLayer(o.id))map.addLayer(o);};
  L({id:'net',type:'line',source:'net',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],9,['match',['get','ty'],2,1.4,.8],15,['match',['get','ty'],2,4,2.5]],'line-opacity':netOp()}});
  L({id:'isoN',type:'fill',source:'isoN',paint:{'fill-color':dark?'#4a93e0':'#1972d2','fill-opacity':dark?.55:.45}});
  L({id:'isoB',type:'fill',source:'isoB',paint:{'fill-color':HOT,'fill-opacity':.8}});
  L({id:'isoA',type:'line',source:'isoA',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':dark?'#8d98a5':'#6b7581','line-width':1.2,'line-dasharray':[2,2]}});
  L({id:'stopsC',type:'circle',source:'stopsC',paint:{'circle-color':['get','c'],'circle-opacity':.78,'circle-stroke-color':paper,'circle-stroke-width':1,
    'circle-radius':['interpolate',['linear'],['zoom'],9,['*',['get','s'],.35],12,['*',['get','s'],1],15,['*',['get','s'],2.4]]}});
  /* mesures du jeu de la conclusion */
  const blue=dark?'#4a93e0':'#1972d2', green=dark?'#3fbf88':'#1d8a5c';
  L({id:'mC-case',type:'line',source:'mC',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':paper,'line-width':['interpolate',['linear'],['zoom'],9,7,14,14]}});
  L({id:'mC',type:'line',source:'mC',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':blue,'line-width':['interpolate',['linear'],['zoom'],9,4,14,9]}});
  L({id:'route-case',type:'line',source:'route',filter:['==',['get','k'],'ride'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':paper,'line-width':['interpolate',['linear'],['zoom'],9,3,15,10],'line-opacity':.6}});
  L({id:'route',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],9,1.5,15,5],'line-opacity':.5}});
  L({id:'heat',type:'circle',source:'heat',paint:{'circle-color':['get','c'],'circle-radius':['get','r'],'circle-opacity':['get','o'],'circle-blur':.5}});
  L({id:'others',type:'circle',source:'others',paint:{'circle-color':['get','c'],'circle-radius':['interpolate',['linear'],['zoom'],8,.9,10,1.5,12,3,14,6,17,9],'circle-opacity':['interpolate',['linear'],['zoom'],8,.55,12,.8],'circle-stroke-width':0}});
  L({id:'mF',type:'line',source:'mF',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],9,3,14,5],'line-offset':['interpolate',['linear'],['zoom'],9,-4,14,-7]}});
  L({id:'mF2',type:'line',source:'mF',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],9,3,14,5],'line-offset':['interpolate',['linear'],['zoom'],9,4,14,7]}});
  L({id:'mE',type:'line',source:'mE',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':blue,'line-width':['interpolate',['linear'],['zoom'],9,2.5,14,5],'line-dasharray':[1.2,1.2]}});
  L({id:'trail-glow',type:'line',source:'trail',filter:['==',['get','k'],'ride'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],9,8,15,26],'line-opacity':.28,'line-blur':8}});
  L({id:'trail-case',type:'line',source:'trail',filter:['==',['get','k'],'ride'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':paper,'line-width':['interpolate',['linear'],['zoom'],9,6,15,13]}});
  L({id:'trail-ride',type:'line',source:'trail',filter:['==',['get','k'],'ride'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],9,3.5,15,9]}});
  L({id:'trail-walk',type:'line',source:'trail',filter:['!=',['get','k'],'ride'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':HOT,'line-width':['interpolate',['linear'],['zoom'],9,2,15,6],'line-dasharray':[1,1.6]}});
  L({id:'fleet',type:'line',source:'fleet',layout:{'line-cap':'butt'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],8,['match',['get','ty'],3,.8,1.2],11,['match',['get','ty'],3,1.4,2],13,['match',['get','ty'],3,2.6,3.6],16,['match',['get','ty'],3,4.6,7]]}});
  L({id:'veh-case',type:'line',source:'veh',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':ink,'line-width':['interpolate',['linear'],['zoom'],10,9,16,20]}});
  L({id:'veh',type:'line',source:'veh',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],10,6,16,15],'line-opacity':['get','o']}});
  L({id:'mR',type:'circle',source:'mR',paint:{'circle-color':green,'circle-radius':['interpolate',['linear'],['zoom'],9,3,14,7],'circle-stroke-color':paper,'circle-stroke-width':1.5,'circle-opacity':.9}});
  L({id:'mS',type:'circle',source:'mS',paint:{'circle-color':['get','c'],'circle-radius':['get','r'],'circle-stroke-color':paper,'circle-stroke-width':2.5}});
  L({id:'rstops',type:'circle',source:'rstops',paint:{'circle-radius':['interpolate',['linear'],['zoom'],10,2.5,15,6],'circle-color':paper,'circle-stroke-color':['get','c'],'circle-stroke-width':2.5}});
  if(typeof calm==='function'&&netBase!=null){calm(1);crowdVis(phase==='pick');}
  readyRes();
}
map.on('style.load',layers);
UI.onTheme(d=>{if(d===dark)return;dark=d;map.setStyle(STYLE(d),{diff:false});});

/* Nadia */
/* Nadia : un personnage qui marche, attend au soleil (sueur, soleil, elle s'essuie le front) ou voyage à bord (badge de la ligne) */
const me=document.createElement('div'); me.className='nadia';
me.innerHTML=`<i class="halo"></i><svg class="who" viewBox="0 0 44 64" aria-hidden="true">
  <ellipse class="gs" cx="22" cy="61" rx="10" ry="2.6"/>
  <g class="body front">
    <g class="legL"><path d="M19.5 40 L18 57" class="leg"/><path d="M15.5 58.5 h5" class="shoe"/></g>
    <g class="legR"><path d="M24.5 40 L26 57" class="leg"/><path d="M23.5 58.5 h5" class="shoe"/></g>
    <path class="top" d="M13 28 q0-6 9-6 q9 0 9 6 l1.5 14 h-21z"/>
    <path class="pk" d="M17 33 h4 v4 h-4z"/>
    <g class="armL"><path d="M14 27 L11.5 39" class="arm"/></g>
    <g class="armR"><path d="M30 27 L32.5 39" class="arm"/></g>
    <circle class="skin" cx="22" cy="15" r="7.2"/>
    <path class="hair" d="M14.6 15.5 q-.4-8.6 7.4-8.6 q7.8 0 7.4 8.6 q-1.6-4.4-7.4-4.4 q-5.8 0-7.4 4.4z"/>
    <circle class="hair bunF" cx="22" cy="6.4" r="3.4"/><circle class="hair bunS" cx="15.2" cy="10.4" r="3.4"/>
    <g class="ff"><circle class="eye" cx="19.4" cy="16" r=".95"/><circle class="eye" cx="24.6" cy="16" r=".95"/><path class="mouth" d="M20.2 19.4 q1.8 1.1 3.6 0"/></g>
    <g class="fs"><path class="skin" d="M28.6 14.2 q2.6 1.2 .2 3.1z"/><circle class="eye" cx="25.9" cy="15.6" r="1"/><path class="mouth" d="M25 19.5 q1.5.8 2.8 0"/></g>
    <g class="sweat"><path d="M31.5 9 c0 0-2.2 2.9-2.2 4.4a2.2 2.2 0 0 0 4.4 0c0-1.5-2.2-4.4-2.2-4.4z"/><path d="M12.8 12 c0 0-1.6 2.1-1.6 3.2a1.6 1.6 0 0 0 3.2 0c0-1.1-1.6-3.2-1.6-3.2z"/></g>
  </g>
  <g class="body side">
    <g class="armB"><path d="M22 26.5 L22 37.5" class="arm b"/><circle cx="22" cy="38.6" r="1.9" class="hand b"/></g>
    <g class="legB"><path d="M22 40 L22 56" class="leg b"/><path d="M21 57.6 h6.5" class="shoe"/></g>
    <path class="top" d="M16.6 27.5 q0-6 5.4-6 q5.4 0 5.4 6 l.9 14.5 h-12.6z"/>
    <g class="legF"><path d="M22 40 L22 56" class="leg"/><path d="M21 57.6 h6.5" class="shoe"/></g>
    <circle class="skin" cx="22" cy="15" r="7.2"/><path class="skin" d="M28.8 13.8 q2.8 1.4 .1 3.3z"/>
    <path class="hair" d="M14.7 16.4 q-.8-9.4 7.3-9.4 q6.4 0 7.3 6.2 q-3.2-2.6-7.3-2.6 q-4.6 0-6 3.8z"/><circle class="hair bunS" cx="14.4" cy="11.6" r="3.3"/>
    <circle class="eye" cx="25.9" cy="15.4" r="1"/><path class="mouth" d="M25.2 19.5 q1.5.8 2.8 0"/>
    <g class="sweat"><path d="M30.6 6.5 c0 0-2.1 2.8-2.1 4.2a2.1 2.1 0 0 0 4.2 0c0-1.4-2.1-4.2-2.1-4.2z"/></g>
    <g class="armF"><path d="M22 26.5 L22 37.5" class="arm"/><circle cx="22" cy="38.6" r="1.9" class="hand"/></g>
  </g>
  <g class="sun"><circle cx="36" cy="4" r="3.6"/><path d="M36 -2.5v2M36 8.5v2M29.5 4h2M40.5 4h2M31.4 -.6l1.4 1.4M39.2 7.2l1.4 1.4M31.4 8.6l1.4-1.4M39.2 .8l1.4-1.4"/></g>
</svg><span class="veh"><i class="vh"></i><b></b></span><span class="tag">Nadia</span>`;
const marker=new maplibregl.Marker({element:me,anchor:'bottom'});
function dress(w){const s=w.sil||{};me.style.setProperty('--skin',s.skin||'#f2cfb1');me.style.setProperty('--arm',s.arm||'#e8b994');me.style.setProperty('--hair',s.hair||'#2a1d17');
  me.classList.toggle('short',!s.bun);me.querySelector('.tag').textContent=w.n;}
dress(WHO);

/* ---------- état ---------- */
const setPhaseCls=()=>{document.body.dataset.phase=phase;};
let lastDrawn=-1, R=null, U=0, u=0, playing=false, speed=1, phase='pick', last=0, cam=null, segI=-1, tick=0, IL=[], nearNow=0;
function prepare(r){
  /* temps d'animation : la marche et l'attente défilent lentement, les trajets à bord plus vite */
  const w=r.seg.map(g=>Math.max(1,(g.t1-g.t0)*(g.k==='ride'?.32:1)));
  const sc=56/w.reduce((a,b)=>a+b,0); let acc=0;
  r.seg.forEach((g,i)=>{g.u0=acc;acc+=Math.max(RM?1:2.6,w[i]*sc);g.u1=acc;});
  U=acc;
  /* voyageurs simulés qui attendent près de chaque arrêt d'attente (MATSim, vigilance rouge) */
  r.seg.forEach(g=>{if(g.k!=='wait'||!MS)return;const p=g.pts[0], tm=(g.t0+g.t1)/2;let n=0;
    for(const L of MS.legs){if(L[0]<2||!L[3])continue;if(tm<L[1]||tm>L[1]+L[3])continue;if(dist([L[4],L[5]],p)<=300)n++;}g.crowd=n;});
}
const simAt=x=>{for(const g of R.seg){if(x<=g.u1)return g.t0+(g.t1-g.t0)*clamp((x-g.u0)/(g.u1-g.u0));}return R.arr;};
const uAt=t=>{for(const g of R.seg){if(t<=g.t1)return g.u0+(g.u1-g.u0)*clamp((t-g.t0)/Math.max(1,g.t1-g.t0));}return U;};
function interp(pts,t){if(t<=pts[0][2])return [pts[0][0],pts[0][1],0];
  for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];if(t<=b[2]){const f=b[2]>a[2]?(t-a[2])/(b[2]-a[2]):1;return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,i];}}
  const z=pts[pts.length-1];return [z[0],z[1],pts.length];}
const segAt=t=>{const s=R.seg;for(let i=0;i<s.length;i++)if(t<s[i].t1)return i;return s.length-1;};
const posAt=t=>interp(R.seg[segAt(t)].pts,t);
/* dose, minutes dehors, minutes en bus non climatisé jusqu'à t */
function totals(t){let dose=0,out=0,noac=0,pied=0,att=0;for(const g of R.seg){if(t<=g.t0)break;const m=(Math.min(t,g.t1)-g.t0)/60;dose+=m*g.rate;if(g.out){out+=m;if(g.k==='walk')pied+=m;else att+=m;}if(g.k==='ride'&&g.cl===2)noac+=m;}return {dose,out,noac,pied,att};}

/* ---------- véhicule : une rame qui suit le tracé ---------- */
const VLEN={2:180,1:110,0:60,3:30};
function cumOf(g){if(g.cum)return g.cum;const c=[0];for(let i=1;i<g.pts.length;i++)c.push(c[i-1]+dist(g.pts[i-1],g.pts[i]));return g.cum=c;}
function atDist(g,d){const c=cumOf(g),P=g.pts;if(d<=0)return P[0];for(let i=1;i<P.length;i++)if(d<=c[i]){const f=(d-c[i-1])/Math.max(1e-6,c[i]-c[i-1]);return [P[i-1][0]+(P[i][0]-P[i-1][0])*f,P[i-1][1]+(P[i][1]-P[i-1][1])*f];}return P[P.length-1];}
function distAt(g,t){const c=cumOf(g),P=g.pts;for(let i=1;i<P.length;i++)if(t<=P[i][2]){const f=P[i][2]>P[i-1][2]?(t-P[i-1][2])/(P[i][2]-P[i-1][2]):1;return c[i-1]+(c[i]-c[i-1])*clamp(f);}return c[c.length-1];}
function rame(g,t){const d0=distAt(g,t),L=VLEN[g.ty]||40,P=[];for(let i=0;i<=8;i++)P.push(atDist(g,Math.max(0,d0-L+L*i/8)));
  return [{type:'Feature',properties:{c:g.col,o:g.ty===1?.6:1},geometry:{type:'LineString',coordinates:P}}];}
/* couverture : toute la flotte ferrée et les voyageurs dehors, en boucle de 6 h 30 à 9 h 30 */
const FLEET_ALL=MS?MS.veh.filter(v=>v[0]<=2||v[0]===5):[],BUS_ALL=MS?MS.veh.filter(v=>v[0]===3||v[0]===4):[];
/* types de véhicule MATSim (rail, subway, tram, bus_ac, bus_noac, cable) vers modes GTFS (2 RER, 1 métro, 0 tram, 3 bus, 6 câble) */
const MSTY={0:2,1:1,2:0,3:3,4:3,5:6},RLEN={2:220,1:110,0:45,3:14,6:10};
/* la rame suit le tracé officiel de sa ligne entre deux arrêts (ligne retrouvée par son mode et sa couleur), en cache */
const KC={};Object.keys(window.TRL||{}).forEach(k=>{const c=(LCOL[k]||'').toUpperCase(),kk=k.split('|')[0]+'|'+c;(KC[kk]=KC[kk]||[]).push(k);});
const KBB={};const bbOf=k=>KBB[k]||(KBB[k]=(()=>{let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;traces(k).forEach(L=>L.forEach(p=>{if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1];}));return [x0-.003,y0-.002,x1+.003,y1+.002];})());
const PC=new Map();
function pieceV(ty,col,i0,i1){const ck=ty+'|'+col+'|'+i0+'|'+i1;if(PC.has(ck))return PC.get(ck);
  const s0=S[i0],s1=S[i1],A=[s0.lon,s0.lat],B=[s1.lon,s1.lat],direct=dist(A,B);let best=null;
  if(direct>30)for(const k of (KC[ty+'|'+String(col).toUpperCase()]||[])){const b=bbOf(k);if(A[0]<b[0]||A[0]>b[2]||A[1]<b[1]||A[1]>b[3]||B[0]<b[0]||B[0]>b[2]||B[1]<b[1]||B[1]>b[3])continue;
    const P=piece(k,A,B);if(!P||P.length<2)continue;const cum=[0];for(let j=1;j<P.length;j++)cum.push(cum[j-1]+dist(P[j-1],P[j]));const T=cum[cum.length-1];
    if(!best||Math.abs(T-direct*1.15)<Math.abs(best.T-direct*1.15))best={P,cum,T};}
  if(!best)best={P:[A,B],cum:[0,direct],T:direct||1};
  PC.set(ck,best);return best;}
const alongP=(g,d)=>{const P=g.P,c=g.cum;if(d<=0)return P[0];for(let j=1;j<P.length;j++)if(d<=c[j]){const f=(d-c[j-1])/Math.max(1e-6,c[j]-c[j-1]);return [P[j-1][0]+(P[j][0]-P[j-1][0])*f,P[j-1][1]+(P[j][1]-P[j-1][1])*f];}return P[P.length-1];};
/* rame : longueur réelle (RER 220 m, métro 110 m, tram 45 m, bus 14 m), 2 pixels au moins ; tracée le long de la ligne jusqu'à sa position */
function rameV(v,a,lo,hi,f,c){const ty=MSTY[v[0]],g=pieceV(ty,c,a[lo*3+1],a[hi*3+1]),d=g.T*f;
  const mpp=156543*Math.cos(g.P[0][1]*Math.PI/180)/Math.pow(2,map.getZoom()),L=Math.max(RLEN[ty]||100,2*mpp),d0=Math.max(0,d-L);
  const pts=[alongP(g,d0)];for(let j=1;j<g.P.length-1;j++)if(g.cum[j]>d0&&g.cum[j]<d)pts.push(g.P[j]);pts.push(alongP(g,d));
  if(pts.length===2&&pts[0][0]===pts[1][0]&&pts[0][1]===pts[1][1])pts[0]=alongP(g,Math.max(0,d-L-1));
  return {type:'Feature',properties:{c,ty},geometry:{type:'LineString',coordinates:pts}};}
function fleetAll(t){const F=[],cols=MS.cols,b=map.getBounds(),LIST=map.getZoom()>=10.5?FLEET_ALL.concat(BUS_ALL):FLEET_ALL;
  for(const v of LIST){const a=v[1];if(t<a[0]||t>a[a.length-3])continue;
    let lo=0,hi=a.length/3-1;while(hi-lo>1){const m=(lo+hi)>>1;if(a[m*3]<=t)lo=m;else hi=m;}
    const s0=S[a[lo*3+1]],s1=S[a[hi*3+1]];if(!s0||!s1)continue;const f=a[hi*3]>a[lo*3]?(t-a[lo*3])/(a[hi*3]-a[lo*3]):0,x=s0.lon+(s1.lon-s0.lon)*f,y=s0.lat+(s1.lat-s0.lat)*f;
    if(!b.contains([x,y]))continue;F.push(rameV(v,a,lo,hi,f,cols[v[2]]||'#888'));}
  return F;}
/* voyageurs simulés : mêmes couleurs que le récit (orange = à pied, orange foncé = à l'arrêt) ; ceux à bord sont dans les trains.
   Les compteurs portent sur toute la région (agents × 100 : la simulation porte sur 1 % des navetteurs). */
const C_WALK='#f08a4b',C_WAIT='#b03d12',C_BIKE='#1d8a5c';
let CNT={pied:0,arret:0,bord:0};
function crowdAll(t){const F=[],b=map.getBounds();let pied=0,arret=0,bord=0;
  for(const L of MS.legs){const d0=L[1],du=L[2];if(t<d0||t>d0+du)continue;let x,y,c;
    if(L[0]>=2){if(t>=d0+L[3]){bord++;continue;}arret++;x=L[4];y=L[5];c=C_WAIT;}else{if(L[0]===0)pied++;const f=du?(t-d0)/du:1;x=L[4]+(L[6]-L[4])*f;y=L[5]+(L[7]-L[5])*f;c=L[0]===0?C_WALK:C_BIKE;}
    if(!b.contains([x,y]))continue;F.push({type:'Feature',properties:{c},geometry:{type:'Point',coordinates:[x,y]}});}
  CNT={pied,arret,bord};return F;}
/* restent chez eux ce jour-là (télétravail dans la simulation) : nombre fixe pour la journée */
const CHEZ=(()=>{const G=(window.PROFILS||{}).groupes||{};let n=0;Object.values(G).forEach(g=>{n+=g.n*g.reste_canicule/100;});return Math.round(n)*100;})();
let coverT=27000;
setTimeout(()=>{const e=document.getElementById('cchez');if(e)e.textContent=nf(CHEZ);},0);
/* trains et tramways simulés par MATSim autour d'elle, aux couleurs de leur ligne */
const FLEET=MS?MS.veh:[];
/* son propre véhicule est dessiné à sa position (source « veh ») : on retire de la flotte les rames de sa ligne autour d'elle,
   sinon le train simulé et le personnage peuvent sembler décalés (MATSim n'interpole qu'entre deux arrêts) */
function fleetAt(t,p,g){const F=[],cols=MS.cols,up=c=>String(c||'').toUpperCase();
  const k=segAt(t),mine=g&&g.k==='ride'?g:(g&&(g.k==='wait'||g.k==='walk')?R.seg.slice(k).find(x=>x.k==='ride'):null);
  for(const v of FLEET){const a=v[1];if(t<a[0]||t>a[a.length-3])continue;
    let lo=0,hi=a.length/3-1;while(hi-lo>1){const m=(lo+hi)>>1;if(a[m*3]<=t)lo=m;else hi=m;}
    const s0=S[a[lo*3+1]],s1=S[a[hi*3+1]];if(!s0||!s1)continue;
    const lim=(v[0]===3||v[0]===4)?.03:.12;if(Math.abs(s0.lon-p[0])>lim||Math.abs(s0.lat-p[1])>lim*.66)continue;
    const f=a[hi*3]>a[lo*3]?(t-a[lo*3])/(a[hi*3]-a[lo*3]):0;
    if(mine&&MSTY[v[0]]===mine.ty&&up(cols[v[2]])===up(mine.col)&&dist([s0.lon+(s1.lon-s0.lon)*f,s0.lat+(s1.lat-s0.lat)*f],p)<2500)continue;
    F.push(rameV(v,a,lo,hi,f,cols[v[2]]||'#888'));}
  return F;}

/* ---------- aucun défilement : un panneau trop plein se resserre un peu (jusqu'à 78 %) ---------- */
window.fitPanel=function(el){if(!el||el.hidden)return;el.style.zoom='';el.style.overflow='hidden';
  for(const z of [1,.94,.88,.83,.78,.72,.66]){el.style.zoom=z===1?'':z;if(el.scrollHeight<=el.clientHeight+1)break;}};
/* ---------- écritures DOM économes : on n'écrit que ce qui change ---------- */
const LAST=new Map();
const put=(key,val,fn)=>{if(LAST.get(key)===val)return;LAST.set(key,val);fn(val);};

/* ---------- scène ---------- */
const segFeat=(g,pts)=>({type:'Feature',properties:{k:g.k,c:g.k==='ride'?g.col:HOT},geometry:{type:'LineString',coordinates:pts.map(p=>[p[0],p[1]])}});
function drawRoute(frac=1){
  const all=R.seg.filter(g=>g.k!=='wait'),n=Math.ceil(all.length*frac);
  setSrc('route',fc(all.slice(0,n).map(g=>segFeat(g,g.pts))));
  const st=[];R.seg.forEach(g=>{if(g.k==='ride')g.stp.forEach(p=>st.push({type:'Feature',properties:{c:g.col},geometry:{type:'Point',coordinates:[p[0],p[1]]}}));});
  setSrc('rstops',fc(frac>=1?st:[]));
}
function drawAt(t,full){
  const k=segAt(t), p=posAt(t), g=R.seg[k];
  const tf=[];R.seg.forEach((s,i)=>{if(s.k==='wait'||i>k)return;if(i<k)tf.push(segFeat(s,s.pts));else{const q=interp(s.pts,t);tf.push(segFeat(s,[...s.pts.slice(0,q[2]),[q[0],q[1]]]));}});
  setSrc('trail',fc(tf.filter(f=>f.geometry.coordinates.length>1)));
  /* halo de chaleur aux arrêts d'attente : il grandit pendant l'attente */
  const hf=[];R.seg.forEach(s=>{if(s.k!=='wait'||t<=s.t0||s.indoor)return;const f=clamp((t-s.t0)/(s.t1-s.t0)),m=(s.t1-s.t0)/60*f,live=t<s.t1,pul=live?(Math.sin(t/9)+1)/2:0;
    hf.push({type:'Feature',properties:{r:14+m*7+pul*6,o:live?.55:.3,c:heatCol(heatF(t)*.6+f*.4)},geometry:{type:'Point',coordinates:s.pts[0]}});});
  setSrc('heat',fc(hf));
  /* voyageurs simulés par MATSim autour d'elle */
  if(MS&&(full||tick%3===0)){const of=[];let nn=0;
    if(t>=+MS.w0&&t<=+MS.w1){for(const L of MS.legs){const d0=L[1],du=L[2];if(t<d0||t>d0+du)continue;
      if(Math.abs(L[4]-p[0])>.05&&Math.abs(L[6]-p[0])>.05)continue;
      let x,y,c;
      /* à bord, l'agent est dans un train ou un tram de la flotte : on ne le dessine pas (MATSim ne donne que la ligne droite départ-arrivée) */
      if(L[0]>=2&&t>=d0+L[3])continue;
      if(L[0]>=2){x=L[4];y=L[5];c=HOT;}
      else{const f=du?(t-d0)/du:1;x=L[4]+(L[6]-L[4])*f;y=L[5]+(L[7]-L[5])*f;c=L[0]===0?'#a08560':'#1d8a5c';}
      const dd=dist([x,y],p);if(dd>3500)continue;if(dd<1000&&(L[0]<2||t<d0+L[3]))nn++;
      of.push({type:'Feature',properties:{c},geometry:{type:'Point',coordinates:[x+((L[1]*7)%13-6)*2e-5,y+((L[1]*11)%13-6)*1.4e-5]}});}}
    nearNow=nn*100; setSrc('others',fc(of));}
  setSrc('veh',fc(g.k==='ride'?rame(g,t):[]));
  if(MS&&(full||tick%2===0))setSrc('fleet',fc(t>=+MS.w0&&t<=+MS.w1?fleetAt(t,p,g):[]));
  /* Nadia */
  marker.setLngLat([p[0],p[1]]);
  const Tn=tAt(t), sunny=g.out&&Tn>=28, sweaty=(g.out&&Tn>=27)||(g.k==='ride'&&g.cl===2&&Tn>=30);
  let dir=LAST.get('dirv')||'';
  if(g.k==='walk'){const q=posAt(Math.min(g.t1,t+60)),dx=(q[0]-p[0])*73300;
    if(Math.abs(dx)>20){const want=dx<0?' left':'',now=performance.now();
      if(LAST.get('dirseg')!==k){LAST.set('dirseg',k);dir=want;LAST.set('dirv',dir);LAST.set('dirw',want);}
      else if(want!==dir){if(LAST.get('dirw')!==want){LAST.set('dirw',want);LAST.set('dirt',now);}else if(now-LAST.get('dirt')>700){dir=want;LAST.set('dirv',dir);}}
      else LAST.set('dirw',want);}}
  put('cls','nadia '+g.k+dir+(sunny?' sunny':'')+(sweaty?' sweaty':'')+(g.indoor?' indoor':'')+(playing?'':' still')+(WHO.sil&&!WHO.sil.bun?' short':''),v=>me.className=v);
  if(g.k==='ride'&&LAST.get('veh')!==g.nm+g.col){LAST.set('veh',g.nm+g.col);const v=me.querySelector('.veh');v.style.background=g.col;v.style.color=window.INKON?INKON(g.col):'#fff';v.querySelector('b').textContent=`${MODE_N[g.ty]||''} ${g.nm}`;}
  put('tag',g.k==='wait'?(g.indoor?`${WHO.n}, sur le quai`:`${WHO.n} attend`):WHO.n,v=>me.querySelector('.tag').textContent=v);
  const hot=g.out?heatF(t):(g.k==='ride'&&g.cl===2?heatF(t)*.6:.1);
  put('hs',(0.5+hot*1.1).toFixed(1),v=>me.style.setProperty('--hs',v));
  /* tableau de bord */
  const T=tAt(t), tot=totals(t);
  put('clock',hm(t),v=>$('#clock').textContent=v); put('temp',nf(T,0),v=>{$('#ctemp').textContent=v+' °C';$('#capm').classList.toggle('hot',T>=30);});
  const sp=split(tot.pied,tot.att);
  put('omin',nf(sp.tot),v=>$('#omin').textContent=v);
  put('odet',`à pied ${nf(sp.p)} · à l’arrêt ${nf(sp.a)}`,v=>$('#odet').textContent=v);
  put('ost',g.out?(g.k==='walk'?'walk':'sun'):(g.noac||(g.k==='ride'&&g.cl===2)?'noac':g.indoor?'in':'cool'),v=>{const e=$('#ost');e.dataset.st=v;$('#hout').dataset.st=v;
    e.textContent=v==='walk'?'à pied, dehors':v==='sun'?'à l’arrêt, dehors':v==='noac'?'à bord, sans clim':v==='in'?'à l’abri, sous terre':'à bord, à l’abri';});
  put('heat',(hot*.9+.05).toFixed(1),v=>$('#haze').style.opacity=v);
  if(k!==segI){segI=k;caption(g);frise();}
  const fp=100*(t-R.dep)/(R.arr-R.dep);
  put('fp',fp.toFixed(1),v=>{$('#fhead').style.left=`calc(${v}% - 1px)`;$('#fsegs').setAttribute('aria-valuenow',Math.round(fp));$('#fsegs').setAttribute('aria-valuetext',hm(t)+', '+$('#capt').textContent);});
}

MASCOT($('#capm'));

/* ---------- l'étape en cours, en une ligne et quelques pastilles ---------- */
const NUM=['zéro','une','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf','vingt'];
const mots=(m,cap)=>{const w=m<=20?NUM[m]:String(m);return cap?w.charAt(0).toUpperCase()+w.slice(1):w;};
const lineN=g=>`${MODE_L[g.ty]||'ligne'} ${g.nm}`;
function caption(g){
  const m=Math.max(1,Math.round((g.t1-g.t0)/60)), cap=$('#cap'), chips=[], T=tAt((g.t0+g.t1)/2), W=WHO;
  let t='',c=HOT;
  if(g.k==='walk'){c='#e0582a';
    if(g.indoor)t=`Correspondance dans les couloirs <span>· ${mots(m)} minute${m>1?'s':''}</span>`;
    else t=`${mots(m,true)} minute${m>1?'s':''} à pied, dehors à ${nf(T,0)} °C. <span>${g.last?'Jusqu’au travail':g.toN?'Jusqu’à '+esc(g.toN):''}</span>`;
    if(!g.indoor&&g.aj>=10)chips.push(['hot','quartier très chaud']);if(!g.indoor&&g.df!=null&&g.df<=300)chips.push(['cool',`lieu frais à ${nf(g.df)} m`]);}
  else if(g.k==='wait'){
    t=g.indoor?`${W.n} attend sur un quai souterrain, à l’abri. <span>${mots(m,true)} minute${m>1?'s':''} · ${esc(g.atN||'')}</span>`:`${W.il==='il'?'Il':'Elle'} attend ${mots(m)} minute${m>1?'s':''} dehors, à ${nf(T,0)} °C. <span>${esc(g.atN||'')}</span>`;}
  else{c=g.col;
    t=g.noac?`Dans le ${esc(lineN(g))}, sans clim : il fait chaud à bord. <span>Jusqu’à ${esc(g.toN||'')}</span>`
      :`Dans le ${esc(lineN(g))}, ${W.il} est à l’abri du soleil : le compteur s’arrête. <span>Jusqu’à ${esc(g.toN||'')}</span>`;}
  $('#capt').innerHTML=t; $('#capc').innerHTML=chips.map(([k,l])=>`<b class="${k}">${l}</b>`).join('');
  cap.style.setProperty('--segc',c);
  if(!(window.PAGES&&PAGES.isOpen())){cap.hidden=false;cap.classList.remove('rise');void cap.offsetWidth;if(!RM)cap.classList.add('rise');}
}
function frise(){
  const tot=R.arr-R.dep;
  $('#fsegs').innerHTML=R.seg.map((g,i)=>`<i class="${g.k}${g.indoor?' in':''}${g.noac?' noac':''}" style="flex:${Math.max(1.2,100*(g.t1-g.t0)/tot).toFixed(2)} 1 0" data-f="${i<=segI?0:1}"></i>`).join('');
  const ln=$('.flegend .ln');if(ln)ln.parentNode.hidden=!R.seg.some(g=>g.noac);
  $('#fmarks').innerHTML=IL.map((x,i)=>`<button type="button" class="${x.shown?'done':''}${x.fil?'':' ap'}" style="left:${(100*(x.t-R.dep)/tot).toFixed(2)}%" data-i="${i}" aria-label="${x.fil?'Chapitre '+x.num+' : '+PAGES.title(x.id):'En passant : '+PAGES.title(x.id)}${x.shown?', déjà lu':''}">${x.fil?x.num:''}</button>`).join('');
}

/* ---------- caméra ---------- */
function camera(t,dt){
  const g=R.seg[segAt(t)], p=posAt(t), fast=g.k==='ride'&&(g.ty===1||g.ty===2);
  const tz=g.k==='ride'?(fast?13.6:15.2):g.k==='wait'?16.6:16.2, f=1-Math.exp(-dt*1.6);
  cam.zoom+=(tz-cam.zoom)*f*.8; cam.x+=(p[0]-cam.x)*Math.min(1,f*3); cam.y+=(p[1]-cam.y)*Math.min(1,f*3);
  map.jumpTo({center:[cam.x,cam.y],zoom:cam.zoom});
}
const camFromMap=()=>{const c=map.getCenter();cam={zoom:map.getZoom(),x:c.lng,y:c.lat};};

/* ---------- boucle ---------- */
function openChapter(il,i){
  il.shown=true; setPlaying(false); $('#cap').hidden=true; frise();
  const ok=PAGES.open(il,X,i+1,IL.length,()=>{$('#chap').style.bottom='';$('#chap').style.maxHeight='';map.setPadding({left:0,top:0,right:0,bottom:0});camFromMap();if(phase==='play'){$('#cap').hidden=false;setPlaying(true);}});
  if(!ok&&phase==='play')setPlaying(true);
  if(ok){fitPanel($('#chap'));setTimeout(()=>fitPanel($('#chap')),700);}
  /* tablette et téléphone : la scène se pose juste au-dessus de la frise, sans la recouvrir, et laisse voir la personne */
  if(ok&&innerWidth<=1024&&innerHeight>520){const c=$('#chap'),hl=$('#hline').getBoundingClientRect(),top=$('#hout').getBoundingClientRect().bottom;
    c.style.bottom=Math.round(innerHeight-hl.top+6)+'px';c.style.maxHeight=Math.max(170,Math.round(hl.top-6-top-120))+'px';}
  if(ok&&innerWidth<=1024&&innerHeight>520){const p=posAt(simAt(u)),h=$('#chap').getBoundingClientRect().height;
    map.easeTo({center:[p[0],p[1]],padding:{top:Math.round($('#hout').getBoundingClientRect().bottom+30),bottom:Math.round(innerHeight-$('#chap').getBoundingClientRect().top+70),left:0,right:0},duration:RM?0:600});}
}
/* couverture : rames et voyageurs dessinés directement sur un calque 2D à chaque image (aucun GeoJSON reconstruit), fluide avec 10 000 objets */
const CV={el:null,ctx:null,on:false,w:0,h:0,r:0};
const zi=(z,st)=>{if(z<=st[0])return st[1];for(let i=2;i<st.length;i+=2)if(z<=st[i]){const f=(z-st[i-2])/(st[i]-st[i-2]);return st[i-1]+(st[i+1]-st[i-1])*f;}return st[st.length-1];};
function cvSize(){const c=map.getCanvas(),r=window.devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;
  if(!CV.el){CV.el=document.createElement('canvas');CV.el.setAttribute('aria-hidden','true');CV.el.style.cssText='position:absolute;left:0;top:0;pointer-events:none';map.getCanvasContainer().appendChild(CV.el);CV.ctx=CV.el.getContext('2d');}
  if(CV.w!==w||CV.h!==h||CV.r!==r){CV.w=w;CV.h=h;CV.r=r;CV.el.width=Math.round(w*r);CV.el.height=Math.round(h*r);CV.el.style.width=w+'px';CV.el.style.height=h+'px';}
  CV.ctx.setTransform(r,0,0,r,0,0);}
function clearCover(){if(CV.ctx)CV.ctx.clearRect(0,0,CV.w,CV.h);CV.on=false;}
function drawCover(t){if(!map.getSource('fleet'))return;
  if(!CV.on){setSrc('fleet',fc([]));setSrc('others',fc([]));CV.on=true;}
  cvSize();const g=CV.ctx,z=map.getZoom();g.clearRect(0,0,CV.w,CV.h);
  /* projection Mercator directe : map.project() est trop lent pour 20 000 points par image */
  const ws=512*Math.pow(2,z),MX=l=>(l+180)/360*ws,MY=a=>(1-Math.log(Math.tan(Math.PI/4+a*Math.PI/360))/Math.PI)/2*ws;
  const ce=map.getCenter(),pc=map.project(ce),ox=pc.x-MX(ce.lng),oy=pc.y-MY(ce.lat);
  const P=c=>({x:MX(c[0])+ox,y:MY(c[1])+oy});
  const rad=zi(z,[8,.9,10,1.5,12,3,14,6,17,9]);g.globalAlpha=zi(z,[8,.55,12,.8]);
  const byC={};for(const f of crowdAll(t)){(byC[f.properties.c]=byC[f.properties.c]||[]).push(f.geometry.coordinates);}
  for(const c in byC){g.fillStyle=c;g.beginPath();for(const q of byC[c]){const p=P(q);if(rad<1.6)g.rect(p.x-rad,p.y-rad,rad*2,rad*2);else{g.moveTo(p.x+rad,p.y);g.arc(p.x,p.y,rad,0,6.2832);}}g.fill();}
  g.globalAlpha=1;g.lineCap='butt';g.lineJoin='round';
  const wB=zi(z,[8,.8,11,1.4,13,2.6,16,4.6]),wR=zi(z,[8,1.2,11,2,13,3.6,16,7]);
  const grp={};for(const f of fleetAll(t)){const k=f.properties.c+'|'+(f.properties.ty===3?1:0);(grp[k]=grp[k]||[]).push(f.geometry.coordinates);}
  for(const k in grp){const [c,b]=k.split('|');g.strokeStyle=c;g.lineWidth=b==='1'?wB:wR;g.beginPath();
    for(const L of grp[k]){let p=P(L[0]);g.moveTo(p.x,p.y);for(let i=1;i<L.length;i++){p=P(L[i]);g.lineTo(p.x,p.y);}}g.stroke();}}
function loop(now){
  if(document.body.dataset.phase!==phase)setPhaseCls();
  const dt=Math.min(.1,(now-(last||now))/1000); last=now; tick++;
  if(phase==='pick'&&MS){coverT+=dt*120;if(coverT>+MS.w1)coverT=+MS.w0;drawCover(coverT);}else if(CV.on)clearCover();
  if(phase==='pick'&&MS&&(tick%3===0)){
    put('cclock',hm(coverT),v=>{const e=$('#pclock');if(e)e.textContent=v;});
    const r100=v=>nf(Math.round(v*100/100)*100);
    put('cpied',r100(CNT.pied),v=>$('#cpied').textContent=v);put('carret',r100(CNT.arret),v=>$('#carret').textContent=v);put('cbord',r100(CNT.bord),v=>$('#cbord').textContent=v);}
  if(phase==='play'&&R){
    if(playing&&!PAGES.isOpen()){const ta=simAt(u);u+=dt*speed;const tb=simAt(Math.min(u,U));
      const il=IL.find(x=>!x.shown&&x.t>ta&&x.t<=tb);
      if(il){u=uAt(il.t);openChapter(il,IL.indexOf(il));}
      else if(u>=U){u=U;finish();}}
    if(phase==='play'){const t=simAt(u);if(!PAGES.isOpen())camera(t,dt);if(playing||t!==lastDrawn||tick%30===0){lastDrawn=t;drawAt(t);}}
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------- isochrones : la ville à 45 minutes, en temps réel (jour ordinaire) et en temps ressenti (canicule) ---------- */
const CELL=400;
function isoCompute(){
  if(!ENG||!R)return null;
  const E=window.RaptorEngine, o=R.o.pt, dep=R.dep, h=heatF(dep), B=45;
  const cx=x=>Math.floor((x-2.35)*73300/CELL), cy=y=>Math.floor((y-48.8)*111320/CELL);
  const run=(v,acc,tr,cost,mpm)=>{
    const src=[];S.forEach((s,k)=>{const m=Math.hypot((s.lon-o[1])*73300,(s.lat-o[0])*111320);if(m<=acc)src.push([k,m*1.25/v]);});
    const res=E.query(ENG,src,dep,{v,maxTransfer:tr,rounds:4,tmax:3600});
    const cells=new Set();
    const mark=(lon,lat,rad)=>{const x0=cx(lon-rad/73300),x1=cx(lon+rad/73300),y0=cy(lat-rad/111320),y1=cy(lat+rad/111320);
      for(let i=x0;i<=x1;i++)for(let j=y0;j<=y1;j++){const lo=2.35+(i+.5)*CELL/73300,la=48.8+(j+.5)*CELL/111320;if(Math.hypot((lo-lon)*73300,(la-lat)*111320)<=rad)cells.add(i+','+j);}};
    mark(o[1],o[0],B*mpm(null));
    for(let k=0;k<S.length;k++){if(res.round[k]<0)continue;const c=cost(res,k);if(c>=B)continue;mark(S[k].lon,S[k].lat,(B-c)*mpm(k));}
    return cells;};
  /* jour normal : 4,5 km/h, jusqu'à 1 000 m à pied vers l'arrêt ; canicule : 3,6 km/h, 600 m au plus (comme sur le site) */
  const A=run(1.25,1000,400,(r,k)=>(r.star[k]-dep)/60,()=>60);
  const Bc=run(1.0,600,250,(r,k)=>(r.star[k]-dep)/60,()=>48);
  const feat=cells=>fc([...cells].map(s=>{const [i,j]=s.split(',').map(Number),x0=2.35+i*CELL/73300,x1=2.35+(i+1)*CELL/73300,y0=48.8+j*CELL/111320,y1=48.8+(j+1)*CELL/111320;
    return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}};}));
  const edges=cells=>{const L=[];cells.forEach(k=>{const [i,j]=k.split(',').map(Number),x0=2.35+i*CELL/73300,x1=2.35+(i+1)*CELL/73300,y0=48.8+j*CELL/111320,y1=48.8+(j+1)*CELL/111320;
      if(!cells.has(i+','+(j-1)))L.push([[x0,y0],[x1,y0]]);if(!cells.has(i+','+(j+1)))L.push([[x0,y1],[x1,y1]]);
      if(!cells.has((i-1)+','+j))L.push([[x0,y0],[x0,y1]]);if(!cells.has((i+1)+','+j))L.push([[x1,y0],[x1,y1]]);});
    return fc([{type:'Feature',properties:{},geometry:{type:'MultiLineString',coordinates:L}}]);};
  const fa=feat(A),fb=feat(Bc);setSrc('isoA',fc([]));setSrc('isoN',fa);setSrc('isoB',fb);
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;fa.features.forEach(f=>f.geometry.coordinates[0].forEach(([x,y])=>{x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}));
  map.fitBounds([[x0,y0],[x1,y1]],{padding:innerWidth<768?PAD():{top:60,bottom:150,left:420,right:140},duration:RM?0:1600});
  return {n:A.size*CELL*CELL/1e6,b:Bc.size*CELL*CELL/1e6};
}
function clearIso(){['isoA','isoN','isoB'].forEach(x=>setSrc(x,fc([])));}

/* ---------- temps ressenti de son trajet (modèle du site, scripts/07_access.py) ---------- */
function ressenti(){
  const G=[0,.15,.3], shift=63000-R.dep, nb=R.seg.filter(g=>g.k==='ride').length;
  const sum=(fn)=>R.seg.reduce((a,g)=>a+fn(g,(g.t1-g.t0)/60),0);
  const reel={bord:sum((g,m)=>g.k==='ride'?m:0),att:sum((g,m)=>g.k==='wait'?m:0),mar:sum((g,m)=>g.k==='walk'?m:0),mon:0};
  const ord={bord:reel.bord,att:2*reel.att,mar:2*reel.mar,mon:3*nb};
  const hot=sh=>({bord:sum((g,m)=>g.k==='ride'?m*(1+heatF((g.t0+g.t1)/2+sh)*G[g.cl||0]):0),
    att:sum((g,m)=>g.k==='wait'?2*m*(1+.06*heatF((g.t0+g.t1)/2+sh)*(g.indoor?0:(g.aj||8))):0),
    mar:sum((g,m)=>g.k==='walk'?2*m*(1+.05*heatF((g.t0+g.t1)/2+sh)*(g.indoor?0:(g.aj||8))):0),mon:3*nb});
  const T=o=>(o.tot=o.bord+o.att+o.mar+o.mon,o);
  return {reel:T(reel),ord:T(ord),matin:T(hot(0)),soir:T(hot(shift))};
}
/* mesures testées par le site, appliquées à son trajet */
function whatIf(){
  const D=f=>R.seg.reduce((a,g)=>a+(g.t1-g.t0)/60*g.rate*f(g),0);
  const rows=[['Ce matin',D(()=>1)],['Bus tous climatisés',D(g=>g.k==='ride'&&g.cl===2?0:1)],['Deux fois plus de passages',D(g=>g.k==='wait'?.5:1)],['Arrêts ombragés par des arbres',D(g=>g.k==='wait'&&g.out?.5:1)]];
  const d2=Math.max(23400,R.dep-3600);
  if(d2<R.dep){const r2=route(R.o,R.d,d2,R.pr);if(r2)rows.push([`Partir à ${hm(d2)}`,r2.seg.reduce((a,g)=>a+(g.t1-g.t0)/60*g.rate,0)]);}
  return rows;
}
/* dose de son trajet avec une combinaison de mesures (jeu de la conclusion) */
let earlyR;
function doseWith(K){
  let segs=R.seg;
  if(K.early){if(earlyR===undefined){const d2=Math.max(23400,R.dep-3600);earlyR=d2<R.dep?route(R.o,R.d,d2,R.pr):null;}if(earlyR)segs=earlyR.seg;}
  return segs.reduce((a,g)=>{let f=1;if(K.clim&&g.k==='ride'&&g.cl===2)f=0;if(g.k==='wait'){if(K.freq)f*=.5;if(K.shade&&g.out)f*=.5;}return a+(g.t1-g.t0)/60*g.rate*f;},0);
}
/* cartogramme d'arrêts : chaque arrêt devient un cercle proportionnel à ses voyageurs d'un jour ordinaire ; orange s'il cumule au moins trois fragilités */
let flowP=null;
const loadFlow=()=>flowP||(flowP=window.FLOW?Promise.resolve(window.FLOW):new Promise(res=>{const sc=document.createElement('script');sc.src='../../web/data/flow.js';sc.onload=()=>res(window.FLOW);sc.onerror=()=>res(null);document.head.appendChild(sc);}));
function stopsMap(){
  const F=window.FLOW;if(!F||!R)return null;
  const xs=[],ys=[];R.seg.forEach(g=>g.pts.forEach(p=>{xs.push(p[0]);ys.push(p[1]);}));
  const m=.04,B=[Math.min(...xs)-m,Math.min(...ys)-m*.7,Math.max(...xs)+m,Math.max(...ys)+m*.7];
  const grey=dark?'#6c7785':'#8c96a1',feats=[];let tot=0,ex=0,nEx=0,big=null;
  /* couloir d'un kilomètre autour de son itinéraire (points tous les ~150 m) */
  const RP=[];R.seg.forEach(g=>{for(let i=1;i<g.pts.length;i++){const a=g.pts[i-1],b=g.pts[i],n=Math.max(1,Math.ceil(dist(a,b)/150));for(let q=0;q<=n;q++)RP.push([a[0]+(b[0]-a[0])*q/n,a[1]+(b[1]-a[1])*q/n]);}});
  const near=st=>{for(const p of RP){if(Math.abs(p[0]-st.lon)<.014&&Math.abs(p[1]-st.lat)<.009&&dist(p,[st.lon,st.lat])<=1000)return true;}return false;};
  S.forEach((st,k)=>{const v=F.vref[k];if(!v||st.lon<B[0]||st.lon>B[2]||st.lat<B[1]||st.lat>B[3]||!near(st))return;
    const hot=CRIT.filter(c=>c.f(st)).length>=3;tot+=v;if(hot){ex+=v;nEx++;if(!big||v>big[1])big=[st.n,v];}
    feats.push({type:'Feature',properties:{s:Math.max(3,Math.min(26,Math.sqrt(v)/9)),c:hot?HOT:grey,v},geometry:{type:'Point',coordinates:[st.lon,st.lat]}});});
  feats.sort((a,b)=>b.properties.v-a.properties.v);
  setSrc('stopsC',fc(feats));calm(.15);crowdVis(false);
  map.fitBounds([[B[0],B[1]],[B[2],B[3]]],{padding:innerWidth<768?PAD():{left:440,top:40,right:40,bottom:140},duration:RM?0:1400});
  return {tot,ex,nEx,n:feats.length,big};
}
function stopsOff(){setSrc('stopsC',fc([]));calm(1);}

/* carte du jeu : où agit chaque mesure choisie */
let netBase=null;  /* null = couverture ; nombre = opacité du réseau pendant le trajet */
/* netBase vaut aussi 'cover' (écran d'accueil) : l'opacité doit rester un nombre, sinon le changement de thème casse la carte */
const netOp=()=>typeof netBase==='number'?netBase:(dark?.55:.4);
function crowdVis(on){['others','fleet'].forEach(id=>{if(map.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');});}
function calm(f){/* f = 1 : carte normale ; f < 1 : tout ce qui n'est pas une mesure passe en transparence */
  const set=(id,p,v)=>{if(map.getLayer(id))map.setPaintProperty(id,p,v);};
  if(netBase==='cover'){set('net','line-color',['get',dark?'d1':'l1']);set('net','line-opacity',1);set('net','line-width',['interpolate',['linear'],['zoom'],8,['match',['get','ty'],2,1.2,.8],15,['match',['get','ty'],2,3.4,2.2]]);}
  else if(netBase==null){set('net','line-color',['get','c']);set('net','line-opacity',(dark?.55:.4)*f);set('net','line-width',['interpolate',['linear'],['zoom'],9,['match',['get','ty'],2,1.4,.8],15,['match',['get','ty'],2,4,2.5]]);}
  else{set('net','line-color',dark?(f<1?'#262b31':'#30363e'):(f<1?'#e6e7e8':'#d6d9dc'));set('net','line-opacity',1);
    set('net','line-width',['interpolate',['linear'],['zoom'],9,['match',['get','ty'],2,1,.6],15,['match',['get','ty'],2,2,1.4]]);}set('route','line-opacity',.8*f);set('route-case','line-opacity',.6*f);
  set('trail-ride','line-opacity',f<1?.25:1);set('trail-glow','line-opacity',f<1?0:.28);set('trail-walk','line-opacity',f<1?.3:1);set('trail-case','line-opacity',f<1?.25:1);
  set('rstops','circle-opacity',f);set('rstops','circle-stroke-opacity',f);
  set('others','circle-opacity',.9*f);set('others','circle-stroke-opacity',f);set('fleet','line-opacity',f);
  set('heat','circle-opacity',f<1?0:1);}
function measMap(on){
  calm(Object.values(on).some(Boolean)?.15:1);
  const xs=[],ys=[];R.seg.forEach(g=>g.pts.forEach(p=>{xs.push(p[0]);ys.push(p[1]);}));
  const m=.1,B=[Math.min(...xs)-m,Math.min(...ys)-m*.7,Math.max(...xs)+m,Math.max(...ys)+m*.7],inB=(x,y)=>x>=B[0]&&x<=B[2]&&y>=B[1]&&y<=B[3];
  const pt=(c,p)=>({type:'Feature',properties:p||{},geometry:{type:'Point',coordinates:c}});
  const ln=(c,p)=>({type:'Feature',properties:p||{},geometry:{type:'LineString',coordinates:c}});
  const green=dark?'#3fbf88':'#1d8a5c', blue=dark?'#4a93e0':'#1972d2';
  /* ses arrêts d'attente dehors : orange, vert s'ils sont ombragés, plus petits si les passages doublent */
  setSrc('mS',fc(R.seg.filter(g=>g.k==='wait'&&g.out).map(g=>pt(g.pts[0],{c:on.shade?green:on.freq?blue:HOT,r:on.freq?7:11}))));
  /* arrêts à ombrager en priorité dans le secteur (simulateur du site) */
  const sous=(lo,la)=>S.some(s=>s.m==='metro'&&Math.abs(s.lon-lo)<.002&&Math.abs(s.lat-la)<.0015&&dist([s.lon,s.lat],[lo,la])<=120);
  const SR=window.SIM?SIM.shade_rank.filter(r=>inB(r.lon,r.lat)&&!sous(r.lon,r.lat)).slice(0,40):[];
  setSrc('mR',fc([]));  /* seulement son trajet : pas les arrêts prioritaires du secteur */
  /* ses lignes : deux fois plus de passages */
  setSrc('mF',fc(on.freq?R.seg.filter(g=>g.k==='ride').map(g=>ln(g.pts.map(p=>[p[0],p[1]]),{c:g.col})):[]));
  /* lignes de bus à climatiser en priorité dans le secteur (simulateur du site) */
  const CR=[];if(window.SIM)for(const r of SIM.clim_rank){if(CR.length>=15)break;const T=traces('3|'+r.n);if(T.some(L=>L.some(p=>inB(p[0],p[1]))))CR.push(...T.map(L=>ln(L)));}
  const myNoac=R.seg.filter(g=>g.k==='ride'&&(g.noac||g.cl===2)).map(g=>ln(g.pts.map(p=>[p[0],p[1]])));setSrc('mC',fc(on.clim?myNoac:[]));
  const nC=window.SIM?SIM.clim_rank.filter(r=>traces('3|'+r.n).some(L=>L.some(p=>inB(p[0],p[1])))).slice(0,15).length:0;
  /* partir une heure plus tôt : son autre itinéraire */
  if(on.early&&earlyR===undefined)doseWith({early:true});
  setSrc('mE',fc(on.early&&earlyR?earlyR.seg.filter(g=>g.k!=='wait').map(g=>ln(g.pts.map(p=>[p[0],p[1]]))):[]));
  ['mC-case','mC','mF','mF2','mS'].forEach(id=>{if(map.getLayer(id))map.moveLayer(id);});
  return {nR:0,nC:myNoac.length,early:!!earlyR};
}
/* contexte transmis aux chapitres */
const share0=()=>{let o=0,t=0;R.seg.forEach(g=>{const d=(g.t1-g.t0)/60*g.rate;t+=d;if(g.out)o+=d;});return t>0?100*o/t:0;};
/* voyageurs simulés dehors à l'heure t, dans toute la région (MATSim, 1 % : × 100) */
function outNow(t){if(!MS||t<+MS.w0||t>+MS.w1)return null;let n=0;for(const L of MS.legs){const d0=L[1],du=L[2];if(t<d0||t>d0+du)continue;if(L[0]===0||(L[0]>=2&&t<d0+L[3]))n++;}return n*100;}
/* minutes au soleil ou dans un bus chaud, avec des mesures : ombre à l'arrêt, deux fois plus de passages, bus climatisés */
function sunWith(K){return R.seg.reduce((a,g)=>{const m=(g.t1-g.t0)/60;if(g.k==='walk'&&g.out)return a+m;if(g.k==='wait'&&g.out)return a+(K.shade?0:m)*(K.freq?.5:1);if(g.k==='ride'&&g.noac)return a+(K.clim?0:m);return a;},0);}
const X={get who(){return WHO;},outNow,sunWith,tAt,stops:stopsMap,stopsOff,measMap,doseWith,share:share0,temp:()=>tAt(R?simAt(u):27000),S,CRIT,RM,hm,totals,whatIf,ressenti,get R(){return R;},now:()=>simAt(u),iso:isoCompute,clearIso,
  crowd:()=>{crowdVis(true);const t=simAt(u),p=posAt(t);map.easeTo({center:[p[0],p[1]],zoom:14,padding:{left:400,top:0,right:0,bottom:0},duration:RM?0:1400});
    if(!MS||t<+MS.w0||t>+MS.w1)return null;let all=0,near=0;
    for(const L of MS.legs){const d0=L[1],du=L[2];if(t<d0||t>d0+du)continue;const out=L[0]===0||(L[0]>=2&&t<d0+L[3]);if(!out)continue;all++;
      const f=L[0]>=2?0:(du?(t-d0)/du:0),x=L[4]+(L[6]-L[4])*f,y=L[5]+(L[7]-L[5])*f;if(dist([x,y],p)<1500)near++;}
    return {all:all*100,near:near*100};},
  unfocus:()=>{crowdVis(false);map.setPadding({left:0,top:0,right:0,bottom:0});}};

/* ---------- séquence : couverture, ouverture, récit, conclusion ---------- */
async function start(o,d,dep,pk,btn){
  const pr=PROF[pk]||PROF.actif, err=$('#perr'); err.hidden=true;
  btn&&btn.classList.add('loading');
  try{await loadEngine();}catch(e){btn&&btn.classList.remove('loading');err.textContent='Les horaires du réseau n’ont pas pu être lus.';err.hidden=false;return;}
  await ready;
  const r=route(o,d,dep,pr);
  btn&&btn.classList.remove('loading');
  if(!r){err.textContent='Aucun trajet de moins de deux heures entre ces deux lieux à cette heure.';err.hidden=false;return;}
  return play(r,o.lab);
}
async function play(r,olab){
  hidePins();
    WHO=window.PROFIL?PROFIL.who():WHO; dress(WHO); $('#mapdesc').textContent=`Carte : le trajet de ${WHO.n}, de ${r.o.lab} à ${r.d.lab} ; ses marches et ses attentes au soleil en pointillés orange, ses trajets à bord à la couleur de chaque ligne.`;
  await ready;
  if(map.getLayer('mE'))map.setPaintProperty('mE','line-color',dark?'#4a93e0':'#1972d2');
  calm(1); loadFlow(); R=r; earlyR=undefined; prepare(R); IL=PAGES.plan(R); u=0; segI=-1; phase='intro'; playing=false;
  PAGES.close(); ['#pick','#pclockw','#end','#cap','#hclock','#hout','#hline'].forEach(s=>$(s).hidden=true);LAST.clear();lastDrawn=-1;
  ['trail','heat','others','veh','fleet','isoA','isoN','isoB','stopsC','mS','mR','mF','mC','mE'].forEach(x=>setSrc(x,fc([]))); marker.remove(); map.setPadding({left:0,top:0,right:0,bottom:0});
  /* 1. vue d'ensemble : le trajet se dessine */
  const xs=[],ys=[];R.seg.forEach(g=>g.pts.forEach(p=>{xs.push(p[0]);ys.push(p[1]);}));
  map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],{padding:innerWidth<768?{top:90,bottom:160,left:30,right:30}:{top:140,bottom:170,left:120,right:120},duration:RM?0:2200});
  const ti=$('#title'), dep=R.dep; $('#titk').textContent=`Jeudi 25 juin 2026 · ${hm(dep)} · ${nf(tAt(dep),0)} °C`;
  if(!SRC_TXT&&R.raptor)SRC_TXT='Trajet calculé sur les horaires du réseau (hors simulation)';
  $('#titt').textContent=`${WHO.n} part de ${R.o.lab.replace(/ \(.*\)$/,'')}`;
  $('#titx').textContent=`Direction ${R.d.lab.replace(/ \(.*\)$/,'')}. ${SRC_TXT}.`;
  ti.hidden=false; ti.classList.remove('show'); void ti.offsetWidth; ti.classList.add('show'); ti.focus({preventScroll:true});
  const steps=RM?1:14; for(let i=1;i<=steps;i++){drawRoute(i/steps); await wait(RM?0:130);}
  await wait(RM?0:1300); ti.hidden=true;
  /* 2. plongée vers la porte de Nadia */
  const p=posAt(R.dep);
  marker.setLngLat([p[0],p[1]]).addTo(map);
  map.flyTo({center:[p[0],p[1]],zoom:16.2,duration:RM?0:2800,curve:1.5,essential:true});
  await wait(RM?50:3000);
  camFromMap();
  ['#hclock','#hout','#hline'].forEach(s=>{const e=$(s);e.hidden=false;e.classList.remove('rise');void e.offsetWidth;if(!RM)e.classList.add('rise');});
  netBase=1; calm(1); crowdVis(false);
  phase='play'; setPlaying(true); drawAt(R.dep,true); $('#pp').focus({preventScroll:true});
}
function setPlaying(v){playing=v;$('#pp').dataset.on=v?'1':'0';$('#pp').setAttribute('aria-label',v?'Pause':'Lecture');}
function finish(){
  if(phase!=='play')return; phase='end'; setPlaying(false); drawAt(R.arr,true);
  const tot=totals(R.arr), tt=(R.arr-R.dep)/60;
  $('#endk').textContent=`Arrivée à ${hm(R.arr)} · ${R.d.lab.replace(/ \(.*\)$/,'')} · ${dur(tt)} de trajet`;
  $('#endt').textContent=`${WHO.n} a passé ${nf(Math.round(tot.out))} minutes dehors ce matin`;
  $('#endv').innerHTML=PAGES.ending(X); PAGES.endingInit(X); setTimeout(()=>fitPanel($('#end')),60); setTimeout(()=>$('#endt').focus({preventScroll:true}),400);
  $('#cap').hidden=true; $('#hline').hidden=true; const e=$('#end'); e.scrollTop=0; e.hidden=false; e.classList.remove('rise'); void e.offsetWidth; if(!RM)e.classList.add('rise');
  const xs=[],ys=[];R.seg.forEach(g=>g.pts.forEach(p=>{xs.push(p[0]);ys.push(p[1]);}));
  map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],{padding:PAD(),duration:RM?0:2600});
}
/* marges de la carte selon l'écran : panneau à gauche au bureau, tiroir en bas sur téléphone */
const PAD=()=>{const vis=s=>{const e=$(s);return e&&!e.hidden&&getComputedStyle(e).display!=='none'?e.getBoundingClientRect():null;};
  const top=Math.max(20,...['#hclock','#hout','#pclockw'].map(vis).filter(Boolean).filter(r=>r.top<innerHeight/3).map(r=>r.bottom+12));
  const panel=vis('#end')||vis('#chap'),bot=vis('#bottom'),hl=vis('#hline');
  let bottom=20+(bot?innerHeight-bot.top:0),left=20;
  if(hl)bottom=Math.max(bottom,innerHeight-hl.top+12);
  if(panel){if(panel.width<innerWidth*.6)left=Math.round(panel.right+20);else bottom=Math.max(bottom,Math.round(innerHeight-panel.top+12));}
  /* le personnage dépasse de son point d'environ 90 px vers le haut (et son étiquette vers la droite) */
  return {top:Math.round(top+90),bottom:Math.round(Math.min(bottom,innerHeight-top-170)),left:Math.round(Math.min(left,innerWidth-120)),right:70};};
/* personne qui reste chez elle (télétravail dans la simulation) : son trajet habituel en gris, puis la comparaison */
async function stay(a){
  hidePins();
  WHO=PROFIL.who(); dress(WHO); await ready;
  const r=fromAgent(a,'habituel'); if(!r)return;
  PAGES.close(); ['#pick','#pclockw','#end','#cap','#hclock','#hout','#hline'].forEach(s=>$(s).hidden=true); marker.remove();
  R=r; prepare(R); IL=[]; phase='end'; playing=false; netBase=1; calm(1); crowdVis(false);
  ['trail','heat','others','veh','fleet','isoA','isoN','isoB','stopsC','mS','mR','mF','mC','mE'].forEach(x=>setSrc(x,fc([])));
  /* son trajet habituel, en pointillés gris : le trajet évité ce jeudi */
  setSrc('route',fc([]));setSrc('mE',fc(R.seg.filter(g=>g.k!=='wait').map(g=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:g.pts.map(p=>[p[0],p[1]])}}))));
  if(map.getLayer('mE'))map.setPaintProperty('mE','line-color',dark?'#b5bec8':'#5d6873');
  setSrc('rstops',fc([]));
  const p=R.seg[0].pts[0]; marker.setLngLat([p[0],p[1]]).addTo(map); me.className='nadia wait still home'+(WHO.sil&&!WHO.sil.bun?' short':'');
  $('#endk').textContent=`Jeudi 25 juin 2026 · ${nf(tAt(R.dep),0)} °C à ${hm(R.dep)}`;
  $('#endt').textContent=`Ce matin, ${WHO.n} reste chez ${WHO.lui}`;
  $('#endv').innerHTML=PAGES.ending(X,true); PAGES.endingInit(X,true); setTimeout(()=>fitPanel($('#end')),60); setTimeout(()=>$('#endt').focus({preventScroll:true}),400);
  const e=$('#end'); e.scrollTop=0; e.hidden=false; e.classList.remove('rise'); void e.offsetWidth; if(!RM)e.classList.add('rise');
  const xs=[],ys=[];R.seg.forEach(g=>g.pts.forEach(q=>{xs.push(q[0]);ys.push(q[1]);}));
  map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],{padding:PAD(),duration:RM?0:2200});
}
/* ---------- calcul de sa journée : la simulation d'abord, les horaires en dernier recours ----------
   1. exemple inchangé : l'agent MATSim de l'exemple (aller, retour, ou journée chez soi)
   2. vivier MATSim : quelqu'un de sa catégorie qui fait ce trajet (mêmes communes), puis quelqu'un d'une autre catégorie,
      puis le trajet simulé le plus proche entre communes voisines (moins de 2,5 km aux deux bouts)
   3. sinon, ou si sa marche est plus lente (60 ans et plus, poussette) : calcul sur les horaires (RAPTOR), hors simulation */
const COM=new Map();S.forEach(s=>{if(s.c&&s.co&&!COM.has(s.c))COM.set(s.c,s.co);});
const CPT=new Map();PL.forEach(p=>{if(p.k==='commune'&&COM.has(p.lab))CPT.set(COM.get(p.lab),[p.pt[1],p.pt[0]]);});
const NCOM=new Map([...COM].map(([n,c])=>[c,n]));
let vivP=null;
const loadVivier=()=>vivP||(vivP=window.VIVIER?Promise.resolve(window.VIVIER):new Promise(res=>{const sc=document.createElement('script');sc.src='../../web/data/profils_vivier.js';sc.onload=()=>res(window.VIVIER);sc.onerror=()=>res(null);document.head.appendChild(sc);}));
function decode(V,v){const N=V.noms,X=e=>e/1e5;
  const dec=T=>(T||[]).map(l=>{const t0=l[1],t1=l[1]+l[2],a=[X(l[3]),X(l[4])];
    if(l[0]===0){const p=[];for(let q=8;q+1<l.length;q+=2)p.push([X(l[q]),X(l[q+1])]);return {k:'walk',t0,t1,a,b:[X(l[5]),X(l[6])],...(l[7]?{in:true}:{}),...(p.length?{p}:{})};}
    if(l[0]===1)return {k:'wait',t0,t1,a,s:l[7]<0?null:l[7],sn:N[l[8]],quai:!!l[9]};
    return {k:'ride',t0,t1,a,b:[X(l[5]),X(l[6])],ty:l[7],nm:N[l[8]],sa:l[9]<0?null:l[9],sb:l[10]<0?null:l[10],na:N[l[11]],nb:N[l[12]],noac:!!l[13]};});
  const L=dec(v[3]),Lr=dec(v[4]);
  return {hc:v[0],wc:v[1],hn:NCOM.get(v[0])||v[0],wn:NCOM.get(v[1])||v[1],h:L[0].a,matin:L,soir:Lr.length?Lr:null,reste:false,cs:V.cs[v[2]]};}
/* recherche dans la simulation par points : départ et arrivée des agents les plus proches de son domicile et de son travail.
   « meme » : sa catégorie, à moins de 800 m aux deux bouts ; « autre » : une autre catégorie, même distance ; « voisin » : jusqu'à 2,5 km */
async function chercher(w,o,d){
  const V=await loadVivier();if(!V)return null;
  if(!V.ends)V.ends=V.agents.map(v=>{const L=v[3],z=L[L.length-1];return [[L[0][3]/1e5,L[0][4]/1e5],z[0]===1?[z[3]/1e5,z[4]/1e5]:[z[5]/1e5,z[6]/1e5]];});
  const ci=V.cs.indexOf(w.cs),want=w.st.dep||0,P0=[o.pt[1],o.pt[0]],P1=[d.pt[1],d.pt[0]];
  const C=[];V.agents.forEach((v,i)=>{const e=V.ends[i];if(Math.abs(e[0][0]-P0[0])>.04||Math.abs(e[0][1]-P0[1])>.025)return;
    const da=dist(e[0],P0),db=dist(e[1],P1);if(da>2500||db>2500)return;if(want&&Math.abs(v[3][0][1]-want)>1800)return;C.push([v,da,db]);});
  if(!C.length)return null;
  const sc=x=>Math.max(x[1],x[2])+(want?Math.abs(x[0][3][0][1]-want)/6:0);
  const best=f=>{const L=C.filter(f).sort((A,B)=>sc(A)-sc(B));return L[0];};
  let x=best(c=>c[0][2]===ci&&c[1]<=800&&c[2]<=800),how='meme';
  if(!x){x=best(c=>c[1]<=800&&c[2]<=800);how='autre';}
  if(!x){x=best(c=>c[0][2]===ci)||best(()=>true);how='voisin';}
  return x?{agent:decode(V,x[0]),how,da:x[1],db:x[2]}:null;}
/* épingles « domicile » et « travail » pendant la création ; clic sur la carte pour les poser */
const pin=lab=>{const e=document.createElement('div');e.className='pin';e.innerHTML=`<b>${lab}</b><i></i>`;return new maplibregl.Marker({element:e,anchor:'bottom'});};
const PIN={o:pin('Domicile'),d:pin('Travail')};let pickK=null;
function placeOf(st,k){const p=st[k+'p'];if(p)return {lab:st[k],pt:p};const f=findPlace(st[k]);return f?{lab:f.lab,pt:f.pt}:null;}
window.__pins=()=>{if(phase!=='pick')return;const st=PROFIL.state();['o','d'].forEach(k=>{const p=placeOf(st,k);if(p)PIN[k].setLngLat([p.pt[1],p.pt[0]]).addTo(map);else PIN[k].remove();});
  const a=placeOf(st,'o'),b=placeOf(st,'d');if(a&&b){const r=$('#pick').getBoundingClientRect(),m=innerWidth<768;
    map.fitBounds([[Math.min(a.pt[1],b.pt[1]),Math.min(a.pt[0],b.pt[0])],[Math.max(a.pt[1],b.pt[1]),Math.max(a.pt[0],b.pt[0])]],{padding:m?{top:70,bottom:innerHeight-r.top+30,left:40,right:40}:{top:90,bottom:110,left:r.right+60,right:80},maxZoom:13,duration:RM?0:1200});}};
const hidePins=()=>{PIN.o.remove();PIN.d.remove();pickK=null;map.getCanvas().style.cursor='';};
window.__pickOnMap=k=>{pickK=k;map.getCanvas().style.cursor=k?'crosshair':'';};
map.on('click',e=>{if(phase!=='pick'||!pickK)return;const k=pickK,pt=[e.lngLat.lat,e.lngLat.lng];
  let best=null,bd=1e9;S.forEach(s=>{if(!s.c)return;const dd=Math.abs(s.lon-pt[1])+Math.abs(s.lat-pt[0]);if(dd<bd){bd=dd;best=s;}});
  PROFIL.setPoint(k,pt,`Point sur la carte${best?' ('+best.c+')':''}`);window.__pickOnMap(null);window.__pins();});
let SRC_TXT='';
async function follow(w){
  const err=$('#perr');err.hidden=true;const btn=$('#wnext');
  if(w.persona){const a=w.agent;window.__agentCalc=null;current={agent:a,who:w};SRC_TXT=`Trajet de ${w.persona.prenom} dans la simulation`;
    if(a.reste)return stay(a);const r=fromAgent(a,'matin');if(r)return play(r,a.hn);return;}
  const st=w.st;let o=placeOf(st,'o'),d=placeOf(st,'d');
  if(!o){const g=await PROFIL.geocode(st.o);if(g){PROFIL.setPoint('o',g.pt,g.lab);o=g;}}
  if(!d){const g=await PROFIL.geocode(st.d);if(g){PROFIL.setPoint('d',g.pt,g.lab);d=g;}}
  if(!o||!d){err.textContent=`Lieu introuvable : ${!o?st.o:st.d}. Choisissez une suggestion de la liste ou un point sur la carte.`;err.hidden=false;return;}
  if(dist([o.pt[1],o.pt[0]],[d.pt[1],d.pt[0]])<500){err.textContent='Il habite et travaille presque au même endroit : choisissez deux lieux plus éloignés.'.replace('Il ',w.e==='elle'?'Elle ':'Il ');err.hidden=false;return;}
  btn.classList.add('loading');
  let f=null;if(w.marche==='actif')f=await chercher(w,o,d);
  btn.classList.remove('loading');
  if(f){window.__agentCalc=f.agent;const r=fromAgent(f.agent,'matin');
    if(r){current={agent:f.agent,who:w};SRC_TXT=f.how==='meme'?`Trajet tiré de la simulation : ${w.e==='elle'?'une':'un'} ${w.cat.toLowerCase()} simulé${w.e==='elle'?'e':''} qui fait ce trajet`
      :f.how==='autre'?'Trajet tiré de la simulation : une personne simulée qui fait ce trajet':`Trajet tiré de la simulation, le plus proche du sien (départ à ${nf(Math.round(f.da/100)*100)} m, arrivée à ${nf(Math.round(f.db/100)*100)} m)`;
      return play(r,f.agent.hn);}}
  window.__agentCalc=null;SRC_TXT='Trajet calculé sur les horaires du réseau (hors simulation)';
  return launch(o,d,st.dep||27000,w.marche,btn);}
if(window.PROFIL)PROFIL.onStart(follow);
function coverFrame(anim){if(phase!=='pick')return;const st=PROFIL.state();if((st.op||st.o)&&(st.dp||st.d)&&document.querySelector('#pick .wst[data-s="4"]:not([hidden])'))return;
  const r=$('#pick').getBoundingClientRect(),m=r.width>innerWidth*.6,c=$('#pclockw').getBoundingClientRect();
  const pad=m?{top:Math.round(c.bottom+6),bottom:Math.round(innerHeight-r.top+6),left:6,right:6}:{top:Math.round(c.bottom+10),bottom:70,left:Math.round(r.right+10),right:20};
  map.fitBounds(m?[[1.95,48.55],[2.85,49.12]]:[[1.45,48.12],[3.56,49.24]],{padding:pad,duration:anim&&!RM?900:0});}
ready.then(()=>{netBase='cover';calm(1);coverFrame(false);map.on('resize',()=>coverFrame(false));});
addEventListener('resize',()=>{coverFrame(false);['#chap','#end','#pick'].forEach(s=>fitPanel($(s)));});
window.__follow=follow;
function seekFrac(f){if(!R||phase==='intro')return;PAGES.close();if(phase==='end'){phase='play';$('#end').hidden=true;$('#hline').hidden=false;camFromMap();}
  u=uAt(R.dep+(R.arr-R.dep)*clamp(f));segI=-1;const tt=simAt(u);IL.forEach(x=>x.shown=x.t<tt&&x.id!=='arrivee');}

/* ---------- commandes ---------- */
let current=null;
function launch(o,d,h,p,btn){current={o,d,h,p};return start(o,d,h,p,btn);}
$('#pp').addEventListener('click',()=>{if(phase==='play'&&!PAGES.isOpen())setPlaying(!playing);else if(phase==='end')replay();});
$('#auto').addEventListener('click',()=>{const v=$('#auto').getAttribute('aria-pressed')!=='true';$('#auto').setAttribute('aria-pressed',String(v));PAGES.setAuto(v);});
$('#speed').addEventListener('click',()=>{speed=speed===1?2:speed===2?4:1;$('#speed').textContent='× '+speed;$('#speed').setAttribute('aria-label','Vitesse de lecture × '+speed);me.style.setProperty('--step',(Math.max(.22,.6/Math.sqrt(speed))).toFixed(2)+'s');});
$('#fmarks').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!R||phase==='intro')return;e.stopPropagation();const i=+b.dataset.i,il=IL[i];
  seekFrac((il.t-R.dep)/(R.arr-R.dep));openChapter(il,i);});
const fr=$('#frise');
let drag=false; const fx=e=>{const r=fr.getBoundingClientRect();return (e.clientX-r.left)/r.width;};
fr.addEventListener('pointerdown',e=>{if(e.target.closest('#fmarks button'))return;drag=true;fr.setPointerCapture(e.pointerId);seekFrac(fx(e));});
fr.addEventListener('pointermove',e=>{if(drag)seekFrac(fx(e));});
fr.addEventListener('pointerup',()=>drag=false);
fr.addEventListener('keydown',e=>{if(!R)return;const f=(simAt(u)-R.dep)/(R.arr-R.dep),K={ArrowRight:f+.02,ArrowLeft:f-.02,PageUp:f+.1,PageDown:f-.1,Home:0,End:.999};if(e.key in K){e.preventDefault();seekFrac(K[e.key]);}});
function replay(){if(!current)return;if(current.agent){const r=current.agent.reste?null:fromAgent(current.agent,'matin');if(current.agent.reste)return stay(current.agent);if(r)return play(r,current.agent.hn);}launch(current.o,current.d,current.h,current.p);}
$('#again').addEventListener('click',replay);
$('#other').addEventListener('click',()=>{phase='pick';PAGES.close();netBase='cover';calm(1);crowdVis(true);['mS','mR','mF','mC','mE'].forEach(x=>setSrc(x,fc([])));['#end','#cap','#hclock','#hout','#hline'].forEach(s=>$(s).hidden=true);marker.remove();setSrc('route',fc([]));setSrc('rstops',fc([]));setSrc('trail',fc([]));PROFIL.render();setTimeout(()=>{const c=$('#pick h1');if(c){c.tabIndex=-1;c.focus({preventScroll:true});}},60);
  $('#pclockw').hidden=false; setTimeout(()=>{coverFrame(true);window.__pins&&window.__pins();},50); const e=$('#pick');e.hidden=false;e.classList.remove('rise');void e.offsetWidth;if(!RM)e.classList.add('rise');
});
document.addEventListener('keydown',e=>{if(e.key===' '&&phase==='play'&&!PAGES.isOpen()&&!/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)){e.preventDefault();setPlaying(!playing);}});
loadEngine().catch(()=>{});
window.__nadia={map,get WHO(){return WHO;},get R(){return R;},get IL(){return IL;}};

/* ---------- guide ---------- */
const toT=h=>{const m=String(h||'').match(/(\d{1,2})\D*(\d{2})?/);return m?(+m[1])*3600+(+(m[2]||0))*60:null;};
UI.guide({
  ecran:'trajet',
  etat:()=>R?{personne:WHO.n,categorie:WHO.cat,simulation:!R.raptor,depart:R.o.lab,arrivee:R.d.lab,heure_depart:hm(R.dep),arrivee_a:hm(R.arr),profil:R.pr.lab,phase,heure_affichee:hm(simAt(u)),
    segments:R.seg.map(g=>({type:g.k,debut:hm(g.t0),minutes:Math.round((g.t1-g.t0)/60),ligne:g.nm,dehors:g.out,climatisation:g.k==='ride'?['oui','en partie','non'][g.cl]:undefined,voyageurs_simules_autour:g.crowd?g.crowd*100:undefined})),
    ...(()=>{const x=totals(R.arr);return {dose_totale:+x.dose.toFixed(1),minutes_dehors:Math.round(x.out),minutes_bus_non_climatise:Math.round(x.noac)};})()}:{phase:'choix du trajet'},
  actions:{
    suivre_personne:async a=>{const k=String(a.personne||'nadia').toLowerCase();PROFIL.select(k);follow(PROFIL.who());},
    lancer_trajet:async a=>{const o=findPlace(a.depart||'Cergy'), d=findPlace(a.arrivee||'Créteil');if(!o||!d)return;
      const h=toT(a.heure); launch(o,d,h!=null?clamp(h,23400,34200):27000,PROF[a.profil]?a.profil:'actif');},
    mettre_en_avant:async a=>{const el=$({dose:'#hout',jauge:'#hout',dehors:'#hout',heure:'#hclock',temperature:'#hclock',frise:'#hline',legende:'#cap',bilan:'#end'}[a.cible]||'#hout');if(el&&!el.hidden)UI.spotOn(el,6);},
    zoomer_carte:async a=>{if(phase==='play')setPlaying(false);map.flyTo({center:[a.lon,a.lat],zoom:a.zoom||14,duration:RM?0:1200});await wait(1300);},
  },
  welcome:'Choisissez une personne et suivez sa matinée. Je peux expliquer le compteur « Dehors ».',
  fallback:'Sans le serveur du guide, je ne connais que quelques questions :',
  sugg:[`Suis ${PROFIL.who(PROFIL.all()[0]).n}`,'Que compte le compteur « Dehors » ?',`Suis ${PROFIL.who(PROFIL.all()[4]).n}`],
  intents:[
    {k:/suis|suivre|lance|commence|julie|thomas|sophie|karim|nadia/,run:async()=>{const q=norm($('#q').value||''),L=PROFIL.all(),hit=L.find(p=>q.includes(norm(PROFIL.who(p).n))||q.includes(p.key)),k=(hit||L[0]).key;
      PROFIL.select(k);const w=PROFIL.who();follow(w);
      return [w.agent.reste?`Ce jeudi, ${w.n} reste chez ${w.lui} : ${w.il} ne prend pas les transports ce jour-là.`:`${w.n} part de ${w.agent.hn} pour ${w.agent.wn}. Le compteur avance quand ${w.il} marche ou attend dehors, et s’arrête à bord.`,['Que compte le compteur « Dehors » ?']];}},
    {k:/dehors|compteur|jauge|dose|calcul/,run:async()=>{const el=$('#hout');if(!el.hidden)UI.spotOn(el,6);
      return ['Le compteur additionne les minutes à pied et les minutes d’attente à un arrêt en surface, d’après les étapes de la simulation. À bord, sur un quai souterrain ou dans les couloirs d’une gare, il s’arrête.',[`Suis ${PROFIL.who(PROFIL.all()[4]).n}`]];}},
  ]});
})();
