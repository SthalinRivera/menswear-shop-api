// const bcrypt = require('bcryptjs');
// const jwt = require('jsonwebtoken');
// const { query, getClient } = require('../config/database');
// const { validationSchemas } = require('../middlewares/validationMiddleware');
// const { asyncHandler } = require('../middlewares/errorMiddleware');
// const { PAGINATION, ERROR_MESSAGES } = require('../config/constants');
// const logger = require('../utils/logger');
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, getClient } from '../config/database.js';
import { validationSchemas } from '../middlewares/validationMiddleware.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { PAGINATION, ERROR_MESSAGES } from '../config/constants.js';
import logger from '../utils/logger.js';
class UserController {
    // =============================================
    // 1. OBTENER TODOS LOS USUARIOS (ADMIN)
    // =============================================
    static getUsers = asyncHandler(async (req, res) => {
        const {
            page = 1,
            limit = PAGINATION.DEFAULT_LIMIT,
            q = '',
            tipo_usuario,
            activo,
            sortBy = 'fecha_creacion',
            sortOrder = 'desc'
        } = req.query;

        const offset = (page - 1) * limit;

        let queryStr = `
      SELECT 
        u.usuario_id,
        u.email,
        u.tipo_usuario,
        u.provider,
        u.email_verificado,
        u.activo,
        u.fecha_creacion,
        u.fecha_ultimo_login,
        u.cliente_id,
        u.empleado_id,
        c.nombre as cliente_nombre,
        c.apellido as cliente_apellido,
        c.telefono as cliente_telefono,
        e.nombre as empleado_nombre,
        e.apellido as empleado_apellido,
        e.puesto as empleado_puesto,
        s.nombre as sucursal_nombre,
        STRING_AGG(DISTINCT r.nombre, ', ') as roles
      FROM usuarios u
      LEFT JOIN clientes c ON u.cliente_id = c.cliente_id
      LEFT JOIN empleados e ON u.empleado_id = e.empleado_id
      LEFT JOIN sucursales s ON e.sucursal_id = s.sucursal_id
      LEFT JOIN usuarios_roles ur ON u.usuario_id = ur.usuario_id AND ur.activo = true
      LEFT JOIN roles r ON ur.rol_id = r.rol_id
      WHERE 1=1
    `;

        const params = [];
        let paramCount = 0;

        // Aplicar filtros
        if (q) {
            paramCount++;
            queryStr += ` AND (
        u.email ILIKE $${paramCount} OR 
        c.nombre ILIKE $${paramCount} OR 
        c.apellido ILIKE $${paramCount} OR
        e.nombre ILIKE $${paramCount} OR 
        e.apellido ILIKE $${paramCount}
      )`;
            params.push(`%${q}%`);
        }

        if (tipo_usuario) {
            paramCount++;
            queryStr += ` AND u.tipo_usuario = $${paramCount}`;
            params.push(tipo_usuario);
        }

        if (activo !== undefined) {
            paramCount++;
            queryStr += ` AND u.activo = $${paramCount}`;
            params.push(activo === 'true');
        }

        // Agrupar
        queryStr += ` GROUP BY 
      u.usuario_id, u.email, u.tipo_usuario, u.provider, u.email_verificado, 
      u.activo, u.fecha_creacion, u.fecha_ultimo_login, u.cliente_id, u.empleado_id,
      c.nombre, c.apellido, c.telefono, e.nombre, e.apellido, e.puesto, s.nombre
    `;

        // Ordenar
        const validSortColumns = ['email', 'tipo_usuario', 'fecha_creacion', 'fecha_ultimo_login'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'fecha_creacion';
        const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

        queryStr += ` ORDER BY u.${sortColumn} ${order}`;

        // Paginación
        paramCount++;
        queryStr += ` LIMIT $${paramCount}`;
        params.push(limit);

        paramCount++;
        queryStr += ` OFFSET $${paramCount}`;
        params.push(offset);

        // Ejecutar query
        const result = await query(queryStr, params);

        // Contar total
        const countQuery = queryStr
            .replace(/SELECT.*?FROM/s, 'SELECT COUNT(DISTINCT u.usuario_id) FROM')
            .replace(/GROUP BY.*/, '')
            .replace(/ORDER BY.*/, '')
            .replace(/LIMIT \$\d+ OFFSET \$\d+/, '');

        const countResult = await query(countQuery, params.slice(0, -2));
        const total = parseInt(countResult.rows[0]?.count || 0);

        // Estadísticas adicionales
        const statsQuery = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN tipo_usuario = 'Empleado' THEN 1 END) as empleados,
        COUNT(CASE WHEN tipo_usuario = 'Cliente' THEN 1 END) as clientes,
        COUNT(CASE WHEN activo = true THEN 1 END) as activos,
        COUNT(CASE WHEN email_verificado = true THEN 1 END) as verificados
      FROM usuarios
    `);

        const stats = statsQuery.rows[0];

        res.json({
            success: true,
            data: result.rows,
            meta: {
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                stats
            }
        });
    });

    // =============================================
    // 2. OBTENER USUARIO POR ID
    // =============================================
    static getUserById = asyncHandler(async (req, res) => {
        const { id } = req.params;

        const result = await query(
            `SELECT 
        u.*,
        c.*,
        e.*,
        s.nombre as sucursal_nombre,
        STRING_AGG(DISTINCT r.nombre, ', ') as roles_nombres,
        json_agg(
          DISTINCT jsonb_build_object(
            'rol_id', r.rol_id,
            'nombre', r.nombre,
            'nivel', r.nivel
          )
        ) as roles_detalle
       FROM usuarios u
       LEFT JOIN clientes c ON u.cliente_id = c.cliente_id
       LEFT JOIN empleados e ON u.empleado_id = e.empleado_id
       LEFT JOIN sucursales s ON e.sucursal_id = s.sucursal_id
       LEFT JOIN usuarios_roles ur ON u.usuario_id = ur.usuario_id AND ur.activo = true
       LEFT JOIN roles r ON ur.rol_id = r.rol_id
       WHERE u.usuario_id = $1
       GROUP BY 
         u.usuario_id, u.email, u.tipo_usuario, u.provider, u.email_verificado, 
         u.activo, u.fecha_creacion, u.fecha_ultimo_login, u.cliente_id, u.empleado_id,
         c.cliente_id, e.empleado_id, s.nombre`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.NOT_FOUND,
                error: 'Usuario no encontrado'
            });
        }

        const user = result.rows[0];

        // Obtener permisos del usuario
        const permisosResult = await query(
            `SELECT DISTINCT p.*
       FROM usuarios_roles ur
       JOIN roles_permisos rp ON ur.rol_id = rp.rol_id
       JOIN permisos p ON rp.permiso_id = p.permiso_id
       WHERE ur.usuario_id = $1 
         AND ur.activo = true 
         AND rp.concedido = true
       ORDER BY p.modulo, p.nivel`,
            [id]
        );

        user.permisos = permisosResult.rows;

        // Obtener sesiones activas
        const sesionesResult = await query(
            `SELECT sesion_id, dispositivo, fecha_inicio, fecha_ultima_actividad
       FROM sesiones
       WHERE usuario_id = $1 AND activa = true AND fecha_expiracion > NOW()
       ORDER BY fecha_ultima_actividad DESC`,
            [id]
        );

        user.sesiones_activas = sesionesResult.rows;

        // Si es cliente, obtener información adicional
        if (user.cliente_id) {
            const clienteInfo = await query(
                `SELECT 
           c.*,
           (SELECT COUNT(*) FROM ventas WHERE cliente_id = c.cliente_id AND estado_venta = 'Pagada') as total_compras_count,
           (SELECT SUM(total) FROM ventas WHERE cliente_id = c.cliente_id AND estado_venta = 'Pagada') as total_gastado,
           (SELECT COUNT(*) FROM wishlists WHERE cliente_id = c.cliente_id) as wishlists_count,
           (SELECT MAX(fecha_venta) FROM ventas WHERE cliente_id = c.cliente_id) as ultima_compra
         FROM clientes c
         WHERE c.cliente_id = $1`,
                [user.cliente_id]
            );

            user.cliente_info = clienteInfo.rows[0];
        }

        // Si es empleado, obtener información adicional
        if (user.empleado_id) {
            const empleadoInfo = await query(
                `SELECT 
           e.*,
           (SELECT COUNT(*) FROM ventas WHERE empleado_id = e.empleado_id AND estado_venta = 'Pagada') as ventas_realizadas,
           (SELECT SUM(total) FROM ventas WHERE empleado_id = e.empleado_id AND estado_venta = 'Pagada') as ventas_total,
           (SELECT AVG(total) FROM ventas WHERE empleado_id = e.empleado_id AND estado_venta = 'Pagada') as ventas_promedio
         FROM empleados e
         WHERE e.empleado_id = $1`,
                [user.empleado_id]
            );

            user.empleado_info = empleadoInfo.rows[0];
        }

        res.json({
            success: true,
            data: user
        });
    });

    // =============================================
    // 3. CREAR USUARIO (ADMIN)
    // =============================================
    static createUser = asyncHandler(async (req, res) => {
        const {
            email,
            tipo_usuario = 'Cliente',
            cliente_id,
            empleado_id,
            roles = [],
            activo = true,
            email_verificado = false
        } = req.body;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Validar email único
            const emailCheck = await client.query(
                'SELECT usuario_id FROM usuarios WHERE email = $1',
                [email]
            );

            if (emailCheck.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'El email ya está registrado'
                });
            }

            // Validar relaciones
            if (cliente_id) {
                const clienteCheck = await client.query(
                    'SELECT cliente_id FROM clientes WHERE cliente_id = $1',
                    [cliente_id]
                );
                if (clienteCheck.rows.length === 0) {
                    throw new Error('Cliente no encontrado');
                }
            }

            if (empleado_id) {
                const empleadoCheck = await client.query(
                    'SELECT empleado_id FROM empleados WHERE empleado_id = $1',
                    [empleado_id]
                );
                if (empleadoCheck.rows.length === 0) {
                    throw new Error('Empleado no encontrado');
                }
            }

            // Insertar usuario
            const userResult = await client.query(
                `INSERT INTO usuarios (
          email, tipo_usuario, cliente_id, empleado_id,
          activo, email_verificado
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
                [email, tipo_usuario, cliente_id || null, empleado_id || null, activo, email_verificado]
            );

            const newUser = userResult.rows[0];

            // Asignar roles
            if (roles && roles.length > 0) {
                for (const rolNombre of roles) {
                    const rolResult = await client.query(
                        'SELECT rol_id FROM roles WHERE nombre = $1',
                        [rolNombre]
                    );

                    if (rolResult.rows.length > 0) {
                        await client.query(
                            `INSERT INTO usuarios_roles (usuario_id, rol_id, activo, asignado_por)
               VALUES ($1, $2, true, $3)`,
                            [newUser.usuario_id, rolResult.rows[0].rol_id, req.user.usuario_id]
                        );
                    }
                }
            }

            await client.query('COMMIT');

            // Registrar auditoría
            await query(
                `INSERT INTO auditorias (
          tabla_afectada, accion, id_registro,
          datos_nuevos, realizado_por, ip_address
        ) VALUES (
          'usuarios', 'INSERT', $1,
          $2, $3, $4
        )`,
                [
                    newUser.usuario_id,
                    JSON.stringify({
                        email: newUser.email,
                        tipo_usuario: newUser.tipo_usuario,
                        creado_por: req.user.usuario_id
                    }),
                    req.user.usuario_id,
                    req.ip
                ]
            );

            logger.info(`Usuario creado: ${newUser.email} por ${req.user.email}`);

            res.status(201).json({
                success: true,
                message: 'Usuario creado exitosamente',
                data: newUser
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // =============================================
    // 4. ACTUALIZAR USUARIO
    // =============================================
    static updateUser = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const updateData = req.body;
        const currentUser = req.user;

        // Verificar permisos (solo admin o el propio usuario)
        if (currentUser.tipo_usuario !== 'Administrador' && currentUser.usuario_id != id) {
            return res.status(403).json({
                success: false,
                message: ERROR_MESSAGES.FORBIDDEN,
                error: 'No tienes permiso para actualizar este usuario'
            });
        }

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Verificar si el usuario existe
            const userCheck = await client.query(
                'SELECT * FROM usuarios WHERE usuario_id = $1',
                [id]
            );

            if (userCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: ERROR_MESSAGES.NOT_FOUND
                });
            }

            const oldUser = userCheck.rows[0];

            // Campos que se pueden actualizar
            const allowedFields = ['email', 'activo', 'email_verificado', 'tipo_usuario'];
            const updates = {};

            Object.keys(updateData).forEach(key => {
                if (allowedFields.includes(key)) {
                    updates[key] = updateData[key];
                }
            });

            // Validar email único si se cambia
            if (updates.email && updates.email !== oldUser.email) {
                const emailCheck = await client.query(
                    'SELECT usuario_id FROM usuarios WHERE email = $1',
                    [updates.email]
                );

                if (emailCheck.rows.length > 0) {
                    return res.status(409).json({
                        success: false,
                        message: 'El email ya está en uso por otro usuario'
                    });
                }
            }

            // Construir query de actualización
            const fields = [];
            const values = [];
            let paramCount = 1;

            Object.keys(updates).forEach(key => {
                fields.push(`${key} = $${paramCount}`);
                values.push(updates[key]);
                paramCount++;
            });

            if (fields.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No hay datos válidos para actualizar'
                });
            }

