import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
from playwright.sync_api import sync_playwright
S=OUT
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept("OK fait") if d.type=="prompt" else d.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE)
    pg.add_init_script("window.__db.open_points=[{id:'op1',project_id:'p2',text:'Question partagée ?',answer:'',theme:'Réception',owner:'client',owner_name:'M. Martin',status:'open',task_id:null,request_id:null,created_at:1,updated_at:1,closed_at:null,deleted_at:null,updated_by:'bruno@exemple.test'}];localStorage.setItem('todo-mode','cloud');localStorage.setItem('todo-projets-ui','{}')")
    pg.goto(APP);pg.wait_for_timeout(800)
    db=lambda t:pg.evaluate("window.__db."+t)
    pg.locator(".pbtn",has_text="Projet Bêta").click();pg.locator('#ptabs [data-tab="points"]').click()
    t=pg.locator("#lists").inner_text()
    ok("Question partagée" in t and "Client · M. Martin" in t,"lecture open_points (projet partagé)")
    pg.locator('#ptadd [data-q="text"]').fill("Nouvelle question ?");pg.keyboard.press("Enter");pg.wait_for_timeout(300)
    rows=[r for r in db("open_points") if r["text"]=="Nouvelle question ?"]
    ok(len(rows)==1 and rows[0]["project_id"]=="p2" and rows[0]["status"]=="open","envoi d'un nouveau point")
    pg.locator('.pt[data-o="op1"] .chk').click();pg.wait_for_timeout(300)
    r=[r for r in db("open_points") if r["id"]=="op1"][0]
    ok(r["status"]=="closed" and r["answer"]=="OK fait" and r["closed_at"],"levée envoyée au serveur")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
