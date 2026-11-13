/* Écran « Simulation » : animation MATSim (scripts/14_matsim_anim.py) et résultats agrégés (scripts/13_matsim_analysis.py),
   sur les vraies sorties de web/data. Habillage du design system Papier. */
const {$,RM,wait,css}=UI;
const DATA='../../web/data/';
const M=window.MATSIM, SLAT=window.IDF.cols.lat, SLON=window.IDF.cols.lon;
const ANIM={canicule:window.MSANIM_CANICULE,ordinaire:null};
const nf=(v,d=0)=>v==null||isNaN(v)?'–':Number(v).toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d}).replace(/\u202f/g,'\u00a0');
const pct=(a,b)=>{const v=100*(a/b-1);return (v>=0?'+':'−')+nf(Math.abs(v),0)+' %';};
const hm=t=>String(Math.floor(t/3600)).padStart(2,'0')+' h '+String(Math.floor(t%3600/60)).padStart(2,'0');
const loadScript=src=>new Promise(res=>{const s=document.createElement('script');s.src=src;s.onload=()=>res(true);s.onerror=()=>res(false);document.head.appendChild(s);});

/* ---------- couleurs : modes de transport et état des voyageurs ---------- */
const VC=[css('--m-rer'),css('--m-metro'),css('--m-tram'),'#4a93e0',css('--m-bus-noclim'),'#8792a0'];
const VL=['RER, train','métro','tram','bus climatisé','bus non climatisé','câble'];
const C_WAIT=css('--heat-4'), C_WALK='#8a96a3', C_BIKE=css('--ok'), C_NOAC=css('--alert');
const SAMPLE=['#FFCD00','#003CA6','#E2231A','#00814F','#6E6E00','#F28E42','#8D5E2A'];

/* ---------- carte et couche animée ---------- */
const VIEW=[[48.70,2.10],[49.02,2.62]];
/* tablette et téléphone : la note posée en haut de la carte ne cache pas la zone simulée */
const viewPad=()=>{const n=UI.compact()&&document.querySelector('#wmap .mnote');return n?{paddingTopLeft:[8,n.offsetHeight+16],paddingBottomRight:[8,8]}:{padding:[8,8]};};
const map=L.map('map',{zoomControl:false,attributionControl:false,zoomSnap:.25,zoomDelta:.5}).fitBounds(VIEW,viewPad());
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:17}).addTo(map);
L.control.attribution({prefix:false}).addAttribution('© contributeurs OpenStreetMap').addTo(map);
const Anim=L.Layer.extend({
  onAdd(m){this._m=m;const c=this._c=L.DomUtil.create('canvas','leaflet-zoom-hide');m.getPanes().overlayPane.appendChild(c);m.on('moveend zoomend resize',this._reset,this);this._reset();},
  onRemove(m){L.DomUtil.remove(this._c);m.off('moveend zoomend resize',this._reset,this);},
  _reset(){const s=this._m.getSize(),tl=this._m.containerPointToLayerPoint([0,0]);L.DomUtil.setPosition(this._c,tl);this._c.width=s.x;this._c.height=s.y;draw();}
});
const layer=new Anim();
const st={day:'canicule',t:28800,play:false,noac:false,view:'agents'};
function vpos(v,t){const P=v[1],n=P.length/3;if(t<P[0]||t>P[(n-1)*3])return null;let lo=0,hi=n-1;
  while(hi-lo>1){const m=(lo+hi)>>1;if(P[m*3]<=t)lo=m;else hi=m;}
  const t0=P[lo*3],t1=P[hi*3],f=t1>t0?(t-t0)/(t1-t0):0,z0=P[lo*3+1],z1=P[hi*3+1];
  return [SLAT[z0]+(SLAT[z1]-SLAT[z0])*f,SLON[z0]+(SLON[z1]-SLON[z0])*f,P[lo*3+2]];}
