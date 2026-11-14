/**
 * Checks EXPO_PUBLIC_SUPABASE_URL for the common setup mistakes and returns a
 * human-readable problem, or null if it looks right.
 */
export function supabaseUrlProblem(url: string | undefined): string | null {
  if (!url) return null; // not configured: the app runs offline
  const u = url.trim();
  if (u !== url) return 'EXPO_PUBLIC_SUPABASE_URL has spaces around it. Remove them.';
  if (/^["']|["']$/.test(u)) return 'EXPO_PUBLIC_SUPABASE_URL is wrapped in quotes. Remove them.';
  if (u.includes('your-project-ref')) {
    return 'EXPO_PUBLIC_SUPABASE_URL is still the example value from .env.example. Paste your Project URL from Supabase → Project Settings → API, then restart with "npx expo start --clear".';
  }
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return `EXPO_PUBLIC_SUPABASE_URL is not a valid URL: "${u}". It should look like https://abcdefghijklmnop.supabase.co`;
  }
  if (parsed.protocol !== 'https:') return 'EXPO_PUBLIC_SUPABASE_URL must start with https://';
  if (parsed.hostname.includes('supabase.com')) {
    return 'EXPO_PUBLIC_SUPABASE_URL is the dashboard address. Use the Project URL from Project Settings → API (it ends in .supabase.co).';
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return `EXPO_PUBLIC_SUPABASE_URL should end at ".supabase.co" with nothing after it (remove "${parsed.pathname}").`;
  }
  return null;
}

/** The host name the app will contact, for showing in error messages. */
export function supabaseHost(url: string | undefined): string {
  if (!url) return '(not set)';
  try {
    return new URL(url.trim().replace(/^["']|["']$/g, '')).hostname || url;
  } catch {
    return url;
  }
}
