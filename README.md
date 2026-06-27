# MedSafe Lens

MedSafe Lens is a real-data medicine safety review assistant. It helps patients, pharmacists, and clinicians organize a medicine list into a traceable review brief using public medicine data.

## What changed in v2

- Rebuilt the interface into a product-style PWA shell.
- Removed canned repeated advice and demo-only rule behavior.
- Uses live public APIs first:
  - NIH/NLM RxNorm for medicine name normalization.
  - openFDA drug labels for boxed warnings, contraindications, interactions, pregnancy, pediatric, geriatric, and warning sections.
- Generates medicine-specific findings from retrieved label sections.
- Generates dynamic questions based on the exact warnings and patient context.
- Adds PWA support through `manifest.webmanifest` and `sw.js`, so the project can later be wrapped with Capacitor for Android/iOS.

## What it does

- Accepts multiple medicines, one per line.
- Captures patient context: age, sex, pregnancy/breastfeeding, kidney/liver disease, conditions, and allergies.
- Normalizes names with RxNorm when the API is available.
- Searches openFDA labels by generic name, substance name, and brand name.
- Extracts evidence from real label sections.
- Flags high-priority review signals such as boxed warnings, contraindications, and relevant pregnancy/geriatric/pediatric sections.
- Builds evidence cards with manufacturer, route, product type, match field, and label effective date when available.

## What it does not do

This is not a medical device, diagnosis tool, prescribing tool, or replacement for clinical judgment. It should not be used to start, stop, or change medication without a qualified healthcare professional.

## Run locally

```powershell
cd "C:\Users\NuRuL AzAm\Documents\SHIHAB\medicine-safety-checker"
py -m http.server 5174 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5174/
```

## Data sources

- RxNorm API: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html
- openFDA drug label API: https://open.fda.gov/apis/drug/label/
- openFDA searchable fields: https://open.fda.gov/apis/drug/label/searchable-fields/

## Android/iOS path

This project is currently a static PWA. For a native app wrapper:

1. Keep the web app as the shared UI.
2. Add Capacitor.
3. Build Android/iOS shells from the same app.
4. Add secure backend proxying if API quotas, privacy, or audit logging become important.

## Future research path

A trained model can be added only after selecting a validated, licensed clinical dataset and defining a clinician-reviewed evaluation plan. For medication safety, a random Kaggle model would create false confidence, so this version uses traceable public label evidence instead.
