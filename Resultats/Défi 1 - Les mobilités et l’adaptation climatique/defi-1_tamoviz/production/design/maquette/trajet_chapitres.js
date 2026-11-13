/* Scènes de « Une journée sous canicule » : aux moments clés, la lecture s'arrête sur une page du récit.
   Une phrase, un graphique, une source. Les données viennent de tout le site « Réseau sous canicule » :
   access.js (ACC), sim.js (SIM), macro.js (MACRO), matsim.js (MATSIM), carto_com.js (cartogramme, chargé à part). */
(function(){
'use strict';
const ACC=window.ACC, SIM=window.SIM, MACRO=window.MACRO, MATSIM=window.MATSIM;
const nf=(v,d=0)=>v==null||isNaN(v)?'–':Number(v).toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d}).replace(/[  ]/g,' ');
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const dur=m=>{m=Math.round(m);return m>=60?`${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')}`:`${m} min`;};
const HOT='#e0582a', BLUE='#1972d2', SAND='#c9b9a2', W=650;
const ACOM=ACC?Object.fromEntries(ACC.communes.map(c=>[c.c,c])):{};
/* encre la plus contrastée sur une couleur de ligne : blanche ou foncée */
const lumH=h=>{const n=parseInt(h.slice(1),16),f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(n>>16)+.7152*f(n>>8&255)+.0722*f(n&255);};
const inkOn=h=>{const L=lumH(h);return (1.05/(L+.05))>=((L+.05)/(lumH('#1a2233')+.05))?'#fff':'#1a2233';};
window.INKON=inkOn;
const t_=(x,y,s,cls='ax',a='start')=>`<text x="${x}" y="${y}" class="${cls}" text-anchor="${a}">${s}</text>`;
const key=items=>`<div class="ckey">${items.map(([c,l])=>`<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;

/* pictogrammes simples (trait), 24 × 24 */
const ICON={
  chaleur:'<path d="M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z"/><path d="M11.5 10v7"/>',
  bus:'<rect x="4" y="3" width="16" height="14" rx="3"/><path d="M4 10h16M7 21v-4M17 21v-4"/>',
  horloge:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arbre:'<path d="M12 21v-5M6 16h12l-6-11z"/>',
  revenu:'<path d="M17 6.5a6 6 0 1 0 0 11M5 10.5h8M5 13.5h8"/>',
  personne:'<circle cx="12" cy="6" r="3.2"/><path d="M6 21v-5a6 6 0 0 1 12 0v5z"/>'};
/* pictogrammes du récit (trait blanc sur pastille de couleur), 24 × 24 */
const PIC={
  walk:'<circle cx="13" cy="4.5" r="2.2"/><path d="M12 8l-3 5 3 2-1 6M12 8l3 4 3 1M10 15l-3 6"/>',
  wait:'<circle cx="12" cy="4.5" r="2.2"/><path d="M12 8v8M12 16l-2.5 5M12 16l2.5 5M12 10l-3 3M12 10l3 3"/>',
  bus:'<rect x="5" y="4" width="14" height="13" rx="2.5"/><path d="M5 11h14M8 20v-3M16 20v-3"/>',
  train:'<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 10h12M9 20l1.5-3M15 20l-1.5-3"/><circle cx="9.5" cy="13.5" r=".8"/><circle cx="14.5" cy="13.5" r=".8"/>',
  tram:'<rect x="6" y="5" width="12" height="12" rx="2"/><path d="M9 2h6M12 2v3M6 11h12M9 20l1.5-3M15 20l-1.5-3"/>',
  house:'<path d="M4 11l8-7 8 7M6 10v10h12V10M10 20v-5h4v5"/>'};
const pic=(k,x,y,r,fill)=>`<g transform="translate(${x} ${y})"><circle r="${r}" style="fill:${fill}"/><g transform="translate(${-r*.62} ${-r*.62}) scale(${r*1.24/24})" style="fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round">${PIC[k]}</g></g>`;
const sunG=(x,y,r,c)=>`<g transform="translate(${x} ${y})" style="stroke:${c||HOT};stroke-width:${Math.max(1.4,r/6)};stroke-linecap:round"><circle r="${r}" style="fill:${c||HOT}"/>`+
  Array.from({length:8},(_,i)=>{const a=i*Math.PI/4,c1=Math.cos(a),s1=Math.sin(a);return `<line x1="${(c1*r*1.35).toFixed(1)}" y1="${(s1*r*1.35).toFixed(1)}" x2="${(c1*r*1.75).toFixed(1)}" y2="${(s1*r*1.75).toFixed(1)}"/>`;}).join('')+'</g>';
const MODE_S={0:'Tram',1:'Métro',2:'RER',3:'Bus',6:'Câble',7:'Funi.'};
const vehOf=g=>g.ty===3?'bus':g.ty===0?'tram':'train';
const PERSON='M12 2.8a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 1 1 0-6.4zM6 21v-5a6 6 0 0 1 12 0v5z';

/* ---------- la mascotte du guide, en relief (dégradés, reflet, ombre portée) ---------- */
let MID=0;
function mascot(el){const i='m'+(++MID);el.classList.add('masc3');
  el.innerHTML=`<svg viewBox="0 0 64 76"><defs>
    <radialGradient id="${i}b" cx="35%" cy="38%" r="70%"><stop offset="0" stop-color="#8cc8ff"/><stop offset=".55" stop-color="#2a86e0"/><stop offset="1" stop-color="#0b4a96"/></radialGradient>
    <radialGradient id="${i}h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="${i}s" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
    <ellipse class="sh" cx="32" cy="71" rx="17" ry="4" fill="url(#${i}s)"/>
    <g class="fl">
      <path d="M32 3C32 3 9 30 9 45a23 23 0 0 0 46 0C55 30 32 3 32 3z" fill="url(#${i}b)"/>
      <path d="M32 3C32 3 9 30 9 45a23 23 0 0 0 4 13C12 40 26 20 32 3z" fill="#fff" opacity=".12"/>
      <ellipse cx="22" cy="33" rx="6" ry="9" transform="rotate(28 22 33)" fill="url(#${i}h)"/>
      <ellipse class="cheek" cx="18" cy="52" rx="4.2" ry="2.6" fill="#ff8a7a" opacity=".45"/><ellipse class="cheek" cx="46" cy="52" rx="4.2" ry="2.6" fill="#ff8a7a" opacity=".45"/>
      <g class="eyes"><ellipse cx="24" cy="44" rx="5" ry="6" fill="#fff"/><ellipse cx="40" cy="44" rx="5" ry="6" fill="#fff"/>
        <circle cx="25.2" cy="45.3" r="2.8" fill="#14243a"/><circle cx="41.2" cy="45.3" r="2.8" fill="#14243a"/><circle cx="26.2" cy="44" r=".9" fill="#fff"/><circle cx="42.2" cy="44" r=".9" fill="#fff"/></g>
      <g class="mouth"><path d="M27 54.5q5 4.5 10 0q-5 2-10 0z" fill="#0d2a4a"/></g>
      <path class="sweat" d="M54 26c0 0-3.5 4.6-3.5 7a3.5 3.5 0 0 0 7 0c0-2.4-3.5-7-3.5-7z" fill="#bfe6ff" stroke="#5fb0f0" stroke-width=".8"/>
    </g></svg>`;}
window.MASCOT=mascot;
/* texte qui s'écrit, la mascotte parle pendant ce temps */
let typeT=null;
function typeIn(el,txt,m,rm){clearInterval(typeT);el.setAttribute('aria-label',txt);if(rm){el.textContent=txt;return;}let i=0;el.textContent='';m.classList.add('talk');
  typeT=setInterval(()=>{i+=2;el.textContent=txt.slice(0,i);if(i>=txt.length){clearInterval(typeT);m.classList.remove('talk');}},22);}

