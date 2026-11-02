import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { DEMO_MODE } from './api';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = url && key ? createClient(url, key) : null;
interface AuthValue { token: string | null; ready: boolean; signIn(email: string, password: string): Promise<void>; signOut(): Promise<void>; demoLogin(): void }
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    if (DEMO_MODE && sessionStorage.getItem('clinicdesk:staff') === 'demo') { setToken('local-demo-staff'); setReady(true); return; }
    if (!supabase) { setReady(true); return; }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (live) { setToken(session?.access_token ?? null); setReady(true); } });
    supabase.auth.getSession().then(({ data, error }) => { if (live) { setToken(error ? null : data.session?.access_token ?? null); setReady(true); } });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, []);
  async function signIn(email: string, password: string) {
    if (!supabase) throw new Error('Configure the Supabase public URL and anon key to sign in.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Sign-in failed. Check your email and password.');
    setToken(data.session.access_token);
  }
  async function signOut() { if (supabase) await supabase.auth.signOut(); sessionStorage.removeItem('clinicdesk:staff'); setToken(null); }
  function demoLogin() { if (DEMO_MODE) { sessionStorage.setItem('clinicdesk:staff', 'demo'); setToken('local-demo-staff'); } }
  return <AuthContext.Provider value={{ token, ready, signIn, signOut, demoLogin }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider missing'); return value; }
