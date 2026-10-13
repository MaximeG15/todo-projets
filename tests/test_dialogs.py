import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
import json
from playwright.sync_api import sync_playwright
S=OUT
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
data={"projects":[{"id":"p1","name":"Projet Alpha","color":"#E0703A"}],"tasks":[{"id":"a","projectId":"p1","title":"Tâche A","status":"todo","priority":"normale","due":"","createdAt":1,"requestId":"r1"}],
 "requests":[{"id":"r1","projectId":"p1","title":"Demande test","status":"new","priority":"normale","createdAt":1}],"points":[],"deleted":[]}
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1280,"height":800})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    native=[];pg.on("dialog",lambda d:(native.append(d.message),d.dismiss()))
    pg.add_init_script("if(!localStorage.getItem('seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui',JSON.stringify({mode:'list',scope:'all'}));localStorage.setItem('seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(400)
    pg.locator(".pbtn",has_text="Projet Alpha").click()
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="Renommer").click()
    d=pg.locator("dialog.uidlg");ok(d.is_visible(),"prompt intégré affiché")
    ok(pg.evaluate("document.activeElement.value")=="Projet Alpha","valeur par défaut sélectionnée et focus")
    pg.screenshot(path=S+"dlg_prompt.png")
    pg.keyboard.type("Projet Bêta");pg.keyboard.press("Enter");pg.wait_for_timeout(200)
    ok(d.count()==0 and pg.locator(".pbtn",has_text="Projet Bêta").count()==1,"Entrée valide le renommage")
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="Renommer").click()
    pg.keyboard.type("Zzz");pg.keyboard.press("Escape");pg.wait_for_timeout(200)
    ok(d.count()==0 and pg.locator(".pbtn",has_text="Projet Bêta").count()==1,"Échap annule")
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="Supprimer le projet").click()
    ok("irréversible" in d.inner_text(),"confirmation suppression projet")
    ok(pg.evaluate("document.activeElement.textContent")=="Annuler","focus sur Annuler pour une action destructrice")
    pg.screenshot(path=S+"dlg_confirm.png")
    pg.keyboard.press("Escape");pg.wait_for_timeout(200)
    ok(pg.locator(".pbtn",has_text="Projet Bêta").count()==1,"projet conservé après Échap")
    # demande liée : 3 choix
    pg.locator("#ptabs button",has_text="Demandes").click();pg.wait_for_timeout(200)
    row=pg.locator('.req[data-r="r1"]');row.locator("details.more summary").click();row.locator('[data-a="del"]').click();pg.wait_for_timeout(200)
    ok(d.locator("button").count()==3,"suppression demande : 3 choix")
    pg.screenshot(path=S+"dlg_req.png")
    d.locator("button",has_text="Garder").click();pg.wait_for_timeout(200)
    st=pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")
    ok(st["requests"][0].get("deletedAt") and not st["tasks"][0].get("deletedAt"),"« Garder la tâche » : demande seule à la corbeille")
    ok(not native,"aucune boîte native %s"%native)
    pg.set_viewport_size({"width":390,"height":800})
    pg.locator(".pbtn",has_text="Projet Bêta").first.evaluate("e=>e.click()")
    pg.evaluate("document.querySelector('.ddmore summary').click()");pg.locator(".ddmore .menu button",has_text="Supprimer le projet").click()
    pg.screenshot(path=S+"dlg_mobile.png")
    b.close()
print("ERREURS:",errs) if errs else print("TOUT OK")
sys.exit(1 if errs else 0)
