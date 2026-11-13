/* Écran « Cartogramme » : cartogramme continu précalculé par scripts/05_carto.py (diffusion, Gastner et Newman 2004),
   sur les vraies données de web/data. Même calcul que le site, habillage du design system Papier. */
const {$,RM,wait,css}=UI;
const DATA='../../web/data/';

/* ---------- données : arrêts, carreaux, unités (repris de web/app.js) ---------- */
const RD=window.IDF, FLOWD=window.FLOW, CARS=window.CARS, LAY=window.LAYERS, V2D=window.V2;
const S=RD.cols.id.map((id,k)=>{const c=RD.cols,vref=FLOWD.vref[k],fi=FLOWD.i[k];
  return {id,n:c.n[k],c:c.c[k],co:c.co[k],ir:c.ir[k],pp:c.pp[k],nc:c.nc[k],aj:c.aj[k],df:c.df[k],nvp:c.nvp[k],acc:c.acc[k],
    fl:vref>0&&fi?{vref,i:fi,v:fi.map(x=>x==null?0:Math.round(vref*x/100))}:null};});
const SER=V2D.serie.map(x=>({d:x.d,vig:x.vig['75']||1})), DAYS=SER.map(x=>x.d);
const RED=['2026-06-22','2026-06-23','2026-06-24','2026-06-25','2026-06-26'];
const nf=(v,d=0)=>v==null||isNaN(v)?'–':Number(v).toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d}).replace(/\u202f/g,'\u00a0');
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const avg=a=>{a=a.filter(v=>v!=null);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;};
const MOIS=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const dLabel=d=>{const[,m,j]=d.split('-').map(Number);return j+' '+MOIS[m-1];};
const VIG_L={1:'vigilance verte',2:'vigilance jaune',3:'vigilance orange',4:'vigilance rouge'};
/* score de vulnérabilité : 6 critères, seuils par défaut du site */
const TH={aj:10,nc:50,pp:20,df:300,nvp:20};
const score=s=>[s.pp<=TH.pp,s.nc!=null&&s.nc*100>=TH.nc,s.aj!=null&&s.aj>=TH.aj,s.df==null||s.df>TH.df,s.nvp!=null&&s.nvp<=TH.nvp,s.acc==='false'].filter(Boolean).length;
const SC=S.map(score);
const FIL={ind:k=>CARS.ind[k]||0,ns:k=>CARS.ns[k]};
const stopsBy={ir:{},co:{}},carsBy={ir:{},co:{}};
S.forEach((s,k)=>{for(const key of ['ir','co']){const v=s[key];if(v)(stopsBy[key][v]=stopsBy[key][v]||[]).push(k);}});
for(let k=0;k<CARS.ind.length;k++){for(const key of ['ir','co']){const v=CARS[key][k];if(v)(carsBy[key][v]=carsBy[key][v]||[]).push(k);}}
const COMNAME=Object.fromEntries(LAY.communes.features.map(f=>[f.properties.code,f.properties.nom.replace(' Arrondissement','')]));
function units(u){
  const key=u==='iris'?'ir':'co',feats=u==='iris'?LAY.iris.features:LAY.communes.features,fid=f=>u==='iris'?f.properties.code_iris:f.properties.code;
  return feats.map(f=>{const id=fid(f);return {id,nom:u==='iris'?f.properties.nom_iris:COMNAME[id],sub:u==='iris'?f.properties.nom_commune:'',stops:stopsBy[key][id]||[],cars:carsBy[key][id]||[]};});
}
const redI=k=>S[k].fl?avg(RED.map(d=>S[k].fl.i[DAYS.indexOf(d)])):null;

