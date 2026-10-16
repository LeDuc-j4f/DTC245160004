// js/api.js - tiny fetch wrapper
const API = (() => {
    const base = '/api';
    function getToken() { return localStorage.getItem('hrm_token') || ''; }
    function setToken(t) { localStorage.setItem('hrm_token', t); }
    function clearToken() { localStorage.removeItem('hrm_token'); }
    function getUser() { try { return JSON.parse(localStorage.getItem('hrm_user') || 'null'); } catch { return null; } }
    function setUser(u) { localStorage.setItem('hrm_user', JSON.stringify(u)); }
    function clearUser() { localStorage.removeItem('hrm_user'); }

    async function request(path, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        const token = getToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;
        if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.body);
        }
        const r = await fetch(base + path, { ...opts, headers });
        if (r.status === 401) {
            clearToken(); clearUser();
            if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
            throw new Error('Unauthorized');
        }
        const ct = r.headers.get('content-type') || '';
        const data = ct.includes('application/json') ? await r.json() : await r.text();
        if (!r.ok) {
            const err = new Error((data && data.error) || ('HTTP ' + r.status));
            err.status = r.status;
            err.data   = data;
            throw err;
        }
        return data;
    }

    return {
        getToken, setToken, clearToken, getUser, setUser, clearUser,
        get:  (p)    => request(p, { method: 'GET' }),
        post: (p, b) => request(p, { method: 'POST', body: b }),
        put:  (p, b) => request(p, { method: 'PUT',  body: b }),
        del:  (p)    => request(p, { method: 'DELETE' }),
        login: async (username, password) => {
            const r = await request('/auth/login', { method: 'POST', body: { username, password } });
            setToken(r.data.token);
            setUser(r.data.user);
            return r.data;
        },
        logout: () => { clearToken(); clearUser(); location.href = 'login.html'; },
        requireAuth: () => {
            if (!getToken()) { location.href = 'login.html'; return false; }
            return true;
        },
        me: () => request('/auth/me'),
    };
})();
