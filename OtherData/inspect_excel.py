import pandas as pd
import os
import sys

DATA_DIR = r"C:\Users\samim\Desktop\ProjetValorisationDesDonnees\OtherData"
OUTPUT_FILE = os.path.join(DATA_DIR, "inspect_all.txt")

# Discover all .xlsx files automatically to avoid encoding issues with hardcoded names
files = sorted([f for f in os.listdir(DATA_DIR) if f.endswith('.xlsx')])

with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
    out.write(f"Total .xlsx files found: {len(files)}\n\n")

    for idx, fname in enumerate(files, 1):
        fpath = os.path.join(DATA_DIR, fname)
        out.write("=" * 100 + "\n")
        out.write(f"FILE {idx}: {fname}\n")
        out.write("=" * 100 + "\n\n")

        try:
            xls = pd.ExcelFile(fpath)
            sheet_names = xls.sheet_names
            out.write(f"  Sheet names: {sheet_names}\n")
            out.write(f"  Number of sheets: {len(sheet_names)}\n\n")

            for sheet in sheet_names:
                out.write("-" * 80 + "\n")
                out.write(f"  SHEET: '{sheet}'\n")
                out.write("-" * 80 + "\n")

                df = pd.read_excel(xls, sheet_name=sheet)
                out.write(f"  Shape: {df.shape}  (rows x columns)\n")
                out.write(f"  Columns ({len(df.columns)}): {list(df.columns)}\n")
                out.write(f"  Dtypes:\n")
                for col, dtype in df.dtypes.items():
                    out.write(f"    {col}: {dtype}\n")
                out.write(f"\n  First 5 rows:\n")
                # Use tabulate-style display with pd options
                pd.set_option('display.max_columns', None)
                pd.set_option('display.width', 200)
                pd.set_option('display.max_colwidth', 60)
                out.write(df.head(5).to_string(index=True))
                out.write("\n\n")

        except Exception as e:
            out.write(f"  *** ERROR reading file: {e} ***\n\n")

    out.write("=" * 100 + "\n")
    out.write("INSPECTION COMPLETE\n")
    out.write("=" * 100 + "\n")

sys.stdout.reconfigure(encoding='utf-8')
print(f"Done. Output written to {OUTPUT_FILE}")
print(f"Files processed: {len(files)}")
for f in files:
    print(f"  - {f}")
