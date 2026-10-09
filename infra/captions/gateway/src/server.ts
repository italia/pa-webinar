/**
 * HTTP e WebSocket del gateway, sulla stessa porta:
 *
 * - `GET /healthz`: il processo è vivo;
 * - `GET /readyz`: il motore risponde (503 altrimenti);
 * - `GET /status`: stato per il portale (carico, voci, sospensioni), senza
 *   dati personali;
 * - WebSocket `/transcribe/<meetingId>?room=<stanza>`: la connessione del
 *   bridge. Se è configurato un segreto, il bridge lo presenta nell'header
 *   `X-Captions-Token` (o come `Authorization: Bearer`), messo da Jicofo.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { WebSocketServer } from 'ws';

import type { Gateway } from './gateway.js';

function tokenMatches(expected: string, req: IncomingMessage): boolean {
  const header = req.headers['x-captions-token'];
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  const given = (Array.isArray(header) ? header[0] : header) ?? bearer ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `/transcribe/<meetingId>` → meetingId; il resto dell'URL dà la stanza. */
export function parseTranscribePath(url: string): { meetingId: string; room: string | null } | null {
  const parsed = new URL(url, 'http://localhost');
  const match = /^\/transcribe(?:\/([^/]+))?\/?$/.exec(parsed.pathname);
  if (!match) return null;
  const room = parsed.searchParams.get('room');
  return {
    meetingId: match[1] ? decodeURIComponent(match[1]) : 'unknown',
    room: room && room.length <= 256 ? room : null,
  };
}

export function createGatewayServer(gateway: Gateway): Server {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (req.method === 'GET' && (path === '/readyz' || path === '/status')) {
      const status = gateway.status();
      const code = path === '/readyz' && status.engine !== 'up' ? 503 : 200;
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(status));
      return;
    }
    res.writeHead(404).end();
  });

  server.on('upgrade', (req, socket, head) => {
    const target = parseTranscribePath(req.url ?? '/');
    const token = gateway.config.authToken;
    if (!target) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    if (token && !tokenMatches(token, req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log(`[captions] conferenza collegata (${target.meetingId})`);
      ws.on('close', () => console.log(`[captions] conferenza chiusa (${target.meetingId})`));
      gateway.attach(ws, target.meetingId, target.room).catch((err: Error) => {
        console.warn(`[captions] conferenza rifiutata: ${err.message}`);
        ws.close(1011);
      });
    });
  });

  return server;
}
