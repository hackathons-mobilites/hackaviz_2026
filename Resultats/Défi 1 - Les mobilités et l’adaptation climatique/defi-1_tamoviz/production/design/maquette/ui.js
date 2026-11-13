/* Comportements communs aux écrans de la maquette : fenêtres, onglets, organigramme de méthode, guide.
   Chaque écran fournit son contenu et ses questions préparées ; ce fichier ne connaît aucune donnée. */
(function(){
'use strict';
const $=q=>document.querySelector(q);
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait=ms=>new Promise(r=>setTimeout(r,RM?0:ms));
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const norm=t=>t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’']/g,' ');
/* ---------- mise à l'échelle : la mise en page de référence (1 280 × 800) est réduite pour tenir sur l'écran ---------- */
const BASE_W=1280,BASE_H=800;let SCALE=1,BAR=1;
/* tablette et téléphone (≤ 1 024 px) : pas de réduction, mise en page empilée de maquette.css (carte en haut, tiroir dessous).
   L'écran immersif (trajet.html) garde sa propre mise en page : seule sa barre du bas est remise à taille réelle sur téléphone. */
const MQ_COMPACT=matchMedia('(max-width:1024px)'),MQ_PHONE=matchMedia('(max-width:767px)');
const isImm=()=>document.body.classList.contains('immersif');
const compact=()=>MQ_COMPACT.matches&&!isImm();
function fitScreen(){
  /* l'écran immersif (trajet.html) a sa propre mise en page tablette et téléphone : jamais réduit sous 1 024 px */
  const b=document.body,s=MQ_COMPACT.matches?1:Math.min(1,innerWidth/BASE_W,innerHeight/BASE_H);SCALE=s;
  if(s<1){Object.assign(b.style,{transform:`scale(${s})`,transformOrigin:'0 0',width:innerWidth/s+'px',height:innerHeight/s+'px'});}
  else{Object.assign(b.style,{transform:'',width:'',height:''});}
  /* contre-échelle de la barre du bas et de la bulle quand le bureau est réduit sur un téléphone */
  BAR=(MQ_PHONE.matches&&s<1)?1/s:1;
  const bt=document.getElementById('bottom'),bu=document.getElementById('bubble');
  if(bt)Object.assign(bt.style,BAR>1?{transform:`scale(${BAR})`,transformOrigin:'0 100%',left:8*BAR+'px',right:'auto',bottom:8*BAR+'px',width:(innerWidth-16)+'px'}
    :{transform:'',transformOrigin:'',left:'',right:'',bottom:'',width:''});
  if(bu)Object.assign(bu.style,BAR>1?{transform:`scale(${BAR})`,transformOrigin:'0 0'}:{transform:'',transformOrigin:''});
  /* légende en bandeau : sur téléphone et tablette en paysage, sortie de la fenêtre carte pour devenir le haut du tiroir */
  const lg=document.querySelector('.legbar'),wm=document.getElementById('wmap');
  if(lg&&wm){const out=compact()&&(MQ_PHONE.matches||innerHeight<900);
    if(out&&lg.parentNode===wm)wm.after(lg);else if(!out&&lg.parentNode!==wm)wm.appendChild(lg);}
  centerSrc();
}
/* sélecteur d'écran défilant (téléphone) : l'écran affiché reste visible */
function centerSrc(){
  const src=document.getElementById('src'),cur=src&&src.querySelector('[aria-current="page"]');
  if(cur&&src.scrollWidth>src.clientWidth)src.scrollLeft=cur.offsetLeft-src.offsetLeft-(src.clientWidth-cur.offsetWidth)/2;
}
fitScreen();
document.fonts&&document.fonts.ready.then(centerSrc);
/* rectangle d'un élément en pixels CSS du bureau (et non en pixels d'écran) */
const box=e=>{const r=e.getBoundingClientRect();return{left:r.left/SCALE,top:r.top/SCALE,right:r.right/SCALE,bottom:r.bottom/SCALE,width:r.width/SCALE,height:r.height/SCALE};};
const resizers=[fitScreen];
const relayout=()=>resizers.forEach(f=>f());
addEventListener('resize',relayout);
const onResize=f=>resizers.push(f);

/* ---------- fenêtres : agrandir sur tout le bureau, revenir ---------- */
const desk=$('#desk'), mainWin=desk.querySelector('.win.on');
let deskTop=0;
function setMax(w){
  /* tablette et téléphone : la fenêtre agrandie commence en haut du bureau ; le défilement du tiroir est rendu au retour */
  const was=desk.classList.contains('has-max');
  if(compact()&&w&&!was)deskTop=desk.scrollTop;
  desk.querySelectorAll('.win').forEach(x=>{const on=x===w;x.classList.toggle('max',on);x.classList.toggle('on',on||(!w&&x===mainWin));
    const b=x.querySelector('.mx');if(b){b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',on?'Réduire la fenêtre':'Agrandir la fenêtre');}});
  desk.classList.toggle('has-max',!!w);
  if(compact()){if(w)desk.scrollTop=0;else if(was)desk.scrollTop=deskTop;}
  setTimeout(relayout,0);
}
desk.querySelectorAll('.win').forEach(w=>{
  const b=w.querySelector('.mx');if(b)b.onclick=()=>setMax(w.classList.contains('max')?null:w);
  const wh=w.querySelector('.wh');if(wh)wh.ondblclick=e=>{if(!e.target.closest('button'))setMax(w.classList.contains('max')?null:w);};
});

/* ---------- onglets ---------- */
function showTab(b){const t=b.closest('.tabs');t.querySelectorAll('button').forEach(x=>{const on=x===b;x.setAttribute('aria-selected',String(on));if(x.dataset.p){const p=document.getElementById(x.dataset.p);if(p)p.hidden=!on;}});setTimeout(relayout,0);}
document.querySelectorAll('.tabs').forEach(t=>t.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>showTab(b))));

/* ---------- organigramme : connecteurs coudés recalculés à chaque changement de taille ---------- */
function flow(diaId,edges){
  const d=document.getElementById(diaId), sv=d.querySelector('.wires');
  function draw(){
    if(!d.offsetWidth)return;
    const o=box(d),R=id=>{const r=box(document.getElementById(id));return{l:r.left-o.left,r:r.right-o.left,t:r.top-o.top,b:r.bottom-o.top,cx:(r.left+r.right)/2-o.left,cy:(r.top+r.bottom)/2-o.top};};
    const inb={};edges.forEach(e=>{if(!e[2])(inb[e[1]]=inb[e[1]]||[]).push(e[0]);});
    let h='';const A=4;
    edges.forEach(([f,t,v])=>{const a=R(f),b=R(t);let path,head;
      if(v){const x=b.cx;path=`M${x} ${a.b}V${b.t-A}`;head=`M${x} ${b.t}l-3 -${A+1}h6z`;}
      else{const k=inb[t].indexOf(f),n=inb[t].length,y2=b.t+(b.b-b.t)*(k+1)/(n+1),xm=(a.r+b.l)/2;path=`M${a.r} ${a.cy}H${xm}V${y2}H${b.l-A}`;head=`M${b.l} ${y2}l-${A+1} -3v6z`;}
      h+=`<path d="${path}" data-f="${f}" data-t="${t}"/><path class="ah" d="${head}" data-f="${f}" data-t="${t}"/>`;});
    sv.innerHTML=h;
  }
  const up=id=>{const s=new Set([id]);let ch=true;while(ch){ch=false;edges.forEach(([f,t])=>{if(s.has(t)&&!s.has(f)){s.add(f);ch=true;}});}return s;};
  function lit(id){
    if(!id){d.classList.remove('focus');d.querySelectorAll('.lit').forEach(e=>e.classList.remove('lit'));return;}
    const u=up(id);d.classList.add('focus');d.querySelectorAll('.nd').forEach(n=>n.classList.toggle('lit',u.has(n.id)));
    d.querySelectorAll('.wires path').forEach(p=>p.classList.toggle('lit',u.has(p.dataset.f)&&u.has(p.dataset.t)));
  }
  d.querySelectorAll('.nd.step').forEach(n=>{n.addEventListener('mouseenter',()=>lit(n.id));n.addEventListener('mouseleave',()=>lit(null));});
  draw();document.fonts&&document.fonts.ready.then(draw);onResize(draw);
  return {draw,lit};
}

/* ---------- guide : bulle, mise en avant, questions préparées ---------- */
const bub=$('#bubble'),btx=$('#btx'),bacts=$('#bacts'),spot=$('#spot'),mB=$('#mascBar'),mU=$('#mascBub');
let token=0,target=null,guideMax=false,scrolling=false,cfg={intents:[],sugg:[],welcome:'',fallback:''};
const resets=[];
function place(){
  if(bub.hidden)return;
  const ask=box($('#ask')),bw=bub.offsetWidth*BAR,bh=bub.offsetHeight*BAR,g=12*BAR,W=innerWidth/SCALE,m=(MQ_PHONE.matches?8:16)*BAR;
  const cand=[[ask.left,ask.top-g-bh],[ask.right-bw,ask.top-g-bh],[m,ask.top-g-bh],[W-m-bw,ask.top-g-bh]];
  if(MQ_PHONE.matches)cand.push([m,m]);  /* téléphone : en haut de l'écran si l'élément montré est dans le tiroir */
  const t=target&&box(target);
  const hit=([x,y])=>t&&x<t.right&&x+bw>t.left&&y<t.bottom&&y+bh>t.top;
  const c=cand.map(([x,y])=>[Math.max(m,Math.min(W-m-bw,x)),y]).find(c=>!hit(c))||cand[0];
  bub.style.left=c[0]+'px';bub.style.top=c[1]+'px';
}
function spotOn(el,pad=6){
  target=el;if(!el){spot.classList.remove('on');return;}
  /* tablette et téléphone : l'élément montré dans le tiroir est d'abord amené à l'écran */
  /* la fenêtre carte reste collée en haut : la zone visible du tiroir commence sous elle */
  const inDrawer=compact()&&!el.closest('#wmap')&&desk.contains(el);
  let vt=-1e9,vb=1e9;
  if(inDrawer){
    const wm=document.getElementById('wmap'),d=box(desk),dpad=parseFloat(getComputedStyle(desk).paddingBottom)||0;
    vt=(wm&&wm.offsetWidth&&!desk.classList.contains('has-max'))?box(wm).bottom+pad:d.top;vb=d.bottom-dpad/2;
    if(!scrolling){const t=box(el),h=vb-vt;let dy=0;
      if(t.height>h||t.top<vt+pad)dy=t.top-vt-pad;else if(t.bottom>vb-pad)dy=t.bottom-vb+pad;
      if(Math.abs(dy)>1){scrolling=true;desk.scrollTop+=dy;scrolling=false;}}
  }
  const r=box(el),top=Math.max(r.top-pad,vt-pad),bot=Math.min(r.bottom+pad,vb);
  Object.assign(spot.style,{left:r.left-pad+'px',top:top+'px',width:r.width+2*pad+'px',height:Math.max(0,bot-top)+'px'});
  spot.classList.add('on');place();
}
function reset(){
  resets.forEach(f=>f());
  document.querySelectorAll('.zoomed').forEach(e=>e.classList.remove('zoomed'));
  spotOn(null);
  if(guideMax){setMax(null);guideMax=false;}
}
function close(){token++;reset();bub.hidden=true;mB.classList.remove('think','talk');}
function chips(list,withOk){
  bacts.innerHTML='';
  (list||[]).forEach(a=>{const b=document.createElement('button');b.type='button';b.className='sugg';b.textContent=a;b.onclick=()=>ask(a);bacts.appendChild(b);});
  if(withOk){const ok=document.createElement('button');ok.type='button';ok.className='sugg ok';ok.textContent='Compris';ok.onclick=close;bacts.appendChild(ok);}
}
async function say(html,acts,my){
  mU.classList.remove('think');mU.classList.add('talk');mB.classList.add('talk');
  const tmp=document.createElement('div');tmp.innerHTML=html;const full=tmp.textContent;
  if(RM){btx.innerHTML=html;}else{for(let i=1;i<=full.length;i+=3){if(my!==token)return;btx.textContent=full.slice(0,i);place();await wait(14);}btx.innerHTML=html;}
  mU.classList.remove('talk');mB.classList.remove('talk');
  chips(acts,true);place();
}
function maxi(w){if(!w.classList.contains('max')){setMax(w);guideMax=true;}}
async function ask(text){
  const my=++token;reset();
  const n=norm(text);
  bub.hidden=false;btx.innerHTML='<span class="dots"><i></i><i></i><i></i></span>';bacts.innerHTML='';
  mU.classList.add('think');mB.classList.add('think');place();
  await wait(550);if(my!==token)return;
  mU.classList.remove('think');mB.classList.remove('think');
  if(AGENT){
    const r=await agent(text,my);
    if(my!==token)return;
    if(r){await play(r,my);return;}
  }
  const it=cfg.intents.find(i=>i.test?i.test(n):i.k.test(n));
  const res=it?await it.run(n,my):[cfg.fallback,cfg.sugg.slice(0,4)];
  if(!res||my!==token)return;
  await say(res[0],res[1],my);
}
/* ---------- agent (Claude Agent SDK, serveur local design/maquette/agent/serveur.py) ---------- */
let AGENT=false;
const SKEY='guide_session',NKEY='guide_suite';
const store={get:k=>{try{return sessionStorage.getItem(k);}catch(e){return null;}},set:(k,v)=>{try{v==null?sessionStorage.removeItem(k):sessionStorage.setItem(k,v);}catch(e){}}};
fetch('/api/ping').then(r=>r.ok&&r.json()).then(j=>{if(j&&j.ok){AGENT=true;document.body.classList.add('agent-on');}}).catch(()=>{});
async function agent(text,my){
  try{
    const r=await fetch('/api/guide',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:text,ecran:cfg.ecran,etat:cfg.etat?cfg.etat():{},session:store.get(SKEY)})});
    if(!r.ok)return null;
    const j=await r.json();
    if(j.session)store.set(SKEY,j.session);
    if(j.erreur||!j.texte)return null;
    return j;
  }catch(e){return null;}
}
const SCREENS_HREF={mesures:'index.html',cartogramme:'cartogramme.html',simulation:'simulation.html',trajet:'trajet.html'};
/* exécute les actions demandées par l'agent, puis affiche sa réponse */
async function play(r,my){
  const acts=r.actions||[];
  for(let i=0;i<acts.length;i++){
    const a=acts[i];
    if(a.outil==='changer_ecran'&&a.args.ecran!==cfg.ecran&&SCREENS_HREF[a.args.ecran]){
      store.set(NKEY,JSON.stringify({texte:r.texte,suggestions:r.suggestions,actions:acts.slice(i+1)}));
      location.href=SCREENS_HREF[a.args.ecran];return;
    }
    const f=cfg.actions&&cfg.actions[a.outil];
    if(f){try{await f(a.args||{});}catch(e){}}
    if(my!==token)return;
    await wait(250);
  }
  mU.classList.remove('think');mB.classList.remove('think');
  await say(esc(r.texte).replace(/\n+/g,'<br>'),r.suggestions||[],my);
}
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SCREENS=[{k:/cartogramme|deform/,href:'cartogramme.html',l:'le cartogramme'},{k:/mesure/,href:'index.html',l:'les mesures testées'},{k:/simulation|matsim|animation/,href:'simulation.html',l:'la simulation'},{k:/nadia|trajet|journee/,href:'trajet.html',l:'la journée de Nadia'}];
function guide(c){
  cfg=Object.assign(cfg,c);
  /* changer d'écran : seulement si l'écran demandé n'est pas déjà affiché */
  const here=location.pathname.split('/').pop()||'index.html';
  cfg.intents=SCREENS.filter(s=>s.href!==here&&cfg.ecran!=='trajet').map(s=>({k:new RegExp('(montre|ouvre|va|passe|affiche|voir).*('+s.k.source+')'),run:async()=>{location.href=s.href;return null;}})).concat(cfg.intents);
  $('#ask').addEventListener('submit',e=>{e.preventDefault();const v=$('#q').value.trim();if(v){ask(v);$('#q').value='';}});
  $('#q').addEventListener('focus',()=>{if(bub.hidden){token++;bub.hidden=false;btx.innerHTML=cfg.welcome;chips(cfg.sugg,false);place();}});
  const suite=store.get(NKEY);
  if(suite){store.set(NKEY,null);try{const r=JSON.parse(suite);setTimeout(()=>{const my=++token;bub.hidden=false;btx.innerHTML='<span class="dots"><i></i><i></i><i></i></span>';place();play(r,my);},900);}catch(e){}}
}
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(!bub.hidden)close(); else if(desk.classList.contains('has-max'))setMax(null);
});
onResize(()=>{if(target)spotOn(target);place();});
desk.addEventListener('scroll',()=>{if(target){scrolling=true;spotOn(target);scrolling=false;}},{passive:true});

