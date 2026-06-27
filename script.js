const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";
const OPENFDA_LABEL = "https://api.fda.gov/drug/label.json";

const form = document.querySelector("#medicine-form");
const medicineInput = document.querySelector("#medicine-input");
const ageInput = document.querySelector("#age-input");
const sexInput = document.querySelector("#sex-input");
const pregnancyInput = document.querySelector("#pregnancy-input");
const organInput = document.querySelector("#organ-input");
const conditionInput = document.querySelector("#condition-input");
const demoButton = document.querySelector("#demo-basic");
const clearButton = document.querySelector("#clear-all");
const riskCard = document.querySelector("#risk-card");
const findingList = document.querySelector("#finding-list");
const medicineGrid = document.querySelector("#medicine-grid");
const questionList = document.querySelector("#question-list");
const evidenceList = document.querySelector("#evidence-list");
const installButton = document.querySelector("#install-button");

let deferredInstallPrompt = null;

const labelSections = [
  { key: "boxed_warning", title: "Boxed warning", level: "high" },
  { key: "contraindications", title: "Contraindications", level: "high" },
  { key: "do_not_use", title: "Do not use", level: "high" },
  { key: "drug_interactions", title: "Drug interactions", level: "moderate" },
  { key: "warnings", title: "Warnings", level: "moderate" },
  { key: "warnings_and_cautions", title: "Warnings and cautions", level: "moderate" },
  { key: "ask_doctor", title: "Ask doctor", level: "moderate" },
  { key: "ask_doctor_or_pharmacist", title: "Ask doctor or pharmacist", level: "moderate" },
  { key: "pregnancy", title: "Pregnancy", level: "moderate", context: "pregnancy" },
  { key: "pregnancy_or_breast_feeding", title: "Pregnancy or breastfeeding", level: "moderate", context: "pregnancy" },
  { key: "nursing_mothers", title: "Nursing mothers", level: "moderate", context: "breastfeeding" },
  { key: "geriatric_use", title: "Geriatric use", level: "moderate", context: "geriatric" },
  { key: "pediatric_use", title: "Pediatric use", level: "moderate", context: "pediatric" },
  { key: "overdosage", title: "Overdosage", level: "low" },
];

const urgentKeywords = [
  "fatal",
  "life-threatening",
  "contraindicated",
  "major bleeding",
  "serious bleeding",
  "anaphylaxis",
  "respiratory depression",
  "suicidal",
  "severe liver",
  "renal failure",
  "birth defects",
];

demoButton.addEventListener("click", () => {
  medicineInput.value = "warfarin\naspirin\nibuprofen\nmetformin";
  ageInput.value = "67";
  sexInput.value = "female";
  pregnancyInput.value = "no";
  organInput.value = "yes";
  conditionInput.value = "kidney disease, stomach ulcer history";
});

