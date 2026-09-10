# AI syllabus import setup

The browser sends syllabus text or one image to the authenticated Supabase Edge Function. The OpenAI secret stays server-side and must never be added to a `VITE_` environment variable.

1. Add an Edge Function secret named `OPENAI_API_KEY` in the Supabase project.
2. Deploy `supabase/functions/parse-syllabus` to project `lefvekpaqtoyplngsbqu`.
3. Keep JWT verification enabled for the function so only signed-in tracker users can invoke it.

With the Supabase CLI, the equivalent commands are:

```powershell
supabase secrets set OPENAI_API_KEY=YOUR_KEY --project-ref lefvekpaqtoyplngsbqu
supabase functions deploy parse-syllabus --project-ref lefvekpaqtoyplngsbqu
```

The function calls the OpenAI Responses API with `store: false`, accepts syllabus text or PNG/JPEG/WebP screenshots, and returns structured course, grading, explicit assignment, and expected-series recurrence data for user review. The Edge Function extracts recurrence facts only; the browser application generates each expected assignment date deterministically.
