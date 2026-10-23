// src/middleware/upload.middleware.js
'use strict';

const multer = require('multer');
const path = require('path');
const fs   = require('fs');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => {
        const ts = Date.now();
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${ts}_${safe}`);
    },
});

function fileFilter(req, file, cb) {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    return cb(new Error('Unsupported file type'));
}

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024, files: 5 },  // 5MB / 5 files
});

module.exports = { upload, UPLOAD_DIR };
