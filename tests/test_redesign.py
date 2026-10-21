import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,on_dialog
import json,datetime
from playwright.sync_api import sync_playwright
S=OUT
D=datetime.date.today()
iso=lambda d:d.isoformat()
T=[{"id":"t1","projectId":"d","title":"Tâche en retard","due":iso(D-datetime.timedelta(days=3)),"priority":"normale","status":"todo","who":"Alice Martin","createdAt":1},
   {"id":"t2","projectId":"d","title":"Tâche du jour","due":iso(D),"priority":"haute","status":"todo","createdAt":2},
   {"id":"t3","projectId":"d","title":"Tâche à glisser","due":iso(D),"priority":"normale","status":"todo","createdAt":3},
   {"id":"t4","projectId":"d","title":"Tâche à reporter","due":iso(D),"priority":"normale","status":"todo","createdAt":4}]
P=[{"id":"o1","projectId":"d","text":"Format des étiquettes","answer":"","hypothesis":"","erp":"","theme":"Réception","owner":"","ownerName":"","status":"open","createdAt":1}]
data={"projects":[{"id":"d","name":"Projet Alpha","color":"#E0703A"},{"id":"l","name":"Projet Bêta","color":"#2F7D5B"}],"tasks":T,"requests":[],"points":P,"deleted":[]}
INIT="if(!sessionStorage.getItem('s')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');sessionStorage.setItem('s','1')}"%json.dumps(json.dumps(data))
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
def task(pg,i):return pg.evaluate("id=>JSON.parse(localStorage.getItem('todo-projets')).tasks.find(t=>t.id===id)||null",i)
def tasks(pg):return pg.evaluate("()=>JSON.parse(localStorage.getItem('todo-projets')).tasks")
with sync_playwright() as pw:
    b=pw.chromium.launch()
    # ---------- Ordinateur ----------
    pg=b.new_page(viewport={"width":1366,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.add_init_script(INIT)
    pg.goto(APP);pg.wait_for_timeout(400)
    # Analyse de la saisie rapide
    r=pg.evaluate("window.__qParse('Relancer le client demain @alice !haute #beta')")
    ok(r["title"]=="Relancer le client" and r["due"]==iso(D+datetime.timedelta(days=1)) and r["prio"]=="haute" and r["who"]=="Alice Martin" and r["pid"]=="l","saisie rapide : date, personne, priorité, projet reconnus (%s)"%r)
    r=pg.evaluate("window.__qParse('Commander le lot #3 dans 2 semaines')")
    ok(r["title"]=="Commander le lot #3" and r["due"]==iso(D+datetime.timedelta(days=14)) and "pid" not in r,"saisie rapide : « #3 » inconnu laissé dans le titre, « dans 2 semaines »")
    r=pg.evaluate("window.__qParse('Vérifier le plan')")
    ok(r=={"title":"Vérifier le plan"},"saisie rapide : texte simple inchangé")
    # Ajout avec aperçu
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.wait_for_timeout(300)
    pg.locator("[data-tab=tasks]").click();pg.wait_for_timeout(200)
    ok(not pg.locator("#qd").is_visible(),"formulaire d'ajout replié tant qu'on n'écrit pas")
    pg.locator("#qt").click();pg.keyboard.type("Envoyer le planning demain !haute");pg.wait_for_timeout(200)
    ok(pg.locator("#qparse").is_visible() and "Échéance" in pg.locator("#qparse").text_content() and "haute" in pg.locator("#qparse").text_content(),"aperçu « Compris : » affiché")
    ok(pg.locator("#qd").is_visible(),"champs détaillés visibles pendant la saisie")
    pg.screenshot(path=S+"v2_quick.png")
    pg.keyboard.press("Enter");pg.wait_for_timeout(300)
    n=[t for t in tasks(pg) if t["title"]=="Envoyer le planning"]
    ok(len(n)==1 and n[0]["due"]==iso(D+datetime.timedelta(days=1)) and n[0]["priority"]=="haute" and n[0]["projectId"]=="d","tâche créée avec échéance et priorité comprises")
    ok(pg.locator("#qt").input_value()=="" and not pg.locator("#qparse").is_visible(),"saisie vidée après ajout")
    # Un champ rempli à la main l'emporte
    pg.locator("#qt").click();pg.keyboard.type("Appeler le transporteur demain")
    pg.fill("#qd",iso(D+datetime.timedelta(days=5)));pg.locator("#qt").press("Enter");pg.wait_for_timeout(300)
    n=[t for t in tasks(pg) if t["title"]=="Appeler le transporteur"]
    ok(len(n)==1 and n[0]["due"]==iso(D+datetime.timedelta(days=5)),"date saisie à la main prioritaire")
    # Vue d'ensemble
    pg.locator("[data-tab=overview]").click();pg.wait_for_timeout(300)
    ok(pg.locator(".ovcard").count()==4,"vue d'ensemble : 4 cartes")
    ok(pg.locator(".ovrow",has_text="Tâche en retard").count()==1,"vue d'ensemble : tâche en retard à traiter")
    ok(not pg.locator("#quick").is_visible(),"vue d'ensemble : pas de formulaire d'ajout")
    pg.screenshot(path=S+"v2_overview.png")
    pg.locator(".ovrow",has_text="Tâche en retard").first.click();pg.wait_for_timeout(300)
    ok(pg.locator(".task.open .edit, .edit.drawer").count()>=1 or "Tâche en retard" in pg.locator("#lists").inner_text(),"vue d'ensemble : la ligne ouvre la tâche")
    # Palette : créer une tâche
    pg.keyboard.press("Escape");pg.locator("[data-tab=tasks]").click();pg.wait_for_timeout(200)
    pg.keyboard.press("Control+k");pg.wait_for_timeout(200)
    pg.keyboard.type("Préparer la visite vendredi");pg.wait_for_timeout(200)
    it=pg.locator("dialog.cmdk .cmdi",has_text="Créer la tâche")
    ok(it.count()==1,"palette : action « Créer la tâche »")
    it.click();pg.wait_for_timeout(300)
    n=[t for t in tasks(pg) if t["title"]=="Préparer la visite"]
    ok(len(n)==1 and n[0]["due"] and n[0]["projectId"]=="d","palette : tâche créée dans le projet ouvert, avec échéance")
    # Corbeille dans la barre latérale
    ok(pg.locator(".vbtn",has_text="Corbeille").is_visible(),"corbeille dans la barre latérale")
    # Thème sombre
    pg.evaluate("()=>{document.documentElement.dataset.theme='dark'}");pg.wait_for_timeout(100)
    pg.screenshot(path=S+"v2_dark.png")
    pg.close()
    # ---------- Téléphone ----------
    ctx=b.new_context(viewport={"width":390,"height":844},has_touch=True,is_mobile=True)
    pg=ctx.new_page();pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.add_init_script(INIT)
    pg.goto(APP);pg.wait_for_timeout(400)
    ok(pg.locator(".bnav [data-b=add]").is_visible() and not pg.locator("#fab").is_visible(),"téléphone : bouton + dans la barre du bas")
    ok(pg.locator("[data-tab=overview]").count()==0,"téléphone : pas d'onglet Vue d'ensemble")
    pg.locator(".bnav [data-b=menu]").click();pg.wait_for_timeout(200)
    pg.locator(".pjt",has_text="Projet Alpha").click();pg.wait_for_timeout(300)
    ok(pg.locator(".phacts .btn",has_text="Démarrer une visite").is_visible() and pg.locator(".phacts .btn",has_text="Nouvelle réunion").is_visible(),"téléphone : actions rapides sur l'accueil du projet")
    pg.screenshot(path=S+"v2_phone_home.png")
    # Glisser : terminer / reporter
    pg.locator(".phtile").first.click();pg.wait_for_timeout(300)
    def swipe(title,dx):
        li=pg.locator(".task:not(.pt):not(.req)",has_text=title).first
        bb=li.bounding_box();x=bb["x"]+bb["width"]/2;y=bb["y"]+bb["height"]/2
        pg.evaluate("""([sel,x,y,dx])=>{const li=[...document.querySelectorAll('#lists .task[data-id]')].find(e=>e.textContent.includes(sel));
          const tgt=li.querySelector('.ttl')||li;const o={bubbles:true,pointerId:7,pointerType:'touch',isPrimary:true};
          tgt.dispatchEvent(new PointerEvent('pointerdown',{...o,clientX:x,clientY:y}));
          for(let i=1;i<=6;i++)tgt.dispatchEvent(new PointerEvent('pointermove',{...o,clientX:x+dx*i/6,clientY:y}));
          window.__swc=li.classList.contains('swiping');
          tgt.dispatchEvent(new PointerEvent('pointerup',{...o,clientX:x+dx,clientY:y}));}""",[title,x,y,dx])
        pg.wait_for_timeout(300)
    if pg.locator(".task",has_text="Tâche à glisser").count():
        swipe("Tâche à glisser",140)
        ok(pg.evaluate("window.__swc") and task(pg,"t3")["status"]=="done","glisser à droite : tâche terminée")
        swipe("Tâche à reporter",-140)
        ok(task(pg,"t4")["due"]==iso(D+datetime.timedelta(days=1)),"glisser à gauche : reportée à demain")
        ok(pg.locator(".task.open").count()==0,"glisser n'ouvre pas la tâche")
    else:
        ok(False,"liste des tâches du téléphone introuvable")
    pg.screenshot(path=S+"v2_phone_list.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