let live={nv:0,wait:0,walk:0,noac:0,fmax:0,top:[]};
const WIN=300;   /* demi-fenêtre glissante : ±5 min */
const SAJ=window.IDF.cols.aj, SCOM=window.IDF.cols.c;
/* ---------- préparation des flux (tronçons entre arrêts) ---------- */
function prep(D){
  if(D._segs)return;
  const segs=[],base=new Set();
  for(const v of D.veh){const P=v[1],n=P.length/3,c=v.length>2?v[2]:-1;
    for(let i=0;i<n-1;i++){const z0=P[i*3+1],z1=P[i*3+4];if(z0===z1)continue;
      segs.push([P[i*3],P[i*3+3],z0,z1,P[i*3+2],c,v[0]]);base.add(z0<z1?z0*65536+z1:z1*65536+z0);}}
  const bk=new Map();for(const sg of segs){const b=Math.floor(sg[0]/60);if(!bk.has(b))bk.set(b,[]);bk.get(b).push(sg);}
  D._segs=segs;D._bk=bk;D._base=[...base];
}
/* ---------- préparation de l'exposition : chaque moment passé dehors, pondéré par l'aléa du lieu, dans un hexagone de 1 km ---------- */
const KX=73.3,KY=111.32,HR=.6;              /* km par degré ; rayon des hexagones : 0,6 km */
const HW=Math.sqrt(3)*HR,HV=1.5*HR;
function hexOf(lon,lat){                    /* hexagone (pointe en haut) contenant le point */
  const x=lon*KX,y=lat*KY,r=Math.round(y/HV),q=Math.round((x-(r&1)*HW/2)/HW);
  let best=null;for(const dr of[-1,0,1])for(const dq of[-1,0,1]){const rr=r+dr,qq=q+dq,cx=qq*HW+(rr&1)*HW/2,cy=rr*HV,d=(x-cx)**2+(y-cy)**2;if(!best||d<best.d)best={d,k:rr*100000+qq,cx,cy};}
  return best;
}
let STOPGRID=null;
function nearStop(lon,lat){
  if(!STOPGRID){STOPGRID=new Map();for(let k=0;k<SLAT.length;k++){const g=Math.floor(SLON[k]/.005)+'_'+Math.floor(SLAT[k]/.005);if(!STOPGRID.has(g))STOPGRID.set(g,[]);STOPGRID.get(g).push(k);}}
  const gx=Math.floor(lon/.005),gy=Math.floor(lat/.005);let best=-1,bd=1e9;
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const L_=STOPGRID.get((gx+a)+'_'+(gy+b));if(!L_)continue;
    for(const k of L_){const d=((SLON[k]-lon)*KX)**2+((SLAT[k]-lat)*KY)**2;if(d<bd){bd=d;best=k;}}}
  return bd<.25?best:-1;                     /* arrêt à moins de 500 m */
}
const HEX=new Map();
function prepExpo(D){
  if(D._ex)return;
  const ex=[];
  for(const l of D.legs){const [m,d,du,w,x0,y0,x1,y1]=l;let t0,t1,lon,lat;
    if(m>=2){if(!w)continue;t0=d;t1=d+w;lon=x0;lat=y0;}            /* attente en surface */
    else{if(!du)continue;t0=d;t1=d+du;lon=(x0+x1)/2;lat=(y0+y1)/2;} /* marche ou vélo */
    const k=nearStop(lon,lat),aj=k>=0&&SAJ[k]!=null?SAJ[k]:8,h=hexOf(lon,lat);
    if(!HEX.has(h.k))HEX.set(h.k,{lat:h.cy/KY,lon:h.cx/KX,noms:{}});
    if(k>=0){const nm=SCOM[k];const H=HEX.get(h.k);H.noms[nm]=(H.noms[nm]||0)+1;}
    ex.push([t0,t1,h.k,aj/10]);}
  D._ex=ex;
}
function expoAt(D,t){
  const agg=new Map();
  for(const e of D._ex){const a=Math.max(e[0],t-WIN),b=Math.min(e[1],t+WIN);if(b<=a)continue;agg.set(e[2],(agg.get(e[2])||0)+(b-a)/60*e[3]);}
  return agg;
}
let BREAKS=null;   /* seuils fixes, calculés sur la journée de canicule, pour comparer les deux journées */
function breaks(){
  if(BREAKS)return BREAKS;const D=ANIM.canicule;prepExpo(D);const v=[];
  for(let t=25200;t<=32400;t+=900)for(const x of expoAt(D,t).values())if(x>0)v.push(x);
  v.sort((a,b)=>a-b);const q=f=>v[Math.floor(f*(v.length-1))];
  return BREAKS=[q(.5),q(.75),q(.9),q(.97)];
}
const HEATC=[1,2,3,4,5].map(i=>css('--heat-'+i));
const MODEC=['#6574b6','#b89755','#529889','#7d8b9a','#7d8b9a','#8792a0'];   /* RER, métro, tram, bus, bus, câble */
let PX=null;
const sp=z=>{let q=PX[z];if(!q){q=map.latLngToContainerPoint([SLAT[z],SLON[z]]);PX[z]=q;}return q;};
map.on('movestart zoomstart',()=>{PX=null;});
const LBLS=L.layerGroup().addTo(map);
/* ---------- cartes de chaleur : densité lissée des voyageurs (noyau gaussien approché par flous successifs) ---------- */
const CELL=4,KR=3;   /* pixels par cellule ; rayon du lissage en cellules */
function grid(pts,W,H){
  const gw=Math.ceil(W/CELL),gh=Math.ceil(H/CELL),a=new Float32Array(gw*gh);
  for(const p of pts){const x=Math.floor(p[0]/CELL),y=Math.floor(p[1]/CELL);if(x>=0&&y>=0&&x<gw&&y<gh)a[y*gw+x]+=p[2]||1;}
  const b=new Float32Array(a.length);
  for(let pass=0;pass<3;pass++){                       /* trois flous en boîte ≈ gaussienne */
    for(let y=0;y<gh;y++){let acc=0;for(let x=-KR;x<gw+KR;x++){if(x+KR<gw)acc+=a[y*gw+x+KR];if(x-KR-1>=0)acc-=a[y*gw+x-KR-1];if(x>=0&&x<gw)b[y*gw+x]=acc/(2*KR+1);}}
    for(let x=0;x<gw;x++){let acc=0;for(let y=-KR;y<gh+KR;y++){if(y+KR<gh)acc+=b[(y+KR)*gw+x];if(y-KR-1>=0)acc-=b[(y-KR-1)*gw+x];if(y>=0&&y<gh)a[y*gw+x]=acc/(2*KR+1);}}
  }
  return {a,gw,gh};
}
const hex2rgb=h=>{h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];};
const RAMP_HEAT=['#fde9c9','#f9b672','#ec7340','#c23a22','#7a1414'].map(hex2rgb);
const RAMP_RED=['#f6c9c2','#e58f80','#d5584b','#c52625','#8e1414'].map(hex2rgb);
const BLUE=hex2rgb('#1972d2'),RED=hex2rgb('#c52625');
const lerpRamp=(R,f)=>{f=Math.max(0,Math.min(1,f))*(R.length-1);const i=Math.min(R.length-2,Math.floor(f)),u=f-i;return R[i].map((v,k)=>v+(R[i+1][k]-v)*u);};
const OFF=document.createElement('canvas');
function paint(g,G,col){   /* col(v) -> [r,g,b,a] ou null */
  OFF.width=G.gw;OFF.height=G.gh;const o=OFF.getContext('2d'),im=o.createImageData(G.gw,G.gh),D=im.data;
  for(let i=0;i<G.a.length;i++){const c=col(G.a[i]);if(!c)continue;D[i*4]=c[0];D[i*4+1]=c[1];D[i*4+2]=c[2];D[i*4+3]=c[3];}
  o.putImageData(im,0,0);g.save();g.globalAlpha=1;g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(OFF,0,0,G.gw*CELL,G.gh*CELL);g.restore();
}
function outPts(D,t,noac){   /* voyageurs dehors (ou dans un bus non climatisé) à l'instant t, en pixels */
  const pts=[];
  for(const l of D.legs){const [m,d,du,w,x0,y0,x1,y1]=l;if(t<d||t>d+du)continue;let lat,lon;
    if(noac){if(m!==6||t<d+w)continue;const f=du-w>0?(t-d-w)/(du-w):0;lat=y0+(y1-y0)*f;lon=x0+(x1-x0)*f;}
    else if(m>=2){if(t>=d+w)continue;lat=y0;lon=x0;}
    else{const f=du?(t-d)/du:0;lat=y0+(y1-y0)*f;lon=x0+(x1-x0)*f;}
    const q=map.latLngToContainerPoint([lat,lon]);pts.push([q.x,q.y,1]);}
  return pts;
}
let REF={};   /* niveau de référence par vue et par zoom : vigilance rouge à 8 h, 99e centile */
function ref(key,make){const k=key+'|'+map.getZoom().toFixed(2)+'|'+layer._c.width;if(REF[k])return REF[k];
  const G=make(),v=[];for(const x of G.a)if(x>0)v.push(Math.abs(x));v.sort((a,b)=>a-b);return REF[k]=v.length?v[Math.floor(.99*(v.length-1))]:1;}
