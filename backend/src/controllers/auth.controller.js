// src/controllers/auth.controller.js
'use strict';

const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const { pool } = require('../config/db');
const { signToken } = require('../middleware/auth.middleware');
const { runValidation } = require('../middleware/validation.middleware');
const { logger } = require('../config/logger');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const loginValidation = [
    body('username').isString().trim().notEmpty().withMessage('username required'),
    body('password').isString().notEmpty().withMessage('password required'),
];

const registerValidation = [
    body('username').isString().trim().isLength({ min: 3, max: 64 }),
    body('password').isString().isLength({ min: 8, max: 128 }),
    body('role').isIn(['admin', 'hr', 'employee']),
    body('employee_id').optional().isInt(),
];

async function login(req, res) {
    const { username, password } = req.body;
    try {
        const r = await pool.query(
            `SELECT id, username, password_hash, role, employee_id, is_active
             FROM users WHERE username = $1 LIMIT 1`,
            [username]
        );
        if (r.rowCount === 0) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }
        const u = r.rows[0];
        if (!u.is_active) {
            return res.status(403).json({ ok: false, error: 'Account disabled' });
        }
        const ok = await bcrypt.compare(password, u.password_hash);
        if (!ok) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [u.id]);
        const token = signToken(u);
        logger.info('Login success', { user_id: u.id, username: u.username, role: u.role });
        return res.json({
            ok: true,
            data: {
                token,
                user: { id: u.id, username: u.username, role: u.role, employee_id: u.employee_id },
            },
        });
    } catch (err) {
        logger.error('login error', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Login failed' });
    }
}

async function register(req, res) {
    const { username, password, role, employee_id } = req.body;
    try {
        const exists = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
        if (exists.rowCount > 0) {
            return res.status(409).json({ ok: false, error: 'Username already exists' });
        }
        const hash = await bcrypt.hash(password, ROUNDS);
        const r = await pool.query(
            `INSERT INTO users (username, password_hash, role, employee_id)
             VALUES ($1, $2, $3, $4)
             RETURNING id, username, role, employee_id, created_at`,
            [username, hash, role, employee_id || null]
        );
        await pool.query(
            `INSERT INTO audit_log (user_id, action, entity, entity_id, payload)
             VALUES ($1, 'create', 'user', $2, $3)`,
            [req.user.sub, r.rows[0].id, JSON.stringify({ username, role })]
        );
        return res.status(201).json({ ok: true, data: r.rows[0] });
    } catch (err) {
        logger.error('register error', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Register failed' });
    }
}

async function me(req, res) {
    try {
        const r = await pool.query(
            `SELECT u.id, u.username, u.role, u.employee_id, u.last_login_at,
                    e.full_name, e.employee_code, e.email
             FROM users u
             LEFT JOIN employees e ON e.id = u.employee_id
             WHERE u.id = $1`,
            [req.user.sub]
        );
        if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'User not found' });
        return res.json({ ok: true, data: r.rows[0] });
    } catch (err) {
        logger.error('me error', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Lookup failed' });
    }
}

module.exports = { login, register, me, loginValidation, registerValidation, runValidation };
