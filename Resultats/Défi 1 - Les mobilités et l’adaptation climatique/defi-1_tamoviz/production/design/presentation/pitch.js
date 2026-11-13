/* Réseau sous canicule · vidéo de pitch en motion design, en six temps :
   1 l'accroche, 2 le problème, 3 la solution, 4 la différenciation, 5 les impacts, 6 la suite.
   Une seule carte MapLibre sert de caméra : elle vole d'une diapositive à l'autre et ses couches se construisent.
   La solution montre l'écran réel « Une journée sous canicule » (design/maquette/trajet.html), en direct.
   Navigation : flèches, Page précédente / suivante, Entrée, Début, Fin ; Espace = lecture automatique ;
   T = thème ; F = plein écran ; #n dans l'adresse ouvre la diapositive n ; ?auto=1 lance la lecture.
   Lit : web/data/core.js (IDF), couleurs_lignes.js (LCOL), traces_lignes.js (TRL), volet2.js (V2),
   matsim.js (MATSIM), profils.js (PROFILS). Aucun chiffre n'est recopié à la main. */
(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const RM=matchMedia('(prefers-reduced-motion:reduce)').matches;
const nf=(v,d=0)=>Number(v).toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d});
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=f=>{f=clamp(f);return f<.5?4*f*f*f:1-Math.pow(-2*f+2,3)/2;};
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hm=s=>{const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return `${h} h ${String(m).padStart(2,'0')}`;};
const IDF=window.IDF, LCOL=window.LCOL||{}, TRL=window.TRL||{}, V2=window.V2, MS=window.MATSIM, PR=window.PROFILS;

/* ---------- échelle de la scène : 1 280 × 720, jamais de défilement ---------- */
let K=1;
function fit(){K=Math.min(innerWidth/1280,innerHeight/720);document.documentElement.style.setProperty('--k',K.toFixed(4));}
fit();

/* ---------- thème : même clé que les écrans de la maquette, pour que l'écran intégré suive ---------- */
const THK='rsc-theme';
const isDark=()=>{const t=document.documentElement.dataset.theme;return t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;};
try{const t=localStorage.getItem(THK);if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}
const themeLabel=()=>{$('#theme').textContent=isDark()?'Thème clair':'Thème sombre';};

/* =====================================================================
   Données
   ===================================================================== */
const MODE_C={0:'#529889',1:'#b89755',2:'#6574b6',3:'#c67f77'};
const MODE_N={0:'le tramway',1:'le métro',2:'le train',3:'le bus'};
const CEN=[2.3488,48.8534];
const dkm=(a,b)=>Math.hypot((a[0]-b[0])*73.3,(a[1]-b[1])*111.32);

/* tracés officiels : même décodage que l'écran « Une journée sous canicule » (design/maquette/trajet.js) */
const TRC={};
function traces(key){if(TRC[key])return TRC[key];const raw=TRL[key]||[];
  return TRC[key]=raw.map(e=>{const L=[];let x=e[0],y=e[1];L.push([x/1e5,y/1e5]);for(let i=2;i<e.length;i+=2){x+=e[i];y+=e[i+1];L.push([x/1e5,y/1e5]);}return L;});}
const dist=(a,b)=>Math.hypot((a[0]-b[0])*73300,(a[1]-b[1])*111320);
function project(L,p){let best=[1e15,0,0,L[0]],acc=0;
  for(let i=1;i<L.length;i++){const a=L[i-1],b=L[i],ax=(b[0]-a[0])*73300,ay=(b[1]-a[1])*111320,l2=ax*ax+ay*ay,
    px=(p[0]-a[0])*73300,py=(p[1]-a[1])*111320,f=l2?Math.max(0,Math.min(1,(px*ax+py*ay)/l2)):0,dx=px-f*ax,dy=py-f*ay,d=Math.hypot(dx,dy),sl=Math.sqrt(l2);
    if(d<best[0])best=[d,acc+f*sl,i,[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]];acc+=sl;}
  return best;}
function piece(key,A,B){const direct=dist(A,B);let best=null;
  for(const L of traces(key)){const pa=project(L,A),pb=project(L,B);if(pa[0]>220||pb[0]>220)continue;
    const len=Math.abs(pb[1]-pa[1]);if(len>direct*2.6+400||len<direct*.6)continue;const sc=pa[0]+pb[0]+len*.02;if(best&&best.sc<=sc)continue;
    const mid=pa[1]<=pb[1]?L.slice(pa[2],pb[2]):L.slice(pb[2],pa[2]).reverse();
    best={sc,pts:[pa[3],...mid,pb[3]]};}
  return best?best.pts:null;}

const fc=f=>({type:'FeatureCollection',features:f});
const line=(c,p)=>({type:'Feature',properties:p,geometry:{type:'LineString',coordinates:c}});
const pt=(c,p)=>({type:'Feature',properties:p,geometry:{type:'Point',coordinates:c}});

