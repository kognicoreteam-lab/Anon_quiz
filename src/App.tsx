import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ToastProvider } from './context/ToastContext.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { LandingScreen } from './components/landing/LandingScreen.tsx';
import { HostDashboard } from './components/host/HostDashboard.tsx';
import { UserJoin } from './components/participant/UserJoin.tsx';

function AppRouter() {
  const { user, loading } = useAuth();
  const [routeUrl, setRouteUrl] = useState<string>(
    () => window.location.pathname + window.location.search
  );

  const navigate = useCallback((nextPath: string) => {
    const current = window.location.pathname + window.location.search;
    if (nextPath !== current) {
      window.history.pushState({}, '', nextPath);
      setRouteUrl(nextPath);
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setRouteUrl(window.location.pathname + window.location.search);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const parsedRoute = new URL(routeUrl, window.location.origin);
  const pathname = parsedRoute.pathname;
  const qrParam = parsedRoute.searchParams.get('qr');

  // Match /quiz/:quizId
  const quizMatch = pathname.match(/^\/quiz\/([^/]+)\/?$/);
  if (quizMatch) {
    const quizId = decodeURIComponent(quizMatch[1]);
    return <UserJoin quizId={quizId} qrParam={qrParam} onNavigate={navigate} />;
  }

  // Match /host
  if (pathname === '/host' || pathname.startsWith('/host/')) {
    if (loading) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
        </div>
      );
    }
    if (!user) {
      return <LandingScreen onNavigate={navigate} />;
    }
    return <HostDashboard onNavigate={navigate} />;
  }

  return <LandingScreen onNavigate={navigate} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
