import express from "express";
import { body, param } from "express-validator";
import SaleController from "../controllers/saleController.js";
import { authenticateJWT, checkPermission } from "../middlewares/authMiddleware.js";
import { validate, validationSchemas } from "../middlewares/validationMiddleware.js";

const router = express.Router();

// Rutas públicas limitadas (con autenticación pero sin permisos específicos)
router.get(
    '/:id',
    authenticateJWT,
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    SaleController.getSaleById
);

// Rutas protegidas para empleados
router.post(
    '/',
    authenticateJWT,
    checkPermission('VENTAS_CREAR'),
    validate([
        body('cliente_id').optional().isInt({ min: 1 }).withMessage('Cliente ID inválido'),
        body('tipo_venta').isIn(['Presencial', 'Online', 'Telefónica']).withMessage('Tipo de venta inválido'),
        body('metodo_pago').isIn(['Efectivo', 'Tarjeta Crédito', 'Tarjeta Débito', 'Transferencia']).withMessage('Método de pago inválido'),
        body('costo_envio').optional().isFloat({ min: 0 }).withMessage('Costo de envío inválido'),
        body('notas').optional().trim(),
        body('detalles').isArray({ min: 1 }).withMessage('Detalles de venta requeridos'),
        // body('detalles.*.producto_id').isInt({ min: 1 }).withMessage('Producto ID inválido'),
        body('detalles.*.variante_id').optional().isInt({ min: 1 }).withMessage('Variante ID inválido'),
        body('detalles.*.cantidad').isInt({ min: 1 }).withMessage('Cantidad inválida'),
        body('detalles.*.precio_unitario').isFloat({ min: 0 }).withMessage('Precio unitario inválido'),
        body('detalles.*.descuento_unitario').optional().isFloat({ min: 0 }).withMessage('Descuento unitario inválido')
    ]),
    SaleController.createSale
);

router.get(
    '/',
    authenticateJWT,
    checkPermission('VENTAS_VER'),
    validate(validationSchemas.pagination.concat([
        body('fecha_inicio').optional().isDate().withMessage('Fecha inicio inválida'),
        body('fecha_fin').optional().isDate().withMessage('Fecha fin inválida'),
        body('cliente_id').optional().isInt({ min: 1 }).withMessage('Cliente ID inválido'),
        body('tipo_venta').optional().isIn(['Presencial', 'Online', 'Telefónica']).withMessage('Tipo de venta inválido'),
        body('metodo_pago').optional().isIn(['Efectivo', 'Tarjeta Crédito', 'Tarjeta Débito', 'Transferencia']).withMessage('Método de pago inválido'),
        body('estado_venta').optional().isIn(['Pendiente', 'Completada', 'Cancelada']).withMessage('Estado de venta inválido'),
        body('include_cliente').optional().isBoolean().withMessage('Include cliente debe ser booleano'),
        body('include_detalles').optional().isBoolean().withMessage('Include detalles debe ser booleano'),
        body('order_by').optional().isIn(['fecha_creacion', 'total', 'cliente']).withMessage('Orden inválido'),
        body('order_direction').optional().isIn(['asc', 'desc']).withMessage('Dirección de orden inválida')
    ])),
    SaleController.getSales
);

router.put(
    '/:id/status',
    authenticateJWT,
    checkPermission('VENTAS_EDITAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido'),
        body('estado_venta').isIn(['Pendiente', 'Completada']).withMessage('Estado de venta inválido'),
        body('notas').optional().trim()
    ]),
    SaleController.updateSaleStatus
);

router.put(
    '/:id/cancel',
    authenticateJWT,
    checkPermission('VENTAS_ANULAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido'),
        body('motivo').optional().trim(),
        body('reembolsar').optional().isBoolean().withMessage('Reembolsar debe ser booleano')
    ]),
    SaleController.cancelSale
);

// Reportes y estadísticas
router.get(
    '/stats/overview',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    validate([
        body('fecha_inicio').optional().isDate().withMessage('Fecha inicio inválida'),
        body('fecha_fin').optional().isDate().withMessage('Fecha fin inválida'),
        body('agrupar_por').optional().isIn(['dia', 'semana', 'mes', 'trimestre', 'año']).withMessage('Agrupación inválida')
    ]),
    SaleController.getSalesStats
);

router.get(
    '/:id/invoice',
    authenticateJWT,
    checkPermission('VENTAS_VER'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    SaleController.generateInvoice
);

// Obtener detalles completos de una venta
router.get(
    '/:id/details',
    authenticateJWT,
    checkPermission('VENTAS_VER'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    SaleController.getSaleWithDetails
);

// Reembolsos
router.post(
    '/:id/refund',
    authenticateJWT,
    checkPermission('VENTAS_ANULAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido'),
        body('motivo').notEmpty().trim().withMessage('Motivo requerido'),
        body('monto').isFloat({ min: 0 }).withMessage('Monto inválido'),
        body('metodo_reembolso').isIn(['Efectivo', 'Tarjeta', 'Transferencia']).withMessage('Método de reembolso inválido'),
        body('productos').optional().isArray().withMessage('Productos debe ser un array'),
        body('productos.*.detalle_venta_id').isInt({ min: 1 }).withMessage('Detalle venta ID inválido'),
        body('productos.*.cantidad').isInt({ min: 1 }).withMessage('Cantidad inválida')
    ]),
    SaleController.processRefund
);

// Búsqueda avanzada
router.get(
    '/search/advanced',
    authenticateJWT,
    checkPermission('VENTAS_VER'),
    validate(validationSchemas.pagination.concat([
        body('query').optional().trim(),
        body('codigo_venta').optional().trim(),
        body('cliente_nombre').optional().trim(),
        body('cliente_email').optional().isEmail().withMessage('Email inválido'),
        body('producto_nombre').optional().trim(),
        body('sku').optional().trim(),
        body('min_total').optional().isFloat({ min: 0 }).withMessage('Total mínimo inválido'),
        body('max_total').optional().isFloat({ min: 0 }).withMessage('Total máximo inválido')
    ])),
    SaleController.advancedSearch
);

// Exportar ventas
router.get(
    '/export/csv',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    validate([
        body('fecha_inicio').optional().isDate().withMessage('Fecha inicio inválida'),
        body('fecha_fin').optional().isDate().withMessage('Fecha fin inválida')
    ]),
    SaleController.exportSalesToCSV
);

// Dashboard stats (métricas rápidas)
router.get(
    '/stats/dashboard',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    SaleController.getDashboardStats
);

// Ventas por cliente
router.get(
    '/cliente/:cliente_id',
    authenticateJWT,
    checkPermission('VENTAS_VER'),
    validate([
        param('cliente_id').isInt({ min: 1 }).withMessage('Cliente ID inválido')
    ]),
    SaleController.getClientSales
);

// Métricas de productos más vendidos
router.get(
    '/stats/top-products',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    validate([
        body('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Límite inválido'),
        body('fecha_inicio').optional().isDate().withMessage('Fecha inicio inválida'),
        body('fecha_fin').optional().isDate().withMessage('Fecha fin inválida'),
        body('categoria_id').optional().isInt({ min: 1 }).withMessage('Categoría ID inválida')
    ]),
    SaleController.getTopProducts
);

export default router;