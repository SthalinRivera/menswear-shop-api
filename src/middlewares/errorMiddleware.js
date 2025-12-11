import logger from "../utils/logger.js";
import { ERROR_MESSAGES } from "../config/constants.js";

// Error handler global
export const errorHandler = (err, req, res, next) => {
    // Log detallado del error
    logger.error({
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        ip: req.ip,
        user: req.user?.usuario_id || "anonymous"
    });

    // Error de validación
    if (err.name === "ValidationError") {
        return res.status(400).json({
            success: false,
            message: ERROR_MESSAGES.VALIDATION_ERROR,
            errors: err.details || err.message
        });
    }

    // Error de JWT
    if (err.name === "JsonWebTokenError") {
        return res.status(401).json({
            success: false,
            message: "Token inválido"
        });
    }

    if (err.name === "TokenExpiredError") {
        return res.status(401).json({
            success: false,
            message: "Token expirado"
        });
    }

    // Error de base de datos (PostgreSQL)
    if (err.code === "23505") {
        // Unique constraint (duplicado)
        return res.status(409).json({
            success: false,
            message: ERROR_MESSAGES.DUPLICATE_ENTRY,
            error: err.detail
        });
    }

    if (err.code === "23503") {
        // Foreign key violation
        return res.status(400).json({
            success: false,
            message: "Referencia inválida",
            error: err.detail
        });
    }

    // Errores personalizados con status
    if (err.statusCode) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            error: err.error || null
        });
    }

    // Error genérico
    const statusCode = err.status || 500;

    const message = process.env.NODE_ENV === "production"
        ? ERROR_MESSAGES.INTERNAL_ERROR
        : err.message;

    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === "development" && { stack: err.stack })
    });
};

// 404 handler
export const notFoundHandler = (req, res, next) => {
    const error = new Error(`Ruta no encontrada: ${req.originalUrl}`);
    error.statusCode = 404;
    next(error);
};

// Wrapper para funciones async (evita try-catch en controllers)
export const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
