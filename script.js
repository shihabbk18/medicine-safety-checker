const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";

const medicineForm = document.querySelector("#medicine-form");
const medicineInput = document.querySelector("#medicine-input");
const ageInput = document.querySelector("#age-input");
const pregnancyInput = document.querySelector("#pregnancy-input");
const organInput = document.querySelector("#organ-input");
const allergyInput = document.querySelector("#allergy-input");
const recognizedList = document.querySelector("#recognized-list");
const findingList = document.querySelector("#finding-list");
const questionList = document.querySelector("#question-list");
const riskMeter = document.querySelector("#risk-meter");
const demoButton = document.querySelector("#load-demo");

const highRiskTerms = [
  "warfarin",
  "heparin",
  "insulin",
  "digoxin",
  "lithium",
  "methotrexate",
  "phenytoin",
  "clozapine",
  "amiodarone",
];

const localMedicineIndex = {
  warfarin: { display: "warfarin", rxcui: "11289" },
  aspirin: { display: "aspirin", rxcui: "1191" },
  ibuprofen: { display: "ibuprofen", rxcui: "5640" },
  naproxen: { display: "naproxen", rxcui: "7258" },
  metformin: { display: "metformin", rxcui: "6809" },
  insulin: { display: "insulin", rxcui: "5856" },
  lisinopril: { display: "lisinopril", rxcui: "29046" },
  losartan: { display: "losartan", rxcui: "52175" },
  atorvastatin: { display: "atorvastatin", rxcui: "83367" },
  amlodipine: { display: "amlodipine", rxcui: "17767" },
  omeprazole: { display: "omeprazole", rxcui: "7646" },
  paracetamol: { display: "acetaminophen / paracetamol", rxcui: "161" },
  acetaminophen: { display: "acetaminophen / paracetamol", rxcui: "161" },
  clopidogrel: { display: "clopidogrel", rxcui: "32968" },
  rivaroxaban: { display: "rivaroxaban", rxcui: "1114195" },
  apixaban: { display: "apixaban", rxcui: "1364430" },
  digoxin: { display: "digoxin", rxcui: "3407" },
  lithium: { display: "lithium", rxcui: "6448" },
  methotrexate: { display: "methotrexate", rxcui: "6851" },
};

const bleedingTerms = ["warfarin", "aspirin", "ibuprofen", "naproxen", "clopidogrel", "rivaroxaban", "apixaban"];
const kidneyCautionTerms = ["ibuprofen", "naproxen", "diclofenac", "metformin", "lisinopril", "losartan"];
const pregnancyCautionTerms = ["warfarin", "isotretinoin", "methotrexate", "valproate", "ibuprofen", "lisinopril", "losartan"];

const curatedInteractionRules = [
  {
    terms: ["warfarin", "aspirin"],
    level: "high",
    title: "Warfarin + aspirin bleeding risk",
    message:
      "This combination can increase bleeding risk and should be reviewed by a clinician, especially without a clear indication and monitoring plan.",
  },
  {
    terms: ["warfarin", "ibuprofen"],
    level: "high",
    title: "Warfarin + ibuprofen bleeding risk",
    message:
      "NSAIDs such as ibuprofen can raise bleeding risk when combined with warfarin. Ask a clinician or pharmacist before combining.",
  },
  {
    terms: ["aspirin", "ibuprofen"],
    level: "moderate",
    title: "Aspirin + ibuprofen caution",
    message:
      "Combining aspirin with ibuprofen can increase stomach bleeding risk and may affect aspirin's antiplatelet effect depending on timing.",
  },
  {
    terms: ["lisinopril", "ibuprofen"],
    level: "moderate",
    title: "ACE inhibitor + NSAID kidney caution",
    message:
      "NSAIDs such as ibuprofen can worsen kidney function in some people taking ACE inhibitors, especially with dehydration or kidney disease.",
  },
  {
    terms: ["metformin", "kidney"],
    level: "moderate",
    title: "Metformin kidney-function review",
    message:
      "Metformin safety depends on kidney function. A clinician may need to review recent kidney labs before use or dose changes.",
  },
];

demoButton.addEventListener("click", () => {
  medicineInput.value = "warfarin\naspirin\nibuprofen\nmetformin";
  ageInput.value = "66";
  pregnancyInput.value = "";
  organInput.value = "yes";
  allergyInput.value = "";
});

medicineForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const names = parseMedicineInput(medicineInput.value);

  if (!names.length) {
    renderState({
      risk: "low",
      title: "No medicines entered",
      message: "Add at least one medicine name to begin.",
      recognized: [],
      findings: [makeFinding("neutral", "No input", "Enter medicines one per line.")],
      questions: ["What prescription, over-the-counter, and supplement products is the patient taking?"],
    });
    return;
  }

  setLoading();

  try {
    const recognized = await Promise.all(names.map(resolveMedicine));
    const validRxcuis = recognized.filter((item) => item.rxcui).map((item) => item.rxcui);
    const interactions = validRxcuis.length > 1 ? await fetchInteractions(validRxcuis) : [];
    const findings = buildFindings(names, recognized, interactions);
    const contextFindings = buildContextFindings(names);
    const allFindings = [...findings, ...contextFindings];
    const risk = scoreRisk(allFindings);

    renderState({
      risk,
      title: risk === "high" ? "High caution" : risk === "moderate" ? "Needs review" : "No major signal found",
      message: riskMessage(risk),
      recognized,
      findings: allFindings.length
        ? allFindings
        : [makeFinding("low", "No major signals found", "No interaction or duplicate signal was found from the available data.")],
      questions: buildQuestions(names, allFindings),
    });
  } catch (error) {
    renderState({
      risk: "moderate",
      title: "Could not complete live check",
      message: "The public medicine API may be offline, blocked, or unavailable from this browser.",
      recognized: [],
      findings: [
        makeFinding(
          "moderate",
          "Live data unavailable",
          "Try again with internet access. Do not assume the combination is safe just because the checker could not connect."
        ),
      ],
      questions: ["Can a pharmacist review this full medicine list directly?"],
    });
  }
});

function parseMedicineInput(value) {
  return [...new Set(value.split(/\n|,/).map((item) => item.trim()).filter(Boolean))];
}

async function resolveMedicine(name) {
  const local = localMedicineIndex[name.toLowerCase()];

  try {
    const url = `${RXNAV_BASE}/approximateTerm.json?term=${encodeURIComponent(name)}&maxEntries=1`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`RxNorm lookup failed for ${name}`);
    }
    const data = await response.json();
    const candidate = data.approximateGroup?.candidate?.[0];

    if (!candidate?.rxcui) {
      return local
        ? { input: name, display: local.display, rxcui: local.rxcui, score: 1, local: true }
        : { input: name, display: name, rxcui: "", score: 0 };
    }

    const properties = await fetchConceptProperties(candidate.rxcui);
    return {
      input: name,
      display: properties?.name || candidate.name || local?.display || name,
      rxcui: candidate.rxcui,
      score: Number(candidate.score || 0),
    };
  } catch (_error) {
    return local
      ? { input: name, display: local.display, rxcui: local.rxcui, score: 1, local: true }
      : { input: name, display: name, rxcui: "", score: 0, local: true };
  }
}

async function fetchConceptProperties(rxcui) {
  const response = await fetch(`${RXNAV_BASE}/rxcui/${encodeURIComponent(rxcui)}/properties.json`);
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return data.properties || null;
}

async function fetchInteractions(rxcuis) {
  try {
    const response = await fetch(`${RXNAV_BASE}/interaction/list.json?rxcuis=${encodeURIComponent(rxcuis.join("+"))}`);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return flattenInteractions(data);
  } catch (_error) {
    return [];
  }
}

function flattenInteractions(data) {
  const groups = data.fullInteractionTypeGroup || [];
  return groups.flatMap((group) =>
    (group.fullInteractionType || []).flatMap((type) =>
      (type.interactionPair || []).map((pair) => ({
        severity: pair.severity || "unknown",
        description: pair.description || "Interaction signal found.",
        source: group.sourceName || "RxNav",
        drugs: (pair.interactionConcept || []).map((concept) => concept.minConceptItem?.name).filter(Boolean),
      }))
    )
  );
}

function buildFindings(names, recognized, interactions) {
  const findings = [];
  const normalizedNames = names.map((name) => name.toLowerCase());
  const duplicateInputs = normalizedNames.filter((name, index) => normalizedNames.indexOf(name) !== index);
  const unknown = recognized.filter((item) => !item.rxcui);

  if (duplicateInputs.length) {
    findings.push(makeFinding("moderate", "Possible duplicate entry", `Duplicate medicine names were entered: ${duplicateInputs.join(", ")}.`));
  }

  unknown.forEach((item) => {
    findings.push(
      makeFinding(
        "moderate",
        `Could not standardize "${item.input}"`,
        "The medicine may be misspelled, local-only, a supplement, or unavailable in RxNorm. Ask a pharmacist to identify the active ingredient."
      )
    );
  });

  interactions.forEach((interaction) => {
    const severity = interaction.severity.toLowerCase();
    const level = severity.includes("high") ? "high" : severity.includes("moderate") ? "moderate" : "moderate";
    findings.push(
      makeFinding(
        level,
        `${interaction.source} interaction signal`,
        `${interaction.description}${interaction.drugs.length ? ` Medicines: ${interaction.drugs.join(" + ")}.` : ""}`
      )
    );
  });

  buildCuratedInteractionFindings(names).forEach((finding) => findings.push(finding));

  const lowerJoined = names.join(" ").toLowerCase();
  highRiskTerms
    .filter((term) => lowerJoined.includes(term))
    .forEach((term) => {
      findings.push(makeFinding("moderate", `High-monitoring medicine: ${term}`, "This medicine often needs dose/context review, monitoring, or extra caution."));
    });

  const bleedingMatches = bleedingTerms.filter((term) => lowerJoined.includes(term));
  if (bleedingMatches.length >= 2) {
    findings.push(
      makeFinding(
        "high",
        "Bleeding-risk combination signal",
        `${bleedingMatches.join(", ")} can be associated with bleeding risk in some patients. Confirm with a clinician before combining.`
      )
    );
  }

  return findings;
}

