/* ============================================================
   LeakLens Dashboard — app logic
   ============================================================ */

const CONFIG = {
  DATA_LAYER_BASE: "http://localhost:4000",

  // Ceilings on how long we wait before giving up. The AI call runs two
  // reasoning models on a decentralized network and legitimately takes
  // 15-80s, so its budget is generous - but it must be finite, or a stalled
  // router leaves the panel spinning with no way for the user to tell
  // whether it is working.
  BREACH_TIMEOUT_MS: 30000,
  AI_TIMEOUT_MS: 180000,
};

/**
 * fetch with a deadline. AbortController is what actually cancels the
 * in-flight request; without it a hung connection holds the UI forever.
 */
async function fetchWithTimeout(url, timeoutMs, timeoutMessage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Client-side session cache to eliminate rate limits during repeated testing
const SESSION_CACHE = {
  breaches: new Map(),
  ai: new Map(),
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

const scoreRingEl = document.getElementById("score-ring");
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

  // Strict debouncing: ignore duplicate enters/clicks while request resolves
  if (scanButton.disabled) return;

  const email = emailInput.value.trim().toLowerCase();
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
  clearAIPanel();
}

/**
 * Wipe every trace of the previous scan's AI verdict. Without this, a scan
 * whose analysis fails leaves the PREVIOUS email's model cards, reasoning
 * and Gonka Request IDs on screen next to the new email's breach list -
 * one person's verdict attributed to another person's address.
 */
function clearAIPanel() {
  breachVerdictsEl.innerHTML = "";
  coverageNoteEl.hidden = true;
  coverageNoteEl.textContent = "";
  modelsLineEl.hidden = true;
  modelsLineEl.textContent = "";

  leakScoreEl.textContent = "--";
  leakScoreEl.className = "score-value";
  scoreRingEl.className = "score-ring";
  scoreLabelEl.textContent = "Waiting on Gonka analysis";
  consensusStatusEl.textContent = "--";
  consensusStatusEl.className = "consensus-value";
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function showClean() {
  cleanState.hidden = false;
}

/* ============================================================
   DATA LAYER
   ============================================================ */

async function fetchBreachData(email) {
  if (SESSION_CACHE.breaches.has(email)) {
    return SESSION_CACHE.breaches.get(email);
  }

  const url = `${CONFIG.DATA_LAYER_BASE}/api/check-email?email=${encodeURIComponent(email)}`;
  const res = await fetchWithTimeout(
    url,
    CONFIG.BREACH_TIMEOUT_MS,
    "The leak database took too long to respond. Try again shortly.",
  );
  const data = await res.json();

  if (!res.ok) {
    const messages = {
      400: data.error || "That doesn't look like a valid email.",
      429: "Too many checks right now — the leak database is rate-limited. Try again in a minute.",
      502: "Couldn't reach the leak database right now. Try again shortly.",
    };
    throw new Error(messages[res.status] || data.error || "Unexpected error checking that email.");
  }

  SESSION_CACHE.breaches.set(email, data);
  return data;
}

// A widely-leaked address appears in hundreds of breaches. Rendering all of
// them buries the Leak Score panel and makes the page sluggish, so we show
// the biggest ones first and let the user expand the rest.
const INITIAL_BREACHES_SHOWN = 20;

function renderResults(data) {
  breachCountEl.textContent = data.breachCount;

  const totalRecords = data.breaches.reduce(
    (sum, b) => sum + (b.recordsExposed || 0),
    0
  );
  recordsExposedEl.textContent = totalRecords.toLocaleString();

  // Largest first, matching the order the AI layer judges them in - so the
  // breaches the models actually assessed are the ones on screen.
  const ordered = [...data.breaches].sort(
    (a, b) => (b.recordsExposed || 0) - (a.recordsExposed || 0)
  );

  renderBreachList(ordered, INITIAL_BREACHES_SHOWN);
}

function renderBreachList(ordered, limit) {
  breachListEl.innerHTML = "";

  const fragment = document.createDocumentFragment();
  ordered.slice(0, limit).forEach((breach) => fragment.appendChild(renderBreachItem(breach)));
  breachListEl.appendChild(fragment);

  const existingToggle = document.querySelector(".show-all-breaches");
  if (existingToggle) existingToggle.remove();

  const remaining = ordered.length - Math.min(limit, ordered.length);
  if (remaining <= 0) return;

  const showAll = document.createElement("button");
  showAll.type = "button";
  showAll.className = "show-all-breaches";
  showAll.textContent = `Show all ${ordered.length} leaks (${remaining} more)`;
  showAll.addEventListener("click", () => renderBreachList(ordered, ordered.length));
  breachListEl.after(showAll);
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
  const scoreText = score === null || score === undefined ? "" : `${score}/100 · `;
  slot.innerHTML = `<span class="ai-chip ai-chip-flagged">${scoreText}${escapeHtml(statusLabel)}</span>`;
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
   AI LAYER (Gonka Multi-Model Consensus)
   ============================================================ */

const STATUS_LABELS = {
  consensus: "Agreement",
  disputed: "Disputed",
  "single-model": "Single model",
  unverified: "Unverified",
  unavailable: "Unavailable",
};

async function fetchAIAnalysis(email) {
  if (SESSION_CACHE.ai.has(email)) {
    return SESSION_CACHE.ai.get(email);
  }

  const url = `${CONFIG.DATA_LAYER_BASE}/api/analyze-breach?email=${encodeURIComponent(email)}`;
  const res = await fetchWithTimeout(
    url,
    CONFIG.AI_TIMEOUT_MS,
    "The Gonka Router took too long to respond. The breach report above is still valid.",
  );
  const data = await res.json();

  if (!res.ok) {
    const messages = {
      429: "Gonka analysis is rate-limited right now — try again shortly.",
      502: "Couldn't reach the Gonka Router right now.",
      503: "AI severity analysis isn't configured for this deployment yet (no Gonka key set).",
    };
    throw new Error(messages[res.status] || data.error || "AI analysis failed.");
  }

  SESSION_CACHE.ai.set(email, data);
  return data;
}

function setAIStatus(state) {
  aiUnavailableEl.hidden = state !== "unavailable";
  const labels = { loading: "Asking two models…", unavailable: "Unavailable" };
  aiStatusBadgeEl.textContent = labels[state] || "";
  aiStatusBadgeEl.className = `ai-status-badge ai-status-${state}`;
}

function showAIUnavailable(message) {
  // Clear first: a failed analysis must not leave the previous scan's
  // verdicts and Request IDs sitting under the error message.
  clearAIPanel();
  setAIStatus("unavailable");
  aiUnavailableMessageEl.textContent = message;
  scoreLabelEl.textContent = "No severity score available";
}

function scoreTier(score) {
  if (score >= 67) return { label: "High", className: "tier-high", ringClass: "ring-high" };
  if (score >= 34) return { label: "Medium", className: "tier-medium", ringClass: "ring-medium" };
  return { label: "Low", className: "tier-low", ringClass: "ring-low" };
}

function renderAIVerdict(analysis) {
  setAIStatus("live");
  aiStatusBadgeEl.textContent = "Live · Gonka Router";

  // Each model returns its OWN Truth Score. The headline is reconciled from
  // those, so if no model answered there is no number to show.
  const verdicts = (analysis.truthScores || []).filter(Boolean);
  const answered = verdicts.filter((v) => v.ok);

  if (analysis.overallRiskScore === null || answered.length === 0) {
    showAIUnavailable("No model returned a usable Truth Score.");
    return;
  }

  const tier = scoreTier(analysis.overallRiskScore);
  leakScoreEl.textContent = analysis.overallRiskScore;
  leakScoreEl.className = `score-value ${tier.className}`;
  scoreRingEl.className = `score-ring ${tier.ringClass}`;
  scoreLabelEl.textContent = `${tier.label} risk`;

  // Consensus styling. The backend reports agreement / divergence /
  // single-model / unverified.
  consensusStatusEl.className = "consensus-value";
  const apart = analysis.scoreDifference != null ? ` · ${analysis.scoreDifference} pts apart` : "";

  if (analysis.consensusStatus === "agreement") {
    consensusStatusEl.textContent = `Agreement${apart}`;
    consensusStatusEl.classList.add("status-agreement");
  } else if (analysis.consensusStatus === "divergence") {
    consensusStatusEl.textContent = `Models disagree${apart}`;
    consensusStatusEl.classList.add("status-dispute");
  } else {
    consensusStatusEl.textContent = STATUS_LABELS[analysis.consensusStatus] || analysis.consensusStatus;
    consensusStatusEl.classList.add("status-single");
  }

  const notes = [];
  if (analysis.truncated) {
    notes.push(`Judged the ${analysis.analyzedBreaches} largest of ${analysis.totalBreaches} leaks found, ranked by risk.`);
  }
  // If the router served the same model twice there was no real
  // cross-verification, and saying otherwise would be dishonest.
  if (analysis.consensusNote) notes.push(analysis.consensusNote);

  coverageNoteEl.hidden = notes.length === 0;
  coverageNoteEl.textContent = notes.join(" ");

  if (analysis.models && analysis.models.length) {
    modelsLineEl.hidden = false;
    modelsLineEl.textContent = `Cross-checked by ${analysis.models.join(" and ")}`;
  }

  breachVerdictsEl.innerHTML = verdicts.map(renderModelTruthScore).join("");

  // Mark the breaches the models themselves named as the biggest risks.
  (analysis.breaches || []).forEach((breach) => {
    if (breach.flaggedByModel) setBreachAIChip(breach.name, "Flagged", null);
  });
}

/**
 * One card per model: its own Truth Score, evidence, reasoning, recommended
 * action, and the Gonka Request ID proving the score came from the network.
 */
function renderModelTruthScore(verdict) {
  if (!verdict) return "";

  if (!verdict.ok) {
    return `
      <div class="breach-verdict-card">
        <div class="breach-verdict-header">
          <span class="breach-verdict-name">${escapeHtml(verdict.model)}</span>
          <span class="verdict-status-pill status-unavailable">No response</span>
        </div>
        <div class="model-verdict-block model-no-response">
          ${escapeHtml(verdict.error || "This model did not answer.")}
        </div>
      </div>
    `;
  }

  const tier = scoreTier(verdict.truthScore);
  // Show who ACTUALLY answered - the router does not always honour the
  // requested model, and claiming otherwise would misrepresent the proof.
  const answeringModel = verdict.actualModel || verdict.model;
  const misroutedNote = verdict.misrouted
    ? `<span class="score-diff">requested ${escapeHtml(verdict.model)}</span>`
    : "";

  return `
    <div class="breach-verdict-card">
      <div class="breach-verdict-header">
        <span class="breach-verdict-name">${escapeHtml(answeringModel)}</span>
        <span class="verdict-status-pill status-consensus">Truth Score</span>
      </div>
      <div class="breach-verdict-score ${tier.className}">
        ${verdict.truthScore}/100 ${misroutedNote}
      </div>
      <div class="model-verdict-block">
        ${verdict.evidence ? `<p class="model-evidence">${escapeHtml(verdict.evidence)}</p>` : ""}
        <p class="model-reasoning">${escapeHtml(verdict.reasoning || "")}</p>
        ${verdict.recommendedAction ? `<p class="model-action"><strong>Do this first:</strong> ${escapeHtml(verdict.recommendedAction)}</p>` : ""}
        <p class="request-id">Gonka Request ID: <code>${escapeHtml(verdict.requestId || "n/a")}</code></p>
      </div>
    </div>
  `;
}
