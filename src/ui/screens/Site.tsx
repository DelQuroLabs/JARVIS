import type { ReactNode } from 'react';
import { Icon, Logo, type IconName } from '../icons.tsx';
import { Link, navigate } from '../router.tsx';
import { Btn } from '../components.tsx';
import { TOOLS } from '../../core/tools.ts';
import { NODE_KIND_COUNT } from '../../core/workflow.ts';
import { ROLES, PRESETS } from '../../core/crew.ts';
import { MODES } from '../../core/modes.ts';
import { INTENT_COUNT, unsupportedIntents } from '../../core/intents.ts';
import { PATTERNS } from '../../core/privacy.ts';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <header className="sitenav">
        <Link to="/former-landing" className="brand">
          <Logo size={26} />
          <span>JARVIS</span>
        </Link>
        <nav>
          <Link to="/guide">Guide</Link>
          <Link to="/privacy">Privacy</Link>
          <a href="#/app" onClick={(e) => { e.preventDefault(); navigate('/app'); }} className="btn primary sm" style={{ marginLeft: 6 }}>
            Open app
          </a>
        </nav>
      </header>
      {children}
      <footer className="footer">
        <div className="row between">
          <div className="row" style={{ gap: 8 }}>
            <Logo size={18} />
            <span>JARVIS &middot; local-first agent workspace</span>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <Link to="/guide">Guide</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/app/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p style={{ marginTop: 14, maxWidth: '62ch' }}>
          No account required, no analytics, no telemetry. Bring your own free model key, or run entirely offline on the built-in reflex core.
        </p>
      </footer>
    </div>
  );
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'agent', title: 'An agent loop you can watch', body: 'Think, route, act, observe, respond. Every step is shown as it happens, with the provider that answered and the tools that ran. Step and tool budgets are enforced, not suggested.' },
  { icon: 'tools', title: `${TOOLS.length} real tools`, body: 'Maths, text, data, hashing, encoding, keyless search and weather, a virtual filesystem, and JavaScript that executes in an isolated Worker with networking stripped out.' },
  { icon: 'flow', title: `Workflows with ${NODE_KIND_COUNT} node kinds`, body: 'Branch, loop, classify, call tools and call the model. Cycles are refused at edit time and at run time. Unreached branches report as skipped, never as failed.' },
  { icon: 'crew', title: `A crew of ${ROLES.length} roles`, body: `${PRESETS.length} presets, from a ship review to a threat model. Each role reads the whole prior transcript, so it argues with the last one instead of repeating it.` },
  { icon: 'shield', title: 'Privacy that does something', body: `${PATTERNS.length} secret patterns are scanned out of every outbound payload. Strict mode disables network tools entirely. Credentials are never transmitted at any level.` },
  { icon: 'cloud', title: 'Your server, or nothing', body: 'Sync is optional and connects to your own JARVIS server. Authenticate with your GitHub account — only you can read and write your data.' },
];

const MATRIX: [string, string, string][] = [
  ['Chat with tool use', 'Yes', 'Text protocol on providers without native function calling'],
  ['Autonomous task loop', 'Yes', `${MODES.length} modes, each with an enforced step and tool budget`],
  ['Run generated code', 'Yes, sandboxed', 'Worker with fetch, XHR, WebSocket and importScripts removed; 4s timeout'],
  ['Read and write files', 'Virtual only', 'An in-memory workspace. There is no access to your real filesystem'],
  ['Web search', 'Keyless, limited', 'DuckDuckGo instant answers, then Wikipedia. Good for encyclopedic queries, poor for news'],
  ['Fetch a URL', 'CORS permitting', 'Browsers block cross-origin reads unless the site opts in. The tool says so instead of failing silently'],
  ['Works offline', 'Yes', 'Installable PWA. Tools, skills, workflows and the reflex core all run with no network'],
  ['Wake word', 'No', 'A web page cannot listen in the background. Anything claiming otherwise on the web is not doing what it says'],
  ['Control your computer', 'No', 'No launching apps, no locking the screen, no reading battery or CPU. The browser sandbox forbids it'],
  ['Send email or SMS', 'No', 'That needs a server-side credential. Nothing privileged is shipped in this bundle'],
];