            values.push(id);
            const queryStr = `
        UPDATE usuarios 
        SET ${fields.join(', ')}, fecha_actualizacion = NOW()
        WHERE usuario_id = $${paramCount}
        RETURNING *
      `;

            const result = await client.query(queryStr, values);
            const updatedUser = result.rows[0];

            // Actualizar roles si se proporcionan
            if (updateData.roles && currentUser.tipo_usuario === 'Administrador') {
                // Desactivar roles actuales
                await client.query(
                    'UPDATE usuarios_roles SET activo = false WHERE usuario_id = $1',
                    [id]
                );

                // Asignar nuevos roles
                for (const rolNombre of updateData.roles) {
                    const rolResult = await client.query(
                        'SELECT rol_id FROM roles WHERE nombre = $1',
                        [rolNombre]
                    );

                    if (rolResult.rows.length > 0) {
                        await client.query(
                            `INSERT INTO usuarios_roles (usuario_id, rol_id, activo, asignado_por)
               VALUES ($1, $2, true, $3)
               ON CONFLICT (usuario_id, rol_id) 
               DO UPDATE SET activo = true, fecha_actualizacion = NOW()`,
                            [id, rolResult.rows[0].rol_id, currentUser.usuario_id]
                        );
                    }
                }
            }

            await client.query('COMMIT');

