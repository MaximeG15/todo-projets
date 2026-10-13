"""Outils communs aux tests de To do projets (données entièrement fictives)."""
import os, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / "index.html").as_uri()            # l'application, ouverte en file://
FAKE = str(pathlib.Path(__file__).resolve().parent / "fake_supabase.js")  # faux serveur Supabase
OUT = str(pathlib.Path(__file__).resolve().parent / "out") + os.sep          # captures et exports (non versionnés)
os.makedirs(OUT, exist_ok=True)


class _Dialog:
    """Imite l'objet Dialog de Playwright pour les boîtes de dialogue intégrées à l'application."""
    def __init__(self, o):
        self.type = o["type"]; self.message = o["message"]; self.default_value = o.get("def", "")
        self.fields = o.get("fields", []); self.r = {"ok": True}
    def accept(self, v=None): self.r = {"ok": True, "v": v}
    def dismiss(self): self.r = {"ok": False}


def on_dialog(page, fn):
    """Équivalent de page.on("dialog", fn) pour les boîtes intégrées (à appeler avant page.goto)."""
    def handler(o):
        d = _Dialog(o); fn(d); return d.r
    page.expose_function("__testDialog", handler)


THEMES = [("Réception", 11, 3), ("Expédition", 14, 2), ("Stockage", 20, 0), ("Préparation", 18, 0), ("Généralités", 12, 0)]

def synthetic_points():
    """78 points ouverts fictifs : 75 ouverts (Réception 11, Expédition 14, …) et 3 levés ; 5 sujets ERP."""
    pts, n = [], 0
    for theme, count, erp in THEMES:
        for i in range(count):
            n += 1
            sujet = ("suivi du numéro de série par palette" if theme == "Stockage" and i < 3 else
                     "règle FIFO à confirmer" if theme == "Préparation" and i == 0 else "point à préciser avec le client")
            pts.append({"text": f"Question {n} – {theme.lower()} : {sujet}",
                        "answer": "", "hypothesis": "Hypothèse de travail %d" % n if n % 4 == 0 else "",
                        "erp": "oui" if i < erp else "", "theme": theme, "owner": "client" if n % 2 else "mecalux",
                        "status": "open", "created_at": 1700000000000 + n})
    for i in range(3):
        n += 1
        pts.append({"text": f"Question {n} – stockage : point levé", "answer": "Réponse obtenue", "hypothesis": "",
                    "erp": "", "theme": "Stockage", "owner": "client", "status": "closed", "created_at": 1700000000000 + n})
    return pts
