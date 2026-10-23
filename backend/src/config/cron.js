// src/config/cron.js - mark absent for previous workday at 23:00 daily
'use strict';

const cron = require('node-cron');
const { pool } = require('./db');
const { logger } = require('./logger');

async function markAbsentForDate(dateStr) {
    const sql = `
        WITH active_emps AS (
            SELECT id FROM employees
            WHERE status = 'active'
        ),
        missing AS (
            SELECT e.id FROM active_emps e
            LEFT JOIN attendance a
                ON a.employee_id = e.id AND a.date = $1::date
            WHERE a.id IS NULL
        )
        INSERT INTO attendance (employee_id, date, status, check_in_method, note)
        SELECT id, $1::date, 'absent', 'manual', 'auto-marked by cron'
        FROM missing
        ON CONFLICT (employee_id, date) DO NOTHING
        RETURNING id;
    `;
    const r = await pool.query(sql, [dateStr]);
    logger.info('Marked absent', { date: dateStr, count: r.rowCount });
    return r.rowCount;
}

const { syncExpiredLeaves } = require('../controllers/employee.controller');

function scheduleAbsentJob() {
    // Every day at 00:00, auto-reactivate employees whose leave period ended
    cron.schedule('0 0 * * *', async () => {
        try {
            await syncExpiredLeaves();
        } catch (err) {
            logger.error('Sync expired leaves cron failed', { err: err.message });
        }
    }, { timezone: 'Asia/Ho_Chi_Minh' });

    // Every day at 23:00, mark absent for employees who did not check in today
    cron.schedule('0 23 * * *', async () => {
        try {
            const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
            const todayStr = localNow.toISOString().slice(0, 10);
            await syncExpiredLeaves();
            await markAbsentForDate(todayStr);
        } catch (err) {
            logger.error('Absent cron failed', { err: err.message });
        }
    }, { timezone: 'Asia/Ho_Chi_Minh' });
    logger.info('Absent cron scheduled (23:00 daily)');
}

module.exports = { scheduleAbsentJob, markAbsentForDate };
