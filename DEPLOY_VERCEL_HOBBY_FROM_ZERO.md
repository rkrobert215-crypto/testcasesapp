# Deploy To Vercel Hobby From Zero

This guide starts from nothing:

- no Supabase account yet
- no Vercel account yet
- GitHub repo already exists:
  - `https://github.com/rkrobert215-crypto/testcasesapp`

This project is already prepared for:

- localhost usage
- Vercel Hobby deployment
- Node.js server functions on Vercel

Localhost will still keep working after deployment.

---

## What You Need Before Starting

You need:

1. A GitHub account
2. A Supabase account
3. A Vercel account
4. At least one AI provider API key

Best first provider for hosted testing:

- `OPENROUTER_API_KEY`

Reason:

- it already worked in a real end-to-end test for this project

---

## Part 1: Create A Supabase Account

1. Open:
   - `https://supabase.com/dashboard`
2. Click `Start your project`
3. Sign up with GitHub, Google, or email
4. Verify your email if Supabase asks
5. Log in to the Supabase dashboard

Official docs:

- Supabase docs home: https://supabase.com/docs

---

## Part 2: Create A New Supabase Project

1. In Supabase dashboard, click `New project`
2. Choose your organization
3. Fill these fields:
   - `Name`: any project name you want
   - `Database Password`: create a strong password and save it somewhere
   - `Region`: choose the closest region to you
4. Click `Create new project`
5. Wait until the project finishes provisioning

Do not close the page until the project is ready.

---

## Part 3: Get The Supabase URL And Publishable Key

1. Open your new Supabase project
2. Go to:
   - `Project Settings` -> `API`
3. Copy these values:
   - `Project URL`
   - `Publishable key`

You will use them in Vercel as:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Important:

- use the **publishable** key for the frontend
- do not use `service_role` in Vercel frontend env vars

Official docs:

- API keys: https://supabase.com/docs/guides/api/api-keys

---

## Part 4: Optional But Recommended - Push Database Migrations To Hosted Supabase

This app can deploy to Vercel without using Supabase Edge Functions for the heavy AI routes.

But if you want your hosted Supabase database schema to match the repo, do this.

### 4.1 Install Supabase CLI

Open PowerShell and run:

```powershell
npm install -g supabase
```

Then verify:

```powershell
supabase --version
```

### 4.2 Login To Supabase CLI

Run:

```powershell
supabase login
```

It will open a browser.

### 4.3 Link This Repo To The Hosted Supabase Project

In the repo folder:

```powershell
cd "D:\testcases app\twilight-spark-suite-874494d8-main\twilight-spark-suite-874494d8-main"
supabase link
```

Choose your new hosted project from the list.

### 4.4 Push Migrations

Run:

```powershell
supabase db push
```

Official docs:

- Database migrations: https://supabase.com/docs/guides/deployment/database-migrations

If you want the fastest first deploy and you do not need hosted database tables immediately, you can skip Part 4 for now and come back later.

---

## Part 5: Create A Vercel Account

1. Open:
   - `https://vercel.com`
2. Click `Sign Up`
3. Choose `Continue with GitHub`
4. Authorize Vercel to access your GitHub account
5. Finish the signup flow

Use the Hobby plan.

You do not need to pay for the first deploy.

Official docs:

- Import an existing project: https://vercel.com/docs/getting-started-with-vercel/import

---

## Part 6: Import The GitHub Repo Into Vercel

1. In Vercel dashboard, click:
   - `Add New` -> `Project`
2. Under GitHub repositories, find:
   - `rkrobert215-crypto/testcasesapp`
3. Click `Import`

If Vercel asks for GitHub access to the repo, approve it.

---

## Part 7: Configure The Vercel Project

On the import/configure screen, set:

- `Framework Preset`: `Vite`
- `Root Directory`: leave default
- `Build Command`: `npm run build`
- `Output Directory`: `dist`

This matches the repo config:

- [vercel.json](D:\testcases%20app\twilight-spark-suite-874494d8-main\twilight-spark-suite-874494d8-main\vercel.json)

---

## Part 8: Add Environment Variables In Vercel

Before clicking deploy, open the environment variable section in Vercel.

You need these variables.

### 8.1 Required Frontend Variables

Add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_USE_VERCEL_AI_API`

Values:

- `VITE_SUPABASE_URL` = the Supabase `Project URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` = the Supabase `Publishable key`
- `VITE_USE_VERCEL_AI_API` = `true`

### 8.2 Required AI Provider Variable

Add one provider key first.

Recommended first choice:

- `OPENROUTER_API_KEY`

If you want another provider instead, add one of:

- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`

### 8.3 Optional OpenRouter Variables

If you use OpenRouter, also add:

- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`

For the first deploy:

- `OPENROUTER_APP_TITLE` = `Test Case Generator`
- `OPENROUTER_HTTP_REFERER` can be left blank for the first deploy

After deployment, set:

- `OPENROUTER_HTTP_REFERER` = your final `.vercel.app` URL

Then redeploy once.

### 8.4 Which Environments To Select

When Vercel asks which environments should get the variable, select:

- `Production`
- `Preview`
- `Development`

That keeps behavior consistent.

Official docs:

- Environment variables: https://vercel.com/docs/environment-variables

---

## Part 9: Deploy The Project

After all environment variables are added:

1. Click `Deploy`
2. Wait for build to finish
3. Vercel will give you a URL like:
   - `https://testcasesapp-xxxxx.vercel.app`

