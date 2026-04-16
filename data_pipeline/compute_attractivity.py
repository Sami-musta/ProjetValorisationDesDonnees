"""
Compute attractivity scores per district in Canton de Vaud.

Four factors:
  1. Cultural offerings (museums, galleries, artwork, attractions, viewpoints, libraries)
  2. Sports & Leisure (sports centres, fitness, parks, playgrounds)
  3. Restaurants & F&B (restaurants, cafes, fast food, bars)
  4. Employment attractiveness (offices, conference centres, universities, coworking)

Each POI is geo-located and assigned to a district via the GeoJSON boundaries.
Scores are normalized per district and weighted to produce a final attractivity score.
"""

import pandas as pd
import numpy as np
import json
import os
from shapely.geometry import Point, shape

# ───────────────────────────────────────────
# CONFIG
# ───────────────────────────────────────────
BASE_DIR = r'C:\Users\samim\Desktop\ProjetValorisationDesDonnees'
OTHER_DATA = os.path.join(BASE_DIR, 'OtherData')
VAUD_DATA = os.path.join(BASE_DIR, 'VaudData')
OUTPUT_DIR = os.path.join(BASE_DIR, 'webapp', 'data')

# Weights for each factor (must sum to 1.0)
WEIGHTS = {
    'cultural':   0.25,   # Cultural offerings
    'sports':     0.30,   # Sports & leisure (high impact on overnight stays)
    'restaurant': 0.15,   # Restaurants (people eat but don't necessarily sleep)
    'employment': 0.30,   # Employment attractiveness (business travelers stay overnight)
}

# POI category definitions
CULTURAL_TOURISM = ['museum', 'gallery', 'artwork', 'attraction', 'viewpoint', 'theme_park', 'alpine_hut']
CULTURAL_AMENITY = ['library', 'music_school']

SPORTS_LEISURE = ['sports_centre', 'fitness_centre', 'water_park', 'trampoline_park', 'dance']
SPORTS_LEISURE_PARKS = ['park', 'playground', 'garden', 'dog_park']

RESTAURANT_AMENITY = ['restaurant', 'cafe', 'fast_food', 'bar']

EMPLOYMENT_OFFICE_TYPES = [
    'company', 'government', 'insurance', 'it', 'consulting',
    'estate_agent', 'association', 'ngo', 'architect', 'accountant',
    'lawyer', 'advertising_agency', 'travel_agent', 'foundation',
    'coworking', 'coworking_space', 'research', 'engineer',
    'financial_advisor', 'tax_advisor', 'notary', 'marketing',
    'employment_agency', 'educational_institution', 'administrative',
    'telecommunication', 'newspaper', 'energy_supplier', 'union',
    'yes',  # generic office
]
EMPLOYMENT_AMENITY = ['conference_centre', 'university']


# ───────────────────────────────────────────
# LOAD GEOJSON BOUNDARIES
# ───────────────────────────────────────────
def load_district_polygons(geojson_path):
    """Load GeoJSON and build district -> list of polygons mapping."""
    with open(geojson_path, 'r', encoding='utf-8') as f:
        geo = json.load(f)

    # Build a mapping: district_name -> list of shapely geometries (communes)
    districts = {}
    for feature in geo['features']:
        district = feature['properties']['neighbourhood_group']
        commune = feature['properties']['neighbourhood']
        geom = shape(feature['geometry'])
        if district not in districts:
            districts[district] = {'geom': [], 'communes': []}
        districts[district]['geom'].append(geom)
        districts[district]['communes'].append(commune)

    return districts


def assign_district(lat, lon, districts, _cache={}):
    """Assign a lat/lon point to a district using point-in-polygon."""
    key = (round(lat, 5), round(lon, 5))
    if key in _cache:
        return _cache[key]

    point = Point(lon, lat)  # shapely uses (x=lon, y=lat)
    for district_name, data in districts.items():
        for geom in data['geom']:
            if geom.contains(point):
                _cache[key] = district_name
                return district_name
    _cache[key] = None
    return None


