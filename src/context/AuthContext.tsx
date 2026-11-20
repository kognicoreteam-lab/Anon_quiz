import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase.ts';
import type { HostUser } from '../types/quiz.ts';
import { syncHostProfile } from '../services/index.ts';
import { isAllowedHostEmail } from '../config/hostAccess.ts';

interface AuthContextValue {
  user: HostUser | null;
  loading: boolean;
  accessDeniedMessage: string | null;
  clearAccessDenied: () => void;
  signInWithGoogle: () => Promise<HostUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const UNAUTHORIZED_HOST_MSG =
  'Access denied. Only authorized host email accounts are permitted to access Host Mode.';

function mapFirebaseUser(fbUser: FirebaseUser): HostUser {
  return {
    uid: fbUser.uid,
    email: fbUser.email || '',
    displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Host',
    photoURL: fbUser.photoURL || undefined,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<HostUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        if (fbUser.emailVerified && isAllowedHostEmail(fbUser.email)) {
          const mapped = mapFirebaseUser(fbUser);
          setUser(mapped);
          setAccessDeniedMessage(null);
          void syncHostProfile(mapped).catch((err) => {
            console.error('Host profile sync error:', err);
          });
        } else {
          setUser(null);
          setAccessDeniedMessage(
            !fbUser.emailVerified
              ? 'Your Google account email must be verified to host quizzes.'
              : UNAUTHORIZED_HOST_MSG
          );
          void firebaseSignOut(auth).catch(() => {
            // ignore transient sign-out failure
          });
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signInWithGoogle = async (): Promise<HostUser> => {
    setAccessDeniedMessage(null);
    const credential = await signInWithPopup(auth, googleProvider);
    const fbUser = credential.user;
    if (!fbUser.emailVerified) {
      await firebaseSignOut(auth);
      const msg = 'Your Google account email must be verified to host quizzes.';
      setAccessDeniedMessage(msg);
      throw new Error(msg);
    }
    if (!isAllowedHostEmail(fbUser.email)) {
      await firebaseSignOut(auth);
      setAccessDeniedMessage(UNAUTHORIZED_HOST_MSG);
      throw new Error(UNAUTHORIZED_HOST_MSG);
    }
    const mapped = mapFirebaseUser(fbUser);
    setUser(mapped);
    await syncHostProfile(mapped);
    return mapped;
  };

  const signOut = async (): Promise<void> => {
    await firebaseSignOut(auth);
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
