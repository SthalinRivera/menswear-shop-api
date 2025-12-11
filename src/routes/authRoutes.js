// src/routes/authRoutes.js
import express from 'express';
import { body } from 'express-validator';
import AuthController from '../controllers/authController.js';
import { validate, validationSchemas } from '../middlewares/validationMiddleware.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Rutas públicas
router.post('/login',
    validate(validationSchemas.login),
    AuthController.login
);

router.post('/register',
    validate(validationSchemas.register),
    AuthController.register
);

router.post('/refresh-token',
    AuthController.refreshToken
);

router.post('/request-password-reset',
    AuthController.requestPasswordReset
);

router.post('/reset-password',
    AuthController.resetPassword
);

// OAuth Google
router.get('/google',
    AuthController.googleAuth
);

router.get('/google/callback',
    AuthController.googleCallback
);

// Rutas protegidas
router.get('/profile',
    authenticateJWT,
    AuthController.getProfile
);

router.put('/change-password',
    authenticateJWT,
    validate([
        body('current_password').notEmpty().withMessage('Contraseña actual requerida'),
        body('new_password').isLength({ min: 8 }).withMessage('La nueva contraseña debe tener al menos 8 caracteres')
    ]),
    AuthController.changePassword
);

router.post('/logout',
    authenticateJWT,
    AuthController.logout
);

export default router;