clearButton.addEventListener("click", () => {
  form.reset();
  renderIdle();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const names = parseMedicineNames(medicineInput.value);

  if (!names.length) {
    renderReview({
      risk: "low",
      title: "No medicines entered",
      message: "Add at least one medicine name to begin the review.",
      medicines: [],
      findings: [finding("low", "No input", "Medicine list is empty.", "App")],
      questions: ["Which prescription, over-the-counter, herbal, and supplement products is the patient taking?"],
    });
    return;
  }

  renderLoading(names);

  const context = readContext();
  const medicines = await Promise.all(names.map((name) => analyzeMedicine(name)));
  const findings = buildFindings(medicines, context);
  const questions = buildQuestions(medicines, findings, context);
  const risk = scoreRisk(findings);

  renderReview({
    risk,
    title: risk === "high" ? "High-priority review" : risk === "moderate" ? "Clinician review advised" : "Evidence gathered",
    message: riskMessage(risk),
    medicines,
    findings: findings.length
      ? findings
      : [finding("low", "No major label signal extracted", "No boxed warning, contraindication, or context-specific label section was found in the retrieved records.", "openFDA")],
    questions,
  });
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.tab}-panel`).classList.add("active");
  });
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

function parseMedicineNames(value) {
  return [...new Set(value.split(/\n|,/).map((item) => item.trim()).filter(Boolean))];
}

function readContext() {
  return {
    age: ageInput.value ? Number(ageInput.value) : null,
    sex: sexInput.value,
    pregnancy: pregnancyInput.value,
    organ: organInput.value,
    conditions: conditionInput.value.trim(),
  };
}

async function analyzeMedicine(inputName) {
  const rxnorm = await resolveRxNorm(inputName);
  const label = await fetchBestLabel(inputName, rxnorm);
  return {
    inputName,
    rxnorm,
    label,
    displayName: label?.displayName || rxnorm?.displayName || inputName,
    substances: extractSubstances(label),
  };
}

async function resolveRxNorm(name) {
  try {
    const url = `${RXNAV_BASE}/approximateTerm.json?term=${encodeURIComponent(name)}&maxEntries=6`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const candidates = data.approximateGroup?.candidate || [];
    const best = candidates.find((item) => item.name) || candidates[0];
    if (!best?.rxcui) {
      return null;
    }
    const properties = await fetchRxProperties(best.rxcui);
    return {
      rxcui: best.rxcui,
      score: Number(best.score || 0),
      displayName: properties?.name || best.name || name,
      source: best.source || "RxNorm",
    };
  } catch (_error) {
    return null;
  }
}

async function fetchRxProperties(rxcui) {
  try {
    const response = await fetch(`${RXNAV_BASE}/rxcui/${encodeURIComponent(rxcui)}/properties.json`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.properties || null;
  } catch (_error) {
    return null;
  }
}

async function fetchBestLabel(inputName, rxnorm) {
  const terms = uniqueClean([
    inputName,
    rxnorm?.displayName,
    stripSalt(rxnorm?.displayName || ""),
    stripSalt(inputName),
  ]);

  const fieldAttempts = ["openfda.generic_name", "openfda.substance_name", "openfda.brand_name"];

  for (const term of terms) {
    for (const field of fieldAttempts) {
      const result = await fetchOpenFdaLabel(field, term);
      if (result) {
        return normalizeLabel(result, term, field);
      }
    }
  }

  return null;
}

async function fetchOpenFdaLabel(field, term) {
  try {
    const search = `${field}:"${term.replaceAll('"', "")}"`;
    const params = new URLSearchParams({
      search,
      limit: "1",
    });
    const response = await fetch(`${OPENFDA_LABEL}?${params.toString()}`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.results?.[0] || null;
  } catch (_error) {
    return null;
  }
}

function normalizeLabel(raw, matchedTerm, matchedField) {
  const openfda = raw.openfda || {};
  const displayName =
    first(openfda.generic_name) ||
    first(openfda.brand_name) ||
    first(openfda.substance_name) ||
    matchedTerm;

  return {
    raw,
    displayName: titleCase(displayName),
    matchedTerm,
    matchedField,
    manufacturer: first(openfda.manufacturer_name),
    productType: first(openfda.product_type),
    route: first(openfda.route),
    effectiveTime: raw.effective_time,
    sections: collectSections(raw),
  };
}

function collectSections(raw) {
  return labelSections
    .filter((section) => Array.isArray(raw[section.key]) && raw[section.key].length)
    .map((section) => ({
      ...section,
      text: cleanSnippet(raw[section.key].join(" ")),
      level: upgradeLevel(section.level, raw[section.key].join(" ")),
    }));
}

