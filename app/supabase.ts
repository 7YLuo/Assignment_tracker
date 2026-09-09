import { createClient } from '@supabase/supabase-js';

type ViteEnvironment = ImportMeta & {
  env: {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  };
};

const environment = (import.meta as ViteEnvironment).env;
const supabaseUrl = environment.VITE_SUPABASE_URL?.trim() ?? '';
const supabasePublishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

export const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
