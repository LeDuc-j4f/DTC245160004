// src/controllers/dashboard.controller.js
'use strict';

const { pool } = require('../config/db');
const { logger } = require('../config/logger');

async function overview(req, res) {
    try {
        // 1) counts
        const empCount = await pool.query(
            `SELECT
                COUNT(*)::int FILTER (WHERE status='active')     AS active_employees,
                COUNT(*)::int FILTER (WHERE status='terminated') AS terminated_employees,
                COUNT(*)::int FILTER (WHERE status='on_leave')   AS on_leave_employees,
                COUNT(*)::int                                     AS total_employees
             FROM employees`
        );
        const deptCount = await pool.query(`SELECT COUNT(*)::int AS total FROM departments`);

        // 2) today breakdown
        const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const today = localNow.toISOString().slice(0, 10);
        const todayStats = await pool.query(
            `SELECT
                COUNT(*)::int FILTER (WHERE status='on_time')     AS on_time,
                COUNT(*)::int FILTER (WHERE status='late')        AS late,
                COUNT(*)::int FILTER (WHERE status='early_leave') AS early_leave,
                COUNT(*)::int FILTER (WHERE status='absent')      AS absent,
                COUNT(*)::int AS total
             FROM attendance WHERE date = $1::date`,
            [today]
        );

        // 3) last 7 days trend
        const trend = await pool.query(
            `WITH days AS (
                SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day')::date AS d
            )
            SELECT d.d AS date,
                   COUNT(a.id)::int FILTER (WHERE a.status='on_time')     AS on_time,
                   COUNT(a.id)::int FILTER (WHERE a.status='late')        AS late,
                   COUNT(a.id)::int FILTER (WHERE a.status='early_leave') AS early_leave,
                   COUNT(a.id)::int FILTER (WHERE a.status='absent')      AS absent
            FROM days d
            LEFT JOIN attendance a ON a.date = d.d
            GROUP BY d.d
            ORDER BY d.d ASC`
        );

        // 4) recent check-in/out (last 1h)
        const recent = await pool.query(
            `SELECT a.id, a.employee_id, e.employee_code, e.full_name,
                    a.date, a.check_in, a.check_out, a.status
             FROM attendance a
             JOIN employees e ON e.id = a.employee_id
             WHERE a.check_in  > NOW() - INTERVAL '1 hour'
                OR a.check_out > NOW() - INTERVAL '1 hour'
             ORDER BY GREATEST(a.check_in, a.check_out) DESC NULLS LAST
             LIMIT 20`
        );

        // 5) top 5 late this month
        const topLate = await pool.query(
            `SELECT e.id, e.employee_code, e.full_name,
                    COUNT(*)::int AS late_count
             FROM attendance a
             JOIN employees e ON e.id = a.employee_id
             WHERE a.status = 'late'
               AND a.date >= date_trunc('month', CURRENT_DATE)
             GROUP BY e.id, e.employee_code, e.full_name
             ORDER BY late_count DESC
             LIMIT 5`
        );

        return res.json({
            ok: true,
            data: {
                today,
                employees: empCount.rows[0],
                departments: deptCount.rows[0],
                today_stats: todayStats.rows[0],
                trend_7_days: trend.rows,
                recent: recent.rows,
                top_late_this_month: topLate.rows,
            },
        });
    } catch (err) {
        logger.error('dashboard overview', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to load dashboard' });
    }
}

module.exports = { overview };
