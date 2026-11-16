import { supabase } from './supabase';

/** The account with exactly this email (never lists users). null if none, or when signed out. */
export async function findAccount(email: string): Promise<{ id: string; name: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('find_account', { p_email: email.trim() });
  if (error) throw new Error(error.message);
  const row = (data as { id: string; name: string }[] | null)?.[0];
  return row ?? null;
}

/** The name friends see on shared expenses. */
export async function getMyName(): Promise<string | null> {
  if (!supabase) return null;
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return null;
  const { data } = await supabase.from('profiles').select('name').eq('id', uid).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

export async function setMyName(name: string): Promise<void> {
  if (!supabase) return;
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) throw new Error('Sign in first.');
  const { error } = await supabase.from('profiles').update({ name: name.trim() }).eq('id', uid);
  if (error) throw new Error(error.message);
}
