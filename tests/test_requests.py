import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
import json,time
from playwright.sync_api import sync_playwright
S=OUT
P=[{"id":"p1","name":"Projet Alpha","color":"#E0703A"},{"id":"p2","name":"Projet Bêta","color":"#3FA37A"}]
T=[{"id":"a","projectId":"p1","title":"Tâche existante","due":"2026-10-14","priority":"normale","status":"todo","createdAt":1}]
R=[{"id":"r0","projectId":"p2","title":"Interface Sage X3 : ajout du lot","requester":"M. Martin","received":"2026-10-05","due":"2026-10-09","priority":"haute","status":"analysis","scope":"out","estimate":3,"quote":"todo","createdAt":1}]
data={"projects":P,"tasks":T,"requests":R,"deleted":[]}
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.add_init_script("if(!sessionStorage.getItem('s')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');sessionStorage.setItem('s','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(400)
    st=lambda: pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")
    rq=lambda i:[r for r in st()["requests"] if r["id"]==i]
    ok(pg.locator(".vbtn",has_text="Demandes client").locator(".n").inner_text()=="1","compteur Demandes client (vue globale)")
    pg.locator(".pbtn",has_text="Projet Alpha").click()
    ok(pg.locator("#ptabs").is_visible() and pg.locator('#ptabs [data-tab="requests"]').count()==0,"onglets du projet visibles, sans onglet Demandes client")
    pg.locator(".vbtn",has_text="Demandes client").click()
    ok(pg.locator("#reqadd").is_visible() and pg.locator("#quick").is_hidden(),"vue Demandes client : formulaire dédié")
    f=pg.locator("#reqadd");f.locator('[data-q="proj"]').select_option(label="Projet Alpha");f.locator('[data-q="title"]').fill("Modifier l'étiquette colis");f.locator('[data-q="who"]').fill("Mme Durand");f.locator('[data-q="due"]').fill("2026-10-16");f.locator('[data-q="prio"]').select_option("haute");f.locator(".qadd").click()
    rs=[r for r in st()["requests"] if r["projectId"]=="p1"]
    ok(len(rs)==1 and rs[0]["status"]=="new" and rs[0]["received"]==time.strftime("%Y-%m-%d") and rs[0]["requester"]=="Mme Durand","demande créée (statut Nouvelle, reçue aujourd'hui)")
    rid=rs[0]["id"]
    # détail
    row=pg.locator(f'.req[data-r="{rid}"]');row.locator(".ttl").click()
    e=row.locator(".edit")
    e.locator('[data-f="scope"]').select_option("out");e.locator('[data-f="est"]').fill("2,5");e.locator('[data-f="quote"]').select_option("todo");e.locator('[data-f="desc"]').fill("Ajouter le code client sur l'étiquette");e.locator('[data-f="st"]').select_option("analysis")
    e.locator('[data-k="ok"]').click()
    r=rq(rid)[0];ok(r["scope"]=="out" and r["estimate"]==2.5 and r["quote"]=="todo" and r["status"]=="analysis","détail enregistré (périmètre, 2,5 j, devis, statut)")
    pg.screenshot(path=S+"req_proj.png")
    # créer une tâche
    row=pg.locator(f'.req[data-r="{rid}"]');row.locator("details.more summary").click();row.locator('[data-a="task"]').click()
    ts=[t for t in st()["tasks"] if t.get("requestId")==rid]
    ok(len(ts)==1 and ts[0]["projectId"]=="p1" and ts[0]["due"]=="2026-10-16","tâche liée créée")
    ok(rq(rid)[0]["status"]=="doing","demande passée En cours")
    ok("Tâches liées : 0/1" in pg.locator(f'.req[data-r="{rid}"]').inner_text(),"avancement des tâches affiché")
    pg.locator(f'.req[data-r="{rid}"] .rtasks input').click()
    ok([t for t in st()["tasks"] if t.get("requestId")==rid][0]["status"]=="done","cocher la tâche depuis la demande")
    ok("Tâches liées : 1/1" in pg.locator(f'.req[data-r="{rid}"]').inner_text(),"avancement mis à jour")
    # statut rapide + annulation
    pg.locator(f'.req[data-r="{rid}"] .rsel').select_option("done")
    r=rq(rid)[0];ok(r["status"]=="done" and r["closedAt"],"demande traitée (closedAt)")
    ok(pg.locator(f'.req[data-r="{rid}"]').count()==0 and pg.locator(".showdone").count()==1,"traitée repliée")
    pg.locator("#toast button").click();ok(rq(rid)[0]["status"]=="doing","annulation du statut")
    # tâche -> lien vers la demande
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator('#ptabs [data-tab="tasks"]').click();pg.locator(".showdone").click()
    tid=[t for t in st()["tasks"] if t.get("requestId")==rid][0]["id"]
    ok(pg.locator(f'.task[data-id="{tid}"] .reqtag').count()==1,"étiquette Demande sur la tâche")
    # lier une tâche existante via le détail
    pg.locator('.task[data-id="a"] .ttl').click()
    pg.locator('.task[data-id="a"] select[aria-label="Demande client liée"]').select_option(rid)
    pg.locator('.task[data-id="a"] [data-k="ok"]').click()
    ok([t for t in st()["tasks"] if t["id"]=="a"][0].get("requestId")==rid,"lier une tâche existante")
    pg.locator('.task[data-id="a"] .reqtag').click()
    ok(pg.locator(f'.req[data-r="{rid}"] .edit').count()==1,"clic sur l'étiquette : ouvre la demande")
    pg.locator(f'.req[data-r="{rid}"] [data-k="ko"]').click()
    # corbeille
    row=pg.locator(f'.req[data-r="{rid}"]');row.locator("details.more summary").click();row.locator('[data-a="del"]').click();pg.wait_for_timeout(300)
    ok(rq(rid)[0].get("deletedAt"),"demande à la corbeille")
    lt=[t for t in st()["tasks"] if t.get("requestId")==rid]
    ok(len(lt)==2 and all(t.get("deletedAt") for t in lt),"tâches liées aussi à la corbeille (confirmation acceptée)")
    pg.locator(".vbtn",has_text="Corbeille").click()
    ok("Demande client" in pg.locator("#lists").inner_text(),"demande listée dans la corbeille")
    pg.locator(".trow",has_text="étiquette colis").filter(has=pg.locator(".reqtag")).locator("[data-r]").click()
    ok(not rq(rid)[0].get("deletedAt"),"demande restaurée")
    ok(all(not t.get("deletedAt") for t in st()["tasks"] if t.get("requestId")==rid),"tâches liées restaurées avec la demande")
    # vue globale
    pg.locator(".vbtn",has_text="Demandes client").click()
    t=pg.locator("#lists").inner_text()
    ok("Interface Sage X3" in t and "étiquette colis" in t and pg.locator("#reqadd [data-q=proj]").count()==1,"vue globale : toutes les demandes + choix du projet")
    ok("Réponse en retard" in t,"réponse en retard signalée")
    pg.screenshot(path=S+"req_global.png")
    pg.locator(".vbtn",has_text="Tableau de bord").click()
    ok("Demandes client ouvertes" in pg.locator(".kpis").inner_text(),"indicateur sur le tableau de bord")
    pg.set_viewport_size({"width":390,"height":844});pg.locator("#menubtn").click();pg.locator("#mmenu .mmrow",has_text="Demandes client").click();pg.wait_for_timeout(200)
    ok(pg.evaluate("document.documentElement.scrollWidth")<=390,"mobile : pas de débordement")
    pg.screenshot(path=S+"req_m.png",full_page=True)
    # export json contient les demandes
    ok(len(st()["requests"])==2,"données locales : 2 demandes")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
