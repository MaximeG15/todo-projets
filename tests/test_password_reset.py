import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from helpers import APP,OUT,FAKE,on_dialog,synthetic_points
from playwright.sync_api import sync_playwright
S=OUT
errs=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: errs.append(m)
PATCH="""(()=>{const cc=window.supabase.createClient;window.supabase.createClient=(...a)=>{const c=cc(...a);
 const rec=/type=recovery/.test(location.hash);let sess=rec?{access_token:'eyJ',user:{id:'u1',email:'alice@exemple.test'}}:null;
 c.auth.getSession=async()=>({data:{session:sess}});
 c.auth.resetPasswordForEmail=async(e,o)=>{window.__reset=[e,o];return {error:null}};
 c.auth.updateUser=async(u)=>{window.__upd=u;return {data:{user:sess.user},error:null}};
 c.auth.signInWithPassword=async()=>({data:{},error:{message:'Invalid login credentials',status:400}});
 return c}})()"""
with sync_playwright() as pw:
    b=pw.chromium.launch()
    pg=b.new_page();pg.on("pageerror",lambda e:errs.append("JS: "+str(e)))
    pg.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg.add_init_script(path=FAKE);pg.add_init_script(PATCH)
    pg.add_init_script("localStorage.setItem('todo-mode','cloud')")
    pg.goto(APP);pg.wait_for_timeout(500)
    ok(pg.locator("#glogin").is_visible(),"écran de connexion")
    pg.fill("#lemail","Alice@Exemple.test");pg.click("#lforgot")
    ok(pg.locator("#gforgot").is_visible() and pg.input_value("#femail")=="Alice@Exemple.test","formulaire oublié pré-rempli")
    pg.click("#fgo");pg.wait_for_timeout(200)
    r=pg.evaluate("window.__reset");ok(r and r[0]=="alice@exemple.test" and r[1]["redirectTo"].endswith("index.html"),"resetPasswordForEmail appelé %s"%r)
    ok("e-mail vient d'être envoyé" in pg.inner_text("#fok"),"message de confirmation")
    pg.click("#fback");ok(pg.locator("#glogin").is_visible(),"retour connexion")
    pg.screenshot(path=S+"pwd1.png")
    # retour par le lien
    pg2=b.new_page();pg2.on("pageerror",lambda e:errs.append("JS2: "+str(e)))
    pg2.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg2.add_init_script(path=FAKE);pg2.add_init_script(PATCH)
    pg2.goto(APP+"#access_token=x&type=recovery");pg2.wait_for_timeout(500)
    ok(pg2.locator("#greset").is_visible(),"formulaire nouveau mot de passe")
    pg2.fill("#rpass","abc");pg2.fill("#rpass2","abc");pg2.click("#rgo")
    ok(pg2.evaluate("!document.querySelector(\"#rpass\").checkValidity()"),"contrôle longueur (navigateur)")
    pg2.fill("#rpass","nouveau123");pg2.fill("#rpass2","nouveau124");pg2.click("#rgo")
    ok("différents" in pg2.inner_text("#rerr"),"contrôle confirmation")
    pg2.fill("#rpass2","nouveau123");pg2.click("#rgo");pg2.wait_for_timeout(600)
    ok(pg2.evaluate("window.__upd")=={"password":"nouveau123"},"updateUser appelé")
    ok(pg2.locator("#gate").is_hidden() and pg2.locator(".pbtn",has_text="Alpha").count()>0,"connecté après changement")
    pg3=b.new_page();pg3.on("pageerror",lambda e:errs.append("JS3: "+str(e)))
    pg3.route("**/supabase.js",lambda r:r.fulfill(body="",content_type="text/javascript"))
    pg3.add_init_script(path=FAKE);pg3.add_init_script(PATCH)
    pg3.goto(APP+"#error=access_denied&error_code=otp_expired");pg3.wait_for_timeout(400)
    ok(pg3.locator("#gforgot").is_visible() and "expiré" in pg3.inner_text("#ferr"),"lien expiré géré")
    b.close()
print("ERREURS:",errs) if errs else print("TOUT OK")
sys.exit(1 if errs else 0)