/* ---------- les chapitres ---------- */
const DEFS={
/* 1. la porte : qui peut rester chez soi ce jeudi (MATSim, vigilance rouge) */
porte:{role:'fil',niv:'rec',mode:'side',k:'La porte',when:R=>R.raptor?null:R.dep+20,
  make(X){const G=window.PROFILS&&PROFILS.groupes;if(!G)return null;const w=X.who,T=Math.round(X.tAt(X.R.dep));
    const rows=[['cadre','Cadres'],['inter','Prof. intermédiaires'],['employe','Employés'],['ouvrier','Ouvriers']];
    let v='<div class="rows10" role="img">';const lab={cadre:'Cadres',inter:'Professions intermédiaires',employe:'Employés',ouvrier:'Ouvriers'};
    rows.forEach(([k,l])=>{const r=Math.round(G[k].reste_canicule/10),me=k===w.cs;
      v+=`<div class="r10${me?' me':''}"><p>${l}${me?` <b>· ${esc(w.n)}</b>`:''}</p><div class="bons">${Array.from({length:10},(_,i)=>`<i class="${i<10-r?'on':''}"></i>`).join('')}</div><p class="r10n"><b>${10-r}</b>/10</p></div>`;});
    v+='</div><div class="ckey"><span><i class="kgo"></i>part</span><span><i class="kst"></i>reste chez soi</span></div>';
    /* genre : parmi les actifs qui ne peuvent ni télétravailler ni décaler leurs horaires, deux sur trois sont des femmes */
    const fem=`<svg viewBox="0 0 13 22" class="g3"><circle cx="6.5" cy="3.6" r="3.2"/><path d="M6.5 7.5 L1 18 h11z"/></svg>`,hom=`<svg viewBox="0 0 13 22" class="g3"><circle cx="6.5" cy="3.6" r="3.2"/><path d="M1 22v-9a5.5 5.5 0 0 1 11 0v9z"/></svg>`;
    v+=`<div class="genre" role="img" aria-label="Parmi les actifs qui ne peuvent ni télétravailler ni décaler leurs horaires, deux sur trois sont des femmes."><span class="gp f">${fem}${fem}</span><span class="gp h">${hom}</span><p><b>2 sur 3 : des femmes</b><small>sans télétravail ni horaires flexibles</small></p><b class="niv mes">Mesuré</b></div>`;
    const g=G[w.cs],r=Math.round(g.reste_canicule/10);
    const GN={cadre:'cadres',inter:'professions intermédiaires',employe:'employés',ouvrier:'ouvriers'}[w.cs],ro=Math.round(g.reste_ordinaire/10);
    return {t:`Il fait déjà ${T} °C. ${w.n} part travailler, comme ${10-r} ${GN} sur 10.`,v,
      alt:'Sur dix personnes de chaque catégorie, combien partent travailler ce jeudi : '+rows.map(([k,l])=>`${l} : ${10-Math.round(G[k].reste_canicule/10)} partent`).join(', ')+'.',
      n:`Parmi les ${GN} : un jour ordinaire, ${ro} sur 10 restent chez eux ; ce jeudi de vigilance rouge, ${r} sur 10.${w.cs!=='cadre'?` Chez les cadres, ${Math.round(G.cadre.reste_canicule/10)} sur 10.`:''}`,
      s:'Simulation MATSim, journée de vigilance rouge'};}},
/* 3. à l'arrêt : l'arrêt dessiné (soleil et température, chaleur du quartier, lieu frais le plus proche, fréquence) */
arret:{role:'fil',niv:'mes',mode:'side',k:'À l’arrêt',when:R=>{const g=R.seg.find(g=>g.k==='wait'&&g.out&&g.t1-g.t0>=60);return g?g.t0+(g.t1-g.t0)*.35:null;},
  make(X){const R=X.R,i=R.seg.findIndex(g=>g.k==='wait'&&g.out&&g.t1-g.t0>=60),g=R.seg[i],s=g.at!=null?X.S[g.at]:null,m=Math.max(1,Math.round((g.t1-g.t0)/60)),w=X.who;
    const T=Math.round(X.tAt(g.t0)),nx=R.seg.slice(i+1).find(x=>x.k==='ride'),W2=340,H2=168,gy=140;
    const aj=s&&s.aj!=null?s.aj:null,df=s&&s.df!=null?s.df:null,fr=s&&s.pointe>0?60/s.pointe:null;
    const chaud=aj==null?'chaleur du quartier : inconnue':aj>=10?'quartier très chaud':aj>=7?'quartier chaud':'chaleur modérée';
    const frais=!s?'lieu frais : inconnu':df!=null&&df<=300?`lieu frais à ${nf(df)} m`:'pas de lieu frais à moins de 300 m';
    const pass=fr==null?'passages : inconnu':fr<1.5?'un passage chaque minute ou presque':`un passage toutes les ${nf(Math.round(fr))} min`;
    const sr=12+Math.max(0,T-24)*1.1,sk=w.sil||{};
    let v=`<svg viewBox="0 0 ${W2} ${H2}" class="cv ill" role="img">`;
    /* sol, vagues de chaleur si le quartier est chaud */
    v+=`<line x1="0" x2="${W2}" y1="${gy}" y2="${gy}" style="stroke:var(--line2);stroke-width:2"/>`;
    if(aj!=null&&aj>=7)for(let k=0;k<(aj>=10?3:2);k++)v+=`<path d="M${120+k*12} ${gy-6} q4 -6 0 -12 q-4 -6 0 -12 q4 -6 0 -12" style="fill:none;stroke:${HOT};stroke-width:2;stroke-linecap:round;opacity:${.85-k*.2}"/>`;
    /* soleil et température */
    v+=sunG(36,34,sr)+`<text x="${36+sr*1.9+4}" y="40" style="font:800 20px var(--font);fill:var(--hot-tx)">${T} °C</text>`;
    /* poteau d'arrêt et la ligne attendue */
    v+=`<line x1="170" x2="170" y1="${gy}" y2="58" style="stroke:var(--tx2);stroke-width:3"/><rect x="146" y="38" width="48" height="24" rx="6" style="fill:${nx?nx.col:'var(--tx2)'}"/>`+
      `<text x="170" y="55" text-anchor="middle" style="font:800 12px var(--font);fill:${nx?inkOn(nx.col):'#fff'}">${esc(nx?((nx.ty===3?'':MODE_S[nx.ty]+' ')+nx.nm):'')}</text>`;
    /* la personne qui attend */
    v+=`<g transform="translate(190 ${gy-58})"><circle cx="12" cy="8" r="7" style="fill:${sk.skin||'#f2cfb1'}"/><path d="M5 8 q0-8 7-8 q7 0 7 8 q-2-4-7-4 q-5 0-7 4z" style="fill:${sk.hair||'#2a1d17'}"/>`+
      `<path d="M3 30 q0-14 9-14 q9 0 9 14v6H3z" style="fill:#22b5a5"/><path d="M8 36v20M16 36v20" style="stroke:#2b3a55;stroke-width:4;stroke-linecap:round"/></g>`;
    v+=`<text x="202" y="${gy+20}" text-anchor="middle" class="lb">attend ${m} min</text>`;
    /* lieu frais : arbre et distance, ou absence */
    const tx=300;
    v+=`<g transform="translate(${tx} ${gy})" style="opacity:${df!=null&&df<=300?1:.35}"><rect x="-3" y="-26" width="6" height="26" style="fill:#7a5a3c"/><circle cx="0" cy="-40" r="20" style="fill:${df!=null&&df<=300?'#2f9e6a':'var(--sil-off)'}"/></g>`;
    if(df!=null&&df<=300)v+=`<path d="M216 ${gy-30} H272" style="stroke:#2f9e6a;stroke-width:2;stroke-dasharray:4 4"/>`;
    v+=`<text x="${tx}" y="${gy+20}" text-anchor="middle" class="lb">${df!=null&&df<=300?`frais à ${nf(df)} m`:s?'aucun lieu frais':'inconnu'}</text>`;
    v+=`<text x="136" y="${gy+20}" text-anchor="middle" class="lb" style="fill:var(--hot-tx)">${aj==null?'':aj>=10?'très chaud':aj>=7?'chaud':''}</text>`;
    v+='</svg>';
    v+=`<p class="ill-n">${esc(g.atN||(s&&s.n)||'Son arrêt')}</p>`;
    const o=X.outNow(g.t0);
    const nO=o?`En ce moment, environ ${nf(Math.round(o/100)*100)} voyageurs attendent ou marchent dehors en Île-de-France (estimé par la simulation).`:'';
    return {t:`${X.hm(g.t0)} : ${w.il==='il'?'il':'elle'} attend ${m} minute${m>1?'s':''} dehors, à ${T} °C.`,v,
      alt:`Dessin de l’arrêt ${g.atN||''} : ${T} °C, ${chaud}, ${frais}, ${pass}.`,n:[pass.charAt(0).toUpperCase()+pass.slice(1)+'.',nO].filter(Boolean).join(' '),
      s:'Institut Paris Région (îlots de chaleur), Ville de Paris et OSM (lieux frais), IDFM (horaires)'};}},
/* les arrêts de son secteur en cercles proportionnels aux voyageurs, sur la carte (cartogramme d'arrêts du site) */
arrets:{role:'apart',niv:'rec',mode:'side',k:'Les arrêts de son trajet',when:R=>{const rs=R.seg.filter(g=>g.k==='ride');if(!rs.length)return null;const g=rs.reduce((a,b)=>(b.t1-b.t0)>(a.t1-a.t0)?b:a);return g.t0+(g.t1-g.t0)*.25;},
  make(X){const r=X.stops();if(!r||!r.tot)return null;const p=Math.round(100*r.ex/r.tot);
    return {raw:{nEx:r.nEx,n:r.n,p},t:p>=5?`Autour de son trajet, ${p} % des voyageurs passent par un arrêt très exposé`:r.nEx?`Le long de son trajet, ${nf(r.nEx)} arrêt${r.nEx>1?'s':''} très exposé${r.nEx>1?'s':''} sur ${nf(r.n)} : un secteur plutôt épargné`:`Le long de son trajet, aucun arrêt très exposé sur ${nf(r.n)}`,
      v:`<div class="ckey" style="margin-top:0"><span><i style="background:${HOT};border-radius:50%"></i>arrêt très exposé (3 fragilités ou plus)</span><span><i style="background:var(--sil-off);border-radius:50%"></i>autre arrêt</span></div>`+
        `<div class="figs" style="margin-top:8px"><div class="hot"><b>${nf(r.nEx)}</b><small>arrêt${r.nEx>1?'s':''} très exposé${r.nEx>1?'s':''}</small></div><div><b style="color:var(--tx)">${nf(r.n)}</b><small>arrêts à moins d’un kilomètre de son trajet</small></div></div>`,
      alt:`Carte des arrêts autour de son trajet, en cercles proportionnels aux voyageurs : ${nf(r.nEx)} arrêts sur ${nf(r.n)} sont très exposés et voient passer ${p} % des voyageurs.`,
      n:`Taille du cercle = voyageurs d’un jour ordinaire. Très exposé = au moins trois fragilités (quartier très chaud, bus sans clim, peu de passages, pas de lieu frais, revenus bas).${r.big?` Le plus fréquenté du secteur : ${esc(r.big[0])}.`:''}`,
      s:'Validations IDFM 2026, critères de fragilité du site',close:()=>X.stopsOff()};}},
/* où vivent les plus exposés : la région redessinée selon ses habitants exposés (cartogramme du site) */
expo:{role:'apart',niv:'rec',mode:'side',k:'Où vivent les plus exposés',when:R=>{const rs=R.seg.filter(g=>g.k==='ride');const g=rs[rs.length-1];return g?g.t0+(g.t1-g.t0)*.85:null;},
  make(X){const C=window.CARTO_COM;if(!C)return null;const Q=cartoShares(C),co0=X.R.hc||X.S[X.R.seg[0].stop].co,me=co0.slice(0,2),D=Q.dep;
    const top=Object.entries(D).sort((a,b)=>(b[1].e-b[1].p)-(a[1].e-a[1].p))[0],dn=DEPN[top[0]]||top[0],md=D[me];
    const pc=v=>nf(100*v);
    return {raw:{dep:D},t:`Redessinée selon ses habitants exposés, la région penche vers ${top[0]==='93'?'la Seine-Saint-Denis':dn} : ${pc(top[1].p)} % des habitants, ${pc(top[1].e)} % des exposés`,
      v:`<div class="pcarto"><canvas id="pcv" role="img" aria-label="${esc(cap1(`${dn} : ${pc(top[1].p)} % des habitants de la région et ${pc(top[1].e)} % des exposés.`))}"></canvas><p class="pcap" id="pcap" aria-hidden="true">carte réelle</p></div>`+
        `<div class="ckey"><span><i style="background:var(--cx-hi)"></i>plus d’exposés que d’habitants</span><span><i style="background:var(--cx-mid)"></i>autant</span><span><i style="background:var(--cx-lo)"></i>moins</span></div>`,
      alt:`Cartogramme : chaque commune a une taille proportionnelle à ses habitants exposés. ${dn} : ${pc(top[1].p)} % des habitants de la région et ${pc(top[1].e)} % des exposés.`+(md&&me!==top[0]?` ${DEPN[me]||me}, où vit ${esc(X.who.n)} : ${pc(md.p)} % des habitants, ${pc(md.e)} % des exposés.`:''),
      n:md&&me!==top[0]?`${cap1(DEPN[me]||me)}, où vit ${esc(X.who.n)} : ${pc(md.p)} % des habitants, ${pc(md.e)} % des exposés. Habitant exposé = qui vit près d’un arrêt cumulant au moins trois fragilités.`:'Habitant exposé = arrêt qui cumule au moins trois fragilités.',
      s:'Cartogramme du site. Sources : Insee, IDFM, Institut Paris Région',after:()=>cartoExpo(C,Q,co0)};}},
/* 5. arrivée : l'aller et le retour en pictogrammes (à pied, attente, à bord), longueur = minutes, même échelle */
arrivee:{role:'fil',niv:'rec',mode:'side',k:'Arrivée',when:R=>R.arr-3,
  make(X){const R=X.R,a=R.agent,w=X.who,SP=window.SPLIT;
    const fromSeg=()=>R.seg.map(g=>({k:g.k,t0:g.t0,t1:g.t1,in:g.k==='walk'&&!!g.indoor,quai:g.k==='wait'&&!!g.indoor,noac:g.k==='ride'&&g.cl===2,ty:g.ty,nm:g.nm}));
    const go=a?a.matin:fromSeg(),back=a&&a.soir&&a.soir.length?a.soir:null;if(!go||!go.length)return null;
    const out=L=>{let p=0,t=0;L.forEach(x=>{const m=(x.t1-x.t0)/60;if(x.k==='walk'&&!x.in)p+=m;else if(x.k==='wait'&&!x.quai)t+=m;});return SP(p,t);};
    const steps=L=>{const S2=[];L.filter(x=>x.t1>x.t0).forEach(x=>{const k=x.k==='walk'?(x.in?'abri':'walk'):x.k==='wait'?(x.quai?'abri':'wait'):'ride',m=(x.t1-x.t0)/60,
      last=S2[S2.length-1];if(last&&last.k===k&&k!=='ride')last.m+=m;else S2.push({k,m,v:x.k==='ride'?vehOf(x):null,noac:!!x.noac,nm:x.nm});});return S2;};
    const tot=L=>steps(L).reduce((s,x)=>s+x.m,0),mx=Math.max(tot(go),back?tot(back):0,1),W2=340,x0=58,x1=W2-6;
    const strip=(L,lab,T,y)=>{const S2=steps(L),o=out(L);let x=x0,v='';
      const sr=6+Math.max(0,T-24)*.55;v+=sunG(18,y+4,sr)+`<text x="18" y="${(y+4+sr*1.8+12).toFixed(0)}" text-anchor="middle" class="lb" style="fill:var(--hot-tx)">${T} °C</text>`;
      v+=`<text x="${x0}" y="${y-18}" class="lb">${lab} · <tspan style="fill:var(--hot-tx);font-weight:800">${o.tot} min dehors</tspan></text>`;
      S2.forEach(st=>{const L2=(x1-x0)*st.m/mx,c=st.k==='walk'||st.k==='wait'?HOT:st.noac?'#c46a2e':'var(--iso-n)';
        v+=`<line x1="${x.toFixed(1)}" x2="${(x+L2).toFixed(1)}" y1="${y+4}" y2="${y+4}" style="stroke:${c};stroke-width:6;stroke-linecap:round${st.k==='wait'?';stroke-dasharray:2 5':''}"/>`;
        if(L2>=20){v+=pic(st.k==='ride'?st.v:st.k==='abri'?'wait':st.k,x+Math.min(L2/2,Math.max(10,L2/2)),y+4,10,st.k==='ride'||st.k==='abri'?(st.noac?'#c46a2e':'var(--iso-n)'):HOT);
          if(L2>=26)v+=`<text x="${(x+L2/2).toFixed(1)}" y="${y+30}" text-anchor="middle" class="ax">${Math.round(st.m)} min</text>`;}
        x+=L2;});
      return v;};
    const Tg=Math.round(X.tAt(go[0].t0)),Ts=back?Math.round(X.tAt(back[0].t0)):null,H2=back?160:86;
    const altAR=`Aller à ${X.hm(go[0].t0)}, ${Tg} °C : ${out(go).tot} minutes dehors.`+(back?` Retour à ${X.hm(back[0].t0)}, ${Ts} °C : ${out(back).tot} minutes dehors.`:'');
    let v=`<svg viewBox="0 0 ${W2} ${H2}" class="cv ill" role="img" aria-label="${esc(altAR)}">`+strip(go,`Aller, ${X.hm(go[0].t0)}`,Tg,34)+(back?strip(back,`Retour, ${X.hm(back[0].t0)}`,Ts,112):'')+'</svg>';
    v+='<div class="ckey"><span><i class="lw"></i>dehors</span><span><i class="lb"></i>à l’abri</span>'+([go,back].some(L=>(L||[]).some(x=>x.noac))?'<span><i class="ln"></i>bus sans clim</span>':'')+'</div>';
    const dm=out(go).tot,db=back?out(back).tot:null;
    return {t:Ts?`Arrivée : ${dm} minutes dehors. Au retour, à ${Ts} °C : ${db} minutes dehors.`:`Arrivée : ${dm} minutes dehors.`,v,
      alt:`Aller : ${dm} minutes dehors.${Ts?` Retour à ${Ts} °C : ${db} minutes dehors.`:''} `+steps(go).map(s=>`${s.k==='walk'?'à pied':s.k==='wait'?'attente':'à bord'} ${Math.round(s.m)} min`).join(', ')+'.',
      n:Ts?'Le retour se fait au plus chaud de la journée.':a?'':'Trajet calculé sur les horaires : le retour du soir n’est pas disponible.',
      s:a?'Simulation MATSim : étapes de ses trajets aller et retour':'Horaires IDFM (hors simulation)'};}},
};
/* sa ligne a-t-elle résisté ? fréquentation pendant la semaine de vigilance rouge (100 = jour normal), mesurée par les validations */
DEFS.ligne={role:'apart',niv:'mes',mode:'side',k:'Sa ligne',q:'Sa ligne a-t-elle résisté à la canicule ?',
  when:R=>{const g=R.seg.find(g=>g.k==='ride');return g?g.t0+(g.t1-g.t0)*.6:null;},
  make(X){const M=window.MATSIM;if(!M||!M.observed)return null;const R=X.R,rides=R.seg.filter(g=>g.k==='ride');if(!rides.length)return null;
    const O=M.observed,LN=M.lines||[],mine=[];
    rides.forEach(g=>{const lab=`${g.ty===3?'Bus':g.ty===2?'RER':g.ty===1?'Métro':g.ty===0?'Tram':'Ligne'} ${g.nm}`;if(mine.some(x=>x.lab===lab))return;
      const L=g.ty===3?LN.find(x=>x.n===g.nm):null;
      const v=L?L.obs:g.ty===3?(g.noac||g.cl===2?O['bus non climatisés']:O['bus climatisés']):O['ferré'];
      mine.push({lab,v,col:g.col,own:!!L,noac:g.ty===3&&(g.noac||g.cl===2)});});
    const ref=[['Trains, RER, métro',O['ferré'],'var(--iso-n)',''],['Bus climatisés',O['bus climatisés'],'#1d8a5c',''],['Bus non climatisés',O['bus non climatisés'],'#d9461d','5 4']];
    const W2=340,H2=190,x0=70,x1=220,Y=v=>16+(H2-40)*(100-v)/(100-50);
    let g=`<svg viewBox="0 0 ${W2} ${H2}" class="cv ill" role="img">`;
    g+=`<text x="${x0}" y="${H2-6}" text-anchor="middle" class="ax">jour normal</text><text x="${x1}" y="${H2-6}" text-anchor="middle" class="ax">vigilance rouge</text>`;
    g+=`<line x1="${x0}" x2="${x0}" y1="10" y2="${H2-22}" style="stroke:var(--line2)"/><line x1="${x1}" x2="${x1}" y1="10" y2="${H2-22}" style="stroke:var(--line2)"/>`;
    ref.forEach(([l,v,c,da])=>{g+=`<line x1="${x0}" x2="${x1}" y1="${Y(100)}" y2="${Y(v)}" style="stroke:${c};stroke-width:2;opacity:.55${da?';stroke-dasharray:'+da:''}"/>`+
      `<text x="${x1+6}" y="${Y(v)+4}" class="ax">${l} ${Math.round(v)}</text>`;});
    mine.slice(0,3).forEach((m,i)=>{g+=`<line x1="${x0}" x2="${x1}" y1="${Y(100)}" y2="${Y(m.v)}" style="stroke:${m.col};stroke-width:5;stroke-linecap:round${m.noac?';stroke-dasharray:8 5':''}"/><circle cx="${x1}" cy="${Y(m.v)}" r="5" style="fill:${m.col};stroke:var(--panel);stroke-width:2"/>`+
      `<text x="${x0-8}" y="${Y(100)+4+i*15}" text-anchor="end" class="lb">${esc(m.lab)}</text>`;});
    g+=`<text x="${x0+4}" y="${Y(100)-6}" class="ax">100</text></svg>`;
    const m0=mine[0],d=Math.round(100-m0.v);
    return {raw:{mine,ref},t:m0.own?`Pendant la vigilance rouge, son ${m0.lab.toLowerCase().replace('rer','RER')} a perdu environ ${d} % de voyageurs.`:`Pendant la vigilance rouge, les lignes comme la sienne (${m0.lab}) ont perdu environ ${d} % de voyageurs.`,
      v:g,
      n:'Indice de fréquentation (100 = jour normal comparable). Limite : le choix des jours de référence peut le décaler de quelques points ; à lire comme un ordre de grandeur.',
      alt:'Graphique en pente de la fréquentation, jour normal puis vigilance rouge : '+mine.map(m=>`${m.lab} ${Math.round(m.v)}`).join(', ')+' ; '+ref.map(r=>`${r[0]} ${Math.round(r[1])}`).join(', ')+'.',
      s:'Validations IDFM, juin 2026 (indice du site)'};}};
