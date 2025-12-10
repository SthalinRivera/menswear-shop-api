const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const ProductController = require('../controllers/productController');
const { authenticateJWT, checkPermission } = require('../middlewares/authMiddleware');
const { validate, validationSchemas } = require('../middlewares/validationMiddleware');

// Rutas públicas (solo lectura)
router.get('/',
    validate(validationSchemas.pagination.concat(validationSchemas.search)),
    ProductController.getProducts
);

router.get('/:id',
    ProductController.getProductById
);

router.get('/barcode/:barcode',
    ProductController.searchByBarcode
);

// Rutas protegidas para empleados
router.post('/',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    ProductController.createProduct
);

router.put('/:id',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    ProductController.updateProduct
);

router.delete('/:id',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    ProductController.deleteProduct
);

// Variantes
router.post('/:producto_id/variantes',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        body('talla').notEmpty().withMessage('Talla es requerida'),
        body('color_nombre').notEmpty().withMessage('Color es requerido')
    ]),
    ProductController.createVariant
);

router.put('/variantes/:variante_id/stock',
    authenticateJWT,
    checkPermission('INV_EDITAR'),
    validate([
        body('cantidad').isInt({ min: 1 }).withMessage('Cantidad inválida'),
        body('tipo_movimiento').isIn(['Entrada', 'Salida']).withMessage('Tipo de movimiento inválido'),
        body('almacen_id').isInt({ min: 1 }).withMessage('Almacén inválido')
    ]),
    ProductController.updateVariantStock
);

// Reportes y estadísticas
router.get('/stats/low-stock',
    authenticateJWT,
    checkPermission('INV_VER'),
    ProductController.getLowStockProducts
);

router.get('/stats/overview',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    ProductController.getProductStats
);

module.exports = router;