/* réseau ferré (train, RER, métro, tramway) à la couleur officielle ; rang de révélation = distance au centre de Paris */
const NET=[],BUS=[];
Object.keys(TRL).forEach(k=>{const ty=+k.split('|')[0];
  if(ty<=2){const c=LCOL[k]||MODE_C[ty];
    traces(k).forEach(L=>{let dm=1e9;for(let i=0;i<L.length;i+=6)dm=Math.min(dm,dkm(L[i],CEN));
      const Q=L.filter((p,i)=>i%2===0||i===L.length-1);if(Q.length>1)NET.push(line(Q,{c,ty,r:clamp(dm/45)}));});}
  else if(ty===3){traces(k).forEach(L=>{const Q=L.filter((p,i)=>i%5===0||i===L.length-1);if(Q.length>1)BUS.push(line(Q,{}));});}
});

/* zones d'arrêt et cinq fragilités : mêmes seuils que l'écran (CRIT de trajet.js) */
const C=IDF.cols, NZ=C.id.length, ZONES=[];let HOT=0;
const CRIT=[i=>C.aj[i]>=10, i=>C.nc[i]!=null&&C.nc[i]>=.5, i=>C.pp[i]!=null&&C.pp[i]<=20, i=>C.df[i]==null||C.df[i]>300, i=>C.nvp[i]!=null&&C.nvp[i]<=20];
for(let i=0;i<NZ;i++){const p={r:clamp(dkm([C.lon[i],C.lat[i]],CEN)/60),n:0};
  CRIT.forEach((f,j)=>{const v=f(i)?1:0;p['f'+j]=v;p.n+=v;});if(p.n>=3)HOT++;
  ZONES.push(pt([C.lon[i],C.lat[i]],p));}

/* voyageurs MATSim (vigilance rouge) : déplacements, et attentes reconstituées entre deux déplacements */
const KIND={walk:1,bike:2,rail:3,subway:3,tram:3,bus_ac:3,bus_noac:4};
const LEGS=[];
{const by=new Map();(MS.anim.c||[]).forEach(a=>{if(a[1]==='stay')return;let g=by.get(a[0]);if(!g)by.set(a[0],g=[]);g.push(a);});
  by.forEach(g=>{g.sort((a,b)=>a[2]-b[2]);
    g.forEach((a,i)=>{LEGS.push([a[2],a[2]+Math.max(a[3],1),a[4],a[5],a[6],a[7],KIND[a[1]]||3]);
      const b=g[i+1];if(b){const e=a[2]+a[3],gap=b[2]-e;if(gap>20&&gap<2400)LEGS.push([e,b[2],a[6],a[7],a[6],a[7],0]);}});});}
function agentsAt(T,only){const F=[];let out=0,on=0;
  for(const L of LEGS){if(T<L[0]||T>=L[1])continue;const k=L[6];if(k<=1)out++;else if(k>=3)on++;
    if(only&&k>1)continue;const f=(T-L[0])/(L[1]-L[0]);F.push(pt([L[2]+(L[4]-L[2])*f,L[3]+(L[5]-L[3])*f],{k}));}
  return {F,out,on};}

/* personnes types : le premier agent de chaque profil, celui que montre l'écran (règle de 18_profils_matsim.py).
   Dehors = marche + attente à un arrêt en surface (l'attente sur un quai ne compte pas). */
const PERS=(PR.personas||[]).map(p=>{const a=p.agents[0]||{};
  const base={key:p.key,name:p.prenom,elle:p.genre==='elle',cs:p.cs,job:p.metiers[0],from:a.hn,to:a.wn,id:a.id};
  if(a.reste||!a.matin||!a.matin.length)return Object.assign(base,{home:true,seg:[],dur:0});
  const t0=a.matin[0].t0;
  const seg=a.matin.map(s=>{let g;const col=s.k==='ride'?(LCOL[s.ty+'|'+s.nm]||MODE_C[s.ty]||'#6574b6'):null;
    if(s.k==='ride')g=piece(s.ty+'|'+s.nm,s.a,s.b)||[s.a,s.b];else if(s.k==='walk')g=[s.a,s.b];else g=[s.a,s.a];
    const cum=[0];for(let i=1;i<g.length;i++)cum.push(cum[i-1]+dist(g[i-1],g[i]));
    return {k:s.k,out:s.k==='walk'||(s.k==='wait'&&!s.quai),noac:s.k==='ride'&&!!s.noac,ty:s.ty,nm:s.nm,sn:s.sn,a:s.a,t0:s.t0-t0,t1:s.t1-t0,abs:s.t0,g,cum,col};});
  const sum=f=>seg.filter(f).reduce((v,s)=>v+(s.t1-s.t0),0)/60;
  return Object.assign(base,{seg,dur:seg[seg.length-1].t1,t0,
    walk:sum(s=>s.k==='walk'),wait:sum(s=>s.k==='wait'&&s.out),noacM:sum(s=>s.noac)});});
