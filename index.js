// Basic HTTP server using Node's built-in 'http' module.

const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;

// --- In-memory data store (ephemeral) ---
// I keep a small list of books in memory. This is for testing only.
let books = [
  { id: 1, title: 'Eloquent JS', author: 'Marijn Haverbeke' },
  { id: 2, title: 'You Don\'t Know JS', author: 'Kyle Simpson' },
  { id: 3, title: 'Clean Code', author: 'Robert C. Martin' }
];
let nextId = 4;

// --- Helpers ---
function sendJSON(res, status = 200, payload = {}) {
  // I serialize the payload and set common headers including Content-Length.
  const body = JSON.stringify(payload);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.statusCode = status;
  res.end(body);
}

function parseCookies(cookieHeader) {
  // I parse the Cookie header into an object { name: value }
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach(part => {
    const [k, v] = part.split('=');
    if (!k) return;
    out[k.trim()] = (v || '').trim();
  });
  return out;
}

function nowMs() {
  return Date.now();
}

function readBody(req) {
  // I read the request body and try to parse JSON. Returns a promise.
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve(null);
      try {
        return resolve(JSON.parse(raw));
      } catch (err) {
        // If JSON parse fails, return raw string instead.
        return resolve(raw);
      }
    });
    req.on('error', reject);
  });
}

// Simple auth token for demo. I treat this as the secret for protected routes.
const DEMO_BEARER = 'secret-token-123';

