const winston = require('winston');
// const path = require('path'); // Ya no es necesario
// const fs = require('fs'); // Ya no es necesario

// ❌ ELIMINAMOS la creación del directorio de logs
// const logDir = 'logs';
// if (!fs.existsSync(logDir)) {
//   fs.mkdirSync(logDir);
// }

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
        // ✅ MANTENEMOS: Console transport (Los logs de consola son capturados por Vercel)
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),

        // ❌ ELIMINAMOS: File transport para errores
        // new winston.transports.File({
        //   filename: path.join(logDir, 'error.log'),
        //   level: 'error',
        //   maxsize: 5242880, // 5MB
        //   maxFiles: 5
        // }),

        // ❌ ELIMINAMOS: File transport para todos los logs
        // new winston.transports.File({
        //   filename: path.join(logDir, 'combined.log'),
        //   maxsize: 5242880, // 5MB
        //   maxFiles: 5
        // }),

        // ❌ ELIMINAMOS: File transport para auditoría
        // new winston.transports.File({
        //   filename: path.join(logDir, 'audit.log'),
        //   level: 'info',
        //   format: winston.format.json(),
        //   maxsize: 5242880,
        //   maxFiles: 10
        // })
    ]
});

// Stream para morgan (HTTP logging)
logger.stream = {
    write: (message) => {
        logger.info(message.trim());
    }
};

// Métodos personalizados (Estos pueden quedarse igual)
logger.audit = (action, user, details) => {
    logger.info('AUDIT', {
        action,
        user: user?.usuario_id || 'system',
        ip: details?.ip,
        details: details?.message || details
    });
};

logger.api = (method, path, status, duration, user) => {
    logger.info('API', {
        method,
        path,
        status,
        duration: `${duration}ms`,
        user: user?.usuario_id || 'anonymous'
    });
};

module.exports = logger;