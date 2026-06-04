"""
Compute per-neighbourhood monthly occupancy from the Airbnb calendar.

The Analysis view's "Tendances saisonnières" chart must react to the selected
quartier. The canton-wide seasonal file (vaud_seasonal.json) can't do that, so
here we aggregate calendar occupancy by (neighbourhood, month) and also keep an
"all" canton-wide series.

Output: webapp/data/vaud_seasonal_by_nh.json
{
  "all":      [{"month":"Jan","month_num":1,"occupancy_rate":51.4}, ... 12],
  "Lausanne": [...12...],
  ...
}
Only neighbourhoods with enough calendar coverage are kept (>= MIN_LISTINGS
distinct listings) so a single noisy listing can't define a whole curve.
"""
import gzip
import json
import os
import pandas as pd

HERE = os.path.dirname(__file__)
VAUD = os.path.join(HERE, '..', 'VaudData')
OUT = os.path.join(HERE, '..', 'webapp', 'data', 'vaud_seasonal_by_nh.json')

MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
MIN_LISTINGS = 3   # a neighbourhood needs at least this many listings to be reliable


def months_payload(series_by_month):
    """series_by_month: dict month_num(1..12) -> rate(0..100). Fill gaps with None→skip."""
    out = []
    for m in range(1, 13):
        if m in series_by_month:
            out.append({
                'month': MONTH_NAMES[m - 1],
                'month_num': m,
                'occupancy_rate': round(float(series_by_month[m]), 1),
            })
    return out


def main():
    cal_path = os.path.join(VAUD, 'calendar.csv.gz')
    listings_path = os.path.join(VAUD, 'listings.csv.gz')

    print('Loading calendar...')
    with gzip.open(cal_path, 'rt', encoding='utf-8') as f:
        cal = pd.read_csv(f, low_memory=False, usecols=['listing_id', 'date', 'available'])
    cal['month'] = pd.to_datetime(cal['date']).dt.month
    cal['booked'] = (cal['available'].astype(str).str.strip().str.lower() == 'f').astype(int)

    print('Loading listings -> neighbourhood map...')
    with gzip.open(listings_path, 'rt', encoding='utf-8') as f:
        listings = pd.read_csv(f, low_memory=False, usecols=[
            'id', 'neighbourhood_cleansed', 'estimated_occupancy_l365d',
            'price', 'estimated_revenue_l365d', 'latitude', 'longitude'
        ])

    # Filter active listings mirroring process_airbnb.py
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

    listings['price_clean'] = listings['price'].apply(clean_price)
    listings['estimated_revenue_l365d'] = pd.to_numeric(listings.get('estimated_revenue_l365d', 0), errors='coerce').fillna(0)
    listings['estimated_occupancy_l365d'] = pd.to_numeric(listings.get('estimated_occupancy_l365d', 0), errors='coerce').fillna(0)
    listings['latitude'] = pd.to_numeric(listings.get('latitude', 0), errors='coerce')
    listings['longitude'] = pd.to_numeric(listings.get('longitude', 0), errors='coerce')

    mask_active = (
        (listings['estimated_occupancy_l365d'] > 0) &
        (listings['price_clean'] > 0) &
        (listings['estimated_revenue_l365d'] > 0) &
        listings['latitude'].between(46.0, 47.2) &
        listings['longitude'].between(6.0, 7.3) &
        listings['neighbourhood_cleansed'].notna() &
        (listings['neighbourhood_cleansed'].astype(str).str.strip() != '')
    )
    active_listings = listings[mask_active].copy()
    print(f'  Active listings kept for seasonality: {len(active_listings)} / {len(listings)}')

    nh_map = dict(zip(active_listings['id'], active_listings['neighbourhood_cleansed']))

    cal['nh'] = cal['listing_id'].map(nh_map)
    cal = cal.dropna(subset=['nh'])

    result = {}

    # Canton-wide "all"
    g_all = cal.groupby('month')['booked'].mean() * 100
    result['all'] = months_payload(g_all.to_dict())

    # Per neighbourhood
    listings_per_nh = cal.groupby('nh')['listing_id'].nunique()
    grp = cal.groupby(['nh', 'month'])['booked'].mean() * 100

    kept = 0
    for nh in listings_per_nh.index:
        if listings_per_nh[nh] < MIN_LISTINGS:
            continue
        sub = grp.loc[nh]  # Series indexed by month
        result[nh] = months_payload(sub.to_dict())
        kept += 1

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False)

    print(f'Exported {OUT}')
    print(f'  neighbourhoods kept (>= {MIN_LISTINGS} listings): {kept}')
    print(f'  + canton-wide "all"')


if __name__ == '__main__':
    main()
