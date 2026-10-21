import os,sys,base64;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,on_dialog
import json, openpyxl
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
# En-têtes du type « Commentaires MECALUX » / « Commentaires <CLIENT> »
HDR=["N°","Thème","Description","Commentaires MECALUX","Commentaires DIAMOND","Statut","Acteur"]
def xlsx(name,rows):
    wb=openpyxl.Workbook();ws=wb.active;ws.append(HDR)
    for r in rows: ws.append(r)
    p=OUT+name;wb.save(p);return base64.b64encode(open(p,"rb").read()).decode()
R1=[1,"Réception","Format des étiquettes ?","Hypothèse : 100x150",None,"Ouvert","Client"]
R2=[2,"Stock","Hauteur des alvéoles ?",None,None,"Ouvert","Client"]
R3=[3,"Expédition","Transporteurs utilisés ?",None,None,"Ouvert","Client"]
v1=xlsx("a1.xlsx",[R1,R2,R3])
v2=xlsx("a2.xlsx",[R1[:4]+["Oui, 100x150 thermique"]+R1[5:],R2,R3])
v4=xlsx("a4.xlsx",[R1[:4]+["Oui, 100x150 thermique, 2 par palette"]+R1[5:],R2[:4]+["1,20 m sauf allée A"]+R2[5:],R3[:4]+["DHL, DPD et Geodis"]+R3[5:]])
v3=xlsx("a3.xlsx",[R1[:4]+["Oui, 100x150 thermique"]+R1[5:],R2[:4]+["1,20 m partout"]+R2[5:],R3[:4]+["DHL et DPD"]+R3[5:]])
data={"projects":[{"id":"p","name":"Diamond Europe","color":"#E0703A"}],"tasks":[],"requests":[],"points":[],"deleted":[]}
FAKE_FS="""(()=>{window.__xlContent=null;
 const h={name:'Points ouverts Diamond.xlsx',queryPermission:async()=>'granted',requestPermission:async()=>'granted',
   getFile:async()=>{const b=Uint8Array.from(atob(window.__xlContent),c=>c.charCodeAt(0));return new File([b],'Points ouverts Diamond.xlsx',{lastModified:window.__mod||1})}};
 window.showOpenFilePicker=async()=>[h];
 window.__notifs=[];window.Notification=class{constructor(t,o){window.__notifs.push([t,o.body]);this.close=()=>{}}static get permission(){return window.__nperm||'default'}static async requestPermission(){window.__nperm='granted';return 'granted'}};})()"""
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda dl:dl.accept())
    pg.add_init_script(FAKE_FS)
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui',JSON.stringify({xl:{p:true}}));localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    st=lambda:pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")["points"]
    pg.locator(".pbtn",has_text="Diamond Europe").click();pg.locator('#ptabs [data-tab="points"]').click()
    pg.evaluate("c=>window.__xlContent=c",v1)
    pg.locator("button",has_text="Synchroniser avec Excel").first.click();pg.wait_for_timeout(800)
    s=st()
    ok(len(s)==3 and any(x["hypothesis"].startswith("Hypothèse") for x in s) and not any(x.get("ansNew") for x in s),"import : « Commentaires MECALUX » lu comme commentaire Mecalux, aucune alerte")
    # le client répond dans « Commentaires DIAMOND » ; synchronisation manuelle
    pg.evaluate("c=>{window.__xlContent=c;window.__mod=2}",v2)
    pg.locator("button",has_text="Synchroniser avec Excel").first.click();pg.wait_for_timeout(2000)
    s=st();x=[p for p in s if p["text"].startswith("Format")][0]
    ok(x["answer"]=="Oui, 100x150 thermique" and x.get("ansNew"),"réponse lue dans « Commentaires DIAMOND » et signalée comme nouvelle")
    ok("1 nouvelle réponse du client" in pg.locator("#toast").inner_text() and pg.locator("#toast button").inner_text()=="Voir","message « nouvelle réponse » avec bouton Voir")
    ok(pg.locator(".ansbar").count()==1 and pg.locator(".task.pt.ansnew").count()==1 and pg.locator(".tag.ansnew").count()==1,"bandeau, point surligné et repère « Nouvelle réponse client »")
    ok(pg.locator(".pbtn",has_text="Diamond Europe").locator(".pansn").inner_text()=="1" and pg.locator('#ptabs [data-tab="points"] .ansdot').count()==1,"pastille sur le projet et sur l'onglet Points")
    pg.screenshot(path=OUT+"ans_banner.png")
    pg.locator(".tag.ansnew").click();pg.wait_for_timeout(300)
    ok(not [p for p in st() if p.get("ansNew")] and pg.locator(".ansbar").count()==0 and pg.locator(".pansn").count()==0,"clic sur le repère : réponse marquée comme lue, alertes effacées")
    # synchro automatique, appli en arrière-plan, alertes Windows activées
    pg.evaluate("window.__nperm='granted';document.hasFocus=()=>false")
    pg.evaluate("c=>{window.__xlContent=c;window.__mod=3}",v3);pg.evaluate("window.__xlAutoNow()");pg.wait_for_timeout(1000)
    n=pg.evaluate("window.__notifs")
    ok(len([p for p in st() if p.get("ansNew")])==2,"auto : 2 nouvelles réponses signalées")
    ok(len(n)==1 and "Diamond Europe : 2 nouvelles réponses du client" in n[0][0] and "Hauteur des alvéoles" in n[0][1],"notification Windows : %s"%n)
    ok("2 nouvelles réponses du client" in pg.locator(".ansbar").inner_text(),"bandeau : 2 réponses")
    pg.locator("[data-ansonly]").click();pg.wait_for_timeout(300)
    ok(pg.locator(".task.pt").count()==2 and "Nouvelles réponses du client uniquement" in pg.locator("#lists").inner_text(),"filtre : seulement les nouvelles réponses")
    pg.locator(".task.pt.ansnew .ttl").first.click();pg.wait_for_timeout(300)
    ok(len([p for p in st() if p.get("ansNew")])==1,"ouvrir le point : réponse lue")
    pg.locator("[data-ansread]").click();pg.wait_for_timeout(300)
    ok(not [p for p in st() if p.get("ansNew")] and pg.locator(".ansbar").count()==0 and pg.locator(".task.pt").count()==3,"tout marquer comme lu : retour à tous les points")
    # réponse modifiée par l'appli puis inchangée dans l'Excel : pas de nouvelle alerte
    pg.evaluate("c=>{window.__mod=4}",None);pg.evaluate("window.__xlAutoNow()");pg.wait_for_timeout(800)
    ok(not [p for p in st() if p.get("ansNew")],"Excel inchangé : pas d'alerte")
    # téléphone : tuile Points de l'accueil du projet
    pg.evaluate("c=>{window.__xlContent=c;window.__mod=6}",v4);pg.evaluate("window.__xlAutoNow()");pg.wait_for_timeout(800)
    if pg.locator(".task.pt.open .ttl").count():pg.locator(".task.pt.open .ttl").first.click();pg.wait_for_timeout(200)
    pg.set_viewport_size({"width":390,"height":844});pg.wait_for_timeout(300)
    pg.locator(".bnav [data-b=menu]").click();pg.wait_for_timeout(200)
    ok("3 nouvelles réponses client" in pg.locator(".pjt",has_text="Diamond Europe").inner_text(),"téléphone : écran Projets")
    pg.locator(".pjt",has_text="Diamond Europe").click();pg.wait_for_timeout(300)
    ok("3 nouvelles réponses du client" in pg.locator(".phtile",has_text="Points").inner_text(),"téléphone : tuile Points ouverts")
    pg.screenshot(path=OUT+"ans_phone.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
