import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,on_dialog
import json
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
T=[{"id":"a","projectId":"p","title":"Tâche en retard","priority":"haute","due":"2020-01-01","status":"todo","createdAt":1,"checklist":[{"id":"s1","text":"Étape 1","done":True},{"id":"s2","text":"Étape 2","done":False}]},
   {"id":"b","projectId":"p","title":"Tâche normale","priority":"normale","due":"","status":"waiting","createdAt":2}]
P=[{"id":"o1","projectId":"p","text":"Question client","answer":"","hypothesis":"","erp":"","theme":"Réception","owner":"client","ownerName":"","status":"open","createdAt":1}]
data={"projects":[{"id":"p","name":"Projet Alpha","color":"#E0703A"}],"tasks":T,"requests":[],"points":P,"deleted":[]}
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)));on_dialog(pg,lambda d:d.accept())
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    pg.locator(".pbtn").first.click()
    k=pg.locator("#kpis").inner_text();print("   ",k.replace("\n"," | "))
    ok("tâches ouvertes" in k and "en retard" in k and "point ouvert" in k,"bandeau d'indicateurs du projet")
    ok(pg.locator('.task[data-id="a"].late').count()==1,"tâche en retard repérée")
    ok(not pg.locator('.task[data-id="a"] ul.steps').is_visible(),"étapes repliées dans la liste")
    pg.locator('.task[data-id="a"] .stepstag').click()
    ok(pg.locator('.task[data-id="a"] ul.steps').is_visible(),"étapes dépliées par l'étiquette")
    pg.locator('.task[data-id="a"] .ttl').click();pg.wait_for_timeout(200)
    d=pg.locator(".edit.drawer")
    box=d.bounding_box();print("   ",box)
    ok(d.count()==1 and box["x"]>=1000 and box["height"]>=899,"détail ouvert dans le panneau de droite")
    ok(pg.locator('.task[data-id="a"].open').count()==1 and "Projet Alpha" in d.locator(".dkick").inner_text(),"ligne active et en-tête du panneau")
    ok(d.locator(".dfield",has_text="Échéance").count()==1,"champs libellés")
    d.locator('input[aria-label="Intitulé"]').fill("Tâche renommée");d.locator('[data-k=ok]').click();pg.wait_for_timeout(200)
    ok(json.loads(pg.evaluate("localStorage.getItem('todo-projets')"))["tasks"][0]["title"]=="Tâche renommée","enregistrement depuis le panneau")
    pg.locator('.task[data-id="b"] .ttl').click();pg.keyboard.press("Escape");pg.wait_for_timeout(200)
    ok(pg.locator(".edit.drawer").count()==0,"Échap ferme le panneau")
    pg.locator('#ptabs [data-tab="points"]').click()
    ok(pg.locator("#kpis .ptbar").count()==1 and "à répondre par le client" in pg.locator("#kpis").inner_text(),"points : barre de répartition")
    pg.screenshot(path=OUT+"cockpit_points.png")
    # téléphone
    pg.set_viewport_size({"width":390,"height":844});pg.wait_for_timeout(200)
    ok(pg.locator("#bnav").is_visible() and not pg.locator("#views").is_visible(),"téléphone : barre de navigation en bas")
    pg.locator('#bnav [data-b="today"]').click();pg.wait_for_timeout(200)
    ok(pg.locator("#ptitle").inner_text()=="Ma journée" and pg.locator('#bnav [data-b="today"][aria-current="true"]').count()==1,"téléphone : Ma journée")
    pg.locator('#bnav [data-b="menu"]').click()
    ok(pg.locator(".pjgrid .pjt").count()>=1 and pg.locator(".pjviews").count()==0,"téléphone : Projets ouvre l'écran des projets (les vues sont dans le menu ☰)")
    ok(pg.evaluate("document.documentElement.scrollWidth<=390"),"téléphone : pas de débordement")
    pg.screenshot(path=OUT+"cockpit_mobile.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