/* ---------- indicateurs de couleur (palettes du design system) ---------- */
const HEAT=[1,2,3,4,5].map(i=>css('--heat-'+i)), NA=css('--line2')||'#d5dbe3';
const DIVC=['#8f1b1a',css('--div-neg'),css('--div-n2'),css('--div-mid'),css('--div-p2'),css('--div-pos')];
const IND={
  expo:{l:'Habitants exposés',unit:' %',d:0,br:[10,25,50,75],cols:HEAT,labs:['moins de 10 %','10 à 25 %','25 à 50 %','50 à 75 %','75 % ou plus'],
    f:x=>{const P=x.cars.reduce((a,i)=>a+FIL.ind(i),0);if(!P)return null;return 100*x.cars.reduce((a,i)=>a+(SC[FIL.ns(i)]>=3?FIL.ind(i):0),0)/P;}},
  score:{l:'Score moyen des arrêts',unit:' / 6',d:1,br:[1,1.5,2,2.5],cols:HEAT,labs:['moins de 1','1 à 1,5','1,5 à 2','2 à 2,5','2,5 ou plus'],
    f:x=>x.stops.length?avg(x.stops.map(k=>SC[k])):null},
  red:{l:'Voyageurs, semaine rouge',unit:'',d:0,br:[70,85,95,105,115],cols:DIVC,labs:['−30 % ou plus','−15 à −30 %','−5 à −15 %','normal (± 5 %)','+5 à +15 %','+15 % ou plus'],
    f:x=>{const st=x.stops.filter(k=>S[k].fl&&redI(k)!=null);const W=st.reduce((a,k)=>a+S[k].fl.vref,0);return W?st.reduce((a,k)=>a+S[k].fl.vref*redI(k),0)/W:null;},
    fmt:v=>(v>=100?'+':'−')+nf(Math.abs(v-100))+' % par rapport à un jour ordinaire'},
};
const bin=(v,br,cols)=>{if(v==null)return NA;let i=0;while(i<br.length&&v>=br[i])i++;return cols[i];};
const WEIGHT={vref:'validations d’un jour ordinaire',vday:'validations du jour choisi',pop:'habitants',expo:'habitants exposés (score ≥ 3)'};

