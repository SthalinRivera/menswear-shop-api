const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const SaleController = require('../controllers/saleController');
const { authenticateJWT, checkPermission } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validationMiddleware');

// Rutas públicas limitadas
router.get('/:id',
    authenticateJWT,
    SaleController.getSaleById
);

// Rutas protegidas para empleados
router.post('/',
    authenticateJWT,
    checkPermission('VENTAS_CREAR'),
    SaleController.createSale
);

router.get('/',
    authenticateJWT,
    checkPermission('VENTAS_VER'),
    SaleController.getSales
);

router.put('/:id/status',
    authenticateJWT,
    checkPermission('VENTAS_EDITAR'),
    validate([
        body('estado_venta').notEmpty().withMessage('Estado de venta requerido')
    ]),
    SaleController.updateSaleStatus
);

router.put('/:id/cancel',
    authenticateJWT,
    checkPermission('VENTAS_ANULAR'),
    validate([
        body('motivo').optional().trim()
    ]),
    SaleController.cancelSale
);

// Reportes y facturación
router.get('/stats/overview',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    SaleController.getSalesStats
);

router.get('/:id/invoice',
    authenticateJWT,
    checkPermission('VENTAS_VER'),
    SaleController.generateInvoice
);

module.exports = router;