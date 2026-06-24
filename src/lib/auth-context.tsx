import type { Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
type PreviewRole = 'owner' | 'manager' | 'cashier';
const PREVIEW_ROLE_KEY = 'godown.preview-role.v1';

function isPreviewHost() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return (
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname.endsWith('.netlify.app') ||
    window.location.hostname.endsWith('.vercel.app') ||
    window.location.hostname.endsWith('.ondigitalocean.app') ||
    window.location.hostname.endsWith('.loca.lt') ||
    window.location.hostname.endsWith('.tunnelmole.net')
  );
}

function getPreviewRole(): PreviewRole | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const search = window.location.search;
  const hash = window.location.hash.toLowerCase();
  let role: PreviewRole | null = null;
  const explicitRole = params.get('previewRole') ?? params.get('role');
  if (explicitRole === 'owner' || explicitRole === 'manager' || explicitRole === 'cashier') role = explicitRole;
  if (search.includes('owner=preview') || hash.includes('owner')) role = 'owner';
  if (search.includes('manager=preview') || hash.includes('manager')) role = 'manager';
  if (search.includes('cashier=preview') || hash.includes('cashier')) role = 'cashier';

  if (role) {
    window.sessionStorage.setItem(PREVIEW_ROLE_KEY, role);
    return role;
  }

  if (!isPreviewHost()) return null;
  const storedRole = window.sessionStorage.getItem(PREVIEW_ROLE_KEY);
  return storedRole === 'owner' || storedRole === 'manager' || storedRole === 'cashier'
    ? storedRole
    : null;
}

export function isOwnerPreviewMode() {
  return getPreviewRole() === 'owner';
}

export function isCashierPreviewMode() {
  return getPreviewRole() === 'cashier';
}

export function isManagerPreviewMode() {
  return getPreviewRole() === 'manager';
}

export function isAnyPreviewMode() {
  return isOwnerPreviewMode() || isCashierPreviewMode() || isManagerPreviewMode();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const ownerPreviewMode = isOwnerPreviewMode();
  const cashierPreviewMode = isCashierPreviewMode();
  const managerPreviewMode = isManagerPreviewMode();
  const effectiveProfile: Profile | null = ownerPreviewMode
    ? {
        id: 'owner-preview',
        full_name: 'Rajab Salum',
        role: 'owner',
        branch_id: null,
        created_at: new Date().toISOString(),
      }
    : cashierPreviewMode
      ? {
          id: 'cashier-preview',
          full_name: 'Cashier',
          role: 'cashier',
          branch_id: 'adiasports',
          created_at: new Date().toISOString(),
        }
    : managerPreviewMode
      ? {
          id: 'manager-preview',
          full_name: 'Manager',
          role: 'manager',
          branch_id: 'adiasports',
          created_at: new Date().toISOString(),
        }
    : profile;
  const effectiveRole = effectiveProfile?.role;
  const isOwner = ownerPreviewMode || ['owner', 'admin'].includes(effectiveRole ?? '');
  const isAdmin = isOwner || ['manager'].includes(effectiveRole ?? '');

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile((data as Profile) ?? null);
  };

  useEffect(() => {
    let mounted = true;

    if (ownerPreviewMode || cashierPreviewMode || managerPreviewMode) {
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        await fetchProfile(data.session.user.id);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        await fetchProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [cashierPreviewMode, managerPreviewMode, ownerPreviewMode]);

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  };

  const signUp: AuthContextValue['signUp'] = async (email, password, fullName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    return {
      error: error?.message ?? null,
      needsEmailConfirmation: !error && !data.session,
    };
  };

  const signOut = async () => {
    if ((ownerPreviewMode || cashierPreviewMode || managerPreviewMode) && Platform.OS === 'web' && typeof window !== 'undefined') {
      window.sessionStorage.removeItem(PREVIEW_ROLE_KEY);
      window.location.assign('/login?v=preview-logout');
      return;
    }
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (session?.user) await fetchProfile(session.user.id);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile: effectiveProfile,
        loading,
        isAdmin,
        isOwner,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
