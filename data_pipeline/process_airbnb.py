"""
AirValo — Data Pipeline v4
Processes Airbnb data for Canton de Vaud with enriched investment scoring.

Score composition (6 factors, investor-oriented):
  1. Revenue potential     (25%) — actual earnings from Airbnb data
  2. Occupancy rate        (20%) — demand effectiveness
  3. Attractivity          (20%) — cultural, sports, restaurants, employment POIs
  4. Market saturation     (15%) — Airbnb listings per 1000 inhabitants (inverted)
  5. Real estate yield     (10%) — revenue relative to property price (CHF/m²)
  6. Seasonal stability    (10%) — low variance = predictable income
"""

import pandas as pd
import gzip
import json
import os
import math
import numpy as np
import fitz  # pymupdf — for real estate PDF

# ───────────────────────────────────────────
# CONFIG
# ───────────────────────────────────────────
BASE_DIR = r'c:\Users\samim\Desktop\ProjetValorisationDesDonnees'
OTHER_DATA = os.path.join(BASE_DIR, 'OtherData')
VAUD_CFG = {'folder': 'VaudData', 'lat': 46.5197, 'lng': 6.6323, 'zoom': 10}
OUTPUT_DIR = os.path.join(BASE_DIR, 'webapp', 'data')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ───────────────────────────────────────────
# HELPERS
# ───────────────────────────────────────────
def clean_price(val):
    if pd.isna(val):
        return 0.0
    if isinstance(val, str):
        val = val.replace('$', '').replace(',', '')
    try:
        v = float(val)
        return min(v, 5000.0) if v > 0 else 0.0
    except:
        return 0.0

def safe_float(val, default=0.0):
    try:
        v = float(val)
        return v if not math.isnan(v) else default
    except:
        return default

