import pandas as pd
import gzip
import os

base_dir = r'c:\Users\samim\Desktop\ProjetValorisationDesDonnees'

# Read the DETAILED listings (listings.csv.gz has WAY more columns)
print("=== DETAILED LISTINGS (listings.csv.gz) ===")
with gzip.open(os.path.join(base_dir, 'GenevaData', 'listings.csv.gz'), 'rt', encoding='utf-8') as f:
    df = pd.read_csv(f, low_memory=False)
print(f"Shape: {df.shape}")
print(f"\nALL COLUMNS ({len(df.columns)}):")
for col in df.columns:
    non_null = df[col].notna().sum()
    print(f"  {col}: {non_null}/{len(df)} non-null | sample: {df[col].dropna().iloc[0] if non_null > 0 else 'N/A'}")

print("\n=== CALENDAR DATA ===")
with gzip.open(os.path.join(base_dir, 'GenevaData', 'calendar.csv.gz'), 'rt', encoding='utf-8') as f:
    cal = pd.read_csv(f, nrows=20)
print(f"Columns: {list(cal.columns)}")
print(cal.head(10))

print("\n=== REVIEWS DATA ===")
rev = pd.read_csv(os.path.join(base_dir, 'GenevaData', 'reviews.csv'), nrows=10)
print(f"Columns: {list(rev.columns)}")
print(rev.head(5))

print("\n=== NEIGHBOURHOODS ===")
nh = pd.read_csv(os.path.join(base_dir, 'GenevaData', 'neighbourhoods.csv'))
print(nh)
