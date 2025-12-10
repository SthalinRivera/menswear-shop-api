const express = require('express');
const { body } = require('express-validator');

const router = express.Router();
const AuthController = require('../controllers/authController');
const { validate, validationSchemas } = require('../middlewares/validationMiddleware');
const { authenticateJWT } = require('../middlewares/authMiddleware');

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

module.exports = router;