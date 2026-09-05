/**
 * verifyGonka.js
 * Pre-demo confidence check. Run `npm run verify-gonka` after putting your
 * key in .env and it answers the four questions that decide whether the
 * live demo works:
 *
 *   1. Is a key loaded at all?
 *   2. Does the router accept it?
 *   3. Do the two model IDs we are configured to use actually exist?
 *   4. Does a real inference come back with a usable Request ID?
 *
 * It never prints the key itself - only a masked fingerprint - so this is
 * safe to run while screen-sharing.
 */

import {
  createGonkaClient,
  callGonkaModel,
  listAvailableModels,
} from '../src/gonkaClient.js';
import {
  GONKA_API_KEY,
  GONKA_BASE_URL,
  GONKA_MODEL_PRIMARY,
  GONKA_MODEL_SECONDARY,
} from '../src/config.js';

// Show only enough of the key to confirm the right one loaded.
function maskKey(key) {
  if (!key) return '(none)';
  if (key.length <= 10) return '****';
  return `${key.slice(0, 6)}...${key.slice(-4)} (${key.length} chars)`;
}

function printHeading(text) {
  console.log(`\n${text}`);
  console.log('-'.repeat(text.length));
}

async function main() {
  printHeading('1. Configuration');
  console.log(`   Base URL : ${GONKA_BASE_URL}`);
  console.log(`   API key  : ${maskKey(GONKA_API_KEY)}`);
  console.log(`   Models   : ${GONKA_MODEL_PRIMARY} , ${GONKA_MODEL_SECONDARY}`);

  if (!GONKA_API_KEY) {
    console.error('\n   FAIL: no GONKA_API_KEY found.');
    console.error('   Fix: copy .env.example to .env and paste your key into it.');
    process.exit(1);
  }

  const client = createGonkaClient();

  printHeading('2. Model catalogue');
  let availableModels = [];
  try {
    availableModels = await listAvailableModels(client);
    console.log(`   Router accepted the key. ${availableModels.length} models reachable:`);
    for (const modelId of availableModels) console.log(`     - ${modelId}`);
  } catch (error) {
    console.error(`   Could not list models: ${error.message}`);
    if (error.status === 401) {
      console.error('   That is an auth failure - the key was rejected.');
      process.exit(1);
    }
    console.error('   Continuing anyway; some routers do not expose /models.');
  }

  printHeading('3. Configured models present?');
  for (const configuredModel of [GONKA_MODEL_PRIMARY, GONKA_MODEL_SECONDARY]) {
    if (availableModels.length === 0) {
      console.log(`   ?  ${configuredModel} - catalogue unavailable, will test directly`);
    } else if (availableModels.includes(configuredModel)) {
      console.log(`   OK ${configuredModel}`);
    } else {
      console.log(`   !! ${configuredModel} NOT in the catalogue above.`);
      console.log('      Copy an exact ID from the list into .env - they are case-sensitive.');
    }
  }

  printHeading('4. Live inference + Request ID');
  let anyModelWorked = false;
  for (const modelToTest of [GONKA_MODEL_PRIMARY, GONKA_MODEL_SECONDARY]) {
    try {
      const result = await callGonkaModel(
        client,
        modelToTest,
        'Reply with exactly this JSON and nothing else: {"ok": true}',
      );
      anyModelWorked = true;
      console.log(`   OK ${modelToTest}`);
      console.log(`      reply      : ${result.text.slice(0, 80)}`);
      console.log(`      request id : ${result.requestId ?? '(none returned)'}`);
      console.log(`      id source  : ${result.requestIdSource}`);
    } catch (error) {
      console.log(`   !! ${modelToTest} failed: ${error.message}`);
    }
  }

  printHeading('Verdict');
  if (anyModelWorked) {
    console.log('   Gonka integration is LIVE. The dashboard AI panel will work.');
    process.exit(0);
  }
  console.log('   No model responded. Fix the model IDs or key before demoing.');
  process.exit(1);
}

main().catch((error) => {
  console.error('\nUnexpected failure:', error.message);
  process.exit(1);
});
