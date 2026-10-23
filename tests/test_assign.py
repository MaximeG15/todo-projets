import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE)
    pg.add_init_script("localStorage.setItem('todo-mode','cloud');localStorage.setItem('todo-projets-ui',JSON.stringify({mode:'list',scope:'all'}))")
    pg.goto(APP);pg.wait_for_timeout(800)
    tk=lambda i:[x for x in pg.evaluate("window.__db.tasks") if x["id"]==i][0]
    ok(pg.locator("#views .vbtn",has_text="Mes tâches").count()==0 and pg.locator("#views .vbtn[data-v=all]").inner_text().startswith("Tâches"),"une seule entrée « Tâches » dans la barre")
    # attribution par le nom d'un membre du projet (projet partagé par Bruno)
    r=pg.locator('.task[data-id="t2"]');r.locator(".ttl").click()
    ed=pg.locator('.task[data-id="t2"] .edit');ed.locator('input[aria-label="Responsable"]').fill("bruno d");ed.locator('[data-k="ok"]').click();pg.wait_for_timeout(400)
    ok(tk("t2")["who"]=="bruno@exemple.test","nom d'un membre enregistré sous son e-mail")
    ok("Bruno D" in pg.locator('.task[data-id="t2"] .tag.who').get_attribute("title"),"pastille : nom du responsable en info-bulle")
    # saisie rapide avec mon nom
    pg.locator(".pbtn",has_text="Projet Alpha").click()
    pg.fill("#qt","Préparer la recette");pg.fill("#qw","Alice Martin");pg.locator("#quick button[type=submit]").click();pg.wait_for_timeout(400)
    me=[x for x in pg.evaluate("window.__db.tasks") if x["title"]=="Préparer la recette"]
    ok(me and me[0]["who"]=="alice@exemple.test","saisie rapide : attribuée à moi (e-mail)")
    ok(pg.locator(".task .tag.who.me").count()>=1,"mes tâches mises en évidence")
    # vue Mes tâches
    pg.locator("#views .vbtn[data-v=all]").click();pg.wait_for_timeout(200)
    ok(pg.locator('.wseg [data-who="__me"]').get_attribute("aria-pressed")=="true","« Tâches » : filtre « Mes tâches » par défaut")
    titles=pg.eval_on_selector_all("#lists .task .ttl","e=>e.map(x=>x.textContent.trim())")
    ok(titles==["Préparer la recette"],"vue « Mes tâches » : seulement mes tâches (%s)"%titles)
    ok("Mes tâches" in pg.locator("#ptitle").inner_text(),"titre « Mes tâches »")
    pg.locator('.wseg [data-who="all"]').click();pg.wait_for_timeout(200)
    ok(pg.locator("#lists .task").count()>=3,"filtre « Toutes » : toutes les tâches")
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator("#views .vbtn[data-v=all]").click();pg.wait_for_timeout(200)
    ok(pg.locator('.wseg [data-who="all"]').get_attribute("aria-pressed")=="true","filtre mémorisé")
    # attribution groupée
    pg.locator(".pbtn",has_text="Projet Alpha").click()
    pg.locator("#viewbar button",has_text="Sélectionner").click()
    pg.locator("#selbar [data-sa=all]").click()
    opts=pg.eval_on_selector_all('#selbar select[data-sk="who"] option',"e=>e.map(x=>x.textContent)")
    ok(any(o.startswith("Moi") for o in opts),"responsable groupé : « Moi » proposé (%s)"%opts)
    pg.select_option('#selbar select[data-sk="who"]',"alice@exemple.test");pg.wait_for_timeout(500)
    ok(all(x["who"]=="alice@exemple.test" for x in pg.evaluate("window.__db.tasks") if x["project_id"]=="p1" and not x.get("deleted_at")),"attribution groupée envoyée au serveur")
    pg.screenshot(path=OUT+"assign.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
