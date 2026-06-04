# AirValo — Valorisation des données Airbnb du canton de Vaud

> **Projet académique** — Master of Science HES-SO en Business Administration, orientation *Management des Systèmes d'Information*
> Application web décisionnelle pour **futurs hôtes / investisseurs Airbnb** dans le **canton de Vaud**.

AirValo croise des sources de données ouvertes (Inside Airbnb, avis voyageurs, OpenStreetMap, Atlas statistique Vaud, prix immobiliers, répertoire officiel des localités swisstopo) pour répondre, commune par commune, à trois questions : **où** investir, **quoi** proposer et **à quel prix** — puis **combien** cela peut rapporter. Le tout via un **score d'investissement** orienté investisseur, une **attractivité calculée localement** (rayon autour de chaque bien), une **analyse des avis voyageurs** et un **simulateur de lancement avec ROI**.

---

## ✨ Ce que fait l'application

| Vue | Fonction |
|-----|----------|
| 📊 **Aperçu** | KPIs du canton, meilleurs quartiers, revenu par type de bien, recommandation AirValo, panorama des fonctionnalités |
| 🗺️ **Carte interactive** | 2 568 annonces géolocalisées (Leaflet), colorées par score / revenu / prix / occupation. Clic sur un bien → fiche détaillée + **rayon d'analyse visible** (zone 1 500 m + proximité transports 1 000 m). Les points superposés restent **cliquables** même sous un rayon. |
| 💬 **Expérience voyageurs** | Analyse de **71 644 avis Airbnb** sur **167 communes** : thèmes valorisés, frictions à surveiller, tonalité globale et conseil par commune. Affichée sur la fiche carte, dans l'onglet Attractivité et dans le simulateur. |
| 🎯 **Attractivité** | Score local sur **5 facteurs** (culture, sport, restauration, emploi, transports), agrégé par district et par **code postal (NPA)** avec explorateur filtrable (228 zones). |
| 📈 **Analyse détaillée** | Filtres (quartier, type, prix, score), comparaison des communes, tendances saisonnières, recommandation AirValo fiabilisée. |
| 🧮 **Simulateur de lancement** | Formulaire (commune, profil, type, budget) → **prix conseillé /nuit** (P25/P50/P75), **occupation attendue**, **revenu projeté**, **ROI & payback** (setup seul vs global), comparables actifs réels + « à savoir dans cette zone ». |
| ⚖️ **Réglementations & partenaires** | Cadre légal vaudois réel (règle des 90 jours, enregistrement, taxe de séjour) avec sources officielles, et réseau de partenaires locaux. |
| 🌓 **UX** | Thème clair / sombre, responsive desktop / tablette / mobile. |

---

## 🧮 Score d'investissement AirValo (0–100)

Métrique composite orientée **investisseur**, calculée par annonce puis agrégée par commune. Six facteurs pondérés :

| Facteur | Poids | Mesure |
|---------|-------|--------|
| Revenu potentiel | 25 % | Rang percentile du revenu annuel réel (Inside Airbnb) |
| Taux d'occupation | 20 % | Jours occupés / 365 |
| Attractivité locale | 20 % | POI dans un rayon autour du bien (5 facteurs OSM) |
| Saturation du marché | 15 % | Densité locale (Airbnb / aire en ha) / taux d'occupation moyen (inversé) |
| Rendement immobilier | 10 % | Revenu Airbnb / prix au m² de la commune |
| Stabilité saisonnière | 10 % | Inverse de la variance mensuelle d'occupation |

> Les notes Airbnb (cleanliness, communication…) sont **volontairement exclues** du score : elles reflètent l'hôte actuel, pas le potentiel du lieu. Elles sont en revanche exploitées séparément dans l'**analyse de sentiment** (Expérience voyageurs).

### Attractivité locale — pondération (5 facteurs)
`emploi 25 % · sport 22 % · culture 20 % · transports 20 % · restauration 13 %`
Chaque bien reçoit son propre score selon les POI présents dans un **rayon de 1 500 m**, avec décroissance par distance. Les transports utilisent un rayon réduit (gare ≤ 1 000 m, tram ≤ 700 m, bus ≤ 400 m).

---

## 🏗️ Architecture

