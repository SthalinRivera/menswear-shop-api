import express from 'express';
import BrandController from '../controllers/brandController.js';
import { authenticateJWT, checkPermission } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validationMiddleware.js';
import { body, query } from 'express-validator';

const router = express.Router();

// RUTAS PÚBLICAS
router.get('/',
    validate([
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 }),
        query('activa').optional().isBoolean()
    ]),
    BrandController.getBrands
);

router.get('/simple',
    BrandController.getAllBrandsSimple
);

router.get('/search',
    BrandController.searchBrands
);

router.get('/top-selling',
    BrandController.getTopSellingBrands
);

router.get('/country/:pais',
    BrandController.getBrandsByCountry
);

router.get('/:id',
    BrandController.getBrandById
);

router.get('/:id/products',
    BrandController.getBrandProducts
);

// RUTAS PROTEGIDAS
router.get('/stats/overview',
    authenticateJWT,
    checkPermission('MARCAS_VER'),
    BrandController.getBrandStats
);

router.get('/stats/low-stock',
    authenticateJWT,
    checkPermission('INVENTARIO_VER'),
    BrandController.getBrandsWithLowStock
);

router.post('/',
    authenticateJWT,
    checkPermission('MARCAS_EDITAR'),
    BrandController.createBrand
);

router.put('/:id',
    authenticateJWT,
    checkPermission('MARCAS_EDITAR'),
    BrandController.updateBrand
);

router.delete('/:id',
    authenticateJWT,
    checkPermission('MARCAS_EDITAR'),
    BrandController.deleteBrand
);

// IMPORT/EXPORT
router.post('/import',
    authenticateJWT,
    checkPermission('MARCAS_EDITAR'),
    validate([
        body('marcas').isArray().withMessage('Se requiere un array de marcas')
    ]),
    BrandController.importBrands
);

router.get('/export',
    authenticateJWT,
    checkPermission('MARCAS_VER'),
    BrandController.exportBrands
);

// LOGO/IMAGEN
router.get('/:id/logo-info',
    authenticateJWT,
    BrandController.getBrandLogo
);

export default router;