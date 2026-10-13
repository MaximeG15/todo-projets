import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
from playwright.sync_api import sync_playwright
S=OUT
errs=[];ans=["Master data","Données de base"]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept(ans.pop(0)) if d.type=="prompt" else d.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE)
    pg.add_init_script("window.__db.open_points=[{id:'op1',project_id:'p1',text:'Q ?',answer:'',hypothesis:'',erp:'',theme:'Réception',owner:'',owner_name:'',status:'open',task_id:null,request_id:null,created_at:1,updated_at:1,closed_at:null,deleted_at:null,updated_by:''}];window.__db.point_themes=[{id:'th1',project_id:'p1',name:'Expédition',created_at:1}];localStorage.setItem('todo-mode','cloud');localStorage.setItem('todo-projets-ui','{}')")
    pg.goto(APP);pg.wait_for_timeout(800)
    db=lambda t:pg.evaluate("window.__db."+t)
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator('#ptabs [data-tab="points"]').click()
    opts=pg.locator('#ptadd [data-q="theme"] option').all_inner_texts()
    ok("Expédition" in opts and "Réception" in opts,"thèmes en ligne + utilisés proposés %s"%opts)
    pg.locator('#ptadd [data-q="theme"]').select_option("__new");pg.wait_for_timeout(300)
    ok(any(t["name"]=="Master data" for t in db("point_themes")),"nouveau thème enregistré en ligne")
    pg.locator(".g-pt",has_text="Réception").locator(".thren").click();pg.wait_for_timeout(400)
    ok(any(t["name"]=="Données de base" for t in db("point_themes")) and [o for o in db("open_points") if o["id"]=="op1"][0]["theme"]=="Données de base","renommer : thème et points mis à jour en ligne")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
