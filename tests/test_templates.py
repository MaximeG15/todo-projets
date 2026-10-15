import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,FAKE
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
# Modèle fictif (le vrai contenu est en base, pas dans le dépôt)
TPL=[{"id":"x1","template":"af-standard","flow":"Flux A","flow_order":1,"sort":1,"text":"Question A1 ?","hypothesis":"Défaut A1"},
     {"id":"x2","template":"af-standard","flow":"Flux A","flow_order":1,"sort":2,"text":"Question A2 ?","hypothesis":""},
     {"id":"x3","template":"af-standard","flow":"Flux B","flow_order":2,"sort":1,"text":"Question B1 ?","hypothesis":""}]
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":950})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE)
    pg.add_init_script("window.__db.point_templates=%s"%__import__("json").dumps(TPL))
    pg.add_init_script("localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(1000)
    pg.fill("#newp","Projet Gamma");pg.locator("#addp button").click();pg.wait_for_timeout(900)
    d=pg.locator("dialog.uidlg")
    ok(d.count()==1 and "Projet Gamma" in d.inner_text() and "Flux A" in d.inner_text(),"nouveau projet : proposition des points standard")
    ok("3 points" in d.locator("[data-n]").inner_text(),"tous les flux cochés par défaut")
    d.locator('[data-f="1"]').uncheck();ok("2 points" in d.locator("[data-n]").inner_text(),"choix flux par flux")
    d.locator("[data-ok]").click();pg.wait_for_timeout(1200)
    pid=[p["id"] for p in pg.evaluate("window.__db.projects") if p["name"]=="Projet Gamma"][0]
    rows=[o for o in pg.evaluate("window.__db.open_points||[]") if o["project_id"]==pid]
    ok(len(rows)==2 and all(o["theme"]=="Flux A" and o["owner"]=="client" for o in rows),"points créés en ligne, thème = flux, à répondre par le client")
    ok(any(o["hypothesis"]=="Défaut A1" for o in rows),"valeur par défaut du modèle en commentaire")
    # ajout ultérieur depuis le menu : seuls les points manquants sont proposés
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="points ouverts standard").click();pg.wait_for_timeout(500)
    d=pg.locator("dialog.uidlg")
    ok(d.locator('[data-f="0"]').is_disabled() and "1 point" in d.locator("[data-n]").inner_text(),"menu : flux déjà présents grisés")
    d.locator("[data-ok]").click();pg.wait_for_timeout(1200)
    rows=[o for o in pg.evaluate("window.__db.open_points||[]") if o["project_id"]==pid]
    ok(len(rows)==3,"ajout du flux manquant sans doublon")
    # projet vide
    pg.fill("#newp","Projet Delta");pg.locator("#addp button").click();pg.wait_for_timeout(900)
    pg.locator("dialog.uidlg [data-x]").click();pg.wait_for_timeout(500)
    pid2=[p["id"] for p in pg.evaluate("window.__db.projects") if p["name"]=="Projet Delta"][0]
    ok(not [o for o in pg.evaluate("window.__db.open_points||[]") if o["project_id"]==pid2],"projet vide si refus")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