/* ---------- carte ---------- */
const BOUNDS=[[48.11,1.44],[49.25,3.57]];
const map=L.map('map',{zoomControl:false,attributionControl:false,zoomSnap:.25,zoomDelta:.5}).fitBounds(BOUNDS,{padding:[10,10]});
const BASE=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:17,className:'base'}).addTo(map);
L.control.attribution({prefix:false}).addAttribution('© contributeurs OpenStreetMap').addTo(map);
const R=L.canvas({padding:.3}), G=L.layerGroup().addTo(map);
const fade=t=>BASE.setOpacity(1-.8*t);
const st={u:'com',fix:false,lg:false,w:'vref',c:'expo',day:'2026-06-25',t:1};
let morphing=false,C=null,U=null,shapes=[],anim=null,z0=map.getZoom();
const loadScript=src=>new Promise(res=>{const s=document.createElement('script');s.src=src;s.onload=()=>res(true);s.onerror=()=>res(false);document.head.appendChild(s);});
async function getCarto(){
  const suf=st.fix?'_fixe':'',v=(st.u==='com'?'CARTO_COM':'CARTO_IRIS')+suf.toUpperCase();
  if(!window[v])await loadScript(DATA+`carto_${st.u}${suf}.js`);
  return window[v];
}
const hasDays=()=>C&&Object.keys(C.days).length>0;
const useLog=()=>st.lg&&C.modes.vref_log&&st.w!=='vday';
const disp=()=>st.w==='vday'?C.days[st.day]:C.modes[st.w+(useLog()?'_log':'')];
const IX=x=>C.lon0+x/73300, IY=y=>C.lat0+y/111320;
const pt=(i,t,d)=>[IY(C.base[2*i+1]+d[2*i+1]*t),IX(C.base[2*i]+d[2*i]*t)];
const ringsOf=(rr,t)=>{const d=disp().d;return rr.map(p=>p.map(r=>r.map(i=>pt(i,t,d))));};
function weightTxt(u){
  if(!u)return '–';
  if(st.w==='pop')return nf(u.cars.reduce((a,i)=>a+FIL.ind(i),0))+' habitants';
  if(st.w==='expo')return nf(u.cars.reduce((a,i)=>a+(SC[FIL.ns(i)]>=3?FIL.ind(i):0),0))+' habitants exposés';
  const di=DAYS.indexOf(st.day);
  return nf(u.stops.reduce((a,k)=>a+(S[k].fl?(st.w==='vday'?(S[k].fl.v[di]||0):S[k].fl.vref):0),0))+' validations';
}
function weightVal(u){
  if(!u)return 0;
  if(st.w==='pop')return u.cars.reduce((a,i)=>a+FIL.ind(i),0);
  if(st.w==='expo')return u.cars.reduce((a,i)=>a+(SC[FIL.ns(i)]>=3?FIL.ind(i):0),0);
  const di=DAYS.indexOf(st.day);
  return u.stops.reduce((a,k)=>a+(S[k].fl?(st.w==='vday'?(S[k].fl.v[di]||0):S[k].fl.vref):0),0);
}
const label=u=>u.sub?`${u.nom} (${u.sub})`:u.nom;
const UNIT=()=>st.u==='com'?['commune','communes']:['IRIS','IRIS'];
const list=a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' et '+a[a.length-1];
/* récit calculé à partir de ce qui est affiché */
function story(){
  const cfg=IND[st.c],rows=U.map(u=>({u,w:weightVal(u),v:cfg.f(u)})).filter(r=>r.w>0).sort((a,b)=>b.w-a.w);
  if(!rows.length)return '';
  const W=rows.reduce((a,r)=>a+r.w,0),n=Math.max(1,Math.round(U.length/10)),top=rows.slice(0,n),sh=100*top.reduce((a,r)=>a+r.w,0)/W;
  const [one,many]=UNIT();
  let t=`${nf(sh)} % des ${WEIGHT[st.w]} se concentrent dans ${nf(n)} ${many} sur ${nf(U.length)}, soit une sur dix.`;
  const big=rows.slice(0,Math.max(20,n));
  if(st.c==='expo'){const h=big.filter(r=>r.v!=null&&r.v>=50).slice(0,3).map(r=>label(r.u));
    t+=h.length?` Parmi les plus grandes, celles où plus de la moitié des habitants sont exposés : ${list(h)}.`:' Aucune des plus grandes zones n’a plus de la moitié de ses habitants exposés.';}
  else if(st.c==='score'){const h=big.filter(r=>r.v!=null&&r.v>=2).slice(0,3).map(r=>label(r.u));
    t+=h.length?` Les plus grandes aux arrêts les plus fragiles : ${list(h)}.`:' Les plus grandes zones ont des arrêts peu fragiles.';}
  else{const lost=rows.filter(r=>r.v!=null&&r.v<85),pw=100*lost.reduce((a,r)=>a+r.w,0)/W;
    t+=` Pendant la semaine rouge, ${nf(pw)} % de ce poids est dans des ${many} qui ont perdu plus de 15 % de voyageurs.`;}
  return t;
}
/* mise en avant d'une zone par le guide */
let focused=null;
function focusUnit(code){
  unfocus();const k=C.codes.indexOf(code);if(k<0)return null;const pl=shapes[k].pl;
  pl.setStyle({color:css('--idfm-ink'),weight:2.4});pl.bringToFront();focused=pl;setTimeout(placeLabels,0);
  map.flyToBounds(pl.getBounds(),{padding:[60,60],maxZoom:st.u==='iris'?10:9.5,duration:RM?0:1});
  return pl;
}
function unfocus(){if(focused){focused.setStyle({color:css('--panel'),weight:st.u==='com'?.6:.25});focused=null;}}
UI.onReset(()=>{unfocus();fitAll();});
function build(){
  G.clearLayers();
  const cfg=IND[st.c], Ui=Object.fromEntries(U.map(u=>[u.id,u])), white=css('--panel');
  shapes=C.iris.map((rr,j)=>{const u=Ui[C.codes[j]],v=u?cfg.f(u):null;
    const pl=L.polygon(ringsOf(rr,st.t),{renderer:R,color:white,weight:st.u==='com'?.6:.25,fillColor:bin(v,cfg.br,cfg.cols),fillOpacity:1});
    pl.bindTooltip(`<b>${esc(u?u.nom:C.codes[j])}</b>${u&&u.sub?' · '+esc(u.sub):''}<br>${weightTxt(u)}<br>${cfg.l} : ${v==null?'–':(cfg.fmt?cfg.fmt(v):nf(v,cfg.d)+cfg.unit)}`,{sticky:true,className:'tip'});
    G.addLayer(pl);return {rr,pl,u};});
  legend();info();
  if(!morphing){fitAll();setTimeout(placeLabels,RM?0:700);}
}
/* cadrage : la carte montre toujours la forme entière, quelle que soit la déformation */
function boundsAt(t){
  const d=disp().d,B=C.base,n=B.length/2;let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for(let i=0;i<n;i++){const x=B[2*i]+d[2*i]*t,y=B[2*i+1]+d[2*i+1]*t;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  return L.latLngBounds([IY(y0),IX(x0)],[IY(y1),IX(x1)]);
}
function fitAll(t=st.t,animate=!RM,extra){const b=boundsAt(t);if(extra)b.extend(extra);map.fitBounds(b,{padding:[14,14],animate,duration:.6});}
function frame(t){shapes.forEach(({rr,pl})=>pl.setLatLngs(ringsOf(rr,t)));fade(t);}
function morph(target){
  cancelAnimationFrame(anim);const from=st.t,t0=performance.now(),dur=RM?0:1400;
  fitAll(target,!RM,boundsAt(from));morphing=true;LBL.clearLayers();
  const step=now=>{const k=dur?Math.min(1,(now-t0)/dur):1,e=1-Math.pow(1-k,3);st.t=from+(target-from)*e;frame(st.t);if(k<1)anim=requestAnimationFrame(step);else{morphing=false;placeLabels();}};
  anim=requestAnimationFrame(step);
  const b=$('#cmorph');b.setAttribute('aria-pressed',String(!!target));b.textContent=target?'Cartogramme':'Carte réelle';
}
function legend(){
  const cfg=IND[st.c];
  $('#leg').innerHTML=`<div><h4>Couleur · ${cfg.l}</h4><div class="sw">${cfg.cols.map((c,i)=>`<span><i style="background:${c}"></i>${cfg.labs[i]}</span>`).join('')}<span><i style="background:${NA}"></i>sans donnée</span></div></div>
   <div><h4>Surface</h4><p>proportionnelle ${useLog()?'au logarithme des':'aux'} ${WEIGHT[st.w]}</p></div>`;
}
function info(){
  $('#cerr').textContent='écart moyen '+nf(disp().err,1)+' %';
  $('#cnt').textContent=nf(C.codes.length)+(st.u==='com'?' communes':' IRIS');
  $('#cread').textContent=story();
  const showDay=st.w==='vday';
  if(showDay){const r2=SER[DAYS.indexOf(st.day)],o=$('#o-cday');o.textContent=dLabel(st.day)+' · '+VIG_L[r2.vig];o.classList.toggle('hot',r2.vig>=3);}
}
function syncControls(){
  const days=hasDays();
  $('#cw').querySelector('option[value="vday"]').disabled=!days;
  if(!days&&st.w==='vday')st.w='vref';
  $('#cw').value=st.w; $('#cc').value=st.c;
  const CD=days?Object.keys(C.days).sort():[];
  if(days&&!C.days[st.day])st.day=CD[0];
  $('#cday-row').hidden=st.w!=='vday';
  if(days){const sl=$('#cday');sl.max=CD.length-1;sl.value=CD.indexOf(st.day);}
  const logOk=!!C.modes.vref_log&&st.w!=='vday';
  $('#clog').querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',String((b.dataset.l==='true')===!!(st.lg&&logOk)));b.disabled=b.dataset.l==='true'&&!logOk;});
  $('#cfix').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.f==='true')===st.fix)));
  $('#cunit').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.u===st.u)));
}
async function reload(){
  const c=await getCarto(); if(!c)return; C=c; U=units(st.u); syncControls(); build();
}

