import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { supabaseHost, supabaseUrlProblem } from './supabaseUrl';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Shown in Settings and sign-in errors so setup mistakes are visible on the phone. */
export const SUPABASE_HOST = supabaseHost(url);
export const SUPABASE_URL_PROBLEM = supabaseUrlProblem(url);

/** Turns a raw network error into one that says which server could not be reached. */
export function describeNetworkError(message: string): string {
  if (SUPABASE_URL_PROBLEM) return SUPABASE_URL_PROBLEM;
  if (/fetch failed|network request failed|hostname could not be found|failed to fetch/i.test(message)) {
    return `Could not reach ${SUPABASE_HOST}. Check that this matches the Project URL in Supabase → Project Settings → API, that the project is not paused, and that your phone is online. (${message})`;
  }
  return message;
}

/** null when the app is run without Supabase configured: it then works fully offline. */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;

// Only refresh auth tokens while the app is in the foreground.
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