/* ---------- vue Différence : voyageurs dehors (attente en surface, marche, vélo), canicule moins ordinaire ---------- */
function prepOut(D){
  if(D._out)return;const ex=[];
  for(const l of D.legs){const [m,d,du,w,x0,y0,x1,y1]=l;let t0,t1,lon,lat;
    if(m>=2){if(!w)continue;t0=d;t1=d+w;lon=x0;lat=y0;}else{if(!du)continue;t0=d;t1=d+du;lon=(x0+x1)/2;lat=(y0+y1)/2;}
    const h=hexOf(lon,lat);
    if(!HEX.has(h.k))HEX.set(h.k,{lat:h.cy/KY,lon:h.cx/KX,noms:{}});
    const k=nearStop(lon,lat);if(k>=0){const H=HEX.get(h.k),nm=SCOM[k];H.noms[nm]=(H.noms[nm]||0)+1;}
    ex.push([t0,t1,h.k]);}
  D._out=ex;
}
function outAt(D,t){const agg=new Map();for(const e of D._out){const a=Math.max(e[0],t-WIN),b=Math.min(e[1],t+WIN);if(b>a)agg.set(e[2],(agg.get(e[2])||0)+(b-a)/60);}return agg;}
function diffAt(t){
  const A=outAt(ANIM.ordinaire,t),B=outAt(ANIM.canicule,t),dd=new Map();
  for(const k of new Set([...A.keys(),...B.keys()]))dd.set(k,(B.get(k)||0)-(A.get(k)||0));
  return dd;
}
let DBR=null;   /* seuils symétriques, fixes sur toute la matinée */
function dbreaks(){
  if(DBR)return DBR;const v=[];
  for(let t=25200;t<=32400;t+=900)for(const x of diffAt(t).values())if(x)v.push(Math.abs(x));
  v.sort((a,b)=>a-b);const q=f=>v[Math.floor(f*(v.length-1))];return DBR=[q(.5),q(.85)];
}
const DIVC5=[css('--div-pos'),css('--div-p2'),null,css('--div-n2'),css('--div-neg')];
const nameOf=h=>{const n=Object.entries(h.noms).sort((a,b)=>b[1]-a[1])[0];return n?n[0].replace(' Arrondissement',''):null;};
function draw(){
  const c=layer._c;if(!c)return;const g=c.getContext('2d'),D=ANIM[st.day],t=st.t;g.clearRect(0,0,c.width,c.height);
  if(!D)return;prep(D);PX=PX||[];
  const W=c.width,H=c.height,out=q=>q.x<-40||q.y<-40||q.x>W+40||q.y>H+40;
  /* réseau en fond, très léger */
  g.globalAlpha=.5;g.strokeStyle='#c4cbd4';g.lineWidth=.6;g.beginPath();
  for(const k of D._base){const a=sp(Math.floor(k/65536)),b=sp(k%65536);if(out(a)&&out(b))continue;g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);}
  g.stroke();
  let changes=[];
  if(st.view==='diff'&&ANIM.ordinaire&&ANIM.canicule){
    prepOut(ANIM.ordinaire);prepOut(ANIM.canicule);const dd=diffAt(t),br=dbreaks(),sc=8/Math.sqrt(br[1]*3);
    const cs=[...dd.entries()].filter(([k,v])=>Math.abs(v)>=br[0]*1.4).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
    for(const [k,v] of cs.reverse()){const h=HEX.get(k),q=map.latLngToContainerPoint([h.lat,h.lon]);if(out(q))continue;
      const r=Math.min(14,1.5+Math.sqrt(Math.abs(v))*sc);g.globalAlpha=.8;g.fillStyle=v<0?css('--div-pos'):css('--div-neg');
      g.beginPath();g.arc(q.x,q.y,r,0,6.283);g.fill();g.globalAlpha=1;g.strokeStyle='#fff';g.lineWidth=.8;g.stroke();}
    const all=[...dd.entries()].map(([k,v])=>({k,v,h:HEX.get(k)}));
    const dn=all.filter(x=>x.v<0).sort((a,b)=>a.v-b.v),up=all.filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
    changes={dn,up};
  }else{
    /* vue Agents : chaque voyageur simulé ; regroupés en un cercle quand ils sont plusieurs au même endroit (cellules de 10 px) */
    const CEL=10,bins=new Map();
    for(const l of D.legs){const [m,d,du,w,x0,y0,x1,y1]=l;if(t<d||t>d+du)continue;let lat,lon,cat;
      if(m>=2&&t<d+w){lat=y0;lon=x0;cat=0;}                                             /* attend dehors */
      else if(m>=2){const f=du-w>0?(t-d-w)/(du-w):0;lat=y0+(y1-y0)*f;lon=x0+(x1-x0)*f;cat=st.noac&&m===6?4:3;}  /* à bord */
      else{const f=du?(t-d)/du:0;lat=y0+(y1-y0)*f;lon=x0+(x1-x0)*f;cat=m===1?2:1;}       /* vélo ou marche */
      const q=map.latLngToContainerPoint([lat,lon]);if(out(q))continue;
      const k=cat+'_'+Math.floor(q.x/CEL)+'_'+Math.floor(q.y/CEL),e=bins.get(k);
      if(e){e.n++;e.x+=q.x;e.y+=q.y;}else bins.set(k,{cat,n:1,x:q.x,y:q.y});}
    const COL=[C_WAIT,C_WALK,C_BIKE,'#8a96a6',C_NOAC],ALP=st.noac?[.35,.25,.25,.18,.95]:[.9,.6,.75,.4,.95];
    const order=st.noac?[3,1,2,0,4]:[3,1,2,4,0];
    for(const cat of order){g.fillStyle=COL[cat];
      for(const e of bins.values()){if(e.cat!==cat)continue;const r=e.n===1?(cat===0||cat===4?1.8:1.3):Math.min(11,1.6+Math.sqrt(e.n)*1.5);
        g.globalAlpha=ALP[cat];g.beginPath();g.arc(e.x/e.n,e.y/e.n,r,0,6.283);g.fill();
        if(e.n>=4&&(cat===0||cat===4)){g.globalAlpha=.9;g.strokeStyle='#fff';g.lineWidth=.7;g.stroke();}}}
  }
  /* compteurs à l'instant t */
  let nv=0,noac=0;for(const v of D.veh){const p=vpos(v,t);if(!p)continue;nv++;if(v[0]===4)noac+=p[2];}
  let wt=0,wk=0;for(const l of D.legs){if(t<l[1]||t>l[1]+l[2])continue;if(l[0]>=2&&t<l[1]+l[3])wt++;else if(l[0]<2)wk++;}
  g.globalAlpha=1;live={nv,wait:wt,walk:wk,noac,changes};
  labelsDiff(st.view==='diff'?changes:null);
  $('#sclock').textContent=hm(t);liveBand();cursor();
}
/* largeur réelle d'une étiquette : capitales espacées de 0,06 em, marges et filet compris */
const LBC=document.createElement('canvas').getContext('2d');
const lblW=nm=>{const fs=UI.compact()?12:11.5;LBC.font=`700 ${fs}px ${getComputedStyle(document.body).fontFamily}`;const t=nm.toUpperCase();return LBC.measureText(t).width+.06*fs*t.length+16;};
/* plus fortes baisses et hausses, nommées sur la carte (sans chevauchement) */
let lastSig='',NAMED={dn:[],up:[]};
function labelsDiff(ch){
  const sig=ch?ch.dn.slice(0,4).map(x=>x.k).join(',')+'/'+ch.up.slice(0,3).map(x=>x.k).join(',')+'|'+map.getZoom()+'|'+map.getSize().x+'|'+map.getCenter().lng.toFixed(3):'none';
  if(sig===lastSig)return;lastSig=sig;LBLS.clearLayers();NAMED={dn:[],up:[]};if(!ch)return;
  const placed=[];
  const put=(list,kind,n)=>{for(const x of list){if(NAMED[kind].length>=n)break;const nm=nameOf(x.h);if(!nm||NAMED.dn.includes(nm)||NAMED.up.includes(nm))continue;
    const q=map.latLngToContainerPoint([x.h.lat,x.h.lon]),w=lblW(nm),MS=map.getSize();
    /* près d'un bord, l’étiquette (centrée sur son point, 18 px de haut) est décalée vers l’intérieur, au-dessus de l’attribution, pour ne jamais être coupée */
    const dx=Math.max(4+w/2-q.x,Math.min(0,MS.x-4-w/2-q.x)),dy=Math.max(13-q.y,Math.min(0,MS.y-31-q.y)),wc=UI.compact()?w:nm.length*7.4+10,b={l:q.x+dx-wc/2,r:q.x+dx+wc/2,t:q.y+dy-24,b:q.y+dy-8};
    if(placed.some(p=>b.l<p.r+4&&b.r>p.l-4&&b.t<p.b+2&&b.b>p.t-2))continue;placed.push(b);NAMED[kind].push(nm);
    LBLS.addLayer(L.marker([x.h.lat,x.h.lon],{icon:L.divIcon({className:'clbl caps '+(kind==='dn'?'dn':'up'),html:`<span${dx||dy?` style="margin-left:${Math.round(dx)}px;margin-top:${Math.round(dy)}px"`:''}>${nm}</span>`,iconSize:null}),interactive:false,keyboard:false}));}};
  put(ch.dn,'dn',2);put(ch.up,'up',2);
}
layer.addTo(map);

