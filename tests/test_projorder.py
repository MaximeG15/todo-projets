import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog
import json
from playwright.sync_api import sync_playwright
# Ordre des projets : glisser-déposer dans la barre de gauche (souris), Alt+flèches, ordre conservé, enregistré en ligne
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
P=[{"id":"p%d"%i,"name":n,"color":"#3E7CB1"} for i,n in enumerate(["Diamond Europe","Ladrôme","Perso/RH/Autres","Projet test"])]
data={"projects":P,"tasks":[],"requests":[],"points":[],"deleted":[]}
def drag(pg,src,dst_index):
    items=pg.locator("#plist li.pli")
    a=items.nth(src).bounding_box();b=items.nth(dst_index).bounding_box()
    pg.mouse.move(a["x"]+60,a["y"]+a["height"]/2);pg.mouse.down()
    ty=b["y"]+(b["height"]*0.2 if dst_index<src else b["height"]*0.8)
    for k in range(1,11):pg.mouse.move(a["x"]+60,a["y"]+a["height"]/2+(ty-a["y"]-a["height"]/2)*k/10);pg.wait_for_timeout(16)
    pg.mouse.up();pg.wait_for_timeout(500)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    pg=b.new_page(viewport={"width":1440,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(400)
    order=lambda:pg.locator("#plist li.pli .pname").all_inner_texts()
    drag(pg,3,0)
    ok(order()==["Projet test","Diamond Europe","Ladrôme","Perso/RH/Autres"],"glisser « Projet test » en tête (%s)"%order())
    ok(pg.locator("#ptitle").inner_text().startswith("Ma journée") or "Projet test" not in pg.locator("#ptitle").inner_text(),"le glisser n'ouvre pas le projet")
    pg.locator("#plist li.pli .pbtn").nth(1).click();pg.wait_for_timeout(200)
    ok("Diamond Europe" in pg.locator("#ptitle").inner_text(),"un clic simple ouvre toujours le projet")
    pg.locator("#plist li.pli .pbtn").nth(0).focus();pg.keyboard.press("Alt+ArrowDown");pg.wait_for_timeout(200)
    ok(order()[:2]==["Diamond Europe","Projet test"],"Alt+flèche bas : projet descendu d'un cran")
    pg.reload();pg.wait_for_timeout(400)
    ok(order()==["Diamond Europe","Projet test","Ladrôme","Perso/RH/Autres"],"ordre conservé après rechargement")
    pg.close()
    # téléphone : l'écran Projets suit le même ordre
    m=b.new_page(viewport={"width":390,"height":844});on_dialog(m,lambda d:d.accept("Nouveau client" if d.type=="prompt" else None));m.add_init_script("localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local')"%json.dumps(json.dumps({**data,"projects":[P[0],P[3],P[1],P[2]]})))
    m.goto(APP);m.wait_for_timeout(400)
    ok(m.locator(".pjt[data-p] b").all_inner_texts()[:2]==["Diamond Europe","Projet test"],"téléphone : écran Projets dans le même ordre")
    m.locator(".bnav [data-b=add]").click();m.wait_for_timeout(400)
    ok(m.locator("#__none").count()==0 and m.evaluate("JSON.parse(localStorage.getItem('todo-projets')).projects.some(p=>p.name==='Nouveau client')"),"téléphone : le + de l'écran Projets crée un projet")
    m.close()
    # en ligne : ordre enregistré dans le profil
    pg=b.new_page(viewport={"width":1440,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS2: "+str(e)))
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script("window.__db.profiles[0].user_id='u1';localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(1200)
    names=pg.locator("#plist li.pli .pname").all_inner_texts()
    drag(pg,len(names)-1,0);pg.wait_for_timeout(600)
    prof=pg.evaluate("window.__db.profiles[0].project_order")
    ok(prof and pg.locator("#plist li.pli .pname").all_inner_texts()[0]==names[-1],"en ligne : ordre enregistré dans le profil (%s)"%prof)
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
