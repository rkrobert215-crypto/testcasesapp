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
2. Pick a provider in `AI Settings`.
3. Run `Generate` with a small requirement.
4. Run `Requirement Analysis`.
5. Run `Check Coverage`.
6. Try `Generate Missing Cases`.
7. Export to Excel.

If a provider fails, check the toast message first. Quota, high-demand, and structured-output provider issues are now surfaced separately.