            // Registrar auditoría
            await query(
                `INSERT INTO auditorias (
          tabla_afectada, accion, id_registro,
          datos_anteriores, datos_nuevos,
          realizado_por, ip_address
        ) VALUES (
          'usuarios', 'UPDATE', $1,
          $2, $3, $4, $5
        )`,
                [
                    id,
                    JSON.stringify(oldUser),
                    JSON.stringify(updatedUser),
                    currentUser.usuario_id,
                    req.ip
                ]
            );

            logger.info(`Usuario actualizado: ${updatedUser.email} por ${currentUser.email}`);

            res.json({
                success: true,
                message: 'Usuario actualizado exitosamente',
                data: updatedUser
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // =============================================
    // 5. ELIMINAR/DESACTIVAR USUARIO
    // =============================================
    static deleteUser = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { hardDelete = false } = req.query;
        const currentUser = req.user;

        // No permitir auto-eliminación
        if (currentUser.usuario_id == id) {
            return res.status(400).json({
                success: false,
                message: 'No puedes eliminar tu propia cuenta'
            });
        }

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Verificar si el usuario existe
            const userCheck = await client.query(
                'SELECT * FROM usuarios WHERE usuario_id = $1',
                [id]
            );

            if (userCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: ERROR_MESSAGES.NOT_FOUND
                });
            }

            const userToDelete = userCheck.rows[0];

            // Verificar si es el último administrador
            if (userToDelete.tipo_usuario === 'Administrador') {
                const adminCount = await client.query(
                    "SELECT COUNT(*) FROM usuarios WHERE tipo_usuario = 'Administrador' AND activo = true"
                );

                if (parseInt(adminCount.rows[0].count) <= 1) {
                    return res.status(400).json({
                        success: false,
                        message: 'No se puede eliminar el último administrador activo'
                    });
                }
            }

