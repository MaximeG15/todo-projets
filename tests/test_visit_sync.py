import os,sys,time,datetime;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
PHOTO="""window.__testPhoto=()=>new Promise(r=>{const c=document.createElement('canvas');c.width=800;c.height=600;const g=c.getContext('2d');g.fillStyle='#6E7E88';g.fillRect(0,0,800,600);c.toBlob(b=>r(new File([b],'p.jpg',{type:'image/jpeg'})),'image/jpeg',0.9)});"""
SCAN="""(()=>{let n=0;window.BarcodeDetector=class{static async getSupportedFormats(){return ['code_128','data_matrix']}constructor(){}async detect(){n++;return n>2?[{format:'data_matrix',rawValue:'A-01-02-03'}]:[]}};
 window.__persist=0;try{Object.defineProperty(navigator,'storage',{value:{persisted:async()=>false,persist:async()=>{window.__persist++;return true}},configurable:true})}catch(e){}})();"""
with sync_playwright() as pw:
    b=pw.chromium.launch(args=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"])
    ctx=b.new_context(viewport={"width":390,"height":844});ctx.grant_permissions(["camera"])
    pg=ctx.new_page()
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    RESP={}
    def dlg(d):
        for k,val in RESP.items():
            if k in d.message:d.accept(val);return
        d.accept()
    on_dialog(pg,dlg)
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script(PHOTO);pg.add_init_script(SCAN)
    pg.add_init_script("if(!sessionStorage.getItem('db'))localStorage.setItem('todo-mode','cloud');else{const d=JSON.parse(sessionStorage.getItem('db'));Object.keys(d).forEach(k=>window.__db[k]=d[k]);window.__storage={}}")
    pg.goto(APP);pg.wait_for_timeout(1200)
    def open_visits():
        pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Alpha").click();pg.locator(".phtile",has_text="Visites").click();pg.wait_for_timeout(300)
    open_visits()
    pg.locator("#lists [data-new]").click();pg.wait_for_timeout(400)
    ok(pg.evaluate("window.__persist")>=1,"C : stockage persistant demandé au navigateur")
    v=pg.locator("#visview");v.locator(".vistile",has_text="Réception").click()
    add=lambda t:(v.locator(".visin textarea").fill(t),v.locator("[data-add]").click(),pg.wait_for_timeout(250))
    add("Note A");pg.wait_for_timeout(2500)
    db_notes=lambda:[n["text"] for n in pg.evaluate("window.__db.visits[0].notes")]
    ok(db_notes()==["Note A"],"visite envoyée")
    # --- B : modification sur un « autre appareil » pendant qu'on travaille hors connexion
    ctx.set_offline(True)
    add("Note B")
    RESP["Note de"]="Supprimer la note"
    v.locator(".visnote",has_text="Note A").locator("[data-more]").click();pg.wait_for_timeout(300)
    del RESP["Note de"]
    ok(v.locator(".visnote",has_text="Note A").count()==0,"suppression locale de la note A")
    pg.wait_for_timeout(400)
    pg.evaluate("""()=>{const r=window.__db.visits[0],f=r.notes[0].flow,now=Date.now();r.notes.push({id:'nc',flow:f,type:'note',text:'Note C (autre appareil)',photos:[],at:now,u:now,conv:null});r.prep={...(r.prep||{}),location:'Quai nord'};r.sync={...(r.sync||{}),pu:now};r.updated_at=now+5}""")
    ctx.set_offline(False);pg.wait_for_timeout(3000)
    ok(sorted(db_notes())==["Note B","Note C (autre appareil)"],"B : fusion — les notes des deux appareils sont gardées, la suppression est respectée "+str(db_notes()))
    ok(v.locator(".visnote").count()==2 and v.locator(".visnote",has_text="Note C").count()==1,"B : l'écran affiche la version fusionnée")
    ok(pg.evaluate("window.__db.visits[0].prep.location")=="Quai nord","B : préparation modifiée ailleurs conservée")
    # --- A : rafraîchissement à l'ouverture d'une visite
    pg.evaluate("""()=>{const r=window.__db.visits[0],f=r.notes[0].flow,now=Date.now();r.notes.push({id:'nd',flow:f,type:'note',text:'Note D',photos:[],at:now,u:now});r.updated_at=now+10}""")
    v.locator("[data-back]").click();v.locator("[data-back]").click();pg.wait_for_timeout(200)
    pg.locator("#lists .mtgrow").first.click();pg.wait_for_timeout(800)
    v.locator(".vistile",has_text="Réception").click();pg.wait_for_timeout(300)
    ok(v.locator(".visnote",has_text="Note D").count()==1,"A : ouverture de la visite — version du serveur récupérée")
    # --- scan de code-barres
    v.locator("[data-scan]").click();pg.wait_for_timeout(1800)
    sc=pg.locator(".visscan")
    ok("Datamatrix" in sc.inner_text() and "A-01-02-03" in sc.inner_text(),"scan : format et contenu détectés")
    pg.screenshot(path=OUT+"visit_scan.png")
    sc.locator("[data-use]").click();pg.wait_for_timeout(500)
    ok("Code-barres Datamatrix : A-01-02-03" in v.locator(".visin textarea").input_value() and v.locator(".visstage .vph").count()==1,"scan : texte et photo de l'étiquette ajoutés à la note")
    v.locator("[data-add]").click();pg.wait_for_timeout(2500)
    ok(any("A-01-02-03" in t for t in db_notes()),"scan : note enregistrée")
    # --- D : nettoyage du cache photos (visite terminée, photo envoyée depuis plus de 7 jours)
    v.locator("[data-back]").click();v.locator("[data-end]").click();v.locator("[data-done]").click();pg.wait_for_timeout(2500)
    pg.evaluate("""async()=>{const d=await new Promise(r=>{const q=indexedDB.open('todo-projets-visites');q.onsuccess=()=>r(q.result)});const all=await new Promise(r=>{const q=d.transaction('photos').objectStore('photos').getAll();q.onsuccess=()=>r(q.result)});
      await new Promise(r=>{const t=d.transaction('photos','readwrite');all.forEach(p=>{p.at=0;t.objectStore('photos').put(p)});t.oncomplete=r})}""")
    n_before=pg.evaluate("Object.keys(window.__storage).length")
    pg.evaluate("sessionStorage.setItem('db',JSON.stringify(window.__db))")
    pg.reload();pg.wait_for_timeout(5000)
    n_idb=pg.evaluate("""async()=>{const d=await new Promise(r=>{const q=indexedDB.open('todo-projets-visites');q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=d.transaction('photos').objectStore('photos').count();q.onsuccess=()=>r(q.result)})}""")
    ok(n_before==1 and n_idb==0,"D : photo d'une visite terminée retirée du téléphone (reste en ligne)")
    b.close()
    # --- F : agenda ; E : photos supprimées avec le projet
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1280,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS2: "+str(e)));on_dialog(pg,lambda d:d.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script(PHOTO);pg.add_init_script("localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(1200)
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator('#ptabs [data-tab="visits"]').click();pg.locator("#lists [data-prep]").click();pg.wait_for_timeout(400)
    v=pg.locator("#visview")
    when=(datetime.date.today()).isoformat()+"T14:00"
    v.locator('[data-k="plannedAt"]').fill(when);v.locator('[data-k="plannedAt"]').dispatch_event("change");v.locator("[data-x]").click();pg.wait_for_timeout(300)
    pg.locator(".vbtn",has_text="Agenda de la semaine").click();pg.wait_for_timeout(500)
    ag=pg.locator(".day.today .visag")
    ok(ag.count()==1 and "Préparée" in ag.inner_text() and "14:00" in ag.inner_text(),"F : visite préparée affichée dans l'agenda à sa date")
    ag.click();pg.wait_for_timeout(300)
    ok(pg.locator("#visview [data-start]").is_visible(),"F : clic dans l'agenda — ouverture de la visite")
    pg.locator("#visview [data-start]").click();pg.locator("#visview .vistile",has_text="Stockage").click()
    pg.locator("#visview [data-cam]").click();pg.wait_for_timeout(800);pg.locator(".visedit [data-ok]").click();pg.wait_for_timeout(400)
    pg.locator("#visview [data-add]").click();pg.wait_for_timeout(2500)
    ok(len(pg.evaluate("Object.keys(window.__storage||{})"))==1,"photo envoyée")
    pg.locator("#visview [data-back]").click();pg.locator("#visview [data-back]").click();pg.wait_for_timeout(200)
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.wait_for_timeout(200)
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="Supprimer le projet").click();pg.wait_for_timeout(1500)
    ok(not pg.evaluate("Object.keys(window.__storage||{})"),"E : photos de visite supprimées avec le projet")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
