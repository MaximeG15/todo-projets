import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
# Photo de test générée dans la page (pas de vraie photo)
PHOTO="""window.__testPhoto=()=>new Promise(r=>{const c=document.createElement('canvas');c.width=2400;c.height=1800;const g=c.getContext('2d');
  g.fillStyle='#6E7E88';g.fillRect(0,0,2400,1800);g.fillStyle='#E0703A';g.fillRect(200,600,2000,60);g.fillStyle='#C9B79A';g.fillRect(400,700,500,400);
  c.toBlob(b=>r(new File([b],'photo.jpg',{type:'image/jpeg'})),'image/jpeg',0.9)});"""
with sync_playwright() as pw:
    b=pw.chromium.launch();ctx=b.new_context(viewport={"width":390,"height":844},device_scale_factor=2,has_touch=True)
    pg=ctx.new_page()
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    RESP={}  # sous-chaîne du message -> réponse
    def dlg(d):
        for k,val in RESP.items():
            if k in d.message:d.accept(val);return
        d.accept()
    on_dialog(pg,dlg)
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script(PHOTO)
    pg.add_init_script("localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(1200)
    pg.evaluate("document.querySelector('.pbtn')&&0")
    # ouvrir le projet depuis le menu (téléphone)
    pg.locator(".bnav [data-b=menu]").click();pg.wait_for_timeout(200)
    pg.locator(".pjt",has_text="Projet Alpha").click();pg.wait_for_timeout(300)
    pg.locator(".phtile",has_text="Visites").click();pg.wait_for_timeout(300)
    ok("Préparer une visite" in pg.locator("#lists").inner_text(),"onglet Visites")
    pg.locator("#lists [data-new]").click();pg.wait_for_timeout(500)
    v=pg.locator("#visview")
    ok(v.is_visible() and v.locator(".vistile:not(.add)").count()==8,"nouvelle visite : 8 flux par défaut")
    pg.screenshot(path=OUT+"visit_home.png")
    # ajouter un flux
    v.locator("[data-addf]").click();pg.wait_for_timeout(200)
    ok(v.locator(".vistile:not(.add)").count()==8,"ajout de flux annulé si nom vide")
    RESP["Nom du nouveau flux"]="Quais"
    v.locator("[data-addf]").click();pg.wait_for_timeout(300)
    ok(v.locator(".vistile",has_text="Quais").count()==1,"flux ajouté")
    # flux Réception : note de type question
    v.locator(".vistile",has_text="Réception").click();pg.wait_for_timeout(300)
    ok(v.locator(".vist b").inner_text()=="Réception","écran du flux")
    v.locator('[data-t="question"]').click()
    v.locator(".visin textarea").fill("Question test sur les étiquettes fournisseur ?")
    v.locator("[data-add]").click();pg.wait_for_timeout(300)
    ok(v.locator(".visnote .nt-q").count()==1,"note « Question client » ajoutée")
    # photos : deux photos annotées, légende
    v.locator("[data-cam]").click();pg.wait_for_timeout(1200)
    ed=pg.locator(".visedit")
    ok(ed.is_visible(),"éditeur photo ouvert")
    cv=ed.locator(".visstagecv canvas");bb=cv.bounding_box()
    pg.mouse.move(bb["x"]+bb["width"]*.3,bb["y"]+bb["height"]*.3);pg.mouse.down();pg.mouse.move(bb["x"]+bb["width"]*.6,bb["y"]+bb["height"]*.6,steps=5);pg.mouse.up()
    ed.locator(".viscapt").fill("Quai 3")
    pg.screenshot(path=OUT+"visit_photo.png")
    ed.locator("footer [data-more]").click();pg.wait_for_timeout(1200)
    ok("Photo 2 sur 2" in ed.inner_text(),"série : deuxième photo")
    ed.locator("[data-tool=arrow]").click()
    bb=ed.locator(".visstagecv canvas").bounding_box()
    pg.mouse.move(bb["x"]+20,bb["y"]+20);pg.mouse.down();pg.mouse.move(bb["x"]+120,bb["y"]+90,steps=4);pg.mouse.up()
    ed.locator("[data-ok]").click();pg.wait_for_timeout(1500)
    ok(v.locator(".visstage .vph").count()==2,"2 photos jointes à la note en cours")
    v.locator('[data-t="action"]').click();v.locator(".visin textarea").fill("Récupérer un exemple de bon de livraison")
    v.locator("[data-add]").click();pg.wait_for_timeout(800)
    ok(v.locator(".visnote").count()==2 and v.locator(".visnote .vph img[src^='blob:']").count()==2,"note « Action » avec ses 2 photos affichées")
    pg.screenshot(path=OUT+"visit_flow.png")
    info=pg.evaluate("""async()=>{const d=await new Promise(r=>{const q=indexedDB.open('todo-projets-visites');q.onsuccess=()=>r(q.result)});
      const all=await new Promise(r=>{const q=d.transaction('photos').objectStore('photos').getAll();q.onsuccess=()=>r(q.result)});
      const out=[];for(const p of all){const bm=await createImageBitmap(p.blob);out.push([p.blob.size,bm.width,bm.height])}return out}""")
    ok(len(info)==2 and all(w<=1600 and h<=1600 and s<700000 for s,w,h in info),"photos réduites (≤ 1600 px) : "+str(info))
    pg.wait_for_timeout(2500)
    st=pg.evaluate("Object.keys(window.__storage||{})")
    rows=pg.evaluate("window.__db.visits||[]")
    ok(len(st)==2 and all(k.startswith("visit-photos/p1/") for k in st),"photos envoyées dans le stockage privé du projet")
    ok(len(rows)==1 and len(rows[0]["notes"])==2,"visite enregistrée en ligne")
    # hors connexion
    ctx.set_offline(True);pg.wait_for_timeout(200)
    v.locator('[data-t="note"]').click();v.locator(".visin textarea").fill("Note prise sans réseau")
    v.locator("[data-add]").click();pg.wait_for_timeout(2500)
    ok("Hors ligne" in v.locator(".visst").inner_text() and "attente" in v.locator(".visst").inner_text(),"hors connexion : enregistré sur le téléphone, en attente")
    ok(len(pg.evaluate("window.__db.visits")[0]["notes"])==2,"hors connexion : rien n'est envoyé")
    ctx.set_offline(False);pg.wait_for_timeout(2500)
    ok(len(pg.evaluate("window.__db.visits")[0]["notes"])==3 and "tout est enregistré" in v.locator(".visst").inner_text(),"retour du réseau : envoi automatique")
    # déplacer une note
    RESP["Note de"]="Déplacer vers un autre flux"
    v.locator(".visnote").last.locator("[data-more]").click();pg.wait_for_timeout(300)
    pg.locator("dialog.vissheet [data-f]",has_text="Stockage").click();pg.wait_for_timeout(300)
    ok(v.locator(".visnote").count()==2,"note déplacée vers un autre flux")
    # fin de visite : points et tâches
    v.locator("[data-back]").click();pg.wait_for_timeout(200)
    ok("1 note" in v.locator(".vistile",has_text="Stockage").inner_text(),"compteurs des flux à jour")
    v.locator("[data-end]").click();pg.wait_for_timeout(300)
    ok("1 question" in v.inner_text() and "1 action" in v.inner_text(),"bilan : questions et actions à créer")
    pg.screenshot(path=OUT+"visit_end.png")
    v.locator("[data-apply]").click();pg.wait_for_timeout(1500)
    pts=[o for o in pg.evaluate("window.__db.open_points||[]") if o["project_id"]=="p1"]
    tks=[t for t in pg.evaluate("window.__db.tasks") if "Issu de la visite" in (t.get("note") or "")]
    ok(any(o["text"].startswith("Question test") and o["theme"]=="Réception" and o["owner"]=="client" for o in pts),"question devenue point ouvert (thème = flux)")
    ok(len(tks)==1 and tks[0]["title"]=="Récupérer un exemple de bon de livraison","action devenue tâche")
    ok("déjà été créés" in v.inner_text(),"pas de doublon possible")
    pg.evaluate("()=>{const d=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{set(v){window.__lastPrint=v;d.set.call(this,v)},get(){return d.get.call(this)}})}")
    v.locator("[data-pdf]").click();pg.wait_for_timeout(1500)
    pr=pg.evaluate("window.__lastPrint||''")
    ok("Réception" in pr and pr.count("<img")==2 and "Quai 3" in pr,"export PDF avec photos et légendes")
    v.locator("[data-done]").click();pg.wait_for_timeout(500)
    ok(v.is_hidden() and pg.locator("#lists .mtgrow",has_text="Terminée").count()==1,"bilan : « Clôturer la visite » ramène à la liste, visite terminée")
    # rechargement : tout est relu, photos comprises
    pg.reload();pg.wait_for_timeout(1500)
    pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Alpha").click();pg.locator(".phtile",has_text="Visites").click();pg.wait_for_timeout(800)
    pg.locator("#lists .mtgrow").first.click();pg.wait_for_timeout(300)
    pg.locator("#visview .vistile",has_text="Réception").click();pg.wait_for_timeout(800)
    ok(pg.locator("#visview .vph img[src^='blob:']").count()==2,"après rechargement : notes et photos")
    # suppression : photos retirées du stockage
    pg.locator("#visview [data-back]").click();pg.locator("#visview [data-back]").click();pg.wait_for_timeout(300)
    pg.locator("#lists .mtgrow").first.click();pg.wait_for_timeout(300)
    RESP["Visite d'analyse"]="Supprimer la visite"
    pg.locator("#visview [data-vm]").click();pg.wait_for_timeout(2500)
    ok(pg.locator("#lists .mtgrow").count()==0 and not pg.evaluate("Object.keys(window.__storage||{})"),"visite supprimée avec ses photos")
    b.close()
    # mode local (sans compte) : tout reste sur l'appareil
    import json
    data={"projects":[{"id":"p","name":"Projet Local","color":"#E0703A"}],"tasks":[],"requests":[],"points":[],"deleted":[]}
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":390,"height":844})
    SHEET={}
    pg.on("pageerror",lambda e:errs.append("JS3: "+str(e)));on_dialog(pg,lambda d:d.accept(SHEET.get(d.type)))
    pg.add_init_script(PHOTO)
    pg.add_init_script("""window.__testGallery=()=>Promise.all([1,2,3].map(i=>new Promise(r=>{const c=document.createElement('canvas');c.width=1200;c.height=900;const g=c.getContext('2d');g.fillStyle=['#2F7D5B','#1D4E78','#B42318'][i-1];g.fillRect(0,0,1200,900);c.toBlob(b=>r(new File([b],'g'+i+'.jpg',{type:'image/jpeg'})),'image/jpeg',0.9)})));""")
    pg.add_init_script("if(!localStorage.getItem('__seed')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('__seed','1')}"%json.dumps(json.dumps(data)))
    pg.goto(APP);pg.wait_for_timeout(500)
    pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Local").click();pg.locator(".phtile",has_text="Visites").click()
    pg.locator("#lists [data-new]").click();pg.wait_for_timeout(300)
    v=pg.locator("#visview");v.locator(".vistile",has_text="Stockage").click()
    v.locator("[data-cam]").click();pg.wait_for_timeout(1200);pg.locator(".visedit [data-ok]").click();pg.wait_for_timeout(800)
    v.locator(".visin textarea").fill("Note locale");v.locator("[data-add]").click();pg.wait_for_timeout(500)
    ok("mode local" in v.locator(".visst").inner_text(),"mode local : enregistré sur cet appareil")
    # galerie : plusieurs photos d'un coup, depuis le flux puis depuis l'éditeur
    v.locator("[data-gal]").click();pg.wait_for_timeout(1500)
    ed=pg.locator(".visedit")
    ok("Photo 1 sur 3" in ed.inner_text(),"galerie : 3 photos importées d'un coup, l'éditeur s'ouvre sur la première")
    pg.screenshot(path=OUT+"visit_gallery_editor.png")
    ed.locator("[data-galm]").click();pg.wait_for_timeout(1500)
    ok("Photo 4 sur 6" in ed.inner_text(),"éditeur : ajout depuis la galerie")
    ed.locator("[data-ok]").click();pg.wait_for_timeout(1500)
    ok(v.locator(".visstage .vph").count()==6,"6 photos de la galerie jointes à la note")
    v.locator(".visin textarea").fill("Photos de la galerie");v.locator("[data-add]").click();pg.wait_for_timeout(500)
    pg.screenshot(path=OUT+"visit_gallery_flow.png")
    # accueil : import rapide de la galerie, puis choix du flux
    v.locator("[data-back]").click();pg.wait_for_timeout(200)
    pg.screenshot(path=OUT+"visit_home_gallery.png")
    v.locator("[data-qgal]").click();pg.wait_for_timeout(1500);pg.locator(".visedit [data-ok]").click();pg.wait_for_timeout(1200)
    pg.locator("dialog.vissheet [data-f]",has_text="Réception").click();pg.wait_for_timeout(300)
    ok("3 photos" in v.locator(".vistile",has_text="Réception").inner_text(),"accueil : photos de la galerie rangées dans le flux choisi")
    # clôture depuis le menu ⋯ de la visite, puis reprise depuis la liste
    SHEET["sheet"]="Clôturer la visite"
    v.locator("[data-vm]").click();pg.wait_for_timeout(600)
    ok(v.is_hidden() and pg.locator("#lists .mtgrow",has_text="Terminée").count()==1,"menu ⋯ : visite clôturée, retour à la liste")
    SHEET["sheet"]="Reprendre la visite"
    pg.locator("#lists .mtgrow").first.click();pg.wait_for_timeout(300);v.locator("[data-vm]").click();pg.wait_for_timeout(400)
    v.locator("[data-back]").click();pg.wait_for_timeout(300)
    ok(pg.locator("#lists .mtgrow",has_text="En cours").locator("[data-fin]").count()==1,"liste : bouton « Clôturer » sur une visite en cours")
    pg.locator("#lists [data-fin]").click();pg.wait_for_timeout(400)
    ok(pg.locator("#lists .mtgrow",has_text="Terminée").count()==1,"liste : visite clôturée sans l'ouvrir")
    pg.locator("#lists .mtgrow").first.click();pg.wait_for_timeout(300)
    pg.reload();pg.wait_for_timeout(800)
    pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Local").click();pg.locator(".phtile",has_text="Visites").click();pg.wait_for_timeout(500)
    pg.locator("#lists .mtgrow").first.click();pg.locator("#visview .vistile",has_text="Stockage").click();pg.wait_for_timeout(600)
    ok(pg.locator("#visview .visnote",has_text="Note locale").locator("img[src^='blob:']").count()==1,"mode local : note et photo conservées après rechargement")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
