import os,sys,base64;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,on_dialog
import json, openpyxl
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
HDR=["N°","Sujets ouverts","Description","Hypothèse Mecalux","Retours CLIENT","Statut","Acteur"]
def xlsx(name,rows):
    wb=openpyxl.Workbook();ws=wb.active;ws.append(HDR)
    for r in rows: ws.append(r)
    p=OUT+name;wb.save(p);return base64.b64encode(open(p,"rb").read()).decode()
v1=xlsx("f1.xlsx",[[1,"Réception","Format des étiquettes ?",None,None,"Ouvert","Client"]])
v2=xlsx("f2.xlsx",[[1,"Réception","Format des étiquettes ?",None,"100x150 validé","Clôturé","Client"],[2,"Stock","Nouveau point du client",None,None,"Ouvert","Client"]])
data={"projects":[{"id":"p","name":"Projet Alpha","color":"#E0703A"}],"tasks":[],"requests":[],"points":[],"deleted":[]}
# Fichier lié simulé : même poignée relue à chaque synchronisation, contenu remplacé entre deux clics (comme OneDrive)
FAKE_FS="""(()=>{window.__xlContent=null;window.__picks=0;
 const h={name:'Points ouverts projet.xlsx',queryPermission:async()=>window.__perm||'granted',requestPermission:async()=>'granted',
   getFile:async()=>{const b=Uint8Array.from(atob(window.__xlContent),c=>c.charCodeAt(0));return new File([b],'Points ouverts projet.xlsx',{lastModified:window.__mod||1})}};
 window.showOpenFilePicker=async()=>{window.__picks++;return [h]};})()"""
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    seen=[];on_dialog(pg,lambda dl:(seen.append(dl.message),dl.accept()))
    pg.add_init_script(FAKE_FS)
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui',JSON.stringify({xl:{p:true}}));localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    st=lambda:pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator('#ptabs [data-tab="points"]').click()
    pg.evaluate("c=>window.__xlContent=c",v1)
    btn=pg.locator("button",has_text="Synchroniser avec Excel").first
    ok(btn.count()==1,"bouton Synchroniser avec Excel")
    btn.click();pg.wait_for_timeout(800)
    ok(pg.evaluate("window.__picks")==1 and len(st()["points"])==1,"1er clic : choix du fichier puis import")
    ok("Points ouverts projet.xlsx" in pg.locator(".xlbadge").inner_text(),"nom du fichier lié affiché")
    pg.evaluate("c=>window.__xlContent=c",v2)
    pg.locator("button",has_text="Synchroniser avec Excel").first.click();pg.wait_for_timeout(800)
    s=st()["points"]
    ok(pg.evaluate("window.__picks")==1,"clic suivant : pas de nouveau choix de fichier")
    ok(len(s)==2 and any(x["status"]=="closed" and "100x150" in x["answer"] for x in s),"modifications de l'Excel reprises en un clic")
    pg.wait_for_timeout(1000)  # laisse passer l'alerte « nouvelle réponse du client » de la synchro précédente
    pg.locator("button",has_text="Synchroniser avec Excel").first.click();pg.wait_for_timeout(600)
    ok("déjà à jour" in pg.locator("#toast").inner_text(),"sans changement : message « déjà à jour »")
    # synchronisation automatique : fichier modifié (date de modification changée)
    v3=xlsx("f3.xlsx",[[1,"Réception","Format des étiquettes ?",None,"100x150 validé","Clôturé","Client"],[2,"Stock","Nouveau point du client",None,"Réponse ajoutée dans l'Excel","Ouvert","Client"],[3,"Stock","Troisième point",None,None,"Ouvert","Client"]])
    pg.evaluate("c=>{window.__xlContent=c;window.__mod=2}",v3);pg.evaluate("window.__xlAutoNow()");pg.wait_for_timeout(800)
    s=st()["points"]
    ok(len(s)==3 and any(x.get("answer")=="Réponse ajoutée dans l'Excel" for x in s),"auto : modification et nouveau point appliqués sans confirmation")
    ok("1 nouvelle réponse du client" in pg.locator("#toast").inner_text(),"auto : réponse du client ajoutée dans l'Excel, alerte « nouvelle réponse »")
    n=len(seen);pg.evaluate("window.__xlAutoNow()");pg.wait_for_timeout(500)
    ok(len(seen)==n and len(st()["points"])==3,"auto : fichier inchangé, rien à faire")
    # point retiré de l'Excel : pas d'application automatique, repère à valider
    v4=xlsx("f4.xlsx",[[1,"Réception","Format des étiquettes ?",None,"100x150 validé","Clôturé","Client"],[2,"Stock","Nouveau point du client",None,"Réponse ajoutée dans l'Excel","Ouvert","Client"]])
    pg.evaluate("c=>{window.__xlContent=c;window.__mod=3}",v4);pg.evaluate("window.__xlAutoNow()");pg.wait_for_timeout(800)
    ok(len([x for x in st()["points"] if not x.get("deletedAt")])==3 and "1 élément à valider" in pg.locator(".xlact").inner_text(),"auto : point retiré signalé, pas supprimé")
    pg.locator(".xlact").click();pg.wait_for_timeout(800)
    ok("n'existe plus" in seen[-1] and pg.locator(".xlact").count()==0,"clic sur le repère : validation manuelle, repère effacé")
    # accès non autorisé : repère « reprendre »
    pg.evaluate("window.__perm='prompt'");pg.evaluate("c=>{window.__mod=4}",None);pg.evaluate("window.__xlAutoNow()");pg.wait_for_timeout(500)
    ok("reprendre la synchro" in pg.locator(".xlact").inner_text(),"accès à réautoriser : repère cliquable")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
