// src/controllers/dashboard.controller.js
'use strict';

const { pool } = require('../config/db');
const { logger } = require('../config/logger');
const { syncExpiredLeaves } = require('./employee.controller');

async function overview(req, res) {
    try {
        await syncExpiredLeaves();
        const { from, to, department_id, status, search, cal_month } = req.query;

        const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const todayStr = localNow.toISOString().slice(0, 10);

        const startDate = from || todayStr;
        const endDate = to || todayStr;

        // 1) Employee counts
        let empSql = `SELECT
            COUNT(*) FILTER (WHERE status='active')::int     AS active_employees,
            COUNT(*) FILTER (WHERE status='terminated')::int AS terminated_employees,
            COUNT(*) FILTER (WHERE status='on_leave')::int   AS on_leave_employees,
            COUNT(*)::int                                     AS total_employees
         FROM employees`;
        const empParams = [];
        if (department_id) {
            empParams.push(parseInt(department_id, 10));
            empSql += ` WHERE department_id = $1`;
        }
        const empCount = await pool.query(empSql, empParams);
        const deptCount = await pool.query(`SELECT COUNT(*)::int AS total FROM departments`);

        // 2) Stats breakdown for selected period & department
        let deptConditionAtt = '';
        let deptConditionEmp = '';
        const statParams = [startDate, endDate];
        if (department_id) {
            statParams.push(parseInt(department_id, 10));
            deptConditionAtt = ` AND e.department_id = $${statParams.length}`;
            deptConditionEmp = ` AND e.department_id = $${statParams.length}`;
        }

        const statSql = `
            SELECT
                COUNT(id) FILTER (WHERE check_in_status = 'on_time' OR (check_in_status IS NULL AND status IN ('on_time', 'early_leave')))::int AS on_time,
                COUNT(id) FILTER (WHERE check_in_status = 'late' OR (check_in_status IS NULL AND status = 'late'))::int AS late,
                COUNT(id) FILTER (WHERE check_out_status = 'early_leave' OR (check_out_status IS NULL AND status = 'early_leave'))::int AS early_leave,
                COUNT(*) FILTER (WHERE status = 'absent' OR check_in_status = 'absent')::int AS absent,
                COUNT(*)::int AS total
            FROM (
                SELECT a.id, a.check_in_status, a.check_out_status, a.status::text AS status
                FROM attendance a
                JOIN employees e ON e.id = a.employee_id
                WHERE a.date >= $1::date AND a.date <= $2::date
                  ${deptConditionAtt}
                UNION ALL
                SELECT NULL::int AS id, 'absent' AS check_in_status, NULL::text AS check_out_status, 'absent'::text AS status
                FROM employees e
                WHERE e.status = 'active'
                  ${deptConditionEmp}
                  AND NOT EXISTS (
                      SELECT 1 FROM attendance a
                      WHERE a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
                  )
            ) all_records
        `;
        const periodStats = await pool.query(statSql, statParams);

        // 3) Calendar summary by day for the requested month or date range
        let calFrom = startDate;
        let calTo = endDate;
        function getMonthEndDate(ym) {
            const [y, m] = ym.split('-').map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            return `${ym}-${String(lastDay).padStart(2, '0')}`;
        }
        if (cal_month && /^\d{4}-\d{2}$/.test(cal_month)) {
            calFrom = `${cal_month}-01`;
            calTo = getMonthEndDate(cal_month);
        } else {
            // Default to whole month of startDate
            const yyyymm = startDate.slice(0, 7);
            calFrom = `${yyyymm}-01`;
            calTo = getMonthEndDate(yyyymm);
        }

        let calSql = `
            SELECT TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
                   COUNT(a.id) FILTER (WHERE a.check_in_status = 'on_time' OR (a.check_in_status IS NULL AND a.status IN ('on_time', 'early_leave')))::int AS on_time,
                   COUNT(a.id) FILTER (WHERE a.check_in_status = 'late' OR (a.check_in_status IS NULL AND a.status = 'late'))::int AS late,
                   COUNT(a.id) FILTER (WHERE a.check_out_status = 'early_leave' OR (a.check_out_status IS NULL AND a.status = 'early_leave'))::int AS early_leave,
                   COUNT(a.id) FILTER (WHERE a.status = 'absent' OR a.check_in_status = 'absent')::int AS absent,
                   COUNT(a.id)::int AS total
            FROM attendance a
            JOIN employees e ON e.id = a.employee_id
            WHERE a.date >= $1::date AND a.date <= $2::date
        `;
        const calParams = [calFrom, calTo];
        if (department_id) {
            calParams.push(parseInt(department_id, 10));
            calSql += ` AND e.department_id = $${calParams.length}`;
        }
        calSql += ` GROUP BY a.date ORDER BY a.date ASC`;
        const calRes = await pool.query(calSql, calParams);

        const calendarDays = {};
        for (const r of calRes.rows) {
            calendarDays[r.date] = r;
        }
        const statsRow = periodStats.rows[0];
        if (calendarDays[todayStr] && statsRow) {
            calendarDays[todayStr] = {
                ...calendarDays[todayStr],
                absent: statsRow.absent,
                total: statsRow.total
            };
        } else if (statsRow && statsRow.total > 0 && todayStr >= calFrom && todayStr <= calTo) {
            calendarDays[todayStr] = {
                date: todayStr,
                on_time: statsRow.on_time,
                late: statsRow.late,
                early_leave: statsRow.early_leave,
                absent: statsRow.absent,
                total: statsRow.total
            };
        }

        // 4) Filtered activities list for the selected date or range
        const actParams = [startDate, endDate];
        let deptCondAttAct = '';
        let deptCondEmpAct = '';
        if (department_id) {
            actParams.push(parseInt(department_id, 10));
            deptCondAttAct = ` AND e.department_id = $${actParams.length}`;
            deptCondEmpAct = ` AND e.department_id = $${actParams.length}`;
        }

        let actSql = `
            WITH combined AS (
                SELECT a.id, a.employee_id, e.employee_code, e.full_name,
                       d.name AS department_name, e.shift_name, e.work_start, e.work_end,
                       TO_CHAR(a.date, 'YYYY-MM-DD') AS date,
                       a.check_in, a.check_out, a.status::text AS status,
                       a.check_in_status, a.check_out_status,
                       a.check_in_method::text AS check_in_method, a.check_out_method::text AS check_out_method,
                       a.confidence_in, a.confidence_out,
                       a.created_at
                FROM attendance a
                JOIN employees e ON e.id = a.employee_id
                LEFT JOIN departments d ON d.id = e.department_id
                WHERE a.date >= $1::date AND a.date <= $2::date
                  ${deptCondAttAct}
                UNION ALL
                SELECT NULL::int AS id, e.id AS employee_id, e.employee_code, e.full_name,
                       d.name AS department_name, e.shift_name, e.work_start, e.work_end,
                       TO_CHAR($2::date, 'YYYY-MM-DD') AS date,
                       NULL::timestamptz AS check_in, NULL::timestamptz AS check_out,
                       'absent'::text AS status,
                       'absent' AS check_in_status, NULL::text AS check_out_status,
                       'manual'::text AS check_in_method, NULL::text AS check_out_method,
                       NULL::numeric AS confidence_in, NULL::numeric AS confidence_out,
                       e.created_at
                FROM employees e
                LEFT JOIN departments d ON d.id = e.department_id
                WHERE e.status = 'active'
                  ${deptCondEmpAct}
                  AND NOT EXISTS (
                      SELECT 1 FROM attendance a
                      WHERE a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
                  )
            )
            SELECT * FROM combined
            WHERE 1=1
        `;

        if (status) {
            if (status === 'on_time') {
                actSql += ` AND (check_in_status = 'on_time' OR (check_in_status IS NULL AND status IN ('on_time', 'early_leave')))`;
            } else if (status === 'late') {
                actSql += ` AND (check_in_status = 'late' OR (check_in_status IS NULL AND status = 'late'))`;
            } else if (status === 'early_leave') {
                actSql += ` AND (check_out_status = 'early_leave' OR (check_out_status IS NULL AND status = 'early_leave'))`;
            } else if (status === 'absent') {
                actSql += ` AND (status = 'absent' OR check_in_status = 'absent')`;
            } else {
                actParams.push(status);
                actSql += ` AND status = $${actParams.length}`;
            }
        }
        if (search) {
            actParams.push(`%${search.trim()}%`);
            actSql += ` AND (full_name ILIKE $${actParams.length} OR employee_code ILIKE $${actParams.length})`;
        }
        actSql += ` ORDER BY date DESC, GREATEST(check_in, check_out, created_at) DESC NULLS LAST LIMIT 150`;
        const activities = await pool.query(actSql, actParams);

        return res.json({
            ok: true,
            data: {
                today: todayStr,
                filter: {
                    from: startDate,
                    to: endDate,
                    department_id: department_id || '',
                    status: status || '',
                    search: search || '',
                    cal_month: cal_month || startDate.slice(0, 7),
                },
                employees: empCount.rows[0],
                departments: deptCount.rows[0],
                today_stats: periodStats.rows[0],
                calendar_days: calendarDays,
                recent: activities.rows,
            },
        });
    } catch (err) {
        logger.error('dashboard overview', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to load dashboard' });
    }
}

module.exports = { overview };