function buildFindings(medicines, context) {
  const findings = [];

  medicines.forEach((medicine) => {
    if (!medicine.rxnorm) {
      findings.push(
        finding(
          "moderate",
          `RxNorm could not normalize "${medicine.inputName}"`,
          "The name may be a local brand, misspelled, a supplement, or absent from the public RxNorm match result.",
          "RxNorm"
        )
      );
    }

    if (!medicine.label) {
      findings.push(
        finding(
          "moderate",
          `No openFDA label found for "${medicine.inputName}"`,
          "The app could not retrieve a public FDA label for this entry. A pharmacist should identify the active ingredient and local formulation.",
          "openFDA"
        )
      );
      return;
    }

    medicine.label.sections.forEach((section) => {
      if (!sectionApplies(section, context)) {
        return;
      }
      if (["boxed_warning", "contraindications", "do_not_use", "drug_interactions"].includes(section.key) || section.context) {
        findings.push(
          finding(
            section.level,
            `${medicine.displayName}: ${section.title}`,
            section.text,
            `openFDA ${section.title}`,
            medicine.displayName
          )
        );
      }
    });
  });

  findings.push(...buildDuplicateIngredientFindings(medicines));
  findings.push(...buildCrossMedicineFindings(medicines));
  findings.push(...buildContextCompletenessFindings(context));

  return dedupeFindings(findings);
}

function buildDuplicateIngredientFindings(medicines) {
  const map = new Map();
  medicines.forEach((medicine) => {
    medicine.substances.forEach((substance) => {
      const key = normalizeToken(substance);
      if (!key) {
        return;
      }
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(medicine.displayName);
    });
  });

  return [...map.entries()]
    .filter(([, names]) => new Set(names).size > 1)
    .map(([ingredient, names]) =>
      finding(
        "high",
        `Possible duplicate active ingredient: ${ingredient}`,
        `The retrieved labels list the same substance across: ${[...new Set(names)].join(", ")}.`,
        "openFDA active ingredient"
      )
    );
}

function buildCrossMedicineFindings(medicines) {
  const findings = [];
  const comparable = medicines.filter((medicine) => medicine.label);

  comparable.forEach((medicine) => {
    const interactionText = medicine.label.sections
      .filter((section) => ["drug_interactions", "warnings", "warnings_and_cautions"].includes(section.key))
      .map((section) => section.text.toLowerCase())
      .join(" ");

    if (!interactionText) {
      return;
    }

    comparable
      .filter((other) => other !== medicine)
      .forEach((other) => {
        const terms = uniqueClean([other.inputName, other.displayName, ...other.substances]).map((term) => term.toLowerCase());
        if (terms.some((term) => term.length > 3 && interactionText.includes(term))) {
          findings.push(
            finding(
              "moderate",
              `${medicine.displayName} label mentions ${other.displayName}`,
              `The retrieved interaction/warning text for ${medicine.displayName} appears to mention ${other.displayName}. Review the label section and timing/dose with a clinician.`,
              "openFDA cross-label scan",
              medicine.displayName
            )
          );
        }
      });
  });

  return findings;
}

function buildContextCompletenessFindings(context) {
  const findings = [];

  if (context.age === null) {
    findings.push(finding("low", "Age missing", "Age changes pediatric, geriatric, dosing, fall-risk, and monitoring interpretation.", "Patient context"));
  }
  if (!context.pregnancy) {
    findings.push(finding("low", "Pregnancy/breastfeeding context missing", "Label pregnancy and lactation sections cannot be interpreted without this context.", "Patient context"));
  }
  if (!context.organ) {
    findings.push(finding("low", "Kidney/liver context missing", "Renal or hepatic disease can change safety, dose, and monitoring decisions.", "Patient context"));
  }
  if (context.conditions) {
    findings.push(
      finding(
        "moderate",
        "Patient conditions/allergies supplied",
        `Review retrieved contraindications and warnings against: ${context.conditions}.`,
        "Patient context"
      )
    );
  }

  return findings;
}

