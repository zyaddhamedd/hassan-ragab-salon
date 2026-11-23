import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, '..');
const distRoot = path.join(workspace, '.local/hassan/frontend-dist');
const port = Number(process.env.PORT);
const backendUrl = (process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');

if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT must be a positive integer');
}

function sendText(response, status, body, headers = {}) {
  response.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8', ...headers});
  response.end(body);
}

function contentType(filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg',
  };
  return types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function proxyBackend(request, response) {
  if (!backendUrl) {
    sendText(response, 503, 'BACKEND_URL is not configured');
    return;
  }

  let target;
  try {
    target = new URL(request.url, backendUrl);
  } catch {
    sendText(response, 502, 'Invalid backend target');
    return;
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    sendText(response, 502, 'Invalid backend protocol');
    return;
  }

  const transport = target.protocol === 'https:' ? https : http;
  const headers = {
    ...request.headers,
    host: target.host,
    'x-forwarded-host': request.headers.host || '',
    'x-forwarded-proto': request.headers['x-forwarded-proto'] || 'https',
    'x-forwarded-for': request.socket.remoteAddress || '',
  };
  const upstream = transport.request(target, {
    method: request.method,
    headers,
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on('error', error => {
    if (!response.headersSent) {
      sendText(response, 502, 'Backend proxy error');
    } else {
      response.destroy(error);
    }
  });
  request.pipe(upstream);
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;

  if (pathname === '/health') {
    proxyBackend(request, response);
    return;
  }

  if (pathname === '/api/' || pathname.startsWith('/api/')) {
    proxyBackend(request, response);
    return;
  }

  if (pathname === '/uploads' || pathname.startsWith('/uploads/')) {
    proxyBackend(request, response);
    return;
  }

  if (pathname === '/' || pathname === '') {
    response.writeHead(302, {Location: '/admin/'});
    response.end();
    return;
  }

  if (pathname === '/audio' || pathname.startsWith('/audio/')) {
    const audioRoot = path.join(distRoot, 'mini');
    const audioFile = path.resolve(audioRoot, `.${pathname}`);
    if (!audioFile.startsWith(audioRoot + path.sep)) {
      sendText(response, 403, 'Forbidden');
      return;
    }
    fs.stat(audioFile, (error, stats) => {
      if (!error && stats.isFile()) {
        response.writeHead(200, {
          'Content-Type': contentType(audioFile),
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        fs.createReadStream(audioFile).pipe(response);
        return;
      }
      sendText(response, 404, 'Audio asset not found');
    });
    return;
  }

  const app = pathname.startsWith('/admin') ? 'admin'
    : pathname.startsWith('/mini') ? 'mini'
    : null;

  if (!app) {
    sendText(response, 404, 'Not found');
    return;
  }

  if (pathname === `/${app}`) {
    response.writeHead(302, {Location: `/${app}/`});
    response.end();
    return;
  }

  const appRoot = path.join(distRoot, app);
  if (pathname === `/${app}/`) {
    fs.readFile(path.join(appRoot, 'index.html'), (indexError, html) => {
      if (indexError) {
        sendText(response, 404, `${app} build not found`);
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      response.end(html);
    });
    return;
  }

  const relative = pathname.slice(app.length + 1);
  const filePath = path.resolve(appRoot, `.${relative}`);

  if (!filePath.startsWith(appRoot + path.sep)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (!error && stats.isFile()) {
      response.writeHead(200, {
        'Content-Type': contentType(filePath),
        'Cache-Control': filePath.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      fs.createReadStream(filePath).pipe(response);
      return;
    }

    fs.readFile(path.join(appRoot, 'index.html'), (indexError, html) => {
      if (indexError) {
        sendText(response, 404, `${app} build not found`);
        return;
      }
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
      response.end(html);
    });
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Hassan Ragab Frontend listening on 0.0.0.0:${port}`);
});
