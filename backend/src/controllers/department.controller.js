// src/controllers/department.controller.js
'use strict';

const { body, param } = require('express-validator');
const { pool } = require('../config/db');
const { runValidation } = require('../middleware/validation.middleware');
const { logger } = require('../config/logger');

const createValidation = [
    body('name').isString().trim().isLength({ min: 1, max: 128 }),
    body('description').optional().isString().isLength({ max: 1000 }),
    runValidation,
];

async function list(req, res) {
    try {
        const r = await pool.query(
            `SELECT d.id, d.name, d.description, d.created_at,
                    (SELECT COUNT(*)::int FROM employees e WHERE e.department_id = d.id) AS employee_count
             FROM departments d ORDER BY d.name ASC`
        );
        return res.json({ ok: true, data: r.rows });
    } catch (err) {
        logger.error('list depts', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to list departments' });
    }
}

async function create(req, res) {
    const { name, description } = req.body;
    try {
        const r = await pool.query(
            `INSERT INTO departments (name, description) VALUES ($1, $2)
             RETURNING id, name, description, created_at`,
            [name, description || null]
        );
        await pool.query(
            `INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES ($1, 'create', 'department', $2)`,
            [req.user.sub, r.rows[0].id]
        );
        return res.status(201).json({ ok: true, data: r.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ ok: false, error: 'Department name already exists' });
        }
        logger.error('create dept', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to create department' });
    }
}

async function update(req, res) {
    const id = parseInt(req.params.id, 10);
    const { name, description } = req.body;
    try {
        const r = await pool.query(
            `UPDATE departments SET name = COALESCE($1, name),
                                    description = COALESCE($2, description)
             WHERE id = $3 RETURNING id, name, description, created_at, updated_at`,
            [name || null, description || null, id]
        );
        if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Not found' });
        return res.json({ ok: true, data: r.rows[0] });
    } catch (err) {
        logger.error('update dept', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to update department' });
    }
}

async function softDelete(req, res) {
    const id = parseInt(req.params.id, 10);
    try {
        // Set employees in this dept to NULL department
        await pool.query('UPDATE employees SET department_id = NULL WHERE department_id = $1', [id]);
        const r = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING id', [id]);
        if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Not found' });
        return res.json({ ok: true, data: { id } });
    } catch (err) {
        logger.error('delete dept', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to delete department' });
    }
}

module.exports = { list, create, update, softDelete, createValidation };
