import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './.build/core.mjs';
const { providerForMode, OPENAI_MODELS, isOpenAIReasoningModel, specOf } = C;

test('per-mode model: Build uses the code-tier override, everything else the day-to-day model', () => {
  const p = { id: 'openai', key: 'k', model: 'gpt-6-luna', modelByTier: { code: 'gpt-6-sol' } };
  assert.equal(providerForMode(p, 'build').model, 'gpt-6-sol');
  assert.equal(providerForMode(p, 'assist').model, 'gpt-6-luna');
  assert.equal(providerForMode(p, 'agent').model, 'gpt-6-luna');
  assert.equal(providerForMode({ ...p, modelByTier: undefined }, 'build').model, 'gpt-6-luna');
});

test('OpenAI catalog: every active GPT chat model is selectable, GPT-6 first, no duplicates', () => {
  const ids = specOf('openai').models;
  assert.deepEqual(ids.slice(0, 3), ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-terra', 'gpt-4o-mini', 'o4-mini']) assert.ok(ids.includes(id), id);
  assert.equal(specOf('openai').model, 'gpt-6-luna');
  assert.equal(OPENAI_MODELS.length, ids.length);
});

test('reasoning-model detection (these reject temperature)', () => {
  for (const m of ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-luna', 'gpt-5', 'o3', 'o4-mini']) assert.ok(isOpenAIReasoningModel(m), m);
  for (const m of ['gpt-4o', 'gpt-4.1-mini', 'gpt-4o-mini']) assert.ok(!isOpenAIReasoningModel(m), m);
});