# ───────────────────────────────────────────
# LOAD AND CATEGORIZE POIs
# ───────────────────────────────────────────
def load_pois():
    """Load POI data from the Excel files and categorize them."""
    excel_path = os.path.join(OTHER_DATA, 'AIrbnb complementary data Vaud.xlsx')

    # F&B and tourism POIs
    fb = pd.read_excel(excel_path, sheet_name='F&B and tourism')
    fb['@lat'] = pd.to_numeric(fb['@lat'], errors='coerce')
    fb['@lon'] = pd.to_numeric(fb['@lon'], errors='coerce')
    fb = fb.dropna(subset=['@lat', '@lon'])
    before_fb = len(fb)
    if '@id' in fb.columns:
        fb = fb.drop_duplicates(subset=['@id'])
    fb = fb.drop_duplicates(subset=['@lat', '@lon', 'amenity', 'tourism'])
    print(f"  FB sheet: {before_fb} -> {len(fb)} (after dedup)")

    # Transport and other POIs
    tr = pd.read_excel(excel_path, sheet_name='Tansport and other')
    tr['@lat'] = pd.to_numeric(tr['@lat'], errors='coerce')
    tr['@lon'] = pd.to_numeric(tr['@lon'], errors='coerce')
    tr = tr.dropna(subset=['@lat', '@lon'])
    before_tr = len(tr)
    if '@id' in tr.columns:
        tr = tr.drop_duplicates(subset=['@id'])
    tr = tr.drop_duplicates(subset=['@lat', '@lon', 'amenity', 'leisure', 'office'])
    print(f"  TR sheet: {before_tr} -> {len(tr)} (after dedup)")

    # Cross-sheet dedup: if same @id appears in both, keep only FB version
    if '@id' in fb.columns and '@id' in tr.columns:
        fb_ids = set(fb['@id'].dropna())
        before_overlap = len(tr)
        tr = tr[~tr['@id'].isin(fb_ids)]
        print(f"  Cross-sheet overlap removed: {before_overlap - len(tr)}")

    pois = []

    # --- Cultural ---
    # From tourism sheet: museums, galleries, etc.
    cultural_tourism = fb[fb['tourism'].isin(CULTURAL_TOURISM)]
    for _, r in cultural_tourism.iterrows():
        pois.append({'lat': r['@lat'], 'lon': r['@lon'], 'category': 'cultural',
                     'type': r['tourism'], 'name': r.get('name', '')})

    # From transport sheet: libraries, music schools
    cultural_amenity = tr[tr['amenity'].isin(CULTURAL_AMENITY)]
    for _, r in cultural_amenity.iterrows():
        pois.append({'lat': r['@lat'], 'lon': r['@lon'], 'category': 'cultural',
                     'type': r['amenity'], 'name': r.get('name', '')})

    # --- Sports & Leisure ---
    # From transport sheet: sports centres, fitness centres
    sports_leisure = tr[tr['leisure'].isin(SPORTS_LEISURE)]
    for _, r in sports_leisure.iterrows():
        pois.append({'lat': r['@lat'], 'lon': r['@lon'], 'category': 'sports',
                     'type': r['leisure'], 'name': r.get('name', '')})

    # Parks and playgrounds (weighted lower - count as 0.5 each)
    sports_parks = tr[tr['leisure'].isin(SPORTS_LEISURE_PARKS)]
    for _, r in sports_parks.iterrows():
        pois.append({'lat': r['@lat'], 'lon': r['@lon'], 'category': 'sports',
                     'type': r['leisure'], 'name': r.get('name', ''), 'weight': 0.5})

    # --- Restaurants ---
    restaurants = fb[fb['amenity'].isin(RESTAURANT_AMENITY)]
    for _, r in restaurants.iterrows():
        pois.append({'lat': r['@lat'], 'lon': r['@lon'], 'category': 'restaurant',
                     'type': r['amenity'], 'name': r.get('name', '')})

    # --- Employment ---
    # Offices
    offices = tr[tr['office'].isin(EMPLOYMENT_OFFICE_TYPES)]
    for _, r in offices.iterrows():
        pois.append({'lat': r['@lat'], 'lon': r['@lon'], 'category': 'employment',
                     'type': f"office:{r['office']}", 'name': r.get('name', '')})

    # Conference centres and universities
    emp_amenity = tr[tr['amenity'].isin(EMPLOYMENT_AMENITY)]
    for _, r in emp_amenity.iterrows():
        pois.append({'lat': r['@lat'], 'lon': r['@lon'], 'category': 'employment',
                     'type': r['amenity'], 'name': r.get('name', '')})

    print(f"  Total POIs loaded: {len(pois)}")
    poi_df = pd.DataFrame(pois)
    if 'weight' not in poi_df.columns:
        poi_df['weight'] = 1.0
    poi_df['weight'] = poi_df['weight'].fillna(1.0)

    for cat in ['cultural', 'sports', 'restaurant', 'employment']:
        count = len(poi_df[poi_df['category'] == cat])
        print(f"    {cat}: {count} POIs")

    return poi_df


