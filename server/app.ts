import express, { type Express } from 'express';
import { store as defaultStore, type DataStore } from './db/store.ts';
import { eventBus as defaultBus, type RealtimeEventBus } from './realtime/eventBus.ts';
import type { GoogleTokenVerifier } from './middleware/firebaseAuth.ts';
import { createAuthRoutes } from './routes/authRoutes.ts';
import { createHostRoutes } from './routes/hostRoutes.ts';
import { createParticipantRoutes } from './routes/participantRoutes.ts';
import { createSseRoutes } from './routes/sseRoutes.ts';

export interface CreateAppOptions {
  dataStore?: DataStore;
  bus?: RealtimeEventBus;
  verifyGoogleToken?: GoogleTokenVerifier;
}

export function createApiApp(options: CreateAppOptions = {}): Express {
  const dataStore = options.dataStore ?? defaultStore;
  const bus = options.bus ?? defaultBus;

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, runtime: 'node', timestamp: Date.now() });
  });

  app.use('/api/auth', createAuthRoutes(dataStore, { verifyGoogleToken: options.verifyGoogleToken }));
  app.use('/api/host', createHostRoutes(dataStore, bus));
  app.use('/api/public', createParticipantRoutes(dataStore, bus));
  app.use('/api/events', createSseRoutes(dataStore, bus));

  // JSON 404 for unknown /api/* routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}