/* « Où vivent les plus exposés » (cartogramme déformé) retiré du récit : la forme déformée ne se lisait pas. */
const ORDER=['porte','arret','ligne','arrets','arrivee'];
/* ---------- questions en titre (la réponse est la phrase du personnage) et tableaux de données ---------- */
const Q={porte:'Qui peut rester chez soi ce jeudi ?',arret:'Comment se passe l’attente à son arrêt ?',arrets:'Les arrêts autour de son trajet sont-ils exposés ?',expo:'Où vivent les plus exposés ?',arrivee:'Combien de temps dehors, à l’aller et au retour ?'};
Object.keys(Q).forEach(k=>{if(DEFS[k])DEFS[k].q=Q[k];});
const dtab=(cap,cols,rows)=>`<table class="dtab"><caption>${cap}</caption><thead><tr>${cols.map(c=>`<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
const stepRows=L=>(L||[]).filter(x=>x.t1>x.t0).map(x=>[x.k==='walk'?(x.in?'Couloirs':'À pied'):x.k==='wait'?(x.quai?'Quai souterrain':'Attente dehors'):(x.noac?'Bus sans clim':'À bord')+(x.nm?' ('+esc(x.nm)+')':''),Math.round((x.t1-x.t0)/60)+' min']);
const DATA={
  porte:(X)=>{const G=PROFILS.groupes;return dtab('Part des actifs qui restent chez eux (simulation)',['Catégorie','Jour ordinaire','Jeudi de vigilance rouge'],
    [['Cadres','cadre'],['Professions intermédiaires','inter'],['Employés','employe'],['Ouvriers','ouvrier']].map(([l,k])=>[l,nf(G[k].reste_ordinaire)+' %',nf(G[k].reste_canicule)+' %']))+
    dtab('Actifs sans télétravail ni horaires flexibles (enquête)',['Groupe','Part'],[['Femmes','2 sur 3'],['Femmes qui ne peuvent pas télétravailler','42 %'],['Hommes qui ne peuvent pas télétravailler','32 %']]);},
  arret:(X)=>{const R=X.R,g=R.seg.find(g=>g.k==='wait'&&g.out&&g.t1-g.t0>=60);if(!g)return '';const s=g.at!=null?X.S[g.at]:null;
    return dtab('Son arrêt',['Mesure','Valeur'],[['Arrêt',esc(g.atN||'–')],['Attente',Math.round((g.t1-g.t0)/60)+' min'],['Température',Math.round(X.tAt(g.t0))+' °C'],
      ['Aléa d’îlot de chaleur (sur 17)',s&&s.aj!=null?nf(s.aj,1):'inconnu'],['Lieu frais le plus proche',s&&s.df!=null?nf(s.df)+' m':'inconnu'],['Passages par heure en pointe',s&&s.pointe?nf(s.pointe,1):'inconnu']]);},
  arrets:(X,r)=>r&&r.raw?dtab('Arrêts à moins d’un kilomètre de son trajet',['Mesure','Valeur'],[['Arrêts',nf(r.raw.n)],['Arrêts très exposés',nf(r.raw.nEx)],['Part des voyageurs passant par un arrêt très exposé',r.raw.p+' %']]):'',
  expo:(X,r)=>r&&r.raw?dtab('Part de la région, par département',['Département','Habitants','Habitants exposés'],Object.entries(r.raw.dep).sort((a,b)=>a[0].localeCompare(b[0])).map(([d,x])=>[DEPN[d]?cap1(DEPN[d]):d,nf(100*x.p)+' %',nf(100*x.e)+' %'])):'',
  arrivee:(X)=>{const a=X.R.agent;return dtab('Aller',['Étape','Durée'],stepRows(a?a.matin:X.R.seg))+(a&&a.soir?dtab('Retour',['Étape','Durée'],stepRows(a.soir)):'');},
  ligne:(X,r)=>r&&r.raw?dtab('Fréquentation pendant la vigilance rouge (100 = jour normal)',['Ligne ou groupe','Indice'],[...r.raw.mine.map(m=>[esc(m.lab),Math.round(m.v)]),...r.raw.ref.map(x=>[x[0],Math.round(x[1])])]):''};


