import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,on_dialog
import json, datetime, openpyxl
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
HDR=["Date d'ouverture","Sujets ouverts","Description","Hypothèse Mecalux","Retours CLIENT","Statut","Acteur","Sujet ERP ?"]
def xlsx(name,rows):
    wb=openpyxl.Workbook();ws=wb.active;ws.title="Points ouverts";ws.append(HDR)
    for r in rows: ws.append(r)
    wb.create_sheet("Listes").append(["Ouvert","Clôturé"])
    p=OUT+name;wb.save(p);return p
d=datetime.datetime(2026,10,7)
A="Quel format d'étiquette en réception ?"; B="Combien de quais de chargement ?"; C="Gestion des numéros de série à l'expédition"
v1=xlsx("v1.xlsx",[[d,"Réception",A,None,None,"Ouvert",None,"NON"],[d,"Expédition",B,"Deux quais",None,None,"Client",None],[d,"Expédition",C,None,None,None,None,"OUI"],[d,"Stock","Nouveau point venu de l'Excel",None,None,None,"Mecalux",None]])
v2=xlsx("v2.xlsx",[[d,"Réception",A,None,"Format 100x150 validé","Clôturé",None,"NON"],[d,"Expédition",B,"Deux quais",None,None,"Client",None],[d,"Expédition","Gestion des numéros de série à l'expédition (scan obligatoire)",None,None,None,None,"OUI"],[d,"Stock","Second nouveau point",None,None,None,None,None]])
P=[{"id":"a","projectId":"p","text":A,"answer":"","hypothesis":"","erp":"","theme":"Réception","owner":"","ownerName":"","status":"open","createdAt":1},
   {"id":"b","projectId":"p","text":B,"answer":"Réponse saisie dans l'appli","hypothesis":"","erp":"","theme":"Expédition","owner":"","ownerName":"","status":"open","createdAt":2},
   {"id":"c","projectId":"p","text":C,"answer":"","hypothesis":"","erp":"","theme":"Expédition","owner":"","ownerName":"","status":"open","createdAt":3},
   {"id":"m","projectId":"p","text":"Point créé à la main dans l'appli","answer":"","hypothesis":"","erp":"","theme":"","owner":"","ownerName":"","status":"open","createdAt":4}]
data={"projects":[{"id":"p","name":"Projet Alpha","color":"#E0703A"},{"id":"q","name":"Projet Bêta","color":"#2F7D5B"}],"tasks":[],"requests":[],"points":P,"deleted":[]}
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    seen=[];on_dialog(pg,lambda dl:(seen.append(dl.message),dl.accept()))
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    st=lambda:pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")
    pt=lambda i:[x for x in st()["points"] if x["id"]==i][0]
    pg.locator(".pbtn",has_text="Projet Alpha").click()
    pg.locator(".ddmore summary").click()
    ok(pg.locator(".ddmore .menu",has_text="Excel").count()==0,"fonction invisible par défaut")
    pg.keyboard.press("Escape");pg.locator("#search").fill("/excel");pg.locator("#search").press("Enter");pg.wait_for_timeout(200)
    pg.locator(".ddmore summary").click()
    ok(pg.locator(".ddmore .menu button",has_text="Mettre à jour depuis Excel").count()==1,"commande cachée /excel : menu disponible")
    with pg.expect_file_chooser() as fc: pg.locator(".ddmore .menu button",has_text="Mettre à jour depuis Excel").click()
    fc.value.set_files(v1);pg.wait_for_timeout(600)
    print("   ",seen[-1].replace("\n"," | ")[:400])
    ok("3 points existants reliés" in seen[-1] and "1 nouveau point" in seen[-1],"1re synchro : 3 points reliés, 1 nouveau")
    ok(pt("b")["answer"]=="Réponse saisie dans l'appli" and pt("b")["hypothesis"]=="Deux quais" and pt("b")["owner"]=="client","1re synchro : saisie appli conservée, champs vides complétés")
    ok(pt("a")["erp"]=="non" and pt("c")["erp"]=="oui","1re synchro : sujet ERP repris")
    ok(any(x["text"]=="Nouveau point venu de l'Excel" and x["owner"]=="mecalux" and x["createdAt"]>1e12 for x in st()["points"]),"nouveau point créé avec sa date")
    ok("xl" not in pt("m"),"point créé dans l'appli non relié")
    # modification dans l'appli puis 2e synchro
    pg.evaluate("()=>{}")
    s=st();[x for x in s["points"] if x["id"]=="b"][0]["hypothesis"]="Hypothèse revue dans l'appli"
    pg.evaluate("s=>{localStorage.setItem('todo-projets',JSON.stringify(s))}",s);pg.reload();pg.wait_for_timeout(300)
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator(".ddmore summary").click()
    with pg.expect_file_chooser() as fc: pg.locator(".ddmore .menu button",has_text="Mettre à jour depuis Excel").click()
    fc.value.set_files(v2);pg.wait_for_timeout(600)
    print("   ",seen[-1].replace("\n"," | ")[:500])
    ok(pt("a")["status"]=="closed" and pt("a")["answer"]=="Format 100x150 validé","2e synchro : statut et réponse modifiés dans l'Excel repris")
    ok(pt("b")["hypothesis"]=="Hypothèse revue dans l'appli","2e synchro : modification faite dans l'appli conservée (Excel inchangé)")
    ok(pt("c")["text"].endswith("(scan obligatoire)"),"2e synchro : description reformulée reconnue et mise à jour")
    ok("n'existe plus dans l'Excel" in seen[-1],"point retiré de l'Excel signalé")
    gone=[x for x in st()["points"] if x["text"]=="Nouveau point venu de l'Excel"][0]
    ok(gone.get("deletedAt") and "xl" not in gone,"point retiré : corbeille (choix par défaut du test)")
    ok(sum(1 for x in st()["points"] if x["text"]=="Second nouveau point")==1,"second nouveau point ajouté")
    # annulation
    pg.locator("#toast button").click();pg.wait_for_timeout(200)
    ok(pt("a")["status"]=="open" and not any(x["text"]=="Second nouveau point" for x in st()["points"]),"annulation de la mise à jour")
    # autre projet : rien
    pg.locator(".pbtn",has_text="Projet Bêta").click();pg.locator(".ddmore summary").click()
    ok(pg.locator(".ddmore .menu",has_text="Excel").count()==0,"autre projet : fonction absente")
    pg.screenshot(path=OUT+"excel_link.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
