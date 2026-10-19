import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,FAKE,on_dialog
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    # mode local : lien discret, information, aucun service tiers chargé
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":950})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    ext=[];base=APP.rsplit("/",1)[0]
    pg.on("request",lambda r:ext.append(r.url) if not r.url.startswith(base) and not r.url.startswith("data:") and not r.url.startswith("blob:") else None)
    pg.add_init_script("localStorage.setItem('todo-mode','local')")
    pg.goto(APP);pg.wait_for_timeout(800)
    ok(not ext,"aucune requête vers un service tiers (polices et bibliothèque locales)")
    ok(not pg.locator("#privacybtn").is_visible(),"lien discret : masqué tant que « Fichier et sauvegarde » est replié")
    pg.locator("#toolstitle").click();pg.locator("#privacybtn").click()
    d=pg.locator("dialog.privdlg")
    ok(d.is_visible() and "30 jours" in d.inner_text() and "navigateur" in d.inner_text(),"page d'information (mode local)")
    ok(d.locator("[data-del]").count()==0,"mode local : pas de suppression de compte")
    with pg.expect_download() as dl: d.locator("[data-exp]").click()
    ok(dl.value.suggested_filename.endswith(".json"),"exporter mes données")
    b.close()
    # mode local : contacts d'un projet archivé depuis plus de 6 mois effacés, comptes rendus supprimés depuis 30 jours effacés
    import json,time
    now=int(time.time()*1000)
    data={"projects":[{"id":"a","name":"Ancien","color":"#999","archived":True,"archivedAt":now-200*864e5,"contacts":[{"id":"c1","name":"Contact A","side":"client"}]},
                      {"id":"b","name":"Récent","color":"#999","archived":True,"archivedAt":now-10*864e5,"contacts":[{"id":"c2","name":"Contact B","side":"client"}],
                       "meetings":[{"id":"m1","projectId":"b","title":"Vieux CR","status":"draft","deletedAt":now-40*864e5},{"id":"m2","projectId":"b","title":"CR","status":"draft"}]}],
          "tasks":[],"requests":[],"points":[],"deleted":[]}
    b=pw.chromium.launch();pg=b.new_page()
    pg.add_init_script("localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local')"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(600)
    st=pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")
    ok(st["projects"][0].get("contacts")==[] and len(st["projects"][1]["contacts"])==1,"contacts d'un projet archivé depuis plus de 6 mois effacés")
    ok([m["id"] for m in st["projects"][1]["meetings"]]==["m2"],"compte rendu supprimé depuis plus de 30 jours effacé")
    b.close()
    # mode en ligne : hébergement UE, suppression du compte avec double confirmation
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":950})
    pg.on("pageerror",lambda e:errs.append("JS2: "+str(e)))
    answers=["ok","alice@exemple.test","ok"]
    on_dialog(pg,lambda dl:dl.accept("alice@exemple.test") if dl.type=="prompt" else dl.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script("localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(1000)
    pg.locator("#toolstitle").click();pg.locator("#privacybtn").click()
    d=pg.locator("dialog.privdlg")
    ok("Irlande" in d.inner_text() and "12 semaines" in d.inner_text(),"mode en ligne : hébergement UE et durées affichés")
    d.locator("[data-del]").click();pg.wait_for_timeout(800)
    ok(pg.evaluate("sessionStorage.getItem('__rpc')")=="delete_my_account;","suppression du compte demandée au serveur")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
