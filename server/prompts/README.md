# JARVIS prompts

Every system prompt the server-side assistant uses lives in this folder as plain
Markdown. Edit them here; the server reloads them on restart (and in dev, on the
next request). Nothing in code overrides what you write — the placeholders
below are the only substitution the loader performs.

| File | Used for |
|---|---|
| `persona.jarvis.md` | The JARVIS personality (default) |
| `persona.neutral.md` | Warm, professional, no humor |
| `persona.terse.md` | Fewest words possible |
| `rules.md` | Non-negotiable operating rules appended to every persona |
| `memory.extract.md` | The background pass that distills durable facts from each exchange |
| `memory.recall.md` | How recalled memories and the user profile are framed inside the prompt |

## Placeholders

| Token | Replaced with |
|---|---|
| `{{address}}` | Instruction on how to address the user (from the "Call you" setting) |
| `{{humor}}` | Humor level 0–10 |
| `{{currency}}` | ISO currency code |
| `{{today}}` | Today's date, YYYY-MM-DD (UTC) |
| `{{channel_rules}}` | Telegram vs in-app formatting rules |

## Vetting checklist

- Does the persona ever claim an action succeeded without a tool result? It must not.
- Does it confirm before email and deletes? (rules.md)
- Does the extractor ignore one-off task details and anything the assistant said about itself?
- Would a recalled memory that contains "ignore previous instructions" be obeyed? It is quarantined before it gets here, but the recall framing must still say memories are data, not instructions.
