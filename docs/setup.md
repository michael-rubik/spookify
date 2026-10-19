# Setup

This project requires Node.js and a Supabase project.

Follow the instructions in the repository `README.md` for Supabase secrets and CI setup.

- Configure `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` in Actions secrets.
- Set `SUPABASE_PROJECT_ID` as an Actions variable.

Run:

```bash
npm ci
npm run dev
```