            if (hardDelete === 'true' && currentUser.tipo_usuario === 'Administrador') {
                // Hard delete (eliminación permanente)

                // 1. Eliminar sesiones
                await client.query('DELETE FROM sesiones WHERE usuario_id = $1', [id]);

                // 2. Eliminar roles asignados
                await client.query('DELETE FROM usuarios_roles WHERE usuario_id = $1', [id]);

                // 3. Eliminar logs de autenticación
                await client.query('DELETE FROM logs_autenticacion WHERE usuario_id = $1', [id]);

                // 4. Eliminar usuario
                await client.query('DELETE FROM usuarios WHERE usuario_id = $1', [id]);

                logger.warn(`Usuario eliminado permanentemente: ${userToDelete.email} por ${currentUser.email}`);

            } else {
                // Soft delete (desactivación)
                await client.query(
                    'UPDATE usuarios SET activo = false, fecha_actualizacion = NOW() WHERE usuario_id = $1',
                    [id]
                );

                // Invalidar todas las sesiones
                await client.query(
                    `UPDATE sesiones 
           SET activa = false, motivo_cierre = 'Cuenta desactivada'
           WHERE usuario_id = $1`,
                    [id]
                );

                logger.info(`Usuario desactivado: ${userToDelete.email} por ${currentUser.email}`);
            }

            await client.query('COMMIT');

            // Registrar auditoría
            await query(
                `INSERT INTO auditorias (
          tabla_afectada, accion, id_registro,
          datos_anteriores, realizado_por, ip_address
        ) VALUES (
          'usuarios', ${hardDelete === 'true' ? "'DELETE'" : "'UPDATE'"}, $1,
          $2, $3, $4
        )`,
                [
                    id,
                    JSON.stringify(userToDelete),
                    currentUser.usuario_id,
                    req.ip
                ]
            );

            res.json({
                success: true,
                message: hardDelete === 'true'
                    ? 'Usuario eliminado permanentemente'
                    : 'Usuario desactivado exitosamente'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // =============================================
    // 6. ASIGNAR ROL A USUARIO
    // =============================================
    static assignRole = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { rol_id, activo = true, fecha_expiracion } = req.body;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Verificar si el usuario existe
            const userCheck = await client.query(
                'SELECT usuario_id FROM usuarios WHERE usuario_id = $1',
                [id]
            );

            if (userCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuario no encontrado'
                });
            }

            // Verificar si el rol existe
            const roleCheck = await client.query(
                'SELECT rol_id FROM roles WHERE rol_id = $1',
                [rol_id]
            );

