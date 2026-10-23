// server.js - HRM backend entrypoint
'use strict';

require('dotenv').config();

const express       = require('express');
const helmet        = require('helmet');
const cors          = require('cors');
const compression   = require('compression');
const rateLimit     = require('express-rate-limit');

const { logger }        = require('./src/config/logger');
const { pool, checkDb } = require('./src/config/db');
const routes            = require('./src/routes/routes');
const { scheduleAbsentJob } = require('./src/config/cron');

const app  = express();
const PORT = parseInt(process.env.BACKEND_PORT || '3000', 10);

// Trust proxy so X-Forwarded-For from Nginx works correctly
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
    contentSecurityPolicy: false,  // backend serves JSON only; CSP is set by Nginx
    crossOriginEmbedderPolicy: false,
}));

// CORS — allow only known origins (mirror Nginx whitelist)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost,http://localhost:80,http://localhost:8080,http://127.0.0.1,https://localhost,https://127.0.0.1')
    .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('CORS not allowed: ' + origin));
    },
    credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Global rate limit
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests' },
});
app.use(globalLimiter);

// Health check (public)
app.get('/health', (req, res) => res.json({ ok: true, service: 'hrm-backend', time: new Date().toISOString() }));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'hrm-backend', time: new Date().toISOString() }));

// Prometheus metrics endpoint
const appStartTime = Date.now();
app.get('/metrics', (req, res) => {
    const mem = process.memoryUsage();
    const uptime = (Date.now() - appStartTime) / 1000;
    const cpu = process.cpuUsage();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(
`# HELP process_uptime_seconds The uptime of the process in seconds.
# TYPE process_uptime_seconds gauge
process_uptime_seconds ${uptime}

# HELP process_resident_memory_bytes Resident memory size in bytes.
# TYPE process_resident_memory_bytes gauge
process_resident_memory_bytes ${mem.rss}

# HELP process_heap_bytes Process heap bytes.
# TYPE process_heap_bytes gauge
process_heap_bytes ${mem.heapUsed}

# HELP process_heap_total_bytes Process heap total bytes.
# TYPE process_heap_total_bytes gauge
process_heap_total_bytes ${mem.heapTotal}

# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.
# TYPE process_cpu_seconds_total counter
process_cpu_seconds_total ${(cpu.user + cpu.system) / 1000000}

# HELP nodejs_version_info Node.js version info.
# TYPE nodejs_version_info gauge
nodejs_version_info{version="${process.version}"} 1
`);
});

// API routes
app.use('/api', routes);

// 404
app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// Error handler
app.use((err, req, res, _next) => {
    logger.error('Unhandled error', { err: err.message, stack: err.stack, path: req.path });
    if (err.message && err.message.startsWith('CORS')) {
        return res.status(403).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: 'Internal server error' });
});

// Start
(async () => {
    try {
        await checkDb();
        logger.info('Database connected');
        await pool.query(`
            ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_status VARCHAR(32) DEFAULT 'on_time';
            ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_status VARCHAR(32);
        `);
        scheduleAbsentJob();
        app.listen(PORT, '0.0.0.0', () => {
            logger.info(`HRM backend listening on port ${PORT}`);
        });
    } catch (err) {
        logger.error('Startup failed', { err: err.message });
        process.exit(1);
    }
})();

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(sig => {
    process.on(sig, async () => {
        logger.info(`Received ${sig}, shutting down`);
        try { await pool.end(); } catch (e) { /* ignore */ }
        process.exit(0);
    });
});
