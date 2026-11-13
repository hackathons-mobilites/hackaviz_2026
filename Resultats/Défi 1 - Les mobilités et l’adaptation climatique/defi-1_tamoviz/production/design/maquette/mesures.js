/* Écran « Mesures » : carte illustrative, graphique des mesures, organigramme, questions du guide. */
const {$,RM,wait,css}=UI;
const map=L.map('map',{zoomControl:false,attributionControl:true}).setView([48.80,2.40],10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© contributeurs OpenStreetMap',maxZoom:17}).addTo(map);
const H=[1,2,3,4,5].map(i=>css('--heat-'+i));
const DOTS=L.featureGroup().addTo(map);
let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
for(let k=0;k<140;k++){const a=rnd()*6.283,r=Math.sqrt(rnd())*0.42,lat=48.83+r*Math.sin(a)*.62,lng=2.36+r*Math.cos(a);
  const c=Math.min(4,Math.floor((1-r/0.42)*3+rnd()*2.2));
  L.circleMarker([lat,lng],{radius:4+rnd()*6,color:'#fff',weight:1,fillColor:H[c],fillOpacity:.9}).addTo(DOTS);}
/* tablette et téléphone : la carte est petite, on garde les points hors de la note et de la légende posées dessus.
   Deux cadrages possibles : entre la note (haut) et la légende (bas), ou à droite de la légende quand la carte est large ; on garde le plus grand. */
const fitPad=()=>{if(!UI.compact())return{padding:[16,16]};const n=$('#wmap .mnote'),l=$('#wmap .legend'),z=$('#wmap .zl'),m=$('#map').getBoundingClientRect();
  const A={paddingTopLeft:[12,(n?n.offsetHeight+8:0)+12],paddingBottomRight:[12,(l?l.offsetHeight+8:0)+12]};
  if(!l||!n)return A;
  const lr=Math.max(l.getBoundingClientRect().right,n.getBoundingClientRect().right)-m.left,
        B={paddingTopLeft:[lr+12,(z?z.offsetHeight+8:0)+12],paddingBottomRight:[12,12]};
  if(m.width-lr<120)return A;
  const zz=o=>map.getBoundsZoom(DOTS.getBounds(),false,L.point(o.paddingTopLeft).add(o.paddingBottomRight));
  return zz(B)>zz(A)?B:A;};
/* tablette et téléphone : zoom fractionnaire pour que les cercles remplissent la petite carte */
const fitDots=(animate=false)=>{map.options.zoomSnap=UI.compact()?.25:1;const p=fitPad();map.fitBounds(DOTS.getBounds(),Object.assign({},p,{animate}));
  /* petite carte : tous les cercles réduits dans la même proportion, pour qu'ils restent lisibles sans se recouvrir */
  const fh=map.getSize().y-(p.padding?32:p.paddingTopLeft[1]+p.paddingBottomRight[1]),k=UI.compact()?Math.max(.5,Math.min(1,fh/260)):1;
  DOTS.eachLayer(c=>{c.options.r0=c.options.r0||c.options.radius;c.setRadius(c.options.r0*k);});};
fitDots();
/* la carte change de taille sans redimensionnement de la fenêtre (mise en page empilée, polices, fenêtre agrandie) : on la recadre */
{let lw=0,lh=0;new ResizeObserver(()=>{const el=$('#map'),w=el.offsetWidth,h=el.offsetHeight;if(!w||!h||(w===lw&&h===lh))return;lw=w;lh=h;
  map.invalidateSize({pan:false});fitDots();}).observe($('#map'));}

/* barres divergentes : écart à la canicule sans mesure */
const D={dose:{t:'Dose de chaleur totale, en %',u:' %',v:[['Horaires décalés',-9.0],['Fréquence',1.1],['Bus climatisés',2.7]]},
         nav:{t:'Navetteurs en transport en commun',u:'',v:[['Horaires décalés',-114100],['Fréquence',36300],['Bus climatisés',38100]]}};
const nfs=(v,d=0)=>(v<0?'−':'+')+Math.abs(v).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d}).replace(/\u202f/g,'\u00a0');
const curK=()=>document.querySelector('.seg [aria-pressed="true"]').dataset.k;
function bars(k){const el=$('#bars'),W=Math.max(300,el.clientWidth||420);
  /* tablette et téléphone, fenêtre agrandie : le graphique prend la hauteur libre (lignes plus hautes, barres plus épaisses) */
  const big=UI.compact()&&$('#wres').classList.contains('max'),H=big?Math.max(86,el.clientHeight||86):86,
        rh=big?Math.min(72,(H-8)/3):27,bh=big?Math.min(28,Math.round(rh*.45)):16,fs=big?14:12.5,fv=big?13.5:12;
  el.setAttribute('viewBox','0 0 '+W+' '+H);
  const d=D[k],x0=192,x1=W-64,mn=Math.min(0,...d.v.map(r=>r[1])),mx=Math.max(0,...d.v.map(r=>r[1])),sc=(x1-x0)/(mx-mn),z=x0-mn*sc;
  const y0=big?(H-3*rh)/2:4;
  let o=`<line x1="${z}" x2="${z}" y1="${y0}" y2="${big?y0+3*rh:84}" style="stroke:var(--line2)"/>`;
  d.v.forEach(([l,v],i)=>{const y=y0+i*rh,cy=big?y+rh/2:y+10,w=Math.abs(v)*sc,x=v<0?z-w:z,c=v<0?css('--div-pos'):css('--div-neg');
    o+=`<g class="row" data-l="${l}"><text x="0" y="${big?cy+4.5:y+14}" font-size="${fs}" font-weight="500" style="fill:var(--tx2)">${l}</text>
    <rect x="${x}" y="${cy-bh/2}" width="${w}" height="${bh}" rx="1" fill="${c}"/>
    <text x="${v<0?x-6:x+w+6}" y="${big?cy+4.5:y+14}" font-size="${fv}" font-weight="500" text-anchor="${v<0?'end':'start'}" style="fill:var(--tx)" font-family="IBM Plex Mono">${nfs(v,k==='dose'?1:0)}${d.u}</text></g>`;});
  el.innerHTML=o;$('#rt').textContent=d.t;}
