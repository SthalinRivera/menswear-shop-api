/**
 * Manejador estandarizado de respuestas HTTP
 */

/**
 * Envía una respuesta exitosa
 * @param {Object} res - Objeto response de Express
 * @param {*} data - Datos a enviar
 * @param {string} message - Mensaje de éxito
 * @param {number} statusCode - Código de estado HTTP (default: 200)
 */
export const sendSuccess = (res, data = null, message = "Operación exitosa", statusCode = 200) => {
    const response = {
        success: true,
        message,
        statusCode,
        timestamp: new Date().toISOString()
    };

    if (data !== null) {
        if (data.data && data.pagination) {
            // Si tiene estructura paginada
            response.data = data.data;
            response.pagination = data.pagination;
        } else if (Array.isArray(data)) {
            // Si es un array
            response.data = data;
            response.total = data.length;
        } else if (typeof data === 'object') {
            // Si es un objeto
            response.data = data;
        } else {
            // Otros tipos de datos
            response.data = data;
        }
    }

    res.status(statusCode).json(response);
};

/**
 * Envía una respuesta de error
 * @param {Object} res - Objeto response de Express
 * @param {Error|Object|string} error - Error a enviar
 * @param {number} statusCode - Código de estado HTTP (default: 500)
 */
export const sendError = (res, error, statusCode = 500) => {
    let message = "Error interno del servidor";
    let errors = null;
    let errorCode = null;

    if (typeof error === 'string') {
        message = error;
    } else if (error instanceof Error) {
        message = error.message || message;
        errorCode = error.code || null;

        // Si es un error de validación de express-validator
        if (error.errors) {
            errors = error.errors;
        }
    } else if (typeof error === 'object') {
        message = error.message || message;
        errorCode = error.code || null;
        errors = error.errors || null;
    }

    // Mapear códigos de PostgreSQL a mensajes más amigables
    if (errorCode === '23505') {
        message = "El registro ya existe (violación de unicidad)";
        statusCode = 409;
    } else if (errorCode === '23503') {
        message = "Violación de clave foránea";
        statusCode = 400;
    } else if (errorCode === '23502') {
        message = "Campo requerido no puede ser nulo";
        statusCode = 400;
    } else if (errorCode === '42P01') {
        message = "Tabla no encontrada";
        statusCode = 500;
    } else if (errorCode === '42703') {
        message = "Columna no encontrada";
        statusCode = 500;
    }

    const response = {
        success: false,
        message,
        statusCode,
        timestamp: new Date().toISOString()
    };

    if (errorCode) {
        response.errorCode = errorCode;
    }

    if (errors) {
        response.errors = errors;
    }

    // Solo incluir stack trace en desarrollo
    if (process.env.NODE_ENV === 'development' && error instanceof Error) {
        response.stack = error.stack;
    }

    res.status(statusCode).json(response);
};

/**
 * Envía una respuesta de error de validación
 * @param {Object} res - Objeto response de Express
 * @param {Array} errors - Array de errores de validación
 */
export const sendValidationError = (res, errors) => {
    const formattedErrors = errors.map(err => ({
        field: err.path || err.param,
        message: err.msg,
        value: err.value,
        location: err.location
    }));

    sendError(res, {
        message: "Error de validación",
        errors: formattedErrors
    }, 400);
};

/**
 * Envía una respuesta de recurso no encontrado
 * @param {Object} res - Objeto response de Express
 * @param {string} resourceName - Nombre del recurso no encontrado
 */
export const sendNotFound = (res, resourceName = "Recurso") => {
    sendError(res, {
        message: `${resourceName} no encontrado`
    }, 404);
};

/**
 * Envía una respuesta de acceso denegado
 * @param {Object} res - Objeto response de Express
 * @param {string} message - Mensaje de acceso denegado
 */
export const sendForbidden = (res, message = "Acceso denegado") => {
    sendError(res, {
        message
    }, 403);
};

/**
 * Envía una respuesta de no autorizado
 * @param {Object} res - Objeto response de Express
 * @param {string} message - Mensaje de no autorizado
 */
export const sendUnauthorized = (res, message = "No autorizado") => {
    sendError(res, {
        message
    }, 401);
};

/**
 * Envía una respuesta de conflicto (duplicado)
 * @param {Object} res - Objeto response de Express
 * @param {string} message - Mensaje de conflicto
 */
export const sendConflict = (res, message = "El recurso ya existe") => {
    sendError(res, {
        message
    }, 409);
};

/**
 * Envía una respuesta de error interno del servidor
 * @param {Object} res - Objeto response de Express
 * @param {Error} error - Error original
 */
