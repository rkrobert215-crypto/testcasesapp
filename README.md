# TCX - Test Case Generator

AI-powered test case generation and requirement analysis app built with React, Vite, and Supabase.

## Stack

- React + TypeScript
- Vite
- Tailwind CSS + shadcn-ui
- Supabase Edge Functions
- Local or hosted PostgreSQL through Supabase

## Run the frontend locally

```sh
npm install
npm run dev
```

The app opens at `http://localhost:5173`.

## Full local Supabase setup

For full local database and backend setup, use the guides already included in the repo:

- `HOW_TO_USE.txt`
- `FULL_LOCAL_SUPABASE_SETUP.txt`

Helpful commands:

```sh
npm run supabase:start
npm run supabase:status
npm run supabase:functions:serve
npm run supabase:stop
```

## AI providers

The app supports these providers through the in-app `AI Settings` dialog:

- OpenAI
- Claude
- Google Gemini
- Groq

Provider keys are stored in browser local storage on your machine.

## Deployment notes

- Frontend changes go live locally as soon as the Vite dev server reloads.
- Supabase function changes only affect hosted environments after you deploy the updated functions.
- Use `DEPLOY_HOSTED_FUNCTIONS.bat` if you want to push the latest edge functions to your hosted Supabase project.
