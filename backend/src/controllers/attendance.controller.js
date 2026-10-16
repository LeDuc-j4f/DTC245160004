// src/controllers/attendance.controller.js
'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { body, query, param } = require('express-validator');
const { pool, toVectorLiteral } = require('../config/db');
const { runValidation } = require('../middleware/validation.middleware');
const { logger } = require('../config/logger');

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://ai-worker:8000';
const FACE_MATCH_THRESHOLD = parseFloat(process.env.FACE_MATCH_THRESHOLD || '0.45');
const WORK_START = process.env.WORK_START || '08:30';
const WORK_END   = process.env.WORK_END   || '17:30';
const LATE_GRACE = parseInt(process.env.LATE_GRACE_MINUTES || '5', 10);
const EARLY_GRACE = parseInt(process.env.EARLY_LEAVE_GRACE_MINUTES || '5', 10);

function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function statusForCheckIn(now, dateStr) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const start = timeToMinutes(WORK_START) + LATE_GRACE;
    return cur <= start ? 'on_time' : 'late';
}

function statusForCheckOut(now) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const end = timeToMinutes(WORK_END) - EARLY_GRACE;
    return cur >= end ? 'on_time' : 'early_leave';
}

/**
 * POST /api/attendance/face-check
 * Multipart: file=<image>
 * Body optional: manual_employee_id (skip matching, force this employee)
 *
 * Behaviour:
 *   - Send image to AI worker, get faces [{bounding_box, embedding}]
 *   - If 0 faces  -> 400 NO_FACE
 *   - For first face, query nearest employee by cosine distance
 *   - If distance > threshold  -> 404 NO_MATCH
 *   - If today's attendance row already has check_in:
 *        * Fill check_out (this is end-of-day)
 *        * Status: on_time / early_leave
 *     Else:
 *        * Insert check_in
 *        * Status: on_time / late
 */
async function faceCheck(req, res) {
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: 'Image file required' });

    let faces = [];
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
        faces = (aiResp.data && aiResp.data.data) || [];
    } catch (err) {
        logger.error('AI worker call failed', { err: err.message });
        return res.status(502).json({ ok: false, error: 'AI service unavailable' });
    }

    if (faces.length === 0) {
        logger.info('face_check: no face detected', { file: file.originalname });
        return res.status(400).json({ ok: false, error: 'NO_FACE', message: 'No face detected in image' });
    }

    const embedding = faces[0].embedding;
    if (!embedding || !Array.isArray(embedding) || embedding.length !== 512) {
        return res.status(500).json({ ok: false, error: 'Invalid embedding from AI worker' });
    }

    // 1) Match nearest employee
    const matchSql = `
        SELECT id, employee_code, full_name,
               face_embedding <=> $1::vector AS distance
        FROM employees
        WHERE face_embedding IS NOT NULL AND status = 'active'
        ORDER BY face_embedding <=> $1::vector
        LIMIT 1
    `;
    const matchR = await pool.query(matchSql, [toVectorLiteral(embedding)]);
    if (matchR.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'NO_ENROLLED_EMPLOYEE', message: 'No employee with face data' });
    }
    const emp = matchR.rows[0];
    const distance = parseFloat(emp.distance);
    if (distance > FACE_MATCH_THRESHOLD) {
        logger.info('face_check: no match', { distance, threshold: FACE_MATCH_THRESHOLD });
        return res.json({
            ok: true,
            data: {
                matched: false,
                distance,
                threshold: FACE_MATCH_THRESHOLD,
                bounding_box: faces[0].bounding_box,
            },
        });
    }

    // 2) Insert check_in or check_out for today
    const now     = new Date();
    const today   = now.toISOString().slice(0, 10);  // YYYY-MM-DD (UTC)
    // Use Asia/Ho_Chi_Minh date for "today"
    const localNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const localDate = localNow.toISOString().slice(0, 10);

    const existing = await pool.query(
        `SELECT id, check_in, check_out FROM attendance WHERE employee_id = $1 AND date = $2::date`,
        [emp.id, localDate]
    );

    if (existing.rowCount === 0) {
        // Check-in
        const status = statusForCheckIn(localNow, localDate);
        const ins = await pool.query(
            `INSERT INTO attendance
                (employee_id, date, check_in, status, check_in_method, confidence_in)
             VALUES ($1, $2::date, NOW(), $3, 'face', $4)
             RETURNING id, date, check_in, status`,
            [emp.id, localDate, status, (1 - distance).toFixed(4)]
        );
        logger.info('face_check: check_in', { emp_id: emp.id, status, distance });
        return res.json({
            ok: true,
            data: {
                matched: true,
                action: 'check_in',
                employee: { id: emp.id, employee_code: emp.employee_code, full_name: emp.full_name },
                distance,
                threshold: FACE_MATCH_THRESHOLD,
                confidence: (1 - distance).toFixed(4),
                attendance: ins.rows[0],
            },
        });
    }

    const row = existing.rows[0];
    if (!row.check_out) {
        // Check-out
        const status = statusForCheckOut(localNow);
        const up = await pool.query(
            `UPDATE attendance
             SET check_out = NOW(), status = $1, check_out_method = 'face',
                 confidence_out = $2
             WHERE id = $3
             RETURNING id, date, check_in, check_out, status`,
            [status, (1 - distance).toFixed(4), row.id]
        );
        logger.info('face_check: check_out', { emp_id: emp.id, status, distance });
        return res.json({
            ok: true,
            data: {
                matched: true,
                action: 'check_out',
                employee: { id: emp.id, employee_code: emp.employee_code, full_name: emp.full_name },
                distance,
                threshold: FACE_MATCH_THRESHOLD,
                confidence: (1 - distance).toFixed(4),
                attendance: up.rows[0],
            },
        });
    }

    // Already both in & out
    return res.json({
        ok: true,
        data: {
            matched: true,
            action: 'none',
            message: 'Already checked in and out today',
            employee: { id: emp.id, employee_code: emp.employee_code, full_name: emp.full_name },
            distance,
            attendance: row,
        },
    });
}

