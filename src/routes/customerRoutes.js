import express from "express";
import { body, param, query } from "express-validator";
import CustomerController from "../controllers/customerController.js";
import { authenticateJWT, checkPermission } from "../middlewares/authMiddleware.js";
import { validate, validationSchemas } from "../middlewares/validationMiddleware.js";

const router = express.Router();

// ====================
// RUTAS PÚBLICAS (lectura)
// ====================
router.get(
    '/',
    validate(validationSchemas.pagination.concat([
        query('tipo_cliente').optional().isString(),
        query('segmento').optional().isString(),
        query('activo').optional().isBoolean()
    ])),
    CustomerController.getCustomers
);

router.get(
    '/:id',
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    CustomerController.getCustomerById
);

// ====================
// RUTAS PROTEGIDAS
// ====================
router.post(
    '/',
    authenticateJWT,
    checkPermission('CLIENTES_ESCRITURA'),
    validate([
        body('codigo_cliente').notEmpty().withMessage('Código requerido'),
        body('nombre').notEmpty().trim().withMessage('Nombre requerido'),
        body('apellido').optional().trim(),
        body('email').optional().isEmail().withMessage('Email inválido'),
        body('telefono').optional().trim(),
        body('tipo_cliente').optional().isIn(['Minorista', 'Mayorista', 'Empresarial', 'VIP']),
        body('segmento').optional().isIn(['Nuevo', 'Ocasional', 'Frecuente', 'Leal']),
        body('activo').optional().isBoolean()
    ]),
    CustomerController.createCustomer
);

router.put(
    '/:id',
    authenticateJWT,
    checkPermission('CLIENTES_ESCRITURA'),
    validate([
        param('id').isInt({ min: 1 }),
        body('nombre').optional().trim(),
        body('apellido').optional().trim(),
        body('email').optional().isEmail(),
        body('telefono').optional().trim(),
        body('segmento').optional().isIn(['Nuevo', 'Ocasional', 'Frecuente', 'Leal']),
        body('activo').optional().isBoolean()
    ]),
    CustomerController.updateCustomer
);

router.patch(
    '/:id/status',
    authenticateJWT,
    checkPermission('CLIENTES_ESCRITURA'),
    validate([
        param('id').isInt({ min: 1 }),
        body('activo').isBoolean().withMessage('Activo requerido')
    ]),
    CustomerController.updateCustomerStatus
);

router.delete(
    '/:id',
    authenticateJWT,
    checkPermission('CLIENTES_ELIMINAR'),
    validate([
        param('id').isInt({ min: 1 })
    ]),
    CustomerController.deleteCustomer
);

export default router;
