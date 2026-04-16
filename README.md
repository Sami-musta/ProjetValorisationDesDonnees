# AirValo — Valorisation des données Airbnb du canton de Vaud

> **Projet académique** — Master of Science HES-SO en Business Administration, orientation *Management des Systèmes d'Information*
> Application web décisionnelle pour **futurs hôtes Airbnb** en Suisse romande, centrée sur le canton de Vaud.

AirValo croise quatre sources de données ouvertes (Inside Airbnb, OFS, Atlas statistique Vaud, OpenStreetMap) pour aider un propriétaire à **évaluer la viabilité d'un lancement Airbnb** : score d'attractivité territoriale, simulation de revenus, comparaison de communes, cadre réglementaire.

---

## ✨ Fonctionnalités

- 🗺️ **Carte interactive** choroplèthe du canton (Leaflet.js) — scores par commune, pins des annonces actives, filtres dynamiques
- 📈 **Analyse détaillée** par commune — prix médian, occupation, revenu annuel, distribution (Chart.js)
- 🧪 **Simulateur de lancement** — formulaire 4 étapes (commune, profil de bien, type, budget) → revenu projeté P25/P50/P75, délai de rentabilité, confiance
- 🎯 **Attractivité multi-facteurs** — scoring OSM (culturel 25 % / sport 30 % / restauration 15 % / emploi 30 %)
- ⚖️ **Règles & fiscalité** — taxes de séjour, déclarations, cadre légal
- 📱 **Responsive** — desktop / tablette / mobile (breakpoints 640/760/1100/1440 px)

---

## 🏗️ Architecture

```
┌─────────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│  Sources publiques  │ ───▶ │  Pipeline Python     │ ───▶ │  Web app statique   │
│  (Airbnb, OSM, OFS) │      │  (process + score)   │      │  (HTML/CSS/JS)      │
└─────────────────────┘      └──────────────────────┘      └─────────────────────┘
```

### Stack technique

| Couche        | Techno                                              |
|---------------|-----------------------------------------------------|
| Pipeline      | Python 3, pandas, requests (OSM Overpass API)       |
| Front-end     | HTML5, CSS3, JavaScript **vanilla** (ES6+)          |
| Cartographie  | [Leaflet.js](https://leafletjs.com/) v1.9 + OpenStreetMap |
| Graphiques    | [Chart.js](https://www.chartjs.org/) v4             |
| Données       | Fichiers JSON statiques (≈ 5 Mo)                    |
| Hébergement   | 100 % statique (GitHub Pages, Netlify, Vercel)      |

---

## 📂 Structure du dépôt

```
.
├── data_pipeline/              # Scripts Python de traitement
│   ├── process_airbnb.py       # Nettoyage des listings Inside Airbnb
│   ├── compute_attractivity.py # Scoring attractivité via POI OSM
│   ├── inspect_data.py
│   └── inspect_detailed.py
│
├── webapp/                     # Application web statique
│   ├── index.html              # Structure sémantique (7 vues)
│   ├── style.css               # Design system (palette corail)
│   ├── app.js                  # Logique : routage, cartes, charts, simulateur
│   └── data/                   # JSON produits par le pipeline
│       ├── vaud_*.json         # Vaud (dataset principal)
│       ├── geneva_*.json       # Genève (comparaison)
│       ├── zurich_*.json       # Zurich (comparaison)
│       └── attractivity_weights.json
│
├── VaudData/                   # Données brutes Inside Airbnb — Vaud
├── GenevaData/                 # Données brutes Inside Airbnb — Genève
├── ZurichData/                 # Données brutes Inside Airbnb — Zurich
├── OtherData/                  # Données complémentaires (OFS, musées, hôtels…)
└── 04_ProjectValorisationDonnees.pdf   # Cahier des charges du cours
```

---

## 🚀 Lancement en local

### Prérequis
- Python **3.9+** (pour ré-exécuter le pipeline uniquement)
- Un navigateur moderne (Chrome, Firefox, Safari, Edge)

### Lancer la web app
L'application est 100 % statique — aucun build, aucune dépendance Node à installer.

```bash
cd webapp
python -m http.server 8000
```

Puis ouvrir [http://localhost:8000](http://localhost:8000).

### Re-générer les JSON (optionnel)

```bash
cd data_pipeline
python process_airbnb.py        # produit vaud_listings.json, etc.
python compute_attractivity.py  # produit vaud_attractivity.json, vaud_pois.json
```

---

## 📊 Sources de données

| Source                            | Usage                                       | Licence              |
|-----------------------------------|---------------------------------------------|----------------------|
| [Inside Airbnb](http://insideairbnb.com/) | Listings, calendriers, avis (Vaud / GE / ZH) | CC BY 4.0            |
| [OpenStreetMap](https://www.openstreetmap.org/) (Overpass) | POI (culture, sport, restauration, emploi) | ODbL                 |
| [OFS](https://www.bfs.admin.ch/)  | Limites communales, données démographiques  | OGD                  |
| [Atlas statistique Vaud](https://www.vd.ch/themes/statistique-recensement/) | Nuitées hôtels, densité, fréquentation musées | OGD                  |

---

## 🎯 Méthodologie

- **Scoring d'attractivité** inspiré du *San Francisco Model* — agrégation pondérée de POI par commune, normalisée [0–100]
- **Simulateur de lancement** — comparaison à la cohorte d'annonces actives, fallback progressif en 5 niveaux (commune-strict → commune-loose → district-strict → district-loose → commune-any) pour garantir un résultat sur toutes les communes du canton
- **Pondération** transparente et ajustable via `attractivity_weights.json`



