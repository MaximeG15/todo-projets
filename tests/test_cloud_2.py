import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
from playwright.sync_api import sync_playwright
S=OUT
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch();pg=b.new_page(viewport={"width":1440,"height":1000})
    pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    on_dialog(pg,lambda d:d.accept())
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE)
    pg.add_init_script("window.__db.client_requests=[{id:'rq1',project_id:'p2',title:'Demande partagée',description:'',requester:'Client',received:'2026-10-01',due:'2026-10-20',priority:'normale',status:'waiting',scope:'in',estimate:'1.5',quote:'sent',created_at:1,updated_at:1,closed_at:null,deleted_at:null,updated_by:'bruno@exemple.test'}];localStorage.setItem('todo-mode','cloud');localStorage.setItem('todo-projets-ui','{}')")
    pg.goto(APP);pg.wait_for_timeout(800)
    db=lambda t:pg.evaluate("window.__db."+t)
    pg.locator(".vbtn",has_text="Demandes client").click()
    t=pg.locator("#lists").inner_text()
    ok("Demande partagée" in t and "1,5 j" in t and "Devis envoyé" in t,"lecture client_requests (estimation numérique, devis)")
    pg.locator(".pbtn",has_text="Projet Alpha").click()
    f=pg.locator("#reqadd");f.locator('[data-q="title"]').fill("Nouvelle demande");f.locator(".qadd").click();pg.wait_for_timeout(300)
    rows=[r for r in db("client_requests") if r["title"]=="Nouvelle demande"]
    ok(len(rows)==1 and rows[0]["project_id"]=="p1" and rows[0]["status"]=="new" and rows[0]["estimate"] is None,"envoi d'une nouvelle demande")
    rid=rows[0]["id"]
    row=pg.locator(f'.req[data-r="{rid}"]');row.locator("details.more summary").click();row.locator('[data-a="task"]').click();pg.wait_for_timeout(300)
    ts=[x for x in db("tasks") if x.get("request_id")==rid]
    ok(len(ts)==1,"tâche envoyée avec request_id")
    ok([r for r in db("client_requests") if r["id"]==rid][0]["status"]=="doing","statut de la demande envoyé")
    log=[l[1] for l in pg.evaluate("window.__log") if l[0]=="upsert"]
    i_r=max(i for i,x in enumerate(log) if x=="client_requests"); 
    print("   ordre des envois :",log[-4:])
    b.close()
print("ERREURS :",errs or "aucune")
sys.exit(1 if errs else 0)