```
┌─────────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│  Sources publiques  │ ───▶ │  Pipeline Python     │ ───▶ │  Web app statique   │
│  (Airbnb, avis,     │      │  (process + score    │      │  (HTML/CSS/JS)      │
│   OSM, OFS, immo)   │      │   + sentiment)       │      │  (JSON statiques)   │
└─────────────────────┘      └──────────────────────┘      └─────────────────────┘
```

### Stack technique

| Couche        | Techno                                              |
|---------------|-----------------------------------------------------|
| Pipeline      | Python 3, pandas, NumPy, Shapely, requests (OSM Overpass) |
| Front-end     | HTML5, CSS3, JavaScript **vanilla** (ES6+) — aucun build |
| Cartographie  | [Leaflet.js](https://leafletjs.com/) v1.9 + OpenStreetMap |
| Graphiques    | [Chart.js](https://www.chartjs.org/) v4 (bar, line, radar, doughnut) |
| Données       | Fichiers JSON statiques |
| Hébergement   | Déploiement CI/CD Netlify (adresse : [https://projet-valorisation-donnees.netlify.app](https://projet-valorisation-donnees.netlify.app)) |

---

## 📂 Structure du dépôt

```
.
├── data_pipeline/              # Scripts Python de traitement
│   ├── process_airbnb.py       # Nettoyage des listings + enrichissement croisé
│   └── compute_attractivity.py # Scoring attractivité via POI OSM (par rayon)
│
├── webapp/                     # Application web statique
│   ├── index.html              # Structure sémantique (vues : aperçu, carte, analyse, simulateur, attractivité, règles, à propos)
│   ├── style.css               # Design system (palette corail) + thème sombre
│   ├── app.js                  # Routage, cartes, charts, simulateur, sentiment
│   └── data/                   # JSON produits par le pipeline
│       ├── vaud_listings.json        # 2 500 annonces (score, prix, revenu, sous-scores, NPA)
│       ├── vaud_neighborhoods.json   # 204 communes agrégées
│       ├── vaud_npa.json             # 228 zones par code postal
│       ├── vaud_attractivity.json    # Attractivité par district
│       ├── vaud_sentiment.json       # Avis voyageurs : thèmes, frictions, tonalité (167 communes)
│       ├── vaud_property_types.json  # 4 types de bien
│       ├── vaud_seasonal.json        # Saisonnalité (12 mois)
│       ├── attractivity_weights.json # Pondérations transparentes
│       └── geneva_*.json / zurich_*.json  # Villes de comparaison
│
├── OtherData/                  # Données brutes complémentaires (OFS, musées, hôtels, transports…)
└── README.md
```

---

## 🚀 Lancement en local

L'application est **100 % statique** — aucun build, aucune dépendance Node.

```bash
cd webapp
python -m http.server 8000
```

Puis ouvrir [http://localhost:8000](http://localhost:8000).

### Re-générer les JSON (optionnel)

```bash
cd data_pipeline
python process_airbnb.py        # listings, communes, NPA, saisonnalité
python compute_attractivity.py  # attractivité par rayon + agrégats district
```

---

## 📊 Sources de données (7)

| Source | Usage | Licence |
|--------|-------|---------|
| [Inside Airbnb](http://insideairbnb.com/) | Listings + calendriers (disponibilité 365 j) | CC BY 4.0 |
| Avis voyageurs Airbnb (reviews) | Analyse de sentiment : 71 644 commentaires, 167 communes | CC BY 4.0 |
| [OpenStreetMap](https://www.openstreetmap.org/) (Overpass) | ~11 000 POI : culture, sport, restauration, emploi, **transports** | ODbL |
| Atlas / Stat Vaud | Densité de population par commune (saturation) | OGD |
| Neho / Lookmove | Prix immobiliers au m² par commune (rendement) | — |
| Répertoire officiel des localités (swisstopo / AMTOVZ) | Rattachement de chaque bien à son NPA | OGD |
| GeoJSON cantonal | Découpage communes / districts (geo-matching) | OGD |

---

## 💬 Analyse de sentiment — méthodologie

Les **71 644 avis** sont analysés pour extraire, par commune et par type de bien :

- **Thèmes dominants** — part des avis mentionnant un sujet (confort, accueil, vue, localisation, propreté, transports…). *Un avis peut citer plusieurs thèmes — les % ne totalisent pas 100 %.*
- **Points à surveiller (frictions)** — part des avis où le thème est mentionné avec un signal négatif.
- **Tonalité globale** — positif 51,6 % · mixte 15,8 % · neutre 27,4 % · négatif 5,2 %.
- **Fiabilité** — graduée selon le volume d'avis de la commune.

> ⚠️ « Logements avec avis » = logements présents dans le fichier de commentaires, **et non** le nombre d'annonces actives. Les avis Airbnb étant structurellement très positifs, les **thèmes** et **frictions** sont plus actionnables que la tonalité brute.

---

## ⚖️ Cadre réglementaire (Canton de Vaud)

- **Règle des 90 jours** — louer > 90 jours/an dans un district en pénurie de logements exige une **autorisation de changement d'affectation** (commune, LDTR/LATC). Exemptés : Aigle, Broye-Vully, Jura-Nord-vaudois.
- **Enregistrement** — annonce obligatoire à la commune depuis le 1ᵉʳ juillet 2022 (LEAE) ; registre communal des loueurs.
- **Sous-location** — accord préalable écrit du bailleur obligatoire.
- **Taxe de séjour** — communale, **collectée automatiquement par Airbnb** depuis avril 2023 (accord UCV) ; 144 communes signataires au 1ᵉʳ février 2025.

Sources : [État de Vaud](https://www.vd.ch/territoire-et-construction/logement/hebergement-airbnb) · [Police cantonale du commerce](https://www.vd.ch/economie/police-cantonale-du-commerce/informations-relatives-aux-locations-de-type-airbnb) · [UCV](https://www.ucv.ch/thematiques/economie-et-finances/airbnb) · [Centre d'aide Airbnb](https://www.airbnb.com/help/article/3462).
*Informations indicatives (màj mai 2026) — vérifier auprès de la commune avant tout lancement.*

---

## 🎯 Notes de méthodologie & UX

- **Attractivité par rayon** — Agrégation pondérée des POI autour de chaque bien, normalisée [0–100], et non plus héritée de la moyenne du district.
- **Saturation du marché** — La saturation mesure l'offre par rapport à la demande locale. La formule de calcul est :
  $$\text{Saturation} = \frac{\text{Densité d'annonces (listings/ha)}}{\text{Taux d'occupation moyen}}$$
  où le taux d'occupation moyen correspond à $\text{jours occupés} / 365$. Ce score brut est ensuite inversé et normalisé par rapport au maximum observé :
  $$\text{Score} = 100 - \left(\frac{\text{Saturation}}{\text{Saturation}_{\max}} \times 100\right)$$
  Ainsi, une saturation faible donne un score proche de 100, synonyme d'opportunité pour l'investisseur.
- **Seuils et couleurs des scores** — Paliers de score unifiés sur la carte (cercles), les légendes et les fiches pour guider visuellement l'utilisateur :
  - **Limité** (0–30) : Gris (`#94a3b8`)
  - **Moyen** (30–50) : Jaune (`#fbbf24`)
  - **Bon** (50–70) : Sarcelle/Teal (`#00a699`)
  - **Excellent** (70–100) : Rouge corail (`#FF5A5F`)
- **Formatage des nombres (Norme Suisse)** — Surcharge globale de `Number.prototype.toLocaleString` pour imposer la simple quote comme séparateur des milliers (ex. `10'000`) et le point pour les décimales sur l'ensemble de l'application (chiffres d'affaires, prix/nuit, graphiques Chart.js).
- **Passerelle interactive vers la carte** — Lien direct depuis les fiches de biens et le simulateur ("Voir toutes les annonces comparables sur la carte") permettant de basculer instantanément sur l'onglet Carte, de filtrer les marqueurs Leaflet sur les comparables, de recentrer dynamiquement via `map.fitBounds()`, et d'afficher un bandeau de réinitialisation flottant.
- **Simulateur** — Comparaison à la cohorte d'annonces actives, avec **fallback progressif** (commune-strict → commune-loose → district-strict → district-loose → commune-any) pour garantir un résultat sur toute commune.
- **Fiabilité** — Les recommandations filtrent les communes à moins de 3 annonces ; les annonces inactives (0 jour d'occupation) sont exclues du calcul.
- **Transparence** — Pondérations exposées dans `attractivity_weights.json`.