const MOV=PERS.filter(P=>!P.home), NADIA=MOV[0], THOMAS=MOV.find(P=>P.noacM>0)||MOV[1];
function along(s,f){const L=s.cum[s.cum.length-1]*f;let i=1;while(i<s.g.length-1&&s.cum[i]<L)i++;
  const a=s.g[i-1],b=s.g[i]||a,sl=(s.cum[i]-s.cum[i-1])||1,u=clamp((L-s.cum[i-1])/sl);return [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u];}
function persAt(P,T){let out=0,pos=null,seg=null,trail=[];
  for(const s of P.seg){if(T>=s.t1){if(s.out)out+=s.t1-s.t0;trail.push(...s.g);continue;}
    if(T>=s.t0){const f=(T-s.t0)/((s.t1-s.t0)||1);if(s.out)out+=T-s.t0;seg=s;pos=s.k==='wait'?s.g[0]:along(s,f);
      if(s.k!=='wait'){const L=s.cum[s.cum.length-1]*f;s.g.forEach((p,i)=>{if(s.cum[i]<=L)trail.push(p);});}trail.push(pos);}
    break;}
  if(!pos){const s=P.seg[P.seg.length-1];pos=s.g[s.g.length-1];}
  return {out,pos,seg,trail};}
const routeOf=P=>P.seg.filter(s=>s.g.length>1).map(s=>line(s.g,{c:s.col||css('--hot'),o:s.out?1:0}));

/* l'accroche : sa première attente au soleil */
const HOOK=(()=>{const P=NADIA,i=P.seg.findIndex(s=>s.k==='wait'&&s.out),w=P.seg[i],r=P.seg.slice(i).find(s=>s.k==='ride');
  return {P,at:w.a,sn:w.sn,t:w.abs,mode:r?(MODE_N[r.ty]||'')+' '+r.nm:''};})();
/* température maximale du jour suivi (25 juin) à Paris-Montsouris */
const TMAX=(V2.serie.find(s=>s.d==='2026-06-25')||V2.serie[0]).met['75'].tx;

/* =====================================================================
   Carte caméra
   ===================================================================== */
const STYLE=d=>`https://tiles.openfreemap.org/styles/${d?'dark':'positron'}`;
const IDF_B=[[1.45,48.12],[3.56,49.24]], PC_B=[[2.17,48.74],[2.56,48.97]];
const map=new maplibregl.Map({container:'map',style:STYLE(isDark()),bounds:IDF_B,interactive:false,
  attributionControl:{compact:true},fadeDuration:0,pitchWithRotate:false,maxPitch:65});
let ready=false;
const LAY={bus:['line-opacity'],net:['line-opacity'],heat:['line-opacity'],zones:['circle-opacity'],ag:['circle-opacity'],
  route:['line-opacity'],trail:['line-opacity'],stops:['circle-opacity','circle-stroke-opacity']};
const vis={};
function show(o){vis.cur=o;if(!ready)return;
  Object.keys(LAY).forEach(id=>{const v=o[id]||0;LAY[id].forEach(p=>map.setPaintProperty(id,p,v));});}
const setP=(id,p,v)=>{if(ready)map.setPaintProperty(id,p,v);};
const setF=(id,f)=>{if(ready)map.setFilter(id,f);};
const setD=(id,d)=>{if(ready){const s=map.getSource(id);if(s)s.setData(d);}};
function addLayers(){
  const dk=isDark(),T={duration:RM?0:900,delay:0};
  ['bus','net','zones','ag','route','trail','stops'].forEach(id=>map.addSource(id,{type:'geojson',data:fc(id==='bus'?BUS:id==='net'?NET:id==='zones'?ZONES:[])}));
  map.addLayer({id:'bus',type:'line',source:'bus',paint:{'line-color':dk?'#5a6572':'#9aa4b0','line-width':['interpolate',['linear'],['zoom'],8,.3,12,.9],'line-opacity':0,'line-opacity-transition':T}});
  map.addLayer({id:'net',type:'line',source:'net',layout:{'line-join':'round','line-cap':'round'},
    paint:{'line-color':['get','c'],'line-width':['interpolate',['linear'],['zoom'],8,['match',['get','ty'],2,1.6,1.1],12,['match',['get','ty'],2,4,3],16,['match',['get','ty'],2,9,7]],'line-opacity':0,'line-opacity-transition':T}});
  map.addLayer({id:'heat',type:'line',source:'net',layout:{'line-join':'round','line-cap':'round'},
    paint:{'line-color':css('--heat-4'),'line-width':['interpolate',['linear'],['zoom'],8,2.2,12,5.5,16,11],'line-opacity':0}});
  map.addLayer({id:'zones',type:'circle',source:'zones',paint:{'circle-radius':['interpolate',['linear'],['zoom'],8,1.3,12,3.5,15,6],
    'circle-color':css('--tx3'),'circle-opacity':0,'circle-opacity-transition':T,'circle-color-transition':{duration:RM?0:600}}});
  map.addLayer({id:'route',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},
    paint:{'line-color':['get','c'],'line-width':4,'line-opacity':0,'line-opacity-transition':T}});
  map.addLayer({id:'trail',type:'line',source:'trail',layout:{'line-join':'round','line-cap':'round'},
    paint:{'line-color':['get','c'],'line-width':6,'line-opacity':0,'line-opacity-transition':T}});
  map.addLayer({id:'stops',type:'circle',source:'stops',paint:{'circle-radius':9,'circle-color':['get','c'],'circle-stroke-color':css('--panel'),'circle-stroke-width':2.5,
    'circle-opacity':0,'circle-stroke-opacity':0,'circle-opacity-transition':T,'circle-stroke-opacity-transition':T,'circle-color-transition':{duration:RM?0:600}}});
  map.addLayer({id:'ag',type:'circle',source:'ag',paint:{'circle-radius':['interpolate',['linear'],['zoom'],8,2.4,12,4.6],
    'circle-color':['match',['get','k'],0,css('--heat-4'),1,css('--hot'),2,css('--ok'),4,css('--alert'),css('--ns')],
    'circle-opacity':0,'circle-opacity-transition':T}});
  ready=true;
  if(vis.cur)show(vis.cur);
  if(cur>=0){const s=SCN[SL[cur].dataset.scene];if(s.leave)s.leave();s.enter.call(s);}
}
map.on('style.load',addLayers);

