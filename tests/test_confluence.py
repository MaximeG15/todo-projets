import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog
import json
from playwright.sync_api import sync_playwright
# Confluence en direct : connexion par jeton, lien d'une page à une mise en service, envoi automatique, témoin
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
R={}
def handler(d):
    r=R.get(d.type)
    if isinstance(r,list): r=r.pop(0) if r else None
    d.accept(r)
# faux relais « confluence » : enregistre les appels, répond comme la fonction serveur
FN="""window.__calls=[];window.__fnFail=null;
window.__fn=async(name,body)=>{window.__calls.push({name,body:JSON.parse(JSON.stringify(body||{}))});
  const err=(code,message)=>({data:null,error:{message,context:{json:async()=>({code,message})}}});
  if(name!=='confluence')return err('x','x');
  if(window.__fnFail){const f=window.__fnFail;window.__fnFail=null;return err(f[0],f[1])}
  if(body.action==='save'){window.__db.user_confluence=[{user_id:'u1',site:body.site,email:body.email,token_enc:'v1.x.y',expires_on:body.expiresOn,updated_at:1}];return {data:{ok:true,site:body.site,mode:'site'},error:null}}
  if(body.action==='link')return {data:{ok:true,pageId:'4242',title:'MES Projet Alpha – Comptes rendus',url:'https://easywmsfrance.atlassian.net/wiki/spaces/PROJ/pages/4242',site:'easywmsfrance.atlassian.net',by:'u1',sig:'sig-test'},error:null};
  if(body.action==='push')return {data:{ok:true,pushed:body.days.map(d=>d.key)},error:null};
  return err('bad_action','?')};"""
