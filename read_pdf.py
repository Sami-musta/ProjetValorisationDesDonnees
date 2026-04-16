import pypdf
import sys

try:
    reader = pypdf.PdfReader(r'c:\Users\samim\Desktop\ProjetValorisationDesDonnees\04_ProjectValorisationDonnes.pdf')
    text = []
    for page in reader.pages:
        text.append(page.extract_text())
    
    with open(r'c:\Users\samim\Desktop\ProjetValorisationDesDonnees\pdf_content.txt', 'w', encoding='utf-8') as f:
        f.write('\n'.join(text))
    print("Successfully extracted PDF.")
except Exception as e:
    print(f"Error: {e}")
