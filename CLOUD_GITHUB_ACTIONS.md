# Cloud Deployment With GitHub Actions

The recommended Claude Subscription production path is now documented in
`CLOUD_CLAUDE_DEPLOYMENT.md` and automated by
`.github/workflows/deploy-cloudflare-lambda.yml`.

This project can run without local Docker for normal use:

- Frontend: Vercel
- AI/server routes: Vercel Node Functions under `api/functions/[functionName].ts`
- Database/auth project: Hosted Supabase
- Local Docker/Supabase: optional for local development only

## Workflows

### `CI`

File: `.github/workflows/ci.yml`

Runs on every push to `main` and on pull requests:

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

### `Deploy Vercel`

File: `.github/workflows/vercel-deploy.yml`

Manual deployment workflow. Use this when you want GitHub Actions to deploy the app to Vercel.

Required GitHub repository secrets:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

Get these from Vercel:

- `VERCEL_TOKEN`: Vercel account settings, Tokens
- `VERCEL_ORG_ID`: run `vercel link` locally or check `.vercel/project.json`
- `VERCEL_PROJECT_ID`: run `vercel link` locally or check `.vercel/project.json`

Keep the normal app secrets in Vercel Environment Variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_USE_VERCEL_AI_API
OPENROUTER_API_KEY
OPENROUTER_APP_TITLE
OPENROUTER_HTTP_REFERER
GEMINI_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
GROQ_API_KEY
HOSTED_AI_ACCESS_TOKEN
CLAUDE_CLI_LAMBDA_URL
LAMBDA_PROXY_TOKEN
```

`HOSTED_AI_ACCESS_TOKEN`, `CLAUDE_CLI_LAMBDA_URL`, and `LAMBDA_PROXY_TOKEN` are
required for the Claude Subscription provider. Enter `HOSTED_AI_ACCESS_TOKEN`
once in the web app under `AI Settings`; keep it different from the Lambda
proxy token. Keep `CLAUDE_CODE_OAUTH_TOKEN` exclusively in the Lambda deployment
workflow; never put it in Vercel or a `VITE_*` variable.

If Vercel Git integration is already auto-deploying on every push, keep this workflow manual to avoid duplicate deployments.

### `Deploy Supabase Migrations`

File: `.github/workflows/supabase-migrations.yml`

Manual workflow for pushing `supabase/migrations` to the hosted Supabase project.

Required GitHub repository secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
```

Use this only after confirming your hosted Supabase project is the intended target.

## Normal Daily Flow

1. Push code to GitHub.
2. CI runs automatically.
3. Vercel can auto-deploy from GitHub, or you can run `Deploy Vercel` manually.
4. Run `Deploy Supabase Migrations` manually only when database migrations need to be applied.

## Local Development

Localhost still works:

```powershell
START_FULL_LOCAL.bat
```

Local Docker/Supabase is now only a development option. It is not required for the hosted app.