/* ---------- bandeau sous la carte : légende et compteurs en direct ---------- */
function liveBand(){
  const k=100;
  const sz=n=>(Math.min(11,1.6+Math.sqrt(n)*1.5)*2).toFixed(1);
  const ag=`<div><h4>Voyageurs simulés à l’instant affiché · regroupés quand ils sont proches</h4><div class="sw"><span><i class="dot" style="background:${C_WAIT}"></i>attend dehors</span><span><i class="dot" style="background:${C_WALK};opacity:.6"></i>marche</span><span><i class="dot" style="background:${C_BIKE}"></i>vélo</span><span><i class="dot" style="background:#8a96a6;opacity:.6"></i>à bord</span>${st.noac?'<span><i class="dot" style="background:'+C_NOAC+'"></i>dans un bus non climatisé</span>':''}</div>
    <div class="sw sizes">${[1,5,20].map(n=>`<span><i class="dot" style="width:${sz(n)}px;height:${sz(n)}px;background:${C_WAIT}"></i>${nf(n*100)}</span>`).join('')}<span class="hint">voyageurs par cercle</span></div></div>`;
  const df=`<div><h4>Voyageurs dehors sur 10 min · vigilance rouge par rapport à une journée ordinaire</h4><div class="sw"><span><i class="dot" style="background:${css('--div-pos')}"></i>moins dehors</span><span><i class="dot" style="background:${css('--div-neg')}"></i>plus dehors</span><span class="hint">un cercle par hexagone de 1 km, taille selon l’écart</span></div>
    <p class="hint">Attente en surface, marche et vélo, sur 10 minutes autour de l’heure affichée.</p></div>`;
  const mk=$('#mkey');
  if(mk)mk.innerHTML=st.view==='diff'?`<span><i style="background:${css('--div-pos')}"></i>moins dehors qu’un jour ordinaire</span><span><i style="background:${css('--div-neg')}"></i>plus dehors</span>`
    :`<span><i style="background:${C_WAIT}"></i>attend dehors</span><span><i style="background:${C_WALK}"></i>marche</span><span><i style="background:${C_BIKE}"></i>vélo</span><span><i style="background:#8a96a6"></i>à bord</span>${st.noac?`<span><i style="background:${C_NOAC}"></i>bus non climatisé</span>`:''}`;
  $('#live').innerHTML=(st.view==='diff'?df:ag)+`
   <div class="cnt"><h4>À ${hm(st.t)}</h4>
    ${st.view==='diff'&&(NAMED.dn.length||NAMED.up.length)?`<p class="tops">${NAMED.dn.length?'Plus forte baisse : <b class="dn">'+NAMED.dn.join(', ')+'</b>':''}${NAMED.up.length?'<br>Hausse : <b class="up">'+NAMED.up.join(', ')+'</b>':''}</p>`:''}<p><b>${nf(live.wait*k)}</b> voyageurs attendent dehors</p><p><b>${nf(live.noac*k)}</b> dans des bus non climatisés</p><p><b>${nf(live.nv)}</b> véhicules en circulation</p></div>`;
}