/* calendrier : un chapitre par moment ; trop proches, on décale le suivant d'au moins 90 s */
function plan(R){
  const L=[];ORDER.forEach(id=>{let t=null;try{t=DEFS[id].when(R);}catch(e){}if(t!=null&&t>=R.dep&&t<=R.arr)L.push({id,t,shown:false});});
  L.sort((a,b)=>a.t-b.t);const fil=L.filter(x=>DEFS[x.id].role==='fil'),ap=L.filter(x=>DEFS[x.id].role!=='fil');
  for(let i=1;i<fil.length;i++)if(fil[i].t-fil[i-1].t<60)fil[i].t=Math.min(R.arr-5,fil[i-1].t+60);
  const out=[...fil];ap.forEach(x=>{if(x.t<=R.arr-20&&out.every(y=>Math.abs(y.t-x.t)>=90))out.push(x);});out.sort((a,b)=>a.t-b.t);
  let k=0;const of=out.filter(x=>DEFS[x.id].role==='fil').length;out.forEach(x=>{x.fil=DEFS[x.id].role==='fil';if(x.fil){x.num=++k;x.of=of;}});
  return out;
}

/* ---------- page de chapitre ---------- */
const box=document.getElementById('chap'), veil=document.getElementById('veil');
let timer=null, onClose=null, cur=null, prevFocus=null, AUTO=false;
function open(il,X,idx,total,done){
  const d=DEFS[il.id];let r=null;try{r=d.make(X);}catch(e){console.error(e);}
  if(!r){done&&done();return false;}
  cur=r;box.className='hud side';
  const fil=d.role==='fil';box.classList.toggle('apart',!fil);
  document.getElementById('chk').textContent=fil?`${il.num} sur ${il.of} · ${d.q||d.k}`:`En passant · ${d.q||d.k}`;
  let tab='';try{tab=DATA[il.id]?DATA[il.id](X,r):'';}catch(e){}
  if(r.n)tab=(tab||'')+`<p class="dnote">${r.n}</p>`;
  const bd=document.getElementById('chd');bd.hidden=!tab;bd.setAttribute('aria-pressed','false');bd.textContent='Données';
  bd.onclick=()=>{const on=bd.getAttribute('aria-pressed')!=='true';bd.setAttribute('aria-pressed',String(on));bd.textContent=on?'Graphique':'Données';
    const v=document.getElementById('chv');v.innerHTML=on?`<div class="dwrap">${tab}</div>`:r.v;if(!on&&r.after)setTimeout(r.after,30);window.fitPanel&&window.fitPanel(box);};
  const m=document.getElementById('chm');if(!m.firstChild)mascot(m);m.classList.toggle('hot',X.temp()>=30);
  const tmp=document.createElement('div');tmp.innerHTML=r.t;typeIn(document.getElementById('cht'),tmp.textContent,m,X.RM);
  document.getElementById('chv').innerHTML=r.v;{const sv=document.querySelector('#chv [role="img"]');if(sv&&!r.alt)sv.setAttribute('aria-label',tmp.textContent+(r.n?'. '+r.n.replace(/<[^>]+>/g,''):''));else if(sv)sv.setAttribute('aria-label',r.alt);} const nn=document.getElementById('chn');nn.innerHTML='';nn.hidden=true;
  document.getElementById('chs').innerHTML=`<b class="niv ${d.niv}">${d.niv==='mes'?'Mesuré':'Reconstitué'}</b>${esc(r.s||'')}`;
  veil.hidden=true; box.scrollTop=0; box.classList.remove('hold'); box.hidden=false; box.classList.remove('rise'); void box.offsetWidth; if(!X.RM)box.classList.add('rise');
  onClose=done; if(r.after)setTimeout(r.after,60);
  const bar=document.querySelector('#chgo .bar'); bar.style.animation='none'; void bar.offsetWidth; bar.style.animation=X.RM?'none':'';
  clearTimeout(timer); box.classList.toggle('noauto',!AUTO||X.RM); if(AUTO&&!X.RM)timer=setTimeout(close,fil?18000:11000);
  bar.style.animationDuration=fil?'18s':'11s';
  prevFocus=document.activeElement; setTimeout(()=>box.focus({preventScroll:true}),30);
  return true;
}
function close(){clearTimeout(timer);if(box.hidden)return;box.hidden=true;veil.hidden=true;cartoStop=true;if(cur&&cur.close)cur.close();cur=null;const f=onClose;onClose=null;if(f)f();
  const pf=prevFocus;prevFocus=null;(pf&&pf.offsetParent&&pf!==document.body?pf:document.getElementById('pp')).focus({preventScroll:true});}
