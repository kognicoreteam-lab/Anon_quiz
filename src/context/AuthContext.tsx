import React, { createContext, useContext, useEffect, useState } from 'react';
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase.ts';
import type { HostUser } from '../types/quiz.ts';
import {
  ApiError,
  apiRequest,
  getStoredHostToken,
  setStoredHostToken,
} from '../services/httpClient.ts';
import { isAllowedHostEmail } from '../config/hostAccess.ts';

interface AuthContextValue {
  user: HostUser | null;
  loading: boolean;
  accessDeniedMessage: string | null;
  clearAccessDenied: () => void;
  signInWithGoogle: () => Promise<HostUser>;
  signInHost: (email: string, password: string) => Promise<HostUser>;
  registerHost: (email: string, password: string, displayName?: string) => Promise<HostUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const UNAUTHORIZED_HOST_MSG =
  'Access denied. Only authorized host email accounts are permitted to access Host Mode.';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<HostUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const token = getStoredHostToken();
    if (!token) {
      setLoading(false);
      return;
    }

    apiRequest<{ user: HostUser }>('/api/auth/me', { auth: true })
      .then((data) => {
        if (!active) return;
        if (data.user && isAllowedHostEmail(data.user.email)) {
          setUser(data.user);
        } else {
          setStoredHostToken(null);
          setUser(null);
        }
      })
      .catch(() => {
        if (!active) return;
        setStoredHostToken(null);
        setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const signInWithGoogle = async (): Promise<HostUser> => {
    setAccessDeniedMessage(null);
    const credential = await signInWithPopup(auth, googleProvider);
    const fbUser = credential.user;

    if (!fbUser.emailVerified) {
      await firebaseSignOut(auth).catch(() => undefined);
      const msg = 'Your Google account email must be verified to host quizzes.';
      setAccessDeniedMessage(msg);
      throw new Error(msg);
    }

    if (!isAllowedHostEmail(fbUser.email)) {
      await firebaseSignOut(auth).catch(() => undefined);
      setAccessDeniedMessage(UNAUTHORIZED_HOST_MSG);
      throw new ApiError(UNAUTHORIZED_HOST_MSG, 403);
    }

    const idToken = await fbUser.getIdToken();
    const data = await apiRequest<{ user: HostUser; token: string }>('/api/auth/google', {
      method: 'POST',
      body: { idToken },
    });

    setStoredHostToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const signInHost = async (email: string, password: string): Promise<HostUser> => {
    setAccessDeniedMessage(null);
    const cleanedEmail = email.trim().toLowerCase();
    if (!isAllowedHostEmail(cleanedEmail)) {
      setAccessDeniedMessage(UNAUTHORIZED_HOST_MSG);
      throw new ApiError(UNAUTHORIZED_HOST_MSG, 403);
    }

    const data = await apiRequest<{ user: HostUser; token: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: cleanedEmail, password },
    });

    setStoredHostToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const registerHost = async (
    email: string,
    password: string,
    displayName?: string
  ): Promise<HostUser> => {
    setAccessDeniedMessage(null);
    const cleanedEmail = email.trim().toLowerCase();
    if (!isAllowedHostEmail(cleanedEmail)) {
      setAccessDeniedMessage(UNAUTHORIZED_HOST_MSG);
      throw new ApiError(UNAUTHORIZED_HOST_MSG, 403);
    }

    const data = await apiRequest<{ user: HostUser; token: string }>('/api/auth/register', {
      method: 'POST',
      body: { email: cleanedEmail, password, displayName: displayName?.trim() || undefined },
    });

    setStoredHostToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const signOut = async (): Promise<void> => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', auth: true });
    } catch {
      // ignore network error on logout
    }
    await firebaseSignOut(auth).catch(() => undefined);
    setStoredHostToken(null);
    setUser(null);
    setAccessDeniedMessage(null);
  };

  const clearAccessDenied = () => setAccessDeniedMessage(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        accessDeniedMessage,
        clearAccessDenied,
        signInWithGoogle,
        signInHost,
        registerHost,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
