# Providers, keys and the CORS problem

This app runs entirely in a browser. That single fact decides which APIs it can
offer, and it rules out a lot of otherwise excellent services.

A web page can only read a response if the server sends an
`Access-Control-Allow-Origin` header covering the calling origin. No proxy, no
server, no exceptions. A key that works perfectly from `curl` or a Node script
can be completely unusable here. So nothing is listed in the app until its
preflight has been probed from a real browser origin.

## Method

Each candidate got two probes on **2026-09-04**, from origin
`https://example.com`:

```bash
# 1. preflight: would a browser be allowed to POST with an Authorization header?
curl -X OPTIONS -D- -o /dev/null \
  -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type' \
  "$URL"

# 2. real POST with a deliberately invalid key: is the endpoint live, and does
#    the *error* response also carry CORS headers?
curl -X POST -D- -H 'Origin: https://example.com' \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer invalid-probe-key' \
  -d '{"model":"x","messages":[{"role":"user","content":"hi"}]}' "$URL"
```

A provider ships only if the preflight is allowed. The result is recorded in the
spec as `cors: 'verified'` with the probe date, and the Providers screen shows
that date next to the provider.

## Model providers — shipped

| Provider | Endpoint | Preflight | Cost tier |
|---|---|---|---|
| Groq | `api.groq.com/openai/v1` | 204, `ACAO: *` | Free tier |
| Google Gemini | `generativelanguage.googleapis.com` | allowed | Free tier |
| Cerebras | `api.cerebras.ai/v1` | 200, `ACAO: *` | Free tier (~1M tokens/day) |
| Mistral | `api.mistral.ai/v1` | 200, `ACAO: *` | Free "Experiment" tier |
| Z.ai / Zhipu GLM | `open.bigmodel.cn/api/paas/v4` | 200, origin echoed | Flash models free |
| Hugging Face | `router.huggingface.co/v1` | 200, `ACAO: *` | Small monthly credit |
| OpenRouter | `openrouter.ai/api/v1` | allowed | `:free` models, key required |
| Nebius AI Studio | `api.studio.nebius.com/v1` | 204, `ACAO: *` | Signup credit |
| Together AI | `api.together.xyz/v1` | 200, `ACAO: *` | Signup credit |
| DeepSeek | `api.deepseek.com` | 200, origin echoed | Paid |
| xAI Grok | `api.x.ai/v1` | 200, `ACAO: *` | Paid |
| Perplexity | `api.perplexity.ai` | 204, `ACAO: *` | Paid |
| OpenAI | `api.openai.com/v1` | allowed | Paid |
| Anthropic | `api.anthropic.com/v1` | allowed (needs the opt-in header) | Paid |
| Ollama | `localhost:11434` | your machine | Local |
| LM Studio | `localhost:1234` | your machine | Local |
| Custom | anything OpenAI-compatible | unverified by definition | Yours |
| Keyless fallback | `text.pollinations.ai` | allowed | No account |

## Model providers — rejected, and why

| Candidate | Probe result | Verdict |
|---|---|---|
| GitHub Models | HTTP 410, `github_models_retirement_brownout` | The service is being retired. Listing it would break on first use. |
| NVIDIA NIM | Preflight 200 but **no** `Access-Control-Allow-Origin` | A browser cannot read the reply. |
| SambaNova | Preflight 200 but **no** `Access-Control-Allow-Origin` | Same. |
| Cloudflare Workers AI | 405 on preflight; needs an account id in the path | Not usable as a drop-in browser endpoint. |

These four are named in the app's Providers screen too, so the absence reads as
a decision rather than an oversight.

## Optional tool keys

These upgrade a **tool**, not the model. Every one of them is optional and the
tool works without it.

| Service | With a key | Without a key |
|---|---|---|
| Tavily | `web_search` returns ranked results with snippets | DuckDuckGo instant answers, then Wikipedia |
| GitHub | 5,000 requests/hour and private repos | 60 requests/hour, public only |
| NASA | Your own quota | Shared `DEMO_KEY`, throttled globally |
| OpenWeather | Described conditions and feels-like temperature | Open-Meteo forecast, no key needed |

Rejected for the same CORS reason: **Brave Search** (no `ACAO` header, probed
2026-09-04) and **NewsAPI** (blocks browser origins on the free plan). Both
would need a server proxy — a small Edge proxy is exactly that.

## Keyless data APIs behind the new tools

All probed on 2026-09-04 and returning CORS headers:

| Tool | Endpoint | Notes |
|---|---|---|
| `currency_convert` | `api.frankfurter.dev` | ECB reference rates, not dealing rates |
| `crypto_price` | `api.coingecko.com` | Public tier, rate limited |
| `earthquakes` | `earthquake.usgs.gov` | USGS live feed |
| `hn_search` | `hn.algolia.com` | Hacker News index |
| `geocode` | `geocoding-api.open-meteo.com` | Also powers `weather` |
| `word_lookup` | `api.datamuse.com` | Synonyms, rhymes, related words |
| `book_search` | `openlibrary.org` | Open Library |
| `tv_search` | `api.tvmaze.com` | TVmaze |
| `space_news` | `api.spaceflightnewsapi.net` | Spaceflight News API |
| `github_repo` | `api.github.com` | Keyless, token optional |
| `nasa_apod` | `api.nasa.gov` | `DEMO_KEY` unless you add your own |

Dropped after probing: `api.dictionaryapi.dev` and `worldtimeapi.org` were both
unreachable, and `export.arxiv.org` returns no CORS header at all.

## Where keys live

- Saved in `localStorage` under the app's settings key, per provider.
- Never bundled, never logged, never included in an export — `exportAll()`
  strips the whole keyring and every service key, and there is a test for it.
- Redacted before any text reaches a model: the privacy scanner knows the shape
  of every provider key listed above.
- They only leave the device if you connect a sync server **and** turn on
  "Include keys in cloud sync", which is off by default. That writes one
  `key_vault` row under the same row-level security as everything else.

## Fallback order

The active provider is tried first, then each configured provider in your ranked
chain, then the keyless endpoint if enabled, then the offline reflex core.
Unconfigured providers are skipped rather than counted as failures. Every hop is
recorded and the answer says which provider actually replied.