/* cadrage : la zone utile est à droite du panneau de texte */
function pad(pr){const sl=(innerWidth-1280*K)/2,st=(innerHeight-720*K)/2;
  return {left:Math.round(sl+(pr+30)*K),right:Math.round(sl+40*K),top:Math.round(st+40*K),bottom:Math.round(st+86*K)};}
let camTok=0;
function fly(b,o={}){const tok=++camTok;let center,z;
  if(o.center){center=o.center;z=o.zoom;}else{const c=map.cameraForBounds(b,{padding:pad(o.pr==null?520:o.pr)});if(!c)return;center=c.center;z=c.zoom+(o.dz||0);}
  const bear=o.bearing||0;
  /* décalage plutôt que marge : flyTo garderait la marge pour les vols suivants */
  const P=pad(o.pr==null?520:o.pr),off=o.center?[(P.left-P.right)/2,(P.top-P.bottom)/2]:[0,0];
  map.flyTo({center,zoom:z,pitch:o.pitch||0,bearing:bear,offset:off,duration:RM?0:(o.dur||2600),curve:1.3,essential:true});
  if(o.drift&&!RM)map.once('moveend',()=>{if(tok!==camTok)return;
    map.easeTo({bearing:bear+(o.drift.b||0),zoom:z+(o.drift.z||0),pitch:(o.pitch||0)+(o.drift.p||0),duration:o.drift.t*1000,easing:t=>t,essential:true});});}
const bboxOf=P=>{const B=new maplibregl.LngLatBounds();P.seg.forEach(s=>s.g.forEach(p=>B.extend(p)));return B.toArray();};

/* =====================================================================
   Dessins des panneaux (SVG, couleurs du thème)
   ===================================================================== */
const PERSON='M12 2.8a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 1 1 0-6.4zM6 21v-5a6 6 0 0 1 12 0v5z';
const SUN=(x,y,r)=>{let v=`<circle cx="${x}" cy="${y}" r="${r*.55}"/>`;for(let i=0;i<8;i++){const a=i*Math.PI/4,c=Math.cos(a),s=Math.sin(a);
  v+=`<line x1="${(x+c*r*.75).toFixed(1)}" y1="${(y+s*r*.75).toFixed(1)}" x2="${(x+c*r).toFixed(1)}" y2="${(y+s*r).toFixed(1)}"/>`;}return v;};
const G=PR.groupes, GK=['cadre','inter','employe','ouvrier'], GN={cadre:'Cadres',inter:'Prof. intermédiaires',employe:'Employés',ouvrier:'Ouvriers'};

/* dix bonshommes par groupe : ceux qui restent chez eux passent en bleu, un par un */
function pplSvg(){const W=414,rh=40,H=GK.length*rh;
  let v=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sur dix personnes, restent chez elles en vigilance rouge : ${GK.map(k=>GN[k].toLowerCase()+' '+Math.round(G[k].reste_canicule/10)).join(', ')}">`;
  GK.forEach((k,i)=>{const y=i*rh,n=Math.round(G[k].reste_canicule/10);
    v+=`<text x="0" y="${y+22}">${GN[k]}</text>`;
    for(let j=0;j<10;j++)v+=`<g transform="translate(${148+j*21} ${y+3}) scale(1.15)"><path class="pp" data-g="${i}" data-j="${j}" data-h="${j<n?1:0}" d="${PERSON}" style="fill:var(--hot)"/></g>`;
    v+=`<text class="v va" data-g="${i}" x="${148+10*21+6}" y="${y+22}" opacity="0">${n}/10</text>`;});
  return v+'</svg>';}