/* ---------- commandes ---------- */
$('#cunit').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(st.u===b.dataset.u)return;st.u=b.dataset.u;reload();});
$('#cfix').querySelectorAll('button').forEach(b=>b.onclick=()=>{const f=b.dataset.f==='true';if(st.fix===f)return;st.fix=f;if(f)st.lg=true;reload();});
$('#clog').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(b.disabled)return;st.lg=b.dataset.l==='true';syncControls();build();});
$('#cw').onchange=e=>{st.w=e.target.value;syncControls();build();};
$('#cc').onchange=e=>{st.c=e.target.value;build();};
$('#cday').oninput=e=>{const CD=Object.keys(C.days).sort();st.day=CD[+e.target.value];build();};
$('#cmorph').onclick=()=>morph(st.t>.5?0:1);
const zl=()=>{$('#zlab').textContent=nf(100*Math.pow(2,map.getZoom()-z0))+' %';};
map.on('zoomend',zl);
/* ---------- étiquettes : les plus grandes zones d'abord, jamais deux étiquettes qui se chevauchent ---------- */
const LBL=L.layerGroup().addTo(map);
function ringPx(r){
  const P=r.map(ll=>map.latLngToContainerPoint(ll));let a=0,cx=0,cy=0;
  for(let i=0,j=P.length-1;i<P.length;j=i++){const f=P[j].x*P[i].y-P[i].x*P[j].y;a+=f;cx+=(P[j].x+P[i].x)*f;cy+=(P[j].y+P[i].y)*f;}
  return a?{a:Math.abs(a/2),x:cx/(3*a),y:cy/(3*a)}:{a:0,x:0,y:0};
}
/* style cartographique : communes en capitales espacées, arrondissements abrégés, trois tailles selon l'importance */
const MEAS=document.createElement('canvas').getContext('2d');
const tw=(t,f,ls)=>{MEAS.font=f;return MEAS.measureText(t).width+ls*t.length;};
function lname(u){
  if(st.u==='com'){const m=u.nom.match(/^Paris (\d+)(er|e)/);return m?{t:m[1]+m[2],arr:true}:{t:u.nom.toUpperCase(),arr:false};}
  return {t:u.nom,arr:false};
}
const LV_D=[{fs:12.5,fw:700},{fs:11,fw:600},{fs:10,fw:600}],LV_C=[{fs:12.5,fw:700},{fs:12,fw:600},{fs:12,fw:500}];  /* tablette et téléphone : 12 px au moins */
let LV=LV_D;
function placeLabels(){
  LBL.clearLayers();if(morphing||!shapes.length)return;
  LV=UI.compact()?LV_C:LV_D;
  const sz=map.getSize(),cand=[];
  shapes.forEach(sh=>{if(!sh.u)return;const ll=sh.pl.getLatLngs();let best=null;
    (Array.isArray(ll[0][0])?ll:[ll]).forEach(p=>{const r=ringPx(p[0]);if(!best||r.a>best.a)best=r;});
    if(best&&best.a>0)cand.push({sh,...best});});
  cand.sort((a,b)=>((b.sh.pl===focused)-(a.sh.pl===focused))||(b.a-a.a));
  const placed=[],max=st.u==='com'?40:30,font=getComputedStyle(document.body).fontFamily;
  /* « PARIS » au centre des arrondissements, s'ils sont nommés */
  const arrs=cand.filter(c=>/^Paris \d/.test(c.sh.u.nom));
  let k=0;
  for(const c of cand){
    if(placed.length>=max)break;
    const isF=c.sh.pl===focused,lb=lname(c.sh.u),lv=isF?LV[0]:LV[k<6?0:k<18?1:2],caps=st.u==='com'&&!lb.arr,ls=caps?.06*lv.fs:0;
    const w=tw(lb.t,`${lv.fw} ${lv.fs}px ${font}`,ls)+6,h=lv.fs+5;
    const b={l:c.x-w/2,r:c.x+w/2,t:c.y-h/2,b:c.y+h/2};
    if(b.l<4||b.r>sz.x-4||b.t<4||b.b>sz.y-4)continue;
    if(!isF&&c.a<Math.max(h*h*3,w*h*.45))continue;       /* zone assez grande ; le nom peut déborder un peu, le halo le garde lisible */
    if(placed.some(p=>b.l<p.r+4&&b.r>p.l-4&&b.t<p.b+2&&b.b>p.t-2))continue;  /* jamais de chevauchement */
    placed.push(b);k++;
    LBL.addLayer(L.marker(map.containerPointToLatLng([c.x,c.y]),{icon:L.divIcon({className:'clbl'+(caps?' caps':'')+(lb.arr?' arr':'')+(isF?' on':''),
      html:`<span style="font-size:${lv.fs}px;font-weight:${lv.fw}">${esc(lb.t)}</span>`,iconSize:null}),interactive:false,keyboard:false}));
  }
  if(st.u==='com'&&arrs.length>=6){
    let A=0,x=0,y=0;arrs.forEach(c=>{A+=c.a;x+=c.x*c.a;y+=c.y*c.a;});x/=A;y/=A;
    const w=tw('PARIS',`700 15px ${font}`,1.5)+8,h=20,b={l:x-w/2,r:x+w/2,t:y-h/2,b:y+h/2};
    if(!placed.some(p=>b.l<p.r&&b.r>p.l&&b.t<p.b&&b.b>p.t))
      LBL.addLayer(L.marker(map.containerPointToLatLng([x,y]),{icon:L.divIcon({className:'clbl caps city',html:'<span>Paris</span>',iconSize:null}),interactive:false,keyboard:false}));
  }
}
map.on('zoomend moveend',()=>{if(!morphing)placeLabels();});
$('#zin').onclick=()=>map.zoomIn(); $('#zout').onclick=()=>map.zoomOut(); $('#zfit').onclick=()=>fitAll();
UI.onResize(()=>{map.invalidateSize();if(C)fitAll(st.t,false);});

