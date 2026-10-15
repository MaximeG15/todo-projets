import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
import json
from playwright.sync_api import sync_playwright
S=OUT
pts=synthetic_points()
P=[{"id":"o%d"%i,"projectId":"d","text":o["text"],"answer":o["answer"],"hypothesis":o["hypothesis"],"erp":o["erp"],"theme":o["theme"],"owner":o["owner"],"ownerName":"","status":o["status"],"createdAt":o["created_at"]} for i,o in enumerate(pts)]
data={"projects":[{"id":"d","name":"Projet Alpha","color":"#E0703A"}],"tasks":[],"requests":[],"points":P,"deleted":[]}
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    pg.locator(".pbtn").first.click();pg.locator('#ptabs [data-tab="points"]').click()
    n=lambda: pg.locator(".pt").count()
    ok(n()==75,"sans filtre : 75 points ouverts")
    pg.locator('.chip[data-t="Réception"]').click()
    heads=pg.eval_on_selector_all(".g-pt h2","e=>e.map(x=>(x.querySelector('.ft')||x.firstChild).textContent.trim())")
    ok(n()==11 and heads==["Réception"],"filtre Réception : 11 points")
    pg.locator('.chip[data-t="Expédition"]').click()
    ok(n()==25,"Réception + Expédition : 25 points (%d)"%n())
    pg.locator(".chip[data-erp]").click()
    ok(n()==5,"+ sujets ERP uniquement : %d"%n())
    pg.screenshot(path=S+"filt.png")
    pg.reload();pg.wait_for_selector(".pbtn");pg.wait_for_timeout(300);pg.locator(".pbtn").first.click();pg.locator('#ptabs [data-tab="points"]').click()
    ok(n()==5,"filtres mémorisés après rechargement")
    pg.locator("[data-reset]").click()
    ok(n()==75,"effacer les filtres")
    pg.locator('.chip[data-t="Réception"]').click();pg.locator('.chip[data-all]').click()
    ok(n()==75,"Tous les thèmes")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
