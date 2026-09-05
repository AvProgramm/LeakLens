/**
 * shapeBreachData.js
 * Converts the raw XposedOrNot breach-analytics response into the
 * stable JSON contract the rest of the LeakLens team builds on.
 *
 * Raw XON shape (confirmed against a live request):
 *   {
 *     BreachesSummary: { site, total_breaches?, most_recent_breach?, first_breach?, exposed_data?, password_risk? },
 *     ExposedBreaches: { breaches_details: [ { breach, description, domain, industry,
 *                          password_risk, xposed_data, xposed_date, xposed_records, ... } ] } | null,
 *     BreachMetrics: { industry, passwords_strength: [{...}], yearwise_details: [{...}],
 *                      risk: [{ risk_label, risk_score }] } | null,
 *     PastesSummary: { cnt, domain, tmpstmp },
 *     ExposedPastes: [...] | null,
 *     PasteMetrics: ... | null
 *   }
 *
 * "No breaches found" comes back as HTTP 200 with every top-level key
 * null except BreachesSummary.site (""). We treat that as the baseline
 * "clean" case rather than an error.
 *
 * The BreachMetrics sub-shapes were confirmed against a live request and
 * differ from XON's published docs: `risk`, `passwords_strength` and
 * `yearwise_details` are each a 1-ELEMENT ARRAY wrapping one flat object,
 * not the label/count pairs the docs imply. Parsing them as pairs returns
 * all zeros without erroring, so change these with a real response in hand.
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

// XON's xposed_date is sometimes a bare year ("2015") and sometimes a full
// date ("2015-03-01"). The contract promises a year, so we take the leading
// four digits and fall back to the raw value if it isn't date-shaped.
function extractYear(rawDate) {
  if (rawDate === undefined || rawDate === null) return '';
  const match = String(rawDate).match(/\d{4}/);
  return match ? match[0] : String(rawDate);
}

function normalizeBreachDetail(detail) {
  return {
    name: detail.breach ?? detail.name ?? 'Unknown',
    domain: detail.domain ?? '',
    year: extractYear(detail.xposed_date ?? detail.year),
    industry: detail.industry ?? '',
    recordsExposed: Number(detail.xposed_records) || 0,
    passwordRisk: detail.password_risk ?? 'unknown',
    dataExposed: typeof detail.xposed_data === 'string'
      ? detail.xposed_data.split(';').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(detail.xposed_data)
        ? detail.xposed_data
        : [],
    description: detail.description ?? '',
  };
}

// Confirmed against a live request: passwords_strength is a 1-element array
// containing ONE flat object: [{ EasyToCrack, PlainText, StrongHash, Unknown }].
// It is NOT label/count pairs, which is what XON's docs implied - parsing it
// as pairs silently produced all zeros.
//
// Counts are coerced with Number() because the contract documents these as
// numbers; without it a downstream `strongHash + easyToCrack` would
// concatenate ("50" + "22" = "5022") instead of adding.
function normalizePasswordStrength(passwordsStrength) {
  const entry = Array.isArray(passwordsStrength) ? passwordsStrength[0] : null;
  return {
    strongHash: Number(entry?.StrongHash) || 0,
    easyToCrack: Number(entry?.EasyToCrack) || 0,
    plainText: Number(entry?.PlainText) || 0,
    unknown: Number(entry?.Unknown) || 0,
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
  for (const [key, rawCount] of Object.entries(entry)) {
    const count = Number(rawCount) || 0;
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

export { shapeBreachData };