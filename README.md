# Spookify

This repository now uses a single markdown source of truth in [docs/index.md](docs/index.md).

All project documentation, product plan, contributor guidance, and operational rules live under [docs](docs/). Do not add separate project docs in the repository root or user home config; keep the repo authoritative here.

Start here:

- [docs/index.md](docs/index.md)
- [docs/plan.md](docs/plan.md)
- [docs/agents.md](docs/agents.md)

This file is intentionally a short landing page and redirect only.

```bash
npm run dev
npm run build
npx supabase db push
npx supabase migration repair --status reverted <migration-id>
```

## Notes

This repo uses Supabase for auth and user metadata, so the users table and policies are core app state. Keeping the SQL and migration history aligned prevents false “already up to date” messages and avoids hidden schema drift.
