// src/controllers/employee.controller.js
'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { body, param } = require('express-validator');
const { pool, toVectorLiteral } = require('../config/db');
const { runValidation } = require('../middleware/validation.middleware');
const { logger } = require('../config/logger');

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://ai-worker:8000';

const createValidation = [
    body('employee_code').isString().trim().isLength({ min: 1, max: 32 }),
    body('full_name').isString().trim().isLength({ min: 1, max: 128 }),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('email invalid'),
    body('phone').optional().isString().isLength({ max: 20 }),
    body('department_id').optional().isInt(),
    body('position').optional().isString().isLength({ max: 64 }),
    body('hire_date').optional().isISO8601().withMessage('hire_date must be YYYY-MM-DD'),
    runValidation,
];

const updateValidation = [
    param('id').isInt(),
    runValidation,
];

async function list(req, res) {
    const { search = '', department_id, status = 'active', limit = 50, offset = 0 } = req.query;
    try {
        const params = [];
        const where = [];
        if (search) {
            params.push(`%${search}%`);
            where.push(`(e.full_name ILIKE $${params.length} OR e.employee_code ILIKE $${params.length})`);
        }
        if (department_id) {
            params.push(parseInt(department_id, 10));
            where.push(`e.department_id = $${params.length}`);
        }
        if (status) {
            params.push(status);
            where.push(`e.status = $${params.length}`);
        }
        params.push(parseInt(limit, 10));
        params.push(parseInt(offset, 10));
        const sql = `
            SELECT e.id, e.employee_code, e.full_name, e.email, e.phone,
                   e.department_id, d.name AS department_name,
                   e.position, e.hire_date, e.status, e.face_image_path,
                   e.created_at, e.updated_at,
                   (e.face_embedding IS NOT NULL) AS has_face
            FROM employees e
            LEFT JOIN departments d ON d.id = e.department_id
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY e.id DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `;
        const r = await pool.query(sql, params);
        return res.json({ ok: true, data: r.rows });
    } catch (err) {
        logger.error('list employees', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to list employees' });
    }
}

async function getOne(req, res) {
    const id = parseInt(req.params.id, 10);
    try {
        const r = await pool.query(
            `SELECT e.id, e.employee_code, e.full_name, e.email, e.phone,
                    e.department_id, d.name AS department_name,
                    e.position, e.hire_date, e.status, e.face_image_path,
                    e.created_at, e.updated_at,
                    (e.face_embedding IS NOT NULL) AS has_face
             FROM employees e
             LEFT JOIN departments d ON d.id = e.department_id
             WHERE e.id = $1`,
            [id]
        );
        if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Not found' });
        return res.json({ ok: true, data: r.rows[0] });
    } catch (err) {
        logger.error('get employee', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed' });
    }
}

async function create(req, res) {
    const { employee_code, full_name, email, phone, department_id, position, hire_date } = req.body;
    const file = req.file;  // multer single
    try {
        let embedding = null;
        let facePath  = null;

        if (file) {
            facePath = path.basename(file.path);
            try {
                const form = new FormData();
                form.append('files', fs.createReadStream(file.path), {
                    filename: file.originalname,
                    contentType: file.mimetype,
                });
                const aiResp = await axios.post(`${AI_WORKER_URL}/extract_faces`, form, {
                    headers: form.getHeaders(),
                    timeout: 30_000,
                    maxBodyLength: 10 * 1024 * 1024,
                });
                if (aiResp.data && Array.isArray(aiResp.data.data) && aiResp.data.data.length > 0) {
                    embedding = aiResp.data.data[0].embedding;
                } else {
                    // No face detected — still create employee but mark no embedding
                    logger.warn('No face detected in uploaded image', { employee_code });
                }
            } catch (aiErr) {
                logger.error('AI worker call failed', { err: aiErr.message });
                // Continue without embedding; user can re-upload
            }
        }

        const r = await pool.query(
            `INSERT INTO employees
                (employee_code, full_name, email, phone, department_id, position,
                 hire_date, face_embedding, face_image_path)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE),
                     ${embedding ? '$8::vector' : 'NULL'}, $9)
             RETURNING id, employee_code, full_name, email, phone, department_id,
                       position, hire_date, status, face_image_path, has_face`,
            [
                employee_code, full_name, email || null, phone || null,
                department_id || null, position || null, hire_date || null,
                embedding ? toVectorLiteral(embedding) : null,
                facePath,
            ]
        );
        await pool.query(
            `INSERT INTO audit_log (user_id, action, entity, entity_id, payload)
             VALUES ($1, 'create', 'employee', $2, $3)`,
            [req.user.sub, r.rows[0].id, JSON.stringify({ employee_code, has_face: !!embedding })]
        );
        return res.status(201).json({ ok: true, data: { ...r.rows[0], has_face: !!embedding } });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ ok: false, error: 'employee_code or email already exists' });
        }
        logger.error('create employee', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to create employee' });
    }
}

