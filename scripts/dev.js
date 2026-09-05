/**
 * dev.js
 * Starts the whole app with one command: the data-layer API and a static
 * server for the dashboard, in a single terminal, with one Ctrl+C to stop
 * both.
 *
 * Uses only Node's standard library, so there is nothing extra to install
 * beyond the data-layer's own dependencies.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const dashboardDirectory = join(projectRoot, 'frontend-dashboard');

const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT) || 5173;
const API_PORT = Number(process.env.PORT) || 4000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

/**
 * Resolve a request path to a file inside the dashboard folder, refusing
 * anything that escapes it. Without this check a request for
 * "/../../.env" would happily serve the API key.
 */
function resolveSafePath(requestUrl) {
  const rawPath = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const relativePath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
  const absolutePath = normalize(join(dashboardDirectory, relativePath));

  if (!absolutePath.startsWith(dashboardDirectory + sep) && absolutePath !== dashboardDirectory) {
    return null;
  }
  return absolutePath;
}

function startDashboardServer() {
  const server = createServer(async (req, res) => {
    const filePath = resolveSafePath(req.url);

    if (!filePath) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('Forbidden');
    }

    try {
      const fileContents = await readFile(filePath);
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(filePath)] || 'application/octet-stream',
        // The dashboard is edited constantly during a hackathon; never let
        // a browser serve a stale copy from cache.
        'cache-control': 'no-store',
      });
      res.end(fileContents);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `\n  Dashboard port ${DASHBOARD_PORT} is already in use.` +
        `\n  Stop whatever is using it, or run: DASHBOARD_PORT=5174 npm start\n`,
      );
      process.exit(1);
    }
    throw error;
  });

  server.listen(DASHBOARD_PORT, () => {
    console.log('\n  LeakLens is running');
    console.log(`    Dashboard : http://localhost:${DASHBOARD_PORT}`);
    console.log(`    API       : http://localhost:${API_PORT}`);
    console.log('\n  Press Ctrl+C to stop both.\n');
  });

  return server;
}

// The API runs as a child process so its logs interleave with ours and a
// single Ctrl+C brings the whole thing down.
const apiProcess = spawn(
  process.execPath,
  [join(projectRoot, 'data-layer', 'src', 'server.js')],
  { stdio: 'inherit', env: process.env },
);

apiProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`\n  The data-layer exited with code ${code}.`);
    console.error('  Did you run "npm run setup" first?\n');
  }
  process.exit(code ?? 0);
});

const dashboardServer = startDashboardServer();

function shutDown() {
  dashboardServer.close();
  if (!apiProcess.killed) apiProcess.kill();
  process.exit(0);
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
