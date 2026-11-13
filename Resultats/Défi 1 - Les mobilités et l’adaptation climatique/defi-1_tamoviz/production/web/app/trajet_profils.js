/* Créateur de personnage de « Une journée sous canicule ».
   Quatre étapes, rien sur la carte avant le calcul : son travail (catégorie), son personnage (prénom, elle ou il, apparence),
   sa journée (métier d'exemple, heure de départ, façon de marcher), son trajet (communes de domicile et de travail).
   Cinq exemples tirés de la simulation MATSim (web/data/profils.js) remplissent tout d'un clic.
   Les choix restent dans ce navigateur seulement (jamais dans l'adresse). */
(function(){
'use strict';
const P=window.PROFILS||{personas:[],groupes:{}};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hm=s=>{s=Math.round(s/60)*60;return Math.floor(s/3600)+' h '+String(Math.floor(s%3600/60)).padStart(2,'0');};

const CS=['employe','ouvrier','inter','cadre'];
const CAT={cadre:['Cadre','Cadre'],inter:['Profession intermédiaire','Profession intermédiaire'],employe:['Employée','Employé'],ouvrier:['Ouvrière','Ouvrier']};
const CATX={employe:'aide-soignante, caissière, agent d’entretien…',ouvrier:'préparateur de commandes, électricien…',inter:'infirmière, technicienne, comptable…',cadre:'ingénieur, juriste, chef de projet…'};
/* forme féminine et masculine */
const MET={'aide-soignante':'aide-soignant','agente d’entretien':'agent d’entretien','caissière':'caissier','secrétaire médicale':'secrétaire médical',
  'préparatrice de commandes':'préparateur de commandes','agente de quai':'agent de quai','électricienne':'électricien','boulangère':'boulanger',
  'technicienne de laboratoire':'technicien de laboratoire','infirmière':'infirmier','professeure des écoles':'professeur des écoles','comptable':'comptable',
  'ingénieure de chantier':'ingénieur de chantier','médecin hospitalière':'médecin hospitalier','cheffe de projet':'chef de projet','architecte':'architecte',
  'juriste':'juriste','consultante':'consultant','chargée d’études':'chargé d’études'};
const MASC=Object.fromEntries(Object.entries(MET).map(([f,m])=>[m,f]));
const metier=(m,e)=>e==='elle'?(MASC[m]&&!MET[m]?MASC[m]:m):(MET[m]||m);
/* métiers d'exemple par catégorie, sans doublon entre forme féminine et masculine */
const METS={};P.personas.forEach(p=>{const L=METS[p.cs]||(METS[p.cs]=[]);p.metiers.forEach(x=>{if(!L.some(y=>metier(y,'il')===metier(x,'il')))L.push(x);});});
const SIL=[{k:'a',skin:'#f2cfb1',arm:'#e8b994',hair:'#2a1d17',bun:1,l:'teint clair, chignon'},{k:'b',skin:'#d9a67c',arm:'#c99168',hair:'#1b1410',bun:1,l:'teint mat, chignon'},
  {k:'c',skin:'#8d5a3b',arm:'#7d4d31',hair:'#120c09',bun:1,l:'teint foncé, chignon'},{k:'d',skin:'#f2cfb1',arm:'#e8b994',hair:'#6b4a2e',bun:0,l:'teint clair, cheveux courts'},
  {k:'e',skin:'#d9a67c',arm:'#c99168',hair:'#2a1d17',bun:0,l:'teint mat, cheveux courts'},{k:'f',skin:'#8d5a3b',arm:'#7d4d31',hair:'#120c09',bun:0,l:'teint foncé, cheveux courts'}];
const DEF_SIL={nadia:'b',thomas:'c',sophie:'a',karim:'b',julie:'a'};
/* teint (a clair, b mat, c foncé) + accord : chignon pour elle, cheveux courts pour il */
const TEINT={a:0,b:1,c:2,d:0,e:1,f:2};
const silOf=(k,e)=>SIL[(TEINT[k]||0)+(e==='il'?3:0)];
const avatar=s=>`<svg viewBox="0 0 44 50" aria-hidden="true" class="av"><path d="M8 50 q0-17 14-17 q14 0 14 17z" style="fill:#22b5a5"/><circle cx="22" cy="20" r="10" style="fill:${s.skin}"/>`+
  `<path d="M11.6 20.8 q-.6-12 10.4-12 q11 0 10.4 12 q-2.3-6.2-10.4-6.2 q-8.1 0-10.4 6.2z" style="fill:${s.hair}"/>${s.bun?`<circle cx="22" cy="7.6" r="4.6" style="fill:${s.hair}"/>`:''}</svg>`;
const firstDep=a=>{const L=a.matin&&a.matin.length?a.matin:a.habituel;return L&&L.length?L[0].t0:27000;};

/* état du personnage, gardé dans ce navigateur */
const KEY='rsc-perso';
const DEF={cs:null,n:'',e:'elle',sil:'b',m:0,dep:0,age:'a2',pous:false,o:'',d:'',op:null,dp:null,ex:null};
let ST=Object.assign({},DEF);try{Object.assign(ST,JSON.parse(localStorage.getItem(KEY)||'{}')||{});}catch(e){}
const marche=()=>ST.pous?'poussette':ST.age==='a4'?'senior':'actif';
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(ST));}catch(e){}};
let step=0,onGo=null;

