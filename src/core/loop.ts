// The agent loop: THINK -> ROUTE -> ACT -> OBSERVE -> RESPOND.
// maxSteps and toolBudget are hard caps and are actually enforced (a budget of 0
// means zero tools execute, not "tools discouraged").

import type { LoopStep, Msg, RunOptions, RunResult, ToolCall, ToolCallRecord, ToolSpec } from './types.ts';
import { TOOL_MAP, selectTools } from './tools.ts';
import { chatWithFallback, specOf } from './providers.ts';
import { matchIntent } from './intents.ts';
import { reflex } from './reflex.ts';
import { scan, networkAllowed } from './privacy.ts';
import { estTokens, uid } from './util.ts';

function fmtToolResult(r: ToolCallRecord): string {
  const head = `${r.tool} -> ${r.ok ? 'ok' : 'failed'}: ${r.summary}`;
  return r.detail ? `${head}\n${r.detail.slice(0, 1200)}` : head;
}

export async function executeTool(
  call: ToolCall,
  opts: Pick<RunOptions, 'ctx' | 'privacy'>,
): Promise<ToolCallRecord> {
  const t0 = Date.now();
  const base = { ...call, id: uid('call'), ms: 0 };
  const spec: ToolSpec | undefined = TOOL_MAP[call.tool];
  if (!spec) {
    return { ...base, ok: false, summary: `Unknown tool "${call.tool}"`, ms: Date.now() - t0, blocked: true, reason: 'not-registered' };
  }
  if (spec.network && !networkAllowed(opts.privacy)) {
    return {
      ...base,
      ok: false,
      blocked: true,
      reason: 'privacy',
      summary: `${spec.name} needs network access, which STRICT privacy mode blocks. Switch to Guarded in Settings to allow it.`,
      ms: Date.now() - t0,
    };
  }
  if (spec.approval) {
    const granted = await opts.ctx.approve(spec.name, call.args);
    if (!granted) {
      return { ...base, ok: false, blocked: true, reason: 'denied', summary: `${spec.name} was not approved, so it did not run.`, ms: Date.now() - t0 };
    }
  }
  try {
    const out = await spec.run(call.args, opts.ctx);
    return { ...base, ok: out.ok, summary: out.summary, detail: out.detail, ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, ok: false, summary: `${spec.name} threw: ${e instanceof Error ? e.message : String(e)}`, ms: Date.now() - t0 };
  }
}

