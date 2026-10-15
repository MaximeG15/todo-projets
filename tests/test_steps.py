import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
import json
from playwright.sync_api import sync_playwright
S=OUT
cl=[{"id":"s1","text":"Voir avec Thomas pour le planning de Pierre","done":False},{"id":"s2","text":"Préparer la présentation ppt","done":False},{"id":"s3","text":"Envoyer l'invitation","done":True}]
data={"projects":[{"id":"p1","name":"Projet Bêta","color":"#3FA37A"}],"tasks":[{"id":"a","projectId":"p1","title":"Organiser le kick-off dev","due":"2026-10-16","priority":"normale","status":"todo","createdAt":1,"checklist":cl}],"requests":[],"deleted":[]}
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
def drag(pg,src,dst,below=False):
    a=src.bounding_box();b=dst.bounding_box()
    pg.mouse.move(a["x"]+a["width"]/2,a["y"]+a["height"]/2);pg.mouse.down()
    ty=b["y"]+(b["height"]*0.85 if below else b["height"]*0.15)
    for k in range(1,9):pg.mouse.move(a["x"]+a["width"]/2,a["y"]+(ty-a["y"])*k/8)
    pg.mouse.up();pg.wait_for_timeout(100)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1366,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    pg.add_init_script("if(!sessionStorage.getItem('s')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');sessionStorage.setItem('s','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    order=lambda: [c["id"] for c in json.loads(pg.evaluate("localStorage.getItem('todo-projets')"))["tasks"][0]["checklist"]]
    # vue liste : glisser la 2e étape au-dessus de la 1re
    pg.locator('.task[data-id="a"] .stepstag').click()
    lis=pg.locator('.task[data-id="a"] ul.steps li')
    lis.nth(1).hover()
    drag(pg,lis.nth(1).locator(".grip"),lis.nth(0))
    ok(order()==["s2","s1","s3"],"liste : glisser-déposer enregistre l'ordre %s"%order())
    # édition : glisser la 1re en dernier, sans enregistrer -> rien ; puis enregistrer
    pg.locator('.task[data-id="a"] .ttl').click()
    rows=pg.locator('.task[data-id="a"] .steplist .steprow')
    rows.nth(0).locator('input[type=text]').fill("Préparer la présentation PPT")   # modif de texte avant le tri
    drag(pg,rows.nth(0).locator(".grip"),rows.nth(2),below=True)
    txt=pg.locator('.task[data-id="a"] .steplist input[type=text]').evaluate_all("e=>e.map(x=>x.value)")
    ok(txt==["Voir avec Thomas pour le planning de Pierre","Envoyer l'invitation","Préparer la présentation PPT"],"édition : ordre et texte modifié conservés %s"%txt)
    ok(order()==["s2","s1","s3"],"édition : rien n'est enregistré avant « Enregistrer »")
    # clavier : flèche haut sur la dernière
    pg.locator('.task[data-id="a"] .steplist [data-g="2"]').focus();pg.keyboard.press("ArrowUp")
    txt=pg.locator('.task[data-id="a"] .steplist input[type=text]').evaluate_all("e=>e.map(x=>x.value)")
    ok(txt==["Voir avec Thomas pour le planning de Pierre","Préparer la présentation PPT","Envoyer l'invitation"],"clavier : flèche haut %s"%txt)
    ok(pg.evaluate("document.activeElement.dataset.g")=="1","clavier : le focus suit l'étape")
    pg.screenshot(path=S+"steps_edit.png")
    pg.locator('.task[data-id="a"] [data-k="ok"]').click()
    t=json.loads(pg.evaluate("localStorage.getItem('todo-projets')"))["tasks"][0]["checklist"]
    ok([c["id"] for c in t]==["s1","s2","s3"] and t[1]["text"]=="Préparer la présentation PPT" and t[2]["done"],"enregistrement : ordre, texte et cases cochées")
    # tactile
    m=b.new_context(viewport={"width":390,"height":844},has_touch=True,is_mobile=True).new_page()
    m.add_init_script("localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}')"%json.dumps(json.dumps(data)))
    m.goto(APP);m.wait_for_timeout(300)
    m.locator('.task[data-id="a"] .stepstag').tap();m.wait_for_timeout(150)
    g=m.locator('.task[data-id="a"] ul.steps li').nth(2).locator(".grip");g.scroll_into_view_if_needed();m.wait_for_timeout(100);bb=g.bounding_box();t0=m.locator('.task[data-id="a"] ul.steps li').nth(0).bounding_box()
    cdp=m.context.new_cdp_session(m)
    x=bb["x"]+bb["width"]/2;y=bb["y"]+bb["height"]/2
    cdp.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[{"x":x,"y":y}]})
    for k in range(1,9):cdp.send("Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[{"x":x,"y":y+(t0["y"]+3-y)*k/8}]})
    cdp.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]});m.wait_for_timeout(150)
    o=[c["id"] for c in json.loads(m.evaluate("localStorage.getItem('todo-projets')"))["tasks"][0]["checklist"]]
    ok(o==["s3","s1","s2"],"téléphone : glisser au doigt %s"%o)
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
