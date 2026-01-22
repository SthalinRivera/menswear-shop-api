// src/middlewares/authMiddleware.js
import passport from 'passport';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { JWT_SECRET, ERROR_MESSAGES } from '../config/constants.js';

// Middleware para autenticación JWT
export const authenticateJWT = (req, res, next) => {
    passport.authenticate('jwt', { session: false }, (err, user, info) => {
        if (err) return next(err);

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
export const checkPermission = (permisoCodigo) => {
    return async (req, res, next) => {
        try {
            const user = req.user;
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Usuario no autenticado'
                });
            }

            const isSuperAdmin = user.roles.some(role => role.nombre === 'Super Administrador');
            if (isSuperAdmin) return next();

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
export const checkRole = (...roles) => {
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

export const generateTokens = async (user, ip = '127.0.0.1') => {
    console.log("🔎 TOKEN: datos recibidos:", user);

    // Obtener información del empleado si el usuario es empleado
    let empleado_id = null;
    let sucursal_id = null;

    if (user.tipo_usuario === 'Empleado' && user.empleado_id) {
        try {
            const empleadoResult = await query(
                `SELECT e.empleado_id, e.sucursal_id, e.puesto, s.nombre as sucursal_nombre
                 FROM empleados e
                 LEFT JOIN sucursales s ON e.sucursal_id = s.sucursal_id
                 WHERE e.empleado_id = $1`,
                [user.empleado_id]
            );

            if (empleadoResult.rows.length > 0) {
                empleado_id = empleadoResult.rows[0].empleado_id;
                sucursal_id = empleadoResult.rows[0].sucursal_id;
            }
        } catch (error) {
            console.error('Error al obtener datos del empleado:', error);
        }
    }

    const tokenPayload = {
        usuario_id: user.usuario_id,
        email: user.email,
        tipo_usuario: user.tipo_usuario,
        empleado_id: empleado_id,
        sucursal_id: sucursal_id,
        roles: (user.roles || []).map(r => r.nombre)
    };

    console.log("🔎 TOKEN: payload generado:", tokenPayload);

    const accessToken = jwt.sign(
        tokenPayload,
        process.env.JWT_SECRET || JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    const refreshToken = jwt.sign(
        { usuario_id: user.usuario_id },
        process.env.JWT_REFRESH_SECRET || 'refresh_secret',
        { expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d' }
    );

    // Guardar refresh token en la base de datos
    await query(
        'INSERT INTO sesiones (usuario_id, token_sesion, token_refresh, ip_address, fecha_expiracion) VALUES ($1, $2, $3, $4, NOW() + INTERVAL \'7 days\')',
        [user.usuario_id, accessToken, refreshToken, ip]
    );

    return { accessToken, refreshToken };
};