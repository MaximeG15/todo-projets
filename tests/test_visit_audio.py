import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog
from playwright.sync_api import sync_playwright
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
PHOTO="""window.__testPhoto=()=>new Promise(r=>{const c=document.createElement('canvas');c.width=800;c.height=600;const g=c.getContext('2d');g.fillStyle='#6E7E88';g.fillRect(0,0,800,600);c.toBlob(b=>r(new File([b],'p.jpg',{type:'image/jpeg'})),'image/jpeg',0.9)});"""
with sync_playwright() as pw:
    b=pw.chromium.launch(args=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx=b.new_context(viewport={"width":390,"height":844});ctx.grant_permissions(["microphone","camera"])
    pg=ctx.new_page()
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    RESP={}
    def dlg(d):
        for k,val in RESP.items():
            if k in d.message:d.accept(val);return
        d.accept()
    on_dialog(pg,dlg)
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script(PHOTO)
    pg.add_init_script("localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(1200)
    pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Alpha").click();pg.locator(".phtile",has_text="Visites").click();pg.wait_for_timeout(300)
    pg.locator("#lists [data-new]").click();pg.wait_for_timeout(500)
    v=pg.locator("#visview")
    v.locator(".vistile",has_text="Réception").click();pg.wait_for_timeout(300)
    # --- enregistrement (téléphone)
    v.locator("[data-rec]").click();pg.wait_for_timeout(300)
    d=pg.locator("dialog.recdlg")
    ok(d.is_visible() and "Prévenez les personnes présentes" in d.inner_text(),"premier enregistrement : rappel de prévenir les personnes présentes")
    pg.screenshot(path=OUT+"audio_consent.png")
    d.locator("[data-ok]").click();pg.wait_for_timeout(1500)
    ok(v.locator(".visrec").is_visible() and v.locator(".recpill").count()==1 and v.locator(".viscap").is_hidden(),"enregistrement en cours : barre d'enregistrement et repère REC")
    v.locator("[data-recph]").click();pg.wait_for_timeout(1000);pg.locator(".visedit [data-ok]").click();pg.wait_for_timeout(800)
    ok("1 photo prise pendant" in v.locator(".visrec").inner_text(),"photo prise pendant l'enregistrement")
    v.locator("[data-recpause]").click();pg.wait_for_timeout(300)
    ok("En pause" in v.locator(".visrec").text_content() and v.locator("[data-recpause]").inner_text()=="Reprendre","pause")
    v.locator("[data-recpause]").click();pg.wait_for_timeout(1200)
    pg.screenshot(path=OUT+"audio_recording.png")
    v.locator("[data-recstop]").click();pg.wait_for_timeout(1500)
    note=v.locator(".visnote",has=pg.locator(".nt-au"))
    ok(note.count()==1 and note.locator("audio").count()==1 and note.locator(".vph").count()==1,"arrêt : note « Enregistrement » avec lecteur et la photo")
    ok("À transcrire sur l'ordinateur" in note.inner_text(),"téléphone : « À transcrire sur l'ordinateur »")
    pg.screenshot(path=OUT+"audio_note_phone.png")
    pg.wait_for_timeout(2500)
    keys=pg.evaluate("Object.keys(window.__storage||{})")
    au=[k for k in keys if k.startswith("visit-audio/p1/")]
    ok(len(au)==1 and au[0].endswith(".webm"),"enregistrement envoyé dans le stockage privé « visit-audio » : %s"%au)
    row=pg.evaluate("window.__db.visits[0]")
    a=[n for n in row["notes"] if n.get("audio")]
    ok(len(a)==1 and a[0]["audio"]["dur"]>=2 and a[0]["audio"]["size"]>0,"visite en ligne : durée %ss"%(a[0]["audio"]["dur"] if a else "?"))
    # deuxième enregistrement : plus de rappel
    v.locator("[data-rec]").click();pg.wait_for_timeout(1500)
    ok(pg.locator("dialog.recdlg").count()==0 and v.locator(".visrec").is_visible(),"deuxième enregistrement : pas de nouveau rappel")
    v.locator("[data-recstop]").click();pg.wait_for_timeout(1200)
    # --- ordinateur : transcription
    pg.set_viewport_size({"width":1440,"height":950});pg.wait_for_timeout(400)
    pg.evaluate("()=>{window.__trCalls=[];window.__testTranscribe=async(audio,model)=>{window.__trCalls.push([audio.length,model]);return 'Le responsable explique le contrôle des palettes à réception. Quelle hauteur maximale pour les palettes ?'}}")
    v.locator("[data-back]").click();pg.wait_for_timeout(200);v.locator(".vistile",has_text="Réception").click();pg.wait_for_timeout(400)
    ok("2 enregistrements à transcrire" in v.locator(".trban").inner_text() and v.locator("[data-tr]").count()==2,"ordinateur : bandeau « 2 enregistrements à transcrire » et boutons Transcrire")
    pg.screenshot(path=OUT+"audio_pc_before.png")
    v.locator("[data-trall]").click();pg.wait_for_timeout(2500)
    calls=pg.evaluate("window.__trCalls")
    ok(len(calls)==2 and calls[0][0]>16000*2 and calls[0][1]=="standard","son décodé en 16 kHz et transcrit (%s)"%calls)
    ok(v.locator(".vistr").count()==2 and "contrôle des palettes" in v.locator(".vistr").first.inner_text() and v.locator(".trban").count()==0,"texte transcrit affiché « à relire », bandeau retiré")
    pg.screenshot(path=OUT+"audio_pc_after.png")
    pg.wait_for_timeout(2000)
    row=pg.evaluate("window.__db.visits[0]")
    ok(sum(1 for n in row["notes"] if n.get("tr"))==2,"transcriptions enregistrées en ligne (visibles sur le téléphone)")
    # correction et question client
    RESP["Corriger la transcription"]="Texte corrigé à la main."
    v.locator("[data-tredit]").first.click();pg.wait_for_timeout(400)
    ok("Texte corrigé à la main." in v.locator(".vistr").first.inner_text(),"corriger le texte")
    RESP["Question client"]="Quelle hauteur maximale pour les palettes ?"
    v.locator("[data-trq]").nth(1).click();pg.wait_for_timeout(400)
    ok(v.locator(".visnote .nt-q",).count()==1 and "Quelle hauteur maximale" in v.locator(".visnote",has=pg.locator(".nt-q")).inner_text(),"question client créée à partir d'un passage")
    # export PDF
    pg.evaluate("()=>{const d=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{set(v){window.__lastPrint=v;d.set.call(this,v)},get(){return d.get.call(this)}})}")
    v.locator("[data-back]").click();RESP.clear();
    pg.evaluate("window.__testDialog=null")
    pg.locator("#visview [data-vm]").click();pg.wait_for_timeout(300)
    pg.locator("dialog.vissheet button",has_text="Exporter le compte rendu").click();pg.wait_for_timeout(1500)
    pr=pg.evaluate("window.__lastPrint||''")
    ok("Enregistrement de" in pr and "transcription automatique" in pr and "Texte corrigé à la main." in pr,"compte rendu PDF : enregistrements et transcriptions")
    # première transcription sans modèle : fenêtre de téléchargement
    v.locator(".vistile",has_text="Réception").click();pg.wait_for_timeout(300)
    pg.evaluate("window.__testTranscribe=null")
    v.locator("[data-rec]").click();pg.wait_for_timeout(1500);v.locator("[data-recstop]").click();pg.wait_for_timeout(1200)
    v.locator("[data-tr]").first.click();pg.wait_for_timeout(300)
    md=pg.locator("dialog.trdlg")
    ok(md.is_visible() and md.locator("input[name=trq]").count()==2 and "jamais envoyés sur Internet" in md.inner_text(),"première transcription : choix de la qualité et téléchargement du modèle")
    pg.screenshot(path=OUT+"audio_model.png")
    md.locator("[data-x]").click();pg.wait_for_timeout(200)
    ok(v.locator(".trprog").count()==0,"« Plus tard » : rien n'est lancé")
    # suppression d'une note audio : fichier retiré du stockage
    n0=len([k for k in pg.evaluate("Object.keys(window.__storage||{})") if k.startswith("visit-audio/")])
    pg.evaluate("window.__testDialog=null")
    v.locator(".visnote",has=pg.locator(".nt-au")).last.locator("[data-more]").click();pg.wait_for_timeout(300)
    pg.locator("dialog.vissheet button",has_text="Supprimer la note").click();pg.wait_for_timeout(300)
    pg.locator("dialog.uidlg button",has_text="Supprimer").last.click()
    pg.wait_for_timeout(2500)
    n1=len([k for k in pg.evaluate("Object.keys(window.__storage||{})") if k.startswith("visit-audio/")])
    ok(n1==n0-1,"note supprimée : enregistrement retiré du stockage (%d puis %d)"%(n0,n1))
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
