(function(){const r=document.createElement("link").relList;if(r&&r.supports&&r.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))n(t);new MutationObserver(t=>{for(const i of t)if(i.type==="childList")for(const l of i.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&n(l)}).observe(document,{childList:!0,subtree:!0});function s(t){const i={};return t.integrity&&(i.integrity=t.integrity),t.referrerPolicy&&(i.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?i.credentials="include":t.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function n(t){if(t.ep)return;t.ep=!0;const i=s(t);fetch(t.href,i)}})();const o=[{dossier:"eau",page:"index-eau.html",titre:"Accès à l'eau",pastille:{texte:"💧",fond:"#dbe8f6"},texte:"Est-il facile d'accéder à un point d'eau au niveau de chaque station ? Quelles lignes offrent un bon accès sur tout le trajet ?"},{dossier:"air",page:"index-air.html",titre:"Qualité de l'air",pastille:{texte:"≋",fond:"#d8f0e0"},texte:"Quelle est la pollution aux particules fines sur les quais ? De la ligne la moins polluée à la plus polluée."},{dossier:"fauteuils",page:"index-fauteuils.html",titre:"Accessibilité en fauteuil",pastille:{texte:"♿",fond:"#e3e9f7"},texte:"Chaque station est-elle accessible en fauteuil roulant, seul ou avec assistance ?"},{dossier:"ligne7",page:"index-l7.html",titre:"Ligne 7, station par station",pastille:{texte:"7",fond:"#fa9aba"},texte:"Une rame parcourt la ligne 7 : à chaque station, la qualité de l'air sur le quai et la présence d'une fontaine."}],c=e=>`${e.dossier}/`,a=e=>e.replace(/[&<>"]/g,r=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[r]),u=[{nom:"violences",titre:"Affiche violences",carte:null},{nom:"eau",titre:"Affiche eau",carte:"eau"},{nom:"air",titre:"Affiche air",carte:"air"},{nom:"fauteuils",titre:"Affiche fauteuils",carte:"fauteuils"},{nom:"ligne7",titre:"Affiche ligne 7",carte:"ligne7"}],f=e=>`
  <a class="fiche" href="${c(e)}" target="_blank" rel="noopener">
    <div class="tete">
      <span class="pastille" style="background:${e.pastille.fond}" aria-hidden="true">${e.pastille.texte}</span>
      <h3>${a(e.titre)}</h3>
    </div>
    <div class="capture"><img src="captures/${e.dossier}.png" width="2204" height="1564" alt="Capture d'écran : ${a(e.titre)}" loading="lazy" onerror="this.remove()" /></div>
    <p class="texte">${a(e.texte)}</p>
    <span class="lien">Voir la carte ↗</span>
  </a>`;document.getElementById("cartes").insertAdjacentHTML("beforeend",u.map(e=>{const r=o.find(s=>s.dossier===e.carte);return`
  <figure class="affiche">
    <figcaption>${a(e.titre)}</figcaption>
    <div class="cadre"><img src="affiches/${e.nom}.png" alt="${a(e.titre)}" loading="lazy" onerror="this.remove()" /></div>
    <a class="lien" href="affiches/${e.nom}.png" target="_blank" rel="noopener">Voir l'affiche ↗</a>
  </figure>
  ${r?f(r):"<div></div>"}`}).join(""));
