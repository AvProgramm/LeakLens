/* ============================================================
   LeakLens Dashboard — app logic

   REAL:  everything under "DATA LAYER" below hits the actual
          data-layer endpoint from PR #1 and renders real breach
          data using the exact contract documented in that PR's
          README.

   MOCK:  everything under "AI LAYER (PLACEHOLDER)" is static
          fake data shaped like what Person 2's Gonka Router
          integration will eventually return. It is clearly
          labelled "AI layer pending" in the UI itself, not just
          in code, so nobody mistakes it for a real verdict
          during testing or the demo.

   When Person 2's endpoint exists, the ONLY function that needs
   to change is getAIVerdict() near the bottom of this file. Its
   signature and return shape are already the target contract —
   see the TODO comment right above it.
   ============================================================ */

const CONFIG = {
  // Point this at the deployed data-layer URL on demo day.
  DATA_LAYER_BASE: "http://localhost:4000",
};

// ---------- DOM references ----------

const form = document.getElementById("scan-form");
const emailInput = document.getElementById("email-input");
const scanButton = document.getElementById("scan-button");
const btnLabel = scanButton.querySelector(".btn-label");
const btnSpinner = scanButton.querySelector(".btn-spinner");

const errorBanner = document.getElementById("error-banner");
const emptyState = document.getElementById("empty-state");
const cleanState = document.getElementById("clean-state");
const results = document.getElementById("results");

const breachCountEl = document.getElementById("breach-count");
const recordsExposedEl = document.getElementById("records-exposed");
const breachListEl = document.getElementById("breach-list");

const leakScoreEl = document.getElementById("leak-score");
const scoreLabelEl = document.getElementById("score-label");
const consensusStatusEl = document.getElementById("consensus-status");
const modelVerdictsEl = document.getElementById("model-verdicts");
const reasoningContentEl = document.getElementById("reasoning-content");

// ---------- Form handling ----------

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;

  setLoading(true);
  hideAll();

  try {
    const breachData = await fetchBreachData(email);

    if (!breachData.exposed) {
      showClean();
      return;
    }

    renderResults(breachData);
    // AI layer runs after breach data comes back, since the
    // real Gonka call (once wired up) needs the breach data
    // as its input.
    const aiVerdict = await getAIVerdict(breachData);
    renderAIVerdict(aiVerdict);
    results.hidden = false;

  } catch (err) {
    showError(err.message || "Something went wrong checking that email.");
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  scanButton.disabled = isLoading;
  btnLabel.hidden = isLoading;
  btnSpinner.hidden = !isLoading;
}

function hideAll() {
  errorBanner.hidden = true;
  emptyState.hidden = true;
  cleanState.hidden = true;
  results.hidden = true;
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function showClean() {
  cleanState.hidden = false;
}

/* ============================================================
   DATA LAYER — real, hits PR #1's endpoint
   ============================================================ */

async function fetchBreachData(email) {
  const url = `${CONFIG.DATA_LAYER_BASE}/api/check-email?email=${encodeURIComponent(email)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    // Data layer returns { error: "..." } for 400 / 429 / 502
    const messages = {
      400: data.error || "That doesn't look like a valid email.",
      429: "Too many checks right now — the leak database is rate-limited. Try again in a minute.",
      502: "Couldn't reach the leak database right now. Try again shortly.",
    };
    throw new Error(messages[res.status] || data.error || "Unexpected error checking that email.");
  }

  return data;
}

function renderResults(data) {
  breachCountEl.textContent = data.breachCount;

  const totalRecords = data.breaches.reduce(
    (sum, b) => sum + (b.recordsExposed || 0),
    0
  );
  recordsExposedEl.textContent = totalRecords.toLocaleString();

  breachListEl.innerHTML = "";
  data.breaches.forEach((breach) => {
    breachListEl.appendChild(renderBreachItem(breach));
  });
}

function renderBreachItem(breach) {
  const li = document.createElement("li");
  li.className = "breach-item";

  const chips = [...(breach.dataExposed || [])];
  if (breach.passwordRisk) {
    chips.push(`Password: ${formatPasswordRisk(breach.passwordRisk)}`);
  }

  li.innerHTML = `
    <div class="breach-name-row">
      <span class="breach-name">${escapeHtml(breach.name)}</span>
      <span class="breach-year">${escapeHtml(breach.year || "")}</span>
    </div>
    <div class="breach-meta">
      ${escapeHtml(breach.industry || "Unknown industry")}
      · ${(breach.recordsExposed || 0).toLocaleString()} records exposed
    </div>
    <div class="data-chips">
      ${chips.map((c) => `<span class="data-chip">${escapeHtml(c)}</span>`).join("")}
    </div>
  `;
  return li;
}

function formatPasswordRisk(risk) {
  const labels = {
    plaintext: "stored in plain text",
    easytocrack: "easy to crack",
    hardtocrack: "hard to crack",
    unknown: "unknown strength",
  };
  return labels[risk.toLowerCase()] || risk;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ============================================================
   AI LAYER (PLACEHOLDER) — mock, awaiting Gonka integration

   TODO (Person 2): replace the body of getAIVerdict() with a
   real call once the Gonka Router endpoint exists, e.g.:

     async function getAIVerdict(breachData) {
       const res = await fetch(`${CONFIG.AI_LAYER_BASE}/api/verdict`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(breachData),
       });
       return res.json();
     }

   Keep the return shape identical to MOCK_AI_VERDICT below —
   the render function already expects exactly these fields.
   ============================================================ */

const MOCK_AI_VERDICT = {
  exposure_risk_score: 62,
  risk_tier: "Medium",
  consensus_status: "divergence", // "agreement" | "divergence"
  model_verdicts: [
    { model: "model-a (placeholder)", severity: 58, gonka_request_id: "pending-integration" },
    { model: "model-b (placeholder)", severity: 71, gonka_request_id: "pending-integration" },
  ],
  reasoning_trace: [
    "Placeholder — once Gonka Router is wired up, each model's plain-language explanation of what was exposed and why it matters will render here.",
    "Model disagreement, if any, will be shown explicitly here rather than averaged away silently.",
  ],
};

async function getAIVerdict(breachData) {
  // Small artificial delay so the UI's loading state behaves the
  // same way it will once this is a real network call.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return MOCK_AI_VERDICT;
}

function renderAIVerdict(verdict) {
  leakScoreEl.textContent = verdict.exposure_risk_score;
  scoreLabelEl.textContent = `${verdict.risk_tier} risk — mock data, AI layer pending`;

  consensusStatusEl.textContent =
    verdict.consensus_status === "agreement" ? "Agreement" : "Models disagree";

  modelVerdictsEl.innerHTML = verdict.model_verdicts
    .map(
      (m) => `
      <div class="model-verdict-row">
        <span class="model-verdict-name">${escapeHtml(m.model)}</span>
        <span>${m.severity}/100</span>
      </div>
    `
    )
    .join("");

  reasoningContentEl.innerHTML = verdict.reasoning_trace
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}