document.getElementById('chgo').addEventListener('click',close);
box.addEventListener('mouseenter',()=>{clearTimeout(timer);box.classList.add('hold');});
box.addEventListener('focusin',()=>{clearTimeout(timer);box.classList.add('hold');});
['pointerdown','scroll','wheel','touchstart'].forEach(ev=>box.addEventListener(ev,()=>{clearTimeout(timer);box.classList.add('hold');},{passive:true}));
document.addEventListener('keydown',e=>{if(box.hidden)return;if(e.key==='Escape'&&!(e.target.closest&&e.target.closest('input,textarea,select,#bubble'))){e.preventDefault();e.stopPropagation();close();}});

/* ---------- conclusion : les cinq personnes côte à côte, puis les mesures ---------- */
function ending(X,stayed){
  const PR=window.PROFILS,G=PR?PR.groupes:{},w=X.who,L=window.PROFIL?PROFIL.all():[];
  /* minutes dehors de chaque personne ce matin (0 si elle reste chez elle) ; trait = médiane de son groupe parmi ceux qui partent */
  const rows=L.map(p=>{const ww=PROFIL.who(p),a=ww.agent,m=a.reste?0:window.SPLIT(a.m_matin.pied||0,a.m_matin.attente||0).tot;return {p,ww,a,m,med:G[p.cs]?G[p.cs].med_dehors:null};});
  /* son personnage créé : sa ligne en tête, avec ses minutes dehors de ce matin */
  if(w.key==='moi'&&!stayed){const tt=X.totals(X.R.arr);rows.unshift({p:{key:'moi',cs:w.cs},ww:w,a:{reste:false},m:window.SPLIT(tt.pied,tt.att).tot,med:G[w.cs]?G[w.cs].med_dehors:null});}
  const mx=Math.max(20,...rows.map(r=>Math.max(r.m,r.med||0)));
  /* petit soleil lisible : gros disque, rayons courts */
  const sun1=(x,k=1)=>`<g transform="translate(${x} 8) scale(${k})"><circle r="4.6" style="fill:${HOT}"/>`+Array.from({length:8},(_,i)=>{const t=i*Math.PI/4;return `<line x1="${(Math.cos(t)*6).toFixed(1)}" y1="${(Math.sin(t)*6).toFixed(1)}" x2="${(Math.cos(t)*7.6).toFixed(1)}" y2="${(Math.sin(t)*7.6).toFixed(1)}" style="stroke:${HOT};stroke-width:1.5;stroke-linecap:round"/>`;}).join('')+'</g>';
  /* un soleil par minute, en rangées de dix (comme les bonshommes) */
  /* un soleil par minute, sur une seule ligne (resserrés si nombreux) */
  const suns=n=>{n=Math.max(0,n);const per=Math.min(14,Math.max(7,Math.floor(150/Math.max(1,n)))),k=per/16;return `<svg viewBox="0 0 ${Math.max(1,n)*per+4} 16" class="suns" style="width:${Math.max(1,n)*per+4}px;height:16px" aria-hidden="true">`+
    Array.from({length:n},(_,i)=>sun1(i*per+per/2+2,k)).join('')+'</svg>';};
  let v=`<div class="cmp" role="group" aria-label="${esc('Minutes dehors ce matin, un soleil par minute : '+rows.map(r=>`${r.ww.n} (${r.ww.cat}) ${r.a.reste?'reste chez '+r.ww.lui:r.m+' min'}`).join(', '))}">`;
  rows.forEach(r=>{const me=r.p.key===w.key,tag=me?'div':'button';
    v+=`<${tag} ${me?'class="cr me"':`type="button" class="cr fol" data-k="${r.p.key}" aria-label="Suivre ${esc(r.ww.n)}"`}>${window.PROFIL.avatar(r.ww.sil)}<p><b>${esc(r.ww.n)}</b><small>${esc(r.ww.cat)}${me?' · vous':''}</small></p>`+
      `<span class="cs">${r.a.reste?`<svg viewBox="0 0 24 24" class="hm" aria-hidden="true"><g style="fill:none;stroke:var(--tx2);stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${PIC.house}</g></svg><small>reste chez ${r.ww.lui}</small>`:suns(r.m)}</span>`+
      `<b class="cv2">${r.m}<small> min</small></b></${tag}>`;});
  v+=`</div><div class="ckey"><span><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style="vertical-align:-3px">${sun1(8)}</svg> = 1 minute dehors</span></div>`;
  const e=G.employe,c=G.cadre;
  const like=e&&c?`<p class="like">En moyenne, ce matin : <b>${nf(e.dehors_par_personne)} minutes</b> dehors par employé, <b>${nf(c.dehors_par_personne)}</b> par cadre <small>(en comptant 0 pour ceux qui restent chez eux ou ne prennent pas les transports)</small>.</p>`:'';
  const head=`<p class="gq" style="margin:4px 0 6px">Ceux qui ne peuvent pas rester chez eux restent le plus dehors.</p>`;
  if(stayed){const a=w.agent,m=a.m_habituel||{};
    return `<section class="epg" data-p="1" aria-label="Son trajet habituel"><p class="note2">D’habitude, ${esc(w.n)} met ${nf(m.tot)} minutes pour aller travailler, dont ${nf((m.pied||0)+(m.attente||0))} dehors (pointillés sur la carte). Ce jeudi, la simulation ${w.e==='elle'?'la':'le'} fait travailler de chez ${w.lui}.</p></section>`+
      `<section class="epg" data-p="2" aria-label="Les cinq personnes" hidden>${head}${v}${like}</section>`;}
  const M=[['shade','arbre','Ombrager les arrêts'],['freq','horloge','Doubler les passages'],['clim','bus','Climatiser tous les bus']];
  const cards=M.map(([k,ic,l])=>`<button type="button" class="gc" data-k="${k}" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[ic]}</svg><b>${l}</b><small></small></button>`).join('');
  const base=X.sunWith({}),tt=X.totals(X.R.arr),noac=Math.round(tt.noac),dh=window.SPLIT(tt.pied,tt.att).tot;
  /* première page : l'aller et le retour (même dessin que la scène d'arrivée), toujours visible même si la scène a été passée */
  let ar=null;try{ar=DEFS.arrivee.make(X);}catch(e){}
  const pAR=ar?`<section class="epg" aria-label="Aller et retour"><p class="pq">Combien de temps dehors, à l’aller et au retour ?</p><p class="gq" style="margin:2px 0 6px">${esc(ar.t)}</p>${ar.v}<div class="dview" hidden>${DATA.arrivee(X)}${ar.n?`<p class="dnote">${ar.n}</p>`:''}</div></section>`:'';
  /* deuxième page : le soir, le même trajet paraît plus long (une courbe heure par heure, couleur = température) */
  let pSoir='';
  try{const Wd=ACC.window,R=X.R,a=R.agent,hn=R.dep/3600,he=a&&a.soir&&a.soir.length?a.soir[0].t0/3600:17.5;
    const at=h=>{const p=Wd.find(x=>x.h===Math.floor(h)),q=Wd.find(x=>x.h===Math.floor(h)+1)||p;return p?p.ess+(q.ess-p.ess)*(h-Math.floor(h)):null;};
    const vm=at(hn),ve=at(he),d=Math.round(ve-vm);
    if(vm!=null&&ve!=null){const W2=340,H2=170,m={l:6,r:6,t:30,b:22},bw=(W2-m.l-m.r)/Wd.length,v0=Math.min(...Wd.map(x=>x.ess))*.9,v1=Math.max(...Wd.map(x=>x.ess));
      const Y=v=>H2-m.b-(H2-m.t-m.b)*(v-v0)/(v1-v0),hc=T=>T>=38?'#9e2410':T>=34?'#d9461d':T>=30?'#f57b32':T>=27?'#f39a3c':'#e8b04a';
      let g=`<svg viewBox="0 0 ${W2} ${H2}" class="cv ill" role="img" aria-label="Durée ressentie du trajet domicile-travail selon l’heure : ${Math.round(vm)} minutes à ${Math.floor(hn)} h, ${Math.round(ve)} minutes à ${Math.floor(he)} h.">`;
      /* une seule courbe, colorée selon la température de l'heure ; points du départ et du retour */
      const Xh=h=>m.l+bw/2+(h-Wd[0].h)*bw,gid='gs'+Math.round(Math.random()*1e6);
      g+=`<defs><linearGradient id="${gid}" x1="${Xh(Wd[0].h)}" x2="${Xh(Wd[Wd.length-1].h)}" y1="0" y2="0" gradientUnits="userSpaceOnUse">`+Wd.map((x,i)=>`<stop offset="${(i/(Wd.length-1)).toFixed(3)}" stop-color="${hc(x.T)}"/>`).join('')+'</linearGradient></defs>';
      g+=`<path d="${Wd.map((x,i)=>(i?'L':'M')+Xh(x.h).toFixed(1)+' '+Y(x.ess).toFixed(1)).join('')}" style="fill:none;stroke:url(#${gid});stroke-width:5;stroke-linejoin:round;stroke-linecap:round"/>`;
      Wd.forEach(x=>{if(x.h%3===0)g+=`<text x="${Xh(x.h).toFixed(1)}" y="${H2-6}" text-anchor="middle" class="ax">${x.h} h</text>`;});
      const ym=Y(vm),ye=Y(ve);
      g+=`<line x1="${Xh(hn)}" x2="${Xh(he)}" y1="${ym}" y2="${ym}" style="stroke:var(--tx3);stroke-dasharray:3 3"/><line x1="${Xh(he)}" x2="${Xh(he)}" y1="${ym}" y2="${ye+8}" style="stroke:var(--tx);stroke-width:2"/>`+
        `<path d="M${Xh(he)-4} ${ye+11} L${Xh(he)} ${ye+4} L${Xh(he)+4} ${ye+11}" style="fill:var(--tx)"/>`+
        `<text x="${Xh(he)+8}" y="${((ym+ye)/2+5).toFixed(1)}" style="font:800 16px var(--font);fill:var(--hot-tx)">+${d} min</text>`;
      [[hn,vm,'matin'],[he,ve,'retour']].forEach(([h,vv,l])=>{const T=Math.round(X.tAt(h*3600));g+=`<circle cx="${Xh(h)}" cy="${Y(vv)}" r="5.5" style="fill:var(--panel);stroke:var(--tx);stroke-width:2.5"/>`;
        const lab=`${l} · ${T} °C`,tw=lab.length*6.4,cx=Math.max(m.l+tw/2,Math.min(W2-m.r-tw/2,Xh(h))),ty=l==='matin'?Y(vv)+20:Y(vv)-12;
        g+=`<rect x="${(cx-tw/2-3).toFixed(1)}" y="${(ty-12).toFixed(1)}" width="${(tw+6).toFixed(1)}" height="16" rx="4" style="fill:var(--panel)"/><text x="${cx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" class="lb">${lab}</text>`;});
      g+='</svg>';
      pSoir=`<section class="epg" aria-label="Le soir" hidden><div class="dview" hidden>${dtab('Durée ressentie d’un trajet moyen, heure par heure',['Heure','Température','Durée ressentie'],Wd.map(x=>[x.h+' h',Math.round(x.T)+' °C',Math.round(x.ess)+' min']))}<p class="dnote">Hauteur de la ligne = durée « ressentie » d’un trajet domicile-travail moyen : l’attente et la marche au soleil pèsent plus que le temps assis à bord. Couleur = température de l’heure.</p></div><p class="pq">Le retour du soir est-il plus dur ?</p><p class="gq" style="margin:2px 0 6px">Au retour, à ${Math.round(X.tAt(he*3600))} °C, le même trajet paraît ${d} minute${d>1?'s':''} plus long qu’au départ.</p>${g}`+
        `<div class="ckey"><span><i style="background:#e8b04a"></i>frais</span><span><i style="background:#9e2410"></i>38 °C</span></div></section>`;}}catch(e){}
  /* page « demain » : projeté (trajectoire de référence TRACC, Météo-France 2025) */
  const flame=(n,dash)=>Array.from({length:n},()=>`<svg viewBox="0 0 20 24" class="vg${dash?' pj':''}" aria-hidden="true"><path d="M10 1 C10 1 3 9 3 15 a7 7 0 0 0 14 0 C17 9 10 1 10 1z"/></svg>`).join('');
  const pDem=`<section class="epg" aria-label="Demain" hidden><p class="pq">Combien d’étés comme celui-ci, demain ?</p><p class="gq" style="margin:2px 0 6px">Vers 2050, un été comme 2026 serait normal.</p>
    <div class="dem" role="img" aria-label="Aujourd’hui, été exceptionnel. Entre 2030 et 2050, vagues de chaleur cinq fois plus fréquentes : un été comme 2026 serait normal. En 2100, il serait frais, avec des pointes à 48 °C.">
      <div class="dc"><p class="dy">2026</p><div class="vgs">${flame(1,false)}</div><p><b>exceptionnel</b></p></div>
      <div class="dc pjc"><p class="dy">2050</p><div class="vgs">${flame(5,true)}</div><p><b>× 5</b> · normal</p></div>
      <div class="dc pjc"><p class="dy">2100</p><div class="vgs"><span class="thermo">48 °C</span></div><p><b>frais</b></p></div></div>
    <p class="ill-n"><b class="niv proj">Projeté</b> France entière, TRACC</p>
    <div class="dview" hidden>${dtab('Trajectoire de référence (TRACC)',['Horizon','Réchauffement en France','Ce qui change'],[['Aujourd’hui','–','été 2026 : exceptionnel'],['2030 à 2050','+2,7 °C','vagues de chaleur 5 fois plus fréquentes, jusqu’à 48 °C ; un été caniculaire d’aujourd’hui serait normal'],['2100','+4 °C','un été caniculaire d’aujourd’hui serait frais ; Paris aurait le climat de Montpellier']])}<p class="dnote">Trajectoire de réchauffement de référence (TRACC), ministère de la Transition écologique, projections Météo-France 2025. Valeurs pour la France, pas un comptage pour Paris.</p></div></section>`;
  const dCmp=`<div class="dview" hidden>${dtab('Minutes dehors ce matin',['Personne','Catégorie','Minutes'],rows.map(r=>[esc(r.ww.n),esc(r.ww.cat),r.a.reste?'reste chez soi':r.m]))}${like.replace('class="like"','class="dnote"')}</div>`;
  return pAR+pSoir+`<section class="epg" data-p="1" aria-label="Les cinq personnes"${pAR||pSoir?' hidden':''}><p class="pq">Qui passe le plus de temps dehors ?</p>${head}${v}${dCmp}</section><section class="epg" data-p="2" aria-label="À vous d’agir" hidden><p class="pq">Que changerait chaque mesure pour son trajet ?</p><div class="game"><p class="gx">${noac?`${dh} min dehors + ${noac} min en bus sans clim`:`${dh} min dehors`}</p><div class="gcards g3">${cards}</div>
    <div class="gres"><span class="m3" id="gm" aria-hidden="true"></span><div class="gtxt"><p id="gsay" aria-live="polite">Combien de minutes de chaleur reste-t-il ?</p>
      <div class="gbar"><i id="gfill"></i></div></div><span id="gval">${nf(dh+noac)}<small> min</small></span></div><div class="mkey" id="mkey"></div></div></section>`+pDem;
}
/* le jeu : chaque mesure recalcule ses minutes au soleil ou dans un bus chaud */
/* conclusion en pages : onglets visibles en haut (on voit qu'il y a d'autres résultats), bouton « suivant » en bas */
const COURT={'Aller et retour':'Aller-retour','Le soir':'Le soir','Les cinq personnes':'Comparer','À vous d’agir':'Agir','Son trajet habituel':'Habituel','Demain':'Demain'};
function endPages(){const P=[...document.querySelectorAll('#endv .epg')],nav=document.getElementById('enav'),tb=document.getElementById('etabs');if(!nav)return;let i=0;
  tb.innerHTML=P.map((p,j)=>`<button type="button" role="tab" id="etab${j}" aria-controls="epg${j}">${COURT[p.getAttribute('aria-label')]||p.getAttribute('aria-label')}</button>`).join('');
  P.forEach((p,j)=>{p.id='epg'+j;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby','etab'+j);});
  let show=k=>{i=Math.max(0,Math.min(P.length-1,k));P.forEach((p,j)=>p.hidden=j!==i);
    tb.querySelectorAll('[role=tab]').forEach((t,j)=>{t.setAttribute('aria-selected',String(j===i));t.tabIndex=j===i?0:-1;});
    nav.querySelector('.ep').disabled=i===0;const n=nav.querySelector('.en');n.disabled=i===P.length-1;
    n.textContent=i<P.length-1?`Suivant : ${COURT[P[i+1].getAttribute('aria-label')]||'suite'}`:'Dernier résultat';
    nav.querySelectorAll('.ed i').forEach((d,j)=>d.classList.toggle('on',j===i));window.fitPanel&&window.fitPanel(document.getElementById('end'));};
  tb.hidden=nav.hidden=P.length<2;nav.querySelector('.ed').innerHTML=P.map(()=>'<i></i>').join('');
  tb.onclick=e=>{const t=e.target.closest('[role=tab]');if(t)show(+t.id.slice(4));};
  tb.onkeydown=e=>{const d={ArrowRight:1,ArrowLeft:-1}[e.key];if(!d)return;e.preventDefault();show(i+d);tb.querySelectorAll('[role=tab]')[i].focus();};
  const bd=nav.querySelector('.edat');
  const dset=on=>{const sec=P[i],dv=sec.querySelector('.dview');bd.hidden=!dv;if(!dv)return;[...sec.children].forEach(c=>{if(c!==dv&&!c.classList.contains('pq'))c.hidden=on;});dv.hidden=!on;
    bd.setAttribute('aria-pressed',String(on));bd.textContent=on?'Graphique':'Données';window.fitPanel&&window.fitPanel(document.getElementById('end'));};
  bd.onclick=()=>dset(bd.getAttribute('aria-pressed')!=='true');
  const show0=show;show=k=>{if(bd.getAttribute('aria-pressed')==='true')dset(false);show0(k);bd.hidden=!P[i].querySelector('.dview');};
  nav.querySelector('.ep').onclick=()=>show(i-1);nav.querySelector('.en').onclick=()=>show(i+1);show(0);}
function endingInit(X,stayed){
  setTimeout(endPages,0);
  document.querySelectorAll('#endv button.fol').forEach(b=>b.addEventListener('click',()=>{PROFIL.select(b.dataset.k);const ww=PROFIL.who();
    document.getElementById('end').hidden=true;window.__follow&&window.__follow(ww);}));
  if(stayed)return;
  const m=document.getElementById('gm');if(!m)return;mascot(m);m.classList.add('hot');
  const R0=v=>Math.round(v),base=R0(X.sunWith({})),on={};
  const cardTxt=()=>document.querySelectorAll('.gc').forEach(b=>{const k=b.dataset.k,o2=Object.assign({},on,{[k]:!on[k]}),g=on[k]?R0(X.sunWith(o2))-R0(X.sunWith(on)):R0(X.sunWith(on))-R0(X.sunWith(o2));
    const dehors=X.R.seg.some(s=>s.k==='wait'&&s.out);
    b.querySelector('small').textContent=g>0?`−${g} min`:k==='clim'&&!X.R.seg.some(s=>s.noac)?'0 min : aucun bus sans clim ce matin':(k==='shade'||k==='freq')&&!dehors?'0 min : ses attentes sont sous terre, à l’abri':Object.keys(on).some(x=>on[x]&&x!==k)?'0 min de plus':'0 min';});
  document.querySelectorAll('.gc').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.k;on[k]=!on[k];b.setAttribute('aria-pressed',String(!!on[k]));upd();}));
  const upd=function(){const mm=X.measMap(on),d=R0(X.sunWith(on)),g=base-d,ks=Object.keys(on).filter(k=>on[k]),w=X.who;cardTxt();
    document.getElementById('gfill').style.width=(base>0?clamp(d/base)*100:0).toFixed(1)+'%';
    document.getElementById('gval').innerHTML=`${nf(d)}<small> min</small>`;
    m.classList.toggle('hot',d>base*.65);
    const onlyClim=ks.length===1&&ks[0]==='clim';
    document.getElementById('gsay').innerHTML=!ks.length?'Combien de minutes de chaleur reste-t-il ?':
      g<=0?'Aucun effet sur ce trajet : sa chaleur se prend à pied.':`<b>${g} minute${g>1?'s':''} de chaleur en moins</b> pour ${esc(w.n)}${onlyClim?', à bord':''}. ${ks.every(k=>k!=='clim')?'':''}`;legend(mm);}
  upd();
  function legend(mm){const k=[];
    if(on.shade)k.push('<span><i class="dot g"></i>ses arrêts à l’ombre</span>');
    if(on.freq)k.push('<span><i class="glow"></i>2 fois plus de passages</span>');
    if(on.clim)k.push(mm.nC?'<span><i class="cb"></i>son bus climatisé</span>':'<span>pas de bus sans clim sur son trajet</span>');
    const el=document.getElementById('mkey');el.innerHTML=k.length?'<b>Sur la carte</b>'+k.join(''):'';window.fitPanel&&window.fitPanel(document.getElementById('end'));}
}

