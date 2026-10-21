import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
import json
from playwright.sync_api import sync_playwright
S=OUT
pts=synthetic_points()
P=[{"id":"o%d"%i,"projectId":"d","text":o["text"],"answer":"","hypothesis":o["hypothesis"],"erp":o["erp"],"theme":o["theme"],"owner":"","ownerName":"","status":o["status"],"createdAt":o["created_at"]} for i,o in enumerate(pts)]
T=[{"id":"t1","projectId":"d","title":"Préparer l'atelier réception","due":"2026-10-15","priority":"normale","status":"todo","createdAt":1},
   {"id":"t2","projectId":"l","title":"Faire valider la partie Réception + Convoyeur","due":"2026-10-16","priority":"normale","status":"todo","createdAt":2},
   {"id":"t3","projectId":"l","title":"Commander les étiquettes","due":"","priority":"normale","status":"todo","note":"voir format avec la réception","createdAt":3}]
R=[{"id":"r1","projectId":"l","title":"Ajout d'un contrôle en réception","description":"Le client veut un contrôle qualité","requester":"M. Martin","received":"2026-10-10","due":"2026-10-20","priority":"normale","status":"new","scope":"","estimate":None,"quote":"","createdAt":1}]
data={"projects":[{"id":"d","name":"Projet Alpha","color":"#E0703A"},{"id":"l","name":"Projet Bêta","color":"#2F7D5B"}],"tasks":T,"requests":R,"points":P,"deleted":[]}
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1366,"height":900})
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.add_init_script("if(!sessionStorage.getItem('s')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');sessionStorage.setItem('s','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    pg.keyboard.press("Control+k");pg.wait_for_timeout(200)
    ok(pg.locator("dialog.cmdk").is_visible() and pg.evaluate("document.activeElement.closest('dialog.cmdk')!==null"),"Ctrl+K ouvre « Rechercher ou créer »")
    pg.keyboard.type("reception");pg.wait_for_timeout(300)
    ok("Rechercher « reception » partout" in pg.locator("dialog.cmdk").inner_text() and pg.locator("dialog.cmdk .cmdi").count()>3,"résultats et actions proposés")
    pg.screenshot(path=S+"cmdk.png")
    pg.keyboard.press("Enter");pg.wait_for_timeout(400)
    ok(pg.evaluate("document.querySelector('#search').value")=="reception" and pg.locator("dialog.cmdk").count()==0,"Entrée : recherche partout")
    sub=pg.locator("#psub").inner_text();print("   ",sub)
    ok(pg.locator(".task:not(.pt):not(.req)").count()==3,"3 tâches trouvées (titre et note, sans accent)")
    ok(pg.locator(".pt").count()>=10 and pg.locator(".req").count()==1,"points ouverts et demande trouvés")
    ok(pg.locator(".pt mark").count()>0 and pg.locator(".req mark").count()>0,"mots surlignés")
    ok(pg.locator(".pt .tag",has_text="Projet Alpha").count()>0,"projet affiché sur les points (recherche globale)")
    pg.screenshot(path=S+"search.png")
    # plusieurs mots
    pg.fill("#search","numéro série");pg.wait_for_timeout(400)
    n=pg.locator(".pt").count();ok(n>=3,"plusieurs mots : %d points"%n)
    # dans un projet
    pg.fill("#search","");pg.wait_for_timeout(300)
    pg.locator(".pbtn",has_text="Projet Bêta").click()
    pg.fill("#search","reception");pg.wait_for_timeout(400)
    ok(pg.locator(".pt").count()==0 and pg.locator(".req").count()==1 and pg.locator(".task:not(.pt):not(.req)").count()==2,"limitée au projet ouvert")
    # modifier un point depuis les résultats
    pg.locator(".pbtn",has_text="Alpha").click();pg.fill("#search","FIFO");pg.wait_for_timeout(400)
    pg.locator(".pt .ttl").first.click();pg.wait_for_timeout(100)
    ok(pg.locator(".pt .edit").count()==1,"ouvrir un point depuis la recherche")
    pg.fill("#search","zzzz");pg.wait_for_timeout(400)
    ok("Aucun résultat" in pg.locator("#lists").inner_text(),"aucun résultat : message")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
