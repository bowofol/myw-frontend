import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { isSupabaseConfigured, supabaseConfig } from './config.js';

export { isSupabaseConfigured, supabaseConfig };

export const supabase = isSupabaseConfigured()
  ? createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
