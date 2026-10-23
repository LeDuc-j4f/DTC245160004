// src/middleware/auth.middleware.js
'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

function signToken(user) {
    const payload = {
        sub: user.id,
        username: user.username,
        role: user.role,
        employee_id: user.employee_id || null,
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function authRequired(req, res, next) {
    const h = req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ ok: false, error: 'Missing token' });
    try {
        const decoded = jwt.verify(m[1], JWT_SECRET);
        req.user = decoded;
        return next();
    } catch (err) {
        return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }
}

module.exports = { signToken, authRequired };