pushes=lambda pg:[c["body"] for c in pg.evaluate("window.__calls") if c["body"].get("action")=="push"]
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,handler)
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script(FN);pg.add_init_script("localStorage.setItem('todo-mode','cloud');window.__confDelay=400")
    pg.goto(APP);pg.wait_for_timeout(1200)
    # --- mise en service démarrée, pas encore de connexion : le lien demande de connecter Confluence
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator('#ptabs [data-tab="visits"]').click();pg.wait_for_timeout(300)
    R["visnew"]={"type":"mes"}
    pg.locator("#lists .btn",has_text="Démarrer un déplacement").first.click();pg.wait_for_timeout(600)
    v=pg.locator("#visview")
    ok(v.locator(".mesrow").count()==6 and v.locator(".confchip").count()==0,"mise en service démarrée, aucune page liée")
    R["sheet"]=["Lier une page Confluence"]
    v.locator("[data-vm]").click();pg.wait_for_timeout(600)
    ok(pg.locator("dialog.conflink").count()==0 and pg.locator("dialog.confdlg").count()==1,"sans connexion : la liaison propose d'abord de connecter Confluence")
    ok(pg.locator('#acc [data-a="conf"]').count()==1,"bouton « Connecter Confluence » dans le compte")
    # --- connexion (fenêtre Connecter Confluence)
    pg.evaluate("window.__testDialog=null")
    d=pg.locator("dialog.confdlg")
    ok(d.is_visible() and d.locator('[data-k="site"]').input_value()=="easywmsfrance.atlassian.net" and "Comment créer le jeton" in d.inner_text(),"fenêtre de connexion : site par défaut et pas-à-pas")
    d.locator("[data-ok]").click();pg.wait_for_timeout(300)
    ok("jeton" in d.locator("[data-err]").inner_text().lower(),"jeton obligatoire à la première connexion")
    d.locator('[data-k="token"]').fill("ATATT3xFfGF0-jeton-de-test-0123456789")
    d.locator("[data-ok]").click();pg.wait_for_timeout(600)
    sv=[c["body"] for c in pg.evaluate("window.__calls") if c["body"].get("action")=="save"]
    ok(pg.locator("dialog.confdlg").count()==0 and len(sv)==1 and sv[0]["site"]=="easywmsfrance.atlassian.net" and len(sv[0]["expiresOn"])==10,"connexion enregistrée (jeton envoyé au relais, date d'expiration)")
    ok(pg.evaluate("window.__db.user_confluence.length")==1,"connexion visible dans le compte")
    on_dialog_back=pg.evaluate("1")
    # --- lier la page (vraie fenêtre)
    v.locator("[data-vm]").click();pg.wait_for_timeout(300)
    pg.locator("dialog.uidlg button",has_text="Lier une page Confluence").first.click();pg.wait_for_timeout(500)
    lk=pg.locator("dialog.conflink")
    ok(lk.is_visible(),"fenêtre « Lier une page Confluence »")
    lk.locator('[data-k="url"]').fill("https://easywmsfrance.atlassian.net/wiki/spaces/PROJ/pages/4242/MES");lk.locator("[data-ok]").click();pg.wait_for_timeout(1500)
    chip=v.locator(".confchip")
    ok(pg.locator("dialog.conflink").count()==0 and chip.count()==1,"page liée : témoin dans l'en-tête")
    ps=pushes(pg)
    ok(len(ps)>=1 and ps[-1]["pageId"]=="4242" and ps[-1]["sig"]=="sig-test" and len(ps[-1]["days"])==1 and ps[-1]["days"][0]["title"].startswith("J1 · ") and "Projet Alpha" in ps[-1]["days"][0]["title"] and len(ps[-1]["days"][0]["rows"])==6,"premier envoi : journée 1 avec ses 6 rubriques")
    ok("à jour" in chip.inner_text() and "ok" in chip.get_attribute("class"),"témoin : à jour")
    # --- modification : envoi automatique après le délai, seulement la journée modifiée
    n0=len(pushes(pg))
    pg.evaluate("""()=>{window.__testDialog=async o=>o.type==='mesitem'?{ok:true,v:{t:'Réception fournisseurs',d:'OK en réel',who:'Max',st:'Fait'}}:null}""")
    v.locator(".mesrow",has=pg.locator("h3",has_text="Problèmes majeurs")).locator("[data-addit]").click();pg.wait_for_timeout(1500)
    ps=pushes(pg)
    okrow=[r for r in ps[-1]["days"][0]["rows"] if r["title"].startswith("Process OK")][0] if len(ps)>n0 else {"items":[]}
    ok(len(ps)==n0+1 and okrow["items"] and okrow["items"][0]["t"]=="Réception fournisseurs" and okrow["items"][0]["st"]=="Fait" and "mis à jour le" in ps[-1]["days"][0]["stamp"],"élément ajouté : envoi automatique (rangé dans Process OK, horodaté)")
    pg.wait_for_timeout(1200)
    ok(len(pushes(pg))==n0+1,"pas de renvoi sans nouvelle modification")
    # --- erreur de jeton : témoin en erreur, puis clôture qui renvoie
    pg.evaluate("window.__fnFail=['auth','Jeton refusé ou expiré : renouvelez-le dans « Connecter Confluence ».']")
    pg.evaluate("window.__testDialog=null")
    ed=v.locator(".mesrow",has=pg.locator("h3",has_text="Statut de l'installation")).locator(".rte");ed.click();ed.fill("Réception en production.");v.locator(".mesbar b").click();pg.wait_for_timeout(2200)
    ok("err" in chip.get_attribute("class") and "jeton" in chip.inner_text(),"jeton refusé : témoin en erreur")
    chip.click();pg.wait_for_timeout(300)
    inf=pg.locator("dialog.confinfo")
    ok(inf.is_visible() and "MES Projet Alpha" in inf.inner_text() and inf.locator("[data-cfg]").count()==1,"détail : page liée, état, bouton Renouveler le jeton")
    pg.screenshot(path=OUT+"confluence_info.png")
    inf.locator("[data-now]").click();pg.wait_for_timeout(800)
    ps=pushes(pg)
    st=[r for r in ps[-1]["days"][0]["rows"] if r["title"].startswith("Statut")][0]
    ok("ok" in chip.get_attribute("class") and "Réception en production" in st["text"],"« Envoyer maintenant » : statut envoyé, témoin à jour")
    n1=len(ps)
    v.locator("[data-close]").click();pg.wait_for_timeout(700)
    ps=pushes(pg)
    ok(len(ps)>n1 and ps[-1]["days"][0]["closed"] is True and "journée clôturée" in ps[-1]["days"][0]["stamp"],"clôture de la journée : envoi immédiat")
    pg.screenshot(path=OUT+"confluence_mes.png")
    # --- délier
    chip.click();pg.wait_for_timeout(300)
    pg.locator("dialog.confinfo [data-unlink]").click();pg.wait_for_timeout(300)
    pg.locator("dialog.uidlg button",has_text="Délier").last.click();pg.wait_for_timeout(500)
    ok(v.locator(".confchip").count()==0,"page déliée : plus de témoin")
    pg.close()
    # --- préparation d'une mise en service : lier la page avant le démarrage
    p2=b.new_page(viewport={"width":1440,"height":900});p2.on("pageerror",lambda e:errs.append("JSp: "+str(e)))
    p2.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    p2.add_init_script(path=FAKE);p2.add_init_script(FN);p2.add_init_script("localStorage.setItem('todo-mode','cloud');window.__confDelay=300;window.__db.user_confluence=[{user_id:'u1',site:'easywmsfrance.atlassian.net',email:'alice@exemple.test',token_enc:'x',expires_on:'2027-10-01'}]")
    on_dialog(p2,handler)
    p2.goto(APP);p2.wait_for_timeout(1200)
    p2.locator(".pbtn",has_text="Projet Alpha").click();p2.locator('#ptabs [data-tab="visits"]').click();p2.wait_for_timeout(300)
    R["visnew"]={"type":"mes"}
    p2.locator("#lists [data-prep]").click();p2.wait_for_timeout(600)
    pv=p2.locator("#visview")
    ok(pv.locator(".vpcconf [data-conflink]").is_visible(),"préparation de mise en service : bouton « Lier une page Confluence »")
    p2.evaluate("window.__testDialog=null")
    pv.locator(".vpcconf [data-conflink]").click();p2.wait_for_timeout(300)
    p2.locator("dialog.conflink [data-k=url]").fill("https://easywmsfrance.atlassian.net/wiki/spaces/PROJ/pages/4242");p2.locator("dialog.conflink [data-ok]").click();p2.wait_for_timeout(1200)
    ok("MES Projet Alpha" in pv.locator(".vpcconf").inner_text() and pv.locator(".vpcconf [data-confunlink]").count()==1,"page liée dès la préparation (titre affiché, Délier)")
    n=len(pushes(p2))
    pv.locator("[data-start]").first.click();p2.wait_for_timeout(1500)
    ok(len(pushes(p2))>n and pv.locator(".confchip").count()==1,"démarrage : premier envoi automatique, témoin dans l'en-tête")
    p2.screenshot(path=OUT+"confluence_prep.png")
    p2.close()
    # --- visite d'analyse fonctionnelle : lien dès la préparation, un bloc par journée découpé par flux
    p3=b.new_page(viewport={"width":1440,"height":900});p3.on("pageerror",lambda e:errs.append("JSa: "+str(e)))
    p3.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    p3.add_init_script(path=FAKE);p3.add_init_script(FN);p3.add_init_script("localStorage.setItem('todo-mode','cloud');window.__confDelay=300;window.__db.user_confluence=[{user_id:'u1',site:'easywmsfrance.atlassian.net',email:'alice@exemple.test',token_enc:'x',expires_on:'2027-10-01'}]")
    on_dialog(p3,handler)
    p3.goto(APP);p3.wait_for_timeout(1200)
    p3.locator(".pbtn",has_text="Projet Alpha").click();p3.locator('#ptabs [data-tab="visits"]').click();p3.wait_for_timeout(300)
    R["visnew"]={"type":"af"}
    p3.locator("#lists [data-prep]").click();p3.wait_for_timeout(600)
    av=p3.locator("#visview")
    ok(av.locator(".vpc3 .confprep [data-conflink]").is_visible(),"préparation de visite d'AF : encadré Confluence en haut de la colonne de droite")
    p3.evaluate("window.__testDialog=null")
    av.locator(".vpc3 [data-conflink]").click();p3.wait_for_timeout(300)
    p3.locator("dialog.conflink [data-k=url]").fill("https://easywmsfrance.atlassian.net/wiki/spaces/PROJ/pages/4242");p3.locator("dialog.conflink [data-ok]").click();p3.wait_for_timeout(1000)
    av.locator("[data-start]").first.click();p3.wait_for_timeout(800)
    ok(av.locator(".confchip").count()==1,"visite démarrée : témoin Confluence dans l'en-tête")
    av.locator(".visdl .vistile",has_text="Réception").click();p3.wait_for_timeout(300)
    av.locator('button[data-t="question"]').click();av.locator(".visin .rte").fill("Quelles informations remonter à Sage à la clôture d'une réception ?");av.locator("[data-add]").click();p3.wait_for_timeout(300)
    av.locator('button[data-t="note"]').click();av.locator(".visin .rte").fill("Réception aveugle sur les retours.");av.locator("[data-add]").click();p3.wait_for_timeout(1500)
    ps=pushes(p3)
    d0=ps[-1]["days"][0] if ps and ps[-1]["days"] else {"parts":[]}
    parts=d0.get("parts",[])
    flux=[x.get("flux") for x in parts if x.get("flux")]
    notes=[n for x in parts if x.get("notes") for n in x["notes"]]
    heads=[x.get("h") for x in parts if x.get("h")]
    ok(len(ps)>=1 and d0.get("title","").startswith("Visite d'analyse fonctionnelle – J1") and flux==["Réception"],"envoi : bloc de la journée, découpé par flux")
    ok("Informations" in heads and "Synthèse du jour" in heads and "Questions client du jour" in heads,"bloc : informations, synthèse, questions client du jour")
    ok(any(n["tag"]=="Question client" and "fin de visite" in n["after"] for n in notes) and any(n["tag"]=="Note" for n in notes),"notes avec leur type et leur suite")
    p3.screenshot(path=OUT+"confluence_af.png")
    p3.close()
    # --- téléphone : témoin sous l'en-tête
    m=b.new_page(viewport={"width":390,"height":844});m.on("pageerror",lambda e:errs.append("JSm: "+str(e)))
    m.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    m.add_init_script(path=FAKE);m.add_init_script(FN);m.add_init_script("localStorage.setItem('todo-mode','cloud');window.__confDelay=300;window.__db.user_confluence=[{user_id:'u1',site:'easywmsfrance.atlassian.net',email:'alice@exemple.test',token_enc:'x',expires_on:'2026-11-01'}]")
    on_dialog(m,handler)
    m.goto(APP);m.wait_for_timeout(1200)
    R["visnew"]={"type":"mes"}
    m.locator(".pjt",has_text="Projet Alpha").click();m.locator(".phtile",has_text="Déplacements").click();m.wait_for_timeout(300)
    m.locator("#lists .btn",has_text="Démarrer un déplacement").first.click();m.wait_for_timeout(600)
    m.evaluate("window.__testDialog=null")
    mv=m.locator("#visview");mv.locator("[data-vm]").click();m.wait_for_timeout(300)
    m.locator("dialog.uidlg button",has_text="Lier une page Confluence").first.click();m.wait_for_timeout(400)
    m.locator("dialog.conflink [data-k=url]").fill("https://easywmsfrance.atlassian.net/wiki/spaces/PROJ/pages/4242");m.locator("dialog.conflink [data-ok]").click();m.wait_for_timeout(1500)
    ok(mv.locator(".confrow .confchip").is_visible() and "à jour" in mv.locator(".confchip").inner_text(),"téléphone : témoin sous l'en-tête")
    m.screenshot(path=OUT+"confluence_phone.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
