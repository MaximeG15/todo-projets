# Tests automatisés

Tests de bout en bout de l'application dans un vrai navigateur (Chromium, via Playwright).
Ils utilisent uniquement des **données fictives** et un **faux serveur Supabase** (`fake_supabase.js`) :
aucun accès à la base réelle, aucune donnée client.

## Lancer les tests en local

```bash
pip install playwright
python -m playwright install chromium
python tests/run_all.py            # tous les tests
python tests/run_all.py search     # seulement ceux dont le nom contient « search »
```

Les captures d'écran et fichiers exportés pendant les tests sont écrits dans `tests/out/` (non versionné).

## Intégration continue

Le workflow `.github/workflows/tests.yml` lance la suite à chaque envoi sur `main` et à chaque pull request.
