# Vercel Hobby Deployment

This app can run on Vercel Hobby with the React frontend in `dist` and AI routes under `/api/functions/*`.

What stays the same:
- Localhost still uses `START_FULL_LOCAL.bat`.
- Browser-saved keys still work for full local mode.
- App tabs and testcase flow are unchanged.

What changes on Vercel:
- Hosted AI calls go to `/api/functions/<function-name>`.
- Provider API keys should be stored as Vercel Environment Variables, not in browser localStorage.
- Long AI calls are still limited by Vercel Hobby function limits, so very large requirements can still need retry or a stronger provider.

## Required Vercel Environment Variables

Frontend:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_USE_VERCEL_AI_API=true`

Provider keys, add only what you use:
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`

Hosted access and Claude Subscription backend:
- `HOSTED_AI_ACCESS_TOKEN` = a unique random app-access token, also entered in the browser under `AI Settings`
- `CLAUDE_CLI_LAMBDA_URL` = the Function URL output from the AWS Lambda stack
- `LAMBDA_PROXY_TOKEN` = the same private token configured on that Lambda

`HOSTED_AI_ACCESS_TOKEN` is not an Anthropic key. It prevents anonymous visitors
from consuming the server-side AI quota. When configured, it protects every
Vercel AI route, not only Claude Subscription. Keep it different from
`LAMBDA_PROXY_TOKEN`.

Keep `CLAUDE_CODE_OAUTH_TOKEN` only in AWS Lambda/GitHub Actions. Never add it
to Vercel or any `VITE_*` variable. Vercel securely proxies Claude Subscription
requests to Lambda while all other providers continue to run in the Vercel
Node function.

Optional OpenRouter metadata:
- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`

## Vercel Project Settings

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: default `npm install`

The included `vercel.json` sets the API function max duration for the hosted AI route.

## Smoke Test After Deploy

1. Open the `.vercel.app` URL.
2. Open `AI Settings`, enter the `Hosted AI access token`, and pick a provider.
3. Save the settings.
4. Run `Generate` with a small requirement.
5. Run `Requirement Analysis`.
6. Run `Check Coverage`.
7. Try `Generate Missing Cases`.
8. Export to Excel.

If a provider fails, check the toast message first. Quota, high-demand, and structured-output provider issues are now surfaced separately.

## Local Chrome With Cloud Backend

To keep the UI on localhost while AI/server work runs on Vercel:

1. Add this to `.env.local`:

```env
VITE_HOSTED_AI_API_BASE_URL=https://YOUR-VERCEL-APP.vercel.app
```

2. Restart `npm run dev`.
3. Open `http://localhost:5173`.

When `VITE_HOSTED_AI_API_BASE_URL` is set, localhost calls `/api/functions/*` on Vercel instead of starting the local AI server.