/* minutes dehors par personne : un soleil = une minute */
function sunSvg(){const W=414,rh=40,H=GK.length*rh,mx=Math.max(...GK.map(k=>G[k].dehors_par_personne));const per=Math.ceil(mx);
  let v=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes dehors par personne en vigilance rouge : ${GK.map(k=>GN[k].toLowerCase()+' '+nf(G[k].dehors_par_personne)).join(', ')}">`;
  GK.forEach((k,i)=>{const y=i*rh,m=Math.round(G[k].dehors_par_personne),hot=m>=G.employe.dehors_par_personne-1;
    v+=`<text x="0" y="${y+22}">${GN[k]}</text>`;
    for(let j=0;j<m;j++)v+=`<g class="sun" data-g="${i}" data-j="${j}" style="stroke:var(--hot);fill:var(--hot);stroke-width:1.6;opacity:0">${SUN(156+j*(196/per),y+18,8)}</g>`;
    v+=`<text class="v ${hot?'vh':''}" data-g="${i}" x="${156+m*(196/per)+4}" y="${y+22}" opacity="0">${nf(G[k].dehors_par_personne)} min</text>`;});
  return v+'</svg>';}
/* mesures : minutes en moins, pour la personne suivie et pour la personne qui prend un bus sans clim */
function mesSvg(){const rows=[['Ombrager ses arrêts',P=>P.wait],['Doubler les passages',P=>P.wait/2],['Climatiser les bus',P=>P.noacM]];
  const W=414,rh=52,H=rows.length*rh+30,lx=150,mx=Math.max(1,...rows.flatMap(r=>[r[1](NADIA),r[1](THOMAS)])),sc=(W-lx-80)/mx;
  const tot=P=>P.walk+P.wait+P.noacM;
  let v=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes au soleil ou dans un bus chaud en moins : ${rows.map(r=>r[0].toLowerCase()+' : '+NADIA.name+' '+nf(r[1](NADIA),1)+', '+THOMAS.name+' '+nf(r[1](THOMAS),1)).join(' ; ')}">`;
  v+=`<text x="${lx}" y="12" class="mono">ce matin : ${NADIA.name} ${nf(tot(NADIA))} min · ${THOMAS.name} ${nf(tot(THOMAS))} min</text>`;
  rows.forEach((r,i)=>{const y=i*rh+26;v+=`<text x="0" y="${y+20}">${r[0]}</text>`;
    [[NADIA,'var(--div-pos)',0],[THOMAS,'var(--seq-3)',22]].forEach(([P,c,dy])=>{const m=r[1](P);
      v+=`<rect class="bb" data-w="${(m*sc).toFixed(1)}" x="${lx}" y="${y+dy+2}" width="0" height="15" rx="2" style="fill:${c}"/>`;
      v+=`<text class="v" data-x="${(lx+m*sc+6).toFixed(1)}" x="${lx+6}" y="${y+dy+14}" opacity="0">${m>0.05?'−'+nf(m,1):'0'} min · ${P.name}</text>`;});});
  return v+'</svg>';}
function growBars(t){$$('.sl.on .vis rect.bb').forEach((b,i)=>{const f=ease((t-1.2-i*.15)/1),w=+b.dataset.w*f;b.setAttribute('width',w.toFixed(1));
  const tx=b.nextElementSibling;tx.setAttribute('x',(+b.getAttribute('x')+w+6).toFixed(1));tx.setAttribute('opacity',f>.05?1:0);});}
/* frise de son trajet : orange = dehors, couleur de la ligne = à bord */
const frise=P=>`<span class="fr">${P.seg.map(s=>`<i style="left:${s.t0/P.dur*100}%;width:${(s.t1-s.t0)/P.dur*100}%;background:${s.col||(s.out?'var(--hot)':'var(--ns)')}"></i>`).join('')}<em></em></span>`;

/* personnage qui attend au soleil, dessiné pour l'accroche */
function waiterEl(){const el=document.createElement('div');el.className='waiter';
  el.innerHTML=`<svg viewBox="0 0 120 150" aria-hidden="true">
    <g class="ws">${SUN(88,26,20)}</g>
    <ellipse cx="50" cy="141" rx="26" ry="5" class="wsh"/>
    <rect x="16" y="40" width="5" height="102" rx="2" class="wpole"/><rect x="6" y="30" width="25" height="18" rx="4" class="wsign"/>
    <g transform="translate(26 58) scale(3.6)"><path d="${PERSON}" class="wp"/></g>
    <path d="M70 70q3 5 0 8q-3-3 0-8z" class="wd"/><path d="M78 84q3 5 0 8q-3-3 0-8z" class="wd"/></svg>
    <span class="wt">${nf(TMAX,1)}&nbsp;°C</span>`;return el;}

