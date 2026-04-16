import pandas as pd
import gzip
import json
import os

def inspect_data(city_path):
    print(f"--- Inspecting {city_path} ---")
    listings_path = os.path.join(city_path, 'listings.csv')
    try:
        df = pd.read_csv(listings_path)
        print(f"Listings shape: {df.shape}")
        print(f"Columns: {list(df.columns)}")
        # Check standard columns
        cols_to_check = ['id', 'neighbourhood', 'neighbourhood_cleansed', 'latitude', 'longitude', 'property_type', 'room_type', 'accommodates', 'price', 'availability_365', 'number_of_reviews_ltm', 'review_scores_rating']
        found_cols = [c for c in cols_to_check if c in df.columns]
        print(f"Found standard columns: {found_cols}")
        print(df[found_cols].head(3))
    except Exception as e:
        print(f"Error reading listings: {e}")

base_dir = r'c:\Users\samim\Desktop\ProjetValorisationDesDonnees'
cities = ['GenevaData', 'ZurichData', 'VaudData']

for city in cities:
    inspect_data(os.path.join(base_dir, city))
