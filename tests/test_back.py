import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,FAKE,on_dialog
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":390,"height":844},has_touch=True)
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script("localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(1200)
    back=lambda:(pg.evaluate("history.back()"),pg.wait_for_timeout(400))
    mode=lambda:pg.evaluate("document.body.dataset.mode")
    start=mode();url=pg.url
    pg.locator(".bnav [data-b=menu]").click();pg.wait_for_timeout(200)
    pg.locator(".pjt",has_text="Projet Alpha").click();pg.wait_for_timeout(200)
    ok(mode()=="home","accueil du projet")
    pg.locator(".phtile",has_text="Points").click();pg.wait_for_timeout(200)
    ok(mode()=="points","rubrique Points ouverts")
    back();ok(mode()=="home" and pg.url==url,"retour : accueil du projet, l'appli reste ouverte")
    back();ok(mode()=="projects","retour : écran Projets")
    back();ok(mode()==start,"retour : écran de départ (%s)"%start)
    # visite : flux puis accueil de la visite puis fermeture
    pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Alpha").click();pg.locator(".phtile",has_text="Visites").click();pg.wait_for_timeout(200)
    on=pg.locator("#lists [data-new]")
    pg.evaluate("window.__testDialog=null")
    on.click();pg.wait_for_timeout(300);pg.locator("dialog.uidlg button",has_text="Démarrer").click();pg.wait_for_timeout(400)
    v=pg.locator("#visview");v.locator(".vistile",has_text="Réception").click();pg.wait_for_timeout(200)
    ok(v.locator(".vist b").inner_text()=="Réception","visite : écran du flux")
    back();ok(v.is_visible() and v.locator(".vistile").count()>0,"retour : accueil de la visite")
    back();ok(pg.locator("#visview").count()==0 and mode()=="visits","retour : visite fermée, liste des visites")
    # fenêtre ouverte : fermée par le retour
    pg.locator("#lists .mtgrow").first.click();pg.wait_for_timeout(300)
    pg.locator("#visview [data-vm]").click();pg.wait_for_timeout(200)
    ok(pg.locator("dialog.vissheet").count()==1,"menu de la visite ouvert")
    back();ok(pg.locator("dialog[open]").count()==0 and pg.locator("#visview").is_visible(),"retour : menu fermé, on reste dans la visite")
    back();back();back();back()
    # cloche
    pg.locator(".bellbtn.m").click();pg.wait_for_timeout(200)
    ok(pg.locator("#notifpop").is_visible(),"panneau de notifications ouvert")
    back();ok(pg.locator("#notifpop").is_hidden(),"retour : panneau fermé")
    # à l'écran de départ : message, l'appli ne se ferme pas au premier appui
    for i in range(8):
        if pg.evaluate("window.__navState().stack")<=1:break
        back()
    back()
    ok("Appuyez encore sur Retour" in pg.locator("#toast").inner_text() and pg.url==url,"écran de départ : message « appuyez encore pour quitter »")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
