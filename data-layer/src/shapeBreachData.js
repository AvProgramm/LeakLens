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

function getRiskScore(breachMetrics, breachCount) {
  if (breachMetrics) {
    const candidate =
      breachMetrics.risk?.risk_score ??
      breachMetrics.risk_score ??
      breachMetrics.risk;
    if (typeof candidate === 'number') return candidate;
  }
  // Fallback heuristic so the field is never missing: 0 breaches -> 0,
  // otherwise scale with count, capped at 10. This is a placeholder —
  // the AI scoring team's severity model should supersede this, this
  // is just so `riskScore` is never undefined for downstream code.
  if (!breachCount) return 0;
  return Math.min(10, breachCount * 2);
}

function riskLabel(score) {
  if (score === 0) return 'None';
  if (score <= 3) return 'Low';
  if (score <= 6) return 'Medium';
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

// passwords_strength from XON comes as an array of [label, count] pairs
// in an order that isn't formally documented. We map by label text so
// this doesn't silently break if the order changes.
//
// Every count is coerced with Number() and accumulated with +=. XON has
// been seen to send counts as strings, and the contract documents these as
// numbers - without the coercion a downstream `strongHash + easyToCrack`
// would concatenate ("1" + "0" = "10") instead of adding. Accumulating
// rather than assigning also means two pairs whose labels both match the
// same bucket sum correctly instead of the second silently winning.
function normalizePasswordStrength(pairs) {
  const out = { strongHash: 0, easyToCrack: 0, plainText: 0, unknown: 0 };
  if (!Array.isArray(pairs)) return out;
  for (const pair of pairs) {
    if (!Array.isArray(pair)) continue;
    const [rawLabel, rawCount] = pair;
    const label = String(rawLabel).toLowerCase();
    const count = Number(rawCount) || 0;
    if (label.includes('easy')) out.easyToCrack += count;
    else if (label.includes('hard') || label.includes('strong')) out.strongHash += count;
    else if (label.includes('plain') || label.includes('clear')) out.plainText += count;
    else out.unknown += count;
  }
  return out;
}

// yearwise_details comes as [[year, count], ...]
function normalizeYearlyBreakdown(pairs) {
  const out = {};
  if (!Array.isArray(pairs)) return out;
  for (const pair of pairs) {
    if (!Array.isArray(pair)) continue;
    const [year, rawCount] = pair;
    out[String(year)] = Number(rawCount) || 0;
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
    riskLabel: riskLabel(riskScore),
    breaches: breachDetails.map(normalizeBreachDetail),
    passwordStrength: normalizePasswordStrength(raw?.BreachMetrics?.passwords_strength),
    yearlyBreakdown: normalizeYearlyBreakdown(raw?.BreachMetrics?.yearwise_details),
    pastes: {
      count: raw?.PastesSummary?.cnt ?? 0,
    },
  };
}

export { shapeBreachData };