/* ============================================================
   LeakLens Dashboard — app logic

   Both layers are now real:
     - /api/check-email     breach lookup (XposedOrNot)
     - /api/analyze-breach  Gonka Router multi-model consensus

   The AI panel still degrades gracefully: if Gonka isn't
   configured (no key) or the analysis call fails, the panel
   shows an explicit "unavailable" state rather than breaking —
   the breach report above it still renders either way, matching
   how the backend itself is documented to behave.
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
const aiStatusBadgeEl = document.getElementById("ai-status-badge");
const coverageNoteEl = document.getElementById("coverage-note");
const modelsLineEl = document.getElementById("models-line");
const aiUnavailableEl = document.getElementById("ai-unavailable");
const aiUnavailableMessageEl = document.getElementById("ai-unavailable-message");
const breachVerdictsEl = document.getElementById("breach-verdicts");

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
    results.hidden = false;

    // The AI analysis is a separate call and can fail or be
    // unconfigured independently of the breach lookup above —
    // that failure should never take down the breach report the
    // person already has in front of them.
    setAIStatus("loading");
    try {
      const analysis = await fetchAIAnalysis(email);
      renderAIVerdict(analysis);
    } catch (aiErr) {
      showAIUnavailable(aiErr.message);
    }

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
  li.dataset.breachName = breach.name;

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
    <div class="ai-chip-slot" data-ai-chip-for="${escapeHtml(breach.name)}"></div>
  `;
  return li;
}

function setBreachAIChip(breachName, statusLabel, score) {
  const slot = breachListEl.querySelector(
    `.ai-chip-slot[data-ai-chip-for="${cssEscape(breachName)}"]`
  );
  if (!slot) return;
  slot.innerHTML = `<span class="ai-chip ai-chip-${statusLabel.toLowerCase()}">${score}/100 · ${escapeHtml(statusLabel)}</span>`;
}

function cssEscape(str) {
  return window.CSS && CSS.escape ? CSS.escape(str) : str.replace(/"/g, '\\"');
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
   AI LAYER — real, hits data-layer's Gonka consensus endpoint

   GET /api/analyze-breach?email=... returns:
     overallRiskScore, consensusStatus, disputedCount,
     analyzedBreaches, totalBreaches, truncated, models[],
     breaches[]: { name, status, finalScore, scoreDifference,
                   modelA: { ok, model, severityScore, evidence,
                             reasoning, recommendedAction,
                             requestId, requestIdSource },
                   modelB: { ...same shape } }

   503 means Gonka isn't configured (no key) — that's a normal,
   documented state, not a bug, so it's handled as "unavailable"
   rather than a generic error.
   ============================================================ */

const STATUS_LABELS = {
  consensus: "Agreement",
  disputed: "Disputed",
  "single-model": "Single model",
  unverified: "Unverified",
  unavailable: "Unavailable",
};

async function fetchAIAnalysis(email) {
  const url = `${CONFIG.DATA_LAYER_BASE}/api/analyze-breach?email=${encodeURIComponent(email)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    const messages = {
      429: "Gonka analysis is rate-limited right now — try again shortly.",
      502: "Couldn't reach the Gonka Router right now.",
      503: "AI severity analysis isn't configured for this deployment yet (no Gonka key set).",
    };
    throw new Error(messages[res.status] || data.error || "AI analysis failed.");
  }

  return data;
}

function setAIStatus(state) {
  aiUnavailableEl.hidden = state !== "unavailable";
  const labels = { loading: "Checking…", unavailable: "Unavailable" };
  aiStatusBadgeEl.textContent = labels[state] || "";
  aiStatusBadgeEl.className = `ai-status-badge ai-status-${state}`;
}

function showAIUnavailable(message) {
  setAIStatus("unavailable");
  aiUnavailableMessageEl.textContent = message;
  scoreLabelEl.textContent = "No severity score available";
}

function scoreTier(score) {
  if (score >= 67) return { label: "High", className: "tier-high" };
  if (score >= 34) return { label: "Medium", className: "tier-medium" };
  return { label: "Low", className: "tier-low" };
}

function renderAIVerdict(analysis) {
  setAIStatus("live");
  aiStatusBadgeEl.textContent = "Live · Gonka Router";

  const tier = scoreTier(analysis.overallRiskScore);
  leakScoreEl.textContent = analysis.overallRiskScore;
  leakScoreEl.className = `score-value ${tier.className}`;
  scoreLabelEl.textContent = `${tier.label} risk`;

  consensusStatusEl.textContent =
    analysis.consensusStatus === "consensus" ? "Agreement" : "Models disagree";

  if (analysis.truncated) {
    coverageNoteEl.hidden = false;
    coverageNoteEl.textContent = `Showing the ${analysis.analyzedBreaches} largest of ${analysis.totalBreaches} leaks found, ranked by risk.`;
  } else {
    coverageNoteEl.hidden = true;
  }

  if (analysis.models && analysis.models.length) {
    modelsLineEl.hidden = false;
    modelsLineEl.textContent = `Cross-checked by ${analysis.models.join(" and ")}`;
  }

  breachVerdictsEl.innerHTML = analysis.breaches.map(renderBreachVerdict).join("");

  // Cross-reference back onto the breach list above so each
  // leak shows its own severity, not just the aggregate.
  analysis.breaches.forEach((b) => {
    const label = STATUS_LABELS[b.status] || b.status;
    setBreachAIChip(b.name, label, b.finalScore);
  });
}

function renderBreachVerdict(breach) {
  const statusLabel = STATUS_LABELS[breach.status] || breach.status;
  const diffNote =
    breach.status === "disputed" && breach.scoreDifference
      ? `<span class="score-diff">Δ ${breach.scoreDifference} pts</span>`
      : "";

  return `
    <div class="breach-verdict-card">
      <div class="breach-verdict-header">
        <span class="breach-verdict-name">${escapeHtml(breach.name)}</span>
        <span class="verdict-status-pill status-${breach.status}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="breach-verdict-score">
        ${breach.finalScore ?? "--"}/100 ${diffNote}
      </div>
      <div class="model-compare">
        ${renderModelVerdict(breach.modelA)}
        ${renderModelVerdict(breach.modelB)}
      </div>
    </div>
  `;
}

function renderModelVerdict(model) {
  if (!model) return "";
  if (!model.ok) {
    return `<div class="model-verdict-block model-no-response">No response from this model</div>`;
  }
  return `
    <div class="model-verdict-block">
      <div class="model-verdict-name">${escapeHtml(model.model)} · ${model.severityScore}/100</div>
      <p class="model-evidence">${escapeHtml(model.evidence || "")}</p>
      <p class="model-reasoning">${escapeHtml(model.reasoning || "")}</p>
      ${model.recommendedAction ? `<p class="model-action"><strong>Do this first:</strong> ${escapeHtml(model.recommendedAction)}</p>` : ""}
      <p class="request-id">Request ID: <code>${escapeHtml(model.requestId || "n/a")}</code></p>
    </div>
  `;
}