/* compteur animé */
const count=(el,v,t,t0,dur,dec=0)=>{if(el)el.textContent=nf(v*ease((t-t0)/dur),dec);};

/* =====================================================================
   Écran réel intégré : « Une journée sous canicule »
   ===================================================================== */
const SHOT=$('#shot'), FR=SHOT.querySelector('iframe');
const doc=()=>FR.dataset.ok?FR.contentDocument:null;
const cam=v=>{const c=SHOT.querySelector('.cam');if(c.dataset.v!==v){c.dataset.v=v;c.style.transform=v==='none'?'none':v;}};
function frames(){const near=SL.some((s,i)=>s.dataset.shot&&Math.abs(i-cur)<=1);
  if(near&&!FR.dataset.on){FR.dataset.on=1;delete FR.dataset.ok;FR.onload=()=>{if(FR.src.endsWith('about:blank'))return;FR.dataset.ok=1;};FR.src=FR.dataset.src;}
  else if(!near&&FR.dataset.on){delete FR.dataset.on;delete FR.dataset.ok;FR.src='about:blank';}}
const visible=el=>el&&!el.hidden&&el.offsetParent!==null;
const click=sel=>{const d=doc(),b=d&&d.querySelector(sel);if(b){b.click();return true;}return false;};

/* =====================================================================
   Scènes : enter() à l'arrivée, tick(t) à chaque image (t en secondes depuis l'arrivée)
   ===================================================================== */
