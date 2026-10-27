// To do projets : application (rendu, synchronisation, exports).
(function(){
  // Configuration du mode en ligne : voir js/config.js
  const CONFIG=Object.assign({supabaseUrl:"",supabaseKey:"",allowedDomains:[]},window.TODO_CONFIG||{});
  // 16 couleurs bien distinctes ; un nouveau projet prend la première qui n'est pas déjà utilisée
  const COLORS=["#3E7CB1","#C2410C","#2F7D5B","#8E5BB5","#B8860B","#C0396B","#1F8A8A","#4A6272","#D9480F","#5C7CFA","#2B8A3E","#AE3EC9","#E8590C","#0B7285","#A61E4D","#6B7B2A"];
  function nextColor(extra){
    const used=new Set([...state.projects.map(p=>String(p.color||"").toUpperCase()),...(extra||[]).map(c=>String(c).toUpperCase())]);
    const free=COLORS.find(c=>!used.has(c.toUpperCase()));
    if(free)return free;
    // toutes prises : teinte générée, la plus éloignée possible des précédentes (angle d'or)
    const h=Math.round((state.projects.length*137.508)%360);
    const f=(n,k=(n+h/30)%12)=>0.42-0.28*Math.max(Math.min(k-3,9-k,1),-1);
    return "#"+[f(0),f(8),f(4)].map(x=>Math.round(x*255).toString(16).padStart(2,"0")).join("").toUpperCase();
  }
  let state={projects:[],tasks:[],requests:[],points:[],deleted:[]};
  let view="all"; // "all" ou id projet
  let editing=null;
  // Préférences d'affichage : stockées à part, jamais dans le fichier de données
  let ui={mode:"list",showDone:true};
  try{Object.assign(ui,JSON.parse(localStorage.getItem("todo-projets-ui")||"{}"))}catch(e){}
  try{if(window.matchMedia("(max-width:899px)").matches)ui.mode="projects"}catch(e){} // sur téléphone, l'appli s'ouvre sur l'écran Projets
  const saveUi=()=>{try{localStorage.setItem("todo-projets-ui",JSON.stringify(ui))}catch(e){}};
  let weekStart=null; // lundi de la semaine affichée
  const mondayOf=d=>{const x=new Date(d);x.setHours(0,0,0,0);const wd=(x.getDay()+6)%7;x.setDate(x.getDate()-wd);return x};
  const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const isoWeek=d=>{const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const n=x.getUTCDay()||7;x.setUTCDate(x.getUTCDate()+4-n);const y0=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil(((x-y0)/864e5+1)/7)};
  let store=null, docRef=null, pending=null, ready=false;
  const $=s=>document.querySelector(s);
  const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
  const today=()=>{const d=new Date();d.setHours(0,0,0,0);return d};
  const parseD=s=>{if(!s)return null;const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
  const fmtD=s=>{const d=parseD(s);return d?d.toLocaleDateString("fr-FR",{day:"numeric",month:"short"}):""};
  const isLate=t=>t.status!=="done"&&t.status!=="waiting"&&t.due&&parseD(t.due)<today();
  const isToday=t=>t.status!=="done"&&t.due&&parseD(t.due).getTime()===today().getTime();
  const proj=id=>state.projects.find(p=>p.id===id);
  const escRaw=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const esc=s=>escRaw(rtIs(s)?rtText(s):s);
  const live=()=>state.tasks.filter(t=>!t.deletedAt); // tâches hors corbeille
  const isArch=pid=>{const p=proj(pid);return !!(p&&p.archived)};
  const STATUS={todo:"À faire",doing:"En cours",waiting:"En attente",done:"Terminée"};
  const needsRelance=t=>t.status==="waiting"&&t.due&&parseD(t.due)<=today();

  // ---------- Persistance ----------
  function lsLoad(){try{const r=localStorage.getItem("todo-projets");if(r)return JSON.parse(r)}catch(e){}return null}
  let MODE="local"; // "local" ou "cloud"
  function lsSave(){
    try{
      if(MODE==="cloud"){if(cloud.user)localStorage.setItem("todo-cloud:"+cloud.user.id,JSON.stringify({state,dirty:[...cloud.dirty]}))}
      else localStorage.setItem("todo-projets",JSON.stringify(state));
    }catch(e){}
  }
  // ---------- Suivi des changements (pour fusionner à plusieurs) ----------
  let snap=new Map();
  const bare=o=>{const c={...o};delete c.updatedAt;return JSON.stringify(c)};
  function resetSnap(){snap=new Map();state.projects.forEach(p=>snap.set("p:"+p.id,bare(p)));state.tasks.forEach(t=>snap.set("t:"+t.id,bare(t)));(state.requests||[]).forEach(r=>snap.set("r:"+r.id,bare(r)));(state.points||[]).forEach(o=>snap.set("o:"+o.id,bare(o)))}
  function stamp(){
    const t0=Date.now(), seen=new Set(), changed=[], removed=[];
    const chk=(k,o)=>{seen.add(k);const prev=snap.get(k);if(prev!==bare(o)){if(MODE!=="cloud"&&k[0]==="t")logLocal(o,prev);o.updatedAt=t0;snap.set(k,bare(o));changed.push(k)}};
    state.projects.forEach(p=>chk("p:"+p.id,p));
    state.tasks.forEach(t=>chk("t:"+t.id,t));
    if(!Array.isArray(state.requests))state.requests=[];
    state.requests.forEach(r=>chk("r:"+r.id,r));
    if(!Array.isArray(state.points))state.points=[];
    state.points.forEach(o=>chk("o:"+o.id,o));
    for(const k of [...snap.keys()])if(!seen.has(k)){snap.delete(k);removed.push(k);if(MODE!=="cloud")state.deleted.push({id:k.slice(2),at:t0})}
    return {changed,removed};
  }
  // Fusion tâche par tâche : la version la plus récente l'emporte, les suppressions sont propagées
  function merge(local,remote){
    const tomb=new Map();
    [...(remote.deleted||[]),...(local.deleted||[])].forEach(d=>{if(d&&d.id&&(!tomb.has(d.id)||tomb.get(d.id)<d.at))tomb.set(d.id,d.at)});
    const pick=(a,b)=>{
      const m=new Map(), seen=new Set(), order=[];
      [...a,...b].forEach(o=>{if(!seen.has(o.id)){seen.add(o.id);order.push(o.id)}});
      b.forEach(o=>m.set(o.id,o));
      a.forEach(o=>{const r=m.get(o.id);if(!r||(o.updatedAt||0)>(r.updatedAt||0))m.set(o.id,o)});
      return order.map(id=>m.get(id)).filter(o=>!(tomb.has(o.id)&&tomb.get(o.id)>=(o.updatedAt||0)));
    };
    const limit=Date.now()-120*864e5;
    return {
      projects:pick(local.projects,remote.projects),
      tasks:pick(local.tasks,remote.tasks),
      requests:pick(local.requests||[],remote.requests||[]),
      points:pick(local.points||[],remote.points||[]),
      deleted:[...tomb].filter(([,at])=>at>limit).map(([id,at])=>({id,at}))
    };
  }
  const canon=d=>JSON.stringify([d.projects,[...d.tasks].sort((a,b)=>a.id<b.id?-1:1),[...(d.requests||[])].sort((a,b)=>a.id<b.id?-1:1),[...(d.points||[])].sort((a,b)=>a.id<b.id?-1:1),[...d.deleted].sort((a,b)=>a.id<b.id?-1:1)]);
  function applyState(d){state=d;resetSnap();lsSave();if(editing&&!state.tasks.some(t=>t.id===editing))editing=null;if(editingReq&&!(state.requests||[]).some(r=>r.id===editingReq))editingReq=null;if(editingPt&&!(state.points||[]).some(o=>o.id===editingPt))editingPt=null;render()}

  let fileHandle=null, fileTimer=null, fileOk=false, fileBusy=false, lastMod=0;
  const FSA="showSaveFilePicker" in window;
  function save(){
    const ch=stamp();
    if(MODE==="cloud"){cloud.queue(ch);lsSave();cloud.flush();return}
    lsSave();
    if(fileHandle&&fileOk){
      clearTimeout(fileTimer); setSync("Enregistrement…");
      fileTimer=setTimeout(()=>{fileTimer=null;writeFile()},400);
    } else setSync("Enregistré dans ce navigateur · "+now());
  }
  const now=()=>new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
  const payload=d=>JSON.stringify({app:"todo-projets",version:2,savedAt:new Date().toISOString(),projects:d.projects,tasks:d.tasks,requests:d.requests||[],points:d.points||[],deleted:d.deleted},null,2);
  // Écriture : on relit d'abord le fichier pour intégrer les changements du collègue
  async function writeFile(){
    if(fileBusy){clearTimeout(fileTimer);fileTimer=setTimeout(()=>{fileTimer=null;writeFile()},300);return}
    fileBusy=true;
    try{
      let remote=null; try{remote=await readFile(fileHandle)}catch(e){}
      const merged=remote?merge(state,remote):state;
      if(canon(merged)!==canon(state))applyState(merged);
      const w=await fileHandle.createWritable();await w.write(payload(merged));await w.close();
      lastMod=(await fileHandle.getFile()).lastModified;
      setSync("Enregistré dans "+fileHandle.name+" · "+now());
    }catch(e){fileOk=false;showFile();setSync("Échec de l'écriture dans le fichier : modifications conservées dans le navigateur. Reconnectez le fichier.")}
    fileBusy=false;
  }
  // Relecture régulière du fichier pour voir les modifications du collègue
  async function pollFile(){
    if(!fileHandle||!fileOk||fileBusy||fileTimer||editing||document.hidden)return;
    fileBusy=true;
    try{
      const f=await fileHandle.getFile();
      if(f.lastModified!==lastMod){
        lastMod=f.lastModified;
        const remote=await readFile(fileHandle);
        if(remote){const merged=merge(state,remote);if(canon(merged)!==canon(state)){applyState(merged);setSync("Mis à jour depuis "+fileHandle.name+" · "+now())}}
      }
    }catch(e){}
    fileBusy=false;
  }
  setInterval(pollFile,10000);
  window.addEventListener("focus",pollFile);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)pollFile()});
  async function readFile(h){
    const f=await h.getFile(); const txt=await f.text();
    if(!txt.trim())return null;
    const d=JSON.parse(txt);
    if(!Array.isArray(d.projects)||!Array.isArray(d.tasks))throw new Error("format");
    return normalize(d);
  }
  // mémorise le lien vers le fichier entre deux ouvertures (IndexedDB)
  function idb(mode,fn){return new Promise((res,rej)=>{const r=indexedDB.open("todo-projets",1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onerror=()=>rej(r.error);r.onsuccess=()=>{try{const tx=r.result.transaction("kv",mode);const st=tx.objectStore("kv");const q=fn(st);tx.oncomplete=()=>res(q&&q.result);tx.onerror=()=>rej(tx.error)}catch(e){rej(e)}}})}
  const keepHandle=h=>idb("readwrite",st=>h?st.put(h,"file"):st.delete("file")).catch(()=>{});
  const loadHandle=()=>idb("readonly",st=>st.get("file")).catch(()=>null);
  async function linkHandle(h,mode){
    fileHandle=h; fileOk=true; await keepHandle(h);
    if(mode==="open"||mode==="resume"){
      try{
        const d=await readFile(h);
        lastMod=(await h.getFile()).lastModified;
        if(!d){save()}
        else if(mode==="open"){view="all";editing=null;applyState(d);setSync("Données chargées depuis "+h.name)}
        else{const merged=merge(state,d);applyState(merged);if(canon(merged)!==canon(d))save();else setSync("Données chargées depuis "+h.name)}
      }
      catch(e){uiAlert("Ce fichier n'est pas un fichier de données To do projets valide.");fileHandle=null;fileOk=false;await keepHandle(null)}
    } else save();
    showFile();
  }
  async function createFile(){
    try{const h=await window.showSaveFilePicker({suggestedName:"todo-projets.json",types:[{description:"Données To do projets",accept:{"application/json":[".json"]}}]});await linkHandle(h,"new")}catch(e){}
  }
  async function openFile(){
    try{const [h]=await window.showOpenFilePicker({types:[{description:"Données To do projets",accept:{"application/json":[".json"]}}]});await linkHandle(h,"open")}catch(e){}
  }
  async function relink(){
    if(!fileHandle)return;
    try{
      const perm=await fileHandle.requestPermission({mode:"readwrite"});
      if(perm==="granted"){await linkHandle(fileHandle,"resume")}
    }catch(e){setSync("Impossible de rouvrir le fichier : utilisez « Ouvrir un fichier ».")}
  }
  async function unlink(){
    if(!await uiConfirm("Délier le fichier ? Vos données restent dans le navigateur et dans le fichier, mais le fichier ne sera plus mis à jour.",{ok:"Délier"}))return;
    fileHandle=null;fileOk=false;await keepHandle(null);showFile();setSync("Fichier délié : enregistrement dans le navigateur uniquement.");
  }
  function showFile(){
    const info=$("#fileinfo"), rl=$("#frelink"), ul=$("#funlink");
    if(!FSA){info.className="fileinfo warn";info.textContent="Ce navigateur ne permet pas l'enregistrement direct dans un fichier. Utilisez Chrome ou Edge, ou les boutons Exporter / Importer.";$("#fnew").hidden=true;$("#fopen").hidden=true;rl.hidden=true;ul.hidden=true;return}
    if(fileHandle&&fileOk){info.className="fileinfo linked";info.textContent="Enregistrement automatique dans : "+fileHandle.name;rl.hidden=true;ul.hidden=false}
    else if(fileHandle){info.className="fileinfo warn";info.textContent="Fichier "+fileHandle.name+" à reconnecter (autorisation demandée par le navigateur).";rl.textContent="Reconnecter "+fileHandle.name;rl.hidden=false;ul.hidden=false}
    else{info.className="fileinfo";info.textContent="Aucun fichier lié : les données sont seulement dans ce navigateur.";rl.hidden=true;ul.hidden=true}
  }
  function setSync(t){const e=$("#sync");e.textContent=t;e.className="status "+(/Hors connexion|Échec|impossible|Impossible|Erreur|injoignable|interrompue/.test(t)?"off":(/Synchronisé|Enregistré|chargées|Mis à jour/.test(t)?"ok":""))}
  function normalize(d){return {projects:Array.isArray(d&&d.projects)?d.projects.slice():[],tasks:Array.isArray(d&&d.tasks)?d.tasks.slice():[],requests:Array.isArray(d&&d.requests)?d.requests.slice():[],points:Array.isArray(d&&d.points)?d.points.slice():[],deleted:Array.isArray(d&&d.deleted)?d.deleted.slice():[]}}

  // ---------- Sauvegarde fichier ----------
  // Sauvegarde complète au format local : projets (avec familles et thèmes), tâches (avec commentaires),
  // demandes client, points ouverts et corbeille. Réimportable en mode local comme en ligne.
  function backupSnapshot(){
    const d=JSON.parse(JSON.stringify(state));
    if(MODE==="cloud"){
      d.projects.forEach(p=>{
        p.families=(cloud.families[p.id]||[]).map(f=>({id:f.id,name:f.name}));
        p.pointThemes=(cloud.ptThemes[p.id]||[]).map(t=>({id:t.id,name:t.name}));
        p.meetings=(cloud.meetings[p.id]||[]).map(x=>JSON.parse(JSON.stringify(x)));
        p.contacts=(cloud.contacts[p.id]||[]).map(x=>({...x}));
        const m=cloud.meta[p.id];if(m){p.owner=m.ownerEmail;p.sharedWith=m.members.slice()}
      });
      d.tasks.forEach(t=>{const c=cloud.comments[t.id];if(c&&c.length)t.comments=c.map(x=>({id:x.id,author:x.author,text:x.text,at:x.at}))});
    }
    return d;
  }
  function exportData(){
    const d=backupSnapshot();
    const blob=new Blob([JSON.stringify({app:"todo-projets",version:3,exportedAt:new Date().toISOString(),mode:MODE,account:MODE==="cloud"?cloud.email:"",...d},null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="todo-projets-sauvegarde-"+iso(today())+".json";
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    setSync(`Sauvegarde téléchargée : ${d.projects.length} projet(s), ${d.tasks.filter(t=>!t.deletedAt).length} tâche(s), ${(d.points||[]).filter(o=>!o.deletedAt).length} point(s) ouvert(s), ${(d.requests||[]).filter(r=>!r.deletedAt).length} demande(s)`);
  }
  function importData(file){
    const r=new FileReader();
    r.onload=async()=>{
      try{
        const d=JSON.parse(r.result);
        if(!Array.isArray(d.projects)||!Array.isArray(d.tasks))throw 0;
        if(!await uiConfirm(`Remplacer vos données actuelles par ce fichier (${d.projects.length} projet(s), ${d.tasks.length} tâche(s)) ?`,{ok:"Remplacer",danger:true}))return;
        // les éléments absents du fichier importé sont considérés comme supprimés
        const imp=normalize(d), t0=Date.now();
        imp.projects.forEach(p=>p.updatedAt=t0);imp.tasks.forEach(t=>t.updatedAt=t0);
        view="all";editing=null;state=imp;save();render();
      }catch(e){uiAlert("Ce fichier n'est pas une sauvegarde valide de To do projets.")}
    };
    r.readAsText(file);
  }
  function mergeData(file){
    const r=new FileReader();
    r.onload=async()=>{
      try{
        const d=JSON.parse(r.result);
        if(!Array.isArray(d.projects)||!Array.isArray(d.tasks))throw 0;
        const before=state.tasks.length;
        applyState(merge(state,normalize(d)));
        if(fileHandle&&fileOk)writeFile();
        setSync(`Fusion terminée : ${state.tasks.length-before>0?state.tasks.length-before+" tâche(s) ajoutée(s)":"aucune nouvelle tâche"}`);
      }catch(e){uiAlert("Ce fichier n'est pas un fichier de données To do projets valide.")}
    };
    r.readAsText(file);
  }

  // ---------- Mode en ligne (Supabase) ----------
  const cloud={client:null,user:null,email:"",meta:{},comments:{},profiles:{},families:{},ptThemes:{},meetings:{},contacts:{},dirty:new Map(),seq:0,flushing:false,again:false,retry:null,channel:null,fetchT:null,lastOk:0};
  const cloudReady=()=>!!(CONFIG.supabaseUrl&&CONFIG.supabaseKey&&window.supabase&&window.supabase.createClient);
  // La session est aussi gardée en mémoire : si le navigateur ne la restitue pas à la librairie
  // (stockage bloqué, verrou entre onglets…), on joint nous-mêmes le jeton aux requêtes.
  function useSession(sess){
    cloud.session=sess||null;
    try{if(cloud.client&&sess&&sess.access_token)cloud.client.realtime.setAuth(sess.access_token)}catch(e){}
  }
  function authFetch(input,init){
    try{
      const url=typeof input==="string"?input:(input&&input.url)||"";
      const tok=cloud.session&&cloud.session.access_token;
      if(tok&&/\/(rest|functions)\/v1\//.test(url)){
        const h=new Headers((init&&init.headers)||(input&&input.headers)||{});
        const a=h.get("Authorization")||"";
        if(!a||a==="Bearer "+CONFIG.supabaseKey||!a.startsWith("Bearer ey")){h.set("Authorization","Bearer "+tok);init={...(init||{}),headers:h}}
      }
    }catch(e){}
    return fetch(input,init);
  }
  const AUTH_HASH=(()=>{const h=location.hash||"";return{recovery:/type=recovery/.test(h),error:/error_code=|error=access_denied/.test(h)&&!/type=recovery/.test(h)}})();
  if(AUTH_HASH.error)try{history.replaceState(null,"",location.pathname+location.search)}catch(e){}
  function cloudClient(){
    if(!cloud.client){
      cloud.client=window.supabase.createClient(CONFIG.supabaseUrl,CONFIG.supabaseKey,{
        auth:{persistSession:true,autoRefreshToken:true,storageKey:"todo-projets-auth",lock:async(name,timeout,fn)=>await fn()},
        global:{fetch:authFetch}
      });
      try{cloud.client.auth.onAuthStateChange((ev,sess)=>{if(sess)useSession(sess);else if(ev==="SIGNED_OUT")useSession(null);if(ev==="PASSWORD_RECOVERY")setTimeout(()=>showGate("reset"),0)})}catch(e){}
    }
    return cloud.client;
  }
  const LOGO_RX=/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/;
  function pLogo(p){return p&&typeof p.logo==="string"&&p.logo.length<=150000&&LOGO_RX.test(p.logo)?p.logo:""}
  function pMark(p,cls){return pLogo(p)?`<img class="plogo${cls?" "+cls:""}" src="${p.logo}" alt="">`:`<span class="dot" style="--pc:${p.color}"></span>`}
  const isOwner=pid=>{const m=cloud.meta[pid];return !m||m.owner===cloud.user.id};
  const rowT=t=>({id:t.id,project_id:t.projectId,title:t.title,priority:t.priority||"normale",due:t.due||null,status:t.status==="waiting"?"todo":(t.status||"todo"),waiting:t.status==="waiting",waiting_for:t.waitingFor||"",deleted_at:t.deletedAt||null,note:t.note||"",who:t.who||"",created_at:t.createdAt||Date.now(),done_at:t.doneAt||null,updated_at:t.updatedAt||Date.now(),updated_by:cloud.email,checklist:Array.isArray(t.checklist)?t.checklist:[],repeat:t.repeat||null,family:t.family||null,request_id:t.requestId||null});
  const rowP=p=>({id:p.id,name:p.name,color:p.color||null,archived:!!p.archived,logo:pLogo(p)||null,updated_at:p.updatedAt||Date.now()});
  const fromT=r=>({id:r.id,projectId:r.project_id,title:r.title,priority:r.priority,due:r.due||"",status:r.waiting&&r.status==="todo"?"waiting":r.status,waitingFor:r.waiting_for||"",deletedAt:r.deleted_at?Number(r.deleted_at):null,note:r.note||"",who:r.who||"",createdAt:Number(r.created_at),doneAt:r.done_at?Number(r.done_at):null,updatedAt:Number(r.updated_at),updatedBy:r.updated_by||"",checklist:Array.isArray(r.checklist)?r.checklist:[],repeat:r.repeat||null,family:r.family||"",requestId:r.request_id||null});
  // ordre d'affichage des projets choisi par l'utilisateur (barre de gauche) ; les projets inconnus de l'ordre restent à la suite
  const projSort=(list,order)=>{if(!Array.isArray(order)||!order.length)return list;const pos=new Map(order.map((id,i)=>[id,i]));return list.slice().sort((a,b)=>(pos.has(a.id)?pos.get(a.id):1e6)-(pos.has(b.id)?pos.get(b.id):1e6))};
  const fromP=r=>{const p={id:r.id,name:r.name,color:r.color||COLORS[0],archived:!!r.archived};if(r.logo&&LOGO_RX.test(r.logo))p.logo=r.logo;return p};
  const rowR=r=>({id:r.id,project_id:r.projectId,title:r.title,description:r.description||"",requester:r.requester||"",received:r.received||null,due:r.due||null,priority:r.priority||"normale",status:r.status||"new",scope:r.scope||"",estimate:r.estimate==null||r.estimate===""?null:Number(r.estimate),quote:r.quote||"",created_at:r.createdAt||Date.now(),updated_at:r.updatedAt||Date.now(),closed_at:r.closedAt||null,deleted_at:r.deletedAt||null,updated_by:cloud.email});
  const rowO=o=>({id:o.id,project_id:o.projectId,text:o.text,answer:o.answer||"",hypothesis:o.hypothesis||"",erp:o.erp||"",theme:o.theme||"",owner:o.owner||"",owner_name:o.ownerName||"",status:o.status==="closed"?"closed":"open",task_id:o.taskId||null,request_id:o.requestId||null,created_at:o.createdAt||Date.now(),updated_at:o.updatedAt||Date.now(),closed_at:o.closedAt||null,deleted_at:o.deletedAt||null,updated_by:cloud.email,excel_ref:o.xl||null,answer_new_at:o.ansNew||null});
  const fromO=r=>({id:r.id,projectId:r.project_id,text:r.text,answer:r.answer||"",hypothesis:r.hypothesis||"",erp:r.erp||"",theme:r.theme||"",owner:r.owner||"",ownerName:r.owner_name||"",status:r.status,taskId:r.task_id||null,requestId:r.request_id||null,createdAt:Number(r.created_at),updatedAt:Number(r.updated_at),closedAt:r.closed_at?Number(r.closed_at):null,deletedAt:r.deleted_at?Number(r.deleted_at):null,updatedBy:r.updated_by||"",xl:r.excel_ref||null,ansNew:r.answer_new_at?Number(r.answer_new_at):null});
  const fromR=r=>({id:r.id,projectId:r.project_id,title:r.title,description:r.description||"",requester:r.requester||"",received:r.received||"",due:r.due||"",priority:r.priority,status:r.status,scope:r.scope||"",estimate:r.estimate==null?null:Number(r.estimate),quote:r.quote||"",createdAt:Number(r.created_at),updatedAt:Number(r.updated_at),closedAt:r.closed_at?Number(r.closed_at):null,deletedAt:r.deleted_at?Number(r.deleted_at):null,updatedBy:r.updated_by||""});
  const transient=e=>!e||!e.code; // pas de code PostgreSQL = problème réseau
  function cloudStatus(){
    const n=cloud.dirty.size;
    if(n)setSync(cloud.netDown||navigator.onLine===false?`Hors connexion : ${n} modification(s) en attente, envoi automatique au retour de la connexion.`:`Envoi de ${n} modification(s)…`);
    else setSync("Synchronisé"+(cloud.lastOk?" · "+new Date(cloud.lastOk).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}):""));
  }
  cloud.queue=function(ch){
    ch.changed.forEach(k=>this.dirty.set(k,{op:"up",seq:++this.seq}));
    ch.removed.forEach(k=>this.dirty.set(k,{op:"del",seq:++this.seq}));
  };
  cloud.flush=async function(){
    if(!this.user)return;
    if(this.flushing){this.again=true;return}
    this.flushing=true;clearTimeout(this.retry);
    const c=cloudClient();
    try{
      do{
        this.again=false;
        if(!this.dirty.size)break;
        cloudStatus();
        const batch=[...this.dirty].map(([k,v])=>({k,...v}));
        const byKey=(pre,op)=>batch.filter(b=>b.k.startsWith(pre)&&b.op===op);
        const done=[]; let refused=0, netFail=false;
        // un invité ne peut pas modifier le projet lui-même : on ignore ces changements
        const pUp=byKey("p:","up").filter(b=>{if(isOwner(b.k.slice(2)))return true;done.push(b);return false});
        const steps=[
          [pUp,"projects",b=>{const o=state.projects.find(x=>x.id===b.k.slice(2));return o&&rowP(o)},"up"],
          [byKey("r:","up"),"client_requests",b=>{const o=(state.requests||[]).find(x=>x.id===b.k.slice(2));return o&&rowR(o)},"up"],
          [byKey("o:","up"),"open_points",b=>{const o=(state.points||[]).find(x=>x.id===b.k.slice(2));return o&&rowO(o)},"up"],
          [byKey("t:","up"),"tasks",b=>{const o=state.tasks.find(x=>x.id===b.k.slice(2));return o&&rowT(o)},"up"],
          [byKey("t:","del"),"tasks",null,"del"],
          [byKey("r:","del"),"client_requests",null,"del"],
          [byKey("o:","del"),"open_points",null,"del"],
          [byKey("p:","del").filter(b=>{if(isOwner(b.k.slice(2)))return true;done.push(b);return false}),"projects",null,"del"]
        ];
        for(const [items,table,mk,op] of steps){
          if(!items.length||netFail)continue;
          const run=async list=>{
            if(op==="up"){const rows=list.map(mk).filter(Boolean);if(!rows.length)return null;return (await c.from(table).upsert(rows)).error}
            return (await c.from(table).delete().in("id",list.map(b=>b.k.slice(2)))).error;
          };
          let err=await run(items);
          if(!err){done.push(...items);continue}
          if(transient(err)){netFail=true;continue}
          // refus serveur : on isole les éléments en cause
          for(const it of items){const e=await run([it]);if(!e)done.push(it);else if(transient(e)){netFail=true;break}else{refused++;done.push(it)}}
        }
        done.forEach(b=>{const cur=this.dirty.get(b.k);if(cur&&cur.seq===b.seq)this.dirty.delete(b.k)});
        lsSave();
        if(refused){uiAlert(`${refused} modification(s) n'ont pas pu être enregistrées (droits insuffisants : le projet a peut-être été supprimé ou ne vous est plus partagé). L'affichage va être actualisé.`);this.fetch()}
        this.netDown=netFail;
        if(netFail){this.again=false;this.retry=setTimeout(()=>this.flush(),15000);break}
        if(!this.dirty.size)this.lastOk=Date.now();
      }while(this.again);
    }finally{this.flushing=false}
    cloudStatus();
    if(this.again)this.flush();
  };
  cloud.fetch=async function(){
    if(!this.user)return;
    if(editing||editingReq||editingPt){clearTimeout(this.fetchT);this.fetchT=setTimeout(()=>this.fetch(),3000);return}
    const c=cloudClient();
    const [P,M,T,C,PR,F,R,O,TH,MT,CT]=await Promise.all([c.from("projects").select("*"),c.from("project_members").select("*"),c.from("tasks").select("*"),c.from("task_comments").select("*"),c.from("profiles").select("*"),c.from("project_families").select("*"),c.from("client_requests").select("*"),c.from("open_points").select("*"),c.from("point_themes").select("*"),c.from("meetings").select("*"),c.from("project_contacts").select("*")]);
    if(MT&&!MT.error){
      const mm={};MT.data.filter(r=>!r.deleted_at).map(fromMtg).forEach(x=>{(mm[x.projectId]=mm[x.projectId]||[]).push(x)});
      const js=JSON.stringify(mm);if(js!==this._lastMt){this._lastMt=js;this.meetings=mm;this._cmChanged=true}
    }
    if(CT&&!CT.error){
      const cm={};CT.data.forEach(r=>{(cm[r.project_id]=cm[r.project_id]||[]).push(fromCt(r))});
      const js=JSON.stringify(cm);if(js!==this._lastCt){this._lastCt=js;this.contacts=cm;this._cmChanged=true}
    }
    if(TH&&!TH.error){
      const tm={};TH.data.slice().sort((a,b)=>Number(a.created_at)-Number(b.created_at)).forEach(r=>{(tm[r.project_id]=tm[r.project_id]||[]).push({id:r.id,name:r.name})});
      const js=JSON.stringify(tm);if(js!==this._lastPt){this._lastPt=js;this.ptThemes=tm;this._cmChanged=true}
    }
    if(!F.error){
      const fm={};F.data.slice().sort((a,b)=>Number(a.created_at)-Number(b.created_at)).forEach(r=>{(fm[r.project_id]=fm[r.project_id]||[]).push({id:r.id,name:r.name})});
      const js=JSON.stringify(fm);if(js!==this._lastFm){this._lastFm=js;this.families=fm;this._cmChanged=true}
    }
    if(!PR.error){
      const pm={};PR.data.forEach(r=>pm[String(r.email).toLowerCase()]={first:r.first_name,last:r.last_name});
      const js=JSON.stringify(pm);if(js!==this._lastPr){this._lastPr=js;this.profiles=pm;this._cmChanged=true;$("#whoami").textContent=nameOf(this.email)}
      if(!pm[this.email]&&!this._askedProfile){this._askedProfile=true;ensureProfile()}
      const me=PR.data.find(r=>this.user&&r.user_id===this.user.id);if(me&&Array.isArray(me.project_order)&&!this._orderPending)this.projOrder=me.project_order;
    }
    const err=P.error||M.error||T.error;
    if(!C.error){
      const cm={};C.data.slice().sort((a,b)=>Number(a.created_at)-Number(b.created_at)).forEach(r=>{(cm[r.task_id]=cm[r.task_id]||[]).push({id:r.id,author:r.author_email,text:r.body,at:Number(r.created_at)})});
      const js=JSON.stringify(cm);if(js!==this._lastCm){this._lastCm=js;this.comments=cm;this._cmChanged=true}
    }
    if(err){
      const authErr=err.code==="42501"||err.code==="PGRST301"||err.code==="PGRST303"||/jwt/i.test(err.message||"");
      if(authErr&&!this._retried){
        // droits refusés : la session n'est pas (encore) prise en compte, on la renouvelle puis on réessaie
        this._retried=true;
        try{const r=await c.auth.refreshSession();if(r&&r.data&&r.data.session)useSession(r.data.session)}catch(e){}
        setTimeout(()=>this.fetch(),800);return;
      }
      if(authErr){setSync("Session expirée : reconnectez-vous.");return}
      if(transient(err))setSync("Connexion au serveur impossible : affichage de la dernière version connue.");else setSync("Erreur serveur : "+err.message);return}
    this._retried=false;
    const meta={};
    P.data.forEach(r=>meta[r.id]={owner:r.owner,ownerEmail:r.owner_email,members:[]});
    M.data.forEach(r=>{if(meta[r.project_id])meta[r.project_id].members.push(r.email)});
    Object.values(meta).forEach(m=>m.members.sort());
    let projects=P.data.slice().sort((a,b)=>Number(a.created_at)-Number(b.created_at)).map(fromP);
    let tasks=T.data.filter(r=>meta[r.project_id]).map(fromT);
    let requests=R.error?(state.requests||[]).slice():R.data.filter(r=>meta[r.project_id]).map(fromR);
    let points=O.error?(state.points||[]).slice():O.data.filter(r=>meta[r.project_id]).map(fromO);
    // les modifications locales pas encore envoyées restent prioritaires
    for(const [k,v] of this.dirty){
      const id=k.slice(2);
      const [arr,src]=({p:[projects,state.projects],t:[tasks,state.tasks],r:[requests,state.requests||[]],o:[points,state.points||[]]})[k[0]]||[[],[]];
      const loc=src.find(x=>x.id===id);
      const i=arr.findIndex(x=>x.id===id);
      if(v.op==="del"){if(i>=0)arr.splice(i,1)}
      else if(loc){if(i>=0)arr[i]=loc;else arr.push(loc)}
    }
    tasks=tasks.filter(t=>projects.some(p=>p.id===t.projectId));
    this.meta=meta;
    requests=requests.filter(r=>projects.some(p=>p.id===r.projectId));
    points=points.filter(o=>projects.some(p=>p.id===o.projectId));
    projects=projSort(projects,this.projOrder);
    const next={projects,tasks,requests,points,deleted:[]};
    if(canon(next)!==canon(state)||JSON.stringify(meta)!==this._lastMeta){this._lastMeta=JSON.stringify(meta);this._cmChanged=false;applyState(next)}
    else if(this._cmChanged){this._cmChanged=false;render()}
    if(!this.dirty.size){this.lastOk=Date.now()}
    cloudStatus();
  };
  cloud.schedule=function(){clearTimeout(this.fetchT);this.fetchT=setTimeout(()=>this.fetch(),400)};
  // Synchronisation incrémentale : chaque événement temps réel est appliqué ligne par ligne,
  // sans recharger toutes les tables. Les projets et les partages déclenchent un rechargement complet.
  const RT_ROWS={tasks:["t","tasks",r=>fromT(r),["title","note","checklist"]],client_requests:["r","requests",r=>fromR(r),["title","description"]],open_points:["o","points",r=>fromO(r),["text","answer","hypothesis"]]};
  cloud.rt={q:[],t:null};
  cloud.onRow=function(table,pl){this.rt.q.push([table,pl||{}]);clearTimeout(this.rt.t);this.rt.t=setTimeout(()=>this.applyRows(),150)};
  cloud.applyRows=function(){
    if(!this.user||!this.rt.q.length)return;
    if(editing||editingReq||editingPt){clearTimeout(this.rt.t);this.rt.t=setTimeout(()=>this.applyRows(),3000);return}
    const q=this.rt.q;this.rt.q=[];
    let full=false,changed=false,side=false;
    const upList=(map,pid,row,sortKey)=>{let found=false;Object.keys(map).forEach(k=>{map[k]=map[k].map(x=>{if(x.id===row.id){found=true;return {...x,name:row.name}}return x})});if(!found&&pid)(map[pid]=map[pid]||[]).push({id:row.id,name:row.name})};
    const rmList=(map,id)=>Object.keys(map).forEach(k=>{map[k]=map[k].filter(x=>x.id!==id);if(!map[k].length)delete map[k]});
    for(const [table,pl] of q){
      const ev=pl.eventType, nw=pl.new||{}, od=pl.old||{};
      const id=ev==="DELETE"?od.id:nw.id;
      if(RT_ROWS[table]){
        const [pre,key,from,need]=RT_ROWS[table];
        if(!id){full=true;continue}
        const k=pre+":"+id;
        if(this.dirty.has(k))continue; // modification locale pas encore envoyée : elle reste prioritaire
        const arr=state[key]||(state[key]=[]), i=arr.findIndex(x=>x.id===id);
        if(ev==="DELETE"){if(i>=0){arr.splice(i,1);snap.delete(k);changed=true}continue}
        if(need.some(f=>!(f in nw))||!this.meta[nw.project_id]){full=true;continue}
        if(i>=0&&Number(nw.updated_at)<(arr[i].updatedAt||0))continue; // écho d'une version plus ancienne
        const o=from(nw);
        if(i>=0&&bare(arr[i])===bare(o))continue;
        if(i>=0)arr[i]=o;else arr.push(o);
        snap.set(k,bare(o));changed=true;
      } else if(table==="task_comments"){
        const cm=this.comments||(this.comments={});
        if(ev==="DELETE"){if(id)Object.keys(cm).forEach(t=>{cm[t]=cm[t].filter(c=>c.id!==id);if(!cm[t].length)delete cm[t]})}
        else if(nw.task_id){const l=cm[nw.task_id]=(cm[nw.task_id]||[]).filter(c=>c.id!==nw.id);l.push({id:nw.id,author:nw.author_email,text:nw.body,at:Number(nw.created_at)});l.sort((a,b)=>a.at-b.at)}
        this._lastCm=JSON.stringify(cm);side=true;
      } else if(table==="project_families"){
        const fm=this.families||(this.families={});
        if(ev==="DELETE"){if(id)rmList(fm,id)}else upList(fm,nw.project_id,nw);
        this._lastFm=JSON.stringify(fm);side=true;
      } else if(table==="point_themes"){
        const tm=this.ptThemes||(this.ptThemes={});
        if(ev==="DELETE"){if(id)rmList(tm,id)}else upList(tm,nw.project_id,nw);
        this._lastPt=JSON.stringify(tm);side=true;
      } else if(table==="meetings"){
        const mm=this.meetings||(this.meetings={});
        Object.keys(mm).forEach(k=>{mm[k]=mm[k].filter(x=>x.id!==id)});
        if(ev!=="DELETE"&&nw.project_id&&!nw.deleted_at)(mm[nw.project_id]=mm[nw.project_id]||[]).push(fromMtg(nw));
        this._lastMt=JSON.stringify(mm);side=true;
      } else if(table==="project_contacts"){
        const cm=this.contacts||(this.contacts={});
        Object.keys(cm).forEach(k=>{cm[k]=cm[k].filter(x=>x.id!==id)});
        if(ev!=="DELETE"&&nw.project_id)(cm[nw.project_id]=cm[nw.project_id]||[]).push(fromCt(nw));
        this._lastCt=JSON.stringify(cm);side=true;
      } else if(table==="profiles"&&ev!=="DELETE"&&nw.email){
        this.profiles[String(nw.email).toLowerCase()]={first:nw.first_name,last:nw.last_name};
        this._lastPr=JSON.stringify(this.profiles);$("#whoami").textContent=nameOf(this.email);side=true;
      } else full=true; // projets, partages, ou événement incomplet : rechargement complet
    }
    if(changed){
      lsSave();
      if(editing&&!state.tasks.some(t=>t.id===editing))editing=null;
      if(editingReq&&!(state.requests||[]).some(r=>r.id===editingReq))editingReq=null;
      if(editingPt&&!(state.points||[]).some(o=>o.id===editingPt))editingPt=null;
    }
    if(changed||side)render();
    if(full)this.schedule();
    else if(!this.dirty.size){this.lastOk=Date.now();cloudStatus()}
  };
  cloud.subscribe=function(){
    const c=cloudClient();
    if(this.channel)c.removeChannel(this.channel);
    let ch=c.channel("todo-"+this.user.id);
    ["tasks","client_requests","open_points","task_comments","project_families","point_themes","profiles","meetings","project_contacts"].forEach(t=>{ch=ch.on("postgres_changes",{event:"*",schema:"public",table:t},pl=>this.onRow(t,pl))});
    ["projects","project_members"].forEach(t=>{ch=ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>this.schedule())});
    this._rtDown=false;
    this.channel=ch.subscribe(st=>{
      // après une coupure, on recharge tout pour rattraper les événements manqués
      if(st==="SUBSCRIBED"){if(this._rtDown){this._rtDown=false;this.schedule()}}
      else if(st==="CHANNEL_ERROR"||st==="TIMED_OUT"||st==="CLOSED")this._rtDown=true;
    });
  };
  async function startCloud(){
    MODE="cloud";
    $("#localbox").hidden=true;$("#acc").hidden=false;
    if(!cloudReady()){MODE="local";showGate("choice");return}
    const c=cloudClient();
    let session=null;
    try{session=(await c.auth.getSession()).data.session}catch(e){}
    if(!session){showGate("login");return}
    useSession(session);
    await enterCloud(session.user);
  }
  async function enterCloud(user){
    MODE="cloud";$("#localbox").hidden=true;$("#acc").hidden=false;
    cloud.user=user;cloud.email=(user.email||"").toLowerCase();
    cloud.profiles={};cloud._lastPr="";cloud._askedProfile=false;
    $("#whoami").textContent=cloud.email;$("#toolstitle .tsl").textContent="Compte et sauvegarde";
    $("#gate").hidden=true;
    try{localStorage.setItem("todo-mode","cloud")}catch(e){}
    // affichage immédiat de la dernière version connue, puis synchronisation
    let cache=null;try{cache=JSON.parse(localStorage.getItem("todo-cloud:"+user.id)||"null")}catch(e){}
    state=cache?normalize(cache.state):{projects:[],tasks:[],requests:[],points:[],deleted:[]};
    cloud.dirty=new Map(cache&&Array.isArray(cache.dirty)?cache.dirty:[]);
    resetSnap();view="all";editing=null;render();renderAccount();
    setSync("Synchronisation…");
    if(cloud.dirty.size)await cloud.flush();
    await cloud.fetch();
    purgeTrash();
    cloud.subscribe();
    setTimeout(confRemind,4000);
  }
  async function login(e){
    e.preventDefault();
    const email=$("#lemail").value.trim(), password=$("#lpass").value;
    $("#lerr").textContent="";$("#lgo").disabled=true;
    try{
      const {data,error}=await cloudClient().auth.signInWithPassword({email,password});
      if(error){$("#lerr").textContent=/invalid/i.test(error.message)?"E-mail ou mot de passe incorrect.":(transient(error)&&!error.status?"Serveur injoignable : vérifiez votre connexion Internet.":"Connexion refusée : "+error.message);return}
      $("#lpass").value="";
      useSession(data.session);
      await enterCloud(data.user);
    }catch(err){$("#lerr").textContent="Serveur injoignable : vérifiez votre connexion Internet."}
    finally{$("#lgo").disabled=false}
  }
  async function forgot(e){
    e.preventDefault();
    const email=$("#femail").value.trim().toLowerCase();
    $("#ferr").textContent="";$("#fok").textContent="";$("#fgo").disabled=true;
    try{
      const {error}=await cloudClient().auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
      if(error){$("#ferr").textContent=/rate|limit|seconds/i.test(error.message||"")?"Trop de demandes rapprochées : patientez quelques minutes avant de réessayer.":(transient(error)&&!error.status?"Serveur injoignable : vérifiez votre connexion Internet.":"Envoi impossible : "+error.message);return}
      $("#fok").textContent="Si un compte existe pour "+email+", un e-mail vient d'être envoyé. Ouvrez le lien qu'il contient sur cet appareil (pensez à vérifier les courriers indésirables).";
    }catch(err){$("#ferr").textContent="Serveur injoignable : vérifiez votre connexion Internet."}
    finally{$("#fgo").disabled=false}
  }
  async function resetPass(e){
    e.preventDefault();
    const p1=$("#rpass").value,p2=$("#rpass2").value;
    $("#rerr").textContent="";
    if(p1.length<8){$("#rerr").textContent="Le mot de passe doit contenir au moins 8 caractères.";return}
    if(p1!==p2){$("#rerr").textContent="Les deux mots de passe sont différents.";return}
    $("#rgo").disabled=true;
    try{
      const {data,error}=await cloudClient().auth.updateUser({password:p1});
      if(error){$("#rerr").textContent=/different|same/i.test(error.message||"")?"Choisissez un mot de passe différent de l'ancien.":/session|expired|jwt/i.test(error.message||"")?"Le lien a expiré : refaites une demande depuis « Mot de passe oublié ».":"Modification refusée : "+error.message;return}
      $("#rpass").value="";$("#rpass2").value="";
      let sess=null;try{sess=(await cloudClient().auth.getSession()).data.session}catch(x){}
      if(sess)useSession(sess);
      await enterCloud((data&&data.user)||(sess&&sess.user));
      toast("Mot de passe modifié.");
    }catch(err){$("#rerr").textContent="Serveur injoignable : vérifiez votre connexion Internet."}
    finally{$("#rgo").disabled=false}
  }
  const domainOk=email=>!CONFIG.allowedDomains||!CONFIG.allowedDomains.length||CONFIG.allowedDomains.includes(email.split("@").pop().toLowerCase());
  async function signup(e){
    e.preventDefault();
    const email=$("#semail").value.trim().toLowerCase(), password=$("#spass").value, p2=$("#spass2").value;
    const first=$("#sfirst").value.trim(), last=$("#slast").value.trim();
    $("#serr").textContent="";$("#sok").textContent="";
    if(!first||!last){$("#serr").textContent="Indiquez votre prénom et votre nom.";return}
    if(!domainOk(email)){$("#serr").textContent="Adresse non autorisée : utilisez votre e-mail "+CONFIG.allowedDomains.map(d=>"@"+d).join(" ou ")+".";return}
    if(password.length<8){$("#serr").textContent="Le mot de passe doit contenir au moins 8 caractères.";return}
    if(password!==p2){$("#serr").textContent="Les deux mots de passe sont différents.";return}
    $("#sgo").disabled=true;
    try{
      const {data,error}=await cloudClient().auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname,data:{first_name:first,last_name:last}}});
      if(error){
        const m=error.message||"";
        $("#serr").textContent=/already|registered|exists/i.test(m)?"Un compte existe déjà avec cette adresse : utilisez « J'ai déjà un compte ».":
          /signups? not allowed|disabled/i.test(m)?"La création de compte est désactivée : contactez la personne qui gère l'application.":
          /database error|domain/i.test(m)?"Adresse e-mail refusée par le serveur.":
          /password/i.test(m)?"Mot de passe refusé : "+m:
          (transient(error)&&!error.status?"Serveur injoignable : vérifiez votre connexion Internet.":"Création refusée : "+m);
        return;
      }
      $("#spass").value="";$("#spass2").value="";
      if(data.session){
        // s'assurer que la session est bien active avant les premières requêtes
        useSession(data.session);
        try{await cloudClient().auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token})}catch(e){}
        await enterCloud(data.user);await saveProfile(first,last);return}
      if(data.user&&Array.isArray(data.user.identities)&&!data.user.identities.length){$("#serr").textContent="Un compte existe déjà avec cette adresse : utilisez « J'ai déjà un compte ».";return}
      try{localStorage.setItem("todo-mode","cloud")}catch(e){}
      $("#sok").textContent="Compte créé. Un e-mail de confirmation vient de vous être envoyé : cliquez sur le lien qu'il contient, puis connectez-vous.";
    }catch(err){$("#serr").textContent="Serveur injoignable : vérifiez votre connexion Internet."}
    finally{$("#sgo").disabled=false}
  }
  async function logout(){
    if(cloud.dirty.size&&!await uiConfirm(`${cloud.dirty.size} modification(s) ne sont pas encore envoyées. Se déconnecter quand même ? Elles seront envoyées à votre prochaine connexion sur ce navigateur.`,{ok:"Se déconnecter"}))return;
    const c=cloudClient();
    if(cloud.channel){c.removeChannel(cloud.channel);cloud.channel=null}
    try{await c.auth.signOut()}catch(e){}
    useSession(null);
    cloud.user=null;cal.events=null;cal.hasLink=null;state={projects:[],tasks:[],requests:[],points:[],deleted:[]};render();
    showGate("login");
  }
  async function changePassword(){
    const r=await uiForm("Changer de mot de passe",[{k:"a",label:"Nouveau mot de passe (8 caractères minimum)",type:"password",ac:"new-password"},{k:"b",label:"Confirmer le mot de passe",type:"password",ac:"new-password"}],
      v=>v.a.length<8?"Le mot de passe doit contenir au moins 8 caractères.":v.a!==v.b?"Les deux saisies sont différentes.":"",{ok:"Enregistrer"});
    if(!r)return;
    const {error}=await cloudClient().auth.updateUser({password:r.a});
    if(error)uiAlert("Changement refusé : "+error.message);else toast("Mot de passe modifié.");
  }
  function renderAccount(){
    const a=$("#acc");
    a.innerHTML=`<p class="sub">Compte en ligne</p><p class="who-me">${esc(cloud.email)}</p>
      <button class="btn" type="button" data-a="imp">Restaurer / importer (.json)</button>
      <button class="btn" type="button" data-a="exp" title="Télécharge une copie complète de vos données (projets, tâches, familles, points ouverts, demandes, commentaires) sur votre ordinateur">Sauvegarder une copie (.json)</button>
      <button class="btn ghost" type="button" data-a="name">Modifier mon nom</button>
      <button class="btn ghost" type="button" data-a="pwd">Changer le mot de passe</button>
      <button class="btn ghost" type="button" data-a="conf">Connecter Confluence</button>
      <button class="btn ghost" type="button" data-a="out">Se déconnecter</button>
      <button class="btn ghost" type="button" data-a="loc">Passer en mode local</button>
      <input type="file" accept=".json,application/json" hidden>`;
    const f=a.querySelector("input[type=file]");
    f.onchange=e=>{if(e.target.files[0])importToCloud(e.target.files[0]);e.target.value=""};
    a.querySelectorAll("button").forEach(b=>b.onclick=()=>({imp:()=>f.click(),exp:exportData,name:()=>openProfile(false),pwd:changePassword,conf:openConfCfg,out:logout,loc:toLocal})[b.dataset.a]());
  }
  // ---------- Données et confidentialité (RGPD) : information, export, suppression du compte ----------
  function openPrivacy(){
    const cl=MODE==="cloud";
    const d=document.createElement("dialog");d.className="uidlg privdlg";d.setAttribute("aria-label","Données et confidentialité");
    d.innerHTML=`<form method="dialog"><h3>Données et confidentialité</h3>
      <div class="privbody">
      <h4>Données enregistrées</h4>
      <p>Ce que vous saisissez : projets, tâches, points ouverts, demandes client, comptes rendus de réunion et contacts de projet. Pour chaque utilisateur en ligne : prénom, nom et adresse e-mail. Le lien de votre calendrier Outlook, si vous l'ajoutez, n'est visible que de vous.</p>
      <h4>Où sont-elles stockées ?</h4>
      <p>${cl?"Mode en ligne : base de données Supabase hébergée dans l'Union européenne (Irlande).":"Mode local : uniquement dans ce navigateur, ou dans le fichier que vous avez choisi sur votre ordinateur."} Le code de l'appli est servi par GitHub Pages et ne contient aucune donnée. Polices et bibliothèques sont hébergées avec l'appli. Seul service tiers, et seulement si vous le connectez : Confluence (Atlassian), qui reçoit les comptes rendus des mises en service liées à une page ; votre jeton API y est chiffré sur le serveur de l'appli et n'est visible de personne. Avec le lien Excel, le fichier reste sur votre ordinateur ; seuls les points lus sont enregistrés.</p>
      <h4>Qui y a accès ?</h4>
      <p>Un projet n'est visible que de son propriétaire et des personnes avec qui il le partage.</p>
      <h4>Durées de conservation</h4>
      <ul><li>Éléments supprimés (corbeille) : effacés définitivement après ${TRASH_DAYS} jours.</li>
      <li>Contacts d'un projet archivé : effacés ${Math.round(CONTACTS_ARCH_DAYS/30)} mois après l'archivage.</li>
      <li>Projet supprimé : tout son contenu est effacé${cl?` ; il disparaît des sauvegardes automatiques au bout de ${BACKUP_WEEKS} semaines`:""}.</li>
      ${cl?`<li>Sauvegardes automatiques hebdomadaires : conservées ${BACKUP_WEEKS} semaines.</li>`:""}</ul>
      <h4>Vos droits</h4>
      <p>Vous pouvez à tout moment télécharger une copie de vos données${cl?" ou supprimer votre compte":""}. Pour toute autre demande (rectification, question), adressez-vous au propriétaire du projet concerné.</p>
      </div>
      <div class="uibtns">${cl?`<button type="button" class="btn ghost danger-t" data-del>Supprimer mon compte…</button><span style="flex:1"></span>`:""}<button type="button" class="btn" data-exp>Exporter mes données</button><button type="button" class="btn primary" data-x>Fermer</button></div></form>`;
    document.body.appendChild(d);
    const close=()=>{try{d.close()}catch(e){}d.remove()};
    d.addEventListener("cancel",e=>{e.preventDefault();close()});
    d.querySelector("[data-x]").onclick=close;
    d.querySelector("[data-exp]").onclick=()=>exportData();
    const del=d.querySelector("[data-del]");if(del)del.onclick=async()=>{close();await deleteAccount()};
    if(d.showModal)d.showModal();else d.setAttribute("open","");
  }
  async function deleteAccount(){
    const mine=state.projects.filter(p=>isOwner(p.id)), shared=mine.filter(p=>((cloud.meta[p.id]||{}).members||[]).length);
    const msg=[`Supprimer définitivement votre compte ${cloud.email} ?`,"",
      mine.length?`Vos ${mine.length} projet(s) seront supprimés avec tout leur contenu${shared.length?`, y compris pour les personnes avec qui ils sont partagés (${shared.map(p=>p.name).join(", ")})`:""}.`:"Vous n'êtes propriétaire d'aucun projet.",
      "Vous serez retiré des projets partagés avec vous.","","Pensez à « Exporter mes données » avant. Cette action est irréversible."].join("\n");
    if(!await uiConfirm(msg,{ok:"Supprimer mon compte",danger:true}))return;
    const conf=await uiPrompt("Pour confirmer, saisissez votre adresse e-mail","",{ok:"Supprimer définitivement"});
    if(conf==null)return;
    if(norm(conf.trim())!==norm(cloud.email)){uiAlert("L'adresse saisie ne correspond pas : le compte n'a pas été supprimé.");return}
    const {error}=await cloudClient().rpc("delete_my_account");
    if(error){uiAlert(/delete_my_account|PGRST202|function/i.test(error.message||"")?"La suppression de compte n'est pas encore activée sur le serveur. Contactez l'administrateur de l'appli.":"Suppression impossible : "+error.message);return}
    await uiAlert("Votre compte et vos données ont été supprimés.");
    try{await cloudClient().auth.signOut()}catch(e){}
    try{localStorage.removeItem("todo-mode")}catch(e){}
    location.reload();
  }
  // Import d'un fichier .json (export ou fichier de données local) dans le compte en ligne
  function importToCloud(file){
    const r=new FileReader();
    r.onload=async()=>{
      let d;try{d=JSON.parse(r.result);if(!Array.isArray(d.projects)||!Array.isArray(d.tasks))throw 0}catch(e){uiAlert("Ce fichier n'est pas un fichier de données To do projets valide.");return}
      const nT=d.tasks.filter(t=>!t.deletedAt).length, nO=(d.points||[]).filter(o=>!o.deletedAt).length, nR=(d.requests||[]).filter(x=>!x.deletedAt).length;
      if(!await uiConfirm(`Importer ${d.projects.length} projet(s), ${nT} tâche(s)${nO?`, ${nO} point(s) ouvert(s)`:""}${nR?`, ${nR} demande(s) client`:""} dans votre compte ?\n\nIls s'ajoutent à vos projets en ligne existants : rien n'est remplacé ni supprimé.`,{ok:"Importer"}))return;
      const ids={}, nid=()=>(crypto.randomUUID?crypto.randomUUID():uid()+uid());
      const fams=[], fmap={}, themes=[], coms=[];
      d.projects.forEach(p=>{
        (Array.isArray(p.families)?p.families:[]).forEach(f=>{if(f&&f.id&&f.name){fmap[f.id]=nid();fams.push({id:fmap[f.id],pid:p.id,name:String(f.name).slice(0,60)})}});
        (Array.isArray(p.pointThemes)?p.pointThemes:[]).forEach(t=>{if(t&&t.name)themes.push({pid:p.id,name:String(t.name).slice(0,80)})});
      });
      d.projects.forEach((p,i)=>{ids[p.id]=nid();const used=state.projects.map(x=>String(x.color||"").toUpperCase());const col=p.color&&!used.includes(String(p.color).toUpperCase())?p.color:nextColor();state.projects.push(Object.assign({id:ids[p.id],name:String(p.name||"Projet"),color:col},pLogo(p)?{logo:p.logo}:{}))});
      const rids={};
      (Array.isArray(d.requests)?d.requests:[]).forEach(r=>{if(!ids[r.projectId]||r.deletedAt||!r.title)return;rids[r.id]=nid();state.requests.push({id:rids[r.id],projectId:ids[r.projectId],title:String(r.title).slice(0,300),description:String(r.description||""),requester:String(r.requester||""),received:/^\d{4}-\d{2}-\d{2}$/.test(r.received||"")?r.received:"",due:/^\d{4}-\d{2}-\d{2}$/.test(r.due||"")?r.due:"",priority:["haute","normale","basse"].includes(r.priority)?r.priority:"normale",status:REQL[r.status]?r.status:"new",scope:["","in","out"].includes(r.scope)?r.scope:"",estimate:r.estimate==null||isNaN(+r.estimate)?null:+r.estimate,quote:QUOTE[r.quote]!==undefined?r.quote:"",createdAt:Number(r.createdAt)||Date.now(),closedAt:r.closedAt||null})});
      (Array.isArray(d.points)?d.points:[]).forEach(o=>{if(!ids[o.projectId]||o.deletedAt||!o.text)return;state.points.push({id:nid(),projectId:ids[o.projectId],text:rtCut(String(o.text),2000),answer:String(o.answer||""),hypothesis:String(o.hypothesis||""),erp:["oui","non"].includes(o.erp)?o.erp:"",theme:String(o.theme||"").slice(0,80),owner:OWNER[o.owner]!==undefined?o.owner:"",ownerName:String(o.ownerName||"").slice(0,120),status:o.status==="closed"?"closed":"open",taskId:null,requestId:null,createdAt:Number(o.createdAt)||Date.now(),closedAt:o.closedAt||null})});
      d.tasks.forEach(t=>{if(!ids[t.projectId]||t.deletedAt)return;state.tasks.push({id:nid(),projectId:ids[t.projectId],title:String(t.title||""),priority:["haute","normale","basse"].includes(t.priority)?t.priority:"normale",due:/^\d{4}-\d{2}-\d{2}$/.test(t.due||"")?t.due:"",status:["todo","doing","waiting","done"].includes(t.status)?t.status:"todo",waitingFor:String(t.waitingFor||""),note:String(t.note||""),who:String(t.who||""),createdAt:Number(t.createdAt)||Date.now(),doneAt:t.doneAt||null,checklist:Array.isArray(t.checklist)?t.checklist.filter(c=>c&&c.text).map(c=>({id:String(c.id||uid()),text:String(c.text),done:!!c.done})):[],repeat:t.repeat&&t.repeat.unit?{n:+t.repeat.n||1,unit:String(t.repeat.unit)}:null,requestId:rids[t.requestId]||null,family:fmap[t.family]||""});const nt=state.tasks[state.tasks.length-1];(Array.isArray(t.comments)?t.comments:[]).forEach(c=>{if(c&&c.text)coms.push({task:nt.id,author:c.author,text:String(c.text),at:c.at})})});
      view="all";save();render();
      // familles, thèmes et commentaires : créés une fois les projets et tâches enregistrés en ligne
      (async()=>{
        setSync("Import en cours…");
        await cloud.flush();
        const c=cloudClient();let ko=0;
        if(fams.length){const {error}=await c.from("project_families").insert(fams.map(f=>({id:f.id,project_id:ids[f.pid],name:f.name})));if(error)ko++}
        if(themes.length){const {error}=await c.from("point_themes").insert(themes.map(t=>({project_id:ids[t.pid],name:t.name})));if(error&&error.code!=="23505")ko++}
        const cts=[],mts=[];
        d.projects.forEach(p=>{
          (Array.isArray(p.contacts)?p.contacts:[]).forEach(x=>{if(x&&x.name)cts.push({project_id:ids[p.id],name:String(x.name).slice(0,120),role:String(x.role||"").slice(0,120),side:SIDE[x.side]?x.side:"client",email:String(x.email||"").slice(0,200)})});
          (Array.isArray(p.meetings)?p.meetings:[]).forEach(x=>{if(x&&x.title&&!x.deletedAt)mts.push({...rowMtg({...x,projectId:ids[p.id]}),id:nid(),outlook_key:x.outlookKey||null})});
        });
        if(cts.length){const {error}=await c.from("project_contacts").insert(cts);if(error)ko++}
        if(mts.length){const {error}=await c.from("meetings").insert(mts);if(error)ko++}
        for(let i=0;i<coms.length;i+=200){
          const part=coms.slice(i,i+200).map(x=>{const who=x.author&&x.author!==cloud.email&&x.author!=="Moi"?`[${nameOf(x.author)}${x.at?", "+new Date(x.at).toLocaleDateString("fr-FR"):""}] `:"";return {task_id:x.task,body:(who+x.text).slice(0,4000)}});
          const {error}=await c.from("task_comments").insert(part);if(error)ko++;
        }
        await cloud.fetch();
        setSync(ko?"Import terminé, mais certains éléments (familles, thèmes ou commentaires) n'ont pas pu être recréés.":"Import terminé : projets, tâches, familles, thèmes et commentaires restaurés.");
      })();
    };
    r.readAsText(file);
  }
  async function shareAdd(pid,email){
    email=email.trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){uiAlert("Adresse e-mail invalide.");return}
    if(email===cloud.email){uiAlert("C'est votre propre adresse.");return}
    const {error}=await cloudClient().from("project_members").insert({project_id:pid,email});
    if(error&&error.code!=="23505"){uiAlert(transient(error)?"Serveur injoignable : réessayez quand la connexion sera rétablie.":"Partage refusé : "+error.message);return}
    await cloud.fetch();
  }
  async function shareRemove(pid,email,leaving){
    if(!await uiConfirm(leaving?"Quitter ce projet ? Il disparaîtra de votre liste ; son propriétaire pourra vous le repartager.":`Retirer l'accès de ${email} à ce projet ?`,{ok:leaving?"Quitter":"Retirer",danger:true}))return;
    const {error}=await cloudClient().from("project_members").delete().eq("project_id",pid).eq("email",email);
    if(error){uiAlert(transient(error)?"Serveur injoignable : réessayez quand la connexion sera rétablie.":"Action refusée : "+error.message);return}
    if(leaving){for(const k of [...cloud.dirty.keys()]){const t=state.tasks.find(x=>"t:"+x.id===k)||(state.requests||[]).find(x=>"r:"+x.id===k)||(state.points||[]).find(x=>"o:"+x.id===k);if(k==="p:"+pid||(t&&t.projectId===pid))cloud.dirty.delete(k)}view="all"}
    await cloud.fetch();
  }
  let shareOpen=false, vbOpen=false;
  function renderShare(p){
    const box=$("#share");
    if(MODE!=="cloud"||!p||!cloud.user){box.hidden=true;return}
    const m=cloud.meta[p.id];
    if(!m){box.hidden=!shareOpen;if(shareOpen)box.innerHTML=`<p class="muted">Projet en cours d'enregistrement : le partage sera possible dans un instant.</p>`;return}
    if(!isOwner(p.id)){
      box.hidden=false;
      box.innerHTML=`<p class="muted">Projet partagé par <b>${esc(nameOf(m.ownerEmail))}</b>${m.members.length>1?` avec ${m.members.length-1} autre(s) personne(s)`:""}. Vous pouvez modifier ses tâches.</p>`;
      return;
    }
    box.hidden=!shareOpen;if(!shareOpen)return;
    box.innerHTML=`<h4>Partager « ${esc(p.name)} »</h4>
      ${m.members.length?`<ul>${m.members.map(e=>`<li><span>${nameOf(e)!==e?`<b>${esc(nameOf(e))}</b> <span class="muted">${esc(e)}</span>`:`${esc(e)} <span class="muted">(n'a pas encore de compte ou de nom renseigné)</span>`}</span><button class="btn ghost" type="button" data-e="${esc(e)}">Retirer</button></li>`).join("")}</ul>`:`<p class="muted" style="margin-bottom:10px">Ce projet n'est partagé avec personne.</p>`}
      <form autocomplete="off"><input type="email" placeholder="E-mail du collègue" aria-label="E-mail du collègue" required><button class="btn primary" type="submit">Partager</button></form>
      <p class="muted" style="margin-top:8px">La personne voit le projet et ses tâches, et peut les modifier, dès qu'elle se connecte avec cette adresse. Seul vous pouvez renommer, supprimer ou partager le projet.</p>`;
    box.querySelectorAll("[data-e]").forEach(b=>b.onclick=()=>shareRemove(p.id,b.dataset.e,false));
    const f=box.querySelector("form");f.onsubmit=e=>{e.preventDefault();shareAdd(p.id,f.querySelector("input").value)};
  }
  function showGate(step){
    $("#gate").hidden=false;
    $("#gchoice").hidden=step!=="choice";$("#glogin").hidden=step!=="login";$("#gsignup").hidden=step!=="signup";
    $("#gforgot").hidden=step!=="forgot";$("#greset").hidden=step!=="reset";
    if(step==="forgot"){$("#ferr").textContent="";$("#fok").textContent="";$("#femail").value=$("#femail").value||$("#lemail").value;setTimeout(()=>$("#femail").focus(),0)}
    if(step==="reset"){$("#rerr").textContent="";setTimeout(()=>$("#rpass").focus(),0)}
    const ok=cloudReady();$("#gcloud").disabled=!ok;$("#gsignupbtn").hidden=!ok;$("#gnocloud").hidden=ok;
    if(step==="login")setTimeout(()=>$("#lemail").focus(),0);
    if(step==="signup"){$("#sdomains").textContent=CONFIG.allowedDomains&&CONFIG.allowedDomains.length?"Réservé aux adresses "+CONFIG.allowedDomains.map(d=>"@"+d).join(", ")+".":"";setTimeout(()=>$("#semail").focus(),0)}
  }
  async function toLocal(){
    if(MODE==="cloud"&&cloud.dirty.size&&!await uiConfirm(`${cloud.dirty.size} modification(s) en ligne ne sont pas encore envoyées. Elles le seront à votre prochain passage en mode en ligne. Continuer ?`,{ok:"Continuer"}))return;
    if(cloud.channel){cloudClient().removeChannel(cloud.channel);cloud.channel=null}
    cloud.user=null;
    try{localStorage.setItem("todo-mode","local")}catch(e){}
    location.reload();
  }
  function toCloud(){
    if(!cloudReady()){uiAlert("Le mode en ligne n'est pas configuré dans ce fichier, ou la connexion Internet est indisponible.");return}
    try{localStorage.setItem("todo-mode","cloud")}catch(e){}
    location.reload();
  }

  // ---------- Lecture d'un calendrier ICS (Outlook) ----------
  const ICS={};
  (function(){
    const WINTZ={"Romance Standard Time":"Europe/Paris","W. Europe Standard Time":"Europe/Berlin","Central Europe Standard Time":"Europe/Budapest","Central European Standard Time":"Europe/Warsaw","GMT Standard Time":"Europe/London","Greenwich Standard Time":"Atlantic/Reykjavik","E. Europe Standard Time":"Europe/Chisinau","FLE Standard Time":"Europe/Kiev","GTB Standard Time":"Europe/Bucharest","Turkey Standard Time":"Europe/Istanbul","Russian Standard Time":"Europe/Moscow","Morocco Standard Time":"Africa/Casablanca","W. Central Africa Standard Time":"Africa/Lagos","South Africa Standard Time":"Africa/Johannesburg","Arabian Standard Time":"Asia/Dubai","India Standard Time":"Asia/Kolkata","China Standard Time":"Asia/Shanghai","Singapore Standard Time":"Asia/Singapore","Tokyo Standard Time":"Asia/Tokyo","AUS Eastern Standard Time":"Australia/Sydney","Eastern Standard Time":"America/New_York","Central Standard Time":"America/Chicago","Mountain Standard Time":"America/Denver","Pacific Standard Time":"America/Los_Angeles","SA Pacific Standard Time":"America/Bogota","E. South America Standard Time":"America/Sao_Paulo","Argentina Standard Time":"America/Argentina/Buenos_Aires","Central America Standard Time":"America/Guatemala","Pacific SA Standard Time":"America/Santiago","UTC":"UTC","Coordinated Universal Time":"UTC"};
    const LOCAL=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"}catch(e){return "UTC"}})();
    const okTz=tz=>{try{new Intl.DateTimeFormat("en-US",{timeZone:tz});return true}catch(e){return false}};
    const resolveTz=tz=>{if(!tz)return LOCAL;tz=tz.replace(/^"|"$/g,"");if(WINTZ[tz])return WINTZ[tz];if(okTz(tz))return tz;const m=Object.keys(WINTZ).find(k=>tz.toLowerCase().includes(k.toLowerCase()));return m?WINTZ[m]:LOCAL};
    const fmtCache={};
    function offset(ts,tz){ // ms à ajouter à l'heure UTC pour obtenir l'heure locale du fuseau
      if(tz==="UTC")return 0;
      const f=fmtCache[tz]||(fmtCache[tz]=new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}));
      const p={};f.formatToParts(new Date(ts)).forEach(x=>p[x.type]=x.value);
      return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour%24,+p.minute,+p.second)-Math.floor(ts/1000)*1000;
    }
    function toUtc(w,tz){ // heure murale -> instant
      const g=Date.UTC(w.y,w.m-1,w.d,w.h,w.mi,w.s);
      if(tz==="UTC")return g;
      let t=g-offset(g,tz); t=g-offset(t,tz); return t;
    }
    function parseDate(v,params,vtz){
      const isDate=params.VALUE==="DATE"||/^\d{8}$/.test(v);
      const m=/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v); if(!m)return null;
      const w={y:+m[1],m:+m[2],d:+m[3],h:+(m[4]||0),mi:+(m[5]||0),s:+(m[6]||0)};
      const tz=m[7]?"UTC":(isDate?"FLOAT":resolveTz(params.TZID));
      return {w,tz:isDate?LOCAL:tz,allDay:isDate};
    }
    const unesc=s=>s.replace(/\\n/gi,"\n").replace(/\\([,;\\])/g,"$1");
    function parse(text){
      const lines=String(text||"").replace(/\r\n?/g,"\n").replace(/\n[ \t]/g,"").split("\n");
      const evs=[];let cur=null,depth=[];
      for(const ln of lines){
        if(!ln)continue;
        if(ln==="BEGIN:VEVENT"){cur={exdates:[]};depth.push("VEVENT");continue}
        if(ln.startsWith("BEGIN:")){depth.push(ln.slice(6));continue}
        if(ln==="END:VEVENT"){if(cur)evs.push(cur);cur=null;depth.pop();continue}
        if(ln.startsWith("END:")){depth.pop();continue}
        if(!cur||depth[depth.length-1]!=="VEVENT")continue; // ignore VALARM etc.
        const c=ln.indexOf(":"); if(c<0)continue;
        const head=ln.slice(0,c), val=ln.slice(c+1);
        const [name,...ps]=head.split(";"); const params={};
        ps.forEach(p=>{const i=p.indexOf("=");if(i>0)params[p.slice(0,i).toUpperCase()]=p.slice(i+1)});
        switch(name.toUpperCase()){
          case "UID":cur.uid=val;break;
          case "SUMMARY":cur.title=unesc(val);break;
          case "LOCATION":cur.location=unesc(val);break;
          case "STATUS":cur.status=val.toUpperCase();break;
          case "DTSTART":cur.start=parseDate(val,params);break;
          case "DTEND":cur.end=parseDate(val,params);break;
          case "DURATION":cur.duration=val;break;
          case "RRULE":cur.rrule=val;break;
          case "EXDATE":val.split(",").forEach(v=>{const d=parseDate(v,params);if(d)cur.exdates.push(d)});break;
          case "RECURRENCE-ID":cur.recurId=parseDate(val,params);break;
          case "X-MICROSOFT-CDO-BUSYSTATUS":cur.busy=val.toUpperCase();break;
        }
      }
      return evs.filter(e=>e.start);
    }
    function durMs(s){const m=/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s||"");if(!m)return 0;return (m[1]==="-"?-1:1)*((+m[2]||0)*6048e5+(+m[3]||0)*864e5+(+m[4]||0)*36e5+(+m[5]||0)*6e4+(+m[6]||0)*1e3)}
    const DAYS=["SU","MO","TU","WE","TH","FR","SA"];
    const dOf=(y,m,d)=>new Date(Date.UTC(y,m-1,d));
    const wOf=(dt,base)=>({y:dt.getUTCFullYear(),m:dt.getUTCMonth()+1,d:dt.getUTCDate(),h:base.h,mi:base.mi,s:base.s});
    const dim=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
    function nthWeekday(y,m,wd,n){ // n>0 : n-ième ; n<0 : en partant de la fin
      if(n>0){const first=dOf(y,m,1).getUTCDay();const d=1+((wd-first+7)%7)+7*(n-1);return d<=dim(y,m)?d:null}
      const last=dim(y,m),ld=dOf(y,m,last).getUTCDay();const d=last-((ld-wd+7)%7)+7*(n+1);return d>=1?d:null;
    }
    // Liste des occurrences (heure murale) d'une règle, jusqu'à 'until' (instant)
    function expandRule(ev,rangeEnd){
      const r={};ev.rrule.split(";").forEach(p=>{const [k,v]=p.split("=");r[k.toUpperCase()]=v});
      const freq=r.FREQ, iv=Math.max(1,+r.INTERVAL||1), count=r.COUNT?+r.COUNT:Infinity;
      const until=r.UNTIL?(()=>{const u=parseDate(r.UNTIL,{});return u.allDay?toUtc({...u.w,h:23,mi:59,s:59},ev.start.tz):toUtc(u.w,u.tz)})():Infinity;
      const byday=(r.BYDAY||"").split(",").filter(Boolean).map(x=>{const m=/^([+-]?\d+)?([A-Z]{2})$/.exec(x);return m?{n:m[1]?+m[1]:0,wd:DAYS.indexOf(m[2])}:null}).filter(Boolean);
      const bymd=(r.BYMONTHDAY||"").split(",").filter(Boolean).map(Number);
      const bym=(r.BYMONTH||"").split(",").filter(Boolean).map(Number);
      const setpos=(r.BYSETPOS||"").split(",").filter(Boolean).map(Number);
      const wkst=DAYS.indexOf(r.WKST||"MO");
      const s=ev.start.w, sDate=dOf(s.y,s.m,s.d), tz=ev.start.tz;
      const out=[];let n=0;
      const push=list=>{
        list.sort((a,b)=>a-b);
        let l=list.map(x=>new Date(x));
        if(setpos.length)l=setpos.map(p=>p>0?l[p-1]:l[l.length+p]).filter(Boolean);
        for(const dt of l){
          if(dt<sDate)continue;
          const w=wOf(dt,s), t=toUtc(w,tz);
          if(t>until||n>=count)return false;
          n++; if(t>rangeEnd)return false;
          out.push({w,t});
        }
        return true;
      };
      for(let i=0;i<20000;i++){
        let cands=[];
        if(freq==="DAILY"){const d=new Date(sDate);d.setUTCDate(d.getUTCDate()+i*iv);
          if((bym.length&&!bym.includes(d.getUTCMonth()+1))||(byday.length&&!byday.some(b=>b.wd===d.getUTCDay()))){if(toUtc(wOf(d,s),tz)>Math.min(until,rangeEnd))break;continue}
          cands=[d.getTime()];}
        else if(freq==="WEEKLY"){const ws=new Date(sDate);ws.setUTCDate(ws.getUTCDate()-((ws.getUTCDay()-wkst+7)%7)+7*i*iv);
          const wds=byday.length?byday.map(b=>b.wd):[sDate.getUTCDay()];
          cands=wds.map(wd=>{const d=new Date(ws);d.setUTCDate(d.getUTCDate()+((wd-wkst+7)%7));return d.getTime()});}
        else if(freq==="MONTHLY"||freq==="YEARLY"){
          const months=[];
          if(freq==="MONTHLY"){const k=(s.m-1)+i*iv;months.push([s.y+Math.floor(k/12),k%12+1])}
          else (bym.length?bym:[s.m]).forEach(mm=>months.push([s.y+i*iv,mm]));
          for(const [y,mm] of months){
            if(freq==="MONTHLY"&&bym.length&&!bym.includes(mm))continue;
            if(bymd.length)bymd.forEach(md=>{const d=md>0?md:dim(y,mm)+md+1;if(d>=1&&d<=dim(y,mm))cands.push(dOf(y,mm,d).getTime())});
            else if(byday.length)byday.forEach(b=>{if(b.n){const d=nthWeekday(y,mm,b.wd,b.n);if(d)cands.push(dOf(y,mm,d).getTime())}else{for(let d=1;d<=dim(y,mm);d++)if(dOf(y,mm,d).getUTCDay()===b.wd)cands.push(dOf(y,mm,d).getTime())}});
            else if(s.d<=dim(y,mm))cands.push(dOf(y,mm,s.d).getTime());
          }
        } else {cands=[sDate.getTime()];push(cands);break}
        if(!push(cands))break;
        const lastC=Math.max(...cands.concat([0]));
        if(cands.length&&toUtc(wOf(new Date(lastC),s),tz)>Math.min(until,rangeEnd)+864e5*400)break;
      }
      return out;
    }
    // Occurrences entre deux instants
    ICS.instances=function(evs,from,to){
      const res=[];
      const overrides=new Map(); // uid|instant d'origine
      evs.filter(e=>e.recurId).forEach(e=>overrides.set(e.uid+"|"+toUtc(e.recurId.w,e.recurId.tz),e));
      const mk=(e,t)=>{
        let len;
        if(e.end)len=toUtc(e.end.w,e.end.tz)-toUtc(e.start.w,e.start.tz);
        else if(e.duration)len=durMs(e.duration);
        else len=e.start.allDay?864e5:0;
        return {uid:e.uid||"",title:e.title||"(sans titre)",location:e.location||"",allDay:!!e.start.allDay,start:t,end:t+Math.max(0,len),busy:e.busy||""};
      };
      for(const e of evs){
        if(e.status==="CANCELLED")continue;
        const t0=toUtc(e.start.w,e.start.tz);
        if(e.recurId||!e.rrule){const x=mk(e,t0);if(x.end>=from&&x.start<to||(x.start>=from&&x.start<to))res.push(x);continue}
        const ex=new Set(e.exdates.map(d=>toUtc(d.w,d.tz)));
        for(const o of expandRule(e,to)){
          if(ex.has(o.t)||overrides.has(e.uid+"|"+o.t))continue;
          const x=mk(e,o.t);
          if(x.end>from&&x.start<to||(x.start>=from&&x.start<to))res.push(x);
        }
      }
      return res.sort((a,b)=>a.start-b.start);
    };
    ICS.parse=parse;
  })();
  // ---------- Familles de tâches (par projet) ----------
  function getFamilies(pid){
    const l=MODE==="cloud"?(cloud.families[pid]||[]):((proj(pid)||{}).families||[]);
    return l.slice().sort((a,b)=>a.name.localeCompare(b.name,"fr",{sensitivity:"base"}));
  }
  const famOf=t=>t.family?getFamilies(t.projectId).find(f=>f.id===t.family)||null:null;
  const famName=t=>{const f=famOf(t);return f?f.name:""};
  async function addFamily(pid,name){
    name=String(name||"").trim().slice(0,60); if(!name)return null;
    const ex=getFamilies(pid).find(f=>f.name.toLowerCase()===name.toLowerCase()); if(ex)return ex.id;
    const id=crypto.randomUUID?crypto.randomUUID():uid()+uid();
    if(MODE==="cloud"){
      const {error}=await cloudClient().from("project_families").insert({id,project_id:pid,name});
      if(error){uiAlert(transient(error)?"Famille non créée : connexion au serveur impossible.":"Famille refusée : "+error.message);return null}
      (cloud.families[pid]=cloud.families[pid]||[]).push({id,name});cloud._lastFm=JSON.stringify(cloud.families);
      return id;
    }
    const pr=proj(pid); if(!pr)return null;
    pr.families=[...(pr.families||[]),{id,name}]; save(); return id;
  }
  async function renameFamily(pid,fid,name){
    name=String(name||"").trim().slice(0,60); if(!name)return false;
    if(MODE==="cloud"){
      const {error}=await cloudClient().from("project_families").update({name}).eq("id",fid);
      if(error){uiAlert("Renommage impossible : "+error.message);return false}
      (cloud.families[pid]||[]).forEach(f=>{if(f.id===fid)f.name=name});cloud._lastFm=JSON.stringify(cloud.families);return true;
    }
    const pr=proj(pid); if(!pr)return false;
    pr.families=(pr.families||[]).map(f=>f.id===fid?{...f,name}:f); save(); return true;
  }
  async function deleteFamily(pid,fid){
    const f=getFamilies(pid).find(x=>x.id===fid); if(!f)return false;
    const n=state.tasks.filter(t=>t.projectId===pid&&t.family===fid).length;
    if(!await uiConfirm(`Supprimer la famille « ${f.name} » ?${n?` Les ${n} tâche(s) qui l'utilisent passeront en « Sans famille ».`:""}`,{ok:"Supprimer",danger:true}))return false;
    if(MODE==="cloud"){
      const {error}=await cloudClient().from("project_families").delete().eq("id",fid);
      if(error){uiAlert("Suppression impossible : "+error.message);return false}
      cloud.families[pid]=(cloud.families[pid]||[]).filter(x=>x.id!==fid);cloud._lastFm=JSON.stringify(cloud.families);
    } else {const pr=proj(pid);pr.families=(pr.families||[]).filter(x=>x.id!==fid)}
    state.tasks.forEach(t=>{if(t.projectId===pid&&t.family===fid)t.family=""});
    save(); return true;
  }

  // ---------- Profils (prénom et nom) ----------
  function nameOf(v){
    if(!v)return "";
    if(MODE!=="cloud")return v;
    const p=cloud.profiles[String(v).trim().toLowerCase()];
    return p?`${p.first} ${p.last}`:v;
  }
  const whoName=t=>nameOf((t.who||"").trim());
  const initialsOf=n=>String(n||"").replace(/@.*/,"").split(/[\s._-]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("")||"?";
  const AV_COLORS=["#3E7CB1","#2F7D5B","#8E5BB5","#B8860B","#1F8A8A","#C0396B","#4A6272","#5C7CFA"];
  const avColor=n=>{let h=0;for(const c of String(n||""))h=(h*31+c.charCodeAt(0))>>>0;return AV_COLORS[h%AV_COLORS.length]};
  // Panneau de détail à droite : le formulaire d'édition reste dans la ligne (même logique), affiché en panneau latéral
  function drawerize(f,kicker,title,onClose){
    f.classList.add("drawer");f.setAttribute("role","dialog");f.setAttribute("aria-label","Détail : "+title);
    const h=document.createElement("div");h.className="dhead full";
    h.innerHTML=`<div class="dkick">${kicker}</div><button type="button" class="dclose" aria-label="Fermer le détail">✕</button>`;
    h.querySelector(".dclose").onclick=onClose;
    // libellés visibles au-dessus des champs (les références aux champs sont déjà prises : l'enveloppe ne change rien au code)
    [...f.children].forEach(el=>{
      if(!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))return;
      const lb=el.getAttribute("aria-label");if(!lb)return;
      const w=document.createElement("label");w.className="dfield"+(el.tagName==="SELECT"||el.type==="date"?"":" wide");
      w.innerHTML=`<span>${esc(lb)}</span>`;el.replaceWith(w);w.appendChild(el);
    });
    f.prepend(h);
  }
  // Attribution : un nom ou une adresse correspondant à un membre du projet est enregistré sous son e-mail
  const memberEmails=pid=>{
    if(MODE!=="cloud")return [];
    const s=new Set([cloud.email]),add=m=>{if(!m)return;if(m.ownerEmail)s.add(String(m.ownerEmail).toLowerCase());(m.members||[]).forEach(e=>s.add(String(e).toLowerCase()))};
    if(pid)add(cloud.meta[pid]);else Object.values(cloud.meta).forEach(add);
    return [...s].filter(Boolean);
  };
  function resolveWho(txt,pid){
    txt=String(txt||"").trim();if(!txt||MODE!=="cloud")return txt;
    const n=norm(txt);
    for(const e of [...memberEmails(pid),...memberEmails()])if(n===norm(e)||n===norm(nameOf(e)))return e;
    return txt;
  }
  const isMyTask=t=>MODE==="cloud"&&!!cloud.email&&!!(t.who||"").trim()&&(String(t.who).trim().toLowerCase()===cloud.email||norm(whoName(t))===norm(nameOf(cloud.email)));
  async function saveProfile(first,last){
    const {error}=await cloudClient().from("profiles").upsert({user_id:cloud.user.id,first_name:first,last_name:last,updated_at:Date.now()});
    if(error)return error;
    cloud.profiles[cloud.email]={first,last};cloud._lastPr=JSON.stringify(cloud.profiles);
    const d=$("#profdlg");if(d.open&&d.close)d.close();
    $("#whoami").textContent=nameOf(cloud.email);render();
    return null;
  }
  async function ensureProfile(){
    const md=(cloud.user&&cloud.user.user_metadata)||{};
    if(md.first_name&&md.last_name){if(!await saveProfile(String(md.first_name).trim(),String(md.last_name).trim()))return}
    openProfile(true);
  }
  function openProfile(first){
    const dlg=$("#profdlg"), me=cloud.profiles[cloud.email]||{};
    $("#pfirst").value=me.first||"";$("#plast").value=me.last||"";$("#perr").textContent="";
    $("#proftitle").textContent=first?"Complétez votre profil":"Mon nom";
    $("#profintro").textContent=first?"Indiquez votre prénom et votre nom : c'est ainsi que vos collègues vous verront dans les projets partagés, les commentaires et les responsables.":"Votre prénom et votre nom, tels que vos collègues les voient.";
    if(dlg.showModal)dlg.showModal();else dlg.setAttribute("open","");
    setTimeout(()=>$("#pfirst").focus(),0);
  }
  async function submitProfile(e){
    e.preventDefault();
    const f=$("#pfirst").value.trim(), l=$("#plast").value.trim();
    if(!f||!l){$("#perr").textContent="Le prénom et le nom sont obligatoires.";return}
    $("#psave").disabled=true;
    const err=await saveProfile(f,l);
    $("#psave").disabled=false;
    if(err){$("#perr").textContent=transient(err)?"Serveur injoignable : réessayez dans un instant.":"Enregistrement impossible : "+err.message;return}
    $("#profdlg").close&&$("#profdlg").close();
  }

  // ---------- Réunions Outlook (calendrier publié) ----------
  const OUTLOOK_HOSTS=["outlook.office365.com","outlook.office.com","outlook.live.com"];
  const cal={events:null,fetchedAt:0,loading:false,error:"",hasLink:null,lastTry:0};
  async function fnError(error){try{const j=await error.context.json();return j}catch(e){return {code:"",message:error&&error.message||"Erreur inconnue"}}}
  async function loadMeetings(force,need){ // need : chargé même si l'affichage dans l'agenda est désactivé (choix d'une réunion)
    if(MODE!=="cloud"||!cloud.user||(!ui.showMeetings&&!need)||cal.loading)return;
    if(!force&&cal.events&&Date.now()-cal.fetchedAt<10*60e3)return;
    if(!force&&!cal.events&&Date.now()-cal.lastTry<60e3)return; // pas de nouvel essai immédiat après un échec
    cal.loading=true;cal.lastTry=Date.now();cal.error="";if(ui.mode==="agenda")renderMeetStatus();
    try{
      const {data,error}=await cloudClient().functions.invoke("outlook-ics",{method:"POST",body:{}});
      if(error){
        const j=await fnError(error);
        if(j.code==="no_link"){cal.hasLink=false;cal.events=null;cal.error="";cal.loading=false;ui.showMeetings=false;saveUi();render();if(!need)openCalCfg();return}
        cal.error=j.message||"Calendrier indisponible pour le moment.";
      } else {
        const text=typeof data==="string"?data:(data instanceof Blob?await data.text():String(data||""));
        cal.events=ICS.parse(text);cal.fetchedAt=Date.now();cal.hasLink=true;
      }
    }catch(e){cal.error="Calendrier indisponible : vérifiez votre connexion."}
    cal.loading=false;
    if(ui.mode==="agenda")render();
  }
  function renderMeetStatus(){
    const el=document.getElementById("meetstatus"); if(!el)return;
    el.className="mstatus"+(cal.error?" err":"");
    el.textContent=cal.loading?"Réunions Outlook : chargement…":cal.error?("Réunions Outlook : "+cal.error):(cal.events?`Réunions Outlook mises à jour à ${new Date(cal.fetchedAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`:"");
  }
  const hm=ms=>new Date(ms).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
  function meetingsByDay(ws){
    const out={}; if(!ui.showMeetings||!cal.events)return out;
    const from=ws.getTime(), to=addDays(ws,7).getTime();
    let list=[];try{list=ICS.instances(cal.events,from,to)}catch(e){cal.error="lecture du calendrier impossible.";return out}
    for(let i=0;i<7;i++){
      const d0=addDays(ws,i).getTime(), d1=addDays(ws,i+1).getTime(), key=iso(addDays(ws,i));
      out[key]=list.filter(m=>m.allDay?(m.start<d1&&m.end>d0):(m.start>=d0&&m.start<d1)||(m.start<d0&&m.end>d0));
    }
    return out;
  }
  function meetEl(m,dayStart){
    const el=document.createElement("div");el.className="meet"+(m.busy==="FREE"?" free":"");
    const time=m.allDay?"Journée":(m.start<dayStart?"Suite":`${hm(m.start)} – ${hm(m.end)}`);
    const cr=mtgForOutlook(m);
    el.innerHTML=`<span class="mt">${time}${cr?` <span class="crb" title="Compte rendu ${cr.status==="validated"?"validé":"en brouillon"}">CR</span>`:""}</span><span class="mn">${esc(m.title)}</span>${m.location?`<span class="ml">${esc(m.location)}</span>`:""}`;
    el.title=`${m.title}${m.location?" · "+m.location:""} — cliquez pour ${cr?"ouvrir":"créer"} le compte rendu`;
    el.setAttribute("role","button");el.tabIndex=0;el.classList.add("clk");
    el.onclick=()=>mtgFromOutlook(m);el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();mtgFromOutlook(m)}};
    return el;
  }
  async function openCalCfg(){
    const dlg=$("#calcfg"); $("#calerr").textContent=""; $("#calurl").value="";
    $("#calremove").hidden=true;
    if(dlg.showModal)dlg.showModal();else dlg.setAttribute("open","");
    try{const {data}=await cloudClient().from("user_calendar").select("ics_url").eq("user_id",cloud.user.id);if(data&&data[0]){$("#calurl").value=data[0].ics_url;$("#calremove").hidden=false;cal.hasLink=true}}catch(e){}
  }
  async function saveCalCfg(){
    let v=$("#calurl").value.trim().replace(/^webcal:\/\//i,"https://");
    let u;try{u=new URL(v)}catch(e){$("#calerr").textContent="Collez le lien ICS complet, qui commence par https://";return}
    if(u.protocol!=="https:"||!OUTLOOK_HOSTS.includes(u.hostname.toLowerCase())){$("#calerr").textContent="Ce lien ne vient pas d'Outlook / Microsoft 365. Copiez le lien « ICS » proposé par Outlook.";return}
    $("#calsave").disabled=true;
    const {error}=await cloudClient().from("user_calendar").upsert({user_id:cloud.user.id,ics_url:u.toString(),updated_at:Date.now()});
    $("#calsave").disabled=false;
    if(error){$("#calerr").textContent="Enregistrement impossible : "+(error.message||"erreur");return}
    $("#calcfg").close&&$("#calcfg").close();
    cal.hasLink=true;ui.showMeetings=true;saveUi();cal.events=null;loadMeetings(true);render();
  }
  async function removeCal(){
    if(!await uiConfirm("Retirer le lien de votre calendrier Outlook ? Les réunions ne s'afficheront plus.",{ok:"Retirer",danger:true}))return;
    await cloudClient().from("user_calendar").delete().eq("user_id",cloud.user.id);
    cal.events=null;cal.hasLink=false;ui.showMeetings=false;saveUi();
    $("#calcfg").close&&$("#calcfg").close();render();
  }

  // ---------- Actions ----------
  // Logo du client : image recadrée sur son contenu, réduite à 240 px, stockée avec le projet (data URL)
  async function logoMake(file){
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((ok,ko)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>ko(new Error("img"));i.src=url});
      let w=img.naturalWidth||512, h=img.naturalHeight||512;const k0=Math.min(1,1200/Math.max(w,h));w=Math.max(1,Math.round(w*k0));h=Math.max(1,Math.round(h*k0));
      const c=document.createElement("canvas");c.width=w;c.height=h;const g=c.getContext("2d");g.drawImage(img,0,0,w,h);
      // recadrage : on retire les marges transparentes ou blanches
      let x0=w,y0=h,x1=-1,y1=-1;
      try{const d=g.getImageData(0,0,w,h).data;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(d[i+3]>16&&!(d[i]>244&&d[i+1]>244&&d[i+2]>244)){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}}}catch(e){}
      if(x1<0){x0=0;y0=0;x1=w-1;y1=h-1}
      const pad=Math.round(Math.max(x1-x0,y1-y0)*0.04);x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);x1=Math.min(w-1,x1+pad);y1=Math.min(h-1,y1+pad);
      const cw=x1-x0+1, ch=y1-y0+1;
      for(const max of [240,160,110]){
        const k=Math.min(1,max/Math.max(cw,ch)), o=document.createElement("canvas");o.width=Math.max(1,Math.round(cw*k));o.height=Math.max(1,Math.round(ch*k));
        const og=o.getContext("2d");og.imageSmoothingQuality="high";og.drawImage(c,x0,y0,cw,ch,0,0,o.width,o.height);
        let u=o.toDataURL("image/webp",0.92);if(!/^data:image\/webp/.test(u))u=o.toDataURL("image/png");
        if(u.length<=100000&&LOGO_RX.test(u))return u;
      }
      return null;
    }catch(e){return null}finally{URL.revokeObjectURL(url)}
  }
  function logoDialog(p){
    let cur=pLogo(p)||"";
    const d=document.createElement("dialog");d.className="uidlg logodlg";d.setAttribute("aria-label","Logo du client");
    d.innerHTML=`<form method="dialog"><h3>Logo du client</h3>
      <p class="uimsg">Affiché dans la liste des projets, en tête du projet, sur les comptes rendus, les exports de points ouverts et les rapports de déplacement.</p>
      <div class="logodrop" tabindex="0" role="button" aria-label="Choisir une image"><img alt="" hidden><span>Glissez l'image ici, collez-la (Ctrl+V) ou cliquez pour choisir un fichier.<small>PNG, JPEG, WebP ou SVG. Les marges blanches sont retirées automatiquement.</small></span></div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" hidden>
      <p class="uierr" hidden></p>
      <div class="uibtns"><button type="button" class="btn ghost logodel" data-del>Retirer le logo</button><span style="flex:1"></span><button type="button" class="btn ghost" data-x>Annuler</button><button type="button" class="btn primary" data-ok>Enregistrer</button></div></form>`;
    document.body.appendChild(d);
    const zone=d.querySelector(".logodrop"), im=zone.querySelector("img"), txt=zone.querySelector("span"), inp=d.querySelector("input"), err=d.querySelector(".uierr");
    const show=()=>{im.hidden=!cur;txt.hidden=!!cur;if(cur)im.src=cur;d.querySelector("[data-del]").hidden=!cur;zone.classList.toggle("has",!!cur)};
    const take=async f=>{
      if(!f||!/^image\//.test(f.type)){err.hidden=false;err.textContent="Ce fichier n'est pas une image.";return}
      err.hidden=true;zone.classList.add("busy");const u=await logoMake(f);zone.classList.remove("busy");
      if(!u){err.hidden=false;err.textContent="Image illisible. Essayez un fichier PNG ou JPEG.";return}
      cur=u;show();
    };
    const onPaste=e=>{const it=[...(e.clipboardData&&e.clipboardData.items||[])].find(x=>x.kind==="file"&&/^image\//.test(x.type));if(it){e.preventDefault();take(it.getAsFile())}};
    document.addEventListener("paste",onPaste);
    zone.onclick=()=>inp.click();zone.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();inp.click()}};
    inp.onchange=()=>{if(inp.files[0])take(inp.files[0]);inp.value=""};
    zone.ondragover=e=>{e.preventDefault();zone.classList.add("over")};zone.ondragleave=()=>zone.classList.remove("over");
    zone.ondrop=e=>{e.preventDefault();zone.classList.remove("over");const f=e.dataTransfer&&e.dataTransfer.files[0];if(f)take(f)};
    const close=()=>{document.removeEventListener("paste",onPaste);try{d.close()}catch(e){}d.remove()};
    d.addEventListener("cancel",e=>{e.preventDefault();close()});
    d.querySelector("[data-x]").onclick=close;
    d.querySelector("[data-del]").onclick=()=>{cur="";show()};
    d.querySelector("[data-ok]").onclick=()=>{const pr=proj(p.id);if(pr&&(pLogo(pr)||"")!==cur){if(cur)pr.logo=cur;else delete pr.logo;save();render();toast(cur?"Logo du client enregistré.":"Logo du client retiré.")}close()};
    show();
    if(d.showModal)d.showModal();else d.setAttribute("open","");
  }
  function addProject(name){
    name=name.trim(); if(!name)return;
    const p={id:uid(),name,color:nextColor()};
    state.projects.push(p); view=p.id; if(isPhone())ui.mode="home"; save(); render();
    if(MODE==="cloud")setTimeout(()=>tplDialog(p,true),400);
  }
  async function renameProject(p){
    const n=await uiPrompt("Nouveau nom du projet",p.name,{ok:"Renommer"}); if(n&&n.trim()){p.name=n.trim();save();render()}
  }
  async function deleteProject(p){
    const nb=state.tasks.filter(t=>t.projectId===p.id).length;
    const mem=MODE==="cloud"&&cloud.meta[p.id]?cloud.meta[p.id].members.length:0;
    if(!await uiConfirm(`Supprimer définitivement le projet « ${p.name} »${nb?` et ses ${nb} tâche(s)`:""} ?${mem?` Il sera aussi supprimé pour les ${mem} personne(s) avec qui il est partagé.`:""}\n\nCette action est irréversible. Pour un projet terminé, préférez « Archiver » : il sera masqué mais restera consultable.`,{ok:"Supprimer le projet",danger:true}))return;
    await visPurgeProject(p.id);
    state.projects=state.projects.filter(x=>x.id!==p.id);
    state.tasks=state.tasks.filter(t=>t.projectId!==p.id);
    state.requests=(state.requests||[]).filter(r=>r.projectId!==p.id);
    state.points=(state.points||[]).filter(o=>o.projectId!==p.id);
    view="all"; save(); render();
  }
  function clearDone(){
    const pool=live().filter(t=>t.status==="done"&&(view==="all"?!isArch(t.projectId):t.projectId===view));
    if(!pool.length)return;
    const at=Date.now();
    undoable(`${pool.length} tâche${pool.length>1?"s":""} terminée${pool.length>1?"s":""} mise${pool.length>1?"s":""} à la corbeille`,pool,()=>pool.forEach(t=>t.deletedAt=at));
  }
  // ---------- Ajout en une ligne : « Relancer le client demain @Alice !haute #Alpha » ----------
  // Les mots reconnus remplissent l'échéance, le responsable, la priorité et le projet ;
  // un champ rempli à la main garde toujours la priorité sur ce qui est deviné.
  const WDAYS=["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
  function qParse(raw){
    let t=" "+String(raw||"")+" ";const out={};
    const cut=re=>{const m=t.match(re);if(m){t=t.replace(m[0]," ");return m}return null};
    // priorité
    let m=cut(/\s!(haute|urgent(?:e)?|h|basse|b|normale|n)(?=\s)/i);
    if(m){const k=m[1].toLowerCase();out.prio=/^h|^u/.test(k)?"haute":/^b/.test(k)?"basse":"normale"}
    // projet (#nom, mots collés ou début du nom)
    m=t.match(/\s#([^\s#@!]+)(?=\s)/);
    if(m){const k=norm(m[1]).replace(/[^a-z0-9]/g,"");const pr=k&&state.projects.filter(x=>!x.archived).find(x=>{const n=norm(x.name).replace(/[^a-z0-9 ]/g,"");return n.replace(/ /g,"").startsWith(k)||n.split(" ").some(w=>w&&w.startsWith(k))});if(pr){out.pid=pr.id;t=t.replace(m[0]," ")}}
    // responsable (@nom, comparé aux personnes connues)
    m=cut(/\s@([^\s@#!]+)(?=\s)/);
    if(m){const k=norm(m[1]);const pp=[...document.querySelectorAll("#people option")].map(o=>o.value).filter(Boolean);
      out.who=pp.find(n=>norm(n).startsWith(k))||pp.find(n=>norm(n).split(/\s+/).some(w=>w.startsWith(k)))||(m[1].charAt(0).toUpperCase()+m[1].slice(1))}
    // échéance
    const d0=today();let d=null;
    if((m=cut(/\s(aujourd'hui|aujourd’hui|auj)(?=\s)/i)))d=d0;
    else if((m=cut(/\s(apr[eè]s-demain)(?=\s)/i)))d=addDays(d0,2);
    else if((m=cut(/\s(demain)(?=\s)/i)))d=addDays(d0,1);
    else if((m=cut(/\sdans\s+(\d{1,3})\s+(jours?|semaines?|mois)(?=\s)/i))){const n=+m[1];d=/^j/i.test(m[2])?addDays(d0,n):/^s/i.test(m[2])?addDays(d0,7*n):(x=>{x.setMonth(x.getMonth()+n);return x})(new Date(d0))}
    else if((m=cut(/\s(semaine prochaine)(?=\s)/i)))d=addDays(mondayOf(d0),7);
    else if((m=cut(/\s(?:le\s+)?(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?(?=\s)/i))){let y=m[3]?+m[3]:d0.getFullYear();if(y<100)y+=2000;const x=new Date(y,+m[2]-1,+m[1]);if(!m[3]&&x<d0)x.setFullYear(y+1);if(x.getMonth()===+m[2]-1)d=x}
    else if((m=cut(new RegExp("\\s(?:(?:ce|le)\\s+)?("+WDAYS.join("|")+")(?:\\s+prochain)?(?=\\s)","i")))){const w=WDAYS.indexOf(m[1].toLowerCase());d=addDays(d0,(w-d0.getDay()+7)%7||7)}
    if(d)out.due=iso(d);
    out.title=t.replace(/\s+/g," ").trim();
    return out;
  }
  function qPreview(){
    const el=$("#qparse"),q=$("#quick");if(!el)return;
    const v=$("#qt").value, r=qParse(v);q.classList.toggle("has",!!v.trim());
    const bits=[];
    if(r.due&&!$("#qd").value)bits.push(`<span class="tag today">Échéance : ${esc(shortDay(r.due))}</span>`);
    if(r.who&&!$("#qw").value.trim())bits.push(`<span class="tag">Responsable : ${esc(r.who)}</span>`);
    if(r.prio&&$("#qprio").value==="normale"&&r.prio!=="normale")bits.push(`<span class="tag">Priorité ${esc(r.prio)}</span>`);
    if(r.pid&&proj(r.pid))bits.push(`<span class="tag">${pMark(proj(r.pid))}${esc(proj(r.pid).name)}</span>`);
    el.innerHTML=bits.length?`<span class="qpl">Compris :</span>${bits.join("")}`:"";el.hidden=!bits.length;
  }
  function addTask(){
    const r=qParse($("#qt").value);
    const title=r.title||$("#qt").value.trim(); let pid=$("#qp").value;
    if(!title)return;
    if(r.pid&&proj(r.pid))pid=r.pid;
    if(!pid){uiAlert("Créez d'abord un projet.");return}
    const prio=$("#qprio").value!=="normale"?$("#qprio").value:(r.prio||"normale");
    const due=$("#qd").value||r.due||"";
    const who=$("#qw").value.trim()||r.who||"";
    state.tasks.push({id:uid(),projectId:pid,title,priority:prio,due,status:"todo",note:"",who:resolveWho(who,pid),createdAt:Date.now(),checklist:[],repeat:null});
    $("#qt").value="";$("#qd").value="";$("#qprio").value="normale";qPreview();
    save(); render(); $("#qt").focus();
  }
  window.__qParse=qParse; // utilisé par les tests
  // ---------- Tâches récurrentes ----------
  const REPEATS=[["","Ne se répète pas"],["1-day","Tous les jours"],["1-week","Toutes les semaines"],["2-week","Toutes les 2 semaines"],["1-month","Tous les mois"]];
  const repKey=r=>r&&r.n&&r.unit?`${r.n}-${r.unit}`:"";
  const repLabel=r=>(REPEATS.find(x=>x[0]===repKey(r))||[0,""])[1];
  const repFrom=k=>{if(!k)return null;const [n,unit]=k.split("-");return {n:+n,unit}};
  function nextDue(t){
    const r=t.repeat, step=d=>{const x=new Date(d);if(r.unit==="day")x.setDate(x.getDate()+r.n);else if(r.unit==="week")x.setDate(x.getDate()+7*r.n);else{const day=x.getDate();x.setDate(1);x.setMonth(x.getMonth()+r.n);x.setDate(Math.min(day,new Date(x.getFullYear(),x.getMonth()+1,0).getDate()))}return x};
    let d=step(t.due?parseD(t.due):today());
    while(d<today())d=step(d);
    return iso(d);
  }
  function spawnNext(t){
    if(!t.repeat||!t.repeat.unit)return null;
    if(t.repeat.nextId&&state.tasks.some(x=>x.id===t.repeat.nextId))return null; // déjà créée
    const id=MODE==="cloud"&&crypto.randomUUID?crypto.randomUUID():uid();
    const n={id,projectId:t.projectId,title:t.title,priority:t.priority,due:nextDue(t),status:"todo",note:t.note||"",who:t.who||"",createdAt:Date.now(),
      checklist:(t.checklist||[]).map(c=>({id:uid(),text:c.text,done:false})),repeat:{n:t.repeat.n,unit:t.repeat.unit}};
    t.repeat={...t.repeat,nextId:id};
    state.tasks.push(n);
    return n;
  }
  function toggle(t){
    if(t.status==="done"){applyStatus(t,"todo");save();render();return}
    changeStatus(t,"done");
  }
  function cycleDoing(t){applyStatus(t,t.status==="todo"?"doing":"todo");save();render()}
  function removeTask(t){
    if(editing===t.id)editing=null;
    undoable(`« ${short(t.title)} » mise à la corbeille`,[t],()=>{t.deletedAt=Date.now()});
  }

  // ---------- Rendu ----------
  const prioRank={haute:0,normale:1,basse:2};
  function sortOpen(a,b){
    const la=isLate(a),lb=isLate(b); if(la!==lb)return la?-1:1;
    if(a.due&&b.due&&a.due!==b.due)return a.due<b.due?-1:1;
    if(prioRank[a.priority]!==prioRank[b.priority])return prioRank[a.priority]-prioRank[b.priority];
    if(!!a.due!==!!b.due)return a.due?-1:1;
    return a.createdAt-b.createdAt;
  }
  const cap=w=>w.charAt(0).toUpperCase()+w.slice(1);
  const longDay=d=>d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  const shortDay=s=>cap(parseD(s).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"}));
  const ICON_MORE='<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg>';
  const ICON_CHEV='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
  // Regroupement par échéance
  function bucketOf(t){
    if(t.status==="waiting")return "waiting";
    if(!t.due)return "none";
    const d=parseD(t.due), t0=today(), diff=Math.round((d-t0)/864e5);
    if(diff<0)return "late"; if(diff===0)return "today"; if(diff===1)return "tomorrow";
    const endWeek=addDays(mondayOf(t0),6), endNext=addDays(mondayOf(t0),13);
    if(d<=endWeek)return "week"; if(d<=endNext)return "next"; return "later";
  }
  function bucketDefs(){
    const t0=today(), m=mondayOf(t0), nm=addDays(m,7), ne=addDays(m,13);
    const rng=(a,b)=>a.getMonth()===b.getMonth()?`${a.getDate()} – ${b.getDate()} ${b.toLocaleDateString("fr-FR",{month:"long"})}`:`${a.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})} – ${b.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}`;
    return [
      ["late","En retard",""],
      ["today","Aujourd'hui",longDay(t0)],
      ["tomorrow","Demain",longDay(addDays(t0,1))],
      ["week","Cette semaine",""],
      ["next","Semaine prochaine",rng(nm,ne)],
      ["later","Plus tard",""],
      ["none","Sans échéance",""],
      ["waiting","En attente","relances"]
    ];
  }
  function render(){
    if(view!=="all"&&!proj(view))view="all";
    if(ui.mode==="kanban")ui.mode="list"; // ancien mode Kanban (retiré)
    if(ui.taskMode==="kanban")ui.taskMode="list";
    if(!["list","agenda","dash","trash","requests","points","meetings","visits","home","projects","overview"].includes(ui.mode))ui.mode="list";
    if(ui.mode==="overview"&&isPhone())ui.mode=view==="all"?"list":"home"; // sur téléphone, l'accueil du projet tient lieu de vue d'ensemble
    if(ui.mode==="projects"){if(isPhone())view="all";else ui.mode="list"}
    if(ui.mode==="home"&&(view==="all"||!isPhone()))ui.mode="list";
    if((ui.mode==="points"||ui.mode==="meetings"||ui.mode==="visits"||ui.mode==="overview")&&view==="all")ui.mode="list";
    if(["list","agenda"].includes(ui.mode))ui.taskMode=ui.mode;
    if(ui.mode==="trash"||ui.mode==="dash")view="all";
    const mode=ui.mode;
    // sélection multiple : quittée en changeant de vue
    const sctx=view+"|"+mode+"|"+(query.trim()?"q":"");
    if(selMode&&(sctx!==selCtx||!((selMode==="t"&&mode==="list")||(selMode==="o"&&mode==="points"))||query.trim())){selMode=null;selIds.clear()}
    selCtx=sctx;$("#lists").classList.toggle("selmode",!!selMode);
    Promise.resolve().then(()=>{selBar();document.body.classList.toggle("hasdrawer",!!document.querySelector("#lists .edit.drawer"))});
    const alive=live();
    const open=alive.filter(t=>t.status!=="done"&&!isArch(t.projectId));
    const nToday=open.filter(t=>isLate(t)||isToday(t)||needsRelance(t)).length;
    const wkS=iso(mondayOf(new Date())), wkE=iso(addDays(mondayOf(new Date()),6));
    const hidA=hiddenSet();
    const nWeek=open.filter(t=>t.due&&t.due>=wkS&&t.due<=wkE&&!hidA.has(t.projectId)).length;
    const nTrash=state.tasks.length-alive.length+(state.requests||[]).filter(r=>r.deletedAt).length+(state.points||[]).filter(o=>o.deletedAt).length;
    const nReq=liveReq().filter(r=>reqOpen(r)&&!isArch(r.projectId)).length;
    if(ui.scope!=="today")ui.scope="all";

    // vues
    const V=$("#views"); V.innerHTML="";
    const VIC={today:"M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",agenda:"M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v14H3zM3 10h18M8 3v4M16 3v4",all:"M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",mine:"M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",req:"M4 4h16v12H8l-4 4z",dash:"M4 20V10M10 20V4M16 20v-7M22 20H2",trash:"M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"};
    const vb=(id,label,n,act,fn)=>{const x=document.createElement("button");x.type="button";x.className="vbtn";x.dataset.v=id;x.setAttribute("aria-current",act);x.innerHTML=`<svg class="vic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${VIC[id]||""}"></path></svg><span>${label}</span><span class="n">${n||""}</span>`;x.onclick=fn;V.appendChild(x)};
    const go=(mode,scope)=>()=>{query="";$("#search").value="";ui.mode=mode;ui.scope=scope;saveUi();view="all";editing=null;shareOpen=false;weekStart=null;closeMenu();render()};
    vb("today","Ma journée",nToday,view==="all"&&mode==="list"&&ui.scope==="today",go("list","today"));
    vb("agenda","Agenda de la semaine",nWeek,view==="all"&&mode==="agenda",go("agenda","all"));
    // « Tâches » : une seule entrée ; le filtre Mes tâches / Toutes est dans la vue (choix mémorisé)
    const tasksWho=()=>MODE==="cloud"?(ui.tasksWho!=null?ui.tasksWho:"__me"):"";
    const goTasks=()=>{ui.who=tasksWho();go("list","all")()};
    vb("all","Tâches",MODE==="cloud"&&tasksWho()==="__me"?open.filter(isMyTask).length:open.length,view==="all"&&mode==="list"&&ui.scope==="all",goTasks);
    // barre de navigation du téléphone
    {const bn=$("#bnav");if(bn){
      const mine=MODE==="cloud";
      bn.querySelector('[data-b="mine"] .bl').textContent="Tâches";
      const act={today:view==="all"&&mode==="list"&&ui.scope==="today",mine:view==="all"&&mode==="list"&&ui.scope==="all",agenda:mode==="agenda",menu:mode==="projects"||view!=="all"};
      bn.querySelectorAll("[data-b]").forEach(x=>{const k=x.dataset.b;x.setAttribute("aria-current",!!act[k]);
        if(k==="add"){x.onclick=()=>{mmClose();$("#fab").click()};x.setAttribute("aria-expanded",document.body.classList.contains("addopen"));return}
        x.onclick=k==="menu"?()=>{closeMenu();query="";$("#search").value="";ui.mode="projects";view="all";editing=null;saveUi();render();window.scrollTo({top:0})}
          :k==="today"?()=>{if(ui.who==="__me")ui.who="";go("list","today")()}
          :k==="agenda"?()=>{go("agenda","all")()}
          :goTasks});
    }}
    vb("dash","Tableau de bord","",mode==="dash",go("dash","all"));
    vb("trash","Corbeille",nTrash||"",mode==="trash",go("trash","all"));V.lastChild.classList.add("mobonly-v");
    const tb=$("#trashbtn");
    if(tb){
      tb.setAttribute("aria-pressed",mode==="trash");
      tb.title=mode==="trash"?"Fermer la corbeille":nTrash?`Corbeille : ${nTrash} tâche${nTrash>1?"s":""}`:"Corbeille (vide)";
      tb.setAttribute("aria-label",tb.title);
      tb.querySelector(".tbn").textContent=nTrash>99?"99+":nTrash||"";
      tb.onclick=mode==="trash"?go("list","all"):go("trash","all");
    }

    // projets
    const pl=$("#plist"); pl.innerHTML="";
    const addP=p=>{
      const all=alive.filter(t=>t.projectId===p.id), nOpen=all.filter(t=>t.status!=="done").length;
      const pct=all.length?Math.round(100*(all.length-nOpen)/all.length):0;
      const m=MODE==="cloud"&&cloud.meta[p.id];
      const PSH=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8"></path></svg>`;
      const badge=m?(m.owner!==cloud.user.id?`<span class="pshared" title="Partagé par ${esc(nameOf(m.ownerEmail))}"><span class="vsr">invité</span>${PSH}</span>`:(m.members.length?`<span class="pshared" title="Partagé avec ${esc(m.members.map(nameOf).join(", "))}"><span class="vsr">partagé</span>${PSH}</span>`:"")):"";
      const li=document.createElement("li");
      li.innerHTML=`<button class="pbtn${p.archived?" arch":""}" type="button" style="--pc:${esc(p.color||"#3E7CB1")}" aria-current="${view===p.id}">${pMark(p)}<span class="pname">${esc(p.name)}</span>${badge}${ansOf(p.id).length?`<span class="pansn" title="${ansTxt(ansOf(p.id).length)} (Excel)">${ansOf(p.id).length}</span>`:""}<span class="count">${nOpen}</span><span class="pbar" title="${pct} % terminé"><i style="width:${pct}%;background:${p.color}"></i></span></button>`;
      li.firstChild.onclick=e=>{if(projDrag.justDropped){e.preventDefault();return}openProject(p.id)};
      if(!p.archived){li.dataset.pid=p.id;li.className="pli";projDragBind(li)}
      pl.appendChild(li);
    };
    const actP=state.projects.filter(p=>!p.archived), archP=state.projects.filter(p=>p.archived);
    actP.forEach(addP);
    if(archP.length){
      const li=document.createElement("li");
      const openA=!!ui.showArchived||(view!=="all"&&isArch(view));
      li.innerHTML=`<button class="parch" type="button" aria-expanded="${openA}">${ICON_CHEV}<span>Projets archivés (${archP.length})</span></button>`;
      li.firstChild.onclick=()=>{ui.showArchived=!openA;saveUi();render()};
      pl.appendChild(li);
      if(openA)archP.forEach(addP);
    }

    // en-tête
    const p=view==="all"?null:proj(view);
    const agenda=mode==="agenda";
    $("#quick").hidden=mode==="dash"||mode==="trash"||mode==="requests"||mode==="points"||mode==="home"||mode==="projects"||mode==="overview"||mode==="visits"||mode==="meetings";
    $("#wrap").classList.toggle("wide",agenda||mode==="dash");
    // onglets du projet : tâches / demandes client
    const tabs=$("#ptabs");$("#stucklbl").textContent=p?p.name:"";
    if(p&&mode!=="dash"&&mode!=="trash"&&!query.trim()){
      const nT=alive.filter(t=>t.projectId===p.id&&t.status!=="done").length, nR=liveReq().filter(r=>r.projectId===p.id&&reqOpen(r)).length;
      tabs.hidden=false;
      const nO=livePts().filter(o=>o.projectId===p.id&&o.status!=="closed").length;
      tabs.innerHTML=`${isPhone()?"":`<button type="button" role="tab" aria-selected="${mode==="overview"}" data-tab="overview">Vue d'ensemble</button>`}<button type="button" role="tab" aria-selected="${mode!=="requests"&&mode!=="points"&&mode!=="meetings"&&mode!=="visits"&&mode!=="overview"}" data-tab="tasks">Tâches <span>${nT}</span></button><button type="button" role="tab" aria-selected="${mode==="points"}" data-tab="points">Points<span class="tlx"> ouverts</span> <span>${nO}</span>${ansOf(p.id).length?`<i class="ansdot" title="${ansTxt(ansOf(p.id).length)}" aria-label="${ansTxt(ansOf(p.id).length)}"></i>`:""}</button><button type="button" role="tab" aria-selected="${mode==="requests"}" data-tab="requests">Demandes<span class="tlx"> client</span> <span>${nR}</span></button><button type="button" role="tab" aria-selected="${mode==="meetings"}" data-tab="meetings">Réunions <span>${mtgList(p.id).length}</span></button><button type="button" role="tab" aria-selected="${mode==="visits"}" data-tab="visits">Déplacements <span>${(visEnsure(),visList(p.id).length)}</span></button>`;
      tabs.querySelectorAll("[data-tab]").forEach(x=>x.onclick=()=>{const k=x.dataset.tab;ui.mode=k==="tasks"?(ui.taskMode||"list"):k;if(ui.mode!=="list")ui.scope="all";saveUi();editing=null;editingReq=null;editingPt=null;render()});
    } else {tabs.hidden=true;tabs.innerHTML=""}
    if(!weekStart)weekStart=mondayOf(new Date());
    const wEnd=addDays(weekStart,6);
    let title, sub;
    const archTag=p&&p.archived?` <span class="archtag">Archivé</span>`:"";
    if(agenda){
      title=(p?`${pMark(p)}${esc(p.name)} · `:"")+`Semaine ${isoWeek(weekStart)}`+archTag;
      const sm=weekStart.getMonth()===wEnd.getMonth();
      sub=(sm?`${weekStart.getDate()} – ${wEnd.toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}`:`${weekStart.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})} – ${wEnd.toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"})}`);
    } else if(mode==="dash"){
      title="Tableau de bord";
      const na=actP.length;
      sub=`${cap(longDay(today()))} · ${na} projet${na>1?"s":""} actif${na>1?"s":""}${archP.length?`, ${archP.length} archivé${archP.length>1?"s":""}`:""}`;
    } else if(mode==="requests"){
      title=p?`${pMark(p)}${esc(p.name)}${archTag}`:"Demandes client";
      const rs=liveReq().filter(r=>(p?r.projectId===p.id:!isArch(r.projectId))&&reqOpen(r));
      const late=rs.filter(reqLate).length, out=rs.filter(r=>r.scope==="out").length, q=rs.filter(r=>r.quote==="todo").length;
      sub=`${rs.length} demande${rs.length>1?"s":""} client ouverte${rs.length>1?"s":""}`+(late?`, ${late} réponse${late>1?"s":""} en retard`:"")+(out?`, ${out} hors périmètre`:"")+(q?`, ${q} devis à faire`:"");
    } else if(mode==="points"){
      title=`${pMark(p)}${esc(p.name)}${archTag}`;
      const ps=livePts().filter(o=>o.projectId===p.id), no=ps.filter(o=>o.status!=="closed");
      const byO=k=>no.filter(o=>o.owner===k).length;
      sub=`${no.length} point${no.length>1?"s":""} ouvert${no.length>1?"s":""}`+(ps.length-no.length?`, ${ps.length-no.length} levé${ps.length-no.length>1?"s":""}`:"")+([["client","côté client"],["mecalux","côté Mecalux"],["tiers","côté tiers"]].filter(([k])=>byO(k)).map(([k,l])=>` · ${byO(k)} ${l}`).join(""));
    } else if(mode==="projects"){
      const na=state.projects.filter(x=>!x.archived).length;
      title="Projets";sub=`${na} projet${na>1?"s":""} en cours`;
    } else if(mode==="home"||mode==="overview"){
      title=`${pMark(p)}${esc(p.name)}${archTag}`;
      const m=MODE==="cloud"?cloud.meta[p.id]:null, others=m?[m.ownerEmail,...m.members].filter(e=>e!==cloud.email):[];
      sub=cap(longDay(today()))+(others.length?` · partagé avec ${others.map(nameOf).join(", ")}`:"");
    } else if(mode==="visits"){
      title=`${pMark(p)}${esc(p.name)}${archTag}`;
      const vs=visList(p.id), nOpen=vs.filter(x=>x.status==="open").length, nPrep=vs.filter(x=>x.status==="prep").length;
      sub=`${vs.length} déplacement${vs.length>1?"s":""}`+(nOpen?`, ${nOpen} en cours`:"")+(nPrep?`, ${nPrep} préparé${nPrep>1?"s":""}`:"");
    } else if(mode==="meetings"){
      title=`${pMark(p)}${esc(p.name)}${archTag}`;
      const ms=mtgList(p.id), nd=ms.filter(x=>x.status==="draft").length;
      sub=`${ms.length} compte${ms.length>1?"s":""} rendu${ms.length>1?"s":""} de réunion`+(nd?`, dont ${nd} brouillon${nd>1?"s":""}`:"");
    } else if(mode==="trash"){
      title="Corbeille";
      sub=nTrash?`${nTrash} élément${nTrash>1?"s":""} supprimé${nTrash>1?"s":""}`:"La corbeille est vide";
    } else {
      title=p?`${pMark(p)}${esc(p.name)}${archTag}`:(ui.scope==="today"?"Ma journée":ui.who==="__me"?"Mes tâches":"Toutes les tâches");
      const poolOpen=alive.filter(t=>t.status!=="done"&&(p?t.projectId===p.id:!isArch(t.projectId)));
      const pToday=poolOpen.filter(t=>isToday(t)).length, pLate=poolOpen.filter(isLate).length, pWait=poolOpen.filter(t=>t.status==="waiting").length;
      sub=`${cap(longDay(today()))} · ${poolOpen.length} tâche${poolOpen.length>1?"s":""} ouverte${poolOpen.length>1?"s":""}`+(pToday?`, ${pToday} pour aujourd'hui`:"")+(pLate?`, ${pLate} en retard`:"")+(pWait?`, ${pWait} en attente`:"");
    }
    {const fa=$("#fav");if(fa){const nm=MODE==="cloud"&&cloud.email?nameOf(cloud.email):"";fa.hidden=!nm;fa.textContent=initialsOf(nm)}}
    // Téléphone : dans une rubrique, le titre est celui de la rubrique (le projet figure dans le lien de retour)
    if(p&&mode!=="home"&&!query.trim()&&isPhone()){const lb={list:"Tâches",agenda:"Agenda du projet",points:"Points ouverts",meetings:"Réunions",visits:"Déplacements"}[mode];if(lb)title=lb}
    $("#ptitle").innerHTML=title; $("#psub").textContent=sub;
    if(document.body.dataset.mode&&document.body.dataset.mode!==mode&&document.body.classList.contains("addopen")){document.body.classList.remove("addopen");const fb=$("#fab");if(fb){fb.setAttribute("aria-expanded","false");fb.setAttribute("aria-label","Ajouter")}}
    document.body.dataset.mode=mode;
    // Téléphone : retour à l'accueil du projet depuis une rubrique
    {const pb=$("#pback");if(pb){const on=!!p&&mode!=="home"&&!query.trim();pb.hidden=!on;if(on){pb.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>${esc(p.name)}`;pb.onclick=()=>{ui.mode="home";saveUi();editing=null;editingPt=null;render();window.scrollTo({top:0})}}}}
    // ---- Indicateurs du projet (bandeau sous le titre) ----
    const K=$("#kpis");K.innerHTML="";K.hidden=true;K.classList.remove("jkpis");
    // couleur du projet ouvert : halo de l'en-tête et repères (design 3.0)
    {const mn=document.querySelector("main");if(mn){if(p)mn.style.setProperty("--pc",p.color||"#2F4A5A");else mn.style.removeProperty("--pc");mn.classList.toggle("inproj",!!p)}}
    if(!p&&!query.trim()&&mode==="list"&&ui.scope==="today"){
      // Ma journée : quatre compteurs (aujourd'hui, en retard, en attente, réunions du jour)
      const hid=hiddenSet(), mine=open.filter(t=>!hid.has(t.projectId)&&(!ui.who||ui.who===""||(ui.who==="__me"?isMyTask(t):true)));
      const nT=mine.filter(t=>isToday(t)&&t.status!=="waiting").length, nL=mine.filter(isLate).length, nW=mine.filter(t=>t.status==="waiting").length;
      let nM=null;try{if(MODE==="cloud"&&ui.showMeetings&&cal.events){const d=meetingsByDay(mondayOf(new Date()))[iso(today())]||[];nM=d.filter(m=>!m.allDay&&m.busy!=="FREE").length}}catch(e){}
      const jk=(n,l,c,go)=>`<button type="button" class="jk ${c}"${go?` data-jgo="${go}"`:""}><b>${n}</b><span>${esc(l)}</span></button>`;
      K.innerHTML=jk(nT,"pour aujourd'hui","jt","today")+jk(nL,"en retard","jl","late")+jk(nW,"en attente","jw","wait")+(nM!=null?jk(nM,nM>1?"réunions aujourd'hui":"réunion aujourd'hui","jm","meet"):jk(mine.filter(needsRelance).length,"relances à faire","jm","wait"));
      K.classList.add("jkpis");K.hidden=false;
      K.querySelectorAll("[data-jgo]").forEach(b=>b.onclick=()=>{const g=b.dataset.jgo;
        if(g==="meet"){ui.mode="agenda";ui.scope="all";saveUi();render();return}
        const h=[...document.querySelectorAll("#lists .group > h2, #lists h2")].find(x=>g==="late"?/retard/i.test(x.textContent):g==="wait"?/attente|relance/i.test(x.textContent):/aujourd/i.test(x.textContent));
        if(h)h.scrollIntoView({behavior:"smooth",block:"start"})});
    } else if(p&&!query.trim()&&["list","agenda","requests"].includes(mode)){
      const po=alive.filter(t=>t.projectId===p.id&&t.status!=="done");
      const pts=livePts().filter(o=>o.projectId===p.id&&o.status!=="closed"), cli=pts.filter(o=>o.owner==="client").length;
      const nxt=po.filter(t=>t.due&&!isLate(t)).sort((a,b)=>a.due<b.due?-1:1)[0];
      const k=(v,l,cls)=>`<div class="hk${cls?" "+cls:""}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
      K.innerHTML=k(po.length,po.length>1?"tâches ouvertes":"tâche ouverte")+k(po.filter(isLate).length,"en retard",po.some(isLate)?"bad":"")+k(po.filter(t=>t.status==="waiting").length,"en attente","wait")
        +(pts.length?k(pts.length,(pts.length>1?"points ouverts":"point ouvert")+(cli?` · ${cli} côté client`:"")):"")
        +(nxt?k(shortDay(nxt.due),"prochaine échéance"):"");
      K.hidden=false;
    } else if(p&&!query.trim()&&mode==="points"){
      const ps=livePts().filter(o=>o.projectId===p.id), no=ps.filter(o=>o.status!=="closed"), lev=ps.length-no.length;
      if(ps.length){
        const c=no.filter(o=>o.owner==="client").length, m=no.filter(o=>o.owner==="mecalux").length, t=no.filter(o=>o.owner==="tiers").length, nd=no.length-c-m-t;
        const pc=n=>(100*n/ps.length).toFixed(1)+"%";
        const xl=xlOn(p.id)&&ptLinkedProj(p.id)&&ui.xlLast&&ui.xlLast[p.id]?new Date(ui.xlLast[p.id]):null, xf=ui.xlFile&&ui.xlFile[p.id];
        K.innerHTML=`<div class="ptbar"><div class="bar" role="img" aria-label="Répartition des points : ${c} côté client, ${m} côté Mecalux, ${t} côté tiers, ${nd} sans interlocuteur, ${lev} levés"><span class="b-cli" style="width:${pc(c)}"></span><span class="b-mec" style="width:${pc(m)}"></span><span class="b-tie" style="width:${pc(t)}"></span><span class="b-nd" style="width:${pc(nd)}"></span><span class="b-ok" style="width:${pc(lev)}"></span></div>
          <div class="lg">${c?`<span><i class="b-cli"></i><b>${c}</b> à répondre par le client</span>`:""}${m?`<span><i class="b-mec"></i><b>${m}</b> côté Mecalux</span>`:""}${t?`<span><i class="b-tie"></i><b>${t}</b> côté tiers</span>`:""}${nd?`<span><i class="b-nd"></i><b>${nd}</b> sans interlocuteur</span>`:""}<span><i class="b-ok"></i><b>${lev}</b> levé${lev>1?"s":""}</span></div></div>
          ${xl?`<span class="xlbadge" title="${esc(xf||"")}${xf&&xlFsOk()?" – synchronisation automatique toutes les 10 minutes, appli ouverte":""}">Lié à ${xf?esc(xf):"l'Excel"} · mis à jour le ${xl.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})} à ${xl.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</span>`:""}
          ${xlOn(p.id)&&xlNeed[p.id]?`<button type="button" class="xlbadge xlact" data-xlgo>Cliquez pour reprendre la synchro Excel</button>`:""}
          ${xlOn(p.id)&&ui.xlPend&&ui.xlPend[p.id]?`<button type="button" class="xlbadge xlact" data-xlgo>Excel : ${ui.xlPend[p.id]} élément${ui.xlPend[p.id]>1?"s":""} à valider</button>`:""}`;
        K.querySelectorAll("[data-xlgo]").forEach(b=>b.onclick=()=>xlQuick(p));
        K.hidden=false;
      }
    }

    // ---- Haut à droite : actions sur le projet (Partager, Exporter, ⋯) ----
    const tools=$("#ptools"); tools.innerHTML="";
    const b=(txt,fn,cls,host)=>{const x=document.createElement("button");x.className="btn "+(cls||"ghost");x.type="button";x.textContent=txt;x.onclick=fn;(host||tools).appendChild(x);return x};
    const DDI={share:"M16 6l-4-4-4 4M12 2v13M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7",close:"M6 6l12 12M18 6 6 18",
      plan:"M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17",points:"M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0zM12 7.5v5.5M12 16.5h.01",
      recap:"M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h5",rename:"M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",logo:"M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9.5h.01",
      std:"M4 6h10M4 12h10M4 18h6M18 14v6M15 17h6",archive:"M3 4h18v4H3zM5 8v12h14V8M10 12h4",trash:"M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
      sync:"M20 11a8 8 0 0 0-14.6-4.5M4 4v3h3M4 13a8 8 0 0 0 14.6 4.5M20 20v-3h-3",link:"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
      imp:"M12 3v12M7 10l5 5 5-5M5 21h14",unlink:"M4 4l16 16M10 14a4 4 0 0 0 5.7 0l1.5-1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M13 6.3l.3-.3a4 4 0 0 1 5.7 5.7l-.6.6",
      quit:"M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"};
    const ddSvg=k=>`<span class="ddi" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="${DDI[k]}"></path></svg></span>`;
    const ddMenu=(label,items,cls,title)=>{
      const d=document.createElement("details");d.className="more ddm"+(cls?" "+cls:"");
      d.innerHTML=`<summary class="btn" aria-label="${esc(label.replace(/[▾⋯]/g,"").trim()||"Plus d'actions")}">${label==="⋯"?`<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`:label}</summary><div class="ddbg" aria-hidden="true"></div><div class="menu">${title?`<div class="ddsh"><span class="ddgrab" aria-hidden="true"></span><div class="ddtt">${title}</div><button type="button" class="ddx" aria-label="Fermer">${ddSvg("close")}</button></div>`:""}</div>`;
      const m=d.querySelector(".menu");
      d.querySelector(".ddbg").onclick=()=>{d.open=false};const dx0=d.querySelector(".ddx");if(dx0)dx0.onclick=()=>{d.open=false};
      d.addEventListener("toggle",()=>document.body.classList.toggle("ddopen",d.open&&matchMedia("(max-width:899px)").matches));
      items.filter(Boolean).forEach(it=>{if(it==="-"){m.insertAdjacentHTML("beforeend",`<hr>`);return}if(it.hr){m.insertAdjacentHTML("beforeend",`<hr class="${it.cls||""}">`);return}
        if(it.colors){const pr=it.colors, taken=new Set(state.projects.filter(x=>x.id!==pr.id).map(x=>String(x.color||"").toUpperCase()));
          const w=document.createElement("div");w.className="swatches";w.innerHTML=`<div class="mh">Couleur du projet</div><div class="sw">${COLORS.map(c=>`<button type="button" data-c="${c}" style="background:${c}" aria-label="Couleur ${c}${taken.has(c)?" (déjà utilisée par un autre projet)":""}" aria-pressed="${String(pr.color).toUpperCase()===c}" title="${taken.has(c)?"Déjà utilisée par un autre projet":"Choisir cette couleur"}" class="${String(pr.color).toUpperCase()===c?"on":""}${taken.has(c)?" taken":""}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg></button>`).join("")}</div>`;
          w.querySelectorAll("[data-c]").forEach(bt=>bt.onclick=()=>{d.open=false;document.body.classList.remove("ddopen");const cur=proj(pr.id);if(cur){cur.color=bt.dataset.c;save();render()}});
          m.appendChild(w);return}if(it.h){m.insertAdjacentHTML("beforeend",`<div class="mh${it.cls?" "+it.cls:""}">${esc(it.h)}</div>`);return}
        const x=document.createElement("button");x.type="button";x.className=(it.cls||"")+(it.i?" ddrow":"");x.innerHTML=it.i?ddSvg(it.i)+`<span class="ddt">${esc(it.t)}</span>`:esc(it.t);x.onclick=()=>{d.open=false;document.body.classList.remove("ddopen");it.fn()};m.appendChild(x)});
      tools.appendChild(d);return d;
    };
    const initials=n=>String(n||"").replace(/@.*/,"").split(/[\s._-]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("")||"?";
    const AVC=["#3E7CB1","#C2410C","#2F7D5B","#8E5BB5","#B8860B","#C0396B"];
    if(mode==="trash"){if(nTrash)b("Vider la corbeille",emptyTrash);b("Fermer la corbeille",go("list","all"),"")}
    else{
      if(p&&MODE==="cloud"&&isOwner(p.id)){
        const m=cloud.meta[p.id], who=m?[m.ownerEmail,...m.members]:[cloud.email];
        const sb=b("",()=>{shareOpen=!shareOpen;render()},"sharebtn");
        sb.innerHTML=`${who.length>1?`<span class="avs">${who.slice(0,4).map((e,i)=>`<span style="background:${AVC[i%AVC.length]}" title="${esc(nameOf(e))}">${esc(initials(nameOf(e)))}</span>`).join("")}${who.length>4?`<span class="more4">+${who.length-4}</span>`:""}</span>`:""}${shareOpen?"Fermer le partage":"Partager"}`;
        sb.title=who.length>1?"Partagé avec "+m.members.map(nameOf).join(", "):"Partager ce projet avec un collègue";
      }
      if(p&&mode==="points"&&(MODE!=="cloud"||isOwner(p.id))){
        if(xlOn(p.id)&&xlFsOk())b("Synchroniser avec Excel",()=>xlQuick(p),"deskonly");
        const xb=b("",()=>xlCfg(p),"deskonly xlcfgbtn");xb.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v16H4zM4 9h16M4 14h16M10 4v16"></path></svg><span>${xlOn(p.id)?"Lien Excel":"Connecter Excel"}</span>`;xb.title=xlOn(p.id)?"Fichier Excel lié : réglages et explications":"Synchroniser les points ouverts avec un fichier Excel (SharePoint / OneDrive)";
      }
      const dx=ddMenu("Exporter ▾",[{h:"Documents"},{t:"Récap de la semaine",fn:openRecap},{t:"Plan d'actions (Excel / PDF)",fn:()=>openExport(p,"tasks")},{t:"Points ouverts (Excel / PDF)",fn:()=>openExport(p,"points")}],"ddexp");
      dx.querySelector("summary").innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"></path></svg><span class="ddl">Exporter</span><span class="ddc" aria-hidden="true">▾</span>`;
      // éléments affichés seulement sur téléphone, où Partager et Exporter sont regroupés dans le menu ⋯
      const mob=p?[{h:"Partager et exporter",cls:"mobonly"},...(MODE==="cloud"&&isOwner(p.id)?[{t:shareOpen?"Fermer le partage":"Partager le projet…",i:shareOpen?"close":"share",fn:()=>{shareOpen=!shareOpen;render()},cls:"mobonly"}]:[]),
        {t:"Exporter le plan d'actions",i:"plan",fn:()=>openExport(p,"tasks"),cls:"mobonly"},{t:"Exporter les points ouverts",i:"points",fn:()=>openExport(p,"points"),cls:"mobonly"},{t:"Récap de la semaine",i:"recap",fn:openRecap,cls:"mobonly"},{t:"-",cls:"mobonly",hr:true}]:[];
      const ttl=p?`<span class="ddcol" style="background:${esc(p.color||"#888")}"></span><b>${esc(p.name)}</b>`:"";
      if(p){
        if(MODE!=="cloud"||isOwner(p.id))ddMenu("⋯",[...mob,{h:"Projet",cls:"mobonly"},{t:"Renommer le projet",i:"rename",fn:()=>renameProject(p)},{t:pLogo(p)?"Changer le logo du client…":"Ajouter le logo du client…",i:"logo",fn:()=>logoDialog(p)},...(MODE==="cloud"?[{t:"Ajouter les points ouverts standard…",i:"std",fn:()=>tplDialog(p,false)}]:[]),{colors:p},"-",{t:xlOn(p.id)?"Lien Excel des points ouverts…":"Synchroniser les points ouverts avec Excel…",i:"sync",fn:()=>xlCfg(p),cls:"deskonly"},{t:p.archived?"Réactiver le projet":"Archiver le projet",i:"archive",fn:()=>archiveProject(p,!p.archived)},{t:"Supprimer le projet",i:"trash",fn:()=>deleteProject(p),cls:"danger"}],"ddmore",ttl);
        else ddMenu("⋯",[...mob,{t:"Quitter le projet",i:"quit",fn:()=>shareRemove(p.id,cloud.email,true),cls:"danger"}],"ddmore",ttl);
      }
    }
    // ---- Barre d'affichage propre à l'onglet (au-dessus de la liste) ----
    const vbar=$("#viewbar");vbar.innerHTML="";
    const vl=document.createElement("div");vl.className="vbl";const vr=document.createElement("div");vr.className="vbr";
    const people=[...new Set(alive.map(whoName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr"));
    const sugg=new Set(people);
    if(MODE==="cloud"){if(cloud.email)sugg.add(nameOf(cloud.email));Object.values(cloud.meta).forEach(m=>{sugg.add(nameOf(m.ownerEmail));m.members.forEach(e=>sugg.add(nameOf(e)))})}
    $("#people").innerHTML=[...sugg].filter(Boolean).map(n=>`<option value="${esc(n)}">`).join("");
    if(ui.who&&ui.who!=="__none"&&ui.who!=="__me"&&!people.includes(ui.who))ui.who="";
    if(ui.who==="__me"&&MODE!=="cloud")ui.who="";
    const taskView=mode==="list"||agenda;
    if(taskView&&!query.trim()){
      const seg=document.createElement("div");seg.className="seg";seg.setAttribute("role","group");seg.setAttribute("aria-label","Affichage");
      [["list","Liste"],["agenda","Agenda"]].forEach(([m,l])=>{const x=document.createElement("button");x.type="button";x.textContent=l;x.setAttribute("aria-pressed",ui.mode===m);x.onclick=()=>{ui.mode=m;if(m!=="list")ui.scope="all";saveUi();editing=null;render()};seg.appendChild(x)});
      vl.appendChild(seg);
      if(agenda){
        const wn=document.createElement("div");wn.className="wnav";
        wn.innerHTML=`<button class="btn" type="button" data-w="-1" aria-label="Semaine précédente">${ICON_CHEV.replace('M9 6l6 6-6 6','M15 6l-6 6 6 6')}</button><button class="btn" type="button" data-w="0">Cette semaine</button><button class="btn" type="button" data-w="1" aria-label="Semaine suivante">${ICON_CHEV}</button>`;
        wn.querySelectorAll("[data-w]").forEach(x=>x.onclick=()=>{const n=+x.dataset.w;weekStart=n?addDays(weekStart,7*n):mondayOf(new Date());render()});
        vl.appendChild(wn);
      }
      if(mode==="list"&&!p&&ui.scope==="all"&&MODE==="cloud"){
        const ws=document.createElement("div");ws.className="seg wseg";ws.setAttribute("role","group");ws.setAttribute("aria-label","Tâches affichées");
        [["__me","Mes tâches"],["","Toutes"]].forEach(([w,l])=>{const x=document.createElement("button");x.type="button";x.textContent=l;x.dataset.who=w||"all";x.setAttribute("aria-pressed",w==="__me"?ui.who==="__me":ui.who!=="__me");x.onclick=()=>{ui.who=w;ui.tasksWho=w;saveUi();editing=null;render()};ws.appendChild(x)});
        vl.appendChild(ws);
      }
      if(mode==="list"){
        const gb=document.createElement("label");gb.className="whobox";
        gb.innerHTML=`Grouper par <select aria-label="Grouper par"><option value="due">Échéance</option><option value="family">Famille</option></select>`;
        const gs=gb.querySelector("select");gs.value=ui.groupBy||"due";gs.onchange=()=>{ui.groupBy=gs.value;saveUi();render()};
        vr.appendChild(gb);
      }
      if(agenda){
        if(!p&&state.projects.length)vr.appendChild(projectFilter());
        const mb=b("Réunions Outlook",()=>{
          if(MODE!=="cloud"){uiAlert("L'affichage des réunions Outlook est disponible en mode en ligne (avec un compte).");return}
          ui.showMeetings=!ui.showMeetings;saveUi();
          if(ui.showMeetings){if(cal.hasLink===false){openCalCfg();ui.showMeetings=false;saveUi();return}loadMeetings(false)}
          render();
        },"mtoggle",vr);
        mb.setAttribute("aria-pressed",!!ui.showMeetings&&MODE==="cloud");
        mb.title=MODE==="cloud"?"Afficher ou masquer vos réunions Outlook dans l'agenda":"Disponible en mode en ligne";
        if(MODE==="cloud"&&ui.showMeetings)b("Réglages du calendrier",openCalCfg,"",vr);
      }
      if((people.length||MODE==="cloud")&&!(!p&&ui.scope==="all"&&MODE==="cloud"&&ui.who==="__me")){
        const w=document.createElement("label");w.className="whobox";
        w.innerHTML=`Responsable <select id="whosel" aria-label="Filtrer par responsable"><option value="">Tout le monde</option>${MODE==="cloud"&&p?`<option value="__me">Mes tâches</option>`:""}${people.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("")}<option value="__none">Non attribuées</option></select>`;
        const sel=w.querySelector("select");sel.value=ui.who||"";sel.onchange=e=>{ui.who=e.target.value;if(!p&&(ui.who===""||ui.who==="__me"))ui.tasksWho=ui.who;saveUi();render()};
        vr.appendChild(w);
      }
    }
    if(!query.trim()&&mode==="points"&&p&&livePts().some(x=>x.projectId===p.id)){
      const seg=document.createElement("div");seg.className="seg";seg.setAttribute("role","group");seg.setAttribute("aria-label","Affichage des points");
      [["list","Détail"],["table","Tableau"]].forEach(([m,l])=>{const x=document.createElement("button");x.type="button";x.textContent=l;x.setAttribute("aria-pressed",(ui.ptView||"list")===m&&!(m==="table"&&selMode));x.onclick=()=>{ui.ptView=m;saveUi();if(m==="table"){selMode=null;selIds.clear();editingPt=null}render()};seg.appendChild(x)});
      vl.appendChild(seg);
    }
    if(!query.trim()&&((mode==="list"&&!agenda)||(mode==="points"&&p))){
      const k=mode==="points"?"o":"t";
      const sb=b(selMode?"Annuler la sélection":"Sélectionner",()=>selMode?selEnd():selStart(k),"selbtn",vr);
      sb.setAttribute("aria-pressed",!!selMode);sb.title="Sélectionner plusieurs éléments pour les modifier en une fois";
    }
    if(vr.children.length){
      const act=(ui.who?1:0)+((mode==="list"&&!agenda&&(ui.groupBy||"due")!=="due")?1:0)+(selMode?1:0);
      const fb=document.createElement("button");fb.type="button";fb.className="btn vbfilt";fb.setAttribute("aria-expanded",!!vbOpen);
      fb.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"></path></svg>Filtres${act?` <b>${act}</b>`:""}`;
      fb.onclick=()=>{vbOpen=!vbOpen;vbar.classList.toggle("open",vbOpen);fb.setAttribute("aria-expanded",vbOpen)};
      vl.appendChild(fb);
    }
    vbar.classList.toggle("open",!!vbOpen);
    vbar.append(vl,vr);vbar.hidden=!vl.children.length&&!vr.children.length;
    renderShare(p);

    // sélecteur projet
    const qp=$("#qp"); const cur=qp.value;
    const qps=state.projects.filter(x=>!x.archived||(p&&x.id===p.id));
    qp.innerHTML=qps.length?qps.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join(""):`<option value="">Aucun projet</option>`;
    qp.value=p?p.id:(qps.some(x=>x.id===cur)?cur:(qps[0]?.id||""));

    // contenu
    const L=$("#lists"); L.innerHTML="";$("#addslot").innerHTML="";$("#wrap").classList.remove("twocol");
    if(mode==="trash"&&!query.trim()){renderTrash(L);return}
    if(mode==="projects"&&!query.trim()){renderProjects(L);return}
    if(mode==="home"&&p&&!query.trim()){renderProjHome(L,p);return}
    if(mode==="overview"&&p&&!query.trim()){renderOverview(L,p);return}
    if(!state.projects.length){
      L.innerHTML=`<div class="empty">Commencez par créer un projet (« + Nouveau projet » dans la colonne de gauche), puis ajoutez vos tâches ici.</div>`;return;
    }
    if(mode==="requests"&&!query.trim()){renderRequests(L,p);return}
    if(mode==="meetings"&&p&&!query.trim()){renderMeetings(L,p);return}
    if(mode==="visits"&&p&&!query.trim()){renderVisits(L,p);return}
    if(mode==="points"&&p&&!query.trim()){renderPoints(L,p);return}
    const base=alive.filter(t=>(!p||t.projectId===p.id)&&(!ui.who||mode==="dash"||(ui.who==="__me"?isMyTask(t):ui.who==="__none"?!(t.who||"").trim():whoName(t)===ui.who)));
    if(query.trim()){
      // Recherche dans les tâches, les points ouverts et les demandes client
      const found=base.filter(matches);
      const fo=found.filter(t=>t.status!=="done").sort(sortOpen), fd=found.filter(t=>t.status==="done").sort((a,b)=>(b.doneAt||0)-(a.doneAt||0));
      const mq=txt=>{const h=norm(txt);return norm(query.trim()).split(/\s+/).every(w=>h.includes(w))};
      const pn=x=>(proj(x.projectId)||{}).name||"";
      const fp=livePts().filter(x=>(!p||x.projectId===p.id)&&mq([x.text,x.answer,x.hypothesis,x.theme,x.ownerName,ownerTxt(x),pn(x)].map(rtText).join("\n")))
        .sort((a,b)=>((a.status==="closed")-(b.status==="closed"))||pn(a).localeCompare(pn(b),"fr")||(a.createdAt||0)-(b.createdAt||0));
      const fr=liveReq().filter(r=>(!p||r.projectId===p.id)&&mq([r.title,r.description,r.requester,REQL[r.status],pn(r)].map(v=>rtText(v||"")).join("\n")))
        .sort((a,b)=>(reqOpen(b)-reqOpen(a))||((a.due||"9999")<(b.due||"9999")?-1:1));
      const total=found.length+fp.length+fr.length;
      $("#ptitle").innerHTML="Recherche";
      const part=(n,one,many)=>n?`${n} ${n>1?many:one}`:"";
      $("#psub").textContent=`${total} résultat${total>1?"s":""} pour « ${query.trim()} »`+(p?` dans ${p.name}`:"")+(total?" : "+[part(found.length,"tâche","tâches"),part(fp.length,"point ouvert","points ouverts"),part(fr.length,"demande client","demandes client")].filter(Boolean).join(", "):"");
      if(fo.length)L.appendChild(group("res","Tâches à faire et en cours","",fo,!p));
      if(fd.length)L.appendChild(group("done","Tâches terminées","",fd,!p));
      if(fp.length){
        const g=document.createElement("section");g.className="group g-pt";
        g.innerHTML=`<h2>Points ouverts <span>${fp.length}</span></h2>`;
        const ul=document.createElement("ul");ul.className="tasks";fp.forEach(x=>ul.appendChild(ptRow(x,ptLabel(x),!p)));g.appendChild(ul);L.appendChild(g);
      }
      if(fr.length){
        const g=document.createElement("section");g.className="group g-req";
        g.innerHTML=`<h2>Demandes client <span>${fr.length}</span></h2>`;
        const ul=document.createElement("ul");ul.className="tasks";fr.forEach(r=>ul.appendChild(reqRow(r,!p)));g.appendChild(ul);L.appendChild(g);
      }
      if(!total)L.insertAdjacentHTML("beforeend",`<div class="empty">Aucun résultat${p?" dans ce projet":""}. La recherche porte sur les tâches (intitulé, note, étapes, commentaires, responsable), les points ouverts (point, thème, hypothèse, réponse, interlocuteur) et les demandes client (objet, description, demandeur).${p?" Pour chercher dans tous les projets, cliquez sur « Toutes les tâches » puis relancez la recherche.":""}</div>`);
      return;
    }
    if(mode==="dash"){renderDash(L);return}
    const pool=p?base:base.filter(t=>!isArch(t.projectId));
    if(agenda){renderAgenda(L,p,pool);return}
    const openPool=pool.filter(t=>t.status!=="done").sort(sortOpen);
    const done=pool.filter(t=>t.status==="done").sort((a,b)=>(b.doneAt||0)-(a.doneAt||0));
    const wanted=ui.scope==="today"?["late","today","waiting"]:null;
    const inScope=t=>{if(!wanted)return true;const k=bucketOf(t);return k==="waiting"?needsRelance(t):wanted.includes(k)};
    let shown=0;
    if(ui.groupBy==="family"){
      const items=openPool.filter(inScope);
      const byPrio=(a,b)=>(prioRank[a.priority]??1)-(prioRank[b.priority]??1)||((a.due||"9999")<(b.due||"9999")?-1:(a.due||"9999")>(b.due||"9999")?1:0)||(a.createdAt||0)-(b.createdAt||0);
      const groups=new Map();
      items.forEach(t=>{const f=famOf(t);const k=f?t.projectId+"|"+f.id:"__none";if(!groups.has(k))groups.set(k,{f,proj:proj(t.projectId),items:[]});groups.get(k).items.push(t)});
      const keys=[...groups.keys()].sort((a,b)=>{if(a==="__none")return 1;if(b==="__none")return -1;const A=groups.get(a),B=groups.get(b);return A.f.name.localeCompare(B.f.name,"fr",{sensitivity:"base"})||(A.proj&&B.proj?A.proj.name.localeCompare(B.proj.name,"fr"):0)});
      keys.forEach(k=>{const g=groups.get(k);shown+=g.items.length;L.appendChild(group("fam",g.f?g.f.name:"Sans famille",g.f&&!p&&g.proj?g.proj.name:"",g.items.sort(byPrio),!p))});
    } else
    bucketDefs().forEach(([key,label,detail])=>{
      if(wanted&&!wanted.includes(key))return;
      const items=openPool.filter(t=>bucketOf(t)===key&&inScope(t));
      if(!items.length)return;
      shown+=items.length;
      L.appendChild(group(key,label,detail,items,!p));
    });
    if(!shown)L.insertAdjacentHTML("beforeend",`<div class="empty">${ui.scope==="today"?"Rien de prévu aujourd'hui, aucune tâche en retard ni relance à faire.":(pool.length?"Toutes les tâches sont terminées.":`Aucune tâche${p?" pour ce projet":""}. Saisissez-en une dans la barre ci-dessus.`)}</div>`);
    if(done.length&&ui.scope!=="today"){
      const btn=document.createElement("button");btn.type="button";btn.className="showdone";btn.setAttribute("aria-expanded",!!ui.showDoneList);
      btn.innerHTML=`${ICON_CHEV}${ui.showDoneList?"Masquer":"Afficher"} ${done.length>1?`les ${done.length} tâches terminées`:"la tâche terminée"}`;
      btn.onclick=()=>{ui.showDoneList=!ui.showDoneList;saveUi();render()};
      const row=document.createElement("div");row.className="donerow";row.appendChild(btn);
      const vd=document.createElement("button");vd.type="button";vd.className="btn ghost vider";vd.textContent="Vider les terminées";vd.title="Mettre toutes les tâches terminées à la corbeille (annulable)";vd.onclick=clearDone;row.appendChild(vd);
      L.appendChild(row);
      if(ui.showDoneList)L.appendChild(group("done","Terminées","",done,!p));
    }
    splitCols(L);
  }
  // Grand écran : répartit les groupes sur deux colonnes, dans l'ordre de lecture
  let wideMQ=null;
  function splitCols(L){
    const wrap=$("#wrap"); wrap.classList.remove("twocol");
    if(!wideMQ){wideMQ=window.matchMedia("(min-width:1700px)");wideMQ.addEventListener?.("change",()=>render())}
    if(!wideMQ.matches)return;
    const gs=[];for(const el of L.children){if(el.classList.contains("group"))gs.push(el);else break}
    if(gs.length<2)return;
    const w=gs.map(g=>2+g.querySelectorAll(".task").length+(g.querySelector(".task .edit")?8:0));
    const total=w.reduce((a,b)=>a+b,0);
    let acc=0,cut=1,best=Infinity;
    for(let i=0;i<gs.length-1;i++){acc+=w[i];const d=Math.abs(total-2*acc);if(d<best){best=d;cut=i+1}}
    const box=document.createElement("div");box.className="cols";
    const a=document.createElement("div"),b=document.createElement("div");a.className=b.className="col";
    gs.forEach((g,i)=>(i<cut?a:b).appendChild(g));
    box.append(a,b);L.prepend(box);wrap.classList.add("twocol");
  }
  // ---------- Vue agenda ----------
  function openInList(t){
    if(isArch(t.projectId))view=t.projectId;
    ui.mode="list";ui.scope="all";ui.showDoneList=ui.showDoneList||t.status==="done";saveUi();editing=t.id;render();
    const el=document.querySelector(`.task[data-id="${t.id}"]`);
    if(el)el.scrollIntoView({block:"center"});
  }
  function moveTo(id,due){
    const t=state.tasks.find(x=>x.id===id); if(!t||t.due===due)return;
    t.due=due; save(); render();
  }
  function dropZone(el,due){
    el.addEventListener("dragover",e=>{e.preventDefault();el.classList.add("over")});
    el.addEventListener("dragleave",()=>el.classList.remove("over"));
    el.addEventListener("drop",e=>{e.preventDefault();el.classList.remove("over");const id=e.dataTransfer.getData("text/plain");if(id)moveTo(id,due)});
  }
  function card(t,showProj,withDate){
    const pr=proj(t.projectId);
    const c=document.createElement("div");
    const late=isLate(t);
    c.className=`card${t.status==="done"?" done":""}${late?" late":""}`;
    c.style.setProperty("--pc",pr?pr.color:"#3E5868");
    c.draggable=true;
    const bits=[];
    if(t.status==="doing")bits.push(`<span class="st">En cours</span>`);
    if(t.status==="waiting")bits.push(`<span class="st wait">En attente${t.waitingFor?" · "+esc(t.waitingFor):""}</span>`);
    if(late)bits.push(`<span class="st">En retard</span>`);
    if(withDate&&t.due)bits.push(shortDay(t.due));
    if(t.priority==="haute")bits.push("Priorité haute");
    if(showProj&&pr)bits.push(esc(pr.name));
    if(t.who)bits.push(`<b>${esc(whoName(t))}</b>`);
    c.innerHTML=`<input type="checkbox" class="chk" ${t.status==="done"?"checked":""} aria-label="Marquer comme terminée"><div><div class="ct" title="Ouvrir le détail">${esc(t.title)}</div>${bits.length?`<div class="cm">${bits.join(" · ")}</div>`:""}</div>`;
    c.querySelector(".chk").onchange=()=>toggle(t);
    c.querySelector(".ct").onclick=()=>openInList(t);
    c.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain",t.id);e.dataTransfer.effectAllowed="move"});
    return c;
  }
  // ---------- Projets affichés dans l'agenda ----------
  let pfOpen=false;
  const hiddenSet=()=>new Set(Array.isArray(ui.hiddenProjects)?ui.hiddenProjects:[]);
  const isMine=pid=>MODE!=="cloud"||!cloud.meta[pid]||cloud.meta[pid].owner===(cloud.user&&cloud.user.id);
  function setHidden(ids,hide){
    const h=hiddenSet();ids.forEach(id=>hide?h.add(id):h.delete(id));
    ui.hiddenProjects=[...h].filter(id=>state.projects.some(x=>x.id===id));saveUi();render();
  }
  function projectFilter(){
    const h=hiddenSet(), all=state.projects.filter(x=>!x.archived);
    const mine=all.filter(x=>isMine(x.id)), shared=all.filter(x=>!isMine(x.id));
    const shown=all.filter(x=>!h.has(x.id)).length;
    const d=document.createElement("details");d.className="pfilter";d.open=pfOpen;
    d.addEventListener("toggle",()=>{pfOpen=d.open});
    const sec=(title,list)=>!list.length?"":`<div class="pfsec"><div class="pfhead"><b>${title}</b><span><button type="button" class="pflink" data-all="${list.map(x=>x.id).join(",")}">Tout</button> · <button type="button" class="pflink" data-none="${list.map(x=>x.id).join(",")}">Aucun</button></span></div>
      ${list.map(x=>{const m=MODE==="cloud"&&cloud.meta[x.id];const sub=m&&!isMine(x.id)?`<small>par ${esc(nameOf(m.ownerEmail))}</small>`:(m&&m.members.length?`<small>partagé</small>`:"");return `<label class="pfrow"><input type="checkbox" data-p="${x.id}" ${h.has(x.id)?"":"checked"}><span class="dot" style="background:${x.color}"></span><span class="pfname">${esc(x.name)}</span>${sub}</label>`}).join("")}</div>`;
    d.innerHTML=`<summary class="btn${shown<all.length?" pfactive":""}">Projets affichés : ${shown}/${all.length}</summary>
      <div class="pfmenu">${sec("Mes projets",mine)}${sec("Projets partagés avec moi",shared)}${!all.length?`<p class="hint">Aucun projet.</p>`:""}</div>`;
    d.querySelectorAll("[data-p]").forEach(cb=>cb.onchange=()=>setHidden([cb.dataset.p],!cb.checked));
    d.querySelectorAll("[data-all]").forEach(b=>b.onclick=()=>setHidden(b.dataset.all.split(","),false));
    d.querySelectorAll("[data-none]").forEach(b=>b.onclick=()=>setHidden(b.dataset.none.split(","),true));
    return d;
  }
  function renderAgenda(L,p,pool){
    if(!p){const h=hiddenSet();if(h.size)pool=pool.filter(t=>!h.has(t.projectId))}
    const startIso=iso(weekStart), endIso=iso(addDays(weekStart,6)), todayIso=iso(today());
    const showProj=!p;
    const visible=t=>ui.showDone||t.status!=="done";
    const top=document.createElement("div");top.style.cssText="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between";
    top.innerHTML=`<p class="hint">Glissez une tâche sur un autre jour pour changer son échéance. Cliquez sur son intitulé pour l'ouvrir.</p><label class="whobox"><input type="checkbox" ${ui.showDone?"checked":""}> Afficher les terminées</label>`;
    top.querySelector("input").onchange=e=>{ui.showDone=e.target.checked;saveUi();render()};
    L.appendChild(top);
    if(MODE==="cloud"&&ui.showMeetings){loadMeetings(false);const ms=document.createElement("p");ms.id="meetstatus";ms.style.margin="0";top.insertBefore(ms,top.lastElementChild);setTimeout(renderMeetStatus,0)}
    const meets=MODE==="cloud"?meetingsByDay(weekStart):{};
    // Visites sur site (préparées, en cours ou terminées) à leur date
    visEnsure();
    const hid=p?null:hiddenSet();
    const visDay={};state.projects.filter(x=>(p?x.id===p.id:!x.archived&&!(hid&&hid.has(x.id)))).forEach(x=>visList(x.id).forEach(v=>{if(v.status==="prep"&&!(v.prep&&v.prep.plannedAt))return;const n=visNDays(v), d0=new Date(visStartDay(v)+"T12:00");for(let j=0;j<n;j++){const k=iso(addDays(d0,j));(visDay[k]=visDay[k]||[]).push({v,j:j+1,n})}}));
    const visEl=(v,j,n)=>{const el=document.createElement("div");const pj=proj(v.projectId)||{name:"",color:"#999"};const st={prep:"Préparé",open:"En cours",done:"Terminé"}[v.status]||"";
      el.className="meet visag clk "+v.status;el.setAttribute("role","button");el.tabIndex=0;
      el.innerHTML=`<span class="mt">${[j===1&&(v.status==="prep"||v.startedAt)?hm(visDate(v)):"",n>1?`Jour ${j}/${n}`:"",""].filter(Boolean).join(" · ")}${(j===1&&(v.status==="prep"||v.startedAt))||n>1?" · ":""}<span class="vstb">Déplacement · ${st}</span></span><span class="mn">${esc(v.title)}</span>${showProj?`<span class="ml"><i class="dot" style="background:${esc(pj.color)}"></i>${esc(pj.name)}</span>`:v.prep&&v.prep.location?`<span class="ml">${esc(v.prep.location)}</span>`:""}`;
      el.title=`${v.title} (${st.toLowerCase()}) — cliquez pour ouvrir le déplacement`;
      el.onclick=()=>visOpen(v);el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();visOpen(v)}};return el};
    const wk=document.createElement("div");wk.className="week";
    for(let i=0;i<7;i++){
      const d=addDays(weekStart,i), di=iso(d);
      const dayMeets=meets[di]||[];
      const items=pool.filter(t=>t.due===di&&visible(t)).sort((a,b)=>(a.status==="done")-(b.status==="done")||sortOpen(a,b));
      const nOpen=items.filter(t=>t.status!=="done").length;
      const col=document.createElement("section");
      col.className=`day${i>=5?" we":""}${di===todayIso?" today":""}`;
      col.innerHTML=`<h2 class="dhead"><span>${cap(d.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric"}))}</span>${di===todayIso?`<span class="badge">Aujourd'hui</span>`:(nOpen?`<span class="n">${nOpen}</span>`:"")}</h2><div class="dbody"></div>`;
      const body=col.querySelector(".dbody");
      const dayVis=(visDay[di]||[]).sort((a,b)=>(a.j>1)-(b.j>1)||visDate(a.v)-visDate(b.v));
      dayVis.forEach(x=>body.appendChild(visEl(x.v,x.j,x.n)));
      dayMeets.forEach(m=>body.appendChild(meetEl(m,d.getTime())));
      if(items.length)items.forEach(t=>body.appendChild(card(t,showProj,false)));
      else if(i<5&&!dayMeets.length&&!dayVis.length)body.innerHTML=`<div class="dempty">Rien de prévu</div>`;
      dropZone(col,di);
      wk.appendChild(col);
    }
    L.appendChild(wk);
    const side=document.createElement("div");side.className="agside";
    const panel=(title,items,due,emptyTxt)=>{
      const sec=document.createElement("section");sec.className="day";
      sec.innerHTML=`<h2 class="dhead"><span>${title}</span><span class="n">${items.length||""}</span></h2><div class="dbody"></div>`;
      const body=sec.querySelector(".dbody");
      if(items.length)items.forEach(t=>body.appendChild(card(t,showProj,true)));
      else body.innerHTML=`<div class="dempty">${emptyTxt}</div>`;
      if(due!==null)dropZone(sec,due);
      return sec;
    };
    const lateBefore=pool.filter(t=>t.status!=="done"&&t.due&&t.due<startIso&&t.due<todayIso).sort(sortOpen);
    if(lateBefore.length)side.appendChild(panel("En retard",lateBefore,null,""));
    const nS=iso(addDays(weekStart,7)), nE=iso(addDays(weekStart,13));
    const nextW=pool.filter(t=>t.status!=="done"&&t.due&&t.due>=nS&&t.due<=nE).sort(sortOpen);
    side.appendChild(panel("Semaine suivante",nextW,null,"Rien de prévu pour l'instant."));
    const noDue=pool.filter(t=>t.status!=="done"&&!t.due).sort(sortOpen);
    side.appendChild(panel("Sans échéance",noDue,"","Toutes les tâches ouvertes ont une échéance."));
    L.appendChild(side);
  }
  function group(key,label,detail,items,showProj){
    const g=document.createElement("section");g.className="group g-"+key;
    if(key==="fam")g.classList.add("g-family");
    g.innerHTML=`<h2>${label} <span>${detail?esc(detail)+" · ":""}${items.length}</span></h2>`;
    const ul=document.createElement("ul");ul.className="tasks";
    items.forEach(t=>ul.appendChild(row(t,showProj,key)));
    g.appendChild(ul);
    return g;
  }
  // ---------- Texte enrichi (gras, italique, souligné, barré, surligné, couleur, listes, titres, liens) ----------
  // Stockage : texte brut tant qu'il n'y a aucune mise en forme ; sinon HTML nettoyé commençant par <p>, <ul>, <ol> ou <h3>.
  // Affichage : rtHtml() (toujours renettoyé) ; usages en texte brut (Excel, mails, recherche, extraits) : rtText().
  var RT_COL={r:"#C93C3C",b:"#2C6FB7",g:"#2F8A5F"};
  function rtIs(s){return typeof s==="string"&&s.charCodeAt(0)===60&&/^<(p|ul|ol|h3)>/.test(s)}
  var rtCache=new Map(), rtTxtCache=new Map();
  function rtColorKey(c){
    c=String(c||"").trim().toLowerCase();if(!c)return "";
    let r,g,b,m;
    if((m=c.match(/^#([0-9a-f]{3})$/)))[r,g,b]=m[1].split("").map(x=>parseInt(x+x,16));
    else if((m=c.match(/^#([0-9a-f]{6})$/)))[r,g,b]=[0,2,4].map(i=>parseInt(m[1].substr(i,2),16));
    else if((m=c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)))[r,g,b]=[+m[1],+m[2],+m[3]];
    else return {red:"r",blue:"b",green:"g"}[c]||"";
    if(r<60&&g<60&&b<60)return "";
    let best="",bd=1e9;for(const[k,h]of Object.entries(RT_COL)){const R=parseInt(h.substr(1,2),16),G=parseInt(h.substr(3,2),16),B=parseInt(h.substr(5,2),16);const d=(R-r)**2+(G-g)**2+(B-b)**2;if(d<bd){bd=d;best=k}}
    return bd<22000?best:"";
  }
  // fond coloré (surligné) : ni transparent, ni blanc, ni gris très clair
  function rtMarkBg(bg){
    bg=bg.trim().toLowerCase();if(/transparent|initial|inherit|none|white|var\(/.test(bg))return false;
    let m,r,g,b,a=1;
    if((m=bg.match(/^#([0-9a-f]{3})$/)))[r,g,b]=m[1].split("").map(x=>parseInt(x+x,16));
    else if((m=bg.match(/^#([0-9a-f]{6})/)))[r,g,b]=[0,2,4].map(i=>parseInt(m[1].substr(i,2),16));
    else if((m=bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/))){[r,g,b]=[+m[1],+m[2],+m[3]];if(m[4]!=null)a=+m[4]}
    else return /yellow|orange|pink|lime|cyan/.test(bg);
    if(a<0.2)return false;
    return !(Math.min(r,g,b)>225&&Math.max(r,g,b)-Math.min(r,g,b)<20);
  }
  // Nettoyage : seules les balises de la barre d'outils sont gardées ; tout le reste devient du texte.
  function rtClean(html){
    const doc=new DOMParser().parseFromString(`<body>${html}</body>`,"text/html");
    const BLOCK={p:"p",div:"p",h1:"h3",h2:"h3",h3:"h3",h4:"h3",h5:"h3",h6:"h3",blockquote:"p",pre:"p",li:"li",ul:"ul",ol:"ol"};
    const INL={b:"b",strong:"b",i:"i",em:"i",u:"u",ins:"u",s:"s",strike:"s",del:"s",mark:"mark"};
    const escT=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    function inl(n){ // contenu en ligne
      let o="";
      n.childNodes.forEach(c=>{
        if(c.nodeType===3){o+=escT(c.nodeValue.replace(/[\r\n]+/g," "));return}
        if(c.nodeType!==1)return;
        const t=c.tagName.toLowerCase();
        if(t==="br"){o+="<br>";return}
        if(t==="script"||t==="style"||t==="template"||t==="iframe"||t==="object")return;
        let inner=styl(c,inl(c));
        if(INL[t])inner=`<${INL[t]}>${inner}</${INL[t]}>`;
        if(t==="a"){const h=(c.getAttribute("href")||"").trim();if(/^(https?:|mailto:)/i.test(h))inner=`<a href="${escT(h).replace(/"/g,"&quot;")}" target="_blank" rel="noopener noreferrer">${inner}</a>`}
        if(BLOCK[t]&&t!=="li")inner=inner+"<br>"; // bloc imbriqué dans du texte en ligne
        o+=inner;
      });
      return o;
    }
    function styl(c,inner){ // mise en forme portée par l'attribut style, la couleur ou la classe
        const t=c.tagName.toLowerCase(), st=(c.getAttribute("style")||"").toLowerCase();
        if(/font-weight:\s*(bold|[6-9]00)/.test(st))inner=`<b>${inner}</b>`;
        if(/font-style:\s*italic/.test(st))inner=`<i>${inner}</i>`;
        if(/text-decoration[^;]*underline/.test(st))inner=`<u>${inner}</u>`;
        if(/text-decoration[^;]*line-through/.test(st))inner=`<s>${inner}</s>`;
        const bg=(st.match(/background(?:-color)?:\s*([^;]+)/)||[])[1];
        if(bg&&rtMarkBg(bg))inner=`<mark>${inner}</mark>`;
        const ck=rtColorKey(t==="font"?c.getAttribute("color"):((st.match(/(?:^|;)\s*color:\s*([^;]+)/)||[])[1]));
        if(ck)inner=`<span class="rc-${ck}">${inner}</span>`;
        if(t==="span"&&/\brc-([rbg])\b/.test(c.className||""))inner=`<span class="rc-${c.className.match(/\brc-([rbg])\b/)[1]}">${inner}</span>`;
        return inner;
    }
    const out=[];let run=null;
    const flush=()=>{if(run!==null){const x=run.replace(/(<br>)+$/,"");if(x.replace(/<[^>]+>/g,"").trim()||/<br>/.test(x))out.push(`<p>${x}</p>`);run=null}};
    function list(el,tag){
      const items=[];
      el.childNodes.forEach(c=>{
        if(c.nodeType===1&&c.tagName.toLowerCase()==="li"){
          let x="";const sub=[];
          c.childNodes.forEach(d=>{if(d.nodeType===1&&/^(ul|ol)$/i.test(d.tagName))sub.push(list(d,d.tagName.toLowerCase()));else{const w=document.createElement("span");w.appendChild(d.cloneNode(true));x+=inl(w)}});
          items.push(`<li>${x.replace(/(<br>)+$/,"")}${sub.join("")}</li>`);
        }else if(c.nodeType===1&&/^(ul|ol)$/i.test(c.tagName)&&items.length){items[items.length-1]=items[items.length-1].replace(/<\/li>$/,list(c,c.tagName.toLowerCase())+"</li>")}
        else{const w=document.createElement("span");w.appendChild(c.cloneNode(true));const x=inl(w);if(x.replace(/<[^>]+>/g,"").trim())items.push(`<li>${x}</li>`)}
      });
      return items.length?`<${tag}>${items.join("")}</${tag}>`:"";
    }
    function walk(parent){
      parent.childNodes.forEach(c=>{
        const t=c.nodeType===1?c.tagName.toLowerCase():"";
        if(t==="ul"||t==="ol"){flush();const l=list(c,t);if(l)out.push(l);return}
        if(t&&BLOCK[t]&&t!=="li"){
          if([...c.children].some(x=>/^(ul|ol|p|div|h[1-6]|blockquote)$/i.test(x.tagName))){flush();walk(c);flush();return}
          flush();const x=styl(c,inl(c)).replace(/(<br>)+$/,"");
          if(x.replace(/<[^>]+>/g,"").trim())out.push(BLOCK[t]==="h3"?`<h3>${x}</h3>`:`<p>${x}</p>`);else if(BLOCK[t]==="p"&&c.querySelector("br"))out.push("<p><br></p>");
          return}
        if(t==="li"){flush();const w=document.createElement("ul");w.appendChild(c.cloneNode(true));out.push(list(w,"ul"));return}
        const w=document.createElement("span");w.appendChild(c.cloneNode(true));
        run=(run||"")+inl(w);
      });
    }
    walk(doc.body);flush();
    while(out.length&&out[out.length-1]==="<p><br></p>")out.pop();
    while(out.length&&out[0]==="<p><br></p>")out.shift();
    return out.join("");
  }
  // Valeur à stocker : texte brut s'il n'y a pas de mise en forme
  function rtStore(html){
    const c=rtClean(html);if(!c)return "";
    if(!/<(b|i|u|s|mark|span|a|ul|ol|h3)\b/.test(c))return rtText(c).trim();
    return c;
  }
  // assemble deux textes (brut ou enrichi) en un seul
  function rtJoin(a,b){a=String(a||"");b=String(b||"");if(!a)return b;if(!b)return a;if(!rtIs(a)&&!rtIs(b))return a+"\n"+b;const blk=x=>rtIs(x)?x:x.split("\n").map(l=>`<p>${l?escRaw(l):"<br>"}</p>`).join("");return rtClean(blk(a)+blk(b))}
  const rtCut=(x,n)=>{x=String(x||"");return rtIs(x)?(x.length>60000?rtText(x).slice(0,n):x):x.slice(0,n)};
  function rtHtml(s){
    s=String(s||"");if(!s)return "";
    if(!rtIs(s))return esc(s).replace(/\n/g,"<br>");
    let h=rtCache.get(s);if(h==null){h=rtClean(s);if(rtCache.size>800)rtCache.clear();rtCache.set(s,h)}
    return h;
  }
  function rtText(s){
    s=String(s||"");if(!rtIs(s))return s;
    let t=rtTxtCache.get(s);if(t!=null)return t;
    const doc=new DOMParser().parseFromString(`<body>${rtClean(s)}</body>`,"text/html");
    const lines=[];
    const txt=n=>{let o="";n.childNodes.forEach(c=>{if(c.nodeType===3)o+=c.nodeValue;else if(c.nodeType===1){const g=c.tagName.toLowerCase();if(g==="br")o+="\n";else if(g==="ul"||g==="ol")return;else o+=txt(c)}});return o};
    const lst=(el,depth)=>{let k=0;el.querySelectorAll(":scope > li").forEach(li=>{k++;lines.push("  ".repeat(depth)+(el.tagName==="OL"?k+". ":"• ")+txt(li).trim());li.querySelectorAll(":scope > ul, :scope > ol").forEach(sub=>lst(sub,depth+1))})};
    doc.body.childNodes.forEach(c=>{if(c.nodeType!==1)return;const g=c.tagName.toLowerCase();if(g==="ul"||g==="ol")lst(c,0);else lines.push(txt(c))});
    t=lines.join("\n").replace(/ /g," ");
    if(rtTxtCache.size>800)rtTxtCache.clear();rtTxtCache.set(s,t);return t;
  }
  // surlignage de la recherche à l'intérieur d'un texte enrichi
  function rtHl(s,q){
    const h=rtHtml(s);if(!q)return h;
    const tpl=document.createElement("template");tpl.innerHTML=h;
    const walker=document.createTreeWalker(tpl.content,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(nd=>{const v=nd.nodeValue,n=norm(v);let i=0,j,f=null;
      while((j=n.indexOf(q,i))>=0){f=f||document.createDocumentFragment();f.append(v.slice(i,j));const m=document.createElement("mark");m.textContent=v.slice(j,j+q.length);f.append(m);i=j+q.length}
      if(f){f.append(v.slice(i));nd.replaceWith(f)}});
    return tpl.innerHTML;
  }
  // ---------- Éditeur : greffé automatiquement sur les <textarea data-rt> ----------
  const RT_SVG=d=>`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  const RT_BTNS=[
    ["bold","Gras (Ctrl+B)","<b>B</b>"],["italic","Italique (Ctrl+I)",'<i class="rti">I</i>'],["underline","Souligné (Ctrl+U)","<u>S</u>"],["strike","Barré (Ctrl+Maj+X)","<s>B</s>"],["|"],
    ["mark","Surligner (Ctrl+Maj+H)",'<span class="rtmk">ab</span>'],["color","Couleur du texte",'<span class="rtcol">A<i></i></span>'],["|"],
    ["ul","Liste à puces",RT_SVG("M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01")],["ol","Liste numérotée",RT_SVG("M10 6h10M10 12h10M10 18h10M4 5h1v3M4 12h2l-2 2h2M4 17h2v3H4")],["h3","Titre","<b>T</b>"],["|"],
    ["link","Lien",RT_SVG("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1")],["clear","Effacer la mise en forme",RT_SVG("M5 5l14 14M7 15h6M9 5h10M14 5l-3 10")]
  ];
  function rtExec(ed,cmd,arg){
    ed.focus();
    try{document.execCommand("styleWithCSS",false,false)}catch(e){}
    if(cmd==="strike")document.execCommand("strikeThrough");
    else if(cmd==="mark"||cmd==="color"){
      // surligné et couleur : la sélection est enveloppée directement (balises maîtrisées)
      const sel=window.getSelection();if(!sel.rangeCount)return;
      const n=sel.anchorNode&&(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement);
      const m0=cmd==="mark"&&n&&n.closest("mark");
      if(m0&&ed.contains(m0)){m0.replaceWith(...m0.childNodes)}
      else{
        const r=sel.getRangeAt(0);if(r.collapsed||!ed.contains(r.commonAncestorContainer))return;
        const frag=r.extractContents();
        frag.querySelectorAll(cmd==="mark"?"mark":"span[class^='rc-'],font").forEach(x=>x.replaceWith(...x.childNodes));
        let node=frag;
        if(cmd==="mark"||arg){const w=document.createElement(cmd==="mark"?"mark":"span");if(cmd==="color")w.className="rc-"+arg;w.appendChild(frag);node=w}
        const first=node.firstChild,last=node.lastChild;r.insertNode(node);
        const nr=document.createRange();if(node.nodeType===1&&node.parentNode){nr.selectNode(node)}else if(first&&last){nr.setStartBefore(first);nr.setEndAfter(last)}sel.removeAllRanges();sel.addRange(nr);
      }
    }
    else if(cmd==="ul")document.execCommand("insertUnorderedList");
    else if(cmd==="ol")document.execCommand("insertOrderedList");
    else if(cmd==="h3")rtToggleH3(ed);
    else if(cmd==="clear"){document.execCommand("removeFormat");document.execCommand("unlink");document.execCommand("formatBlock",false,"p")}
    else document.execCommand(cmd);
    ed.dispatchEvent(new Event("input",{bubbles:true}));
  }
  // Titre : bascule paragraphe <-> titre sur les lignes sélectionnées (hors listes)
  function rtToggleH3(ed){
    const sel=window.getSelection();if(!sel.rangeCount)return;
    const r=sel.getRangeAt(0), a=[sel.anchorNode,sel.anchorOffset,sel.focusNode,sel.focusOffset];
    let blocks=[...ed.children].filter(b=>/^(P|H3|DIV)$/.test(b.tagName)&&r.intersectsNode(b));
    if(!blocks.length){ // texte directement dans l'éditeur : on l'enveloppe d'abord dans un paragraphe
      if(ed.textContent.trim()&&![...ed.children].some(b=>/^(P|H3|DIV|UL|OL)$/.test(b.tagName))){const p=document.createElement("p");while(ed.firstChild)p.appendChild(ed.firstChild);ed.appendChild(p);blocks=[p]}
      else return;
    }
    const toH=!blocks.every(b=>b.tagName==="H3");
    blocks.forEach(b=>{if(b.querySelector("ul,ol"))return;const n=document.createElement(toH?"h3":"p");while(b.firstChild)n.appendChild(b.firstChild);b.replaceWith(n)});
    try{sel.setBaseAndExtent(...a)}catch(e){}
  }
  function rtState(w){
    const ed=w.querySelector(".rte");if(document.activeElement!==ed)return;
    const q=c=>{try{return document.queryCommandState(c)}catch(e){return false}};
    const sel=window.getSelection(), n=sel.anchorNode&&(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement);
    const has=c=>!!(n&&ed.contains(n.closest(c)));
    const st={bold:has("b,strong")||(q("bold")&&!has("h3")),italic:has("i,em")||q("italic"),underline:has("u")||q("underline"),strike:has("s,strike,del")||q("strikeThrough"),ul:has("ul"),ol:has("ol"),
      mark:!!(n&&ed.contains(n.closest("mark,[style*=background]"))),h3:!!(n&&ed.contains(n.closest("h3"))),link:!!(n&&ed.contains(n.closest("a")))};
    w.querySelectorAll(".rtb [data-c]").forEach(b=>{if(b.dataset.c in st)b.setAttribute("aria-pressed",st[b.dataset.c])});
  }
  async function rtColorMenu(btn,ed){
    document.querySelectorAll(".rtpop").forEach(x=>x.remove());
    const sel=window.getSelection(), rg=sel.rangeCount?sel.getRangeAt(0).cloneRange():null;
    const pop=document.createElement("div");pop.className="rtpop";pop.setAttribute("role","menu");
    pop.innerHTML=[["","Noir","#0F1E28"],["r","Rouge",RT_COL.r],["b","Bleu",RT_COL.b],["g","Vert",RT_COL.g]].map(([k,l,c])=>`<button type="button" role="menuitem" data-rc="${k}"><i style="background:${c}"></i>${l}</button>`).join("");
    document.body.appendChild(pop);
    const br=btn.getBoundingClientRect(), vv=window.visualViewport, vh=vv?vv.height+vv.offsetTop:window.innerHeight, ph=pop.offsetHeight, pw=pop.offsetWidth;
    pop.style.left=Math.max(8,Math.min(br.left-4,window.innerWidth-pw-8))+"px";
    pop.style.top=(vh-br.bottom>=ph+12?br.bottom+4:Math.max(8,br.top-ph-4))+"px";
    const closeOnScroll=()=>{pop.remove();window.removeEventListener("scroll",closeOnScroll,true)};setTimeout(()=>window.addEventListener("scroll",closeOnScroll,true),0);
    pop.querySelectorAll("button").forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>{pop.remove();if(rg){sel.removeAllRanges();sel.addRange(rg)}rtExec(ed,"color",b.dataset.rc)}});
    setTimeout(()=>document.addEventListener("pointerdown",function f(e){if(!pop.contains(e.target)){pop.remove();document.removeEventListener("pointerdown",f,true)}},true),0);
  }
  function rtUpgrade(ta){
    if(ta.dataset.rtOn)return;ta.dataset.rtOn="1";
    const w=document.createElement("div");w.className="rtw"+(ta.className?" "+ta.className:"");
    const label=ta.getAttribute("aria-label")||(ta.closest("label")&&ta.closest("label").firstChild&&ta.closest("label").firstChild.textContent.trim())||"Texte";
    w.innerHTML=`<div class="rtb" role="toolbar" aria-label="Mise en forme">${RT_BTNS.map(b=>b[0]==="|"?`<span class="rtsep" aria-hidden="true"></span>`:`<button type="button" class="rtbtn" data-c="${b[0]}" aria-label="${b[1]}" title="${b[1]}" aria-pressed="false">${b[2]}</button>`).join("")}</div><div class="rte rt" contenteditable="${ta.readOnly?"false":"true"}" role="textbox" aria-multiline="true" aria-label="${esc(label)}" data-ph="${esc(ta.placeholder||"")}" spellcheck="true"></div>`;
    ta.parentNode.insertBefore(w,ta);w.appendChild(ta);ta.hidden=true;ta.tabIndex=-1;
    const ed=w.querySelector(".rte");
    // dans un <label>, un clic ne doit pas être renvoyé au premier bouton de la barre (Gras)
    if(w.closest("label"))w.addEventListener("click",e=>{if(!e.target.closest(".rtbtn,.rtpop button"))e.preventDefault()});
    w.addEventListener("click",e=>{const b=e.target.closest(".rtbtn,.rtpop button");if(b&&w.closest("label"))e.preventDefault()},true);
    const fill=()=>{const v=ta.value;ed.innerHTML=v?(rtIs(v)?rtHtml(v):v.split("\n").map(l=>`<p>${l?esc(l):"<br>"}</p>`).join("")):"";w.classList.toggle("rtempty",!ed.textContent.trim()&&!ed.querySelector("li"))};
    fill();ta._rtFill=fill;
    // le code existant continue de lire et d'écrire textarea.value
    const desc=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value");
    Object.defineProperty(ta,"value",{configurable:true,get(){return desc.get.call(this)},set(v){const old=desc.get.call(this);desc.set.call(this,v);if(!ta._rtSync&&String(v??"")!==old)fill()}});
    ta.focus=()=>ed.focus();
    const sync=()=>{ta._rtSync=true;desc.set.call(ta,rtStore(ed.innerHTML));ta._rtSync=false;w.classList.toggle("rtempty",!ed.textContent.trim()&&!ed.querySelector("li"));ta.dispatchEvent(new Event("input",{bubbles:true}))};
    ed.addEventListener("input",sync);
    ed.addEventListener("focus",()=>{try{document.execCommand("defaultParagraphSeparator",false,"p")}catch(e){}w.classList.add("on");rtPhoneBar(w)});
    ed.addEventListener("blur",()=>{setTimeout(()=>{if(!w.contains(document.activeElement)){w.classList.remove("on");rtPhoneBar(null);ta.dispatchEvent(new Event("change",{bubbles:true}));ta.dispatchEvent(new Event("blur"))}},150)});
    ed.addEventListener("keyup",()=>rtState(w));ed.addEventListener("mouseup",()=>rtState(w));
    ed.addEventListener("keydown",e=>{
      const k=e.key.toLowerCase(), mod=e.ctrlKey||e.metaKey;
      if(mod&&!e.shiftKey&&(k==="b"||k==="i"||k==="u")){e.preventDefault();e.stopPropagation();rtExec(ed,{b:"bold",i:"italic",u:"underline"}[k]);rtState(w);return}
      if(mod&&e.shiftKey&&k==="x"){e.preventDefault();e.stopPropagation();rtExec(ed,"strike");rtState(w);return}
      if(mod&&e.shiftKey&&k==="h"){e.preventDefault();e.stopPropagation();rtExec(ed,"mark");rtState(w);return}
      // les raccourcis du textarea d'origine (Entrée pour valider, Échap…) restent actifs
      const ev=new KeyboardEvent("keydown",{key:e.key,code:e.code,ctrlKey:e.ctrlKey,metaKey:e.metaKey,shiftKey:e.shiftKey,altKey:e.altKey,bubbles:true,cancelable:true});
      e.stopPropagation();ta.dispatchEvent(ev);if(ev.defaultPrevented){e.preventDefault();return}
      // « - », « * » ou « 1. » suivi d'une espace en début de ligne : liste
      if(e.key===" "&&!mod){
        const sel=window.getSelection();if(!sel.rangeCount||!sel.isCollapsed)return;
        const blk=sel.anchorNode&&(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement).closest("p,div,h3");
        if(!blk||!ed.contains(blk)||(x=>x&&ed.contains(x))(blk.closest("li")))return;
        const t=blk.textContent;if(sel.anchorOffset!==t.length&&sel.anchorNode.nodeType===3)return;
        if(t==="-"||t==="*"||t==="•"||t==="1."){e.preventDefault();blk.innerHTML="<br>";const r=document.createRange();r.setStart(blk,0);r.collapse(true);sel.removeAllRanges();sel.addRange(r);rtExec(ed,t==="1."?"ol":"ul")}
      }
    });
    ed.addEventListener("paste",e=>{
      const cd=e.clipboardData;if(!cd)return;e.preventDefault();
      const h=cd.getData("text/html"), t=cd.getData("text/plain");
      const ins=h?rtClean(h):t.split(/\r?\n/).map(l=>`<p>${l?esc(l):"<br>"}</p>`).join("");
      if(ins)document.execCommand("insertHTML",false,ins);
    });
    w.querySelectorAll(".rtbtn").forEach(b=>{
      b.onmousedown=e=>e.preventDefault();
      b.onclick=async()=>{
        const c=b.dataset.c;
        if(c==="color"){rtColorMenu(b,ed);return}
        if(c==="link"){
          const sel=window.getSelection(), rg=sel.rangeCount?sel.getRangeAt(0).cloneRange():null, txt=rg?rg.toString():"";
          const a=sel.anchorNode&&(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement).closest("a");
          if(a&&ed.contains(a)){a.replaceWith(...a.childNodes);sync();return}
          let u=await uiPrompt("Adresse du lien (https://…)","https://",{ok:"Ajouter le lien"});if(!u||!u.trim()||u.trim()==="https://")return;u=u.trim();
          if(!/^(https?:|mailto:)/i.test(u))u=(/@/.test(u)&&!/\//.test(u)?"mailto:":"https://")+u;
          ed.focus();if(rg){sel.removeAllRanges();sel.addRange(rg)}
          if(txt)document.execCommand("createLink",false,u);else document.execCommand("insertHTML",false,`<a href="${esc(u)}">${esc(u.replace(/^mailto:/,""))}</a>&nbsp;`);
          sync();return}
        rtExec(ed,c);rtState(w);
      };
    });
  }
  // Téléphone : la barre d'outils se place juste au-dessus du clavier
  let rtBarW=null;
  function rtPhoneBar(w){
    if(rtBarW&&rtBarW!==w){rtBarW.classList.remove("kb");rtBarW.querySelector(".rtb").style.removeProperty("top")}
    rtBarW=w&&isPhone()?w:null;
    if(rtBarW){rtBarW.classList.add("kb");rtBarPos()}
  }
  function rtBarPos(){
    if(!rtBarW)return;const vv=window.visualViewport, b=rtBarW.querySelector(".rtb");
    const h=b.offsetHeight||46, top=vv?vv.offsetTop+vv.height-h:window.innerHeight-h;
    b.style.top=Math.max(0,top)+"px";
  }
  if(window.visualViewport){visualViewport.addEventListener("resize",rtBarPos);visualViewport.addEventListener("scroll",rtBarPos)}
  new MutationObserver(ms=>{for(const m of ms)m.addedNodes.forEach(n=>{if(n.nodeType!==1)return;if(n.matches&&n.matches("textarea[data-rt]"))rtUpgrade(n);else if(n.querySelectorAll)n.querySelectorAll("textarea[data-rt]").forEach(rtUpgrade)})}).observe(document.documentElement,{childList:true,subtree:true});
  // un lien dans un texte affiché ne déclenche pas l'ouverture de la ligne qui le contient
  document.addEventListener("click",e=>{const a=e.target.closest&&e.target.closest(".rt a");if(a&&!a.closest(".rte"))e.stopPropagation()},true);
  window.__rt={rtClean,rtStore,rtHtml,rtText,rtIs};
  // ordinateur : la fenêtre « Compte et sauvegarde » se ferme en cliquant ailleurs ou avec Échap
  document.addEventListener("pointerdown",e=>{const tb=document.getElementById("toolsbox");if(tb&&tb.open&&!isPhone()&&!tb.contains(e.target)&&!e.target.closest("dialog"))tb.open=false},true);
  document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;const tb=document.getElementById("toolsbox");if(tb&&tb.open&&!isPhone()&&!document.querySelector("dialog[open]")){tb.open=false;const s=document.getElementById("toolstitle");if(s)s.focus()}});
  // ---------- Recherche ----------
  let query="";
  const norm=x=>String(x||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
  function hl(text){
    if(rtIs(text))return `<span class="rt">${rtHl(text,norm(query.trim()))}</span>`;
    const t=esc(text); if(!query.trim())return t;
    const q=norm(query.trim()), n=norm(text);
    const out=[];let i=0,j;
    while((j=n.indexOf(q,i))>=0){out.push(esc(text.slice(i,j)),"<mark>",esc(text.slice(j,j+q.length)),"</mark>");i=j+q.length}
    out.push(esc(text.slice(i)));
    return i?out.join(""):t;
  }
  function matches(t){
    const q=norm(query.trim()); if(!q)return true;
    const p=proj(t.projectId);
    const hay=[t.title,t.note,t.who,whoName(t),famName(t),p&&p.name,...(t.checklist||[]).map(c=>c.text),...getComments(t).map(c=>c.text)].map(v=>norm(rtText(v||""))).join("\n");
    return q.split(/\s+/).every(w=>hay.includes(w));
  }
  // ---------- Commentaires ----------
  function getComments(t){return MODE==="cloud"?(cloud.comments[t.id]||[]):(Array.isArray(t.comments)?t.comments:[])}
  const fmtWhen=ms=>{const d=new Date(ms);return d.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})+" à "+d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})};
  async function addComment(t,text){
    text=text.trim(); if(!text)return false;
    if(rtText(text).length>4000||text.length>40000){uiAlert("Commentaire trop long (4000 caractères maximum).");return false}
    if(MODE==="cloud"){
      const id=crypto.randomUUID?crypto.randomUUID():uid()+uid();
      const {error}=await cloudClient().from("task_comments").insert({id,task_id:t.id,body:text});
      if(error){uiAlert(transient(error)?"Commentaire non envoyé : connexion au serveur impossible. Réessayez dans un instant.":"Commentaire refusé : "+error.message);return false}
      (cloud.comments[t.id]=cloud.comments[t.id]||[]).push({id,author:cloud.email,text,at:Date.now()});
      cloud._lastCm=JSON.stringify(cloud.comments);
      return true;
    }
    const cur=state.tasks.find(x=>x.id===t.id); if(!cur)return false;
    cur.comments=[...(cur.comments||[]),{id:uid(),author:"Moi",text,at:Date.now()}];
    save(); return true;
  }
  async function delComment(t,c){
    if(!await uiConfirm("Supprimer ce commentaire ?",{ok:"Supprimer",danger:true}))return false;
    if(MODE==="cloud"){
      const {error}=await cloudClient().from("task_comments").delete().eq("id",c.id);
      if(error){uiAlert("Suppression impossible : "+error.message);return false}
      cloud.comments[t.id]=(cloud.comments[t.id]||[]).filter(x=>x.id!==c.id);
      cloud._lastCm=JSON.stringify(cloud.comments);
      return true;
    }
    const cur=state.tasks.find(x=>x.id===t.id); if(!cur)return false;
    cur.comments=(cur.comments||[]).filter(x=>x.id!==c.id); save(); return true;
  }
  function commentsBox(t){
    const box=document.createElement("div");box.className="cbox";
    const draw=()=>{
      const list=getComments(t);
      box.innerHTML=`<span class="lbl">Commentaires${list.length?` (${list.length})`:""}</span>
        ${list.length?`<ul class="clist">${list.map(c=>`<li><div class="ch"><span><b>${esc(nameOf(c.author))}</b> · ${fmtWhen(c.at)}</span>${(MODE!=="cloud"||c.author===cloud.email)?`<button type="button" class="xbtn" data-c="${esc(c.id)}" aria-label="Supprimer ce commentaire">×</button>`:""}</div><div class="cb rt">${rtHtml(c.text)}</div></li>`).join("")}</ul>`:""}
        <div class="cform"><textarea data-rt placeholder="Ajouter un commentaire…" aria-label="Nouveau commentaire"></textarea><button class="btn" type="button">Publier</button></div>`;
      const ta=box.querySelector("textarea"), go=box.querySelector(".cform .btn");
      const send=async()=>{go.disabled=true;if(await addComment(t,ta.value)){draw();box.querySelector("textarea").focus()}else go.disabled=false};
      go.onclick=send;
      ta.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();send()}});
      box.querySelectorAll("[data-c]").forEach(b=>b.onclick=async()=>{const c=getComments(t).find(x=>x.id===b.dataset.c);if(c&&await delComment(t,c))draw()});
    };
    draw();
    return box;
  }
  // ---------- Réordonner par glisser-déposer (souris, écran tactile et clavier) ----------
  function sortable(box,done){
    const rows=()=>[...box.children].filter(r=>r.dataset.idx!=null);
    box.querySelectorAll(":scope > [data-idx] > .grip").forEach(h=>{
      h.onpointerdown=e=>{
        if(e.button>0)return;
        e.preventDefault();
        const row=h.parentElement, start=rows().map(r=>+r.dataset.idx);
        row.classList.add("dragging");box.classList.add("sorting");
        const pid=e.pointerId;
        const move=ev=>{
          if(ev.pointerId!==pid)return;
          ev.preventDefault();
          const others=rows().filter(r=>r!==row);
          let before=null;
          for(const r of others){const b=r.getBoundingClientRect();if(ev.clientY<b.top+b.height/2){before=r;break}}
          if(before){if(row.nextElementSibling!==before)box.insertBefore(row,before)}
          else{const last=others[others.length-1];if(last&&last.nextElementSibling!==row)last.after(row)}
        };
        const end=ev=>{
          if(ev&&ev.pointerId!==pid)return;
          window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",end);window.removeEventListener("pointercancel",end);
          row.classList.remove("dragging");box.classList.remove("sorting");
          const order=rows().map(r=>+r.dataset.idx);
          if(order.join()!==start.join())done(order);
        };
        window.addEventListener("pointermove",move,{passive:false});window.addEventListener("pointerup",end);window.addEventListener("pointercancel",end);
      };
      h.onkeydown=e=>{
        if(e.key!=="ArrowUp"&&e.key!=="ArrowDown")return;
        e.preventDefault();
        const order=rows().map(r=>+r.dataset.idx), i=order.indexOf(+h.parentElement.dataset.idx), j=e.key==="ArrowUp"?i-1:i+1;
        if(j<0||j>=order.length)return;
        [order[i],order[j]]=[order[j],order[i]];
        done(order,j);
      };
    });
  }
  // ---------- Étapes ----------
  function toggleStep(t,sid){
    const cur=state.tasks.find(x=>x.id===t.id); if(!cur)return;
    cur.checklist=(cur.checklist||[]).map(c=>c.id===sid?{...c,done:!c.done}:c);
    save();render();
  }
  const stepsOpen=new Set(); // tâches dont les étapes sont dépliées dans la liste
  function row(t,showProj,bucket){
    const li=document.createElement("li");
    li.className=`task${t.status==="done"?" done":""}${isLate(t)?" late":""}${editing===t.id?" open":""}${stepsOpen.has(t.id)?" showsteps":""}`;
    li.dataset.id=t.id;
    const p=proj(t.projectId);
    const steps=Array.isArray(t.checklist)?t.checklist:[];
    const nCom=getComments(t).length;
    const tags=[];
    if(showProj&&p)tags.push(`<span class="tag"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>`);
    const fam=famName(t); if(fam&&bucket!=="fam")tags.push(`<span class="tag fam">${hl(fam)}</span>`);
    if(t.status==="doing")tags.push(`<span class="tag doing">En cours</span>`);
    if(t.status==="waiting")tags.push(`<span class="tag wait">En attente${t.waitingFor?" · "+hl(t.waitingFor):""}</span>`);
    if(t.due&&t.status==="waiting")tags.push(`<span class="tag${needsRelance(t)&&parseD(t.due)<today()?" late":needsRelance(t)?" today":""}">Relance ${shortDay(t.due).toLowerCase()}</span>`);
    else if(t.due&&t.status!=="done"){
      if(isLate(t))tags.push(`<span class="tag late">En retard · ${shortDay(t.due)}</span>`);
      else if(isToday(t))tags.push(`<span class="tag today">Aujourd'hui</span>`);
      else if(bucket!=="tomorrow")tags.push(`<span class="tag">${shortDay(t.due)}</span>`);
    } else if(t.due)tags.push(`<span class="tag">${shortDay(t.due)}</span>`);
    if(steps.length)tags.push(`<button type="button" class="tag stepstag" data-a="steps" aria-expanded="${stepsOpen.has(t.id)}" title="${stepsOpen.has(t.id)?"Masquer":"Afficher"} les étapes">${steps.filter(c=>c.done).length}/${steps.length} étapes</button>`);
    if(t.repeat&&t.repeat.unit)tags.push(`<span class="tag" title="Tâche récurrente"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l3 3-3 3"></path><path d="M4 11V9a4 4 0 0 1 4-4h12"></path><path d="M7 22l-3-3 3-3"></path><path d="M20 13v2a4 4 0 0 1-4 4H4"></path></svg>${repLabel(t.repeat)}</span>`);
    if(t.priority==="haute")tags.push(`<span class="tag hi">Priorité haute</span>`);
    if(t.priority==="basse")tags.push(`<span class="tag">Priorité basse</span>`);
    if(t.who)tags.push(`<span class="tag who av${isMyTask(t)?" me":""}" title="Responsable : ${esc(whoName(t))}" style="--av:${avColor(whoName(t))}"><span class="avi" aria-hidden="true">${esc(initialsOf(whoName(t)))}</span><span class="avn">${hl(whoName(t))}</span></span>`);
    const rq=reqOf(t); if(rq)tags.push(`<button type="button" class="tag reqtag" data-a="req" title="Ouvrir la demande client">Demande : ${esc(short(rq.title))}</button>`);
    if(nCom)tags.push(`<button type="button" class="tag" data-a="edit" title="Voir les commentaires" style="border:0;cursor:pointer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"></path></svg>${nCom} commentaire${nCom>1?"s":""}</button>`);
    li.innerHTML=`<input type="checkbox" class="chk" ${t.status==="done"?"checked":""} aria-label="Marquer comme terminée">
      <div><div class="ttl">${hl(t.title)}</div>${tags.length?`<div class="meta">${tags.join("")}</div>`:""}
      ${steps.length&&editing!==t.id?`<ul class="steps">${steps.map((c,i)=>`<li class="${c.done?"ok":""}" data-idx="${i}"><span class="grip" data-g="${i}" tabindex="0" role="button" title="Glisser pour changer l'ordre (ou flèches haut et bas)" aria-label="Déplacer l'étape ${i+1}"><svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="9" cy="8" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="9" cy="13" r="1.5"/></svg></span><input type="checkbox" ${c.done?"checked":""} data-s="${esc(c.id)}" aria-label="Étape terminée : ${esc(c.text)}"><span>${hl(c.text)}</span></li>`).join("")}</ul>`:""}
      ${t.note&&editing!==t.id?`<div class="note">${hl(t.note)}</div>`:""}</div>
      <div class="acts">
        ${t.status!=="done"?`<button class="sbtn" data-a="doing" type="button">${t.status==="doing"?"Mettre en pause":t.status==="waiting"?"Reprendre":"Démarrer"}</button>`:""}
        <details class="more"><summary aria-label="Plus d'actions">${ICON_MORE}</summary>
          <div class="menu"><button type="button" data-a="edit">${editing===t.id?"Fermer le détail":"Modifier"}</button>${t.status!=="done"?`<button type="button" data-a="doing" class="mobonly">${t.status==="doing"?"Mettre en pause":t.status==="waiting"?"Reprendre":"Démarrer"}</button>`:""}${t.status!=="done"&&t.status!=="waiting"?`<button type="button" data-a="wait">Mettre en attente…</button>`:""}<button type="button" data-a="hist">Historique</button><button type="button" data-a="del" class="danger">Mettre à la corbeille</button></div>
        </details>
      </div>`;
    li.querySelector(".chk").onchange=()=>toggle(t);
    li.querySelector(".ttl").onclick=()=>{editing=editing===t.id?null:t.id;render()};
    li.querySelectorAll("[data-s]").forEach(cb=>cb.onchange=()=>toggleStep(t,cb.dataset.s));
    const sul=li.querySelector(":scope > div > ul.steps");
    if(sul)sortable(sul,order=>{const cur=state.tasks.find(x=>x.id===t.id);if(!cur||!Array.isArray(cur.checklist))return;const cl=cur.checklist.slice();if(order.some(i=>!cl[i])||order.length!==cl.length){render();return}cur.checklist=order.map(i=>cl[i]);save();render()});
    li.querySelectorAll("[data-a]").forEach(btn=>btn.onclick=()=>{
      const a=btn.dataset.a;
      if(a==="steps"){if(stepsOpen.has(t.id))stepsOpen.delete(t.id);else stepsOpen.add(t.id);render();return}
      if(a==="doing")cycleDoing(t);
      if(a==="edit"){editing=editing===t.id?null:t.id;render()}
      if(a==="del")removeTask(t);
      if(a==="wait")changeStatus(t,"waiting");
      if(a==="req")openRequest(reqOf(t));
      if(a==="hist"){histOpen=t.id;editing=t.id;render();const el=document.querySelector(`.task[data-id="${t.id}"] .hbox`);if(el)el.scrollIntoView({block:"nearest"})}
    });
    if(editing===t.id){
      const f=document.createElement("div");f.className="edit";
      f.innerHTML=`<input type="text" class="full" value="${esc(t.title)}" aria-label="Intitulé">
        <select aria-label="Projet">${state.projects.map(x=>`<option value="${x.id}" ${x.id===t.projectId?"selected":""}>${esc(x.name)}</option>`).join("")}</select>
        <select aria-label="Priorité">${["haute","normale","basse"].map(v=>`<option value="${v}" ${v===t.priority?"selected":""}>Priorité ${v}</option>`).join("")}</select>
        <input type="date" value="${esc(t.due)}" aria-label="Échéance">
        <input type="text" value="${esc(whoName(t))}" placeholder="Responsable" aria-label="Responsable" list="people">
        <select aria-label="Répétition">${REPEATS.map(([k,l])=>`<option value="${k}" ${k===repKey(t.repeat)?"selected":""}>${l}</option>`).join("")}</select>
        <select aria-label="Statut">${Object.entries(STATUS).map(([k,l])=>`<option value="${k}" ${k===(t.status||"todo")?"selected":""}>${l}</option>`).join("")}</select>
        <input type="text" value="${esc(t.waitingFor||"")}" placeholder="En attente de (client, collègue, validation…)" aria-label="En attente de" maxlength="120">
        <select aria-label="Demande client liée"></select>
        <div class="famsel"><select aria-label="Famille"></select><button type="button" class="btn ghost" data-f="ren">Renommer</button><button type="button" class="btn ghost" data-f="del">Supprimer</button></div>
        <textarea data-rt class="full" placeholder="Note (contexte, contact, référence Jira…)" aria-label="Note">${escRaw(t.note)}</textarea>
        <div class="stepedit"><span class="lbl">Étapes</span><div class="steplist"></div>
          <div class="steprow"><input type="text" placeholder="Ajouter une étape puis Entrée" aria-label="Nouvelle étape"><button class="btn" type="button">Ajouter</button></div></div>
        <div class="full"><button class="btn primary" type="button" data-k="ok">Enregistrer</button> <button class="btn ghost" type="button" data-k="ko">Annuler</button></div>`;
      const [ti,sp,spr,dd,wh,rp,stS,wfI,rqS]=f.querySelectorAll(":scope > input, :scope > select");
      const fillReq=()=>{const list=liveReq().filter(r=>r.projectId===sp.value&&(reqOpen(r)||r.id===t.requestId));rqS.innerHTML=`<option value="">Aucune demande client liée</option>${list.map(r=>`<option value="${esc(r.id)}" ${r.id===t.requestId?"selected":""}>Demande : ${esc(short(r.title))}</option>`).join("")}`;rqS.hidden=!list.length};
      fillReq();sp.addEventListener("change",fillReq);const ta=f.querySelector(":scope > textarea");
      const syncWf=()=>{wfI.hidden=stS.value!=="waiting"};syncWf();stS.onchange=()=>{syncWf();if(!wfI.hidden)wfI.focus()};
      sp.innerHTML=state.projects.filter(x=>!x.archived||x.id===t.projectId).map(x=>`<option value="${x.id}" ${x.id===t.projectId?"selected":""}>${esc(x.name)}</option>`).join("");
      // famille : liste déroulante propre au projet choisi
      const fs=f.querySelector(".famsel select"), fRen=f.querySelector("[data-f=ren]"), fDel=f.querySelector("[data-f=del]");
      const fillFam=sel=>{
        const fams=getFamilies(sp.value);
        if(sel&&!fams.some(x=>x.id===sel))sel="";
        fs.innerHTML=`<option value="">Sans famille</option>${fams.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}<option value="__new">+ Nouvelle famille…</option>`;
        fs.value=sel||"";fs.dataset.prev=fs.value;
        fRen.hidden=fDel.hidden=!fs.value;
      };
      fillFam(t.family||"");
      sp.addEventListener("change",()=>fillFam(fs.value));
      fs.onchange=async()=>{
        if(fs.value==="__new"){
          const name=await uiPrompt("Nom de la nouvelle famille (propre au projet « "+((proj(sp.value)||{}).name||"")+" »)","",{ok:"Créer"});
          const id=name?await addFamily(sp.value,name):null;
          fillFam(id||fs.dataset.prev||"");
        } else {fs.dataset.prev=fs.value;fRen.hidden=fDel.hidden=!fs.value}
      };
      fRen.onclick=async()=>{const cur=getFamilies(sp.value).find(x=>x.id===fs.value);if(!cur)return;const n=await uiPrompt("Nouveau nom de la famille",cur.name,{ok:"Renommer"});if(n&&await renameFamily(sp.value,cur.id,n))fillFam(cur.id)};
      fDel.onclick=async()=>{const id=fs.value;if(id&&await deleteFamily(sp.value,id))fillFam("")};
      // étapes en cours d'édition (appliquées à l'enregistrement)
      let draft=steps.map(c=>({...c}));
      const sl=f.querySelector(".steplist"), sIn=f.querySelector(".steprow input");
      const drawSteps=()=>{
        sl.innerHTML=draft.map((c,i)=>`<div class="steprow" data-idx="${i}"><span class="grip" data-g="${i}" tabindex="0" role="button" title="Glisser pour changer l'ordre (ou flèches haut et bas)" aria-label="Déplacer l'étape ${i+1}"><svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="9" cy="8" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="9" cy="13" r="1.5"/></svg></span><input type="checkbox" ${c.done?"checked":""} data-i="${i}" aria-label="Étape terminée" style="width:18px;height:18px;accent-color:var(--nav)"><input type="text" value="${esc(c.text)}" data-t="${i}" aria-label="Étape ${i+1}"><button type="button" class="xbtn" data-x="${i}" aria-label="Retirer l'étape">×</button></div>`).join("");
        sl.querySelectorAll("[data-i]").forEach(x=>x.onchange=()=>{draft[+x.dataset.i].done=x.checked});
        sl.querySelectorAll("[data-t]").forEach(x=>x.oninput=()=>{draft[+x.dataset.t].text=x.value});
        sl.querySelectorAll("[data-x]").forEach(x=>x.onclick=()=>{draft.splice(+x.dataset.x,1);drawSteps()});
        sortable(sl,(order,focusIdx)=>{draft=order.map(i=>draft[i]);drawSteps();if(focusIdx!=null){const g=sl.querySelector(`[data-g="${focusIdx}"]`);if(g)g.focus()}});
      };
      const addStep=()=>{const v=sIn.value.trim();if(!v)return;draft.push({id:uid(),text:v,done:false});sIn.value="";drawSteps();sIn.focus()};
      f.querySelector(".steprow .btn").onclick=addStep;
      sIn.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addStep()}});
      drawSteps();
      f.querySelector("[data-k=ok]").onclick=()=>{
        const cur=state.tasks.find(x=>x.id===t.id);
        if(!cur){editing=null;render();uiAlert("Cette tâche a été supprimée entre-temps (peut-être par un collègue).");return}
        if(ti.value.trim())cur.title=ti.value.trim();cur.projectId=sp.value;cur.priority=spr.value;cur.due=dd.value;{const nv=wh.value.trim();cur.who=nv===whoName(cur)?(cur.who||""):resolveWho(nv,sp.value)}cur.note=ta.value.trim();
        cur.family=fs.value&&fs.value!=="__new"?fs.value:"";
        if(sIn.value.trim())draft.push({id:uid(),text:sIn.value.trim(),done:false});
        cur.checklist=draft.filter(c=>c.text.trim()).map(c=>({id:c.id,text:c.text.trim(),done:!!c.done}));
        const r=repFrom(rp.value);
        cur.repeat=r?{...r,...(repKey(cur.repeat)===rp.value&&cur.repeat.nextId?{nextId:cur.repeat.nextId}:{})}:null;
        const nx=applyStatus(cur,stS.value);
        if(cur.status==="waiting")cur.waitingFor=wfI.value.trim();
        cur.requestId=rqS.value||null;
        editing=null;save();render();
        if(nx)setSync(`Tâche récurrente : prochaine occurrence créée pour le ${shortDay(nx.due)}`)};
      f.querySelector("[data-k=ko]").onclick=()=>{editing=null;render()};
      f.appendChild(commentsBox(t));
      f.appendChild(histBox(t));
      drawerize(f,`<span class="dot" style="background:${p?p.color:"#999"}"></span>${esc(p?p.name:"")}${famName(t)?" · "+esc(famName(t)):""}`,t.title,()=>{editing=null;render()});
      li.appendChild(f);
      setTimeout(()=>ti.focus(),0);
    }
    if(selMode==="t")selDecorate(li,t.id);
    return li;
  }
  // ---------- Sélection multiple (tâches de la liste, points ouverts d'un projet) ----------
  let selMode=null, selCtx="", selLast=null; // selMode : null | "t" | "o"
  const selIds=new Set();
  const selRowsSel=()=>selMode==="t"?"#lists li.task:not(.pt):not(.req)[data-id]":"#lists li.pt[data-o]";
  const selRowId=li=>li.dataset.id||li.dataset.o;
  function selStart(k){if(k==="o"&&ui.ptView==="table"){ui.ptView="list";saveUi()}selMode=k;selIds.clear();selLast=null;editing=null;editingPt=null;render()}
  function selEnd(){selMode=null;selIds.clear();render()}
  function selDecorate(li,id){
    const on=selIds.has(id);li.classList.toggle("sel",on);
    const cb=document.createElement("input");cb.type="checkbox";cb.className="selbox";cb.checked=on;cb.setAttribute("aria-label","Sélectionner");
    li.prepend(cb);
    li.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();selToggle(id,e.shiftKey)},true);
  }
  function selToggle(id,range){
    const rows=[...document.querySelectorAll(selRowsSel())], ids=rows.map(selRowId);
    if(range&&selLast&&ids.includes(selLast)&&ids.includes(id)){
      const [a,b]=[ids.indexOf(selLast),ids.indexOf(id)].sort((x,y)=>x-y);
      ids.slice(a,b+1).forEach(x=>selIds.add(x));
    } else if(selIds.has(id))selIds.delete(id);else selIds.add(id);
    selLast=id;selPaint();
  }
  function selPaint(){
    document.querySelectorAll(selRowsSel()).forEach(li=>{const on=selIds.has(selRowId(li));li.classList.toggle("sel",on);const cb=li.querySelector(":scope > .selbox");if(cb)cb.checked=on});
    selBar();
  }
  function selItems(){return selMode==="t"?state.tasks.filter(t=>selIds.has(t.id)&&!t.deletedAt):(state.points||[]).filter(x=>selIds.has(x.id)&&!x.deletedAt)}
  // modification groupée des points, annulable
  function ptBulk(msg,items,fn){
    const copies=items.map(x=>JSON.parse(JSON.stringify(x)));
    items.forEach(fn);save();render();
    toast(msg,()=>{copies.forEach(c=>{const i=state.points.findIndex(y=>y.id===c.id);if(i>=0)state.points[i]=c});save();render()});
  }
  const DUE_OPTS=()=>{const t=today(),wd=t.getDay(),mon=addDays(t,((8-wd)%7)||7);return [["today","Aujourd'hui",iso(t)],["tom","Demain",iso(addDays(t,1))],["mon","Lundi prochain",iso(mon)],["pick","Choisir une date…",null],["none","Retirer l'échéance",""]]};
  function selBar(){
    let bar=$("#selbar");
    if(!selMode){if(bar)bar.remove();document.body.classList.remove("hasselbar");return}
    if(!bar){bar=document.createElement("div");bar.id="selbar";bar.setAttribute("role","toolbar");bar.setAttribute("aria-label","Actions sur la sélection");document.body.appendChild(bar)}
    document.body.classList.add("hasselbar");
    const items=selItems(), n=items.length, T=selMode==="t";
    [...selIds].forEach(id=>{if(!items.some(x=>x.id===id))selIds.delete(id)});
    const pids=[...new Set(items.map(x=>x.projectId))], one=pids.length===1?pids[0]:null;
    const opt=(v,l)=>`<option value="${esc(v)}">${esc(l)}</option>`;
    const sel=(k,label,opts)=>`<select data-sk="${k}" aria-label="${esc(label)}">${opt("",label+"…")}${opts}</select>`;
    let acts="";
    if(n&&T){
      const ppl=new Map();
      memberEmails(one).forEach(e=>ppl.set(e,nameOf(e)));
      live().forEach(t=>{const w=(t.who||"").trim();if(w&&!ppl.has(w)&&![...ppl.values()].includes(whoName(t)))ppl.set(w,whoName(t))});
      acts+=sel("st","Statut",Object.entries(STATUS).map(([k,l])=>opt(k,l)).join(""));
      acts+=sel("due","Échéance",DUE_OPTS().map(([k,l])=>opt(k,l)).join(""));
      acts+=sel("who","Responsable",(MODE==="cloud"?opt(cloud.email,"Moi ("+nameOf(cloud.email)+")"):"")+[...ppl].filter(([e])=>e!==cloud.email).sort((a,b)=>a[1].localeCompare(b[1],"fr")).map(([e,l])=>opt(e,l)).join("")+opt("__other","Autre personne…")+opt("__none","Non attribuée"));
      acts+=sel("prio","Priorité",["haute","normale","basse"].map(v=>opt(v,"Priorité "+v)).join(""));
      if(one)acts+=sel("fam","Famille",getFamilies(one).map(f=>opt(f.id,f.name)).join("")+opt("__none","Sans famille"));
      const ps=state.projects.filter(x=>!x.archived&&(MODE!=="cloud"||cloud.meta[x.id]));
      if(ps.length>1)acts+=sel("proj","Déplacer vers",ps.map(x=>opt(x.id,x.name)).join(""));
    }
    if(n&&!T){
      acts+=sel("pst","Statut",opt("closed","Levé")+opt("open","Ouvert"));
      if(one)acts+=sel("th","Thème",ptThemes(one).map(k=>opt(k,k)).join("")+opt("__none","Sans thème"));
      acts+=sel("ow","Qui doit répondre",Object.entries(OWNER).filter(([k])=>k).map(([k,l])=>opt(k,l)).join("")+opt("__none","Non défini"));
      acts+=sel("erp","Sujet ERP",opt("oui","Oui")+opt("non","Non")+opt("__none","Non précisé"));
    }
    if(n)acts+=`<button type="button" class="btn ghost dangerlink" data-sa="trash">Mettre à la corbeille</button>`;
    const fem=T?"e":"";
    bar.innerHTML=`<div class="sbl"><b>${n} sélectionné${fem}${n>1?"s":""}</b><button type="button" class="pflink" data-sa="all">Tout sélectionner</button>${n?`<button type="button" class="pflink" data-sa="none">Désélectionner</button>`:""}</div>
      <div class="sbacts">${acts||`<span class="muted">Cliquez sur les ${T?"tâches":"points"} à modifier (Maj + clic pour une plage).</span>`}</div>
      <button type="button" class="btn primary" data-sa="end">Terminer</button>`;
    bar.querySelector("[data-sa=all]").onclick=()=>{document.querySelectorAll(selRowsSel()).forEach(li=>selIds.add(selRowId(li)));selPaint()};
    const nb=bar.querySelector("[data-sa=none]");if(nb)nb.onclick=()=>{selIds.clear();selPaint()};
    bar.querySelector("[data-sa=end]").onclick=selEnd;
    const tr=bar.querySelector("[data-sa=trash]");
    if(tr)tr.onclick=()=>{
      const at=Date.now(),its=selItems();selIds.clear();
      if(T)undoable(`${its.length} tâche${its.length>1?"s":""} mise${its.length>1?"s":""} à la corbeille`,its,()=>its.forEach(t=>{t.deletedAt=at}));
      else ptBulk(`${its.length} point${its.length>1?"s":""} mis à la corbeille`,its,x=>{x.deletedAt=at});
    };
    bar.querySelectorAll("select[data-sk]").forEach(s=>s.onchange=()=>{const v=s.value;s.value="";if(v)selApply(s.dataset.sk,v)});
    document.body.style.setProperty("--selbarh",bar.offsetHeight+"px");
  }
  async function selApply(k,v){
    const its=selItems();if(!its.length)return;
    const n=its.length,pl=n>1?"s":"",lbl=selMode==="t"?`${n} tâche${pl}`:`${n} point${pl}`;
    if(selMode==="t"){
      if(k==="st"){
        let wf="";if(v==="waiting"){wf=await uiPrompt("En attente de qui ou de quoi ? (facultatif)","",{ok:"Mettre en attente"});if(wf===null)return}
        undoable(`${lbl} : ${STATUS[v].toLowerCase()}`,its,()=>its.forEach(t=>{applyStatus(t,v);if(v==="waiting")t.waitingFor=wf.trim()}));
      }
      if(k==="due"){
        let d=(DUE_OPTS().find(o=>o[0]===v)||[])[2];
        if(v==="pick"){const r=await uiForm("Nouvelle échéance",[{k:"d",label:`Échéance pour ${lbl}`,type:"date"}],x=>x.d?"":"Choisissez une date.",{ok:"Appliquer"});if(!r)return;d=r.d}
        undoable(`${lbl} : ${d?"échéance au "+fmtD(d):"échéance retirée"}`,its,()=>its.forEach(t=>{t.due=d}));
      }
      if(k==="who"){
        let w=v==="__none"?"":v;
        if(v==="__other"){const r=await uiPrompt("Nom ou e-mail du responsable","",{ok:"Attribuer"});if(r===null||!r.trim())return;w=r}
        undoable(`${lbl} : ${w?"attribuée"+pl+" à "+nameOf(resolveWho(w,its[0].projectId)):"sans responsable"}`,its,()=>its.forEach(t=>{t.who=resolveWho(w,t.projectId)}));
      }
      if(k==="prio")undoable(`${lbl} : priorité ${v}`,its,()=>its.forEach(t=>{t.priority=v}));
      if(k==="fam")undoable(`${lbl} : ${v==="__none"?"sans famille":"famille « "+((getFamilies(its[0].projectId).find(f=>f.id===v)||{}).name||"")+" »"}`,its,()=>its.forEach(t=>{t.family=v==="__none"?"":v}));
      if(k==="proj"){
        const to=proj(v);if(!to)return;
        undoable(`${lbl} déplacée${pl} vers « ${to.name} »`,its,()=>its.forEach(t=>{if(t.projectId!==v){t.projectId=v;t.family=""}}));
      }
    } else {
      if(k==="pst")ptBulk(`${lbl} : ${v==="closed"?"levé"+pl:"rouvert"+pl}`,its,x=>{if(x.status!==v){x.status=v;x.closedAt=v==="closed"?Date.now():null}});
      if(k==="th")ptBulk(`${lbl} : ${v==="__none"?"sans thème":"thème « "+v+" »"}`,its,x=>{x.theme=v==="__none"?"":v});
      if(k==="ow")ptBulk(`${lbl} : ${v==="__none"?"interlocuteur non défini":"à répondre par "+OWNER[v]}`,its,x=>{x.owner=v==="__none"?"":v});
      if(k==="erp")ptBulk(`${lbl} : ${v==="oui"?"sujet ERP":v==="non"?"hors ERP":"sujet ERP non précisé"}`,its,x=>{x.erp=v==="__none"?"":v});
    }
  }
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape"||document.querySelector("dialog[open]"))return;
    if(document.querySelector("#lists .edit.drawer")&&(editing||editingPt||editingReq)){editing=editingPt=editingReq=null;render();return}
    if(selMode)selEnd();
  });
  // ---------- Statuts ----------
  // Change le statut (sans enregistrer). Renvoie la prochaine occurrence si une tâche récurrente est terminée.
  function applyStatus(t,st){
    if(!t||t.status===st)return null;
    const was=t.status; t.status=st;
    if(st!=="waiting")t.waitingFor="";
    if(st==="done"){t.doneAt=Date.now();return spawnNext(t)}
    if(was==="done")t.doneAt=null;
    return null;
  }
  const short=s=>{s=String(s||"");if(rtIs(s))s=rtText(s).replace(/\s+/g," ").trim();return s.length>60?s.slice(0,57)+"…":s};
  async function changeStatus(t,st){
    if(!t||t.status===st)return;
    let wf="";
    if(st==="waiting"){wf=await uiPrompt("En attente de qui ou de quoi ? (facultatif : client, collègue, validation…)",t.waitingFor||"",{ok:"Mettre en attente"});if(wf===null)return}
    const n=undoable(st==="done"?`« ${short(t.title)} » terminée`:`« ${short(t.title)} » : ${STATUS[st].toLowerCase()}`,[t],()=>{const r=applyStatus(t,st);if(st==="waiting")t.waitingFor=wf.trim();return r});
    if(n)setSync(`Tâche récurrente : prochaine occurrence créée pour le ${shortDay(n.due)}`);
  }

  // ---------- Annulation ----------
  let toastT=null;
  // ---------- Boîtes de dialogue intégrées (remplacent alert / confirm / prompt du navigateur) ----------
  // window.__testDialog : point d'entrée réservé aux tests automatisés.
  function uiDialog(o){
    if(typeof window.__testDialog==="function")return Promise.resolve(window.__testDialog({type:o.kind||"dialog",message:o.msg||"",def:o.def||"",fields:(o.fields||[]).map(f=>f.k)})).then(r=>{
      r=r||{};if(o.kind==="alert")return;if(o.kind==="confirm")return r.ok!==false;
      if(o.kind==="prompt")return r.ok===false?null:(r.v==null?(o.def||""):String(r.v));
      if(o.fields)return r.ok===false?null:(r.v||{});
      return r.ok===false?null:(r.v!=null?r.v:(o.buttons||[]).filter(b=>b.v!=null).pop().v);
    });
    return new Promise(res=>{
      const prevFocus=document.activeElement;
      const d=document.createElement("dialog");d.className="uidlg";d.setAttribute("aria-modal","true");
      const fields=o.fields||(o.kind==="prompt"?[{k:"v",label:"",def:o.def||"",multiline:o.multiline}]:[]);
      const btns=o.buttons||(o.kind==="alert"?[{v:true,label:o.ok||"OK",cls:"primary",focus:true}]:[{v:null,label:o.cancel||"Annuler",cls:"ghost",focus:!!o.danger&&!fields.length},{v:true,label:o.ok||"OK",cls:o.danger?"danger":"primary",focus:!o.danger}]);
      d.innerHTML=`<form method="dialog">${o.title?`<h3>${esc(o.title)}</h3>`:""}${o.msg?`<p class="uimsg">${esc(o.msg)}</p>`:""}
        ${fields.map((f,i)=>`<label class="uifld">${f.label?`<span>${esc(f.label)}</span>`:""}${f.multiline?`<textarea rows="3" data-k="${i}"></textarea>`:`<input data-k="${i}" type="${f.type||"text"}"${f.ac?` autocomplete="${f.ac}"`:""}>`}</label>`).join("")}
        <p class="uierr" role="alert"></p>
        <div class="uibtns">${btns.map((b,i)=>`<button type="button" class="btn ${b.cls==null?"":b.cls}" data-b="${i}">${esc(b.label)}</button>`).join("")}</div></form>`;
      document.body.appendChild(d);
      const ins=[...d.querySelectorAll("[data-k]")];ins.forEach((el,i)=>el.value=fields[i].def||"");
      let done=false;
      const finish=v=>{if(done)return;done=true;try{d.close()}catch(e){}d.remove();try{prevFocus&&prevFocus.focus&&document.contains(prevFocus)&&prevFocus.focus({preventScroll:true})}catch(e){}res(v)};
      const value=b=>{
        if(b.v==null)return null;
        if(!fields.length)return b.v;
        const vals={};fields.forEach((f,i)=>vals[f.k]=ins[i].value);
        if(o.kind==="prompt")return vals.v;
        return vals;
      };
      const click=i=>{
        const b=btns[i],v=value(b);
        if(b.v!=null&&o.validate&&fields.length){const err=o.validate(v);if(err){d.querySelector(".uierr").textContent=err;return}}
        finish(o.kind==="alert"?undefined:o.kind==="confirm"?b.v!=null:v);
      };
      d.querySelectorAll("[data-b]").forEach(b=>b.onclick=()=>click(+b.dataset.b));
      d.addEventListener("cancel",e=>{e.preventDefault();finish(o.kind==="alert"?undefined:o.kind==="confirm"?false:null)});
      d.querySelector("form").onsubmit=e=>{e.preventDefault()};
      d.addEventListener("keydown",e=>{
        if(e.key==="Enter"&&!e.shiftKey&&!(e.target.tagName==="TEXTAREA"&&!(e.ctrlKey||e.metaKey))&&e.target.tagName!=="BUTTON"){
          e.preventDefault();const k=btns.findIndex(b=>b.v!=null&&/primary|danger/.test(b.cls||""));click(k>=0?k:btns.length-1);
        }
      });
      if(d.showModal)d.showModal();else d.setAttribute("open","");
      const f=ins[0]||d.querySelector(`[data-b="${Math.max(0,btns.findIndex(b=>b.focus))}"]`);
      setTimeout(()=>{f.focus();if(f.select&&ins[0])f.select()},0);
    });
  }
  const uiAlert=(msg,o={})=>uiDialog({...o,kind:"alert",msg});
  const uiConfirm=(msg,o={})=>uiDialog({...o,kind:"confirm",msg});
  const uiPrompt=(msg,def="",o={})=>uiDialog({...o,kind:"prompt",msg,def});
  const uiForm=(title,fields,validate,o={})=>uiDialog({...o,kind:"form",title,fields,validate});
  function toast(msg,undo,label){
    let el=$("#toast");
    if(!el){el=document.createElement("div");el.id="toast";el.className="toast";el.setAttribute("role","status");document.body.appendChild(el)}
    el.innerHTML=`<span>${esc(msg)}</span>${undo?`<button type="button">${esc(label||"Annuler")}</button>`:""}`;
    el.hidden=false;
    clearTimeout(toastT);toastT=setTimeout(()=>{el.hidden=true},undo?8000:4000);
    if(undo)el.querySelector("button").onclick=()=>{el.hidden=true;clearTimeout(toastT);undo()};
  }
  // Exécute une action sur des tâches, puis propose de l'annuler pendant quelques secondes
  function undoable(msg,tasks,fn){
    const before=new Set(state.tasks.map(t=>t.id));
    const copies=tasks.map(t=>JSON.parse(JSON.stringify(t)));
    const res=fn();
    save();render();
    const created=state.tasks.filter(t=>!before.has(t.id)).map(t=>t.id);
    toast(msg,()=>{
      copies.forEach(c=>{
        const i=state.tasks.findIndex(x=>x.id===c.id);
        if(i>=0){if(state.tasks[i].history)c.history=state.tasks[i].history;state.tasks[i]=c}
        else state.tasks.push(c);
      });
      if(created.length)state.tasks=state.tasks.filter(t=>!created.includes(t.id));
      save();render();
    });
    return res;
  }

  // ---------- Corbeille ----------
  const TRASH_DAYS=30, CONTACTS_ARCH_DAYS=182, BACKUP_WEEKS=12;
  async function emptyTrash(){
    const n=state.tasks.filter(t=>t.deletedAt).length+(state.requests||[]).filter(r=>r.deletedAt).length+(state.points||[]).filter(o=>o.deletedAt).length;
    if(!n||!await uiConfirm(`Supprimer définitivement ${n>1?`les ${n} éléments`:"l'élément"} de la corbeille ? Cette action est irréversible.`,{ok:"Vider la corbeille",danger:true}))return;
    state.tasks=state.tasks.filter(t=>!t.deletedAt);state.requests=(state.requests||[]).filter(r=>!r.deletedAt);state.points=(state.points||[]).filter(o=>!o.deletedAt);save();render();
  }
  function purgeTrash(){
    const lim=Date.now()-TRASH_DAYS*864e5;
    const old=x=>x.deletedAt&&x.deletedAt<lim;
    if(state.tasks.some(old)||(state.requests||[]).some(old)||(state.points||[]).some(old)){state.tasks=state.tasks.filter(t=>!old(t));state.requests=(state.requests||[]).filter(r=>!old(r));state.points=(state.points||[]).filter(o=>!old(o));save();render()}
    // Mode local : mêmes règles de conservation que côté serveur (comptes rendus supprimés : 30 jours ; contacts d'un projet archivé : 6 mois)
    if(MODE!=="cloud"){
      const limA=Date.now()-CONTACTS_ARCH_DAYS*864e5;let ch=false;
      state.projects.forEach(p=>{
        if(p.meetings&&p.meetings.some(old)){p.meetings=p.meetings.filter(m=>!old(m));ch=true}
        if(p.archived&&p.archivedAt&&p.archivedAt<limA&&(p.contacts||[]).length){p.contacts=[];ch=true}
      });
      if(ch){save();render()}
    }
  }
  function renderTrash(L){
    const items=[...state.tasks.filter(t=>t.deletedAt),...(state.requests||[]).filter(r=>r.deletedAt).map(r=>Object.assign(Object.create(null),{__req:r,...r})),...(state.points||[]).filter(o=>o.deletedAt).map(o=>Object.assign(Object.create(null),{__pt:o,...o,title:o.text}))].sort((a,b)=>b.deletedAt-a.deletedAt);
    L.insertAdjacentHTML("beforeend",`<p class="hint">Les tâches, demandes et points supprimés restent ${TRASH_DAYS} jours dans la corbeille, puis sont effacées définitivement.${MODE==="cloud"?" Sur un projet partagé, la corbeille est commune à tous ses membres.":""}</p>`);
    if(!items.length){L.insertAdjacentHTML("beforeend",`<div class="empty">La corbeille est vide.</div>`);return}
    const ul=document.createElement("ul");ul.className="tasks";
    items.forEach(t=>{
      const p=proj(t.projectId), left=Math.max(0,TRASH_DAYS-Math.floor((Date.now()-t.deletedAt)/864e5));
      const li=document.createElement("li");li.className="trow";
      const isR=!!t.__req, isO=!!t.__pt;
      li.innerHTML=`<div><div class="ttl" style="cursor:default">${esc(t.title)}</div><div class="meta">${isR?`<span class="tag reqtag">Demande client</span>`:""}${isO?`<span class="tag reqtag">Point ouvert</span>`:""}${p?`<span class="tag"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>`:""}<span class="tag">Supprimée le ${fmtWhen(t.deletedAt)}${MODE==="cloud"&&t.updatedBy?" par "+esc(nameOf(t.updatedBy)):""}</span><span class="tag">${left?`Effacement dans ${left} jour${left>1?"s":""}`:"Effacement imminent"}</span></div></div>
        <div class="acts"><button class="sbtn" type="button" data-r>Restaurer</button><button class="sbtn danger" type="button" data-x>Supprimer définitivement</button></div>`;
      if(isO){
        li.querySelector("[data-r]").onclick=()=>{const cur=state.points.find(x=>x.id===t.id);if(!cur)return;cur.deletedAt=null;save();render();toast("Point ouvert restauré")};
        li.querySelector("[data-x]").onclick=async()=>{if(!await uiConfirm(`Supprimer définitivement ce point ouvert ? Cette action est irréversible.`,{ok:"Supprimer",danger:true}))return;state.points=state.points.filter(x=>x.id!==t.id);save();render()};
        ul.appendChild(li);return;
      }
      if(isR){
        li.querySelector("[data-r]").onclick=()=>{const cur=state.requests.find(x=>x.id===t.id);if(!cur)return;const at=cur.deletedAt;const ts=state.tasks.filter(x=>x.requestId===cur.id&&x.deletedAt&&x.deletedAt===at);cur.deletedAt=null;ts.forEach(x=>x.deletedAt=null);save();render();toast(`Demande « ${short(cur.title)} » restaurée${ts.length?` avec ${ts.length>1?`ses ${ts.length} tâches`:"sa tâche"}`:""}`)};
        li.querySelector("[data-x]").onclick=async()=>{if(!await uiConfirm(`Supprimer définitivement la demande « ${t.title} » ? Cette action est irréversible.`,{ok:"Supprimer",danger:true}))return;state.requests=state.requests.filter(x=>x.id!==t.id);live().forEach(x=>{if(x.requestId===t.id)x.requestId=null});save();render()};
        ul.appendChild(li);return;
      }
      li.querySelector("[data-r]").onclick=()=>{const cur=state.tasks.find(x=>x.id===t.id);if(!cur)return;cur.deletedAt=null;save();render();toast(`« ${short(cur.title)} » restaurée${isArch(cur.projectId)?" (projet archivé)":""}`)};
      li.querySelector("[data-x]").onclick=async()=>{if(!await uiConfirm(`Supprimer définitivement « ${t.title} » ? Cette action est irréversible.`,{ok:"Supprimer",danger:true}))return;state.tasks=state.tasks.filter(x=>x.id!==t.id);save();render()};
      ul.appendChild(li);
    });
    L.appendChild(ul);
  }

  // ---------- Archivage des projets ----------
  function archiveProject(p,on){
    const id=p.id;p.archived=!!on;if(MODE!=="cloud")p.archivedAt=on?Date.now():null;
    if(on&&view===id)view="all";
    save();render();
    toast(on?`Projet « ${short(p.name)} » archivé : il reste consultable dans « Projets archivés ».`:`Projet « ${short(p.name)} » réactivé.`,()=>{const cur=proj(id);if(!cur)return;cur.archived=!on;if(on)view=id;save();render()});
  }

  // ---------- Tableau de bord ----------
  function renderDash(L){
    const t0=iso(today()), wS=iso(mondayOf(new Date())), wE=iso(addDays(mondayOf(new Date()),6)), in14=iso(addDays(today(),13));
    const projs=state.projects.filter(p=>!p.archived);
    const all=live().filter(t=>!isArch(t.projectId));
    const open=all.filter(t=>t.status!=="done");
    const dl=ms=>ms?iso(new Date(ms)):"";
    const goList=(scope,extra)=>()=>{query="";$("#search").value="";view="all";ui.mode="list";ui.scope=scope;Object.assign(ui,extra||{});saveUi();editing=null;render();window.scrollTo({top:0})};
    const kpis=[
      ["Tâches ouvertes",open.length,"",goList("all")],
      ["En retard",open.filter(isLate).length,"bad",goList("today")],
      ["En attente",open.filter(t=>t.status==="waiting").length,"wait",()=>{view="all";ui.mode="list";ui.scope="all";ui.groupBy="due";saveUi();render();setTimeout(()=>{const g=document.querySelector(".g-waiting");if(g)g.scrollIntoView({block:"start"})},0)}],
      ["Échéance cette semaine",open.filter(t=>t.due&&t.due>=wS&&t.due<=wE).length,"",()=>{view="all";ui.mode="agenda";ui.scope="all";weekStart=null;saveUi();render()}],
      ["Demandes client ouvertes",liveReq().filter(r=>reqOpen(r)&&!isArch(r.projectId)).length,liveReq().some(r=>reqLate(r)&&!isArch(r.projectId))?"bad":"",()=>{view="all";ui.mode="requests";saveUi();render();window.scrollTo({top:0})}],
      ["Terminées cette semaine",all.filter(t=>t.status==="done"&&dl(t.doneAt)>=wS&&dl(t.doneAt)<=wE).length,"ok",goList("all",{showDoneList:true})]
    ];
    const k=document.createElement("div");k.className="kpis";
    kpis.forEach(([l,n,c,fn])=>{const b=document.createElement("button");b.type="button";b.className="kpi"+(c&&n?" "+c:"");b.innerHTML=`<b>${n}</b><span>${l}</span>`;b.onclick=fn;k.appendChild(b)});
    L.appendChild(k);
    const sec=(title,detail)=>{const s=document.createElement("section");s.className="group";s.innerHTML=`<h2>${title} <span>${detail||""}</span></h2>`;return s};
    // avancement par projet
    const sp=sec("Avancement par projet",`${projs.length} projet${projs.length>1?"s":""} actif${projs.length>1?"s":""}`);
    if(!projs.length)sp.insertAdjacentHTML("beforeend",`<div class="empty">Aucun projet actif.</div>`);
    else{
      const rows=projs.map(p=>{
        const ts=all.filter(t=>t.projectId===p.id), op=ts.filter(t=>t.status!=="done");
        const pct=ts.length?Math.round(100*(ts.length-op.length)/ts.length):0;
        const next=op.filter(t=>t.due&&t.due>=t0).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:0)[0];
        const late=op.filter(isLate).length;
        const rq=liveReq().filter(r=>r.projectId===p.id&&reqOpen(r)), rqLate=rq.filter(reqLate).length;
        const npt=livePts().filter(o=>o.projectId===p.id&&o.status!=="closed").length;
        return `<tr class="click" data-p="${esc(p.id)}"><td><span class="dot" style="background:${p.color};display:inline-block;margin-right:8px"></span>${esc(p.name)}</td>
          <td><span class="prog"><i><b style="width:${pct}%;background:${p.color}"></b></i>${pct} %</span></td>
          <td class="num">${op.length}</td><td class="num">${op.filter(t=>t.status==="doing").length||""}</td><td class="num">${op.filter(t=>t.status==="waiting").length||""}</td><td class="num${late?" bad":""}">${late||""}</td><td class="num">${npt||""}</td><td class="num${rqLate?" bad":""}" title="${rqLate?rqLate+" réponse(s) en retard":""}">${rq.length||""}</td>
          <td>${next?`${shortDay(next.due)} · ${esc(short(next.title))}`:`<span class="muted">—</span>`}</td></tr>`;
      }).join("");
      sp.insertAdjacentHTML("beforeend",`<div class="tscroll"><table class="dtable"><thead><tr><th>Projet</th><th>Avancement</th><th class="num">Ouvertes</th><th class="num">En cours</th><th class="num">En attente</th><th class="num">En retard</th><th class="num">Points ouverts</th><th class="num">Demandes</th><th>Prochaine échéance</th></tr></thead><tbody>${rows}</tbody></table></div>`);
      sp.querySelectorAll("[data-p]").forEach(tr=>tr.onclick=()=>{view=tr.dataset.p;ui.mode="list";ui.scope="all";saveUi();editing=null;render();window.scrollTo({top:0})});
    }
    L.appendChild(sp);
    const grid=document.createElement("div");grid.className="dgrid";
    // charge par personne
    const pp=sec("Charge par personne","tâches ouvertes");
    const by=new Map();
    open.forEach(t=>{const n=whoName(t)||"";if(!by.has(n))by.set(n,[]);by.get(n).push(t)});
    const people=[...by.entries()].sort((a,b)=>(a[0]===""?1:0)-(b[0]===""?1:0)||b[1].length-a[1].length||a[0].localeCompare(b[0],"fr"));
    if(!people.length)pp.insertAdjacentHTML("beforeend",`<div class="empty">Aucune tâche ouverte.</div>`);
    else{
      pp.insertAdjacentHTML("beforeend",`<div class="tscroll"><table class="dtable narrow"><thead><tr><th>Responsable</th><th class="num">Ouvertes</th><th class="num">En retard</th><th class="num">Cette semaine</th><th class="num">En attente</th></tr></thead><tbody>${people.map(([n,ts])=>{const late=ts.filter(isLate).length;return `<tr class="click" data-w="${esc(n||"__none")}"><td>${n?esc(n):`<span class="muted">Non attribuées</span>`}</td><td class="num">${ts.length}</td><td class="num${late?" bad":""}">${late||""}</td><td class="num">${ts.filter(t=>t.due&&t.due>=wS&&t.due<=wE).length||""}</td><td class="num">${ts.filter(t=>t.status==="waiting").length||""}</td></tr>`}).join("")}</tbody></table></div>`);
      pp.querySelectorAll("[data-w]").forEach(tr=>tr.onclick=goList("all",{who:tr.dataset.w}));
    }
    grid.appendChild(pp);
    // échéances à venir
    const up=sec("Échéances des 14 prochains jours","");
    const soon=open.filter(t=>t.due&&t.due>=t0&&t.due<=in14).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:sortOpen(a,b));
    up.querySelector("h2 span").textContent=soon.length?`${soon.length} tâche${soon.length>1?"s":""}`:"";
    if(!soon.length)up.insertAdjacentHTML("beforeend",`<div class="empty">Aucune échéance dans les 14 prochains jours.</div>`);
    else{
      up.insertAdjacentHTML("beforeend",`<div class="tscroll"><table class="dtable narrow"><thead><tr><th>Date</th><th>Tâche</th><th>Projet</th></tr></thead><tbody>${soon.slice(0,15).map(t=>{const p=proj(t.projectId);return `<tr class="click" data-t="${esc(t.id)}"><td style="white-space:nowrap">${shortDay(t.due)}</td><td>${esc(t.title)}${t.status==="waiting"?` <span class="tag wait">En attente</span>`:t.status==="doing"?` <span class="tag doing">En cours</span>`:""}</td><td style="white-space:nowrap"><span class="dot" style="background:${p?p.color:"#999"};display:inline-block;margin-right:6px"></span>${esc(p?p.name:"")}</td></tr>`}).join("")}</tbody></table></div>${soon.length>15?`<p class="hint">et ${soon.length-15} autre(s) : voir l'agenda.</p>`:""}`);
      up.querySelectorAll("[data-t]").forEach(tr=>tr.onclick=()=>{const t=state.tasks.find(x=>x.id===tr.dataset.t);if(t){view="all";openInList(t)}});
    }
    grid.appendChild(up);
    L.appendChild(grid);
  }

  // ---------- Historique des modifications ----------
  const fname=(pid,fid)=>fid?((getFamilies(pid).find(f=>f.id===fid)||{}).name||""):"";
  const clSum=l=>{l=Array.isArray(l)?l:[];return l.length?`${l.filter(c=>c.done).length}/${l.length}`:""};
  function diffTask(o,prevJson){
    if(!prevJson)return [{f:"created",n:o.title}];
    let a;try{a=JSON.parse(prevJson)}catch(e){return []}
    const out=[], add=(f,x,y)=>{x=x??"";y=y??"";if(x!==y)out.push({f,o:x,n:y})};
    if(!a.deletedAt&&o.deletedAt)out.push({f:"deleted"});else if(a.deletedAt&&!o.deletedAt)out.push({f:"restored"});
    add("title",a.title,o.title);add("status",a.status,o.status);add("due",a.due,o.due);add("priority",a.priority,o.priority);add("who",a.who,o.who);
    if(a.projectId!==o.projectId)out.push({f:"project",o:(proj(a.projectId)||{}).name||"",n:(proj(o.projectId)||{}).name||""});
    if((a.family||"")!==(o.family||""))out.push({f:"family",o:fname(a.projectId,a.family),n:fname(o.projectId,o.family)});
    add("waitingFor",a.waitingFor,o.waitingFor);
    if((a.note||"")!==(o.note||""))out.push({f:"note"});
    if(JSON.stringify(a.checklist||[])!==JSON.stringify(o.checklist||[]))out.push({f:"checklist",o:clSum(a.checklist),n:clSum(o.checklist)});
    return out;
  }
  function logLocal(o,prev){
    const ch=diffTask(o,prev); if(!ch.length)return;
    const at=Date.now();
    o.history=[...(Array.isArray(o.history)?o.history:[]),...ch.map(c=>({at,...c}))].slice(-80);
  }
  async function loadHistory(t){
    try{
      const {data,error}=await cloudClient().from("task_history").select("*").eq("task_id",t.id).order("id",{ascending:true}).limit(300);
      if(error)return null;
      return data.map(r=>({at:Number(r.at),by:r.actor_email,f:r.field,o:r.old_value,n:r.new_value}));
    }catch(e){return null}
  }
  const HLBL={title:"l'intitulé",status:"le statut",due:"l'échéance",priority:"la priorité",who:"le responsable",project:"le projet",family:"la famille",waitingFor:"« En attente de »"};
  function histText(h){
    const val=(f,x)=>{
      if(x==null||x==="")return f==="who"?"personne":f==="due"?"aucune":f==="family"?"sans famille":"vide";
      if(f==="status")return STATUS[x]||x;
      if(f==="due"){const d=parseD(x);return d?d.toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"}):x}
      if(f==="who")return nameOf(x);
      return x;
    };
    switch(h.f){
      case "created":return "a créé la tâche";
      case "deleted":return "a mis la tâche à la corbeille";
      case "restored":return "a restauré la tâche depuis la corbeille";
      case "note":return "a modifié la note";
      case "checklist":return `a mis à jour les étapes${h.n?` : ${esc(h.n)} terminée(s)`:" (toutes retirées)"}`;
      default:return `a changé ${HLBL[h.f]||esc(h.f)} : « ${esc(val(h.f,h.o))} » devient « ${esc(val(h.f,h.n))} »`;
    }
  }
  let histOpen=null;
  function histBox(t){
    const d=document.createElement("details");d.className="hbox";
    d.innerHTML=`<summary>Historique des modifications</summary><ul class="hlist"><li class="hint">Chargement…</li></ul>`;
    const ul=d.querySelector("ul");
    const fill=async()=>{
      let list;
      if(MODE==="cloud"){list=await loadHistory(t);if(!list){ul.innerHTML=`<li class="hint">Historique indisponible : connexion au serveur impossible.</li>`;return}}
      else list=((state.tasks.find(x=>x.id===t.id)||t).history)||[];
      ul.innerHTML=list.length?list.slice().reverse().map(h=>{const txt=histText(h);return `<li><time>${fmtWhen(h.at)}</time>${h.by?`<b>${esc(nameOf(h.by))}</b> ${txt}`:cap(txt)}</li>`}).join(""):`<li class="hint">Aucune modification enregistrée pour l'instant : l'historique est conservé depuis la mise à jour du 8 octobre 2026.</li>`;
    };
    d.addEventListener("toggle",()=>{if(d.open){histOpen=t.id;fill()}else if(histOpen===t.id)histOpen=null});
    if(histOpen===t.id)d.open=true;
    return d;
  }

  // ---------- Export des points ouverts ----------
  function exportSets(ps,o){
    const lim=Date.now()-o.days*864e5;
    const rank=t=>t.status==="done"?4:isLate(t)?0:t.status==="doing"?1:t.status==="waiting"?2:3;
    return ps.map(p=>{
      const ts=live().filter(t=>t.projectId===p.id&&(t.status!=="done"||(o.done&&(t.doneAt||0)>=lim)));
      ts.sort((a,b)=>rank(a)-rank(b)||(a.due||"9999").localeCompare(b.due||"9999")||(prioRank[a.priority]??1)-(prioRank[b.priority]??1)||(a.createdAt||0)-(b.createdAt||0));
      return {p,rows:ts.map(t=>{
        const cs=getComments(t), lc=cs[cs.length-1];
        const r=rank(t);
        return {t,st:r===4?"Terminée":r===0?"En retard":STATUS[t.status]||"À faire",cls:["late","doing","wait","todo","done"][r],fam:famName(t),prio:cap(t.priority||"normale"),who:whoName(t),due:t.due||"",wf:t.waitingFor||"",steps:clSum(t.checklist),note:rtText(t.note||""),noteH:t.note||"",com:lc?`${nameOf(lc.author)} (${new Date(lc.at).toLocaleDateString("fr-FR")}) : ${rtText(lc.text)}`:""};
      })};
    });
  }
  const slug=s=>norm(s).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"projet";
  const expBase=ps=>`plan-actions-${ps.length>1?"projets":slug(ps[0].name)}-${iso(today())}`;
  const expTitle=ps=>`Plan d'actions – ${ps.length>1?ps.map(p=>p.name).join(", "):ps[0].name}`;
  const {buildXlsx}=window.XlsxLite;
  function exportXlsx(ps,o){
    const sets=exportSets(ps,o), multi=ps.length>1;
    const cols=[multi&&["Projet",22],["Statut",12],["Tâche",55],["Famille",18],["Priorité",10],o.who&&["Responsable",22],["Échéance",12],["En attente de",24],["Étapes",9],o.note&&["Note",50],o.com&&["Dernier commentaire",50]].filter(Boolean);
    const stS={late:6,wait:7,doing:8,done:9,todo:10};
    const rows=[[{v:expTitle(ps),s:1}],[{v:`Situation au ${new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}`,s:2}],[],cols.map(c=>({v:c[0],s:3}))];
    sets.forEach(st=>st.rows.forEach(r=>{
      const v={"Projet":st.p.name,"Statut":r.st,"Tâche":r.t.title,"Famille":r.fam,"Priorité":r.prio,"Responsable":r.who,"Échéance":r.due?parseD(r.due):"","En attente de":r.wf,"Étapes":r.steps,"Note":r.note,"Dernier commentaire":r.com};
      rows.push(cols.map(c=>({v:v[c[0]],s:c[0]==="Statut"?stS[r.cls]:c[0]==="Échéance"?5:4})));
    }));
    const blob=buildXlsx("Plan d'actions",rows,cols.map(c=>c[1]),4);
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=expBase(ps)+".xlsx";
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    return true;
  }
  function exportPdf(ps,o){
    const sets=exportSets(ps,o);
    const dateL=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});
    const total=sets.reduce((n,s)=>n+s.rows.filter(r=>r.cls!=="done").length,0);
    const body=sets.map(s=>{
      const op=s.rows.filter(r=>r.cls!=="done");
      const cnt=[`${op.length} point${op.length>1?"s":""} ouvert${op.length>1?"s":""}`,op.filter(r=>r.cls==="late").length&&`${op.filter(r=>r.cls==="late").length} en retard`,op.filter(r=>r.cls==="wait").length&&`${op.filter(r=>r.cls==="wait").length} en attente`,s.rows.length-op.length&&`${s.rows.length-op.length} terminé(s) récemment`].filter(Boolean).join(" · ");
      const head=`<tr><th>Statut</th><th>Tâche</th><th>Famille</th><th>Priorité</th>${o.who?"<th>Responsable</th>":""}<th>Échéance</th><th>En attente de</th></tr>`;
      const rows=s.rows.map(r=>`<tr><td class="st ${r.cls}">${esc(r.st)}</td><td><div class="tt">${esc(r.t.title)}${r.steps?` <span class="mut">(étapes ${esc(r.steps)})</span>`:""}</div>${o.note&&r.note?`<div class="nt rt">${rtHtml(r.noteH)}</div>`:""}${o.com&&r.com?`<div class="nt">Dernier commentaire – ${esc(r.com)}</div>`:""}</td><td>${esc(r.fam)}</td><td>${esc(r.prio)}</td>${o.who?`<td>${esc(r.who)}</td>`:""}<td class="nw">${r.due?esc(parseD(r.due).toLocaleDateString("fr-FR")):""}</td><td>${esc(r.wf)}</td></tr>`).join("");
      return `<section><h2 style="border-color:${s.p.color}">${pLogo(s.p)?`<img class="lg" src="${s.p.logo}" alt="">`:""}${esc(s.p.name)}</h2><p class="sub">${cnt}</p>${s.rows.length?`<table><thead>${head}</thead><tbody>${rows}</tbody></table>`:`<p class="mut">Aucun point ouvert.</p>`}</section>`;
    }).join("");
    const title=expTitle(ps);
    const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(expBase(ps))}</title><style>
      @page{size:A4 landscape;margin:12mm}
      *{box-sizing:border-box}body{margin:0;font:10pt/1.4 "Segoe UI",Arial,sans-serif;color:#16232B}
      h1{font-size:19pt;margin:0}.lead{color:#51646F;margin:3px 0 14px}
      section{margin:0 0 18px}h2{font-size:13pt;margin:0;padding-bottom:3px;border-bottom:3px solid #2F4A5A;display:flex;align-items:center;gap:10px}h2 .lg{max-height:30px;max-width:120px;object-fit:contain}
      .sub{color:#51646F;margin:4px 0 8px;font-size:9.5pt}
      table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{page-break-inside:avoid}
      th{background:#EEF1F3;text-align:left;font-size:8.5pt;font-weight:600;text-transform:uppercase;letter-spacing:.03em;padding:5px 6px;border-bottom:1px solid #C9D3D9}
      td{padding:5px 6px;border-bottom:1px solid #E3E8EB;vertical-align:top}
      .st{font-weight:600;white-space:nowrap}.late{color:#B42318}.doing{color:#1F4A66}.wait{color:#5B3FA0}.done{color:#2F7D5B}.todo{color:#3E5868}
      .tt{font-weight:500}.nt{color:#51646F;font-size:9pt;margin-top:2px;white-space:pre-wrap}.mut{color:#7A8A94;font-weight:400}.nw{white-space:nowrap}
    </style></head><body><h1>${esc(title)}</h1><p class="lead">Situation au ${dateL} · ${total} point${total>1?"s":""} ouvert${total>1?"s":""}</p>${body}</body></html>`;
    const ifr=document.createElement("iframe");ifr.setAttribute("aria-hidden","true");ifr.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(ifr);
    const prev=document.title;
    ifr.onload=()=>{
      document.title=expBase(ps);
      const w=ifr.contentWindow;
      const done=()=>{document.title=prev;setTimeout(()=>ifr.remove(),1000)};
      w.addEventListener("afterprint",done);
      setTimeout(()=>{try{w.focus();w.print()}catch(e){uiAlert("Impression impossible dans ce navigateur.");done()}},50);
    };
    ifr.srcdoc=html;
    return html;
  }
  function openExport(p,kind){
    const dlg=$("#expdlg");
    let k=kind==="points"?"points":"tasks";
    const setKind=v=>{k=v;$("#expkind").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.k===k));$("#expopt-t").hidden=k!=="tasks";$("#expopt-p").hidden=k!=="points";
      $("#exphint").textContent=k==="tasks"?"Plan d'actions prêt à transmettre (client, comité de pilotage, hiérarchie) : tâches en retard, en cours, en attente et à faire, triées par échéance.":"Liste des points ouverts prête à transmettre au client avant un atelier : numérotée, regroupée par thème, avec qui doit répondre.";
      $("#expprojs").querySelectorAll("small").forEach(sm=>{const id=sm.dataset.p;sm.textContent=k==="tasks"?`${live().filter(t=>t.projectId===id&&t.status!=="done").length} tâche(s) ouverte(s)`:`${livePts().filter(o=>o.projectId===id&&o.status!=="closed").length} point(s) ouvert(s)`})};
    $("#expkind").querySelectorAll("button").forEach(b=>b.onclick=()=>setKind(b.dataset.k));
    const projs=state.projects.filter(x=>!x.archived||(p&&x.id===p.id));
    if(!projs.length){uiAlert("Aucun projet à exporter.");return}
    $("#expprojs").innerHTML=projs.map(x=>`<label class="pfrow"><input type="checkbox" value="${esc(x.id)}" ${!p||x.id===p.id?"checked":""}><span class="dot" style="background:${x.color}"></span><span class="pfname">${esc(x.name)}</span><small data-p="${esc(x.id)}"></small></label>`).join("");
    setKind(k);
    $("#experr").textContent="";
    const sel=()=>[...$("#expprojs").querySelectorAll("input:checked")].map(i=>proj(i.value)).filter(Boolean);
    const opts=()=>({done:$("#expdone").checked,days:+$("#expdays").value,note:$("#expnote").checked,com:$("#expcom").checked,who:$("#expwho").checked});
    const go=async fmt=>{
      const ps=sel();if(!ps.length){$("#experr").textContent="Choisissez au moins un projet.";return}
      $("#experr").textContent="";
      if(k==="points"){const po={closed:$("#expptclosed").checked,ans:$("#expptans").checked,owner:$("#expptowner").checked};if(fmt==="xlsx")exportPointsXlsx(ps,po);else exportPointsPdf(ps,po);return}
      if(fmt==="xlsx"){$("#expxlsx").disabled=true;try{await exportXlsx(ps,opts())}finally{$("#expxlsx").disabled=false}}
      else exportPdf(ps,opts());
    };
    $("#expxlsx").onclick=()=>go("xlsx");
    $("#exppdf").onclick=()=>go("pdf");
    $("#expall").onclick=()=>$("#expprojs").querySelectorAll("input").forEach(i=>i.checked=true);
    $("#expnone").onclick=()=>$("#expprojs").querySelectorAll("input").forEach(i=>i.checked=false);
    if(dlg.showModal)dlg.showModal();else dlg.setAttribute("open","");
  }
  // ---------- Points ouverts ----------
  const OWNER={"":"Non défini",client:"Client",mecalux:"Mecalux",tiers:"Tiers"};
  const livePts=()=>(state.points||[]).filter(x=>!x.deletedAt);
  // Thèmes : ceux créés manuellement + ceux déjà utilisés par des points
  function storedThemes(pid){return MODE==="cloud"?(cloud.ptThemes[pid]||[]):((proj(pid)||{}).pointThemes||[])}
  const ptThemes=pid=>{
    const m=new Map();
    storedThemes(pid).forEach(t=>m.set(t.name.toLowerCase(),t.name));
    livePts().forEach(x=>{if(x.projectId===pid&&x.theme&&!m.has(x.theme.toLowerCase()))m.set(x.theme.toLowerCase(),x.theme)});
    return [...m.values()].sort((a,b)=>a.localeCompare(b,"fr",{sensitivity:"base"}));
  };
  async function addTheme(pid,name){
    name=String(name||"").trim().slice(0,80);if(!name)return null;
    const ex=ptThemes(pid).find(n=>n.toLowerCase()===name.toLowerCase());if(ex)return ex;
    const id=crypto.randomUUID?crypto.randomUUID():uid()+uid();
    if(MODE==="cloud"){
      const {error}=await cloudClient().from("point_themes").insert({id,project_id:pid,name});
      if(error&&error.code!=="23505"){uiAlert(transient(error)?"Thème non créé : connexion au serveur impossible.":"Thème refusé : "+error.message);return null}
      (cloud.ptThemes[pid]=cloud.ptThemes[pid]||[]).push({id,name});cloud._lastPt=JSON.stringify(cloud.ptThemes);
      return name;
    }
    const pr=proj(pid);if(!pr)return null;
    pr.pointThemes=[...(pr.pointThemes||[]),{id,name}];save();return name;
  }
  async function renameThemeTo(pid,old,v){
    v=String(v||"").trim().slice(0,80);if(!v||v===old)return false;
    if(ptThemes(pid).some(n=>n!==old&&n.toLowerCase()===v.toLowerCase())&&!await uiConfirm(`Le thème « ${v} » existe déjà : fusionner « ${old} » dedans ?`,{ok:"Fusionner"}))return false;
    const st=storedThemes(pid).find(t=>t.name===old), dup=storedThemes(pid).find(t=>t.name!==old&&t.name.toLowerCase()===v.toLowerCase());
    if(MODE==="cloud"){
      const c=cloudClient();
      if(st){const {error}=dup?await c.from("point_themes").delete().eq("id",st.id):await c.from("point_themes").update({name:v}).eq("id",st.id);if(error){uiAlert("Renommage impossible : "+error.message);return false}}
      else if(!dup){const id=crypto.randomUUID?crypto.randomUUID():uid()+uid();await c.from("point_themes").insert({id,project_id:pid,name:v});(cloud.ptThemes[pid]=cloud.ptThemes[pid]||[]).push({id,name:v})}
      if(st){cloud.ptThemes[pid]=dup?(cloud.ptThemes[pid]||[]).filter(t=>t.id!==st.id):(cloud.ptThemes[pid]||[]).map(t=>t.id===st.id?{...t,name:v}:t)}
      cloud._lastPt=JSON.stringify(cloud.ptThemes);
    } else {
      const pr=proj(pid);let l=(pr.pointThemes||[]).slice();
      if(st)l=dup?l.filter(t=>t!==st):l.map(t=>t===st?{...t,name:v}:t);else if(!dup)l.push({id:uid(),name:v});
      pr.pointThemes=l;
    }
    const target=dup?dup.name:v;
    livePts().forEach(x=>{if(x.projectId===pid&&x.theme===old)x.theme=target});
    if(ui.lastTheme===old){ui.lastTheme=target;saveUi()}
    save();render();return true;
  }
  async function deleteTheme(pid,name){
    const n=livePts().filter(x=>x.projectId===pid&&x.theme===name).length;
    if(!await uiConfirm(`Supprimer le thème « ${name} » ?${n?` Les ${n} point(s) qui l'utilisent passeront en « Sans thème ».`:""}`,{ok:"Supprimer",danger:true}))return false;
    const st=storedThemes(pid).find(t=>t.name===name);
    if(MODE==="cloud"){
      if(st){const {error}=await cloudClient().from("point_themes").delete().eq("id",st.id);if(error){uiAlert("Suppression impossible : "+error.message);return false}}
      cloud.ptThemes[pid]=(cloud.ptThemes[pid]||[]).filter(t=>t.name!==name);cloud._lastPt=JSON.stringify(cloud.ptThemes);
    } else {const pr=proj(pid);pr.pointThemes=(pr.pointThemes||[]).filter(t=>t.name!==name)}
    livePts().forEach(x=>{if(x.projectId===pid&&x.theme===name)x.theme=""});
    if(ui.lastTheme===name){ui.lastTheme="";saveUi()}
    save();render();return true;
  }
  // Liste déroulante des thèmes avec « + Nouveau thème… »
  function themeOptions(pid,sel,emptyLabel){
    return `<option value="">${emptyLabel}</option>${ptThemes(pid).map(n=>`<option value="${esc(n)}" ${n===sel?"selected":""}>${esc(n)}</option>`).join("")}<option value="__new">+ Nouveau thème…</option>`;
  }
  function bindThemeSelect(sel,pid,emptyLabel,after){
    sel.dataset.prev=sel.value;
    sel.addEventListener("change",async()=>{
      if(sel.value!=="__new"){sel.dataset.prev=sel.value;if(after)after();return}
      const name=await uiPrompt("Nom du nouveau thème (propre à ce projet)","",{ok:"Créer"});
      const n=name?await addTheme(pid,name):null;
      sel.innerHTML=themeOptions(pid,n||sel.dataset.prev||"",emptyLabel);
      sel.value=n||sel.dataset.prev||"";sel.dataset.prev=sel.value;if(after)after(!!n);
    });
  }
  const ownerTxt=x=>x.owner||x.ownerName?[x.owner?OWNER[x.owner]:"",x.ownerName].filter(Boolean).join(" · "):"";
  let editingPt=null;
  const newId=()=>MODE==="cloud"&&crypto.randomUUID?crypto.randomUUID():uid();
  // Nettoie une ligne collée : puces, numéros, titre « Points ouverts : »
  const cleanLine=l=>l.replace(/^\s*(?:[-*•·◦▪●–—]|\d{1,3}[.)]|[a-z][.)])\s+/i,"").replace(/^\s*[•·◦▪●]\s*/,"").trim();
  function splitPasted(txt){
    return String(txt||"").split(/\r?\n/).map(cleanLine).filter(l=>l&&!/^points?\s+ouverts?\s*:?$/i.test(l)&&!/^.{0,40}:\s*$/.test(l));
  }
  function addPoints(texts,pid,theme,owner){
    const now=Date.now();
    texts.forEach((t,i)=>state.points.push({id:newId(),projectId:pid,text:t.slice(0,2000),answer:"",hypothesis:"",erp:"",theme:(theme||"").slice(0,80),owner:owner||"",ownerName:"",status:"open",taskId:null,requestId:null,createdAt:now+i,closedAt:null}));
    save();render();
  }
  function ptUndoable(msg,x,fn){
    const copy=JSON.parse(JSON.stringify(x));
    fn();save();render();
    toast(msg,()=>{const i=state.points.findIndex(y=>y.id===copy.id);if(i>=0)state.points[i]=copy;else state.points.push(copy);save();render()});
  }
  async function closePoint(x,on){
    if(on&&!x.answer){
      const a=await uiPrompt("Réponse ou décision obtenue (facultatif) :","",{ok:"Lever le point",multiline:true});
      if(a===null){render();return}
      ptUndoable("Point levé",x,()=>{x.answer=a.trim();x.status="closed";x.closedAt=Date.now()});
      return;
    }
    ptUndoable(on?"Point levé":"Point rouvert",x,()=>{x.status=on?"closed":"open";x.closedAt=on?Date.now():null});
  }
  function pointToTask(x){
    const id=newId();
    state.tasks.push({id,projectId:x.projectId,title:x.text.split("\n")[0].slice(0,300),priority:"normale",due:"",status:"todo",note:`Issu du point ouvert : ${x.text}`,who:"",createdAt:Date.now(),checklist:[],repeat:null});
    x.taskId=id;save();render();
    toast("Tâche créée à partir du point ouvert",()=>{const t=state.tasks.find(y=>y.id===id);if(t){editing=id;openInList(t)}},"Ouvrir la tâche");
  }
  function pointToRequest(x){
    const id=newId();
    state.requests.push({id,projectId:x.projectId,title:rtText(x.text).split("\n")[0].slice(0,300),description:[rtText(x.text).includes("\n")?rtText(x.text):"",x.answer?`Réponse / décision : ${rtText(x.answer)}`:""].filter(Boolean).join("\n\n"),requester:x.owner==="client"?x.ownerName:"",received:iso(today()),due:"",priority:"normale",status:"new",scope:"",estimate:null,quote:"",createdAt:Date.now(),closedAt:null});
    x.requestId=id;save();render();
    toast("Demande client créée à partir du point ouvert",()=>{openRequest(state.requests.find(r=>r.id===id))},"Ouvrir la demande");
  }
  function deletePoint(x){
    if(editingPt===x.id)editingPt=null;
    ptUndoable("Point mis à la corbeille",x,()=>{x.deletedAt=Date.now()});
  }
  async function renameTheme(pid,old){
    const n=await uiPrompt("Nouveau nom du thème",old,{ok:"Renommer"});if(n===null)return;
    renameThemeTo(pid,old,n);
  }
  // Numéro affiché : celui de l'Excel pour les points liés ; numérotation interne sinon (vide pour un point hors Excel d'un projet lié)
  const ptLinkedProj=pid=>(state.points||[]).some(x=>x.projectId===pid&&!x.deletedAt&&x.xl&&x.xl.n);
  function ptLabel(x,n){if(x.xl&&x.xl.n)return String(x.xl.n);return ptLinkedProj(x.projectId)?"":String(n||ptNum(x))}
  function ptNum(x){const l=livePts().filter(y=>y.projectId===x.projectId).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));return l.findIndex(y=>y.id===x.id)+1}
  function ptRow(x,num,showProj){
    const li=document.createElement("li");
    li.className=`task pt${x.status==="closed"?" done":""}${editingPt===x.id?" open":""}${x.ansNew?" ansnew":""}`;li.dataset.o=x.id;
    const tags=[];
    const ow=ownerTxt(x);
    const pp=proj(x.projectId);
    if(showProj&&pp)tags.push(`<span class="tag"><span class="dot" style="background:${pp.color}"></span>${esc(pp.name)}</span>`);
    if(showProj&&x.theme)tags.push(`<span class="tag fam">${hl(x.theme)}</span>`);
    if(x.ansNew)tags.unshift(`<button type="button" class="tag ansnew" data-a="seen" title="Réponse reçue par l'Excel le ${esc(fmtWhen(x.ansNew))}. Cliquer pour la marquer comme lue.">Nouvelle réponse client<span aria-hidden="true">✓</span></button>`);
    if(ow)tags.push(`<span class="tag who" title="Qui doit répondre">${hl(ow)}</span>`);
    if(!(x.xl&&x.xl.n)&&ptLinkedProj(x.projectId))tags.push(`<span class="tag" title="Point créé dans l'appli, absent du fichier Excel">Hors Excel</span>`);
    if(x.erp==="oui")tags.push(`<span class="tag erp" title="Sujet ERP">Sujet ERP</span>`);
    if(x.erp==="non")tags.push(`<span class="tag" title="Sujet ERP">Hors ERP</span>`);
    const t=x.taskId?live().find(y=>y.id===x.taskId):null, r=x.requestId?liveReq().find(y=>y.id===x.requestId):null;
    if(t)tags.push(`<button type="button" class="tag reqtag" data-l="t" title="Ouvrir la tâche liée">Tâche${t.status==="done"?" terminée":""} : ${esc(short(t.title))}</button>`);
    if(r)tags.push(`<button type="button" class="tag reqtag" data-l="r" title="Ouvrir la demande liée">Demande : ${esc(short(r.title))}</button>`);
    if(x.status==="closed"&&x.closedAt)tags.push(`<span class="tag">Levé le ${fmtWhen(x.closedAt).split(" à ")[0]}</span>`);
    li.innerHTML=`<input type="checkbox" class="chk" ${x.status==="closed"?"checked":""} aria-label="Point levé">
      <div><div class="ttl ptxt"><span class="pnum">${num?esc(num)+".":"•"}</span> ${hl(x.text)}</div>${tags.length?`<div class="meta">${tags.join("")}</div>`:""}
      ${x.hypothesis&&editingPt!==x.id?`<div class="phyp"><b>Hypothèse Mecalux :</b> ${hl(x.hypothesis)}</div>`:""}
      ${x.answer&&editingPt!==x.id?`<div class="pans"><b>Réponse :</b> ${hl(x.answer)}</div>`:""}</div>
      <div class="acts"><details class="more"><summary aria-label="Plus d'actions">${ICON_MORE}</summary>
        <div class="menu"><button type="button" data-a="edit">${editingPt===x.id?"Fermer le détail":"Modifier / répondre"}</button>${t?"":`<button type="button" data-a="task">Créer une tâche liée</button>`}${r?"":`<button type="button" data-a="req">Créer une demande client</button>`}<button type="button" data-a="del" class="danger">Mettre à la corbeille</button></div>
      </details></div>`;
    li.querySelector(".chk").onchange=e=>closePoint(x,e.target.checked);
    li.querySelector(".ttl").onclick=()=>{editingPt=editingPt===x.id?null:x.id;if(editingPt&&x.ansNew)ansSeen([x]);else render()};
    const lt=li.querySelector("[data-l=t]");if(lt)lt.onclick=()=>{editing=t.id;openInList(t)};
    const lr=li.querySelector("[data-l=r]");if(lr)lr.onclick=()=>openRequest(r);
    li.querySelectorAll("[data-a]").forEach(b=>b.onclick=()=>{
      const a=b.dataset.a;
      if(a==="edit"){editingPt=editingPt===x.id?null:x.id;if(editingPt&&x.ansNew)ansSeen([x]);else render()}
      if(a==="seen")ansSeen([x]);
      if(a==="task")pointToTask(x);
      if(a==="req")pointToRequest(x);
      if(a==="del")deletePoint(x);
    });
    if(editingPt===x.id){
      const f=document.createElement("div");f.className="edit";
      f.innerHTML=`<label class="full flbl">Point ouvert<textarea data-rt data-f="text" aria-label="Point ouvert">${escRaw(x.text)}</textarea></label>
        <label class="flbl">Thème<span class="famsel"><select data-f="theme">${themeOptions(x.projectId,x.theme||"","Sans thème")}</select><button type="button" class="btn ghost" data-th="ren">Renommer</button><button type="button" class="btn ghost" data-th="del">Supprimer</button></span></label>
        <label class="flbl">Qui doit répondre<select data-f="owner">${Object.entries(OWNER).map(([k,l])=>`<option value="${k}" ${k===(x.owner||"")?"selected":""}>${l}</option>`).join("")}</select></label>
        <label class="flbl">Interlocuteur<input type="text" data-f="oname" value="${esc(x.ownerName||"")}" maxlength="120" placeholder="Nom de la personne"></label>
        <label class="flbl">Statut<select data-f="st"><option value="open" ${x.status!=="closed"?"selected":""}>Ouvert</option><option value="closed" ${x.status==="closed"?"selected":""}>Levé</option></select></label>
        <label class="flbl">Sujet ERP ?<select data-f="erp"><option value="" ${!x.erp?"selected":""}>Non précisé</option><option value="oui" ${x.erp==="oui"?"selected":""}>Oui</option><option value="non" ${x.erp==="non"?"selected":""}>Non</option></select></label>
        <label class="full flbl">Hypothèse Mecalux<textarea data-rt data-f="hyp" aria-label="Hypothèse Mecalux" placeholder="Proposition ou hypothèse de Mecalux à faire valider…">${escRaw(x.hypothesis||"")}</textarea></label>
        <label class="full flbl">Réponse / décision<textarea data-rt data-f="ans" aria-label="Réponse / décision" placeholder="Réponse obtenue, décision prise, compte rendu d'atelier…">${escRaw(x.answer||"")}</textarea></label>
        <div class="full"><button class="btn primary" type="button" data-k="ok">Enregistrer</button> <button class="btn ghost" type="button" data-k="ko">Annuler</button></div>`;
      const g=k=>f.querySelector(`[data-f=${k}]`);
      const ths=g("theme"), thR=f.querySelector("[data-th=ren]"), thD=f.querySelector("[data-th=del]");
      const syncTh=()=>{thR.hidden=thD.hidden=!ths.value||ths.value==="__new"};syncTh();
      bindThemeSelect(ths,x.projectId,"Sans thème",syncTh);
      thR.onclick=async()=>{const old=ths.value;if(!old)return;const n=await uiPrompt("Nouveau nom du thème",old,{ok:"Renommer"});if(n===null)return;const keep={text:g("text").value,ans:g("ans").value,hyp:g("hyp").value};if(await renameThemeTo(x.projectId,old,n)){const el=document.querySelector(`.pt[data-o="${x.id}"] .edit`);if(el){el.querySelector("[data-f=text]").value=keep.text;el.querySelector("[data-f=ans]").value=keep.ans;el.querySelector("[data-f=hyp]").value=keep.hyp}}};
      thD.onclick=async()=>{const old=ths.value;if(!old)return;const keep={text:g("text").value,ans:g("ans").value,hyp:g("hyp").value};if(await deleteTheme(x.projectId,old)){const el=document.querySelector(`.pt[data-o="${x.id}"] .edit`);if(el){el.querySelector("[data-f=text]").value=keep.text;el.querySelector("[data-f=ans]").value=keep.ans;el.querySelector("[data-f=hyp]").value=keep.hyp}}};
      f.querySelector("[data-k=ok]").onclick=()=>{
        const cur=state.points.find(y=>y.id===x.id);
        if(!cur){editingPt=null;render();uiAlert("Ce point a été supprimé entre-temps (peut-être par un collègue).");return}
        if(g("text").value.trim())cur.text=g("text").value.trim();
        cur.theme=g("theme").value==="__new"?cur.theme:g("theme").value;cur.owner=g("owner").value;cur.ownerName=g("oname").value.trim();cur.answer=g("ans").value.trim();cur.hypothesis=g("hyp").value.trim();cur.erp=g("erp").value;
        const st=g("st").value;if(st!==cur.status){cur.status=st;cur.closedAt=st==="closed"?Date.now():null}
        editingPt=null;save();render();
      };
      f.querySelector("[data-k=ko]").onclick=()=>{editingPt=null;render()};
      drawerize(f,`${num?"N° "+esc(num)+" · ":""}${esc(x.theme||"Sans thème")}${x.erp==="oui"?" · Sujet ERP":""}`,x.text.split("\n")[0],()=>{editingPt=null;render()});
      li.appendChild(f);
      setTimeout(()=>g("text").focus(),0);
    }
    if(selMode==="o")selDecorate(li,x.id);
    return li;
  }
  function renderPoints(L,p){
    const all=livePts().filter(x=>x.projectId===p.id).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    const num=new Map(all.map((x,i)=>[x.id,i+1]));
    const themes=ptThemes(p.id);
    const add=document.createElement("form");add.className="quick";add.id="ptadd";add.autocomplete="off";
    add.innerHTML=`<label class="qmain"><span class="qkind qk-pt">Point ouvert</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="color:var(--muted)"><path d="M12 5v14M5 12h14"></path></svg><input type="text" data-q="text" placeholder="Nouvelle question à trancher… (vous pouvez coller une liste)" aria-label="Point ouvert" maxlength="2000"></label>
      <select data-q="theme" aria-label="Thème" class="qtheme">${themeOptions(p.id,ui.lastTheme&&themes.includes(ui.lastTheme)?ui.lastTheme:"","Thème : aucun")}</select>
      <select data-q="owner" aria-label="Qui doit répondre"><option value="">Qui doit répondre ?</option><option value="client">Client</option><option value="mecalux">Mecalux</option><option value="tiers">Tiers</option></select>
      <button class="qadd" type="submit">Ajouter</button>`;
    const q=k=>add.querySelector(`[data-q=${k}]`);
    bindThemeSelect(q("theme"),p.id,"Thème : aucun",created=>{ui.lastTheme=q("theme").value;saveUi();
      if(created){const txt=q("text").value, ow=q("owner").value;render();const na=$("#ptadd");if(na){na.querySelector("[data-q=text]").value=txt;na.querySelector("[data-q=owner]").value=ow;na.querySelector("[data-q=text]").focus()}}});
    const submit=texts=>{if(!texts.length)return;const th=q("theme").value==="__new"?"":q("theme").value;ui.lastTheme=th;saveUi();addPoints(texts,p.id,th,q("owner").value);const ni=document.querySelector("#ptadd [data-q=text]");if(ni)ni.focus()};
    add.onsubmit=e=>{e.preventDefault();const v=q("text").value.trim();if(v)submit([v])};
    q("text").addEventListener("paste",async e=>{
      const txt=(e.clipboardData||window.clipboardData).getData("text");
      if(!/\n/.test(txt.trim()))return;
      const lines=splitPasted(txt);
      if(lines.length<2)return;
      e.preventDefault();
      if(await uiConfirm(`Ajouter ${lines.length} points ouverts ?\n\n${lines.slice(0,8).map(l=>"• "+l).join("\n")}${lines.length>8?`\n• … et ${lines.length-8} autre(s)`:""}`,{ok:"Ajouter"}))submit(lines);
    });
    $("#addslot").appendChild(add);
    if(!all.length){L.insertAdjacentHTML("beforeend",`<div class="empty">Aucun point ouvert sur ce projet. Saisissez une question dans la barre ci-dessus, ou collez directement une liste (une ligne par point, les puces sont retirées automatiquement).</div>`);return}
    // filtres : thèmes (plusieurs possibles) et sujets ERP
    ui.ptFilter=ui.ptFilter&&typeof ui.ptFilter==="object"?ui.ptFilter:{};
    const fl=ui.ptFilter[p.id]||{themes:[],erp:false};
    const known=new Set([...all.map(x=>x.theme||""),...themes]);
    fl.themes=(fl.themes||[]).filter(k=>known.has(k));
    const setF=f=>{ui.ptFilter[p.id]=f;saveUi();render()};
    const allOpen=all.filter(x=>x.status!=="closed");
    const cnt=k=>allOpen.filter(x=>(x.theme||"")===k&&(!fl.erp||x.erp==="oui")).length;
    const keys=[...known].sort((a,b)=>a===""?1:b===""?-1:a.localeCompare(b,"fr",{sensitivity:"base"}));
    const bar=document.createElement("div");bar.className="chips";bar.setAttribute("role","group");bar.setAttribute("aria-label","Filtrer les points ouverts");
    bar.innerHTML=`<span class="chipslbl">Filtrer :</span><button type="button" class="chip" data-all aria-pressed="${!fl.themes.length}">Tous les thèmes</button>${keys.map(k=>`<button type="button" class="chip" data-t="${esc(k)}" aria-pressed="${fl.themes.includes(k)}">${k?esc(k):"Sans thème"}<span>${cnt(k)}</span></button>`).join("")}<span class="chipsep" aria-hidden="true"></span><button type="button" class="chip chip-erp" data-erp aria-pressed="${!!fl.erp}">Sujets ERP uniquement</button>${fl.themes.length||fl.erp?`<button type="button" class="pflink" data-reset>Effacer les filtres</button>`:""}`;
    bar.querySelector("[data-all]").onclick=()=>setF({...fl,themes:[]});
    bar.querySelectorAll("[data-t]").forEach(b=>b.onclick=e=>{const k=b.dataset.t;let t=fl.themes.slice();
      t=t.includes(k)?t.filter(x=>x!==k):[...t,k];
      setF({...fl,themes:t})});
    bar.querySelector("[data-erp]").onclick=()=>setF({...fl,erp:!fl.erp});
    const rs=bar.querySelector("[data-reset]");if(rs)rs.onclick=()=>setF({themes:[],erp:false});
    if(keys.length>1||fl.erp||all.some(x=>x.erp))L.appendChild(bar);
    // nouvelles réponses du client reçues par l'Excel : bandeau, filtre, tout marquer comme lu
    const fresh=all.filter(x=>x.ansNew);
    if(fl.ans&&!fresh.length)fl.ans=false;
    if(fresh.length){
      const ab=document.createElement("div");ab.className="ansbar";ab.setAttribute("role","status");
      const ask=notifOk()&&Notification.permission!=="granted"&&ptLinkedProj(p.id);
      ab.innerHTML=`<span class="ansdot" aria-hidden="true"></span><span class="anst"><b>${ansTxt(fresh.length)}</b> dans l'Excel${fresh.length>1?"":` : ${esc(short(fresh[0].text))}`}</span><span class="ansb">${fl.ans?`<button type="button" class="btn ghost" data-ansall>Afficher tous les points</button>`:`<button type="button" class="btn" data-ansonly>Afficher ${fresh.length>1?"ces réponses":"la réponse"}</button>`}<button type="button" class="btn ghost" data-ansread>Tout marquer comme lu</button>${ask?`<button type="button" class="btn ghost" data-ansnotif title="Alerte Windows quand l'appli est en arrière-plan">Activer les alertes Windows</button>`:""}</span>`;
      const ao=ab.querySelector("[data-ansonly]");if(ao)ao.onclick=()=>setF({...fl,ans:true});
      const aa=ab.querySelector("[data-ansall]");if(aa)aa.onclick=()=>setF({...fl,ans:false});
      ab.querySelector("[data-ansread]").onclick=()=>{fl.ans=false;ui.ptFilter[p.id]=fl;saveUi();ansSeen(fresh)};
      const an=ab.querySelector("[data-ansnotif]");if(an)an.onclick=ansNotifAsk;
      L.appendChild(ab);
    }
    const pass=x=>(!fl.themes.length||fl.themes.includes(x.theme||""))&&(!fl.erp||x.erp==="oui")&&(!fl.ans||x.ansNew);
    const filtered=all.filter(pass);
    const open=filtered.filter(x=>x.status!=="closed"), closed=filtered.filter(x=>x.status==="closed").sort((a,b)=>(b.closedAt||0)-(a.closedAt||0));
    if(fl.themes.length||fl.erp||fl.ans)L.insertAdjacentHTML("beforeend",`<p class="hint">${fl.ans?"Nouvelles réponses du client uniquement · ":""}${open.length} point${open.length>1?"s":""} ouvert${open.length>1?"s":""} affiché${open.length>1?"s":""} sur ${allOpen.length}${fl.themes.length?` · thème${fl.themes.length>1?"s":""} : ${fl.themes.map(k=>esc(k||"Sans thème")).join(", ")}`:""}${fl.erp?" · sujets ERP":""}</p>`);
    if(!open.length)L.insertAdjacentHTML("beforeend",`<div class="empty">${fl.themes.length||fl.erp?"Aucun point ouvert ne correspond aux filtres.":"Tous les points sont levés."}</div>`);
    const groups=new Map();open.forEach(x=>{const k=x.theme||"";if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x)});
    // thèmes repliables (mémorisés par projet) et vue tableau compacte
    ui.ptFold=ui.ptFold&&typeof ui.ptFold==="object"?ui.ptFold:{};
    const fold=new Set(ui.ptFold[p.id]||[]);
    const setFold=f=>{ui.ptFold[p.id]=[...f];saveUi();render()};
    const tableView=ui.ptView==="table"&&!selMode;
    const sorted=[...groups.keys()].sort((a,b)=>a===""?1:b===""?-1:a.localeCompare(b,"fr",{sensitivity:"base"}));
    if(sorted.length>1){
      const fb=document.createElement("div");fb.className="foldbar";
      fb.innerHTML=`<button type="button" class="pflink" data-f="close">Tout replier</button><button type="button" class="pflink" data-f="open">Tout déplier</button>`;
      fb.querySelector("[data-f=close]").onclick=()=>setFold(new Set([...fold,...sorted]));
      fb.querySelector("[data-f=open]").onclick=()=>setFold(new Set([...fold].filter(k=>!sorted.includes(k))));
      L.appendChild(fb);
    }
    const items=(host,list)=>{
      if(tableView){
        const w=document.createElement("div");w.className="tscroll";
        w.innerHTML=`<table class="dtable pttable"><thead><tr><th class="num">N°</th><th>Point ouvert</th><th>Qui doit répondre</th><th>ERP</th><th>Commentaire Mecalux</th><th>Réponse client</th><th>Statut</th></tr></thead><tbody>${list.map(x=>{const n=ptLabel(x,num.get(x.id));return `<tr data-o="${esc(x.id)}" tabindex="0" title="Ouvrir le détail"><td class="num">${esc(n)}</td><td class="ptc"><div class="clamp">${hl(x.text)}</div></td><td>${esc(ownerTxt(x))}</td><td>${x.erp==="oui"?"Oui":x.erp==="non"?"Non":""}</td><td class="ptc"><div class="clamp">${hl(x.hypothesis||"")}</div></td><td class="ptc"><div class="clamp">${hl(x.answer||"")}</div></td><td>${x.status==="closed"?"Levé":"Ouvert"}</td></tr>`}).join("")}</tbody></table>`;
        w.querySelectorAll("tr[data-o]").forEach(tr=>{const go=()=>{ui.ptView="list";saveUi();editingPt=tr.dataset.o;render();const el=document.querySelector(`.pt[data-o="${tr.dataset.o}"]`);if(el)el.scrollIntoView({block:"center"})};tr.onclick=go;tr.onkeydown=e=>{if(e.key==="Enter")go()}});
        host.appendChild(w);
      } else {
        const ul=document.createElement("ul");ul.className="tasks";list.forEach(x=>ul.appendChild(ptRow(x,ptLabel(x,num.get(x.id)))));host.appendChild(ul);
      }
    };
    sorted.forEach(k=>{
      const list=groups.get(k), folded=fold.has(k)&&!list.some(x=>x.id===editingPt);
      const g=document.createElement("section");g.className="group g-pt"+(folded?" folded":"");
      g.innerHTML=`<h2><button type="button" class="foldbtn" aria-expanded="${!folded}" title="${folded?"Déplier":"Replier"} ce thème">${ICON_CHEV}<span class="ft">${k?esc(k):"Sans thème"}</span> <span>${list.length}</span></button>${k&&!folded?`<button type="button" class="pflink thren">Renommer</button>`:""}</h2>`;
      g.querySelector(".foldbtn").onclick=()=>{const f=new Set(fold);if(f.has(k))f.delete(k);else f.add(k);setFold(f)};
      const rb=g.querySelector(".thren");if(rb)rb.onclick=()=>renameTheme(p.id,k);
      if(!folded)items(g,list);
      L.appendChild(g);
    });
    if(closed.length){
      const btn=document.createElement("button");btn.type="button";btn.className="showdone";btn.setAttribute("aria-expanded",!!ui.showClosedPts);
      btn.innerHTML=`${ICON_CHEV}${ui.showClosedPts?"Masquer":"Afficher"} ${closed.length>1?`les ${closed.length} points levés`:"le point levé"}`;
      btn.onclick=()=>{ui.showClosedPts=!ui.showClosedPts;saveUi();render()};
      L.appendChild(btn);
      if(ui.showClosedPts){const g=document.createElement("section");g.className="group g-pt";g.innerHTML=`<h2>Points levés <span>${closed.length}</span></h2>`;items(g,closed);L.appendChild(g)}
    }
  }
  // Export des points ouverts (Excel / PDF) à transmettre au client
  function pointSets(ps,o){
    return ps.map(p=>{
      const all=livePts().filter(x=>x.projectId===p.id).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
      const num=new Map(all.map((x,i)=>[x.id,i+1]));
      const rows=all.filter(x=>x.status!=="closed"||o.closed).sort((a,b)=>((a.theme||"￿").localeCompare(b.theme||"￿","fr",{sensitivity:"base"}))||((a.status==="closed")-(b.status==="closed"))||(num.get(a.id)-num.get(b.id)));
      return {p,rows:rows.map(x=>({x,n:ptLabel(x,num.get(x.id)),theme:x.theme||"Sans thème",owner:ownerTxt(x),st:x.status==="closed"?"Levé":"Ouvert"}))};
    });
  }
  const ptBase=ps=>`points-ouverts-${ps.length>1?"projets":slug(ps[0].name)}-${iso(today())}`;
  const ptTitle=ps=>`Points ouverts – ${ps.length>1?ps.map(p=>p.name).join(", "):ps[0].name}`;
  function exportPointsXlsx(ps,o){
    const sets=pointSets(ps,o), multi=ps.length>1;
    const cols=[multi&&["Projet",22],["N°",6],["Date d'ouverture",13],["Thème",20],["Point ouvert",60],["Hypothèse Mecalux",45],o.ans&&["Réponse / décision",45],["Statut",10],o.owner&&["Qui doit répondre",22],["Sujet ERP ?",10]].filter(Boolean);
    const rows=[[{v:ptTitle(ps),s:1}],[{v:`Situation au ${new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}`,s:2}],[],cols.map(c=>({v:c[0],s:3}))];
    sets.forEach(st=>st.rows.forEach(r=>{
      const v={"Projet":st.p.name,"N°":r.n===""?"":(isFinite(+r.n)?+r.n:r.n),"Date d'ouverture":r.x.createdAt?new Date(r.x.createdAt):"","Thème":r.theme,"Point ouvert":rtText(r.x.text),"Hypothèse Mecalux":rtText(r.x.hypothesis||""),"Qui doit répondre":r.owner,"Statut":r.st,"Réponse / décision":rtText(r.x.answer||""),"Sujet ERP ?":r.x.erp==="oui"?"OUI":r.x.erp==="non"?"NON":""};
      rows.push(cols.map(c=>({v:v[c[0]],s:c[0]==="Statut"?(r.st==="Levé"?9:6):c[0]==="Date d'ouverture"?5:4})));
    }));
    const blob=buildXlsx("Points ouverts",rows,cols.map(c=>c[1]),4);
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=ptBase(ps)+".xlsx";
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }
  function exportPointsPdf(ps,o){
    const sets=pointSets(ps,o);
    const dateL=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});
    const total=sets.reduce((n,s)=>n+s.rows.filter(r=>r.st==="Ouvert").length,0);
    const body=sets.map(s=>{
      const nOpen=s.rows.filter(r=>r.st==="Ouvert").length, nClosed=s.rows.length-nOpen;
      const byTheme=new Map();s.rows.forEach(r=>{if(!byTheme.has(r.theme))byTheme.set(r.theme,[]);byTheme.get(r.theme).push(r)});
      const tables=[...byTheme].map(([th,rs])=>`<h3>${esc(th)}</h3><table><thead><tr><th class="n">N°</th><th class="pc">Point ouvert</th>${o.owner?"<th class=\"ow\">Qui doit répondre</th>":""}<th class="st">Statut</th>${o.ans?"<th>Réponse / décision</th>":""}</tr></thead><tbody>${rs.map(r=>`<tr><td class="n">${esc(r.n)}</td><td class="pre rt">${rtHtml(r.x.text)}${r.x.hypothesis?`<div class="hyp"><b>Hypothèse Mecalux :</b> ${rtHtml(r.x.hypothesis)}</div>`:""}${r.x.erp==="oui"?`<div class="erp">Sujet ERP</div>`:""}</td>${o.owner?`<td>${esc(r.owner)}</td>`:""}<td class="st ${r.st==="Levé"?"done":"open"}">${r.st}</td>${o.ans?`<td class="pre rt">${rtHtml(r.x.answer||"")}</td>`:""}</tr>`).join("")}</tbody></table>`).join("");
      return `<section><h2 style="border-color:${s.p.color}">${pLogo(s.p)?`<img class="lg" src="${s.p.logo}" alt="">`:""}${esc(s.p.name)}</h2><p class="sub">${nOpen} point${nOpen>1?"s":""} ouvert${nOpen>1?"s":""}${nClosed?` · ${nClosed} levé${nClosed>1?"s":""}`:""}</p>${s.rows.length?tables:`<p class="mut">Aucun point ouvert.</p>`}</section>`;
    }).join("");
    const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(ptBase(ps))}</title><style>
      @page{size:A4 portrait;margin:14mm}
      *{box-sizing:border-box}body{margin:0;font:10pt/1.45 "Segoe UI",Arial,sans-serif;color:#16232B}
      h1{font-size:19pt;margin:0}.lead{color:#51646F;margin:3px 0 16px}
      section{margin:0 0 20px}h2{font-size:13.5pt;margin:0;padding-bottom:3px;border-bottom:3px solid #2F4A5A}
      h3{font-size:11pt;margin:14px 0 6px;color:#2F4A5A}
      .sub{color:#51646F;margin:4px 0 4px;font-size:9.5pt}
      table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{page-break-inside:avoid}
      th{background:#EEF1F3;text-align:left;font-size:8.5pt;font-weight:600;text-transform:uppercase;letter-spacing:.03em;padding:5px 6px;border-bottom:1px solid #C9D3D9}
      td{word-wrap:break-word;padding:6px;border-bottom:1px solid #E3E8EB;vertical-align:top}
      .n{width:6%;color:#51646F;white-space:nowrap}.st{width:10%;font-weight:600;white-space:nowrap}.ow{width:17%}.pc{width:38%}
      .open{color:#B42318}.done{color:#2F7D5B}.pre{white-space:pre-wrap}.hyp{margin-top:4px;color:#1F4A66;font-size:9pt}.erp{display:inline-block;margin-top:4px;font-size:8pt;font-weight:600;color:#7A4B00;background:#FFF1C9;border-radius:3px;padding:0 4px}.mut{color:#7A8A94}
    </style></head><body><h1>${esc(ptTitle(ps))}</h1><p class="lead">Situation au ${dateL} · ${total} point${total>1?"s":""} ouvert${total>1?"s":""}</p>${body}</body></html>`;
    printHtml(html,ptBase(ps));
    return html;
  }
  function printHtml(html,base){
    html=String(html).replace("</head>",`<style>.rt p,.rtx p{margin:0}.rt p+p,.rtx p+p{margin-top:3px}.rt ul,.rt ol,.rtx ul,.rtx ol{margin:2px 0;padding-left:20px}.rt h3,.rtx h3{font-size:1.05em;margin:2px 0}mark{background:#FFE58A;padding:0 1px}.rc-r{color:#C93C3C}.rc-b{color:#2C6FB7}.rc-g{color:#2F8A5F}.rt a,.rtx a{color:#2C6FB7}td.rt{white-space:normal}</style></head>`);
    const ifr=document.createElement("iframe");ifr.setAttribute("aria-hidden","true");ifr.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(ifr);
    const prev=document.title;
    ifr.onload=()=>{
      document.title=base;
      const w=ifr.contentWindow;
      const done=()=>{document.title=prev;setTimeout(()=>ifr.remove(),1000)};
      w.addEventListener("afterprint",done);
      setTimeout(()=>{try{w.focus();w.print()}catch(e){uiAlert("Impression impossible dans ce navigateur.");done()}},50);
    };
    ifr.srcdoc=html;
  }
  // ---------- Lien Excel des points ouverts (mise à jour à sens unique : Excel vers appli) ----------
  // Disponible sur tous les projets : « Lien Excel » dans les points ouverts (explication et choix du fichier). L'Excel n'est jamais modifié.
  // Chaque point lié garde (xl) les dernières valeurs lues dans l'Excel : ensuite, un champ n'est repris que s'il a changé dans l'Excel.
  // Au premier rapprochement (ou après un changement des règles de lecture, XL_VER), les écarts entre appli et Excel sont soumis à l'utilisateur.
  const XL_VER=2;
  // un projet est lié quand un fichier Excel a été choisi sur ce poste (ou par l'ancienne activation « /excel »)
  const xlOn=pid=>!!((ui.xlFile&&ui.xlFile[pid])||(ui.xl&&ui.xl[pid]));
  async function xlUnlink(p){
    if(!await uiConfirm(`Délier le fichier Excel de « ${p.name} » ?\n\nLes points ouverts restent dans l'appli ; ils ne seront simplement plus mis à jour depuis l'Excel.`,{ok:"Délier"}))return;
    if(ui.xl)delete ui.xl[p.id];if(ui.xlFile)delete ui.xlFile[p.id];if(ui.xlPend)delete ui.xlPend[p.id];delete xlNeed[p.id];delete xlHandles[p.id];
    try{const db=await xlIdb();db.transaction("xl","readwrite").objectStore("xl").delete(p.id)}catch(e){}
    saveUi();render();toast(`Fichier Excel délié de « ${p.name} ».`);
  }
  // Fenêtre d'explication et de réglage, sur le modèle du lien vers l'agenda Outlook
  function xlCfg(p){
    const linked=xlOn(p.id), f=ui.xlFile&&ui.xlFile[p.id], last=ui.xlLast&&ui.xlLast[p.id]?new Date(ui.xlLast[p.id]):null, fs=xlFsOk();
    const d=document.createElement("dialog");d.className="xlcfg";d.setAttribute("aria-labelledby","xlcfgt");
    d.innerHTML=`<form method="dialog" class="rbox">
      <h2 id="xlcfgt" style="margin:0;font:700 26px/1.1 'Barlow Condensed','Arial Narrow',sans-serif">Synchroniser les points ouverts avec Excel</h2>
      ${linked?`<p class="xlstate"><b>Fichier lié${f?" : "+esc(f):""}</b>${last?`<span>Dernière mise à jour le ${last.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})} à ${last.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</span>`:""}<span>Relu automatiquement toutes les 10 minutes quand l'appli est ouverte sur cet ordinateur.</span></p>`:""}
      <ol class="calsteps">
        <li>Dans <b>SharePoint</b>, ouvrez le dossier qui contient le fichier des points ouverts et cliquez sur <b>Synchroniser</b> (ou <b>Ajouter un raccourci à Mes fichiers</b>). OneDrive copie le fichier sur votre ordinateur et le tient à jour.</li>
        <li>Vérifiez que le tableau a une colonne <b>Description</b> (ou « Point ouvert », « Question »). Les colonnes <b>N°</b>, <b>Thème / Sujet</b>, <b>Statut / État</b>, <b>Acteur</b>, <b>Hypothèse Mecalux</b>, <b>Retour client</b> et <b>ERP</b> sont reconnues par leur titre, dans n'importe quel ordre.</li>
        <li>Cliquez sur <b>${linked?"Changer de fichier":"Choisir le fichier Excel"}</b> puis ouvrez le fichier dans votre dossier OneDrive (par exemple « OneDrive - Mecalux »). Autorisez l'accès quand le navigateur le demande.</li>
      </ol>
      ${fs?"":`<p class="gerr">Ce navigateur ne permet pas de lier un fichier. Ouvrez l'appli dans Edge ou Chrome sur ordinateur, ou utilisez « Importer une fois » à chaque mise à jour.</p>`}
      <p class="hint">Mise à jour à sens unique, de l'Excel vers l'appli : le fichier n'est jamais modifié. Au premier rapprochement, les écarts entre l'appli et l'Excel vous sont soumis ; ensuite, seuls les changements faits dans l'Excel sont repris. Le lien est mémorisé sur cet ordinateur uniquement.</p>
      <div class="ractions">
        ${linked&&fs?`<button class="btn primary" type="button" data-a="sync">Synchroniser maintenant</button><button class="btn" type="button" data-a="link">Changer de fichier</button>`:fs?`<button class="btn primary" type="button" data-a="link">Choisir le fichier Excel</button>`:""}
        <button class="btn" type="button" data-a="pick">Importer une fois…</button>
        ${linked?`<button class="btn" type="button" data-a="unlink">Délier le fichier</button>`:""}
        <button class="btn ghost" type="button" data-a="x">Fermer</button>
      </div>
      ${(state.points||[]).some(x=>x.projectId===p.id)?`<button type="button" class="btn ghost danger xlpurge" data-a="purge">Supprimer tous les points ouverts du projet…</button>`:""}
    </form>`;
    document.body.appendChild(d);
    const close=()=>{try{d.close()}catch(e){}d.remove()};
    d.addEventListener("cancel",e=>{e.preventDefault();close()});
    d.querySelector("form").onsubmit=e=>e.preventDefault();
    d.querySelectorAll("[data-a]").forEach(b=>b.onclick=()=>{const a=b.dataset.a;close();
      if(a==="sync")xlQuick(p);else if(a==="link")xlLink(p);else if(a==="pick")xlPick(p);else if(a==="unlink")xlUnlink(p);else if(a==="purge")xlPurge(p)});
    if(d.showModal)d.showModal();else d.setAttribute("open","");
  }
  const XL_F=["text","theme","hypothesis","answer","status","owner","erp"];
  const XL_LBL={text:"description",theme:"thème",hypothesis:"commentaire Mecalux",answer:"commentaire client",status:"statut",owner:"acteur",erp:"sujet ERP"};
  const xlKey=s=>norm(rtText(String(s||""))).replace(/[^a-z0-9]+/g," ").trim();
  const xlWords=s=>new Set(xlKey(s).split(" ").filter(w=>w.length>2));
  const xlSim=(a,b)=>{const A=xlWords(a),B=xlWords(b);if(!A.size||!B.size)return 0;let n=0;A.forEach(w=>{if(B.has(w))n++});return n/(A.size+B.size-n)};
  const xlStr=v=>v==null?"":rtText(String(v)).replace(/\r\n?/g,"\n").replace(/[ \t]+\n/g,"\n").trim();
  const xlSame=(f,a,b)=>f==="text"?xlKey(a)===xlKey(b):rtText(String(a||""))===rtText(String(b||""));
  const xlShow=(f,v)=>f==="status"?(v==="closed"?"levé / clôturé":"ouvert"):f==="erp"?(v==="oui"?"OUI":v==="non"?"NON":"—"):f==="owner"?(OWNER[v]||"—"):(v?`« ${String(v).length>50?String(v).slice(0,47)+"…":v} »`:"vide");
  function xlParse(sheets){
    // colonnes reconnues par leur titre (l'ordre peut changer)
    const H=[["n",h=>/^(n|no|num|numero|n o|ref|id)$/.test(h)],["date",h=>/date/.test(h)],["text",h=>/description|point ouvert|question/.test(h)],
      ["erp",h=>/erp/.test(h)],["status",h=>/statut|etat/.test(h)],["owner",h=>/acteur|qui doit|responsable/.test(h)],
      ["hypothesis",h=>/hypothese|mecalux/.test(h)],["answer",[h=>/retour|reponse|decision|client|diamond/.test(h),h=>/commentaire/.test(h)]],["theme",h=>/sujet|theme|famille/.test(h)]];
    for(const sh of sheets){
      for(let hr=0;hr<Math.min(10,sh.rows.length);hr++){
        const hd=(sh.rows[hr]||[]).map(v=>xlKey(v)), col={}, used=new Set();
        H.forEach(([f,t])=>{for(const tt of [].concat(t)){const i=hd.findIndex((h,k)=>h&&!used.has(k)&&tt(h));if(i>=0){col[f]=i;used.add(i);break}}});
        if(col.text==null)continue;
        const rows=[];
        sh.rows.slice(hr+1).forEach((r,i)=>{
          const g=f=>col[f]==null?null:r[col[f]];
          const text=xlStr(g("text")).slice(0,2000);if(!text)return;
          const st=xlKey(g("status")), ow=xlKey(g("owner")), er=xlKey(g("erp")), d=g("date"), n=xlStr(g("n"));
          rows.push({line:hr+i+2,n,date:typeof d==="number"&&d>20000?Math.round((d-25569)*864e5+new Date().getTimezoneOffset()*6e4):null,
            v:{text,theme:xlStr(g("theme")).slice(0,80),hypothesis:xlStr(g("hypothesis")),answer:xlStr(g("answer")),
               status:!st?"":/clotur|leve|ferme|termine|resolu/.test(st)?"closed":"open",
               owner:!ow?"":/mecalux/.test(ow)?"mecalux":/tiers/.test(ow)?"tiers":"client",
               erp:/^(oui|yes|o|x)$/.test(er)?"oui":/^(non|no|n)$/.test(er)?"non":""}});
        });
        return {sheet:sh.name,rows,cols:Object.keys(col)};
      }
    }
    throw new Error("Aucune colonne « Description » trouvée dans le classeur.");
  }
  // Repartir de zéro avant un nouvel import : suppression définitive de tous les points du projet (corbeille comprise)
  async function xlPurge(p){
    const n=(state.points||[]).filter(x=>x.projectId===p.id).length;
    if(!n){toast("Aucun point ouvert sur ce projet.");return}
    if(!await uiConfirm(`Supprimer définitivement les ${n} points ouverts de « ${p.name} » (corbeille comprise) ?\n\nIls ne pourront pas être restaurés depuis l'appli. Vous pourrez ensuite les réimporter avec « Mettre à jour depuis Excel ».`,{ok:`Supprimer les ${n} points`,danger:true}))return;
    state.points=(state.points||[]).filter(x=>x.projectId!==p.id);
    if(editingPt)editingPt=null;
    save();render();toast(`${n} points ouverts supprimés.`);
  }
  // Fichier lié (Edge / Chrome sur ordinateur) : le navigateur garde l'accès au fichier choisi, ici la copie OneDrive synchronisée.
  // La poignée est conservée dans IndexedDB (par projet, sur ce poste) ; elle ne quitte jamais le navigateur.
  const xlFsOk=()=>typeof window.showOpenFilePicker==="function";
  const xlHandles={};
  function xlIdb(){return new Promise((res,rej)=>{const r=indexedDB.open("todo-projets-fichiers",1);r.onupgradeneeded=()=>r.result.createObjectStore("xl");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
  async function xlHandleGet(pid){
    if(xlHandles[pid])return xlHandles[pid];
    try{const db=await xlIdb();return await new Promise(res=>{const q=db.transaction("xl").objectStore("xl").get(pid);q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null)})}catch(e){return null}
  }
  async function xlHandleSet(pid,h){
    xlHandles[pid]=h;
    try{const db=await xlIdb();await new Promise(res=>{const t=db.transaction("xl","readwrite");t.objectStore("xl").put(h,pid);t.oncomplete=res;t.onerror=res;t.onabort=res})}catch(e){}
  }
  async function xlLink(p){
    if(!xlFsOk()){xlPick(p);return}
    let h;
    try{[h]=await window.showOpenFilePicker({id:"xl-points",multiple:false,types:[{description:"Classeur Excel",accept:{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":[".xlsx"]}}]})}
    catch(e){return}
    await xlHandleSet(p.id,h);
    ui.xlFile=ui.xlFile||{};ui.xlFile[p.id]=h.name;saveUi();
    await xlRead(p,h);
  }
  async function xlRead(p,h){
    try{
      if(h.queryPermission&&await h.queryPermission({mode:"read"})!=="granted"&&await h.requestPermission({mode:"read"})!=="granted"){uiAlert("Accès au fichier Excel refusé. Cliquez sur « Autoriser » quand le navigateur le demande.");return}
      const f=await h.getFile();delete xlNeed[p.id];
      if(await xlSync(p,f)==="ok"){ui.xlMod=ui.xlMod||{};ui.xlMod[p.id]=f.lastModified;saveUi()}
      render();
    }catch(e){
      if(e&&e.name&&!/NotFound|NotReadable|InvalidState/.test(e.name)){uiAlert("Lecture du fichier Excel impossible : "+(e.message||e.name));return}
      if(await uiConfirm(`Le fichier « ${h.name} » est introuvable (déplacé, renommé ou pas encore synchronisé par OneDrive).\n\nChoisir à nouveau le fichier Excel lié ?`,{ok:"Choisir le fichier"}))xlLink(p);
    }
  }
  // Un clic : relit le fichier lié ; la première fois, on le choisit
  async function xlQuick(p){
    if(!xlFsOk()){xlPick(p);return}
    const h=await xlHandleGet(p.id);
    if(!h){xlLink(p);return}
    await xlRead(p,h);
  }
  function xlPick(p){
    const inp=document.createElement("input");inp.type="file";inp.accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    inp.onchange=()=>{if(inp.files[0])xlSync(p,inp.files[0])};inp.click();
  }
  async function xlSync(p,file){
    let parsed;
    try{parsed=xlParse(await window.XlsxLite.readXlsx(await file.arrayBuffer()))}
    catch(e){uiAlert("Lecture impossible : "+(e&&e.message||"fichier Excel illisible.")+"\n\nVérifiez qu'il s'agit bien d'un fichier .xlsx (pas .xls ni .xlsm protégé).");return}
    const plan=xlPlan(p.id,parsed.rows);
    const tag=r=>r&&r.n?`N° ${r.n} – `:"";
    // 1. écarts entre l'appli et l'Excel sur des points pas encore rapprochés : l'utilisateur choisit
    let prefer="xl";
    if(plan.conflicts.length){
      const nP=new Set(plan.conflicts.map(c=>c.pt)).size;
      const ex=plan.conflicts.slice(0,8).map(c=>`• ${tag(c.row)}${short(c.pt.text)}\n   ${XL_LBL[c.f]} : appli ${xlShow(c.f,c.pt[c.f])} / Excel ${xlShow(c.f,c.row.v[c.f])}`);
      const ch=await uiDialog({title:"Écarts entre l'appli et l'Excel",msg:[`${plan.conflicts.length} valeur${plan.conflicts.length>1?"s":""} diffère${plan.conflicts.length>1?"nt":""} sur ${nP} point${nP>1?"s":""} :`,"",...ex,...(plan.conflicts.length>8?[`• … et ${plan.conflicts.length-8} autre(s)`]:[]),"","Ce choix ne vaut que pour ces écarts. Ensuite, seuls les changements faits dans l'Excel seront repris."].join("\n"),
        buttons:[{v:null,label:"Annuler",cls:"ghost"},{v:"app",label:"Garder les valeurs de l'appli"},{v:"xl",label:"Prendre les valeurs de l'Excel",cls:"primary",focus:true}]});
      if(ch==null)return;prefer=ch;
    }
    const nUp=plan.updates.length, nF=plan.updates.reduce((n,u)=>n+u.fields.length,0)+(prefer==="xl"?plan.conflicts.length:0);
    const nUpAll=new Set([...plan.updates.map(u=>u.pt),...(prefer==="xl"?plan.conflicts.map(c=>c.pt):[])]).size;
    const nothing=!nUpAll&&!plan.added.length&&!plan.gone.length&&!plan.links.length;
    if(nothing){if(plan.silent.length){plan.silent.forEach(f=>f());save()}toast(`Points ouverts déjà à jour avec l'Excel (${parsed.rows.length} lignes lues).`);ui.xlLast=ui.xlLast||{};ui.xlLast[p.id]=Date.now();if(ui.xlPend)delete ui.xlPend[p.id];saveUi();render();return "ok"}
    const lines=[`Fichier : ${file.name} (onglet « ${parsed.sheet} », ${parsed.rows.length} lignes)`,""];
    if(nUpAll)lines.push(`• ${nUpAll} point${nUpAll>1?"s":""} mis à jour (${nF} champ${nF>1?"s":""})${nUp?" :":""}`,...plan.updates.slice(0,6).map(u=>`   – ${tag(u.row)}${short(u.pt.text)} : ${u.fields.map(f=>XL_LBL[f]).join(", ")}`),...(nUp>6?[`   – … et ${nUp-6} autre(s)`]:[]));
    if(plan.added.length)lines.push(`• ${plan.added.length} nouveau${plan.added.length>1?"x":""} point${plan.added.length>1?"s":""} :`,...plan.added.slice(0,6).map(r=>`   – ${tag(r)}${short(r.v.text)}`),...(plan.added.length>6?[`   – … et ${plan.added.length-6} autre(s)`]:[]));
    if(plan.links.length)lines.push(`• ${plan.links.length} point${plan.links.length>1?"s":""} rapproché${plan.links.length>1?"s":""} de l'Excel`);
    if(plan.gone.length)lines.push(`• ${plan.gone.length} point${plan.gone.length>1?"s":""} n'existe${plan.gone.length>1?"nt":""} plus dans l'Excel :`,...plan.gone.slice(0,5).map(x=>`   – ${x.xl&&x.xl.n?`N° ${x.xl.n} – `:""}${short(x.text)}`),...(plan.gone.length>5?[`   – … et ${plan.gone.length-5} autre(s)`]:[]));
    if(plan.dupes)lines.push("",`Attention : ${plan.dupes} ligne${plan.dupes>1?"s":""} en double dans l'Excel (même N° ou même description) ignorée${plan.dupes>1?"s":""}.`);
    const miss=["hypothesis","answer","status"].filter(f=>!parsed.cols.includes(f));
    if(miss.length)lines.push("",`Colonne${miss.length>1?"s":""} non trouvée${miss.length>1?"s":""} dans l'Excel : ${miss.map(f=>XL_LBL[f]).join(", ")}.`);
    lines.push("","L'Excel n'est pas modifié.");
    const btns=plan.gone.length?[{v:null,label:"Annuler",cls:"ghost"},{v:"keep",label:"Appliquer, garder les points retirés"},{v:"trash",label:"Appliquer, retirés à la corbeille",cls:"primary",focus:true}]
      :[{v:null,label:"Annuler",cls:"ghost"},{v:"keep",label:"Appliquer",cls:"primary",focus:true}];
    const ch=await uiDialog({title:"Mise à jour depuis Excel",msg:lines.join("\n"),buttons:btns});
    if(ch==null)return;
    const undo=xlApply(p,plan,prefer,ch);
    if(ui.xlPend)delete ui.xlPend[p.id];saveUi();
    const nAdd=plan.added.length;
    toast(`Mise à jour Excel appliquée : ${nUpAll} modifié${nUpAll>1?"s":""}, ${nAdd} ajouté${nAdd>1?"s":""}${plan.gone.length?`, ${plan.gone.length} retiré${plan.gone.length>1?"s":""}${ch==="trash"?" (corbeille)":" (conservé"+(plan.gone.length>1?"s":"")+")"}`:""}`,undo);
    if(undo.fresh.length)setTimeout(()=>ansAlert(p,undo.fresh),1200);
    return "ok";
  }
  // Applique un plan (gone : "trash", "keep" ou null pour ne pas toucher aux points retirés de l'Excel) ; renvoie l'annulation
  function xlApply(p,plan,prefer,gone){
    const before=JSON.parse(JSON.stringify((state.points||[]).filter(x=>x.projectId===p.id)));
    const now=Date.now();
    const fresh=[];
    const setF=(x,f,v)=>{if(f==="status"){v=v||"open";x.closedAt=v==="closed"?(x.closedAt||now):null}
      // réponse du client nouvelle ou modifiée dans l'Excel : signalée jusqu'à ce qu'elle soit lue
      if(f==="answer"&&xlStr(v)&&xlStr(v)!==xlStr(x.answer)){x.ansNew=now;fresh.push(x)}
      x[f]=v};
    plan.updates.forEach(u=>u.fields.forEach(f=>setF(u.pt,f,u.row.v[f])));
    if(prefer==="xl")plan.conflicts.forEach(c=>setF(c.pt,c.f,c.row.v[c.f]));
    plan.refs.forEach(f=>f());plan.silent.forEach(f=>f());
    plan.added.forEach((r,i)=>state.points.push({id:newId(),projectId:p.id,...r.v,status:r.v.status||"open",ownerName:"",taskId:null,requestId:null,createdAt:r.date?r.date+i:now+i,closedAt:r.v.status==="closed"?now:null,xl:{ver:XL_VER,n:r.n||"",k:xlKey(r.v.text),v:r.v}}));
    if(gone)plan.gone.forEach(x=>{delete x.xl;if(gone==="trash")x.deletedAt=now});
    ui.xlLast=ui.xlLast||{};ui.xlLast[p.id]=now;saveUi();
    save();render();
    const undo=()=>{state.points=(state.points||[]).filter(x=>x.projectId!==p.id).concat(before);save();render()};
    undo.fresh=fresh;return undo;
  }
  // ---------- Synchronisation automatique (appli ouverte, fichier lié, accès autorisé) ----------
  // Toutes les 10 minutes, à l'ouverture et au retour sur l'onglet. Les changements faits dans l'Excel et les nouveaux points
  // sont appliqués sans confirmation (annulables) ; les points retirés de l'Excel et les écarts d'un premier rapprochement
  // attendent un clic sur « Synchroniser avec Excel ».
  // ---------- Alerte « nouvelle réponse du client » (colonne Commentaires <client> de l'Excel) ----------
  function ansOf(pid){return livePts().filter(o=>o.projectId===pid&&o.ansNew)}
  function ansTxt(n){return n>1?`${n} nouvelles réponses du client`:"1 nouvelle réponse du client"}
  function notifOk(){return "Notification" in window}
  function ansShow(pid){
    view=pid;ui.mode="points";ui.ptFilter=ui.ptFilter&&typeof ui.ptFilter==="object"?ui.ptFilter:{};
    ui.ptFilter[pid]={...(ui.ptFilter[pid]||{themes:[],erp:false}),themes:[],erp:false,ans:true};saveUi();editingPt=null;render();
  }
  function ansSeen(list){const now=Date.now();list.forEach(x=>{x.ansNew=null;x.updatedAt=now});save();render()}
  function ansAlert(p,fresh){
    const n=fresh.length;if(!n)return;
    toast(`« ${p.name} » : ${ansTxt(n)} dans l'Excel.`,()=>ansShow(p.id),"Voir");
    // notification Windows si l'appli n'est pas au premier plan (autorisation donnée une fois)
    if(notifOk()&&Notification.permission==="granted"&&(document.hidden||!document.hasFocus())){
      try{
        const x=fresh[0], nt=new Notification(`${p.name} : ${ansTxt(n)}`,{body:n>1?fresh.slice(0,3).map(o=>"• "+short(o.text)).join("\n")+(n>3?`\n… et ${n-3} autre(s)`:""):`${short(x.text)}\nRéponse : ${short(x.answer)}`,tag:"ans-"+p.id,icon:"icons/icon-192-v7.png"});
        nt.onclick=()=>{try{window.focus()}catch(e){}ansShow(p.id);nt.close()};
      }catch(e){}
    }
  }
  async function ansNotifAsk(){
    if(!notifOk()){uiAlert("Ce navigateur ne permet pas les notifications.");return}
    if(Notification.permission==="denied"){uiAlert("Les notifications sont bloquées pour cette appli.\n\nPour les autoriser : cliquez sur le cadenas (ou ⋯ › Autorisations de l'application) à gauche de l'adresse, puis Notifications › Autoriser.");return}
    const r=await Notification.requestPermission();
    toast(r==="granted"?"Notifications activées : vous serez alerté des réponses du client, même appli en arrière-plan.":"Notifications non autorisées.");render();
  }
  const XL_AUTO_MS=10*60e3;
  const xlNeed={};let xlAutoBusy=false,xlAutoAt=0;
  const xlCanSync=pid=>xlOn(pid)&&(MODE!=="cloud"||isOwner(pid));
  async function xlAuto(force){
    if(xlAutoBusy||!xlFsOk()||(!force&&Date.now()-xlAutoAt<60e3))return;
    if(document.querySelector("dialog[open]")||editingPt||mtgCur)return;
    xlAutoBusy=true;xlAutoAt=Date.now();
    try{
      for(const p of state.projects.filter(p=>!p.archived&&xlCanSync(p.id))){
        const h=await xlHandleGet(p.id);if(!h)continue;
        let file;
        try{
          if(h.queryPermission&&await h.queryPermission({mode:"read"})!=="granted"){if(!xlNeed[p.id]){xlNeed[p.id]=true;render()}continue}
          file=await h.getFile();
        }catch(e){continue}
        if(xlNeed[p.id]){delete xlNeed[p.id];render()}
        ui.xlMod=ui.xlMod||{};
        if(ui.xlMod[p.id]===file.lastModified)continue;
        let parsed;try{parsed=xlParse(await window.XlsxLite.readXlsx(await file.arrayBuffer()))}catch(e){continue}
        if(document.querySelector("dialog[open]")||editingPt||mtgCur)break;
        const plan=xlPlan(p.id,parsed.rows);
        if(plan.conflicts.length||plan.links.length){ui.xlPend=ui.xlPend||{};ui.xlPend[p.id]=plan.conflicts.length+plan.links.length+plan.gone.length;ui.xlMod[p.id]=file.lastModified;saveUi();render();continue}
        const nUp=plan.updates.length,nAdd=plan.added.length;
        ui.xlPend=ui.xlPend||{};if(plan.gone.length)ui.xlPend[p.id]=plan.gone.length;else delete ui.xlPend[p.id];
        ui.xlMod[p.id]=file.lastModified;saveUi();
        if(!nUp&&!nAdd&&!plan.silent.length&&!plan.refs.length){ui.xlLast=ui.xlLast||{};ui.xlLast[p.id]=Date.now();saveUi();render();continue}
        const undo=xlApply(p,plan,"xl",null);
        if(undo.fresh.length)ansAlert(p,undo.fresh);
        else if(nUp||nAdd)toast(`« ${p.name} » mis à jour depuis Excel : ${nUp} point${nUp>1?"s":""} modifié${nUp>1?"s":""}, ${nAdd} ajouté${nAdd>1?"s":""}.`,undo);
      }
    }finally{xlAutoBusy=false}
  }
  setInterval(()=>xlAuto(true),XL_AUTO_MS);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)xlAuto(false)});
  setTimeout(()=>xlAuto(true),8000);
  window.__xlAutoNow=()=>xlAuto(true); // utilisé par les tests
  // Rapproche les lignes Excel des points du projet et prépare les changements (sans rien modifier)
  function xlPlan(pid,rows){
    const pts=(state.points||[]).filter(x=>x.projectId===pid);
    const byKey=new Map(), byN=new Map();let dupes=0;
    rows.forEach(r=>{
      const k=xlKey(r.v.text);
      if((r.n&&byN.has(r.n))||(!r.n&&byKey.has(k))){dupes++;return}
      r.k=k;if(r.n)byN.set(r.n,r);if(!byKey.has(k))byKey.set(k,r);
    });
    const free=new Set(rows.filter(r=>r.k!=null)), match=new Map(); // point -> ligne
    const take=(x,r)=>{if(r&&free.has(r)&&!match.has(x)){match.set(x,r);free.delete(r)}};
    // 1. N° mémorisé, 2. description mémorisée, 3. description identique, 4. description proche
    pts.forEach(x=>{if(x.xl&&x.xl.n)take(x,byN.get(x.xl.n))});
    pts.forEach(x=>{if(x.xl&&x.xl.k)take(x,byKey.get(x.xl.k))});
    pts.forEach(x=>take(x,byKey.get(xlKey(x.text))));
    const cand=[];
    pts.filter(x=>!match.has(x)).forEach(x=>free.forEach(r=>{const s=Math.max(x.xl?xlSim(x.xl.v.text,r.v.text):0,xlSim(x.text,r.v.text))+((x.xl?x.xl.v.theme:x.theme)===r.v.theme?0.05:0);if(s>=0.6)cand.push([s,x,r])}));
    cand.sort((a,b)=>b[0]-a[0]).forEach(([,x,r])=>take(x,r));
    const updates=[],links=[],conflicts=[],refs=[],silent=[];
    match.forEach((r,x)=>{
      if(x.deletedAt)return; // à la corbeille : on n'y touche pas
      const v=r.v, base=x.xl&&x.xl.ver===XL_VER?x.xl.v:null;
      const ref=()=>{x.xl={ver:XL_VER,n:r.n||"",k:r.k,v}};
      if(base){
        // déjà rapproché : on ne reprend que ce qui a changé dans l'Excel depuis la dernière lecture
        const fields=XL_F.filter(f=>!xlSame(f,v[f],base[f])&&!(f==="status"&&!v[f])&&!xlSame(f,v[f],x[f]));
        if(fields.length)updates.push({pt:x,row:r,fields});
        const changed=XL_F.some(f=>!xlSame(f,v[f],base[f]))||x.xl.n!==(r.n||"");
        if(fields.length||changed)(fields.length?refs:silent).push(ref);
        return;
      }
      // premier rapprochement : on complète les champs vides, les écarts sont soumis à l'utilisateur
      const fields=[];
      XL_F.forEach(f=>{
        const xv=v[f], av=x[f]||"";
        if(!xv||xlSame(f,xv,av))return;
        if(f==="status"?false:!av)fields.push(f);else conflicts.push({pt:x,row:r,f});
      });
      if(fields.length)updates.push({pt:x,row:r,fields});
      links.push(x);refs.push(ref);
    });
    return {updates,conflicts,links,refs,silent,added:[...free],gone:pts.filter(x=>x.xl&&!x.deletedAt&&!match.has(x)),dupes};
  }
  // ---------- Réunions et comptes rendus ----------
  // Une réunion (atelier, COPIL, point hebdo) appartient à un projet. On prépare l'ordre du jour, on relève en séance
  // décisions, actions, points levés et nouveaux points, puis on VALIDE : c'est seulement à ce moment que les tâches et
  // les points sont créés ou mis à jour dans le projet. Le PDF n'est produit que sur demande.
  const MTG_KIND={atelier:"Atelier",copil:"COPIL",hebdo:"Point hebdomadaire",autre:"Réunion"};
  const SIDE={client:"Client",mecalux:"Mecalux",tiers:"Tiers"};
  const rowMtg=m=>({id:m.id,project_id:m.projectId,title:m.title,kind:m.kind,theme:m.theme||"",starts_at:m.startsAt||null,ends_at:m.endsAt||null,location:m.location||"",outlook_key:m.outlookKey||null,status:m.status,participants:m.participants||[],agenda:m.agenda||[],items:m.items||[],notes:m.notes||"",next_meeting:m.nextMeeting||"",validated_at:m.validatedAt||null,updated_at:m.updatedAt||Date.now(),deleted_at:m.deletedAt||null});
  const fromMtg=r=>({id:r.id,projectId:r.project_id,title:r.title,kind:r.kind,theme:r.theme||"",startsAt:r.starts_at?Number(r.starts_at):null,endsAt:r.ends_at?Number(r.ends_at):null,location:r.location||"",outlookKey:r.outlook_key||"",status:r.status,participants:Array.isArray(r.participants)?r.participants:[],agenda:Array.isArray(r.agenda)?r.agenda:[],items:Array.isArray(r.items)?r.items:[],notes:r.notes||"",nextMeeting:r.next_meeting||"",validatedAt:r.validated_at?Number(r.validated_at):null,createdBy:r.created_by||"",createdAt:Number(r.created_at)||0,updatedAt:Number(r.updated_at)||0,deletedAt:r.deleted_at?Number(r.deleted_at):null});
  const fromCt=r=>({id:r.id,name:r.name,role:r.role||"",side:r.side||"client",email:r.email||""});
  function mtgList(pid){
    const l=MODE==="cloud"?(cloud.meetings[pid]||[]):((proj(pid)||{}).meetings||[]);
    return l.filter(m=>!m.deletedAt).sort((a,b)=>(b.startsAt||b.createdAt||0)-(a.startsAt||a.createdAt||0));
  }
  const mtgAll=()=>state.projects.flatMap(p=>mtgList(p.id));
  const ctList=pid=>(MODE==="cloud"?(cloud.contacts[pid]||[]):((proj(pid)||{}).contacts||[])).slice().sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  const mtgSaveT={};
  function mtgPut(m,now){
    m.updatedAt=Date.now();
    if(MODE==="cloud"){
      Object.keys(cloud.meetings).forEach(k=>{cloud.meetings[k]=cloud.meetings[k].filter(x=>x.id!==m.id)});
      (cloud.meetings[m.projectId]=cloud.meetings[m.projectId]||[]).push(JSON.parse(JSON.stringify(m)));
      clearTimeout(mtgSaveT[m.id]);
      const send=async()=>{
        const {error}=await cloudClient().from("meetings").upsert(rowMtg(m));
        if(error){setSync(transient(error)?"Compte rendu : enregistrement en attente de connexion…":"Compte rendu non enregistré : "+error.message);mtgSaveT[m.id]=setTimeout(send,15000)}
      };
      if(now)send();else mtgSaveT[m.id]=setTimeout(send,700);
    } else {
      const p=proj(m.projectId);if(!p)return;
      state.projects.forEach(q=>{if(q.meetings)q.meetings=q.meetings.filter(x=>x.id!==m.id)});
      p.meetings=(p.meetings||[]);p.meetings.push(JSON.parse(JSON.stringify(m)));save();
    }
  }
  // Suppression d'un compte rendu (corbeille logique, annulable) ; les tâches et points déjà créés restent dans le projet
  async function mtgDelete(m){
    const valid=m.status==="validated";
    if(!await uiConfirm(`Supprimer le compte rendu « ${m.title} » du ${mtgDate(m).toLocaleDateString("fr-FR")} ?`+(valid?"\n\nLes tâches et points ouverts créés à sa validation restent dans le projet.":""),{ok:"Supprimer",danger:true}))return false;
    const x=JSON.parse(JSON.stringify(m));x.deletedAt=Date.now();mtgPut(x,true);
    if(mtgCur&&mtgCur.id===m.id){mtgCur=null;renderMtg()}
    render();
    toast("Compte rendu supprimé.",()=>{const y=JSON.parse(JSON.stringify(x));y.deletedAt=null;mtgPut(y,true);render()});
    return true;
  }
  // Changement de projet en préparation : l'ordre du jour est recalculé pour le nouveau projet
  async function mtgMove(pid){
    const m=mtgCur;if(!m||m.status!=="draft"||pid===m.projectId)return;
    const p=proj(pid);if(!p)return;
    const refs=(m.items||[]).filter(i=>i.type==="close"||i.type==="taskdone").length;
    if(!await uiConfirm(`Affecter ce compte rendu au projet « ${p.name} » ?\n\nL'ordre du jour sera recalculé avec les points et tâches de ce projet. Les sujets libres sont conservés.`+(refs?`\n${refs} élément(s) déjà notés (points levés, tâches terminées) concernent l'ancien projet et seront retirés.`:""),{ok:"Changer de projet"})){renderMtg();return}
    mtgSet(mm=>{
      mm.projectId=pid;
      const t=norm(mm.title||"");mm.theme=mm.kind==="atelier"?(ptThemes(pid).find(x=>t.includes(norm(x)))||""):"";
      mm.items=(mm.items||[]).filter(i=>i.type!=="close"&&i.type!=="taskdone");
      const free=(mm.agenda||[]).filter(a=>a.kind==="free");
      mm.agenda=[...proposeAgenda(mm).filter(x=>x.checked).map(({key,kind,ref,title,label})=>({key,kind,ref,title,label,done:false})),...free];
    },true);
    render();
  }
  async function ctAdd(pid,c){
    const x={id:newId(),name:c.name.trim().slice(0,120),role:(c.role||"").trim().slice(0,120),side:SIDE[c.side]?c.side:"client",email:(c.email||"").trim().slice(0,200)};
    if(!x.name)return null;
    if(MODE==="cloud"){
      const {error}=await cloudClient().from("project_contacts").insert({id:x.id,project_id:pid,name:x.name,role:x.role,side:x.side,email:x.email});
      if(error){uiAlert(transient(error)?"Contact non enregistré : connexion au serveur impossible.":"Contact refusé : "+error.message);return null}
      (cloud.contacts[pid]=cloud.contacts[pid]||[]).push(x);
    } else {const p=proj(pid);p.contacts=[...(p.contacts||[]),x];save()}
    return x;
  }
  async function ctDel(pid,id){
    if(MODE==="cloud"){const {error}=await cloudClient().from("project_contacts").delete().eq("id",id);if(error){uiAlert("Suppression impossible : "+error.message);return}cloud.contacts[pid]=(cloud.contacts[pid]||[]).filter(x=>x.id!==id)}
    else{const p=proj(pid);p.contacts=(p.contacts||[]).filter(x=>x.id!==id);save()}
  }
  const mtgDate=m=>m.startsAt?new Date(m.startsAt):new Date(m.createdAt||Date.now());
  const mtgDay=m=>mtgDate(m).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  const mtgWhen=m=>cap(mtgDay(m))+(m.startsAt?` · ${hm(m.startsAt)}${m.endsAt&&m.endsAt>m.startsAt?" – "+hm(m.endsAt):""}`:"")+(m.location?` · ${m.location}`:"");
  const mtgLabel=m=>`${m.title} du ${mtgDate(m).toLocaleDateString("fr-FR")}`;
  const ptNumOf=x=>{const n=ptLabel(x);return n?"N° "+n:""};
  // Personnes proposées : contacts du projet, membres du projet (Mecalux), personnes déjà notées dans la réunion
  function mtgPeople(m){
    const out=[],seen=new Set(),add=(name,side,extra)=>{const k=norm(name);if(!name||seen.has(k))return;seen.add(k);out.push({name,side,...extra})};
    (m.participants||[]).forEach(p=>add(p.name,p.side));
    ctList(m.projectId).forEach(c=>add(c.name,c.side,{role:c.role}));
    memberEmails(m.projectId).forEach(e=>add(nameOf(e),"mecalux",{email:e}));
    return out;
  }
  function defaultParticipants(pid){
    const l=[];
    if(MODE==="cloud"&&cloud.email)l.push({name:nameOf(cloud.email),side:"mecalux",present:true,email:cloud.email});
    return l;
  }
  // Ordre du jour proposé selon le type de réunion
  function proposeAgenda(m){
    const pid=m.projectId, out=[];
    const prev=mtgList(pid).filter(x=>x.id!==m.id&&x.status==="validated"&&(x.startsAt||x.createdAt)<=(m.startsAt||Date.now())).sort((a,b)=>(b.startsAt||b.createdAt)-(a.startsAt||a.createdAt))[0];
    if(prev)(prev.items||[]).filter(i=>i.type==="action"&&i.createdId).forEach(i=>{const t=live().find(x=>x.id===i.createdId);if(t&&t.status!=="done")out.push({key:"t:"+t.id,kind:"task",ref:t.id,title:t.title,label:"Action du "+mtgDate(prev).toLocaleDateString("fr-FR"),checked:true})});
    const pts=livePts().filter(o=>o.projectId===pid&&o.status!=="closed");
    const byNum=(a,b)=>{const na=parseFloat(ptLabel(a))||1e9,nb=parseFloat(ptLabel(b))||1e9;return na-nb||(a.createdAt||0)-(b.createdAt||0)};
    const tks=live().filter(t=>t.projectId===pid&&t.status!=="done");
    const addT=(t,label,checked)=>{if(!out.some(o=>o.key==="t:"+t.id))out.push({key:"t:"+t.id,kind:"task",ref:t.id,title:t.title,label,checked})};
    if(m.kind==="atelier"){
      (m.theme?pts.filter(o=>(o.theme||"")===m.theme):pts.filter(o=>o.owner==="client")).sort(byNum).forEach(o=>out.push({key:"o:"+o.id,kind:"point",ref:o.id,title:o.text.split("\n")[0].slice(0,200),label:[ptNumOf(o)||"Point ouvert",o.theme].filter(Boolean).join(" · "),checked:!!m.theme}));
    } else if(m.kind==="copil"){
      tks.filter(isLate).forEach(t=>addT(t,"Tâche en retard",true));
      tks.filter(t=>t.status==="waiting").forEach(t=>addT(t,"En attente"+(t.waitingFor?" de "+t.waitingFor:""),true));
      liveReq().filter(r=>r.projectId===pid&&reqOpen(r)).forEach(r=>out.push({key:"r:"+r.id,kind:"request",ref:r.id,title:r.title,label:"Demande client",checked:true}));
      const nc=pts.filter(o=>o.owner==="client").length;
      if(nc)out.push({key:"f:ptcli",kind:"free",ref:"",title:`Points ouverts en attente du client (${nc})`,label:"Sujet",checked:true});
    } else if(m.kind==="hebdo"){
      const lim=iso(addDays(today(),7));
      tks.filter(t=>isLate(t)||(t.due&&t.due<=lim)).forEach(t=>addT(t,isLate(t)?"Tâche en retard":"Échéance "+shortDay(t.due).toLowerCase(),true));
    }
    return out;
  }
  const subjOf=(m,a)=>{
    if(!a)return null;
    if(a.kind==="point")return {a,o:(state.points||[]).find(x=>x.id===a.ref)};
    if(a.kind==="task")return {a,t:state.tasks.find(x=>x.id===a.ref)};
    if(a.kind==="request")return {a,r:(state.requests||[]).find(x=>x.id===a.ref)};
    return {a};
  };
  // ---------- Création depuis l'agenda (réunion Outlook) ----------
  const outlookKey=ev=>(ev.uid||ev.title)+"|"+ev.start;
  const mtgForOutlook=ev=>mtgAll().find(x=>x.outlookKey===outlookKey(ev));
  function guessProject(title){
    const t=norm(title);
    const ps=state.projects.filter(p=>!p.archived);
    return ps.find(p=>t.includes(norm(p.name)))||ps.find(p=>norm(p.name).split(/[^a-z0-9]+/).some(w=>w.length>=4&&t.includes(w)))||null;
  }
  async function mtgFromOutlook(ev,pid){
    const ex=mtgForOutlook(ev);if(ex){mtgOpen(ex);return}
    const ps=state.projects.filter(p=>!p.archived);if(!ps.length){uiAlert("Créez d'abord un projet.");return}
    const g=pid?null:guessProject(ev.title);
    const r=await mtgNewDialog({title:ev.title,startsAt:ev.allDay?null:ev.start,endsAt:ev.allDay?null:ev.end,location:ev.location,outlookKey:outlookKey(ev),projectId:pid||(g||ps[0]).id,guessed:!!g});
    if(r){if(pid){ui.mode="meetings";saveUi();render()}mtgOpen(r,"prep")}
  }
  // « Nouvelle réunion » d'un projet : choisir la réunion Outlook à laquelle rattacher le compte rendu (ou une réunion hors Outlook)
  async function mtgStart(p){
    const manual=async()=>{const r=await mtgNewDialog({projectId:p.id});if(r){ui.mode="meetings";saveUi();render();mtgOpen(r,"prep")}};
    if(MODE!=="cloud"||!cloud.user)return manual();
    const pick=await mtgPickOutlook(p);
    if(pick==="manual")return manual();
    if(pick)return mtgFromOutlook(pick,p.id);
  }
  function mtgPickOutlook(p){
    return new Promise(async res=>{
      const from=addDays(today(),-14).getTime(), to=addDays(today(),22).getTime();
      const evs=()=>{if(!cal.events)return [];try{return ICS.instances(cal.events,from,to).filter(e=>e.title).sort((a,b)=>a.start-b.start)}catch(e){return []}};
      const pn=norm(p.name), pw=pn.split(/[^a-z0-9]+/).filter(w=>w.length>=4);
      const mine=e=>{const t=norm(e.title+" "+(e.location||""));return t.includes(pn)||pw.some(w=>t.includes(w))};
      if(typeof window.__testDialog==="function"){
        if(!cal.events)await loadMeetings(true,true);
        const list=evs();const r=await window.__testDialog({type:"mtgpick",message:p.name,options:list.map(e=>e.title),hasLink:cal.hasLink!==false});
        if(!r||r.ok===false)return res(null);if(r.v==="__manual")return res("manual");return res(list.find(e=>e.title===r.v)||null);
      }
      const d=document.createElement("dialog");d.className="uidlg mtgpick";d.setAttribute("aria-label","Nouvelle réunion");
      d.innerHTML=`<form method="dialog"><h3>Nouvelle réunion</h3><p class="uimsg">Choisissez la réunion Outlook à laquelle rattacher le compte rendu.</p>
        <input type="search" class="mpq" placeholder="Rechercher une réunion…" aria-label="Rechercher une réunion" hidden>
        <div class="mpl" role="list"></div>
        <div class="uibtns"><button type="button" class="btn" data-man>Réunion hors Outlook</button><span class="sp"></span><button type="button" class="btn ghost" data-x>Annuler</button></div></form>`;
      document.body.appendChild(d);
      const L=d.querySelector(".mpl"), Q=d.querySelector(".mpq");let list=[];
      const close=v=>{try{d.close()}catch(e){}d.remove();res(v)};
      const row=(e,k,sg)=>{const cr=mtgForOutlook(e), now=Date.now();return `<button type="button" class="mpi${e.end<now?" past":""}${sg?" sug":""}" data-i="${k}"><span class="mpt">${sg?`<em>${esc(new Date(e.start).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"}))}</em>`:""}${e.allDay?"Journée":`${hm(e.start)} – ${hm(e.end)}`}</span><span class="mpn"><b>${esc(e.title)}</b>${e.location?`<small>${esc(e.location)}</small>`:""}</span>${cr?`<span class="crb" title="Compte rendu déjà créé : il sera ouvert">CR</span>`:""}</button>`};
      const dayH=t=>{const d0=new Date(t),td=iso(today()),di=iso(d0);return (di===td?"Aujourd'hui · ":di===iso(addDays(today(),1))?"Demain · ":di===iso(addDays(today(),-1))?"Hier · ":"")+d0.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})};
      const paint=()=>{
        if(cal.loading&&!cal.events){L.innerHTML=`<p class="mpmsg">Chargement de vos réunions Outlook…</p>`;return}
        if(cal.hasLink===false){L.innerHTML=`<div class="mpmsg"><p>Votre agenda Outlook n'est pas encore relié à l'appli. Reliez-le une fois pour choisir vos réunions ici et les voir dans l'agenda.</p><button type="button" class="btn primary" data-cal>Relier mon agenda Outlook</button></div>`;L.querySelector("[data-cal]").onclick=()=>{close(null);openCalCfg()};return}
        if(!cal.events){L.innerHTML=`<p class="mpmsg">${esc(cal.error||"Réunions Outlook indisponibles pour le moment.")}</p>`;return}
        list=evs();Q.hidden=!list.length;
        const q=norm(Q.value.trim());const shown=list.map((e,k)=>({e,k})).filter(x=>!q||norm(x.e.title+" "+(x.e.location||"")).includes(q));
        if(!shown.length){L.innerHTML=`<p class="mpmsg">${q?"Aucune réunion ne correspond.":"Aucune réunion Outlook sur les deux dernières semaines ni les trois prochaines."}</p>`;return}
        const now=Date.now(), sug=q?[]:shown.filter(x=>mine(x.e)).sort((a,b)=>Math.abs(a.e.start-now)-Math.abs(b.e.start-now)).slice(0,4);
        let h=sug.length?`<div class="mph">Pour ${esc(p.name)}</div>${sug.map(x=>row(x.e,x.k,true)).join("")}`:"";
        let last="";shown.forEach(x=>{const dh=dayH(x.e.start);if(dh!==last){h+=`<div class="mph" data-day="${iso(new Date(x.e.start))}">${esc(cap(dh))}</div>`;last=dh}h+=row(x.e,x.k)});
        L.innerHTML=h;
        L.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>close(list[+b.dataset.i]));
        if(!q&&!sug.length){const t=L.querySelector(`[data-day="${iso(today())}"]`)||[...L.querySelectorAll("[data-day]")].find(x=>x.dataset.day>iso(today()));if(t)L.scrollTop=t.offsetTop-L.offsetTop}
      };
      Q.oninput=paint;
      d.addEventListener("cancel",e=>{e.preventDefault();close(null)});
      d.querySelector("[data-x]").onclick=()=>close(null);
      d.querySelector("[data-man]").onclick=()=>close("manual");
      d.querySelector("form").onsubmit=e=>e.preventDefault();
      if(d.showModal)d.showModal();else d.setAttribute("open","");
      paint();
      if(!cal.events||Date.now()-cal.fetchedAt>10*60e3){const w=loadMeetings(true,true);paint();await w;while(cal.loading)await new Promise(r=>setTimeout(r,200));if(document.contains(d))paint()}
    });
  }
  // Boîte de création : projet, type, thème (pour un atelier) ; réunion manuelle : intitulé, date et heure en plus
  function mtgNewDialog(o){
    return new Promise(res=>{
      const d=document.createElement("dialog");d.className="uidlg";d.setAttribute("aria-label","Nouveau compte rendu");
      const manual=!o.outlookKey;
      const ps=state.projects.filter(p=>!p.archived||p.id===o.projectId);
      d.innerHTML=`<form method="dialog"><h3>${manual?"Nouvelle réunion":"Compte rendu de réunion"}</h3>
        ${manual?"":`<p class="uimsg"><b>${esc(o.title)}</b><br>${esc(mtgWhen({startsAt:o.startsAt,endsAt:o.endsAt,location:o.location,createdAt:o.startsAt}))}</p>`}
        ${manual?`<label class="uifld"><span>Intitulé</span><input type="text" data-k="title" maxlength="300" placeholder="Ex. : Atelier Réception"></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="uifld"><span>Date</span><input type="date" data-k="date" value="${iso(today())}"></label><label class="uifld"><span>Heure</span><input type="time" data-k="time" value="09:00"></label></div>`:""}
        <label class="uifld"><span>Projet${o.guessed?" (reconnu dans l'intitulé)":""}</span><select data-k="pid">${ps.map(p=>`<option value="${esc(p.id)}"${p.id===o.projectId?" selected":""}>${esc(p.name)}</option>`).join("")}</select></label>
        <label class="uifld"><span>Type</span><select data-k="kind">${Object.entries(MTG_KIND).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select></label>
        <label class="uifld" data-th><span>Thème de l'atelier</span><select data-k="theme"></select></label>
        <p class="uimsg" data-hint style="font-size:13px;color:var(--muted)"></p>
        <p class="uierr" role="alert"></p>
        <div class="uibtns"><button type="button" class="btn ghost" data-x>Annuler</button><button type="button" class="btn primary" data-ok>Créer le compte rendu</button></div></form>`;
      document.body.appendChild(d);
      const q=k=>d.querySelector(`[data-k=${k}]`);
      if(/copil|comit/i.test(o.title||""))q("kind").value="copil";else if(/hebdo|weekly|point d.?(é|e)quipe/i.test(o.title||""))q("kind").value="hebdo";
      let thPid=null;
      const fillTh=()=>{
        const pid=q("pid").value, ths=ptThemes(pid), t=norm(o.title||(q("title")&&q("title").value)||"");
        if(thPid!==pid){
          const guess=ths.find(x=>t.includes(norm(x)))||"";
          q("theme").innerHTML=`<option value="">Aucun thème (points à répondre par le client)</option>`+ths.map(x=>`<option${x===guess?" selected":""}>${esc(x)}</option>`).join("");
          thPid=pid;
        }
        d.querySelector("[data-th]").hidden=q("kind").value!=="atelier";
        const m={projectId:pid,kind:q("kind").value,theme:q("theme").value,startsAt:o.startsAt||Date.now()};
        const c=proposeAgenda(m).filter(x=>x.checked).length;
        d.querySelector("[data-hint]").textContent=`Ordre du jour proposé : ${c} sujet${c>1?"s":""} (modifiable avant la réunion).`;
      };
      ["pid","kind","theme"].forEach(k=>q(k).addEventListener("change",fillTh));fillTh();
      const close=v=>{try{d.close()}catch(e){}d.remove();res(v)};
      d.addEventListener("cancel",e=>{e.preventDefault();close(null)});
      d.querySelector("[data-x]").onclick=()=>close(null);
      d.querySelector("[data-ok]").onclick=()=>{
        let title=o.title, startsAt=o.startsAt||null, endsAt=o.endsAt||null;
        if(manual){
          title=q("title").value.trim();if(!title){d.querySelector(".uierr").textContent="Indiquez l'intitulé de la réunion.";return}
          const dt=q("date").value, tm=q("time").value||"09:00";
          if(dt){const [y,mo,da]=dt.split("-").map(Number),[h,mi]=tm.split(":").map(Number);startsAt=new Date(y,mo-1,da,h,mi).getTime();endsAt=null}
        }
        const m={id:newId(),projectId:q("pid").value,title:title.slice(0,300),kind:q("kind").value,theme:q("kind").value==="atelier"?q("theme").value:"",startsAt,endsAt,location:o.location||"",outlookKey:o.outlookKey||"",status:"draft",participants:defaultParticipants(q("pid").value),agenda:[],items:[],notes:"",nextMeeting:"",createdAt:Date.now()};
        m.agenda=proposeAgenda(m).filter(x=>x.checked).map(({key,kind,ref,title,label})=>({key,kind,ref,title,label,done:false}));
        m.agenda.push({key:"f:"+uid(),kind:"free",ref:"",title:"Divers",label:"Sujet",done:false});
        mtgPut(m,true);close(m);
      };
      if(d.showModal)d.showModal();else d.setAttribute("open","");
      setTimeout(()=>(manual?q("title"):d.querySelector("[data-ok]")).focus(),0);
    });
  }
  // ---------- Écran de réunion (préparation, séance, compte rendu) ----------
  let mtgCur=null, mtgPhase="run", mtgIdx=0, mtgForm=null;
  function mtgOpen(m,phase){
    mtgCur=JSON.parse(JSON.stringify(m));
    mtgPhase=phase||(m.status==="validated"?"review":(m.items||[]).length?"run":"prep");
    mtgIdx=Math.max(0,(mtgCur.agenda||[]).findIndex(a=>!a.done));mtgForm=null;
    renderMtg();
  }
  function mtgClose(){if(mtgCur&&mtgCur.status==="draft")mtgPut(mtgCur,true);mtgCur=null;renderMtg();render()}
  const mtgEdit=()=>mtgCur&&mtgCur.status==="draft";
  function mtgSet(fn,now){if(!mtgEdit())return;fn(mtgCur);mtgPut(mtgCur,now);renderMtg()}
  function mtgItemText(i){
    if(i.type==="close"){const o=(state.points||[]).find(x=>x.id===i.ref);return (o?(ptNumOf(o)?ptNumOf(o)+" – ":"")+short(o.text):"Point")+(i.text?" : "+rtText(i.text):"")}
    if(i.type==="taskdone"){const t=state.tasks.find(x=>x.id===i.ref);return "Tâche terminée : "+(t?t.title:"")}
    if(i.type==="action")return rtText(i.text)+(i.who?" – "+nameOf(i.who):"")+(i.due?" – pour le "+fmtD(i.due):"");
    if(i.type==="newpoint")return rtText(i.text)+(i.owner?" – à répondre par : "+(OWNER[i.owner]||i.owner):"");
    return rtText(i.text);
  }
  const ITYPE={decision:["Décision","#4B2E8F","#ECE6F7"],action:["Action","#6B5200","#FFF4CC"],close:["Point levé","#1F5C43","#DDF0E5"],newpoint:["Nouveau point","#1D4E78","#DCEAF7"],taskdone:["Tâche terminée","#1F5C43","#DDF0E5"]};
  function renderMtg(){
    let v=$("#mtgview");
    if(!mtgCur){if(v)v.remove();document.body.classList.remove("mtgopen");return}
    if(!v){v=document.createElement("div");v.id="mtgview";v.setAttribute("role","dialog");v.setAttribute("aria-modal","true");document.body.appendChild(v)}
    document.body.classList.add("mtgopen");
    const m=mtgCur,p=proj(m.projectId)||{name:"",color:"#999"},ed=mtgEdit();
    v.className="mtgv"+(ui.mtgPresent&&mtgPhase==="run"?" present":"");
    v.setAttribute("aria-label",m.title);
    const ph=(k,l)=>`<button type="button" data-ph="${k}" aria-pressed="${mtgPhase===k}">${l}</button>`;
    v.innerHTML=`<header class="mtgh"><span class="dot" style="background:${esc(p.color)}"></span>
      <div class="mtgt"><b>${esc(m.title)}</b><span>${esc(p.name)} · ${esc(MTG_KIND[m.kind]||"Réunion")}${m.theme?" · "+esc(m.theme):""} · ${esc(mtgWhen(m))}</span></div>
      ${m.status==="validated"?`<span class="mtgok">Validé le ${new Date(m.validatedAt).toLocaleDateString("fr-FR")}</span>`:`<span class="mtgdraft">Brouillon</span>`}
      <div class="seg mtgph" role="group" aria-label="Étape">${ph("prep","Préparation")}${ph("run","Réunion")}${ph("review","Compte rendu")}</div>
      ${mtgPhase==="run"?`<button type="button" class="btn ghost mtgpres" aria-pressed="${!!ui.mtgPresent}" title="Affichage pour projeter devant le client : notes et relevé masqués, texte agrandi">Mode présentation</button>`:""}
      <button type="button" class="btn ghost mtgdel" data-del title="Supprimer ce compte rendu">Supprimer</button>
      <button type="button" class="dclose" data-close aria-label="Fermer la réunion">✕</button></header>
      <div class="mtgbody" id="mtgbody"></div>`;
    v.querySelectorAll("[data-ph]").forEach(b=>b.onclick=()=>{mtgPhase=b.dataset.ph;mtgForm=null;renderMtg()});
    v.querySelector("[data-close]").onclick=mtgClose;
    v.querySelector("[data-del]").onclick=()=>mtgDelete(mtgCur);
    const pr=v.querySelector(".mtgpres");if(pr)pr.onclick=()=>{ui.mtgPresent=!ui.mtgPresent;saveUi();renderMtg()};
    const B=v.querySelector("#mtgbody");
    if(mtgPhase==="prep")mtgPrep(B,m,ed);else if(mtgPhase==="review")mtgReview(B,m,ed);else mtgRun(B,m,ed);
  }
  function peoplePanel(m,ed){
    const box=document.createElement("section");box.className="mtgcard";
    const ppl=mtgPeople(m), cur=new Map((m.participants||[]).map(x=>[norm(x.name),x]));
    box.innerHTML=`<h3>Participants</h3>${ppl.length?`<div class="mtgppl">${ppl.map((x,i)=>{const c=cur.get(norm(x.name));return `<label><input type="checkbox" data-i="${i}" ${c&&c.present?"checked":""} ${ed?"":"disabled"}><span>${esc(x.name)}${x.role?` <small>${esc(x.role)}</small>`:""}</span><em>${esc(SIDE[x.side]||"")}</em></label>`}).join("")}</div>`:`<p class="muted">Aucun contact pour ce projet.</p>`}
      ${ed?`<form class="mtgadd" autocomplete="off"><input type="text" placeholder="Nom ou fonction" aria-label="Nom ou fonction" maxlength="120"><select aria-label="Côté">${Object.entries(SIDE).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select><button class="btn" type="submit">Ajouter</button>
      <label class="mtgkeep"><input type="checkbox" checked> Garder dans les contacts du projet</label></form>`:""}`;
    box.querySelectorAll("[data-i]").forEach(cb=>cb.onchange=()=>mtgSet(mm=>{
      const x=ppl[+cb.dataset.i],l=mm.participants||(mm.participants=[]),f=l.find(y=>norm(y.name)===norm(x.name));
      if(f)f.present=cb.checked;else l.push({name:x.name,side:x.side,present:cb.checked,...(x.email?{email:x.email}:{})});
    }));
    const f=box.querySelector(".mtgadd");
    if(f)f.onsubmit=async e=>{e.preventDefault();const name=f.querySelector("input[type=text]").value.trim(),side=f.querySelector("select").value;if(!name)return;
      if(f.querySelector(".mtgkeep input").checked&&!ctList(m.projectId).some(c=>norm(c.name)===norm(name)))await ctAdd(m.projectId,{name,side});
      mtgSet(mm=>{(mm.participants=mm.participants||[]).push({name,side,present:true})})};
    return box;
  }
  // E-mail d'ordre du jour : destinataires = participants cochés ayant une adresse (client en « À », autres en copie)
  function agendaMailData(m){
    const p=proj(m.projectId)||{name:""}, me=(MODE==="cloud"&&cloud.email)||"";
    const cts=ctList(m.projectId), to=[], cc=[];
    (m.participants||[]).filter(x=>x.present).forEach(x=>{
      const c=cts.find(c=>norm(c.name)===norm(x.name)), mail=(x.email||(c&&c.email)||"").trim();
      if(!mail||norm(mail)===norm(me)||to.includes(mail)||cc.includes(mail))return;
      ((x.side||(c&&c.side))==="client"?to:cc).push(mail);
    });
    const when=mtgDay(m)+(m.startsAt?" à "+hm(m.startsAt):"")+(m.location?` (${m.location})`:""), subject=`${p.name?p.name+" – ":""}Ordre du jour : ${m.title} (${mtgDate(m).toLocaleDateString("fr-FR")})`;
    const lines=(m.agenda||[]).map((a,i)=>{
      let t=a.title;
      if(a.kind==="point"){const o=(state.points||[]).find(x=>x.id===a.ref);if(o){const n=ptNumOf(o);t=(n?n+" – ":"")+o.text.split("\n")[0]}}
      return `${i+1}. ${t}`;
    });
    const ppl=(m.participants||[]).filter(x=>x.present).map(x=>x.name+(SIDE[x.side]?` (${SIDE[x.side]})`:""));
    const body=["Bonjour,","",`Voici l'ordre du jour de la réunion « ${m.title} » prévue le ${when}.`,"","Ordre du jour :",...lines,
      ...(ppl.length?["","Participants : "+ppl.join(", ")]:[]),"","N'hésitez pas à nous indiquer si vous souhaitez ajouter un sujet.","","Cordialement,",...(me?[nameOf(me)]:[])].join("\n");
    return {to,cc,subject,body};
  }
  function agendaMail(m){
    const r=agendaMailData(m);
    const d=document.createElement("dialog");d.className="uidlg maildlg";d.setAttribute("aria-label","E-mail d'ordre du jour");
    d.innerHTML=`<form method="dialog"><h3>E-mail d'ordre du jour</h3>
      <label class="uifld"><span>À</span><input type="text" data-k="to" value="${esc(r.to.join("; "))}" placeholder="Adresse du client (ajoutez l'e-mail dans les contacts du projet)"></label>
      <label class="uifld"><span>Cc</span><input type="text" data-k="cc" value="${esc(r.cc.join("; "))}"></label>
      <label class="uifld"><span>Objet</span><input type="text" data-k="subject" value="${esc(r.subject)}"></label>
      <label class="uifld"><span>Message</span><textarea rows="12" data-k="body"></textarea></label>
      <p class="uimsg" data-hint style="font-size:13px;color:var(--muted)">Le message s'ouvre dans votre messagerie (Outlook) : vous le relisez et l'envoyez vous-même.</p>
      <div class="uibtns"><button type="button" class="btn ghost" data-x>Fermer</button><button type="button" class="btn" data-copy>Copier le texte</button><button type="button" class="btn primary" data-open>Ouvrir dans la messagerie</button></div></form>`;
    document.body.appendChild(d);
    const q=k=>d.querySelector(`[data-k=${k}]`);q("body").value=r.body;
    const close=()=>{try{d.close()}catch(e){}d.remove()};
    d.addEventListener("cancel",e=>{e.preventDefault();close()});
    d.querySelector("[data-x]").onclick=close;
    const copy=async()=>{try{await navigator.clipboard.writeText(q("body").value);return true}catch(e){q("body").select();try{return document.execCommand("copy")}catch(e2){return false}}};
    d.querySelector("[data-copy]").onclick=async()=>{if(await copy()){const b=d.querySelector("[data-copy]");b.textContent="Copié";setTimeout(()=>b.textContent="Copier le texte",1500)}};
    d.querySelector("[data-open]").onclick=async()=>{
      const enc=s=>encodeURIComponent(s), addr=s=>s.split(/[;,\s]+/).filter(Boolean).join(";");
      const base=`mailto:${addr(q("to").value)}?subject=${enc(q("subject").value)}`+(q("cc").value.trim()?`&cc=${enc(addr(q("cc").value))}`:"");
      const full=base+`&body=${enc(q("body").value)}`;
      // Les messageries tronquent les liens trop longs : dans ce cas, le texte passe par le presse-papiers
      if(full.length>1900){await copy();toast("Ordre du jour long : le texte est copié, collez-le dans le message (Ctrl+V).");window.__lastMailto=base;location.href=base}
      else{window.__lastMailto=full;location.href=full}
      close();
    };
    if(d.showModal)d.showModal();else d.setAttribute("open","");
  }
  function mtgPrep(B,m,ed){
    const cands=proposeAgenda(m), keys=new Set((m.agenda||[]).map(a=>a.key));
    cands.filter(c=>!keys.has(c.key)).forEach(c=>c.checked=false);
    const shown=[...(m.agenda||[]).map(a=>({...a,checked:true})),...cands.filter(c=>!keys.has(c.key))];
    const left=document.createElement("section");left.className="mtgcard mtgprep";
    const other=livePts().filter(o=>o.projectId===m.projectId&&o.status!=="closed"&&!keys.has("o:"+o.id)&&!cands.some(c=>c.key==="o:"+o.id));
    left.innerHTML=`<h3>Ordre du jour <span class="muted">${(m.agenda||[]).length} sujet${(m.agenda||[]).length>1?"s":""} retenu${(m.agenda||[]).length>1?"s":""}</span></h3>
      <p class="muted">Cochez les sujets à aborder. Les sujets proposés dépendent du type de réunion${m.kind==="atelier"?(m.theme?` (points ouverts « ${esc(m.theme)} »)`:" (points à répondre par le client)"):""} et des actions encore ouvertes du compte rendu précédent.</p>
      <div class="mtgcands">${shown.map((c,i)=>`<label><input type="checkbox" data-c="${i}" ${c.checked?"checked":""} ${ed?"":"disabled"}><span><small>${esc(c.label||"")}</small>${esc(c.title)}</span></label>`).join("")||`<p class="muted">Aucun sujet proposé : ajoutez-les ci-dessous.</p>`}</div>
      ${ed?`<div class="mtgaddrow">${other.length?`<select aria-label="Ajouter un point ouvert"><option value="">Ajouter un point ouvert…</option>${other.map(o=>`<option value="${esc(o.id)}">${esc((ptNumOf(o)?ptNumOf(o)+" – ":"")+short(o.text))}</option>`).join("")}</select>`:""}
        <form autocomplete="off"><input type="text" placeholder="Sujet libre (ex. : planning de la recette)" aria-label="Sujet libre" maxlength="200"><button class="btn" type="submit">Ajouter</button></form></div>`:""}`;
    left.querySelectorAll("[data-c]").forEach(cb=>cb.onchange=()=>mtgSet(mm=>{
      const c=shown[+cb.dataset.c];
      if(cb.checked){if(!mm.agenda.some(a=>a.key===c.key))mm.agenda.push({key:c.key,kind:c.kind,ref:c.ref,title:c.title,label:c.label,done:false})}
      else mm.agenda=mm.agenda.filter(a=>a.key!==c.key);
    }));
    const sel=left.querySelector(".mtgaddrow select");
    if(sel)sel.onchange=()=>{const o=other.find(x=>x.id===sel.value);if(o)mtgSet(mm=>mm.agenda.push({key:"o:"+o.id,kind:"point",ref:o.id,title:o.text.split("\n")[0].slice(0,200),label:[ptNumOf(o)||"Point ouvert",o.theme].filter(Boolean).join(" · "),done:false}))};
    const fr=left.querySelector(".mtgaddrow form");
    if(fr)fr.onsubmit=e=>{e.preventDefault();const t=fr.querySelector("input").value.trim();if(t)mtgSet(mm=>mm.agenda.push({key:"f:"+uid(),kind:"free",ref:"",title:t.slice(0,200),label:"Sujet",done:false}))};
    const right=document.createElement("div");right.className="mtgside";
    if(ed){
      const pc=document.createElement("section");pc.className="mtgcard mtgproj";
      const ps=state.projects.filter(p=>!p.archived||p.id===m.projectId);
      pc.innerHTML=`<h3>Projet</h3><select aria-label="Projet du compte rendu">${ps.map(p=>`<option value="${esc(p.id)}"${p.id===m.projectId?" selected":""}>${esc(p.name)}</option>`).join("")}</select>`;
      pc.querySelector("select").onchange=e=>mtgMove(e.target.value);
      right.appendChild(pc);
    }
    right.appendChild(peoplePanel(m,ed));
    const go=document.createElement("div");go.className="mtggo";
    go.innerHTML=(ed?`<button type="button" class="btn primary" data-go>Démarrer la réunion</button>`:"")+((m.agenda||[]).length?`<button type="button" class="btn" data-mail>Envoyer l'ordre du jour par e-mail</button>`:"");
    const gb=go.querySelector("[data-go]");if(gb)gb.onclick=()=>{mtgPhase="run";mtgIdx=0;renderMtg()};
    const mb=go.querySelector("[data-mail]");if(mb)mb.onclick=()=>agendaMail(mtgCur);
    right.appendChild(go);
    B.className="mtgbody prep";B.append(left,right);
  }
  function mtgRun(B,m,ed){
    const ag=m.agenda||[];
    if(!ag.length){B.className="mtgbody";B.innerHTML=`<div class="empty">L'ordre du jour est vide. Passez par « Préparation » pour choisir les sujets.</div>`;return}
    mtgIdx=Math.min(Math.max(0,mtgIdx),ag.length-1);
    const a=ag[mtgIdx], s=subjOf(m,a), items=(m.items||[]).map((it,i)=>({...it,i})).filter(it=>it.subj===a.key);
    const left=document.createElement("aside");left.className="mtgcard mtgag";
    const nd=ag.filter(x=>x.done).length;
    left.innerHTML=`<h3>Ordre du jour <span class="muted">${nd} traité${nd>1?"s":""} sur ${ag.length}</span></h3><ol>${ag.map((x,i)=>`<li><button type="button" data-g="${i}" class="${i===mtgIdx?"cur":""}${x.done?" done":""}"><span class="st" aria-hidden="true">${x.done?"✓":i===mtgIdx?"●":""}</span><span><small>${esc(x.label||"")}</small>${esc(x.title)}</span></button></li>`).join("")}</ol>`;
    left.querySelectorAll("[data-g]").forEach(b=>b.onclick=()=>{mtgIdx=+b.dataset.g;mtgForm=null;renderMtg()});
    const mid=document.createElement("section");mid.className="mtgmid";
    let head="",body="";
    if(s.o){const o=s.o;head=`<div class="mtgk">${esc([ptNumOf(o)||"Point ouvert",o.theme,o.erp==="oui"?"Sujet ERP":""].filter(Boolean).join(" · "))}${o.owner?` <span class="tag who">${esc(OWNER[o.owner])} doit répondre</span>`:""}${o.status==="closed"?` <span class="tag">Levé</span>`:""}</div><h2 class="rt">${rtHtml(o.text)}</h2>`;
      body=(o.hypothesis||o.answer)?`<div class="mtgcom">${o.hypothesis?`<div class="c-mec"><b>Commentaire Mecalux</b><div class="rt">${rtHtml(o.hypothesis)}</div></div>`:""}${o.answer?`<div class="c-cli"><b>Réponse client</b><div class="rt">${rtHtml(o.answer)}</div></div>`:""}</div>`:""}
    else if(s.t){const t=s.t;head=`<div class="mtgk">${esc(a.label||"Tâche")}</div><h2>${esc(t.title)}</h2>`;body=`<p class="muted">${esc([STATUS[t.status],t.due?"échéance "+shortDay(t.due).toLowerCase():"sans échéance",t.who?"responsable : "+whoName(t):""].filter(Boolean).join(" · "))}</p>`}
    else if(s.r){const r=s.r;head=`<div class="mtgk">Demande client</div><h2>${esc(r.title)}</h2>`;body=r.description?`<div class="muted rt">${rtHtml(r.description)}</div>`:""}
    else head=`<div class="mtgk">${esc(a.label||"Sujet")}</div><h2>${esc(a.title)}</h2>`;
    const acts=[];
    if(s.o&&s.o.status!=="closed")acts.push(["close","Lever le point","avec la réponse obtenue"]);
    if(s.t&&s.t.status!=="done")acts.push(["taskdone","Tâche terminée","marquée faite à la validation"]);
    acts.push(["decision","Décision","ajoutée au relevé"],["action","Action","deviendra une tâche"],["newpoint","Nouveau point","deviendra un point ouvert"]);
    const ppl=mtgPeople(m);
    mid.innerHTML=`<div class="mtgsubj">${head}${body}</div>
      ${ed?`<div class="mtgacts">${acts.map(([k,l,d])=>`<button type="button" data-act="${k}" class="a-${k}${mtgForm===k?" on":""}"><b>${l}</b><span>${d}</span></button>`).join("")}</div>`:""}
      <div class="mtgform"></div>
      <div class="mtgitems">${items.length?`<h4>Relevé sur ce sujet</h4>`+items.map(it=>{const t=ITYPE[it.type]||["Note","#3A4B55","#EEF2F5"];return `<div class="mtgit"><span class="ity" style="color:${t[1]};background:${t[2]}">${t[0]}</span><span class="itx">${esc(mtgItemText(it))}</span>${ed?`<button type="button" data-del="${it.i}" aria-label="Retirer">✕</button>`:""}</div>`}).join(""):""}</div>
      <div class="mtgnav"><button type="button" class="btn" data-nav="-1" ${mtgIdx===0?"disabled":""}>‹ Sujet précédent</button>
        ${ed?`<label class="mtgdone"><input type="checkbox" ${a.done?"checked":""}> Sujet traité</label>`:""}
        ${mtgIdx<ag.length-1?`<button type="button" class="btn" data-nav="1">Sujet suivant ›</button>`:`<button type="button" class="btn primary" data-end>Terminer et voir le compte rendu</button>`}</div>`;
    mid.querySelectorAll("[data-act]").forEach(b=>b.onclick=()=>{const k=b.dataset.act;
      if(k==="taskdone"){mtgSet(mm=>{(mm.items=mm.items||[]).push({id:uid(),type:"taskdone",subj:a.key,ref:a.ref});mm.agenda[mtgIdx].done=true});return}
      mtgForm=mtgForm===k?null:k;renderMtg()});
    mid.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>mtgSet(mm=>{mm.items.splice(+b.dataset.del,1)}));
    mid.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>{mtgIdx+=+b.dataset.nav;mtgForm=null;renderMtg()});
    const en=mid.querySelector("[data-end]");if(en)en.onclick=()=>{mtgPhase="review";renderMtg()};
    const dn=mid.querySelector(".mtgdone input");if(dn)dn.onchange=()=>mtgSet(mm=>{mm.agenda[mtgIdx].done=dn.checked});
    // formulaire de saisie de l'élément choisi
    const F=mid.querySelector(".mtgform");
    if(ed&&mtgForm){
      const whoOpts=`<option value="">—</option>`+ppl.map(x=>`<option value="${esc(x.email||x.name)}">${esc(x.name)} (${esc(SIDE[x.side]||"")})</option>`).join("");
      const lbl={close:"Réponse ou décision obtenue",decision:"Décision prise",action:"Action à mener",newpoint:"Nouvelle question à trancher"}[mtgForm];
      F.innerHTML=`<form autocomplete="off" class="f-${mtgForm}"><label class="uifld wide"><span>${lbl}</span><textarea data-rt rows="2" aria-label="${lbl}"></textarea></label>
        ${mtgForm==="action"?`<label class="uifld"><span>Qui</span><select data-w>${whoOpts}</select></label><label class="uifld"><span>Pour le</span><input type="date" data-d></label>`:""}
        ${mtgForm==="newpoint"?`<label class="uifld"><span>Qui doit répondre</span><select data-o><option value="client">Client</option><option value="mecalux">Mecalux</option><option value="tiers">Tiers</option><option value="">Non défini</option></select></label>`:""}
        <div class="fbtns"><button type="button" class="btn ghost" data-cancel>Annuler</button><button type="submit" class="btn primary">Ajouter</button></div></form>`;
      const fm=F.querySelector("form"),ta=fm.querySelector("textarea");
      setTimeout(()=>ta.focus(),0);
      ta.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();fm.requestSubmit()}});
      fm.querySelector("[data-cancel]").onclick=()=>{mtgForm=null;renderMtg()};
      fm.onsubmit=e=>{e.preventDefault();const text=ta.value.trim();if(!text&&mtgForm!=="close")return;
        const it={id:uid(),type:mtgForm,subj:a.key,text};
        if(mtgForm==="close")it.ref=a.ref;
        if(mtgForm==="action"){it.who=fm.querySelector("[data-w]").value;it.due=fm.querySelector("[data-d]").value}
        if(mtgForm==="newpoint"){it.owner=fm.querySelector("[data-o]").value;it.theme=(s.o&&s.o.theme)||m.theme||""}
        mtgForm=null;
        mtgSet(mm=>{(mm.items=mm.items||[]).push(it);mm.agenda[mtgIdx].done=true});
      };
    }
    const right=document.createElement("div");right.className="mtgside";
    right.appendChild(peoplePanel(m,ed));
    const tot=document.createElement("section");tot.className="mtgcard";
    const cnt=k=>(m.items||[]).filter(i=>i.type===k).length;
    tot.innerHTML=`<h3>Relevé de la réunion</h3><div class="mtgtot">${[["close","point(s) levé(s)"],["decision","décision(s)"],["action","action(s)"],["newpoint","nouveau(x) point(s)"]].map(([k,l])=>`<div><b>${cnt(k)}</b> ${l}</div>`).join("")}</div>`;
    right.appendChild(tot);
    const nt=document.createElement("label");nt.className="mtgcard mtgnotes";
    nt.innerHTML=`<h3>Notes libres</h3><textarea data-rt aria-label="Notes libres" placeholder="Notes de séance (reprises dans le compte rendu si vous le souhaitez)…" ${ed?"":"readonly"}></textarea>`;
    const ntA=nt.querySelector("textarea");ntA.value=m.notes||"";
    ntA.oninput=()=>{if(!mtgEdit())return;mtgCur.notes=ntA.value;mtgPut(mtgCur)};
    right.appendChild(nt);
    B.className="mtgbody run";B.append(left,mid,right);
  }
  // Contenu du compte rendu (aperçu et PDF)
  function crSections(m,opt){
    const it=m.items||[], present=(m.participants||[]).filter(x=>x.present), absent=(m.participants||[]).filter(x=>!x.present);
    const by=k=>it.filter(i=>i.type===k);
    const closedIds=new Set(by("close").map(i=>i.ref));
    const S=[];
    if(opt.decisions&&by("decision").length)S.push(["Décisions",`<ul>${by("decision").map(i=>`<li class="rt">${rtHtml(i.text)}</li>`).join("")}</ul>`]);
    if(opt.closed&&by("close").length)S.push(["Points levés",`<table><thead><tr><th class="n">N°</th><th>Point</th><th>Réponse / décision</th></tr></thead><tbody>${by("close").map(i=>{const o=(state.points||[]).find(x=>x.id===i.ref)||{};return `<tr><td class="n">${esc(o.id?ptLabel(o):"")}</td><td>${esc(o.text||"")}</td><td class="pre">${esc(i.text||"")}</td></tr>`}).join("")}</tbody></table>`]);
    if(opt.done&&by("taskdone").length)S.push(["Tâches terminées",`<ul>${by("taskdone").map(i=>{const t=state.tasks.find(x=>x.id===i.ref);return `<li>${esc(t?t.title:"")}</li>`}).join("")}</ul>`]);
    if(opt.actions&&by("action").length)S.push(["Actions",`<table><thead><tr><th>Action</th><th class="w">Qui</th><th class="d">Pour le</th></tr></thead><tbody>${by("action").map(i=>`<tr><td class="rt">${rtHtml(i.text)}</td><td>${esc(i.who?nameOf(i.who):"")}</td><td>${esc(i.due?parseD(i.due).toLocaleDateString("fr-FR"):"")}</td></tr>`).join("")}</tbody></table>`]);
    if(opt.newpoints&&by("newpoint").length)S.push(["Nouveaux points ouverts",`<ul>${by("newpoint").map(i=>`<li><span class="rt">${rtHtml(i.text)}</span>${i.owner?` <span class="mut">– à répondre par : ${esc(OWNER[i.owner]||"")}</span>`:""}</li>`).join("")}</ul>`]);
    if(opt.open){
      const rest=livePts().filter(o=>o.projectId===m.projectId&&o.status!=="closed"&&!closedIds.has(o.id)&&(m.kind==="atelier"&&m.theme?o.theme===m.theme:(m.agenda||[]).some(a=>a.ref===o.id)));
      if(rest.length)S.push(["Points restant ouverts",`<table><thead><tr><th class="n">N°</th><th>Point</th><th class="w">Doit répondre</th></tr></thead><tbody>${rest.map(o=>`<tr><td class="n">${esc(ptLabel(o))}</td><td>${esc(o.text)}</td><td>${esc(o.owner?OWNER[o.owner]:"")}</td></tr>`).join("")}</tbody></table>`]);
    }
    if(opt.notes&&(m.notes||"").trim())S.push(["Notes",`<div class="rt">${rtHtml(m.notes.trim())}</div>`]);
    if((m.nextMeeting||"").trim())S.push(["Prochaine réunion",`<p>${esc(m.nextMeeting.trim())}</p>`]);
    const p=proj(m.projectId)||{name:""};
    const head=`<header${pLogo(p)?` class="hl"`:""}><div><div class="k">Compte rendu${m.kind!=="autre"?" – "+esc(MTG_KIND[m.kind]):""}</div><h1>${esc(p.name)} – ${esc(m.title)}</h1><div class="when">${esc(mtgWhen(m))}</div></div>${pLogo(p)?`<img class="crlogo" src="${p.logo}" alt="Logo ${esc(p.name)}">`:""}</header>
      <dl>${present.length?`<dt>Présents</dt><dd>${esc(present.map(x=>x.name+(x.side?" ("+(SIDE[x.side]||"")+")":"")).join(", "))}</dd>`:""}${absent.length?`<dt>Absents</dt><dd>${esc(absent.map(x=>x.name).join(", "))}</dd>`:""}</dl>`;
    return head+(S.length?S.map(([t,h],i)=>`<section><h2>${i+1}. ${t}</h2>${h}</section>`).join(""):`<p class="mut">Aucun élément relevé pour le moment.</p>`)
      +`<footer>Compte rendu établi${MODE==="cloud"&&cloud.email?" par "+esc(nameOf(cloud.email)):""} le ${new Date().toLocaleDateString("fr-FR")}</footer>`;
  }
  const CR_CSS=`.crdoc{font:10.5pt/1.45 Arial,Helvetica,sans-serif;color:#16232B}
    .crdoc header{border-bottom:2px solid #16232B;padding-bottom:8px;margin-bottom:10px}.crdoc header.hl{display:flex;justify-content:space-between;align-items:center;gap:16px}.crdoc .crlogo{max-height:52px;max-width:160px;object-fit:contain;flex:none}.crdoc .k{font-size:8.5pt;letter-spacing:.08em;text-transform:uppercase;color:#51646F}
    .crdoc h1{font-size:17pt;margin:2px 0}.crdoc .when{color:#3A4B55}.crdoc dl{display:grid;grid-template-columns:70px 1fr;gap:3px 8px;margin:0 0 6px}.crdoc dt{color:#51646F}.crdoc dd{margin:0}
    .crdoc h2{font-size:11pt;text-transform:uppercase;letter-spacing:.04em;color:#1F4A66;margin:14px 0 4px}.crdoc ul{margin:0;padding-left:18px}.crdoc table{width:100%;border-collapse:collapse}
    .crdoc th{text-align:left;font-size:8.5pt;text-transform:uppercase;color:#51646F;padding:3px 6px 3px 0;border-bottom:1px solid #C7D1D8}.crdoc td{padding:5px 6px 5px 0;border-bottom:1px solid #E6EBEE;vertical-align:top}
    .crdoc .n{width:42px;white-space:nowrap}.crdoc .w{width:28%}.crdoc .d{width:14%}.crdoc .pre{white-space:pre-wrap}.crdoc .mut{color:#51646F}
    .crdoc footer{margin-top:18px;font-size:8.5pt;color:#51646F;border-top:1px solid #E6EBEE;padding-top:6px}`;
  const crOpt=()=>Object.assign({decisions:true,closed:true,done:true,actions:true,newpoints:true,open:false,notes:true},ui.crOpt||{});
  function mtgPdf(m){
    const p=proj(m.projectId)||{name:"projet"};
    const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(mtgLabel(m))}</title><style>@page{size:A4;margin:16mm 15mm}body{margin:0}${CR_CSS}</style></head><body><div class="crdoc">${crSections(m,crOpt())}</div></body></html>`;
    printHtml(html,`compte-rendu-${slug(p.name)}-${slug(m.title)}-${iso(mtgDate(m))}`);
  }
  function mtgReview(B,m,ed){
    const it=m.items||[], o=crOpt();
    const n=k=>it.filter(i=>i.type===k).length;
    const left=document.createElement("aside");left.className="mtgcard mtgrev";
    const ck=(k,l,c)=>`<label><input type="checkbox" data-o="${k}" ${o[k]?"checked":""}> ${l}${c!=null?` <span class="muted">(${c})</span>`:""}</label>`;
    left.innerHTML=`<h3>Compte rendu</h3>
      <div class="mtgtot"><div><b>${n("close")}</b> point(s) levé(s)</div><div><b>${n("decision")}</b> décision(s)</div><div><b>${n("action")}</b> action(s)</div><div><b>${n("newpoint")}</b> nouveau(x) point(s)</div></div>
      <fieldset><legend>Contenu</legend>${ck("decisions","Décisions",n("decision"))}${ck("closed","Points levés et réponses",n("close"))}${ck("done","Tâches terminées",n("taskdone"))}${ck("actions","Actions",n("action"))}${ck("newpoints","Nouveaux points ouverts",n("newpoint"))}${ck("open","Points restant ouverts",null)}${ck("notes","Notes libres",null)}</fieldset>
      <label class="uifld"><span>Prochaine réunion</span><input type="text" data-next maxlength="300" placeholder="Ex. : atelier Expédition, vendredi 16 octobre à 14:00" ${ed?"":"readonly"}></label>
      ${ed?`<p class="muted">Rien n'est encore modifié dans le projet. À la validation, les actions deviennent des tâches, les nouveaux points sont créés et les points levés sont mis à jour.</p>
        <button type="button" class="btn primary" data-val>Valider et appliquer au projet</button>`:`<p class="muted">Compte rendu validé le ${new Date(m.validatedAt).toLocaleDateString("fr-FR")} : les tâches et les points ont été créés dans le projet.</p>`}
      <button type="button" class="btn" data-pdf>Télécharger en PDF</button>
      <button type="button" class="btn ghost dangerlink" data-rm>Supprimer ce compte rendu</button>`;
    const nx=left.querySelector("[data-next]");nx.value=m.nextMeeting||"";
    nx.oninput=()=>{if(!mtgEdit())return;mtgCur.nextMeeting=nx.value;mtgPut(mtgCur);paint()};
    left.querySelectorAll("[data-o]").forEach(cb=>cb.onchange=()=>{ui.crOpt={...crOpt(),[cb.dataset.o]:cb.checked};saveUi();paint()});
    left.querySelector("[data-pdf]").onclick=()=>mtgPdf(mtgCur);
    const vb=left.querySelector("[data-val]");if(vb)vb.onclick=()=>mtgValidate();
    left.querySelector("[data-rm]").onclick=async()=>{
      if(!await uiConfirm(`Supprimer le compte rendu « ${mtgLabel(m)} » ?${m.status==="validated"?"\n\nLes tâches et points déjà créés dans le projet sont conservés.":""}`,{ok:"Supprimer",danger:true}))return;
      mtgCur.deletedAt=Date.now();mtgPut(mtgCur,true);mtgCur=null;renderMtg();render();toast("Compte rendu supprimé.");
    };
    const right=document.createElement("div");right.className="mtgprev";
    const doc=document.createElement("article");doc.className="crdoc crpage";right.appendChild(doc);
    const paint=()=>{doc.innerHTML=crSections(mtgCur,crOpt())};paint();
    let st=$("#crcss");if(!st){st=document.createElement("style");st.id="crcss";st.textContent=CR_CSS;document.head.appendChild(st)}
    B.className="mtgbody review";B.append(left,right);
  }
  async function mtgValidate(){
    const m=mtgCur;if(!m||m.status!=="draft")return;
    const it=m.items||[], n=k=>it.filter(i=>i.type===k).length;
    if(!await uiConfirm(`Valider le compte rendu et l'appliquer au projet ?\n\n• ${n("action")} action(s) deviendront des tâches\n• ${n("newpoint")} nouveau(x) point(s) ouvert(s) seront créés\n• ${n("close")} point(s) seront levés\n• ${n("taskdone")} tâche(s) seront marquées terminées\n\nLe compte rendu ne sera plus modifiable.`,{ok:"Valider"}))return;
    const now=Date.now(), src=`Issu de : ${mtgLabel(m)}`;
    it.forEach((i,k)=>{
      if(i.type==="action"){const id=newId();state.tasks.push({id,projectId:m.projectId,title:rtText(i.text).split("\n")[0].slice(0,300),priority:"normale",due:i.due||"",status:"todo",note:rtJoin(rtIs(i.text)||i.text.includes("\n")?i.text:"",src),who:resolveWho(i.who||"",m.projectId),createdAt:now+k,checklist:[],repeat:null});i.createdId=id}
      if(i.type==="newpoint"){const id=newId();state.points.push({id,projectId:m.projectId,text:rtCut(i.text,2000),answer:"",hypothesis:"",erp:"",theme:(i.theme||"").slice(0,80),owner:i.owner||"",ownerName:"",status:"open",taskId:null,requestId:null,createdAt:now+k,closedAt:null});i.createdId=id}
      if(i.type==="close"){const o=(state.points||[]).find(x=>x.id===i.ref);if(o){if(i.text)o.answer=rtJoin(o.answer,i.text);o.status="closed";o.closedAt=now}}
      if(i.type==="taskdone"){const t=state.tasks.find(x=>x.id===i.ref);if(t)applyStatus(t,"done")}
    });
    m.status="validated";m.validatedAt=now;
    save();mtgPut(m,true);renderMtg();render();
    toast("Compte rendu validé : tâches et points mis à jour dans le projet.");
  }
  // ---------- Onglet Réunions d'un projet ----------
  function renderMeetings(L,p){
    const top=document.createElement("div");top.className="mtgtop";
    top.innerHTML=`<button type="button" class="btn primary" data-new>Nouvelle réunion</button><span class="muted">${MODE==="cloud"?"Choisissez la réunion dans votre agenda Outlook, ou créez une réunion hors Outlook.":"Astuce : en mode en ligne, vous pouvez rattacher le compte rendu à une réunion de votre agenda Outlook."}</span>`;
    top.querySelector("[data-new]").onclick=()=>mtgStart(p);
    L.appendChild(top);
    const ms=mtgList(p.id);
    const g=document.createElement("section");g.className="group";
    g.innerHTML=`<h2>Comptes rendus <span>${ms.length}</span></h2>`;
    if(!ms.length)g.insertAdjacentHTML("beforeend",`<div class="empty">Aucune réunion pour ce projet. Créez-en une, ou partez d'une réunion Outlook dans l'agenda.</div>`);
    else{
      const ul=document.createElement("ul");ul.className="tasks";
      ms.forEach(m=>{const li=document.createElement("li");li.className="task mtgrow";li.dataset.m=m.id;
        const c=k=>(m.items||[]).filter(i=>i.type===k).length;
        li.innerHTML=`<span class="mtgdate">${esc(mtgDate(m).toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}))}</span><div><div class="ttl">${esc(m.title)}</div><div class="meta"><span class="tag">${esc(MTG_KIND[m.kind]||"Réunion")}${m.theme?" · "+esc(m.theme):""}</span><span class="tag ${m.status==="validated"?"done-t":"wait"}">${m.status==="validated"?"Validé":"Brouillon"}</span>${c("decision")?`<span class="tag">${c("decision")} décision(s)</span>`:""}${c("action")?`<span class="tag">${c("action")} action(s)</span>`:""}${c("close")?`<span class="tag">${c("close")} point(s) levé(s)</span>`:""}</div></div><div class="acts"><button type="button" class="sbtn">Ouvrir</button><button type="button" class="sbtn" data-del aria-label="Supprimer le compte rendu ${esc(m.title)}" title="Supprimer">✕</button></div>`;
        li.querySelector("[data-del]").onclick=e=>{e.stopPropagation();mtgDelete(m)};
        li.onclick=()=>mtgOpen(m);ul.appendChild(li)});
      g.appendChild(ul);
    }
    L.appendChild(g);
    // contacts du projet
    const cs=ctList(p.id);
    const cg=document.createElement("section");cg.className="group";
    cg.innerHTML=`<h2>Contacts du projet <span>${cs.length}</span></h2><div class="mtgcts">${cs.map(c=>`<div class="mtgct"><b>${esc(c.name)}</b>${c.role?` <span class="muted">${esc(c.role)}</span>`:""}<em>${esc(SIDE[c.side]||"")}</em>${c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:""}<button type="button" data-x="${esc(c.id)}" aria-label="Retirer ${esc(c.name)}">✕</button></div>`).join("")||`<p class="muted">Ajoutez les interlocuteurs du client : ils seront proposés comme participants des réunions.</p>`}</div>
      <form class="mtgctadd" autocomplete="off"><input type="text" data-n placeholder="Nom" aria-label="Nom du contact" maxlength="120" required><input type="text" data-r placeholder="Fonction (facultatif)" aria-label="Fonction" maxlength="120"><input type="email" data-e placeholder="E-mail (facultatif)" aria-label="E-mail" maxlength="200"><select data-s aria-label="Côté">${Object.entries(SIDE).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select><button class="btn" type="submit">Ajouter</button></form>`;
    cg.querySelectorAll("[data-x]").forEach(b=>b.onclick=async()=>{const c=cs.find(x=>x.id===b.dataset.x);if(c&&await uiConfirm(`Retirer « ${c.name} » des contacts du projet ?`,{ok:"Retirer",danger:true})){await ctDel(p.id,c.id);render()}});
    const f=cg.querySelector("form");f.onsubmit=async e=>{e.preventDefault();const r=await ctAdd(p.id,{name:f.querySelector("[data-n]").value,role:f.querySelector("[data-r]").value,email:f.querySelector("[data-e]").value,side:f.querySelector("[data-s]").value});if(r)render()};
    L.appendChild(cg);
  }
  // ---------- Visites sur site (prise de notes par flux, photos, hors connexion) ----------
  // Une visite = un document (flux + notes). Tout est d'abord enregistré sur l'appareil (IndexedDB) : la visite
  // fonctionne sans réseau. En mode en ligne, les visites et les photos partent dès que la connexion le permet
  // (table « visits », stockage privé « visit-photos », chemin <projet>/<visite>/<photo>.jpg).
  const VIS_FLOWS=["Réception","Stockage","Réapprovisionnement","Préparation","Expédition","Gestion de stock","Inventaire"];
  const NTYPE={note:["Note","nt-note"],question:["Question client","nt-q"],action:["Action","nt-act"]};
  const VIS_MAX=1600, VIS_Q=0.8;
  const vis={map:{},loaded:false,loading:null,pending:0,flushing:false,err:"",urls:{},t:null};
  const visAcct=()=>MODE==="cloud"&&cloud.user?cloud.user.id:"local";
  let visDbP=null;
  function visDb(){return visDbP||(visDbP=new Promise((res,rej)=>{const r=indexedDB.open("todo-projets-visites",1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("visits"))d.createObjectStore("visits",{keyPath:"id"});if(!d.objectStoreNames.contains("photos"))d.createObjectStore("photos",{keyPath:"id"})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}))}
  async function idb(st,mode,fn){const d=await visDb();return new Promise(res=>{let out;const t=d.transaction(st,mode);const q=fn(t.objectStore(st));if(q)q.onsuccess=()=>{out=q.result};t.oncomplete=()=>res(out);t.onerror=t.onabort=()=>res(undefined)})}
  const idbAll=st=>idb(st,"readonly",s=>s.getAll()).then(r=>r||[]);
  const idbGet=(st,k)=>idb(st,"readonly",s=>s.get(k));
  const idbPut=(st,v)=>idb(st,"readwrite",s=>s.put(v));
  const idbDel=(st,k)=>idb(st,"readwrite",s=>s.delete(k));
  const rowVis=v=>({id:v.id,project_id:v.projectId,title:v.title||"",started_at:v.startedAt||null,ended_at:v.endedAt||null,status:v.status||"open",flows:v.flows||[],notes:v.notes||[],prep:v.prep||{},items:v.items||[],sync:v.sync||{},updated_at:v.updatedAt||Date.now(),deleted_at:v.deletedAt||null});
  const fromVis=r=>({id:r.id,projectId:r.project_id,title:r.title||"",startedAt:r.started_at?Number(r.started_at):null,endedAt:r.ended_at?Number(r.ended_at):null,status:r.status||"open",flows:Array.isArray(r.flows)?r.flows:[],notes:Array.isArray(r.notes)?r.notes:[],prep:r.prep&&typeof r.prep==="object"?r.prep:{},items:Array.isArray(r.items)?r.items:[],sync:r.sync&&typeof r.sync==="object"?r.sync:{},createdBy:r.created_by||"",createdAt:Number(r.created_at)||0,updatedAt:Number(r.updated_at)||0,deletedAt:r.deleted_at?Number(r.deleted_at):null});
  const visDate=v=>v.startedAt||(v.prep&&v.prep.plannedAt)||v.createdAt||Date.now();
  // Déplacement sur plusieurs jours : dernier jour facultatif (prep.endDay, AAAA-MM-JJ)
  const visStartDay=v=>iso(new Date(visDate(v)));
  const visEndDay=v=>{const e=v.prep&&v.prep.endDay, s=visStartDay(v);return e&&e>s?e:s};
  const visNDays=v=>Math.min(60,Math.round((new Date(visEndDay(v)+"T12:00")-new Date(visStartDay(v)+"T12:00"))/864e5)+1);
  const visRangeTxt=(v,long)=>{const n=visNDays(v), a=new Date(visStartDay(v)+"T12:00"), b=new Date(visEndDay(v)+"T12:00");
    if(n<2)return a.toLocaleDateString("fr-FR",long?{weekday:"long",day:"numeric",month:"long"}:{weekday:"short",day:"numeric",month:"short"});
    const same=a.getMonth()===b.getMonth()&&a.getFullYear()===b.getFullYear();
    return `du ${a.toLocaleDateString("fr-FR",long?{weekday:"long",day:"numeric",...(same?{}:{month:"long"})}:{day:"numeric",...(same?{}:{month:"short"})})} au ${b.toLocaleDateString("fr-FR",long?{weekday:"long",day:"numeric",month:"long"}:{day:"numeric",month:"short"})} (${n} jours)`};
  // Types de déplacement : visite d'analyse fonctionnelle (par flux), dry run (à venir), mise en service (compte rendu par jour)
  const VIS_TYPES={af:{l:"Visite d'analyse fonctionnelle",days:2,d:"Notes par flux (réception, stockage, préparation…), éléments à voir, bilan en points ouverts et tâches."},
    dry:{l:"Dry run",days:1,soon:true,d:"Répétition générale avant la mise en service."},
    mes:{l:"Mise en service",days:5,d:"Un compte rendu par jour : actions réalisées, problèmes, actions à venir, statut et ressentis. Notes, photos et vocaux du jour."}};
  const visKind=v=>(v&&v.prep&&VIS_TYPES[v.prep.type]&&v.prep.type)||"af";
  const isMes=v=>visKind(v)==="mes";
  const visDays=v=>{const d0=new Date(visStartDay(v)+"T12:00");return Array.from({length:visNDays(v)},(_,j)=>iso(addDays(d0,j)))};
  const dayLbl=(d,long)=>new Date(d+"T12:00").toLocaleDateString("fr-FR",long?{weekday:"long",day:"numeric",month:"long"}:{weekday:"short",day:"numeric",month:"short"});
  // Pour le calendrier de l'appli : déplacements datés de tous les projets visibles (bande colorée sur les jours concernés)
  window.__dpTrips=()=>{try{visEnsure();return Object.values(vis.map).map(x=>x.v).filter(v=>!v.deletedAt&&!(v.status==="prep"&&!(v.prep&&v.prep.plannedAt))).map(v=>{const pj=proj(v.projectId);if(!pj||pj.archived)return null;
    return {id:v.id,s:visStartDay(v),e:visEndDay(v),title:v.title||"Déplacement",pname:pj.name,color:pj.color||"#3E7CB1",st:{prep:"prévu",open:"en cours",done:"terminé"}[v.status]||""}}).filter(Boolean)}catch(e){return []}};
  const visList=pid=>Object.values(vis.map).map(x=>x.v).filter(v=>v.projectId===pid&&!v.deletedAt).sort((a,b)=>((b.status==="prep")-(a.status==="prep"))||(a.status==="prep"?visDate(a)-visDate(b):visDate(b)-visDate(a)));
  const visFlows=v=>(v.flows||[]).filter(f=>!f.off);
  const visItems=(v,fid)=>(v.items||[]).filter(i=>i.flow===fid&&!i.mk);
  const themeKey=x=>norm(x||"").replace(/s$/,"");
  // Reprend dans « À voir » les points ouverts du projet attendant le client, dont le thème correspond au flux
  function visSeed(v){
    let n=0;const have=new Set((v.items||[]).filter(i=>i.ref).map(i=>i.ref));v.items=v.items||[];
    livePts().filter(o=>o.projectId===v.projectId&&o.status!=="closed"&&o.owner==="client"&&!have.has(o.id)).forEach(o=>{
      const f=(v.flows||[]).find(f=>!f.off&&themeKey(f.name)===themeKey(o.theme));if(!f)return;
      v.items.push({id:uid(),flow:f.id,kind:"point",ref:o.id,text:o.text.split("\n")[0].slice(0,300),label:ptNumOf(o)||"Point ouvert",seen:false});n++;
    });
    return n;
  }
  // ---- Fusion : deux appareils (ou deux personnes) peuvent modifier la même visite sans s'écraser ----
  // Chaque note, élément « À voir » et flux porte un horodatage (u) ; les suppressions sont mémorisées (sync.gone).
  const VIS_RANK={prep:0,open:1,done:2};
  function visStamp(v,prev){
    const now=Date.now();v.sync=v.sync||{};const gone=new Set(v.sync.gone||[]);
    const strip=x=>{const {u,...r}=x;return JSON.stringify(r)};
    ["notes","items","flows"].forEach(k=>{
      const old=new Map(((prev&&prev[k])||[]).map(x=>[x.id,x]));
      (v[k]||[]).forEach(x=>{const o=old.get(x.id);if(!o||strip(o)!==strip(x))x.u=now;old.delete(x.id)});
      old.forEach((_,id)=>gone.add(id));
    });
    v.sync.gone=[...gone].slice(-3000);
    if(!prev||JSON.stringify(prev.prep||{})!==JSON.stringify(v.prep||{}))v.sync.pu=now;
    const meta=x=>JSON.stringify([x.title,x.status,x.startedAt||null,x.endedAt||null]);
    if(!prev||meta(prev)!==meta(v))v.sync.mu=now;
    const ord=x=>(x.flows||[]).map(f=>f.id).join(",");
    if(!prev||ord(prev)!==ord(v))v.sync.ou=now;
  }
  function visMerge(a,b){ // a : version de cet appareil ; b : version du serveur
    const sa=a.sync||{}, sb=b.sync||{}, gone=new Set([...(sa.gone||[]),...(sb.gone||[])]);
    const m=JSON.parse(JSON.stringify((sa.mu||0)>=(sb.mu||0)?a:b)), o=m===a?b:((sa.mu||0)>=(sb.mu||0)?b:a);
    const un=k=>{const map=new Map();[...(b[k]||[]),...(a[k]||[])].forEach(x=>{const p=map.get(x.id);if(!p||(x.u||0)>=(p.u||0))map.set(x.id,JSON.parse(JSON.stringify(x)))});return [...map.values()].filter(x=>!gone.has(x.id))};
    m.notes=un("notes").sort((x,y)=>(x.at||0)-(y.at||0));
    const ordItems=[...(a.items||[]),...(b.items||[])].map(x=>x.id), ip=new Map();ordItems.forEach((id,i)=>{if(!ip.has(id))ip.set(id,i)});
    m.items=un("items").sort((x,y)=>ip.get(x.id)-ip.get(y.id));
    const src=((sa.ou||0)>=(sb.ou||0)?a:b).flows||[], pos=new Map(src.map((f,i)=>[f.id,i]));
    m.flows=un("flows").sort((x,y)=>(pos.has(x.id)?pos.get(x.id):1e9)-(pos.has(y.id)?pos.get(y.id):1e9));
    m.prep=JSON.parse(JSON.stringify(((sa.pu||0)>=(sb.pu||0)?a:b).prep||{}));
    // une visite démarrée ou terminée ne revient jamais à l'état « préparée »
    if(m.status==="prep"&&o.status!=="prep"){m.status=o.status;m.endedAt=o.endedAt||null}
    m.startedAt=[a.startedAt,b.startedAt].filter(Boolean).sort((x,y)=>x-y)[0]||null;
    m.sync={gone:[...gone].slice(-3000),mu:Math.max(sa.mu||0,sb.mu||0),pu:Math.max(sa.pu||0,sb.pu||0),ou:Math.max(sa.ou||0,sb.ou||0)};
    m.updatedAt=Math.max(a.updatedAt||0,b.updatedAt||0);
    m.deletedAt=a.deletedAt||b.deletedAt||null;
    return m;
  }
  // Remplace la visite affichée par sa version fusionnée (sans perdre l'écran en cours ni une saisie)
  function visAdopt(v){
    if(!visCur||visCur.id!==v.id)return;
    if(JSON.stringify(visCur)===JSON.stringify(v))return;
    visCur=JSON.parse(JSON.stringify(v));visCur.items=visCur.items||[];visCur.prep=visCur.prep||{};
    if(visCur.deletedAt){visCur=null;renderVisit();render();return}
    const a=document.activeElement;if(a&&a.closest&&a.closest("#visview")&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))return;
    renderVisit();
  }
  // Charge les visites (appareil + serveur) ; relancé à l'ouverture de l'onglet, d'une visite et au retour sur l'appli
  function visLoad(force){
    if(vis.loading)return vis.loading;
    if(MODE==="cloud"&&!cloud.user)return Promise.resolve();
    if(vis.loaded&&!force&&Date.now()-(vis.at||0)<15e3)return Promise.resolve();
    vis.loading=(async()=>{
      const acct=visAcct();let m={};vis.acct=acct;
      if(vis.loaded&&vis.acct===acct)m={...vis.map};
      else try{(await idbAll("visits")).filter(r=>r.acct===acct).forEach(r=>m[r.id]=r)}catch(e){}
      let changed=!vis.loaded;
      if(MODE==="cloud"&&cloud.user&&navigator.onLine!==false){
        let data=null,error=true;try{({data,error}=await cloudClient().from("visits").select("*"))}catch(e){}
        if(!error)for(const row of data||[]){
          const v=fromVis(row), loc=m[v.id];
          if(!loc||(!loc.dirty&&v.updatedAt>=(loc.v.updatedAt||0))){if(!loc||JSON.stringify(loc.v)!==JSON.stringify(v)){m[v.id]={id:v.id,acct,v,dirty:false};idbPut("visits",m[v.id]);changed=true}}
          else if(loc.dirty){const mg=visMerge(loc.v,v);m[v.id]={id:v.id,acct,v:mg,dirty:true};idbPut("visits",m[v.id]);changed=true}
        }
        vis.at=Date.now();
      }
      vis.map=m;vis.loaded=true;vis.loading=null;
      await visCount();
      if(changed){if(visCur&&m[visCur.id])visAdopt(m[visCur.id].v);if(!visCur)render();else renderVisit()}
      visFlush();
    })();
    return vis.loading;
  }
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&vis.loaded)visLoad()});
  async function visCount(){
    const acct=visAcct();let n=Object.values(vis.map).filter(x=>x.dirty).length;
    try{n+=(await idbAll("photos")).filter(p=>p.acct===acct&&(!p.up||p.del)).length}catch(e){}
    vis.pending=MODE==="cloud"?n:0;
  }
  function visPut(v){
    visStamp(v,vis.map[v.id]&&vis.map[v.id].v);
    v.updatedAt=Date.now();
    const rec={id:v.id,acct:visAcct(),v:JSON.parse(JSON.stringify(v)),dirty:MODE==="cloud"};
    vis.map[v.id]=rec;idbPut("visits",rec).then(()=>visCount()).then(()=>{if(visCur)visStatus()});
    clearTimeout(vis.t);vis.t=setTimeout(visFlush,1500);
    if(v.prep&&v.prep.conf)confSchedule(v);
  }
  async function visFlush(){
    if(MODE!=="cloud"||!cloud.user||vis.flushing)return;
    if(navigator.onLine===false){await visCount();if(visCur)visStatus();return}
    vis.flushing=true;vis.err="";
    try{
      const acct=visAcct(), c=cloudClient();
      for(const p of (await idbAll("photos")).filter(p=>p.acct===acct&&(p.del||!p.up))){
        const r=visMediaRef(p), st=c.storage.from(r.b), path=r.path;
        if(p.del){const {error}=await st.remove([path]);if(error&&transient(error))throw error;await idbDel("photos",p.id);continue}
        const {error}=await st.upload(path,p.blob,{contentType:r.ct,upsert:true});
        if(error){if(transient(error))throw error;vis.err=error.message;continue}
        p.up=true;await idbPut("photos",p);
      }
      for(const rec of Object.values(vis.map).filter(r=>r.dirty)){
        // avant d'envoyer : fusion avec la version du serveur (modifiée entre-temps sur un autre appareil ?)
        const {data:sv,error:e1}=await c.from("visits").select("*").eq("id",rec.id);
        if(e1){if(transient(e1))throw e1}
        else if(sv&&sv[0]){const mg=visMerge(rec.v,fromVis(sv[0]));if(JSON.stringify(mg)!==JSON.stringify(rec.v)){mg.updatedAt=Math.max(Date.now(),mg.updatedAt||0);rec.v=mg;await idbPut("visits",rec);visAdopt(mg)}}
        const sent=rec.v.updatedAt;
        const {error}=await c.from("visits").upsert(rowVis(rec.v));
        if(error){if(transient(error))throw error;vis.err=error.message;continue}
        const cur=vis.map[rec.id];if(cur&&cur.v.updatedAt===sent){cur.dirty=false;await idbPut("visits",cur)}
      }
      visCleanCache();
    }catch(e){vis.err=""}
    finally{vis.flushing=false}
    await visCount();if(visCur)visStatus();
  }
  window.addEventListener("online",()=>visFlush());
  // Emplacement d'un fichier de visite : photo (visit-photos, .jpg) ou enregistrement audio (visit-audio, .webm / .m4a)
  function visMediaRef(p){return p.kind==="audio"?{b:"visit-audio",path:`${p.pid}/${p.vid}/${p.id}.${p.ext||"webm"}`,ct:(p.mime||"audio/webm").split(";")[0]}:{b:"visit-photos",path:`${p.pid}/${p.vid}/${p.id}.jpg`,ct:"image/jpeg"}}
  // C. Demande au navigateur de ne pas effacer les données de l'appli (photos pas encore envoyées)
  function visPersist(){try{if(vis.persistAsked||!navigator.storage||!navigator.storage.persist)return;vis.persistAsked=true;navigator.storage.persisted().then(ok=>{if(!ok)return navigator.storage.persist()}).catch(()=>{})}catch(e){}}
  // D. Les photos déjà envoyées ne restent sur l'appareil que pour les visites en cours (ou consultées dans les 7 derniers jours)
  async function visCleanCache(){
    if(MODE!=="cloud"||vis.cleaned)return;vis.cleaned=true;
    const lim=Date.now()-7*864e5, acct=visAcct();
    for(const ph of await idbAll("photos")){
      if(ph.acct!==acct||!ph.up||ph.del)continue;
      const v=vis.map[ph.vid]&&vis.map[ph.vid].v;
      if(v&&!v.deletedAt&&v.status!=="done")continue;
      if((ph.at||0)>lim)continue;
      await idbDel("photos",ph.id);if(vis.urls[ph.id]){try{URL.revokeObjectURL(vis.urls[ph.id])}catch(e){}delete vis.urls[ph.id]}
    }
  }
  // E. Suppression d'un projet : ses photos de visite sont retirées du stockage et de l'appareil
  async function visPurgeProject(pid){
    try{
      const acct=visAcct();
      for(const ph of await idbAll("photos"))if(ph.pid===pid)await idbDel("photos",ph.id);
      for(const r of Object.values(vis.map))if(r.v.projectId===pid){await idbDel("visits",r.id);delete vis.map[r.id]}
      if(MODE!=="cloud"||!cloud.user||navigator.onLine===false)return;
      for(const b of ["visit-photos","visit-audio"]){
        const st=cloudClient().storage.from(b);
        const {data:dirs}=await st.list(pid,{limit:1000});
        for(const d of dirs||[]){
          const {data:files}=await st.list(`${pid}/${d.name}`,{limit:1000});
          const paths=(files||[]).filter(f=>f.name).map(f=>`${pid}/${d.name}/${f.name}`);
          for(let i=0;i<paths.length;i+=100)await st.remove(paths.slice(i,i+100));
        }
      }
    }catch(e){}
  }
  setInterval(()=>{if(!vis.loaded)visLoad();else if(vis.pending)visFlush()},60e3);
  setTimeout(()=>{if(!vis.loaded)visLoad()},3000);
  // Photo : image locale (sur l'appareil) ou téléchargée du stockage puis gardée en cache
  async function visPhotoUrl(v,phid){
    if(vis.urls[phid])return vis.urls[phid];
    let rec=await idbGet("photos",phid);
    if(!rec&&MODE==="cloud"&&cloud.user&&navigator.onLine!==false){
      const {data,error}=await cloudClient().storage.from("visit-photos").download(`${v.projectId}/${v.id}/${phid}.jpg`);
      if(!error&&data){rec={id:phid,acct:visAcct(),pid:v.projectId,vid:v.id,blob:data,up:true,del:false,at:Date.now()};idbPut("photos",rec)}
    }
    if(!rec||!rec.blob)return "";
    return vis.urls[phid]=URL.createObjectURL(rec.blob);
  }
  function visFillPhotos(root,v){root.querySelectorAll("img[data-ph]").forEach(async im=>{const u=await visPhotoUrl(v,im.dataset.ph);if(u)im.src=u;else im.closest(".vph")&&im.closest(".vph").classList.add("missing")})}
  function visDropPhotos(v,ids,meta){ids.forEach(async id=>{const r=await idbGet("photos",id);if(MODE!=="cloud"){idbDel("photos",id);return}await idbPut("photos",r?{...r,blob:null,del:true}:{id,acct:visAcct(),pid:v.projectId,vid:v.id,blob:null,up:true,del:true,...(meta||{})});if(vis.urls[id]){try{URL.revokeObjectURL(vis.urls[id])}catch(e){}delete vis.urls[id]}visFlush()})}
  const visDropAudio=(v,a)=>{if(a&&a.id)visDropPhotos(v,[a.id],{kind:"audio",ext:a.ext,mime:a.mime})};
  // Enregistrement audio : fichier local (sur l'appareil) ou téléchargé du stockage puis gardé en cache
  async function visAudioBlob(v,a){
    let rec=await idbGet("photos",a.id);
    if((!rec||!rec.blob)&&MODE==="cloud"&&cloud.user&&navigator.onLine!==false){
      const ref=visMediaRef({kind:"audio",pid:v.projectId,vid:v.id,id:a.id,ext:a.ext,mime:a.mime});
      const {data,error}=await cloudClient().storage.from(ref.b).download(ref.path);
      if(!error&&data){rec={id:a.id,kind:"audio",ext:a.ext,mime:a.mime,acct:visAcct(),pid:v.projectId,vid:v.id,blob:data,up:true,del:false,at:Date.now()};idbPut("photos",rec)}
    }
    return rec&&rec.blob||null;
  }
  async function visAudioUrl(v,a){if(vis.urls[a.id])return vis.urls[a.id];const b=await visAudioBlob(v,a);return b?(vis.urls[a.id]=URL.createObjectURL(b)):""}
  // ---------- Création, suppression ----------
  // Nouveau déplacement : type, intitulé, premier et dernier jour
  function visNewDialog(p,prep){
    const today=iso(new Date());
    if(typeof window.__testDialog==="function")return Promise.resolve(window.__testDialog({type:"visnew",message:"Nouveau déplacement",options:Object.keys(VIS_TYPES)})).then(r=>{
      if(r&&r.ok===false)return null;let v=r&&r.v;if(typeof v==="string")v={title:v};v=v||{};const type=VIS_TYPES[v.type]&&!VIS_TYPES[v.type].soon?v.type:"af";
      const start=v.start||(prep?"":today);return {type,title:v.title||VIS_TYPES[type].l,start,end:v.end||(start?iso(addDays(new Date(start+"T12:00"),VIS_TYPES[type].days-1)):"")}});
    return new Promise(res=>{
      let type="af", touched=false, endTouched=false;
      const d=document.createElement("dialog");d.className="uidlg vissheet visnewdlg";d.setAttribute("aria-label","Nouveau déplacement");
      d.innerHTML=`<form method="dialog"><h3>Nouveau déplacement</h3>
        <div class="vtypes" role="radiogroup" aria-label="Type de déplacement">${Object.entries(VIS_TYPES).map(([k,t])=>`<button type="button" role="radio" class="vtype${t.soon?" soon":""}" data-ty="${k}" aria-checked="${k===type}"${t.soon?' disabled aria-disabled="true"':""}><span class="vtyi" aria-hidden="true">${k==="mes"?VI.rocket:k==="dry"?VI.flask:WH_SVG}</span><span class="vtyt"><b>${esc(t.l)}${t.soon?` <em>Bientôt disponible</em>`:""}</b><span>${esc(t.d)}</span>${t.soon?"":`<small>${plural(t.days,"jour")} par défaut</small>`}</span></button>`).join("")}</div>
        <label class="uifld"><span>Intitulé</span><input type="text" data-k="title" maxlength="300"></label>
        <div class="visgrid"><label class="uifld"><span>Premier jour</span><input type="date" data-k="start" data-dptrips${prep?"":" disabled"}></label><label class="uifld"><span>Dernier jour</span><input type="date" data-k="end" data-dptrips></label></div>
        <p class="muted vnhint"></p>
        <div class="uibtns"><button type="button" class="btn ghost" data-x>Annuler</button><button type="button" class="btn primary" data-ok>${prep?"Préparer":"Démarrer"}</button></div></form>`;
      document.body.appendChild(d);
      const q=k=>d.querySelector(`[data-k="${k}"]`), ti=q("title"), st=q("start"), en=q("end"), hint=d.querySelector(".vnhint");
      st.value=prep?"":today;
      const paint=()=>{d.querySelectorAll("[data-ty]").forEach(b=>b.setAttribute("aria-checked",b.dataset.ty===type));if(!touched)ti.value=VIS_TYPES[type].l;
        if(!endTouched){en.value=st.value?iso(addDays(new Date(st.value+"T12:00"),VIS_TYPES[type].days-1)):""}en.min=st.value||"";
        hint.textContent=st.value?"":`Sans date, le dernier jour sera calculé (${plural(VIS_TYPES[type].days,"jour")}) quand vous fixerez le début.`};
      paint();
      d.querySelectorAll("[data-ty]").forEach(b=>b.onclick=()=>{if(b.disabled)return;type=b.dataset.ty;endTouched=false;paint()});
      ti.oninput=()=>{touched=true};st.onchange=()=>{if(en.value&&st.value&&en.value<st.value)endTouched=false;paint()};en.onchange=()=>{endTouched=true;if(en.value&&st.value&&en.value<st.value){en.value="";endTouched=false;paint()}};
      const close=v=>{try{d.close()}catch(e){}d.remove();res(v)};
      d.addEventListener("cancel",e=>{e.preventDefault();close(null)});
      d.querySelector("[data-x]").onclick=()=>close(null);
      d.querySelector("[data-ok]").onclick=()=>close({type,title:ti.value.trim()||VIS_TYPES[type].l,start:st.value,end:en.value});
      d.querySelector("form").onsubmit=e=>e.preventDefault();
      if(d.showModal)d.showModal();else d.setAttribute("open","");
      setTimeout(()=>{const b=d.querySelector('[data-ty="af"]');if(b)b.focus()},30);
    });
  }
  async function visNew(p,prep){
    const r=await visNewDialog(p,prep);
    if(!r)return;
    const now=Date.now(), mes=r.type==="mes";
    const start=prep?(r.start?new Date(r.start+"T09:00").getTime():null):null, s0=prep?r.start:iso(new Date());
    const end=s0&&r.end&&r.end>s0?r.end:null;
    const v={id:newId(),projectId:p.id,title:(r.title||"Déplacement sur site").slice(0,300),startedAt:prep?null:now,endedAt:null,status:prep?"prep":"open",flows:mes?[]:VIS_FLOWS.map(n=>({id:uid(),name:n})),notes:[],items:[],prep:{participants:defaultParticipants(p.id),type:r.type,days:VIS_TYPES[r.type].days,...(start?{plannedAt:start}:{}),...(end?{endDay:end}:{})},createdAt:now};
    visPersist();
    if(!mes)v.prep.propV=1;
    visPut(v);visOpen(v);render();
  }
  async function visDelete(v){
    const nP=(v.notes||[]).reduce((n,x)=>n+(x.photos||[]).length,0);
    if(!await uiConfirm(`Supprimer le déplacement « ${v.title} » du ${new Date(visDate(v)).toLocaleDateString("fr-FR")} ?\n\n${(v.notes||[]).length} note(s) et ${nP} photo(s) seront supprimées. Les points ouverts et tâches déjà créés restent dans le projet.`,{ok:"Supprimer",danger:true}))return;
    const x=JSON.parse(JSON.stringify(v));x.deletedAt=Date.now();
    visDropPhotos(x,(x.notes||[]).flatMap(n=>(n.photos||[]).map(p=>p.id)));(x.notes||[]).forEach(n=>visDropAudio(x,n.audio));
    visPut(x);if(visCur&&visCur.id===v.id){visCur=null;renderVisit()}render();
    toast("Déplacement supprimé.");
  }
  // ---------- Écran de visite ----------
  let visCur=null, visScreen="home", visFlowId=null, visType="note", visStage=[], visText="", visReply=null, visDayF="", visMesDay=null;
  function visOpen(v,flowId){if(vis.loaded)setTimeout(()=>visLoad(true),0);visCur=JSON.parse(JSON.stringify(v));visCur.items=visCur.items||[];visCur.prep=visCur.prep||{};
    // flux « Généralités » retiré des flux par défaut : on l'enlève des visites en cours s'il est resté vide
    if(visCur.status!=="done"){const g=(visCur.flows||[]).filter(f=>f.name==="Généralités"&&!visNotes(visCur,f.id).length&&!visCur.items.some(i=>i.flow===f.id)).map(f=>f.id);if(g.length&&visCur.flows.length>g.length)visQuiet(x=>{x.flows=x.flows.filter(f=>!g.includes(f.id))})}
    visScreen=v.status==="prep"?"prep":flowId?"flow":"home";visFlowId=flowId||null;visStage=[];visText="";visReply=null;visDayF="";visMesDay=null;if(isMes(visCur))visType="note";renderVisit()}
  async function visClose(){
    if(visRec&&visCur&&visRec.vid===visCur.id){if(!await uiConfirm("Un enregistrement est en cours. L'arrêter et le garder avant de quitter le déplacement ?",{ok:"Arrêter et quitter"}))return;recStop();await new Promise(r=>setTimeout(r,400))}
    auStopAll();
    if(visStage.length)visDropPhotos(visCur,visStage.map(s=>s.id));visCur=null;visStage=[];renderVisit();render()}
  function visSet(fn){fn(visCur);visPut(visCur);renderVisit()}
  function visQuiet(fn){fn(visCur);visPut(visCur)} // modification sans redessiner (saisie en cours)
  const visNotes=(v,fid)=>(v.notes||[]).filter(n=>n.flow===fid);
  const plural=(n,s,p)=>`${n} ${n>1?(p||s+"s"):s}`;
  function visStatus(){
    const el=document.querySelector("#visview .visst");if(!el)return;
    const off=navigator.onLine===false, n=vis.pending;
    el.className="visst"+(MODE!=="cloud"?" loc":off?" off":n?" wait":" ok");
    const long=MODE!=="cloud"?"Enregistré sur cet appareil (mode local)":off?`Hors ligne · enregistré sur le téléphone${n?` · ${plural(n,"élément")} en attente`:""}`:n?`Envoi en cours · ${plural(n,"élément")} en attente`:"En ligne · tout est enregistré";
    const sh=MODE!=="cloud"?"Sur cet appareil":off?`Hors ligne${n?` · ${n} en attente`:""}`:n?`${n} en attente`:"Enregistré";
    el.title=long;el.innerHTML=`<i></i><span aria-hidden="true">${sh}</span><span class="vsr">${long}</span>`;
  }
  function renderVisit(){
    let o=$("#visview");
    if(!visCur){if(o)o.remove();document.body.classList.remove("visopen");return}
    if(!o){o=document.createElement("div");o.id="visview";o.setAttribute("role","dialog");o.setAttribute("aria-modal","true");document.body.appendChild(o)}
    document.body.classList.add("visopen");
    const v=visCur, p=proj(v.projectId)||{name:""};
    o.className="visv"+(isMes(v)?" mes":"");o.setAttribute("aria-label",v.title);
    if(visScreen==="flow"&&!visFlows(v).some(f=>f.id===visFlowId))visScreen="home";
    if(visScreen==="prep")visPrepScreen(o,v,p);else if(visScreen==="flow")visFlowScreen(o,v,p);else if(visScreen==="end")visEndScreen(o,v,p);else visHomeScreen(o,v,p);
    o.classList.remove("recording");if(visRec&&visScreen!=="prep"&&visScreen!=="end")recPanel(o);
    visStatus();
  }
  const visBack=(label)=>`<button type="button" class="visback" data-back aria-label="${label}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg></button>`;
  const WH_SVG=`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 12 4l9 5.5V20H3zM7 20v-8h10v8M7 14.5h10M7 17.5h10"></path></svg>`;
  const CAM_SVG=`<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>`;
  const GAL_SVG=`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"></rect><circle cx="9" cy="10" r="2"></circle><path d="M21 16.5l-5.2-5.2L7 20"></path></svg>`;
  // Clôture : depuis l'accueil de la visite, le bilan ou la liste des visites
  function visPendingN(v){const its=v.items||[];return (v.notes||[]).filter(n=>!n.conv&&(n.type==="question"||n.type==="action")&&!(n.item&&(its.find(i=>i.id===n.item)||{}).kind==="point")).length}
  async function visFinish(v){
    const n=visPendingN(v);
    if(n&&!await uiConfirm(`${n>1?`${n} questions ou actions n'ont`:"Une question ou action n'a"} pas encore été transformée${n>1?"s":""} en point ouvert ou en tâche.\n\nClôturer quand même ? Vous pourrez le faire plus tard depuis le bilan du déplacement.`,{ok:"Clôturer le déplacement"}))return false;
    const now=Date.now();
    if(visCur&&visCur.id===v.id){visQuiet(x=>{x.status="done";x.endedAt=x.endedAt||now});visClose()}
    else{const x=JSON.parse(JSON.stringify(v));x.status="done";x.endedAt=x.endedAt||now;visPut(x);render()}
    toast("Déplacement clôturé. Il reste consultable dans l'onglet Déplacements du projet.");
    return true;
  }
  function visQuick(src){
    visCapture(async photos=>{
      if(!photos.length)return;
      const fid=isMes(visCur)?mesTodayFlow():await visPickFlow("Dans quel flux ranger "+(photos.length>1?"ces photos ?":"cette photo ?"));
      if(!fid){visDropPhotos(visCur,photos.map(x=>x.id));return}
      visSet(x=>x.notes.push({id:uid(),flow:fid,type:"note",text:"",photos,at:Date.now(),conv:null}));
      toast(isMes(visCur)?`${plural(photos.length,"photo")} ajoutée${photos.length>1?"s":""} à la journée.`:`${plural(photos.length,"photo")} ajoutée${photos.length>1?"s":""} au flux « ${(visCur.flows.find(f=>f.id===fid)||{}).name} ».`);
    },src);
  }
  // ---------- Visite 2.0 : en-tête clair, accueil, flux, vue ordinateur en trois colonnes ----------
  const visWide=()=>window.matchMedia("(min-width:1100px)").matches;
  try{window.matchMedia("(min-width:1100px)").addEventListener("change",()=>{if(visCur)renderVisit()})}catch(e){}
  const VI={
    chev:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>`,
    back:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>`,
    more:`<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"></circle><circle cx="12" cy="12" r="1.9"></circle><circle cx="19" cy="12" r="1.9"></circle></svg>`,
    plus:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>`,
    check:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg>`,
    target:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4"></circle></svg>`,
    pin:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>`,
    users:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8"></path></svg>`,
    rocket:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19l3-1 8.5-8.5a3.5 3.5 0 0 0-5-5L3 13l-1 3zM14 6l4 4M6 14l4 4"></path></svg>`,
    flask:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10"></path></svg>`,
    copy:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"></path></svg>`,
    doc:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6"></path></svg>`
  };
  const visMoreBtn=(attr,label)=>`<button type="button" class="visback vismb" ${attr} aria-label="${label}">${VI.more}</button>`;
  // En-tête : retour, titre, pastille d'enregistrement, actions ; la pastille (.visst) est remplie par visStatus()
  const visHead=(backAria,backTxt,title,sub,acts,below)=>`<header class="vish"><div class="visrow"><button type="button" class="visback" data-back aria-label="${backAria}">${VI.back}<span>${esc(backTxt)}</span></button><div class="vist"><b>${esc(title)}</b><span>${sub}</span></div><span class="vsp"></span><div class="visst" role="status"></div>${acts||""}</div>${below||""}</header>`;
  const visDay=v=>visRangeTxt(v,true);
  const visSub=(v,p)=>`${esc(p.name)} · ${esc(visDay(v))}${v.startedAt&&v.status!=="prep"?` · démarré à ${hm(v.startedAt)}`:""}${v.status==="done"?" · terminé":""}`;
  const visItemsOn=v=>{const on=new Set(visFlows(v).map(f=>f.id));return (v.items||[]).filter(i=>on.has(i.flow)&&!i.mk)};
  function visCounts(ns){
    const ph=ns.reduce((k,x)=>k+(x.photos||[]).length,0), q=ns.filter(x=>x.type==="question").length, a=ns.filter(x=>x.type==="action").length, au=ns.filter(x=>x.audio).length;
    return {n:ns.length,ph,q,a,au};
  }
  function visGoalCard(v){
    const pr=v.prep||{}, parts=pr.participants||[];
    if(!pr.goal&&!pr.location&&!parts.length)return "";
    const sub=[pr.location||"",parts.length?plural(parts.length,"participant"):""].filter(Boolean).map(esc).join(" · ");
    return `<button type="button" class="visgoal" data-prepv aria-label="Voir la préparation du déplacement"><span class="visgi">${VI.target}</span><span class="visgt"><b>${esc(pr.goal||"Objectif à préciser")}</b>${sub?`<small>${sub}</small>`:""}</span>${VI.chev}</button>`;
  }
  function visProgCard(v){
    const ns=v.notes||[], c=visCounts(ns), its=visItemsOn(v), seen=its.filter(i=>i.seen).length;
    if(!its.length&&!ns.length)return "";
    const pct=its.length?Math.round(100*seen/its.length):0;
    const tg=(n,s,p,k)=>n?`<span class="tag vt-${k}">${plural(n,s,p)}</span>`:"";
    return `<section class="visprogc">${its.length?`<div class="vpch"><span class="vpcl">Avancement</span><b>${seen} / ${its.length}</b><span>éléments vus</span></div><span class="vbar${seen===its.length?" ok":""}"><i style="width:${pct}%"></i></span>`:""}
      <div class="vpct">${tg(c.n,"note","notes","n")}${tg(c.ph,"photo","photos","n")}${tg(c.q,"question client","questions client","cli")}${tg(c.a,"action","actions","act")}${tg(c.au,"enregistrement","enregistrements","au")}</div></section>`;
  }
  function visFlowRows(v,sel){
    return visFlows(v).map(f=>{
      const c=visCounts(visNotes(v,f.id)), it=visItems(v,f.id), seen=it.filter(i=>i.seen).length;
      const bits=[];if(c.n)bits.push(plural(c.n,"note"));if(c.ph)bits.push(plural(c.ph,"photo"));if(c.q)bits.push(plural(c.q,"question"));if(c.au&&!c.n)bits.push(plural(c.au,"enregistrement"));
      const done=it.length&&seen===it.length;
      return `<button type="button" class="vistile${done?" alldone":""}${sel===f.id?" on":""}" data-f="${esc(f.id)}"${sel===f.id?` aria-current="true"`:""}><span class="vtt"><b>${esc(f.name)}</b><span${bits.length?"":` class="vtodo"`}>${bits.join(" · ")||"À visiter"}</span></span>${it.length?`<span class="vtp"><span class="vbar sm${done?" ok":""}"><i style="width:${Math.round(100*seen/it.length)}%"></i></span><i class="visprog">${seen}/${it.length} vus</i></span>`:""}<span class="vtc">${VI.chev}</span></button>`;
    }).join("");
  }
  function visInfoBox(v){
    const pr=v.prep||{}, parts=pr.participants||[];
    return `<section class="visinfo"><div class="vissh"><h3>Le déplacement</h3><button type="button" class="vislink" data-prepv>Préparation</button></div>
      ${pr.goal?`<p>${VI.target}<span>${esc(pr.goal)}</span></p>`:""}${pr.location?`<p>${VI.pin}<span>${esc(pr.location)}</span></p>`:""}
      ${parts.length?`<p>${VI.users}<span class="vispp">${parts.map(x=>`<span class="tag${x.side==="client"?" vt-cli":""}">${esc(x.name)}</span>`).join("")}</span></p>`:""}
      ${!pr.goal&&!pr.location&&!parts.length?`<p class="muted">Objectif, lieu et participants se renseignent dans la préparation.</p>`:""}</section>`;
  }
  // « À voir » : l'élément suivant est mis en avant, les éléments vus sont regroupés
  function visSeeBox(v,f){
    const its=visItems(v,f.id);if(!its.length)return "";
    const un=its.filter(i=>!i.seen), sn=its.filter(i=>i.seen);
    const row=(i,first)=>{const nr=(v.notes||[]).filter(n=>n.item===i.id).length;
      return `<div class="visit${i.seen?" seen":""}${first?" next":""}" data-i="${esc(i.id)}"><button type="button" class="visseen" data-seen aria-pressed="${!!i.seen}" aria-label="${i.seen?"Marquer comme non vu":"Marquer comme vu"}"></button><span class="vitx">${first?`<small class="visnext">Prochain</small>`:""}${i.kind==="point"?`<small>${esc(i.label||"Point ouvert")}</small>`:""}${esc(i.text)}${nr?`<em>${plural(nr,"réponse")}</em>`:""}</span><button type="button" class="btn visrep" data-rep>Répondre</button></div>`};
    return `<section class="visitems"><div class="vissh"><h3>À voir</h3><b>${sn.length} / ${its.length} vus</b></div>${un.map((i,k)=>row(i,k===0)).join("")}${sn.length?`<details class="visseenl"${ui.visSeenOpen?" open":""}><summary>${VI.check}${plural(sn.length,"élément vu","éléments vus")}</summary>${sn.map(i=>row(i,false)).join("")}</details>`:""}</section>`;
  }
  const VIS_HINT={note:"",question:"À la fin du déplacement, deviendra un point ouvert pour le client.",action:"À la fin du déplacement, deviendra une tâche à votre nom."};
  function visComposer(rep){
    return `<footer class="viscap" data-vt="${visType}">
        <div class="visseg" role="radiogroup" aria-label="Type de note">${Object.entries(NTYPE).map(([k,[l]])=>`<button type="button" role="radio" aria-checked="${visType===k}" data-t="${k}">${l}</button>`).join("")}</div>
        <div class="viskit"><button type="button" class="viskb" data-gal aria-label="Ajouter des photos de la galerie">${GAL_SVG}<span>Galerie</span></button>${bcOk()?`<button type="button" class="viskb" data-scan aria-label="Scanner un code-barres">${BC_SVG}<span>Scanner</span></button>`:""}${recOk()?`<button type="button" class="viskb rec" data-rec aria-label="Enregistrer la conversation">${MIC_SVG}<span>Enregistrer</span></button>`:""}</div>
        <p class="vishint"${VIS_HINT[visType]?"":" hidden"}>${VIS_HINT[visType]}</p>
        ${rep?`<div class="visreply"><span>Réponse à : <b>${esc(rep.text)}</b></span><button type="button" data-unrep aria-label="Ne plus répondre à cet élément">✕</button></div>`:""}
        ${visStage.length?`<div class="visstage">${visStage.map(s=>`<span class="vph sm"><img data-ph="${esc(s.id)}" alt="Photo jointe"><button type="button" data-unstage="${esc(s.id)}" aria-label="Retirer la photo">✕</button></span>`).join("")}</div>`:""}
        <div class="visin"><button type="button" class="viscam" data-cam aria-label="Prendre une photo">${CAM_SVG}</button><textarea data-rt rows="2" aria-label="Texte de la note" placeholder="Écrire ou dicter (micro du clavier)…">${escRaw(visText)}</textarea><button type="button" class="visok" data-add aria-label="Ajouter la note"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg></button></div>
      </footer>`;
  }
  const visQuickBar=()=>`<footer class="visf vqf"><button type="button" class="visqb" data-qgal aria-label="Importer des photos de la galerie (le flux est choisi ensuite)">${GAL_SVG}<span>Galerie</span></button><button type="button" class="visfab" data-quick aria-label="Photo rapide (le flux est choisi ensuite)">${CAM_SVG}</button>${recOk()?`<button type="button" class="visqb rec" data-qrec aria-label="Enregistrer la conversation (le flux est choisi ensuite)">${MIC_SVG}<span>Enregistrer</span></button>`:`<span class="visqb" aria-hidden="true"></span>`}</footer>`;
  const visHomeActs=v=>`<button type="button" class="btn visendh" data-end>${v.status==="done"?"Bilan":"Terminer"}</button>${visMoreBtn("data-vm","Actions sur le déplacement")}`;
  // liaisons communes à l'accueil, au flux et à la vue ordinateur
  function visBindCommon(o,v){
    o.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{visScreen="flow";visFlowId=b.dataset.f;renderVisit()});
    const vm=o.querySelector("[data-vm]");if(vm)vm.onclick=async()=>{
      const ch=await visSheet(v.title,[...(isMes(v)?[{k:"conf",l:v.prep&&v.prep.conf?"Page Confluence liée":"Lier une page Confluence"}]:[]),...(v.status==="done"?[{k:"reopen",l:"Reprendre le déplacement"}]:[{k:"finish",l:"Clôturer le déplacement"}]),{k:"gal",l:"Importer des photos de la galerie"},{k:"prep",l:"Revoir la préparation"},{k:"ren",l:"Renommer le déplacement"},{k:"pdf",l:"Exporter le compte rendu (PDF)"},{k:"del",l:"Supprimer le déplacement",danger:true}]);
      if(ch==="conf"){if(visCur.prep&&visCur.prep.conf)confInfo(visCur);else confLinkDlg(visCur)}
      else if(ch==="finish")visFinish(visCur);
      else if(ch==="reopen")visSet(x=>{x.status="open";x.endedAt=null});
      else if(ch==="gal")visQuick("gallery");
      else if(ch==="prep"){visScreen="prep";renderVisit()}
      else if(ch==="ren"){const t=await uiPrompt("Intitulé du déplacement",v.title,{ok:"Renommer"});if(t&&t.trim())visSet(x=>{x.title=t.trim().slice(0,300)})}
      else if(ch==="pdf")visPdf(visCur);
      else if(ch==="del")visDelete(visCur);
    };
    const af=o.querySelector("[data-addf]");if(af)af.onclick=async()=>{const n=await uiPrompt("Nom du nouveau flux","",{ok:"Ajouter"});if(n&&n.trim())visSet(x=>x.flows.push({id:uid(),name:n.trim().slice(0,60)}))};
    const en=o.querySelector("[data-end]");if(en)en.onclick=()=>{visScreen="end";renderVisit()};
    o.querySelectorAll("[data-prepv]").forEach(b=>b.onclick=()=>{visScreen="prep";renderVisit()});
    const qk=o.querySelector("[data-quick]");if(qk)qk.onclick=()=>visQuick("camera");
    const qg=o.querySelector("[data-qgal]");if(qg)qg.onclick=()=>visQuick("gallery");
    const qr=o.querySelector("[data-qrec]");if(qr)qr.onclick=async()=>{const fid=isMes(visCur)?mesTodayFlow():await visPickFlow("Dans quel flux ranger l'enregistrement ?");if(!fid)return;if(!isMes(visCur)){visScreen="flow";visFlowId=fid}renderVisit();recStart(fid)};
    o.querySelectorAll("[data-dayf]").forEach(b=>b.onclick=()=>{visDayF=b.dataset.dayf;renderVisit()});
    o.querySelectorAll(".visnote [data-more]").forEach(b=>b.onclick=()=>visNoteMenu(b.closest("[data-n]").dataset.n));
    o.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>visViewPhoto(b.dataset.view));
    recFillPlayers(o,v);trBind(o,v);visFillPhotos(o,v);
  }
  function visBindFlow(o,v,f){
    o.querySelectorAll("button[data-t]").forEach(b=>b.onclick=()=>{visType=b.dataset.t;o.querySelectorAll("button[data-t]").forEach(x=>x.setAttribute("aria-checked",x===b));const cp=o.querySelector(".viscap");if(cp)cp.dataset.vt=visType;const h=o.querySelector(".vishint");if(h){h.textContent=VIS_HINT[visType];h.hidden=!VIS_HINT[visType]}});
    const ta=o.querySelector(".visin textarea");ta.oninput=()=>{visText=ta.value};
    o.querySelectorAll("[data-unstage]").forEach(b=>b.onclick=()=>{const id=b.dataset.unstage;visDropPhotos(visCur,[id]);visStage=visStage.filter(s=>s.id!==id);renderVisit()});
    o.querySelector("[data-cam]").onclick=()=>visCapture(photos=>{visStage=visStage.concat(photos);renderVisit()});
    o.querySelector("[data-gal]").onclick=()=>visCapture(photos=>{visStage=visStage.concat(photos);renderVisit()},"gallery");
    const rb=o.querySelector("[data-rec]");if(rb)rb.onclick=()=>recStart(f.id);
    const sc=o.querySelector("[data-scan]");if(sc)sc.onclick=()=>visScan(r=>{if(!r)return;visText=(ta.value.trim()?ta.value.trim()+"\n":"")+r.text;if(r.photo)visStage=visStage.concat([r.photo]);renderVisit();const t=$("#visview .visin textarea");if(t){t.focus();t.setSelectionRange(t.value.length,t.value.length)}});
    o.querySelector("[data-add]").onclick=()=>{
      const t=ta.value.trim();if(!t&&!visStage.length){ta.focus();return}
      const photos=visStage;visStage=[];visText="";
      const item=visReply;visReply=null;
      visSet(x=>{x.notes.push({id:uid(),flow:f.id,type:visType,text:rtCut(t,4000),photos,at:Date.now(),conv:null,...(item?{item}:{})});if(item){const i=x.items.find(y=>y.id===item);if(i)i.seen=true}});
      const m=$("#visview .vism.notes");if(m)m.scrollTop=m.scrollHeight;
    };
    const fm=o.querySelector("[data-fm]");if(fm)fm.onclick=()=>visFlowMenu(f);
    const sl=o.querySelector(".visseenl");if(sl)sl.ontoggle=()=>{ui.visSeenOpen=sl.open;saveUi()};
    o.querySelectorAll("[data-seen]").forEach(b=>b.onclick=()=>{const id=b.closest("[data-i]").dataset.i;visSet(x=>{const i=x.items.find(y=>y.id===id);if(i)i.seen=!i.seen})});
    o.querySelectorAll("[data-rep]").forEach(b=>b.onclick=()=>{visReply=b.closest("[data-i]").dataset.i;renderVisit();const t=$("#visview .visin textarea");if(t)t.focus()});
    const ur=o.querySelector("[data-unrep]");if(ur)ur.onclick=()=>{visReply=null;renderVisit()};
    const m=o.querySelector(".vism.notes");if(m&&!visReply)m.scrollTop=m.scrollHeight;
  }
  function visHomeScreen(o,v,p){
    if(isMes(v))return visMesScreen(o,v,p);
    if(visWide())return visDesk(o,v,p,null);
    o.innerHTML=visHead("Quitter le déplacement","Projet",v.title,visSub(v,p),visHomeActs(v))+`<main class="vism vhome">${trBanner(v)}${visGoalCard(v)}${visProgCard(v)}
      <div class="vishd"><h2>Flux</h2><button type="button" class="vislink" data-addf>${VI.plus}Ajouter un flux</button></div>
      <nav class="vislist" aria-label="Flux du déplacement">${visFlowRows(v,null)}</nav></main>${visQuickBar()}`;
    o.querySelector("[data-back]").onclick=visClose;
    visBindCommon(o,v);
  }
  function visPickFlow(title,except){
    return new Promise(res=>{
      const d=document.createElement("dialog");d.className="uidlg vissheet";d.setAttribute("aria-label",title);
      d.innerHTML=`<form method="dialog"><h3>${esc(title)}</h3><div class="vispick">${visFlows(visCur).filter(f=>f.id!==except).map(f=>`<button type="button" class="btn" data-f="${esc(f.id)}">${esc(f.name)}</button>`).join("")}</div><div class="uibtns"><button type="button" class="btn ghost" data-x>Annuler</button></div></form>`;
      document.body.appendChild(d);
      const close=v=>{try{d.close()}catch(e){}d.remove();res(v)};
      d.addEventListener("cancel",e=>{e.preventDefault();close(null)});
      d.querySelector("[data-x]").onclick=()=>close(null);
      d.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>close(b.dataset.f));
      if(d.showModal)d.showModal();else d.setAttribute("open","");
    });
  }
  function visNoteHtml(n,withFlow){
    let [l,c]=NTYPE[n.type]||NTYPE.note;if(n.audio&&n.type==="note"){l="Enregistrement";c="nt-au"}
    const fl=withFlow&&visCur?(visCur.flows.find(f=>f.id===n.flow)||{}).name:"";
    return `<article class="visnote" data-n="${esc(n.id)}"><div class="visnh"><span class="nt ${c}">${l}</span><span>${hm(n.at)}${fl?` · ${esc(fl)}`:""}</span>${n.conv?`<span class="visconv">${n.conv.kind==="point"?"Point ouvert créé":"Tâche créée"}</span>`:""}<span class="sp"></span><button type="button" class="vismore" data-more aria-label="Actions sur la note">${VI.more}</button></div>
      ${n.item&&visCur&&(visCur.items||[]).find(i=>i.id===n.item)?`<div class="visre">Réponse à : ${esc(visCur.items.find(i=>i.id===n.item).text)}</div>`:""}
      ${n.text?`<div class="rt vistx">${rtHtml(n.text)}</div>`:""}
      ${n.audio?visAudioHtml(n):""}
      ${(n.photos||[]).length?`<div class="visphs">${n.photos.map(ph=>`<button type="button" class="vph" data-view="${esc(ph.id)}" aria-label="Voir la photo${ph.caption?" : "+esc(ph.caption):""}"><img data-ph="${esc(ph.id)}" alt="">${ph.caption?`<span>${esc(ph.caption)}</span>`:""}</button>`).join("")}</div>`:""}
      ${!n.conv&&(n.type==="question"||n.type==="action")?`<span class="visfut">${n.type==="question"?"Deviendra un point ouvert pour le client":"Deviendra une tâche à votre nom"}</span>`:""}</article>`;
  }
  const visCountTxt=ns=>{const c=visCounts(ns);return `${plural(c.n,"note")} · ${plural(c.ph,"photo")}${c.q?` · ${plural(c.q,"question client","questions client")}`:""}${c.a?` · ${plural(c.a,"action")}`:""}`};
  function visFlowScreen(o,v,p){
    if(visWide())return visDesk(o,v,p,visFlowId);
    const f=v.flows.find(x=>x.id===visFlowId), ns=visNotes(v,f.id), its=visItems(v,f.id), rep=visReply&&its.find(i=>i.id===visReply);
    if(visReply&&!rep)visReply=null;
    o.innerHTML=visHead(f.day?"Retour à la journée":"Retour aux flux",f.day?"Journée":"Déplacement",f.day?mesDayName(v,f.day):f.name,esc(visCountTxt(ns)),f.day?"":visMoreBtn("data-fm","Actions sur le flux"),
        `<div class="vischips" role="tablist" aria-label="Changer de flux">${visFlows(v).map(x=>`<button type="button" role="tab" aria-selected="${x.id===f.id}" data-f="${esc(x.id)}">${esc(x.name)}</button>`).join("")}</div>`)+
      `<main class="vism notes">${trBanner(v)}${visSeeBox(v,f)}
        ${isMes(v)?"":visDayBar(v)}${visNotesList(v,ns)}</main>${visComposer(rep)}`;
    o.querySelector("[data-back]").onclick=()=>{visScreen="home";renderVisit()};
    const chip=o.querySelector('.vischips [aria-selected="true"]');if(chip)chip.scrollIntoView({block:"nearest",inline:"center"});
    visBindCommon(o,v);visBindFlow(o,v,f);
  }
  // Ordinateur : flux à gauche, notes et saisie au centre, « À voir » et infos à droite
  function visDesk(o,v,p,fid){
    if(isMes(v)){const fx=fid&&v.flows.find(x=>x.id===fid);if(fx&&fx.day)visMesDay=fx.day;visScreen="home";return visMesScreen(o,v,p)}
    const f=fid?v.flows.find(x=>x.id===fid):null;
    let center;
    if(f){
      const ns=visNotes(v,f.id), rep=visReply&&visItems(v,f.id).find(i=>i.id===visReply);if(visReply&&!rep)visReply=null;
      center=`<div class="visdch"><div><h2>${esc(f.name)}</h2><span>${esc(visCountTxt(ns))}</span></div>${visMoreBtn("data-fm","Actions sur le flux")}</div>
        ${visDayBar(v)}<main class="vism notes">${visNotesList(v,ns)}</main>${visComposer(rep)}`;
    }else{
      const recent=(v.notes||[]).filter(n=>visFlows(v).some(x=>x.id===n.flow)).slice().sort((a,b)=>b.at-a.at).slice(0,6);
      center=`<main class="vism vhome">${visGoalCard(v)}<div class="vishd"><h2>Dernières notes</h2></div>${recent.length?recent.map(n=>visNoteHtml(n,true)).join(""):`<p class="visempty">Choisissez un flux à gauche pour prendre des notes et des photos.</p>`}</main>${visQuickBar()}`;
    }
    o.innerHTML=visHead(f?"Retour à l'accueil du déplacement":"Quitter le déplacement",f?"Accueil":p.name,v.title,visSub(v,p),visHomeActs(v))+
      `<div class="visdesk"><aside class="visdl">${visProgCard(v)}<div class="vishd"><h2>Flux</h2><button type="button" class="vislink" data-addf aria-label="Ajouter un flux">${VI.plus}<span>Ajouter</span></button></div><nav class="vislist" aria-label="Flux du déplacement">${visFlowRows(v,fid)}</nav></aside>
      <section class="visdc">${center}</section>
      <aside class="visdr">${f?visSeeBox(v,f):""}${visInfoBox(v)}${trBanner(v)}</aside></div>`;
    o.querySelector("[data-back]").onclick=f?()=>{visScreen="home";renderVisit()}:visClose;
    visBindCommon(o,v);if(f)visBindFlow(o,v,f);
  }
  async function visSheet(title,items){
    if(typeof window.__testDialog==="function"){const r=await window.__testDialog({type:"sheet",message:title,options:items.map(i=>i.l)});const i=items.find(x=>x.l===(r&&r.v));return i?i.k:null}
    return new Promise(res=>{
      const d=document.createElement("dialog");d.className="uidlg vissheet";d.setAttribute("aria-label",title);
      d.innerHTML=`<form method="dialog"><h3>${esc(title)}</h3><div class="vispick">${items.map((i,k)=>`<button type="button" class="btn${i.danger?" danger-t":""}" data-k="${k}">${esc(i.l)}</button>`).join("")}</div><div class="uibtns"><button type="button" class="btn ghost" data-x>Annuler</button></div></form>`;
      document.body.appendChild(d);
      const close=v=>{try{d.close()}catch(e){}d.remove();res(v)};
      d.addEventListener("cancel",e=>{e.preventDefault();close(null)});
      d.querySelector("[data-x]").onclick=()=>close(null);
      d.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>close(items[+b.dataset.k].k));
      if(d.showModal)d.showModal();else d.setAttribute("open","");
    });
  }
  async function visNoteMenu(nid){
    const n=visCur.notes.find(x=>x.id===nid);if(!n)return;
    const items=[{k:"edit",l:"Modifier le texte"},...Object.entries(NTYPE).filter(([k])=>k!==n.type).map(([k,[l]])=>({k:"t:"+k,l:"Changer en « "+l+" »"})),{k:"photo",l:"Prendre une photo"},{k:"gal",l:"Ajouter des photos de la galerie"},...(visFlows(visCur).length>1?[{k:"move",l:"Déplacer vers un autre flux"}]:[]),{k:"del",l:"Supprimer la note",danger:true}];
    const ch=await visSheet("Note de "+hm(n.at),items);if(!ch)return;
    if(ch==="edit"){const t=await uiPrompt("Texte de la note",n.text||"",{ok:"Enregistrer",multiline:true});if(t!=null)visSet(x=>{x.notes.find(y=>y.id===nid).text=t.trim().slice(0,4000)})}
    else if(ch.startsWith("t:"))visSet(x=>{x.notes.find(y=>y.id===nid).type=ch.slice(2)});
    else if(ch==="photo"||ch==="gal")visCapture(photos=>{if(photos.length)visSet(x=>{const y=x.notes.find(z=>z.id===nid);y.photos=(y.photos||[]).concat(photos)})},ch==="gal"?"gallery":"camera");
    else if(ch==="move"){const fid=await visPickFlow("Déplacer la note vers…",n.flow);if(fid)visSet(x=>{x.notes.find(y=>y.id===nid).flow=fid})}
    else if(ch==="del"){if(!await uiConfirm("Supprimer cette note"+((n.photos||[]).length?` et ses ${plural(n.photos.length,"photo")}`:"")+(n.audio?" et son enregistrement":"")+" ?",{ok:"Supprimer",danger:true}))return;visDropPhotos(visCur,(n.photos||[]).map(p=>p.id));visDropAudio(visCur,n.audio);visSet(x=>{x.notes=x.notes.filter(y=>y.id!==nid)})}
  }
  async function visFlowMenu(f){
    const n=visNotes(visCur,f.id).length;
    const ch=await visSheet("Flux « "+f.name+" »",[{k:"ren",l:"Renommer le flux"},...(n?[]:[{k:"del",l:"Supprimer le flux",danger:true}])]);
    if(ch==="ren"){const t=await uiPrompt("Nouveau nom du flux",f.name,{ok:"Renommer"});if(t&&t.trim())visSet(x=>{x.flows.find(y=>y.id===f.id).name=t.trim().slice(0,60)})}
    if(ch==="del")visSet(x=>{x.flows=x.flows.filter(y=>y.id!==f.id);x.items=(x.items||[]).filter(i=>i.flow!==f.id)});
  }
  async function visViewPhoto(phid){
    const n=visCur.notes.find(x=>(x.photos||[]).some(p=>p.id===phid));if(!n)return;
    const list=()=>(visCur.notes.find(y=>y.id===n.id)||{photos:[]}).photos||[];
    let idx=list().findIndex(p=>p.id===phid), changed=false;
    const ARR=dir=>`<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir<0?"M15 5l-7 7 7 7":"M9 5l7 7-7 7"}"></path></svg>`;
    const d=document.createElement("dialog");d.className="visphoto";d.setAttribute("aria-label","Photo");
    d.innerHTML=`<div class="visphv"><img alt=""><button type="button" class="visnav prev" data-nav="-1" aria-label="Photo précédente">${ARR(-1)}</button><button type="button" class="visnav next" data-nav="1" aria-label="Photo suivante">${ARR(1)}</button><span class="visphn" aria-live="polite"></span><button type="button" class="viszoom" data-zr hidden aria-label="Revenir à la taille normale"></button></div>
      <div class="visphb"><input type="text" maxlength="200" placeholder="Légende" aria-label="Légende"><button type="button" class="btn danger-t" data-del>Supprimer</button><button type="button" class="btn primary" data-x>Fermer</button></div>`;
    document.body.appendChild(d);
    const img=d.querySelector("img"), inp=d.querySelector("input"), cnt=d.querySelector(".visphn");
    // la légende saisie est gardée quand on change de photo
    const keep=()=>{const ph=list()[idx];if(!ph)return;const c=inp.value.trim().slice(0,200);if(c!==(ph.caption||"")){visQuiet(x=>{x.notes.find(y=>y.id===n.id).photos.find(p=>p.id===ph.id).caption=c});changed=true}};
    const show=async()=>{
      const ps=list(), ph=ps[idx];if(!ph)return;
      inp.value=ph.caption||"";img.alt=ph.caption||"Photo";img.removeAttribute("src");zReset();
      cnt.textContent=ps.length>1?`${idx+1} / ${ps.length}`:"";cnt.hidden=ps.length<2;
      d.querySelectorAll("[data-nav]").forEach(b=>{b.hidden=ps.length<2;b.disabled=+b.dataset.nav<0?idx===0:idx===ps.length-1});
      const id=ph.id, u=await visPhotoUrl(visCur,id);if(u&&list()[idx]&&list()[idx].id===id)img.src=u;
    };
    const go=k=>{const ps=list(), j=idx+k;if(j<0||j>=ps.length)return;keep();idx=j;show()};
    d.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>go(+b.dataset.nav));
    const onKey=e=>{if(e.target===inp||!d.isConnected)return;if(e.key==="ArrowLeft"){e.preventDefault();go(-1)}else if(e.key==="ArrowRight"){e.preventDefault();go(1)}};
    document.addEventListener("keydown",onKey);
    // zoom : pincement à deux doigts, molette, double-clic ou double tape ; déplacement de la photo zoomée au doigt ou à la souris
    // balayage horizontal (photo non zoomée) : photo précédente ou suivante
    const v=d.querySelector(".visphv"), zb=d.querySelector("[data-zr]");
    let z=1,tx=0,ty=0,pinch=null,drag=null,lastTap=0;const pts=new Map();
    const ctr=e=>{const r=v.getBoundingClientRect();return [e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2]};
    const apply=()=>{img.style.transform=z>1?`translate(${tx}px,${ty}px) scale(${z})`:"";v.classList.toggle("zoomed",z>1);zb.hidden=z<=1;zb.textContent=Math.round(z*100)+" %"};
    const clamp=()=>{if(z<=1.01){z=1;tx=0;ty=0;return}const r=v.getBoundingClientRect(), mx=r.width*(z-1)/2, my=r.height*(z-1)/2;tx=Math.max(-mx,Math.min(mx,tx));ty=Math.max(-my,Math.min(my,ty))};
    const zoomAt=(nz,cx,cy)=>{nz=Math.max(1,Math.min(6,nz));const k=nz/z;tx=cx-(cx-tx)*k;ty=cy-(cy-ty)*k;z=nz;clamp();apply()};
    function zReset(){z=1;tx=0;ty=0;pinch=null;drag=null;pts.clear();apply()}
    const toggle=e=>{if(z>1)zReset();else{const [cx,cy]=ctr(e);zoomAt(2.5,cx,cy)}};
    zb.onclick=zReset;
    v.addEventListener("wheel",e=>{e.preventDefault();const [cx,cy]=ctr(e);zoomAt(z*Math.exp(-e.deltaY*0.0015),cx,cy)},{passive:false});
    v.addEventListener("dblclick",e=>{if(e.target.closest("button"))return;e.preventDefault();toggle(e)});
    v.addEventListener("pointerdown",e=>{
      if(e.target.closest("button"))return;
      pts.set(e.pointerId,[e.clientX,e.clientY]);try{v.setPointerCapture(e.pointerId)}catch(x){}
      if(pts.size===2){const [a,b]=[...pts.values()];pinch={d:Math.hypot(a[0]-b[0],a[1]-b[1])||1,z,m:[(a[0]+b[0])/2,(a[1]+b[1])/2]};drag=null}
      else if(pts.size===1)drag={x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY,t:Date.now(),moved:false};
    });
    v.addEventListener("pointermove",e=>{
      if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);
      if(pinch&&pts.size===2){const [a,b]=[...pts.values()], m=[(a[0]+b[0])/2,(a[1]+b[1])/2], r=v.getBoundingClientRect();
        tx+=m[0]-pinch.m[0];ty+=m[1]-pinch.m[1];pinch.m=m;
        zoomAt(pinch.z*Math.hypot(a[0]-b[0],a[1]-b[1])/pinch.d,m[0]-r.left-r.width/2,m[1]-r.top-r.height/2);return}
      if(drag){if(Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)>8)drag.moved=true;
        if(z>1){tx+=e.clientX-drag.x;ty+=e.clientY-drag.y;clamp();apply()}drag.x=e.clientX;drag.y=e.clientY}
    });
    const up=e=>{
      if(!pts.has(e.pointerId))return;pts.delete(e.pointerId);
      if(pinch){if(pts.size<2)pinch=null;if(pts.size===1){const [p]=[...pts.values()];drag={x:p[0],y:p[1],sx:p[0],sy:p[1],t:0,moved:true}}return}
      const g=drag;drag=null;if(!g||e.type==="pointercancel")return;
      const dx=e.clientX-g.sx, dy=e.clientY-g.sy;
      if(z<=1&&Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5){go(dx<0?1:-1);return}
      if(e.pointerType==="touch"&&!g.moved&&Date.now()-g.t<300){if(Date.now()-lastTap<320){lastTap=0;toggle(e)}else lastTap=Date.now()}
    };
    v.addEventListener("pointerup",up);v.addEventListener("pointercancel",up);
    const close=()=>{keep();document.removeEventListener("keydown",onKey);try{d.close()}catch(e){}d.remove();if(changed)renderVisit()};
    d.addEventListener("cancel",e=>{e.preventDefault();close()});
    d.querySelector("[data-x]").onclick=close;
    d.querySelector("[data-del]").onclick=async()=>{
      keep();const ph=list()[idx];if(!ph)return;
      if(!await uiConfirm("Supprimer cette photo ?",{ok:"Supprimer",danger:true}))return;
      visDropPhotos(visCur,[ph.id]);
      visQuiet(x=>{const y=x.notes.find(z=>z.id===n.id);y.photos=y.photos.filter(p=>p.id!==ph.id);if(!y.photos.length&&!y.text)x.notes=x.notes.filter(z=>z.id!==y.id)});changed=true;
      const ps=list();if(!ps.length){document.removeEventListener("keydown",onKey);try{d.close()}catch(e){}d.remove();renderVisit();return}
      idx=Math.min(idx,ps.length-1);show();
    };
    if(d.showModal)d.showModal();else d.setAttribute("open","");
    show();
  }
  // ---------- Photo : prise de vue, réduction, annotation, légende, série ----------
  // src « camera » : appareil photo direct ; « gallery » : galerie du téléphone, plusieurs photos possibles
  function visPickFiles(src){
    return new Promise(res=>{
      if(src==="gallery"&&typeof window.__testGallery==="function"){Promise.resolve(window.__testGallery()).then(r=>res(r||[]));return}
      if(src!=="gallery"&&typeof window.__testPhoto==="function"){Promise.resolve(window.__testPhoto()).then(f=>res(f?[f]:[]));return}
      const inp=document.createElement("input");inp.type="file";inp.accept="image/*";
      if(src==="gallery")inp.multiple=true;else inp.setAttribute("capture","environment");
      inp.onchange=()=>res([...(inp.files||[])]);inp.click();
    });
  }
  const visPickFile=()=>visPickFiles("camera").then(a=>a[0]||null);
  const VIS_GAL_MAX=12;
  async function visLoadShots(files){
    const out=[];let bad=0;
    for(const f of files.slice(0,VIS_GAL_MAX)){try{out.push({base:await visLoadImage(f),shapes:[],caption:""})}catch(e){bad++}}
    const msg=[files.length>VIS_GAL_MAX&&`${VIS_GAL_MAX} photos au plus par import : ${files.length-VIS_GAL_MAX} ignorée${files.length-VIS_GAL_MAX>1?"s":""}.`,bad&&`${plural(bad,"image illisible")}${bad>1?" ignorées":" ignorée"}.`].filter(Boolean);
    if(msg.length&&out.length)toast(msg.join(" "));
    return out;
  }
  async function visLoadImage(file){
    let src;
    try{src=await createImageBitmap(file,{imageOrientation:"from-image"})}
    catch(e){src=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=URL.createObjectURL(file)})}
    const w0=src.width, h0=src.height, k=Math.min(1,VIS_MAX/Math.max(w0,h0));
    const c=document.createElement("canvas");c.width=Math.round(w0*k);c.height=Math.round(h0*k);
    c.getContext("2d").drawImage(src,0,0,c.width,c.height);
    return c;
  }
  async function visCapture(done,src){
    visPersist();
    const files=await visPickFiles(src||"camera");if(!files.length)return;
    const shots=await visLoadShots(files);if(!shots.length){uiAlert(files.length>1?"Images illisibles.":"Photo illisible.");return}
    visEditor(shots,done,src==="gallery"?0:shots.length-1);
  }
  function visEditor(shots,done,start){
    let cur=start==null?shots.length-1:start, tool="circle", color="#F2B705", drawing=null;
    const d=document.createElement("div");d.className="visedit";d.setAttribute("role","dialog");d.setAttribute("aria-modal","true");d.setAttribute("aria-label","Photo");
    document.body.appendChild(d);
    const paint=(cv,s,w)=>{
      const g=cv.getContext("2d");g.drawImage(s.base,0,0);
      const lw=Math.max(4,Math.round(cv.width/150));g.lineWidth=lw;g.lineCap="round";g.lineJoin="round";
      [...s.shapes,...(w?[w]:[])].forEach(sh=>{
        g.strokeStyle=sh.c;g.beginPath();
        if(sh.t==="circle"){const [a,b]=sh.p,rx=Math.abs(b[0]-a[0])/2,ry=Math.abs(b[1]-a[1])/2;g.ellipse((a[0]+b[0])/2,(a[1]+b[1])/2,Math.max(rx,1),Math.max(ry,1),0,0,Math.PI*2)}
        else if(sh.t==="arrow"){const [a,b]=sh.p,an=Math.atan2(b[1]-a[1],b[0]-a[0]),hl=lw*4;g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.moveTo(b[0]-hl*Math.cos(an-0.5),b[1]-hl*Math.sin(an-0.5));g.lineTo(b[0],b[1]);g.lineTo(b[0]-hl*Math.cos(an+0.5),b[1]-hl*Math.sin(an+0.5))}
        else sh.p.forEach((pt,i)=>i?g.lineTo(pt[0],pt[1]):g.moveTo(pt[0],pt[1]));
        g.stroke();
      });
    };
    const draw=()=>{
      const s=shots[cur];
      d.innerHTML=`<header><button type="button" class="visround" data-x aria-label="Abandonner les photos">✕</button><div class="vist"><b>Photo ${cur+1} sur ${shots.length}</b><span>Entourez ou fléchez au doigt</span></div><button type="button" class="visround" data-rot aria-label="Pivoter la photo d'un quart de tour" title="Pivoter"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.4 5.7"></path><path d="M20 4v7h-7"></path></svg></button><button type="button" class="btn ghost" data-retake>Reprendre</button></header>
        <div class="visstagecv"><canvas></canvas></div>
        <div class="vistools" role="toolbar" aria-label="Annotation">${[["circle","Cercle"],["arrow","Flèche"],["pen","Crayon"]].map(([k,l])=>`<button type="button" data-tool="${k}" aria-pressed="${tool===k}">${l}</button>`).join("")}<span class="sp"></span>${[["#F2B705","jaune"],["#E5484D","rouge"],["#FFFFFF","blanc"]].map(([c,l])=>`<button type="button" class="viscol" data-col="${c}" style="background:${c}" aria-label="Couleur ${l}" aria-pressed="${color===c}"></button>`).join("")}<button type="button" class="visround" data-undo aria-label="Annuler le dernier trait">↶</button></div>
        <input type="text" class="viscapt" maxlength="200" placeholder="Légende (ex. : quai 3, étiquette actuelle)" aria-label="Légende de la photo" value="${esc(s.caption)}">
        <div class="visstrip">${shots.map((x,i)=>`<button type="button" data-i="${i}" aria-label="Photo ${i+1}" aria-current="${i===cur}"><canvas width="${Math.round(x.base.width/x.base.height*48)}" height="48"></canvas></button>`).join("")}<button type="button" class="add" data-more aria-label="Ajouter une photo à la série">+</button></div>
        <footer><button type="button" class="btn ico" data-more aria-label="Prendre une autre photo" title="Prendre une autre photo">${CAM_SVG}</button><button type="button" class="btn ico" data-galm aria-label="Ajouter des photos de la galerie" title="Ajouter des photos de la galerie">${GAL_SVG}</button><button type="button" class="btn primary" data-ok>${shots.length>1?`Ajouter les ${shots.length} photos`:"Ajouter la photo"}</button></footer>`;
      const cv=d.querySelector(".visstagecv canvas");cv.width=s.base.width;cv.height=s.base.height;paint(cv,s);
      d.querySelectorAll(".visstrip canvas").forEach((c,i)=>c.getContext("2d").drawImage(shots[i].base,0,0,c.width,c.height));
      const pt=e=>{const r=cv.getBoundingClientRect();return [(e.clientX-r.left)*cv.width/r.width,(e.clientY-r.top)*cv.height/r.height]};
      cv.onpointerdown=e=>{e.preventDefault();cv.setPointerCapture&&cv.setPointerCapture(e.pointerId);const p=pt(e);drawing={t:tool,c:color,p:tool==="pen"?[p]:[p,p]}};
      cv.onpointermove=e=>{if(!drawing)return;const p=pt(e);if(drawing.t==="pen")drawing.p.push(p);else drawing.p[1]=p;paint(cv,s,drawing)};
      cv.onpointerup=cv.onpointercancel=()=>{if(!drawing)return;const w=drawing;drawing=null;const [a,b]=[w.p[0],w.p[w.p.length-1]];if(w.t==="pen"?w.p.length>1:Math.hypot(b[0]-a[0],b[1]-a[1])>8)s.shapes.push(w);paint(cv,s)};
      d.querySelector(".viscapt").oninput=e=>{s.caption=e.target.value};
      d.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>{tool=b.dataset.tool;d.querySelectorAll("[data-tool]").forEach(x=>x.setAttribute("aria-pressed",x===b))});
      d.querySelectorAll("[data-col]").forEach(b=>b.onclick=()=>{color=b.dataset.col;d.querySelectorAll("[data-col]").forEach(x=>x.setAttribute("aria-pressed",x===b))});
      d.querySelector("[data-undo]").onclick=()=>{s.shapes.pop();paint(cv,s)};
      // rotation d'un quart de tour (sens horaire) : l'image et les annotations déjà tracées tournent ensemble
      d.querySelector("[data-rot]").onclick=()=>{
        const b=s.base, c=document.createElement("canvas");c.width=b.height;c.height=b.width;
        const g=c.getContext("2d");g.translate(c.width,0);g.rotate(Math.PI/2);g.drawImage(b,0,0);
        const H=b.height;s.shapes.forEach(sh=>{sh.p=sh.p.map(([x,y])=>[H-y,x])});s.base=c;draw();
      };
      d.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{cur=+b.dataset.i;draw()});
      d.querySelector("[data-retake]").onclick=async()=>{const f=await visPickFile();if(!f)return;try{s.base=await visLoadImage(f);s.shapes=[]}catch(e){}draw()};
      d.querySelector("[data-galm]").onclick=async()=>{const fs=await visPickFiles("gallery");if(!fs.length)return;const add=await visLoadShots(fs);if(!add.length){uiAlert("Images illisibles.");return}cur=shots.length;shots.push(...add);draw()};
      d.querySelectorAll("[data-more]").forEach(b=>b.onclick=async()=>{const f=await visPickFile();if(!f)return;try{shots.push({base:await visLoadImage(f),shapes:[],caption:""});cur=shots.length-1}catch(e){uiAlert("Photo illisible.")}draw()});
      d.querySelector("[data-x]").onclick=async()=>{if(shots.some(x=>x.shapes.length||x.caption)&&!await uiConfirm("Abandonner ces photos ?",{ok:"Abandonner",danger:true}))return;d.remove();done([])};
      d.querySelector("[data-ok]").onclick=async()=>{
        const b=d.querySelector("[data-ok]");b.disabled=true;b.textContent="Enregistrement…";
        const out=[];
        for(const x of shots){
          const c=document.createElement("canvas");c.width=x.base.width;c.height=x.base.height;paint(c,x);
          const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",VIS_Q));
          const id=uid()+uid();
          await idbPut("photos",{id,acct:visAcct(),pid:visCur.projectId,vid:visCur.id,blob,up:false,del:false,at:Date.now()});
          out.push({id,caption:x.caption.trim().slice(0,200)});
        }
        d.remove();done(out);visCount().then(visStatus);
      };
    };
    draw();
  }
  // ---------- Préparation de la visite (au bureau, sur ordinateur ou téléphone) ----------
  const dtLocal=ms=>{if(!ms)return "";const d=new Date(ms);const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`};
  const ptShort=t=>{t=String(t||"");if(rtIs(t))t=rtText(t);t=t.replace(/\s+/g," ").trim();return t.length>180?t.slice(0,177)+"…":t};
  const visPropMore={}; // propositions dépliées au-delà des 5 premières, par flux
  const visPrepOpen={}; // flux dépliés dans la préparation (par défaut : ceux qui ont des éléments)
  // démarrer : le premier jour devient aujourd'hui et la durée prévue est conservée (le dernier jour est décalé d'autant)
  function visStartNow(){visSet(y=>{y.prep=y.prep||{};const n=y.prep.plannedAt?visNDays(y):(y.prep.days||1);
    y.status="open";y.startedAt=Date.now();y.prep.endDay=n>1?iso(addDays(new Date(),n-1)):null});visScreen="home";renderVisit();render();toast("Déplacement démarré : bon déplacement !")}
  function visPrepScreen(o,v,p){
    // v106 : les points ouverts ne sont plus repris d'office ; ceux repris automatiquement auparavant sont retirés une fois
    if(v.status==="prep"&&!isMes(v)&&!(v.prep&&v.prep.propV)){visQuiet(y=>{y.prep=y.prep||{};y.items=(y.items||[]).filter(i=>!(i.kind==="point"&&i.ref));y.prep.propV=1});v=visCur}
    const pr=v.prep||(v.prep={}), live=v.status!=="prep", wide=visWide();
    const parts=pr.participants||[], cand=[], seen=new Set();
    const addC=(name,side,extra)=>{const k=norm(name);if(!name||seen.has(k))return;seen.add(k);cand.push({name,side,...extra})};
    parts.forEach(x=>addC(x.name,x.side));ctList(v.projectId).forEach(c=>addC(c.name,c.side,{role:c.role}));memberEmails(v.projectId).forEach(e=>addC(nameOf(e),"mecalux",{email:e}));
    const on=new Set(parts.map(x=>norm(x.name)));
    const usedPts=new Set((v.items||[]).filter(i=>i.ref).map(i=>i.ref));
    const freePts=livePts().filter(x=>x.projectId===v.projectId&&x.status!=="closed"&&!usedPts.has(x.id))
      .sort((a,b)=>((b.owner==="client")-(a.owner==="client"))||((a.createdAt||0)-(b.createdAt||0)));
    const flowOfPt=x=>{const tk=themeKey(x.theme);return tk?(v.flows||[]).find(f=>!f.off&&themeKey(f.name)===tk):null};
    const propsOf=fid=>freePts.filter(x=>{const f=flowOfPt(x);return f&&f.id===fid});
    const noFlow=freePts.filter(x=>!flowOfPt(x)), nProp=freePts.length-noFlow.length, nAdded=(v.items||[]).filter(i=>i.kind==="point"&&i.ref).length;
    const ageTxt=x=>{if(x.owner!=="client"||!x.createdAt)return x.owner==="mecalux"?"à traiter":"";const d=Math.floor((Date.now()-x.createdAt)/864e5);if(d>3650)return "en attente client";return d<1?"en attente depuis aujourd'hui":`en attente depuis ${d} j`};
    const ownPill=x=>x.owner==="client"?'<span class="vpown cli">Client</span>':x.owner==="mecalux"?'<span class="vpown">Mecalux</span>':"";
    const propHtml=x=>`<div class="vprop"><span><small>${esc(ptNumOf(x)||"Point ouvert")}${ownPill(x)}<em>${esc(ageTxt(x))}</em></small>${esc(ptShort(x.text))}</span><button type="button" class="btn vpadd" data-addprop="${esc(x.id)}">${VI.plus}Ajouter</button></div>`;
    const propBlock=f=>{const ps=propsOf(f.id);if(!ps.length)return "";const more=!!visPropMore[f.id], shown=more?ps:ps.slice(0,5);
      return `<div class="vprops"><div class="vproph"><span class="vpsp" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"></path></svg></span><b>Points ouverts proposés · ${ps.length}</b>${ps.length>1?`<button type="button" class="vislink" data-addall="${esc(f.id)}">Tout ajouter</button>`:""}</div>
        <p class="muted">Points non levés du thème « ${esc(f.name)} ». Rien n'est ajouté tant que vous ne cliquez pas.</p>${shown.map(propHtml).join("")}
        ${ps.length>5?`<button type="button" class="vislink vpmore" data-pmore="${esc(f.id)}">${more?"Réduire":ps.length-5===1?"Voir l'autre":`Voir les ${ps.length-5} autres`}</button>`:""}</div>`};
    const fl=v.flows||[], nOn=fl.filter(f=>!f.off).length, nIt=visItemsOn(v).length;
    const isOpen=f=>!f.off&&(f.id in visPrepOpen?visPrepOpen[f.id]:visItems(v,f.id).length>0);
    const acts=wide?(live?`<button type="button" class="btn primary" data-go>Revenir au déplacement</button>`:`<button type="button" class="btn" data-x>Fermer</button><button type="button" class="btn primary" data-start>${WH_SVG}Démarrer le déplacement</button>`):"";
    o.innerHTML=visHead(live?"Retour au déplacement":"Fermer la préparation",live?"Déplacement":"Projet",live?"Préparation":"Préparer le déplacement",`${esc(v.title)} · ${esc(p.name)}`,acts+visMoreBtn("data-pm","Actions sur le déplacement"))+`
      <main class="vism prep${isMes(v)?" mesprep":""}"><div class="visprepg">
        <div class="vpc1">
        <section class="viscard"><h3>Informations</h3>
          <div class="visgrid"><label class="uifld"><span>Début (date et heure)</span><input type="datetime-local" data-k="plannedAt" value="${dtLocal(pr.plannedAt)}"></label>
          <label class="uifld"><span>Dernier jour <small class="muted">si plusieurs jours</small></span><input type="date" data-k="endDay" data-dptrips="${esc(v.id)}" value="${esc(pr.endDay&&pr.plannedAt&&pr.endDay>iso(new Date(pr.plannedAt))?pr.endDay:"")}" min="${pr.plannedAt?iso(new Date(pr.plannedAt)):""}"></label></div>
          <p class="visdur muted" data-dur${pr.plannedAt&&visNDays(v)>1?"":" hidden"}>${pr.plannedAt?esc(cap(visRangeTxt(v,true))):""}</p>
          <label class="uifld"><span>Lieu</span><input type="text" data-k="location" maxlength="300" placeholder="Site, adresse" value="${esc(pr.location||"")}"></label>
          <label class="uifld"><span>Objectif du déplacement</span><textarea rows="2" data-k="goal" maxlength="2000" placeholder="Ex. : analyser les flux de réception et d'expédition">${esc(pr.goal||"")}</textarea></label>
          <label class="uifld"><span>Infos utiles</span><textarea rows="2" data-k="info" maxlength="2000" placeholder="Contact sur place, horaires, équipements de sécurité…">${esc(pr.info||"")}</textarea></label>
        </section>
        <section class="viscard"><div class="vissh"><h3>Participants</h3>${parts.length?`<span class="muted">${plural(parts.length,"coché","cochés")}</span>`:""}</div>
          ${cand.length?`<div class="mtgppl visppl">${cand.map((x,i)=>`<label><input type="checkbox" data-pp="${i}" ${on.has(norm(x.name))?"checked":""}><span>${esc(x.name)}${x.role?` <small>${esc(x.role)}</small>`:""}</span><em>${esc(SIDE[x.side]||"")}</em></label>`).join("")}</div>`:`<p class="muted">Aucun contact pour ce projet.</p>`}
          <form class="mtgadd" data-padd autocomplete="off"><input type="text" placeholder="Nom ou fonction" aria-label="Nom ou fonction" maxlength="120"><select aria-label="Côté">${Object.entries(SIDE).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select><button class="btn" type="submit">Ajouter</button></form>
        </section>
        </div>
        ${isMes(v)?`<div class="vpcconf"><section class="viscard confprep"><h3>${CONF_SVG}Compte rendu dans Confluence</h3>
          ${pr.conf?`<a class="confpage" href="${esc(pr.conf.url||"#")}" target="_blank" rel="noopener"><b>${esc(pr.conf.title||"Page Confluence")}</b><span>${esc(pr.conf.site||"")} · ouvrir dans Confluence</span></a>
            <p class="muted">Le compte rendu de chaque journée s'écrira en direct dans cette page dès le démarrage de la mise en service : un bloc par journée, le plus récent en haut. Le reste de la page n'est pas modifié.</p>
            <div class="confprepb"><button type="button" class="btn" data-conflink>Changer de page</button><button type="button" class="btn ghost" data-confunlink>Délier</button></div>`
          :`<p class="muted">Liez la page Confluence partagée des comptes rendus : chaque journée y sera écrite en direct dès le démarrage de la mise en service, sans toucher au reste de la page.</p>
            <button type="button" class="btn primary" data-conflink>Lier une page Confluence</button>${MODE==="cloud"?"":`<p class="muted">Nécessite le mode en ligne (compte).</p>`}`}
        </section></div>`:""}
        <div class="vpc2">
          <div class="vishd"><h2>À voir pendant le déplacement</h2><span>${plural(nIt,"élément")} · ${plural(nOn,"flux","flux")}${nProp?` · <b class="vpcount">${plural(nProp,"point proposé","points proposés")}</b>`:""}</span></div>
          <div class="visflows">${fl.map((f,k)=>{const it=visItems(v,f.id), op=isOpen(f);return `<div class="visfl${f.off?" off":""}${op?" open":""}" data-f="${esc(f.id)}">
            <div class="visflh"><input type="checkbox" data-on ${f.off?"":"checked"} aria-label="Flux ${esc(f.name)} couvert pendant le déplacement"><button type="button" class="visflt" data-tog aria-expanded="${op}"${f.off?" disabled":""}><b>${esc(f.name)}</b>${!f.off&&!op&&propsOf(f.id).length?`<span class="vpbadge">${plural(propsOf(f.id).length,"proposé","proposés")}</span>`:""}<span class="muted">${f.off?"non couvert":it.length?plural(it.length,"élément"):"aucun élément"}</span>${f.off?"":VI.chev}</button>
              <button type="button" class="visround sm" data-up ${k?"":"disabled"} aria-label="Monter ${esc(f.name)}">↑</button><button type="button" class="visround sm" data-down ${k<fl.length-1?"":"disabled"} aria-label="Descendre ${esc(f.name)}">↓</button></div>
            ${op?`${it.map(i=>`<div class="visprepi" data-i="${esc(i.id)}"><span>${i.kind==="point"?`<small>${esc(i.label||"Point ouvert")}</small>`:""}${esc(i.text)}</span><button type="button" class="vismore" data-del aria-label="Retirer « ${esc(i.text)} »">✕</button></div>`).join("")}
              <form class="visprepadd" autocomplete="off"><input type="text" maxlength="300" placeholder="Ajouter un élément à voir…" aria-label="Élément à voir pour ${esc(f.name)}"><button class="btn" type="submit">Ajouter</button></form>${propBlock(f)}`:""}
          </div>`}).join("")}</div>
          <button type="button" class="vislink" data-addf>${VI.plus}Ajouter un flux</button>
        </div>
        <aside class="vpc3"><section class="viscard"><div class="vissh"><h3>Points ouverts</h3><span class="muted">${plural(freePts.length+nAdded,"non levé","non levés")}</span></div>
          <div class="vpkpis"><span class="ok"><b>${nAdded}</b>${nAdded>1?"ajoutés":"ajouté"}</span><span class="pr"><b>${nProp}</b>proposé${nProp>1?"s":""} dans les flux</span><span><b>${noFlow.length}</b>sans flux</span></div>
          <p class="muted">Chaque flux propose les points de son thème. Les points dont le thème ne correspond à aucun flux restent ici : choisissez le flux où les voir.</p>
          ${noFlow.length?`<b class="vpsub">Sans flux correspondant · ${noFlow.length}</b>`:""}
          ${noFlow.length?`<div class="vpnflist" tabindex="0" role="region" aria-label="Points ouverts sans flux correspondant (${noFlow.length})">`:""}${noFlow.map(x=>`<div class="vprop vpnf"><span><small>${esc([ptNumOf(x),x.theme].filter(Boolean).join(" · "))}${ownPill(x)}</small>${esc(ptShort(x.text))}</span><span class="vpnfr"><select data-nfsel="${esc(x.id)}" aria-label="Flux où voir ce point"><option value="">Choisir un flux…</option>${(v.flows||[]).filter(f=>!f.off).map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}</select><button type="button" class="btn vpadd" data-addpt="${esc(x.id)}">${VI.plus}Ajouter</button></span></div>`).join("")}${noFlow.length?"</div>":""}
        </section></aside>
      </div></main>
      ${wide?"":`<footer class="visf">${live?`<button type="button" class="btn primary visend" data-go>Revenir au déplacement</button>`:`<button type="button" class="btn visend" data-x>Fermer</button><button type="button" class="btn primary visend" data-start>Démarrer le déplacement</button>`}</footer>`}`;
    const back=()=>{if(live){visScreen="home";renderVisit()}else visClose()};
    o.querySelector("[data-back]").onclick=back;
    const x=o.querySelector("[data-x]");if(x)x.onclick=back;
    const g=o.querySelector("[data-go]");if(g)g.onclick=back;
    const st=o.querySelector("[data-start]");if(st)st.onclick=visStartNow;
    const cl=o.querySelector("[data-conflink]");if(cl)cl.onclick=()=>confLinkDlg(visCur);
    const cu=o.querySelector("[data-confunlink]");if(cu)cu.onclick=async()=>{if(!await uiConfirm("Délier la page Confluence de cette mise en service ?",{ok:"Délier",danger:true}))return;clearTimeout(conf.timers[visCur.id]);delete conf.st[visCur.id];confSaveSent(visCur.id,{});visSet(y=>{if(y.prep)delete y.prep.conf});toast("Page Confluence déliée.")};
    o.querySelector("[data-pm]").onclick=async()=>{const ch=await visSheet(v.title,[{k:"ren",l:"Renommer le déplacement"},{k:"del",l:"Supprimer le déplacement",danger:true}]);
      if(ch==="ren"){const t=await uiPrompt("Intitulé du déplacement",v.title,{ok:"Renommer"});if(t&&t.trim())visSet(y=>{y.title=t.trim().slice(0,300)})}else if(ch==="del")visDelete(visCur)};
    o.querySelectorAll("[data-k]").forEach(el=>el.onchange=()=>{const k=el.dataset.k;
      if(k==="endDay"||k==="plannedAt"){const st=k==="plannedAt"?el.value.slice(0,10):(o.querySelector('[data-k="plannedAt"]').value||"").slice(0,10), ed=o.querySelector('[data-k="endDay"]');
        if(k==="endDay"&&el.value&&!st){el.value="";toast("Indiquez d'abord la date de début.");return}
        ed.min=st;if(ed.value&&st&&ed.value<st){ed.value="";if(k==="endDay")toast("Le dernier jour doit être après le début.")}}
      visQuiet(y=>{y.prep=y.prep||{};if(k==="plannedAt")y.prep.plannedAt=el.value?new Date(el.value).getTime():null;else if(k==="endDay")y.prep.endDay=el.value||null;else y.prep[k]=el.value.trim();
        if(k==="plannedAt"&&y.prep.plannedAt&&!y.prep.endDay&&(y.prep.days||1)>1){y.prep.endDay=iso(addDays(new Date(y.prep.plannedAt),y.prep.days-1));const ed=o.querySelector('[data-k="endDay"]');if(ed)ed.value=y.prep.endDay}
        if(y.prep.endDay&&(!y.prep.plannedAt||y.prep.endDay<=iso(new Date(y.prep.plannedAt))))y.prep.endDay=null;
        const du=o.querySelector("[data-dur]");if(du){const multi=y.prep.plannedAt&&visNDays(y)>1;du.hidden=!multi;du.textContent=multi?cap(visRangeTxt(y,true)):""}})});
    o.querySelectorAll("[data-pp]").forEach(cb=>cb.onchange=()=>visQuiet(y=>{const c=cand[+cb.dataset.pp];y.prep.participants=(y.prep.participants||[]).filter(z=>norm(z.name)!==norm(c.name));if(cb.checked)y.prep.participants.push({name:c.name,side:c.side,...(c.email?{email:c.email}:{})})}));
    const pa=o.querySelector("[data-padd]");pa.onsubmit=async e=>{e.preventDefault();const name=pa.querySelector("input").value.trim(),side=pa.querySelector("select").value;if(!name)return;
      if(!ctList(v.projectId).some(c=>norm(c.name)===norm(name)))await ctAdd(v.projectId,{name,side});
      visSet(y=>{y.prep.participants=(y.prep.participants||[]).filter(z=>norm(z.name)!==norm(name));y.prep.participants.push({name,side})})};
    const ptItem=(x,fid)=>({id:uid(),flow:fid,kind:"point",ref:x.id,text:x.text.split("\n")[0].slice(0,300),label:ptNumOf(x)||"Point ouvert",seen:false});
    o.querySelectorAll("[data-addprop]").forEach(b=>b.onclick=()=>{const x=livePts().find(z=>z.id===b.dataset.addprop), f=x&&flowOfPt(x);if(!f)return;
      visPrepOpen[f.id]=true;visSet(y=>{y.items=y.items||[];if(!y.items.some(i=>i.ref===x.id))y.items.push(ptItem(x,f.id))})});
    o.querySelectorAll("[data-addall]").forEach(b=>b.onclick=()=>{const fid=b.dataset.addall, ps=propsOf(fid);visPrepOpen[fid]=true;
      visSet(y=>{y.items=y.items||[];ps.forEach(x=>{if(!y.items.some(i=>i.ref===x.id))y.items.push(ptItem(x,fid))})});toast(`${plural(ps.length,"point ouvert ajouté","points ouverts ajoutés")} au flux.`)});
    o.querySelectorAll("[data-pmore]").forEach(b=>b.onclick=()=>{visPropMore[b.dataset.pmore]=!visPropMore[b.dataset.pmore];renderVisit()});
    o.querySelector("[data-addf]").onclick=async()=>{const n=await uiPrompt("Nom du nouveau flux","",{ok:"Ajouter"});if(n&&n.trim())visSet(y=>y.flows.push({id:uid(),name:n.trim().slice(0,60)}))};
    o.querySelectorAll("[data-addpt]").forEach(b=>b.onclick=async()=>{
      const x=livePts().find(z=>z.id===b.dataset.addpt);if(!x)return;
      const sel=o.querySelector(`[data-nfsel="${CSS.escape(x.id)}"]`);let fid=sel&&sel.value;
      if(!fid)fid=await visPickFlow("Dans quel flux voir ce point ?");if(!fid)return;
      visPrepOpen[fid]=true;
      visSet(y=>{y.items=y.items||[];y.items.push({id:uid(),flow:fid,kind:"point",ref:x.id,text:x.text.split("\n")[0].slice(0,300),label:ptNumOf(x)||"Point ouvert",seen:false})});
    });
    o.querySelectorAll(".visfl").forEach(box=>{
      const fid=box.dataset.f, idx=()=>visCur.flows.findIndex(z=>z.id===fid);
      box.querySelector("[data-on]").onchange=e=>visSet(y=>{y.flows.find(z=>z.id===fid).off=!e.target.checked});
      box.querySelector("[data-tog]").onclick=()=>{visPrepOpen[fid]=!box.classList.contains("open");renderVisit()};
      box.querySelector("[data-up]").onclick=()=>visSet(y=>{const i=idx();if(i>0)[y.flows[i-1],y.flows[i]]=[y.flows[i],y.flows[i-1]]});
      box.querySelector("[data-down]").onclick=()=>visSet(y=>{const i=idx();if(i<y.flows.length-1)[y.flows[i+1],y.flows[i]]=[y.flows[i],y.flows[i+1]]});
      box.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{const id=b.closest("[data-i]").dataset.i;visSet(y=>{y.items=y.items.filter(z=>z.id!==id);y.notes.forEach(n=>{if(n.item===id)delete n.item})})});
      const fa=box.querySelector(".visprepadd");if(fa)fa.onsubmit=e=>{e.preventDefault();const t=fa.querySelector("input").value.trim();if(t){visPrepOpen[fid]=true;visSet(y=>{y.items=y.items||[];y.items.push({id:uid(),flow:fid,kind:"free",text:t.slice(0,300),seen:false})});const n=$(`#visview .visfl[data-f="${fid}"] .visprepadd input`);if(n)n.focus()}};
    });
  }
  // ---------- Scan de codes-barres (API BarcodeDetector : Chrome sur Android ; absente sur iPhone) ----------
  const BC_FMT={ean_13:"EAN-13",ean_8:"EAN-8",upc_a:"UPC-A",upc_e:"UPC-E",code_128:"Code 128",code_39:"Code 39",code_93:"Code 93",codabar:"Codabar",itf:"ITF (2 parmi 5 entrelacé)",data_matrix:"Datamatrix",qr_code:"QR code",pdf417:"PDF417",aztec:"Aztec"};
  const bcOk=()=>typeof window.BarcodeDetector==="function"&&!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
  const BC_SVG=`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13 8v8M17 8v8"></path></svg>`;
  // Lecture GS1 : (01)03760123456784(10)LOT… à partir du contenu brut (séparateur FNC1 = caractère GS)
  const GS1_FIX={"00":18,"01":14,"02":14,"11":6,"12":6,"13":6,"15":6,"16":6,"17":6,"20":2};
  function gs1Parse(raw){
    let s=String(raw||"");const sym=/^\](C1|d2|Q3|e0)/.test(s);s=s.replace(/^\][A-Za-z]\d/,"").replace(/^\u001d/,"");
    if(!sym&&!s.includes("\u001d")&&!/^(00\d{18}|01\d{14})/.test(s))return null;
    const out=[];let i=0;
    while(i<s.length){
      if(s[i]==="\u001d"){i++;continue}
      const two=s.substr(i,2), three=s.substr(i,3), four=s.substr(i,4);let ai,len=null;
      if(GS1_FIX[two]){ai=two;len=GS1_FIX[two]}
      else if(/^3[1-6]\d\d$/.test(four)){ai=four;len=6}
      else if(/^41[0-7]$/.test(three)){ai=three;len=13}
      else if(/^(24[0-3]|25[0-5]|40[0-3]|42[0-2])$/.test(three)){ai=three}
      else if(/^(70[0-3]\d|8\d\d\d)$/.test(four)){ai=four}
      else if(/^(10|21|22|30|37|9\d)$/.test(two)){ai=two}
      else return null;
      i+=ai.length;let v;
      if(len){v=s.substr(i,len);if(v.length!==len)return null;i+=len}
      else{const e=s.indexOf("\u001d",i);v=e<0?s.slice(i):s.slice(i,e);i=e<0?s.length:e+1}
      if(!v)return null;out.push(`(${ai})${v}`);
    }
    return out.length?out.join(""):null;
  }
  async function visScan(done){
    let stream=null, timer=null, det=null, found=null, shot=null, cand=null, torch=false;
    const d=document.createElement("div");d.className="visscan";d.setAttribute("role","dialog");d.setAttribute("aria-modal","true");d.setAttribute("aria-label","Scanner un code-barres");
    d.innerHTML=`<header><button type="button" class="visround" data-x aria-label="Fermer le scan">✕</button><div class="vist"><b>Scanner un code-barres</b><span>Étiquette fournisseur, emplacement, support…</span></div></header>
      <div class="visscanv"><video playsinline muted autoplay></video><div class="visscanf" aria-hidden="true"></div></div>
      <div class="visscanr" aria-live="polite"><p class="muted">Visez le code-barres, il est lu automatiquement.</p></div>`;
    d.querySelector("header").insertAdjacentHTML("beforeend",`<button type="button" class="btn ghost vistorch" data-torch hidden aria-pressed="false">Lampe</button>`);
    document.body.appendChild(d);
    const video=d.querySelector("video"), out=d.querySelector(".visscanr");
    const stop=()=>{clearInterval(timer);timer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null};
    const close=v=>{stop();d.remove();done(v)};
    d.querySelector("[data-x]").onclick=()=>close(null);
    const start=async()=>{
      if(shot&&shot.parentNode)shot.remove();video.hidden=false;
      found=null;shot=null;cand=null;
      out.innerHTML=`<p class="muted">Visez le code-barres, il est lu automatiquement. Pour un code long, approchez-vous jusqu'à ce qu'il remplisse la largeur.</p>`;
      // haute résolution : indispensable pour les codes 1D longs (GS1-128), dont les barres sont fines
      try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false})}
      catch(e){out.innerHTML=`<p class="uierr">Accès à l'appareil photo refusé ou impossible. Autorisez la caméra pour ce site dans les réglages du navigateur.</p>`;return}
      video.srcObject=stream;try{await video.play()}catch(e){}
      const track=stream.getVideoTracks()[0];
      try{await track.applyConstraints({advanced:[{focusMode:"continuous"}]})}catch(e){}
      const tb=d.querySelector("[data-torch]");
      try{const cp=track.getCapabilities?track.getCapabilities():{};if(cp.torch){tb.hidden=false;tb.onclick=async()=>{torch=!torch;try{await track.applyConstraints({advanced:[{torch}]});tb.setAttribute("aria-pressed",torch)}catch(e){}}}}catch(e){}
      if(!det){let fm;try{fm=await window.BarcodeDetector.getSupportedFormats()}catch(e){}det=new window.BarcodeDetector(fm&&fm.length?{formats:fm}:undefined)}
      timer=setInterval(async()=>{
        if(!video.videoWidth||found)return;
        let r;try{r=await det.detect(video)}catch(e){return}
        if(!r||!r.length||found){if(!r||!r.length)cand=null;return}
        // plusieurs codes visibles : on retient celui le plus proche du centre de l'image
        const cx=video.videoWidth/2, cy=video.videoHeight/2, dist=x=>{const b=x.boundingBox||{x:cx,y:cy,width:0,height:0};return Math.hypot(b.x+b.width/2-cx,b.y+b.height/2-cy)};
        const best=r.slice().sort((a,b)=>dist(a)-dist(b))[0], key=best.format+"|"+best.rawValue;
        // confirmation : la même lecture doit revenir deux fois de suite (évite les fausses lectures)
        if(!cand||cand.key!==key){cand={key,n:1};return}
        if(++cand.n<2)return;
        found=best;
        const c=document.createElement("canvas"), k=Math.min(1,VIS_MAX/Math.max(video.videoWidth,video.videoHeight));
        c.width=Math.round(video.videoWidth*k);c.height=Math.round(video.videoHeight*k);c.getContext("2d").drawImage(video,0,0,c.width,c.height);shot=c;
        stop();c.className="visshot";video.hidden=true;d.querySelector(".visscanv").appendChild(c);
        const raw0=String(found.rawValue||""), g=gs1Parse(raw0), raw=g||raw0.replace(/\u001d/g," | ");
        const fmt=g?(found.format==="code_128"?"GS1-128":found.format==="data_matrix"?"GS1 Datamatrix":found.format==="qr_code"?"GS1 QR code":(BC_FMT[found.format]||found.format)+" (GS1)"):(BC_FMT[found.format]||found.format||"Code-barres");
        out.innerHTML=`<div class="visbc"><span class="muted">Format</span><b>${esc(fmt)}</b><span class="muted">Contenu</span><code>${esc(raw)||"(vide)"}</code></div>
          <label class="vischk"><input type="checkbox" data-shot checked><span>Joindre la photo de l'étiquette</span></label>
          <div class="visscanb"><button type="button" class="btn" data-again>Scanner à nouveau</button><button type="button" class="btn primary" data-use>Ajouter à la note</button></div>`;
        out.querySelector("[data-again]").onclick=start;
        out.querySelector("[data-use]").onclick=async()=>{
          let photo=null;
          if(out.querySelector("[data-shot]").checked&&shot){
            const blob=await new Promise(res=>shot.toBlob(res,"image/jpeg",VIS_Q)), id=uid()+uid();
            await idbPut("photos",{id,acct:visAcct(),pid:visCur.projectId,vid:visCur.id,blob,up:false,del:false,at:Date.now()});
            photo={id,caption:`Code-barres ${fmt}`.slice(0,200)};
          }
          close({text:`Code-barres ${fmt} : ${raw}`,photo});
        };
      },250);
    };
    start();
  }
  // ---------- Fin de visite : bilan, points ouverts, tâches, export ----------
  function visEndScreen(o,v,p){
    const ns=v.notes||[], its=v.items||[];
    const fname=id=>(v.flows.find(f=>f.id===id)||{name:"?"}).name;
    const itemOf=n=>n.item?its.find(i=>i.id===n.item):null;
    // notes à transformer : questions et actions, sauf les réponses à un point ouvert existant
    const todo=ns.filter(n=>!n.conv&&(n.type==="question"||n.type==="action")&&!((itemOf(n)||{}).kind==="point"));
    const nq=todo.filter(n=>n.type==="question"), na=todo.filter(n=>n.type==="action");
    const answered=its.filter(i=>i.kind==="point"&&!i.applied&&ns.some(n=>n.item===i.id));
    const left=its.filter(i=>!i.seen&&!i.applied&&!ns.some(n=>n.item===i.id)), leftFree=left.filter(i=>i.kind!=="point"), leftPts=left.filter(i=>i.kind==="point");
    const ansTxt=i=>ns.filter(n=>n.item===i.id).map(n=>n.text||"(photos)").join(" / ");
    const seenN=its.filter(i=>i.seen).length, c=visCounts(ns);
    const anything=todo.length||answered.length||leftFree.length;
    const dur=v.startedAt&&v.endedAt&&v.endedAt>v.startedAt?(m=>` (${m>=60?Math.floor(m/60)+" h "+String(m%60).padStart(2,"0"):m+" min"})`)(Math.round((v.endedAt-v.startedAt)/60000)):"";
    const kpi=(n,s,pl,k)=>`<div class="viskpi vt-${k}"><b>${n}</b><span>${n>1?pl:s}</span></div>`;
    const what=[nq.length?`${plural(nq.length,"question")} ${nq.length>1?"deviennent des points ouverts":"devient un point ouvert"} pour le client, rangé${nq.length>1?"s":""} par flux`:"",na.length?`${plural(na.length,"action")} ${na.length>1?"deviennent des tâches":"devient une tâche"} à votre nom`:""].filter(Boolean).join(" · ");
    o.innerHTML=visHead("Retour au déplacement","Déplacement",v.status==="done"?"Bilan du déplacement":"Fin de déplacement",`${esc(p.name)} · ${hm(visDate(v))}${v.endedAt?" – "+hm(v.endedAt):""}${dur}`,"")+
      `<main class="vism end">
        <section class="viscard">
          <div class="viskpis">${kpi(c.n,"note","notes","n")}${kpi(c.ph,"photo","photos","n")}${kpi(c.q,"question","questions","cli")}${kpi(c.a,"action","actions","act")}</div>
          ${its.length?`<div class="viscov"><span class="vbar${seenN===its.length?" ok":""}"><i style="width:${Math.round(100*seenN/its.length)}%"></i></span><b>${seenN} / ${its.length} éléments prévus vus</b></div>`:""}
          ${v.flows.some(f=>visNotes(v,f.id).length)?`<div class="visflsum">${v.flows.map(f=>{const x=visCounts(visNotes(v,f.id));if(!x.n)return "";return `<span><b>${esc(f.name)}</b> ${[plural(x.n,"note"),x.ph?plural(x.ph,"photo"):"",x.q?plural(x.q,"question"):"",x.a?plural(x.a,"action"):""].filter(Boolean).join(" · ")}</span>`}).join("")}</div>`:`<p class="muted">Aucune note.</p>`}
        </section>
        <section class="viscard"><div class="vissh"><h3>À créer dans le projet</h3>${todo.length?`<b data-cnt>${plural(todo.length,"élément coché","éléments cochés")}</b>`:""}</div>
          ${todo.length?`<p class="muted">${what}.</p>${todo.map(n=>`<label class="vischk sm"><input type="checkbox" data-one="${esc(n.id)}" data-kind="${n.type}" checked><span><span class="vckh"><span class="tag vt-${n.type==="question"?"cli":"act"}">${n.type==="question"?"Point ouvert":"Tâche"}</span><em>${esc(fname(n.flow))}</em></span>${esc(n.text||"(photo sans texte)")}</span></label>`).join("")}`
          :`<p class="muted">${ns.some(n=>n.conv)?"Tous les points et tâches de ce déplacement ont déjà été créés.":"Aucune note de type « Question client » ou « Action »."}</p>`}
        </section>
        ${answered.length?`<section class="viscard"><h3>Points ouverts répondus sur site</h3><p class="muted">La réponse est ajoutée au point. Cochez ceux qui peuvent être levés.</p>${answered.map(i=>`<label class="vischk sm"><input type="checkbox" data-close="${esc(i.id)}"><span><em>Lever le point ${esc(i.label||"")} (${esc(fname(i.flow))})</em>${esc(i.text)}<small class="visans">Réponse : ${esc(ansTxt(i))}</small></span></label>`).join("")}</section>`:""}
        ${left.length?`<section class="viscard"><h3>Restant à voir</h3>${leftFree.map(i=>`<div class="visleft"><span><em>${esc(fname(i.flow))}</em>${esc(i.text)}</span><div class="visseg3" role="radiogroup" aria-label="Que faire de « ${esc(i.text)} » ?">${[["","Ignorer"],["point","Point ouvert"],["task","Tâche"]].map(([val,l],k)=>`<label><input type="radio" name="vl-${esc(i.id)}" value="${val}" data-left="${esc(i.id)}"${k?"":" checked"}><span>${l}</span></label>`).join("")}</div></div>`).join("")}${leftPts.map(i=>`<div class="visleft"><span><em>${esc(i.label||"Point ouvert")} · ${esc(fname(i.flow))}</em>${esc(i.text)}</span><span class="muted">reste ouvert</span></div>`).join("")}</section>`:""}
      </main>
      <footer class="visf col vendf">${anything?`<button type="button" class="btn primary" data-apply>Appliquer au projet</button>`:""}<div class="visf2"><button type="button" class="btn" data-pdf>${VI.doc}Compte rendu PDF</button>${v.status==="done"?`<button type="button" class="btn" data-reopen>Reprendre le déplacement</button>`:`<button type="button" class="btn ${anything?"":"primary "}visdone" data-done>Clôturer le déplacement</button>`}</div></footer>`;
    o.querySelector("[data-back]").onclick=()=>{visScreen="home";renderVisit()};
    const ap=o.querySelector("[data-apply]");
    const label=()=>{if(!ap)return;
      const one=[...o.querySelectorAll("[data-one]:checked")], lc=[...o.querySelectorAll("[data-left]:checked")];
      const np=one.filter(x=>x.dataset.kind==="question").length+lc.filter(x=>x.value==="point").length, nt=one.filter(x=>x.dataset.kind==="action").length+lc.filter(x=>x.value==="task").length;
      const parts=[np?plural(np,"point ouvert","points ouverts"):"",nt?plural(nt,"tâche"):""].filter(Boolean);
      ap.textContent=parts.length&&!answered.length?"Créer "+parts.join(" et "):"Appliquer au projet";
      const cn=o.querySelector("[data-cnt]");if(cn)cn.textContent=plural(one.length,"élément coché","éléments cochés")};
    o.querySelectorAll("[data-one],[data-left]").forEach(x=>x.addEventListener("change",label));label();
    if(ap)ap.onclick=()=>visApply(
      new Set([...o.querySelectorAll("[data-one]")].filter(x=>x.checked).map(x=>x.dataset.one)),
      new Set([...o.querySelectorAll("[data-close]")].filter(x=>x.checked).map(x=>x.dataset.close)),
      Object.fromEntries([...o.querySelectorAll("[data-left]:checked")].filter(x=>x.value).map(x=>[x.dataset.left,x.value])));
    o.querySelector("[data-pdf]").onclick=()=>visPdf(visCur);
    const dn=o.querySelector("[data-done]");if(dn)dn.onclick=()=>visFinish(visCur);
    const ro=o.querySelector("[data-reopen]");if(ro)ro.onclick=()=>{visSet(x=>{x.status="open";x.endedAt=null});visScreen="home";renderVisit()};
  }
  function visApply(ids,closeIds,leftChoice){
    const v=visCur, now=Date.now(), dstr=new Date(visDate(v)).toLocaleDateString("fr-FR"), src=`Issu du déplacement du ${dstr}`;
    const fname=id=>(v.flows.find(f=>f.id===id)||{name:""}).name;
    let nP=0,nT=0,nA=0,nC=0,k=0;
    const me=MODE==="cloud"&&cloud.email?resolveWho(nameOf(cloud.email),v.projectId):"";
    const mkPoint=(txt,flow)=>{const id=newId();state.points.push({id,projectId:v.projectId,text:rtCut(txt,2000),answer:"",hypothesis:"",erp:"",theme:fname(flow).slice(0,80),owner:"client",ownerName:"",status:"open",taskId:null,requestId:null,createdAt:now+(k++),closedAt:null});nP++;return id};
    const mkTask=(txt,flow)=>{const id=newId();state.tasks.push({id,projectId:v.projectId,title:rtText(txt).split("\n")[0].slice(0,300),priority:"normale",due:"",status:"todo",note:rtJoin(rtIs(txt)||txt.includes("\n")?txt:"",src+(fname(flow)?` (${fname(flow)})`:"")),who:me,createdAt:now+(k++),checklist:[],repeat:null});nT++;return id};
    // 1. notes « Question client » et « Action »
    v.notes.filter(n=>ids.has(n.id)&&!n.conv).forEach(n=>{
      const txt=(n.text||"").trim()||`Voir photo${(n.photos||[]).length>1?"s":""} (${fname(n.flow)})`;
      if(n.type==="question")n.conv={kind:"point",id:mkPoint(txt,n.flow)};
      else if(n.type==="action")n.conv={kind:"task",id:mkTask(txt,n.flow)};
    });
    // 2. réponses apportées sur site aux points ouverts existants
    (v.items||[]).filter(i=>i.kind==="point"&&!i.applied&&v.notes.some(n=>n.item===i.id)).forEach(i=>{
      const o=(state.points||[]).find(x=>x.id===i.ref&&!x.deletedAt);i.applied=true;if(!o)return;
      const t=v.notes.filter(n=>n.item===i.id).map(n=>rtText(n.text||"").trim()||"voir les photos du compte rendu de déplacement").join(" / ");
      o.answer=rtJoin(o.answer,`Déplacement du ${dstr} : ${t}`);nA++;
      if(closeIds.has(i.id)&&o.status!=="closed"){o.status="closed";o.closedAt=now;nC++}
    });
    // 3. éléments prévus non vus
    (v.items||[]).filter(i=>!i.applied&&leftChoice[i.id]).forEach(i=>{i.applied=true;i.conv={kind:leftChoice[i.id],id:leftChoice[i.id]==="point"?mkPoint(i.text,i.flow):mkTask(i.text,i.flow)}});
    if(!nP&&!nT&&!nA){toast("Rien à appliquer.");return}
    save();visPut(v);renderVisit();render();
    toast([nP?plural(nP,"point ouvert créé","points ouverts créés"):"",nT?plural(nT,"tâche créée","tâches créées"):"",nA?`${plural(nA,"réponse ajoutée","réponses ajoutées")} aux points${nC?` (${plural(nC,"levé","levés")})`:""}`:""].filter(Boolean).join(", ")+".");
  }
  async function visPdf(v){
    if(isMes(v))return mesPdf(v,null);
    const p=proj(v.projectId)||{name:""};
    const urls={};await Promise.all(v.notes.flatMap(n=>(n.photos||[]).map(async ph=>{urls[ph.id]=await visPhotoUrl(v,ph.id)})));
    const missing=Object.values(urls).filter(u=>!u).length;
    const its=v.items||[], pr=v.prep||{};
    const sec=visFlows(v).map(f=>{const ns=visNotes(v,f.id), it=visItems(v,f.id);if(!ns.length&&!it.length)return "";
      return `<section><h2>${esc(f.name)}</h2>${it.length?`<ul class="it">${it.map(i=>`<li class="${i.seen?"ok":"ko"}">${i.seen?"Vu":"Non vu"} · ${i.kind==="point"?esc(i.label||"Point ouvert")+" – ":""}${esc(i.text)}</li>`).join("")}</ul>`:""}${ns.map((n,ix)=>`${visNDays(v)>1&&(!ix||iso(new Date(ns[ix-1].at))!==iso(new Date(n.at)))?`<h3 class="dy">${esc(visDayHead(v,iso(new Date(n.at))))}</h3>`:""}<div class="n"><div class="h"><span class="t ${n.type}">${(NTYPE[n.type]||NTYPE.note)[0]}</span> ${hm(n.at)}${n.item&&its.find(i=>i.id===n.item)?` · réponse à : ${esc(its.find(i=>i.id===n.item).text)}`:""}</div>${n.text?`<div class="rtx">${rtHtml(n.text)}</div>`:""}${n.audio?`<p class="au">Enregistrement de ${mmss(n.audio.dur||0)}${n.tr?" – transcription automatique :":" (non transcrit)"}</p>${n.tr?`<p class="tr">${esc(n.tr.text).replace(/\n/g,"<br>")}</p>`:""}`:""}${(n.photos||[]).length?`<div class="ph">${n.photos.map(ph=>urls[ph.id]?`<figure><img src="${urls[ph.id]}" alt=""><figcaption>${esc(ph.caption||"")}</figcaption></figure>`:"").join("")}</div>`:""}</div>`).join("")}</section>`}).join("");
    const css=`body{font-family:Arial,sans-serif;color:#16232B;margin:0;font-size:11pt}h1{font-size:18pt;margin:0}.sub{color:#51646F;margin:4px 0 16px}h2{font-size:13pt;color:#1D4E78;border-bottom:1px solid #C7D1D8;padding-bottom:3px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.03em}.n{margin:0 0 10px;break-inside:avoid}.au{font-size:9.5pt;color:#4B3A8C;font-weight:bold;margin:2px 0}.tr{font-style:italic;color:#3A4B55;margin:2px 0 4px}.h{font-size:9pt;color:#51646F}.t{font-weight:bold;padding:1px 6px;border-radius:8px;background:#EEF1F3}.t.question{background:#DCEAF7;color:#1D4E78}.t.action{background:#FFF4CC;color:#6B5200}p{margin:3px 0}.ph{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}figure{margin:0;width:48%;break-inside:avoid}figure img{width:100%;border-radius:4px}figcaption{font-size:9pt;color:#51646F}.it{margin:0 0 10px;padding-left:18px;font-size:10pt}.it li.ok{color:#1F5C43}.it li.ko{color:#9A3412}.meta{display:grid;grid-template-columns:110px 1fr;gap:3px 10px;margin:0 0 14px;font-size:10pt}.meta b{color:#51646F;font-weight:normal}.dy{font-size:10pt;color:#51646F;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.04em}@page{margin:15mm}`;
    const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(v.title)}</title><style>${css}.vh{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.vh img{max-height:52px;max-width:160px;object-fit:contain}</style></head><body><div class="vh"><h1>${esc(v.title)}</h1>${pLogo(p)?`<img src="${p.logo}" alt="">`:""}</div><p class="sub">${esc(p.name)} · ${esc(new Date(visDate(v)).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}))}${v.endedAt&&v.startedAt?` · ${hm(v.startedAt)} – ${hm(v.endedAt)}`:""}</p>${pr.location||pr.goal||(pr.participants||[]).length?`<div class="meta">${pr.location?`<b>Lieu</b><span>${esc(pr.location)}</span>`:""}${pr.goal?`<b>Objectif</b><span>${esc(pr.goal)}</span>`:""}${(pr.participants||[]).length?`<b>Participants</b><span>${esc(pr.participants.map(x=>x.name+(SIDE[x.side]?` (${SIDE[x.side]})`:"")).join(", "))}</span>`:""}</div>`:""}${sec||"<p>Aucune note.</p>"}</body></html>`;
    if(missing)toast(`${plural(missing,"photo")} non disponible${missing>1?"s":""} hors connexion : absente${missing>1?"s":""} du PDF.`);
    printHtml(html,`deplacement-${(p.name||"projet").replace(/[^\wÀ-ÿ-]+/g,"-")}-${iso(new Date(visDate(v)))}`);
  }

  // ---------- Notes séparées par jour (déplacement sur plusieurs jours) ----------
  const visDayIdx=(v,d)=>{const i=visDays(v).indexOf(d);return i>=0?i+1:0};
  const visDayHead=(v,d)=>{const k=visDayIdx(v,d);return `${k?"Jour "+k+" · ":""}${dayLbl(d)}`};
  function visDayBar(v){
    if(isMes(v)||visNDays(v)<2)return "";
    const ds=visDays(v);if(visDayF&&!ds.includes(visDayF))visDayF="";
    return `<div class="visdayf" role="group" aria-label="Afficher les notes de"><button type="button" data-dayf="" aria-pressed="${!visDayF}">Tous les jours</button>${ds.map((d,i)=>`<button type="button" data-dayf="${d}" aria-pressed="${visDayF===d}" title="${esc(dayLbl(d,true))}">Jour ${i+1}</button>`).join("")}</div>`;
  }
  function visNotesList(v,ns){
    const multi=!isMes(v)&&visNDays(v)>1;
    if(multi&&visDayF)ns=ns.filter(n=>iso(new Date(n.at))===visDayF);
    if(!ns.length)return `<p class="visempty">${visDayF&&multi?"Aucune note ce jour-là pour ce flux.":"Aucune note pour ce flux. Écrivez ou prenez une photo ci-dessous."}</p>`;
    if(!multi)return ns.map(n=>visNoteHtml(n)).join("");
    let last="";return ns.map(n=>{const d=iso(new Date(n.at)), h=d!==last?`<div class="visdsep"><b>${esc(visDayHead(v,d))}</b></div>`:"";last=d;return h+visNoteHtml(n)}).join("");
  }
  // ---------- Mise en service : un compte rendu par jour ----------
  const MES_ROWS=p=>[["ok","Process OK / Actions réalisées","list"],["pb","Problèmes majeurs et points en cours","list"],["todo","Points à traiter / Actions à venir","list"],["statut","Statut de l'installation","text"],["rc","Ressenti "+(p.name||"client"),"text"],["rm","Ressenti Mecalux","text"]];
  const MES_ST={"Fait":"done-t","En cours":"vt-act","À faire":"mes-todo","Annulée":"mes-ann"};
  const mesClosed=st=>st==="Fait"||st==="Annulée";
  function mesDays(v){const s=new Set(visDays(v));(v.flows||[]).forEach(f=>{if(f.day)s.add(f.day)});return [...s].sort()}
  const mesFlow=(v,d)=>(v.flows||[]).find(f=>f.day===d);
  const mesRows=(v,fid)=>(v.items||[]).filter(i=>i.mk==="row"&&i.flow===fid).sort((a,b)=>(a.pos||0)-(b.pos||0));
  const mesIts=(v,rid)=>(v.items||[]).filter(i=>i.mk==="it"&&i.row===rid).sort((a,b)=>(a.pos||0)-(b.pos||0));
  const mesDayName=(v,d)=>{const k=mesDays(v).indexOf(d)+1;return `Jour ${k} · ${dayLbl(d)}`};
  function mesPickDay(v){const ds=mesDays(v), t=iso(new Date());if(visMesDay&&ds.includes(visMesDay))return visMesDay;return ds.includes(t)?t:t<ds[0]?ds[0]:ds[ds.length-1]}
  // crée la journée : rubriques de la veille (ou rubriques par défaut) et éléments non terminés repris
  function mesCreateDay(y,d){
    let f=mesFlow(y,d);if(f)return f;
    y.flows=y.flows||[];y.items=y.items||[];
    f={id:uid(),name:"",day:d};y.flows.push(f);y.flows.sort((a,b)=>(a.day||"").localeCompare(b.day||""));
    y.flows.forEach(x=>{if(x.day)x.name=mesDayName(y,x.day)});
    const prev=y.flows.filter(x=>x.day&&x.day<d&&mesRows(y,x.id).length).pop();
    let pos=0;
    if(prev)mesRows(y,prev.id).forEach(r=>{const nr={id:uid(),flow:f.id,mk:"row",key:r.key||null,title:r.title,kind:r.kind,text:"",pos:pos++};y.items.push(nr);
      if(r.kind==="list")mesIts(y,r.id).filter(i=>!mesClosed(i.st)).forEach((i,j)=>y.items.push({id:uid(),flow:f.id,mk:"it",row:nr.id,t:i.t,d:i.d||"",who:i.who||"",st:i.st,pos:j,from:i.from||i.id,...(i.c?{c:i.c}:{})}))});
    else MES_ROWS(proj(y.projectId)||{}).forEach(([key,title,kind])=>y.items.push({id:uid(),flow:f.id,mk:"row",key,title,kind,text:"",pos:pos++}));
    return f;
  }
  // flux de la journée affichée (créée au besoin) : photos rapides et enregistrements
  function mesTodayFlow(){const d=mesPickDay(visCur);let id=(mesFlow(visCur,d)||{}).id;if(!id)visQuiet(y=>{id=mesCreateDay(y,d).id});return id}
  // « Fait » range l'élément dans « Process OK » ; repassé à faire, il retourne dans la rubrique correspondante
  function mesRoute(y,it){const rows=mesRows(y,it.flow), cur=rows.find(r=>r.id===it.row), by=k=>rows.find(r=>r.key===k);
    if(it.st==="Fait"&&by("ok"))it.row=by("ok").id;
    else if(it.st==="Annulée"){if(!cur){const t=by("pb")||rows.find(r=>r.kind==="list");if(t)it.row=t.id}}
    else if((!cur||cur.key==="ok")&&it.st!=="Fait"){const t=by(it.st==="En cours"?"pb":"todo")||by("pb")||by("todo")||rows.find(r=>r.kind==="list"&&r.key!=="ok");if(t)it.row=t.id}}
  function mesPeople(v){const s=new Map();const add=n=>{n=String(n||"").trim();if(n&&!s.has(norm(n)))s.set(norm(n),n)};
    ((v.prep||{}).participants||[]).filter(x=>x.side!=="client").forEach(x=>add(x.name.split(/\s+/)[0]));(v.items||[]).forEach(i=>{if(i.mk==="it")add(i.who)});return [...s.values()].slice(0,12)}
  function mesItemDialog(rowId,itId){
    const v=visCur, it=itId?v.items.find(i=>i.id===itId):null, row=v.items.find(i=>i.id===(it?it.row:rowId));if(!row)return;
    const rows=mesRows(v,row.flow).filter(r=>r.kind==="list");
    // même sujet déjà saisi (sans description différente) : proposer de mettre à jour le point existant plutôt que d'en créer un double
    const twin=r=>{if(itId)return null;const t=norm(r.t), d=norm(rtText(r.d||""));const ds=mesDays(v), dayOf=i=>(v.flows.find(f=>f.id===i.flow)||{}).day||"";
      return (v.items||[]).filter(i=>i.mk==="it"&&norm(i.t)===t&&(!d||norm(rtText(i.d||""))===d)).sort((a,b)=>ds.indexOf(dayOf(b))-ds.indexOf(dayOf(a)))[0]||null};
    const save=async r=>{if(!r||!String(r.t||"").trim())return;
      const tw=twin(r);let link=null, upd=null;
      if(tw){const same=tw.flow===row.flow, dn=mesDayName(v,(v.flows.find(f=>f.id===tw.flow)||{}).day||"");
        const ch=await uiDialog({kind:"dialog",title:"Ce point existe déjà",msg:`« ${tw.t} » (${tw.st||"sans état"}${tw.who?", "+tw.who:""}) a déjà été saisi ${same?"dans cette journée":"le "+dn}.\n\nMettre à jour ce point évite un doublon dans le compte rendu et dans la copie Excel.`,buttons:[{v:null,label:"Annuler",cls:"ghost"},{v:"new",label:"Créer un nouveau point"},{v:"upd",label:"Mettre à jour le point existant",cls:"primary",focus:true}]});
        if(!ch)return;if(ch==="upd"){if(same)upd=tw.id;else link=tw}}
      if(upd&&!String(r.d||"").trim())r.d=tw.d||"";if(link&&!String(r.d||"").trim())r.d=link.d||"";if((upd||link)&&!String(r.who||"").trim())r.who=(upd?tw:link).who||"";
      visSet(y=>{let x=(itId||upd)&&y.items.find(i=>i.id===(itId||upd));
        if(!x){x={id:uid(),flow:row.flow,mk:"it",row:row.id,c:link&&link.c||Date.now(),...(link?{from:link.from||link.id}:{}),pos:Math.max(-1,...mesIts(y,row.id).map(i=>i.pos||0))+1};y.items.push(x)}
        x.t=String(r.t).trim().slice(0,300);x.d=rtCut(String(r.d||"").trim(),4000);x.who=String(r.who||"").trim().slice(0,80);x.st=MES_ST[r.st]?r.st:"En cours";
        if(r.row&&rows.some(z=>z.id===r.row)&&r.row!==x.row){x.row=r.row;x.pos=Math.max(-1,...mesIts(y,r.row).map(i=>i.pos||0))+1}else mesRoute(y,x)})};
    const del=()=>visSet(y=>{y.items=y.items.filter(i=>i.id!==itId)});
    const defSt=it?it.st:row.key==="ok"?"Fait":row.key==="todo"?"À faire":"En cours";
    if(typeof window.__testDialog==="function"){Promise.resolve(window.__testDialog({type:"mesitem",message:row.title,options:rows.map(r=>r.title)})).then(r=>{if(!r||r.ok===false)return;const x=r.v||{};if(x.del){del();return}
      const tr=x.rowTitle&&rows.find(z=>z.title===x.rowTitle);save({t:x.t,d:x.d,who:x.who,st:x.st||defSt,row:tr?tr.id:(it?it.row:row.id)})});return}
    const ppl=mesPeople(v);
    const d=document.createElement("dialog");d.className="uidlg vissheet mesdlg";d.setAttribute("aria-label",it?"Modifier l'élément":"Ajouter un élément");
    d.innerHTML=`<form method="dialog"><h3>${it?"Modifier l'élément":esc(row.title)}</h3>
      <label class="uifld"><span>Sujet</span><input type="text" data-k="t" maxlength="300" placeholder="Ex. : Étiquettes supports"></label>
      <label class="uifld"><span>Description</span><textarea data-rt data-k="d" rows="3" placeholder="Ce qui a été fait, constaté ou reste à faire"></textarea></label>
      <div class="uifld"><span>Qui</span>${ppl.length?`<div class="meschips">${ppl.map(n=>`<button type="button" data-who="${esc(n)}">${esc(n)}</button>`).join("")}</div>`:""}<input type="text" data-k="who" maxlength="80" placeholder="Nom" aria-label="Qui"></div>
      <div class="uifld"><span>Statut</span><div class="meschips" role="radiogroup" aria-label="Statut">${Object.keys(MES_ST).map(k=>`<button type="button" role="radio" data-st="${esc(k)}" aria-checked="false">${esc(k)}</button>`).join("")}</div></div>
      ${rows.length>1?`<label class="uifld"><span>Rubrique</span><select data-k="row">${rows.map(r=>`<option value="${esc(r.id)}">${esc(r.title)}</option>`).join("")}</select></label>`:""}
      <p class="muted">Un élément passé à « Fait » se range tout seul dans « Process OK / Actions réalisées ». Les éléments « Fait » et « Annulée » ne sont pas repris le lendemain.</p>
      <div class="uibtns">${it?`<button type="button" class="btn danger" data-del>Supprimer</button><span class="sp"></span>`:""}<button type="button" class="btn ghost" data-x>Annuler</button><button type="button" class="btn primary" data-ok>Enregistrer</button></div></form>`;
    document.body.appendChild(d);
    const q=k=>d.querySelector(`[data-k="${k}"]`);let st=defSt;
    q("t").value=it?it.t:"";q("who").value=it?it.who||"":"";if(q("row"))q("row").value=it?it.row:row.id;
    setTimeout(()=>{q("d").value=it?it.d||"":""},0);
    const paintSt=()=>d.querySelectorAll("[data-st]").forEach(b=>b.setAttribute("aria-checked",b.dataset.st===st));paintSt();
    const paintWho=()=>d.querySelectorAll("[data-who]").forEach(b=>b.setAttribute("aria-pressed",norm(b.dataset.who)===norm(q("who").value)));paintWho();
    d.querySelectorAll("[data-st]").forEach(b=>b.onclick=()=>{st=b.dataset.st;paintSt()});
    d.querySelectorAll("[data-who]").forEach(b=>b.onclick=()=>{q("who").value=norm(b.dataset.who)===norm(q("who").value)?"":b.dataset.who;paintWho()});q("who").oninput=paintWho;
    const close=()=>{try{d.close()}catch(e){}d.remove()};
    d.addEventListener("cancel",e=>{e.preventDefault();close()});
    d.querySelector("[data-x]").onclick=close;
    const db=d.querySelector("[data-del]");if(db)db.onclick=async()=>{close();if(await uiConfirm(`Supprimer « ${it.t} » ?`,{ok:"Supprimer",danger:true}))del()};
    d.querySelector("[data-ok]").onclick=()=>{const t=q("t").value.trim();if(!t){q("t").focus();return}const r={t,d:q("d").value,who:q("who").value,st,row:q("row")?q("row").value:null};close();
      if(r.row===(it?it.row:row.id))r.row=null;save(r)};
    d.querySelector("form").onsubmit=e=>e.preventDefault();
    if(d.showModal)d.showModal();else d.setAttribute("open","");
    setTimeout(()=>q("t").focus(),30);
  }
  function mesItHtml(i){
    return `<div class="mesit" role="button" tabindex="0" data-it="${esc(i.id)}" aria-label="Modifier « ${esc(i.t)} »"><div class="mesith"><b>${esc(i.t)}</b><span class="tag ${MES_ST[i.st]||""}">${esc(i.st||"")}</span></div>${i.d?`<div class="rt mesitd">${rtHtml(i.d)}</div>`:""}${i.who?`<span class="meswho"><i aria-hidden="true">${esc(i.who.slice(0,1).toUpperCase())}</i>${esc(i.who)}</span>`:""}</div>`;
  }
  function visMesScreen(o,v,p){
    const ds=mesDays(v), d=visMesDay=mesPickDay(v), k=ds.indexOf(d)+1, wide=visWide(), today=iso(new Date());
    // journée du jour (ou passée) d'une mise en service démarrée : compte rendu ouvert d'office
    if(!mesFlow(v,d)&&d<=today&&v.status==="open")visQuiet(y=>{mesCreateDay(y,d)});
    const f=mesFlow(v,d);
    const dstat=x=>{const fx=mesFlow(v,x);if(!fx)return x>today?"À venir":"Pas encore commencée";const n=(v.items||[]).filter(i=>i.mk==="it"&&i.flow===fx.id).length;return `${fx.closed?"Clôturée":"En cours"} · ${plural(n,"élément")}`};
    const chips=`<div class="mesdays" role="tablist" aria-label="Journées de la mise en service">${ds.map((x,i)=>{const fx=mesFlow(v,x);return `<button type="button" role="tab" aria-selected="${x===d}" data-day="${x}" class="${fx&&fx.closed?"cl":""}"><b>J${i+1}<span class="mesdl"> · ${esc(dayLbl(x))}</span></b><span class="mesds">${esc(new Date(x+"T12:00").toLocaleDateString("fr-FR",{weekday:"short",day:"numeric"}))}</span><small>${esc(dstat(x))}</small></button>`}).join("")}<button type="button" class="mesadd" data-addday aria-label="Ajouter un jour">${VI.plus}<span>Ajouter un jour</span></button></div>`;
    let body, notes="";
    if(!f){
      body=`<section class="viscard mesnone"><h3>${esc(mesDayName(v,d))}</h3><p>${d>today?"Journée à venir.":"Pas encore de compte rendu pour cette journée."} Les rubriques et les points non terminés de la veille seront repris.</p><button type="button" class="btn primary" data-mkday>Commencer le compte rendu</button></section>`;
    }else{
      const ns=visNotes(v,f.id), rows=mesRows(v,f.id);
      body=`<div class="mesbar"><div><b>Jour ${k} · ${esc(dayLbl(d,true))}</b><span>${f.closed?"Journée clôturée":"Journée en cours"}</span></div><button type="button" class="btn" data-cr>${VI.doc}<span>Compte rendu</span></button><button type="button" class="btn${f.closed?"":" primary"}" data-close>${f.closed?"Rouvrir":"Clôturer la journée"}</button></div>
        ${rows.map(r=>{const its=r.kind==="list"?mesIts(v,r.id):[];return `<section class="mesrow mr-${esc(r.key||"x")}" data-r="${esc(r.id)}"><div class="mesrh"><h3>${esc(r.title)}</h3>${r.kind==="list"?`<span class="muted">${its.length}</span>`:""}<button type="button" class="vismore" data-rm aria-label="Actions sur la rubrique ${esc(r.title)}">${VI.more}</button></div>
          ${r.kind==="list"?`${its.map(mesItHtml).join("")}<button type="button" class="vislink mesaddit" data-addit>${VI.plus}Ajouter</button>`:`<textarea data-rt data-rtext rows="3" aria-label="${esc(r.title)}" placeholder="${r.key==="statut"?"Où en est l'installation ce jour-là…":r.key==="rc"||r.key==="rm"?"Comment la journée a été vécue…":"Saisir le texte…"}">${escRaw(r.text||"")}</textarea>`}</section>`}).join("")}
        <button type="button" class="vislink mesaddrow" data-addrow>${VI.plus}Ajouter une rubrique</button>`;
      notes=`<section class="viscard mesnotes"><div class="vissh"><h3>Notes, photos et vocaux du jour</h3><span class="muted">${ns.length}</span></div>${wide?"":ns.slice(-4).map(n=>visNoteHtml(n)).join("")}${wide?"":`<button type="button" class="btn" data-f="${esc(f.id)}">${ns.length>4?`Voir les ${ns.length} notes et ajouter`:"Ajouter une note, une photo ou un vocal"}</button>`}</section>`;
    }
    const acts=(wide?confChip(v):"")+`<button type="button" class="btn visendh" data-mesend>${v.status==="done"?"Reprendre":"Terminer"}</button>${visMoreBtn("data-vm","Actions sur le déplacement")}`;
    if(wide){
      const ns=f?visNotes(v,f.id):[];
      o.innerHTML=visHead("Quitter le déplacement",p.name,v.title,visSub(v,p),acts)+`<div class="visdesk mesdesk"><aside class="visdl"><div class="vishd"><h2>Journées</h2></div>${chips}</aside>
        <section class="visdc"><main class="vism mes">${body}</main></section>
        <aside class="visdr mesr">${f?`<div class="vissh"><h3>Notes, photos et vocaux du jour</h3><span class="muted">${ns.length}</span></div><div class="vism notes">${ns.length?ns.map(n=>visNoteHtml(n)).join(""):`<p class="visempty">Aucune note ce jour. Écrivez, prenez une photo ou enregistrez ci-dessous.</p>`}</div>${visComposer(null)}`:""}</aside></div>`;
    }else{
      o.innerHTML=visHead("Quitter le déplacement","Projet",`${VIS_TYPES.mes.l} · Jour ${k}`,visSub(v,p),acts,(confChip(v)?`<div class="confrow">${confChip(v)}</div>`:"")+chips)+`<main class="vism mes">${body}${notes}</main>${f?visQuickBar():""}`;
    }
    o.querySelector("[data-back]").onclick=visClose;
    o.querySelectorAll(".confchip[data-conf]").forEach(b=>b.onclick=()=>confInfo(visCur));
    if(v.prep&&v.prep.conf&&!conf.opened[v.id]){conf.opened[v.id]=1;if(!conf.timers[v.id])confSchedule(v,2500)}
    const sel=o.querySelector('.mesdays [aria-selected="true"]');if(sel&&!wide)sel.scrollIntoView({block:"nearest",inline:"center"});
    o.querySelectorAll("[data-day]").forEach(b=>b.onclick=()=>{visMesDay=b.dataset.day;renderVisit()});
    o.querySelector("[data-addday]").onclick=()=>{const nd=iso(addDays(new Date(visEndDay(v)+"T12:00"),1));visMesDay=nd;visSet(y=>{y.prep=y.prep||{};if(!y.prep.plannedAt&&!y.startedAt)y.prep.plannedAt=new Date(visStartDay(y)+"T09:00").getTime();y.prep.endDay=nd})};
    const me=o.querySelector("[data-mesend]");if(me)me.onclick=()=>{if(v.status==="done")visSet(x=>{x.status="open";x.endedAt=null});else visFinish(visCur)};
    const mk=o.querySelector("[data-mkday]");if(mk)mk.onclick=()=>visSet(y=>{mesCreateDay(y,d)});
    visBindCommon(o,v);
    if(!f)return;
    if(wide)visBindFlow(o,v,f);
    o.querySelector("[data-close]").onclick=()=>{const was=f.closed;visSet(y=>{const x=mesFlow(y,d);if(x)x.closed=!x.closed});toast(was?"Journée rouverte.":"Journée clôturée.");if(visCur.prep&&visCur.prep.conf)setTimeout(()=>confPush(visCur.id),50)};
    o.querySelector("[data-cr]").onclick=async()=>{const ch=await visSheet("Compte rendu du jour "+k,[{k:"copy",l:"Copier pour Confluence (compte rendu du jour)"},{k:"xl",l:"Copier pour Excel (points Go Live)"},{k:"pdf",l:"PDF de la journée"},{k:"all",l:"PDF de toute la mise en service"}]);
      if(ch==="xl"){const x=mesExcelCopy(visCur);if(!x.n){toast("Aucun point à copier.");return}const ok=await copyRich(x.html,x.text);toast(ok?`${plural(x.n,"point copié","points copiés")} : sélectionnez la première ligne du tableau Excel (colonne N°) puis Ctrl+V.`:"Copie impossible sur cet appareil.")}
      else if(ch==="copy"){const h=mesDayHtml(visCur,d,false);const ok=await copyRich(h.html,h.text);toast(ok?"Compte rendu copié : collez-le dans la page Confluence (Ctrl+V).":"Copie impossible sur cet appareil.")}
      else if(ch==="pdf")mesPdf(visCur,[d]);else if(ch==="all")mesPdf(visCur,null)};
    o.querySelectorAll("[data-addit]").forEach(b=>b.onclick=()=>mesItemDialog(b.closest("[data-r]").dataset.r,null));
    o.querySelectorAll("[data-it]").forEach(b=>{const go=()=>mesItemDialog(null,b.dataset.it);b.onclick=e=>{if(e.target.closest("a"))return;go()};b.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}}});
    o.querySelectorAll("[data-rtext]").forEach(ta=>{const id=ta.closest("[data-r]").dataset.r;let t=null;const put=()=>{clearTimeout(t);visQuiet(y=>{const r=y.items.find(i=>i.id===id);if(r)r.text=rtCut(ta.value.trim(),8000)})};ta.addEventListener("input",()=>{clearTimeout(t);t=setTimeout(put,700)});ta.addEventListener("change",put);ta.addEventListener("blur",put)});
    o.querySelectorAll("[data-rm]").forEach(b=>b.onclick=async()=>{
      const id=b.closest("[data-r]").dataset.r, r=visCur.items.find(i=>i.id===id);if(!r)return;
      const rows=mesRows(visCur,f.id), ix=rows.findIndex(x=>x.id===id);
      const ch=await visSheet(r.title,[{k:"ren",l:"Renommer la rubrique"},...(ix>0?[{k:"up",l:"Monter"}]:[]),...(ix<rows.length-1?[{k:"down",l:"Descendre"}]:[]),{k:"del",l:"Supprimer la rubrique",danger:true}]);
      if(ch==="ren"){const t=await uiPrompt("Nom de la rubrique",r.title,{ok:"Renommer"});if(t&&t.trim())visSet(y=>{const x=y.items.find(i=>i.id===id);if(x)x.title=t.trim().slice(0,120)})}
      else if(ch==="up"||ch==="down"){const o2=rows[ix+(ch==="up"?-1:1)];visSet(y=>{const ord=mesRows(y,f.id);const a=ord.findIndex(x=>x.id===id),b2=ord.findIndex(x=>x.id===o2.id);[ord[a],ord[b2]]=[ord[b2],ord[a]];ord.forEach((x,i)=>x.pos=i)})}
      else if(ch==="del"){const n=mesIts(visCur,id).length;if(!await uiConfirm(`Supprimer la rubrique « ${r.title} »${n?` et ses ${plural(n,"élément")}`:r.text?" et son texte":""} ?\n\nElle ne sera plus reprise les jours suivants.`,{ok:"Supprimer",danger:true}))return;visSet(y=>{y.items=y.items.filter(i=>i.id!==id&&i.row!==id)})}
    });
    o.querySelector("[data-addrow]").onclick=async()=>{
      const kind=await visSheet("Nouvelle rubrique",[{k:"list",l:"Liste d'éléments (sujet, qui, statut)"},{k:"text",l:"Texte libre"}]);if(!kind)return;
      const t=await uiPrompt("Nom de la rubrique","",{ok:"Ajouter"});if(!t||!t.trim())return;
      visSet(y=>{y.items.push({id:uid(),flow:f.id,mk:"row",key:null,title:t.trim().slice(0,120),kind,text:"",pos:Math.max(-1,...mesRows(y,f.id).map(i=>i.pos||0))+1})});
    };
  }
  // Points Go Live de toute la mise en service : un point par origine, dans l'ordre d'apparition, avec son dernier état
  function mesGoLive(v){
    const order=[], last=new Map();
    mesDays(v).forEach(d=>{const f=mesFlow(v,d);if(!f)return;mesRows(v,f.id).filter(r=>r.kind==="list").forEach(r=>mesIts(v,r.id).forEach(i=>{const k=i.from||i.id;if(!last.has(k))order.push(k);last.set(k,i)}))});
    const first=new Map();order.forEach((k,ix)=>first.set(k,ix));
    return order.slice().sort((a,b)=>{const ca=last.get(a).c, cb=last.get(b).c;return ca&&cb?ca-cb:first.get(a)-first.get(b)}).map(k=>last.get(k));
  }
  // copie pour le tableau Excel « Points ouverts Go Live » : N°, Sujet, Commentaire, État, Qui
  function mesExcelCopy(v){
    const pts=mesGoLive(v), cell=x=>String(x||"").replace(/[\t\r\n]+/g," ").trim();
    const rows=pts.map((i,k)=>[k+1,cell(i.t),cell(rtText(i.d||"")),cell(i.st),cell(i.who)]);
    return {n:rows.length,text:rows.map(r=>r.join("\t")).join("\r\n"),html:`<table>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(String(c))}</td>`).join("")}</tr>`).join("")}</table>`};
  }
  // copie riche (tableau) : se colle tel quel dans Confluence, Word ou Outlook
  async function copyRich(html,text){
    try{if(window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write){await navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([html],{type:"text/html"}),"text/plain":new Blob([text],{type:"text/plain"})})]);return true}}catch(e){}
    try{const box=document.createElement("div");box.contentEditable="true";box.style.cssText="position:fixed;left:-9999px;top:0;opacity:0";box.innerHTML=html;document.body.appendChild(box);
      const r=document.createRange();r.selectNodeContents(box);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);const ok=document.execCommand("copy");sel.removeAllRanges();box.remove();return ok}catch(e){return false}
  }
  function mesDayHtml(v,d){
    const f=mesFlow(v,d), k=mesDays(v).indexOf(d)+1, rows=f?mesRows(v,f.id):[];
    const th='style="border:1px solid #C1C7D0;padding:8px 10px;background:#F4F5F7;text-align:left;vertical-align:top;width:28%"', td='style="border:1px solid #C1C7D0;padding:8px 10px;vertical-align:top"';
    const li=i=>`<li><b>${esc(i.t)}</b>${i.d?" : "+esc(rtText(i.d)).replace(/\n/g,"<br>"):""}${i.who||i.st?` (${esc([i.who,i.st].filter(Boolean).join(" - "))})`:""}</li>`;
    const title=`${VIS_TYPES.mes.l} – Jour ${k} – ${cap(dayLbl(d,true))}`;
    const html=`<p><b>${esc(title)}</b></p><table style="border-collapse:collapse;width:100%"><thead><tr><th ${th}>Sujet</th><th ${th.replace("width:28%","")}>Description</th></tr></thead><tbody>${rows.map(r=>`<tr><th ${th}>${esc(r.title)}</th><td ${td}>${r.kind==="list"?(()=>{const its=mesIts(v,r.id);return its.length?`<ul>${its.map(li).join("")}</ul>`:""})():(r.text?rtHtml(r.text):"")}</td></tr>`).join("")}</tbody></table>`;
    const text=[title,""].concat(rows.map(r=>`${r.title}\n${r.kind==="list"?mesIts(v,r.id).map(i=>`- ${i.t}${i.d?" : "+rtText(i.d):""}${i.who||i.st?` (${[i.who,i.st].filter(Boolean).join(" - ")})`:""}`).join("\n"):rtText(r.text||"")}\n`)).join("\n");
    return {html,text,title};
  }
  async function mesPdf(v,only){
    const p=proj(v.projectId)||{name:""}, days=(only||mesDays(v)).filter(d=>mesFlow(v,d));
    if(!days.length){toast("Aucune journée commencée.");return}
    const urls={};await Promise.all(v.notes.filter(n=>days.some(d=>(mesFlow(v,d)||{}).id===n.flow)).flatMap(n=>(n.photos||[]).map(async ph=>{urls[ph.id]=await visPhotoUrl(v,ph.id)})));
    const sec=days.map(d=>{const h=mesDayHtml(v,d), ns=visNotes(v,mesFlow(v,d).id);
      return `<section class="day"><h2>${esc(mesDayName(v,d))}</h2>${h.html.replace(/^<p><b>.*?<\/b><\/p>/,"")}${ns.length?`<h3>Notes, photos et vocaux du jour</h3>${ns.map(n=>`<div class="n"><div class="h">${hm(n.at)}${n.audio?` · enregistrement de ${mmss(n.audio.dur||0)}`:""}</div>${n.text?`<div>${rtHtml(n.text)}</div>`:""}${n.tr?`<p class="tr">${esc(n.tr.text).replace(/\n/g,"<br>")}</p>`:""}${(n.photos||[]).length?`<div class="ph">${n.photos.map(ph=>urls[ph.id]?`<figure><img src="${urls[ph.id]}" alt=""><figcaption>${esc(ph.caption||"")}</figcaption></figure>`:"").join("")}</div>`:""}</div>`).join("")}`:""}</section>`}).join("");
    const css=`body{font-family:Arial,sans-serif;color:#16232B;margin:0;font-size:10.5pt}h1{font-size:18pt;margin:0}.sub{color:#51646F;margin:4px 0 14px}h2{font-size:13pt;color:#1D4E78;border-bottom:1px solid #C7D1D8;padding-bottom:3px;margin:16px 0 8px}h3{font-size:11pt;margin:12px 0 6px}ul{margin:0;padding-left:18px}li{margin:2px 0}table{break-inside:auto}tr{break-inside:avoid}p{margin:3px 0}.n{margin:0 0 8px;break-inside:avoid}.h{font-size:9pt;color:#51646F}.tr{font-style:italic;color:#3A4B55}.ph{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}figure{margin:0;width:48%}figure img{width:100%;border-radius:4px}figcaption{font-size:9pt;color:#51646F}.day+.day{break-before:page}.vh{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.vh img{max-height:52px;max-width:160px;object-fit:contain}@page{margin:14mm}`;
    const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(v.title)}</title><style>${css}</style></head><body><div class="vh"><h1>${esc(v.title)}</h1>${pLogo(p)?`<img src="${p.logo}" alt="">`:""}</div><p class="sub">${esc(p.name)} · ${esc(only&&only.length===1?mesDayName(v,only[0]):visRangeTxt(v,true))}</p>${sec}</body></html>`;
    printHtml(html,`mise-en-service-${(p.name||"projet").replace(/[^\wÀ-ÿ-]+/g,"-")}-${only&&only.length===1?only[0]:iso(new Date(visDate(v)))}`);
  }
  // ---------- Confluence : compte rendu de mise en service écrit en direct dans une page partagée ----------
  // Connexion par jeton API (chiffré par le relais serveur « confluence »), page liée au déplacement (lien signé),
  // envoi 10 s après chaque modification et à la clôture de la journée : un bloc par journée, le plus récent en haut.
  const conf={me:undefined,st:{},timers:{},opened:{}};
  const CONF_SVG=`<svg class="confic" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#1868DB"></rect><path d="M5.5 15.5c4-5.2 8-5.2 13 0M5.5 8.5c5 5.2 9 5.2 13 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"></path></svg>`;
  const confDelay=()=>window.__confDelay||10000;
  async function confCall(body){
    const {data,error}=await cloudClient().functions.invoke("confluence",{method:"POST",body});
    if(error){const j=await fnError(error);const e=new Error(j.message||"Confluence indisponible pour le moment.");e.code=j.code||"";throw e}
    return data||{};
  }
  async function confLoadMe(){
    if(MODE!=="cloud"||!cloud.user){conf.me=null;return null}
    try{const {data}=await cloudClient().from("user_confluence").select("site,email,expires_on,updated_at").eq("user_id",cloud.user.id);conf.me=data&&data[0]||null}catch(e){conf.me=null}
    return conf.me;
  }
  const confDaysLeft=me=>me&&me.expires_on?Math.round((new Date(me.expires_on+"T12:00")-new Date(iso(new Date())+"T12:00"))/864e5):null;
  async function confRemind(){
    await confLoadMe();const n=confDaysLeft(conf.me);if(n===null||n>15)return;
    const k="tdp-conf-remind:"+iso(new Date());try{if(localStorage.getItem(k))return;localStorage.setItem(k,"1")}catch(e){}
    toast(n<0?"Votre jeton Confluence a expiré : renouvelez-le pour reprendre les envois.":`Votre jeton Confluence expire ${n===0?"aujourd'hui":n===1?"demain":`dans ${n} jours`} : pensez à le renouveler.`,()=>openConfCfg(),"Renouveler");
  }
  async function openConfCfg(){
    if(MODE!=="cloud"||!cloud.user){uiAlert("La connexion à Confluence nécessite le mode en ligne (compte).");return}
    await confLoadMe();
    const me=conf.me, exp=me&&me.expires_on||iso(addDays(new Date(),365)), fd=s=>new Date(s+"T12:00").toLocaleDateString("fr-FR");
    const d=document.createElement("dialog");d.className="uidlg confdlg";d.setAttribute("aria-label","Connecter Confluence");
    d.innerHTML=`<form method="dialog" autocomplete="off"><div class="confg"><div class="confl">
      <h3>${CONF_SVG}Connecter Confluence</h3>
      <p class="muted">Les comptes rendus de mise en service s'écrivent en direct dans la page Confluence que vous liez au déplacement.</p>
      ${me?`<p class="confok">Connecté à ${esc(me.site)} (${esc(me.email)})${me.expires_on?` · jeton valable jusqu'au ${fd(me.expires_on)}`:""}</p>`:""}
      <label class="uifld"><span>Site Atlassian</span><input type="text" data-k="site" spellcheck="false" value="${esc(me?me.site:"easywmsfrance.atlassian.net")}"></label>
      <label class="uifld"><span>E-mail du compte Atlassian</span><input type="email" data-k="email" value="${esc(me?me.email:(cloud.email||""))}"></label>
      <label class="uifld"><span>Jeton API${me?` <small class="muted">laisser vide pour garder le jeton actuel</small>`:""}</span><input type="password" data-k="token" autocomplete="new-password" placeholder="${me?"••••••••••••••••":"Collez ici le jeton créé chez Atlassian"}"></label>
      <label class="uifld"><span>Date d'expiration du jeton</span><input type="date" data-k="exp" value="${esc(exp)}"></label>
      <p class="conferr" data-err role="alert"></p>
      <p class="muted confsec">Le jeton est chiffré sur le serveur de l'appli : il n'est jamais réaffiché ni partagé avec vos collègues. Un rappel s'affiche 15 jours avant son expiration.</p>
      <div class="uibtns">${me?`<button type="button" class="btn danger" data-rm>Déconnecter</button><span class="sp"></span>`:""}<button type="button" class="btn ghost" data-x>Annuler</button>${me?`<button type="button" class="btn" data-test>Tester</button>`:""}<button type="button" class="btn primary" data-ok>Enregistrer</button></div>
    </div><div class="confr"><b>Comment créer le jeton ?</b><ol>
      <li><b>Ouvrez la page Jetons API d'Atlassian</b><span>Compte Atlassian, rubrique Sécurité, puis « Créer un jeton API avec des portées ».</span></li>
      <li><b>Nommez-le et fixez sa durée</b><span>Par exemple « To do projets ». Durée maximale : 365 jours. Reportez la date d'expiration ici.</span></li>
      <li><b>Choisissez Confluence et les portées</b><span>Cochez read:page:confluence et write:page:confluence : le jeton ne peut que lire et modifier des pages.</span></li>
      <li><b>Copiez le jeton ici</b><span>Il ne s'affiche qu'une fois chez Atlassian. Collez-le dans « Jeton API », puis Enregistrer : la connexion est testée.</span></li></ol>
      <a class="btn" href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">Ouvrir la page Jetons API</a></div></div></form>`;
    document.body.appendChild(d);
    const q=k=>d.querySelector(`[data-k="${k}"]`), err=d.querySelector("[data-err]");
    const close=()=>{try{d.close()}catch(e){}d.remove()};
    const msg=(t,ok)=>{err.textContent=t;err.classList.toggle("ok",!!ok)};
    const busy=b=>d.querySelectorAll("button").forEach(x=>x.disabled=b);
    d.addEventListener("cancel",e=>{e.preventDefault();close()});d.querySelector("[data-x]").onclick=close;
    d.querySelector("form").onsubmit=e=>e.preventDefault();
    d.querySelector("[data-ok]").onclick=async()=>{
      const site=q("site").value.trim(), email=q("email").value.trim(), token=q("token").value.trim(), ex=q("exp").value||null;
      if(!site||!email){msg("Indiquez le site et l'e-mail du compte Atlassian.");return}
      busy(true);msg("Vérification de la connexion…",true);
      try{
        if(!token){
          if(!me){busy(false);msg("Collez le jeton API créé chez Atlassian.");q("token").focus();return}
          if(site.toLowerCase().replace(/^https?:\/\//,"").replace(/\/.*$/,"")!==me.site||email!==me.email){busy(false);msg("Pour changer de site ou d'e-mail, collez aussi le jeton.");q("token").focus();return}
          const {error}=await cloudClient().from("user_confluence").update({expires_on:ex,updated_at:Date.now()}).eq("user_id",cloud.user.id);if(error)throw error;
        }else await confCall({action:"save",site,email,token,expiresOn:ex});
        await confLoadMe();close();toast("Confluence connecté : vous pouvez lier une page à une mise en service.");
        Object.keys(conf.st).forEach(id=>{if(conf.st[id].code==="auth"||conf.st[id].code==="no_cred")confPush(id)});
      }catch(e){busy(false);msg(e.message||"Connexion impossible.")}
    };
    const t=d.querySelector("[data-test]");if(t)t.onclick=async()=>{busy(true);msg("Test en cours…",true);try{await confCall({action:"test"});msg("Connexion réussie : écriture des pages autorisée.",true)}catch(e){msg(e.message)}busy(false)};
    const rm=d.querySelector("[data-rm]");if(rm)rm.onclick=async()=>{
      close();if(!await uiConfirm("Déconnecter Confluence ? Le jeton est effacé du serveur. Les pages déjà liées ne recevront plus les comptes rendus (les blocs déjà écrits restent dans Confluence).",{ok:"Déconnecter",danger:true}))return;
      await cloudClient().from("user_confluence").delete().eq("user_id",cloud.user.id);conf.me=null;toast("Confluence déconnecté.")};
    if(d.showModal)d.showModal();else d.setAttribute("open","");
    setTimeout(()=>(me?q("token"):q("token")).focus(),30);
  }
  // ---- envoi ----
  const confHash=s=>{let h=5381;for(let i=0;i<s.length;i++)h=(Math.imul(h,33)^s.charCodeAt(i))>>>0;return h.toString(36)};
  const confSent=vid=>{try{return JSON.parse(localStorage.getItem("tdp-conf:"+vid)||"{}")}catch(e){return {}}};
  const confSaveSent=(vid,o)=>{try{localStorage.setItem("tdp-conf:"+vid,JSON.stringify(o))}catch(e){}};
  function confDays(v){
    const p=proj(v.projectId)||{name:""}, c=v.prep.conf, ds=mesDays(v);
    return ds.filter(d=>mesFlow(v,d)&&(!c.from||d>=c.from)).map(d=>{const f=mesFlow(v,d), k=ds.indexOf(d)+1;
      const rows=mesRows(v,f.id).map(r=>r.kind==="list"?{title:r.title,kind:"list",items:mesIts(v,r.id).map(i=>({t:i.t||"",d:rtText(i.d||""),who:i.who||"",st:i.st||""}))}:{title:r.title,kind:"text",text:rtText(r.text||"")});
      return {key:d,title:`J${k} · ${dayLbl(d,true)} · ${p.name}`,closed:!!f.closed,rows}});
  }
  function confLabel(vid){const s=conf.st[vid]||{};
    return s.st==="sending"?"Confluence · envoi…":s.st==="pending"?"Confluence · envoi dans un instant":s.st==="offline"?"Confluence · hors ligne, envoi au retour du réseau":s.st==="err"?"Confluence · "+(s.code==="auth"?"jeton refusé ou expiré":s.code==="no_cred"?"connexion absente":"envoi en échec"):s.at?"Confluence · à jour "+hm(s.at):"Confluence · page liée"}
  function confPaint(vid){document.querySelectorAll(".confchip[data-conf]").forEach(b=>{if(b.dataset.conf!==vid)return;const s=conf.st[vid]||{};b.className="confchip "+(s.st||"idle");b.querySelector("span").textContent=confLabel(vid);b.title=s.st==="err"&&s.msg?s.msg:"Page Confluence liée : cliquez pour le détail"})}
  const confChip=v=>v&&v.prep&&v.prep.conf?`<button type="button" class="confchip ${(conf.st[v.id]||{}).st||"idle"}" data-conf="${esc(v.id)}"><i aria-hidden="true"></i><span>${esc(confLabel(v.id))}</span></button>`:"";
  function confSchedule(v,delay){
    if(MODE!=="cloud"||!v||!isMes(v)||!v.prep||!v.prep.conf||v.deletedAt||v.status==="prep")return;
    clearTimeout(conf.timers[v.id]);
    const s=conf.st[v.id]||(conf.st[v.id]={});if(s.st!=="sending")s.st=navigator.onLine===false?"offline":"pending";confPaint(v.id);
    conf.timers[v.id]=setTimeout(()=>confPush(v.id),delay==null?confDelay():delay);
  }
  async function confPush(vid,force){
    clearTimeout(conf.timers[vid]);conf.timers[vid]=null;
    const rec=vis.map[vid], v=rec&&rec.v;if(!v||!v.prep||!v.prep.conf||MODE!=="cloud")return;
    const s=conf.st[vid]||(conf.st[vid]={});
    if(s.st==="sending"){s.again=true;return}
    if(navigator.onLine===false){s.st="offline";confPaint(vid);return}
    const c=v.prep.conf, key=c.pageId+"|"+c.sig, sent=confSent(vid);
    const all=confDays(v), hashOf=d=>confHash(JSON.stringify(d)), fresh=sent._k!==key;
    const todo=all.filter(d=>force||fresh||sent[d.key]!==hashOf(d));
    if(!todo.length){s.st="ok";s.at=s.at||Date.now();s.msg="";s.code="";confPaint(vid);return}
    const now=new Date(), me=cloud.email?nameOf(cloud.email):"";
    const stamp=d=>`To do projets · mis à jour le ${now.toLocaleDateString("fr-FR")} à ${hm(now)}${me?" par "+me:""}${d.closed?" · journée clôturée":""}`;
    s.st="sending";s.again=false;confPaint(vid);
    try{
      await confCall({action:"push",visitId:vid,pageId:c.pageId,by:c.by,sig:c.sig,days:todo.map(d=>({...d,stamp:stamp(d)}))});
      const s2=fresh?{}:confSent(vid);s2._k=key;todo.forEach(d=>{s2[d.key]=hashOf(d);s2["at:"+d.key]=Date.now()});confSaveSent(vid,s2);
      s.st="ok";s.at=Date.now();s.msg="";s.code="";
    }catch(e){
      s.st=navigator.onLine===false?"offline":"err";s.msg=e.message;s.code=e.code||"";
      if(!e.code||["rate","conflict","timeout","upstream","error"].includes(e.code)){clearTimeout(conf.timers[vid]);conf.timers[vid]=setTimeout(()=>confPush(vid),60000)}
    }
    confPaint(vid);
    if(s.again){const r2=vis.map[vid];if(r2)confSchedule(r2.v,1500)}
  }
  window.addEventListener("online",()=>Object.keys(conf.st).forEach(id=>{if(["offline","pending","err"].includes(conf.st[id].st))confPush(id)}));
  async function confLinkDlg(v){
    if(MODE!=="cloud"||!cloud.user){uiAlert("La liaison à Confluence nécessite le mode en ligne (compte).");return}
    await confLoadMe();
    if(!conf.me){if(await uiConfirm("Pour lier une page, connectez d'abord Confluence à votre compte avec un jeton API (une seule fois).",{ok:"Connecter Confluence"}))openConfCfg();return}
    const today=iso(new Date()), past=mesDays(v).filter(x=>mesFlow(v,x)&&x<today);
    const d=document.createElement("dialog");d.className="uidlg vissheet conflink";d.setAttribute("aria-label","Lier une page Confluence");
    d.innerHTML=`<form method="dialog" autocomplete="off"><h3>${CONF_SVG}Lier une page Confluence</h3>
      <p class="muted">Collez le lien de la page partagée des comptes rendus. L'appli y ajoute un bloc par journée, le plus récent en haut, et ne touche pas au reste de la page.</p>
      <label class="uifld"><span>Lien de la page</span><input type="url" data-k="url" placeholder="https://${esc(conf.me.site)}/wiki/spaces/…/pages/…"></label>
      ${past.length?`<label class="confcb"><input type="checkbox" data-k="past" checked> Envoyer aussi ${past.length>1?`les ${past.length} journées déjà saisies`:"la journée déjà saisie"}</label>`:""}
      <p class="conferr" data-err role="alert"></p>
      <div class="uibtns"><button type="button" class="btn ghost" data-x>Annuler</button><button type="button" class="btn primary" data-ok>Lier la page</button></div></form>`;
    document.body.appendChild(d);
    const q=k=>d.querySelector(`[data-k="${k}"]`), err=d.querySelector("[data-err]"), close=()=>{try{d.close()}catch(e){}d.remove()};
    d.addEventListener("cancel",e=>{e.preventDefault();close()});d.querySelector("[data-x]").onclick=close;d.querySelector("form").onsubmit=e=>{e.preventDefault();d.querySelector("[data-ok]").click()};
    d.querySelector("[data-ok]").onclick=async()=>{
      const url=q("url").value.trim();if(!url){q("url").focus();return}
      d.querySelectorAll("button").forEach(b=>b.disabled=true);err.textContent="Recherche de la page…";err.classList.add("ok");
      try{
        await visFlush();
        const r=await confCall({action:"link",visitId:v.id,url});
        const from=past.length&&q("past")&&!q("past").checked?today:null;
        confSaveSent(v.id,{});conf.st[v.id]={};
        visSet(y=>{y.prep=y.prep||{};y.prep.conf={pageId:r.pageId,title:r.title||"",url:r.url||url,site:r.site,by:r.by,byName:nameOf(cloud.email),sig:r.sig,at:Date.now(),...(from?{from}:{})}});
        close();toast(`Page « ${r.title||"Confluence"} » liée : le compte rendu s'y écrit en direct.`);
        setTimeout(()=>confPush(v.id),300);
      }catch(e){d.querySelectorAll("button").forEach(b=>b.disabled=false);err.classList.remove("ok");err.textContent=e.message||"Liaison impossible."}
    };
    if(d.showModal)d.showModal();else d.setAttribute("open","");
    setTimeout(()=>q("url").focus(),30);
  }
  function confInfo(v){
    const c=v.prep.conf, s=conf.st[v.id]||{}, sent=confSent(v.id), ds=mesDays(v), mine=cloud.user&&c.by===cloud.user.id;
    const when=at=>iso(new Date(at))===iso(new Date())?"à "+hm(at):"le "+new Date(at).toLocaleDateString("fr-FR")+" à "+hm(at);
    const d=document.createElement("dialog");d.className="uidlg vissheet confinfo";d.setAttribute("aria-label","Page Confluence liée");
    d.innerHTML=`<form method="dialog"><h3>${CONF_SVG}Page Confluence liée</h3>
      <a class="confpage" href="${esc(c.url||"#")}" target="_blank" rel="noopener"><b>${esc(c.title||"Page Confluence")}</b><span>${esc(c.site||"")} · ouvrir dans Confluence</span></a>
      <p class="confstate ${esc(s.st||"idle")}"><i aria-hidden="true"></i><span>${esc(confLabel(v.id))}${s.st==="err"&&s.msg?`<small>${esc(s.msg)}</small>`:""}</span></p>
      <ul class="confdays">${ds.filter(x=>mesFlow(v,x)).map(x=>{const at=sent["at:"+x], k=ds.indexOf(x)+1;return `<li class="${at?"ok":""}">J${k} · ${esc(dayLbl(x))} · ${c.from&&x<c.from?"non envoyée (antérieure au lien)":at?"envoyée "+when(at):"pas encore envoyée depuis cet appareil"}</li>`}).join("")||"<li>Aucune journée commencée.</li>"}</ul>
      <p class="muted">Envoi 10 secondes après chaque modification et à la clôture de la journée. Seuls les blocs « To do projets » de la page sont modifiés.${mine?"":` Les envois utilisent la connexion Confluence de ${esc(c.byName||"la personne qui a lié la page")}.`}</p>
      <div class="uibtns"><button type="button" class="btn danger" data-unlink>Délier la page</button><span class="sp"></span><button type="button" class="btn ghost" data-x>Fermer</button>${s.code==="auth"&&mine?`<button type="button" class="btn" data-cfg>Renouveler le jeton</button>`:""}<button type="button" class="btn primary" data-now>Envoyer maintenant</button></div></form>`;
    document.body.appendChild(d);
    const close=()=>{try{d.close()}catch(e){}d.remove()};
    d.addEventListener("cancel",e=>{e.preventDefault();close()});d.querySelector("[data-x]").onclick=close;d.querySelector("form").onsubmit=e=>e.preventDefault();
    d.querySelector("[data-now]").onclick=()=>{close();confPush(v.id,true)};
    const cf=d.querySelector("[data-cfg]");if(cf)cf.onclick=()=>{close();openConfCfg()};
    d.querySelector("[data-unlink]").onclick=async()=>{close();if(!await uiConfirm("Délier la page Confluence ? Les envois s'arrêtent ; les blocs déjà écrits restent dans la page.",{ok:"Délier",danger:true}))return;
      clearTimeout(conf.timers[v.id]);delete conf.st[v.id];confSaveSent(v.id,{});visSet(y=>{if(y.prep)delete y.prep.conf});toast("Page Confluence déliée.")};
    if(d.showModal)d.showModal();else d.setAttribute("open","");
  }
  // ---------- Onglet Visites d'un projet ----------
  function visEnsure(){if(vis.loaded&&vis.acct!==visAcct()){vis.loaded=false;vis.map={};vis.urls={}}if(!vis.loaded)visLoad()}

  // ---------- Enregistrements audio (téléphone ou ordinateur) ----------
  // L'enregistrement devient une note du flux ; il reste sur l'appareil jusqu'à son envoi (stockage privé « visit-audio »).
  // La transcription se fait ensuite sur l'ordinateur (voir « Transcription »), sans envoi du son à un service extérieur.
  const MIC_SVG=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg>`;
  const REC_MAX_S=60*60; // une heure au plus par enregistrement
  let visRec=null;
  const recOk=()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder);
  const mmss=s=>{s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+":"+String(m).padStart(2,"0"):String(m).padStart(2,"0"))+":"+String(x).padStart(2,"0")};
  function recMime(){
    for(const [m,ext] of [["audio/webm;codecs=opus","webm"],["audio/webm","webm"],["audio/mp4","m4a"],["audio/ogg;codecs=opus","ogg"]])
      try{if(MediaRecorder.isTypeSupported(m))return {mime:m,ext}}catch(e){}
    return {mime:"",ext:"webm"};
  }
  // rappel : prévenir les personnes présentes (une fois par visite, si la case est cochée)
  function recConsent(v){
    ui.recOk=ui.recOk&&typeof ui.recOk==="object"?ui.recOk:{};
    if(ui.recOk[v.id])return Promise.resolve(true);
    return new Promise(res=>{
      const d=document.createElement("dialog");d.className="uidlg recdlg";d.setAttribute("aria-label","Avant d'enregistrer");
      d.innerHTML=`<form method="dialog"><div class="recdh"><span class="recic">${MIC_SVG}</span><h3>Enregistrer la conversation</h3></div>
        <p class="uimsg">Prévenez les personnes présentes que la conversation est enregistrée.</p>
        <ul class="recul"><li>L'enregistrement est rangé dans le flux en cours et reste sur l'appareil tant qu'il n'y a pas de réseau.</li><li>La transcription se fait ensuite sur votre ordinateur : le son n'est envoyé à aucun service extérieur.</li><li>Vous pouvez prendre des photos pendant l'enregistrement.</li></ul>
        <label class="recchk"><input type="checkbox" data-once checked><span>Ne plus demander pour ce déplacement</span></label>
        <div class="uibtns"><button type="button" class="btn ghost" data-x>Annuler</button><button type="button" class="btn recgo" data-ok><span class="recdot" aria-hidden="true"></span>C'est fait, enregistrer</button></div></form>`;
      document.body.appendChild(d);
      const close=v2=>{try{d.close()}catch(e){}d.remove();res(v2)};
      d.addEventListener("cancel",e=>{e.preventDefault();close(false)});
      d.querySelector("[data-x]").onclick=()=>close(false);
      d.querySelector("[data-ok]").onclick=()=>{if(d.querySelector("[data-once]").checked){ui.recOk[v.id]=1;saveUi()}close(true)};
      if(d.showModal)d.showModal();else d.setAttribute("open","");
    });
  }
  async function recStart(flowId){
    if(visRec)return;
    if(!recOk()){uiAlert("Ce navigateur ne permet pas d'enregistrer le son.");return}
    const v=visCur;if(!v)return;
    if(!await recConsent(v))return;
    let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false})}
    catch(e){uiAlert("Micro inaccessible : autorisez l'accès au micro pour cette appli (cadenas à gauche de l'adresse, ou réglages du navigateur).");return}
    const {mime,ext}=recMime();
    let mr;try{mr=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:32000})}catch(e){mr=new MediaRecorder(stream)}
    const r=visRec={vid:v.id,flow:flowId,mr,stream,chunks:[],mime:mr.mimeType||mime||"audio/webm",ext:/mp4|m4a|aac/.test(mr.mimeType||mime)?"m4a":/ogg/.test(mr.mimeType||mime)?"ogg":ext,
      at:Date.now(),acc:0,since:Date.now(),paused:false,photos:[],levels:[],wake:null,timer:null,ctx:null,an:null};
    mr.ondataavailable=e=>{if(e.data&&e.data.size)r.chunks.push(e.data)};
    mr.onstop=()=>recSave(r);
    mr.start(1000);
    visPersist();
    // niveau sonore (barres) et écran maintenu allumé
    try{const AC=window.AudioContext||window.webkitAudioContext;r.ctx=new AC();const src=r.ctx.createMediaStreamSource(stream);r.an=r.ctx.createAnalyser();r.an.fftSize=512;src.connect(r.an)}catch(e){}
    recWake(r);
    r.timer=setInterval(()=>recTick(r),200);
    renderVisit();
  }
  async function recWake(r){try{if(navigator.wakeLock&&!r.wake&&!document.hidden)r.wake=await navigator.wakeLock.request("screen");if(r.wake)r.wake.addEventListener("release",()=>{r.wake=null})}catch(e){}}
  document.addEventListener("visibilitychange",()=>{if(visRec&&!document.hidden)recWake(visRec)});
  const recElapsed=r=>(r.acc+(r.paused?0:Date.now()-r.since))/1000;
  function recTick(r){
    if(r.an&&!r.paused){const a=new Uint8Array(r.an.fftSize);r.an.getByteTimeDomainData(a);let sum=0;for(const x of a){const y=(x-128)/128;sum+=y*y}r.levels.push(Math.min(1,Math.sqrt(sum/a.length)*4))}
    else r.levels.push(0);
    if(r.levels.length>40)r.levels.shift();
    const el=recElapsed(r);
    document.querySelectorAll("[data-rectime]").forEach(x=>x.textContent=mmss(el));
    const bars=document.querySelector(".recbars");if(bars)bars.innerHTML=r.levels.map(l=>`<i style="height:${Math.max(3,Math.round(l*40))}px"></i>`).join("");
    if(el>=REC_MAX_S)recStop();
  }
  function recPause(){const r=visRec;if(!r)return;try{if(r.paused){r.mr.resume();r.since=Date.now();r.paused=false}else{r.mr.pause();r.acc+=Date.now()-r.since;r.paused=true}}catch(e){}renderVisit()}
  function recStop(){
    const r=visRec;if(!r||r.stopping)return;r.stopping=true;
    if(!r.paused)r.acc+=Date.now()-r.since;r.paused=true;
    clearInterval(r.timer);
    try{r.mr.state!=="inactive"?r.mr.stop():recSave(r)}catch(e){recSave(r)}
  }
  async function recSave(r){
    if(r.saved)return;r.saved=true;
    try{r.stream.getTracks().forEach(t=>t.stop())}catch(e){}
    try{r.ctx&&r.ctx.close()}catch(e){}
    try{r.wake&&r.wake.release()}catch(e){}
    visRec=null;
    const dur=Math.round(r.acc/1000);
    const blob=new Blob(r.chunks,{type:r.mime.split(";")[0]||"audio/webm"});
    if(!blob.size||dur<1){if(r.photos.length&&visCur&&visCur.id===r.vid)visStage=visStage.concat(r.photos);toast("Enregistrement vide : rien n'a été gardé.");renderVisit();return}
    const id=uid()+uid(), mime=blob.type||"audio/webm";
    await idbPut("photos",{id,kind:"audio",ext:r.ext,mime,acct:visAcct(),pid:(vis.map[r.vid]?vis.map[r.vid].v.projectId:visCur&&visCur.projectId),vid:r.vid,blob,up:false,del:false,at:Date.now()});
    const note={id:uid(),flow:r.flow,type:"note",text:"",photos:r.photos,audio:{id,dur,mime,ext:r.ext,size:blob.size},at:r.at,conv:null};
    if(visCur&&visCur.id===r.vid)visSet(x=>{x.notes.push(note)});
    else if(vis.map[r.vid]){const x=JSON.parse(JSON.stringify(vis.map[r.vid].v));x.notes.push(note);visPut(x)}
    visCount().then(visStatus);
    toast(`Enregistrement de ${mmss(dur)} ajouté au flux « ${((visCur||{}).flows||[]).find(f=>f.id===r.flow)?.name||""} ».`);
  }
  // barre d'enregistrement : remplace la saisie en bas de l'écran pendant l'enregistrement
  function recPanel(o){
    const r=visRec;if(!r||!visCur||r.vid!==visCur.id)return;
    o.classList.add("recording");
    const fl=(visCur.flows.find(f=>f.id===r.flow)||{}).name||"";
    const el=document.createElement("footer");el.className="visrec";el.setAttribute("aria-label","Enregistrement en cours");
    el.innerHTML=`<div class="rectop"><div class="recclk"><span class="reclbl">${r.paused?"En pause":"Enregistrement"} · ${esc(fl)}</span><b data-rectime>${mmss(recElapsed(r))}</b></div><div class="recbars" aria-hidden="true"></div></div>
      <p class="recinfo">${r.photos.length?`${plural(r.photos.length,"photo")} prise${r.photos.length>1?"s":""} pendant l'enregistrement · `:""}Écran maintenu allumé · enregistré sur l'appareil</p>
      <div class="recbtns"><button type="button" class="viscam" data-recph aria-label="Prendre une photo pendant l'enregistrement">${CAM_SVG}</button><button type="button" class="btn" data-recpause>${r.paused?"Reprendre":"Pause"}</button><button type="button" class="btn recstop" data-recstop><span class="recsq" aria-hidden="true"></span>Arrêter</button></div>`;
    (o.querySelector(".visdc")||o).appendChild(el);
    el.querySelector("[data-recstop]").onclick=recStop;
    el.querySelector("[data-recpause]").onclick=recPause;
    el.querySelector("[data-recph]").onclick=()=>visCapture(ph=>{if(ph.length&&visRec===r){r.photos=r.photos.concat(ph);renderVisit()}});
    const pill=o.querySelector(".vish .visrow");if(pill&&!pill.querySelector(".recpill"))pill.insertAdjacentHTML("beforeend",`<span class="recpill"><span class="recdot" aria-hidden="true"></span>REC <span data-rectime>${mmss(recElapsed(r))}</span></span>`);
    recTick(r);
  }
  // lecteur d'un enregistrement : lecteur de l'appli (le fichier est chargé au premier appui sur Lecture,
  // depuis l'appareil ou le stockage en ligne) ; la lecture continue si l'écran est redessiné
  const visPlayers={};
  const PLAY_SVG=`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>`;
  const PAUSE_SVG=`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>`;
  function auPaint(id){
    const p=visPlayers[id];
    document.querySelectorAll(`.visau[data-au="${id}"]`).forEach(el=>{
      const au=p&&p.a, dur=au&&isFinite(au.duration)&&au.duration>0?au.duration:+el.dataset.dur||0, t=au?au.currentTime:0, on=!!(au&&!au.paused);
      const b=el.querySelector(".aup");b.innerHTML=p&&p.busy?`<span class="auspin" aria-hidden="true"></span>`:on?PAUSE_SVG:PLAY_SVG;b.setAttribute("aria-label",on?"Mettre en pause":"Écouter l'enregistrement");
      el.querySelector(".aubar i").style.width=(dur?Math.min(100,100*t/dur):0)+"%";
      el.querySelector(".aut").textContent=(t>0.05||on?mmss(t)+" / ":"")+mmss(dur);
    });
  }
  function auStopAll(except){Object.entries(visPlayers).forEach(([k,p])=>{if(k!==except&&p.a&&!p.a.paused){p.a.pause();auPaint(k)}})}
  async function auToggle(v,a){
    let p=visPlayers[a.id];
    if(p&&p.busy)return;
    if(!p||!p.a){
      p=visPlayers[a.id]={busy:true,a:null,dur:a.dur||0};auPaint(a.id);
      const u=await visAudioUrl(v,a);
      if(!u){delete visPlayers[a.id];auPaint(a.id);toast(navigator.onLine===false?"Enregistrement pas encore sur cet appareil : il sera lisible avec du réseau.":"Enregistrement introuvable : il n'a peut-être pas encore été envoyé depuis l'autre appareil.");return}
      const au=new Audio();au.preload="auto";au.src=u;p.a=au;p.busy=false;
      au.ontimeupdate=au.onpause=au.onplay=au.onloadedmetadata=()=>auPaint(a.id);
      au.onended=()=>{au.currentTime=0;auPaint(a.id)};
      au.onerror=()=>{toast("Lecture impossible : format non pris en charge par ce navigateur.");auPaint(a.id)};
    }
    if(p.a.paused){auStopAll(a.id);try{await p.a.play()}catch(e){toast("Lecture impossible : "+(e&&e.message||"erreur du navigateur"))}}
    else p.a.pause();
    auPaint(a.id);
  }
  function recFillPlayers(root,v){
    root.querySelectorAll(".visau[data-au]").forEach(el=>{
      const n=(v.notes||[]).find(x=>x.audio&&x.audio.id===el.dataset.au);if(!n)return;
      el.querySelector(".aup").onclick=()=>auToggle(v,n.audio);
      // déplacement dans l'enregistrement : appui sur la barre
      el.querySelector(".aubar").onclick=e=>{const p=visPlayers[n.audio.id];if(!p||!p.a)return;const r=e.currentTarget.getBoundingClientRect(), dur=isFinite(p.a.duration)&&p.a.duration>0?p.a.duration:n.audio.dur;if(dur){try{p.a.currentTime=Math.max(0,Math.min(dur,dur*(e.clientX-r.left)/r.width))}catch(x){}auPaint(n.audio.id)}};
      auPaint(n.audio.id);
    });
  }
  // ---------- Transcription sur l'ordinateur (Whisper, dans le navigateur) ----------
  // Bibliothèque transformers.js hébergée avec l'appli (vendor/transformers) ; le modèle est téléchargé une fois
  // depuis huggingface.co puis gardé dans le cache du navigateur. Le son ne quitte jamais l'ordinateur.
  const TR_MODELS={standard:{id:"onnx-community/whisper-small",l:"Standard (conseillé)",d:"Téléchargement d'environ 240 Mo, transcription plus rapide. Adapté à un PC portable courant."},
    precis:{id:"onnx-community/whisper-large-v3-turbo",l:"Précis",d:"Meilleur sur le bruit d'entrepôt et les termes techniques. Téléchargement d'environ 1 Go, transcription nettement plus lente."}};
  const tr={q:[],busy:null,worker:null,dl:null,ready:{},err:""};
  const trOk=()=>!isPhone()&&typeof Worker!=="undefined"&&typeof WebAssembly!=="undefined"&&!!(window.AudioContext||window.webkitAudioContext);
  const trModel=()=>TR_MODELS[ui.trModel]?ui.trModel:"standard";
  const trState=nid=>tr.busy&&tr.busy.nid===nid?tr.busy:tr.q.find(x=>x.nid===nid)?{phase:"wait"}:null;
  const trTodo=v=>(v.notes||[]).filter(n=>n.audio&&!n.tr);
  // décodage de l'audio et passage en 16 kHz mono (format attendu par Whisper)
  async function trDecode(blob){
    const AC=window.AudioContext||window.webkitAudioContext, ac=new AC();
    let buf;try{buf=await ac.decodeAudioData(await blob.arrayBuffer())}finally{try{ac.close()}catch(e){}}
    const len=Math.max(1,Math.ceil(buf.duration*16000)), off=new OfflineAudioContext(1,len,16000), src=off.createBufferSource();
    src.buffer=buf;src.connect(off.destination);src.start();
    return (await off.startRendering()).getChannelData(0);
  }
  function trWorker(){
    if(tr.worker)return tr.worker;
    const w=tr.worker=new Worker("js/transcribe-worker.js?v="+(window.__APPV||""),{type:"module"});
    w.onmessage=e=>{
      const m=e.data, b=tr.busy;
      if(m.t==="dl"){tr.dl=m;trPaintDl();return}
      if(!b||m.job!==b.job)return;
      if(m.t==="loaded"){tr.ready[b.model]=1;ui.trReady=ui.trReady||{};ui.trReady[b.model]=1;saveUi();tr.dl=null;trPaintDl(true);b.phase="run";trPaint(b)}
      else if(m.t==="prog"){b.phase="run";b.pct=m.pct;trPaint(b)}
      else if(m.t==="done"){b.res(m.text)}
      else if(m.t==="err"){b.rej(new Error(m.msg||"erreur"))}
    };
    w.onerror=e=>{const b=tr.busy;if(b)b.rej(new Error(e.message||"Le module de transcription n'a pas pu démarrer."))};
    return w;
  }
  async function trRun(audio,model,job){
    if(typeof window.__testTranscribe==="function")return window.__testTranscribe(audio,model); // tests automatiques
    const w=trWorker();
    return new Promise((res,rej)=>{tr.busy.res=res;tr.busy.rej=rej;w.postMessage({t:"run",job,model:TR_MODELS[model].id,audio},[audio.buffer])});
  }
  // file d'attente : un enregistrement à la fois
  function trQueue(v,nids){
    nids.forEach(nid=>{if(!(tr.busy&&tr.busy.nid===nid)&&!tr.q.some(x=>x.nid===nid))tr.q.push({vid:v.id,nid})});
    renderVisit();trNext();
  }
  async function trStart(v,nids){
    if(!nids.length)return;
    const model=trModel();
    if(!(ui.trReady&&ui.trReady[model])&&typeof window.__testTranscribe!=="function"){const ok=await trModelDialog();if(!ok)return}
    trQueue(v,nids);
  }
  async function trNext(){
    if(tr.busy||!tr.q.length)return;
    const it=tr.q.shift(), rec=vis.map[it.vid], v=rec&&rec.v, n=v&&(v.notes||[]).find(x=>x.id===it.nid);
    if(!n||!n.audio||n.tr){trNext();return}
    const model=trModel(), job=uid();
    tr.busy={...it,job,model,phase:tr.ready[model]?"run":"load",pct:0};trPaint(tr.busy);renderVisit();
    try{
      const blob=await visAudioBlob(v,n.audio);
      if(!blob)throw new Error("Enregistrement introuvable : il n'est peut-être pas encore envoyé depuis le téléphone.");
      tr.busy.phase=tr.ready[model]?"run":"load";trPaint(tr.busy);
      const audio=await trDecode(blob);
      const text=String(await trRun(audio,model,job)||"").replace(/\s+/g," ").trim();
      trSet(it.vid,it.nid,x=>{x.tr={text:text||"(aucune parole reconnue)",at:Date.now(),model}});
    }catch(e){
      tr.err=e&&e.message||String(e);
      toast("Transcription impossible : "+tr.err);
      tr.q=tr.q.filter(x=>x.vid!==it.vid);
    }finally{tr.busy=null;renderVisit();trNext()}
  }
  function trSet(vid,nid,fn){
    if(visCur&&visCur.id===vid){visSet(x=>{const n=x.notes.find(y=>y.id===nid);if(n)fn(n)});return}
    const rec=vis.map[vid];if(!rec)return;const x=JSON.parse(JSON.stringify(rec.v)), n=x.notes.find(y=>y.id===nid);if(n){fn(n);visPut(x)}
  }
  function trPaint(b){
    const el=document.querySelector(`.visnote[data-n="${b.nid}"] .trprog`);if(!el)return;
    const pct=b.phase==="load"?(tr.dl&&tr.dl.pct!=null?tr.dl.pct:0):(b.pct||0);
    el.querySelector("[data-trl]").textContent=b.phase==="load"?"Préparation du modèle…":"Transcription en cours…";
    el.querySelector("[data-trp]").textContent=Math.round(pct)+" %";
    el.querySelector("i").style.width=Math.round(pct)+"%";
  }
  function trPaintDl(done){
    const d=document.querySelector("dialog.trdlg");
    if(d){const pr=d.querySelector(".trdl");pr.hidden=false;const pct=tr.dl&&tr.dl.pct!=null?Math.round(tr.dl.pct):0;pr.querySelector("[data-trp]").textContent=pct+" %";pr.querySelector("i").style.width=pct+"%";if(done&&d.__done)d.__done()}
    if(tr.busy)trPaint(tr.busy);
  }
  // première utilisation : choix de la qualité et téléchargement du modèle
  function trModelDialog(){
    return new Promise(res=>{
      const d=document.createElement("dialog");d.className="uidlg trdlg";d.setAttribute("aria-label","Transcription sur cet ordinateur");
      const cur=trModel();
      d.innerHTML=`<form method="dialog"><h3>Transcription sur cet ordinateur</h3>
        <p class="uimsg">Pour transcrire, l'appli télécharge une seule fois un modèle de reconnaissance vocale. Il reste ensuite sur cet ordinateur : les enregistrements ne sont jamais envoyés sur Internet.</p>
        <fieldset class="trq"><legend>Qualité de transcription</legend>${Object.entries(TR_MODELS).map(([k,m])=>`<label><input type="radio" name="trq" value="${k}" ${k===cur?"checked":""}><span><b>${m.l}</b><small>${m.d}</small></span></label>`).join("")}</fieldset>
        <div class="trdl" hidden><div class="trdlh"><span>Téléchargement du modèle…</span><span data-trp>0 %</span></div><div class="trbar"><i></i></div><small>Vous pouvez continuer à travailler dans l'appli pendant le téléchargement.</small></div>
        <p class="trnote">Fonctionne sur ordinateur, dans Chrome ou Edge. Sur le téléphone, les enregistrements attendent d'être transcrits depuis le PC.</p>
        <div class="uibtns"><button type="button" class="btn ghost" data-x>Plus tard</button><button type="button" class="btn primary" data-ok>Télécharger et transcrire</button></div></form>`;
      document.body.appendChild(d);
      const close=v2=>{try{d.close()}catch(e){}d.remove();res(v2)};
      d.addEventListener("cancel",e=>{e.preventDefault();close(false)});
      d.querySelector("[data-x]").onclick=()=>close(false);
      d.querySelector("[data-ok]").onclick=()=>{ui.trModel=d.querySelector("input[name=trq]:checked").value;saveUi();close(true)};
      if(d.showModal)d.showModal();else d.setAttribute("open","");
    });
  }
  // bandeau « enregistrements à transcrire » (ordinateur)
  function trBanner(v){
    if(!trOk())return "";
    const todo=trTodo(v);if(!todo.length)return "";
    const mins=Math.max(1,Math.round(todo.reduce((k,n)=>k+(n.audio.dur||0),0)/60));
    const running=todo.some(n=>trState(n.id));
    return `<section class="trban"><span class="trbic" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h7"></path><path d="M17 15l2 2 3-4"></path></svg></span>
      <div class="trbt"><b>${plural(todo.length,"enregistrement")} à transcrire dans ce déplacement · ${mins} min au total</b><span>La transcription se fait sur cet ordinateur : aucun son n'est envoyé sur Internet. Le texte obtenu est à relire.</span></div>
      ${running?`<span class="trbrun">Transcription en cours…</span>`:`<button type="button" class="btn primary" data-trall>Tout transcrire</button>`}</section>`;
  }
  function trBind(o,v){
    const all=o.querySelector("[data-trall]");if(all)all.onclick=()=>trStart(v,trTodo(v).map(n=>n.id));
    o.querySelectorAll("[data-tr]").forEach(b=>b.onclick=()=>trStart(v,[b.dataset.tr]));
    o.querySelectorAll("[data-trcancel]").forEach(b=>b.onclick=()=>{const id=b.dataset.trcancel;tr.q=tr.q.filter(x=>x.nid!==id);if(tr.busy&&tr.busy.nid===id){try{tr.worker&&tr.worker.terminate()}catch(e){}tr.worker=null;tr.ready={};const bz=tr.busy;bz.rej&&bz.rej(new Error("annulée"))}renderVisit()});
    o.querySelectorAll("[data-tredit]").forEach(b=>b.onclick=async()=>{const n=v.notes.find(x=>x.id===b.dataset.tredit);if(!n||!n.tr)return;const t=await uiPrompt("Corriger la transcription",n.tr.text,{ok:"Enregistrer",multiline:true});if(t!=null)trSet(v.id,n.id,x=>{x.tr={...x.tr,text:t.trim().slice(0,20000),edited:Date.now()}})});
    o.querySelectorAll("[data-trq]").forEach(b=>b.onclick=async()=>{
      const n=v.notes.find(x=>x.id===b.dataset.trq);if(!n||!n.tr)return;
      const sel=String(window.getSelection&&window.getSelection().toString()||"").trim();
      const t=await uiPrompt("Question client (vous pouvez raccourcir le passage)",sel||n.tr.text,{ok:"Créer la question",multiline:true});
      if(!t||!t.trim())return;
      visSet(x=>x.notes.push({id:uid(),flow:n.flow,type:"question",text:t.trim().slice(0,4000),photos:[],at:Date.now(),conv:null}));
      toast("Question client ajoutée au flux : elle deviendra un point ouvert en fin de déplacement.");
    });
    o.querySelectorAll("[data-pick]").forEach(b=>b.onmousedown=e=>e.preventDefault()); // garder la sélection de texte
  }
  function visAudioHtml(n){
    const a=n.audio, st=trState(n.id), canTr=trOk();
    let trh="";
    if(n.tr)trh=`<div class="vistr"><span class="vistrl">Transcription automatique · à relire</span><p>${esc(n.tr.text).replace(/\n/g,"<br>")}</p><div class="vistrb"><button type="button" class="btn" data-tredit="${esc(n.id)}">Corriger le texte</button><button type="button" class="btn" data-trq="${esc(n.id)}" data-pick>Créer une question client à partir d'un passage</button></div></div>`;
    else if(st&&st.phase!=="wait")trh=`<div class="trprog"><div class="trdlh"><span data-trl>${st.phase==="load"?"Préparation du modèle…":"Transcription en cours…"}</span><span data-trp>${Math.round(st.pct||0)} %</span></div><div class="trbar"><i style="width:${Math.round(st.pct||0)}%"></i></div><button type="button" class="btn" data-trcancel="${esc(n.id)}">Annuler</button></div>`;
    else if(st)trh=`<div class="trwait"><span>En attente : sera transcrit après l'enregistrement en cours.</span><button type="button" class="btn" data-trcancel="${esc(n.id)}">Retirer</button></div>`;
    else if(canTr)trh=`<div class="trwait"><span>Pas encore transcrit.</span><button type="button" class="btn trgo" data-tr="${esc(n.id)}">Transcrire</button></div>`;
    else trh=`<div class="trpc">${svgI("M3 4h18v12H3zM8 20h8M12 16v4")} À transcrire sur l'ordinateur</div>`;
    return `<div class="visau" data-au="${esc(a.id)}" data-dur="${+a.dur||0}"><button type="button" class="aup" aria-label="Écouter l'enregistrement">${PLAY_SVG}</button><button type="button" class="aubar" aria-label="Se déplacer dans l'enregistrement"><i></i></button><span class="aut">${mmss(a.dur||0)}</span></div>${trh}`;
  }
  function renderVisits(L,p){
    visEnsure();if(vis.loaded)visLoad();
    const top=document.createElement("div");top.className="vistopbar";
    top.innerHTML=`<button type="button" class="btn primary" data-new>${WH_SVG}Démarrer un déplacement</button><button type="button" class="btn" data-prep>Préparer un déplacement</button><span class="muted">Préparez au bureau, puis démarrez sur site. Fonctionne sans réseau : l'envoi se fait au retour de la connexion.</span>`;
    top.querySelector("[data-prep]").onclick=()=>visNew(p,true);
    top.querySelector("[data-new]").onclick=()=>visNew(p);
    L.appendChild(top);
    const vs=visList(p.id);
    if(!vs.length){const g=document.createElement("section");g.className="group";g.innerHTML=`<h2>Déplacements <span>0</span></h2><div class="empty">${vis.loaded?"Aucun déplacement pour ce projet.":"Chargement…"}</div>`;L.appendChild(g);return}
    const dl=t=>new Date(t).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"});
    const menu=async v=>{
      const ch=await visSheet(v.title,[{k:"open",l:"Ouvrir le déplacement"},...(v.status==="open"?[{k:"fin",l:"Clôturer le déplacement"}]:[]),...(v.status!=="prep"?[{k:"pdf",l:"Exporter le compte rendu (PDF)"}]:[]),{k:"del",l:"Supprimer le déplacement",danger:true}]);
      if(ch==="open")visOpen(v);else if(ch==="fin")visFinish(v);else if(ch==="pdf")visPdf(v);else if(ch==="del")visDelete(v);
    };
    [["open","En cours"],["prep","Préparés"],["done","Terminés"]].forEach(([st,lab])=>{
      const list=vs.filter(v=>(v.status||"open")===st);if(!list.length)return;
      const g=document.createElement("section");g.className="group visgrp";
      g.innerHTML=`<h2>${lab} <span>${list.length}</span></h2>`;
      const ul=document.createElement("ul");ul.className="tasks vislst";
      list.forEach(v=>{
        const li=document.createElement("li");li.className="task mtgrow vrow vr-"+st;
        const ns=v.notes||[], c=visCounts(ns), its=visItemsOn(v), seen=its.filter(i=>i.seen).length, pr=v.prep||{}, pl=pr.plannedAt, nPart=(pr.participants||[]).length;
        const d=st==="prep"?pl:visDate(v);
        const stats=[plural(c.n,"note"),plural(c.ph,"photo"),c.q?plural(c.q,"question"):"",c.au?plural(c.au,"enregistrement"):""].filter(Boolean).join(" · ");
        const nd=visNDays(v), meta=st==="prep"?[pl?(nd>1?`${visRangeTxt(v)} · début ${hm(pl)}`:`${dl(pl)} · ${hm(pl)}`):"Pas encore daté",pr.location||"",isMes(v)?VIS_TYPES.mes.l:plural(its.length,"élément")+" à voir",nPart?plural(nPart,"participant"):""].filter(Boolean)
          :st==="open"?[`Démarré ${dl(visDate(v))} à ${hm(visDate(v))}`,nd>1?`${nd} jours, jusqu'au ${new Date(visEndDay(v)+"T12:00").toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}`:"",pr.location||"",stats]:[nd>1?visRangeTxt(v):dl(visDate(v)),stats];
        const trn=ns.filter(n=>n.audio&&!n.tr).length, pend=visPendingN(v);
        const tags=`<span class="tag ${st==="done"?"done-t":st==="prep"?"wait":"vt-act"}">${st==="done"?"Terminé":st==="prep"?"Préparé":"En cours"}</span>${vis.map[v.id]&&vis.map[v.id].dirty?`<span class="tag vt-act">En attente d'envoi</span>`:""}${st!=="prep"&&trn?`<span class="tag vt-au">${plural(trn,"enregistrement")} à transcrire</span>`:""}${st==="done"&&pend?`<span class="tag vt-cli">${plural(pend,"élément")} à créer dans le projet</span>`:""}${st==="done"&&!pend&&ns.some(n=>n.conv)?`<span class="tag done-t">Points et tâches créés</span>`:""}`;
        li.innerHTML=`<span class="mtgdate vdd">${d?`<b>${new Date(d).getDate()}${nd>1?`<i class="vddto">–${new Date(visEndDay(v)+"T12:00").getDate()}</i>`:""}</b><small>${esc(new Date(d).toLocaleDateString("fr-FR",{month:"short"}))}</small>`:`<small>À dater</small>`}</span>
          <div class="vbody"><div class="ttl">${esc(v.title)}</div><div class="meta"><span class="vmeta">${meta.map(esc).join(" · ")}</span>${tags}</div>${st==="open"&&its.length?`<div class="vprog"><span class="vbar sm"><i style="width:${Math.round(100*seen/its.length)}%"></i></span><span>${seen} / ${its.length} vus</span></div>`:""}</div>
          <div class="vacts">${st==="open"?`<button type="button" class="btn sm" data-fin>Clôturer</button><button type="button" class="btn primary sm" data-open>Reprendre</button>`:st==="prep"?`<button type="button" class="btn sm" data-open>Modifier</button><button type="button" class="btn primary sm" data-startl>Démarrer</button>`:`<button type="button" class="btn sm" data-open>Bilan</button><button type="button" class="btn sm" data-pdfl>${VI.doc}<span>Compte rendu PDF</span></button>`}<button type="button" class="btn sm vmore" data-vmore aria-label="Plus d'actions sur le déplacement ${esc(v.title)}">${VI.more}</button></div>`;
        const stop=fn=>e=>{e.stopPropagation();fn()};
        li.querySelector("[data-vmore]").onclick=stop(()=>menu(v));
        const fin=li.querySelector("[data-fin]");if(fin)fin.onclick=stop(()=>visFinish(v));
        const op=li.querySelector("[data-open]");if(op)op.onclick=stop(()=>{visOpen(v);if(st==="done"){visScreen="end";renderVisit()}});
        const sl=li.querySelector("[data-startl]");if(sl)sl.onclick=stop(()=>{visOpen(v);visStartNow()});
        const pd=li.querySelector("[data-pdfl]");if(pd)pd.onclick=stop(()=>visPdf(v));
        li.onclick=()=>visOpen(v);ul.appendChild(li)});
      g.appendChild(ul);L.appendChild(g);
    });
  }
  window.__visState=()=>({map:vis.map,pending:vis.pending}); // utilisé par les tests
  window.__auState=()=>Object.fromEntries(Object.entries(visPlayers).map(([k,p])=>[k,{playing:!!(p.a&&!p.a.paused),t:p.a?p.a.currentTime:0}]));
  // ---------- Téléphone : écran Projets (icônes) et accueil du projet ----------
  // Sur téléphone, « Projets » (barre du bas) ouvre la grille des projets ; un projet s'ouvre sur son accueil
  // (alerte, quatre rubriques, prochaines échéances) et chaque rubrique s'affiche en plein écran avec un retour.
  const isPhone=()=>window.matchMedia("(max-width:899px)").matches;
  const projIni=n=>{const w=String(n||"").replace(/[^\p{L}\p{N}\s/'-]/gu," ").split(/[\s/'-]+/).filter(Boolean);return ((w.length>1?w[0][0]+w[1][0]:(w[0]||"?").slice(0,2))||"?").toUpperCase()};
  const ICO={req:"M4 4h16v12H8l-4 4zM8 9h8M8 12h5",tasks:"M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",points:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16v.5",meetings:"M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",visits:"M3 9.5 12 4l9 5.5V20H3zM7 20v-8h10v8M7 14.5h10M7 17.5h10"};
  const svgI=d=>`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  function openProject(id){if(view!==id)shareOpen=false;if(view==="all"&&ui.who==="__me")ui.who=""; // le filtre « Mes tâches » de la vue Tâches ne suit pas dans le projet
    view=id;if(ui.scope==="today")ui.scope="all";ui.mode=isPhone()?"home":(["dash","trash","requests","projects","home"].includes(ui.mode)?"list":ui.mode);saveUi();editing=null;query="";$("#search").value="";closeMenu();render();window.scrollTo({top:0})}
  // ---------- Ordre des projets : glisser-déposer dans la barre de gauche (souris, tactile après appui long, Alt+flèches) ----------
  const projDrag={on:false,justDropped:false};
  function projSetOrder(ids){
    const pos=new Map(ids.map((id,i)=>[id,i]));
    const act=state.projects.filter(p=>!p.archived).sort((a,b)=>(pos.has(a.id)?pos.get(a.id):1e6)-(pos.has(b.id)?pos.get(b.id):1e6));
    state.projects=act.concat(state.projects.filter(p=>p.archived));
    const order=state.projects.map(p=>p.id);
    if(MODE==="cloud"&&cloud.user){cloud.projOrder=order;cloud._orderPending=true;
      cloudClient().from("profiles").update({project_order:order}).eq("user_id",cloud.user.id).then(({error})=>{cloud._orderPending=false;if(error)toast("Ordre des projets non enregistré en ligne : "+(error.message||"erreur"))},()=>{cloud._orderPending=false})}
    else save();
    render();
  }
  function projDragBind(li){
    const btn=li.querySelector(".pbtn");
    btn.addEventListener("keydown",e=>{
      if(!e.altKey||(e.key!=="ArrowUp"&&e.key!=="ArrowDown"))return;e.preventDefault();
      const ids=[...li.parentNode.querySelectorAll("li.pli")].map(x=>x.dataset.pid), i=ids.indexOf(li.dataset.pid), j=i+(e.key==="ArrowUp"?-1:1);
      if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];projSetOrder(ids);
      const nb=document.querySelector(`#plist li[data-pid="${li.dataset.pid}"] .pbtn`);if(nb)nb.focus();
    });
    btn.addEventListener("pointerdown",e=>{
      if(e.button!==0||projDrag.on)return;
      const touch=e.pointerType!=="mouse", y0=e.clientY, x0=e.clientX;let started=false, timer=null, items, idx, h, gap, rects, target;
      const begin=()=>{
        started=true;projDrag.on=true;
        items=[...li.parentNode.querySelectorAll("li.pli")];idx=items.indexOf(li);target=idx;
        rects=items.map(x=>x.getBoundingClientRect());h=rects[idx].height;gap=items.length>1?(rects[Math.min(1,items.length-1)].top-rects[0].bottom):0;
        li.classList.add("pdrag");li.parentNode.classList.add("pdragging");
        try{btn.setPointerCapture(e.pointerId)}catch(x){}
        if(navigator.vibrate&&touch)try{navigator.vibrate(15)}catch(x){}
      };
      const move=ev=>{
        if(!started){
          if(touch){if(Math.abs(ev.clientY-y0)>8||Math.abs(ev.clientX-x0)>8){clearTimeout(timer);cleanup()}return}
          if(Math.abs(ev.clientY-y0)<5)return;begin();
        }
        ev.preventDefault();
        const dy=ev.clientY-y0;li.style.transform=`translateY(${dy}px)`;
        const mid=rects[idx].top+h/2+dy;
        let t=0;rects.forEach((r,k)=>{if(k!==idx&&mid>r.top+r.height/2)t++});
        if(t!==target){target=t;items.forEach((x,k)=>{if(k===idx)return;const sh=(idx<target&&k>idx&&k<=target)?-(h+gap):(idx>target&&k<idx&&k>=target)?(h+gap):0;x.style.transform=sh?`translateY(${sh}px)`:""})}
      };
      const up=()=>{
        clearTimeout(timer);
        if(!started){cleanup();return}
        const final=(target-idx)*(h+gap)+(target>idx?0:0);
        li.classList.add("pdrop");li.style.transform=`translateY(${final}px)`;
        const ids=items.map(x=>x.dataset.pid);const [m]=ids.splice(idx,1);ids.splice(target,0,m);
        projDrag.justDropped=true;setTimeout(()=>{projDrag.justDropped=false},250);
        setTimeout(()=>{items.forEach(x=>{x.style.transform="";x.classList.remove("pdrag","pdrop")});li.parentNode&&li.parentNode.classList.remove("pdragging");projDrag.on=false;if(target!==idx)projSetOrder(ids)},170);
        cleanup(true);
      };
      const cleanup=keep=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);document.removeEventListener("pointercancel",up);if(!keep&&!started)projDrag.on=false};
      document.addEventListener("pointermove",move,{passive:false});document.addEventListener("pointerup",up);document.addEventListener("pointercancel",up);
      if(touch)timer=setTimeout(()=>{if(!started)begin()},300);
    });
    btn.addEventListener("contextmenu",e=>{if(projDrag.on)e.preventDefault()});
    btn.title=btn.title||"Glisser pour changer l'ordre (ou Alt + flèches)";
  }
  window.__projOrder=()=>state.projects.map(p=>p.name); // utilisé par les tests
  function renderProjects(L){
    const alive=live(), act=state.projects.filter(p=>!p.archived), arch=state.projects.filter(p=>p.archived);
    const tile=p=>{const open=alive.filter(t=>t.projectId===p.id&&t.status!=="done"), late=open.filter(isLate).length;
      return `<button type="button" class="pjt" data-p="${esc(p.id)}"><span class="pjic${pLogo(p)?" haslogo":""}" style="--pc:${esc(p.color||"#999")}">${pLogo(p)?`<img src="${p.logo}" alt="">`:esc(projIni(p.name))}${late?`<em aria-label="${late} en retard">${late}</em>`:""}</span><b>${esc(p.name)}</b>${ansOf(p.id).length?`<span class="pjans">${ansTxt(ansOf(p.id).length).replace(" du client"," client")}</span>`:`<span>${open.length} tâche${open.length>1?"s":""}</span>`}</button>`};
    L.innerHTML=`<section class="pjgrid" aria-label="Projets en cours">${act.map(tile).join("")}<button type="button" class="pjt" data-newp><span class="pjic add">${svgI("M12 5v14M5 12h14")}</span><b>Nouveau</b></button></section>
      ${arch.length?`<details class="pjarch"${ui.showArch?" open":""}><summary>Projets archivés <span>${arch.length}</span></summary><section class="pjgrid">${arch.map(tile).join("")}</section></details>`:""}
`;
    L.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>openProject(b.dataset.p));
    L.querySelector("[data-newp]").onclick=async()=>{const n=await uiPrompt("Nom du nouveau projet","",{ok:"Créer"});if(n&&n.trim())addProject(n)};
    const ad=L.querySelector(".pjarch");if(ad)ad.ontoggle=()=>{ui.showArch=ad.open;saveUi()};
  }
  function renderProjHome(L,p){
    const alive=live(), open=alive.filter(t=>t.projectId===p.id&&t.status!=="done");
    const late=open.filter(isLate), relance=open.filter(t=>t.status==="waiting"&&t.due&&parseD(t.due)<=today());
    const pts=livePts().filter(o=>o.projectId===p.id), po=pts.filter(o=>o.status!=="closed"), pcli=po.filter(o=>o.owner==="client").length;
    const ms=mtgList(p.id), drafts=ms.filter(m=>m.status==="draft").length;
    visEnsure();const vs=visList(p.id), vOpen=vs.filter(v=>v.status==="open").length, vPrep=vs.filter(v=>v.status==="prep");
    const rq=liveReq().filter(r=>r.projectId===p.id&&reqOpen(r)), rqLate=rq.filter(r=>reqLate(r)).length;
    const dshort=ms=>new Date(ms).toLocaleDateString("fr-FR",{day:"numeric",month:"long"});
    const tiles=[
      ["list","Tâches","tasks","t-tasks",open.length,open.length>1?"ouvertes":"ouverte",late.length?`${late.length} en retard`:"Rien en retard",!!late.length],
      ["points","Points ouverts","points","t-points",po.length,po.length>1?"ouverts":"ouvert",ansOf(p.id).length?ansTxt(ansOf(p.id).length):po.length?`${pcli} à répondre par le client`:"Aucun point ouvert",!!ansOf(p.id).length],
      ["requests","Demandes client","req","t-req",rq.length,"en cours",rqLate?`${rqLate} en retard`:rq.some(r=>r.status==="new")?plural(rq.filter(r=>r.status==="new").length,"nouvelle"):rq.length?"Rien en retard":"Aucune demande en cours",!!rqLate],
      ["meetings","Réunions","meetings","t-mtg",ms.length,ms.length>1?"comptes rendus":"compte rendu",drafts?`${drafts} brouillon${drafts>1?"s":""} à finaliser`:ms.length?`Dernier : ${dshort(ms[0].startsAt||ms[0].createdAt)}`:"Aucun compte rendu",false],
      ["visits","Déplacements","visits","t-vis",vs.length,vs.length>1?"déplacements":"déplacement",vOpen?`${vOpen} en cours`:vPrep.length?`Préparé${vPrep[0].prep&&vPrep[0].prep.plannedAt?" : "+(visNDays(vPrep[0])>1?visRangeTxt(vPrep[0]):dshort(vPrep[0].prep.plannedAt)):""}`:vs.length?`Dernier : ${dshort(visDate(vs[0]))}`:"Aucun déplacement",false]];
    const nxt=open.filter(t=>t.due).sort((a,b)=>(isLate(b)-isLate(a))||(a.due<b.due?-1:1)).slice(0,3);
    const alert=late.length||relance.length?`<button type="button" class="phalert" data-go="list">${svgI("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2")}<span>${[late.length?`<b>${late.length} tâche${late.length>1?"s":""} en retard</b>`:"",relance.length?`${relance.length} relance${relance.length>1?"s":""} à faire`:""].filter(Boolean).join(" · ")}</span>${svgI("M9 6l6 6-6 6")}</button>`:"";
    L.innerHTML=`${alert}<section class="phtiles" aria-label="Rubriques du projet">${tiles.map(([m,t,ic,c,n,u,s,w])=>`<button type="button" class="phtile ${c}" data-go="${m}"><span class="phic">${svgI(ICO[ic])}</span><b>${t}</b><span class="phn"><strong>${n}</strong> ${u}</span><span class="phs${w?" warn":""}">${esc(s)}</span></button>`).join("")}</section>
      ${nxt.length?`<section class="phnext" aria-label="Prochaines échéances"><h3>Prochaines échéances</h3>${nxt.map(t=>`<button type="button" class="phrow" data-t="${esc(t.id)}"><span class="phck" aria-hidden="true"></span><span class="pht">${esc(t.title)}</span><span class="phd${isLate(t)?" late":""}">${isLate(t)?"En retard":esc(shortDay(t.due))}</span></button>`).join("")}</section>`:""}`;
    L.querySelector(".phtiles").insertAdjacentHTML("afterend",`<div class="phacts"><button type="button" class="btn primary" data-act="visit">${svgI("M3 9.5 12 4l9 5.5V20H3zM7 20v-8h10v8M7 14.5h10M7 17.5h10")}Démarrer un déplacement</button><button type="button" class="btn" data-act="mtg">${svgI("M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v14H3zM3 10h18M8 3v4M16 3v4")}Nouvelle réunion</button></div>`);
    L.querySelector('[data-act="visit"]').onclick=()=>{ui.mode="visits";saveUi();render();visNew(p)};
    L.querySelector('[data-act="mtg"]').onclick=()=>mtgStart(p);
    L.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{ui.mode=b.dataset.go;if(ui.mode==="list")ui.scope="all";saveUi();editing=null;render();window.scrollTo({top:0})});
    L.querySelectorAll("[data-t]").forEach(b=>b.onclick=()=>{ui.mode="list";ui.scope="all";saveUi();editing=b.dataset.t;render();const el=document.querySelector(`.task[data-id="${b.dataset.t}"]`);if(el)el.scrollIntoView({block:"center"})});
  }
  // ---------- Vue d'ensemble du projet (ordinateur) : où en est-on, que faut-il traiter ----------
  function renderOverview(L,p){
    const alive=live(), all=alive.filter(t=>t.projectId===p.id), open=all.filter(t=>t.status!=="done");
    const late=open.filter(isLate), today_=open.filter(isToday), relance=open.filter(needsRelance);
    const pts=livePts().filter(o=>o.projectId===p.id), po=pts.filter(o=>o.status!=="closed"), cli=po.filter(o=>o.owner==="client"), ans=ansOf(p.id);
    const reqs=liveReq().filter(r=>r.projectId===p.id&&reqOpen(r)), reqLateL=reqs.filter(reqLate);
    const ms=mtgList(p.id), now=Date.now(), nextM=ms.filter(m=>m.startsAt&&m.startsAt>=now-3600e3).sort((a,b)=>a.startsAt-b.startsAt)[0], drafts=ms.filter(m=>m.status==="draft");
    visEnsure();const vs=visList(p.id), lastV=vs[0], toTr=vs.reduce((k,v)=>k+(v.notes||[]).filter(n=>n.audio&&!n.tr).length,0);
    const dlong=ms_=>new Date(ms_).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"});
    const pct=(a,b)=>b?Math.round(100*a/b):0;
    const card=(go,k,n,u,d,cls,bar)=>`<button type="button" class="ovcard" data-go="${go}"><span class="ovk">${k}</span><span class="ovn"><b>${n}</b> ${u}</span><span class="ovd${cls?" "+cls:""}">${d}</span>${bar||""}</button>`;
    const doneN=all.length-open.length;
    const cards=[
      card("list","Tâches",open.length,open.length>1?"ouvertes":"ouverte",[late.length&&`${late.length} en retard`,relance.length&&`${plural(relance.length,"relance")}`].filter(Boolean).join(" · ")||"Rien en retard",late.length?"late":"",`<span class="ovbar"><i class="gbok" style="width:${pct(doneN,all.length)}%"></i></span>`),
      card("points","Points ouverts",po.length,po.length>1?"ouverts":"ouvert",ans.length?ansTxt(ans.length):`${cli.length} à répondre par le client`,ans.length?"new":"",po.length?`<span class="ovbar"><i class="gbcli" style="width:${pct(cli.length,po.length)}%"></i><i class="gboth" style="width:${pct(po.length-cli.length,po.length)}%"></i></span>`:""),
      card("meetings","Réunions",nextM?esc(dlong(nextM.startsAt)):ms.length,nextM?`· ${new Date(nextM.startsAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`:(ms.length>1?"comptes rendus":"compte rendu"),nextM?esc(nextM.title):drafts.length?`${plural(drafts.length,"brouillon")} à finaliser`:"Aucune réunion prévue",""),
      card("visits","Déplacements",lastV?esc(new Date(visDate(lastV)).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})):"0",lastV?"dernier déplacement":"déplacement",lastV?(toTr?`${plural(toTr,"enregistrement")} à transcrire`:`${plural((lastV.notes||[]).length,"note")} · ${lastV.status==="done"?"terminé":lastV.status==="prep"?"préparé":"en cours"}`):"Aucun déplacement","")
    ].join("");
    // à traiter
    const rows=[];
    late.forEach(t=>rows.push({k:"t",id:t.id,ic:"!",c:"late",t:t.title,d:`Tâche · échéance ${shortDay(t.due).toLowerCase()}`,tag:`<span class="tag late">En retard</span>`}));
    ans.forEach(o=>rows.push({k:"o",id:o.id,ic:"R",c:"new",t:(ptNumOf(o)?ptNumOf(o)+" · ":"")+o.text.split("\n")[0],d:`Point ouvert · réponse reçue ${fmtWhen(o.ansNew)}`,tag:`<span class="tag ansnew">Nouvelle réponse</span>`}));
    reqLateL.forEach(r=>rows.push({k:"r",id:r.id,ic:"D",c:"late",t:"Demande client : "+r.title,d:`Réponse attendue le ${shortDay(r.due).toLowerCase()}`,tag:`<span class="tag late">En retard</span>`}));
    today_.filter(t=>!isLate(t)&&!needsRelance(t)).forEach(t=>rows.push({k:"t",id:t.id,ic:"✓",c:"today",t:t.title,d:"Tâche · aujourd'hui",tag:`<span class="tag today">Aujourd'hui</span>`}));
    relance.forEach(t=>rows.push({k:"t",id:t.id,ic:"↻",c:"wait",t:t.title,d:`En attente${t.waitingFor?" : "+t.waitingFor:""}`,tag:`<span class="tag wait">Relance</span>`}));
    const todo=rows.slice(0,8).map((r,i)=>`<button type="button" class="ovrow" data-i="${i}"><span class="ovic ${r.c}">${esc(r.ic)}</span><span class="ovrt"><b>${esc(r.t)}</b><span>${esc(r.d)}</span></span>${r.tag}</button>`).join("");
    // points par thème
    const th={};po.forEach(o=>{const k=o.theme||"Sans thème";(th[k]=th[k]||{c:0,m:0});if(o.owner==="client")th[k].c++;else th[k].m++});
    const thl=Object.entries(th).sort((a,b)=>(b[1].c+b[1].m)-(a[1].c+a[1].m)).slice(0,7), mx=Math.max(1,...thl.map(([,x])=>x.c+x.m));
    const themes=thl.map(([k,x])=>`<div class="ovth"><span>${esc(k)}</span><span class="ovthb"><i class="gbcli" style="width:${100*x.c/mx}%"></i><i class="gboth" style="width:${100*x.m/mx}%"></i></span><b>${x.c+x.m}</b></div>`).join("");
    // activité récente
    const ev=[];
    all.filter(t=>t.status==="done"&&t.doneAt).forEach(t=>ev.push([t.doneAt,"✓",`Tâche terminée : ${t.title}`,"et-task"]));
    pts.filter(o=>o.status==="closed"&&o.closedAt).forEach(o=>ev.push([o.closedAt,"✓",`Point levé${ptNumOf(o)?" "+ptNumOf(o):""} : ${o.text.split("\n")[0]}`,"et-pt"]));
    pts.filter(o=>o.ansNew).forEach(o=>ev.push([o.ansNew,"R",`Réponse du client${ptNumOf(o)?" sur le "+ptNumOf(o):""} (Excel)`,"et-ans"]));
    ms.forEach(m=>ev.push([m.startsAt||m.createdAt||0,"C",`Réunion : ${m.title}${m.status==="draft"?" (brouillon)":""}`,"et-mtg"]));
    vs.forEach(v=>ev.push([v.endedAt||v.startedAt||v.createdAt||0,"V",`Déplacement${v.status==="done"?" clôturé":v.status==="prep"?" préparé":" en cours"} : ${v.title}`,"et-vis"]));
    const evs=ev.filter(e=>e[0]&&e[0]<=now+864e5).sort((a,b)=>b[0]-a[0]).slice(0,6).map(e=>`<li><span class="ovic sm ${e[3]||""}">${e[1]}</span><span><b>${esc(e[2])}</b><span>${esc(fmtWhen(e[0]))}</span></span></li>`).join("");
    L.innerHTML=`<section class="ovcards" aria-label="État du projet">${cards}</section>
      <div class="ovgrid">
        <section class="ovbox"><h2>À traiter</h2>${todo||`<p class="hint">Rien d'urgent : aucune tâche en retard, aucune nouvelle réponse du client.</p>`}${rows.length>8?`<button type="button" class="btn ghost" data-go="list">Voir toutes les tâches</button>`:""}</section>
        <div class="ovcol">
          ${po.length?`<section class="ovbox"><div class="ovh"><h2>Points ouverts par thème</h2><span class="ovlg"><i style="background:linear-gradient(90deg,#2C6FB7,#8CB8E8)"></i>Client <i style="background:linear-gradient(90deg,#8A99A3,#C3CDD3)"></i>Autres</span></div>${themes}</section>`:""}
          <section class="ovbox"><h2>Activité récente</h2>${evs?`<ul class="ovfeed">${evs}</ul>`:`<p class="hint">Pas encore d'activité enregistrée.</p>`}</section>
        </div>
      </div>`;
    L.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{ui.mode=b.dataset.go;if(ui.mode==="list")ui.scope="all";saveUi();editing=null;render();window.scrollTo({top:0})});
    L.querySelectorAll(".ovrow").forEach(b=>b.onclick=()=>{
      const r=rows[+b.dataset.i];
      if(r.k==="t"){ui.mode="list";ui.scope="all";saveUi();editing=r.id;render();const el=document.querySelector(`.task[data-id="${r.id}"]`);if(el)el.scrollIntoView({block:"center"})}
      else if(r.k==="o"){ansShow(p.id)}
      else{const rq=liveReq().find(x=>x.id===r.id);if(rq)openRequest(rq)}
    });
  }
  // Bouton + de l'accueil du projet : choix de ce qu'on ajoute
  async function phoneAdd(p){
    const ch=await visSheet("Ajouter au projet",[{k:"t",l:"Une tâche"},{k:"o",l:"Un point ouvert"},{k:"m",l:"Une réunion (compte rendu)"},{k:"v",l:"Un déplacement sur site"}]);
    if(ch==="t"){ui.mode="list";ui.scope="all";saveUi();render();setTimeout(()=>$("#fab").click(),50)}
    else if(ch==="o"){ui.mode="points";saveUi();render();setTimeout(()=>{const el=document.querySelector("#addslot input[type=text],#ptadd input[type=text],#ptadd textarea");document.body.classList.add("addopen");if(el){window.scrollTo({top:0});el.focus()}},80)}
    else if(ch==="m"){const r=await mtgNewDialog({projectId:p.id});if(r){ui.mode="meetings";saveUi();render();mtgOpen(r,"prep")}}
    else if(ch==="v"){ui.mode="visits";saveUi();render();visNew(p)}
  }
  // ---------- Points ouverts standard (modèle d'AF, stocké en base : réservé aux utilisateurs connectés) ----------
  let tplCache=null;
  async function loadTemplates(){
    if(MODE!=="cloud")return null;
    if(tplCache)return tplCache;
    const {data,error}=await cloudClient().from("point_templates").select("*");
    if(error)return null;
    tplCache=(data||[]).filter(t=>t.text).sort((a,b)=>(a.flow_order-b.flow_order)||(a.sort-b.sort));
    return tplCache;
  }
  async function tplDialog(p,isNew){
    const tpl=await loadTemplates();
    if(!tpl||!tpl.length){if(!isNew)uiAlert(MODE==="cloud"?"Points standard indisponibles : connexion au serveur impossible.":"Les points ouverts standard ne sont disponibles qu'en mode en ligne.");return}
    const have=new Set(livePts().filter(o=>o.projectId===p.id).map(o=>norm(o.text)));
    const flows=[];tpl.forEach(t=>{let f=flows.find(x=>x.name===t.flow);if(!f)flows.push(f={name:t.flow,items:[]});f.items.push(t)});
    flows.forEach(f=>f.todo=f.items.filter(t=>!have.has(norm(t.text))));
    if(!flows.some(f=>f.todo.length)){if(!isNew)uiAlert("Tous les points standard sont déjà présents dans ce projet.");return}
    const picked=await new Promise(res=>{
      if(typeof window.__testDialog==="function"){Promise.resolve(window.__testDialog({type:"templates",message:p.name,flows:flows.map(f=>f.name)})).then(r=>res(r&&r.ok===false?null:(r&&r.v)||flows.map(f=>f.name)));return}
      const d=document.createElement("dialog");d.className="uidlg";d.setAttribute("aria-label","Points ouverts standard");
      d.innerHTML=`<form method="dialog"><h3>${isNew?"Points ouverts de base":"Ajouter les points ouverts standard"}</h3>
        <p class="uimsg">${isNew?`Ajouter au projet « ${esc(p.name)} » les points ouverts standard de l'analyse fonctionnelle ?`:"Points issus du modèle d'analyse fonctionnelle (standard, hors modules)."} Chaque flux devient un thème ; les points sont à répondre par le client.</p>
        <div class="tplflows">${flows.map((f,i)=>`<label><input type="checkbox" data-f="${i}" ${f.todo.length?"checked":"disabled"}><span>${esc(f.name)}</span><em>${f.todo.length?`${f.todo.length} point${f.todo.length>1?"s":""}`:"déjà présents"}</em></label>`).join("")}</div>
        <p class="uimsg" data-n style="font-size:13px;color:var(--muted)"></p>
        <div class="uibtns"><button type="button" class="btn ghost" data-x>${isNew?"Projet vide":"Annuler"}</button><button type="button" class="btn primary" data-ok>Ajouter les points</button></div></form>`;
      document.body.appendChild(d);
      const boxes=[...d.querySelectorAll("[data-f]")];
      const upd=()=>{const n=boxes.filter(b=>b.checked).reduce((s,b)=>s+flows[+b.dataset.f].todo.length,0);d.querySelector("[data-n]").textContent=`${n} point${n>1?"s":""} ouvert${n>1?"s":""} seront créés.`;d.querySelector("[data-ok]").disabled=!n};
      boxes.forEach(b=>b.onchange=upd);upd();
      const close=v=>{try{d.close()}catch(e){}d.remove();res(v)};
      d.addEventListener("cancel",e=>{e.preventDefault();close(null)});
      d.querySelector("[data-x]").onclick=()=>close(null);
      d.querySelector("[data-ok]").onclick=()=>close(boxes.filter(b=>b.checked).map(b=>flows[+b.dataset.f].name));
      if(d.showModal)d.showModal();else d.setAttribute("open","");
      setTimeout(()=>d.querySelector("[data-ok]").focus(),0);
    });
    if(!picked||!picked.length)return;
    const now=Date.now();let k=0;
    flows.filter(f=>picked.includes(f.name)).forEach(f=>f.todo.forEach(t=>state.points.push({id:newId(),projectId:p.id,text:t.text,answer:"",hypothesis:t.hypothesis||"",erp:"",theme:f.name,owner:"client",ownerName:"",status:"open",taskId:null,requestId:null,createdAt:now+(k++),closedAt:null})));
    save();render();
    toast(`${k} point${k>1?"s":""} ouvert${k>1?"s":""} standard ajouté${k>1?"s":""} au projet.`);
  }
  // ---------- Demandes client ----------
  const REQ=[["new","Nouvelle"],["analysis","En analyse"],["doing","En cours"],["waiting","En attente client"],["done","Traitée"],["refused","Refusée"]];
  const REQL=Object.fromEntries(REQ);
  const QUOTE={"":"Pas de devis",todo:"Devis à faire",sent:"Devis envoyé",accepted:"Devis accepté",refused:"Devis refusé"};
  const SCOPE={"":"Périmètre non évalué","in":"Dans le périmètre","out":"Hors périmètre"};
  const liveReq=()=>(state.requests||[]).filter(r=>!r.deletedAt);
  const reqOpen=r=>r.status!=="done"&&r.status!=="refused";
  const reqLate=r=>reqOpen(r)&&r.due&&parseD(r.due)<today();
  const reqOf=t=>t&&t.requestId?liveReq().find(r=>r.id===t.requestId)||null:null;
  const reqTasks=r=>live().filter(t=>t.requestId===r.id);
  const fmtJ=n=>n==null||n===""?"":`${String(n).replace(".",",")} j`;
  let editingReq=null;
  function setReqStatus(r,st){
    if(!r||r.status===st)return;
    r.status=st;
    r.closedAt=st==="done"||st==="refused"?(r.closedAt||Date.now()):null;
  }
  // Annulation pour les demandes (même principe que pour les tâches)
  function reqUndoable(msg,r,fn){
    const copy=JSON.parse(JSON.stringify(r));
    fn();save();render();
    toast(msg,()=>{const i=state.requests.findIndex(x=>x.id===copy.id);if(i>=0)state.requests[i]=copy;else state.requests.push(copy);save();render()});
  }
  async function deleteRequest(r){
    if(editingReq===r.id)editingReq=null;
    const ts=reqTasks(r);
    let withT=false;
    if(ts.length){
      const list=ts.slice(0,5).map(t=>`• ${t.title}`).join("\n")+(ts.length>5?`\n• … et ${ts.length-5} autre(s)`:"");
      const ch=await uiDialog({title:"Supprimer la demande",msg:`Cette demande a ${ts.length>1?`${ts.length} tâches liées`:"une tâche liée"} :\n${list}`,buttons:[{v:null,label:"Annuler",cls:"ghost"},{v:"keep",label:`Garder ${ts.length>1?"les tâches":"la tâche"}`},{v:"all",label:`Supprimer aussi ${ts.length>1?"les tâches":"la tâche"}`,cls:"danger",focus:true}]});
      if(ch==null)return;
      withT=ch==="all";
    }
    const copies=[r,...(withT?ts:[])].map(x=>JSON.parse(JSON.stringify(x)));
    const at=Date.now();
    r.deletedAt=at;if(withT)ts.forEach(t=>{t.deletedAt=at;if(editing===t.id)editing=null});
    save();render();
    toast(`Demande « ${short(r.title)} »${withT?` et ${ts.length>1?`ses ${ts.length} tâches`:"sa tâche"}`:""} mise${withT?"s":""} à la corbeille`,()=>{
      copies.forEach(c=>{const arr=c.id===r.id?state.requests:state.tasks;const i=arr.findIndex(x=>x.id===c.id);if(i>=0){if(arr[i].history)c.history=arr[i].history;arr[i]=c}else arr.push(c)});
      save();render();
    });
  }
  function addRequest(f,pid){
    const title=f.querySelector("[data-q=title]").value.trim();
    if(!title){f.querySelector("[data-q=title]").focus();return}
    pid=pid||f.querySelector("[data-q=proj]").value;
    if(!pid){uiAlert("Créez d'abord un projet.");return}
    const id=MODE==="cloud"&&crypto.randomUUID?crypto.randomUUID():uid();
    state.requests.push({id,projectId:pid,title,description:"",requester:f.querySelector("[data-q=who]").value.trim(),received:iso(today()),due:f.querySelector("[data-q=due]").value||"",priority:f.querySelector("[data-q=prio]").value,status:"new",scope:"",estimate:null,quote:"",createdAt:Date.now(),closedAt:null});
    save();render();
    const ni=document.querySelector("#reqadd [data-q=title]");if(ni)ni.focus();
  }
  function taskFromRequest(r){
    const id=MODE==="cloud"&&crypto.randomUUID?crypto.randomUUID():uid();
    const t={id,projectId:r.projectId,title:r.title,priority:r.priority||"normale",due:r.due||"",status:"todo",note:r.requester?`Demande de ${r.requester}`:"",who:"",createdAt:Date.now(),checklist:[],repeat:null,requestId:r.id};
    state.tasks.push(t);
    if(r.status==="new"||r.status==="analysis")setReqStatus(r,"doing");
    save();render();
    toast(`Tâche créée et liée à la demande « ${short(r.title)} »`,()=>{const cur=state.tasks.find(x=>x.id===id);if(cur){editing=id;openInList(cur)}},"Ouvrir la tâche");
  }
  function openRequest(r){
    query="";$("#search").value="";
    if(!r)return;
    view="all";ui.mode="requests";saveUi();editingReq=r.id;editing=null;render();
    const el=document.querySelector(`.req[data-r="${r.id}"]`);if(el)el.scrollIntoView({block:"center"});
  }
  function reqRow(r,showProj){
    const li=document.createElement("li");
    li.className=`task req${reqOpen(r)?"":" done"}${editingReq===r.id?" open":""}`;li.dataset.r=r.id;
    const p=proj(r.projectId), ts=reqTasks(r), tDone=ts.filter(t=>t.status==="done").length;
    const tags=[];
    if(showProj&&p)tags.push(`<span class="tag"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>`);
    if(r.requester)tags.push(`<span class="tag who">${hl(r.requester)}</span>`);
    if(r.received)tags.push(`<span class="tag" title="Date de réception">Reçue ${shortDay(r.received).toLowerCase()}</span>`);
    if(r.due&&reqOpen(r))tags.push(`<span class="tag${reqLate(r)?" late":parseD(r.due).getTime()===today().getTime()?" today":""}" title="Réponse attendue">${reqLate(r)?"Réponse en retard · ":"Réponse "}${shortDay(r.due).toLowerCase()}</span>`);
    if(r.priority==="haute")tags.push(`<span class="tag hi">Priorité haute</span>`);
    if(r.priority==="basse")tags.push(`<span class="tag">Priorité basse</span>`);
    if(r.scope==="out")tags.push(`<span class="tag scope-out">Hors périmètre</span>`);
    if(r.scope==="in")tags.push(`<span class="tag">Dans le périmètre</span>`);
    if(r.estimate!=null&&r.estimate!=="")tags.push(`<span class="tag" title="Estimation">${fmtJ(r.estimate)}</span>`);
    if(r.quote)tags.push(`<span class="tag quote-${r.quote}">${QUOTE[r.quote]}</span>`);
    if(ts.length)tags.push(`<span class="tag" title="Tâches liées">Tâches liées : ${tDone}/${ts.length} terminée${tDone>1?"s":""}</span>`);
    const st=r.status||"new";
    li.innerHTML=`<span class="rdot rs-${st}" aria-hidden="true"></span>
      <div><div class="ttl">${hl(r.title)}</div>${tags.length?`<div class="meta">${tags.join("")}</div>`:""}
      ${r.description&&editingReq!==r.id?`<div class="note">${hl(r.description)}</div>`:""}
      ${ts.length&&editingReq!==r.id?`<ul class="steps rtasks">${ts.sort((a,b)=>(a.status==="done")-(b.status==="done")||sortOpen(a,b)).map(t=>`<li class="${t.status==="done"?"ok":""}"><input type="checkbox" ${t.status==="done"?"checked":""} data-t="${esc(t.id)}" aria-label="Tâche terminée : ${esc(t.title)}"><span><a href="#" data-o="${esc(t.id)}">${esc(t.title)}</a>${t.status!=="done"&&t.due?` <span class="mut">· ${shortDay(t.due).toLowerCase()}</span>`:""}${t.status==="doing"?` <span class="mut">· en cours</span>`:t.status==="waiting"?` <span class="mut">· en attente</span>`:""}</span></li>`).join("")}</ul>`:""}</div>
      <div class="acts">
        <select class="rsel" aria-label="Statut de la demande">${REQ.map(([k,l])=>`<option value="${k}" ${k===st?"selected":""}>${l}</option>`).join("")}</select>
        <details class="more"><summary aria-label="Plus d'actions">${ICON_MORE}</summary>
          <div class="menu"><button type="button" data-a="edit">${editingReq===r.id?"Fermer le détail":"Modifier"}</button><button type="button" data-a="task">Créer une tâche liée à cette demande</button><button type="button" data-a="del" class="danger">Mettre à la corbeille</button></div>
        </details>
      </div>`;
    li.querySelector(".ttl").onclick=()=>{editingReq=editingReq===r.id?null:r.id;render()};
    li.querySelector(".rsel").onchange=e=>{const v=e.target.value;reqUndoable(`Demande « ${short(r.title)} » : ${REQL[v].toLowerCase()}`,r,()=>setReqStatus(r,v))};
    li.querySelectorAll("[data-t]").forEach(cb=>cb.onchange=()=>{const t=state.tasks.find(x=>x.id===cb.dataset.t);if(t)toggle(t)});
    li.querySelectorAll("[data-o]").forEach(a=>a.onclick=e=>{e.preventDefault();const t=state.tasks.find(x=>x.id===a.dataset.o);if(t){editing=t.id;openInList(t)}});
    li.querySelectorAll("[data-a]").forEach(b=>b.onclick=()=>{
      const a=b.dataset.a;
      if(a==="edit"){editingReq=editingReq===r.id?null:r.id;render()}
      if(a==="task")taskFromRequest(r);
      if(a==="del")deleteRequest(r);
    });
    if(editingReq===r.id){
      const f=document.createElement("div");f.className="edit";
      const projs=state.projects.filter(x=>!x.archived||x.id===r.projectId);
      f.innerHTML=`<label class="full flbl">Objet<input type="text" data-f="title" value="${esc(r.title)}" maxlength="300"></label>
        <label class="flbl">Projet<select data-f="proj">${projs.map(x=>`<option value="${x.id}" ${x.id===r.projectId?"selected":""}>${esc(x.name)}</option>`).join("")}</select></label>
        <label class="flbl">Demandeur (client)<input type="text" data-f="who" value="${esc(r.requester||"")}" maxlength="120"></label>
        <label class="flbl">Reçue le<input type="date" data-f="rec" value="${esc(r.received||"")}"></label>
        <label class="flbl">Réponse attendue le<input type="date" data-f="due" value="${esc(r.due||"")}"></label>
        <label class="flbl">Priorité<select data-f="prio">${["haute","normale","basse"].map(v=>`<option value="${v}" ${v===(r.priority||"normale")?"selected":""}>Priorité ${v}</option>`).join("")}</select></label>
        <label class="flbl">Statut<select data-f="st">${REQ.map(([k,l])=>`<option value="${k}" ${k===st?"selected":""}>${l}</option>`).join("")}</select></label>
        <label class="flbl">Périmètre<select data-f="scope">${Object.entries(SCOPE).map(([k,l])=>`<option value="${k}" ${k===(r.scope||"")?"selected":""}>${l}</option>`).join("")}</select></label>
        <label class="flbl">Estimation (jours)<input type="text" inputmode="decimal" data-f="est" value="${r.estimate==null?"":esc(String(r.estimate).replace(".",","))}" placeholder="ex. 2,5" maxlength="8"></label>
        <label class="flbl">Devis<select data-f="quote">${Object.entries(QUOTE).map(([k,l])=>`<option value="${k}" ${k===(r.quote||"")?"selected":""}>${l}</option>`).join("")}</select></label>
        <label class="full flbl">Description<textarea data-rt data-f="desc" aria-label="Description" placeholder="Contexte, besoin exprimé, contraintes, référence du mail…">${escRaw(r.description||"")}</textarea></label>
        <div class="full"><button class="btn primary" type="button" data-k="ok">Enregistrer</button> <button class="btn ghost" type="button" data-k="ko">Annuler</button></div>`;
      const g=k=>f.querySelector(`[data-f=${k}]`);
      f.querySelector("[data-k=ok]").onclick=()=>{
        const cur=state.requests.find(x=>x.id===r.id);
        if(!cur){editingReq=null;render();uiAlert("Cette demande a été supprimée entre-temps (peut-être par un collègue).");return}
        if(g("title").value.trim())cur.title=g("title").value.trim();
        const np=g("proj").value;
        if(np!==cur.projectId){live().forEach(t=>{if(t.requestId===cur.id&&t.projectId===cur.projectId)t.requestId=null});cur.projectId=np}
        cur.requester=g("who").value.trim();cur.received=g("rec").value;cur.due=g("due").value;cur.priority=g("prio").value;
        setReqStatus(cur,g("st").value);cur.scope=g("scope").value;
        const e=g("est").value.trim().replace(",",".");cur.estimate=e===""||isNaN(+e)?null:Math.max(0,+e);
        cur.quote=g("quote").value;cur.description=g("desc").value.trim();
        editingReq=null;save();render();
      };
      f.querySelector("[data-k=ko]").onclick=()=>{editingReq=null;render()};
      drawerize(f,`<span class="dot" style="background:${p?p.color:"#999"}"></span>${esc(p?p.name:"")} · Demande client`,r.title,()=>{editingReq=null;render()});
      li.appendChild(f);
      setTimeout(()=>g("title").focus(),0);
    }
    return li;
  }
  function renderRequests(L,p){
    const all=liveReq().filter(r=>p?r.projectId===p.id:!isArch(r.projectId));
    const qprojs=state.projects.filter(x=>!x.archived||(p&&x.id===p.id));
    const add=document.createElement("form");add.className="quick";add.id="reqadd";add.autocomplete="off";
    add.innerHTML=`<label class="qmain"><span class="qkind qk-req">Demande client</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="color:var(--muted)"><path d="M12 5v14M5 12h14"></path></svg><input type="text" data-q="title" placeholder="Nouvelle demande client…" aria-label="Objet de la demande" maxlength="300"></label>
      ${p?"":`<select data-q="proj" aria-label="Projet">${qprojs.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select>`}
      <input type="text" data-q="who" placeholder="Demandeur" aria-label="Demandeur côté client" class="qw">
      <input type="date" data-q="due" aria-label="Réponse attendue le" title="Réponse attendue le">
      <select data-q="prio" aria-label="Priorité"><option value="normale">Priorité normale</option><option value="haute">Priorité haute</option><option value="basse">Priorité basse</option></select>
      <button class="qadd" type="submit">Ajouter</button>`;
    add.onsubmit=e=>{e.preventDefault();addRequest(add,p&&p.id)};
    $("#addslot").appendChild(add);
    const open=all.filter(reqOpen), closed=all.filter(r=>!reqOpen(r)).sort((a,b)=>(b.closedAt||0)-(a.closedAt||0));
    const sortR=(a,b)=>(reqLate(b)-reqLate(a))||((a.due||"9999")<(b.due||"9999")?-1:(a.due||"9999")>(b.due||"9999")?1:0)||(prioRank[a.priority]??1)-(prioRank[b.priority]??1)||(a.createdAt||0)-(b.createdAt||0);
    if(!all.length){L.insertAdjacentHTML("beforeend",`<div class="empty">Aucune demande client${p?" sur ce projet":""}. Saisissez la première dans la barre ci-dessus : objet, demandeur et date de réponse attendue. Le reste (périmètre, estimation, devis) se complète dans le détail.</div>`);return}
    if(!open.length)L.insertAdjacentHTML("beforeend",`<div class="empty">Toutes les demandes sont traitées.</div>`);
    REQ.slice(0,4).forEach(([k,l])=>{
      const items=open.filter(r=>(r.status||"new")===k).sort(sortR);
      if(!items.length)return;
      const g=document.createElement("section");g.className="group g-req";
      g.innerHTML=`<h2><span class="rdot rs-${k}" aria-hidden="true"></span>${l} <span>${items.length}</span></h2>`;
      const ul=document.createElement("ul");ul.className="tasks";items.forEach(r=>ul.appendChild(reqRow(r,!p)));g.appendChild(ul);L.appendChild(g);
    });
    if(closed.length){
      const btn=document.createElement("button");btn.type="button";btn.className="showdone";btn.setAttribute("aria-expanded",!!ui.showClosedReq);
      btn.innerHTML=`${ICON_CHEV}${ui.showClosedReq?"Masquer":"Afficher"} ${closed.length>1?`les ${closed.length} demandes traitées ou refusées`:"la demande traitée ou refusée"}`;
      btn.onclick=()=>{ui.showClosedReq=!ui.showClosedReq;saveUi();render()};
      L.appendChild(btn);
      if(ui.showClosedReq){const g=document.createElement("section");g.className="group g-req";g.innerHTML=`<h2>Traitées et refusées <span>${closed.length}</span></h2>`;const ul=document.createElement("ul");ul.className="tasks";closed.forEach(r=>ul.appendChild(reqRow(r,!p)));g.appendChild(ul);L.appendChild(g)}
    }
  }
  // ---------- Récap de la semaine ----------
  function buildRecap(offset){
    const ws=addDays(mondayOf(new Date()),7*offset), we=addDays(ws,6), wsI=iso(ws), weI=iso(we);
    const nS=iso(addDays(ws,7)), nE=iso(addDays(ws,13)), t0=iso(today());
    const p=view==="all"?null:proj(view);
    const projs=p?[p]:state.projects.filter(x=>!x.archived);
    const line=(t,extra)=>`- ${t.title}${extra?` (${extra})`:""}${t.who?` [${whoName(t)}]`:""}`;
    const range=`${ws.toLocaleDateString("fr-FR",{day:"numeric",month:"long"})} au ${we.toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}`;
    const out=[`Récapitulatif – semaine ${isoWeek(ws)} (du ${range})`,""];
    let any=false;
    projs.forEach(pr=>{
      const ts=live().filter(t=>t.projectId===pr.id);
      const dl=ms=>{const d=new Date(ms);return iso(d)};
      const sec=[
        ["Terminé",ts.filter(t=>t.status==="done"&&t.doneAt&&dl(t.doneAt)>=wsI&&dl(t.doneAt)<=weI).map(t=>line(t,""))],
        ["En cours",ts.filter(t=>t.status==="doing").sort(sortOpen).map(t=>line(t,t.due?"échéance "+shortDay(t.due).toLowerCase():""))],
        ["En attente",ts.filter(t=>t.status==="waiting").sort(sortOpen).map(t=>line(t,[t.waitingFor&&"attente : "+t.waitingFor,t.due&&"relance "+shortDay(t.due).toLowerCase()].filter(Boolean).join(", ")))],
        ["En retard",ts.filter(t=>t.status==="todo"&&t.due&&t.due<t0&&(offset===0||t.due<=weI)).sort(sortOpen).map(t=>line(t,"prévu le "+shortDay(t.due).toLowerCase()))],
        [offset===0?"Reste à faire cette semaine":"Prévu cette semaine, non terminé",ts.filter(t=>t.status==="todo"&&t.due&&t.due>=(offset===0?t0:wsI)&&t.due<=weI).sort(sortOpen).map(t=>line(t,shortDay(t.due).toLowerCase()))],
        ["Semaine suivante",ts.filter(t=>t.status!=="done"&&t.due&&t.due>=nS&&t.due<=nE&&t.status!=="doing").sort(sortOpen).map(t=>line(t,shortDay(t.due).toLowerCase()))]
      ];
      // points ouverts et demandes client de la semaine
      const inW=ms=>ms&&dl(ms)>=wsI&&dl(ms)<=weI;
      const cut=(x,n)=>{x=rtText(String(x||"")).replace(/\s+/g," ").trim();return x.length>n?x.slice(0,n-1)+"…":x};
      const pts=livePts().filter(o=>o.projectId===pr.id);
      const ptsOpen=pts.filter(o=>o.status!=="closed").length;
      sec.push(["Points ouverts levés",pts.filter(o=>o.status==="closed"&&inW(o.closedAt)).sort((a,b)=>a.closedAt-b.closedAt).map(o=>`- ${cut(o.text,140)}${o.answer?` – réponse : ${cut(o.answer,160)}`:""}`)]);
      const ptsNew=pts.filter(o=>inW(o.createdAt)).length;
      if(ptsOpen||ptsNew)sec.push(["Points ouverts",[`- ${ptsOpen} encore ouvert${ptsOpen>1?"s":""}${ptsNew?`, dont ${ptsNew} ajouté${ptsNew>1?"s":""} cette semaine`:""}`]]);
      const rqs=liveReq().filter(r=>r.projectId===pr.id);
      sec.push(["Demandes client reçues",rqs.filter(r=>r.received&&r.received>=wsI&&r.received<=weI).map(r=>`- ${r.title}${r.requester?` (${r.requester})`:""} – ${REQL[r.status].toLowerCase()}`)]);
      sec.push(["Demandes client traitées ou refusées",rqs.filter(r=>!reqOpen(r)&&inW(r.closedAt)).map(r=>`- ${r.title} – ${REQL[r.status].toLowerCase()}`)]);
      sec.push(["Demandes client en cours",rqs.filter(r=>reqOpen(r)&&!(r.received&&r.received>=wsI&&r.received<=weI)).sort((a,b)=>(a.due||"9999")<(b.due||"9999")?-1:1).map(r=>`- ${r.title} – ${REQL[r.status].toLowerCase()}${r.due?`, réponse attendue ${shortDay(r.due).toLowerCase()}`:""}`)]);
      const secF=sec.filter(([,l])=>l.length);
      if(!secF.length)return;
      sec.length=0;sec.push(...secF);
      if(!sec.length)return;
      any=true;
      out.push(pr.name.toUpperCase());
      sec.forEach(([h,l])=>{out.push(h+" :",...l)});
      out.push("");
    });
    if(!any)out.push("Aucune activité ni échéance sur cette période.");
    return {text:out.join("\n").trim()+"\n",title:`Récap semaine ${isoWeek(ws)}`,scope:p?`Projet : ${p.name}`:`Tous les projets (${projs.length})`};
  }
  function openRecap(){
    const dlg=$("#recap");
    const fill=()=>{const r=buildRecap(+$("#recapweek").value);$("#recaptext").value=r.text;$("#recaptitle").textContent=r.title;$("#recapscope").textContent=r.scope+" · le texte est modifiable après copie, dans votre mail ou votre document.";dlg.dataset.title=r.title};
    $("#recapweek").value="0";fill();
    $("#recapweek").onchange=fill;
    $("#recapcopy").onclick=async()=>{const t=$("#recaptext").value;try{await navigator.clipboard.writeText(t);$("#recapcopy").textContent="Copié";setTimeout(()=>$("#recapcopy").textContent="Copier",1500)}catch(e){$("#recaptext").select();document.execCommand&&document.execCommand("copy")}};
    $("#recapmail").onclick=()=>{location.href=`mailto:?subject=${encodeURIComponent(dlg.dataset.title)}&body=${encodeURIComponent($("#recaptext").value)}`};
    $("#recapdl").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([$("#recaptext").value],{type:"text/plain;charset=utf-8"}));a.download=dlg.dataset.title.replace(/\s+/g,"-").toLowerCase()+".txt";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
    if(dlg.showModal)dlg.showModal();else dlg.setAttribute("open","");
  }
  // ---------- Téléphone : menu épuré (☰) et page « Compte et sauvegarde » ----------
  // Les lignes du menu déclenchent les boutons existants (vues, compte, fichier) : mêmes actions qu'avant.
  const MMI={
    agenda:"M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v14H3zM3 10h18M8 3v4M16 3v4",
    all:"M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
    req:"M4 4h16v12H8l-4 4z",
    dash:"M4 20V10M10 20V4M16 20v-7M22 20H2",
    trash:"M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    acct:"M12 4v11M7 10l5 5 5-5M5 20h14",
    shield:"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
    user:"M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    key:"M15 7a4 4 0 1 1-3.5 6H9v2H7v2H4v-3l6.5-6.5A4 4 0 0 1 15 7zM16 9h.01",
    save:"M12 4v11M7 10l5 5 5-5M5 20h14",
    restore:"M12 20V9M7 14l5-5 5 5M5 4h14",
    merge:"M6 4v6a6 6 0 0 0 6 6h6M15 13l3 3-3 3M6 4h.01",
    file:"M6 3h8l4 4v14H6zM14 3v4h4",
    link:"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    device:"M4 5h16v11H4zM8 20h8M12 16v4",
    cloud:"M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z",
    out:"M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
    install:"M12 3v12M7 10l5 5 5-5M4 21h16",
    x:"M6 6l12 12M18 6L6 18",
    chev:"M9 5l7 7-7 7",
    back:"M15 5l-7 7 7 7"
  };
  const mmSvg=(d,s)=>`<svg width="${s||18}" height="${s||18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  var mmPage=null;
  function mmRow(k,ic,label,o){o=o||{};
    return `<button type="button" class="mmrow${o.danger?" danger":""}" data-mm="${k}"><span class="mmic mmc-${o.c||"n"}">${mmSvg(MMI[ic])}</span><span class="mmt"><span>${esc(label)}</span>${o.sub?`<small>${esc(o.sub)}</small>`:""}</span>${o.n!=null&&o.n!==""?`<span class="mmn">${esc(String(o.n))}</span>`:""}${o.chev===false?"":`<span class="mmch">${mmSvg(MMI.chev,16)}</span>`}</button>`;
  }
  const mmGroup=(t,rows)=>rows.length?`<section class="mmg">${t?`<h3>${esc(t)}</h3>`:""}<div class="mmlist">${rows.join("")}</div></section>`:"";
  function mmWho(){
    const cl=MODE==="cloud"&&cloud.email, nm=cl?nameOf(cloud.email):"Mode local (sans compte)";
    const st=$("#sync")?$("#sync").textContent.trim():"";
    const off=$("#sync")&&$("#sync").classList.contains("off");
    return {cl,nm,ini:cl?initialsOf(nm):"",st:st||(cl?"Compte en ligne":"Enregistré sur cet appareil"),off};
  }
  function mmRender(){
    const o=$("#mmenu");if(!o)return;
    const w=mmWho(), vbtn=l=>[...document.querySelectorAll("#views .vbtn")].find(b=>b.querySelector("span")&&b.querySelector("span").textContent===l);
    const cnt=l=>{const b=vbtn(l);return b?b.querySelector(".n").textContent:""};
    const card=`<div class="mmcard"><span class="mmav${w.cl?"":" loc"}">${w.cl?esc(w.ini):mmSvg(MMI.device,22)}</span><span class="mmct"><b>${esc(w.nm)}</b><span class="mmst${w.off?" off":""}"><i></i>${esc(w.st)}</span></span></div>`;
    if(mmPage==="acct"){
      const vis=id=>{const e=$(id);return e&&!e.hidden};
      let groups;
      if(w.cl)groups=mmGroup("Profil",[mmRow("a:name","user","Modifier mon nom"),mmRow("a:pwd","key","Changer le mot de passe")])
        +mmGroup("Connexions",[mmRow("a:conf","link","Confluence",{sub:"Comptes rendus de mise en service en direct"})])
        +mmGroup("Copie de secours",[mmRow("a:exp","save","Sauvegarder une copie",{sub:"Fichier .json de toutes vos données",chev:false}),mmRow("a:imp","restore","Restaurer ou importer",{sub:"Depuis un fichier .json",chev:false})])
        +mmGroup("",[mmRow("a:loc","device","Passer en mode local",{sub:"Sans compte, sur ce téléphone"}),mmRow("a:out","out","Se déconnecter",{danger:true,c:"late",chev:false})]);
      else groups=mmGroup("Fichier de données",[...(vis("#fnew")?[mmRow("#fnew","file","Créer un fichier",{chev:false})]:[]),...(vis("#fopen")?[mmRow("#fopen","file","Ouvrir un fichier",{chev:false})]:[]),...(vis("#frelink")?[mmRow("#frelink","link",$("#frelink").textContent.trim()||"Relier le fichier",{chev:false})]:[]),...(vis("#funlink")?[mmRow("#funlink","x","Délier le fichier",{chev:false})]:[])])
        +mmGroup("Copie de secours",[mmRow("#exp","save","Sauvegarder une copie",{sub:"Fichier .json de toutes vos données",chev:false}),mmRow("#imp","restore","Importer",{sub:"Depuis un fichier .json",chev:false}),mmRow("#mrg","merge","Fusionner un fichier",{sub:"Ajoute sans rien effacer",chev:false})])
        +mmGroup("",[mmRow("#tocloud","cloud","Passer en mode en ligne",{sub:"Compte partagé avec vos collègues"})]);
      const fi=!w.cl&&$("#fileinfo")?$("#fileinfo").textContent.trim():"";
      o.innerHTML=`<header class="mmtop"><button type="button" class="mmback" data-mmback aria-label="Retour au menu">${mmSvg(MMI.back,22)}</button><h2>Compte et sauvegarde</h2></header>
        <div class="mmbody"><div class="mmhero"><span class="mmav lg${w.cl?"":" loc"}">${w.cl?esc(w.ini):mmSvg(MMI.device,28)}</span><b>${esc(w.nm)}</b>${w.cl?`<span class="mmmail">${esc(cloud.email)}</span>`:fi?`<span class="mmmail">${esc(fi)}</span>`:""}<span class="mmst pill${w.off?" off":""}"><i></i>${esc(w.st)}</span></div>${groups}</div>`;
    }else{
      const inst=$("#installbtn")&&!$("#installbtn").hidden;
      o.innerHTML=`<header class="mmtop"><h2>Menu</h2><button type="button" class="mmclose" data-mmclose aria-label="Fermer le menu">${mmSvg(MMI.x,20)}</button></header>
        <div class="mmbody">${card}
        ${mmGroup("Vues",[mmRow("v:Agenda de la semaine","agenda","Agenda de la semaine",{n:cnt("Agenda de la semaine"),c:"wait"}),mmRow("v:Tâches","all","Tâches",{n:cnt("Tâches")}),mmRow("v:Tableau de bord","dash","Tableau de bord",{c:"ok"}),mmRow("v:Corbeille","trash","Corbeille",{n:cnt("Corbeille"),c:"mut"})])}
        ${mmGroup("Réglages",[mmRow("p:acct","acct","Compte et sauvegarde",{sub:w.cl?"Copie de secours, mot de passe":"Fichier, copie de secours, mode en ligne"}),mmRow("#privacybtn","shield","Données et confidentialité"),...(inst?[mmRow("#installbtn","install","Installer l'application",{chev:false})]:[])])}</div>`;
    }
    const cl=o.querySelector("[data-mmclose]");if(cl)cl.onclick=mmClose;
    const bk=o.querySelector("[data-mmback]");if(bk)bk.onclick=()=>{mmPage="main";mmRender()};
    o.querySelectorAll("[data-mm]").forEach(b=>b.onclick=()=>{
      const k=b.dataset.mm;
      if(k==="p:acct"){mmPage="acct";mmRender();o.scrollTop=0;return}
      if(k.startsWith("v:")){const v=vbtn(k.slice(2));mmClose();if(v)v.click();return}
      if(k.startsWith("a:")){const t=$(`#acc [data-a="${k.slice(2)}"]`);if(k==="a:out"||k==="a:loc"||k==="a:conf")mmClose();if(t)t.click();return}
      const t=$(k);if(t){if(k==="#tocloud"||k==="#privacybtn")mmClose();t.click()}
    });
  }
  function mmOpen(page){
    let o=$("#mmenu");
    if(!o){o=document.createElement("div");o.id="mmenu";o.className="mmenu";o.setAttribute("role","dialog");o.setAttribute("aria-modal","true");o.setAttribute("aria-label","Menu");document.body.appendChild(o)}
    mmPage=page||"main";mmRender();document.body.classList.add("mmopen");$("#menubtn").setAttribute("aria-expanded","true");navSync();
    const f=o.querySelector("button");if(f)try{f.focus({preventScroll:true})}catch(e){}
  }
  function mmClose(){const o=$("#mmenu");if(o)o.remove();mmPage=null;document.body.classList.remove("mmopen");const b=$("#menubtn");if(b)b.setAttribute("aria-expanded","false")}
  function closeMenu(){mmClose();const s=$("#side");if(s){s.classList.remove("open");$("#menubtn").setAttribute("aria-expanded","false")}}

  // ---------- Init ----------
  $("#privacybtn").onclick=openPrivacy;
  // Téléphone : la recherche s'ouvre avec la loupe de l'en-tête
  $("#srchbtn").onclick=()=>{const sd=$("#side"),on=!sd.classList.contains("srch");sd.classList.toggle("srch",on);$("#srchbtn").setAttribute("aria-expanded",on);if(on)setTimeout(()=>$("#search").focus(),30);else{if($("#search").value){$("#search").value="";$("#search").dispatchEvent(new Event("input"))}}};
  $("#addp").onsubmit=e=>{e.preventDefault();addProject($("#newp").value);$("#newp").value=""};
  $("#quick").onsubmit=e=>{e.preventDefault();addTask()};
  $("#qt").addEventListener("input",qPreview);["#qd","#qw","#qprio"].forEach(k=>$(k).addEventListener("input",qPreview));
  $("#qt").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addTask()}});
  $("#gcloud").onclick=()=>{if(cloudReady())startCloud()};
  $("#glocal").onclick=()=>{try{localStorage.setItem("todo-mode","local")}catch(e){}$("#gate").hidden=true;startLocal()};
  $("#lback").onclick=()=>showGate("choice");
  $("#glogin").onsubmit=login;
  document.addEventListener("click",e=>{if(!document.contains(e.target))return;document.querySelectorAll("details.more[open],details.pfilter[open]").forEach(d=>{if(!d.contains(e.target)){d.open=false;if(d.classList.contains("pfilter"))pfOpen=false}})});
  document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&(e.key==="k"||e.key==="K")){e.preventDefault();if(document.querySelector("dialog.cmdk[open]"))return;cmdOpen()}});
  let searchT=null;
  $("#search").addEventListener("input",e=>{clearTimeout(searchT);searchT=setTimeout(()=>{query=e.target.value;editing=null;render()},150)});
  $("#search").addEventListener("keydown",e=>{
    if(e.key==="Escape"){e.target.value="";query="";render()}
    // commande cachée : « /excel » + Entrée dans la recherche, projet ouvert (propriétaire uniquement)
    if(e.key==="Enter"&&e.target.value.trim().toLowerCase()==="/excel"){
      e.preventDefault();e.target.value="";query="";
      const p=proj(view);
      if(!p||(MODE==="cloud"&&!isOwner(p.id))){render();return}
      render();xlCfg(p);
    }
  });
  $("#calsave").onclick=saveCalCfg;
  $("#profform").onsubmit=submitProfile;
  $("#pclose").onclick=()=>$("#profdlg").close&&$("#profdlg").close();
  $("#calremove").onclick=removeCal;
  $("#calurl").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();saveCalCfg()}});
  $("#menubtn").onclick=()=>{if(isPhone()){if($("#mmenu"))mmClose();else mmOpen();return}const o=$("#side").classList.toggle("open");$("#menubtn").setAttribute("aria-expanded",o)};
  // Mobile : la barre d'ajout est repliée ; le bouton + l'ouvre (et la referme)
  $("#fab").onclick=()=>{
    if(ui.mode==="home"&&view!=="all"&&proj(view)){phoneAdd(proj(view));return}
    // écran Projets : le + crée un nouveau projet
    if(ui.mode==="projects"&&view==="all"&&!query.trim()){document.body.classList.remove("addopen");(async()=>{const n=await uiPrompt("Nom du nouveau projet","",{ok:"Créer"});if(n&&n.trim())addProject(n)})();return}
    const open=!document.body.classList.contains("addopen");
    document.body.classList.toggle("addopen",open);
    $("#fab").setAttribute("aria-expanded",open);$("#fab").setAttribute("aria-label",open?"Fermer la saisie":"Ajouter");
    if(!open)return;
    window.scrollTo({top:0,behavior:"smooth"});
    setTimeout(()=>{const q=$("#quick");const el=q&&!q.hidden?$("#qt"):document.querySelector("#addslot input[type=text]");if(el)el.focus()},250);
  };
  $("#gsignup").onsubmit=signup;
  $("#tosignup").onclick=e=>{e.preventDefault();showGate("signup")};
  $("#gsignupbtn").onclick=()=>{if(cloudReady())showGate("signup")};
  $("#sback").onclick=()=>showGate("login");
  $("#lforgot").onclick=()=>showGate("forgot");
  $("#fback").onclick=()=>showGate("login");
  $("#gforgot").onsubmit=forgot;
  $("#greset").onsubmit=resetPass;
  $("#tocloud").onclick=toCloud;
  // En-tête figé : version compacte quand on a défilé
  (()=>{const st=$("#stickytop");const f=()=>{const top=st.getBoundingClientRect().top;st.classList.toggle("compact",window.scrollY>0&&top<=0.5)};window.addEventListener("scroll",f,{passive:true});window.addEventListener("resize",f);f()})();
  window.addEventListener("online",()=>{if(MODE==="cloud"){cloud.flush();cloud.fetch()}});
  window.addEventListener("focus",()=>{if(MODE==="cloud")cloud.schedule()});
  // filet de sécurité : rechargement complet toutes les 5 minutes (le temps réel fait le reste)
  setInterval(()=>{if(MODE==="cloud"&&!document.hidden)cloud.fetch()},300000);

  function startLocal(){
    MODE="local";$("#localbox").hidden=false;$("#acc").hidden=true;$("#share").hidden=true;
    $("#whoami").textContent="Mode local (sans compte)";$("#toolstitle .tsl").textContent="Fichier et sauvegarde";
    const cached=lsLoad();
    if(cached){state=normalize(cached);resetSnap()}
    else{state={projects:[],tasks:[],requests:[],points:[],deleted:[]};resetSnap()}
    $("#exp").onclick=exportData;
    $("#imp").onclick=()=>$("#impf").click();
    $("#impf").onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);e.target.value=""};
    $("#mrg").onclick=()=>$("#mrgf").click();
    $("#mrgf").onchange=e=>{if(e.target.files[0])mergeData(e.target.files[0]);e.target.value=""};
    $("#fnew").onclick=createFile;
    $("#fopen").onclick=openFile;
    $("#frelink").onclick=relink;
    $("#funlink").onclick=unlink;
    render(); showFile(); if(cached)setSync("Données chargées depuis ce navigateur");
    purgeTrash();
    (async()=>{
      if(!FSA)return;
      const h=await loadHandle(); if(!h)return;
      fileHandle=h;
      try{
        if((await h.queryPermission({mode:"readwrite"}))==="granted"){await linkHandle(h,"resume");return}
      }catch(e){}
      fileOk=false; showFile();
    })();
  }

  // ---------- Cloche de notifications : réponses du client (Excel), retards, échéances ----------
  // Les réponses du client restent comptées tant qu'elles ne sont pas lues ; les retards et échéances
  // ne sont comptés qu'une fois (vus à l'ouverture du panneau), pour ne pas laisser une pastille permanente.
  const BELL_SVG=`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>`;
  const NOTIF_DAYS=2; // échéances : aujourd'hui et les 2 jours suivants
  function notifData(){
    const act=pid=>{const p=proj(pid);return !!p&&!p.archived};
    const mine=t=>MODE!=="cloud"||!(t.who||"").trim()||isMyTask(t);
    const byDue=(a,b)=>a.due<b.due?-1:a.due>b.due?1:0;
    const ans=livePts().filter(o=>o.ansNew&&act(o.projectId)).sort((a,b)=>b.ansNew-a.ansNew).map(o=>({k:"a:"+o.id+":"+o.ansNew,kind:"ans",o}));
    const ts=live().filter(t=>t.status!=="done"&&t.due&&act(t.projectId)&&mine(t));
    const late=ts.filter(isLate).sort(byDue).map(t=>({k:"l:"+t.id+":"+t.due,kind:"task",t}))
      .concat(liveReq().filter(r=>act(r.projectId)&&reqLate(r)).sort(byDue).map(r=>({k:"r:"+r.id+":"+r.due,kind:"req",r})));
    const lim=addDays(today(),NOTIF_DAYS);
    const soon=ts.filter(t=>!isLate(t)&&(needsRelance(t)||parseD(t.due)<=lim)).sort(byDue).map(t=>({k:"s:"+t.id+":"+t.due+":"+t.status,kind:"task",t}));
    return {ans,late,soon};
  }
  function notifSeenSet(){return new Set(Array.isArray(ui.notifSeen)?ui.notifSeen:[])}
  function notifCount(d){const seen=notifSeenSet();return d.ans.length+d.late.concat(d.soon).filter(x=>!seen.has(x.k)).length}
  function notifBtn(cls){const b=document.createElement("button");b.type="button";b.className="bellbtn "+cls;b.innerHTML=BELL_SVG+`<span class="belln" hidden></span>`;b.onclick=e=>{e.stopPropagation();notifOpen(b)};return b}
  function notifRefresh(){
    if(!state||!state.projects)return;
    const tools=$("#ptools");
    if(tools&&!tools.querySelector(".bellbtn"))tools.prepend(notifBtn("d"));
    const brand=document.querySelector(".side .brand");
    if(brand&&!brand.querySelector(".bellbtn"))brand.insertBefore(notifBtn("m"),$("#srchbtn"));
    const d=notifData(), n=notifCount(d);
    document.querySelectorAll(".bellbtn").forEach(b=>{
      const sp=b.querySelector(".belln");sp.hidden=!n;sp.textContent=n>99?"99+":String(n);
      b.classList.toggle("on",!!n);
      b.setAttribute("aria-label",n?`Notifications : ${n} nouvelle${n>1?"s":""}`:"Notifications");
    });
    try{if(navigator.setAppBadge){if(n)navigator.setAppBadge(n);else navigator.clearAppBadge()}}catch(e){}
    const pop=$("#notifpop");if(pop&&!pop.hidden&&!pop.dataset.busy)notifPaint(pop,d);
  }
  function notifClose(){const pop=$("#notifpop");if(pop)pop.hidden=true;document.querySelectorAll(".bellbtn").forEach(b=>b.setAttribute("aria-expanded","false"))}
  function notifOpen(btn){
    let pop=$("#notifpop");
    if(pop&&!pop.hidden){notifClose();return}
    if(!pop){
      pop=document.createElement("div");pop.id="notifpop";pop.className="notifpop";pop.setAttribute("role","dialog");pop.setAttribute("aria-label","Notifications");pop.hidden=true;document.body.appendChild(pop);
      document.addEventListener("pointerdown",e=>{if(!pop.hidden&&!pop.contains(e.target)&&!e.target.closest(".bellbtn"))notifClose()});
      document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!pop.hidden)notifClose()});
      window.addEventListener("resize",()=>{if(!pop.hidden)notifClose()});
    }
    const d=notifData(), seen=notifSeenSet();
    pop.dataset.fresh=JSON.stringify(d.late.concat(d.soon).filter(x=>!seen.has(x.k)).map(x=>x.k));
    // tout ce qui est affiché est considéré comme vu (les réponses du client restent jusqu'à leur lecture)
    ui.notifSeen=d.late.concat(d.soon).map(x=>x.k);saveUi();
    const r=btn.getBoundingClientRect(), phone=window.innerWidth<=899;
    pop.style.top=Math.round(r.bottom+8)+"px";
    if(phone){pop.style.left="8px";pop.style.right="8px"}else{pop.style.left="auto";pop.style.right=Math.max(8,Math.round(window.innerWidth-r.right))+"px"}
    pop.hidden=false;btn.setAttribute("aria-expanded","true");
    notifPaint(pop,d);notifRefresh();
    const f=pop.querySelector("button");if(f)f.focus({preventScroll:true});
  }
  function notifPaint(pop,d){
    const fresh=new Set(JSON.parse(pop.dataset.fresh||"[]"));
    const pj=pid=>proj(pid)||{name:"",color:"#999"};
    const dayTxt=s=>{const n=Math.round((parseD(s)-today())/864e5);return n===0?"aujourd'hui":n===1?"demain":n===-1?"hier":shortDay(s).toLowerCase()};
    const lateBy=s=>{const n=Math.round((today()-parseD(s))/864e5);return n>1?`en retard de ${n} jours`:"en retard d'un jour"};
    const item=(x,i)=>{
      let p,title,meta,detail="";
      if(x.kind==="ans"){const o=x.o;p=pj(o.projectId);const lb=ptLabel(o);title=(lb?`N° ${lb} · `:"")+o.text;meta=fmtWhen(o.ansNew);detail=`Réponse : « ${short(o.answer)} »`}
      else if(x.kind==="req"){const r=x.r;p=pj(r.projectId);title="Demande client : "+r.title;meta=`Réponse attendue ${dayTxt(r.due)}`;detail=lateBy(r.due)}
      else{const t=x.t;p=pj(t.projectId);title=t.title;
        if(isLate(t)){meta=`Échéance ${dayTxt(t.due)}`;detail=lateBy(t.due)}
        else if(needsRelance(t)){meta=`Relance ${dayTxt(t.due)}`;detail=t.waitingFor?`En attente : ${t.waitingFor}`:"Relance à faire"}
        else{meta=cap(dayTxt(t.due));detail=t.status==="waiting"?"Relance prévue":t.priority==="haute"?"Priorité haute":""}}
      return `<button type="button" class="npi${x.kind==="ans"||fresh.has(x.k)?" new":""}" data-i="${i}"><span class="npm">${pMark(p)}</span><span class="npb"><span class="npp">${esc(p.name)} · ${esc(meta)}</span><b>${esc(title)}</b>${detail?`<span class="npd${x.kind!=="ans"&&/retard/.test(detail)?" late":""}">${esc(detail)}</span>`:""}</span></button>`;
    };
    const all=[];
    const sec=(key,label,list,more)=>{if(!list.length)return "";const shown=list.slice(0,6);const h=shown.map(x=>{all.push(x);return item(x,all.length-1)}).join("");
      return `<section class="nps ${key}"><h3>${label} <span>${list.length}</span></h3>${h}${list.length>shown.length?`<button type="button" class="npmore" data-more="${key}">Voir les ${list.length} ${more}</button>`:""}</section>`};
    const empty=!d.ans.length&&!d.late.length&&!d.soon.length;
    const nAsk=notifOk()&&Notification.permission==="default";
    pop.innerHTML=`<header class="nph"><b>Notifications</b>${d.ans.length?`<button type="button" class="npread" data-allread>Tout marquer comme lu</button>`:""}</header>
      <div class="npl">${empty?`<p class="npe">Rien à signaler : aucune nouvelle réponse du client, aucun retard, aucune échéance dans les ${NOTIF_DAYS+1} prochains jours.</p>`:""}
      ${sec("ans","Réponses du client",d.ans,"réponses")}${sec("late","En retard",d.late,"retards")}${sec("soon",`Échéances · ${NOTIF_DAYS+1} prochains jours`,d.soon,"échéances")}</div>
      ${nAsk?`<footer class="npf"><span>Être alerté des réponses du client même quand l'appli est en arrière-plan</span><button type="button" class="btn" data-ask>Activer</button></footer>`:""}`;
    pop.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{
      const x=all[+b.dataset.i];notifClose();
      if(x.kind==="ans")ansShow(x.o.projectId);
      else if(x.kind==="req")openRequest(x.r);
      else{view="all";openInList(x.t)}
    });
    pop.querySelectorAll("[data-more]").forEach(b=>b.onclick=()=>{
      const k=b.dataset.more;notifClose();
      if(k==="ans"){const pids=[...new Set(d.ans.map(x=>x.o.projectId))];ansShow(pids[0])}
      else{view="all";ui.mode="list";ui.scope="today";if(ui.who==="__me")ui.who="";saveUi();render()}
    });
    const ar=pop.querySelector("[data-allread]");if(ar)ar.onclick=()=>{pop.dataset.busy="1";ansSeen(d.ans.map(x=>x.o));delete pop.dataset.busy;notifPaint(pop,notifData());notifRefresh()};
    const ak=pop.querySelector("[data-ask]");if(ak)ak.onclick=async()=>{await ansNotifAsk();notifPaint(pop,notifData())};
  }
  {const r0=render;render=function(){r0();try{notifRefresh()}catch(e){}}}
  window.__notifData=()=>{const d=notifData();return {ans:d.ans.length,late:d.late.length,soon:d.soon.length,count:notifCount(d)}}; // utilisé par les tests

  // ---------- Téléphone : glisser une tâche (droite = terminer, gauche = reporter d'un jour) ----------
  (function swipeInit(){
    const L=$("#lists");if(!L)return;
    let st=null, swiped=0;
    L.addEventListener("click",e=>{if(Date.now()-swiped<400){e.stopPropagation();e.preventDefault()}},true);
    const reset=li=>{li.classList.remove("swiping","sw-r","sw-l");li.style.removeProperty("--sx")};
    L.addEventListener("pointerdown",e=>{
      if(!isPhone()||selMode||e.pointerType==="mouse")return;
      const li=e.target.closest(".task[data-id]:not(.pt):not(.req):not(.open)");
      if(!li||e.target.closest("input,button,a,select,textarea,summary,.menu,.edit"))return;
      st={li,x:e.clientX,y:e.clientY,dx:0,on:false,id:e.pointerId};
    },{passive:true});
    L.addEventListener("pointermove",e=>{
      if(!st||e.pointerId!==st.id)return;
      const dx=e.clientX-st.x, dy=e.clientY-st.y;
      if(!st.on){if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){st=null;return}if(Math.abs(dx)<14)return;st.on=true;st.li.classList.add("swiping");try{st.li.setPointerCapture(e.pointerId)}catch(x){}}
      st.dx=Math.max(-160,Math.min(160,dx));
      st.li.style.setProperty("--sx",st.dx+"px");
      st.li.classList.toggle("sw-r",st.dx>0);st.li.classList.toggle("sw-l",st.dx<0);
    });
    const end=e=>{
      if(!st||e.pointerId!==st.id)return;
      const {li,dx,on}=st;st=null;if(!on)return;
      swiped=Date.now();
      const t=state.tasks.find(x=>x.id===li.dataset.id);
      reset(li);
      if(!t)return;
      if(dx>90){if(t.status!=="done")changeStatus(t,"done")}
      else if(dx<-90){
        const base=t.due&&parseD(t.due)>today()?parseD(t.due):today();
        const nd=iso(addDays(base,1));
        undoable(`« ${short(t.title)} » reportée au ${shortDay(nd).toLowerCase()}`,[t],()=>{t.due=nd;t.updatedAt=Date.now()});
      }
    };
    L.addEventListener("pointerup",end);L.addEventListener("pointercancel",e=>{if(st&&e.pointerId===st.id){reset(st.li);st=null}});
  })();

  // ---------- Rechercher ou créer (Ctrl+K) ----------
  // Une seule fenêtre pour chercher partout, créer une tâche en une phrase, ouvrir un projet ou une vue.
  function cmdOpen(){
    if(!state||!state.projects)return;
    const d=document.createElement("dialog");d.className="uidlg cmdk";d.setAttribute("aria-label","Rechercher ou créer");
    d.innerHTML=`<div class="cmdin"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg><input type="text" aria-label="Rechercher ou créer" placeholder="Rechercher, ou écrire une tâche : « Relancer le client demain @Alice »" autocomplete="off"><kbd>Échap</kbd></div>
      <div class="cmdl" role="listbox" aria-label="Résultats"></div>
      <div class="cmdf"><span>↑ ↓ choisir</span><span>Entrée valider</span><span>« # » projet · « @ » personne · « ! » priorité</span></div>`;
    document.body.appendChild(d);
    const inp=d.querySelector("input"), list=d.querySelector(".cmdl");
    let items=[], sel=0;
    const close=()=>{try{d.close()}catch(e){}d.remove()};
    d.addEventListener("cancel",e=>{e.preventDefault();close()});
    d.addEventListener("click",e=>{if(e.target===d)close()});
    const cur=view!=="all"?proj(view):null;
    const words=q=>norm(q).split(/\s+/).filter(Boolean);
    const hit=(txt,ws)=>{const n=norm(txt);return ws.every(w=>n.includes(w))};
    const goView=(mode,scope)=>()=>{query="";$("#search").value="";view="all";ui.mode=mode;ui.scope=scope||"all";if(mode==="list"&&scope==="mine"){ui.scope="all";ui.who="__me"}saveUi();editing=null;render();window.scrollTo({top:0})};
    const build=()=>{
      const q=inp.value.trim(), ws=words(q);items=[];
      const add=(sec,ic,t,m,fn,cls)=>items.push({sec,ic,t,m:m||"",fn,cls:cls||""});
      if(q){
        add("Actions","⌕",`Rechercher « ${q} » partout`,"tâches, points ouverts, demandes",()=>{const s=$("#search");s.value=q;query=q;editing=null;render();s.focus()});
        const r=qParse(q), pid=(r.pid&&proj(r.pid)?r.pid:null)||(cur&&!cur.archived?cur.id:null)||(state.projects.find(x=>!x.archived)||{}).id;
        if(r.title&&pid){
          const bits=[proj(pid).name,r.due&&("échéance "+shortDay(r.due).toLowerCase()),r.who&&("pour "+r.who),r.prio&&r.prio!=="normale"&&("priorité "+r.prio)].filter(Boolean).join(" · ");
          add("Actions","+",`Créer la tâche « ${r.title} »`,bits,()=>{
            const t={id:uid(),projectId:pid,title:r.title,priority:r.prio||"normale",due:r.due||"",status:"todo",note:"",who:resolveWho(r.who||"",pid),createdAt:Date.now(),checklist:[],repeat:null};
            state.tasks.push(t);save();render();toast(`Tâche ajoutée à « ${proj(pid).name} ».`,()=>{view=pid;ui.mode="list";ui.scope="all";saveUi();editing=t.id;render()},"Voir")},"new");
        }
        if(cur&&!cur.archived)add("Actions","?",`Nouveau point ouvert « ${q} »`,cur.name,()=>{addPoints([q],cur.id,"","");const x=state.points[state.points.length-1];view=cur.id;ui.mode="points";saveUi();editingPt=x&&x.id;render()});
        live().filter(t=>hit(t.title+" "+rtText(t.note||""),ws)).slice(0,5).forEach(t=>add("Tâches",t.status==="done"?"✓":"○",t.title,(proj(t.projectId)||{}).name||"",()=>{view=t.projectId;ui.mode="list";ui.scope="all";saveUi();query="";$("#search").value="";editing=t.id;render();const el=document.querySelector(`.task[data-id="${t.id}"]`);if(el)el.scrollIntoView({block:"center"})}));
        livePts().filter(o=>hit(rtText(o.text)+" "+rtText(o.answer||"")+" "+(o.theme||""),ws)).slice(0,5).forEach(o=>add("Points ouverts",ptNumOf(o)?ptNumOf(o).replace("N° ",""):"?",rtText(o.text).split("\n")[0],[(proj(o.projectId)||{}).name,o.status==="closed"?"levé":""].filter(Boolean).join(" · "),()=>{view=o.projectId;ui.mode="points";saveUi();query="";$("#search").value="";editingPt=o.id;render();const el=document.querySelector(`.task.pt[data-o="${o.id}"]`);if(el)el.scrollIntoView({block:"center"})}));
        liveReq().filter(x=>hit(x.title+" "+rtText(x.description||""),ws)).slice(0,3).forEach(x=>add("Demandes client","D",x.title,(proj(x.projectId)||{}).name||"",()=>openRequest(x)));
        state.projects.filter(x=>hit(x.name,ws)).slice(0,4).forEach(x=>add("Aller à",x.name.slice(0,2).toUpperCase(),x.name,x.archived?"archivé":"projet",()=>openProject(x.id)));
      } else {
        if(cur){
          add("Ce projet","◎",`${cur.name} · Vue d'ensemble`,"",()=>{ui.mode=isPhone()?"home":"overview";saveUi();render()});
          add("Ce projet","!",`${cur.name} · Points ouverts`,"",()=>{ui.mode="points";saveUi();render()});
          add("Ce projet","R","Nouvelle réunion",cur.name,()=>mtgStart(cur));
          add("Ce projet","V","Démarrer un déplacement",cur.name,()=>{ui.mode="visits";saveUi();render();visNew(cur)});
        }
        state.projects.filter(x=>!x.archived).forEach(x=>add("Projets",x.name.slice(0,2).toUpperCase(),x.name,"",()=>openProject(x.id)));
        [["Ma journée","list","today"],["Agenda de la semaine","agenda"],["Toutes les tâches","list"],...(MODE==="cloud"?[["Mes tâches","list","mine"]]:[]),["Demandes client","requests"],["Tableau de bord","dash"],["Corbeille","trash"]].forEach(([l,m,sc])=>add("Vues","→",l,"",goView(m,sc)));
      }
      sel=Math.min(sel,Math.max(0,items.length-1));
      let lastSec="";
      list.innerHTML=items.map((it,i)=>{const h=it.sec!==lastSec?`<div class="cmdh">${esc(it.sec)}</div>`:"";lastSec=it.sec;return h+`<button type="button" role="option" class="cmdi${it.cls?" "+it.cls:""}" aria-selected="${i===sel}" data-i="${i}"><span class="cmdic">${esc(it.ic)}</span><span class="cmdt">${esc(it.t)}</span><span class="cmdm">${esc(it.m)}</span></button>`}).join("")||`<p class="hint" style="padding:12px">Aucun résultat.</p>`;
      list.querySelectorAll("[data-i]").forEach(b=>{b.onclick=()=>run(+b.dataset.i);b.onmousemove=()=>{if(sel!==+b.dataset.i){sel=+b.dataset.i;mark()}}});
    };
    const mark=()=>list.querySelectorAll("[data-i]").forEach(b=>{const on=+b.dataset.i===sel;b.setAttribute("aria-selected",on);if(on)b.scrollIntoView({block:"nearest"})});
    const run=i=>{const it=items[i];if(!it)return;close();it.fn()};
    inp.addEventListener("input",()=>{sel=0;build()});
    inp.addEventListener("keydown",e=>{
      if(e.key==="ArrowDown"){e.preventDefault();sel=Math.min(items.length-1,sel+1);mark()}
      else if(e.key==="ArrowUp"){e.preventDefault();sel=Math.max(0,sel-1);mark()}
      else if(e.key==="Enter"){e.preventDefault();run(sel)}
    });
    build();
    if(d.showModal)d.showModal();else d.setAttribute("open","");
    inp.focus();
  }
  window.__cmdOpen=cmdOpen;

  // ---------- Bouton « retour » du téléphone (et du navigateur) : retour en arrière dans l'appli ----------
  // Une entrée d'historique par niveau (écran précédent, fenêtre, panneau, visite ouverte…), posée au moment où
  // l'utilisateur touche l'écran : Chrome sur Android ignore les entrées posées sans action de l'utilisateur.
  // Chaque appui sur Retour remonte d'un niveau jusqu'à l'accueil (Projets sur téléphone, Ma journée sur ordinateur) ; à l'accueil, Retour quitte l'appli.
  // accueil : écran Projets sur téléphone, Ma journée sur ordinateur
  const navHome=()=>window.matchMedia("(max-width:899px)").matches?{view:"all",mode:"projects",scope:"all",who:""}:{view:"all",mode:"list",scope:"today",who:""};
  const nav={stack:[],restoring:false,depth:0,inPop:false};
  const navSnap=()=>({view,mode:ui.mode,scope:ui.scope,who:ui.who||""});
  const navKey=x=>x.mode==="projects"?"all|projects":[x.view,x.mode,x.scope,x.mode==="list"&&x.scope==="today"?"":x.who].join("|");
  try{history.replaceState({todoNav:0},"")}catch(e){}
  function navRecord(){
    if(nav.restoring||!state||!state.projects)return;
    const x=navSnap();
    const home=navHome();
    if(!nav.stack.length)nav.stack.push(home);
    if(navKey(x)===navKey(home)){nav.stack=[home];return} // revenu à l'accueil : Retour quittera l'appli
    const top=nav.stack[nav.stack.length-1];
    if(navKey(top)!==navKey(x)){nav.stack.push(x);if(nav.stack.length>60)nav.stack.splice(1,1)}
  }
  // niveaux ouverts par-dessus l'écran (le plus récent est fermé en premier par navOverlayBack)
  function navOverlays(){
    let n=document.querySelectorAll("dialog[open]").length;
    if(document.querySelector(".visedit"))n++;if(document.querySelector(".visscan"))n++;
    const pop=$("#notifpop");if(pop&&!pop.hidden)n++;
    if($("#mmenu"))n+=mmPage==="acct"?2:1;
    const side=$("#side");if(side&&side.classList.contains("open"))n++;if(side&&side.classList.contains("srch"))n++;
    if(visCur)n+=(visScreen==="home"||(visScreen==="prep"&&visCur.status==="prep"))?1:2;
    if(mtgCur)n++;
    if(editing||editingPt||editingReq)n++;
    if(query&&query.trim())n++;
    return n;
  }
  const navWant=()=>Math.max(0,nav.stack.length-1)+navOverlays();
  // pose les entrées manquantes (appelé après une action de l'utilisateur)
  function navSync(){
    if(nav.inPop||nav.restoring||!state||!state.projects)return;
    try{const w=navWant();while(nav.depth<w){nav.depth++;history.pushState({todoNav:nav.depth},"")}}catch(e){}
  }
  function navOverlayBack(){
    // fenêtres (boîtes de dialogue, choix, visionneuse photo…) : la plus récente d'abord
    const dl=[...document.querySelectorAll("dialog[open]")].pop();
    if(dl){const ev=new Event("cancel",{cancelable:true});dl.dispatchEvent(ev);if(!ev.defaultPrevented){try{dl.close()}catch(e){}dl.remove()}return true}
    const ed=document.querySelector(".visedit [data-x]");if(ed){ed.click();return true}
    const sc=document.querySelector(".visscan [data-x]");if(sc){sc.click();return true}
    const pop=$("#notifpop");if(pop&&!pop.hidden){notifClose();return true}
    if($("#mmenu")){if(mmPage==="acct"){mmPage="main";mmRender()}else mmClose();return true}
    const side=$("#side");
    if(side&&side.classList.contains("open")){side.classList.remove("open");$("#menubtn").setAttribute("aria-expanded","false");return true}
    if(side&&side.classList.contains("srch")){$("#srchbtn").click();return true}
    const vb=document.querySelector("#visview [data-back]");if(visCur&&vb){vb.click();return true}
    const mc=document.querySelector("#mtgview [data-close]");if(mtgCur&&mc){mc.click();return true}
    if(editing||editingPt||editingReq){const dc=document.querySelector(".edit.drawer .dclose,.drawer .dclose");if(dc)dc.click();else{editing=null;editingPt=null;editingReq=null;render()}return true}
    if(query&&query.trim()){query="";const q=$("#search");if(q)q.value="";render();return true}
    return false;
  }
  function navBack(){
    if(navOverlayBack())return true;
    if(nav.stack.length>1){
      nav.stack.pop();const x=nav.stack[nav.stack.length-1];
      nav.restoring=true;
      try{if(x.view!=="all"&&!proj(x.view))x.view="all";view=x.view;ui.mode=x.mode;ui.scope=x.scope;ui.who=x.who;editing=null;editingPt=null;editingReq=null;saveUi();render()}
      finally{nav.restoring=false}
      window.scrollTo({top:0});return true;
    }
    return false;
  }
  window.addEventListener("popstate",()=>{
    if(nav.leaving)return;
    nav.depth=Math.max(0,nav.depth-1);
    nav.inPop=true;let done=false;
    try{done=navBack()}catch(e){}
    setTimeout(()=>{nav.inPop=false},0);
    // à l'accueil, rien à fermer : on quitte l'appli (en sautant les entrées restées en trop)
    if(!done&&nav.depth>0){nav.leaving=true;history.go(-(nav.depth+1))}
  });
  // après chaque action de l'utilisateur, on pose les entrées des niveaux ouverts (y compris les fenêtres ouvertes un peu après)
  ["click","keydown","touchend"].forEach(t=>document.addEventListener(t,()=>{setTimeout(navSync,0);setTimeout(navSync,400)},true));
  {const r1=render;render=function(){r1();try{navRecord();navSync()}catch(e){}}}
  window.__navState=()=>({stack:nav.stack.length,depth:nav.depth,want:navWant()}); // utilisé par les tests
  {const r2=render;render=function(){r2();try{if(mmPage)mmRender()}catch(e){}}}

  // ---------- Application installable ----------
  if("serviceWorker" in navigator&&/^https?:$/.test(location.protocol)){
    window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
  }
  let installEvt=null;
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvt=e;$("#installbtn").hidden=false});
  window.addEventListener("appinstalled",()=>{installEvt=null;$("#installbtn").hidden=true});
  $("#installbtn").onclick=async()=>{if(!installEvt)return;installEvt.prompt();try{await installEvt.userChoice}catch(e){}installEvt=null;$("#installbtn").hidden=true};

  let startMode=null;try{startMode=localStorage.getItem("todo-mode")}catch(e){}
  if(AUTH_HASH.recovery&&cloudReady())(async()=>{
    // retour depuis le lien « Mot de passe oublié »
    let sess=null;try{sess=(await cloudClient().auth.getSession()).data.session}catch(e){}
    if(sess){useSession(sess);render();showGate("reset")}
    else{render();showGate("forgot");$("#ferr").textContent="Le lien de réinitialisation n'est plus valide : demandez-en un nouveau."}
  })();
  else if(AUTH_HASH.error&&cloudReady()){render();showGate("forgot");$("#ferr").textContent="Le lien reçu par e-mail a expiré ou a déjà servi : demandez-en un nouveau."}
  else if(startMode==="cloud")startCloud();
  else if(startMode==="local")startLocal();
  else{
    // Première ouverture : si des tâches locales existent déjà, on reste en local sans rien demander
    if(lsLoad()){try{localStorage.setItem("todo-mode","local")}catch(e){}startLocal()}
    else{render();showGate("choice")}
  }
})();

// Calendrier de l'appli (PC) : remplace le calendrier natif des champs date, qui garde le même
// numéro de jour en surbrillance quand on change de mois. Le champ reste un input date (saisie clavier conservée).
(()=>{
  const fine=()=>{try{return matchMedia("(hover:hover) and (pointer:fine)").matches}catch(e){return false}};
  if(fine())document.documentElement.classList.add("dp-on");
  const MO=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
  const p2=n=>String(n).padStart(2,"0"),isoD=d=>`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
  const parse=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||"");return m?new Date(+m[1],m[2]-1,+m[3]):null};
  let pop=null,inp=null,cur=null;
  const close=()=>{if(!pop)return;try{pop.hidePopover&&pop.matches(":popover-open")&&pop.hidePopover()}catch(e){}pop.remove();pop=null;inp=null;document.removeEventListener("pointerdown",outside,true);window.removeEventListener("resize",close);document.removeEventListener("scroll",onScroll,true)};
  const outside=e=>{if(pop&&!pop.contains(e.target)&&e.target!==inp)close()};
  const onScroll=e=>{if(pop&&!pop.contains(e.target))place()};
  const place=()=>{if(!pop||!inp)return;const r=inp.getBoundingClientRect(),h=pop.offsetHeight,w=pop.offsetWidth;
    let top=r.bottom+6;if(top+h>innerHeight-8)top=r.top-h-6>8?r.top-h-6:innerHeight-h-8;
    pop.style.top=Math.max(8,top)+"px";pop.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+"px"};
  const set=v=>{const el=inp;close();el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));el.focus()};
  const draw=()=>{
    const sel=inp.value,today=isoD(new Date()),mn=inp.min||"",mx=inp.max||"";
    const trips=inp.hasAttribute("data-dptrips")&&window.__dpTrips?window.__dpTrips().filter(t=>t.id!==inp.getAttribute("data-dptrips")):[];
    const y=cur.getFullYear(),m=cur.getMonth(),first=new Date(y,m,1),off=(first.getDay()+6)%7,n=new Date(y,m+1,0).getDate();
    let cells="";for(let i=0;i<off;i++)cells+="<span></span>";
    for(let d=1;d<=n;d++){const v=`${y}-${p2(m+1)}-${p2(d)}`,dis=(mn&&v<mn)||(mx&&v>mx);
      const tr=trips.filter(t=>t.s<=v&&v<=t.e),t0=tr[0],dow=(off+d-1)%7;
      const tc=t0?` trip${(t0.s===v||dow===0||d===1)?" ts":""}${(t0.e===v||dow===6||d===n)?" te":""}`:"";
      cells+=`<button type="button" class="dpd${v===sel?" sel":""}${v===today?" tod":""}${tc}" data-v="${v}"${t0?` style="--tc:${t0.color}" title="${tr.map(t=>`${t.title} · ${t.pname}`.replace(/"/g,"&quot;")).join("\n")}"`:""}${dis?" disabled":""}${v===sel?' aria-pressed="true"':""}${v===today?' aria-current="date"':""}>${d}</button>`}
    const m0=`${y}-${p2(m+1)}-01`,m1=`${y}-${p2(m+1)}-${p2(n)}`,inM=trips.filter(t=>t.s<=m1&&t.e>=m0).sort((a,b)=>a.s<b.s?-1:1);
    const MA=["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."],sh=x=>{const q=parse(x);return `${q.getDate()} ${MA[q.getMonth()]}`};
    const leg=inM.length?`<div class="dpl">${inM.map(t=>`<div class="dpli" style="--tc:${t.color}"><i></i><span><b>${t.title.replace(/</g,"&lt;")}</b> · ${t.pname.replace(/</g,"&lt;")}<small>${t.s===t.e?sh(t.s):`${sh(t.s)} – ${sh(t.e)}`}${t.st?` · ${t.st}`:""}</small></span></div>`).join("")}</div>`:"";
    pop.innerHTML=`<div class="dph"><button type="button" class="dpn" data-m="-1" aria-label="Mois précédent">‹</button><b>${MO[m]} ${y}</b><button type="button" class="dpn" data-m="1" aria-label="Mois suivant">›</button></div>
      <div class="dpw"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div><div class="dpg">${cells}</div>${leg}
      <div class="dpf">${inp.required?"<span></span>":'<button type="button" class="dpa" data-x="clear">Effacer</button>'}<button type="button" class="dpa" data-x="today"${(mn&&today<mn)||(mx&&today>mx)?" disabled":""}>Aujourd'hui</button></div>`};
  const open=el=>{close();inp=el;cur=parse(el.value)||parse(el.min&&el.min>isoD(new Date())?el.min:"")||new Date();cur=new Date(cur.getFullYear(),cur.getMonth(),1);
    pop=document.createElement("div");pop.className="dpop";pop.setAttribute("role","dialog");pop.setAttribute("aria-label","Choisir une date");
    const host=el.closest("dialog[open]")||document.body;
    host.appendChild(pop);if(pop.showPopover){pop.setAttribute("popover","manual");try{pop.showPopover()}catch(e){}}
    draw();place();
    pop.addEventListener("pointerdown",e=>e.preventDefault());
    pop.addEventListener("click",e=>{const b=e.target.closest("button");if(!b||b.disabled)return;
      if(b.dataset.m){cur=new Date(cur.getFullYear(),cur.getMonth()+ +b.dataset.m,1);draw();place()}
      else if(b.dataset.v)set(b.dataset.v);
      else if(b.dataset.x==="today")set(isoD(new Date()));
      else if(b.dataset.x==="clear")set("")});
    setTimeout(()=>{document.addEventListener("pointerdown",outside,true);window.addEventListener("resize",close);document.addEventListener("scroll",onScroll,true)},0)};
  document.addEventListener("click",e=>{const el=e.target;if(!(el instanceof HTMLInputElement)||el.type!=="date"||el.disabled||el.readOnly||!fine())return;
    e.preventDefault();if(pop&&inp===el){close();return}open(el)},true);
  document.addEventListener("keydown",e=>{if(!pop)return;if(e.key==="Escape"){e.stopPropagation();e.preventDefault();const el=inp;close();el&&el.focus()}
    else if(e.key==="Tab")close()},true);
  document.addEventListener("keydown",e=>{const el=e.target;if(el instanceof HTMLInputElement&&el.type==="date"&&fine()&&!el.disabled&&(e.key===" "&&e.altKey||e.key==="ArrowDown"&&e.altKey)){e.preventDefault();open(el)}});
  window.__datePick={open,close};
})();
