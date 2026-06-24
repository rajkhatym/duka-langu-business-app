import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';

const fallbackSupabaseUrl = 'https://weejufeyzmzrliamkkpg.supabase.co';
const fallbackSupabaseAnonKey = 'sb_publishable_b66tr9V_nhmQH6f4LmbUwQ_EawjRsd4';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || fallbackSupabaseUrl;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || fallbackSupabaseAnonKey;
const hasPlaceholderConfig =
  supabaseUrl?.includes('xxxxxxxxxxxx') || supabaseAnonKey === 'your-anon-public-key';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && !hasPlaceholderConfig);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Tengeneza faili la .env (angalia .env.example).'
  );
}

// AsyncStorage's web implementation touches `window`, which is unavailable
// during static web SSR. Fall back to a no-op store in that environment.
const noopStorage: SupportedStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: typeof window === 'undefined' ? noopStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