/* exemple : la personne simulée, inchangée (même trajet, même heure, pas normal) */
const exOf=()=>ST.ex?P.personas.find(p=>p.key===ST.ex):null;
function exIntact(){const p=exOf();if(!p)return null;const a=p.agents[0];
  return ST.cs===p.cs&&ST.o===a.hn&&ST.d===a.wn&&marche()==='actif'&&(ST.dep===0||Math.abs(ST.dep-firstDep(a))<=900)?p:null;}
function fill(p){const a=p.agents[0];
  Object.assign(ST,{ex:p.key,cs:p.cs,n:p.prenom,e:p.genre,sil:DEF_SIL[p.key]||'a',m:Math.max(0,(METS[p.cs]||[]).indexOf(p.metiers[0])),dep:0,age:'a2',pous:false,o:a.hn,d:a.wn,op:null,dp:null});save();}
function who(p){
  if(p){const a=p.agents[0],s=silOf(DEF_SIL[p.key],p.genre);
    return {key:p.key,n:p.prenom,e:p.genre,il:p.genre,lui:p.genre==='elle'?'elle':'lui',sil:s,cs:p.cs,cat:CAT[p.cs][p.genre==='elle'?0:1],metier:metier(p.metiers[0],p.genre),agent:a,persona:p};}
  const s=silOf(ST.sil,ST.e),cs=ST.cs||'employe',ex=exIntact();
  return {key:ex?ex.key:'moi',n:(ST.n||'').trim()||'Mon personnage',e:ST.e,il:ST.e,lui:ST.e==='elle'?'elle':'lui',sil:s,cs,cat:CAT[cs][ST.e==='elle'?0:1],
    metier:metier((METS[cs]||[''])[ST.m]||'',ST.e),agent:ex?ex.agents[0]:(window.__agentCalc||null),persona:ex,st:ST,marche:marche()};}