/** Former landing page. Parked at /former-landing; nothing links to it. */
export function Landing() {
  return (
    <Frame>
      <section className="hero">
        <span className="eyebrow">
          <Icon name="spark" size={13} />
          Local-first &middot; free model tiers &middot; installable
        </span>
        <h1>
          An agent workspace that <em>tells you the truth</em> about what it did.
        </h1>
        <p className="lede">
          JARVIS plans, uses tools, runs code in a sandbox, and remembers what you tell it to. It runs in your browser, stores everything on your
          device, and shows you which provider answered and which tools actually ran &mdash; including when the answer came from the offline core.
        </p>
        <div className="cta">
          <Btn variant="primary" icon="chat" onClick={() => navigate('/app')}>
            Open the app
          </Btn>
          <Btn icon="file" onClick={() => navigate('/guide')}>
            Read the guide
          </Btn>
        </div>
        <p className="dim" style={{ marginTop: 18, fontSize: '0.84rem' }}>
          No sign-up. Works with no API key at all &mdash; add a free Groq or Gemini key when you want full reasoning.
        </p>
      </section>

      <div className="feat">
        {FEATURES.map((f) => (
          <div className="f" key={f.title}>
            <div className="ico">
              <Icon name={f.icon} size={18} />
            </div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 46, marginBottom: 6 }}>What it can and cannot do</h2>
      <p className="muted" style={{ marginBottom: 18, maxWidth: '60ch' }}>
        Every row here is checkable in the app. The ones marked &ldquo;no&rdquo; are platform limits, and JARVIS explains them at the moment you
        ask rather than failing quietly.
      </p>
      <table className="matrix">
        <thead>
          <tr>
            <th>Capability</th>
            <th>Status</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {MATRIX.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>
                <span className={`pill ${b.startsWith('No') ? 'bad' : b.startsWith('Yes') ? 'ok' : 'warn'}`}>{b}</span>
              </td>
              <td className="muted">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 46, marginBottom: 6 }}>Zero model calls where none are needed</h2>
      <p className="muted" style={{ maxWidth: '62ch' }}>
        {INTENT_COUNT} deterministic rules answer common requests instantly and for free &mdash; arithmetic, unit conversion, dates, hashing,
        encoding, memory writes. {unsupportedIntents().length} of them exist purely to explain something the platform cannot do, because a clear
        &ldquo;no, and here is why&rdquo; beats a confident wrong answer.
      </p>

      <div className="card" style={{ marginTop: 30 }}>
        <div className="row between wrap" style={{ gap: 14 }}>
          <div>
            <h3>Try it without deciding anything</h3>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: 4 }}>
              It works before you configure a thing. Add a key later, or never.
            </p>
          </div>
          <Btn variant="primary" icon="chevron" onClick={() => navigate('/app')}>
            Open JARVIS
          </Btn>
        </div>
      </div>
    </Frame>
  );
}

export function Guide() {
  return (
    <Frame>
      <div className="prose" style={{ paddingTop: 10 }}>
        <h1>Guide</h1>
        <p className="muted">How the pieces fit together, and when to reach for each one.</p>

        <h2>The loop</h2>
        <p>
          Every request goes through the same five phases. <b>Think</b> checks the deterministic rules first, so &ldquo;12% of 340&rdquo; never
          costs a model call. <b>Route</b> picks a provider and a relevant subset of tools. <b>Act</b> runs the model. If it asks for tools,{' '}
          <b>observe</b> executes them in parallel and feeds the results back. <b>Respond</b> writes the answer. The loop stops at the mode&rsquo;s
          step ceiling, and refuses tool calls past its budget &mdash; and tells you when it does.
        </p>

        <h2>Providers and the fallback chain</h2>
        <p>
          Your configured provider is tried first. If it fails, the keyless endpoint is tried (unless you turn that off). If that fails too, the
          on-device <b>reflex core</b> answers &mdash; it uses deterministic rules, your saved memory, and extractive summarisation, and it always
          says it is running offline. It never pretends to be the model.
        </p>
        <p>
          Groq and Google AI Studio both have genuine free tiers and take about a minute to set up. Everything else is optional.
        </p>

        <h2>Modes</h2>
        <p>
          A mode is a posture plus a budget: system prompt, temperature, maximum loop steps, and how many tool calls may be spent.{' '}
          <b>Brief</b> has a tool budget of zero, and that means zero &mdash; not &ldquo;discouraged&rdquo;. <b>Builder</b> gets ten. <b>Private</b>{' '}
          drops network tools entirely.
        </p>

        <h2>Skills, workflows, routines</h2>
        <ul>
          <li>
            <b>Skill</b> &mdash; a straight line of tool calls with no model involvement. Bind a step&rsquo;s output as{' '}
            <code className="inline">{'{{name}}'}</code> and use it later. Run one from chat with <code className="inline">/trigger</code>.
          </li>
          <li>
            <b>Workflow</b> &mdash; a graph. {NODE_KIND_COUNT} node kinds covering triggers, IO, branching, loops, data transforms, tools and model
            calls. Cycles are refused when you draw them and again when you run them.
          </li>
          <li>
            <b>Routine</b> &mdash; a skill or workflow on a trigger. Because a web page cannot wake itself, scheduled routines fire the next time
            you open the app, and interval routines tick only while it is open. This is stated in the UI rather than glossed over.
          </li>
        </ul>

        <h2>The sandbox</h2>
        <p>
          <code className="inline">code_run</code> executes JavaScript inside a Worker created from a blob URL, with{' '}
          <code className="inline">fetch</code>, <code className="inline">XMLHttpRequest</code>, <code className="inline">WebSocket</code>,{' '}
          <code className="inline">importScripts</code> and <code className="inline">indexedDB</code> deleted from the global scope, and a hard four
          second timeout. If Workers are unavailable it refuses to run at all rather than falling back to an unsandboxed evaluation. The Diagnostics
          screen proves all three properties by executing them.
        </p>
        <p>
          The filesystem tools operate on an in-memory workspace stored in this browser. There is no bridge to your real files, by design.
        </p>

        <h2>Approvals</h2>
        <p>
          Five tools are gated behind an explicit approval prompt showing the exact arguments: writing and deleting sandbox files, running code,
          and making arbitrary HTTP requests. You can turn approvals off in Settings, but the app asks you to confirm that too.
        </p>

        <h2>Crew</h2>
        <p>
          {ROLES.length} roles across six departments, in {PRESETS.length} presets. Roles run in order and each one receives the full prior
          transcript, which is what makes it a critique rather than {ROLES.length} parallel monologues. The Devil&rsquo;s advocate role runs last on
          purpose.
        </p>

        <h2>Where your data lives</h2>
        <p>
          Local storage in this browser, by default and forever unless you connect your own server. Cloud sync writes to your JARVIS server,
          authenticated with your GitHub account. Only you can read and write your data.
        </p>
      </div>
    </Frame>
  );
}