bars('dose');
UI.onResize(()=>{map.invalidateSize();fitDots();bars(curK());});
UI.onReset(()=>fitDots(!RM));
document.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>setSeg(b.dataset.k));
function setSeg(k){document.querySelectorAll('.seg button').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.k===k)));bars(k);}
function hlRow(l){const b=$('#bars');b.classList.add('hl');b.querySelectorAll('.row').forEach(r=>r.classList.toggle('on',r.dataset.l===l));}
UI.onReset(()=>{const b=$('#bars');b.classList.remove('hl');b.querySelectorAll('.row').forEach(r=>r.classList.remove('on'));});

/* sélecteur de scénario */
const sb=$('#scnb'),sm=$('#scnm');
const shut=()=>{sm.hidden=true;sb.setAttribute('aria-expanded','false');};
sb.onclick=e=>{e.stopPropagation();sm.hidden=!sm.hidden;sb.setAttribute('aria-expanded',String(!sm.hidden));
  /* téléphone : la ligne des puces défile, le menu s'ouvre donc en position fixe sous le bouton */
  const fx=!sm.hidden&&UI.compact()&&matchMedia('(max-width:767px)').matches;sm.classList.toggle('fx',fx);
  if(fx){const r=sb.getBoundingClientRect();sm.style.left=Math.max(8,Math.min(innerWidth-8-sm.offsetWidth,r.left))+'px';sm.style.top=r.bottom+6+'px';}
  else{sm.style.left='';sm.style.top='';}};