const HOW=()=>exIntact()?`C’est le trajet de ${exOf().prenom} dans la simulation.`:'On cherche d’abord dans la simulation quelqu’un qui fait ce trajet (de sa catégorie si possible, sinon entre communes voisines) ; sinon, on le calcule sur les horaires du réseau.';
const ok=k=>k===1?!!ST.cs:k===2?!!(ST.n||'').trim():k===3?true:k===4?!!((ST.o||'').trim()&&(ST.d||'').trim()):true;
/* ---------- rendu des étapes ---------- */
function render(){
  $('#wst0').hidden=step!==0;$('#wsteps').hidden=step===0;$('#pick .fact').hidden=step===0;
  if(step===0){$('#pick h1').textContent='Une journée sous canicule';$$('#pick .wst').forEach(s=>s.hidden=true);
    $('#w0list').innerHTML=P.personas.map(p=>{const s=silOf(DEF_SIL[p.key],p.genre),a=p.agents[0];return `<button type="button" class="wx" data-go0="${p.key}">${avatar(s)}<span><b>${esc(p.prenom)}</b><small>${CAT[p.cs][p.genre==='elle'?0:1]} · ${esc(a.hn)}</small></span></button>`;}).join('');return;}
  $('#pick h1').textContent='Créez votre personnage.';
  $$('#pick .wst').forEach(s=>s.hidden=+s.dataset.s!==step);
  $$('#wsteps button').forEach(b=>{const k=+b.dataset.go;b.setAttribute('aria-current',k===step?'step':'false');b.classList.toggle('done',k<step);b.disabled=k>step&&![...Array(k-1)].every((_,i)=>ok(i+1));});
  $('#wprev').hidden=false;
  $('#wnext span').textContent=step===4?'Calculer sa journée':'Suivant';
  $('#wnext').disabled=!ok(step);
  const e=ST.e;
  if(step===1){
    $('#wcs').innerHTML=CS.map(k=>`<button type="button" role="radio" aria-checked="${ST.cs===k}" tabindex="${ST.cs===k||(!ST.cs&&k==='employe')?0:-1}" data-cs="${k}" class="wc"><span><b>${CAT[k][e==='elle'?0:1]}</b><small>${CATX[k]}</small></span></button>`).join('');}
  if(step===2){const s=silOf(ST.sil,ST.e);
    $('#wav').innerHTML=avatar(s);$('#fn').value=ST.n;
    $('#acc').innerHTML=['elle','il'].map(x=>`<button type="button" role="radio" aria-checked="${ST.e===x}" tabindex="${ST.e===x?0:-1}" data-e="${x}">${x}</button>`).join('');
    $('#sil').innerHTML=['a','b','c'].map(k=>{const x=silOf(k,ST.e),on=TEINT[ST.sil]===TEINT[k];return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on?0:-1}" data-s="${k}" aria-label="${['teint clair','teint mat','teint foncé'][TEINT[k]]}" style="--sk:${x.skin};--hr:${x.hair}"><i></i></button>`;}).join('');}
  if(step===3){const cs=ST.cs||'employe';
    /* métiers rangés par catégorie socioprofessionnelle (celle des statistiques) ; changer de métier change la catégorie */
    $('#fm').innerHTML=CS.filter(k=>(METS[k]||[]).length).map(k=>`<optgroup label="${CAT[k][e==='elle'?0:1]}">`+
      METS[k].map((x,i)=>`<option value="${k}:${i}"${k===cs&&i===ST.m?' selected':''}>${esc(metier(x,e))}</option>`).join('')+'</optgroup>').join('');
    let o=`<option value="0"${!ST.dep?' selected':''}>à l’heure de la simulation</option>`;for(let t=23400;t<=34200;t+=900)o+=`<option value="${t}"${t===ST.dep?' selected':''}>à ${hm(t)}</option>`;$('#ph').innerHTML=o;
    $('#pa').value=ST.age;$('#fpous').checked=!!ST.pous;$('#pr').value=marche();ageNote();}
  if(step===4){$('#po').value=ST.o;$('#pd').value=ST.d;$('#whow').textContent=HOW();if(window.__pins)setTimeout(window.__pins,30);}
}
/* effet de l'âge et de la poussette sur le calcul (valeurs de PROF dans trajet.js) */
const MARCHE_TXT={poussette:'Avec une poussette : marche 10 % plus lente, 600 m au plus à pied jusqu’à l’arrêt, 250 m en correspondance.',
  senior:'À 60 ans et plus : marche 15 % plus lente, 500 m au plus à pied jusqu’à l’arrêt, 200 m en correspondance.'};
function ageNote(){const m=marche();$('#wage').textContent=m==='actif'?'':MARCHE_TXT[m]+' La simulation ne distingue pas ces cas : son trajet sera calculé sur les horaires du réseau, avec plus de minutes dehors.';
  if(window.fitPanel)fitPanel($('#pick'));}
function go(k){step=Math.max(0,Math.min(4,k));render();if(window.fitPanel)fitPanel($('#pick'));const h=$(`#pick .wst[data-s="${step}"] h2`);if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
function set(k,v){ST[k]=v;save();}

$('#wsteps').addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b&&!b.disabled)go(+b.dataset.go);});
$('#wprev').addEventListener('click',()=>go(step-1));
$('#wst0').addEventListener('click',e=>{const b=e.target.closest('[data-w0]');if(b){if(b.dataset.w0==='creer'){Object.assign(ST,{ex:null});go(1);}else{const l=$('#w0list');l.hidden=!l.hidden;b.setAttribute('aria-expanded',String(!l.hidden));if(window.fitPanel)fitPanel($('#pick'));}return;}
  const p=e.target.closest('[data-go0]');if(p){fill(P.personas.find(q=>q.key===p.dataset.go0));if(onGo)onGo(who());}});
