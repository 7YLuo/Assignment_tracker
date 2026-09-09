# Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor**, paste the contents of `supabase/migrations/202609090001_create_tracker_states.sql`, and run it once.
3. In **Authentication → URL Configuration**, set the Site URL to `https://7yluo.github.io/Assignment_tracker/` and add the same address to Redirect URLs.
4. Push to `main`. GitHub Actions will read the public browser configuration from `.env.production` and build the configured application.

The project URL and publishable key in `.env.production` are intentionally public because they are included in the browser bundle. Row Level Security protects each user's rows. Never use a secret or service-role key in GitHub Pages, source control, or a `VITE_` variable.

Email/password authentication is enabled by default on most new projects. If email confirmation is enabled, users must confirm their email before their first sign-in.
