const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function createServer() {
  return http.createServer(async (req, res) => {
    const host = req.headers.host || 'localhost:3000';
    const parsed = new URL(req.url, `http://${host}`);
    let pathname = parsed.pathname;
    const query = Object.fromEntries(parsed.searchParams.entries());

    // API routes
    if (pathname.startsWith('/api/')) {
      const apiName = pathname.replace('/api/', '').split('/')[0];
      const apiFile = path.join(ROOT, 'api', `${apiName}.js`);
      if (fs.existsSync(apiFile)) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          req.query = query;
          try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = body; }

          res.status = function (code) { this.statusCode = code; return this; };
          res.json = function (obj) {
            this.setHeader('Content-Type', 'application/json');
            this.end(JSON.stringify(obj));
            return this;
          };

          try {
            const handler = require(apiFile);
            await handler(req, res);
          } catch (err) {
            console.error('API Error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }
    }

    // Rewrites
    if (pathname === '/apply') pathname = '/apply.html';
    if (pathname === '/interview') pathname = '/interview.html';
    if (pathname === '/') pathname = '/index.html';

    const filePath = path.join(ROOT, pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  createServer().listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = { createServer };
