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
    if (!t) return 0;
    const parts = t.toString().slice(0, 5).split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function statusForCheckIn(now, dateStr, empStart) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const startStr = empStart || WORK_START;
    const start = timeToMinutes(startStr) + LATE_GRACE;
    return cur <= start ? 'on_time' : 'late';
}

function statusForCheckOut(now, empEnd) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const endStr = empEnd || WORK_END;
    const end = timeToMinutes(endStr) - EARLY_GRACE;
    return cur >= end ? 'on_time' : 'early_leave';
}

async function getMonthlyStats(employeeId, yearMonthStr) {
    if (!employeeId) return null;
    let ym = yearMonthStr;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
        const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        ym = localNow.toISOString().slice(0, 7);
    }
    const startDate = `${ym}-01`;

    const sql = `
        WITH emp AS (
            SELECT e.id, e.hire_date, e.status, e.leave_start, e.leave_end, e.full_name, e.employee_code,
                   d.name AS department_name, e.shift_name, e.work_start, e.work_end
            FROM employees e
            LEFT JOIN departments d ON d.id = e.department_id
            WHERE e.id = $1
        ),
        month_range AS (
            SELECT $2::date AS start_date, ($2::date + interval '1 month - 1 day')::date AS end_date
        ),
        all_workdays AS (
            SELECT d::date AS workday
            FROM month_range mr,
            generate_series(mr.start_date, mr.end_date, '1 day'::interval) d
            WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
        ),
        past_workdays AS (
            SELECT d::date AS workday
            FROM month_range mr,
            generate_series(
                mr.start_date,
                LEAST(mr.end_date, CURRENT_DATE - 1),
                '1 day'::interval
            ) d
            WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
        ),
        att_stats AS (
            SELECT
                COUNT(a.id) FILTER (WHERE a.check_in IS NOT NULL AND a.status != 'absent')::int AS work_days,
                COUNT(a.id) FILTER (WHERE a.check_in IS NOT NULL AND (a.check_in_status = 'on_time' OR (a.check_in_status IS NULL AND a.status IN ('on_time', 'early_leave'))) AND a.status != 'absent')::int AS on_time_days,
                COUNT(a.id) FILTER (WHERE a.check_in_status = 'late' OR (a.check_in IS NOT NULL AND a.status = 'late'))::int AS late_days,
                COUNT(a.id) FILTER (WHERE a.check_out_status = 'early_leave' OR (a.check_out IS NOT NULL AND a.status = 'early_leave'))::int AS early_leave_days,
                COUNT(a.id) FILTER (WHERE a.status = 'absent' OR a.check_in_status = 'absent')::int AS recorded_absent_days
            FROM attendance a, month_range mr
            WHERE a.employee_id = $1
              AND a.date >= mr.start_date
              AND a.date <= mr.end_date
        )
        SELECT
            e.id AS employee_id,
            e.employee_code,
            e.full_name,
            e.department_name,
            e.shift_name,
            e.work_start,
            e.work_end,
            e.status,
            TO_CHAR(mr.start_date, 'YYYY-MM') AS month,
            TO_CHAR(mr.start_date, 'MM/YYYY') AS month_display,
            (SELECT COUNT(*) FROM all_workdays)::int AS total_working_days,
            COALESCE(att.work_days, 0) AS work_days,
            COALESCE(att.on_time_days, 0) AS on_time_days,
            (SELECT COUNT(*) FROM all_workdays aw WHERE e.leave_start IS NOT NULL AND e.leave_end IS NOT NULL AND aw.workday >= e.leave_start AND aw.workday <= e.leave_end)::int AS leave_days,
            COALESCE(att.recorded_absent_days, 0) AS absent_days,
            COALESCE(att.late_days, 0) AS late_days,
            COALESCE(att.early_leave_days, 0) AS early_leave_days
        FROM emp e, month_range mr, att_stats att;
    `;
    const r = await pool.query(sql, [employeeId, startDate]);
    return r.rows[0] || null;
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
    if (!file) return res.status(400).json({ ok: false, error: 'Yêu cầu tệp hình ảnh khuôn mặt' });

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
        return res.status(502).json({ ok: false, error: 'Dịch vụ AI nhận diện không khả dụng' });
    }

    try {
        if (faces.length === 0) {
            logger.info('face_check: no face detected', { file: file.originalname });
            return res.status(400).json({ ok: false, error: 'NO_FACE', message: 'Không phát hiện khuôn mặt trong ảnh' });
        }

        const embedding = faces[0].embedding;
        if (!embedding || !Array.isArray(embedding) || embedding.length !== 512) {
            return res.status(500).json({ ok: false, error: 'Lỗi định dạng vector đặc trưng từ dịch vụ AI' });
        }

        // 1) Match nearest employee
        const matchSql = `
            SELECT id, employee_code, full_name, work_start, work_end,
                   face_embedding <=> $1::vector AS distance
            FROM employees
            WHERE face_embedding IS NOT NULL AND status = 'active'
            ORDER BY face_embedding <=> $1::vector
            LIMIT 1
        `;
        const matchR = await pool.query(matchSql, [toVectorLiteral(embedding)]);
        if (matchR.rowCount === 0) {
            return res.status(404).json({ ok: false, error: 'NO_ENROLLED_EMPLOYEE', message: 'Chưa có nhân viên nào đăng ký khuôn mặt trong hệ thống' });
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
        const localNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
        const localDate = localNow.toISOString().slice(0, 10);
        const currentMonth = localDate.slice(0, 7);

        const existing = await pool.query(
            `SELECT id, check_in, check_out, status FROM attendance WHERE employee_id = $1 AND date = $2::date`,
            [emp.id, localDate]
        );

        if (existing.rowCount === 0) {
            // Check-in
            const status = statusForCheckIn(localNow, localDate, emp.work_start);
            const ins = await pool.query(
                `INSERT INTO attendance
                    (employee_id, date, check_in, status, check_in_status, check_in_method, confidence_in)
                 VALUES ($1, $2::date, NOW(), $3::attendance_status, $4, 'face', $5)
                 RETURNING id, date, check_in, status, check_in_status, check_out_status`,
                [emp.id, localDate, status, status, (1 - distance).toFixed(4)]
            );
            return res.json({
                ok: true,
                data: {
                    matched: true,
                    action: 'check_in',
                    employee: { id: emp.id, employee_code: emp.employee_code, full_name: emp.full_name, work_start: emp.work_start, work_end: emp.work_end },
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
            const statusOut = statusForCheckOut(localNow, emp.work_end);
            const up = await pool.query(
                `UPDATE attendance
                 SET check_out = NOW(), check_out_status = $1,
                     status = (CASE WHEN status = 'late' THEN 'late'::attendance_status ELSE $2::attendance_status END),
                     check_out_method = 'face',
                     confidence_out = $3
                 WHERE id = $4
                 RETURNING id, date, check_in, check_out, status, check_in_status, check_out_status`,
                [statusOut, statusOut, (1 - distance).toFixed(4), row.id]
            );
            logger.info('face_check: check_out', { emp_id: emp.id, statusOut, distance });

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
                message: 'Đã hoàn thành điểm danh vào và ra cho ngày hôm nay',
                employee: { id: emp.id, employee_code: emp.employee_code, full_name: emp.full_name },
                distance,
                attendance: row,
            },
        });
    } catch (err) {
        logger.error('face_check processing failed', { err: err.message, stack: err.stack });
        return res.status(500).json({ ok: false, error: 'Lỗi ghi nhận điểm danh: ' + err.message });
    }
}

async function manualCheck(req, res) {
    const { employee_id, type, note } = req.body;
    const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const localDate = localNow.toISOString().slice(0, 10);
    const currentMonth = localDate.slice(0, 7);
    try {
        const empR = await pool.query(`SELECT work_start, work_end FROM employees WHERE id = $1`, [employee_id]);
        const empStart = empR.rows[0] ? empR.rows[0].work_start : WORK_START;
        const empEnd = empR.rows[0] ? empR.rows[0].work_end : WORK_END;

        const existing = await pool.query(
            `SELECT id, check_in, check_out FROM attendance WHERE employee_id = $1 AND date = $2::date`,
            [employee_id, localDate]
        );
        if (type === 'in') {
            if (existing.rowCount > 0 && existing.rows[0].check_in) {
                return res.status(409).json({ ok: false, error: 'Hôm nay nhân viên đã điểm danh vào rồi' });
            }
            const status = statusForCheckIn(localNow, localDate, empStart);
            let attRow;
            if (existing.rowCount === 0) {
                const r = await pool.query(
                    `INSERT INTO attendance (employee_id, date, check_in, status, check_in_status, check_in_method, note)
                     VALUES ($1, $2::date, NOW(), $3::attendance_status, $4, 'manual', $5) RETURNING *`,
                    [employee_id, localDate, status, status, note || null]
                );
                attRow = r.rows[0];
            } else {
                const r = await pool.query(
                    `UPDATE attendance SET check_in = NOW(), status = $1::attendance_status, check_in_status = $2, check_in_method = 'manual', note = $3
                     WHERE id = $4 RETURNING *`,
                    [status, status, note || null, existing.rows[0].id]
                );
                attRow = r.rows[0];
            }
            const monthlyStats = await getMonthlyStats(employee_id, currentMonth);
            return res.status(201).json({ ok: true, data: attRow, monthly_stats: monthlyStats });
        }
        if (type === 'out') {
            if (existing.rowCount === 0 || !existing.rows[0].check_in) {
                return res.status(409).json({ ok: false, error: 'Cần điểm danh vào trước khi điểm danh ra' });
            }
            const statusOut = statusForCheckOut(localNow, empEnd);
            const r = await pool.query(
                `UPDATE attendance SET check_out = NOW(), check_out_status = $1,
                        status = (CASE WHEN status = 'late' THEN 'late'::attendance_status ELSE $2::attendance_status END),
                        check_out_method = 'manual'
                 WHERE id = $3 RETURNING *`,
                [statusOut, statusOut, existing.rows[0].id]
            );
            const monthlyStats = await getMonthlyStats(employee_id, currentMonth);
            return res.json({ ok: true, data: r.rows[0], monthly_stats: monthlyStats });
        }
        return res.status(400).json({ ok: false, error: 'Loại điểm danh phải là in (vào) hoặc out (ra)' });
    } catch (err) {
        logger.error('manual check', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Lỗi điểm danh thủ công: ' + err.message });
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
               a.check_in_status, a.check_out_status,
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
        return res.status(500).json({ ok: false, error: 'Lỗi tải danh sách chấm công' });
    }
}

async function myHistory(req, res) {
    const empId = req.user.employee_id;
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 200);
    try {
        if (!empId) {
            // For admin or HR without a linked employee ID, return the latest company attendance records
            if (req.user.role === 'admin' || req.user.role === 'hr') {
                const r = await pool.query(
                    `SELECT a.id, a.date, a.check_in, a.check_out, a.status,
                            a.check_in_status, a.check_out_status,
                            a.check_in_method, a.check_out_method,
                            a.confidence_in, a.confidence_out,
                            e.employee_code, e.full_name, d.name AS department_name
                     FROM attendance a
                     JOIN employees e ON e.id = a.employee_id
                     LEFT JOIN departments d ON d.id = e.department_id
                     ORDER BY a.date DESC, GREATEST(a.check_in, a.check_out) DESC NULLS LAST
                     LIMIT $1`,
                    [limit]
                );
                return res.json({ ok: true, data: r.rows, is_all: true });
            }
            return res.status(403).json({ ok: false, error: 'Tài khoản chưa được liên kết với nhân viên' });
        }
        const r = await pool.query(
            `SELECT a.id, a.date, a.check_in, a.check_out, a.status,
                    a.check_in_status, a.check_out_status,
                    a.check_in_method, a.check_out_method,
                    a.confidence_in, a.confidence_out,
                    e.employee_code, e.full_name
             FROM attendance a
             JOIN employees e ON e.id = a.employee_id
             WHERE a.employee_id = $1
             ORDER BY a.date DESC, GREATEST(a.check_in, a.check_out) DESC NULLS LAST
             LIMIT $2`,
            [empId, limit]
        );
        return res.json({ ok: true, data: r.rows, is_all: false });
    } catch (err) {
        logger.error('my history', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Lỗi tải lịch sử chấm công' });
    }
}

async function monthlyStats(req, res) {
    let { employee_id, month, department_id } = req.query;
    const userRole = req.user ? req.user.role : null;
    let targetEmpId = employee_id ? parseInt(employee_id, 10) : null;

    if (userRole === 'employee' && req.user.employee_id) {
        targetEmpId = req.user.employee_id;
    }

    let ym = month;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
        const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        ym = localNow.toISOString().slice(0, 7);
    }

    try {
        if (targetEmpId) {
            const stats = await getMonthlyStats(targetEmpId, ym);
            if (!stats) {
                return res.status(404).json({ ok: false, error: 'Không tìm thấy thông tin nhân viên' });
            }
            const dailySql = `
                WITH month_range AS (
                    SELECT $2::date AS start_date, ($2::date + interval '1 month - 1 day')::date AS end_date
                ),
                all_days AS (
                    SELECT d::date AS date, EXTRACT(DOW FROM d)::int AS dow
                    FROM month_range mr,
                    generate_series(mr.start_date, mr.end_date, '1 day'::interval) d
                )
                SELECT
                    ad.date,
                    ad.dow,
                    CASE 
                        WHEN ad.dow = 0 THEN 'Chủ nhật'
                        WHEN ad.dow = 1 THEN 'Thứ hai'
                        WHEN ad.dow = 2 THEN 'Thứ ba'
                        WHEN ad.dow = 3 THEN 'Thứ tư'
                        WHEN ad.dow = 4 THEN 'Thứ năm'
                        WHEN ad.dow = 5 THEN 'Thứ sáu'
                        WHEN ad.dow = 6 THEN 'Thứ bảy'
                    END AS day_name,
                    a.check_in,
                    a.check_out,
                    a.check_in_status,
                    a.check_out_status,
                    a.note,
                    CASE
                        WHEN a.check_in IS NOT NULL THEN
                            CASE
                                WHEN (a.check_in_status = 'late' OR a.status = 'late') AND (a.check_out_status = 'early_leave' OR a.status = 'early_leave') THEN 'late_and_early'
                                WHEN a.check_in_status = 'late' OR a.status = 'late' THEN 'late'
                                WHEN a.check_out_status = 'early_leave' OR a.status = 'early_leave' THEN 'early_leave'
                                ELSE 'on_time'
                            END
                        WHEN a.status = 'absent' OR a.check_in_status = 'absent' THEN 'absent'
                        WHEN e.leave_start IS NOT NULL AND e.leave_end IS NOT NULL AND ad.date >= e.leave_start AND ad.date <= e.leave_end THEN 'on_leave'
                        WHEN ad.dow IN (0, 6) THEN 'weekend'
                        WHEN ad.date < e.hire_date THEN 'not_hired'
                        WHEN ad.date = CURRENT_DATE THEN 'today_unrecorded'
                        WHEN ad.date > CURRENT_DATE THEN 'future'
                        ELSE 'no_data'
                    END AS day_status
                FROM all_days ad
                CROSS JOIN employees e
                LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = ad.date
                WHERE e.id = $1
                ORDER BY ad.date ASC;
            `;
            const dailyR = await pool.query(dailySql, [targetEmpId, `${ym}-01`]);
            return res.json({
                ok: true,
                data: {
                    summary: stats,
                    daily: dailyR.rows,
                }
            });
        }

        // Return summary for all employees (filtered by department if provided)
        let deptCondition = '';
        const params = [`${ym}-01`];
        if (department_id) {
            params.push(parseInt(department_id, 10));
            deptCondition = 'AND e.department_id = $2';
        }

        const allSql = `
            WITH month_range AS (
                SELECT $1::date AS start_date, ($1::date + interval '1 month - 1 day')::date AS end_date
            ),
            all_workdays AS (
                SELECT d::date AS workday
                FROM month_range mr,
                generate_series(mr.start_date, mr.end_date, '1 day'::interval) d
                WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
            ),
            att_stats AS (
                SELECT
                    a.employee_id,
                    COUNT(a.id) FILTER (WHERE a.check_in IS NOT NULL AND a.status != 'absent')::int AS work_days,
                    COUNT(a.id) FILTER (WHERE a.check_in IS NOT NULL AND (a.check_in_status = 'on_time' OR (a.check_in_status IS NULL AND a.status IN ('on_time', 'early_leave'))) AND a.status != 'absent')::int AS on_time_days,
                    COUNT(a.id) FILTER (WHERE a.check_in_status = 'late' OR (a.check_in IS NOT NULL AND a.status = 'late'))::int AS late_days,
                    COUNT(a.id) FILTER (WHERE a.check_out_status = 'early_leave' OR (a.check_out IS NOT NULL AND a.status = 'early_leave'))::int AS early_leave_days,
                    COUNT(a.id) FILTER (WHERE a.status = 'absent' OR a.check_in_status = 'absent')::int AS recorded_absent_days
                FROM attendance a, month_range mr
                WHERE a.date >= mr.start_date AND a.date <= mr.end_date
                GROUP BY a.employee_id
            )
            SELECT
                e.id AS employee_id,
                e.employee_code,
                e.full_name,
                e.department_id,
                d.name AS department_name,
                e.shift_name,
                e.status,
                TO_CHAR(mr.start_date, 'YYYY-MM') AS month,
                TO_CHAR(mr.start_date, 'MM/YYYY') AS month_display,
                (SELECT COUNT(*) FROM all_workdays)::int AS total_working_days,
                COALESCE(att.work_days, 0) AS work_days,
                COALESCE(att.on_time_days, 0) AS on_time_days,
                (SELECT COUNT(*) FROM all_workdays aw WHERE e.leave_start IS NOT NULL AND e.leave_end IS NOT NULL AND aw.workday >= e.leave_start AND aw.workday <= e.leave_end)::int AS leave_days,
                COALESCE(att.recorded_absent_days, 0) AS absent_days,
                COALESCE(att.late_days, 0) AS late_days,
                COALESCE(att.early_leave_days, 0) AS early_leave_days
            FROM employees e
            JOIN month_range mr ON true
            LEFT JOIN departments d ON d.id = e.department_id
            LEFT JOIN att_stats att ON att.employee_id = e.id
            WHERE e.status != 'terminated'
              ${deptCondition}
            ORDER BY e.employee_code ASC
        `;
        const allR = await pool.query(allSql, params);

        let totalEmployees = allR.rows.length;
        let totalWorkDays = 0;
        let totalLeaveDays = 0;
        let totalAbsentDays = 0;
        let totalLateDays = 0;
        let totalEarlyDays = 0;

        for (const row of allR.rows) {
            totalWorkDays += parseInt(row.work_days || 0, 10);
            totalLeaveDays += parseInt(row.leave_days || 0, 10);
            totalAbsentDays += parseInt(row.absent_days || 0, 10);
            totalLateDays += parseInt(row.late_days || 0, 10);
            totalEarlyDays += parseInt(row.early_leave_days || 0, 10);
        }

        return res.json({
            ok: true,
            data: {
                month: ym,
                month_display: `${ym.split('-')[1]}/${ym.split('-')[0]}`,
                summary_totals: {
                    total_employees: totalEmployees,
                    total_work_days: totalWorkDays,
                    total_leave_days: totalLeaveDays,
                    total_absent_days: totalAbsentDays,
                    total_late_days: totalLateDays,
                    total_early_leave_days: totalEarlyDays,
                },
                employees: allR.rows,
            }
        });
    } catch (err) {
        logger.error('monthly stats failed', { err: err.message, stack: err.stack });
        return res.status(500).json({ ok: false, error: 'Lỗi lấy thống kê chấm công tháng: ' + err.message });
    }
}

module.exports = {
    faceCheck, manualCheck, list, myHistory, monthlyStats,
    listValidation,
    internal: { statusForCheckIn, statusForCheckOut, timeToMinutes, FACE_MATCH_THRESHOLD, getMonthlyStats },
};
