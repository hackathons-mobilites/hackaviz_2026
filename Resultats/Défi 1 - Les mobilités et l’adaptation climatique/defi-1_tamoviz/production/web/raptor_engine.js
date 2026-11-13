/* RAPTOR (Delling, Pajor, Werneck 2012) sur les horaires GTFS IDFM, arrêts = zones d'arrêt.
   Chaque étiquette garde le temps à bord, d'attente et de marche du meilleur trajet : on en déduit les minutes passées dehors.
   Utilisable dans la page (window.RaptorEngine) et dans Node pour les tests. */
(function(root){
function build(RP){
  const ns=RP.ns, sp=Array.from({length:ns},()=>[]);
  RP.pat.forEach((p,pi)=>p.s.forEach((s,i)=>sp[s].push(pi,i)));
  return {RP,ns,sp};
}
/* sources : [[zone, secondes de marche d'accès]], dep : heure de départ (s) ; opt : {v, maxTransfer, rounds, tmax} */
function query(E,sources,dep,opt){
  const {RP,ns,sp}=E, K=opt.rounds||5, v=opt.v||1.25, maxTr=opt.maxTransfer||400, tmax=dep+(opt.tmax||7200), slack=opt.slack||60;
  const INF=1e15, star=new Float64Array(ns).fill(INF), bIvt=new Float64Array(ns), bWait=new Float64Array(ns), bWalk=new Float64Array(ns), bRound=new Int8Array(ns).fill(-1);
  let prev=new Float64Array(ns).fill(INF), pIvt=new Float64Array(ns), pWait=new Float64Array(ns), pWalk=new Float64Array(ns);
  let marked=[];
  /* traçage optionnel des itinéraires : par tour, d'où vient chaque étiquette */
  const TR=opt.trace?{ride:[],walk:[]}:null;
  for(const [z,w] of sources){ const t=dep+w; if(t<prev[z]){ prev[z]=t; pWalk[z]=w; pIvt[z]=0; pWait[z]=0; if(t<star[z]){star[z]=t;bIvt[z]=0;bWait[z]=0;bWalk[z]=w;bRound[z]=0;} marked.push(z);} }
  for(let k=1;k<=K&&marked.length;k++){
    const cur=new Float64Array(ns).fill(INF), cIvt=new Float64Array(ns), cWait=new Float64Array(ns), cWalk=new Float64Array(ns);
    /* motifs à parcourir, depuis le premier arrêt marqué */
    const Q=new Map();
    const SK=opt.skip||null;
    for(const s of marked){ const L=sp[s]; for(let j=0;j<L.length;j+=2){ const pi=L[j], i=L[j+1]; if(SK&&SK[pi]) continue; const q=Q.get(pi); if(q===undefined||i<q) Q.set(pi,i); } }
    const newMarked=new Set();
    const rideK=TR?new Map():null, walkK=TR?new Map():null; if(TR){ TR.ride[k]=rideK; TR.walk[k]=walkK; }
    for(const [pi,i0] of Q){
      const P=RP.pat[pi], S=P.s, n=S.length, NT=P.n, D=P.t, A=P.a;
      let tr=-1, depB=0, ivtB=0, waitB=0, walkB=0, bi=-1;
      for(let i=i0;i<n;i++){
        const s=S[i];
        if(tr>=0){ const at=A[tr*n+i];
          if(at<star[s]&&at<=tmax){ cur[s]=at; star[s]=at; const ivt=ivtB+(at-depB);
            cIvt[s]=ivt; cWait[s]=waitB; cWalk[s]=walkB; bIvt[s]=ivt; bWait[s]=waitB; bWalk[s]=walkB; bRound[s]=k; newMarked.add(s); if(TR) rideK.set(s,[pi,bi,tr,i]); } }
        const ready=prev[s]+(k>1?slack:0);
        if(prev[s]<INF&&(tr<0||ready<=D[tr*n+i])){
          /* première course qui part après « ready » (horaires croissants par arrêt) */
          let lo=0, hi=(tr<0?NT:tr)-1, best=-1;
          while(lo<=hi){ const m=(lo+hi)>>1; if(D[m*n+i]>=ready){ best=m; hi=m-1; } else lo=m+1; }
          if(best>=0&&(tr<0||best<tr)){ tr=best; depB=D[best*n+i]; ivtB=pIvt[s]; waitB=pWait[s]+(depB-prev[s]); walkB=pWalk[s]; bi=i; }
        }
      }
    }
    /* correspondances à pied */
    const base=[...newMarked];
    for(const s of base){ const F=RP.fp[s]; for(const [nb,m] of F){ if(m>maxTr) continue; const t=cur[s]+m/v;
        if(t<star[nb]&&t<=tmax){ cur[nb]=t; star[nb]=t; cIvt[nb]=cIvt[s]; cWait[nb]=cWait[s]; cWalk[nb]=cWalk[s]+m/v;
          bIvt[nb]=cIvt[nb]; bWait[nb]=cWait[nb]; bWalk[nb]=cWalk[nb]; bRound[nb]=k; newMarked.add(nb); if(TR) walkK.set(nb,[s,m]); } } }
    prev=cur; pIvt=cIvt; pWait=cWait; pWalk=cWalk; marked=[...newMarked];
  }
  return {star,ivt:bIvt,wait:bWait,walk:bWalk,round:bRound,dep,trace:TR};
}
/* itinéraire vers la zone z : liste de segments {type:'ride'|'walk', ...} du départ à l'arrivée */
function journey(E,res,z){
  const TR=res.trace; if(!TR||res.round[z]<0) return null;
  const segs=[]; let s=z, k=res.round[z], guard=0;
  while(k>0&&guard++<40){
    const w=TR.walk[k]&&TR.walk[k].get(s);
    if(w){ segs.push({type:'walk',from:w[0],to:s,m:w[1]}); s=w[0]; continue; }
    const r=TR.ride[k]&&TR.ride[k].get(s); if(!r) break;
    const [pi,bi,tr,ai]=r, P=E.RP.pat[pi], n=P.s.length;
    segs.push({type:'ride',pat:pi,from:P.s[bi],to:P.s[ai],dep:P.t[tr*n+bi],arr:P.a[tr*n+ai],stops:P.s.slice(bi,ai+1)});
    s=P.s[bi]; k--;
  }
  segs.push({type:'access',to:s}); return segs.reverse();
}
root.RaptorEngine={build,query,journey};
})(typeof window!=='undefined'?window:globalThis);