function buildQuestions(medicines, findings, context) {
  const questions = [];
  const highFindings = findings.filter((item) => item.level === "high");
  const interactionFindings = findings.filter((item) => /interaction|cross-label/i.test(item.source) || /interaction/i.test(item.title));
  const contextFindings = findings.filter((item) => item.source === "Patient context");

  highFindings.slice(0, 4).forEach((item) => {
    questions.push(`For "${item.title}", does this warning apply to this patient's dose, indication, labs, and current symptoms?`);
  });

  interactionFindings.slice(0, 4).forEach((item) => {
    questions.push(`Can the pharmacist check timing, dose, and necessity for this interaction signal: ${item.title}?`);
  });

  medicines
    .filter((medicine) => medicine.label?.sections.some((section) => section.context === "pregnancy") && ["pregnant", "breastfeeding"].includes(context.pregnancy))
    .forEach((medicine) => {
      questions.push(`For ${medicine.displayName}, what does the pregnancy/lactation label section mean for this specific patient?`);
    });

  medicines
    .filter((medicine) => medicine.label?.sections.some((section) => section.context === "geriatric") && context.age >= 65)
    .forEach((medicine) => {
      questions.push(`For ${medicine.displayName}, does the geriatric-use section require dose adjustment, monitoring, or fall-risk review?`);
    });

  contextFindings.slice(0, 3).forEach((item) => {
    questions.push(`What missing information is needed to resolve this: ${item.title}?`);
  });

  medicines
    .filter((medicine) => !medicine.label || !medicine.rxnorm)
    .forEach((medicine) => {
      questions.push(`Can the pharmacist identify the exact active ingredient, strength, and formulation for "${medicine.inputName}"?`);
    });

  questions.push("Are there non-prescription painkillers, cold medicines, herbal products, or supplements not listed here?");

  return [...new Set(questions)].slice(0, 10);
}

function sectionApplies(section, context) {
  if (section.context === "pregnancy") {
    return ["pregnant", "breastfeeding"].includes(context.pregnancy);
  }
  if (section.context === "breastfeeding") {
    return context.pregnancy === "breastfeeding";
  }
  if (section.context === "geriatric") {
    return context.age !== null && context.age >= 65;
  }
  if (section.context === "pediatric") {
    return context.age !== null && context.age < 18;
  }
  return true;
}

function scoreRisk(findings) {
  if (findings.some((item) => item.level === "high")) {
    return "high";
  }
  if (findings.some((item) => item.level === "moderate")) {
    return "moderate";
  }
  return "low";
}

function riskMessage(risk) {
  if (risk === "high") {
    return "At least one retrieved label or context signal deserves prompt professional review.";
  }
  if (risk === "moderate") {
    return "The review found label sections or missing context worth discussing with a pharmacist or clinician.";
  }
  return "Evidence was retrieved, but absence of a major signal does not prove the medicine list is safe.";
}

function renderLoading(names) {
  riskCard.className = "risk-card";
  riskCard.innerHTML = `
    <span class="risk-kicker">Analyzing</span>
    <strong>Retrieving labels</strong>
    <p>Checking ${names.length} medicine${names.length === 1 ? "" : "s"} against RxNorm and openFDA public data.</p>
  `;
  findingList.innerHTML = loadingCard("Searching real public data...");
  medicineGrid.innerHTML = loadingCard("Resolving medicines...");
  evidenceList.innerHTML = loadingCard("Collecting label sections...");
  questionList.innerHTML = "<li>Questions will be generated from the evidence found.</li>";
}

function renderIdle() {
  riskCard.className = "risk-card";
  riskCard.innerHTML = `
    <span class="risk-kicker">Ready</span>
    <strong>Waiting for review</strong>
    <p>Enter medicines and run analysis to generate a real-data safety brief.</p>
  `;
  findingList.innerHTML = `
    <article class="finding neutral">
      <span>Idle</span>
      <strong>No review yet</strong>
      <p>The app will summarize label-derived warnings and context-specific concerns here.</p>
    </article>
  `;
  medicineGrid.innerHTML = `<article class="medicine-card empty">No medicines analyzed yet.</article>`;
  evidenceList.innerHTML = `<article class="evidence-card empty">Label snippets, sources, manufacturers, and dates will appear after analysis.</article>`;
  questionList.innerHTML = `<li>Run a review to generate patient-specific clinician questions.</li>`;
}

