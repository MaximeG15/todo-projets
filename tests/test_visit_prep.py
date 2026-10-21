import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
PTS="""window.__db.open_points=[
 {id:'o1',project_id:'p1',text:'Format des étiquettes de réception ?',answer:'',hypothesis:'',erp:'',theme:'Réception',owner:'client',owner_name:'',status:'open',created_at:1,updated_at:1},
 {id:'o2',project_id:'p1',text:'Zones de stockage ?',answer:'',hypothesis:'',erp:'',theme:'Stockage',owner:'client',owner_name:'',status:'open',created_at:2,updated_at:1},
 {id:'o3',project_id:'p1',text:'Interface ERP des réceptions',answer:'',hypothesis:'',erp:'',theme:'Réception',owner:'mecalux',owner_name:'',status:'open',created_at:3,updated_at:1},
 {id:'o4',project_id:'p1',text:'Documents imprimés à l expédition ?',answer:'',hypothesis:'',erp:'',theme:'Expéditions',owner:'client',owner_name:'',status:'open',created_at:4,updated_at:1}];"""
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1280,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script(PTS);pg.add_init_script("localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(1200)
    # --- préparation sur ordinateur
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator('#ptabs [data-tab="visits"]').click();pg.wait_for_timeout(300)
    pg.locator("#lists [data-prep]").click();pg.wait_for_timeout(500)
    v=pg.locator("#visview")
    ok(v.locator("[data-start]").is_visible(),"préparation : écran ouvert, bouton Démarrer")
    fl=lambda n:v.locator(".visfl",has=pg.locator("b",has_text=n))
    ok(fl("Réception").locator(".visprepi").count()==1 and fl("Stockage").locator(".visprepi").count()==1 and fl("Expédition").locator(".visprepi").count()==1,"points ouverts « client » repris par thème (pluriel compris)")
    ok(not any("Interface ERP" in t for t in v.locator(".visprepi").all_inner_texts()),"point côté Mecalux non repris")
    v.locator('[data-k="plannedAt"]').fill("2026-10-28T09:30");v.locator('[data-k="plannedAt"]').dispatch_event("change")
    v.locator('[data-k="location"]').fill("Site de Lyon, quai nord");v.locator('[data-k="location"]').dispatch_event("change")
    v.locator('[data-k="goal"]').fill("Analyser réception et stockage");v.locator('[data-k="goal"]').dispatch_event("change")
    fl("Réception").locator(".visprepadd input").fill("Photographier les étiquettes fournisseur");fl("Réception").locator(".visprepadd button").click();pg.wait_for_timeout(200)
    ok(fl("Réception").locator(".visprepi").count()==2,"élément libre ajouté")
    fl("Inventaire").locator("[data-on]").uncheck();pg.wait_for_timeout(200)
    fl("Stockage").locator("[data-up]").click();pg.wait_for_timeout(200)
    names=v.locator(".visflh b").all_inner_texts()
    ok(names.index("Stockage")<names.index("Réception"),"ordre des flux modifié")
    pg.screenshot(path=OUT+"visit_prep.png")
    v.locator("[data-x]").click();pg.wait_for_timeout(1800)
    row=pg.locator("#lists .mtgrow").first
    print("   ",row.inner_text().replace("\n"," | "))
    ok("Préparée" in row.inner_text() and "4 éléments à voir" in row.inner_text() and "28 oct" in row.inner_text().lower(),"liste : visite préparée, datée")
    r=pg.evaluate("window.__db.visits")[0]
    ok(r["status"]=="prep" and len(r["items"])==4 and r["prep"]["location"].startswith("Site de Lyon"),"préparation enregistrée en ligne")
    # --- sur site, téléphone
    pg.set_viewport_size({"width":390,"height":844});pg.wait_for_timeout(200)
    pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Alpha").click();pg.wait_for_timeout(200)
    ok("Préparée" in pg.locator(".phtile",has_text="Visites").inner_text(),"accueil du projet : visite préparée")
    pg.locator(".phtile",has_text="Visites").click();pg.locator("#lists .mtgrow").first.click();pg.wait_for_timeout(300)
    v.locator("[data-start]").click();pg.wait_for_timeout(300)
    ok(v.locator(".vistile:not(.add)").count()==7 and v.locator(".vistile",has_text="Inventaire").count()==0,"visite démarrée : flux non couverts masqués")
    ok("0/2 vus" in v.locator(".vistile",has_text="Réception").inner_text(),"avancement sur la tuile")
    v.locator(".vistile",has_text="Réception").click();pg.wait_for_timeout(300)
    ok(v.locator(".visitems .visit").count()==2,"flux : liste « À voir »")
    v.locator(".visit",has_text="Format des étiquettes").locator("[data-rep]").click()
    ok("Format des étiquettes" in v.locator(".visreply").inner_text(),"répondre : élément rappelé dans la saisie")
    v.locator(".visin textarea").fill("Format 100x150 validé par le client");v.locator("[data-add]").click();pg.wait_for_timeout(300)
    ok(v.locator(".visnote .visre").count()==1 and v.locator(".visit.seen").count()==1,"réponse rattachée, élément marqué vu")
    v.locator(".visit",has_text="Photographier").locator("[data-seen]").click();pg.wait_for_timeout(200)
    v.locator("[data-back]").click();pg.wait_for_timeout(200)
    ok("2/2 vus" in v.locator(".vistile",has_text="Réception").inner_text(),"tuile : tout est vu")
    pg.screenshot(path=OUT+"visit_live.png")
    v.locator("[data-end]").click();pg.wait_for_timeout(300)
    ok("Points ouverts répondus sur site" in v.inner_text() and "Restant à voir" in v.inner_text(),"bilan : réponses et restant à voir")
    pg.screenshot(path=OUT+"visit_end2.png")
    v.locator('[data-close]').check();v.locator("[data-apply]").click();pg.wait_for_timeout(1500)
    o1=[o for o in pg.evaluate("window.__db.open_points") if o["id"]=="o1"][0]
    ok("Visite du 28/10/2026" not in o1["answer"] and "Format 100x150" in o1["answer"] and o1["status"]=="closed","réponse ajoutée au point et point levé")
    o2=[o for o in pg.evaluate("window.__db.open_points") if o["id"]=="o2"][0]
    ok(o2["status"]=="open" and o2["answer"]=="","point non vu : reste ouvert, inchangé")
    pg.evaluate("()=>{const d=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{set(x){window.__lastPrint=x;d.set.call(this,x)},get(){return d.get.call(this)}})}")
    v.locator("[data-pdf]").click();pg.wait_for_timeout(1200)
    pr=pg.evaluate("window.__lastPrint||''")
    ok("Site de Lyon" in pr and "Vu · " in pr and "Non vu · " in pr and "réponse à" in pr,"PDF : préparation, éléments vus / non vus, réponses")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