/* ---------- cartogramme : parts des habitants et des exposés, calculées sur les surfaces du cartogramme ---------- */
const cap1=s=>s.charAt(0).toUpperCase()+s.slice(1);
const DEPN={'75':'Paris','77':'la Seine-et-Marne','78':'les Yvelines','91':'l’Essonne','92':'les Hauts-de-Seine','93':'la Seine-Saint-Denis','94':'le Val-de-Marne','95':'le Val-d’Oise'};
let QS=null;
function cartoShares(C){if(QS)return QS;const B=C.base;
  const area=D=>C.iris.map(rr=>rr.reduce((a,poly)=>{const r=poly[0];let s2=0;for(let k=0;k<r.length;k++){const i=r[k],q=r[(k+1)%r.length];s2+=(B[2*i]+D[2*i])*(B[2*q+1]+D[2*q+1])-(B[2*q]+D[2*q])*(B[2*i+1]+D[2*i+1]);}return a+Math.abs(s2)/2;},0));
  const E=area(C.modes.expo.d),P=area(C.modes.pop.d),te=E.reduce((a,b)=>a+b,0),tp=P.reduce((a,b)=>a+b,0),dep={};
  C.codes.forEach((c,k)=>{const d=c.slice(0,2),x=dep[d]=dep[d]||{e:0,p:0};x.e+=E[k]/te;x.p+=P[k]/tp;});
  return QS={dep,ratio:C.codes.map((c,k)=>(E[k]/te)/Math.max(1e-9,P[k]/tp))};}