function pickScen(name){sm.querySelectorAll('button').forEach(x=>x.setAttribute('aria-checked',String(x.firstChild.textContent===name)));$('#scnv').textContent=name;}
sm.querySelectorAll('button').forEach(b=>b.onclick=()=>{pickScen(b.firstChild.textContent);shut();});
document.addEventListener('click',e=>{if(!sm.contains(e.target))shut();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')shut();});

/* organigramme de méthode */
const FL=UI.flow('dia',[['s-pop','p-sim'],['s-gtfs','p-sim'],['s-icu','p-dose'],['s-met','p-dose'],['p-sim','p-dose','v'],['p-dose','p-cmp','v']]);
UI.onReset(()=>FL.lit(null));

/* questions préparées du guide */
const COMMUNES={'saint-denis':[48.936,2.357],'montreuil':[48.861,2.443],'paris':[48.857,2.347],'creteil':[48.790,2.455],'nanterre':[48.892,2.207],'argenteuil':[48.948,2.248],'versailles':[48.805,2.120],'evry':[48.629,2.441],'bobigny':[48.908,2.439],'vincennes':[48.847,2.439],'bagnolet':[48.869,2.418],'aubervilliers':[48.914,2.383]};
const comOf=n=>/de .+ a .+/.test(n)?null:Object.keys(COMMUNES).find(c=>n.includes(c));
const CIBLES={carte:'#wmap .mapbox',legende:'#wmap .legend',methode:'#dia',graphique:'#bars',resultat:'#wres .wb',reglages:'#wmap .chips',recit:'#wres .take'};
const FEN={carte:'#wmap',methode:'#wmeth',resultat:'#wres',reglages:'#wmap'};
UI.guide({
  ecran:'mesures',
  etat:()=>({scenario:$('#scnv').textContent,indicateur:curK()}),
  actions:{
    zoomer_carte:async a=>{map.flyTo([a.lat,a.lon],a.zoom||12,{duration:RM?0:1.2});await wait(1300);},
    mettre_en_avant:async a=>{const e=$(CIBLES[a.cible]||'#wmap .mapbox');if(e)UI.spotOn(e,6);},
    agrandir_fenetre:async a=>{const e=$(FEN[a.fenetre]||'#wmap');if(e){UI.maxi(e);await wait(350);}},
    choisir_scenario:async a=>pickScen(a.nom),
    choisir_indicateur:async a=>setSeg(a.indicateur),
    souligner_mesure:async a=>hlRow(a.mesure),
  },
  welcome:'Posez une question : je vous montre la réponse sur la carte, le graphique ou la méthode.',
  fallback:'Dans cette maquette, je sais répondre à quelques questions. Essayez l’une de celles-ci :',
  sugg:['Que signifie la dose de chaleur ?','Pourquoi les horaires décalés ?','Et si tous les bus étaient climatisés ?','Montre Saint-Denis','D’où viennent les données ?','Montre le cartogramme'],
  intents:[
   {test:comOf,run:async(n,my)=>{const com=comOf(n);
     map.flyTo(COMMUNES[com],13,{duration:RM?0:1.2});await wait(1300);if(my!==UI.current())return;UI.spotOn($('#wmap .mapbox'));
     const nm=com.replace(/(^|-)(\w)/g,(x,a,b)=>a+b.toUpperCase()).replace('Creteil','Créteil').replace('Evry','Évry');
     return ['Voici '+nm+'. Les cercles montrent la dose de chaleur des navetteurs qui y habitent, avec le scénario « '+$('#scnv').textContent.toLowerCase()+' ».',['Que signifie la dose de chaleur ?','Où est-elle la plus forte ?']];}},
   {k:/dose|signifi|veut dire|c est quoi|definition/,run:async()=>{FL.lit('p-dose');UI.spotOn($('#dia'),6);
     return ['La <b>dose de chaleur</b>, c’est le temps passé dehors (marche et attente en surface) multiplié par la chaleur de l’heure et par l’aléa d’îlot de chaleur du lieu. Le métro souterrain ne compte pas.',['Où est-elle la plus forte ?','Pourquoi les horaires décalés ?']];}},
   {k:/plus forte|plus fort|ou est|ou sont|carte/,run:async()=>{map.flyTo([48.92,2.40],12,{duration:RM?0:1.2});await wait(1300);UI.spotOn($('#wmap .mapbox'));
     return ['Au nord-est, autour de Saint-Denis et Aubervilliers : beaucoup de marche et d’attente en surface, sur des îlots très exposés. Les cercles foncés sont les plus fortes doses.',['Montre Montreuil','Que signifie la dose de chaleur ?']];}},
   {k:/horaire|cadre|decal|pourquoi/,run:async()=>{setSeg('dose');pickScen('Horaires décalés');hlRow('Horaires décalés');await wait(200);UI.spotOn($('#wres .wb'));
     return ['Avancer la journée d’une heure fait baisser la dose totale de <b>9 %</b>. Mais ce sont surtout les cadres qui en profitent (−21 %) : les employés gardent leurs horaires (+1 %).',['Et si tous les bus étaient climatisés ?','Agrandis le graphique']];}},
   {k:/clim/,run:async()=>{pickScen('Bus climatisés');setSeg('nav');hlRow('Bus climatisés');await wait(200);UI.spotOn($('#wres .wb'));
     return ['Avec tous les bus climatisés, <b>38 100 navetteurs</b> de plus reprennent les transports. Mais la dose totale monte de 2,7 % : plus de monde attend dehors aux arrêts.',['Pourquoi les horaires décalés ?','Montre Saint-Denis']];}},
   {k:/agrandi|graphique|tableau|detail/,run:async()=>{UI.maxi($('#wres'));await wait(350);UI.spotOn($('#bars'),3);
     return ['Voici le graphique en grand. Chaque barre compare une mesure à la canicule sans mesure ; à gauche, ce qui baisse.',['Pourquoi les horaires décalés ?']];}},
   {k:/source|donnee|d ou vien|vient/,run:async()=>{FL.lit(null);UI.spotOn($('#dia'),6);
     return ['Trois sources publiques se croisent : les navetteurs de l’<b>Insee</b> (MOBPRO 2021), les horaires <b>IDFM</b> (GTFS) et les îlots de chaleur de l’<b>Institut Paris Région</b>. La température vient de Météo-France.',['Que signifie la dose de chaleur ?']];}},
   {k:/trajet|de .+ a .+/,run:async()=>{UI.spotOn($('#wmap .mapbox'));
     return ['Je raconterai votre trajet minute par minute : attente, marche, lignes climatisées ou non, et ce que changerait un départ plus tôt. À l’échelle de la commune ou de l’IRIS seulement.',['Montre Saint-Denis']];}},
  ]});

/* Outils d'interface que l'agent (Claude Agent SDK) appellera plus tard à la place des questions préparées.
   Chaque outil fait une seule action visible et réversible par « Compris » ou Échap. */
window.GUIDE_TOOLS={
  zoomer_carte:({lat,lon,zoom=13})=>{map.flyTo([lat,lon],zoom,{duration:RM?0:1.2});setTimeout(()=>UI.spotOn($('#wmap .mapbox')),RM?0:1300);},
  mettre_en_avant:({selecteur,agrandir=false})=>{const e=$(selecteur);if(!e)return false;if(agrandir)e.classList.add('zoomed');setTimeout(()=>UI.spotOn(e),agrandir?320:0);return true;},
  choisir_scenario:({nom})=>pickScen(nom),
  choisir_indicateur:({indicateur})=>setSeg(indicateur),
  souligner_mesure:({mesure})=>hlRow(mesure),
  agrandir_fenetre:({fenetre})=>UI.maxi($('#'+fenetre)),
  parler:({texte,suggestions=[]})=>UI.speak(texte,suggestions),
  effacer:()=>UI.close(),
};