async function update(req, res) {
    const id = parseInt(req.params.id, 10);
    const { full_name, email, phone, department_id, position, status } = req.body;
    const file = req.file;
    try {
        // Optional re-registration of face embedding
        let embedding = null;
        let facePath  = null;
        if (file) {
            facePath = path.basename(file.path);
            try {
                const form = new FormData();
                form.append('files', fs.createReadStream(file.path), {
                    filename: file.originalname,
                    contentType: file.mimetype,
                });
                const aiResp = await axios.post(`${AI_WORKER_URL}/extract_faces`, form, {
                    headers: form.getHeaders(),
                    timeout: 30_000,
                    maxBodyLength: 10 * 1024 * 1024,
                });
                if (aiResp.data && Array.isArray(aiResp.data.data) && aiResp.data.data.length > 0) {
                    embedding = aiResp.data.data[0].embedding;
                }
            } catch (aiErr) {
                logger.error('AI worker call failed on update', { err: aiErr.message });
            }
        }

        const r = await pool.query(
            `UPDATE employees SET
                full_name       = COALESCE($1, full_name),
                email           = COALESCE($2, email),
                phone           = COALESCE($3, phone),
                department_id   = COALESCE($4, department_id),
                position        = COALESCE($5, position),
                status          = COALESCE($6, status),
                face_embedding  = COALESCE($7::vector, face_embedding),
                face_image_path = COALESCE($8, face_image_path)
             WHERE id = $9
             RETURNING id, employee_code, full_name, email, phone, department_id,
                       position, hire_date, status,
                       (face_embedding IS NOT NULL) AS has_face`,
            [
                full_name || null, email || null, phone || null,
                department_id || null, position || null, status || null,
                embedding ? toVectorLiteral(embedding) : null,
                facePath || null,
                id,
            ]
        );
        if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Not found' });
        await pool.query(
            `INSERT INTO audit_log (user_id, action, entity, entity_id, payload)
             VALUES ($1, 'update', 'employee', $2, $3)`,
            [req.user.sub, id, JSON.stringify({ has_face: r.rows[0].has_face })]
        );
        return res.json({ ok: true, data: r.rows[0] });
    } catch (err) {
        logger.error('update employee', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to update' });
    }
}

async function softDelete(req, res) {
    const id = parseInt(req.params.id, 10);
    try {
        const r = await pool.query(
            `UPDATE employees SET status = 'terminated' WHERE id = $1 RETURNING id`,
            [id]
        );
        if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'Not found' });
        await pool.query(
            `INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES ($1, 'terminate', 'employee', $2)`,
            [req.user.sub, id]
        );
        return res.json({ ok: true, data: { id, status: 'terminated' } });
    } catch (err) {
        logger.error('terminate employee', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed' });
    }
}

module.exports = {
    list, getOne, create, update, softDelete,
    createValidation, updateValidation,
};