async function cartoExpo(C,Q,co){
  const cv=document.getElementById('pcv'),cap=document.getElementById('pcap');if(!cv)return;
  const dark=document.documentElement.dataset.theme==='dark'||(!document.documentElement.dataset.theme&&matchMedia('(prefers-color-scheme: dark)').matches);
  const HI=dark?'#e8743b':'#d9581f',MID=dark?'#4a4f57':'#e2dcd2',LO=dark?'#5a7593':'#9fb4c9';
  const css=getComputedStyle(document.documentElement),INK=css.getPropertyValue('--tx').trim()||'#25303b',PAN=css.getPropertyValue('--panel').trim()||'#fff';
  const dpr=Math.min(2,window.devicePixelRatio||1),w=cv.clientWidth||640,h=cv.clientHeight||240;cv.width=w*dpr;cv.height=h*dpr;const g=cv.getContext('2d');g.scale(dpr,dpr);
  const B=C.base,D=C.modes.expo.d,n=B.length/2;let x0=1e12,x1=-1e12,y0=1e12,y1=-1e12;
  for(let i=0;i<n;i++)for(const t of [0,1]){const x=B[2*i]+D[2*i]*t,y=B[2*i+1]+D[2*i+1]*t;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  const sc=Math.min((w-16)/(x1-x0),(h-16)/(y1-y0)),ox=(w-(x1-x0)*sc)/2,oy=(h-(y1-y0)*sc)/2;
  const fill=Q.ratio.map(r=>r>=1.25?HI:r<=.8?LO:MID);
  const DEPS=[...new Set(['93','95','75',String(co||'').slice(0,2)])].filter(Boolean);
  const draw=t=>{g.clearRect(0,0,w,h);const P=i=>[ox+(B[2*i]+D[2*i]*t-x0)*sc,oy+(y1-(B[2*i+1]+D[2*i+1]*t))*sc];
    const path=rr=>{g.beginPath();rr.forEach(poly=>poly.forEach(ring=>{ring.forEach((i,k)=>{const p=P(i);k?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]);});g.closePath();}));};
    C.iris.forEach((rr,j)=>{path(rr);g.fillStyle=fill[j];g.fill();g.strokeStyle=dark?'rgba(0,0,0,.35)':'rgba(255,255,255,.6)';g.lineWidth=.4;g.stroke();});
    /* noms des départements qui comptent pour le récit, et sa commune */
    if(t>.6){g.globalAlpha=Math.min(1,(t-.6)/.3);DEPS.forEach(d=>{let sx=0,sy=0,m=0;C.codes.forEach((c,k)=>{if(c.slice(0,2)!==d)return;C.iris[k].forEach(poly=>poly[0].forEach(i=>{const p=P(i);sx+=p[0];sy+=p[1];m++;}));});if(!m)return;
      const nm={'75':'Paris','77':'Seine-et-Marne','78':'Yvelines','91':'Essonne','92':'Hauts-de-Seine','93':'Seine-Saint-Denis','94':'Val-de-Marne','95':'Val-d’Oise'}[d];g.font='800 12.5px Raleway, sans-serif';const tw=g.measureText(nm).width;
      g.fillStyle=PAN;g.globalAlpha*=.92;g.fillRect(sx/m-tw/2-5,sy/m-12,tw+10,17);g.globalAlpha=Math.min(1,(t-.6)/.3);g.fillStyle=INK;g.fillText(nm,sx/m-tw/2,sy/m+1);});g.globalAlpha=1;}
    const k=C.codes.indexOf(co);if(k>=0){path(C.iris[k]);g.strokeStyle=INK;g.lineWidth=2.4;g.stroke();}};
  cartoStop=false;const rm=window.matchMedia('(prefers-reduced-motion:reduce)').matches,dl=rm?0:900,du=rm?0:2600,t0=performance.now();
  draw(rm?1:0);if(cap)cap.textContent=rm?'redessinée selon les habitants exposés':'carte réelle';if(rm)return;
  const step=now=>{if(cartoStop)return;const f=clamp((now-t0-dl)/du),e=f<.5?2*f*f:1-Math.pow(-2*f+2,2)/2;draw(e);if(cap&&f>.5)cap.textContent='redessinée selon les habitants exposés';if(f<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}

/* ---------- cartogramme animé : de la carte réelle aux habitants exposés ---------- */
let cartoP=null, cartoStop=false;
function loadCarto(){if(window.CARTO_COM)return Promise.resolve(window.CARTO_COM);if(cartoP)return cartoP;
  return cartoP=new Promise(res=>{const s=document.createElement('script');s.src='../../web/data/carto_com.js';s.onload=()=>res(window.CARTO_COM);s.onerror=()=>res(null);document.head.appendChild(s);});}
window.PAGES={setAuto:v=>{AUTO=v;},title:id=>DEFS[id]?DEFS[id].k:'',plan,open,close,ending,endingInit,isOpen:()=>!box.hidden,levers:()=>MATSIM?MATSIM.levers:[],climRank:nm=>SIM?SIM.clim_rank.findIndex(r=>r.n===nm):-1};
})();