export const sendServerError = (res, error) => {
    console.error('Server Error:', error);

    const message = process.env.NODE_ENV === 'production'
        ? "Error interno del servidor"
        : error.message;

    sendError(res, {
        message,
        errorCode: error.code || 'INTERNAL_SERVER_ERROR'
    }, 500);
};

/**
 * Envía una respuesta de error de base de datos
 * @param {Object} res - Objeto response de Express
 * @param {Error} error - Error de base de datos
 */
export const sendDatabaseError = (res, error) => {
    console.error('Database Error:', error);

    let message = "Error de base de datos";
    let statusCode = 500;

    if (error.code === '23505') {
        message = "El registro ya existe";
        statusCode = 409;
    } else if (error.code === '23503') {
        message = "No se puede eliminar o actualizar debido a referencias existentes";
        statusCode = 400;
    } else if (error.code === '23502') {
        message = "Campo requerido no proporcionado";
        statusCode = 400;
    } else if (error.code === '42P01') {
        message = "Error en la estructura de la base de datos";
        statusCode = 500;
    }

    sendError(res, {
        message,
        errorCode: error.code
    }, statusCode);
};

/**
 * Envía una respuesta de éxito con paginación
 * @param {Object} res - Objeto response de Express
 * @param {Array} data - Datos paginados
 * @param {Object} pagination - Información de paginación
 * @param {string} message - Mensaje de éxito
 */
export const sendPaginatedSuccess = (res, data, pagination, message = "Datos obtenidos exitosamente") => {
    sendSuccess(res, {
        data,
        pagination
    }, message, 200);
};

/**
 * Envía una respuesta de éxito para operaciones de creación
 * @param {Object} res - Objeto response de Express
 * @param {*} data - Datos creados
 * @param {string} message - Mensaje de éxito
 */
export const sendCreated = (res, data, message = "Recurso creado exitosamente") => {
    sendSuccess(res, data, message, 201);
};

/**
 * Envía una respuesta de éxito para operaciones de actualización
 * @param {Object} res - Objeto response de Express
 * @param {*} data - Datos actualizados
 * @param {string} message - Mensaje de éxito
 */
export const sendUpdated = (res, data, message = "Recurso actualizado exitosamente") => {
    sendSuccess(res, data, message, 200);
};

/**
 * Envía una respuesta de éxito para operaciones de eliminación
 * @param {Object} res - Objeto response de Express
 * @param {string} message - Mensaje de éxito
 */
export const sendDeleted = (res, message = "Recurso eliminado exitosamente") => {
    sendSuccess(res, null, message, 200);
};

/**
 * Maneja respuestas con try-catch
 * @param {Function} handler - Función controladora
 * @returns {Function} Middleware de Express
 */
export const withErrorHandling = (handler) => {
    return async (req, res, next) => {
        try {
            await handler(req, res, next);
        } catch (error) {
            if (error.name === 'ValidationError') {
                return sendValidationError(res, error.errors || []);
            }
            sendError(res, error);
        }
    };
};

/**
 * Valida si es un UUID
 * @param {string} value - Valor a validar
 * @returns {boolean} True si es un UUID válido
 */
export const isValidUUID = (value) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
};

/**
 * Filtra datos para excluir campos sensibles
 * @param {Object} data - Datos a filtrar
 * @param {Array} sensitiveFields - Campos sensibles a excluir
 * @returns {Object} Datos filtrados
 */
export const filterSensitiveData = (data, sensitiveFields = ['password', 'token', 'contrasena_hash', 'refresh_token']) => {
    if (!data || typeof data !== 'object') return data;

    if (Array.isArray(data)) {
        return data.map(item => filterSensitiveData(item, sensitiveFields));
    }

    const filtered = { ...data };
    sensitiveFields.forEach(field => {
        if (filtered[field] !== undefined) {
            delete filtered[field];
        }
    });

    return filtered;
};

/**
 * Formatea una fecha para respuesta
 * @param {Date|string} date - Fecha a formatear
 * @returns {string} Fecha formateada en ISO string
 */
export const formatDateForResponse = (date) => {
    if (!date) return null;
    const d = new Date(date);
    return d.toISOString();
};

export default {
    sendSuccess,
    sendError,
    sendValidationError,
    sendNotFound,
    sendForbidden,
    sendUnauthorized,
    sendConflict,
    sendServerError,
    sendDatabaseError,
    sendPaginatedSuccess,
    sendCreated,
    sendUpdated,
    sendDeleted,
    withErrorHandling,
    isValidUUID,
    filterSensitiveData,
    formatDateForResponse
};