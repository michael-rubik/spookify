# Setup

This project requires Node.js and a Supabase project.

Follow the instructions in the repository `README.md` for Supabase secrets and CI setup.

- Configure `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` in Actions secrets.
- Set `SUPABASE_PROJECT_ID` as an Actions variable.

Account deletion needs the `delete-account` Edge Function deployed to the linked
project (done by the `supabase` workflow); it does not work with development login.

Run:

```bash
npm ci
npm run dev
```
