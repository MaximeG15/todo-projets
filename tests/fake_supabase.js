// Faux client Supabase pour les tests (données fictives)
(()=>{
  const db=window.__db={projects:[{id:"p1",name:"Projet Alpha",color:"#E0703A",owner:"u1",owner_email:"alice@exemple.test",created_at:1,updated_at:1,archived:false},{id:"p2",name:"Projet Bêta",color:"#3FA37A",owner:"u2",owner_email:"bruno@exemple.test",created_at:2,updated_at:1,archived:false}],
    project_members:[{project_id:"p2",email:"alice@exemple.test"}],
    tasks:[{id:"t1",project_id:"p1",title:"Mail client",priority:"normale",due:"2026-10-09",status:"todo",waiting:true,waiting_for:"Client",note:"",who:"",created_at:1,done_at:null,updated_at:1,updated_by:"",checklist:[],repeat:null,family:null,deleted_at:null},
           {id:"t2",project_id:"p2",title:"Tâche partagée",priority:"normale",due:null,status:"todo",waiting:false,waiting_for:"",note:"",who:"",created_at:2,done_at:null,updated_at:1,updated_by:"",checklist:[],repeat:null,family:null,deleted_at:null},
           {id:"t3",project_id:"p1",title:"Ancienne supprimée",priority:"normale",due:null,status:"todo",waiting:false,waiting_for:"",note:"",who:"",created_at:3,done_at:null,updated_at:1,updated_by:"bruno@exemple.test",checklist:[],repeat:null,family:null,deleted_at:Date.now()-40*864e5},
           {id:"t4",project_id:"p1",title:"Récente supprimée",priority:"normale",due:null,status:"todo",waiting:false,waiting_for:"",note:"",who:"",created_at:4,done_at:null,updated_at:1,updated_by:"bruno@exemple.test",checklist:[],repeat:null,family:null,deleted_at:Date.now()-2*864e5}],
    task_comments:[],profiles:[{email:"alice@exemple.test",first_name:"Alice",last_name:"Martin"},{email:"bruno@exemple.test",first_name:"Bruno",last_name:"D"}],project_families:[],user_calendar:[],
    task_history:[{id:1,task_id:"t1",actor_email:"bruno@exemple.test",at:Date.now()-3600e3,field:"status",old_value:"todo",new_value:"waiting"}]};
  window.__log=[];
  const user={id:"u1",email:"alice@exemple.test"};
  function q(table){
    const st={table,filters:[],op:"select",rows:null,order:null,limit:null};
    const run=()=>{
      const T=db[table]||(db[table]=[]);
      const match=r=>st.filters.every(([k,v,kind])=>kind==="in"?v.includes(r[k]):r[k]===v);
      window.__log.push([st.op,table,JSON.parse(JSON.stringify(st.rows||st.filters))]);
      if(st.op==="select"){let d=T.filter(match);if(st.order)d=d.slice().sort((a,b)=>(a[st.order]>b[st.order]?1:-1));if(st.limit)d=d.slice(0,st.limit);return {data:JSON.parse(JSON.stringify(d)),error:null}}
      if(st.op==="upsert"||st.op==="insert"){st.rows.forEach(r=>{const i=T.findIndex(x=>x.id&&x.id===r.id);if(i>=0)T[i]={...T[i],...r};else T.push({...r})});return {data:null,error:null}}
      if(st.op==="update"){T.filter(match).forEach(r=>Object.assign(r,st.rows[0]));return {data:null,error:null}}
      if(st.op==="delete"){db[table]=T.filter(r=>!match(r));return {data:null,error:null}}
    };
    const b={select(){return b},upsert(r){st.op="upsert";st.rows=Array.isArray(r)?r:[r];return b},insert(r){st.op="insert";st.rows=Array.isArray(r)?r:[r];return b},update(r){st.op="update";st.rows=[r];return b},delete(){st.op="delete";return b},
      eq(k,v){st.filters.push([k,v]);return b},in(k,v){st.filters.push([k,v,"in"]);return b},order(k){st.order=k;return b},limit(n){st.limit=n;return b},maybeSingle(){return b},single(){return b},
      then(res,rej){return Promise.resolve(run()).then(res,rej)}};
    return b;
  }
  window.__rt=[];
  const ch={on(type,f,cb){window.__rt.push({table:f&&f.table,cb});return ch},subscribe(cb){if(cb)setTimeout(()=>cb("SUBSCRIBED"),0);window.__rtStatus=cb;return ch}};
  window.__emit=(table,pl)=>window.__rt.filter(h=>h.table===table).forEach(h=>h.cb(pl));
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:"eyJ",user}}}),onAuthStateChange(){},refreshSession:async()=>({data:{}}),signOut:async()=>({})},
    rpc:async(n,a)=>{(window.__rpc=window.__rpc||[]).push(n);try{sessionStorage.setItem('__rpc',(sessionStorage.getItem('__rpc')||'')+n+';')}catch(e){}return {data:null,error:null}},from:q,channel:()=>{window.__rt=[];return ch},removeChannel(){},realtime:{setAuth(){}},functions:{invoke:async()=>({data:null,error:{message:"x"}})},
    storage:{from:b=>({upload:async(path,blob)=>{if(window.__storageDown)return {data:null,error:{message:"Failed to fetch"}};(window.__storage=window.__storage||{})[b+"/"+path]=blob;return {data:{path},error:null}},
      download:async path=>{const x=(window.__storage||{})[b+"/"+path];return x?{data:x,error:null}:{data:null,error:{message:"not found"}}},
      list:async prefix=>{const pre=b+"/"+prefix+"/",seen=new Set(),out=[];Object.keys(window.__storage||{}).filter(k=>k.startsWith(pre)).forEach(k=>{const rest=k.slice(pre.length),n=rest.split("/")[0];if(!seen.has(n)){seen.add(n);out.push({name:n,id:rest.includes("/")?null:n})}});return {data:out,error:null}},
      remove:async paths=>{paths.forEach(x=>{delete (window.__storage||{})[b+"/"+x]});return {data:[],error:null}}})}})};
})();
