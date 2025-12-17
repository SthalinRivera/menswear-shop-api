import { query, getClient } from '../config/database.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { PAGINATION, ERROR_MESSAGES } from '../config/constants.js';
import logger from '../utils/logger.js';

class RoleController {
    // =============================================
    // 1. OBTENER TODOS LOS ROLES
    // =============================================
    static getRoles = asyncHandler(async (req, res) => {
        const {
            page = 1,
            limit = PAGINATION.DEFAULT_LIMIT,
            q = '',
            tipo,
            nivel_min,
            nivel_max,
            activo = 'true',
            sortBy = 'nivel',
            sortOrder = 'desc'
        } = req.query;

        const offset = (page - 1) * limit;

        let queryStr = `
            SELECT 
                r.*,
                u.email as creado_por_email,
                COUNT(DISTINCT ur.usuario_id) as total_usuarios,
                COUNT(DISTINCT rp.permiso_id) as total_permisos
            FROM roles r
            LEFT JOIN usuarios u ON r.creado_por = u.usuario_id
            LEFT JOIN usuarios_roles ur ON r.rol_id = ur.rol_id AND ur.activo = true
            LEFT JOIN roles_permisos rp ON r.rol_id = rp.rol_id AND rp.concedido = true
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 0;

        // Filtros
        if (q) {
            paramCount++;
            queryStr += ` AND (
                r.nombre ILIKE $${paramCount} OR
                r.descripcion ILIKE $${paramCount}
            )`;
            params.push(`%${q}%`);
        }

        if (tipo) {
            paramCount++;
            queryStr += ` AND r.tipo = $${paramCount}`;
            params.push(tipo);
        }

        if (nivel_min !== undefined) {
            paramCount++;
            queryStr += ` AND r.nivel >= $${paramCount}`;
            params.push(parseInt(nivel_min));
        }

        if (nivel_max !== undefined) {
            paramCount++;
            queryStr += ` AND r.nivel <= $${paramCount}`;
            params.push(parseInt(nivel_max));
        }

        if (activo === 'true') {
            queryStr += ` AND r.activo = true`;
        } else if (activo === 'false') {
            queryStr += ` AND r.activo = false`;
        }

        // Agrupar
        queryStr += ` GROUP BY r.rol_id, u.email`;

        // Ordenar
        const validSortColumns = ['nombre', 'nivel', 'tipo', 'fecha_creacion', 'total_usuarios'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'nivel';
        const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

        queryStr += ` ORDER BY r.${sortColumn} ${order}`;

        // Paginación
        paramCount++;
        queryStr += ` LIMIT $${paramCount}`;
        params.push(limit);

        paramCount++;
        queryStr += ` OFFSET $${paramCount}`;
        params.push(offset);

        // Ejecutar query principal
        const result = await query(queryStr, params);

        // Count
        let countStr = `
            SELECT COUNT(*) 
            FROM roles r
            WHERE 1=1
        `;

        const countParams = [];
        let countParamCount = 0;

        if (q) {
            countParamCount++;
            countStr += ` AND (
                r.nombre ILIKE $${countParamCount} OR
                r.descripcion ILIKE $${countParamCount}
            )`;
            countParams.push(`%${q}%`);
        }

        if (tipo) {
            countParamCount++;
            countStr += ` AND r.tipo = $${countParamCount}`;
            countParams.push(tipo);
        }

        if (nivel_min !== undefined) {
            countParamCount++;
            countStr += ` AND r.nivel >= $${countParamCount}`;
            countParams.push(parseInt(nivel_min));
        }

        if (nivel_max !== undefined) {
            countParamCount++;
            countStr += ` AND r.nivel <= $${countParamCount}`;
            countParams.push(parseInt(nivel_max));
        }

        if (activo === 'true') {
            countStr += ` AND r.activo = true`;
        } else if (activo === 'false') {
            countStr += ` AND r.activo = false`;
        }

        const countResult = await query(countStr, countParams);
        const total = parseInt(countResult.rows[0].count);

        // Obtener tipos únicos para filtros
        const tiposResult = await query(
            `SELECT DISTINCT tipo FROM roles ORDER BY tipo`
        );

        // Obtener estadísticas rápidas
        const statsQuery = await query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN tipo = 'Sistema' THEN 1 END) as sistema,
                COUNT(CASE WHEN tipo = 'Negocio' THEN 1 END) as negocio,
                COUNT(CASE WHEN tipo = 'Personalizado' THEN 1 END) as personalizado,
                COUNT(CASE WHEN activo = true THEN 1 END) as activos
            FROM roles
        `);

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
                filters: {
                    tipos: tiposResult.rows.map(t => t.tipo)
                },
                stats: statsQuery.rows[0]
            }
        });
    });

    // =============================================
    // 2. OBTENER ROL POR ID
    // =============================================
    static getRoleById = asyncHandler(async (req, res) => {
        const { id } = req.params;

        const result = await query(
            `SELECT 
                r.*,
                u.email as creado_por_email,
                COUNT(DISTINCT ur.usuario_id) as total_usuarios
            FROM roles r
            LEFT JOIN usuarios u ON r.creado_por = u.usuario_id
            LEFT JOIN usuarios_roles ur ON r.rol_id = ur.rol_id AND ur.activo = true
            WHERE r.rol_id = $1
            GROUP BY r.rol_id, u.email`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.NOT_FOUND,
                error: 'Rol no encontrado'
            });
        }

        const role = result.rows[0];

        // Obtener permisos del rol
        const permisosResult = await query(
            `SELECT 
                p.*,
                rp.concedido,
                rp.concedido_por,
                up.email as concedido_por_email,
                rp.fecha_concesion
            FROM roles_permisos rp
            JOIN permisos p ON rp.permiso_id = p.permiso_id
            LEFT JOIN usuarios up ON rp.concedido_por = up.usuario_id
            WHERE rp.rol_id = $1
            ORDER BY p.modulo, p.nivel, p.nombre`,
            [id]
        );

        role.permisos = permisosResult.rows;

        // Agrupar permisos por módulo
        const permisosPorModulo = {};
        role.permisos.forEach(permiso => {
            if (!permisosPorModulo[permiso.modulo]) {
                permisosPorModulo[permiso.modulo] = [];
            }
            permisosPorModulo[permiso.modulo].push(permiso);
        });
        role.permisos_por_modulo = permisosPorModulo;

        // Obtener usuarios con este rol
        const usuariosResult = await query(
            `SELECT 
                u.usuario_id,
                u.email,
                u.tipo_usuario,
                u.activo as usuario_activo,
                ur.activo as rol_activo,
                ur.fecha_asignacion,
                ur.fecha_expiracion,
                c.nombre as cliente_nombre,
                c.apellido as cliente_apellido,
                e.nombre as empleado_nombre,
                e.apellido as empleado_apellido,
                ua.email as asignado_por_email
            FROM usuarios_roles ur
            JOIN usuarios u ON ur.usuario_id = u.usuario_id
            LEFT JOIN clientes c ON u.cliente_id = c.cliente_id
            LEFT JOIN empleados e ON u.empleado_id = e.empleado_id
            LEFT JOIN usuarios ua ON ur.asignado_por = ua.usuario_id
            WHERE ur.rol_id = $1
            ORDER BY ur.fecha_asignacion DESC
            LIMIT 20`,
            [id]
        );

        role.usuarios = usuariosResult.rows;

        // Obtener módulos disponibles
        const modulosResult = await query(
            `SELECT DISTINCT modulo FROM permisos ORDER BY modulo`
        );

        role.modulos_disponibles = modulosResult.rows.map(m => m.modulo);

        res.json({
            success: true,
            data: role
        });
    });

    // =============================================
    // 3. CREAR ROL
    // =============================================
    static createRole = asyncHandler(async (req, res) => {
        const {
            nombre,
            descripcion = '',
            nivel = 10,
            tipo = 'Personalizado',
            permisos = [],
            activo = true
        } = req.body;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Validar nombre único
            const nameCheck = await client.query(
                'SELECT rol_id FROM roles WHERE nombre = $1',
                [nombre]
            );

            if (nameCheck.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Ya existe un rol con ese nombre'
                });
            }

            // Insertar rol
            const roleResult = await client.query(
                `INSERT INTO roles (
                    nombre, descripcion, nivel, tipo, 
                    activo, creado_por
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *`,
                [nombre, descripcion, nivel, tipo, activo, req.user?.usuario_id || null]
            );

            const newRole = roleResult.rows[0];

            // Asignar permisos si se proporcionan
            if (permisos && permisos.length > 0) {
                for (const permisoId of permisos) {
                    // Verificar que el permiso existe
                    const permisoCheck = await client.query(
                        'SELECT permiso_id FROM permisos WHERE permiso_id = $1',
                        [permisoId]
                    );

                    if (permisoCheck.rows.length > 0) {
                        await client.query(
                            `INSERT INTO roles_permisos (
                                rol_id, permiso_id, concedido, concedido_por
                            ) VALUES ($1, $2, true, $3)`,
                            [newRole.rol_id, permisoId, req.user?.usuario_id || null]
                        );
                    }
                }
            }

            await client.query('COMMIT');

            // Registrar auditoría
            if (req.user?.usuario_id) {
                await query(
                    `INSERT INTO auditorias (
                        tabla_afectada, accion, id_registro,
                        datos_nuevos, realizado_por, ip_address
                    ) VALUES (
                        'roles', 'INSERT', $1,
                        $2, $3, $4
                    )`,
                    [
                        newRole.rol_id,
                        JSON.stringify({
                            nombre: newRole.nombre,
                            nivel: newRole.nivel,
                            tipo: newRole.tipo,
                            creado_por: req.user.usuario_id
                        }),
                        req.user.usuario_id,
                        req.ip
                    ]
                );
            }

            logger.info(`Rol creado: ${newRole.nombre} por ${req.user?.email || 'sistema'}`);

            res.status(201).json({
                success: true,
                message: 'Rol creado exitosamente',
                data: newRole
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // =============================================
    // 4. ACTUALIZAR ROL
    // =============================================
    static updateRole = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { nombre, descripcion, nivel, tipo, activo, permisos } = req.body;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Verificar si el rol existe
            const roleCheck = await client.query(
                'SELECT * FROM roles WHERE rol_id = $1',
                [id]
            );

            if (roleCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: ERROR_MESSAGES.NOT_FOUND
                });
            }

            const oldRole = roleCheck.rows[0];

            // Validar nombre único si se cambia
            if (nombre && nombre !== oldRole.nombre) {
                const nameCheck = await client.query(
                    'SELECT rol_id FROM roles WHERE nombre = $1',
                    [nombre]
                );

                if (nameCheck.rows.length > 0) {
                    return res.status(409).json({
                        success: false,
                        message: 'Ya existe un rol con ese nombre'
                    });
                }
            }

            // Construir query de actualización
            const updates = [];
            const values = [];
            let paramCount = 1;

            if (nombre !== undefined) {
                updates.push(`nombre = $${paramCount}`);
                values.push(nombre);
                paramCount++;
            }

            if (descripcion !== undefined) {
                updates.push(`descripcion = $${paramCount}`);
                values.push(descripcion);
                paramCount++;
            }

            if (nivel !== undefined) {
                updates.push(`nivel = $${paramCount}`);
                values.push(nivel);
                paramCount++;
            }

            if (tipo !== undefined) {
                updates.push(`tipo = $${paramCount}`);
                values.push(tipo);
                paramCount++;
            }

            if (activo !== undefined) {
                updates.push(`activo = $${paramCount}`);
                values.push(activo);
                paramCount++;
            }

            if (updates.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No hay datos válidos para actualizar'
                });
            }

            values.push(id);
            const queryStr = `
                UPDATE roles 
                SET ${updates.join(', ')}
                WHERE rol_id = $${paramCount}
                RETURNING *
            `;

            const result = await client.query(queryStr, values);
            const updatedRole = result.rows[0];

            // Actualizar permisos si se proporcionan
            if (permisos !== undefined) {
                // Eliminar todos los permisos actuales
                await client.query(
                    'DELETE FROM roles_permisos WHERE rol_id = $1',
                    [id]
                );

                // Agregar nuevos permisos
                if (permisos.length > 0) {
                    for (const permisoId of permisos) {
                        await client.query(
                            `INSERT INTO roles_permisos (
                                rol_id, permiso_id, concedido, concedido_por
                            ) VALUES ($1, $2, true, $3)`,
                            [id, permisoId, req.user?.usuario_id || null]
                        );
                    }
                }
            }

            await client.query('COMMIT');

            // Registrar auditoría
            if (req.user?.usuario_id) {
                await query(
                    `INSERT INTO auditorias (
                        tabla_afectada, accion, id_registro,
                        datos_anteriores, datos_nuevos,
                        realizado_por, ip_address
                    ) VALUES (
                        'roles', 'UPDATE', $1,
                        $2, $3, $4, $5
                    )`,
                    [
                        id,
                        JSON.stringify(oldRole),
                        JSON.stringify(updatedRole),
                        req.user.usuario_id,
                        req.ip
                    ]
                );
            }

            logger.info(`Rol actualizado: ${updatedRole.nombre} por ${req.user?.email || 'sistema'}`);

            res.json({
                success: true,
                message: 'Rol actualizado exitosamente',
                data: updatedRole
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // =============================================
    // 5. ELIMINAR ROL (SOFT DELETE)
    // =============================================
    static deleteRole = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { hardDelete = false } = req.query;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Verificar si el rol existe
            const roleCheck = await client.query(
                'SELECT * FROM roles WHERE rol_id = $1',
                [id]
            );

            if (roleCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: ERROR_MESSAGES.NOT_FOUND
                });
            }

            const roleToDelete = roleCheck.rows[0];

            // No permitir eliminar roles del sistema si tienen usuarios asignados
            if (roleToDelete.tipo === 'Sistema') {
                const usageCheck = await client.query(
                    'SELECT COUNT(*) FROM usuarios_roles WHERE rol_id = $1 AND activo = true',
                    [id]
                );

                if (parseInt(usageCheck.rows[0].count) > 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'No se puede eliminar un rol del sistema que tiene usuarios asignados'
                    });
                }
            }

            if (hardDelete === 'true') {
                // Hard delete (eliminación permanente)
                // Verificar si tiene usuarios asignados
                const usageCheck = await client.query(
                    'SELECT COUNT(*) FROM usuarios_roles WHERE rol_id = $1',
                    [id]
                );

                if (parseInt(usageCheck.rows[0].count) > 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'No se puede eliminar un rol que tiene usuarios asignados'
                    });
                }

                // Eliminar permisos asignados
                await client.query(
                    'DELETE FROM roles_permisos WHERE rol_id = $1',
                    [id]
                );

                // Eliminar el rol
                await client.query(
                    'DELETE FROM roles WHERE rol_id = $1',
                    [id]
                );

                logger.warn(`Rol eliminado permanentemente: ${roleToDelete.nombre} por ${req.user?.email || 'sistema'}`);
            } else {
                // Soft delete (desactivación)
                await client.query(
                    'UPDATE roles SET activo = false WHERE rol_id = $1',
                    [id]
                );

                logger.info(`Rol desactivado: ${roleToDelete.nombre} por ${req.user?.email || 'sistema'}`);
            }

            await client.query('COMMIT');

            // Registrar auditoría
            if (req.user?.usuario_id) {
                await query(
                    `INSERT INTO auditorias (
                        tabla_afectada, accion, id_registro,
                        datos_anteriores, realizado_por, ip_address
                    ) VALUES (
                        'roles', ${hardDelete === 'true' ? "'DELETE'" : "'UPDATE'"}, $1,
                        $2, $3, $4
                    )`,
                    [
                        id,
                        JSON.stringify(roleToDelete),
                        req.user.usuario_id,
                        req.ip
                    ]
                );
            }

            res.json({
                success: true,
                message: hardDelete === 'true'
                    ? 'Rol eliminado permanentemente'
                    : 'Rol desactivado exitosamente'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // =============================================
    // 6. ASIGNAR PERMISO A ROL
    // =============================================
    static assignPermission = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { permiso_id, concedido = true } = req.body;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Verificar si el rol existe
            const roleCheck = await client.query(
                'SELECT rol_id FROM roles WHERE rol_id = $1',
                [id]
            );

            if (roleCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Rol no encontrado'
                });
            }

            // Verificar si el permiso existe
            const permisoCheck = await client.query(
                'SELECT permiso_id FROM permisos WHERE permiso_id = $1',
                [permiso_id]
            );

            if (permisoCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Permiso no encontrado'
                });
            }

            // Verificar si ya tiene el permiso asignado
            const existingPerm = await client.query(
                'SELECT * FROM roles_permisos WHERE rol_id = $1 AND permiso_id = $2',
                [id, permiso_id]
            );

            let result;
            if (existingPerm.rows.length > 0) {
                // Actualizar asignación existente
                result = await client.query(
                    `UPDATE roles_permisos 
                    SET concedido = $1, concedido_por = $2, fecha_concesion = NOW()
                    WHERE rol_id = $3 AND permiso_id = $4
                    RETURNING *`,
                    [concedido, req.user?.usuario_id || null, id, permiso_id]
                );
            } else {
                // Crear nueva asignación
                result = await client.query(
                    `INSERT INTO roles_permisos (
                        rol_id, permiso_id, concedido, concedido_por
                    ) VALUES ($1, $2, $3, $4)
                    RETURNING *`,
                    [id, permisoId, concedido, req.user?.usuario_id || null]
                );
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Permiso asignado exitosamente',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // =============================================
    // 7. REMOVER PERMISO DE ROL
    // =============================================
    static removePermission = asyncHandler(async (req, res) => {
        const { id, permiso_id } = req.params;

        // Verificar si la asignación existe
        const assignmentCheck = await query(
            'SELECT * FROM roles_permisos WHERE rol_id = $1 AND permiso_id = $2',
            [id, permiso_id]
        );

        if (assignmentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'El rol no tiene este permiso asignado'
            });
        }

        // Eliminar la asignación
        await query(
            'DELETE FROM roles_permisos WHERE rol_id = $1 AND permiso_id = $2',
            [id, permiso_id]
        );

        res.json({
            success: true,
            message: 'Permiso removido exitosamente'
        });
    });

    // =============================================
    // 8. OBTENER TODOS LOS PERMISOS
    // =============================================
    static getAllPermissions = asyncHandler(async (req, res) => {
        const { modulo, nivel, activo = 'true' } = req.query;

        let queryStr = `
            SELECT *
            FROM permisos
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 0;

        if (modulo) {
            paramCount++;
            queryStr += ` AND modulo = $${paramCount}`;
            params.push(modulo);
        }

        if (nivel) {
            paramCount++;
            queryStr += ` AND nivel = $${paramCount}`;
            params.push(nivel);
        }

        if (activo === 'true') {
            queryStr += ` AND activo = true`;
        } else if (activo === 'false') {
            queryStr += ` AND activo = false`;
        }

        queryStr += ` ORDER BY modulo, nivel, nombre`;

        const result = await query(queryStr, params);

        // Agrupar por módulo
        const permisosPorModulo = {};
        result.rows.forEach(permiso => {
            if (!permisosPorModulo[permiso.modulo]) {
                permisosPorModulo[permiso.modulo] = [];
            }
            permisosPorModulo[permiso.modulo].push(permiso);
        });

        // Obtener estadísticas
        const statsQuery = await query(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT modulo) as modulos,
                COUNT(DISTINCT nivel) as niveles,
                COUNT(CASE WHEN nivel = 'Lectura' THEN 1 END) as lectura,
                COUNT(CASE WHEN nivel = 'Escritura' THEN 1 END) as escritura,
                COUNT(CASE WHEN nivel = 'Eliminacion' THEN 1 END) as eliminacion,
                COUNT(CASE WHEN nivel = 'Administracion' THEN 1 END) as administracion
            FROM permisos
            WHERE activo = true
        `);

        res.json({
            success: true,
            data: {
                total: result.rows.length,
                por_modulo: permisosPorModulo,
                todos: result.rows,
                stats: statsQuery.rows[0]
            }
        });
    });

    // =============================================
    // 9. BUSCAR ROLES
    // =============================================
    static searchRoles = asyncHandler(async (req, res) => {
        const { q, limit = 10 } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Término de búsqueda demasiado corto (mínimo 2 caracteres)'
            });
        }

        const result = await query(
            `SELECT 
                r.*,
                COUNT(DISTINCT ur.usuario_id) as total_usuarios
            FROM roles r
            LEFT JOIN usuarios_roles ur ON r.rol_id = ur.rol_id AND ur.activo = true
            WHERE r.nombre ILIKE $1 OR r.descripcion ILIKE $1
            GROUP BY r.rol_id
            ORDER BY 
                CASE 
                    WHEN r.nombre ILIKE $1 THEN 1
                    WHEN r.descripcion ILIKE $1 THEN 2
                    ELSE 3
                END,
                r.nivel DESC
            LIMIT $2`,
            [`%${q}%`, limit]
        );

        res.json({
            success: true,
            data: result.rows
        });
    });

    // =============================================
    // 10. OBTENER ESTADÍSTICAS DE ROLES
    // =============================================
    static getRoleStats = asyncHandler(async (req, res) => {
        const stats = await query(`
            SELECT 
                COUNT(*) as total_roles,
                COUNT(DISTINCT nivel) as niveles_distintos,
                AVG(nivel) as nivel_promedio,
                MIN(nivel) as nivel_minimo,
                MAX(nivel) as nivel_maximo,
                COUNT(CASE WHEN activo = true THEN 1 END) as roles_activos,
                COUNT(CASE WHEN tipo = 'Sistema' THEN 1 END) as sistema,
                COUNT(CASE WHEN tipo = 'Negocio' THEN 1 END) as negocio,
                COUNT(CASE WHEN tipo = 'Personalizado' THEN 1 END) as personalizado
            FROM roles
        `);

        // Roles más utilizados
        const topRoles = await query(`
            SELECT 
                r.rol_id,
                r.nombre,
                r.nivel,
                r.tipo,
                COUNT(DISTINCT ur.usuario_id) as total_usuarios
            FROM roles r
            LEFT JOIN usuarios_roles ur ON r.rol_id = ur.rol_id AND ur.activo = true
            GROUP BY r.rol_id, r.nombre, r.nivel, r.tipo
            ORDER BY total_usuarios DESC
            LIMIT 5
        `);

        // Distribución por tipo
        const distributionByType = await query(`
            SELECT 
                tipo,
                COUNT(*) as cantidad_roles,
                STRING_AGG(nombre, ', ') as roles_por_tipo
            FROM roles
            WHERE activo = true
            GROUP BY tipo
            ORDER BY cantidad_roles DESC
        `);

        // Usuarios con múltiples roles
        const multiRoleUsers = await query(`
            SELECT 
                u.usuario_id,
                u.email,
                COUNT(DISTINCT ur.rol_id) as total_roles
            FROM usuarios u
            JOIN usuarios_roles ur ON u.usuario_id = ur.usuario_id AND ur.activo = true
            GROUP BY u.usuario_id, u.email
            HAVING COUNT(DISTINCT ur.rol_id) > 1
            ORDER BY total_roles DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            data: {
                general: stats.rows[0],
                top_roles: topRoles.rows,
                distribucion_tipo: distributionByType.rows,
                usuarios_multiples_roles: multiRoleUsers.rows
            }
        });
    });

    // =============================================
    // 11. OBTENER USUARIOS POR ROL
    // =============================================
    static getUsersByRole = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const {
            page = 1,
            limit = 20,
            activo = 'true'
        } = req.query;

        const offset = (page - 1) * limit;

        let queryStr = `
            SELECT 
                u.usuario_id,
                u.email,
                u.tipo_usuario,
                u.activo as usuario_activo,
                ur.activo as rol_activo,
                ur.fecha_asignacion,
                ur.fecha_expiracion,
                c.nombre as cliente_nombre,
                c.apellido as cliente_apellido,
                e.nombre as empleado_nombre,
                e.apellido as empleado_apellido,
                ua.email as asignado_por_email
            FROM usuarios_roles ur
            JOIN usuarios u ON ur.usuario_id = u.usuario_id
            LEFT JOIN clientes c ON u.cliente_id = c.cliente_id
            LEFT JOIN empleados e ON u.empleado_id = e.empleado_id
            LEFT JOIN usuarios ua ON ur.asignado_por = ua.usuario_id
            WHERE ur.rol_id = $1
        `;

        const params = [id];
        let paramCount = 1;

        if (activo === 'true') {
            paramCount++;
            queryStr += ` AND ur.activo = $${paramCount}`;
            params.push(true);
        } else if (activo === 'false') {
            paramCount++;
            queryStr += ` AND ur.activo = $${paramCount}`;
            params.push(false);
        }

        queryStr += ` ORDER BY ur.fecha_asignacion DESC`;

        // Paginación
        paramCount++;
        queryStr += ` LIMIT $${paramCount}`;
        params.push(limit);

        paramCount++;
        queryStr += ` OFFSET $${paramCount}`;
        params.push(offset);

        const result = await query(queryStr, params);

        // Count
        let countStr = `
            SELECT COUNT(*)
            FROM usuarios_roles ur
            WHERE ur.rol_id = $1
        `;

        const countParams = [id];
        if (activo === 'true') {
            countStr += ` AND ur.activo = true`;
        } else if (activo === 'false') {
            countStr += ` AND ur.activo = false`;
        }

        const countResult = await query(countStr, countParams);
        const total = parseInt(countResult.rows[0].count);

        res.json({
            success: true,
            data: result.rows,
            meta: {
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    });

    // =============================================
    // 12. ASIGNAR ROL A USUARIO
    // =============================================
    static assignRoleToUser = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { usuario_id, activo = true, fecha_expiracion } = req.body;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Verificar si el rol existe
            const roleCheck = await client.query(
                'SELECT rol_id FROM roles WHERE rol_id = $1',
                [id]
            );

            if (roleCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Rol no encontrado'
                });
            }

            // Verificar si el usuario existe
            const userCheck = await client.query(
                'SELECT usuario_id FROM usuarios WHERE usuario_id = $1',
                [usuario_id]
            );

            if (userCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuario no encontrado'
                });
            }

            // Verificar si ya tiene el rol asignado
            const existingRole = await client.query(
                'SELECT usuario_rol_id FROM usuarios_roles WHERE usuario_id = $1 AND rol_id = $2',
                [usuario_id, id]
            );

            let result;
            if (existingRole.rows.length > 0) {
                // Actualizar asignación existente
                result = await client.query(
                    `UPDATE usuarios_roles 
                    SET activo = $1, fecha_expiracion = $2, fecha_asignacion = NOW()
                    WHERE usuario_id = $3 AND rol_id = $4
                    RETURNING *`,
                    [activo, fecha_expiracion || null, usuario_id, id]
                );
            } else {
                // Crear nueva asignación
                result = await client.query(
                    `INSERT INTO usuarios_roles (
                        usuario_id, rol_id, activo, fecha_expiracion, asignado_por
                    ) VALUES ($1, $2, $3, $4, $5)
                    RETURNING *`,
                    [usuario_id, id, activo, fecha_expiracion || null, req.user?.usuario_id || null]
                );
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Rol asignado al usuario exitosamente',
                data: result.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // =============================================
    // 13. REMOVER ROL DE USUARIO
    // =============================================
    static removeRoleFromUser = asyncHandler(async (req, res) => {
        const { id, usuario_id } = req.params;

        // Verificar si la asignación existe
        const assignmentCheck = await query(
            'SELECT * FROM usuarios_roles WHERE usuario_id = $1 AND rol_id = $2',
            [usuario_id, id]
        );

        if (assignmentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'El usuario no tiene este rol asignado'
            });
        }

        // Desactivar la asignación
        await query(
            'UPDATE usuarios_roles SET activo = false WHERE usuario_id = $1 AND rol_id = $2',
            [usuario_id, id]
        );

        res.json({
            success: true,
            message: 'Rol removido del usuario exitosamente'
        });
    });
}

export default RoleController;