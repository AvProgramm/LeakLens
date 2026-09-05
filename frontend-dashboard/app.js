/* ============================================================
   LeakLens Dashboard — app logic

   REAL:  everything under "DATA LAYER" below hits the actual
          data-layer endpoint from PR #1 and renders real breach
          data using the exact contract documented in that PR's
          README.

     REAL:  the AI layer calls the data-layer Gonka analysis endpoint
       and renders live model scores, reasoning, and request IDs.

  The data-layer owns the Gonka Router calls and consensus logic.
   ============================================================ */

const CONFIG = {
  // Point this at the deployed data-layer URL on demo day.
  DATA_LAYER_BASE: "http://localhost:4001",
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

async function getAIVerdict(breachData) {
  const url = `${CONFIG.DATA_LAYER_BASE}/api/analyze-breach?email=${encodeURIComponent(breachData.email)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Couldn't complete the AI severity analysis.");
  }

  return {
    exposure_risk_score: data.overallRiskScore,
    risk_tier: riskTier(data.overallRiskScore),
    consensus_status: data.breaches.some((breach) => breach.status === "disputed")
      ? "divergence"
      : "agreement",
    model_verdicts: data.breaches.flatMap((breach) => [
      {
        model: `${breach.name} — ${breach.modelA.model}`,
        severity: breach.modelA.severity_score,
        gonka_request_id: breach.modelA.requestId,
      },
      {
        model: `${breach.name} — ${breach.modelB.model}`,
        severity: breach.modelB.severity_score,
        gonka_request_id: breach.modelB.requestId,
      },
    ]),
    reasoning_trace: data.breaches.flatMap((breach) => [
      `${breach.name} (${breach.status}): ${breach.modelA.reasoning}`,
      `${breach.name} recommended action: ${breach.modelA.recommended_action}`,
      `${breach.name} second model: ${breach.modelB.reasoning}`,
    ]),
  };
}

function riskTier(score) {
  if (score >= 75) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function renderAIVerdict(verdict) {
  leakScoreEl.textContent = verdict.exposure_risk_score;
  scoreLabelEl.textContent = `${verdict.risk_tier} risk — live Gonka assessment`;

  consensusStatusEl.textContent =
    verdict.consensus_status === "agreement" ? "Agreement" : "Models disagree";

  modelVerdictsEl.innerHTML = verdict.model_verdicts
    .map(
      (m) => `
      <div class="model-verdict-row">
        <span class="model-verdict-name">${escapeHtml(m.model)}</span>
        <span>${m.severity}/100<br><small>${escapeHtml(m.gonka_request_id)}</small></span>
      </div>
    `
    )
    .join("");

  reasoningContentEl.innerHTML = verdict.reasoning_trace
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}
