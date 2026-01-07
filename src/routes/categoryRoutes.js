import express from "express";
import { body, param } from "express-validator";
import CategoryController from "../controllers/categoryController.js";
import { authenticateJWT, checkPermission } from "../middlewares/authMiddleware.js";
import { validate, validationSchemas } from "../middlewares/validationMiddleware.js";

const router = express.Router();

// Rutas públicas (solo lectura)
router.get(
    '/',
    validate(validationSchemas.pagination.concat([
        body('include_products').optional().isBoolean().withMessage('Include products debe ser booleano'),
        body('only_active').optional().isBoolean().withMessage('Only active debe ser booleano'),
        body('nivel').optional().isInt({ min: 1, max: 5 }).withMessage('Nivel inválido')
    ])),
    CategoryController.getCategories
);

router.get(
    '/tree',
    CategoryController.getCategoryTree
);

router.get(
    '/:id',
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    CategoryController.getCategoryById
);

router.get(
    '/:id/products',
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    CategoryController.getCategoryProducts
);

router.get(
    '/slug/:slug',
    validate([
        param('slug').notEmpty().withMessage('Slug requerido')
    ]),
    CategoryController.getCategoryBySlug
);

// Rutas protegidas para administradores
router.post(
    '/',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        body('nombre').notEmpty().trim().withMessage('Nombre requerido'),
        body('descripcion').optional().trim(),
        body('categoria_padre_id').optional().isInt({ min: 1 }).withMessage('Categoría padre inválida'),
        body('nivel').optional().isInt({ min: 1, max: 5 }).withMessage('Nivel inválido'),
        body('slug').optional().trim(),
        body('imagen_url').optional().isURL().withMessage('URL de imagen inválida'),
        body('orden').optional().isInt({ min: 0 }).withMessage('Orden inválido'),
        body('activo').optional().isBoolean().withMessage('Activo debe ser booleano'),
        body('meta_title').optional().trim(),
        body('meta_description').optional().trim(),
        body('meta_keywords').optional().trim()
    ]),
    CategoryController.createCategory
);

router.put(
    '/:id',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido'),
        body('nombre').optional().trim(),
        body('descripcion').optional().trim(),
        body('categoria_padre_id').optional().isInt({ min: 1 }).withMessage('Categoría padre inválida'),
        body('slug').optional().trim(),
        body('imagen_url').optional().isURL().withMessage('URL de imagen inválida'),
        body('orden').optional().isInt({ min: 0 }).withMessage('Orden inválido'),
        body('activo').optional().isBoolean().withMessage('Activo debe ser booleano'),
        body('meta_title').optional().trim(),
        body('meta_description').optional().trim(),
        body('meta_keywords').optional().trim()
    ]),
    CategoryController.updateCategory
);

router.delete(
    '/:id',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    CategoryController.deleteCategory
);

router.patch(
    '/:id/status',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido'),
        body('activo').isBoolean().withMessage('Activo es requerido')
    ]),
    CategoryController.updateCategoryStatus
);

router.patch(
    '/:id/orden',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido'),
        body('orden').isInt({ min: 0 }).withMessage('Orden inválido')
    ]),
    CategoryController.updateCategoryOrder
);

// Mover categoría entre padres
router.post(
    '/:id/move',
    authenticateJWT,
    checkPermission('PRODUCTOS_EDITAR'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido'),
        body('nuevo_padre_id').optional().isInt({ min: 0 }).withMessage('Nuevo padre inválido')
    ]),
    CategoryController.moveCategory
);

// Estadísticas
router.get(
    '/stats/overview',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    CategoryController.getCategoryStats
);

router.get(
    '/:id/stats',
    authenticateJWT,
    checkPermission('VENTAS_REPORTES'),
    validate([
        param('id').isInt({ min: 1 }).withMessage('ID inválido')
    ]),
    CategoryController.getCategoryDetailStats
);

// Búsqueda
router.get(
    '/search/suggestions',
    validate([
        body('query').notEmpty().trim().withMessage('Query requerido'),
        body('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Límite inválido')
    ]),
    CategoryController.searchCategorySuggestions
);

export default router;