export async function runAgent(messages: Msg[], opts: RunOptions): Promise<RunResult> {
  const steps: LoopStep[] = [];
  const calls: ToolCallRecord[] = [];
  const t0 = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  let budget = opts.mode.toolBudget;

  const step = (kind: LoopStep['kind'], label: string, detail?: string): void => {
    const s: LoopStep = { kind, label, detail, ts: Date.now(), ms: Date.now() - t0 };
    steps.push(s);
    opts.onStep?.(s);
  };

  const userMsg = [...messages].reverse().find((m) => m.role === 'user');
  const prompt = userMsg?.content ?? '';

  /* ---------------- THINK: deterministic shortcuts ---------------- */
  step('think', 'Reading the request', `${prompt.length} chars, mode "${opts.mode.name}"`);
  const hit = matchIntent(prompt);

  if (hit?.canned && hit.text) {
    step('respond', hit.reason ? `Not possible here: ${hit.intent.label}` : `Answered from rule "${hit.intent.id}"`, 'zero model calls');
    return { text: hit.text, steps, calls, via: 'reflex', degraded: false, tokensIn: 0, tokensOut: estTokens(hit.text) };
  }

  if (hit?.call && budget > 0) {
    step('route', `Direct dispatch: ${hit.intent.label}`, `no model call needed -> ${hit.call.tool}`);
    const rec = await executeTool(hit.call, opts);
    calls.push(rec);
    budget--;
    step(rec.ok ? 'observe' : 'error', `${rec.tool}: ${rec.summary}`, rec.detail);
    if (rec.ok) {
      const text = rec.detail && rec.detail.length > rec.summary.length ? `${rec.summary}\n\n\`\`\`\n${rec.detail.slice(0, 2000)}\n\`\`\`` : rec.summary;
      step('respond', 'Returned tool result directly');
      return { text, steps, calls, via: 'tool', degraded: false, tokensIn: 0, tokensOut: estTokens(text) };
    }
    // Tool failed: fall through to the model, which now has the failure as context.
  }

  /* ---------------- ROUTE: pick provider and tool subset ---------------- */
  const spec = specOf(opts.provider.id);
  const available = opts.mode.toolBudget > 0 ? selectTools(prompt, opts.mode.groups, 8).filter((t) => !(t.network && !networkAllowed(opts.privacy))) : [];
  step('route', `Provider ${spec.label}`, `${available.length} tool(s) offered, budget ${budget}, maxSteps ${opts.mode.maxSteps}`);

  if (opts.provider.id === 'reflex') {
    const r = reflex(messages, opts.ctx.memory.all());
    step('respond', `Reflex core (${r.rule})`);
    return { text: r.text, steps, calls, via: 'reflex', degraded: true, tokensIn: 0, tokensOut: estTokens(r.text) };
  }

  /* ---------------- ACT / OBSERVE ---------------- */
  const work: Msg[] = messages.map((m) => {
    const s = scan(m.content, opts.privacy);
    if (s.findings.length) step('think', `Redacted ${s.findings.length} sensitive item(s) before sending`, s.findings.map((f) => `${f.label} x${f.count}`).join(', '));
    return { ...m, content: s.clean };
  });

  let finalText = '';
  let via = spec.id as string;
  let degraded = false;
  let lastError: string | undefined;

  for (let i = 0; i < opts.mode.maxSteps; i++) {
    tokensIn += work.reduce((n, m) => n + estTokens(m.content), 0);
    const res = await chatWithFallback(
      {
        provider: opts.provider,
        messages: work,
        system: opts.mode.system,
        tools: budget > 0 ? available : [],
        temperature: opts.mode.temperature,
        signal: opts.signal,
        onToken: opts.onToken,
      },
      {
        chain: opts.chain,
        allowKeyless: opts.allowKeyless,
        onHop: (h) => {
          if (!h.ok) step('route', `${specOf(h.provider).label} unavailable`, h.error);
          else if (h.provider !== opts.provider.id) step('route', `Fell back to ${specOf(h.provider).label}`);
        },
      },
    );
    tokensOut += estTokens(res.text);
    via = res.via;
    degraded = degraded || !!res.degraded;
    lastError = res.error;

    if (res.error && !res.text) {
      const r = reflex(messages, opts.ctx.memory.all(), res.error);
      step('error', 'All providers failed; using the reflex core', res.error);
      step('respond', `Reflex core (${r.rule})`);
      return { text: r.text, steps, calls, via: 'reflex', degraded: true, tokensIn, tokensOut: estTokens(r.text) };
    }

    if (!res.toolCalls.length) {
      finalText = res.text;
      break;
    }

    // Trim the batch to what the budget can afford rather than dropping the
    // whole step: a partially affordable batch still does the work it can.
    const wanted = res.toolCalls.slice(0, Math.max(0, budget));
    const skipped = res.toolCalls.length - wanted.length;
    if (skipped > 0) {
      step('budget', `Tool budget reached; ${skipped} call(s) not run`, `mode "${opts.mode.name}" allows ${opts.mode.toolBudget}`);
    }

    if (!wanted.length) {
      // Budget is gone. Instead of hard-failing, ask for an answer built from
      // the results already gathered - the user gets a real reply either way.
      if (calls.length) {
        work.push({
          id: uid('m'),
          role: 'user',
          content:
            `SYSTEM: The tool budget of ${opts.mode.toolBudget} call(s) is exhausted. ` +
            'Answer now, in plain prose, using only the tool results already provided. Do not request another tool.',
          ts: Date.now(),
        });
        tokensIn += work.reduce((n, m) => n + estTokens(m.content), 0);
        const last = await chatWithFallback(
          {
            provider: opts.provider,
            messages: work,
            system: opts.mode.system,
            temperature: opts.mode.temperature,
            signal: opts.signal,
            tools: [],
          },
          { chain: opts.chain, allowKeyless: opts.allowKeyless },
        );
        tokensOut += estTokens(last.text);
        via = last.via;
        degraded = degraded || !!last.degraded;
        finalText =
          last.text.trim() ||
          `I used all ${opts.mode.toolBudget} tool call(s) this mode allows before finishing. Here is what the tools returned:\n\n${calls
            .map(fmtToolResult)
            .join('\n\n')}`;
      } else {
        finalText =
          res.text.trim() ||
          `This mode ("${opts.mode.name}") allows ${opts.mode.toolBudget} tool call(s), so I could not run the tools this needs. Switch to Deep work mode for a larger budget.`;
      }
      break;
    }

    step('act', `Running ${wanted.length} tool(s)`, wanted.map((c) => c.tool).join(', '));
    const results = await Promise.all(wanted.map((c) => executeTool(c, opts)));
    budget -= results.length;
    for (const r of results) {
      calls.push(r);
      step(r.ok ? 'observe' : 'error', `${r.tool}: ${r.summary}`, r.detail);
    }

    if (res.text.trim()) work.push({ id: uid('m'), role: 'assistant', content: res.text, ts: Date.now() });
    work.push({
      id: uid('m'),
      role: 'user',
      content: `Tool results:\n${results.map(fmtToolResult).join('\n\n')}\n\nUsing only these results, answer the original question in plain prose. Do not call more tools unless something is genuinely missing.`,
      ts: Date.now(),
    });

    if (i === opts.mode.maxSteps - 1) {
      step('budget', `Reached the ${opts.mode.maxSteps}-step ceiling for mode "${opts.mode.name}"`);
      finalText = res.text || results.map((r) => `${r.tool}: ${r.summary}`).join('\n');
    }
  }

  if (!finalText.trim()) {
    const r = reflex(messages, opts.ctx.memory.all(), lastError);
    step('respond', `Empty model output; reflex core (${r.rule})`);
    return { text: r.text, steps, calls, via: 'reflex', degraded: true, tokensIn, tokensOut: estTokens(r.text) };
  }

  step('respond', `Answered via ${specOf(via as never)?.label ?? via}`, `${calls.length} tool call(s), ${tokensIn + tokensOut} est. tokens`);
  return { text: finalText, steps, calls, via, degraded, tokensIn, tokensOut };
}
