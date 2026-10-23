// backend/src/controllers/shift.controller.js
const { pool } = require('../config/db');
const { logger } = require('../config/logger');

async function list(req, res) {
    try {
        const r = await pool.query('SELECT id, name, work_start, work_end, created_at FROM shifts ORDER BY id ASC');
        return res.json({ ok: true, data: r.rows });
    } catch (err) {
        logger.error('shift list error', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Failed to list shifts' });
    }
}

async function create(req, res) {
    let { name, work_start, work_end } = req.body;
    if (!name || !work_start || !work_end) {
        return res.status(400).json({ ok: false, error: 'Tên ca làm việc, giờ vào và giờ ra là bắt buộc' });
    }
    name = name.trim();
    work_start = work_start.trim().slice(0, 5);
    work_end = work_end.trim().slice(0, 5);

    // Chuẩn hóa tên: nếu chưa có giờ trong ngoặc thì thêm vào cho rõ ràng
    if (!name.includes('(') || !name.includes('-')) {
        name = `${name} (${work_start} - ${work_end})`;
    }

    try {
        const r = await pool.query(
            `INSERT INTO shifts (name, work_start, work_end)
             VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET work_start = EXCLUDED.work_start, work_end = EXCLUDED.work_end
             RETURNING id, name, work_start, work_end, created_at`,
            [name, work_start, work_end]
        );
        return res.status(201).json({ ok: true, data: r.rows[0] });
    } catch (err) {
        logger.error('shift create error', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Không thể tạo ca làm việc' });
    }
}

async function remove(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'ID ca làm việc không hợp lệ' });
    try {
        await pool.query('DELETE FROM shifts WHERE id = $1', [id]);
        return res.json({ ok: true, data: { id } });
    } catch (err) {
        logger.error('shift delete error', { err: err.message });
        return res.status(500).json({ ok: false, error: 'Không thể xóa ca làm việc' });
    }
}

module.exports = {
    list,
    create,
    remove,
};
