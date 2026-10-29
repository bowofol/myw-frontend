// Temporary isolation for the unchanged public Supabase data adapters.
// Node owns authentication. Never restore Supabase storage or share MySQL IDs.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { isSupabaseConfigured, supabaseConfig } from '../supabase/config.js';

export { isSupabaseConfigured, supabaseConfig };
const dataClient = isSupabaseConfigured()
  ? createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      accessToken: async () => null,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

export const supabase = dataClient
  ? Object.freeze({
      from: (...args) => dataClient.from(...args),
      storage: dataClient.storage,
      // The existing enquiry adapter may ask for an old UUID. It stays anonymous;
      // no SDK Auth method is called and no Node identity crosses this boundary.
      auth: Object.freeze({
        getUser: async () => ({ data: { user: null }, error: null }),
      }),
    })
  : null;