function renderReview({ risk, title, message, medicines, findings, questions }) {
  riskCard.className = `risk-card ${risk}`;
  riskCard.innerHTML = `
    <span class="risk-kicker">${risk} signal</span>
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(message)}</p>
  `;

  findingList.innerHTML = findings.map(renderFinding).join("");
  medicineGrid.innerHTML = medicines.length ? medicines.map(renderMedicine).join("") : `<article class="medicine-card empty">No medicines analyzed.</article>`;
  evidenceList.innerHTML = medicines.some((medicine) => medicine.label)
    ? medicines.flatMap(renderEvidence).join("")
    : `<article class="evidence-card empty">No label evidence was retrieved.</article>`;
  questionList.innerHTML = questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("");
}

function renderFinding(item) {
  return `
    <article class="finding ${item.level}">
      <span>${escapeHtml(item.source)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.message)}</p>
    </article>
  `;
}

function renderMedicine(medicine) {
  const level = medicine.label?.sections.some((section) => section.level === "high") ? "high" : medicine.label ? "moderate" : "low";
  const label = medicine.label;
  return `
    <article class="medicine-card ${level}">
      <span>${medicine.rxnorm ? "RxNorm matched" : "Manual review needed"}</span>
      <strong>${escapeHtml(medicine.displayName)}</strong>
      <p>${label ? "Public label retrieved from openFDA." : "No public FDA label was retrieved for this entry."}</p>
      <div class="meta-row">
        <em>Input: ${escapeHtml(medicine.inputName)}</em>
        ${medicine.rxnorm?.rxcui ? `<em>RxCUI: ${escapeHtml(medicine.rxnorm.rxcui)}</em>` : ""}
        ${label?.manufacturer ? `<em>${escapeHtml(label.manufacturer)}</em>` : ""}
        ${label?.route ? `<em>${escapeHtml(label.route)}</em>` : ""}
      </div>
    </article>
  `;
}

function renderEvidence(medicine) {
  if (!medicine.label) {
    return [];
  }
  const label = medicine.label;
  return label.sections.slice(0, 7).map(
    (section) => `
      <article class="evidence-card ${section.level}">
        <span>${escapeHtml(medicine.displayName)} | ${escapeHtml(section.title)}</span>
        <strong>${escapeHtml(label.manufacturer || "openFDA label")}</strong>
        <p>${escapeHtml(section.text)}</p>
        <div class="meta-row">
          <em>Matched by ${escapeHtml(label.matchedField)}</em>
          ${label.effectiveTime ? `<em>Effective ${escapeHtml(formatDate(label.effectiveTime))}</em>` : ""}
          ${label.productType ? `<em>${escapeHtml(label.productType)}</em>` : ""}
        </div>
      </article>
    `
  );
}

function loadingCard(message) {
  return `
    <article class="finding neutral">
      <span>Working</span>
      <strong>Please wait</strong>
      <p>${escapeHtml(message)}</p>
    </article>
  `;
}

function finding(level, title, message, source, medicine = "") {
  return { level, title, message: cleanSnippet(message, 360), source, medicine };
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.level}|${item.title}|${item.message.slice(0, 120)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractSubstances(label) {
  if (!label?.raw) {
    return [];
  }
  const openfda = label.raw.openfda || {};
  const values = [
    ...(openfda.substance_name || []),
    ...(openfda.generic_name || []),
    ...(label.raw.active_ingredient || []),
  ];
  return uniqueClean(values.map((value) => value.split(/[;,]/)[0]));
}

function upgradeLevel(level, text) {
  const lower = text.toLowerCase();
  if (urgentKeywords.some((keyword) => lower.includes(keyword))) {
    return "high";
  }
  return level;
}

function cleanSnippet(text, max = 420) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max).trim()}...`;
}

function first(value) {
  return Array.isArray(value) && value.length ? value[0] : "";
}

function uniqueClean(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function stripSalt(value) {
  return String(value)
    .replace(/\b(sodium|hydrochloride|hcl|potassium|calcium|maleate|succinate|tartrate|phosphate|sulfate)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(sodium|hydrochloride|hcl|potassium|calcium|tablet|capsule|solution)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
