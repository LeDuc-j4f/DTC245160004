// src/routes/routes.js
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const { authRequired } = require('../middleware/auth.middleware');
const { requireRole, requireSelfOrRole } = require('../middleware/rbac.middleware');
const { runValidation } = require('../middleware/validation.middleware');
const { upload } = require('../middleware/upload.middleware');

const authCtrl       = require('../controllers/auth.controller');
const empCtrl        = require('../controllers/employee.controller');
const deptCtrl       = require('../controllers/department.controller');
const attCtrl        = require('../controllers/attendance.controller');
const dashCtrl       = require('../controllers/dashboard.controller');
const shiftCtrl      = require('../controllers/shift.controller');

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many login attempts, slow down' },
});

// ---------- Auth ----------
router.post('/auth/login', loginLimiter, authCtrl.loginValidation, runValidation, authCtrl.login);
router.post('/auth/register', authRequired, requireRole('admin'), authCtrl.registerValidation, runValidation, authCtrl.register);
router.get('/auth/me', authRequired, authCtrl.me);

// ---------- Departments ----------
router.get('/departments', authRequired, requireRole('admin', 'hr', 'employee'), deptCtrl.list);
router.post('/departments', authRequired, requireRole('admin', 'hr'), deptCtrl.createValidation, deptCtrl.create);
router.put('/departments/:id', authRequired, requireRole('admin', 'hr'), deptCtrl.update);
router.delete('/departments/:id', authRequired, requireRole('admin'), deptCtrl.softDelete);

// ---------- Employees ----------
router.get('/employees', authRequired, requireRole('admin', 'hr', 'employee'), empCtrl.list);
router.get('/employees/:id', authRequired,
    requireSelfOrRole('id', 'admin', 'hr'),
    empCtrl.getOne);
router.post('/employees', authRequired, requireRole('admin', 'hr'),
    upload.single('file'),
    empCtrl.createValidation, empCtrl.create);
router.put('/employees/:id', authRequired, requireRole('admin', 'hr'),
    upload.single('file'),
    empCtrl.updateValidation, empCtrl.update);
router.delete('/employees/:id', authRequired, requireRole('admin'), empCtrl.softDelete);
router.post('/employees/bulk-shift', authRequired, requireRole('admin', 'hr'), empCtrl.bulkShift);

// ---------- Attendance ----------
router.post('/attendance/face-check',
    authRequired,
    upload.single('file'),
    attCtrl.faceCheck);
router.post('/attendance/manual', authRequired, requireRole('admin', 'hr'), attCtrl.manualCheck);
router.get('/attendance', authRequired, requireRole('admin', 'hr', 'kiosk'),
    attCtrl.listValidation, attCtrl.list);
router.get('/attendance/me', authRequired, attCtrl.myHistory);

// ---------- Shifts ----------
router.get('/shifts', authRequired, requireRole('admin', 'hr', 'employee'), shiftCtrl.list);
router.post('/shifts', authRequired, requireRole('admin', 'hr'), shiftCtrl.create);
router.delete('/shifts/:id', authRequired, requireRole('admin', 'hr'), shiftCtrl.remove);

// ---------- Dashboard ----------
router.get('/dashboard/overview', authRequired, requireRole('admin', 'hr'), dashCtrl.overview);

module.exports = router;