let lastAg=0;
const SCN={
  /* 1. le réseau se dessine et chauffe, puis la caméra descend sur l'arrêt où elle attend */
  accroche:{enter(){this.dive=0;fly(IDF_B,{pr:600,pitch:30,bearing:-10,dur:1500,dz:.35});setF('net',['<=',['get','r'],0]);show({net:1,bus:.15,heat:0});
      $('#h-say').innerHTML=`${hm(HOOK.t)}, à <b>${HOOK.P.from}</b>. ${HOOK.P.elle?'Elle':'Il'} attend ${HOOK.mode} en plein soleil.`;
      if(!this.mk)this.mk=new maplibregl.Marker({element:waiterEl(),anchor:'bottom',offset:[22,0]}).setLngLat(HOOK.at).addTo(map);this.mk.getElement().classList.remove('on');},
    leave(){if(this.mk){this.mk.remove();this.mk=null;}},
    tick(t){setF('net',['<=',['get','r'],ease(t/3.2)]);setP('heat','line-opacity',clamp((t-2)/2.5)*.85);
      count($('#h-temp'),TMAX,t,.4,3,1);
      if(!this.dive&&t>5.2){this.dive=1;fly(null,{center:HOOK.at,zoom:15.6,pitch:58,bearing:-28,dur:4200,pr:600,drift:{b:14,t:7}});}
      if(this.mk)this.mk.getElement().classList.toggle('on',t>8.4);}},

  /* 2a. qui reste chez soi : dix bonshommes par groupe ; la ville bouge en fond */
  reste:{enter(){$('#v-ppl').innerHTML=pplSvg();fly(PC_B,{pitch:40,bearing:-20,dz:.15,drift:{b:14,t:13,z:.2}});setF('net',null);show({net:.3,bus:.12,ag:.8});lastAg=0;},
    tick(t){$$('#v-ppl path.pp').forEach(p=>{const on=p.dataset.h==='1'&&t>1.6+(+p.dataset.g)*.35+(+p.dataset.j)*.12;p.style.fill=on?'var(--accent)':'var(--hot)';});
      $$('#v-ppl text.v').forEach(x=>x.setAttribute('opacity',t>2.4+(+x.dataset.g)*.35?1:0));
      const T=27000+clamp(t/13)*3600;$('#clk2').textContent=hm(T);
      if(performance.now()-lastAg<50)return;lastAg=performance.now();setD('ag',fc(agentsAt(T,false).F));}},

  /* 2b. qui passe du temps dehors : un soleil = une minute ; sur la carte, seuls ceux qui sont dehors */
  dehors:{enter(){$('#v-sun').innerHTML=sunSvg();fly(PC_B,{pitch:50,bearing:12,dz:.35,drift:{b:-12,t:14,z:.2}});show({net:.2,ag:1});lastAg=0;},
    tick(t){$$('#v-sun .sun').forEach(s=>{s.style.opacity=t>1.2+(+s.dataset.g)*.4+(+s.dataset.j)*.07?1:0;});
      $$('#v-sun text.v').forEach(x=>x.setAttribute('opacity',t>2.4+(+x.dataset.g)*.4?1:0));
      if(performance.now()-lastAg<50)return;lastAg=performance.now();const A=agentsAt(28800+clamp(t/14)*2700,true);setD('ag',fc(A.F));
      $('#clk3').textContent=nf(A.out*100);}},

  /* 3a. l'écran réel : on passe d'une personne à l'autre, puis la caméra se pose sur la fiche */
  choix:{enter(){show({net:.25});this.i=0;this.back=0;cam('none');},
    tick(t){const d=doc();if(!d)return;
      if(!this.back){this.back=1;if(!visible(d.querySelector('#pick')))click('#other');}
      const seq=['thomas','sophie','karim','julie','nadia'];
      if(this.i<seq.length&&t>2.2+this.i*1.7){click(`#who5 [data-k="${seq[this.i]}"]`);this.i++;}
      cam(t>11?'scale(1.1)':'none');}},

  /* 3b. on lance sa journée : lecture continue, vitesse × 2 */
  suivre:{enter(){show({net:.25});this.go=0;cam('none');},
    tick(t){const d=doc();if(!d)return;
      if(!this.go&&t>1.2){this.go=1;
        if(visible(d.querySelector('#pick'))){click('#who5 [data-k="nadia"]');click('#pstart');}
        const a=d.querySelector('#auto');if(a&&a.getAttribute('aria-pressed')!=='true')a.click();
        const sp=d.querySelector('#speed');if(sp&&sp.textContent.trim()==='× 1')sp.click();}}},

  /* 4a. la personne suivie est un vrai agent de la simulation : son trajet sur les tracés officiels */
  agent:{enter(){const P=NADIA;setD('route',fc(routeOf(P)));setD('trail',fc([]));
      fly(bboxOf(P),{pitch:45,bearing:-12,drift:{b:10,t:18}});show({net:.2,route:.35,trail:1});
      $('#a-card').innerHTML=`<div class="card"><b>${P.name}</b><span class="who">${P.job} (exemple), ${P.from} → ${P.to} · agent ${P.id}</span>${frise(P)}</div>`;
      if(this.mk)this.mk.remove();const el=document.createElement('div');el.className='pm';el.innerHTML=`<i></i><span>${P.name}</span>`;
      this.mk=new maplibregl.Marker({element:el,anchor:'left',offset:[-7,0]}).setLngLat(P.seg[0].g[0]).addTo(map);this.last=0;},
    leave(){if(this.mk){this.mk.remove();this.mk=null;}setD('trail',fc([]));setD('route',fc([]));},
    tick(t){if(!this.mk||performance.now()-this.last<40)return;this.last=performance.now();
      const P=NADIA,T=clamp((t-2.5)/15)*P.dur,st=persAt(P,T);
      this.mk.setLngLat(st.pos);this.mk.getElement().classList.toggle('out',!!st.seg&&st.seg.out);
      $('#a-out').textContent=nf(st.out/60)+' min';const em=$('#a-card em');if(em)em.style.left=clamp(T/P.dur)*100+'%';
      setD('trail',fc(st.trail.length>1?[line(st.trail,{c:css('--tx')})]:[]));}},

  /* 4b. les sources croisées s'allument une à une sur la carte */
  donnees:{enter(){const c=IDF.counts;
      const L=[['Horaires IDFM',nf(c.offre)+' passages'],['Îlots de chaleur',nf(c.icu)+' îlots'],['Lieux frais',nf(c.frais)+' lieux'],['Simulation MATSim',nf(MS.meta.agents)+' voyageurs']];
      $('#srcs').innerHTML=L.map((x,j)=>`<li data-j="${j}"><i></i><span>${x[0]}</span><small>${x[1]}</small></li>`).join('');
      fly([[1.95,48.62],[2.75,49.07]],{pitch:30,bearing:-8,drift:{b:10,z:.3,t:15}});setF('zones',['<=',['get','r'],0]);setP('zones','circle-color',css('--tx3'));
      setD('ag',fc(agentsAt(29400,false).F));show({net:.25,zones:.9});this.s=-1;},
    leave(){setF('zones',null);},
    tick(t){setF('zones',['<=',['get','r'],ease((t-.5)/2.2)]);const s=Math.min(3,Math.floor((t-.8)/2.4));if(s===this.s)return;this.s=s;
      if(s>=1)setP('zones','circle-color',['case',['==',['get','f0'],1],css('--heat-4'),s>=2?['case',['==',['get','f3'],1],css('--heat-2'),css('--ns')]:css('--ns')]);
      if(s>=3)show({net:.25,zones:.55,ag:.95});
      $$('#srcs li').forEach(li=>{const j=+li.dataset.j;li.classList.toggle('lit',j<=s);li.classList.toggle('cur',j===s);});}},

  /* 5. où agir : ses arrêts d'attente passent au vert quand on les ombrage ; les arrêts très exposés de la région en fond */
  impacts:{enter(){const P=NADIA;$('#v-mes').innerHTML=mesSvg();setD('route',fc(routeOf(P)));
      setD('stops',fc(P.seg.filter(s=>s.k==='wait'&&s.out).map(s=>pt(s.a,{c:css('--hot')}))));
      setF('zones',['>=',['get','n'],3]);setP('zones','circle-color',css('--hot'));
      fly(bboxOf(P),{pitch:40,bearing:8,dz:-.6,drift:{b:-8,t:16}});show({net:.25,route:.9,stops:1,zones:.5});this.g=0;},
    leave(){setF('zones',null);setD('stops',fc([]));setD('route',fc([]));},
    tick(t){growBars(t);if(!this.g&&t>2.4){this.g=1;setD('stops',fc(NADIA.seg.filter(s=>s.k==='wait'&&s.out).map(s=>pt(s.a,{c:css('--ok')}))));}}},

  /* 6. la suite : toute la région, ses arrêts très exposés */
  suite:{enter(){$('#hotn2').textContent=nf(HOT);fly(IDF_B,{pr:600,pitch:40,bearing:12,dz:.25,drift:{b:-14,t:13,z:.15}});setF('net',null);setF('zones',['>=',['get','n'],3]);
      setP('zones','circle-color',css('--hot'));show({net:1,bus:.2,zones:.9});},
    leave(){setF('zones',null);}},
};