// --- Server ---
const server = http.createServer(async (req, res) => {
  const start = nowMs();

  // Basic CORS & common headers so Postman or browser can test it.
  // I allow everything in demo mode; in production this must be restricted.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  // Handle preflight quickly
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Parse URL and query params
  const fullUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = fullUrl.pathname;
  const searchParams = fullUrl.searchParams;

  // Parse cookies
  const cookies = parseCookies(req.headers.cookie);

  // Simple route matching for /books and /books/:id
  const bookMatch = pathname.match(/^\/books(?:\/(\d+))?$/);

  try {
    // Route: GET /books -> list books, support ?limit & ?page & ?author
    if (req.method === 'GET' && pathname === '/books') {
      // I read query params and filter/limit the in-memory list.
      const limit = parseInt(searchParams.get('limit') || '10', 10);
      const page = parseInt(searchParams.get('page') || '1', 10);
      const author = searchParams.get('author');

      let list = books.slice();
      if (author) list = list.filter(b => b.author.toLowerCase().includes(author.toLowerCase()));
      const startIdx = (page - 1) * limit;
      const pageItems = list.slice(startIdx, startIdx + limit);

      // I add meta so Postman can see paging details.
      return sendJSON(res, 200, { page, limit, total: list.length, data: pageItems });
    }

    // Route: GET /books/:id -> single book
    if (req.method === 'GET' && bookMatch && bookMatch[1]) {
      const id = Number(bookMatch[1]);
      const book = books.find(b => b.id === id);
      if (!book) return sendJSON(res, 404, { error: 'Not found' });

      // I set a sample response header and show cookies received.
      res.setHeader('X-Server-Note', 'served-by-node-http');
      // I also include the cookies received in the body for learning.
      return sendJSON(res, 200, { data: book, cookies });
    }

    // Protected routes: create/update/delete require Authorization header Bearer token.
    const isProtectedMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (isProtectedMethod && pathname.startsWith('/books')) {
      const auth = req.headers.authorization || '';
      const matchBearer = auth.match(/^Bearer\s+(.+)$/i);
      const token = matchBearer ? matchBearer[1] : null;
      if (token !== DEMO_BEARER) {
        // I respond 401 when token is missing or invalid.
        res.setHeader('WWW-Authenticate', 'Bearer realm="simple-demo"');
        return sendJSON(res, 401, { error: 'Unauthorized - invalid or missing bearer token' });
      }
    }

    // Route: POST /books -> create a new book
    if (req.method === 'POST' && pathname === '/books') {
      const body = await readBody(req);
      // I accept both JSON and form-encoded text here; prefer JSON.
      if (!body || !body.title || !body.author) {
        return sendJSON(res, 400, { error: 'Missing title or author in request body' });
      }
      const book = { id: nextId++, title: String(body.title), author: String(body.author) };
      books.push(book);

      // I set a session cookie to demonstrate Set-Cookie header.
      const sessionId = crypto.randomBytes(12).toString('hex');
      // I set cookie attributes: HttpOnly and Path. In real apps add Secure and SameSite.
      res.setHeader('Set-Cookie', `sessionId=${sessionId}; HttpOnly; Path=/`);

      return sendJSON(res, 201, { data: book });
    }

    // Route: PUT /books/:id -> replace book completely
    if (req.method === 'PUT' && bookMatch && bookMatch[1]) {
      const id = Number(bookMatch[1]);
      const body = await readBody(req);
      if (!body || !body.title || !body.author) {
        return sendJSON(res, 400, { error: 'Missing title or author in request body' });
      }
      const idx = books.findIndex(b => b.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
      books[idx] = { id, title: String(body.title), author: String(body.author) };
      return sendJSON(res, 200, { data: books[idx] });
    }

    // Route: PATCH /books/:id -> partial update
    if (req.method === 'PATCH' && bookMatch && bookMatch[1]) {
      const id = Number(bookMatch[1]);
      const body = await readBody(req);
      if (!body) return sendJSON(res, 400, { error: 'Missing body' });
      const book = books.find(b => b.id === id);
      if (!book) return sendJSON(res, 404, { error: 'Not found' });
      if (body.title !== undefined) book.title = String(body.title);
      if (body.author !== undefined) book.author = String(body.author);
      return sendJSON(res, 200, { data: book });
    }

    // Route: DELETE /books/:id -> remove book
    if (req.method === 'DELETE' && bookMatch && bookMatch[1]) {
      const id = Number(bookMatch[1]);
      const idx = books.findIndex(b => b.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
      const removed = books.splice(idx, 1)[0];
      return sendJSON(res, 200, { data: removed });
    }

    // If no route matched, return 404
    return sendJSON(res, 404, { error: 'Route not found' });
  } catch (err) {
    // I log the error server-side and return 500 to the client.
    console.error('Server error:', err);
    sendJSON(res, 500, { error: 'Internal Server Error' });
  } finally {
    // I add timing info so Postman can see how long the server took.
    const ms = nowMs() - start;
    res.setHeader('X-Response-Time-ms', String(ms));
  }
});

server.listen(PORT, () => {
  // I print a short message so it is easy to know the server is running.
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /books');
  console.log('  GET  /books/:id');
  console.log('  POST /books (requires Authorization: Bearer secret-token-123)');
  console.log('  PUT  /books/:id (requires Authorization)');
  console.log('  PATCH /books/:id (requires Authorization)');
  console.log('  DELETE /books/:id (requires Authorization)');

  console.log('\nExample curl requests (I can run these to test):');
  console.log("  curl 'http://localhost:3000/books'\n");
  console.log("  curl -X POST http://localhost:3000/books -H 'Content-Type: application/json' -H 'Authorization: Bearer secret-token-123' -d '{\"title\":\"New Book\",\"author\":\"Anon\"}'\n");
});

// --- Notes inside the file (for learning) ---
/*
  Behind the scenes (I wrote these notes for myself):

  - When a request arrives, Node gives a socket + req/res objects. The req contains headers,
    method, and the raw URL. The server reads the headers to get cookies or Authorization.

  - Cookies: The client sends Cookie: name=value; other=value. I parse that header.
    To set cookies, the server sends Set-Cookie response header. Browsers then save
    those cookies and send them on subsequent requests.

  - Authorization: For protected endpoints, I look for req.headers.authorization.
    The typical format is 'Bearer <token>'. The server must validate that token.
    If not valid, the server responds 401 and may include WWW-Authenticate header.

  - Body parsing: For POST/PUT/PATCH, request body arrives as data events. I collect
    chunks and parse JSON when Content-Type is application/json. If parsing fails
    the raw string is returned. In real apps a library handles this robustly.

  - Status codes: I use 200 (OK), 201 (Created), 204 (No Content for OPTIONS),
    400 (Bad Request), 401 (Unauthorized), 404 (Not Found), 500 (Server Error).

  - Content-Length: I set Content-Length to let clients know how many bytes to read.

  - Response time: I set X-Response-Time-ms so it is visible in Postman’s response pane.

  - Persistence: The in-memory array is ephemeral. Restarting the server resets data.
    For production, replace this with a database (Postgres, MongoDB, etc.).
*/
