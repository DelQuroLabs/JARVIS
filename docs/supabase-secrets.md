# Connecting Supabase without exposing secrets

Short answer: **the key this app uses is meant to be public.** The protection is
row-level security, not secrecy. What you must never ship to a browser is the
*service role* key.

---

## The two keys, and which one is safe

| Key | Where it lives | Safe in a browser? |
|---|---|---|
| `anon` / publishable key | Settings → API in your Supabase dashboard | **Yes.** It is designed to be embedded in client apps. |
| `service_role` / secret key | Same page, marked secret | **Never.** It bypasses every RLS policy and can read and delete every row in your project. |

The anon key is not a password. It identifies your project and nothing else. On
its own it grants exactly the access your RLS policies allow — which, in this
project's schema, is **nothing at all until a user signs in**, and then only
that user's own rows.

You can verify this yourself: the Cloud screen has a security check that queries
a table with an anonymous client and expects to get zero rows back. If it ever
returns data, RLS is misconfigured and the screen says so in red.

## Why this app needs no backend to be safe

`supabase/schema.sql` enables **and forces** RLS on all ten tables, then writes
four policies per table keyed to `auth.uid()`. A row is readable and writable
only by the account that owns it. The anon key cannot see anything until
Supabase issues a session for a real user.

Run `supabase/verify.sql` after the schema. It fails loudly if any table is
missing RLS.

## Where the key is stored on this device

In `localStorage`, alongside your other settings. That means:

- Anyone with physical access to an unlocked browser profile can read it.
- It is **not** included in Settings → Export unless you deliberately enable
  "Include keys in cloud sync"; the export is scanned for credential shapes and
  the functional test asserts no key appears in it.
- Settings → Erase everything removes it.

## What would actually be dangerous

- Pasting the **service_role** key into the app. Do not. It is not asked for,
  and there is no field for it.
- Committing a real key to a public repo. Keys belong in `.env`, and `.env`
  belongs in `.gitignore`. Commit `.env.example` with names only.
- Disabling RLS "just to test something". That is the entire security model.

## Model API keys are a different story

Groq, Gemini and the rest are **secret** keys with real spending attached, and
this app puts them in the browser because it has no server. That is a genuine
trade-off, stated plainly:

- Use free-tier keys, which is what the provider list defaults to.
- The keys are sent only to the provider's own endpoint, never anywhere else.
- Every outbound request is scanned by the redactor first.
- If you want them off the device entirely, that needs a proxy server, which
  this build deliberately does not have.

---

## GitHub sign-in

If GitHub sign-in was failing, this is very likely why, and it is now fixed:

Supabase's default **implicit** OAuth flow returns the session in the URL
**fragment** (`#access_token=...`). This app uses a hash router, so its redirect
target is `.../#/app/cloud`. The returned fragment overwrites that route — the
router then sees `#access_token=...`, resolves nothing, and sign-in looks broken
even though Supabase authenticated you correctly.

The client now uses `flowType: 'pkce'`, which returns `?code=...` in the query
string instead. No collision with the hash route.

Two things still have to be true on your side:

1. **Authentication → Providers → GitHub** enabled in your Supabase project,
   with a GitHub OAuth app's client id and secret.
2. The exact redirect URL from the Cloud screen added to
   **Authentication → URL Configuration → Redirect URLs**.

And one honest limitation: **OAuth cannot complete inside the in-app preview
iframe.** A sandboxed frame is not allowed to take over the top-level window for
the round trip to GitHub. Open the app in a real browser tab to sign in.
