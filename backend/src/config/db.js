// src/config/db.js
'use strict';

const { Pool } = require('pg');
const { logger } = require('./logger');

const pool = new Pool({
    host:     process.env.POSTGRES_HOST     || 'db',
    port:     parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB       || 'hrm',
    user:     process.env.POSTGRES_USER     || 'hrm_admin',
    password: process.env.POSTGRES_PASSWORD || '',
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'hrm-backend',
});

pool.on('error', (err) => logger.error('PG pool error', { err: err.message }));

async function checkDb(retries = 30, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const r = await pool.query('SELECT 1 AS ok, now() AS ts');
            logger.info('DB healthcheck ok', { ts: r.rows[0].ts });
            return;
        } catch (err) {
            logger.warn(`DB not ready (try ${i + 1}/${retries}): ${err.message}`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error('Database unreachable');
}

/**
 * Convert a JS array of numbers into a pgvector literal.
 *   toVectorLiteral([0.1, 0.2])  -> '[0.1,0.2]'
 */
function toVectorLiteral(arr) {
    if (!Array.isArray(arr)) throw new Error('Embedding must be array');
    return '[' + arr.map(n => Number(n).toFixed(6)).join(',') + ']';
}

module.exports = { pool, checkDb, toVectorLiteral };
