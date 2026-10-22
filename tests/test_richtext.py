import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,on_dialog
import json
from playwright.sync_api import sync_playwright
# Texte enrichi : nettoyage, stockage, affichage, éditeur (barre d'outils, raccourcis, listes, collage), téléphone
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
EVIL='<p>Texte <img src=x onerror="window.__pwn=1"><b>gras</b><script>window.__pwn=2</script> <a href="javascript:window.__pwn=3">lien</a></p>'
T=[{"id":"a","projectId":"p","title":"Valider le format des étiquettes","due":"","priority":"normale","status":"todo","createdAt":1,"note":"Note simple\nsur deux lignes"},
   {"id":"b","projectId":"p","title":"Tâche piégée","due":"","priority":"normale","status":"todo","createdAt":2,"note":EVIL}]
P=[{"id":"o1","projectId":"p","text":"<p>Format <b>validé</b> ?</p>","answer":"<ul><li>Oui</li><li>100x150</li></ul>","hypothesis":"","erp":"","theme":"Réception","owner":"client","ownerName":"","status":"open","createdAt":1}]
data={"projects":[{"id":"p","name":"Projet Alpha","color":"#E0703A"}],"tasks":T,"requests":[],"points":P,"deleted":[]}
INIT="if(!sessionStorage.getItem('s')){localStorage.setItem('todo-projets',%s);localStorage.setItem('todo-mode','local');localStorage.setItem('todo-projets-ui','{}');sessionStorage.setItem('s','1')}"%json.dumps(json.dumps(data))
def note(pg,i):return pg.evaluate("id=>JSON.parse(localStorage.getItem('todo-projets')).tasks.find(t=>t.id===id).note",i)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    pg=b.new_page(viewport={"width":1366,"height":900})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept("https://exemple.test/cahier"))
    pg.add_init_script(INIT)
    pg.goto(APP);pg.wait_for_timeout(400)
    # ---- nettoyage et conversions
    r=pg.evaluate("""()=>{const R=window.__rt;return {
      a:R.rtClean('<div><strong>A</strong> <em>B</em> <font color="#ff0000">C</font> <span style="background-color:yellow">D</span> <del>E</del></div>'),
      b:R.rtStore('<p>simple</p><p>texte</p>'),
      c:R.rtText('<ul><li>un</li><li>deux</li></ul><ol><li>x</li></ol>'),
      d:R.rtClean('<p onclick="x()">a<iframe src="x"></iframe><a href="javascript:alert(1)">b</a><a href="https://ok.test">c</a></p>'),
      e:R.rtStore('<p>a <b>b</b></p>'),
      f:R.rtIs('<p>x</p>'),g:R.rtIs('Texte <p>')}}""")
    ok(r["a"]=='<p><b>A</b> <i>B</i> <span class="rc-r">C</span> <mark>D</mark> <s>E</s></p>',"nettoyage : gras, italique, couleur, surligné, barré normalisés (%s)"%r["a"])
    ok(r["b"]=="simple\ntexte","sans mise en forme : stocké en texte brut")
    ok(r["c"]=="• un\n• deux\n1. x","texte brut : listes en « • » et « 1. »")
    ok("onclick" not in r["d"] and "iframe" not in r["d"] and "javascript" not in r["d"] and 'href="https://ok.test"' in r["d"],"nettoyage : scripts, iframes et liens javascript retirés")
    ok(r["e"]=="<p>a <b>b</b></p>" and r["f"] and not r["g"],"avec mise en forme : stocké en HTML nettoyé")
    # ---- affichage : formaté, sans risque
    pg.locator(".pbtn",has_text="Projet Alpha").click();pg.locator("[data-tab=tasks]").click();pg.wait_for_timeout(300)
    ok(pg.evaluate("window.__pwn")is None and pg.locator('.task[data-id="b"] .note img, .task[data-id="b"] .note script').count()==0,"texte piégé : rien ne s'exécute")
    ok(pg.locator('.task[data-id="b"] .note b').count()==1 and pg.locator('.task[data-id="b"] .note a').count()==0,"texte piégé : gras gardé, lien javascript retiré")
    # ---- éditeur de la note d'une tâche
    pg.locator('.task[data-id="a"] .ttl').click();pg.wait_for_timeout(300)
    ed=pg.locator('.task[data-id="a"] .rte[aria-label=Note]')
    ok(ed.count()==1 and ed.locator("p").count()==2,"note existante chargée dans l'éditeur (2 lignes)")
    ed.click();pg.wait_for_timeout(100)
    ok(pg.locator('.task[data-id="a"] .rtw.on .rtb').first.is_visible(),"barre d'outils affichée pendant la saisie")
    pg.keyboard.press("Control+End");pg.keyboard.press("Enter")
    pg.keyboard.press("Control+b");pg.keyboard.type("important");pg.keyboard.press("Control+b");pg.keyboard.type(" puis ")
    pg.keyboard.press("Enter");pg.keyboard.type("- premier");pg.keyboard.press("Enter");pg.keyboard.type("second")
    pg.keyboard.press("Enter");pg.keyboard.press("Enter");pg.keyboard.type("surligner ceci")
    pg.keyboard.press("Shift+Home");pg.locator('.task[data-id="a"] .rtw:has([aria-label=Note]) .rtbtn[data-c="mark"]').click()
    pg.keyboard.press("End");pg.keyboard.press("Enter");pg.keyboard.type("rouge")
    pg.keyboard.press("Shift+Home");pg.locator('.task[data-id="a"] .rtw:has([aria-label=Note]) .rtbtn[data-c="color"]').click();pg.locator(".rtpop button",has_text="Rouge").click()
    pg.keyboard.press("End");pg.keyboard.press("Enter");pg.keyboard.type("cahier")
    pg.keyboard.press("Shift+Home");pg.locator('.task[data-id="a"] .rtw:has([aria-label=Note]) .rtbtn[data-c="link"]').click();pg.wait_for_timeout(300)
    pg.screenshot(path=OUT+"rt_editor.png")
    pg.locator('.task[data-id="a"] [data-k="ok"]').click();pg.wait_for_timeout(300)
    n=note(pg,"a");print("   ",n)
    ok(n.startswith("<p>Note simple</p>") and "<b>important</b>" in n,"Ctrl+B : gras enregistré")
    ok("<ul><li>premier</li><li>second</li></ul>" in n,"« - » en début de ligne : liste à puces")
    ok("<mark>surligner ceci</mark>" in n,"surligneur")
    ok('class="rc-r"' in n and n.index('class="rc-r"')<n.index("rouge"),"couleur rouge")
    ok('<a href="https://exemple.test/cahier"' in n,"lien")
    row=pg.locator('.task[data-id="a"] .note')
    ok(row.locator("b").count()>=1 and row.locator("li").count()==2 and row.locator("mark").count()>=1,"liste des tâches : mise en forme affichée")
    pg.screenshot(path=OUT+"rt_list.png")
    # ---- recherche : texte trouvé, balises ignorées
    pg.fill("#search","important");pg.wait_for_timeout(400)
    ok(pg.locator('.task[data-id="a"] .note mark',has_text="important").count()==1,"recherche : mot surligné dans le texte formaté")
    pg.fill("#search","span");pg.wait_for_timeout(400)
    ok(pg.locator('.task[data-id="a"]').count()==0,"recherche : les balises ne sont pas cherchées")
    pg.fill("#search","");pg.wait_for_timeout(300)
    # ---- points ouverts : affichage et export en texte brut
    pg.locator("[data-tab=points]").click();pg.wait_for_timeout(300)
    pt=pg.locator('.pt[data-o="o1"]')
    ok(pt.locator(".ptxt b",has_text="validé").count()==1 and pt.locator(".pans li").count()==2,"point ouvert : question et réponse formatées")
    ok(pg.evaluate("()=>window.__rt.rtText(JSON.parse(localStorage.getItem('todo-projets')).points[0].answer)")=="• Oui\n• 100x150","export : réponse en texte brut")
    # ---- collage depuis Word / le web
    pt.locator(".ttl").click();pg.wait_for_timeout(300)
    hy=pg.locator('.rtw:has([data-f="hyp"]) .rte');hy.click()
    pg.evaluate("""()=>{const e=document.querySelector('.rtw:has([data-f="hyp"]) .rte');const dt=new DataTransfer();dt.setData('text/html','<p style="font-weight:bold">Collé <script>window.__pwn=9</script>depuis Word</p>');dt.setData('text/plain','Collé depuis Word');e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))}""")
    pg.wait_for_timeout(200)
    hv=pg.evaluate("document.querySelector('[data-f=\"hyp\"]').value");print("   ",hv)
    ok(hv=="<p><b>Collé depuis Word</b></p>" and pg.evaluate("window.__pwn") is None,"collage : mise en forme gardée, script retiré")
    pg.keyboard.press("Escape")
    pg.close()
    # ---- téléphone : barre au-dessus du clavier, commentaire publié avec Ctrl+Entrée
    pg=b.new_page(viewport={"width":390,"height":844},has_touch=True)
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.add_init_script(INIT)
    pg.goto(APP);pg.wait_for_timeout(400)
    pg.locator(".bnav [data-b=menu]").click();pg.locator(".pjt",has_text="Projet Alpha").click();pg.locator(".phtile").first.click();pg.wait_for_timeout(300)
    pg.locator('.task[data-id="a"] .ttl').click();pg.wait_for_timeout(400)
    ed=pg.locator('.task[data-id="a"] .rte[aria-label=Note]')
    ed.click();pg.wait_for_timeout(200)
    bar=pg.locator('.rtw.kb .rtb')
    bb=bar.bounding_box() if bar.count() else None
    ok(bb is not None and bb["y"]+bb["height"]>=800 and bb["width"]>=380,"téléphone : barre d'outils pleine largeur en bas de l'écran (%s)"%bb)
    pg.screenshot(path=OUT+"rt_phone.png")
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
