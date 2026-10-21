import os,sys,io,base64;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,FAKE,OUT
from playwright.sync_api import sync_playwright
from PIL import Image,ImageDraw
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
# logo fictif : rectangle bleu au milieu de larges marges blanches
im=Image.new("RGB",(600,300),"white");ImageDraw.Draw(im).rectangle([100,100,499,199],fill=(29,78,120))
buf=io.BytesIO();im.save(buf,"PNG");PNG=buf.getvalue()
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":950})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE)
    pg.add_init_script("localStorage.setItem('todo-mode','cloud');if(sessionStorage.getItem('db')){const d=JSON.parse(sessionStorage.getItem('db'));Object.keys(d).forEach(k=>window.__db[k]=d[k])}")
    pg.goto(APP);pg.wait_for_timeout(1000)
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.wait_for_timeout(300)
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="logo du client").click();pg.wait_for_timeout(300)
    d=pg.locator("dialog.logodlg")
    ok(d.count()==1 and d.locator("[data-del]").is_hidden(),"menu ⋯ : fenêtre du logo, sans bouton Retirer quand il n'y a pas de logo")
    d.locator("input[type=file]").set_input_files({"name":"logo.png","mimeType":"image/png","buffer":PNG});pg.wait_for_timeout(600)
    ok(d.locator(".logodrop img").is_visible(),"fichier choisi : aperçu affiché")
    pg.screenshot(path=OUT+"logo_dialog.png")
    d.locator("[data-ok]").click();pg.wait_for_timeout(1500)
    row=[p for p in pg.evaluate("window.__db.projects") if p["id"]=="p1"][0]
    lg=row.get("logo") or ""
    ok(lg.startswith("data:image/") and len(lg)<100000,"logo envoyé au serveur, taille réduite (%d caractères)"%len(lg))
    w,h=pg.evaluate("u=>new Promise(r=>{const i=new Image();i.onload=()=>r([i.naturalWidth,i.naturalHeight]);i.src=u})",lg)
    ok(w==240 and 55<=h<=80,"marges blanches retirées, 240 px de large (%dx%d)"%(w,h))
    ok(pg.locator(".pbtn",has_text="Projet Alpha").locator("img.plogo").count()==1,"logo dans la liste des projets")
    ok(pg.locator(".head h1 img.plogo").count()==1,"logo en tête du projet")
    pg.screenshot(path=OUT+"logo_desktop.png")
    # collage depuis le presse-papiers
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="Changer le logo").click();pg.wait_for_timeout(300)
    pg.evaluate("""async b64=>{const bin=atob(b64),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);
      const dt=new DataTransfer();dt.items.add(new File([a],'c.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true}))}""",base64.b64encode(PNG).decode())
    pg.wait_for_timeout(600)
    ok(d.locator(".logodrop img").is_visible() and d.locator("[data-del]").is_visible(),"image collée (Ctrl+V) : aperçu, bouton Retirer présent")
    d.locator("[data-x]").click()
    # téléphone : icône du projet = logo
    pg.set_viewport_size({"width":390,"height":844});pg.wait_for_timeout(300)
    pg.locator(".bnav [data-b=menu]").click();pg.wait_for_timeout(300)
    ok(pg.locator(".pjt",has_text="Projet Alpha").locator(".pjic.haslogo img").count()==1 and pg.locator(".pjic",has_text="PB").count()==1,"téléphone : logo à la place des initiales")
    pg.screenshot(path=OUT+"logo_phone.png")
    pg.set_viewport_size({"width":1440,"height":950});pg.wait_for_timeout(300)
    # rechargement : le logo revient du serveur
    pg.evaluate("sessionStorage.setItem('db',JSON.stringify(window.__db))");pg.reload();pg.wait_for_timeout(1500)
    ok(pg.locator(".pbtn",has_text="Projet Alpha").locator("img.plogo").count()==1,"rechargement : logo relu depuis le serveur")
    # retrait
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.wait_for_timeout(300)
    pg.locator(".ddmore summary").click();pg.locator(".ddmore .menu button",has_text="Changer le logo").click();pg.wait_for_timeout(300)
    d.locator("[data-del]").click();d.locator("[data-ok]").click();pg.wait_for_timeout(1500)
    row=[p for p in pg.evaluate("window.__db.projects") if p["id"]=="p1"][0]
    ok(not row.get("logo") and pg.locator(".pbtn",has_text="Projet Alpha").locator(".dot").count()==1,"logo retiré : retour à la pastille de couleur")
    b.close()
print("ERREURS : "+("aucune" if not errs else str(len(errs))));[print(" -",e) for e in errs]
sys.exit(1 if errs else 0)
