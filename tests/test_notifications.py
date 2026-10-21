import os,sys,json,datetime;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,on_dialog
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
D=lambda n:(datetime.date.today()+datetime.timedelta(days=n)).isoformat()
now=int(datetime.datetime.now().timestamp()*1000)
T=lambda i,title,due,st="todo":{"id":i,"projectId":"p","title":title,"priority":"normale","due":due,"status":st,"waitingFor":"le client" if st=="waiting" else "","createdAt":now,"updatedAt":now,"checklist":[]}
data={"projects":[{"id":"p","name":"Diamond Europe","color":"#E0703A"},{"id":"q","name":"Projet archivé","color":"#3FA37A","archived":True}],
  "tasks":[T("t1","Envoyer le planning de démarrage",D(-3)),T("t2","Valider le plan d'implantation",D(0)),T("t3","Relancer pour les fichiers articles",D(0),"waiting"),
           T("t4","Préparer la formation",D(6)),T("t5","Tâche terminée en retard",D(-2),"done"),
           {**T("t6","Tâche d'un projet archivé",D(-5)),"projectId":"q"}],
  "requests":[{"id":"r1","projectId":"p","title":"Ajout d'un état de stock","description":"","requester":"","received":D(-10),"due":D(-1),"priority":"normale","status":"new","scope":"","createdAt":now,"updatedAt":now}],
  "points":[{"id":"o1","projectId":"p","text":"Format des étiquettes de réception ?","answer":"100x150 thermique","hypothesis":"","erp":"","theme":"Réception","owner":"client","ownerName":"","status":"open","createdAt":now-5000,"updatedAt":now,"ansNew":now-60000},
            {"id":"o2","projectId":"p","text":"Hauteur des alvéoles ?","answer":"1,20 m","hypothesis":"","erp":"","theme":"Stockage","owner":"client","ownerName":"","status":"open","createdAt":now-4000,"updatedAt":now,"ansNew":now-30000},
            {"id":"o3","projectId":"p","text":"Transporteurs ?","answer":"","hypothesis":"","erp":"","theme":"Expédition","owner":"client","ownerName":"","status":"open","createdAt":now-3000,"updatedAt":now}],
  "deleted":[]}
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":950})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(600)
    d=pg.evaluate("window.__notifData()")
    ok(d=={"ans":2,"late":2,"soon":2,"count":6},"contenu : 2 réponses client, 2 retards (tâche + demande), 2 échéances (aujourd'hui + relance) %s"%d)
    bell=pg.locator(".bellbtn.d")
    ok(bell.is_visible() and bell.locator(".belln").inner_text()=="6","cloche en haut à droite, pastille 6")
    bell.click();pg.wait_for_timeout(300)
    pop=pg.locator("#notifpop")
    txt=pop.text_content()
    ok(pop.is_visible() and "Réponses du client" in txt and "En retard" in txt and "Échéances" in txt,"panneau : trois rubriques")
    ok("Format des étiquettes" in txt and "100x150 thermique" in txt and "N° 1" in txt,"réponse client : point et réponse")
    ok("en retard de 3 jours" in txt and "Demande client : Ajout d'un état de stock" in txt,"retards : tâche et demande client")
    ok("Valider le plan" in txt and "Relancer pour les fichiers" in txt and "Préparer la formation" not in txt,"échéances : aujourd'hui et relance, pas au-delà de 3 jours")
    ok("terminée" not in txt and "archivé" not in txt,"tâches terminées et projets archivés exclus")
    ok(pop.locator(".npi.new").count()==6,"éléments nouveaux repérés")
    pg.screenshot(path=OUT+"notif_desktop.png")
    pg.keyboard.press("Escape");pg.wait_for_timeout(200)
    ok(pop.is_hidden() and bell.locator(".belln").inner_text()=="2","après lecture du panneau : seules les 2 réponses non lues restent comptées")
    # clic sur une réponse : points du projet, filtrés sur les nouvelles réponses
    bell.click();pop.locator(".npi",has_text="Hauteur des alvéoles").click();pg.wait_for_timeout(300)
    ok(pop.is_hidden() and pg.locator(".task.pt.ansnew").count()==2 and "Nouvelles réponses du client uniquement" in pg.locator("#lists").inner_text(),"clic : points ouverts filtrés sur les nouvelles réponses")
    # clic sur un retard : tâche ouverte
    bell.click();pop.locator(".npi",has_text="Envoyer le planning").click();pg.wait_for_timeout(400)
    ok("Envoyer le planning de démarrage" in pg.locator("main").inner_text(),"clic sur un retard : tâche affichée")
    if pg.locator(".dclose").count():pg.locator(".dclose").first.click();pg.wait_for_timeout(200)
    # tout marquer comme lu
    bell.click();pop.locator("[data-allread]").click();pg.wait_for_timeout(300)
    ok(pg.evaluate("window.__notifData().count")==0 and "Réponses du client" not in pop.text_content() and bell.locator(".belln").is_hidden(),"tout marquer comme lu : pastille effacée")
    pg.mouse.click(700,600);pg.wait_for_timeout(200)
    ok(pop.is_hidden(),"clic à côté : panneau fermé")
    # nouvel élément : la pastille revient
    pg.locator("#qt").fill("Nouvelle tâche du jour");pg.locator("#qd").fill(D(1));pg.locator("#qt").press("Enter");pg.wait_for_timeout(400)
    ok(bell.locator(".belln").inner_text()=="1","nouvelle échéance (demain) : pastille 1")
    # téléphone
    pg.set_viewport_size({"width":390,"height":844});pg.wait_for_timeout(300)
    mb=pg.locator(".bellbtn.m")
    ok(mb.is_visible() and pg.locator(".bellbtn.d").is_hidden() and mb.locator(".belln").inner_text()=="1","téléphone : cloche dans la barre du haut")
    mb.click();pg.wait_for_timeout(300)
    bb=pop.bounding_box()
    ok(pop.is_visible() and bb["x"]<=10 and bb["width"]>=360,"téléphone : panneau pleine largeur")
    pg.screenshot(path=OUT+"notif_phone.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
