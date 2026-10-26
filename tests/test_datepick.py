import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT
import json,datetime
from playwright.sync_api import sync_playwright
# Calendrier de l'appli (PC) : changer de mois ne met plus en surbrillance le même numéro de jour
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
data={"projects":[{"id":"p1","name":"Projet test","color":"#7A4FB5"}],"tasks":[],"requests":[],"points":[],"deleted":[]}
t=datetime.date.today();nx=(t.replace(day=1)+datetime.timedelta(days=32)).replace(day=15)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    pg.add_init_script("localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local')"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(400)
    pg.locator("#plist .pbtn").first.click();pg.wait_for_timeout(300)
    q=pg.locator("#qd")
    if not q.is_visible():
        pg.evaluate("()=>{const d=document.createElement('dialog');d.innerHTML='<input type=date id=qd2>';document.body.appendChild(d);d.showModal()}");q=pg.locator("#qd2")
    q.click();pg.wait_for_timeout(150)
    ok(pg.locator(".dpop").is_visible(),"le calendrier de l'appli s'ouvre au clic")
    ok(pg.locator(".dpop .dpd.tod").count()==1 and pg.locator(".dpop .dpd.tod").inner_text()==str(t.day),"le jour d'aujourd'hui est repéré")
    pg.locator(".dpop .dpn[data-m='1']").click();pg.wait_for_timeout(100)
    ok(pg.locator(".dpop .dpd.tod").count()==0 and pg.locator(".dpop .dpd.sel").count()==0,"mois suivant : aucun jour en surbrillance")
    pg.locator(".dpop .dpd[data-v='%s']"%nx.isoformat()).click();pg.wait_for_timeout(100)
    ok(q.input_value()==nx.isoformat() and pg.locator(".dpop").count()==0,"choisir le 15 remplit le champ et ferme le calendrier")
    # dans une fenêtre modale : le calendrier passe au-dessus
    pg.evaluate("()=>{const d=document.createElement('dialog');d.innerHTML='<input type=date id=dlgd min=\"2026-01-10\">';document.body.appendChild(d);d.showModal()}")
    pg.locator("#dlgd").click();pg.wait_for_timeout(150)
    bx=pg.locator(".dpop").bounding_box()
    top=pg.evaluate("([x,y])=>!!document.elementFromPoint(x,y).closest('.dpop')",[bx["x"]+bx["width"]/2,bx["y"]+bx["height"]/2])
    ok(top,"dans une fenêtre modale, le calendrier est au premier plan")
    pg.keyboard.press("Escape");pg.wait_for_timeout(100)
    ok(pg.locator(".dpop").count()==0 and pg.evaluate("document.querySelector('dialog #dlgd').closest('dialog').open"),"Échap ferme le calendrier sans fermer la fenêtre")
    pg.close()
    # déplacements déjà prévus : bande colorée et légende dans le calendrier des dates de déplacement
    pg=b.new_page(viewport={"width":1440,"height":900});pg.on("pageerror",lambda e:errs.append("JS3: "+str(e)))
    pg.add_init_script("localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local')"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(400)
    pg.locator(".pbtn",has_text="Projet test").click();pg.locator('#ptabs [data-tab="visits"]').click();pg.wait_for_timeout(300)
    pg.locator("#lists [data-startv], #lists .btn",has_text="Démarrer un déplacement").first.click();pg.wait_for_timeout(300)
    d=pg.locator("dialog.visnewdlg");d.locator('[data-ty="mes"]').click();d.locator("[data-ok]").click();pg.wait_for_timeout(500)
    for _ in range(3):
        if pg.locator("#visview [data-back]").count() and pg.locator("#visview [data-back]").first.is_visible():pg.locator("#visview [data-back]").first.click();pg.wait_for_timeout(400)
    ok(pg.evaluate("window.__dpTrips().length")==1,"le déplacement créé est connu du calendrier")
    pg.locator(".pbtn",has_text="Projet test").click();pg.locator('#ptabs [data-tab="visits"]').click();pg.wait_for_timeout(300)
    pg.locator("#lists [data-startv], #lists .btn",has_text="Démarrer un déplacement").first.click();pg.wait_for_timeout(300)
    pg.locator("dialog.visnewdlg [data-k='end']").click();pg.wait_for_timeout(200)
    ok(pg.locator(".dpop .dpd.trip[data-v='%s']"%t.isoformat()).count()==1,"le jour du déplacement existant est coloré")
    ok(pg.locator(".dpop .dpli").count()==1 and "Mise en service" in pg.locator(".dpop .dpli").inner_text(),"légende : déplacement prévu affiché sous le calendrier")
    pg.screenshot(path=OUT+"datepick_trips.png")
    pg.close()
    # téléphone : calendrier natif conservé
    m=b.new_page(viewport={"width":390,"height":844},has_touch=True,is_mobile=True);m.goto(APP);m.wait_for_timeout(300)
    ok(not m.evaluate("document.documentElement.classList.contains('dp-on')"),"téléphone : calendrier natif conservé")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