async function manualCheck(req, res) {
    const { employee_id, type, note } = req.body;
    const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const localDate = localNow.toISOString().slice(0, 10);
    try {
        const existing = await pool.query(
            `SELECT id, check_in, check_out FROM attendance WHERE employee_id = $1 AND date = $2::date`,
            [employee_id, localDate]
        );
        if (type === 'in') {
            if (existing.rowCount > 0 && existing.rows[0].check_in) {
                return res.status(409).json({ ok: false, error: 'Already checked in today' });
            }
            const status = statusForCheckIn(localNow, localDate);
            if (existing.rowCount === 0) {
                const r = await pool.query(
                    `INSERT INTO attendance (employee_id, date, check_in, status, check_in_method, note)
                     VALUES ($1, $2::date, NOW(), $3, 'manual', $4) RETURNING *`,
                    [employee_id, localDate, status, note || null]
                );
                return res.status(201).json({ ok: true, data: r.rows[0] });
            }
            const r = await pool.query(
                `UPDATE attendance SET check_in = NOW(), status = $1, check_in_method = 'manual', note = $2
                 WHERE id = $3 RETURNING *`,
                [status, note || null, existing.rows[0].id]
            );
            return res.json({ ok: true, data: r.rows[0] });
        }
        if (type === 'out') {
            if (existing.rowCount === 0 || !existing.rows[0].check_in) {
                return res.status(409).json({ ok: false, error: 'Must check in first' });
            }
            const status = statusForCheckOut(localNow);
            const r = await pool.query(
                `UPDATE attendance SET check_out = NOW(), status = $1, check_out_method = 'manual'
                 WHERE id = $2 RETURNING *`,
                [status, existing.rows[0].id]
            );
            return res.json({ ok: true, data: r.rows[0] });
        }
        return res.status(400).json({ ok: false, error: 'type must be in or out' });
    } catch (err) {
        logger.error('manual check', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed' });
    }
}

const listValidation = [
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('employee_id').optional().isInt(),
    query('limit').optional().isInt({ min: 1, max: 500 }),
    query('offset').optional().isInt({ min: 0 }),
    runValidation,
];

async function list(req, res) {
    const { from, to, employee_id, limit = 100, offset = 0 } = req.query;
    const where = [];
    const params = [];
    if (from) { params.push(from); where.push(`a.date >= $${params.length}::date`); }
    if (to)   { params.push(to);   where.push(`a.date <= $${params.length}::date`); }
    if (employee_id) { params.push(parseInt(employee_id, 10)); where.push(`a.employee_id = $${params.length}`); }
    params.push(parseInt(limit, 10));
    params.push(parseInt(offset, 10));
    const sql = `
        SELECT a.id, a.employee_id, e.employee_code, e.full_name,
               a.date, a.check_in, a.check_out, a.status,
               a.check_in_method, a.check_out_method,
               a.confidence_in, a.confidence_out, a.note
        FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY a.date DESC, a.employee_id ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    try {
        const r = await pool.query(sql, params);
        return res.json({ ok: true, data: r.rows });
    } catch (err) {
        logger.error('list attendance', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed' });
    }
}

async function myHistory(req, res) {
    const empId = req.user.employee_id;
    if (!empId) return res.status(403).json({ ok: false, error: 'User not linked to employee' });
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 200);
    try {
        const r = await pool.query(
            `SELECT id, date, check_in, check_out, status, check_in_method, check_out_method,
                    confidence_in, confidence_out
             FROM attendance WHERE employee_id = $1
             ORDER BY date DESC LIMIT $2`,
            [empId, limit]
        );
        return res.json({ ok: true, data: r.rows });
    } catch (err) {
        logger.error('my history', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed' });
    }
}

module.exports = {
    faceCheck, manualCheck, list, myHistory,
    listValidation,
    internal: { statusForCheckIn, statusForCheckOut, timeToMinutes, FACE_MATCH_THRESHOLD },
};
