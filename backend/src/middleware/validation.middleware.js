// src/middleware/validation.middleware.js
'use strict';

const { validationResult } = require('express-validator');

function runValidation(req, res, next) {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
        return res.status(400).json({ ok: false, error: 'Validation failed', details: errs.array() });
    }
    return next();
}

module.exports = { runValidation };