/* ---------- commandes ---------- */
async function setDay(d){
  if(!ANIM[d]){await loadScript(DATA+`msanim_${d}.js`);ANIM[d]=window['MSANIM_'+d.toUpperCase()];}
  st.day=d;$('#sday').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.s===d)));draw();
}
function setTime(t){st.t=Math.max(23400,Math.min(34200,t));$('#stime').value=st.t;draw();}
let raf=null,last=0;
function play(on){
  st.play=on;const b=$('#splay');b.setAttribute('aria-pressed',String(on));b.querySelector('span').textContent=on?'Pause':'Lecture';
  b.querySelector('svg').innerHTML=on?'<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>':'<path d="M7 5v14l11-7z"/>';
  cancelAnimationFrame(raf);
  if(on){if(st.t>=34200)st.t=23400;last=performance.now();
    const step=now=>{const dt=Math.min(100,now-last);last=now;st.t+=dt*.4*(RM?0:1)+(RM?60:0);
      if(st.t>=34200){setTime(34200);play(false);return;}setTime(st.t);raf=requestAnimationFrame(step);};
    raf=requestAnimationFrame(step);}
}
$('#sday').querySelectorAll('button').forEach(b=>b.onclick=()=>setDay(b.dataset.s));
$('#splay').onclick=()=>play(!st.play);
async function setView(v){st.view=v;$('#sview').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===v)));
  $('#sday').querySelectorAll('button').forEach(b=>b.disabled=v==='diff');if(v==='diff'){for(const d of ['ordinaire','canicule'])if(!ANIM[d]){await loadScript(DATA+`msanim_${d}.js`);ANIM[d]=window['MSANIM_'+d.toUpperCase()];}}lastSig='';draw();}
