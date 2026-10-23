import { createClient } from '@supabase/supabase-js';
import { CONFIG, assertConfig } from './config';

assertConfig();

export const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