/* ---------- mode sombre par défaut, choix mémorisé sur ce poste ---------- */
const THK='rsc-theme';
const sysDark=()=>!!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);
const isDark=()=>{const t=document.documentElement.dataset.theme;return t?t==='dark':sysDark();};
const themeSubs=[];
function setTheme(t){document.documentElement.dataset.theme=t;try{localStorage.setItem(THK,t);}catch(e){}themeBtn();themeSubs.forEach(f=>f(isDark()));}
document.documentElement.dataset.theme='dark';
try{const t=localStorage.getItem(THK);if(t)document.documentElement.dataset.theme=t;}catch(e){}
const tb=document.createElement('button');tb.className='pill thm';tb.type='button';
tb.innerHTML='<svg class="i sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="i moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
function themeBtn(){const d=isDark();tb.setAttribute('aria-pressed',String(d));const l=d?'Passer en mode clair':'Passer en mode sombre';tb.setAttribute('aria-label',l);tb.title=l;}
tb.addEventListener('click',()=>setTheme(isDark()?'light':'dark'));
{const bt=document.getElementById('bottom');if(bt)bt.appendChild(tb);}themeBtn();
if(window.matchMedia)matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{themeBtn();themeSubs.forEach(f=>f(isDark()));});

window.UI={compact,isDark,onTheme:f=>themeSubs.push(f),store,box,scale:()=>SCALE,showTab,$,RM,wait,css,norm,onResize,setMax,flow,guide,ask,say,close,spotOn,maxi,onReset:f=>resets.push(f),
  current:()=>token, speak:(html,acts)=>{const my=++token;bub.hidden=false;return say(html,acts,my);}};
})();
