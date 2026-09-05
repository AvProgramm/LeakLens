/**
 * contract.test.js
 * Locks the shared breach JSON contract that the dashboard and the AI layer
 * both code against. The contract's central promise is that downstream code
 * never has to null-check, so most of these tests are about the shape being
 * complete even when XposedOrNot sends almost nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeBreachData } from '../src/shapeBreachData.js';

// A realistic slice of a real XON breach-analytics response.
const rawXonResponse = {
  ExposedBreaches: {
    breaches_details: [
      {
        breach: 'SweClockers',
        domain: 'sweclockers.com',
        industry: 'Electronics',
        xposed_date: '2015-03-01',
        xposed_records: 254967,
        password_risk: 'hardtocrack',
        xposed_data: 'Usernames;Email addresses;Passwords',
        description: 'A Swedish tech forum breach.',
      },
    ],
  },
  // The REAL live shape: each of these is a 1-element array wrapping one
  // flat object, not the [label, count] pairs XON's docs imply.
  BreachMetrics: {
    risk: [{ risk_label: 'Low', risk_score: 23 }],
    passwords_strength: [{ EasyToCrack: 0, PlainText: 0, StrongHash: 1, Unknown: 0 }],
    yearwise_details: [{ y2014: 0, y2015: 1 }],
  },
  PastesSummary: { cnt: 0 },
};

test('clean email produces a complete, null-free contract', () => {
  const shaped = shapeBreachData('clean@example.com', {});

  assert.equal(shaped.exposed, false);
  assert.equal(shaped.breachCount, 0);
  assert.equal(shaped.riskScore, 0);
  assert.equal(shaped.riskLabel, 'None');
  assert.deepEqual(shaped.breaches, []);
  assert.deepEqual(shaped.pastes, { count: 0 });

  // The no-null-check promise: every documented field is present.
  for (const requiredField of [
    'email', 'checkedAt', 'exposed', 'breachCount', 'riskScore',
    'riskLabel', 'breaches', 'passwordStrength', 'yearlyBreakdown', 'pastes',
  ]) {
    assert.ok(shaped[requiredField] !== undefined, `missing field: ${requiredField}`);
    assert.ok(shaped[requiredField] !== null, `null field: ${requiredField}`);
  }
});

test('a null XON response does not throw', () => {
  const shaped = shapeBreachData('a@b.com', null);
  assert.equal(shaped.exposed, false);
  assert.deepEqual(shaped.breaches, []);
});

test('breach details map onto the documented field names', () => {
  const shaped = shapeBreachData('user@example.com', rawXonResponse);

  assert.equal(shaped.exposed, true);
  assert.equal(shaped.breachCount, 1);

  const [breach] = shaped.breaches;
  assert.equal(breach.name, 'SweClockers');
  assert.equal(breach.domain, 'sweclockers.com');
  assert.equal(breach.industry, 'Electronics');
  assert.equal(breach.recordsExposed, 254967);
  assert.equal(breach.passwordRisk, 'hardtocrack');
  assert.deepEqual(breach.dataExposed, ['Usernames', 'Email addresses', 'Passwords']);
});

test('a full date is reduced to the year the contract promises', () => {
  const shaped = shapeBreachData('user@example.com', rawXonResponse);
  assert.equal(shaped.breaches[0].year, '2015');
});

test('counts are numbers even when XON sends them as strings', () => {
  const stringyResponse = {
    ExposedBreaches: {
      breaches_details: [{ breach: 'X', xposed_records: '1000', xposed_data: 'Email addresses' }],
    },
    BreachMetrics: {
      passwords_strength: [{ StrongHash: '3', EasyToCrack: '2', PlainText: '0', Unknown: '0' }],
      yearwise_details: [{ y2019: '4' }],
    },
  };

  const shaped = shapeBreachData('user@example.com', stringyResponse);

  assert.equal(typeof shaped.breaches[0].recordsExposed, 'number');
  assert.equal(shaped.breaches[0].recordsExposed, 1000);
  assert.equal(shaped.passwordStrength.strongHash, 3);
  assert.equal(shaped.passwordStrength.easyToCrack, 2);
  assert.equal(shaped.yearlyBreakdown['2019'], 4);

  // The bug this guards: string counts must add, not concatenate.
  assert.equal(shaped.passwordStrength.strongHash + shaped.passwordStrength.easyToCrack, 5);
});

// XON's real BreachMetrics shape differs from their published docs. Parsing
// it as [label, count] pairs returns all zeros WITHOUT erroring, so these
// assertions are what stop that silent regression coming back.
test('password strength is read from the live 1-element-array shape', () => {
  const shaped = shapeBreachData('user@example.com', {
    BreachMetrics: {
      passwords_strength: [{ EasyToCrack: 50, PlainText: 22, StrongHash: 50, Unknown: 92 }],
    },
  });

  assert.deepEqual(shaped.passwordStrength, {
    strongHash: 50, easyToCrack: 50, plainText: 22, unknown: 92,
  });
});

test('yearly breakdown strips the y prefix and drops empty years', () => {
  const shaped = shapeBreachData('user@example.com', {
    BreachMetrics: { yearwise_details: [{ y2007: 0, y2009: 1, y2015: 10 }] },
  });

  assert.deepEqual(shaped.yearlyBreakdown, { 2009: 1, 2015: 10 });
});

test("riskScore uses XON's own 0-100 score and label", () => {
  const shaped = shapeBreachData('user@example.com', {
    ExposedBreaches: { breaches_details: [{ breach: 'X' }] },
    BreachMetrics: { risk: [{ risk_label: 'Critical', risk_score: 100 }] },
  });

  assert.equal(shaped.riskScore, 100);
  assert.equal(shaped.riskLabel, 'Critical');
});

test('the heuristic only applies when XON omits risk entirely', () => {
  const shaped = shapeBreachData('user@example.com', {
    ExposedBreaches: { breaches_details: [{ breach: 'X' }, { breach: 'Y' }] },
  });

  assert.equal(shaped.riskScore, 40);
  assert.equal(shaped.riskLabel, 'Medium');
});

test('xposed_data already an array is passed through unchanged', () => {
  const shaped = shapeBreachData('user@example.com', {
    ExposedBreaches: {
      breaches_details: [{ breach: 'Y', xposed_data: ['Email addresses', 'Phone numbers'] }],
    },
  });
  assert.deepEqual(shaped.breaches[0].dataExposed, ['Email addresses', 'Phone numbers']);
});
