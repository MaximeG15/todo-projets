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
    on_dialog(pg,lambda d:d.accept("Éditeur WMS") if d.type=="prompt" else d.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE)
    pg.add_init_script("localStorage.setItem('todo-mode','cloud');localStorage.setItem('todo-projets-ui',JSON.stringify({mode:'list',scope:'all'}))")
    pg.goto(APP);pg.wait_for_timeout(800)
    db=lambda t:pg.evaluate("window.__db."+t)
    tk=lambda i:[x for x in db("tasks") if x["id"]==i]
    ok(pg.locator('.task[data-id="t1"] .tag.wait').count()==1,"cloud : tâche en attente lue (waiting=true)")
    ok("Client" in pg.locator('.task[data-id="t1"]').inner_text(),"cloud : En attente de lu")
    ok(not tk("t3"),"cloud : corbeille > 30 jours purgée sur le serveur")
    ok(tk("t4") and pg.locator('.task[data-id="t4"]').count()==0,"cloud : tâche en corbeille non affichée")
    # mettre t2 en attente via menu
    r=pg.locator('.task[data-id="t2"]');r.locator("details.more summary").click();r.locator('[data-a="wait"]').click();pg.wait_for_timeout(300)
    t=tk("t2")[0];ok(t["status"]=="todo" and t["waiting"] is True and t["waiting_for"]=="Éditeur WMS","cloud : upsert waiting / waiting_for (%s,%s,%s)"%(t["status"],t["waiting"],t["waiting_for"]))
    # corbeille t2
    r=pg.locator('.task[data-id="t2"]');r.locator("details.more summary").click();r.locator('[data-a="del"]').click();pg.wait_for_timeout(300)
    ok(tk("t2")[0]["deleted_at"],"cloud : deleted_at envoyé")
    pg.locator("#toast button").click();pg.wait_for_timeout(300)
    ok(tk("t2")[0]["deleted_at"] is None,"cloud : annulation renvoyée au serveur")
    # corbeille : t4 avec auteur
    pg.locator("#trashbtn").click()
    txt=pg.locator(".trow").first.inner_text();print("   ",txt.replace("\n"," | "))
    ok("par Bruno D" in txt,"cloud : corbeille indique qui a supprimé")
    pg.locator(".trow [data-r]").first.click();pg.wait_for_timeout(300)
    ok(tk("t4")[0]["deleted_at"] is None,"cloud : restauration envoyée")
    # archiver p1 (propriétaire)
    pg.locator(".pbtn",has_text="Projet Alpha").click()
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="Archiver").click();pg.wait_for_timeout(300)
    ok([p for p in db("projects") if p["id"]=="p1"][0]["archived"] is True,"cloud : archived envoyé")
    # projet invité : pas de bouton Archiver
    pg.locator(".pbtn",has_text="Projet Bêta").click()
    ok(pg.locator(".ddmore .menu button",has_text="Archiver").count()==0,"cloud : invité sans bouton Archiver")
    # historique cloud
    pg.locator(".parch").click();pg.locator(".pbtn",has_text="Projet Alpha").click()
    r=pg.locator('.task[data-id="t1"]');r.locator("details.more summary").click();r.locator('[data-a="hist"]').click();pg.wait_for_timeout(400)
    h=pg.locator('.task[data-id="t1"] .hlist').inner_text();print("   ",h)
    ok("Bruno D" in h and "devient « En attente »" in h,"cloud : historique lu depuis task_history")
    pg.screenshot(path=S+"v3_cloud_hist.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
