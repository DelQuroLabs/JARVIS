// Outbound privacy scanner. Runs on every payload leaving the device.
// POL-SECRETS-006 / POL-USERLEAK-031: secret-shaped strings are redacted before transport,
// and the user is told what was caught.

import type { PrivacyLevel, ScanResult } from './types.ts';

interface Pattern {
  label: string;
  re: RegExp;
  /** Replacement keeps shape so the model still understands the context. */
  mask: string;
  /** Only redact when a key-ish word sits nearby (kills hex false positives). */
  requiresLabel?: boolean;
}

export const PATTERNS: Pattern[] = [
  // Order matters: sk-ant- and sk-or-v1- must be tested before the looser sk-
  // rule, or those keys are redacted under the wrong label and the finding lies
  // about what leaked.
  { label: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, mask: '[REDACTED:anthropic-key]' },
  { label: 'OpenRouter key', re: /\bsk-or-v1-[A-Za-z0-9]{20,}\b/g, mask: '[REDACTED:openrouter-key]' },
  { label: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, mask: '[REDACTED:openai-key]' },
  { label: 'Groq key', re: /\bgsk_[A-Za-z0-9]{30,}\b/g, mask: '[REDACTED:groq-key]' },
  // Added alongside the wider provider list: every new brain is a new key shape
  // that must never reach a model, a log or an export.
  { label: 'Cerebras key', re: /\bcsk-[A-Za-z0-9]{20,}\b/g, mask: '[REDACTED:cerebras-key]' },
  { label: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{20,}\b/g, mask: '[REDACTED:huggingface-token]' },
  { label: 'xAI key', re: /\bxai-[A-Za-z0-9]{20,}\b/g, mask: '[REDACTED:xai-key]' },
  { label: 'Perplexity key', re: /\bpplx-[A-Za-z0-9]{20,}\b/g, mask: '[REDACTED:perplexity-key]' },
  { label: 'NVIDIA key', re: /\bnvapi-[A-Za-z0-9_-]{20,}\b/g, mask: '[REDACTED:nvidia-key]' },
  { label: 'Tavily key', re: /\btvly-[A-Za-z0-9-]{16,}\b/g, mask: '[REDACTED:tavily-key]' },
  { label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g, mask: '[REDACTED:google-key]' },
  { label: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, mask: '[REDACTED:github-token]' },
  { label: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, mask: '[REDACTED:slack-token]' },
  { label: 'Stripe key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, mask: '[REDACTED:stripe-key]' },
  { label: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, mask: '[REDACTED:aws-key]' },
  { label: 'Supabase service key', re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g, mask: '[REDACTED:supabase-service-key]' },
  { label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, mask: '[REDACTED:jwt]' },
  { label: 'Private key block', re: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g, mask: '[REDACTED:private-key]' },
  { label: 'Bearer header', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g, mask: 'Bearer [REDACTED]' },
  { label: 'Password assignment', re: /\b(?:password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*["']?[^\s"',;]{8,}/gi, mask: '[REDACTED:credential]' },
  { label: 'Credit card', re: /\b(?:\d[ -]?){13,16}\b/g, mask: '[REDACTED:card-number]' },
  { label: 'US SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g, mask: '[REDACTED:ssn]' },
  { label: 'Email address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, mask: '[REDACTED:email]' },
  { label: 'Phone number', re: /\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, mask: '[REDACTED:phone]' },
  { label: 'Connection string', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi, mask: '[REDACTED:connection-string]' },
  // Bare 32/40-char hex is ambiguous: it is just as likely a commit SHA, an
  // asset digest or a request id. Only redacted when a key-ish word sits
  // nearby - see `nearLabel`.
  { label: 'Generic hex secret', re: /\b[A-Fa-f0-9]{32,64}\b/g, mask: '[REDACTED:secret]', requiresLabel: true },
];

/** Words that turn an ambiguous blob into a probable credential. */
const KEY_WORDS = /\b(?:key|token|secret|password|passwd|pwd|api[_-]?key|auth|bearer|credential|signature|hmac|salt|access|private)\b/i;

/** True when a key-ish word appears within 40 characters either side. */
function nearLabel(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index);
  const after = text.slice(index + length, index + length + 40);
  return KEY_WORDS.test(before) || KEY_WORDS.test(after);
}

/** Luhn checksum. Kills the order-number and tracking-id false positives. */
export function luhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Which patterns are enforced at each level. GUARDED skips low-risk PII. */
const LEVEL_SKIP: Record<PrivacyLevel, string[]> = {
  STRICT: [],
  GUARDED: ['Email address', 'Phone number', 'Credit card'],
  OPEN: PATTERNS.map((p) => p.label),
};

const ALWAYS = new Set([
  'OpenAI key', 'Anthropic key', 'Groq key', 'Google API key', 'GitHub token',
  'Slack token', 'Stripe key', 'AWS access key', 'Supabase service key',
  'Private key block', 'Bearer header',
]);

export function scan(text: string, level: PrivacyLevel = 'GUARDED'): ScanResult {
  const skip = new Set(LEVEL_SKIP[level]);
  const findings: { label: string; count: number }[] = [];
  let clean = text;

  for (const p of PATTERNS) {
    if (skip.has(p.label) && !ALWAYS.has(p.label)) continue;
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`);

    // Collected first, then replaced from the end, so earlier match indexes
    // stay valid while the string is being rewritten.
    const spans: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (p.requiresLabel && !nearLabel(clean, m.index, m[0].length)) continue;
      if (p.label === 'Credit card' && !luhn(m[0].replace(/\D/g, ''))) continue;
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
    if (!spans.length) continue;

    findings.push({ label: p.label, count: spans.length });
    for (let i = spans.length - 1; i >= 0; i--) {
      clean = clean.slice(0, spans[i].start) + p.mask + clean.slice(spans[i].end);
    }
  }
  return { clean, findings };
}

/** Detect-only pass used to warn the user about what they just pasted (U-01). */
export function detect(text: string): { label: string; count: number }[] {
  return scan(text, 'STRICT').findings;
}

export function levelBlurb(level: PrivacyLevel): string {
  switch (level) {
    case 'STRICT':
      return 'No network tools. Every outbound payload is scanned and redacted, including emails and phone numbers.';
    case 'GUARDED':
      return 'Network tools allowed. Credentials, keys and tokens are always redacted before transport; ordinary contact details are not.';
    case 'OPEN':
      return 'Redaction limited to credentials and key material, which are never transmitted regardless of level.';
  }
}

export function networkAllowed(level: PrivacyLevel): boolean {
  return level !== 'STRICT';
}
