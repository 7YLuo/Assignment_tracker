# Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor**, paste the contents of `supabase/migrations/202609090001_create_tracker_states.sql`, and run it once.
3. In **Authentication → URL Configuration**, set the Site URL to `https://7yluo.github.io/Assignment_tracker/` and add the same address to Redirect URLs.
4. In GitHub, open **Settings → Secrets and variables → Actions** and create these repository secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
5. Push to `main`. GitHub Actions will build the configured application.

Use the project URL and publishable key from Supabase **Settings → API**. Never use a secret or service-role key in GitHub Pages or a `VITE_` variable.

Email/password authentication is enabled by default on most new projects. If email confirmation is enabled, users must confirm their email before their first sign-in.
