import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,on_dialog
import json, openpyxl
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
P=[]
for i,(th,n) in enumerate([("Réception",101),("Réception",102),("Expédition",205),("Expédition",206),("Stock",310)]):
    P.append({"id":"o%d"%i,"projectId":"p","text":"Question %d sur %s"%(n,th.lower()),"answer":"Réponse %d"%n if i==0 else "","hypothesis":"Hypothèse %d"%n if i==1 else "","erp":"oui" if i==2 else "","theme":th,"owner":"client","ownerName":"","status":"open","createdAt":i+1,"xl":{"ver":2,"n":str(n),"k":"","v":{}}})
P.append({"id":"o9","projectId":"p","text":"Point ajouté dans l'appli","answer":"","hypothesis":"","erp":"","theme":"Stock","owner":"","ownerName":"","status":"open","createdAt":99})
T=[{"id":"t1","projectId":"p","title":"Tâche visible","priority":"normale","due":"","status":"todo","createdAt":1}]
data={"projects":[{"id":"p","name":"Projet Alpha","color":"#E0703A"}],"tasks":T,"requests":[],"points":P,"deleted":[]}
with sync_playwright() as pw:
    b=pw.chromium.launch();ctx=b.new_context(viewport={"width":1440,"height":1000},accept_downloads=True);pg=ctx.new_page()
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)));on_dialog(pg,lambda d:d.accept())
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    pg.locator(".pbtn").first.click();pg.locator('#ptabs [data-tab="points"]').click();pg.wait_for_timeout(200)
    nums=pg.eval_on_selector_all(".pt .pnum","e=>e.map(x=>x.textContent.trim())")
    ok("101." in nums and "310." in nums,"N° de l'Excel affichés (%s)"%nums)
    ok(pg.locator('.pt[data-o="o9"] .pnum').inner_text()=="•" and "Hors Excel" in pg.locator('.pt[data-o="o9"]').inner_text(),"point hors Excel : sans numéro, étiqueté")
    # repli
    g=pg.locator(".g-pt",has_text="Réception").first
    g.locator(".foldbtn").click();pg.wait_for_timeout(100)
    ok(pg.locator(".g-pt.folded").count()==1 and pg.locator(".pt").count()==4,"thème replié")
    pg.reload();pg.wait_for_timeout(300);pg.locator(".pbtn").first.click();pg.locator('#ptabs [data-tab="points"]').click()
    ok(pg.locator(".g-pt.folded").count()==1,"repli mémorisé")
    pg.locator(".foldbar [data-f=close]").click();ok(pg.locator(".g-pt.folded").count()==3 and pg.locator(".pt").count()==0,"tout replier")
    pg.locator(".foldbar [data-f=open]").click();ok(pg.locator(".g-pt.folded").count()==0 and pg.locator(".pt").count()==6,"tout déplier")
    # tableau
    pg.locator("#viewbar button",has_text="Tableau").click();pg.wait_for_timeout(100)
    ok(pg.locator(".pttable tbody tr").count()==6,"vue tableau : 6 lignes")
    ok("Hypothèse 102" in pg.locator("#lists").inner_text(),"vue tableau : commentaire Mecalux affiché")
    pg.screenshot(path=OUT+"points_table.png")
    pg.locator('.pttable tr[data-o="o3"]').click();pg.wait_for_timeout(200)
    ok(pg.locator('.pt[data-o="o3"] .edit').count()==1,"clic sur une ligne : ouvre le point en détail")
    # export Excel avec N°
    pg.locator(".ddexp summary").click();pg.locator(".ddexp .menu button",has_text="Points ouverts").click()
    with pg.expect_download() as d: pg.locator("#expxlsx").click()
    d.value.save_as(OUT+"pts_num.xlsx")
    ws=openpyxl.load_workbook(OUT+"pts_num.xlsx").active
    vals=[c.value for row in ws.iter_rows() for c in row]
    ok(101 in vals and 310 in vals,"export Excel : N° de l'Excel")
    pg.keyboard.press("Escape")
    # mobile : barre d'ajout repliée
    pg.set_viewport_size({"width":390,"height":844});pg.locator('#ptabs [data-tab="tasks"]').evaluate("e=>e.click()");pg.wait_for_timeout(200)
    ok(not pg.locator("#quick").is_visible(),"mobile : barre d'ajout repliée")
    pg.locator(".bnav [data-b=add]").click();pg.wait_for_timeout(400)
    ok(pg.locator("#quick").is_visible() and pg.evaluate("document.activeElement.id")=="qt","mobile : + ouvre la saisie")
    pg.fill("#qt","Tâche mobile");pg.keyboard.press("Enter");pg.wait_for_timeout(200)
    ok(pg.locator(".task",has_text="Tâche mobile").count()==1 and pg.locator("#quick").is_visible(),"mobile : ajout, la saisie reste ouverte")
    pg.screenshot(path=OUT+"mobile_open.png")
    print("   fab z",pg.evaluate("getComputedStyle(document.querySelector('#fab')).zIndex"),"sticky z",pg.evaluate("getComputedStyle(document.querySelector('#stickytop')).zIndex"),pg.evaluate("JSON.stringify(document.querySelector('#quick').getBoundingClientRect())"))
    pg.locator(".bnav [data-b=add]").click(timeout=3000);pg.wait_for_timeout(100)
    ok(not pg.locator("#quick").is_visible(),"mobile : + referme la saisie")
    pg.screenshot(path=OUT+"mobile_folded.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
