import { spawn } from 'child_process';
import { resolve } from 'path';
import type { NextRequest } from 'next/server';

import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

// NSE symbols are uppercase letters/digits, occasionally a hyphen (e.g. M&M
// is stored as MM, but some platforms use hyphens). Keep it tight.
const SYMBOL_RE = /^[A-Z][A-Z0-9&-]{0,24}$/;

type Params = { params: Promise<{ portfolioId: string; symbol: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { portfolioId, symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol).toUpperCase();

  if (!SYMBOL_RE.test(symbol)) {
    return new Response('Invalid symbol', { status: 400 });
  }

  const scriptPath = resolve(process.cwd(), 'scripts/research-refresh.py');
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(enc.encode(`data: ${data}\n\n`));
        } catch {
          // controller already closed — ignore
        }
      };

      const child = spawn('python3', ['-u', scriptPath, symbol, portfolioId], {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      let buf = '';

      child.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        // Emit complete lines only — partial JSON would break parsing.
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) send(trimmed);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        // stderr goes to server logs only, not the SSE stream.
        process.stderr.write(chunk);
      });

      child.on('close', (code) => {
        // Flush any remaining partial line.
        if (buf.trim()) send(buf.trim());
        send(JSON.stringify({ type: 'close', code }));
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      child.on('error', (err) => {
        send(JSON.stringify({ type: 'error', message: err.message }));
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      // If the client disconnects, kill the child to avoid orphaned processes.
      req.signal.addEventListener('abort', () => {
        child.kill('SIGTERM');
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering if behind a proxy
    },
  });
}
