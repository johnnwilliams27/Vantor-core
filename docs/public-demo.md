# Public interactive demo

This branch introduces a **fictional, client-side product demonstration** at `/demo` (and `/demo/dashboard`).

## What it does

- Opens directly without registration, passwords, or a NextAuth session.
- Presents all primary product navigation surfaces using the application's existing Next.js and Tailwind environment.
- Includes representative sample balances, portfolio charts, fiat and on-chain positions, treasury recommendations, operations, invoices, policies, compliance, reporting, and admin-adjacent account management.
- Supports route navigation, global record filtering, details panels, local approval/denial simulation, sample transaction forms, CSV export, and a clearly scripted guided assistant.
- Persists simulated changes in browser **sessionStorage** until the browser session ends or the visitor chooses **Reset demo session**.

## Boundaries

**This is not an authenticated test-enterprise session.** The public experience is a separate, illustrative frontend, not a direct connection to a seeded Supabase enterprise. It reuses concepts and shapes of existing test-mode records but does not access the database. It is intentionally not a full functional replacement for all original app surfaces.

- `/demo` is added to the public paths in `src/middleware.ts`. This does not change access controls for `/dashboard`, protected `/api/*`, or other authenticated routes.
- Demo components call **no backend APIs** for data or financial actions. No wallet connections, chain transactions, fiat settlement, or ERP sync operations run from this showcase.
- All records and monetary figures are fictional examples.
- A demo warning stays visible throughout the experience.
- Demo pages specify `noindex,nofollow` to avoid search result confusion.

## Preview / deploy

1. Open the PR's Vercel Preview deployment when available. Preview URLs are managed by the Vercel integration; they cannot be inferred from the branch name.
2. Navigate to `https://<vercel-preview-host>/demo`. No login is needed.
3. Verify navigation, sample charts, details, filters, simulation, CSV export, and mobile drawer.
4. If using a dedicated `demo.vantor.xyz` domain, attach that domain to a **separate Vercel project** tracking this branch or a curated release branch. Keep the existing production project and `www.vantor.xyz` unchanged until explicitly approved.

The code change does not create or configure a Vercel project or DNS record. Do not publish `demo.vantor.xyz` until those external steps are completed.

## Development

```sh
npm install
npm run dev
# open http://localhost:3000/demo
npm test -- tests/demo/demo-data.test.ts
```

## Future fidelity upgrade

For a more exact representation of the authenticated product, extract shared screen components and inject read-only adapters backed by a dedicated sanitized fixture layer. Avoid public access to live Supabase service-role credentials or authenticated operational APIs.