$('#wnext').addEventListener('click',()=>{if(!ok(step))return;if(step<4)go(step+1);else if(onGo)onGo(who());});
$('#pick').addEventListener('click',e=>{
  const c=e.target.closest('[data-cs]');if(c){set('cs',c.dataset.cs);set('m',0);render();$(`[data-cs="${ST.cs}"]`).focus();return;}
  const x=e.target.closest('[data-ex]');if(x){fill(P.personas.find(q=>q.key===x.dataset.ex));go(2);return;}
  /* seulement les boutons « elle / il » et teint : la section de l'étape porte aussi data-s */
  const g=e.target.closest('button[data-e],button[data-s]');if(g){if(g.dataset.e){set('e',g.dataset.e);}else set('sil',g.dataset.s);render();$(`#pick [data-${g.dataset.e?'e':'s'}="${g.dataset.e||g.dataset.s}"]`).focus();}
});
$('#pick').addEventListener('input',e=>{const id=e.target.id;
  if(id==='fn'){set('n',e.target.value.replace(/[<>]/g,'').slice(0,20));$('#wnext').disabled=!ok(step);$$('#wsteps button').forEach(b=>{const k=+b.dataset.go;b.disabled=k>step&&![...Array(k-1)].every((_,i)=>ok(i+1));});}
  if(id==='po'||id==='pd'){const k=id==='po'?'o':'d';set(k,e.target.value);set(k+'p',null);if(window.__pins)window.__pins();$('#wnext').disabled=!ok(step);$('#whow').textContent=HOW();suggest(k,e.target.value);}});
$('#pick').addEventListener('change',e=>{const id=e.target.id;if(id==='fm'){const [k,i]=e.target.value.split(':');if(CAT[k])set('cs',k);set('m',+i||0);}if(id==='ph')set('dep',+e.target.value);
  if(id==='pa'||id==='fpous'){set('age',$('#pa').value);set('pous',$('#fpous').checked);$('#pr').value=marche();ageNote();}});
$('#pick').addEventListener('keydown',e=>{const d={ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[e.key];const b=e.target.closest('[role=radio]');if(!d||!b)return;e.preventDefault();
  const L=[...b.parentNode.children],n=L[(L.indexOf(b)+d+L.length)%L.length];n.click();});
$('#pick').addEventListener('submit',e=>{e.preventDefault();$('#wnext').click();});
/* suggestions : communes et gares du site d'abord, puis adresses de la Base Adresse Nationale (Île-de-France seulement) */
const norm=t=>String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,' ');
const SUG={o:[],d:[]};let sugT=null,sugN=0;
function suggest(k,q){clearTimeout(sugT);const box=$('#p'+k+'l'),inp=$('#p'+k);q=String(q||'').trim();
  if(q.length<3){box.hidden=true;inp.setAttribute('aria-expanded','false');return;}
  sugT=setTimeout(async()=>{const n=++sugN,nq=norm(q);
    const loc=[...document.querySelectorAll('#places option')].map(o=>o.value).filter(v=>norm(v).includes(nq)).slice(0,4).map(v=>({lab:v,src:'site'}));
    let ban=[];try{const r=await fetch('https://api-adresse.data.gouv.fr/search/?q='+encodeURIComponent(q)+'&limit=6&lat=48.86&lon=2.35&autocomplete=1');const j=await r.json();
      ban=(j.features||[]).filter(f=>/^(75|77|78|91|92|93|94|95)/.test(f.properties.citycode||'')).map(f=>({lab:f.properties.label,pt:[f.geometry.coordinates[1],f.geometry.coordinates[0]],src:'adresse'}));}catch(e){}
    if(n!==sugN)return;SUG[k]=[...loc,...ban].slice(0,8);
    box.innerHTML=SUG[k].map((s,i)=>`<li role="option" id="p${k}o${i}" data-i="${i}" tabindex="-1">${esc(s.lab)}<small>${s.src==='adresse'?'adresse':'commune ou gare'}</small></li>`).join('')||'<li class="none">Aucune adresse trouvée en Île-de-France</li>';
    if(box.parentNode!==document.body)document.body.appendChild(box);
    const r=inp.getBoundingClientRect(),below=innerHeight-r.bottom;Object.assign(box.style,{position:'fixed',zIndex:60,left:r.left+'px',width:r.width+'px',right:'auto',
      top:below>=220?(r.bottom+2)+'px':'auto',bottom:below>=220?'auto':(innerHeight-r.top+2)+'px',maxHeight:Math.max(160,Math.min(300,below>=220?below-12:r.top-12))+'px'});
    box.hidden=false;inp.setAttribute('aria-expanded','true');},250);}
