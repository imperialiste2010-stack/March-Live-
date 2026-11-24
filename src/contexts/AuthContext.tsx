import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import { apiUrl, isNativeMobileContainer } from '../lib/api.ts';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { CustomerProfile, DbUser, MerchantShop } from '../types.ts';

interface AuthContextValue {
  firebaseUser: User | null;
  dbUser: DbUser | null;
  customerProfile: CustomerProfile | null;
  merchantShops: MerchantShop[];
  unreadNotificationsCount: number;
  loading: boolean;
  lang: 'fr' | 'nouchi';
  setLang: (l: 'fr' | 'nouchi') => void;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  apiFetch: <T = any>(url: string, options?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [merchantShops, setMerchantShops] = useState<MerchantShop[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<'fr' | 'nouchi'>('fr');

  const apiFetch = useCallback(
    async <T = any>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }

      const currentUser = auth.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        headers.set('Authorization', `Bearer ${token}`);
      }

      const res = await fetch(apiUrl(url), { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Erreur réseau (${res.status})`);
      }
      return data as T;
    },
    []
  );

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) {
      setDbUser(null);
      setCustomerProfile(null);
      setMerchantShops([]);
      setUnreadNotificationsCount(0);
      return;
    }
    try {
      const data = await apiFetch<{
        user: DbUser;
        customerProfile: CustomerProfile | null;
        shops: MerchantShop[];
        unreadNotificationsCount: number;
      }>('/api/me');
      setDbUser(data.user);
      setCustomerProfile(data.customerProfile);
      setMerchantShops(data.shops || []);
      setUnreadNotificationsCount(data.unreadNotificationsCount || 0);
      if (data.user.preferredLang === 'nouchi' || data.user.preferredLang === 'fr') {
        setLang(data.user.preferredLang);
      }
    } catch (err) {
      console.error('Failed to load /api/me:', err);
    }
  }, [apiFetch]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await refreshProfile();
      } else {
        setDbUser(null);
        setCustomerProfile(null);
        setMerchantShops([]);
        setUnreadNotificationsCount(0);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [refreshProfile]);

  const signIn = useCallback(async () => {
    if (isNativeMobileContainer()) {
      await signInWithRedirect(auth, googleAuthProvider);
      return;
    }
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(auth, googleAuthProvider);
        return;
      }
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        dbUser,
        customerProfile,
        merchantShops,
        unreadNotificationsCount,
        loading,
        lang,
        setLang,
        signIn,
        logout,
        refreshProfile,
        apiFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