$('#sview').querySelectorAll('button').forEach(b=>b.onclick=()=>setView(b.dataset.v));
function setNoac(on){st.noac=!!on;$('#snoac').setAttribute('aria-pressed',String(st.noac));draw();}
$('#snoac').onclick=()=>setNoac(!st.noac);
$('#stime').oninput=e=>{play(false);setTime(+e.target.value);};
const z0=map.getZoom();
/* recadrage sur la zone simulée ; un zoom ou un déplacement demandé (doigt, boutons, guide) est respecté jusqu'à « Recentrer » */
let selfMove=0,userView=false;
function refit(){selfMove++;try{map.invalidateSize({pan:false});map.fitBounds(VIEW,Object.assign(viewPad(),{animate:false}));}finally{selfMove--;}userView=false;}
map.on('movestart zoomstart',()=>{if(!selfMove)userView=true;});
{let lw=0,lh=0;new ResizeObserver(()=>{const el=$('#map'),w=el.offsetWidth,h=el.offsetHeight;if(!w||!h||(w===lw&&h===lh))return;lw=w;lh=h;
  if(userView){selfMove++;try{map.invalidateSize({pan:false});}finally{selfMove--;}}else refit();}).observe($('#map'));}
map.on('zoomend',()=>{$('#zlab').textContent=nf(100*Math.pow(2,map.getZoom()-z0))+' %';});
$('#zin').onclick=()=>map.zoomIn();$('#zout').onclick=()=>map.zoomOut();$('#zfit').onclick=refit;

