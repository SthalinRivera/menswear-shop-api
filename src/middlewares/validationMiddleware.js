const { body, query, param, validationResult } = require('express-validator');

const { ERROR_MESSAGES } = require('../config/constants');

// Middleware para validar resultados de express-validator
const validate = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(validation => validation.run(req)));

        const errors = validationResult(req);
        if (errors.isEmpty()) {
            return next();
        }

        const extractedErrors = [];
        errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));

        return res.status(422).json({
            success: false,
            message: ERROR_MESSAGES.VALIDATION_ERROR,
            errors: extractedErrors
        });
    };
};

// Esquemas de validación comunes
const validationSchemas = {
    // Autenticación
    login: [
        body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
        body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres')
    ],

    register: [
        body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
        body('password').isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
            .withMessage('La contraseña debe contener mayúsculas, minúsculas y números'),
        body('nombre').notEmpty().trim().withMessage('El nombre es requerido'),
        body('apellido').optional().trim(),
    ],

    // Productos
    createProduct: [
        body('sku').notEmpty().withMessage('SKU es requerido'),
        body('nombre').notEmpty().trim().withMessage('Nombre es requerido'),
        body('precio_compra').isFloat({ min: 0 }).withMessage('Precio de compra inválido'),
        body('precio_venta').isFloat({ min: 0 }).withMessage('Precio de venta inválido'),
        body('categoria_id').isInt({ min: 1 }).withMessage('Categoría inválida'),
        body('stock_minimo').optional().isInt({ min: 0 }).withMessage('Stock mínimo inválido'),
        body('stock_maximo').optional().isInt({ min: 1 }).withMessage('Stock máximo inválido'),
    ],

    updateProduct: [
        body('nombre').optional().trim().notEmpty().withMessage('Nombre no puede estar vacío'),
        body('precio_venta').optional().isFloat({ min: 0 }).withMessage('Precio de venta inválido'),
        body('activo').optional().isBoolean().withMessage('Activo debe ser booleano'),
    ],

    // Ventas
    createSale: [
        body('cliente_id').optional().isInt({ min: 1 }).withMessage('Cliente inválido'),
        body('tipo_venta').isIn(['Presencial', 'Online', 'Telefónica', 'Mayorista']).withMessage('Tipo de venta inválido'),
        body('metodo_pago').isIn(['Efectivo', 'Tarjeta Crédito', 'Tarjeta Débito', 'Transferencia', 'PayPal', 'Mercado Pago'])
            .withMessage('Método de pago inválido'),
        body('detalles').isArray({ min: 1 }).withMessage('Debe haber al menos un producto en la venta'),
        body('detalles.*.variante_id').isInt({ min: 1 }).withMessage('Variante inválida'),
        body('detalles.*.cantidad').isInt({ min: 1 }).withMessage('Cantidad inválida'),
    ],

    // Clientes
    createCustomer: [
        body('nombre').notEmpty().trim().withMessage('Nombre es requerido'),
        body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
        body('telefono').optional().matches(/^[0-9+\-\s()]{10,20}$/).withMessage('Teléfono inválido'),
        body('tipo_cliente').optional().isIn(['Minorista', 'Mayorista', 'Empresarial', 'VIP']),
    ],

    // Filtros y paginación
    pagination: [
        query('page').optional().isInt({ min: 1 }).withMessage('Página debe ser un número positivo'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Límite debe ser entre 1 y 100'),
        query('sortBy').optional().trim(),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Orden debe ser asc o desc'),
    ],

    search: [
        query('q').optional().trim(),
        query('categoria_id').optional().isInt({ min: 1 }),
        query('marca_id').optional().isInt({ min: 1 }),
        query('genero').optional().isIn(['Hombre', 'Mujer', 'Unisex', 'Niño', 'Niña']),
        query('minPrice').optional().isFloat({ min: 0 }),
        query('maxPrice').optional().isFloat({ min: 0 }),
        query('enPromocion').optional().isBoolean(),
    ],
};

// Exportamos correctamente
module.exports = {
    validate,
    validationSchemas
};