function choose(k,i){const s=SUG[k][i];if(!s)return;set(k,s.lab);set(k+'p',s.pt||null);$('#p'+k).value=s.lab;const box=$('#p'+k+'l');box.hidden=true;$('#p'+k).setAttribute('aria-expanded','false');
  if(window.__pins)window.__pins();$('#wnext').disabled=!ok(step);$('#whow').textContent=HOW();}
['o','d'].forEach(k=>{
  $('#p'+k+'l').addEventListener('mousedown',e=>{const li=e.target.closest('[data-i]');if(li){e.preventDefault();choose(k,+li.dataset.i);}});
  $('#p'+k).addEventListener('keydown',e=>{const box=$('#p'+k+'l');if(box.hidden)return;const L=[...box.querySelectorAll('[data-i]')];let i=L.findIndex(x=>x.classList.contains('on'));
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();i=(i+(e.key==='ArrowDown'?1:-1)+L.length)%L.length;L.forEach(x=>x.classList.remove('on'));if(L[i]){L[i].classList.add('on');$('#p'+k).setAttribute('aria-activedescendant',L[i].id);}}
    else if(e.key==='Enter'&&i>=0){e.preventDefault();choose(k,i);}else if(e.key==='Escape'){box.hidden=true;}});
  $('#p'+k).addEventListener('blur',()=>setTimeout(()=>{$('#p'+k+'l').hidden=true;$('#p'+k).setAttribute('aria-expanded','false');},150));});
/* point sur la carte */
$('#pick').addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(!b)return;const k=b.dataset.pick,on=b.getAttribute('aria-pressed')!=='true';
  $$('[data-pick]').forEach(x=>x.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed',String(on));
  $('#whow').textContent=on?(k==='o'?'Cliquez sur la carte à l’endroit où il ou elle habite.':'Cliquez sur la carte à l’endroit où il ou elle travaille.').replace('il ou elle',ST.e):HOW();
  if(window.__pickOnMap)window.__pickOnMap(on?k:null);});
render();setTimeout(()=>window.fitPanel&&fitPanel($('#pick')),50);

function setPoint(k,pt,lab){set(k,lab);set(k+'p',pt);$$('[data-pick]').forEach(x=>x.setAttribute('aria-pressed','false'));if(step===4){$('#p'+k).value=lab;$('#wnext').disabled=!ok(step);$('#whow').textContent=HOW();}}
async function geocode(q){q=String(q||'').trim();if(q.length<3)return null;
  try{const r=await fetch('https://api-adresse.data.gouv.fr/search/?q='+encodeURIComponent(q)+'&limit=5&lat=48.86&lon=2.35');const j=await r.json();
    const f=(j.features||[]).find(x=>/^(75|77|78|91|92|93|94|95)/.test(x.properties.citycode||''));return f?{lab:f.properties.label,pt:[f.geometry.coordinates[1],f.geometry.coordinates[0]]}:null;}catch(e){return null;}}
window.PROFIL={avatar,who,setPoint,geocode,all:()=>P.personas,groupes:P.groupes,state:()=>ST,
  select:k=>{const p=P.personas.find(q=>q.key===k);if(!p)return;fill(p);step=4;render();},
  onStart:f=>{onGo=f;},render:()=>{step=0;render();}};
})();
