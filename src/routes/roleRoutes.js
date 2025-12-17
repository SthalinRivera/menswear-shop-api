import { Router } from 'express';
import RoleController from '../controllers/roleController.js';
import { authenticateJWT, checkPermission, checkRole } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validationMiddleware.js';
import { body } from 'express-validator';

const router = Router();

// RUTAS DE ADMINISTRACIÓN DE ROLES
router.get('/',
    authenticateJWT,
    checkPermission('ROLES_VER'),
    RoleController.getRoles
);

router.get('/search',
    authenticateJWT,
    checkPermission('ROLES_VER'),
    RoleController.searchRoles
);

router.get('/stats',
    authenticateJWT,
    checkPermission('ROLES_VER'),
    RoleController.getRoleStats
);

router.get('/permissions',
    authenticateJWT,
    checkPermission('ROLES_VER'),
    RoleController.getAllPermissions
);

router.get('/:id',
    authenticateJWT,
    checkPermission('ROLES_VER'),
    RoleController.getRoleById
);

router.post('/',
    authenticateJWT,
    checkPermission('ROLES_EDITAR'),
    validate([
        body('nombre')
            .notEmpty().withMessage('El nombre del rol es requerido')
            .isLength({ min: 3, max: 100 }).withMessage('El nombre debe tener entre 3 y 100 caracteres'),
        body('nivel')
            .isInt({ min: 1, max: 100 }).withMessage('El nivel debe estar entre 1 y 100'),
        body('tipo')
            .isIn(['Sistema', 'Negocio', 'Personalizado']).withMessage('Tipo de rol inválido')
    ]),
    RoleController.createRole
);

router.put('/:id',
    authenticateJWT,
    checkPermission('ROLES_EDITAR'),
    validate([
        body('nombre')
            .optional()
            .isLength({ min: 3, max: 100 }).withMessage('El nombre debe tener entre 3 y 100 caracteres'),
        body('nivel')
            .optional()
            .isInt({ min: 1, max: 100 }).withMessage('El nivel debe estar entre 1 y 100'),
        body('tipo')
            .optional()
            .isIn(['Sistema', 'Negocio', 'Personalizado']).withMessage('Tipo de rol inválido')
    ]),
    RoleController.updateRole
);

router.delete('/:id',
    authenticateJWT,
    checkPermission('ROLES_EDITAR'),
    RoleController.deleteRole
);

// RUTAS DE PERMISOS DE ROLES
router.post('/:id/permissions',
    authenticateJWT,
    checkPermission('ROLES_PERMISOS'),
    validate([
        body('permiso_id').isInt({ min: 1 }).withMessage('ID de permiso inválido')
    ]),
    RoleController.assignPermission
);

router.delete('/:id/permissions/:permiso_id',
    authenticateJWT,
    checkPermission('ROLES_PERMISOS'),
    RoleController.removePermission
);

// RUTAS DE USUARIOS POR ROL
router.get('/:id/users',
    authenticateJWT,
    checkPermission('ROLES_VER'),
    RoleController.getUsersByRole
);

router.post('/:id/users',
    authenticateJWT,
    checkPermission('ROLES_EDITAR'),
    validate([
        body('usuario_id').isInt({ min: 1 }).withMessage('ID de usuario inválido')
    ]),
    RoleController.assignRoleToUser
);

router.delete('/:id/users/:usuario_id',
    authenticateJWT,
    checkPermission('ROLES_EDITAR'),
    RoleController.removeRoleFromUser
);

export default router;