// The local mirror's stand-in for Supabase, so the app can run against it.
// Started by `scripts/localdb.sh serve`; see scripts/README.md.
//
//   /rest/v1/*  → PostgREST, which serves the local database (localdb.sh up)
//   /auth/v1/*  → a minimal fake of Supabase Auth's implicit OAuth flow. The
//                 "provider" is a local page offering the three seeded users
//                 (admin, contributor, viewer), so signing in needs no GitHub,
//                 no Google and no password.
//
// Tokens are HS256 JWTs signed with the local PostgREST secret; PostgREST
// verifies them and the database's auth.uid() reads their `sub`, so the REAL
// RLS policies decide what each user may do — only the identity is stubbed,
// as everywhere else in localdb. Everything listens on 127.0.0.1 only: this
// serves a copy of production and has no business on the network.
import http from 'http';
import crypto from 'crypto';

const SECRET = process.env.LOCALDB_JWT_SECRET;
const PORT = Number(process.env.LOCALDB_API_PORT || 3998);
const PGRST_PORT = Number(process.env.LOCALDB_PGRST_PORT || 3999);
if (!SECRET) { console.error('LOCALDB_JWT_SECRET is not set — start this through scripts/localdb.sh serve'); process.exit(1); }
const USERS = {
    '00000000-0000-4000-a000-000000000001': { email: 'admin@localdb.test',       name: 'Local admin' },
    '00000000-0000-4000-a000-000000000002': { email: 'contributor@localdb.test', name: 'Local contributor' },
    '00000000-0000-4000-a000-000000000003': { email: 'viewer@localdb.test',      name: 'Local viewer (user role)' },
};
const TTL = 3600;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function mint(uid) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ sub: uid, role: 'authenticated', aud: 'authenticated', email: USERS[uid].email, iat: now, exp: now + TTL });
    return `${head}.${body}.${sign(`${head}.${body}`)}`;
}
function verify(token) {
    const [h, b, s] = String(token ?? '').split('.');
    if (!h || !b || !s || sign(`${h}.${b}`) !== s) return null;
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
    return claims.exp > Date.now() / 1000 && USERS[claims.sub] ? claims : null;
}
const userJson = (uid) => ({
    id: uid, aud: 'authenticated', role: 'authenticated', email: USERS[uid].email,
    app_metadata: { provider: 'local', providers: ['local'] },
    user_metadata: { full_name: USERS[uid].name, name: USERS[uid].name },
    created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
});
const session = (uid) => {
    const now = Math.floor(Date.now() / 1000);
    return { access_token: mint(uid), token_type: 'bearer', expires_in: TTL, expires_at: now + TTL,
             refresh_token: `local-${uid}`, user: userJson(uid) };
};
// Only ever redirect back to a local page — never an open redirect.
const safeRedirect = (to) => {
    try { const u = new URL(to); return ['localhost', '127.0.0.1'].includes(u.hostname) ? u.toString() : null; }
    catch { return null; }
};

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};
const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { ...cors, 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise(r => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => r(d)); });

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path.startsWith('/auth/v1/')) {
        if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
        if (path === '/auth/v1/authorize') {
            const to = safeRedirect(url.searchParams.get('redirect_to'));
            if (!to) return send(res, 400, { error: 'redirect_to must be a local page' });
            const links = Object.entries(USERS).map(([uid, u]) =>
                `<li><a href="/auth/v1/local-signin?uid=${uid}&redirect_to=${encodeURIComponent(to)}">${u.name}</a> <small>${u.email}</small></li>`).join('');
            return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Local sign-in</title>
<body style="font:16px system-ui;margin:3rem;max-width:36rem">
<h2>Local review sign-in</h2>
<p>This is the local copy of EVBench (scripts/localdb.sh), not production.
There is no GitHub or Google here — pick a local test user. The real access rules apply to each.</p>
<ul style="line-height:2">${links}</ul></body>`, 'text/html');
        }
        if (path === '/auth/v1/local-signin') {
            const uid = url.searchParams.get('uid');
            const to = safeRedirect(url.searchParams.get('redirect_to'));
            if (!USERS[uid] || !to) return send(res, 400, { error: 'unknown local user or redirect' });
            const s = session(uid);
            const frag = new URLSearchParams({ access_token: s.access_token, expires_in: String(s.expires_in),
                expires_at: String(s.expires_at), refresh_token: s.refresh_token, token_type: 'bearer', provider_token: '' });
            res.writeHead(302, { Location: `${to.split('#')[0]}#${frag}` });
            return res.end();
        }
        if (path === '/auth/v1/user') {
            const claims = verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
            return claims ? send(res, 200, userJson(claims.sub)) : send(res, 401, { msg: 'invalid local token' });
        }
        if (path === '/auth/v1/token' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const uid = String(body.refresh_token ?? '').replace(/^local-/, '');
            return USERS[uid] ? send(res, 200, session(uid)) : send(res, 400, { error: 'invalid_grant' });
        }
        if (path === '/auth/v1/logout') return send(res, 204, '', 'text/plain');
        return send(res, 404, { error: `local auth stand-in has no ${path}` });
    }

    // Everything else is the data API.
    const target = path.replace(/^\/rest\/v1/, '') + url.search;
    const p = http.request({ host: '127.0.0.1', port: PGRST_PORT, path: target, method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${PGRST_PORT}` } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });  // PostgREST sends its own CORS headers
    p.on('error', e => send(res, 502, { error: String(e) }));
    req.pipe(p);
}).listen(PORT, '127.0.0.1', () => console.log(`local Supabase stand-in on http://127.0.0.1:${PORT}`));
