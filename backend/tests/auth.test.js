// tests/auth.test.js - unit tests for auth middleware
'use strict';

const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';
const { signToken, authRequired } = require('../src/middleware/auth.middleware');

function mockReq(token) {
    return token ? { headers: { authorization: 'Bearer ' + token } } : { headers: {} };
}
function mockRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json   = jest.fn(() => res);
    return res;
}

describe('signToken', () => {
    test('signs a valid JWT', () => {
        const user = { id: 1, username: 'a', role: 'admin', employee_id: null };
        const t = signToken(user);
        const decoded = jwt.verify(t, 'test-secret');
        expect(decoded.sub).toBe(1);
        expect(decoded.username).toBe('a');
        expect(decoded.role).toBe('admin');
    });
});

describe('authRequired', () => {
    test('rejects missing token', () => {
        const req = mockReq(null);
        const res = mockRes();
        const next = jest.fn();
        authRequired(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
    test('rejects invalid token', () => {
        const req = mockReq('not-a-jwt');
        const res = mockRes();
        const next = jest.fn();
        authRequired(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
    test('accepts valid token and sets req.user', () => {
        const user = { id: 1, username: 'a', role: 'hr' };
        const t = signToken(user);
        const req = mockReq(t);
        const res = mockRes();
        const next = jest.fn();
        authRequired(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user.sub).toBe(1);
        expect(req.user.role).toBe('hr');
    });
});
