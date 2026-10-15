import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog
import json, datetime
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
P=[{"id":"o%d"%i,"projectId":"p","text":t,"answer":"","hypothesis":"Hypothèse %d"%i if i==1 else "","erp":"","theme":th,"owner":"client","ownerName":"","status":"open","createdAt":i,"xl":{"ver":2,"n":str(40+i),"k":"","v":{}}} for i,(t,th) in enumerate([("Format des étiquettes de réception ?","Réception"),("Scan du numéro de série en réception ?","Réception"),("Profils d'expédition ?","Expédition")])]
T=[{"id":"t1","projectId":"p","title":"Tâche existante","priority":"normale","due":"2020-01-01","status":"todo","createdAt":1}]
data={"projects":[{"id":"p","name":"Projet Alpha","color":"#E0703A","pointThemes":[{"id":"a","name":"Réception"},{"id":"b","name":"Expédition"}]},{"id":"q","name":"Projet Beta","color":"#2F7D5B"}],"tasks":T,"requests":[],"points":P,"deleted":[]}
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":950})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(300)
    st=lambda:pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")
    pg.locator(".pbtn").first.click();pg.locator('#ptabs [data-tab="meetings"]').click()
    ok("Comptes rendus" in pg.locator("#lists").inner_text(),"onglet Réunions")
    # contacts du projet
    pg.fill('.mtgctadd [data-n]',"Responsable logistique");pg.select_option('.mtgctadd [data-s]',"client");pg.locator('.mtgctadd button').click();pg.wait_for_timeout(200)
    ok(st()["projects"][0].get("contacts",[{}])[0].get("name")=="Responsable logistique","contact ajouté au projet")
    # nouvelle réunion
    pg.locator("[data-new]").click()
    dlg=pg.locator("dialog.uidlg")
    dlg.locator("[data-k=title]").fill("Atelier Réception")
    dlg.locator("[data-k=kind]").select_option("atelier");dlg.locator("[data-k=theme]").select_option("Réception")
    ok("2 sujets" in dlg.inner_text(),"ordre du jour proposé selon le thème")
    dlg.locator("[data-ok]").click();pg.wait_for_timeout(300)
    v=pg.locator("#mtgview")
    ok(v.is_visible() and v.locator('[data-ph="prep"][aria-pressed="true"]').count()==1,"écran de préparation ouvert")
    ok(v.locator(".mtgcands input:checked").count()==3,"2 points du thème + Divers cochés")
    # participant : le contact
    v.locator(".mtgppl label",has_text="Responsable logistique").locator("input").check();pg.wait_for_timeout(100)
    # e-mail d'ordre du jour
    v.locator(".mtggo [data-mail]").click();md=pg.locator("dialog.maildlg")
    body=md.locator("[data-k=body]").input_value()
    ok("Ordre du jour :" in body and "1. N° 40 – Format des étiquettes" in body and "Atelier Réception" in md.locator("[data-k=subject]").input_value(),"e-mail d'ordre du jour : objet et sujets numérotés")
    md.locator("[data-open]").click();pg.wait_for_timeout(200)
    ok(pg.evaluate("window.__lastMailto||''").startswith("mailto:?subject="),"e-mail ouvert dans la messagerie")
    v.locator(".mtggo [data-go]").click();pg.wait_for_timeout(200)
    ok("Format des étiquettes" in v.locator(".mtgsubj").inner_text() and "N° 40" in v.locator(".mtgsubj").inner_text(),"séance : 1er sujet avec son N°")
    # lever le point
    v.locator('[data-act="close"]').click();v.locator(".mtgform textarea").fill("Format 100x150 retenu");v.locator('.mtgform [type=submit]').click();pg.wait_for_timeout(150)
    ok("Point levé" in v.locator(".mtgitems").inner_text(),"point levé relevé")
    ok(st()["points"][0]["status"]=="open","rien n'est appliqué au projet avant validation")
    v.locator('[data-act="decision"]').click();v.locator(".mtgform textarea").fill("Étiquettes imprimées au déballage");v.locator('.mtgform [type=submit]').click()
    v.locator('[data-nav="1"]').click()
    ok("Scan du numéro" in v.locator(".mtgsubj").inner_text() and "Hypothèse 1" in v.locator(".mtgcom").inner_text(),"2e sujet avec le commentaire Mecalux")
    v.locator('[data-act="action"]').click();v.locator(".mtgform textarea").fill("Envoyer la maquette d'étiquette")
    v.locator(".mtgform [data-w]").select_option(label="Responsable logistique (Client)");v.locator(".mtgform [data-d]").fill("2026-10-23");v.locator('.mtgform [type=submit]').click()
    v.locator('[data-act="newpoint"]').click();v.locator(".mtgform textarea").fill("Faut-il une étiquette support ?");v.locator('.mtgform [type=submit]').click();pg.wait_for_timeout(150)
    ok(v.locator(".mtgag button.done").count()==2,"sujets marqués traités")
    v.locator(".mtgpres").click();ok(not v.locator(".mtgside").is_visible(),"mode présentation : panneaux internes masqués")
    v.locator(".mtgpres").click()
    v.locator(".mtgnotes textarea").fill("Visite de la zone de réception prévue.");pg.wait_for_timeout(900)
    pg.screenshot(path=OUT+"meeting_run.png")
    v.locator('[data-ph="review"]').click();pg.wait_for_timeout(200)
    doc=v.locator(".crdoc").text_content()
    ok("Décisions" in doc and "Points levés" in doc and "Actions" in doc and "Nouveaux points ouverts" in doc and "Responsable logistique" in doc,"aperçu du compte rendu")
    v.locator("[data-next]").fill("Atelier Expédition, vendredi 14:00");pg.wait_for_timeout(200)
    ok("Atelier Expédition" in v.locator(".crdoc").inner_text(),"prochaine réunion dans l'aperçu")
    pg.screenshot(path=OUT+"meeting_review.png")
    # PDF manuel
    v.locator("[data-pdf]").click();pg.wait_for_timeout(300)
    ok(pg.evaluate("[...document.querySelectorAll('iframe')].some(f=>(f.srcdoc||'').includes('Compte rendu'))"),"PDF produit à la demande")
    # validation
    v.locator("[data-val]").click();pg.wait_for_timeout(300)
    s=st()
    t=[x for x in s["tasks"] if x["title"]=="Envoyer la maquette d'étiquette"]
    ok(t and t[0]["due"]=="2026-10-23" and "Issu de : Atelier Réception" in t[0]["note"],"validation : action devenue tâche")
    ok(s["points"][0]["status"]=="closed" and "100x150" in s["points"][0]["answer"],"validation : point levé avec la réponse")
    ok(any(o["text"]=="Faut-il une étiquette support ?" and o["theme"]=="Réception" for o in s["points"]),"validation : nouveau point créé")
    m=s["projects"][0]["meetings"][0]
    ok(m["status"]=="validated" and v.locator("[data-val]").count()==0,"compte rendu validé et figé")
    v.locator("[data-close]").click()
    ok(pg.locator(".mtgrow",has_text="Validé").count()==1,"liste des comptes rendus")
    # réunion suivante : reprise des actions ouvertes
    pg.locator("[data-new]").click();dlg=pg.locator("dialog.uidlg")
    dlg.locator("[data-k=title]").fill("COPIL");dlg.locator("[data-k=kind]").select_option("copil");dlg.locator("[data-ok]").click();pg.wait_for_timeout(300)
    ok("Envoyer la maquette" in pg.locator("#mtgview .mtgcands").inner_text(),"réunion suivante : actions ouvertes reprises")
    # changement de projet en préparation
    pg.locator("#mtgview .mtgproj select").select_option("q");pg.wait_for_timeout(300)
    s=st();mb=[x for x in s["projects"][1].get("meetings",[]) if x["title"]=="COPIL"]
    ok(mb and not any(x["title"]=="COPIL" for x in s["projects"][0]["meetings"]),"préparation : compte rendu réaffecté à un autre projet")
    ok("Envoyer la maquette" not in pg.locator("#mtgview .mtgcands").inner_text() and "Projet Beta" in pg.locator("#mtgview .mtgt").inner_text(),"ordre du jour recalculé pour le nouveau projet")
    # suppression depuis l'écran de réunion
    pg.locator("#mtgview [data-del]").click();pg.wait_for_timeout(300)
    ok(pg.locator("#mtgview").count()==0 and st()["projects"][1]["meetings"][0].get("deletedAt"),"compte rendu supprimé (corbeille logique)")
    # suppression depuis la liste (compte rendu validé) : les tâches créées restent
    pg.locator(".mtgrow [data-del]").first.click();pg.wait_for_timeout(300)
    s=st()
    ok(pg.locator(".mtgrow").count()==0 and any(x["title"]=="Envoyer la maquette d'étiquette" for x in s["tasks"]),"suppression depuis la liste, tâches conservées")
    b.close()
    # mode en ligne : réunion Outlook dans l'agenda
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":950})
    pg.on("pageerror",lambda e:errs.append("JS2: "+str(e)));on_dialog(pg,lambda d:d.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE)
    mon=datetime.date.today()-datetime.timedelta(days=datetime.date.today().weekday())
    dt=(mon+datetime.timedelta(days=1)).strftime("%Y%m%d")
    ics="BEGIN:VCALENDAR\\r\\nBEGIN:VEVENT\\r\\nUID:evt-1\\r\\nDTSTART:%sT120000Z\\r\\nDTEND:%sT140000Z\\r\\nSUMMARY:Atelier Réception – Projet Alpha\\r\\nLOCATION:Microsoft Teams\\r\\nEND:VEVENT\\r\\nEND:VCALENDAR\\r\\n"%(dt,dt)
    pg.add_init_script("(()=>{const cc=window.supabase.createClient;window.supabase.createClient=(...a)=>{const c=cc(...a);c.functions.invoke=async()=>({data:\"%s\",error:null});return c}})()"%ics)
    pg.add_init_script("localStorage.setItem('todo-mode','cloud');localStorage.setItem('todo-projets-ui',JSON.stringify({mode:'agenda',scope:'all',showMeetings:true}))")
    pg.goto(APP);pg.wait_for_timeout(1200)
    mt=pg.locator(".meet.clk",has_text="Atelier Réception")
    ok(mt.count()==1,"agenda : réunion Outlook cliquable")
    mt.click();dlg=pg.locator("dialog.uidlg")
    ok("Projet Alpha" in dlg.locator("[data-k=pid] option:checked").inner_text() and "reconnu" in dlg.inner_text(),"projet reconnu dans l'intitulé")
    dlg.locator("[data-ok]").click();pg.wait_for_timeout(1200)
    rows=pg.evaluate("window.__db.meetings||[]")
    ok(rows and rows[0]["outlook_key"].startswith("evt-1|") and rows[0]["location"]=="Microsoft Teams","compte rendu enregistré en ligne avec la réunion Outlook")
    pg.locator("#mtgview [data-close]").click();pg.wait_for_timeout(300)
    ok(pg.locator(".meet .crb").count()==1,"agenda : repère CR sur la réunion")
    pg.locator(".meet.clk",has_text="Atelier Réception").click();pg.wait_for_timeout(300)
    pg.locator("#mtgview [data-del]").click();pg.wait_for_timeout(1200)
    ok((pg.evaluate("window.__db.meetings")[0].get("deleted_at")) and pg.locator(".meet .crb").count()==0,"en ligne : suppression enregistrée")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
