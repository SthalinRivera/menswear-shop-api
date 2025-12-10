const logger = require('../utils/logger');
const { ERROR_MESSAGES } = require('../config/constants');

// Error handler global
const errorHandler = (err, req, res, next) => {
    // Log error
    logger.error({
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        ip: req.ip,
        user: req.user?.usuario_id || 'anonymous'
    });

    // Error de validación
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            message: ERROR_MESSAGES.VALIDATION_ERROR,
            errors: err.details || err.message
        });
    }

    // Error de JWT
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Token inválido'
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: 'Token expirado'
        });
    }

    // Error de base de datos
    if (err.code === '23505') { // Violación de unique constraint
        return res.status(409).json({
            success: false,
            message: ERROR_MESSAGES.DUPLICATE_ENTRY,
            error: err.detail
        });
    }

    if (err.code === '23503') { // Violación de foreign key
        return res.status(400).json({
            success: false,
            message: 'Referencia inválida',
            error: err.detail
        });
    }

    // Error personalizado con status code
    if (err.statusCode) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            error: err.error || null
        });
    }

    // Error genérico
    const statusCode = err.status || 500;
    const message = process.env.NODE_ENV === 'production'
        ? ERROR_MESSAGES.INTERNAL_ERROR
        : err.message;

    res.status(statusCode).json({
        success: false,
        message: message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

// 404 handler
const notFoundHandler = (req, res, next) => {
    const error = new Error(`Ruta no encontrada: ${req.originalUrl}`);
    error.statusCode = 404;
    next(error);
};

// Async handler wrapper (evita try-catch en controllers)
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler
};