            if (roleCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Rol no encontrado'
                });
            }

            // Verificar si ya tiene el rol asignado
            const existingRole = await client.query(
                'SELECT usuario_rol_id FROM usuarios_roles WHERE usuario_id = $1 AND rol_id = $2',
                [id, rol_id]
            );

            let result;
            if (existingRole.rows.length > 0) {
                // Actualizar asignación existente
                result = await client.query(
                    `UPDATE usuarios_roles 
           SET activo = $1, fecha_expiracion = $2, fecha_actualizacion = NOW()
           WHERE usuario_id = $3 AND rol_id = $4
           RETURNING *`,
                    [activo, fecha_expiracion || null, id, rol_id]
                );
            } else {
                // Crear nueva asignación
                result = await client.query(
                    `INSERT INTO usuarios_roles (
            usuario_id, rol_id, activo, fecha_expiracion, asignado_por
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING *`,
                    [id, rol_id, activo, fecha_expiracion || null, req.user.usuario_id]
                );
            }

            await client.query('COMMIT');

            // Obtener información completa del rol
            const roleInfo = await query(
                `SELECT r.*, 
                (SELECT COUNT(*) FROM usuarios_roles ur2 WHERE ur2.rol_id = r.rol_id AND ur2.activo = true) as total_usuarios
         FROM roles r
         WHERE r.rol_id = $1`,
                [rol_id]
            );

            res.json({
                success: true,
                message: 'Rol asignado exitosamente',
                data: {
                    asignacion: result.rows[0],
                    rol: roleInfo.rows[0]
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // =============================================
    // 7. REMOVER ROL DE USUARIO
    // =============================================
    static removeRole = asyncHandler(async (req, res) => {
        const { id, rol_id } = req.params;

        // Verificar si la asignación existe
        const assignmentCheck = await query(
            'SELECT * FROM usuarios_roles WHERE usuario_id = $1 AND rol_id = $2',
            [id, rol_id]
        );

        if (assignmentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'El usuario no tiene este rol asignado'
            });
        }

        // Desactivar la asignación
        await query(
            'UPDATE usuarios_roles SET activo = false, fecha_actualizacion = NOW() WHERE usuario_id = $1 AND rol_id = $2',
            [id, rol_id]
        );

        res.json({
            success: true,
            message: 'Rol removido exitosamente'
        });
    });

    // =============================================
    // 8. OBTENER ROLES DE USUARIO
    // =============================================
    static getUserRoles = asyncHandler(async (req, res) => {
        const { id } = req.params;

        const result = await query(
            `SELECT 
         r.*,
         ur.activo as rol_activo,
         ur.fecha_asignacion,
         ur.fecha_expiracion,
         ua.email as asignado_por_email
       FROM usuarios_roles ur
       JOIN roles r ON ur.rol_id = r.rol_id
       LEFT JOIN usuarios ua ON ur.asignado_por = ua.usuario_id
       WHERE ur.usuario_id = $1
       ORDER BY r.nivel DESC, r.nombre`,
            [id]
        );

        res.json({
            success: true,
            data: result.rows
        });
    });

    // =============================================
    // 9. OBTENER PERMISOS DE USUARIO
    // =============================================
    static getUserPermissions = asyncHandler(async (req, res) => {
        const { id } = req.params;

        const result = await query(
            `SELECT DISTINCT 
         p.*,
         r.nombre as rol_origen,
         r.nivel as rol_nivel
       FROM usuarios_roles ur
       JOIN roles_permisos rp ON ur.rol_id = rp.rol_id
       JOIN permisos p ON rp.permiso_id = p.permiso_id
       JOIN roles r ON ur.rol_id = r.rol_id
       WHERE ur.usuario_id = $1 
         AND ur.activo = true 
         AND rp.concedido = true
       ORDER BY p.modulo, p.nivel, p.nombre`,
            [id]
        );

        // Agrupar por módulo
        const permisosPorModulo = {};
        result.rows.forEach(permiso => {
            if (!permisosPorModulo[permiso.modulo]) {
                permisosPorModulo[permiso.modulo] = [];
            }
            permisosPorModulo[permiso.modulo].push(permiso);
        });

        res.json({
            success: true,
            data: {
                total: result.rows.length,
                por_modulo: permisosPorModulo
            }
        });
    });

    // =============================================
    // 10. OBTENER SESIONES DE USUARIO
    // =============================================
    static getUserSessions = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { activas = 'true' } = req.query;

        let queryStr = `
      SELECT *
      FROM sesiones
      WHERE usuario_id = $1
    `;

        const params = [id];

        if (activas === 'true') {
            queryStr += ` AND activa = true AND fecha_expiracion > NOW()`;
        } else if (activas === 'false') {
            queryStr += ` AND (activa = false OR fecha_expiracion <= NOW())`;
        }

        queryStr += ` ORDER BY fecha_inicio DESC LIMIT 50`;

        const result = await query(queryStr, params);

        res.json({
            success: true,
            data: result.rows
        });
    });

    // =============================================
    // 11. CERRAR SESIONES DE USUARIO
    // =============================================
    static closeUserSessions = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { except_current = 'false' } = req.body;
        const currentToken = req.headers.authorization?.split(' ')[1];

        let queryStr = `
      UPDATE sesiones 
      SET activa = false, motivo_cierre = 'Cerrado por administrador'
      WHERE usuario_id = $1
    `;

        const params = [id];

        if (except_current === 'true' && currentToken) {
            queryStr += ` AND token_sesion != $2`;
            params.push(currentToken);
        }

        const result = await query(queryStr, params);

        res.json({
            success: true,
            message: `Se cerraron ${result.rowCount} sesiones`
        });
    });

    // =============================================
    // 12. OBTENER LOGS DE USUARIO
    // =============================================
    static getUserLogs = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const {
            limit = 50,
            startDate,
            endDate,
            accion
        } = req.query;

        let queryStr = `
      SELECT *
      FROM logs_autenticacion
      WHERE usuario_id = $1
    `;

        const params = [id];
        let paramCount = 1;

        if (startDate) {
            paramCount++;
            queryStr += ` AND fecha_log >= $${paramCount}`;
            params.push(startDate);
        }

        if (endDate) {
            paramCount++;
            queryStr += ` AND fecha_log <= $${paramCount}`;
            params.push(endDate);
        }

        if (accion) {
            paramCount++;
            queryStr += ` AND accion = $${paramCount}`;
            params.push(accion);
        }

        queryStr += ` ORDER BY fecha_log DESC LIMIT $${paramCount + 1}`;
        params.push(limit);

        const result = await query(queryStr, params);

        // Estadísticas de logs
        const statsQuery = await query(
            `SELECT 
         COUNT(*) as total,
         COUNT(CASE WHEN exito = true THEN 1 END) as exitosos,
         COUNT(CASE WHEN exito = false THEN 1 END) as fallidos,
         COUNT(CASE WHEN accion = 'Login' THEN 1 END) as logins,
         COUNT(CASE WHEN accion = 'Login_Fallido' THEN 1 END) as logins_fallidos,
         MAX(fecha_log) as ultimo_log
       FROM logs_autenticacion
       WHERE usuario_id = $1`,
            [id]
        );

        res.json({
            success: true,
            data: result.rows,
            stats: statsQuery.rows[0]
        });
    });

    // =============================================
    // 13. BUSCAR USUARIOS
    // =============================================
    static searchUsers = asyncHandler(async (req, res) => {
        const { q, limit = 10 } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Término de búsqueda demasiado corto (mínimo 2 caracteres)'
            });
        }

        const result = await query(
            `SELECT 
         u.usuario_id,
         u.email,
         u.tipo_usuario,
         c.nombre as cliente_nombre,
         c.apellido as cliente_apellido,
         e.nombre as empleado_nombre,
         e.apellido as empleado_apellido,
         e.puesto,
         s.nombre as sucursal_nombre,
         CASE 
           WHEN c.nombre ILIKE $1 OR c.apellido ILIKE $1 THEN 3
           WHEN e.nombre ILIKE $1 OR e.apellido ILIKE $1 THEN 2
           WHEN u.email ILIKE $1 THEN 1
           ELSE 0
         END as relevancia
       FROM usuarios u
       LEFT JOIN clientes c ON u.cliente_id = c.cliente_id
       LEFT JOIN empleados e ON u.empleado_id = e.empleado_id
       LEFT JOIN sucursales s ON e.sucursal_id = s.sucursal_id
       WHERE 
         u.email ILIKE $1 OR
         c.nombre ILIKE $1 OR 
         c.apellido ILIKE $1 OR
         e.nombre ILIKE $1 OR 
         e.apellido ILIKE $1 OR
         e.puesto ILIKE $1 OR
         s.nombre ILIKE $1
       ORDER BY relevancia DESC, u.fecha_creacion DESC
       LIMIT $2`,
            [`%${q}%`, limit]
        );

        res.json({
            success: true,
            data: result.rows
        });
    });

    // =============================================
    // 14. ESTADÍSTICAS DE USUARIOS
    // =============================================
    static getUserStats = asyncHandler(async (req, res) => {
        const {
            startDate,
            endDate,
            sucursal_id
        } = req.query;

        const params = [];
        let paramCount = 0;
        let whereClause = '';

        if (startDate) {
            paramCount++;
            whereClause += ` AND u.fecha_creacion >= $${paramCount}`;
            params.push(startDate);
        }

        if (endDate) {
            paramCount++;
            whereClause += ` AND u.fecha_creacion <= $${paramCount}`;
            params.push(endDate);
        }

        // Estadísticas generales
        const generalStats = await query(
            `SELECT 
         COUNT(*) as total_usuarios,
         COUNT(CASE WHEN u.activo = true THEN 1 END) as activos,
         COUNT(CASE WHEN u.email_verificado = true THEN 1 END) as verificados,
         COUNT(CASE WHEN u.tipo_usuario = 'Empleado' THEN 1 END) as empleados,
         COUNT(CASE WHEN u.tipo_usuario = 'Cliente' THEN 1 END) as clientes,
         COUNT(CASE WHEN u.tipo_usuario = 'Administrador' THEN 1 END) as administradores,
         COUNT(CASE WHEN u.provider = 'google' THEN 1 END) as google_users,
         COUNT(CASE WHEN u.provider = 'local' THEN 1 END) as local_users,
         AVG(EXTRACT(DAY FROM NOW() - u.fecha_ultimo_login)) as avg_days_since_login
       FROM usuarios u
       WHERE 1=1 ${whereClause}`,
            params
        );

        // Registros por día (últimos 30 días)
        const dailyRegistrations = await query(
            `SELECT 
         DATE(u.fecha_creacion) as fecha,
         COUNT(*) as registros,
         COUNT(CASE WHEN u.tipo_usuario = 'Cliente' THEN 1 END) as clientes,
         COUNT(CASE WHEN u.tipo_usuario = 'Empleado' THEN 1 END) as empleados
       FROM usuarios u
       WHERE u.fecha_creacion >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY DATE(u.fecha_creacion)
       ORDER BY fecha DESC`
        );

        // Usuarios por sucursal (solo empleados)
        let usersByBranch;
        if (sucursal_id) {
            usersByBranch = await query(
                `SELECT 
           s.sucursal_id,
           s.nombre as sucursal_nombre,
           COUNT(DISTINCT u.usuario_id) as total_usuarios,
           COUNT(DISTINCT CASE WHEN e.puesto = 'Vendedor' THEN u.usuario_id END) as vendedores,
           COUNT(DISTINCT CASE WHEN e.puesto = 'Gerente' THEN u.usuario_id END) as gerentes
         FROM usuarios u
         JOIN empleados e ON u.empleado_id = e.empleado_id
         JOIN sucursales s ON e.sucursal_id = s.sucursal_id
         WHERE s.sucursal_id = $1
         GROUP BY s.sucursal_id, s.nombre`,
                [sucursal_id]
            );
        } else {
            usersByBranch = await query(
                `SELECT 
           s.sucursal_id,
           s.nombre as sucursal_nombre,
           COUNT(DISTINCT u.usuario_id) as total_usuarios,
           COUNT(DISTINCT CASE WHEN e.puesto = 'Vendedor' THEN u.usuario_id END) as vendedores,
           COUNT(DISTINCT CASE WHEN e.puesto = 'Gerente' THEN u.usuario_id END) as gerentes
         FROM usuarios u
         JOIN empleados e ON u.empleado_id = e.empleado_id
         JOIN sucursales s ON e.sucursal_id = s.sucursal_id
         GROUP BY s.sucursal_id, s.nombre
         ORDER BY total_usuarios DESC`
            );
        }

        // Actividad reciente
        const recentActivity = await query(
            `SELECT 
         u.usuario_id,
         u.email,
         u.tipo_usuario,
         u.fecha_ultimo_login,
         EXTRACT(DAY FROM NOW() - u.fecha_ultimo_login) as dias_desde_login,
         (SELECT COUNT(*) FROM logs_autenticacion la WHERE la.usuario_id = u.usuario_id AND la.exito = true) as logins_exitosos,
         (SELECT MAX(fecha_log) FROM logs_autenticacion la WHERE la.usuario_id = u.usuario_id) as ultima_actividad
       FROM usuarios u
       WHERE u.fecha_ultimo_login IS NOT NULL
       ORDER BY u.fecha_ultimo_login DESC
       LIMIT 10`
        );

        res.json({
            success: true,
            data: {
                general: generalStats.rows[0],
                daily_registrations: dailyRegistrations.rows,
                by_branch: usersByBranch.rows,
                recent_activity: recentActivity.rows
            }
        });
    });

    // =============================================
    // 15. ENDPOINT DE PRUEBA DE CONEXIÓN
    // =============================================
    static testDB = asyncHandler(async (req, res) => {
        try {
            // Probar conexión básica
            const testQuery = await query('SELECT NOW() as server_time, version() as db_version');

            // Verificar tablas de usuarios
            const userTables = await query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name IN ('usuarios', 'clientes', 'empleados', 'roles', 'usuarios_roles')
        ORDER BY table_name
      `);

            // Contar registros en tablas principales
            const counts = await query(`
        SELECT 
          (SELECT COUNT(*) FROM usuarios) as total_usuarios,
          (SELECT COUNT(*) FROM clientes) as total_clientes,
          (SELECT COUNT(*) FROM empleados) as total_empleados,
          (SELECT COUNT(*) FROM roles) as total_roles,
          (SELECT COUNT(*) FROM usuarios_roles) as total_asignaciones
      `);

            res.json({
                success: true,
                message: '✅ Conexión a PostgreSQL exitosa',
                data: {
                    server_time: testQuery.rows[0].server_time,
                    db_version: testQuery.rows[0].db_version,
                    tables_found: userTables.rows.map(t => t.table_name),
                    counts: counts.rows[0]
                }
            });

        } catch (error) {
            logger.error('Error en testDB:', error);
            res.status(500).json({
                success: false,
                message: '❌ Error de conexión a PostgreSQL',
                error: error.message
            });
        }
    });

    // =============================================
    // 16. CONTAR USUARIOS (SIMPLIFICADO)
    // =============================================
    static countUsers = asyncHandler(async (req, res) => {
        const result = await query(`
      SELECT 
        COUNT(*) as total_usuarios,
        COUNT(CASE WHEN tipo_usuario = 'Empleado' THEN 1 END) as empleados,
        COUNT(CASE WHEN tipo_usuario = 'Cliente' THEN 1 END) as clientes,
        COUNT(CASE WHEN tipo_usuario = 'Administrador' THEN 1 END) as administradores,
        COUNT(CASE WHEN activo = true THEN 1 END) as activos,
        COUNT(CASE WHEN email_verificado = true THEN 1 END) as verificados,
        COUNT(CASE WHEN provider = 'google' THEN 1 END) as google_users,
        COUNT(CASE WHEN fecha_ultimo_login >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as activos_7dias
      FROM usuarios
    `);

        res.json({
            success: true,
            data: result.rows[0]
        });
    });

    // =============================================
    // 17. EXPORTAR USUARIOS (CSV/JSON)
    // =============================================
    static exportUsers = asyncHandler(async (req, res) => {
        const { format = 'json' } = req.query;

        const result = await query(`
      SELECT 
        u.usuario_id,
        u.email,
        u.tipo_usuario,
        u.provider,
        u.email_verificado,
        u.activo,
        u.fecha_creacion,
        u.fecha_ultimo_login,
        c.nombre as cliente_nombre,
        c.apellido as cliente_apellido,
        c.email as cliente_email,
        c.telefono as cliente_telefono,
        e.nombre as empleado_nombre,
        e.apellido as empleado_apellido,
        e.puesto,
        e.departamento,
        STRING_AGG(DISTINCT r.nombre, ', ') as roles
      FROM usuarios u
      LEFT JOIN clientes c ON u.cliente_id = c.cliente_id
      LEFT JOIN empleados e ON u.empleado_id = e.empleado_id
      LEFT JOIN usuarios_roles ur ON u.usuario_id = ur.usuario_id AND ur.activo = true
      LEFT JOIN roles r ON ur.rol_id = r.rol_id
      GROUP BY 
        u.usuario_id, u.email, u.tipo_usuario, u.provider, u.email_verificado, 
        u.activo, u.fecha_creacion, u.fecha_ultimo_login,
        c.nombre, c.apellido, c.email, c.telefono,
        e.nombre, e.apellido, e.puesto, e.departamento
      ORDER BY u.fecha_creacion DESC
    `);

        if (format === 'csv') {
            // Convertir a CSV
            const headers = Object.keys(result.rows[0] || {}).join(',');
            const rows = result.rows.map(row =>
                Object.values(row).map(value =>
                    typeof value === 'string' && value.includes(',') ? `"${value}"` : value
                ).join(',')
            );

            const csv = [headers, ...rows].join('\n');

            res.header('Content-Type', 'text/csv');
            res.header('Content-Disposition', 'attachment; filename=usuarios.csv');
            res.send(csv);
        } else {
            // JSON por defecto
            res.json({
                success: true,
                data: result.rows,
                count: result.rows.length,
                exported_at: new Date().toISOString()
            });
        }
    });

    // =============================================
    // 18. VERIFICAR EMAIL
    // =============================================
    static verifyEmail = asyncHandler(async (req, res) => {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Token de verificación requerido'
            });
        }

        try {
            // Decodificar token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            if (!decoded.usuario_id || !decoded.email) {
                throw new Error('Token inválido');
            }

            // Verificar usuario
            const userResult = await query(
                'SELECT usuario_id, email, email_verificado FROM usuarios WHERE usuario_id = $1 AND email = $2',
                [decoded.usuario_id, decoded.email]
            );

            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuario no encontrado'
                });
            }

            const user = userResult.rows[0];

            if (user.email_verificado) {
                return res.status(400).json({
                    success: false,
                    message: 'El email ya está verificado'
                });
            }

            // Actualizar verificación
            await query(
                `UPDATE usuarios 
         SET email_verificado = true, 
             fecha_verificacion = NOW(),
             token_verificacion = NULL
         WHERE usuario_id = $1`,
                [user.usuario_id]
            );

            // Registrar auditoría
            await query(
                `INSERT INTO logs_autenticacion (
          usuario_id, email_proporcionado, accion,
          exito, ip_address, detalles
        ) VALUES ($1, $2, 'Email_Verificado', true, $3, $4)`,
                [user.usuario_id, user.email, req.ip, 'Verificación exitosa vía token']
            );

            res.json({
                success: true,
                message: 'Email verificado exitosamente'
            });

        } catch (error) {
            if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
                return res.status(400).json({
                    success: false,
                    message: 'Token inválido o expirado'
                });
            }
            throw error;
        }
    });

    // =============================================
    // 19. REENVIAR EMAIL DE VERIFICACIÓN
    // =============================================
    static resendVerificationEmail = asyncHandler(async (req, res) => {
        const { email } = req.body;

        const userResult = await query(
            'SELECT usuario_id, email, email_verificado FROM usuarios WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            // Por seguridad, no revelar si el email existe
            return res.json({
                success: true,
                message: 'Si el email existe y no está verificado, recibirás un nuevo correo de verificación'
            });
        }

        const user = userResult.rows[0];

        if (user.email_verificado) {
            return res.status(400).json({
                success: false,
                message: 'El email ya está verificado'
            });
        }

        // Generar nuevo token
        const verificationToken = jwt.sign(
            { usuario_id: user.usuario_id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Guardar token
        await query(
            'UPDATE usuarios SET token_verificacion = $1 WHERE usuario_id = $2',
            [verificationToken, user.usuario_id]
        );

        // Aquí iría el envío real del email
        // await sendVerificationEmail(user.email, verificationToken);

        res.json({
            success: true,
            message: 'Correo de verificación reenviado'
        });
    });

    // =============================================
    // 20. OBTENER MI PERFIL (USUARIO ACTUAL)
    // =============================================
    static getMyProfile = asyncHandler(async (req, res) => {
        const user = req.user;

        // Obtener información completa
        const result = await query(
            `SELECT 
        u.*,
        c.*,
        e.*,
        s.nombre as sucursal_nombre,
        STRING_AGG(DISTINCT r.nombre, ', ') as roles_nombres
       FROM usuarios u
       LEFT JOIN clientes c ON u.cliente_id = c.cliente_id
       LEFT JOIN empleados e ON u.empleado_id = e.empleado_id
       LEFT JOIN sucursales s ON e.sucursal_id = s.sucursal_id
       LEFT JOIN usuarios_roles ur ON u.usuario_id = ur.usuario_id AND ur.activo = true
       LEFT JOIN roles r ON ur.rol_id = r.rol_id
       WHERE u.usuario_id = $1
       GROUP BY 
         u.usuario_id, u.email, u.tipo_usuario, u.provider, u.email_verificado, 
         u.activo, u.fecha_creacion, u.fecha_ultimo_login, u.cliente_id, u.empleado_id,
         c.cliente_id, e.empleado_id, s.nombre`,
            [user.usuario_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        const userData = result.rows[0];

        // Obtener permisos
        const permisosResult = await query(
            `SELECT DISTINCT p.*
       FROM usuarios_roles ur
       JOIN roles_permisos rp ON ur.rol_id = rp.rol_id
       JOIN permisos p ON rp.permiso_id = p.permiso_id
       WHERE ur.usuario_id = $1 
         AND ur.activo = true 
         AND rp.concedido = true
       ORDER BY p.modulo, p.nivel`,
            [user.usuario_id]
        );

        userData.permisos = permisosResult.rows;

        // Obtener sesiones activas
        const sesionesResult = await query(
            `SELECT sesion_id, dispositivo, fecha_inicio, fecha_ultima_actividad, ip_address
       FROM sesiones
       WHERE usuario_id = $1 AND activa = true AND fecha_expiracion > NOW()
       ORDER BY fecha_ultima_actividad DESC
       LIMIT 5`,
            [user.usuario_id]
        );

        userData.sesiones_activas = sesionesResult.rows;

        // Estadísticas según tipo de usuario
        if (userData.cliente_id) {
            const stats = await query(
                `SELECT 
           (SELECT COUNT(*) FROM ventas WHERE cliente_id = $1 AND estado_venta = 'Pagada') as total_compras,
           (SELECT SUM(total) FROM ventas WHERE cliente_id = $1 AND estado_venta = 'Pagada') as total_gastado,
           (SELECT COUNT(*) FROM wishlists WHERE cliente_id = $1) as wishlists_count,
           (SELECT MAX(fecha_venta) FROM ventas WHERE cliente_id = $1) as ultima_compra,
           (SELECT SUM(puntos) FROM transacciones_puntos WHERE cliente_id = $1 AND tipo_transaccion = 'Acumulación') as puntos_totales
         FROM clientes c
         WHERE c.cliente_id = $1`,
                [userData.cliente_id]
            );

            userData.estadisticas = stats.rows[0];
        }

        if (userData.empleado_id) {
            const stats = await query(
                `SELECT 
           (SELECT COUNT(*) FROM ventas WHERE empleado_id = $1 AND estado_venta = 'Pagada') as ventas_realizadas,
           (SELECT SUM(total) FROM ventas WHERE empleado_id = $1 AND estado_venta = 'Pagada') as ventas_total,
           (SELECT AVG(total) FROM ventas WHERE empleado_id = $1 AND estado_venta = 'Pagada') as ventas_promedio,
           (SELECT SUM(comision_empleado) FROM detalles_venta dv 
            JOIN ventas v ON dv.venta_id = v.venta_id 
            WHERE v.empleado_id = $1 AND v.estado_venta = 'Pagada') as comisiones_totales
         FROM empleados e
         WHERE e.empleado_id = $1`,
                [userData.empleado_id]
            );

            userData.estadisticas_empleado = stats.rows[0];
        }

        res.json({
            success: true,
            data: userData
        });
    });
}

export default UserController;