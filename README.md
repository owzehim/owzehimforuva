# UvA-IN App

A progressive web app (PWA) for UvA-IN members.

## Development

- Software developer and technical maintainer: Woojay Lim

## Technology

- Frontend: React, Vite, and Tailwind CSS
- Backend and authentication: Supabase (Postgres, Auth, and Edge Functions)
- Hosting and deployment: Vercel
- Map integration: MapTiler
- Additional integration: Google Apps Script

## Local development

Requirements: Node.js and npm.

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a `.env.local` file with the frontend configuration values:

   ```text
   VITE_SUPABASE_URL=
   VITE_SUPABASE_PUBLISHABLE_KEY=
   VITE_MAPTILER_API_KEY=
   ```

3. Start the development server:

   ```sh
   npm run dev
   ```

Create a production build with `npm run build`.

## Project structure

- `src/` — React application
- `supabase/functions/` — Supabase Edge Functions
- `supabase/migrations/` — database migrations
- `vercel.json` — Vercel routing and deployment configuration

## Security

- Never commit credentials or private keys.
- Keep Supabase service-role credentials in Supabase's server-side function secrets; do not expose them to frontend code or `VITE_` variables.
- Configure frontend environment values in the local environment and Vercel project settings.