/* ---------- histogramme des départs (quarts d'heure à partir de 5 h) ---------- */
const H0=M.hist.o,H1=M.hist.c,HN=H0.length,HMAX=Math.max(...H0,...H1);
function hist(){
  const el=$('#hist'),W=Math.max(300,el.clientWidth||420),H=UI.compact()&&$('#wres').classList.contains('max')?Math.max(92,el.clientHeight||92):92,x0=4,x1=W-4,y1=H-16,bw=(x1-x0)/HN;
  el.setAttribute('viewBox',`0 0 ${W} ${H}`);
  let s=`<line x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}" style="stroke:var(--line2)"/>`;
  for(let i=0;i<HN;i++){const x=x0+i*bw,h0=(y1-6)*H0[i]/HMAX,h1=(y1-6)*H1[i]/HMAX;
    s+=`<rect x="${x+1}" y="${y1-h0}" width="${bw/2-1}" height="${h0}" style="fill:var(--ns)"/><rect x="${x+bw/2}" y="${y1-h1}" width="${bw/2-1}" height="${h1}" style="fill:var(--heat-4)"/>`;
    if(i%4===0)s+=`<text x="${x}" y="${H-3}" font-size="${UI.compact()?12:10}" style="fill:var(--tx3)" font-family="IBM Plex Mono">${5+i/4} h</text>`;}
  s+=`<rect class="win6" x="${x0+(1.5*4)*bw}" y="2" width="${12*bw}" height="${y1-2}" style="fill:var(--accent)" opacity=".06"/><line id="hcur" y1="2" y2="${y1}" style="stroke:var(--accent)" stroke-width="1.5"/>`;
  el.innerHTML=s;cursor();
}
function cursor(){const l=document.getElementById('hcur'),el=$('#hist');if(!l||!el.viewBox.baseVal)return;
  const W=el.viewBox.baseVal.width,x=4+(st.t/3600-5)*4*((W-8)/HN);l.setAttribute('x1',x);l.setAttribute('x2',x);}

/* ---------- chiffres clés, récit et limites (calculés à partir de matsim.js) ---------- */
const SO=M.scen.ordinaire,SC=M.scen.canicule,T=M.tele;
$('#kpis').innerHTML=[
  [pct(SC.commuters,SO.commuters),'navetteurs en transport en commun'],
  [`${nf(T.cadre.o)} → ${nf(T.cadre.c)} %`,'cadres en télétravail'],
  [`${nf(T.essentiel.o)} → ${nf(T.essentiel.c)} %`,'employés et ouvriers en télétravail']].map(([v,l])=>`<div><b>${v}</b><span>${l}</span></div>`).join('');