/* organigramme de méthode : chiffres réels */
$('#n-val').textContent=nf(S.length)+' arrêts · '+DAYS.length+' jours';
$('#n-fil').textContent=nf(CARS.ind.length)+' carreaux de 200 m';
$('#n-geo').textContent=nf(LAY.communes.features.length)+' communes · '+nf(LAY.iris.features.length)+' IRIS';
/* organigramme de méthode */
const FL=UI.flow('dia',[['s-val','p-agg'],['s-fil','p-agg'],['s-geo','p-dif'],['p-agg','p-dif','v'],['p-dif','p-out','v']]);
UI.onReset(()=>FL.lit(null));

/* démarrage : carte réelle, puis déformation */
C=window.CARTO_COM; U=units('com'); syncControls(); st.t=0; build(); zl();
setTimeout(()=>morph(1),RM?0:700);

/* ---------- questions préparées du guide ---------- */
const set=async o=>{const need=('u' in o&&o.u!==st.u)||('fix' in o&&o.fix!==st.fix);Object.assign(st,o);if(need)await reload();else{syncControls();build();}};
const CIBLES={carte:'#wmap .mapbox',legende:'#leg',methode:'#dia',reglages:'#wset .form',recit:'#cread',graphique:'#wset',resultat:'#wset'};
const FEN={carte:'#wmap',methode:'#wmeth',reglages:'#wset',resultat:'#wset'};
UI.guide({
  ecran:'cartogramme',
  etat:()=>({unite:st.u==='com'?'commune':'IRIS',contour:st.fix?'fixe':'libre',echelle:useLog()?'logarithmique':'proportionnelle',poids:st.w,couleur:st.c,jour:st.day,deforme:st.t>.5,zone_entouree:focused?C.codes[shapes.findIndex(s=>s.pl===focused)]:null}),
  actions:{
    regler_cartogramme:async a=>{const o={};if(a.unite)o.u=/iris/i.test(a.unite)?'iris':'com';if(a.contour)o.fix=a.contour==='fixe';if(a.echelle)o.lg=a.echelle==='logarithmique';
      if(a.poids)o.w=a.poids;if(a.couleur)o.c=a.couleur;if(a.jour)o.day=a.jour;if(o.fix)o.lg=true;await set(o);await wait(300);},
    entourer_zone:async a=>{if(focusUnit(String(a.code))){await wait(1100);UI.spotOn($('#wmap .mapbox'));}},
    carte_reelle:async a=>{morph(a.deforme?1:0);await wait(RM?0:1450);},
    zoomer_carte:async a=>{map.flyTo([a.lat,a.lon],a.zoom||11,{duration:RM?0:1});await wait(1100);},
    mettre_en_avant:async a=>{const e=$(CIBLES[a.cible]||'#wmap .mapbox');if(e)UI.spotOn(e,6);},
    agrandir_fenetre:async a=>{const e=$(FEN[a.fenetre]||'#wmap');if(e){UI.maxi(e);await wait(350);}},
  },
  welcome:'Posez une question : je règle le cartogramme et je vous montre ce qu’il faut regarder.',
  fallback:'Dans cette maquette, je sais répondre à quelques questions. Essayez l’une de celles-ci :',
  sugg:['Que représente la surface ?','C’est quoi un IRIS ?','Montre les habitants exposés','Et le 25 juin, en vigilance rouge ?','Montre les mesures testées'],
  intents:[
   {k:/surface|represente|taille|grand|lire|exemple/,run:async(n,my)=>{
     const rows=U.map(u=>({u,w:weightVal(u)})).filter(r=>r.w>0).sort((a,b)=>b.w-a.w);
     const a=rows[0],b=rows[Math.floor(rows.length/2)];
     focusUnit(a.u.id);await wait(1100);if(my!==UI.current())return;UI.spotOn($('#wmap .mapbox'));
     return [`Chaque zone a une surface proportionnelle à ses <b>${WEIGHT[st.w]}</b>. Exemple : <b>${esc(label(a.u))}</b>, entourée, en compte ${nf(a.w)} ; une ${UNIT()[0]} moyenne comme ${esc(label(b.u))} en compte ${nf(b.w)}, d’où une surface ${nf(a.w/b.w)} fois plus petite. La couleur montre un autre indicateur : ${IND[st.c].l.toLowerCase()}.`,['C’est quoi un IRIS ?','Montre les habitants exposés']];}},
   {k:/iris|quartier/,run:async(n,my)=>{
     await set({u:'iris'});
     const pick=U.map(u=>({u,p:u.cars.reduce((a,i)=>a+FIL.ind(i),0),e:IND.expo.f(u)})).filter(r=>r.p>1500&&r.e!=null&&r.u.stops.length>2).sort((a,b)=>b.e-a.e)[0];
     focusUnit(pick.u.id);await wait(1100);if(my!==UI.current())return;UI.spotOn($('#wmap .mapbox'));
     return [`Un <b>IRIS</b> est un petit quartier découpé par l’Insee, d’environ 2 000 habitants ; la région en compte ${nf(LAY.iris.features.length)}. Exemple : <b>${esc(pick.u.nom)}</b>, à ${esc(pick.u.sub)}, entouré : ${nf(pick.p)} habitants, ${pick.u.stops.length} arrêts, et ${nf(pick.e)} % des habitants dépendent d’un arrêt vulnérable.`,['Que représente la surface ?','Reviens aux communes']];}},
   {k:/expos|priorit|vulnerab/,run:async(n,my)=>{
     await set({w:'expo',c:'expo'});
     const r=U.map(u=>({u,w:weightVal(u)})).sort((a,b)=>b.w-a.w)[0];
     focusUnit(r.u.id);await wait(1100);if(my!==UI.current())return;UI.spotOn($('#wmap .mapbox'));
     return [`Surface et couleur montrent maintenant les <b>habitants exposés</b>, ceux qui dépendent d’un arrêt cumulant au moins trois fragilités. La plus grande zone, entourée : <b>${esc(label(r.u))}</b>, avec ${nf(r.w)} habitants exposés.`,['C’est quoi un IRIS ?','Que représente la surface ?']];}},
   {k:/25 juin|vigilance|rouge|jour/,run:async(n,my)=>{
     await set({u:'com',fix:false,w:'vday',day:'2026-06-25',c:'red'});
     const r=U.map(u=>({u,w:weightVal(u),v:IND.red.f(u)})).filter(x=>x.v!=null&&x.w>2000).sort((a,b)=>a.v-b.v)[0];
     focusUnit(r.u.id);await wait(1100);if(my!==UI.current())return;UI.spotOn($('#wmap .mapbox'));
     return [`Voici le <b>25 juin</b>, en vigilance rouge : la surface suit les validations du jour, la couleur l’écart à un jour ordinaire. Exemple, entourée : <b>${esc(label(r.u))}</b>, ${IND.red.fmt(r.v)} pendant la semaine rouge. Le curseur « Jour » compare avec un jour frais.`,['Que représente la surface ?','Montre les habitants exposés']];}},
   {k:/log/,run:async()=>{await set({lg:true,w:st.w==='vday'?'vref':st.w});await wait(250);UI.spotOn($('#clog'),6);
     return ['En surface proportionnelle, Paris écrase le reste de la région. L’<b>échelle logarithmique</b> tasse les écarts : une zone cent fois plus chargée n’est plus cent fois plus grande, et les petites communes redeviennent lisibles.',['Garde la frontière de la région']];}},
   {k:/frontiere|contour|fixe|bord/,run:async()=>{await set({fix:true,lg:true});await wait(250);UI.spotOn($('#wmap .mapbox'));
     return [`La <b>frontière de l’Île-de-France reste en place</b> et seul l’intérieur se déforme. Prix à payer : l’écart de surface monte à ${nf(disp().err,1)} % (il est affiché dans les réglages).`,['C’est quoi un IRIS ?','Pourquoi une échelle logarithmique ?']];}},
   {k:/commune/,run:async()=>{await set({u:'com'});await wait(250);UI.spotOn($('#wmap .mapbox'));return ['Retour aux communes.',['Que représente la surface ?']];}},
   {k:/source|donnee|methode|calcul|comment/,run:async()=>{UI.showTab(document.querySelector('[data-p="m-cr"]'));FL.lit('p-out');UI.spotOn($('#dia'),6);
     return [`Les validations de ${nf(S.length)} arrêts (<b>IDFM</b>) et les habitants de ${nf(CARS.ind.length)} carreaux (<b>Insee</b>) sont additionnés par zone. Puis les densités sont « diffusées » sur une grille de 40 m jusqu’à ce que chaque zone ait la surface de son poids.`,['Que représente la surface ?']];}},
   {k:/reelle|vraie|normale|deform/,run:async()=>{morph(st.t>.5?0:1);await wait(RM?0:1450);UI.spotOn($('#wmap .mapbox'));
     return [st.t>.5?'Voici le cartogramme.':'Voici la carte réelle, sans déformation. Cliquez sur « Carte réelle » pour revenir au cartogramme.',['Que représente la surface ?']];}},
  ]});
