import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
import json
from playwright.sync_api import sync_playwright
S=OUT
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
SEED="""window.__db.project_families=[{id:'f1',project_id:'p1',name:'Paramétrage',created_at:1}];
window.__db.point_themes=[{id:'th1',project_id:'p1',name:'Réception',created_at:1}];
window.__db.tasks[0].family='f1';
window.__db.task_comments=[{id:'c1',task_id:'t1',author_email:'bruno@exemple.test',body:'Vu avec le client',created_at:1700000000000}];
window.__db.open_points=[{id:'op1',project_id:'p1',text:'Q ?',answer:'',hypothesis:'H',erp:'oui',theme:'Réception',owner:'',owner_name:'',status:'open',task_id:null,request_id:null,created_at:1,updated_at:1,closed_at:null,deleted_at:null,updated_by:''}];
localStorage.setItem('todo-mode','cloud');localStorage.setItem('todo-projets-ui','{}');"""
with sync_playwright() as pw:
    b=pw.chromium.launch();ctx=b.new_context(viewport={"width":1440,"height":900},accept_downloads=True);pg=ctx.new_page()
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script(SEED)
    pg.goto(APP);pg.wait_for_timeout(800)
    pg.locator("#toolsbox summary").click()
    with pg.expect_download() as d: pg.locator('#acc [data-a="exp"]').click()
    d.value.save_as(S+"backup.json");print("   fichier :",d.value.suggested_filename)
    j=json.load(open(S+"backup.json"))
    p1=[p for p in j["projects"] if p["id"]=="p1"][0]
    ok(p1["families"]==[{"id":"f1","name":"Paramétrage"}],"sauvegarde : familles")
    ok(p1["pointThemes"]==[{"id":"th1","name":"Réception"}],"sauvegarde : thèmes")
    t1=[t for t in j["tasks"] if t["id"]=="t1"][0]
    ok(t1.get("family")=="f1" and t1.get("comments",[{}])[0].get("text")=="Vu avec le client","sauvegarde : famille de la tâche et commentaires")
    ok(len(j["points"])==1 and j["points"][0]["hypothesis"]=="H","sauvegarde : points ouverts")
    print("   statut :",pg.locator("#sync").inner_text())
    # restauration dans un compte vide
    pg2=ctx.new_page();pg2.on("pageerror",lambda e:errs.append("JS2: "+str(e)));on_dialog(pg2,lambda d:d.accept())
    pg2.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg2.add_init_script(path=FAKE)
    pg2.add_init_script("window.__db.projects=[];window.__db.tasks=[];window.__db.project_members=[];localStorage.setItem('todo-mode','cloud');localStorage.setItem('todo-projets-ui','{}')")
    pg2.goto(APP);pg2.wait_for_timeout(800)
    pg2.locator("#toolsbox summary").click()
    pg2.locator('#acc input[type=file]').set_input_files(S+"backup.json");pg2.wait_for_timeout(1500)
    db=lambda t:pg2.evaluate("window.__db."+t)
    P=db("projects");T=db("tasks");F=db("project_families");TH=db("point_themes");C=db("task_comments");O=db("open_points")
    ok(len(P)==2 and len(O)==1,"restauration : projets et points (%d, %d)"%(len(P),len(O)))
    fam=[f for f in F if f["name"]=="Paramétrage"]
    nt=[t for t in T if t["title"]=="Mail client"]
    ok(fam and nt and nt[0].get("family")==fam[0]["id"],"restauration : famille recréée et rattachée")
    ok(any(t["name"]=="Réception" for t in TH),"restauration : thème recréé")
    ok(any("Vu avec le client" in c["body"] and "[Bruno D" in c["body"] for c in C),"restauration : commentaire avec son auteur d'origine")
    print("   statut :",pg2.locator("#sync").inner_text())
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