Save that URL.

---

## Part 10: If You Use OpenRouter, Update The Referer

If your provider is OpenRouter, do this after the first successful deploy.

1. Copy your deployed Vercel URL
2. Go to:
   - `Vercel` -> `Project` -> `Settings` -> `Environment Variables`
3. Edit:
   - `OPENROUTER_HTTP_REFERER`
4. Set it to your full Vercel URL
5. Save
6. Trigger a new deployment

Important:

- Vercel env var changes apply only to new deployments, not old ones

Official docs:

- Environment variables: https://vercel.com/docs/projects/environment-variables

---

## Part 11: Test The Hosted App

Open the Vercel URL and test in this exact order.

### 11.1 First Smoke Test

1. Open the site
2. Go to `AI Settings`
3. Choose your provider
4. Choose a style like:
   - `Yuv`
   - or `Professional Standard`
5. Paste a **small** requirement
6. Click `Generate`

If that works, continue.

### 11.2 Test The Main Flows

Test these one by one:

1. `Generate`
2. `Requirement Analysis`
3. `Check Coverage`
4. `Generate Missing Cases`
5. Excel export

Do not test a huge requirement first.

Start small.

---

## Part 12: What To Do If Deployment Fails

Check these in order.

### 12.1 Build Failed

Check:

- Vercel used:
  - `npm run build`
- output directory is:
  - `dist`

### 12.2 App Loads But AI Calls Fail

Check:

- `VITE_USE_VERCEL_AI_API=true`
- provider key exists in Vercel env vars
- provider key has quota
- you redeployed after changing env vars

### 12.3 Supabase Errors

Check:

- `VITE_SUPABASE_URL` is your hosted Supabase URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` is your hosted Supabase publishable key
- you did not paste local `127.0.0.1` values

### 12.4 OpenRouter Errors

Check:

- `OPENROUTER_API_KEY` is correct
- `OPENROUTER_HTTP_REFERER` matches your Vercel URL
- redeploy after changing env vars

### 12.5 Gemini Errors

Gemini may fail due to:

- high demand
- free-tier quota
- project limits

If that happens, test first with OpenRouter.

---

## Part 13: Localhost Still Works

Deployment does not replace localhost.

Your local flow remains:

1. Open Docker
2. Run:
   - [START_FULL_LOCAL.bat](D:\testcases%20app\twilight-spark-suite-874494d8-main\twilight-spark-suite-874494d8-main\START_FULL_LOCAL.bat)
3. Open:
   - `http://127.0.0.1:5173`

Hosted mode and local mode can both exist.

---

## Part 14: Important Files In This Repo

These files matter for Vercel deployment:

- [vercel.json](D:\testcases%20app\twilight-spark-suite-874494d8-main\twilight-spark-suite-874494d8-main\vercel.json)
- [api/functions/[functionName].ts](D:\testcases%20app\twilight-spark-suite-874494d8-main\twilight-spark-suite-874494d8-main\api\functions\[functionName].ts)
- [src/lib/retryWithBackoff.ts](D:\testcases%20app\twilight-spark-suite-874494d8-main\twilight-spark-suite-874494d8-main\src\lib\retryWithBackoff.ts)
- [server/generate-test-cases-server.ts](D:\testcases%20app\twilight-spark-suite-874494d8-main\twilight-spark-suite-874494d8-main\server\generate-test-cases-server.ts)
- [.env.vercel.example](D:\testcases%20app\twilight-spark-suite-874494d8-main\twilight-spark-suite-874494d8-main\.env.vercel.example)

---

## Part 15: Vercel Hobby Limits You Should Know

This app is using Vercel Node functions, not Vercel Edge functions, for the heavy AI route.

That is intentional.

Vercel docs currently say Node.js functions on Hobby support up to:

- max duration: `300s`
- max memory: `2 GB`

Source:

- Vercel function limits: https://vercel.com/docs/functions/limitations

Very large AI generations can still hit hosted limits. For first tests, use smaller requirements.

---

## Part 16: Fastest Path Summary

If you want the shortest version:

1. Create Supabase account
2. Create Supabase project
3. Copy:
   - `Project URL`
   - `Publishable key`
4. Create Vercel account with GitHub
5. Import:
   - `rkrobert215-crypto/testcasesapp`
6. Add env vars:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_USE_VERCEL_AI_API=true`
   - `OPENROUTER_API_KEY`
7. Deploy
8. Open the `.vercel.app` URL
9. Test `Generate`
10. If using OpenRouter, set `OPENROUTER_HTTP_REFERER` to the deployed URL and redeploy

---

## Official References

- Vercel import existing project:
  - https://vercel.com/docs/getting-started-with-vercel/import
- Vercel project settings:
  - https://vercel.com/docs/project-configuration/project-settings
- Vercel environment variables:
  - https://vercel.com/docs/environment-variables
- Vercel function limits:
  - https://vercel.com/docs/functions/limitations
- Supabase docs:
  - https://supabase.com/docs
- Supabase API keys:
  - https://supabase.com/docs/guides/api/api-keys
- Supabase database migrations:
  - https://supabase.com/docs/guides/deployment/database-migrations