/* =====================================================================
   Déroulé
   ===================================================================== */
const SL=$$('.sl');let cur=-1,t0=0,auto=false;
$('#prog').innerHTML=SL.map((s,i)=>`<button class="${i&&s.dataset.t!==SL[i-1].dataset.t?'nt':''}" aria-label="Diapositive ${i+1}, temps ${s.dataset.t} : ${s.getAttribute('aria-label')}"><i></i></button>`).join('');
const PB=$$('#prog button');PB.forEach((b,i)=>b.onclick=()=>go(i));
function go(i){i=clamp(i,0,SL.length-1);if(i===cur)return;
  if(cur>=0){const o=SCN[SL[cur].dataset.scene];SL[cur].classList.remove('on');if(o.leave)o.leave();}
  cur=i;const s=SL[i],sc=SCN[s.dataset.scene];
  document.body.classList.toggle('dim',!!s.dataset.dim);document.body.classList.toggle('shot-on',!!s.dataset.shot);
  void s.offsetWidth;s.classList.add('on');t0=performance.now();
  frames();sc.enter.call(sc);
  PB.forEach((b,j)=>{b.firstChild.style.width=j<i?'100%':'0';b.toggleAttribute('aria-current',j===i);});
  $('#tps').textContent=`${s.dataset.t} · ${s.dataset.tn}`;
  $('#num').textContent=`${i+1} / ${SL.length}`;
  history.replaceState(null,'','#'+(i+1));}
function loop(){requestAnimationFrame(loop);if(cur<0)return;const s=SL[cur],sc=SCN[s.dataset.scene],t=(performance.now()-t0)/1000,dur=+s.dataset.dur||10;
  if(sc.tick)try{sc.tick.call(sc,RM?99:t,s);}catch(e){console.error(e);}
  PB[cur].firstChild.style.width=(clamp(t/dur)*100).toFixed(1)+'%';
  if(auto&&t>=dur){if(cur<SL.length-1)go(cur+1);else setAuto(false);}}
function setAuto(v){auto=v;$('#play').setAttribute('aria-pressed',String(v));}

$('#play').onclick=()=>setAuto(!auto);
$('#theme').onclick=toggleTheme;
function toggleTheme(){const t=isDark()?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem(THK,t);}catch(e){}themeLabel();
  ready=false;map.setStyle(STYLE(isDark()),{diff:false});
  if(FR.dataset.on){delete FR.dataset.ok;FR.src=FR.dataset.src;}}
addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey)return;const k=e.key;
  if(k==='ArrowRight'||k==='PageDown'||k==='Enter'||k==='ArrowDown'){e.preventDefault();go(cur+1);}
  else if(k==='ArrowLeft'||k==='PageUp'||k==='ArrowUp'){e.preventDefault();go(cur-1);}
  else if(k==='Home'){e.preventDefault();go(0);}else if(k==='End'){e.preventDefault();go(SL.length-1);}
  else if(k===' '){e.preventDefault();setAuto(!auto);}
  else if(k==='t'||k==='T')toggleTheme();
  else if(k==='f'||k==='F'){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(()=>{});}});
addEventListener('resize',()=>{fit();map.resize();});
/* l'écran intégré garde le focus du clavier : on le rend à la présentation */
addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement&&document.activeElement.tagName==='IFRAME')document.activeElement.blur();window.focus();},0));

themeLabel();
const h=parseInt(location.hash.slice(1),10);
if(new URLSearchParams(location.search).get('auto')==='1')setAuto(true);
go(isFinite(h)?h-1:0);loop();
window.__pitch={go,map,get cur(){return cur;},SCN,setAuto,seek:s=>{t0=performance.now()-s*1000;}};
})();
