# Cloudflare + Claude Subscription Deployment

This is the production bundle:

```text
Browser
  -> Cloudflare Worker Basic Auth
  -> /api/functions/* secure proxy
  -> AWS Lambda Function URL with private proxy token
  -> Node AI server
  -> Claude CLI using CLAUDE_CODE_OAUTH_TOKEN
```

Localhost, Vercel, Supabase functions, OpenAI, Anthropic API, Gemini, Groq, and
OpenRouter remain available. This deployment adds Claude Subscription; it does
not remove another feature or provider.

Claude Code officially supports Pro/Max login and programmatic print mode. The
Lambda token pattern is a personal remote deployment pattern, not an Anthropic
managed hosting product. Confirm that your account plan and current Anthropic
terms permit your intended usage before production use.

## Cost Boundary

Cloudflare Workers Static Assets can fit the free plan for personal usage.
AWS Lambda has a free allowance, but AWS account usage and ECR image storage can
still create charges. Do not treat the complete architecture as guaranteed
free forever. Configure AWS Budgets before deployment.

## 1. Generate the Claude subscription token

On the machine where Claude Code is already logged in:

```powershell
claude setup-token
```

Keep the resulting value private. Store it only as the GitHub secret
`CLAUDE_CODE_OAUTH_TOKEN`. Never put it in `.env`, Vite variables, source code,
Cloudflare browser variables, screenshots, or chat.

## 2. Create the Cloudflare account

1. Open the Cloudflare dashboard and create a free account.
2. Open **My Profile > API Tokens > Create Token**.
3. Use **Edit Cloudflare Workers**.
4. Limit the token to your account.
5. Copy the token once.
6. Copy the Account ID from the Workers overview.

No Cloudflare Pages project is required. `wrangler.jsonc` creates/deploys the
Worker and serves the existing Vite `dist` directory as static assets.

## 3. Prepare AWS safely

1. Create or use an AWS account.
2. Enable MFA on the root account.
3. Open **Billing > Budgets**.
4. Create a small monthly cost budget and email alert.
5. Choose one region, for example `ap-south-1`.
6. Create a GitHub OIDC provider for `token.actions.githubusercontent.com`.
7. Create an IAM role trusted only by
   `repo:rkrobert215-crypto/testcasesapp:ref:refs/heads/main`.
8. Give that deployment role permission for CloudFormation, Lambda, IAM role
   creation/pass-role, ECR, and CloudWatch Logs for this stack.
9. Copy the deployment role ARN.

The runtime Lambda role is created by `cloud/aws/template.yaml` and can only
write its CloudWatch logs.

## 4. Add GitHub repository secrets

Open:

```text
https://github.com/rkrobert215-crypto/testcasesapp
Settings > Secrets and variables > Actions > New repository secret
```

Required:

```text
AWS_GITHUB_ROLE_ARN
AWS_REGION
AWS_ECR_REPOSITORY
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
APP_USERNAME
APP_PASSWORD
LAMBDA_PROXY_TOKEN
CLAUDE_CODE_OAUTH_TOKEN
```

Recommended values:

```text
AWS_ECR_REPOSITORY=testcasesapp-claude
APP_USERNAME=<your private site username>
APP_PASSWORD=<a unique long password>
LAMBDA_PROXY_TOKEN=<a separate random value of at least 32 characters>
```

Add these only if their providers must also work in this cloud deployment:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY
GROQ_API_KEY
OPENROUTER_API_KEY
```

Add these if hosted Supabase features are used:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

`VITE_*` values are public build-time configuration. Never use `VITE_` for a
private AI key or OAuth token.

## 5. Deploy

1. Push the reviewed code to the `main` branch.
2. Open GitHub **Actions**.
3. Select **Deploy Cloudflare and Claude Lambda**.
4. Click **Run workflow**.
5. Wait for lint, tests, build, Lambda deploy, Worker deploy, and health check.
6. Open the final `workers.dev` URL shown in the Wrangler deploy log.
7. Enter `APP_USERNAME` and `APP_PASSWORD` in the browser Basic Auth prompt.

The workflow keeps only three ECR images, sets Lambda reserved concurrency to
one, uses a 15-minute timeout, and retains logs for seven days.

To use the same Claude Subscription backend from `https://testcasesapp.vercel.app`,
copy the stack's `LambdaFunctionUrl` output into the Vercel server variable
`CLAUDE_CLI_LAMBDA_URL`, add the same `LAMBDA_PROXY_TOKEN`, create a separate
`HOSTED_AI_ACCESS_TOKEN`, and redeploy Vercel. Enter that hosted access token
once in the web app under `AI Settings`.
Do not add `CLAUDE_CODE_OAUTH_TOKEN` to Vercel.

Claude Subscription requests use one internally reviewed CLI invocation per
artifact so generation remains inside Vercel's proxy duration while preserving
the principal-QA quality gate. Direct API providers retain their existing
multi-call analysis and correction behavior.

## 6. Mandatory smoke test

Use a requirement with at least two acceptance criteria and confirm:

1. **Full Requirement** generates a complete suite and does not reduce to a
   fixed small count.
2. Rob titles use requirement-supported `Verify that the user...` wording.
3. **High Level TCs**, **Complete TC**, **Scenario**, and **Expected Result**
   return the correct artifact type.
4. **Requirement Analysis** preserves exact labels/config keys.
5. **Test Plan**, **RTM**, **Test Data**, **Scenario Map**, and
   **Clarifications** return non-generic requirement-specific artifacts.
6. **Check Coverage** uses the original requirement and current suite.
7. **Generate Missing Cases** merges additions without deleting old cases.
8. **Audit & Enhance** retains the uploaded baseline and adds only gaps.
9. **Smart Merge** retains unique tests and removes only true duplicates.
10. XLSX and CSV exports open without Excel repair warnings.
11. One screenshot and five screenshots both work.
12. History reload restores the requirement, images, and testcase suite.
13. Unknown API paths return 404; unauthenticated site/API requests return 401.
14. Lambda URL calls without `X-Testcase-Proxy-Token` return 404.

## 7. Rollback

1. Open Cloudflare **Workers & Pages > testcasesapp > Deployments**.
2. Roll back to the previous Worker deployment.
3. Open AWS Lambda and point the function to one of the three retained ECR
   image tags, or rerun this workflow from a known-good Git commit.
4. Keep the existing Vercel deployment until this smoke test passes.

## 8. Rotate or revoke access

If any token was pasted into chat, committed, logged, or shared:

1. Revoke it at the provider immediately.
2. Generate a new token.
3. Update the matching GitHub secret.
4. Rerun the deployment workflow.
5. Review Git history and logs for accidental exposure.

To block the site quickly, rotate `APP_PASSWORD`. To block direct Lambda proxy
traffic, rotate `LAMBDA_PROXY_TOKEN` and redeploy both sides.