$('#sread').innerHTML=`Sous la vigilance rouge, <b>${nf(100*(1-SC.commuters/SO.commuters))} % des navetteurs renoncent</b> au transport en commun, surtout en télétravail. Les cadres le peuvent (${nf(T.cadre.c)} %), bien plus que les employés et ouvriers (${nf(T.essentiel.c)} %) : ceux qui restent dehors sont d’abord ceux qui n’ont pas le choix.`;
$('#n-ag').textContent=nf(M.meta.agents)+' navetteurs, 1 %';
const G=M.group_idx,O=M.observed,e=v=>(v>=100?'+':'−')+nf(Math.abs(v-100))+' %';
$('#lim').innerHTML=`<li>Le <b>ferré</b> est bien reproduit : ${e(G['ferré'])} simulé contre ${e(O['ferré'])} observé pendant la semaine rouge.</li>
  <li>Les <b>bus</b> ne le sont pas encore : ${e(G['bus climatisés'])} simulé contre ${e(O['bus climatisés'])} observé pour les bus climatisés, ${e(G['bus non climatisés'])} contre ${e(O['bus non climatisés'])} pour les non climatisés. Les niveaux absolus des bus sont à lire avec prudence.</li>
  <li>Seuls les trajets domicile-travail de 1 % des navetteurs sont simulés ; les effectifs sont multipliés par 100.</li>`;

hist();setTime(st.t);
UI.onResize(()=>{if(userView)map.invalidateSize();else refit();hist();});

/* organigramme de méthode */
const FL=UI.flow('dia',[['s-pop','p-plan'],['s-gtfs','p-plan'],['s-met','p-sim'],['p-plan','p-sim','v'],['p-sim','p-ev','v']]);
UI.onReset(()=>FL.lit(null));
UI.onReset(()=>{if(userView)refit();});

/* ---------- guide ---------- */
const CIBLES={carte:'#wmap .mapbox',legende:'#live',compteurs:'#live .cnt',methode:'#dia',graphique:'#hist',histogramme:'#hist',resultat:'#wres .wb',recit:'#sread',reglages:'#wmap .chips'};
const FEN={carte:'#wmap',methode:'#wmeth',resultat:'#wres',reglages:'#wmap'};
const toT=h=>{const m=String(h||'').match(/(\d{1,2})\D*(\d{2})?/);return m?(+m[1])*3600+(+(m[2]||0))*60:null;};
UI.guide({
  ecran:'simulation',
  etat:()=>({journee:st.day,heure:hm(st.t),lecture:st.play,vue:st.view==='diff'?'difference':'agents',bus_non_climatises_en_avant:st.noac,plus_fortes_baisses_de_voyageurs_dehors:NAMED.dn,plus_fortes_hausses:NAMED.up}),
  actions:{
    animation:async a=>{if(a.vue)await setView(a.vue==='difference'?'diff':'agents');if(a.bus_non_climatises!=null)setNoac(a.bus_non_climatises);if(a.journee)await setDay(a.journee);const t=toT(a.heure);if(t!=null){play(false);setTime(t);}if(a.lecture!=null)play(!!a.lecture);await wait(300);},
    zoomer_carte:async a=>{map.flyTo([a.lat,a.lon],a.zoom||13,{duration:RM?0:1});await wait(1100);},
    mettre_en_avant:async a=>{if(a.cible==='parametres'){UI.showTab(document.querySelector('[data-p="m-par"]'));UI.spotOn($('#wmeth .wb'),6);return;}
      if(a.cible==='limites'){UI.showTab(document.querySelector('[data-p="m-lim"]'));UI.spotOn($('#wmeth .wb'),6);return;}
      const el=$(CIBLES[a.cible]||'#wmap .mapbox');if(el)UI.spotOn(el,6);},
    agrandir_fenetre:async a=>{const el=$(FEN[a.fenetre]||'#wmap');if(el){UI.maxi(el);await wait(350);}},
  },
  welcome:'Posez une question : je lance l’animation, je règle l’heure et je vous montre ce qu’il faut regarder.',
  fallback:'Sans le serveur du guide, je ne connais que quelques questions :',
  sugg:['Que se passe-t-il à 8 h ?','Qui renonce au trajet ?','La simulation est-elle fiable ?'],
  intents:[
   {k:/8 ?h|heure|pointe|anim|lance/,run:async()=>{await setDay('canicule');play(false);setTime(28800);await wait(200);UI.spotOn($('#live .cnt'),6);
     return [`À 8 h, en vigilance rouge, <b>${nf(live.wait*100)} voyageurs</b> attendent dehors et ${nf(live.noac*100)} sont dans des bus non climatisés.`,['Qui renonce au trajet ?']];}},
   {k:/renonc|teletravail|qui/,run:async()=>{UI.spotOn($('#wres .wb'),6);return [$('#sread').innerHTML,['La simulation est-elle fiable ?']];}},
   {k:/fiable|valid|limite|observ/,run:async()=>{UI.showTab(document.querySelector('[data-p="m-lim"]'));UI.spotOn($('#wmeth .wb'),6);
     return ['Le ferré est bien reproduit, les bus pas encore : leurs niveaux simulés restent loin de l’observé. Les comparaisons entre scénarios restent lisibles.',['Que se passe-t-il à 8 h ?']];}},
  ]});
