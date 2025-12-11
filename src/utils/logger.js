// src/config/logger.js
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Para obtener __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Formato personalizado
const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}] : ${message} `;

    if (metadata && Object.keys(metadata).length > 0) {
        msg += JSON.stringify(metadata);
    }

    return msg;
});

// Configurar logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        customFormat
    ),
    transports: [
        // Logs en consola
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),

        // Logs de errores
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),

        // Logs combinados
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            maxsize: 5242880,
            maxFiles: 5
        }),

        // Logs de auditoría
        new winston.transports.File({
            filename: path.join(logDir, 'audit.log'),
            level: 'info',
            format: winston.format.json(),
            maxsize: 5242880,
            maxFiles: 10
        })
    ]
});

// Stream para morgan (HTTP logging)
logger.stream = {
    write: (message) => {
        logger.info(message.trim());
    }
};

// Métodos personalizados
logger.audit = (action, user, details) => {
    logger.info('AUDIT', {
        action,
        user: user?.usuario_id || 'system',
        ip: details?.ip,
        details: details?.message || details
    });
};

logger.api = (method, pathReq, status, duration, user) => {
    logger.info('API', {
        method,
        path: pathReq,
        status,
        duration: `${duration}ms`,
        user: user?.usuario_id || 'anonymous'
    });
};

export default logger;
