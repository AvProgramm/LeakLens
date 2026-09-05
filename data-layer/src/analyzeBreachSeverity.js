import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { fetchBreachAnalytics, fetchBreachNames } from './xponClient.js';

const MODEL_A = 'moonshotai/Kimi-K2.6';
const MODEL_B = 'MiniMaxAI/MiniMax-M2.7';
const GONKA_BASE_URL = 'https://api.gonkarouter.io';

function createGonkaClient() {
  if (!process.env.GONKA_API_KEY) {
    const error = new Error('GONKA_API_KEY is not configured');
    error.code = 'GONKA_CONFIG';
    throw error;
  }

  return new Anthropic({
    apiKey: process.env.GONKA_API_KEY,
    baseURL: GONKA_BASE_URL,
  });
}

function cleanJsonResponse(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseModelResult(response) {
  const text = response.content
    ?.filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('')
    .trim();

  if (!text) throw new Error('Gonka returned an empty response');

  let parsed;
  try {
    parsed = JSON.parse(cleanJsonResponse(text));
  } catch {
    throw new Error('Gonka returned invalid JSON');
  }

  const score = Number(parsed.severity_score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('Gonka returned an invalid severity score');
  }
  if (typeof parsed.reasoning !== 'string' || typeof parsed.recommended_action !== 'string') {
    throw new Error('Gonka returned an incomplete assessment');
  }

  return {
    severity_score: Math.round(score),
    reasoning: parsed.reasoning,
    recommended_action: parsed.recommended_action,
  };
}

function buildPrompt(breach) {
  const metadata = [
    `Breach name: ${breach.name}`,
    breach.year ? `Breach date: ${breach.year}` : null,
    breach.dataExposed?.length ? `Exposed data classes: ${breach.dataExposed.join(', ')}` : null,
    breach.description ? `Description: ${breach.description}` : null,
  ].filter(Boolean).join('\n');

  return `Assess the cybersecurity severity of this breach for a person whose email appeared in it.\n${metadata}\n\nReturn only strict JSON with exactly these fields: {"severity_score": 0-100, "reasoning": "1-2 sentence explanation", "recommended_action": "specific action the user should take"}. Do not use markdown or add any other fields.`;
}

async function assessWithModel(client, model, prompt) {
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 300,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    return {
      model,
      requestId: response.id,
      ...parseModelResult(response),
    };
  } catch (error) {
    throw new Error(`Gonka ${model} assessment failed: ${error.message}`);
  }
}

function detailByName(details) {
  return new Map(details.map((detail) => [detail.name.toLowerCase(), detail]));
}

function normalizeDetail(name, detail) {
  return {
    name,
    year: detail?.year ?? '',
    dataExposed: detail?.dataExposed ?? [],
    description: detail?.description ?? '',
  };
}

async function getBreaches(email) {
  const names = await fetchBreachNames(email);
  if (!names.length) return [];

  let analytics;
  try {
    analytics = await fetchBreachAnalytics(email);
  } catch (error) {
    if (error.code === 'RATE_LIMITED') throw error;
    analytics = null;
  }

  const details = analytics?.ExposedBreaches?.breaches_details ?? [];
  const byName = detailByName(details.map((detail) => normalizeDetail(
    detail.breach ?? detail.name ?? 'Unknown',
    {
      year: detail.xposed_date ?? detail.year,
      dataExposed: typeof detail.xposed_data === 'string'
        ? detail.xposed_data.split(';').map((item) => item.trim()).filter(Boolean)
        : detail.xposed_data,
      description: detail.description,
    },
  )));

  return names.map((name) => normalizeDetail(name, byName.get(name.toLowerCase())));
}

async function analyzeBreachSeverity(email) {
  const breaches = await getBreaches(email);
  if (!breaches.length) {
    return { email, totalBreaches: 0, overallRiskScore: 0, breaches: [] };
  }

  const client = createGonkaClient();
  const analyzed = await Promise.all(breaches.map(async (breach) => {
    const [modelA, modelB] = await Promise.all([
      assessWithModel(client, MODEL_A, buildPrompt(breach)),
      assessWithModel(client, MODEL_B, buildPrompt(breach)),
    ]);
    const difference = Math.abs(modelA.severity_score - modelB.severity_score);

    return {
      name: breach.name,
      finalScore: difference <= 25
        ? Math.round((modelA.severity_score + modelB.severity_score) / 2)
        : Math.max(modelA.severity_score, modelB.severity_score),
      status: difference <= 25 ? 'consensus' : 'disputed',
      modelA,
      modelB,
    };
  }));

  const overallRiskScore = Math.round(
    analyzed.reduce((sum, breach) => sum + breach.finalScore, 0) / analyzed.length,
  );

  return {
    email,
    totalBreaches: analyzed.length,
    overallRiskScore,
    breaches: analyzed,
  };
}

export { analyzeBreachSeverity };
