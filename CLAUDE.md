# To do projets – fiche de passation

Ce fichier explique l'appli à quelqu'un (ou à une autre conversation Claude) qui découvre le dépôt : à quoi elle sert, comment elle est construite, comment la faire évoluer sans rien casser, et pourquoi les choses sont comme elles sont. Il est tenu à jour à chaque évolution notable.

> Dépôt **public** : ne jamais y mettre de données client (noms de clients réels, points ouverts, comptes rendus, captures d'écran avec des données). Les tests utilisent uniquement des données fictives (« Projet Alpha », « Alice Martin »…).

## 1. À quoi sert l'appli

Application web de suivi de projets pour un **directeur de projet chez Mecalux** (intégrateur du WMS EasyWMS), partagée avec des collègues. Elle ne fait **pas** le suivi global des projets (Gantt, heures : un autre logiciel s'en charge) : elle couvre le quotidien du chef de projet.

- **Tâches** par projet : échéances, priorités, étapes, familles, récurrence, commentaires, attribution aux membres, corbeille, historique, export Excel/PDF, récap de la semaine.
- **Points ouverts** (questions à trancher avec le client pendant l'analyse fonctionnelle) : thèmes, « qui doit répondre », hypothèse Mecalux, sujet ERP, réponses, numéros, lien avec un fichier Excel SharePoint/OneDrive (mise à jour à sens unique Excel vers appli), alerte quand le client répond dans l'Excel.
- **Demandes client** par projet (statuts, chiffrage, devis, tâches liées).
- **Réunions** : comptes rendus créés depuis l'agenda Outlook (calendrier publié en ICS), préparation, mode réunion, validation, PDF.
- **Déplacements** sur site (anciennement « Visites ») : trois types.
  - *Visite d'analyse fonctionnelle (AF)*, 2 jours par défaut : notes par flux d'entrepôt (réception, stockage…), photos annotées, vocaux transcrits sur l'ordinateur, éléments « à voir » préparés à l'avance, bilan qui transforme les questions en points ouverts et les actions en tâches.
  - *Dry run* : affiché grisé, « Bientôt disponible ».
  - *Mise en service (MES)*, 5 jours par défaut : un compte rendu par jour avec rubriques (Process OK / Actions réalisées, Problèmes majeurs et points en cours, Points à traiter / Actions à venir, Statut de l'installation, Ressenti <projet>, Ressenti Mecalux), éléments non terminés repris le lendemain, copie pour Confluence et pour l'Excel « points ouverts Go Live ».
- **Confluence en direct** : une MES ou une visite d'AF peut être liée à une page Confluence partagée ; l'appli y écrit un bloc par journée (le plus récent en haut), sans toucher au reste de la page.
- Appli **installable** (PC, Android, iPhone), utilisable **hors connexion**, version téléphone dédiée.

Langue de l'interface et des messages de commit : **français**. Ton professionnel et factuel.

## 2. Hébergement et services

| Élément | Où |
|---|---|
| Appli (fichiers statiques) | GitHub Pages : https://maximeg15.github.io/todo-projets/ (branche `main`) |
| Base de données, comptes, stockage | Supabase, projet `kdwberesnaixlczrjehq` (UE, Irlande) |
| Clé publique Supabase | `js/config.js` (clé « publishable », faite pour être visible ; la sécurité repose sur les règles RLS) |
| Relais serveur | Fonctions Supabase (Edge Functions) : `outlook-ics` (lecture du calendrier Outlook publié) et `confluence` (écriture dans Confluence) |
| Secret serveur | `CONF_KEY` (chiffrement des jetons Confluence et signature des liens de page), saisi à la main dans Supabase > Edge Functions > Secrets. **Ne jamais le changer** : les jetons déjà enregistrés deviendraient illisibles (il faudrait reconnecter Confluence). |
| Tests | GitHub Actions (`.github/workflows`), Playwright + Chromium |

Deux modes de fonctionnement :
- **Mode local** (sans compte) : données dans le navigateur (localStorage, IndexedDB pour les déplacements), ou dans un fichier `.json` choisi sur l'ordinateur.
- **Mode en ligne** (compte Supabase) : données partagées par projet avec les collègues, synchronisation temps réel ligne par ligne.

## 3. Organisation du code

Pas de framework ni d'étape de compilation : HTML, CSS et JavaScript servis tels quels.

| Fichier | Rôle |
|---|---|
| `index.html` | Squelette, dialogues fixes (compte, calendrier, export…), chargement des scripts avec `?v=NN` |
| `css/app.css` | Styles de base (historique) |
| `css/v2.css` | Couche de design actuelle, chargée en dernier (refonte 2.0 puis « design 3.0 » à dégradés) ; les ajouts récents sont en fin de fichier avec un commentaire `/* vNN : … */` |
| `js/app.js` | **Toute l'appli** dans une seule fonction anonyme (~6 800 lignes) |
| `js/config.js` | Adresse et clé publique Supabase |
| `js/xlsx.js` | Lecture/écriture Excel minimale |
| `js/transcribe-worker.js`, `vendor/transformers` | Transcription Whisper dans le navigateur (aucun envoi du son à un service extérieur) |
| `vendor/supabase.js` | Client Supabase hébergé avec l'appli (RGPD : aucune bibliothèque chargée depuis un CDN) |
| `fonts/` | Polices Barlow / Barlow Condensed hébergées avec l'appli |
| `sw.js` | Service worker : cache hors connexion, nom de cache `todo-projets-vNN` |
| `icons/` | Icônes (le numéro dans le nom force la mise à jour des applis installées) |
| `todo-projets-base.sql` | Script SQL de référence de la base (tables, RLS, fonctions), complété à chaque migration |
| `supabase/functions/*` | Code des relais serveur (le code déployé doit rester identique au dépôt) |
| `tests/` | Tests Playwright (voir `tests/README.md`) |

### Plan de `js/app.js`

Le fichier est découpé en sections repérées par `// ---------- Titre ----------` (chercher ce motif). Dans l'ordre :

persistance et suivi des changements · sauvegarde fichier · **mode en ligne (Supabase)** · RGPD · lecture ICS · familles · profils · réunions Outlook · actions · ajout en une ligne (`@personne !priorité #projet`) · tâches récurrentes · **rendu** (barre latérale, listes, onglets) · agenda · texte enrichi et son éditeur · recherche · commentaires · glisser-déposer · étapes · sélection multiple · statuts · dialogues intégrés (`uiDialog`, `uiConfirm`, `uiPrompt`, `uiForm`) · corbeille · archivage · tableau de bord · historique · export des points ouverts · **points ouverts** · lien Excel · alerte de réponse client · **réunions et comptes rendus** · **déplacements** (création, écran, visite 2.0, photo, préparation, scan de codes-barres, fin de visite, notes par jour) · **mise en service** · **Confluence** · audio et transcription · écran Projets du téléphone · ordre des projets · vue d'ensemble du projet · points ouverts standard (modèle d'AF) · demandes client · récap de la semaine · menu du téléphone · initialisation · cloche de notifications · gestes sur téléphone · Ctrl+K · bouton retour du téléphone · installation. En toute fin, hors de la fonction principale : le calendrier de dates de l'appli (PC).

Repères utiles :
- `state` : données de travail (`projects`, `tasks`, `requests`, `points`, `deleted`) ; `save()` puis `render()`.
- `MODE` (`"local"` / `"cloud"`), `cloud` (client, utilisateur, synchronisation), `ui` (préférences d'affichage, `saveUi()`).
- Déplacements : objet `vis` (cache IndexedDB), `visCur` (déplacement ouvert), `visSet(fn)` (modifie + redessine), `visQuiet(fn)` (modifie sans redessiner), `visPut` (enregistre et programme l'envoi en ligne), `renderVisit()`.
- Téléphone : `isPhone()` (largeur ≤ 899 px), ordinateur à partir de 900 px.
- Échappement HTML : `esc()` partout où du texte utilisateur entre dans du HTML.

## 4. Modèle de données (mode en ligne)

Tables Supabase (toutes avec RLS ; l'accès à un projet passe par `can_access(project_id)` : propriétaire ou membre par e-mail) :

`projects`, `project_members`, `tasks`, `task_comments`, `task_history`, `project_families`, `profiles` (prénom, nom, `project_order`), `user_calendar` (lien ICS, visible de son seul propriétaire), `client_requests`, `open_points`, `point_themes`, `point_templates` (points ouverts standard de l'AF), `meetings`, `project_contacts`, `visits` (déplacements), `user_confluence` (connexion Confluence, jeton chiffré, visible de son seul propriétaire).

Stockage : `visit-photos` et `visit-audio`, chemin `<projet>/<déplacement>/<fichier>`, accès réservé aux membres du projet.

Un déplacement (`visits`) contient en JSON :
- `prep` : préparation (`type` = `af` / `dry` / `mes`, `days`, `plannedAt`, `endDay`, lieu, objectif, participants, `conf` = page Confluence liée) ;
- `flows` : flux (AF) ou journées (MES : `flow.day`, `flow.closed`) ;
- `items` : éléments « à voir » (AF) ; pour la MES, rubriques (`mk:"row"`) et éléments (`mk:"it"`, avec `st` = Fait / En cours / À faire / Annulée, `from` = origine pour la reprise du lendemain) ;
- `notes` : notes (type note / question / action, photos, audio, transcription, `conv` = point ou tâche créé au bilan) ;
- `sync` : horodatages pour fusionner les modifications de plusieurs appareils sans écrasement.

## 5. Confluence en direct (v108 à v110)

- Connexion : chaque utilisateur colle **son** jeton API Atlassian (de préférence « avec portées » : `read:page:confluence`, `write:page:confluence`, et pour les photos `read:attachment:confluence`, `write:attachment:confluence`). Le relais `confluence` teste le jeton, le **chiffre** (AES-GCM, clé `CONF_KEY`) et l'enregistre dans `user_confluence`. Le navigateur ne relit jamais le jeton.
- Lien d'une page : le relais renvoie une **signature** (HMAC) de `déplacement | page | personne`. Les envois des collègues passent par la connexion de la personne qui a lié la page, uniquement vers cette page (fonction SQL `confluence_cred`, qui ne renvoie que le jeton chiffré).
- Écriture : chaque journée est encadrée par deux ancres invisibles `tdp-<déplacement>-<jour>` et `…-fin` ; seul ce bloc est remplacé (`supabase/functions/confluence/blocks.js`). Journée la plus récente en haut. Conflit de version : relecture et nouvel essai.
- Côté appli : envoi 10 s après chaque modification (et immédiatement à la clôture d'une journée de MES), seulement les journées modifiées depuis cet appareil ; témoin dans l'en-tête du déplacement.
- MES : tableau Sujet / Description par journée (même format que « Copier pour Confluence »). AF : par journée, informations (premier jour), synthèse, puis par flux les éléments vus, les notes avec étiquettes et les photos (pièces jointes de la page, 6 par envoi), questions client et actions du jour, éléments à reprendre.
- **Pas encore vérifié** sur une vraie page Confluence au moment de l'écriture de cette fiche (fonctionnement validé avec un faux relais dans `tests/test_confluence.py`).

## 6. Mettre une modification en ligne

1. Modifier le code.
2. Incrémenter la version : `?v=NN` dans `index.html` (5 occurrences) **et** `CACHE = "todo-projets-vNN"` dans `sw.js`. Sans cela, les applis installées gardent l'ancienne version en cache.
3. Lancer tous les tests : `python3 tests/run_all.py` (Playwright ; tout doit passer).
4. Commit en français, titre « vNN : ce qui change », puis push sur `main`. GitHub Pages publie en 1 à 2 minutes ; vérifier que le job **Tests** de GitHub Actions passe (environ 10 minutes).
5. Si la base change : ajouter le SQL à `todo-projets-base.sql`. Si un relais change : redéployer la fonction Supabase avec le même code que le dépôt.
6. Icônes : changer le numéro dans leur nom pour forcer la mise à jour sur les appareils.

## 7. Règles de travail

- Écrire en **français**, ton professionnel et factuel, sans inventer : s'appuyer sur ce que l'utilisateur décrit.
- **Maquette avant toute grosse fonctionnalité** : les propositions d'interface sont faites dans un canevas de design (hors dépôt) et validées avant de coder.
- **Jamais de données client** dans le dépôt public.
- **Ne jamais demander ni utiliser la clé `service_role`** de Supabase. Les relais travaillent avec la session de l'utilisateur (RLS).
- Opérations **destructives** sur la base : fournir le SQL à l'utilisateur plutôt que de l'exécuter. Les migrations non destructives (ajout de table, de colonne, de fonction) peuvent être appliquées directement.
- Aucune ressource externe au chargement (polices, bibliothèques hébergées avec l'appli) : choix RGPD.
- Chaque nouvelle fonction notable a son test Playwright (données fictives, faux client Supabase `tests/fake_supabase.js`).

## 8. Décisions de conception à connaître

- **Navigation** : sur téléphone l'appli s'ouvre sur l'écran Projets ; le bouton retour du téléphone remonte niveau par niveau jusqu'à cet écran, puis quitte l'appli. Sur ordinateur, l'accueil est « Ma journée ».
- **Barre latérale** : une entrée « Tâches » (filtre Mes tâches / Toutes) ; Demandes client et Points ouverts sont dans chaque projet ; ordre des projets par glisser-déposer, synchronisé (`profiles.project_order`).
- **Design** : même direction artistique depuis la refonte 2.0 (Barlow, encre `#0F1E28`, jaune signal `#F2B705`), puis « design 3.0 » : dégradés réservés à l'action principale, à la sélection, à la couleur des projets et aux états. Familles en sarcelle (distinctes du violet « en attente »). Logo : couteau suisse (lames argentées, manche jaune) ; icône Android pleine surface, icône PC aux coins arrondis.
- **Points ouverts** : thèmes rangés dans l'ordre des flux d'un entrepôt (généralités, master data, interfaces ERP, réception, contrôle, rangement/stockage, réapprovisionnement, préparation, emballage, expédition/transport, documents, retours, gestion de stock, inventaire, atelier, matériel, utilisateurs), les autres ensuite par ordre alphabétique (`THEME_ORDER`, `themeCmp`).
- **Préparation d'une visite d'AF** : rien n'est ajouté d'office ; chaque flux **propose** les points non levés de son thème (client d'abord, du plus ancien au plus récent), ajoutés à la main ; les points sans flux correspondant sont dans une liste qui défile à droite.
- **Excel Go Live** (MES) : rempli uniquement par Mecalux ; copie au format N°, Sujet, Commentaire, État, Qui ; un sujet déjà saisi propose de mettre à jour le point existant (pas de doublon).
- **Calendrier de dates** : sur PC, calendrier propre à l'appli (celui de Chrome grisait le même jour en changeant de mois) ; il montre les déplacements déjà prévus. Sur téléphone, calendrier natif.

## 9. Pistes ouvertes

- Vérifier le premier envoi réel vers Confluence (mise en forme, photos, portées du jeton).
- Photos de la mise en service vers Confluence (proposé, non demandé à ce jour).
- Dry run : type de déplacement prévu, pas encore conçu.
- Nom de l'appli : plusieurs pistes étudiées (dont « Pilodo »), aucune retenue.

## 10. Historique résumé

| Période / versions | Principales étapes |
|---|---|
| 8 oct. 2026 | Première version : mode local et en ligne, comptes, appli installable hors connexion |
| Octobre (avant v71) | Étapes, récurrence, commentaires, Outlook dans l'agenda, familles, corbeille, archivage, exports, tableau de bord, demandes client, points ouverts (thèmes, filtres, lien Excel, alertes de réponse), sélection multiple et attribution, interface « Cockpit projet », comptes rendus de réunion, logo, points ouverts standard de l'AF, RGPD, mode visite sur site (photos, hors connexion, audio et transcription, scan de codes-barres), logos clients |
| v71 à v80 | Refonte 2.0 (ordinateur et téléphone), Visites 2.0, menu téléphone épuré, logo 2.0, texte enrichi, barre latérale épurée |
| v81 à v93 | Menu du projet refait, « Déplacements » (plusieurs jours, types AF / dry run / MES), compte rendu de MES jour par jour, copie Excel Go Live, bouton retour du téléphone, lien Excel pour tous, choix de la réunion Outlook, affichage responsive et ordre des projets |
| v94 à v104 | Design 3.0 (dégradés), logo 3.0 et icônes, survol des projets, calendrier de dates de l'appli, corrections d'affichage |
| v105 à v112 | Déplacements prévus dans le calendrier, préparation d'AF avec points proposés par flux, Confluence en direct (MES puis AF avec photos), thèmes dans l'ordre des flux d'entrepôt |

Le détail complet est dans l'historique Git (`git log`), un commit par évolution.
