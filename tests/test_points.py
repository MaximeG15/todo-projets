import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
import json
from playwright.sync_api import sync_playwright
S=OUT
data={"projects":[{"id":"p1","name":"Projet Bêta","color":"#3FA37A"},{"id":"p2","name":"Projet Alpha","color":"#E0703A"}],"tasks":[],"requests":[],"deleted":[]}
PASTE="""Points ouverts :

• gestion de la disponibilité client => par contrat date dans la ligne d'expé ?
• gestion de la DDM (best before) et/ou de la DLC (expiration) ?
• où récupérer les phrases de risque ?
• où et comment récupérer le titre alcool ?
"""
errs=[];answers=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();ctx=b.new_context(viewport={"width":1440,"height":1000},accept_downloads=True)
    ctx.grant_permissions(["clipboard-read","clipboard-write"])
    pg=ctx.new_page()
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    msgs=[]
    def dlg(d):
        msgs.append(d.message)
        d.accept(answers.pop(0) if (d.type=="prompt" and answers) else ("" if d.type=="prompt" else None)) if d.type=="prompt" else d.accept()
    on_dialog(pg,dlg)
    pg.add_init_script("if(!sessionStorage.getItem('s')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');sessionStorage.setItem('s','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    st=lambda: pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")
    pts=lambda: [o for o in st().get("points",[]) if not o.get("deletedAt")]
    pg.locator(".pbtn",has_text="Projet Bêta").click()
    ok(pg.locator('#ptabs [data-tab="points"]').count()==1,"onglet Points ouverts présent")
    pg.locator('#ptabs [data-tab="points"]').click()
    ok(pg.locator("#ptadd").is_visible() and pg.locator("#quick").is_hidden(),"barre dédiée aux points")
    # collage
    answers.append("Réception");pg.locator('#ptadd [data-q="theme"]').select_option("__new");pg.wait_for_timeout(100)
    ok(pg.locator('#ptadd [data-q="theme"]').input_value()=="Réception","nouveau thème créé et sélectionné")
    pg.locator('#ptadd [data-q="owner"]').select_option("client")
    pg.evaluate("t=>navigator.clipboard.writeText(t)",PASTE)
    pg.locator('#ptadd [data-q="text"]').click();pg.keyboard.press("Control+V");pg.wait_for_timeout(200)
    P=pts();print("   ",[o["text"] for o in P])
    ok(len(P)==4 and P[0]["text"].startswith("gestion de la disponibilité") and all(o["theme"]=="Réception" and o["owner"]=="client" for o in P),"collage : 4 points, puces et titre retirés, thème et interlocuteur appliqués")
    # un par un, autre thème
    answers.append("Interface Sage X3");pg.locator('#ptadd [data-q="theme"]').select_option("__new");pg.wait_for_timeout(100);pg.locator('#ptadd [data-q="owner"]').select_option("tiers")
    pg.locator('#ptadd [data-q="text"]').fill("Format du fichier d'articles ?");pg.keyboard.press("Enter")
    ok(len(pts())==5,"ajout un par un")
    heads=pg.eval_on_selector_all(".g-pt h2","e=>e.map(x=>(x.querySelector('.ft')||x.firstChild).textContent.trim())")
    ok(heads==["Interface Sage X3","Réception"],"regroupement par thème %s"%heads)
    ok("1." in pg.locator(".g-pt").nth(1).inner_text(),"numérotation")
    pg.screenshot(path=S+"pts.png")
    # lever avec réponse
    first=pts()[0]["id"]
    answers.append("Date de dispo saisie dans la ligne de commande")
    pg.locator(f'.pt[data-o="{first}"] .chk').click();pg.wait_for_timeout(100)
    o=[x for x in pts() if x["id"]==first][0]
    ok(o["status"]=="closed" and o["answer"].startswith("Date de dispo"),"lever un point avec réponse")
    pg.locator("#toast button").click();o=[x for x in pts() if x["id"]==first][0]
    ok(o["status"]=="open" and o["answer"]=="","annuler la levée")
    # édition
    pg.locator(f'.pt[data-o="{first}"] .ttl').click()
    e=pg.locator(f'.pt[data-o="{first}"] .edit')
    e.locator('[data-f="oname"]').fill("M. Martin");e.locator('[data-f="ans"]').fill("Par contrat");e.locator('[data-f="st"]').select_option("closed");e.locator('[data-k="ok"]').click()
    o=[x for x in pts() if x["id"]==first][0]
    ok(o["ownerName"]=="M. Martin" and o["status"]=="closed" and o["answer"]=="Par contrat","modifier / répondre")
    ok(pg.locator(".showdone").count()==1,"points levés repliés")
    # tâche / demande liée
    second=sorted(pts(),key=lambda x:x["createdAt"])[1]["id"]
    r=pg.locator(f'.pt[data-o="{second}"]');r.locator("details.more summary").click();r.locator('[data-a="task"]').click()
    tk=[t for t in st()["tasks"]]
    ok(len(tk)==1 and [x for x in pts() if x["id"]==second][0]["taskId"]==tk[0]["id"],"créer une tâche liée")
    r=pg.locator(f'.pt[data-o="{second}"]');r.locator("details.more summary").click();r.locator('[data-a="req"]').click()
    rq=st()["requests"]
    ok(len(rq)==1 and rq[0]["requester"]=="" and [x for x in pts() if x["id"]==second][0]["requestId"]==rq[0]["id"],"créer une demande client liée")
    ok(pg.locator(f'.pt[data-o="{second}"] .reqtag').count()==2,"liens affichés sur le point")
    # renommer thème
    answers.append("Interfaces")
    pg.locator(".g-pt",has_text="Interface Sage X3").locator(".thren").click()
    ok(any(x["theme"]=="Interfaces" for x in pts()),"renommer un thème")
    # corbeille
    r=pg.locator(f'.pt[data-o="{second}"]');r.locator("details.more summary").click();r.locator('[data-a="del"]').click()
    ok(len(pts())==4,"point à la corbeille")
    pg.locator(".vbtn",has_text="Corbeille").click()
    ok("Point ouvert" in pg.locator("#lists").inner_text(),"listé dans la corbeille")
    pg.locator(".trow",has=pg.locator(".reqtag",has_text="Point ouvert")).locator("[data-r]").click()
    ok(len(pts())==5,"restauré")
    # thème créé à l'avance, sans point
    pg.locator(".pbtn",has_text="Projet Bêta").click();pg.locator('#ptabs [data-tab="points"]').click()
    answers.append("Inventaire");pg.locator('#ptadd [data-q="theme"]').select_option("__new");pg.wait_for_timeout(100)
    ok(pg.locator('.chip[data-t="Inventaire"]').count()==1,"thème vide visible dans les filtres")
    ok("Inventaire" in [p.get("name") for pr in st()["projects"] for p in pr.get("pointThemes",[])],"thème enregistré dans le projet")
    # édition : changer de thème, renommer et supprimer
    pid0=sorted(pts(),key=lambda x:x["createdAt"])[2]["id"]
    pg.locator(f'.pt[data-o="{pid0}"] .ttl').click()
    pg.locator(f'.pt[data-o="{pid0}"] [data-f="theme"]').select_option("Inventaire")
    pg.locator(f'.pt[data-o="{pid0}"] [data-k="ok"]').click()
    ok([x for x in pts() if x["id"]==pid0][0]["theme"]=="Inventaire","changer de thème via la liste")
    pg.locator(f'.pt[data-o="{pid0}"] .ttl').click()
    answers.append("Inventaires tournants");pg.locator(f'.pt[data-o="{pid0}"] [data-th="ren"]').click();pg.wait_for_timeout(100)
    ok([x for x in pts() if x["id"]==pid0][0]["theme"]=="Inventaires tournants" and pg.locator(f'.pt[data-o="{pid0}"] [data-f="theme"]').input_value()=="Inventaires tournants","renommer depuis le détail")
    pg.locator(f'.pt[data-o="{pid0}"] [data-th="del"]').click();pg.wait_for_timeout(100)
    ok([x for x in pts() if x["id"]==pid0][0]["theme"]=="" and pg.locator('.chip[data-t="Inventaires tournants"]').count()==0,"supprimer un thème")
    pg.locator(f'.pt[data-o="{pid0}"] [data-k="ko"]').click()
    # export
    pg.locator(".pbtn",has_text="Projet Bêta").click();pg.locator('#ptabs [data-tab="points"]').click()
    pg.locator(".ddexp summary").click();pg.locator(".ddexp .menu button",has_text="Points ouverts").click()
    ok(pg.locator('#expkind [data-k="points"]').get_attribute("aria-pressed")=="true" and pg.locator("#expopt-p").is_visible(),"export : Points ouverts présélectionné")
    pg.locator("#expptclosed").check()
    with pg.expect_download() as d: pg.locator("#expxlsx").click()
    d.value.save_as(S+"points.xlsx");print("   ",d.value.suggested_filename)
    pg.locator("#exppdf").click();pg.wait_for_timeout(300)
    html=pg.evaluate("[...document.querySelectorAll('iframe')].pop().srcdoc");open(S+"points.html","w").write(html)
    ok("Points ouverts – Projet Bêta" in html and "Réception" in html and "Levé" in html,"export PDF")
    pg.locator('#expkind [data-k="tasks"]').click()
    with pg.expect_download() as d: pg.locator("#expxlsx").click()
    ok(d.value.suggested_filename.startswith("plan-actions-"),"export tâches renommé Plan d'actions : "+d.value.suggested_filename)
    pg.locator("#expdlg .btn.ghost").click()
    pg.locator(".vbtn",has_text="Tableau de bord").click()
    ok("Points ouverts" in pg.locator(".dtable").first.text_content(),"colonne Points ouverts au tableau de bord")
    pg.set_viewport_size({"width":390,"height":844});pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Bêta").click();pg.locator(".phtile",has_text="Points ouverts").click();pg.wait_for_timeout(200)
    ok(pg.evaluate("document.documentElement.scrollWidth")<=390,"mobile : pas de débordement")
    pg.screenshot(path=S+"pts_m.png",full_page=True)
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
