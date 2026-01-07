import express from "express";
import { body, param } from "express-validator";
import BrandController from "../controllers/brandController.js";
import { authenticateJWT, checkPermission } from "../middlewares/authMiddleware.js";
import { validate, validationSchemas } from "../middlewares/validationMiddleware.js";

const router = express.Router();

// Rutas públicas (solo lectura)
router.get(
    '/',
    validate(validationSchemas.pagination.concat([
        body('only_active').optional().isBoolean().withMessage('Only active debe ser booleano'),
        body('search').optional().trim(),
        body('pais_origen').optional().trim(),
        body('sort_by').optional().isIn(['nombre', 'pais_origen', 'created_at', 'total_productos']).withMessage('Campo de ordenación inválido')
    ])),
    BrandController.getBrands
);

router.get(
    '/all',
    BrandController.getAllActiveBrands
);

router.get(
    '/:id',
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    BrandController.getBrandById
);

router.get(
    '/slug/:slug',
    validate([
        param('slug').notEmpty().withMessage('Slug requerido')
    ]),
    BrandController.getBrandBySlug
);

router.get(
    '/:id/products',
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    BrandController.getBrandProducts
);

// Rutas protegidas para administradores
router.post(
    '/',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        body('nombre').notEmpty().trim().withMessage('Nombre requerido'),
        body('descripcion').optional().trim(),
        body('pais_origen').optional().trim(),
        body('sitio_web').optional().isURL().withMessage('URL inválida'),
        body('contacto_email').optional().isEmail().withMessage('Email inválido'),
        body('telefono_contacto').optional().trim(),
        body('logo_url').optional().isURL().withMessage('URL de logo inválida'),
        body('historia').optional().trim(),
        body('activo').optional().isBoolean().withMessage('Activo debe ser booleano'),
        body('slug').optional().trim(),
        body('meta_title').optional().trim(),
        body('meta_description').optional().trim(),
        body('meta_keywords').optional().trim(),
        body('orden').optional().isInt({ min: 0 }).withMessage('Orden inválido')
    ]),
    BrandController.createBrand
);

router.put(
    '/:id',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido'),
        body('nombre').optional().trim(),
        body('descripcion').optional().trim(),
        body('pais_origen').optional().trim(),
        body('sitio_web').optional().isURL().withMessage('URL inválida'),
        body('contacto_email').optional().isEmail().withMessage('Email inválido'),
        body('telefono_contacto').optional().trim(),
        body('logo_url').optional().isURL().withMessage('URL de logo inválida'),
        body('historia').optional().trim(),
        body('activo').optional().isBoolean().withMessage('Activo debe ser booleano'),
        body('slug').optional().trim(),
        body('meta_title').optional().trim(),
        body('meta_description').optional().trim(),
        body('meta_keywords').optional().trim(),
        body('orden').optional().isInt({ min: 0 }).withMessage('Orden inválido')
    ]),
    BrandController.updateBrand
);

router.delete(
    '/:id',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    BrandController.deleteBrand
);

router.patch(
    '/:id/status',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido'),
        body('activo').isBoolean().withMessage('Activo es requerido')
    ]),
    BrandController.updateBrandStatus
);

// Estadísticas
router.get(
    '/stats/overview',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    BrandController.getBrandStats
);

router.get(
    '/:id/stats',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    BrandController.getBrandDetailStats
);

// Búsqueda
router.get(
    '/search/suggestions',
    validate([
        body('query').notEmpty().trim().withMessage('Query requerido'),
        body('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Límite inválido')
    ]),
    BrandController.searchBrandSuggestions
);

// Importar/Exportar
router.post(
    '/import/csv',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    BrandController.importBrandsFromCSV
);

router.get(
    '/export/csv',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    BrandController.exportBrandsToCSV
);

export default router;