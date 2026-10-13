import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
import json,re,sys
from playwright.sync_api import sync_playwright
S=OUT
P=[{"id":"p1","name":"Projet Alpha","color":"#E0703A"},{"id":"p2","name":"Projet Bêta","color":"#3FA37A"},{"id":"p3","name":"GOHY","color":"#3E7CB1"}]
import time
now=int(time.time()*1000)
T=[
 {"id":"a","projectId":"p1","title":"Mail pour les points ouverts Recep + Convoyeur","due":"2026-10-08","priority":"haute","status":"todo","who":"Alice Martin","note":"Demander le type de base","createdAt":1},
 {"id":"b","projectId":"p1","title":"Tester le standard avant l'atelier d'AF","due":"2026-10-13","priority":"normale","status":"doing","who":"","note":"","createdAt":2,"checklist":[{"id":"s1","text":"x","done":True},{"id":"s2","text":"y","done":False}]},
 {"id":"c","projectId":"p2","title":"Organiser un déplacement sur site","due":"2026-10-16","priority":"normale","status":"waiting","waitingFor":"Signature Projet Bêta","who":"Bruno D","note":"","createdAt":3},
 {"id":"d","projectId":"p2","title":"Faire valider la partie réception","due":"2026-10-06","priority":"normale","status":"todo","who":"Bruno D","note":"","createdAt":4},
 {"id":"e","projectId":"p3","title":"Clôturer l'hypercare","due":"2026-10-20","priority":"basse","status":"todo","who":"","note":"","createdAt":5},
 {"id":"f","projectId":"p1","title":"Déployer la VM","due":"","priority":"normale","status":"done","doneAt":now-86400000,"who":"","note":"","createdAt":6},
 {"id":"g","projectId":"p2","title":"Relancer le client sur le PV","due":"2026-10-07","priority":"normale","status":"waiting","waitingFor":"Client","who":"","note":"","createdAt":7},
]
data={"projects":P,"tasks":T,"deleted":[]}
errs=[];dialogs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    ctx=b.new_context(viewport={"width":1440,"height":1000},accept_downloads=True)
    pg=ctx.new_page()
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    answers=[]
    def dlg(d):
        dialogs.append(d.message)
        if d.type=="prompt": d.accept(answers.pop(0) if answers else "")
        else: d.accept()
    on_dialog(pg,dlg)
    pg.add_init_script("if(!sessionStorage.getItem('seeded')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui',JSON.stringify({mode:'list',scope:'all'}));sessionStorage.setItem('seeded','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(500)
    st=lambda: pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")
    task=lambda i: [t for t in st()["tasks"] if t["id"]==i]
    heads=pg.eval_on_selector_all(".group h2","e=>e.map(x=>x.firstChild.textContent.trim())")
    ok("En attente" in heads, "groupe En attente présent : %s"%heads)
    ok(pg.locator(".tag.wait").count()==2,"2 étiquettes En attente")
    pg.screenshot(path=S+"v3_list.png")
    # --- corbeille + annuler
    row=pg.locator('.task[data-id="e"]')
    row.locator("details.more summary").click(); row.locator('[data-a="del"]').click()
    ok(pg.locator("#toast").is_visible(),"toast après suppression")
    ok(task("e")[0].get("deletedAt"),"tâche e à la corbeille (deletedAt)")
    ok(pg.locator('.task[data-id="e"]').count()==0,"tâche e masquée de la liste")
    pg.locator("#toast button").click(); pg.wait_for_timeout(100)
    ok(not task("e")[0].get("deletedAt") and pg.locator('.task[data-id="e"]').count()==1,"Annuler restaure la tâche")
    row=pg.locator('.task[data-id="e"]'); row.locator("details.more summary").click(); row.locator('[data-a="del"]').click()
    pg.locator("#trashbtn").click()
    ok(pg.locator(".trow").count()==1,"corbeille : 1 ligne")
    pg.screenshot(path=S+"v3_trash.png")
    pg.locator(".trow [data-r]").click()
    ok(pg.locator(".trow").count()==0 and not task("e")[0].get("deletedAt"),"Restaurer depuis la corbeille")
    # --- terminer + annuler
    pg.locator(".vbtn",has_text="Toutes les tâches").click()
    pg.locator('.task[data-id="a"] .chk').click(); pg.wait_for_timeout(100)
    ok(task("a")[0]["status"]=="done","tâche a terminée")
    pg.locator("#toast button").click()
    ok(task("a")[0]["status"]=="todo" and not task("a")[0].get("doneAt"),"Annuler la terminaison")
    # --- mettre en attente via le menu
    answers.append("Validation client")
    row=pg.locator('.task[data-id="d"]'); row.locator("details.more summary").click(); row.locator('[data-a="wait"]').click()
    t=task("d")[0]; ok(t["status"]=="waiting" and t["waitingFor"]=="Validation client","menu Mettre en attente…")
    # reprendre
    pg.locator('.task[data-id="d"] [data-a="doing"]').click()
    t=task("d")[0]; ok(t["status"]=="todo" and t["waitingFor"]=="","Reprendre remet à faire")
    # --- édition : statut + attente + historique
    pg.locator('.task[data-id="b"] .ttl').click()
    f=pg.locator('.task[data-id="b"] .edit')
    f.locator('select[aria-label="Statut"]').select_option("waiting")
    ok(f.locator('input[aria-label="En attente de"]').is_visible(),"champ En attente de affiché")
    f.locator('input[aria-label="En attente de"]').fill("Éditeur")
    f.locator('[data-k="ok"]').click()
    t=task("b")[0]; ok(t["status"]=="waiting" and t["waitingFor"]=="Éditeur","édition du statut")
    ok(any(h["f"]=="status" and h["n"]=="waiting" for h in t.get("history",[])),"historique local : statut")
    row=pg.locator('.task[data-id="b"]'); row.locator("details.more summary").click(); row.locator('[data-a="hist"]').click(); pg.wait_for_timeout(200)
    items=pg.locator('.task[data-id="b"] .hlist li').all_inner_texts()
    print("   historique :",items)
    ok(any("devient « En attente »" in x for x in items),"affichage de l'historique")
    pg.locator('.task[data-id="b"] [data-k="ko"]').click()
    # --- Aujourd'hui : relance g (due hier) visible
    pg.locator(".vbtn",has_text="Aujourd'hui").click()
    ok(pg.locator('.task[data-id="g"]').count()==1,"relance échue visible dans Aujourd'hui")
    ok(pg.locator('.task[data-id="c"]').count()==0,"attente future absente d'Aujourd'hui")
    # --- Tableau de bord
    pg.locator(".vbtn",has_text="Tableau de bord").click()
    k=pg.eval_on_selector_all(".kpi","e=>e.map(x=>x.innerText.replace(/\\n/g,' '))")
    print("   KPI :",k)
    ok(len(k)==6,"6 indicateurs")
    ok(pg.locator(".dtable").count()==3,"3 tableaux")
    pg.screenshot(path=S+"v3_dash.png",full_page=True)
    # --- Archivage
    pg.locator(".pbtn",has_text="GOHY").click()
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="Archiver").click()
    ok([p for p in st()["projects"] if p["id"]=="p3"][0].get("archived"),"projet archivé")
    ok(pg.locator(".parch").count()==1 and pg.locator(".pbtn",has_text="GOHY").count()==0,"section Projets archivés repliée")
    ok("Clôturer" not in pg.locator("#lists").inner_text(),"tâches archivées masquées")
    n_all=pg.locator(".vbtn",has_text="Toutes les tâches").locator(".n").inner_text()
    ok(n_all=="5","compteur hors archivés = %s"%n_all)
    pg.locator(".parch").click()
    pg.locator(".pbtn",has_text="GOHY").click()
    ok("Archivé" in pg.locator("#ptitle").inner_text() and pg.locator('.task[data-id="e"]').count()==1,"projet archivé consultable")
    pg.screenshot(path=S+"v3_arch.png")
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="Réactiver").click()
    ok(not [p for p in st()["projects"] if p["id"]=="p3"][0].get("archived"),"projet réactivé")
    # --- Vider les terminées -> corbeille
    pg.locator(".vbtn",has_text="Toutes les tâches").click()
    pg.locator(".donerow .vider").click()
    ok(task("f")[0].get("deletedAt"),"Vider les terminées : à la corbeille")
    pg.locator("#toast button").click(); ok(not task("f")[0].get("deletedAt"),"annulation du vidage")
    # --- Export
    pg.locator(".ddexp summary").click();pg.locator(".ddexp .menu button",has_text="Plan").click()
    ok(pg.locator("#expdlg").is_visible(),"fenêtre d'export")
    pg.locator("#expdone").check(); pg.locator("#expcom").check()
    with pg.expect_download() as d: pg.locator("#expxlsx").click()
    d.value.save_as(S+"export.xlsx"); print("   fichier :",d.value.suggested_filename)
    pg.locator("#exppdf").click(); pg.wait_for_timeout(400)
    html=pg.evaluate("(document.querySelector('iframe')||{}).srcdoc||''")
    open(S+"export.html","w").write(html)
    ok("Plan d&#39;actions" in html and "En retard" in html,"PDF : document généré")
    pg.locator("#expdlg .btn.ghost").click()
    # mobile
    pg.set_viewport_size({"width":390,"height":844})
    pg.locator(".vbtn",has_text="Tableau de bord").click(); pg.wait_for_timeout(200)
    ok(pg.evaluate("document.documentElement.scrollWidth")<=390,"mobile : pas de débordement (dash)")
    pg.screenshot(path=S+"v3_dash_m.png",full_page=True)
    b.close()
print("dialogues :",dialogs)
print("ERREURS :",errs if errs else "aucune")
sys.exit(1 if errs else 0)
