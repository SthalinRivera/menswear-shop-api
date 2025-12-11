// src/controllers/authController.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { query, getClient } from '../config/database.js';
import { generateTokens } from '../middlewares/authMiddleware.js';
import { validationSchemas } from '../middlewares/validationMiddleware.js';
import logger from '../utils/logger.js';
import { ERROR_MESSAGES } from '../config/constants.js';

class AuthController {
    // Login tradicional
    static login = async (req, res, next) => {
        try {
            const { email, password } = req.body;
            console.log("🔹 Login iniciado para email:", email);

            const result = await query(
                `SELECT u.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido,
             e.nombre as empleado_nombre, e.apellido as empleado_apellido, e.puesto
             FROM usuarios u
             LEFT JOIN clientes c ON u.cliente_id = c.cliente_id
             LEFT JOIN empleados e ON u.empleado_id = e.empleado_id
             WHERE u.email = $1 AND u.activo = true`,
                [email]
            );

            console.log("🔹 Resultados de usuario:", result.rows);

            if (result.rows.length === 0) {
                console.log("⚠️ Usuario no encontrado o inactivo");
                return res.status(401).json({
                    success: false,
                    message: 'Credenciales inválidas'
                });
            }

            const user = result.rows[0];
            console.log("🔹 Usuario encontrado:", user);

            const isValidPassword = bcrypt.compareSync(password, user.contrasena_hash);
            console.log("🔹 Contraseña válida:", isValidPassword);

            if (!isValidPassword) {
                console.log("⚠️ Contraseña incorrecta, aumentando intentos fallidos");
                await query(
                    'UPDATE usuarios SET intentos_fallidos = intentos_fallidos + 1 WHERE usuario_id = $1',
                    [user.usuario_id]
                );

                return res.status(401).json({
                    success: false,
                    message: 'Credenciales inválidas'
                });
            }

            if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
                console.log("⚠️ Cuenta bloqueada hasta:", user.bloqueado_hasta);
                return res.status(403).json({
                    success: false,
                    message: 'Cuenta bloqueada temporalmente'
                });
            }

            console.log("🔹 Restableciendo intentos fallidos y actualizando fecha de login");
            await query(
                'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, fecha_ultimo_login = NOW() WHERE usuario_id = $1',
                [user.usuario_id]
            );

            const rolesResult = await query(
                `SELECT r.nombre, r.nivel
             FROM usuarios_roles ur
             JOIN roles r ON ur.rol_id = r.rol_id
             WHERE ur.usuario_id = $1 AND ur.activo = true`,
                [user.usuario_id]
            );

            console.log("🔹 Roles encontrados:", rolesResult.rows);
            user.roles = rolesResult.rows;

            console.log("🔹 Generando tokens...");
            const tokens = await generateTokens(user, req.ip);
            console.log("🔹 Tokens generados:", tokens);

            await query(
                `INSERT INTO logs_autenticacion (usuario_id, email_proporcionado, accion, exito, ip_address, user_agent)
             VALUES ($1, $2, 'Login', true, $3, $4)`,
                [user.usuario_id, email, req.ip, req.headers['user-agent']]
            );
            console.log("🔹 Log de autenticación insertado");

            res.json({
                success: true,
                message: 'Login exitoso',
                data: {
                    user: {
                        usuario_id: user.usuario_id,
                        email: user.email,
                        tipo_usuario: user.tipo_usuario,
                        nombre: user.cliente_nombre || user.empleado_nombre,
                        apellido: user.cliente_apellido || user.empleado_apellido,
                        roles: user.roles.map(r => r.nombre)
                    },
                    ...tokens
                }
            });

        } catch (error) {
            console.error("💥 Error en login:", error);
            next(error);
        }
    };

    // Registro de cliente
    static register = async (req, res, next) => {
        try {
            const { email, password, nombre, apellido, telefono, fecha_nacimiento, genero } = req.body;

            // Verificar si el email ya existe
            const existingUser = await query(
                'SELECT usuario_id FROM usuarios WHERE email = $1',
                [email]
            );

            if (existingUser.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'El email ya está registrado'
                });
            }

            // Hash de la contraseña
            const hashedPassword = bcrypt.hashSync(password, 10);

            // Iniciar transacción
            const client = await getClient();

            try {
                await client.query('BEGIN');

                // Crear cliente
                const codigoCliente = 'CLI-' + Date.now().toString().slice(-8);
                const clienteResult = await client.query(
                    `INSERT INTO clientes (codigo_cliente, nombre, apellido, email, telefono, fecha_nacimiento, genero, fecha_registro)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           RETURNING cliente_id`,
                    [codigoCliente, nombre, apellido || '', email, telefono || null, fecha_nacimiento || null, genero || 'M']
                );

                const clienteId = clienteResult.rows[0].cliente_id;

                // Crear usuario
                const usuarioResult = await client.query(
                    `INSERT INTO usuarios (cliente_id, email, contrasena_hash, tipo_usuario, email_verificado, activo)
           VALUES ($1, $2, $3, 'Cliente', false, true)
           RETURNING usuario_id`,
                    [clienteId, email, hashedPassword]
                );

                const usuarioId = usuarioResult.rows[0].usuario_id;

                // Asignar rol de cliente regular
                const rolResult = await client.query(
                    `SELECT rol_id FROM roles WHERE nombre = 'Cliente Regular'`
                );

                if (rolResult.rows.length > 0) {
                    await client.query(
                        `INSERT INTO usuarios_roles (usuario_id, rol_id, activo)
             VALUES ($1, $2, true)`,
                        [usuarioId, rolResult.rows[0].rol_id]
                    );
                }

                // Crear wishlist por defecto
                await client.query(
                    `INSERT INTO wishlists (cliente_id, nombre_lista, es_publica)
           VALUES ($1, 'Favoritos', false)`,
                    [clienteId]
                );

                await client.query('COMMIT');

                // Generar token de verificación
                const verificationToken = jwt.sign(
                    { usuario_id: usuarioId, email },
                    process.env.JWT_SECRET,
                    { expiresIn: '24h' }
                );

                // Enviar email de verificación (implementar después)
                // await sendVerificationEmail(email, verificationToken);

                res.status(201).json({
                    success: true,
                    message: 'Registro exitoso. Por favor verifica tu email.',
                    data: {
                        usuario_id: usuarioId,
                        cliente_id: clienteId,
                        email: email
                    }
                });

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            next(error);
        }
    };

    // Login con Google
    static googleAuth = (req, res, next) => {
        passport.authenticate('google', {
            scope: ['profile', 'email'],
            session: false
        })(req, res, next);
    };

    static googleCallback = (req, res, next) => {
        passport.authenticate('google', { session: false }, async (err, user, info) => {
            if (err || !user) {
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
            }

            try {
                // Generar tokens
                const tokens = await generateTokens(user, req.ip);

                // Redirigir al frontend con tokens
                res.redirect(`${process.env.FRONTEND_URL}/auth/callback?access_token=${tokens.accessToken}&refresh_token=${tokens.refreshToken}`);
            } catch (error) {
                res.redirect(`${process.env.FRONTEND_URL}/login?error=token_generation`);
            }
        })(req, res, next);
    };

    // Refresh token
    static refreshToken = async (req, res, next) => {
        try {
            const { refresh_token } = req.body;

            if (!refresh_token) {
                return res.status(400).json({
                    success: false,
                    message: 'Refresh token requerido'
                });
            }

            // Verificar refresh token
            const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);

            // Verificar si la sesión existe y es válida
            const sessionResult = await query(
                `SELECT s.*, u.* FROM sesiones s
         JOIN usuarios u ON s.usuario_id = u.usuario_id
         WHERE s.token_refresh = $1 AND s.activa = true AND s.fecha_expiracion > NOW()`,
                [refresh_token]
            );

            if (sessionResult.rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: 'Refresh token inválido o expirado'
                });
            }

            const user = sessionResult.rows[0];

            // Obtener roles
            const rolesResult = await query(
                `SELECT r.nombre FROM usuarios_roles ur
         JOIN roles r ON ur.rol_id = r.rol_id
         WHERE ur.usuario_id = $1 AND ur.activo = true`,
                [user.usuario_id]
            );

            user.roles = rolesResult.rows.map(r => r.nombre);

            // Generar nuevo access token
            const newAccessToken = jwt.sign(
                {
                    usuario_id: user.usuario_id,
                    email: user.email,
                    tipo_usuario: user.tipo_usuario,
                    roles: user.roles
                },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRE }
            );

            // Actualizar sesión
            await query(
                `UPDATE sesiones 
         SET token_sesion = $1, fecha_ultima_actividad = NOW()
         WHERE token_refresh = $2`,
                [newAccessToken, refresh_token]
            );

            res.json({
                success: true,
                message: 'Token refrescado',
                data: {
                    access_token: newAccessToken,
                    refresh_token: refresh_token,
                    expires_in: 7 * 24 * 60 * 60 // 7 días en segundos
                }
            });

        } catch (error) {
            if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    message: 'Refresh token inválido o expirado'
                });
            }
            next(error);
        }
    };

    // Logout
    static logout = async (req, res, next) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];

            if (token) {
                // Invalidar sesión
                await query(
                    `UPDATE sesiones 
           SET activa = false, motivo_cierre = 'Logout manual'
           WHERE token_sesion = $1`,
                    [token]
                );
            }

            res.json({
                success: true,
                message: 'Sesión cerrada exitosamente'
            });

        } catch (error) {
            next(error);
        }
    };

    // Perfil del usuario actual
    static getProfile = async (req, res, next) => {
        try {
            const user = req.user;

            // Obtener información adicional según tipo de usuario
            let additionalInfo = {};

            if (user.cliente_id) {
                const clienteResult = await query(
                    `SELECT c.*, 
                  (SELECT COUNT(*) FROM ventas WHERE cliente_id = c.cliente_id AND estado_venta = 'Pagada') as total_compras_count,
                  (SELECT SUM(total) FROM ventas WHERE cliente_id = c.cliente_id AND estado_venta = 'Pagada') as total_gastado
           FROM clientes c
           WHERE c.cliente_id = $1`,
                    [user.cliente_id]
                );
                additionalInfo = clienteResult.rows[0];
            } else if (user.empleado_id) {
                const empleadoResult = await query(
                    `SELECT e.*, s.nombre as sucursal_nombre
           FROM empleados e
           LEFT JOIN sucursales s ON e.sucursal_id = s.sucursal_id
           WHERE e.empleado_id = $1`,
                    [user.empleado_id]
                );
                additionalInfo = empleadoResult.rows[0];
            }

            res.json({
                success: true,
                data: {
                    usuario: {
                        usuario_id: user.usuario_id,
                        email: user.email,
                        tipo_usuario: user.tipo_usuario,
                        email_verificado: user.email_verificado,
                        provider: user.provider,
                        fecha_creacion: user.fecha_creacion
                    },
                    perfil: additionalInfo,
                    roles: user.roles
                }
            });

        } catch (error) {
            next(error);
        }
    };

    // Cambiar contraseña
    static changePassword = async (req, res, next) => {
        try {
            const { current_password, new_password } = req.body;
            const user = req.user;

            // Verificar contraseña actual
            const userResult = await query(
                'SELECT contrasena_hash FROM usuarios WHERE usuario_id = $1',
                [user.usuario_id]
            );

            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuario no encontrado'
                });
            }

            const isValid = bcrypt.compareSync(current_password, userResult.rows[0].contrasena_hash);
            if (!isValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Contraseña actual incorrecta'
                });
            }

            // Hash nueva contraseña
            const newHashedPassword = bcrypt.hashSync(new_password, 10);

            // Actualizar contraseña
            await query(
                `UPDATE usuarios 
         SET contrasena_hash = $1, ultimo_cambio_contrasena = NOW(), intentos_fallidos = 0
         WHERE usuario_id = $2`,
                [newHashedPassword, user.usuario_id]
            );

            // Registrar en historial
            await query(
                `INSERT INTO historial_contrasenas (usuario_id, contrasena_hash, ip_address)
         VALUES ($1, $2, $3)`,
                [user.usuario_id, newHashedPassword, req.ip]
            );

            // Invalidar todas las sesiones excepto la actual
            const token = req.headers.authorization?.split(' ')[1];
            await query(
                `UPDATE sesiones 
         SET activa = false, motivo_cierre = 'Cambio de contraseña'
         WHERE usuario_id = $1 AND token_sesion != $2`,
                [user.usuario_id, token]
            );

            res.json({
                success: true,
                message: 'Contraseña cambiada exitosamente'
            });

        } catch (error) {
            next(error);
        }
    };

    // Solicitar reset de contraseña
    static requestPasswordReset = async (req, res, next) => {
        try {
            const { email } = req.body;

            const userResult = await query(
                'SELECT usuario_id, email FROM usuarios WHERE email = $1 AND activo = true',
                [email]
            );

            if (userResult.rows.length === 0) {
                // Por seguridad, no revelar si el email existe o no
                return res.json({
                    success: true,
                    message: 'Si el email existe, recibirás instrucciones para resetear tu contraseña'
                });
            }

            const user = userResult.rows[0];
            const resetToken = jwt.sign(
                { usuario_id: user.usuario_id, email: user.email },
                process.env.JWT_SECRET + user.contrasena_hash, // Usar hash actual como parte del secreto
                { expiresIn: '1h' }
            );

            // Guardar token en la base de datos
            await query(
                `UPDATE usuarios 
         SET reset_token = $1, reset_expira = NOW() + INTERVAL '1 hour'
         WHERE usuario_id = $2`,
                [resetToken, user.usuario_id]
            );

            // Enviar email con link de reset (implementar después)
            // await sendPasswordResetEmail(user.email, resetToken);

            res.json({
                success: true,
                message: 'Si el email existe, recibirás instrucciones para resetear tu contraseña'
            });

        } catch (error) {
            next(error);
        }
    };

    // Resetear contraseña con token
    static resetPassword = async (req, res, next) => {
        try {
            const { token, new_password } = req.body;

            // Buscar usuario con token válido
            const userResult = await query(
                `SELECT usuario_id, contrasena_hash FROM usuarios 
         WHERE reset_token = $1 AND reset_expira > NOW()`,
                [token]
            );

            if (userResult.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Token inválido o expirado'
                });
            }

            const user = userResult.rows[0];
            const newHashedPassword = bcrypt.hashSync(new_password, 10);

            // Actualizar contraseña y limpiar token
            await query(
                `UPDATE usuarios 
         SET contrasena_hash = $1, 
             reset_token = NULL, 
             reset_expira = NULL,
             ultimo_cambio_contrasena = NOW(),
             intentos_fallidos = 0
         WHERE usuario_id = $2`,
                [newHashedPassword, user.usuario_id]
            );

            // Registrar en historial
            await query(
                `INSERT INTO historial_contrasenas (usuario_id, contrasena_hash, ip_address)
         VALUES ($1, $2, $3)`,
                [user.usuario_id, newHashedPassword, req.ip]
            );

            // Invalidar todas las sesiones
            await query(
                `UPDATE sesiones 
         SET activa = false, motivo_cierre = 'Reset de contraseña'
         WHERE usuario_id = $1`,
                [user.usuario_id]
            );

            res.json({
                success: true,
                message: 'Contraseña restablecida exitosamente'
            });

        } catch (error) {
            next(error);
        }
    };
}

export default AuthController;