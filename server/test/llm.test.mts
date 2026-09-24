import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samplingParams, isReasoningModel, DEFAULT_MODEL } from '../src/llm.ts';

test('default server model is GPT-5.6 Luna', () => {
  assert.equal(DEFAULT_MODEL, 'gpt-5.6-luna');
  assert.ok(isReasoningModel('gpt-5.6-luna'));
  assert.ok(isReasoningModel('o4-mini'));
  assert.ok(!isReasoningModel('gpt-4o-mini'));
});

test('reasoning models never receive temperature or max_tokens', () => {
  delete process.env.OPENAI_REASONING_EFFORT;
  const p = samplingParams('gpt-5.6-luna', { temperature: 0.4, maxTokens: 400, effort: 'low' });
  assert.deepEqual(p, { max_completion_tokens: 400, reasoning_effort: 'low' });
  const q = samplingParams('gpt-4o-mini', { temperature: 0.4, maxTokens: 400, effort: 'low' });
  assert.deepEqual(q, { temperature: 0.4, max_tokens: 400 });
});

test('OPENAI_REASONING_EFFORT overrides the per-call default when valid', () => {
  process.env.OPENAI_REASONING_EFFORT = 'high';
  assert.equal(samplingParams('gpt-5.6-luna', { effort: 'low' }).reasoning_effort, 'high');
  process.env.OPENAI_REASONING_EFFORT = 'bogus';
  assert.equal(samplingParams('gpt-5.6-luna', { effort: 'low' }).reasoning_effort, 'low');
  delete process.env.OPENAI_REASONING_EFFORT;
});
