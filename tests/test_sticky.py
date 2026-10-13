import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
import json
from playwright.sync_api import sync_playwright
S=OUT
pts=synthetic_points()
P=[{"id":"o%d"%i,"projectId":"d","text":o["text"],"answer":"","hypothesis":o["hypothesis"],"erp":o["erp"],"theme":o["theme"],"owner":"","ownerName":"","status":o["status"],"createdAt":o["created_at"]} for i,o in enumerate(pts)]
T=[{"id":"t%d"%i,"projectId":"d","title":"Tâche numéro %d"%i,"due":"2026-10-%02d"%(10+i%15),"priority":"normale","status":"todo","createdAt":i} for i in range(40)]
data={"projects":[{"id":"d","name":"Projet Alpha","color":"#E0703A"}],"tasks":T,"requests":[],"points":P,"deleted":[]}
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for w,h in [(1163,800),(1920,1000)]:
        pg=b.new_page(viewport={"width":w,"height":h})
        pg.on("pageerror",lambda e:errs.append(str(e)))
        pg.add_init_script("localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}')"%json.dumps(json.dumps(data)))
        pg.goto(APP);pg.wait_for_timeout(300)
        pg.locator(".pbtn").first.click()
        top0=pg.locator("#quick").bounding_box()["y"]
        pg.mouse.wheel(0,2500);pg.wait_for_timeout(300)
        q=pg.locator("#quick").bounding_box();tabs=pg.locator("#ptabs").bounding_box()
        ok(0<=q["y"]<200 and pg.locator("#stickytop.compact").count()==1,f"{w}px tâches : barre d'ajout visible après défilement (y={round(q['y'])}, avant {round(top0)})")
        if w==1163:pg.screenshot(path=S+"sticky_tasks.png")
        pg.locator("#qt").fill("Nouvelle tâche figée");pg.keyboard.press("Enter")
        ok(any(t["title"]=="Nouvelle tâche figée" for t in json.loads(pg.evaluate("localStorage.getItem('todo-projets')"))["tasks"]),"ajout depuis la barre figée")
        pg.evaluate("window.scrollTo(0,0)");pg.wait_for_timeout(200)
        pg.locator('#ptabs [data-tab="points"]').click();pg.wait_for_timeout(200)
        pg.mouse.wheel(0,4000);pg.wait_for_timeout(300)
        a=pg.locator("#ptadd").bounding_box()
        ok(0<=a["y"]<200,f"{w}px points : barre d'ajout des points visible (y={round(a['y'])})")
        if w==1163:pg.screenshot(path=S+"sticky_pts.png")
        pg.evaluate("window.scrollTo(0,0)");pg.wait_for_timeout(200)
        ok(pg.locator("#stickytop.compact").count()==0 and pg.locator("#ptools").is_visible(),"retour en haut : en-tête complet")
        pg.close()
    m=b.new_page(viewport={"width":390,"height":844})
    m.add_init_script("localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}')"%json.dumps(json.dumps(data)))
    m.goto(APP);m.wait_for_timeout(300)
    m.mouse.wheel(0,3000);m.wait_for_timeout(200)
    ok(m.locator("#quick").bounding_box()["y"]<0,"téléphone : pas d'en-tête figé (bouton + flottant)")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