# ───────────────────────────────────────────
# COMPUTE DISTRICT SCORES
# ───────────────────────────────────────────
def compute_district_scores(poi_df, districts):
    """Assign POIs to districts and compute weighted scores."""

    print("\n  Assigning POIs to districts...")
    poi_df['district'] = poi_df.apply(
        lambda r: assign_district(r['lat'], r['lon'], districts), axis=1
    )

    assigned = poi_df['district'].notna().sum()
    print(f"  Assigned: {assigned}/{len(poi_df)} POIs ({assigned/len(poi_df)*100:.1f}%)")

    # Filter to assigned POIs only
    poi_assigned = poi_df[poi_df['district'].notna()].copy()

    # Count weighted POIs per district per category
    district_scores = {}
    for district_name in districts.keys():
        d_pois = poi_assigned[poi_assigned['district'] == district_name]
        scores = {}
        for cat in ['cultural', 'sports', 'restaurant', 'employment']:
            cat_pois = d_pois[d_pois['category'] == cat]
            scores[cat] = cat_pois['weight'].sum()
        # Also count number of communes and total POIs for context
        scores['total_pois'] = len(d_pois)
        scores['n_communes'] = len(districts[district_name]['communes'])
        district_scores[district_name] = scores

    scores_df = pd.DataFrame(district_scores).T
    scores_df.index.name = 'district'

    # Log-scaled min-max normalization on absolute counts.
    # Rationale: raw density (POIs per commune) strongly penalises rural districts
    # that have many small communes. Log-scaling on absolute counts compresses
    # outliers (Lausanne) without zeroing out everyone else, while still ranking
    # fairly by what matters to an investor: "how many POIs in this district?".
    for cat in ['cultural', 'sports', 'restaurant', 'employment']:
        col = np.log1p(scores_df[cat].astype(float))
        if col.max() > col.min():
            scores_df[f'{cat}_score'] = ((col - col.min()) / (col.max() - col.min()) * 100).round(1)
        else:
            scores_df[f'{cat}_score'] = 50.0

    # Keep density for display/debug
    for cat in ['cultural', 'sports', 'restaurant', 'employment']:
        scores_df[f'{cat}_density'] = (scores_df[cat] / scores_df['n_communes']).round(2)

    # Final attractivity score — weighted combination of per-category log-scores
    scores_df['attractivity_score'] = (
        scores_df['cultural_score'] * WEIGHTS['cultural'] +
        scores_df['sports_score'] * WEIGHTS['sports'] +
        scores_df['restaurant_score'] * WEIGHTS['restaurant'] +
        scores_df['employment_score'] * WEIGHTS['employment']
    ).round(1)

    return scores_df, poi_assigned


