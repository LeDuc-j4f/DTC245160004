// src/config/logger.js - Winston JSON logger (for Promtail/Loki to scrape)
'use strict';

const winston = require('winston');

const redact = winston.format((info) => {
    const deny = ['password', 'token', 'jwt', 'authorization', 'cookie', 'secret'];
    for (const k of Object.keys(info)) {
        if (deny.includes(k.toLowerCase())) info[k] = '[REDACTED]';
    }
    if (info.req && info.req.headers) {
        info.req = { ...info.req, headers: { ...info.req.headers, authorization: '[REDACTED]', cookie: '[REDACTED]' } };
    }
    return info;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        redact(),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'hrm-backend' },
    transports: [
        new winston.transports.Console({
            stderrLevels: ['error'],
        }),
    ],
});

module.exports = { logger };
