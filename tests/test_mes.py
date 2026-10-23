import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,on_dialog
import json,datetime
from playwright.sync_api import sync_playwright
# Déplacements : types (visite d'analyse, dry run à venir, mise en service), mise en service jour par jour, notes séparées par jour
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
data={"projects":[{"id":"p","name":"Projet Alpha","color":"#E0703A"}],"tasks":[],"requests":[],"points":[],"deleted":[]}
INIT="if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data))
R={}   # réponses aux boîtes intégrées, par type
def handler(d):
    r=R.get(d.type)
    if isinstance(r,list): r=r.pop(0) if r else None
    if r=="__no": d.dismiss()
    else: d.accept(r)
today=datetime.date.today()
with sync_playwright() as pw:
    b=pw.chromium.launch()
    # ---------- Boîte de création réelle (sans réponses automatiques) ----------
    pg=b.new_page(viewport={"width":1440,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    pg.add_init_script(INIT);pg.goto(APP);pg.wait_for_timeout(500)
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator('#ptabs [data-tab="visits"]').click();pg.wait_for_timeout(300)
    pg.locator("#lists [data-startv], #lists .btn",has_text="Démarrer un déplacement").first.click();pg.wait_for_timeout(300)
    d=pg.locator("dialog.visnewdlg")
    ok(d.is_visible() and d.locator('[data-ty="dry"]').is_disabled() and "Bientôt disponible" in d.locator('[data-ty="dry"]').inner_text(),"création : Dry run grisé « Bientôt disponible »")
    ok(d.locator('[data-k="title"]').input_value()=="Visite d'analyse fonctionnelle" and d.locator('[data-k="end"]').input_value()==(today+datetime.timedelta(days=1)).isoformat(),"création : visite d'analyse sur 2 jours par défaut")
    d.locator('[data-ty="mes"]').click()
    ok(d.locator('[data-k="title"]').input_value()=="Mise en service" and d.locator('[data-k="end"]').input_value()==(today+datetime.timedelta(days=4)).isoformat(),"création : mise en service sur 5 jours par défaut")
    pg.screenshot(path=OUT+"mes_new.png")
    d.locator("[data-ok]").click();pg.wait_for_timeout(500)
    v=pg.locator("#visview")
    ok(v.locator(".mesdesk").is_visible() and v.locator(".mesdays [data-day]").count()==5,"ordinateur : journées à gauche (5 jours)")
    ok(v.locator(".mesrow").count()==6 and v.locator(".mesrow h3",has_text="Ressenti Projet Alpha").count()==1,"6 rubriques par défaut, « Ressenti » au nom du projet")
    ok(v.locator(".mesr .viscap").is_visible() and v.locator(".mesr .visseg").is_hidden(),"ordinateur : saisie des notes du jour à droite, sans types de note")
    v.locator(".mesr .visin .rte").fill("Arrivée sur site à 9h15");v.locator(".mesr [data-add]").click();pg.wait_for_timeout(300)
    ok(v.locator(".mesr .visnote").count()==1,"note du jour ajoutée")
    pg.screenshot(path=OUT+"mes_pc.png")
    pg.close()
    # ---------- Téléphone : la journée, les éléments, la reprise ----------
    pg=b.new_page(viewport={"width":390,"height":844})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,handler)
    pg.add_init_script(INIT);pg.goto(APP);pg.wait_for_timeout(500)
    pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Alpha").click();pg.locator(".phtile",has_text="Déplacements").click();pg.wait_for_timeout(300)
    R["visnew"]={"type":"mes"}
    pg.locator("#lists .btn",has_text="Démarrer un déplacement").first.click();pg.wait_for_timeout(500)
    v=pg.locator("#visview")
    ok(v.locator(".vish .mesdays [data-day]").count()==5 and v.locator('.mesdays [aria-selected="true"] b').inner_text().startswith("J1"),"téléphone : onglets J1 à J5, J1 sélectionné")
    row=lambda t:v.locator(".mesrow",has=pg.locator("h3",has_text=t))
    R["mesitem"]={"t":"Déclenchement des réapprovisionnements","d":"Analyse en cours","who":"Adrien","st":"En cours"}
    row("Problèmes majeurs").locator("[data-addit]").click();pg.wait_for_timeout(300)
    ok(row("Problèmes majeurs").locator(".mesit").count()==1 and "Adrien" in row("Problèmes majeurs").inner_text(),"élément ajouté dans « Problèmes majeurs »")
    R["mesitem"]={"t":"Documents de réception","d":"Faire le point avec Alain","who":"Maxime","st":"À faire"}
    row("Points à traiter").locator("[data-addit]").click();pg.wait_for_timeout(300)
    R["mesitem"]={"t":"Étiquettes supports","who":"Pierre","st":"En cours"}
    row("Problèmes majeurs").locator("[data-addit]").click();pg.wait_for_timeout(300)
    R["mesitem"]={"t":"Étiquettes supports","d":"Impression corrigée","who":"Pierre","st":"Fait"}
    row("Problèmes majeurs").locator(".mesit",has_text="Étiquettes supports").click();pg.wait_for_timeout(300)
    ok(row("Process OK").locator(".mesit",has_text="Étiquettes supports").count()==1 and row("Problèmes majeurs").locator(".mesit").count()==1,"passé à « Fait » : rangé tout seul dans « Process OK »")
    ed=row("Statut de l'installation").locator(".rte");ed.click();ed.fill("Résolution majeure sur les ordres de sortie.");v.locator(".mesbar b").click();pg.wait_for_timeout(900)
    # rubrique ajoutée puis supprimée
    R["sheet"]=["Texte libre"];R["prompt"]="Sécurité"
    v.locator("[data-addrow]").click();pg.wait_for_timeout(400)
    ok(row("Sécurité").count()==1,"rubrique ajoutée (texte libre)")
    R["sheet"]=["Liste d'éléments (sujet, qui, statut)"];R["prompt"]="Formation"
    v.locator("[data-addrow]").click();pg.wait_for_timeout(400)
    R["sheet"]=["Supprimer la rubrique"]
    row("Sécurité").locator("[data-rm]").click();pg.wait_for_timeout(400)
    ok(row("Sécurité").count()==0 and row("Formation").count()==1,"rubrique supprimée")
    pg.screenshot(path=OUT+"mes_phone.png",full_page=False)
    # copie pour Confluence
    pg.evaluate("()=>{window.__clip=null;navigator.clipboard.write=async items=>{window.__clip=await (await items[0].getType('text/html')).text();window.__clipt=await (await items[0].getType('text/plain')).text()}}")
    R["sheet"]=["Copier pour Confluence (compte rendu du jour)"]
    v.locator("[data-cr]").click();pg.wait_for_timeout(500)
    clip=pg.evaluate("window.__clip")or""
    ok("<table" in clip and "Documents de réception" in clip and "(Maxime - À faire)" in clip and "Résolution majeure" in clip,"compte rendu copié en tableau pour Confluence")
    v.locator("[data-close]").click();pg.wait_for_timeout(300)
    ok("cl" in (v.locator('.mesdays [data-day]').first.get_attribute("class") or ""),"journée clôturée (pastille verte)")
    # jour 2 : reprise des rubriques et des éléments non terminés
    v.locator(".mesdays [data-day]").nth(1).click();pg.wait_for_timeout(300)
    v.locator("[data-mkday]").click();pg.wait_for_timeout(400)
    ok(row("Formation").count()==1 and row("Process OK").locator(".mesit").count()==0,"jour 2 : rubriques de la veille reprises, éléments « Fait » non repris")
    ok(row("Problèmes majeurs").locator(".mesit",has_text="Déclenchement").count()==1 and row("Points à traiter").locator(".mesit",has_text="Documents").count()==1,"jour 2 : éléments en cours et à faire repris")
    ok(row("Statut de l'installation").locator(".rte").inner_text().strip()=="","jour 2 : textes vides")
    R["mesitem"]={"t":"Étiquettes supports","st":"Fait"};R["dialog"]="upd"
    row("Process OK").locator("[data-addit]").click();pg.wait_for_timeout(400)
    ok(row("Process OK").locator(".mesit",has_text="Étiquettes supports").count()==1 and "Pierre" in row("Process OK").inner_text(),"sujet déjà saisi la veille : mis à jour au lieu d'être doublé")
    R["mesitem"]={"t":"Documents de réception","st":"En cours"};R["dialog"]="upd"
    row("Points à traiter").locator("[data-addit]").click();pg.wait_for_timeout(400)
    ok(v.locator(".mesit",has_text="Documents de réception").count()==1 and "En cours" in v.locator(".mesit",has_text="Documents de réception").inner_text(),"sujet déjà présent dans la journée : point existant mis à jour")
    R["mesitem"]={"t":"Transporteur","d":"Format du téléphone Bpost","who":"Adrien","st":"Annulée"}
    row("Problèmes majeurs").locator("[data-addit]").click();pg.wait_for_timeout(300)
    ok(row("Problèmes majeurs").locator(".tag.mes-ann").count()==1,"état « Annulée » disponible")
    R["sheet"]=["Copier pour Excel (points Go Live)"]
    v.locator("[data-cr]").click();pg.wait_for_timeout(500)
    rows=[r.split("\t") for r in (pg.evaluate("window.__clipt") or "").split("\r\n") if r]
    ok(len(rows)==4 and rows[0][:2]==["1","Déclenchement des réapprovisionnements"] and [r[1] for r in rows].count("Étiquettes supports")==1 and [r[1] for r in rows].count("Documents de réception")==1 and [r[1] for r in rows].count("Déclenchement des réapprovisionnements")==1 and any(r[1]=="Étiquettes supports" and r[3]=="Fait" for r in rows) and rows[-1][3]=="Annulée","copie Excel : N°, Sujet, Commentaire, État, Qui – sans doublon d'un jour sur l'autre")
    # notes du jour sur téléphone
    v.locator(".mesnotes [data-f]").click();pg.wait_for_timeout(300)
    v.locator(".visin .rte").fill("Point sécurité à 14h");v.locator("[data-add]").click();pg.wait_for_timeout(300)
    v.locator("[data-back]").click();pg.wait_for_timeout(300)
    ok(v.locator(".mesnotes .visnote").count()==1,"téléphone : note ajoutée à la journée")
    v.locator("[data-mesend]").click();pg.wait_for_timeout(500)
    st=pg.evaluate("JSON.parse(localStorage.getItem('todo-projets'))")
    ok(len(st["tasks"])==0,"aucune tâche créée dans le projet (pas de doublon)")
    ok(pg.locator("#lists .mtgrow",has_text="Mise en service").count()==1,"liste : mise en service terminée")
    pg.close()
    # ---------- Visite d'analyse : notes séparées par jour ----------
    pg=b.new_page(viewport={"width":390,"height":844})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,handler)
    pg.add_init_script(INIT);pg.goto(APP);pg.wait_for_timeout(500)
    pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Alpha").click();pg.locator(".phtile",has_text="Déplacements").click();pg.wait_for_timeout(300)
    R["visnew"]=None
    pg.locator("#lists .btn",has_text="Démarrer un déplacement").first.click();pg.wait_for_timeout(500)
    v=pg.locator("#visview")
    v.locator(".vistile",has_text="Réception").click();pg.wait_for_timeout(300)
    v.locator(".visin .rte").fill("Trois quais de réception");v.locator("[data-add]").click();pg.wait_for_timeout(300)
    ok(v.locator(".visdayf button").count()==3 and v.locator(".visdsep",has_text="Jour 1").count()==1,"visite sur 2 jours : filtre par jour et intertitre « Jour 1 »")
    v.locator('.visdayf [data-dayf]').nth(2).click();pg.wait_for_timeout(200)
    ok(v.locator(".visnote").count()==0 and "Aucune note ce jour-là" in v.inner_text(),"filtre « Jour 2 » : notes du jour 1 masquées")
    pg.close()
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
