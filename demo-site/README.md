# Vantor public interactive demo

Standalone Next.js demo app with fictional browser-only data. This subproject deliberately does not import the production auth, API, wallet or Supabase modules. It keeps the public demo deployment independent from the original finance app and its environment variables.

Set the Vercel project's Root Directory to `demo-site`, Framework to Next.js, and deploy the `deploy/public-demo` branch. Visit `/demo` after building.
