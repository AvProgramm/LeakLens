/**
 * shapeBreachData.js
 * Converts the raw XposedOrNot breach-analytics response into the
 * stable JSON contract the rest of the LeakLens team builds on.
 *
 * Raw XON shape (confirmed from XON's own docs/SDKs):
 *   {
 *     BreachesSummary: { site, total_breaches?, most_recent_breach?, first_breach?, exposed_data?, password_risk? },
 *     ExposedBreaches: { breaches_details: [ { breach, description, domain, industry,
 *                          password_risk, xposed_data, xposed_date, xposed_records, ... } ] } | null,
 *     BreachMetrics: { industry, passwords_strength, yearwise_details, xposed_data, risk? } | null,
 *     PastesSummary: { cnt, domain, tmpstmp },
 *     ExposedPastes: [...] | null,
 *     PasteMetrics: ... | null
 *   }
 *
 * "No breaches found" comes back as HTTP 200 with every top-level key
 * null except BreachesSummary.site (""). We treat that as the baseline
 * "clean" case rather than an error.
 *
 * NOTE: the exact key XON uses for the numeric risk score inside
 * BreachMetrics isn't nailed down in their public docs/SDKs (they
 * describe it in prose as "risk score" but the SDKs don't expose a
 * typed field for it). getRiskScore() below checks the couple of
 * plausible keys and falls back to deriving a rough score from breach
 * count + password_risk. Before the demo, fire one real request and
 * console.log(JSON.stringify(raw.BreachMetrics)) to confirm the actual
 * key, then simplify this function.
 */

// Confirmed live shape: BreachMetrics.risk is a 1-element array:
// [{ risk_label: "Low", risk_score: 23 }]. XON's own score is 0-100,
// not 0-10 — matches the AI layer's 0-100% scale, convenient.
function getRiskScore(breachMetrics, breachCount) {
  const entry = breachMetrics?.risk?.[0];
  if (entry && typeof entry.risk_score === 'number') return entry.risk_score;

  // Fallback heuristic only used if XON ever omits risk (shouldn't
  // happen based on live testing, but keeps the field non-null).
  if (!breachCount) return 0;
  return Math.min(100, breachCount * 20);
}

// Prefer XON's own label when present so it stays consistent with
// their score; only compute our own label for the fallback path.
function riskLabel(score, breachMetrics) {
  const xonLabel = breachMetrics?.risk?.[0]?.risk_label;
  if (xonLabel) return xonLabel;

  if (score === 0) return 'None';
  if (score <= 30) return 'Low';
  if (score <= 60) return 'Medium';
  return 'High';
}

function normalizeBreachDetail(detail) {
  return {
    name: detail.breach ?? detail.name ?? 'Unknown',
    domain: detail.domain ?? '',
    year: detail.xposed_date ?? detail.year ?? '',
    industry: detail.industry ?? '',
    recordsExposed: detail.xposed_records ?? 0,
    passwordRisk: detail.password_risk ?? 'unknown',
    dataExposed: typeof detail.xposed_data === 'string'
      ? detail.xposed_data.split(';').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(detail.xposed_data)
        ? detail.xposed_data
        : [],
    description: detail.description ?? '',
  };
}

// Confirmed live shape: passwords_strength is a 1-element array
// containing ONE flat object: [{ EasyToCrack, PlainText, StrongHash, Unknown }].
// Not label/count pairs as the docs implied.
function normalizePasswordStrength(passwordsStrength) {
  const entry = Array.isArray(passwordsStrength) ? passwordsStrength[0] : null;
  return {
    strongHash: entry?.StrongHash ?? 0,
    easyToCrack: entry?.EasyToCrack ?? 0,
    plainText: entry?.PlainText ?? 0,
    unknown: entry?.Unknown ?? 0,
  };
}

// Confirmed live shape: yearwise_details is a 1-element array containing
// ONE flat object keyed "y2007".."y2026" (not [year,count] pairs).
// We strip the leading "y" and drop zero-count years so the output
// only lists years that actually matter.
function normalizeYearlyBreakdown(yearwiseDetails) {
  const entry = Array.isArray(yearwiseDetails) ? yearwiseDetails[0] : null;
  const out = {};
  if (!entry) return out;
  for (const [key, count] of Object.entries(entry)) {
    if (count > 0) out[key.replace(/^y/, '')] = count;
  }
  return out;
}

/**
 * @param {string} email
 * @param {object} raw - raw XposedOrNot response from xponClient
 * @returns {object} shaped contract object (see README for full schema)
 */
function shapeBreachData(email, raw) {
  const breachDetails = raw?.ExposedBreaches?.breaches_details ?? [];
  const breachCount = breachDetails.length;
  const exposed = breachCount > 0;

  const riskScore = getRiskScore(raw?.BreachMetrics, breachCount);

  return {
    email,
    checkedAt: new Date().toISOString(),
    exposed,
    breachCount,
    riskScore,
    riskLabel: riskLabel(riskScore, raw?.BreachMetrics),
    breaches: breachDetails.map(normalizeBreachDetail),
    passwordStrength: normalizePasswordStrength(raw?.BreachMetrics?.passwords_strength),
    yearlyBreakdown: normalizeYearlyBreakdown(raw?.BreachMetrics?.yearwise_details),
    pastes: {
      count: raw?.PastesSummary?.cnt ?? 0,
    },
  };
}

module.exports = { shapeBreachData };