# ───────────────────────────────────────────
# GENERATE OUTPUT
# ───────────────────────────────────────────
def generate_output(scores_df, poi_assigned, districts):
    """Generate JSON files for the webapp."""

    # District attractivity scores
    district_attractivity = []
    for district_name, row in scores_df.iterrows():
        district_attractivity.append({
            'district': district_name,
            'n_communes': int(row['n_communes']),
            'cultural_count': int(row['cultural']),
            'sports_count': int(row['sports']),
            'restaurant_count': int(row['restaurant']),
            'employment_count': int(row['employment']),
            'total_pois': int(row['total_pois']),
            'cultural_score': float(row['cultural_score']),
            'sports_score': float(row['sports_score']),
            'restaurant_score': float(row['restaurant_score']),
            'employment_score': float(row['employment_score']),
            'attractivity_score': float(row['attractivity_score']),
        })

    # Sort by attractivity score descending
    district_attractivity.sort(key=lambda x: x['attractivity_score'], reverse=True)

    output_path = os.path.join(OUTPUT_DIR, 'vaud_attractivity.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(district_attractivity, f, indent=2, ensure_ascii=False)
    print(f"\n  Exported district attractivity to {output_path}")

    # POI points for map visualization (sampled for performance)
    poi_points = []
    for _, r in poi_assigned.iterrows():
        poi_points.append({
            'lat': round(float(r['lat']), 5),
            'lon': round(float(r['lon']), 5),
            'cat': r['category'],
            'type': str(r['type']),
            'name': str(r.get('name', ''))[:50],
            'district': r['district'],
        })

    poi_path = os.path.join(OUTPUT_DIR, 'vaud_pois.json')
    with open(poi_path, 'w', encoding='utf-8') as f:
        json.dump(poi_points, f, ensure_ascii=False)
    print(f"  Exported {len(poi_points)} POI points to {poi_path}")

    # Weights config for the webapp
    weights_path = os.path.join(OUTPUT_DIR, 'attractivity_weights.json')
    with open(weights_path, 'w', encoding='utf-8') as f:
        json.dump({
            'weights': WEIGHTS,
            'categories': {
                'cultural': {
                    'label': 'Offres culturelles',
                    'description': 'Musées, galeries, attractions, points de vue, bibliothèques',
                    'color': '#9b59b6',
                    'icon': '🎭'
                },
                'sports': {
                    'label': 'Sports & Loisirs',
                    'description': 'Centres sportifs, fitness, parcs, aires de jeux',
                    'color': '#27ae60',
                    'icon': '⚽'
                },
                'restaurant': {
                    'label': 'Restauration',
                    'description': 'Restaurants, cafés, bars, fast-food',
                    'color': '#e67e22',
                    'icon': '🍽️'
                },
                'employment': {
                    'label': 'Attractivité emploi',
                    'description': 'Bureaux, centres de conférence, universités, coworking',
                    'color': '#3498db',
                    'icon': '💼'
                },
            }
        }, f, indent=2, ensure_ascii=False)
    print(f"  Exported weights config to {weights_path}")

    return district_attractivity


# ───────────────────────────────────────────
# MAIN
# ───────────────────────────────────────────
def main():
    print("=" * 60)
    print("COMPUTING ATTRACTIVITY SCORES FOR CANTON DE VAUD")
    print("=" * 60)

    # 1. Load district boundaries
    print("\n1. Loading district boundaries...")
    geojson_path = os.path.join(VAUD_DATA, 'neighbourhoods.geojson')
    districts = load_district_polygons(geojson_path)
    print(f"   Loaded {len(districts)} districts with {sum(len(d['communes']) for d in districts.values())} communes")

    # 2. Load and categorize POIs
    print("\n2. Loading and categorizing POIs...")
    poi_df = load_pois()

    # 3. Compute district scores
    print("\n3. Computing district scores...")
    scores_df, poi_assigned = compute_district_scores(poi_df, districts)

    # 4. Display results
    print("\n" + "=" * 60)
    print("ATTRACTIVITY SCORES BY DISTRICT")
    print("=" * 60)
    display_cols = ['cultural', 'sports', 'restaurant', 'employment',
                    'cultural_score', 'sports_score',
                    'restaurant_score', 'employment_score',
                    'attractivity_score']
    print(scores_df[display_cols].sort_values('attractivity_score', ascending=False).to_string())

    # 5. Generate output files
    print("\n\n4. Generating output files...")
    district_attractivity = generate_output(scores_df, poi_assigned, districts)

    print("\n" + "=" * 60)
    print("RANKING FINAL")
    print("=" * 60)
    for i, d in enumerate(district_attractivity, 1):
        print(f"  {i}. {d['district']:25s} -> Score: {d['attractivity_score']:5.1f}/100")
        print(f"     Culture: {d['cultural_score']:.0f} | Sport: {d['sports_score']:.0f} | "
              f"Resto: {d['restaurant_score']:.0f} | Emploi: {d['employment_score']:.0f}")

    return district_attractivity


if __name__ == "__main__":
    main()
