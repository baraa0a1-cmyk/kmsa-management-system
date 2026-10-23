import { supabase } from './supabase';

export async function signIn(identifier: string, password: string) {
  const { data, error } = await supabase.functions.invoke('login-by-identifier', {
    body: { identifier: identifier.trim(), password }
  });
  if (error) throw error;
  if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'تعذر تسجيل الدخول.');
  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) throw sessionError;
  return sessionData.session;
}

export async function signOut() { await supabase.auth.signOut(); }