export function Privacy() {
  return (
    <Frame>
      <div className="prose" style={{ paddingTop: 10 }}>
        <h1>Privacy</h1>
        <p className="muted">Short version: it stays on your device unless you deliberately connect something.</p>

        <h2>What is stored, and where</h2>
        <p>
          Conversations, memory, workflows, skills, routines, ideas, run traces, the sandbox workspace and your settings are written to this
          browser&rsquo;s local storage. There is no server in this application. There is no analytics, no crash reporting, no telemetry, no
          fingerprinting and no third-party script.
        </p>

        <h2>What leaves the device</h2>
        <ul>
          <li>
            <b>Model requests</b>, to the provider you configured, containing the conversation and the mode&rsquo;s system prompt. Your API key goes
            with them, to that provider only.
          </li>
          <li>
            <b>Tool requests</b>, when a network tool runs: search queries to DuckDuckGo or Wikipedia, place names to Open-Meteo, and whatever URL
            you explicitly ask to fetch.
          </li>
          <li>
            <b>Sync</b>, only if you connect your own JARVIS server.
          </li>
        </ul>
        <p>Nothing else. There is no path in this codebase that sends your data to us, because there is no us to send it to.</p>

        <h2>Redaction before transport</h2>
        <p>
          Every outbound payload is scanned against {PATTERNS.length} patterns. API keys, tokens, private key blocks, connection strings and
          authorization headers are <b>always</b> replaced with a marker, at every privacy level. Strict additionally redacts emails, phone numbers
          and card numbers, and disables the four network tools completely.
        </p>
        <p>
          If you paste something secret-shaped into chat, the app tells you immediately, before the request goes anywhere &mdash; and recommends you
          rotate it. Detection is a heuristic, not a guarantee: treat anything you paste as exposed.
        </p>

        <h2>Your API key</h2>
        <p>
          Kept in local storage, sent only to its own provider, excluded from exports, and never written into the application bundle. Anything
          shipped in a client bundle is recoverable by anyone with the app, which is exactly why no privileged key is shipped in this one.
        </p>

        <h2>Deleting things</h2>
        <ul>
          <li>A single conversation: the trash icon in the conversation list.</li>
          <li>Everything local: Settings &rarr; Your data &rarr; Erase all. Immediate and unrecoverable.</li>
          <li>Everything in the cloud: Cloud &rarr; Danger zone &rarr; Delete my cloud data.</li>
          <li>Clearing site data in your browser also removes all of it.</li>
        </ul>

        <h2>Cookies</h2>
        <p>None. The app uses local storage, and a JWT auth token only if you sign in to sync.</p>

        <h2>Children</h2>
        <p>Not directed at children under 13. No accounts are created by this application itself.</p>

        <p className="dim" style={{ marginTop: 34 }}>
          This describes the software as built. It is not legal advice, and if you deploy JARVIS for other people you become the data controller
          for whatever they put into it.
        </p>
      </div>
    </Frame>
  );
}
