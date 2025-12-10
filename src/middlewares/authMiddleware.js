const passport = require('passport');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { JWT_SECRET, ERROR_MESSAGES } = require('../config/constants');

// Middleware para autenticación JWT
const authenticateJWT = (req, res, next) => {
    passport.authenticate('jwt', { session: false }, (err, user, info) => {
        if (err) {
            return next(err);
        }

        if (!user) {
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.UNAUTHORIZED,
                error: info?.message || 'Token inválido o expirado'
            });
        }

        req.user = user;
        next();
    })(req, res, next);
};

// Middleware para verificar permisos
const checkPermission = (permisoCodigo) => {
    return async (req, res, next) => {
        try {
            const user = req.user;

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Usuario no autenticado'
                });
            }

            // Verificar si es super admin (tiene todos los permisos)
            const isSuperAdmin = user.roles.some(role => role.nombre === 'Super Administrador');
            if (isSuperAdmin) {
                return next();
            }

            // Verificar permiso específico
            const hasPermission = user.permisos.some(permiso => permiso.codigo === permisoCodigo);

            if (!hasPermission) {
                return res.status(403).json({
                    success: false,
                    message: ERROR_MESSAGES.FORBIDDEN,
                    error: `No tienes permiso para: ${permisoCodigo}`
                });
            }

            next();
        } catch (error) {
            next(error);
        }
    };
};

// Middleware para verificar rol
const checkRole = (...roles) => {
    return (req, res, next) => {
        try {
            const user = req.user;

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Usuario no autenticado'
                });
            }

            const hasRole = user.roles.some(role => roles.includes(role.nombre));

            if (!hasRole) {
                return res.status(403).json({
                    success: false,
                    message: ERROR_MESSAGES.FORBIDDEN,
                    error: `Se requiere uno de los roles: ${roles.join(', ')}`
                });
            }

            next();
        } catch (error) {
            next(error);
        }
    };
};

// Middleware para generar tokens
const generateTokens = async (user) => {
    const tokenPayload = {
        usuario_id: user.usuario_id,
        email: user.email,
        tipo_usuario: user.tipo_usuario,
        roles: user.roles.map(r => r.nombre)
    };

    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET || JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '7d'
    });

    const refreshToken = jwt.sign(
        { usuario_id: user.usuario_id },
        process.env.JWT_REFRESH_SECRET || 'refresh_secret',
        { expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d' }
    );

    // Guardar refresh token en la base de datos
    await query(
        'INSERT INTO sesiones (usuario_id, token_sesion, token_refresh, ip_address, fecha_expiracion) VALUES ($1, $2, $3, $4, NOW() + INTERVAL \'7 days\')',
        [user.usuario_id, accessToken, refreshToken, req.ip || '127.0.0.1']
    );

    return { accessToken, refreshToken };
};

module.exports = {
    authenticateJWT,
    checkPermission,
    checkRole,
    generateTokens
};