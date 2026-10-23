// src/middleware/rbac.middleware.js
'use strict';

/**
 * Role-based access control.
 *   requireRole('admin')            -> only admin
 *   requireRole('admin', 'hr')      -> admin OR hr
 *   requireSelfOrRole('employee_id', 'admin')
 *      -> user can access own resource (matched on employee_id), or is admin
 */
function requireRole(...allowed) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ ok: false, error: 'Auth required' });
        if (!allowed.includes(req.user.role)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        return next();
    };
}

function requireSelfOrRole(empIdParam, ...allowed) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ ok: false, error: 'Auth required' });
        if (allowed.includes(req.user.role)) return next();
        const target = parseInt(req.params[empIdParam], 10);
        if (Number.isFinite(target) && target === req.user.employee_id) return next();
        return res.status(403).json({ ok: false, error: 'Forbidden' });
    };
}

module.exports = { requireRole, requireSelfOrRole };
