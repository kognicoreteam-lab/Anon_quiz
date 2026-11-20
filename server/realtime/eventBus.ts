import type { Response } from 'express';

type ChannelClients = Map<string, Set<Response>>;

export class RealtimeEventBus {
  private channels: ChannelClients = new Map();

  subscribe(channel: string, res: Response): () => void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(res);

    // Send initial connected heartbeat
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }
    }, 25_000);

    const cleanup = () => {
      clearInterval(keepAlive);
      const set = this.channels.get(channel);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          this.channels.delete(channel);
        }
      }
    };

    res.on('close', cleanup);
    return cleanup;
  }

  publish(channel: string, event: string, payload: unknown): void {
    const clients = this.channels.get(channel);
    if (!clients || clients.size === 0) return;

    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      if (!res.writableEnded) {
        res.write(frame);
      }
    }
  }
}

export const eventBus = new RealtimeEventBus();

export const hostChannel = (hostUid: string) => `host:${hostUid}`;
export const quizChannel = (quizId: string) => `quiz:${quizId}`;
export const pollChannel = (quizId: string) => `poll:${quizId}`;
export const resultChannel = (quizId: string, submissionId: string) =>
  `result:${quizId}:${submissionId}`;