# ───────────────────────────────────────────
# LOAD ENRICHMENT DATA
# ───────────────────────────────────────────
def load_attractivity_scores():
    """Load pre-computed attractivity scores per district."""
    attract_path = os.path.join(OUTPUT_DIR, 'vaud_attractivity.json')
    if not os.path.exists(attract_path):
        print("  Warning: vaud_attractivity.json not found — run compute_attractivity.py first")
        return None
    with open(attract_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return {d['district']: d for d in data}


def load_population_data():
    """Load population and surface area per commune from the density Excel (2025 sheet)."""
    path = os.path.join(OTHER_DATA, 'Densite-depuis-2012.xlsx')
    if not os.path.exists(path):
        print("  Warning: Densite-depuis-2012.xlsx not found")
        return {}

    df = pd.read_excel(path, sheet_name='2025', header=None)
    pop_map = {}
    for i in range(len(df)):
        code = df.iloc[i, 0]
        name = df.iloc[i, 1]
        pop = df.iloc[i, 2]
        surface = df.iloc[i, 3]  # in hectares

        # Only commune rows have a numeric code in column 0
        if pd.notna(code) and pd.notna(name) and pd.notna(pop):
            try:
                int(code)  # commune code is an int like 5401
                pop_map[str(name).strip()] = {
                    'population': int(pop),
                    'surface_ha': float(surface) if pd.notna(surface) else 0,
                }
            except (ValueError, TypeError):
                pass

    print(f"  Loaded population data for {len(pop_map)} communes")
    return pop_map


def load_real_estate_prices():
    """Load property prices per commune from the PDF."""
    path = os.path.join(OTHER_DATA, 'Prix_immobilier_par_commune__Vaud_(CHFm).pdf')
    if not os.path.exists(path):
        print("  Warning: Prix_immobilier PDF not found")
        return {}

    doc = fitz.open(path)
    price_map = {}
    for page in doc:
        text = page.get_text()
        for line in text.split('\n'):
            line = line.strip()
            if ',' not in line:
                continue
            parts = line.split(',')
            if len(parts) < 2:
                continue
            name = parts[0].strip()
            try:
                p_apt = int(parts[1]) if parts[1].strip() else None
                p_house = int(parts[2]) if len(parts) > 2 and parts[2].strip() else None
                if p_apt or p_house:
                    price_map[name] = {
                        'prix_m2_appart': p_apt,
                        'prix_m2_maison': p_house,
                    }
            except (ValueError, IndexError):
                pass
    doc.close()

    print(f"  Loaded real estate prices for {len(price_map)} communes")
    return price_map


def load_seasonal_variance(cal_path):
    """Compute seasonal stability score from calendar data.
    Returns a dict: listing_id -> stability_score (0-100, higher = more stable)."""
    try:
        with gzip.open(cal_path, 'rt', encoding='utf-8') as f:
            cal = pd.read_csv(f, low_memory=False)
        cal['date'] = pd.to_datetime(cal['date'])
        cal['month'] = cal['date'].dt.month
        cal['booked'] = cal['available'].apply(lambda x: 1 if str(x).strip().lower() == 'f' else 0)

        # Monthly occupancy rate per listing
        monthly = cal.groupby(['listing_id', 'month'])['booked'].mean().reset_index()
        monthly.columns = ['listing_id', 'month', 'occ_rate']

        # Variance of monthly occupancy per listing (lower = more stable)
        variance = monthly.groupby('listing_id')['occ_rate'].std().fillna(0)

        # Normalize: low variance = high score
        if variance.max() > 0:
            stability = (1 - (variance / variance.max())) * 100
        else:
            stability = pd.Series(50.0, index=variance.index)

        # Also compute global monthly seasonal data for charts
        global_monthly = cal.groupby('month').agg(
            avg_price=('price', lambda x: np.mean([clean_price(v) for v in x])),
            occupancy_rate=('booked', 'mean'),
        ).reset_index()

        return stability.to_dict(), global_monthly
    except Exception as e:
        print(f"  Warning: Could not process calendar: {e}")
        return {}, None


# ───────────────────────────────────────────
# COMMUNE NAME MATCHING
# ───────────────────────────────────────────
def normalize_commune_name(name):
    """Normalize commune names for matching across datasets.

    Strips ANY parenthetical qualifier like (VD), (Vaud), (Lavaux), (Payerne), etc.
    Lowercases for case-insensitive matching.
    """
    if pd.isna(name):
        return ''
    import re
    name = str(name).strip()
    # Strip any parenthetical qualifier
    name = re.sub(r'\s*\([^)]*\)\s*', '', name)
    # Normalize whitespace
    name = re.sub(r'\s+', ' ', name).strip()
    return name.lower()


_normalized_lookup_cache = {}


def match_commune(airbnb_name, lookup_map):
    """Try to match an Airbnb commune name against a lookup map via normalized keys."""
    if airbnb_name in lookup_map:
        return lookup_map[airbnb_name]

    # Build/cache normalized lookup for this map
    map_id = id(lookup_map)
    if map_id not in _normalized_lookup_cache:
        _normalized_lookup_cache[map_id] = {
            normalize_commune_name(k): v for k, v in lookup_map.items()
        }
    norm_map = _normalized_lookup_cache[map_id]

    normalized = normalize_commune_name(airbnb_name)
    return norm_map.get(normalized)


# ───────────────────────────────────────────
# INVESTMENT SCORE (0-100) — INVESTOR-ORIENTED
# ───────────────────────────────────────────
def compute_investment_scores(df, attractivity_map, pop_map, price_map, stability_map):
    """
    Composite score for investors (6 factors):
      1. Revenue potential     (25%) — percentile rank of annual revenue
      2. Occupancy rate        (20%) — days occupied / 365
      3. Attractivity          (20%) — cultural, sports, restaurant, employment POIs
      4. Market saturation     (15%) — Airbnb listings per 1000 inhabitants (inverted)
      5. Real estate yield     (10%) — revenue / prix_m2 (higher = better yield)
      6. Seasonal stability    (10%) — low monthly variance = predictable income
    """
    scores = pd.DataFrame(index=df.index)

    # 1. Revenue score (percentile-based)
    rev = df['estimated_revenue_l365d'].fillna(0)
    if rev.max() > 0:
        scores['rev_score'] = (rev.rank(pct=True) * 100).clip(0, 100)
    else:
        scores['rev_score'] = 0

    # 2. Occupancy score
    occ = df['estimated_occupancy_l365d'].fillna(0)
    if occ.max() > 0:
        scores['occ_score'] = (occ / 365 * 100).clip(0, 100)
    else:
        scores['occ_score'] = 0

    # 3. Attractivity score (from POI data, per district)
    nh_group_col = 'neighbourhood_group_cleansed' if 'neighbourhood_group_cleansed' in df.columns else 'neighbourhood_group'
    if attractivity_map and nh_group_col in df.columns:
        scores['attract_score'] = df[nh_group_col].map(
            {k: v['attractivity_score'] for k, v in attractivity_map.items()}
        ).fillna(0)
        df['cultural_score'] = df[nh_group_col].map(
            {k: v['cultural_score'] for k, v in attractivity_map.items()}
        ).fillna(0)
        df['sports_score'] = df[nh_group_col].map(
            {k: v['sports_score'] for k, v in attractivity_map.items()}
        ).fillna(0)
        df['restaurant_score'] = df[nh_group_col].map(
            {k: v['restaurant_score'] for k, v in attractivity_map.items()}
        ).fillna(0)
        df['employment_score'] = df[nh_group_col].map(
            {k: v['employment_score'] for k, v in attractivity_map.items()}
        ).fillna(0)
        print(f"  Attractivity scores applied (mean: {scores['attract_score'].mean():.1f})")
    else:
        scores['attract_score'] = 0

    # 4. Market saturation score (Airbnb listings per 1000 inhabitants, inverted)
    if pop_map:
        # Count listings per commune
        nh_counts = df['neighbourhood_cleansed'].value_counts()
        # Map commune -> population
        commune_pop = {}
        for commune in nh_counts.index:
            matched = match_commune(commune, pop_map)
            if matched:
                commune_pop[commune] = matched['population']

        # Saturation = listings per 1000 inhabitants
        saturation = {}
        for commune, count in nh_counts.items():
            pop = commune_pop.get(commune, None)
            if pop and pop > 0:
                saturation[commune] = (count / pop) * 1000
            else:
                saturation[commune] = None

        sat_series = df['neighbourhood_cleansed'].map(saturation)
        sat_median = sat_series.median()
        sat_series = sat_series.fillna(sat_median)

        if sat_series.max() > 0:
            # Inverse: lower saturation = higher score
            scores['saturation_score'] = (100 - (sat_series / sat_series.max() * 100)).clip(0, 100)
        else:
            scores['saturation_score'] = 50
        df['saturation_per_1000'] = sat_series
        print(f"  Saturation scores applied (mean: {scores['saturation_score'].mean():.1f})")
    else:
        scores['saturation_score'] = 50

    # 5. Real estate yield score (gross annual yield = revenue / property value)
    if price_map:
        # Map commune -> prix_m2 (use apartment price as reference)
        commune_prices = {}
        for commune in df['neighbourhood_cleansed'].unique():
            matched = match_commune(commune, price_map)
            if matched and matched['prix_m2_appart']:
                commune_prices[commune] = matched['prix_m2_appart']

        df['prix_m2'] = df['neighbourhood_cleansed'].map(commune_prices)

        # Fallback: district-level median for communes missing from the PDF
        nh_group_col_p = 'neighbourhood_group_cleansed' if 'neighbourhood_group_cleansed' in df.columns else 'neighbourhood_group'
        if nh_group_col_p in df.columns:
            district_median = df.groupby(nh_group_col_p)['prix_m2'].transform('median')
            df['prix_m2'] = df['prix_m2'].fillna(district_median)
        # Final fallback: canton-wide median
        df['prix_m2'] = df['prix_m2'].fillna(df['prix_m2'].median())

        matched_count = (df['neighbourhood_cleansed'].map(commune_prices).notna()).sum()
        print(f"  Prix m² matched directly: {matched_count}/{len(df)} "
              f"(rest via district median)")

        # Estimated surface in m² from accommodates (Inside Airbnb proxy)
        # Rule of thumb: ~15 m² per person + 10 m² common area
        df['surface_est'] = (15 * df['accommodates'].clip(lower=1) + 10)

        # Gross annual yield as a percentage
        df['property_value'] = df['prix_m2'] * df['surface_est']
        df['gross_yield_pct'] = (df['estimated_revenue_l365d'] / df['property_value'] * 100).replace(
            [float('inf'), float('-inf')], 0
        ).fillna(0)

        # Score: percentile rank on yield
        if df['gross_yield_pct'].max() > 0:
            scores['yield_score'] = (df['gross_yield_pct'].rank(pct=True) * 100).clip(0, 100)
        else:
            scores['yield_score'] = 50
        print(f"  Real estate yield scores applied "
              f"(median yield: {df['gross_yield_pct'].median():.2f}% gross, "
              f"score mean: {scores['yield_score'].mean():.1f})")
    else:
        scores['yield_score'] = 50

    # 6. Seasonal stability score
    if stability_map:
        df['stability_raw'] = df['id'].map(stability_map).fillna(50)
        scores['stability_score'] = df['stability_raw'].clip(0, 100)
        print(f"  Stability scores applied (mean: {scores['stability_score'].mean():.1f})")
    else:
        scores['stability_score'] = 50

    # ── Save sub-scores as columns ──
    df['rev_score'] = scores['rev_score']
    df['occ_score'] = scores['occ_score']
    df['attract_score'] = scores['attract_score']
    df['saturation_score'] = scores['saturation_score']
    df['yield_score'] = scores['yield_score']
    df['stability_score'] = scores['stability_score']

    # ── Weighted composite ──
    df['investment_score'] = (
        scores['rev_score'] * 0.25 +
        scores['occ_score'] * 0.20 +
        scores['attract_score'] * 0.20 +
        scores['saturation_score'] * 0.15 +
        scores['yield_score'] * 0.10 +
        scores['stability_score'] * 0.10
    ).round(1)

    return df


# ───────────────────────────────────────────
# PROCESS VAUD
# ───────────────────────────────────────────
def process_vaud():
    folder = os.path.join(BASE_DIR, VAUD_CFG['folder'])
    print(f"\n{'='*60}")
    print(f"Processing VAUD from {VAUD_CFG['folder']}...")
    print(f"{'='*60}")

    # ── 1. Read detailed listings ──
    gz_path = os.path.join(folder, 'listings.csv.gz')
    with gzip.open(gz_path, 'rt', encoding='utf-8') as f:
        df = pd.read_csv(f, low_memory=False)
    print(f"\n1. Loaded {len(df)} listings with {len(df.columns)} columns")

    # Clean core fields
    df['price_clean'] = df['price'].apply(clean_price)
    df['estimated_revenue_l365d'] = pd.to_numeric(df.get('estimated_revenue_l365d', 0), errors='coerce').fillna(0)
    df['estimated_occupancy_l365d'] = pd.to_numeric(df.get('estimated_occupancy_l365d', 0), errors='coerce').fillna(0)
    df['bedrooms'] = pd.to_numeric(df.get('bedrooms', 0), errors='coerce').fillna(0)
    df['accommodates'] = pd.to_numeric(df.get('accommodates', 1), errors='coerce').fillna(1)
    df['number_of_reviews'] = pd.to_numeric(df.get('number_of_reviews', 0), errors='coerce').fillna(0)
    df['latitude'] = pd.to_numeric(df.get('latitude', 0), errors='coerce')
    df['longitude'] = pd.to_numeric(df.get('longitude', 0), errors='coerce')

    # ── Filter: keep only listings with full financial data ──
    before = len(df)

    # Step 1: remove inactive (0 occupation)
    mask_active = df['estimated_occupancy_l365d'] > 0
    removed_inactive = (~mask_active).sum()

    # Step 2: remove missing price
    mask_price = df['price_clean'] > 0
    removed_price = (mask_active & ~mask_price).sum()

    # Step 3: remove missing revenue
    mask_rev = df['estimated_revenue_l365d'] > 0
    removed_rev = (mask_active & mask_price & ~mask_rev).sum()

    # Step 4: remove invalid coordinates (Vaud bbox)
    mask_geo = df['latitude'].between(46.0, 47.2) & df['longitude'].between(6.0, 7.3)
    removed_geo = (mask_active & mask_price & mask_rev & ~mask_geo).sum()

    # Step 5: remove listings with missing commune/district
    mask_nh = df['neighbourhood_cleansed'].notna() & (df['neighbourhood_cleansed'].astype(str).str.strip() != '')
    removed_nh = (mask_active & mask_price & mask_rev & mask_geo & ~mask_nh).sum()

    # Step 6: remove duplicates on id
    mask_dup = ~df['id'].duplicated()
    removed_dup = (mask_active & mask_price & mask_rev & mask_geo & mask_nh & ~mask_dup).sum()

    # Apply combined filter
    df = df[mask_active & mask_price & mask_rev & mask_geo & mask_nh & mask_dup].copy()

    print(f"2. Data quality filtering: {before} -> {len(df)}")
    print(f"   - removed inactive (occ=0):     {removed_inactive}")
    print(f"   - removed missing price:        {removed_price}")
    print(f"   - removed missing revenue:      {removed_rev}")
    print(f"   - removed invalid coords:       {removed_geo}")
    print(f"   - removed missing commune:      {removed_nh}")
    print(f"   - removed duplicate ids:        {removed_dup}")

    # Sanity checks on survivors
    assert (df['price_clean'] > 0).all(), "PRICE=0 leaked through filter"
    assert (df['estimated_revenue_l365d'] > 0).all(), "REVENUE=0 leaked through filter"
    assert (df['estimated_occupancy_l365d'] > 0).all(), "OCC=0 leaked through filter"
    assert df['latitude'].notna().all() and df['longitude'].notna().all(), "Invalid coords leaked"
    assert df['id'].is_unique, "Duplicate ids leaked"
    print(f"   [OK] Quality assertions passed on {len(df)} listings")

    # ── Load enrichment data ──
    print("\n3. Loading enrichment data...")
    attractivity_map = load_attractivity_scores()
    pop_map = load_population_data()
    price_map = load_real_estate_prices()

    # Seasonal stability
    cal_path = os.path.join(folder, 'calendar.csv.gz')
    print("  Computing seasonal stability...")
    stability_map, global_monthly = load_seasonal_variance(cal_path)
    print(f"  Stability data for {len(stability_map)} listings")

    # ── Compute Investment Score ──
    print("\n4. Computing investment scores...")
    df = compute_investment_scores(df, attractivity_map, pop_map, price_map, stability_map)
    print(f"  Investment Score: min={df['investment_score'].min()}, max={df['investment_score'].max()}, mean={df['investment_score'].mean():.1f}")

    # ── 5. Export listings JSON ──
    print("\n5. Exporting data...")
    sample_size = min(2500, len(df))  # More listings since we only process Vaud now
    sample = df.sample(sample_size, random_state=42) if len(df) > sample_size else df

    listings_json = []
    has_attractivity = 'cultural_score' in df.columns
    for _, r in sample.iterrows():
        listing = {
            'id': int(r['id']),
            'name': str(r.get('name', '')),
            'lat': float(r['latitude']),
            'lng': float(r['longitude']),
            'price': round(float(r['price_clean']), 0),
            'revenue': round(float(r['estimated_revenue_l365d']), 0),
            'occupancy': int(r['estimated_occupancy_l365d']),
            'score': float(r['investment_score']),
            'nh': str(r['neighbourhood_cleansed']),
            'district': str(r.get('neighbourhood_group_cleansed', r.get('neighbourhood_group', ''))),
            'type': str(r.get('room_type', 'N/A')),
            'bedrooms': int(r['bedrooms']),
            'accommodates': int(r['accommodates']),
        }
        if has_attractivity:
            listing['cultural'] = round(float(r.get('cultural_score', 0)), 1)
            listing['sports'] = round(float(r.get('sports_score', 0)), 1)
            listing['restaurant'] = round(float(r.get('restaurant_score', 0)), 1)
            listing['employment'] = round(float(r.get('employment_score', 0)), 1)
        if 'prix_m2' in r and pd.notna(r['prix_m2']):
            listing['prix_m2'] = round(float(r['prix_m2']), 0)
        if 'gross_yield_pct' in r and pd.notna(r['gross_yield_pct']):
            listing['yield_pct'] = round(float(r['gross_yield_pct']), 2)
        if 'saturation_per_1000' in r and pd.notna(r['saturation_per_1000']):
            listing['saturation'] = round(float(r['saturation_per_1000']), 2)
        listings_json.append(listing)

    with open(os.path.join(OUTPUT_DIR, 'vaud_listings.json'), 'w', encoding='utf-8') as f:
        json.dump(listings_json, f, ensure_ascii=False)
    print(f"  Exported {len(listings_json)} listings")

    # ── 6. Neighbourhood aggregation ──
    nh_agg = df.groupby('neighbourhood_cleansed').agg(
        count=('id', 'count'),
        avg_price=('price_clean', 'mean'),
        median_price=('price_clean', 'median'),
        avg_revenue=('estimated_revenue_l365d', 'mean'),
        total_revenue=('estimated_revenue_l365d', 'sum'),
        avg_occupancy=('estimated_occupancy_l365d', 'mean'),
        avg_score=('investment_score', 'mean'),
        avg_rev_score=('rev_score', 'mean'),
        avg_occ_score=('occ_score', 'mean'),
        avg_attract_score=('attract_score', 'mean'),
        avg_saturation_score=('saturation_score', 'mean'),
        avg_yield_score=('yield_score', 'mean'),
        avg_stability_score=('stability_score', 'mean'),
    ).reset_index()

    # Enrich with prix_m2 and population
    nh_agg['prix_m2'] = nh_agg['neighbourhood_cleansed'].apply(
        lambda c: match_commune(c, price_map).get('prix_m2_appart') if match_commune(c, price_map) else None
    )
    nh_agg['population'] = nh_agg['neighbourhood_cleansed'].apply(
        lambda c: match_commune(c, pop_map).get('population') if match_commune(c, pop_map) else None
    )
    nh_agg['saturation_per_1000'] = nh_agg.apply(
        lambda r: (r['count'] / r['population'] * 1000) if r['population'] and r['population'] > 0 else None, axis=1
    )

    nh_agg = nh_agg.sort_values('avg_score', ascending=False)

    nh_json = []
    for _, r in nh_agg.iterrows():
        entry = {
            'nh': r['neighbourhood_cleansed'],
            'count': int(r['count']),
            'avg_price': round(float(r['avg_price']), 0),
            'median_price': round(float(r['median_price']), 0),
            'avg_revenue': round(float(r['avg_revenue']), 0),
            'total_revenue': round(float(r['total_revenue']), 0),
            'avg_occupancy': round(float(r['avg_occupancy']), 0),
            'avg_score': round(float(r['avg_score']), 1),
            'avg_rev_score': round(float(r['avg_rev_score']), 1),
            'avg_occ_score': round(float(r['avg_occ_score']), 1),
            'avg_attract_score': round(float(r['avg_attract_score']), 1),
            'avg_saturation_score': round(float(r['avg_saturation_score']), 1),
            'avg_yield_score': round(float(r['avg_yield_score']), 1),
            'avg_stability_score': round(float(r['avg_stability_score']), 1),
        }
        if pd.notna(r.get('prix_m2')):
            entry['prix_m2'] = int(r['prix_m2'])
        if pd.notna(r.get('population')):
            entry['population'] = int(r['population'])
        if pd.notna(r.get('saturation_per_1000')):
            entry['saturation'] = round(float(r['saturation_per_1000']), 2)
        nh_json.append(entry)

    with open(os.path.join(OUTPUT_DIR, 'vaud_neighborhoods.json'), 'w', encoding='utf-8') as f:
        json.dump(nh_json, f, ensure_ascii=False)
    print(f"  Exported {len(nh_json)} neighborhoods")

    # ── 7. Property Type breakdown ──
    pt_agg = df.groupby('room_type').agg(
        count=('id', 'count'),
        avg_price=('price_clean', 'mean'),
        avg_revenue=('estimated_revenue_l365d', 'mean'),
        avg_occupancy=('estimated_occupancy_l365d', 'mean'),
        avg_score=('investment_score', 'mean'),
    ).reset_index()

    pt_json = []
    for _, r in pt_agg.iterrows():
        pt_json.append({
            'type': r['room_type'],
            'count': int(r['count']),
            'avg_price': round(float(r['avg_price']), 0),
            'avg_revenue': round(float(r['avg_revenue']), 0),
            'avg_occupancy': round(float(r['avg_occupancy']), 0),
            'avg_score': round(float(r['avg_score']), 1),
        })

    with open(os.path.join(OUTPUT_DIR, 'vaud_property_types.json'), 'w', encoding='utf-8') as f:
        json.dump(pt_json, f)
    print(f"  Exported {len(pt_json)} property types")

    # ── 8. Seasonal data for charts ──
    if global_monthly is not None:
        seasonal_json = []
        month_names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        for _, r in global_monthly.iterrows():
            seasonal_json.append({
                'month': month_names[int(r['month']) - 1],
                'month_num': int(r['month']),
                'avg_price': round(float(r['avg_price']), 0),
                'occupancy_rate': round(float(r['occupancy_rate']) * 100, 1),
            })
        with open(os.path.join(OUTPUT_DIR, 'vaud_seasonal.json'), 'w', encoding='utf-8') as f:
            json.dump(seasonal_json, f)
        print(f"  Exported seasonal data ({len(seasonal_json)} months)")

    # ── 9. Manifest (Vaud only) ──
    manifest = {
        "cities": ["vaud"],
        "city_meta": {
            "vaud": {"lat": VAUD_CFG['lat'], "lng": VAUD_CFG['lng'], "zoom": VAUD_CFG['zoom']}
        }
    }
    with open(os.path.join(OUTPUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    print(f"\n{'='*60}")
    print(f"DONE — {len(df)} active listings processed for Canton de Vaud")
    print(f"{'='*60}")


# ───────────────────────────────────────────
# MAIN
# ───────────────────────────────────────────
if __name__ == "__main__":
    process_vaud()
