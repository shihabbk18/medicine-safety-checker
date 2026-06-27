# MedSafe Lens

Medicine safety decision-support website for checking possible interaction signals, duplicate medicine entries, missing patient context, and pharmacist-ready questions.

## What it does

- Normalizes medicine names with the public NIH/NLM RxNorm API.
- Checks interaction signals with the public RxNav interaction API.
- Flags duplicate entries and high-monitoring medicine keywords.
- Adds context warnings for age, pregnancy, kidney/liver disease, and allergies.
- Produces plain-language findings and questions to ask a pharmacist or doctor.

## What it does not do

This project is not a medical device, diagnosis tool, prescribing tool, or replacement for clinical judgment. It should not be used to start, stop, or change medication without a qualified healthcare professional.

## Run locally

Because the app uses browser `fetch`, run it through a local static server:

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
- RxNav interaction API: https://rxnav.nlm.nih.gov/
- openFDA drug labeling API reference: https://open.fda.gov/apis/drug/label/

## Why no trained Kaggle model yet?

For drug safety, a small trained model from a random dataset can look impressive but be unsafe. This first version uses authoritative public medicine vocabularies and interaction records instead. A future research branch can add a trained classifier only after a validated, licensed dataset and clinician-reviewed evaluation plan are selected.
