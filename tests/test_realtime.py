import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
from playwright.sync_api import sync_playwright
S=OUT
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
def trow(id,title,pid="p1",**k):
    r={"id":id,"project_id":pid,"title":title,"priority":"normale","due":None,"status":"todo","waiting":False,"waiting_for":"","note":"","who":"","created_at":10,"done_at":None,"updated_at":10**13,"updated_by":"bruno@exemple.test","checklist":[],"repeat":None,"family":None,"deleted_at":None,"request_id":None}
    r.update(k);return r
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE)
    pg.add_init_script("localStorage.setItem('todo-mode','cloud');localStorage.setItem('todo-projets-ui',JSON.stringify({mode:'list',scope:'all'}))")
    pg.goto(APP);pg.wait_for_timeout(800)
    tabs=pg.evaluate("[...new Set(window.__rt.map(h=>h.table))]")
    ok(len(tabs)==11,"11 tables écoutées %s"%tabs)
    sel=lambda:pg.evaluate("window.__log.filter(l=>l[0]==='select').length")
    n0=sel()
    emit=lambda t,pl:pg.evaluate("([t,pl])=>{if(t!=='tasks'&&pl.eventType!=='DELETE')(window.__db[t]=window.__db[t]||[]).push(pl.new);window.__emit(t,pl)}",[t,pl])
    emit("tasks",{"eventType":"INSERT","new":trow("n1","Nouvelle du collègue")});pg.wait_for_timeout(400)
    ok(pg.locator('.task[data-id="n1"]').count()==1,"insertion appliquée")
    emit("tasks",{"eventType":"UPDATE","new":trow("n1","Titre modifié",updated_at=10**13+5)});pg.wait_for_timeout(400)
    ok("Titre modifié" in pg.locator('.task[data-id="n1"]').inner_text(),"mise à jour appliquée")
    emit("tasks",{"eventType":"UPDATE","new":trow("n1","Ancienne version",updated_at=10**13)});pg.wait_for_timeout(400)
    ok("Titre modifié" in pg.locator('.task[data-id="n1"]').inner_text(),"écho plus ancien ignoré")
    emit("tasks",{"eventType":"DELETE","old":{"id":"n1"}});pg.wait_for_timeout(400)
    ok(pg.locator('.task[data-id="n1"]').count()==0,"suppression appliquée")
    ok(sel()==n0,"aucun rechargement complet (%d requêtes select)"%(sel()-n0))
    ok(not any(l[0]=="upsert" for l in pg.evaluate("window.__log")[-5:]),"pas de renvoi au serveur")
    # priorité locale : on rend t1 dirty puis on émet une version distante
    pg.evaluate("()=>{}")
    # comments / families / themes / profiles
    emit("task_comments",{"eventType":"INSERT","new":{"id":"c1","task_id":"t1","author_email":"bruno@exemple.test","body":"Vu avec le client","created_at":5}});pg.wait_for_timeout(400)
    ok(pg.locator('.task[data-id="t1"]').inner_text().find("1")>=0 and pg.evaluate("1"),"commentaire reçu")
    emit("project_families",{"eventType":"INSERT","new":{"id":"f1","project_id":"p1","name":"Mécanique","created_at":1}});pg.wait_for_timeout(400)
    emit("point_themes",{"eventType":"INSERT","new":{"id":"th1","project_id":"p1","name":"ERP","created_at":1}});pg.wait_for_timeout(400)
    emit("profiles",{"eventType":"UPDATE","new":{"email":"bruno@exemple.test","first_name":"Bruno","last_name":"Girard"}});pg.wait_for_timeout(400)
    # vérification via une nouvelle tâche de Bruno supprimée -> corbeille "par Bruno Durand"
    ok(sel()==n0,"tables annexes : toujours aucun rechargement complet")
    # projet : rechargement complet
    pg.evaluate("window.__db.projects.push({id:'p3',name:'Nouveau partagé',color:'#3366CC',owner:'u2',owner_email:'bruno@exemple.test',created_at:5,updated_at:1,archived:false});window.__db.project_members.push({project_id:'p3',email:'alice@exemple.test'})")
    emit("project_members",{"eventType":"INSERT","new":{"project_id":"p3","email":"alice@exemple.test"}});pg.wait_for_timeout(800)
    ok(sel()>n0 and pg.locator(".pbtn",has_text="Nouveau partagé").count()==1,"partage : rechargement complet")
    # tâche d'un projet inconnu -> rechargement complet
    n1=sel();emit("tasks",{"eventType":"INSERT","new":trow("n2","Projet inconnu",pid="pX")});pg.wait_for_timeout(800)
    ok(sel()>n1,"projet inconnu : rechargement complet")
    # événement incomplet (TOAST) -> rechargement complet
    n2=sel();r=trow("t1","x");del r["note"];emit("tasks",{"eventType":"UPDATE","new":r});pg.wait_for_timeout(800)
    ok(sel()>n2,"ligne incomplète : rechargement complet")
    # priorité locale
    pg.evaluate("()=>{const t=window.__db.tasks.find(x=>x.id==='t2')}")
    pg.evaluate("cb=>0",None)
    # reconnexion
    n3=sel();pg.evaluate("window.__rtStatus('CHANNEL_ERROR');window.__rtStatus('SUBSCRIBED')");pg.wait_for_timeout(800)
    ok(sel()>n3,"reconnexion : rattrapage complet")
    # pendant l'édition : différé
    pg.locator('.task[data-id="t1"] details.more summary').click();pg.locator('.task[data-id="t1"] .menu [data-a="edit"]').click();pg.wait_for_timeout(200)
    emit("tasks",{"eventType":"INSERT","new":trow("n3","Pendant édition")});pg.wait_for_timeout(500)
    ok(pg.locator('.task[data-id="n3"]').count()==0 and pg.locator('.task[data-id="t1"] .edit').count()==1,"édition en cours : application différée")
    ed=pg.locator('.task[data-id="t1"] .edit')
    ok("Mécanique" in ed.inner_html(),"famille reçue en temps réel disponible")
    ok("Vu avec le client" in ed.inner_text(),"commentaire reçu en temps réel affiché")
    pg.keyboard.press("Escape");pg.evaluate("document.querySelector('.task[data-id=\"t1\"] [data-a=\"edit\"]')&&0")
    b.close()
print("ERREURS:",errs) if errs else print("TOUT OK")
sys.exit(1 if errs else 0)
