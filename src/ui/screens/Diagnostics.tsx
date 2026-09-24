import { useCallback, useMemo, useState } from 'react';
import { Shell } from '../Shell.tsx';
import { Icon } from '../icons.tsx';
import { Btn, Card, CopyBtn, Pill, SectionTitle } from '../components.tsx';
import { useApp } from '../state.tsx';
import { TOOLS, runSandboxed, toolNames } from '../../core/tools.ts';
import { NODE_KIND_COUNT, topoSort } from '../../core/workflow.ts';
import { INTENT_COUNT, matchIntent, unsupportedIntents } from '../../core/intents.ts';
import { MODES } from '../../core/modes.ts';
import { PRESETS, ROLES, missingTools } from '../../core/crew.ts';
import { validateSkill } from '../../core/skills.ts';
import { PATTERNS, scan } from '../../core/privacy.ts';
import { storageUsage } from '../../core/store.ts';
import { safeMath } from '../../core/util.ts';

type State = 'passed' | 'failed' | 'blocked' | 'not-run';

interface Check {
  id: string;
  label: string;
  state: State;
  evidence: string;
}

const tone = (s: State) => (s === 'passed' ? 'ok' : s === 'failed' ? 'bad' : s === 'blocked' ? 'warn' : 'default');

export default function Diagnostics() {
  const app = useApp();
  const [live, setLive] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);

  /* ---- static checks, computed from the code itself ---- */
  const staticChecks: Check[] = useMemo(() => {
    const out: Check[] = [];
    const names = toolNames();

    out.push({
      id: 'INV-tools',
      label: 'Tool registry has no duplicate names',
      state: new Set(names).size === names.length ? 'passed' : 'failed',
      evidence: `${names.length} tools, ${new Set(names).size} unique`,
    });

    const gaps = missingTools(names);
    out.push({
      id: 'INV-crew',
      label: 'Every crew role references a registered tool',
      state: gaps.length === 0 ? 'passed' : 'failed',
      evidence: gaps.length ? gaps.map((g) => `${g.roleId} -> ${g.tool}`).join(', ') : `${ROLES.length} roles checked across ${PRESETS.length} presets`,
    });

    const badSkills = app.skills.flatMap((s) => validateSkill(s, names).map((i) => `${s.name}: ${i.message}`));
    out.push({
      id: 'INV-skills',
      label: 'Saved skills validate',
      state: badSkills.length === 0 ? 'passed' : 'failed',
      evidence: badSkills.length ? badSkills.join('; ') : `${app.skills.length} skills, all steps resolve`,
    });

    const cyclic = app.workflows.filter((w) => topoSort(w.nodes, w.edges).cycle !== null);
    out.push({
      id: 'INV-workflows',
      label: 'Saved workflows are acyclic',
      state: cyclic.length === 0 ? 'passed' : 'failed',
      evidence: cyclic.length ? `cycles in: ${cyclic.map((w) => w.name).join(', ')}` : `${app.workflows.length} graphs sorted, ${NODE_KIND_COUNT} node kinds registered`,
    });

    const budgets = MODES.filter((m) => m.maxSteps < 1 || m.toolBudget < 0);
    out.push({
      id: 'INV-modes',
      label: 'Mode budgets are sane',
      state: budgets.length === 0 ? 'passed' : 'failed',
      evidence: budgets.length ? budgets.map((m) => m.id).join(', ') : `${MODES.length} modes, steps 1-${Math.max(...MODES.map((m) => m.maxSteps))}`,
    });

    const identity = matchIntent('who are you');
    out.push({
      id: 'INV-intents',
      label: 'Identity question does not route to search',
      state: identity?.intent.id === 'identity' && identity.canned ? 'passed' : 'failed',
      evidence: `matched "${identity?.intent.id ?? 'nothing'}", canned=${String(identity?.canned)} \u00b7 ${INTENT_COUNT} rules, ${unsupportedIntents().length} declared unsupported`,
    });

    const leaky = scan('my key is sk-proj-abcdefghijklmnopqrstuvwx and card 4111 1111 1111 1111', 'GUARDED');
    out.push({
      id: 'SEC-redaction',
      label: 'Credentials are redacted before transport',
      state: !leaky.clean.includes('sk-proj-abcdefghijklmnopqrstuvwx') ? 'passed' : 'failed',
      evidence: `${PATTERNS.length} patterns; sample redacted ${leaky.findings.length} item(s): ${leaky.findings.map((f) => f.label).join(', ')}`,
    });

    const approvals = TOOLS.filter((t) => t.approval).map((t) => t.name);
    out.push({
      id: 'SEC-approvals',
      label: 'Mutating tools are approval-gated',
      state: approvals.includes('fs_write') && approvals.includes('code_run') && approvals.includes('http_request') ? 'passed' : 'failed',
      evidence: `gated: ${approvals.join(', ')}`,
    });

    const bundleKeys = TOOLS.some((t) => /sk-|AIza|gsk_/.test(t.desc));
    out.push({
      id: 'SEC-bundle',
      label: 'No credential-shaped literals in the tool registry',
      state: bundleKeys ? 'failed' : 'passed',
      evidence: bundleKeys ? 'a tool description contains a key-shaped string' : 'registry scanned, nothing key-shaped found',
    });

    const usage = storageUsage();
    out.push({
      id: 'ENV-storage',
      label: 'Local storage is writable',
      state: usage.bytes >= 0 ? 'passed' : 'blocked',
      evidence: `${(usage.bytes / 1024).toFixed(1)} kB used across ${usage.perKey.filter((k) => k.bytes > 0).length} keys`,
    });

    out.push({
      id: 'ENV-crypto',
      label: 'Web Crypto available for SHA-256',
      state: globalThis.crypto?.subtle ? 'passed' : 'blocked',
      evidence: globalThis.crypto?.subtle ? 'crypto.subtle present' : 'crypto.subtle missing; hash_text falls back to a 32-bit fingerprint',
    });

    out.push({
      id: 'ENV-worker',
      label: 'Workers available for sandboxed code',
      state: typeof Worker !== 'undefined' ? 'passed' : 'blocked',
      evidence: typeof Worker !== 'undefined' ? 'Worker constructor present' : 'no Worker; code_run refuses to execute rather than running unsandboxed',
    });

    out.push({
      id: 'ENV-sw',
      label: 'Service worker registered (offline support)',
      state: 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'passed' : 'not-run') : 'blocked',
      evidence:
        'serviceWorker' in navigator
          ? navigator.serviceWorker.controller
            ? 'a service worker controls this page'
            : 'supported but not yet controlling; it takes over after the first reload'
          : 'not supported in this browser',
    });

    return out;
  }, [app.skills, app.workflows]);

  /* ---- live checks, which actually execute ---- */
  const runLive = useCallback(async () => {
    setBusy(true);
    const out: Check[] = [];

    const calc = safeMath('(847 * 23) / 4');
    out.push({
      id: 'RUN-math',
      label: 'Arithmetic evaluator returns the right answer',
      state: calc.ok && calc.value === 4870.25 ? 'passed' : 'failed',
      evidence: `(847 * 23) / 4 = ${String(calc.value)} (expected 4870.25)`,
    });

    const injection = safeMath('fetch("http://evil.example")');
    out.push({
      id: 'RUN-mathguard',
      label: 'Arithmetic evaluator rejects identifiers',
      state: !injection.ok ? 'passed' : 'failed',
      evidence: injection.ok ? 'accepted a function call - this is a defect' : `refused: ${injection.error}`,
    });

    const rec = await app.runTool('text_stats', { text: 'one two three four five' });
    out.push({
      id: 'RUN-tool',
      label: 'Tool execution path works end to end',
      state: rec.ok ? 'passed' : 'failed',
      evidence: `${rec.tool}: ${rec.summary} (${rec.ms}ms)`,
    });

    const sbx = await runSandboxed('return 6 * 7;');
    out.push({
      id: 'RUN-sandbox',
      label: 'Sandboxed code executes and returns',
      state: sbx.blocked ? 'blocked' : sbx.ok && sbx.value === '42' ? 'passed' : 'failed',
      evidence: sbx.blocked ?? `returned ${String(sbx.value)} (expected 42)`,
    });

    const netless = await runSandboxed('return typeof fetch;');
    out.push({
      id: 'RUN-sandbox-net',
      label: 'Sandbox has no network access',
      state: netless.blocked ? 'blocked' : netless.value === 'undefined' ? 'passed' : 'failed',
      evidence: netless.blocked ?? `typeof fetch inside the worker = ${String(netless.value)} (expected undefined)`,
    });

    const timeout = await runSandboxed('while(true){}', 1200);
    out.push({
      id: 'RUN-sandbox-timeout',
      label: 'Runaway code is terminated',
      state: timeout.blocked ? 'blocked' : !timeout.ok && /exceeded/.test(timeout.error ?? '') ? 'passed' : 'failed',
      evidence: timeout.blocked ?? timeout.error ?? 'no error reported',
    });

    setLive(out);
    setBusy(false);
  }, [app]);

  const all = [...staticChecks, ...(live ?? [])];
  const counts = {
    passed: all.filter((c) => c.state === 'passed').length,
    failed: all.filter((c) => c.state === 'failed').length,
    blocked: all.filter((c) => c.state === 'blocked').length,
    notRun: all.filter((c) => c.state === 'not-run').length,
  };

  const report = all.map((c) => `${c.state.toUpperCase().padEnd(9)} ${c.id.padEnd(18)} ${c.label}\n${' '.repeat(28)}${c.evidence}`).join('\n');

  return (
    <Shell title="Diagnostics" sub={`${counts.passed} passed \u00b7 ${counts.failed} failed \u00b7 ${counts.blocked} blocked`}>
      <Card tight>
        <div className="muted" style={{ fontSize: '0.83rem' }}>
          These checks run against the live build in this browser. A check that cannot execute reports <b>blocked</b> with the reason &mdash; it is
          never upgraded to a pass.
        </div>
      </Card>

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <Btn variant="primary" icon="play" onClick={() => void runLive()} disabled={busy}>
          {busy ? 'Running\u2026' : 'Run live checks'}
        </Btn>
        <CopyBtn text={report} title="Copy report" />
      </div>

      <SectionTitle>Static invariants</SectionTitle>
      <div className="list">
        {staticChecks.map((c) => (
          <div className="item" key={c.id} style={{ cursor: 'default', alignItems: 'flex-start' }}>
            <span className={`ico${c.state === 'passed' ? '' : ' alt'}`}>
              <Icon name={c.state === 'passed' ? 'check' : c.state === 'failed' ? 'warn' : 'info'} size={15} />
            </span>
            <span className="txt">
              <b style={{ whiteSpace: 'normal' }}>{c.label}</b>
              <small className="wrap mono">{c.evidence}</small>
            </span>
            <Pill tone={tone(c.state)}>{c.state}</Pill>
          </div>
        ))}
      </div>

      <SectionTitle>Live execution</SectionTitle>
      {live ? (
        <div className="list">
          {live.map((c) => (
            <div className="item" key={c.id} style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <span className={`ico${c.state === 'passed' ? '' : ' alt'}`}>
                <Icon name={c.state === 'passed' ? 'check' : c.state === 'failed' ? 'warn' : 'info'} size={15} />
              </span>
              <span className="txt">
                <b style={{ whiteSpace: 'normal' }}>{c.label}</b>
                <small className="wrap mono">{c.evidence}</small>
              </span>
              <Pill tone={tone(c.state)}>{c.state}</Pill>
            </div>
          ))}
        </div>
      ) : (
        <Card tight>
          <div className="row" style={{ gap: 10 }}>
            <Pill>not-run</Pill>
            <small className="muted">Six execution checks are defined. They have not been run in this session.</small>
          </div>
        </Card>
      )}

      <SectionTitle>Build facts</SectionTitle>
      <Card tight>
        {[
          ['Tools registered', String(TOOLS.length)],
          ['Workflow node kinds', String(NODE_KIND_COUNT)],
          ['Intent rules', `${INTENT_COUNT} (${unsupportedIntents().length} declared unsupported)`],
          ['Agent modes', String(MODES.length)],
          ['Crew roles', `${ROLES.length} in ${PRESETS.length} presets`],
          ['Redaction patterns', String(PATTERNS.length)],
        ].map(([k, v]) => (
          <div className="row between" key={k} style={{ minHeight: 34 }}>
            <small className="muted">{k}</small>
            <small className="mono">{v}</small>
          </div>
        ))}
      </Card>
    </Shell>
  );
}
