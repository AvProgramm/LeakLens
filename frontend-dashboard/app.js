/* ============================================================
   LeakLens Dashboard - app logic

   Everything here is real. The breach list comes from the
   data-layer's /api/check-email, and the Leak Score panel comes
   from /api/analyze-breach, which runs two independent models on
   the Gonka Network and reports whether they agreed.

   The two loads are deliberately INDEPENDENT: breach results
   render the moment they arrive, and the AI panel fills in after.
   If Gonka is unreachable or unconfigured, the user still gets
   their breach report instead of an empty screen.
   ============================================================ */

const CONFIG = {
  // Must match the data-layer's PORT (default 4000). Point this at the
  // deployed data-layer URL on demo day.
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
const aiStatusEl = document.getElementById("ai-status");

// ---------- Startup ----------

/**
 * Ask the data-layer up front whether Gonka is configured, so the AI panel
 * can say what it is going to do before the user runs a scan rather than
 * failing halfway through one.
 */
async function checkBackendHealth() {
  try {
    const res = await fetch(`${CONFIG.DATA_LAYER_BASE}/health`);
    if (!res.ok) throw new Error("unhealthy");
    const health = await res.json();

    if (!health.gonkaConfigured) {
      setAiStatus(
        "AI analysis is not configured on the server (no GONKA_API_KEY). Breach lookup still works.",
        "warn"
      );
    }
    return health;
  } catch {
    setAiStatus(
      `Cannot reach the data-layer at ${CONFIG.DATA_LAYER_BASE}. Start it with "npm start" inside data-layer/.`,
      "error"
    );
    return null;
  }
}

checkBackendHealth();

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

    // Render and reveal the breach report immediately. The AI panel is a
    // separate, slower call and must never gate this.
    renderResults(breachData);
    results.hidden = false;

    // The scan button is released here, before the AI call, so the user is
    // free to run another lookup while inference is still in flight.
    setLoading(false);
    await loadAiVerdict(email);
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

function setAiStatus(message, tone = "info") {
  if (!aiStatusEl) return;
  aiStatusEl.textContent = message || "";
  aiStatusEl.hidden = !message;
  aiStatusEl.className = `ai-status ai-status-${tone}`;
}

/* ============================================================
   DATA LAYER
   ============================================================ */

async function fetchBreachData(email) {
  const url = `${CONFIG.DATA_LAYER_BASE}/api/check-email?email=${encodeURIComponent(email)}`;

  let res;
  try {
    res = await fetch(url);
  } catch {
    // A network-level failure here almost always means the server isn't
    // running, so say that rather than a generic error.
    throw new Error(
      `Cannot reach the data-layer at ${CONFIG.DATA_LAYER_BASE}. Is it running?`
    );
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const messages = {
      400: data.error || "That doesn't look like a valid email.",
      429: "Too many checks right now - the leak database is rate-limited. Try again in a minute.",
      502: "Couldn't reach the leak database right now. Try again shortly.",
    };
    throw new Error(messages[res.status] || data.error || "Unexpected error checking that email.");
  }

  return data;
}

// A widely-leaked address can appear in hundreds of breaches. Rendering all
// of them at once buries the Leak Score and makes the page sluggish, so we
// show the biggest ones first and let the user expand the rest.
const INITIAL_BREACHES_SHOWN = 20;

function renderResults(data) {
  breachCountEl.textContent = data.breachCount;

  const totalRecords = data.breaches.reduce(
    (sum, b) => sum + (b.recordsExposed || 0),
    0
  );
  recordsExposedEl.textContent = totalRecords.toLocaleString();

  // Largest first, so the most consequential leaks are the ones on screen.
  const orderedBreaches = [...data.breaches].sort(
    (left, right) => (right.recordsExposed || 0) - (left.recordsExposed || 0)
  );

  renderBreachList(orderedBreaches, INITIAL_BREACHES_SHOWN);
}

function renderBreachList(orderedBreaches, limit) {
  breachListEl.innerHTML = "";

  const visibleBreaches = orderedBreaches.slice(0, limit);
  const fragment = document.createDocumentFragment();
  visibleBreaches.forEach((breach) => fragment.appendChild(renderBreachItem(breach)));
  breachListEl.appendChild(fragment);

  // Clear any previous toggle before deciding whether a new one is needed.
  const existingToggle = document.querySelector(".show-all-breaches");
  if (existingToggle) existingToggle.remove();

  const remaining = orderedBreaches.length - visibleBreaches.length;
  if (remaining <= 0) return;

  const showAllButton = document.createElement("button");
  showAllButton.type = "button";
  showAllButton.className = "show-all-breaches";
  showAllButton.textContent = `Show all ${orderedBreaches.length} leaks (${remaining} more)`;
  showAllButton.addEventListener("click", () => {
    renderBreachList(orderedBreaches, orderedBreaches.length);
  });
  breachListEl.after(showAllButton);
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
  return labels[String(risk).toLowerCase()] || risk;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ============================================================
   AI LAYER - Gonka multi-model consensus
   ============================================================ */

/**
 * Fetch and render the Gonka verdict. Failures are contained here and
 * reported inside the AI panel, so a Gonka outage never removes the breach
 * report the user already has on screen.
 */
async function loadAiVerdict(email) {
  setAiStatus("Asking two independent models on the Gonka Network…", "info");
  leakScoreEl.textContent = "…";
  scoreLabelEl.textContent = "Running multi-model analysis";
  consensusStatusEl.textContent = "…";
  modelVerdictsEl.innerHTML = "";
  reasoningContentEl.innerHTML = "";

  try {
    const url = `${CONFIG.DATA_LAYER_BASE}/api/analyze-breach?email=${encodeURIComponent(email)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || "Couldn't complete the AI severity analysis.");
    }

    renderAiVerdict(data);
  } catch (err) {
    leakScoreEl.textContent = "--";
    scoreLabelEl.textContent = "AI analysis unavailable";
    consensusStatusEl.textContent = "--";
    setAiStatus(err.message, "error");
  }
}

function riskTier(score) {
  if (score >= 75) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function renderAiVerdict(report) {
  const analyzed = report.breaches || [];

  // Every breach came back unscored, so say so rather than showing a zero
  // that reads as "you are safe".
  if (report.overallRiskScore === null || analyzed.length === 0) {
    leakScoreEl.textContent = "--";
    scoreLabelEl.textContent = "No model verdicts returned";
    consensusStatusEl.textContent = "--";
    setAiStatus("Both models failed to return a usable assessment.", "warn");
    return;
  }

  leakScoreEl.textContent = report.overallRiskScore;
  scoreLabelEl.textContent = `${riskTier(report.overallRiskScore)} risk — live Gonka assessment`;

  consensusStatusEl.textContent =
    report.consensusStatus === "agreement"
      ? "Models agree"
      : `Models disagree on ${report.disputedCount} of ${analyzed.length}`;

  // Be explicit when only a subset was analysed, so the headline number is
  // never quietly based on less data than the breach list shows.
  const coverageNote = report.truncated
    ? `Analysed the ${report.analyzedBreaches} largest of ${report.totalBreaches} breaches via ${report.models.join(" + ")}.`
    : `Analysed all ${report.analyzedBreaches} breaches via ${report.models.join(" + ")}.`;
  setAiStatus(coverageNote, "info");

  renderModelVerdicts(analyzed);
  renderReasoningTrace(analyzed);
}

/**
 * One row per model per breach, each carrying its Gonka Request ID. That ID
 * is the on-chain proof the hackathon brief asks for: it shows the verdict
 * came from the decentralized network, not from our own server.
 */
function renderModelVerdicts(analyzed) {
  const rows = [];

  for (const breach of analyzed) {
    for (const verdict of [breach.modelA, breach.modelB]) {
      if (!verdict) continue;

      const scoreText = verdict.ok ? `${verdict.severityScore}/100` : "failed";
      const requestIdText = verdict.requestId
        ? `${verdict.requestId}`
        : verdict.ok
          ? "no request id returned"
          : escapeHtml(verdict.error || "no response");

      rows.push(`
        <div class="model-verdict-row ${verdict.ok ? "" : "model-verdict-failed"}">
          <span class="model-verdict-name">
            ${escapeHtml(breach.name)}
            <small>${escapeHtml(verdict.model)}</small>
          </span>
          <span class="model-verdict-score">
            ${escapeHtml(scoreText)}
            <br><small class="request-id" title="Gonka Request ID">${escapeHtml(requestIdText)}</small>
          </span>
        </div>
      `);
    }
  }

  modelVerdictsEl.innerHTML = rows.join("");
}

/**
 * The reasoning trace. Where the models disagreed we show BOTH explanations
 * side by side - the disagreement is the product, so hiding one of them
 * would defeat the point.
 */
function renderReasoningTrace(analyzed) {
  const blocks = analyzed.map((breach) => {
    const statusLabels = {
      consensus: "both models agree",
      disputed: "models disagree",
      "single-model": "one model only",
      unavailable: "no verdict",
    };

    const verdictLines = [breach.modelA, breach.modelB]
      .filter((verdict) => verdict?.ok)
      .map(
        (verdict) => `
          <p class="reasoning-line">
            <strong>${escapeHtml(verdict.model)}</strong>
            — ${escapeHtml(String(verdict.severityScore))}/100.
            ${escapeHtml(verdict.reasoning)}
            ${verdict.evidence ? `<em>Evidence: ${escapeHtml(verdict.evidence)}</em>` : ""}
          </p>`
      )
      .join("");

    const action = [breach.modelA, breach.modelB].find((v) => v?.ok)?.recommendedAction;

    return `
      <div class="reasoning-block">
        <p class="reasoning-heading">
          ${escapeHtml(breach.name)}
          <span class="reasoning-status status-${escapeHtml(breach.status)}">
            ${escapeHtml(statusLabels[breach.status] || breach.status)}
            ${breach.finalScore !== null ? `· ${escapeHtml(String(breach.finalScore))}/100` : ""}
          </span>
        </p>
        ${verdictLines || "<p class='reasoning-line'>No model returned an assessment.</p>"}
        ${action ? `<p class="reasoning-action">Do this first: ${escapeHtml(action)}</p>` : ""}
      </div>
    `;
  });

  reasoningContentEl.innerHTML = blocks.join("");
}
