import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":390,"height":844})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)));RESP={}
    def dlg(d):
        for k,val in RESP.items():
            if k in d.message:d.accept(val);return
        d.accept()
    on_dialog(pg,dlg)
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script("localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(1200)
    h=pg.evaluate("Math.round(document.querySelector('#side').getBoundingClientRect().height)")
    ok(h<=80,"en-tête compact (%d px)"%h)
    ok(not pg.locator("#search").is_visible() and not pg.locator(".pbtn").first.is_visible(),"recherche et projets repliés")
    pg.locator("#srchbtn").click();pg.wait_for_timeout(100)
    ok(pg.locator("#search").is_visible() and pg.evaluate("document.activeElement.id")=="search","loupe : ouvre la recherche")
    pg.locator("#srchbtn").click()
    ok(not pg.locator("#trashbtn").is_visible(),"pas de bouton corbeille flottant")
    pg.locator("#menubtn").click();pg.wait_for_timeout(200)
    ok(pg.locator(".vbtn",has_text="Corbeille").is_visible(),"corbeille dans le menu")
    pg.locator("#menubtn").click()
    # écran Projets : icônes, autres vues
    pg.locator(".bnav [data-b=menu]").click();pg.wait_for_timeout(200)
    ok(pg.locator(".pjt[data-p]").count()==2 and pg.locator(".pjic",has_text="PA").count()==1,"écran Projets : projets en icônes")
    ok(pg.locator(".pjv",has_text="Corbeille").is_visible() and pg.locator(".pjv",has_text="Demandes client").is_visible(),"écran Projets : autres vues")
    ok(pg.locator(".bnav [data-b=menu]").get_attribute("aria-current")=="true","barre du bas : Projets actif")
    pg.locator(".pjt",has_text="Projet Alpha").click();pg.wait_for_timeout(300)
    ok(pg.locator(".phtile").count()==4 and not pg.locator("#ptabs").is_visible(),"accueil du projet : 4 rubriques, sans onglets")
    ok("relance" in pg.locator(".phalert").inner_text(),"alerte : relance à faire")
    ok(pg.locator(".phnext .phrow").count()>=1,"prochaines échéances")
    pg.screenshot(path=OUT+"mobile_home.png")
    RESP["Ajouter au projet"]="Une tâche"
    pg.locator(".fab").click();pg.wait_for_timeout(400)
    ok(pg.evaluate("document.body.dataset.mode")=="list" and pg.locator("#qt").is_visible(),"bouton + : ajout d'une tâche")
    pg.locator("#pback").click();pg.wait_for_timeout(200)
    ok(pg.evaluate("document.body.dataset.mode")=="home","retour à l'accueil du projet")
    pg.locator(".phtile",has_text="Tâches").click();pg.wait_for_timeout(300)
    ok(pg.locator("#ptitle").inner_text()=="Tâches" and "Projet Alpha" in pg.locator("#pback").inner_text(),"rubrique : titre et retour au projet")
    top=pg.evaluate("Math.round(document.querySelector('#lists').getBoundingClientRect().top)")
    ok(top<330,"la liste commence haut dans l'écran (%d px)"%top)
    ok(not pg.locator("#ptools .sharebtn").is_visible() and not pg.locator("#ptools .ddexp").is_visible(),"Partager et Exporter regroupés")
    pg.locator(".ddmore summary").click()
    ok(pg.locator(".ddmore .menu button",has_text="Partager le projet").is_visible() and pg.locator(".ddmore .menu button",has_text="Exporter le plan d'actions").is_visible(),"menu ⋯ : partager et exporter")
    pg.locator(".ddmore summary").click()
    ok(not pg.locator("#viewbar .vbr").is_visible(),"réglages d'affichage repliés")
    pg.locator("#viewbar .vbfilt").click()
    ok(pg.locator("#viewbar .vbr").is_visible(),"bouton Filtres : réglages affichés")
    pg.locator("#whosel").select_option("__me");pg.wait_for_timeout(200)
    ok("1" in pg.locator("#viewbar .vbfilt b").inner_text(),"nombre de filtres actifs affiché")
    ok(pg.evaluate("document.documentElement.scrollWidth")<=390,"pas de débordement horizontal")
    pg.screenshot(path=OUT+"mobile_ui.png")
    # l'ordinateur garde l'affichage complet
    pg.set_viewport_size({"width":1440,"height":900});pg.wait_for_timeout(200)
    ok(pg.locator("#search").is_visible() and pg.locator("#ptools .sharebtn").is_visible() and not pg.locator("#viewbar .vbfilt").is_visible(),"ordinateur : affichage inchangé")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
