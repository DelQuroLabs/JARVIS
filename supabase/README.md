# Supabase setup

Nothing here has been executed against a live project by the agent that wrote it.
Treat every claim below as **not run** until you run it yourself and see the output.

## 1. Create the project

Free tier is enough: <https://supabase.com/dashboard> -> New project.

## 2. Apply the schema

SQL editor -> paste `schema.sql` -> Run. Then paste `verify.sql` -> Run.

`verify.sql` raises an exception on the first problem it finds. A clean run ends with:

```
NOTICE:  PASS: 9 tables verified
```

Keep that output — it is the evidence for the `SEC-001` gate.

## 3. Enable GitHub sign-in (optional)

Authentication -> Providers -> GitHub. You will need a GitHub OAuth app:

- Homepage URL: your deployed app URL
- Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`

Then add your app's URL under Authentication -> URL Configuration -> Redirect URLs.
Without that, the OAuth round trip will bounce back to an error page.

## 4. Connect the app

In JARVIS: **Cloud** -> paste the Project URL and the **anon / publishable** key.

The app refuses a service-role key on sight. If you paste one by accident, rotate it
immediately in Settings -> API — a service-role key bypasses row-level security
entirely and anything in a browser bundle is recoverable.

## What is stored

| Table | Contents |
|---|---|
| `profiles` | handle and avatar from your OAuth provider |
| `conversations` | chat history, as a JSON payload |
| `memory_items` | saved facts, preferences, decisions |
| `workflows`, `skills`, `routines`, `ideas` | your automations and notes |
| `traces` | local run telemetry, if you choose to sync it |
| `crew_runs` | crew review transcripts |

Every row carries `user_id` and is readable only by that user. There is no
cross-user table, no analytics table, and no server-side key in the client bundle.