function buildCuratedInteractionFindings(names) {
  const lowerJoined = names.join(" ").toLowerCase();
  const organContext = organInput.value === "yes" ? " kidney liver organ disease " : "";
  const searchableText = `${lowerJoined}${organContext}`;

  return curatedInteractionRules
    .filter((rule) => rule.terms.every((term) => searchableText.includes(term)))
    .map((rule) => makeFinding(rule.level, rule.title, rule.message));
}

function buildContextFindings(names) {
  const findings = [];
  const lowerJoined = names.join(" ").toLowerCase();
  const age = Number(ageInput.value);

  if (!ageInput.value) {
    findings.push(makeFinding("low", "Age not provided", "Age can change medicine risk, dosing, and monitoring needs."));
  } else if (age >= 65) {
    findings.push(makeFinding("moderate", "Older adult context", "Older adults can have higher risk from sedation, bleeding, kidney effects, and falls."));
  }

  if (!pregnancyInput.value) {
    findings.push(makeFinding("low", "Pregnancy context unknown", "Pregnancy status matters for several medicines."));
  } else if (pregnancyInput.value === "yes") {
    const matches = pregnancyCautionTerms.filter((term) => lowerJoined.includes(term));
    findings.push(
      makeFinding(
        matches.length ? "high" : "moderate",
        "Pregnancy or possible pregnancy",
        matches.length
          ? `Potentially important pregnancy caution terms found: ${matches.join(", ")}. Seek clinician review urgently.`
          : "Ask a clinician or pharmacist to confirm pregnancy safety for every medicine."
      )
    );
  }

  if (!organInput.value) {
    findings.push(makeFinding("low", "Kidney/liver context unknown", "Kidney or liver problems can change safety for many medicines."));
  } else if (organInput.value === "yes") {
    const matches = kidneyCautionTerms.filter((term) => lowerJoined.includes(term));
    findings.push(
      makeFinding(
        matches.length ? "high" : "moderate",
        "Kidney or liver disease context",
        matches.length
          ? `Review these possible caution terms with a clinician: ${matches.join(", ")}.`
          : "Dose adjustment or monitoring may be needed depending on the medicine."
      )
    );
  }

  const allergy = allergyInput.value.trim();
  if (allergy) {
    findings.push(makeFinding("moderate", "Allergy noted", `Confirm none of the medicines contain or cross-react with: ${allergy}.`));
  }

  return findings;
}

function makeFinding(level, title, message) {
  return { level, title, message };
}

function scoreRisk(findings) {
  if (findings.some((finding) => finding.level === "high")) {
    return "high";
  }
  if (findings.some((finding) => finding.level === "moderate")) {
    return "moderate";
  }
  return "low";
}

function riskMessage(risk) {
  if (risk === "high") {
    return "Do not treat this as safe. Ask a pharmacist or doctor before using the combination, especially if symptoms are present.";
  }
  if (risk === "moderate") {
    return "There are context or medicine signals worth reviewing with a healthcare professional.";
  }
  return "No major signal was found from available data, but this does not prove the combination is safe.";
}

function buildQuestions(names, findings) {
  const questions = [
    "Are these all prescription, OTC, herbal, and supplement products the patient takes?",
    "Are any medicines duplicated by brand name and generic name?",
    "Do dose, timing, age, pregnancy status, kidney/liver function, or allergies change the risk?",
  ];

  if (findings.some((finding) => finding.level === "high")) {
    questions.unshift("Should any medicine be paused or changed only under direct clinician instruction?");
  }

  if (names.length > 4) {
    questions.push("Can the medicine list be simplified or reviewed for deprescribing?");
  }

  return questions;
}

function setLoading() {
  riskMeter.className = "risk-meter";
  riskMeter.innerHTML = `
    <span class="risk-label">Checking</span>
    <strong>Working</strong>
    <p>Looking up medicine names and interaction signals...</p>
  `;
  recognizedList.innerHTML = `<span class="empty">Resolving medicine names...</span>`;
  findingList.innerHTML = `
    <article class="finding neutral">
      <strong>Checking public data</strong>
      <p>This usually takes a few seconds.</p>
    </article>
  `;
}

function renderState({ risk, title, message, recognized, findings, questions }) {
  riskMeter.className = `risk-meter ${risk}`;
  riskMeter.innerHTML = `
    <span class="risk-label">${risk} signal</span>
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(message)}</p>
  `;

  recognizedList.innerHTML = recognized.length
    ? recognized
        .map((item) => `<span title="RxCUI: ${escapeHtml(item.rxcui || "not found")}">${escapeHtml(item.display)}${item.rxcui ? "" : " ?"}</span>`)
        .join("")
    : `<span class="empty">No recognized medicines.</span>`;

  findingList.innerHTML = findings
    .map(
      (finding) => `
        <article class="finding ${finding.level}">
          <strong>${escapeHtml(finding.title)}</strong>
          <p>${escapeHtml(finding.message)}</p>
        </article>
      `
    )
    .join("");

  questionList.innerHTML = questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
