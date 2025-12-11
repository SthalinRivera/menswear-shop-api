import { Router } from 'express';
import UserController from '../controllers/userController.js';
import { authenticateJWT, checkPermission, checkRole } from '../middlewares/authMiddleware.js';
import { validate, validationSchemas } from '../middlewares/validationMiddleware.js';
import { body } from 'express-validator';

const router = Router();

// RUTAS PÚBLICAS
router.get('/test-db', UserController.testDB);
router.post('/verify-email', UserController.verifyEmail);
router.post('/resend-verification', UserController.resendVerificationEmail);

// RUTAS PROTEGIDAS
router.get('/profile',
    authenticateJWT,
    UserController.getMyProfile
);

router.get('/count',
    authenticateJWT,
    checkPermission('USUARIOS_VER'),
    UserController.countUsers
);

// RUTAS DE ADMINISTRACIÓN
router.get('/',
    authenticateJWT,
    checkPermission('USUARIOS_VER'),
    validate(validationSchemas.pagination),
    UserController.getUsers
);

router.get('/search',
    authenticateJWT,
    checkPermission('USUARIOS_VER'),
    UserController.searchUsers
);

router.get('/stats',
    authenticateJWT,
    checkPermission('USUARIOS_VER'),
    UserController.getUserStats
);

router.get('/export',
    authenticateJWT,
    checkRole('Administrador'),
    UserController.exportUsers
);

router.get('/:id',
    authenticateJWT,
    checkPermission('USUARIOS_VER'),
    UserController.getUserById
);

router.post('/',
    authenticateJWT,
    checkPermission('USUARIOS_EDITAR'),
    validate([
        body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
        body('tipo_usuario').isIn(['Cliente', 'Empleado', 'Administrador']).withMessage('Tipo de usuario inválido')
    ]),
    UserController.createUser
);

router.put('/:id',
    authenticateJWT,
    checkPermission('USUARIOS_EDITAR'),
    validate(validationSchemas.updateUser),
    UserController.updateUser
);

router.delete('/:id',
    authenticateJWT,
    checkPermission('USUARIOS_EDITAR'),
    UserController.deleteUser
);

// RUTAS DE ROLES
router.get('/:id/roles',
    authenticateJWT,
    checkPermission('USUARIOS_VER'),
    UserController.getUserRoles
);

router.get('/:id/permissions',
    authenticateJWT,
    checkPermission('USUARIOS_VER'),
    UserController.getUserPermissions
);

router.post('/:id/roles',
    authenticateJWT,
    checkPermission('USUARIOS_EDITAR'),
    validate([
        body('rol_id').isInt({ min: 1 }).withMessage('ID de rol inválido')
    ]),
    UserController.assignRole
);

router.delete('/:id/roles/:rol_id',
    authenticateJWT,
    checkPermission('USUARIOS_EDITAR'),
    UserController.removeRole
);

// RUTAS DE SESIONES
router.get('/:id/sessions',
    authenticateJWT,
    checkPermission('USUARIOS_VER'),
    UserController.getUserSessions
);

router.post('/:id/sessions/close',
    authenticateJWT,
    checkPermission('USUARIOS_EDITAR'),
    UserController.closeUserSessions
);

// RUTAS DE LOGS
router.get('/:id/logs',
    authenticateJWT,
    checkRole('Administrador'),
    UserController.getUserLogs
);

export default router;
