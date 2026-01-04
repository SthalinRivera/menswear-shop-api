import { query, getClient } from '../config/database.js';
import { validationSchemas, validate } from '../middlewares/validationMiddleware.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { PAGINATION, ERROR_MESSAGES } from '../config/constants.js';
import logger from '../utils/logger.js';

class BrandController {
    // =============================================
    // 1. OBTENER TODAS LAS MARCAS
    // =============================================
    static getBrands = asyncHandler(async (req, res) => {
        const {
            page = 1,
            limit = PAGINATION.DEFAULT_LIMIT,
            q = '',
            activa = true,
            sortBy = 'nombre',
            sortOrder = 'asc'
        } = req.query;

        const offset = (page - 1) * limit;

        let queryStr = `
      SELECT 
        m.*,
        COUNT(DISTINCT p.producto_id) as total_productos,
        COUNT(DISTINCT CASE WHEN p.activo = true THEN p.producto_id END) as productos_activos,
        MIN(p.precio_venta) as precio_minimo,
        MAX(p.precio_venta) as precio_maximo,
        AVG(p.precio_venta) as precio_promedio
      FROM marcas m
      LEFT JOIN productos p ON m.marca_id = p.marca_id
      WHERE 1=1
    `;

        const params = [];
        let paramCount = 0;

        // Aplicar filtros
        if (q) {
            paramCount++;
            queryStr += ` AND (
        m.nombre ILIKE $${paramCount} OR 
        m.descripcion ILIKE $${paramCount} OR
        m.pais_origen ILIKE $${paramCount}
      )`;
            params.push(`%${q}%`);
        }

        if (activa !== undefined) {
            paramCount++;
            queryStr += ` AND m.activa = $${paramCount}`;
            params.push(activa === 'true');
        }

        // Agrupar
        queryStr += ` GROUP BY m.marca_id`;

        // Ordenar
        const validSortColumns = ['nombre', 'pais_origen', 'fecha_registro', 'total_productos'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'nombre';
        const order = sortOrder === 'desc' ? 'DESC' : 'ASC';

        if (sortColumn === 'total_productos') {
            queryStr += ` ORDER BY total_productos ${order}`;
        } else {
            queryStr += ` ORDER BY m.${sortColumn} ${order}`;
        }

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
            .replace(/SELECT m\.\*,.*?FROM/s, 'SELECT COUNT(DISTINCT m.marca_id) FROM')
            .replace(/GROUP BY.*/, '')
            .replace(/ORDER BY.*/, '')
            .replace(/LIMIT \$\d+ OFFSET \$\d+/, '');

        const countResult = await query(countQuery, params.slice(0, -2));
        const total = parseInt(countResult.rows[0]?.count || 0);

        // Estadísticas adicionales
        const statsQuery = await query(`
      SELECT 
        COUNT(*) as total_marcas,
        COUNT(CASE WHEN activa = true THEN 1 END) as marcas_activas,
        COUNT(DISTINCT pais_origen) as paises_diferentes,
        COUNT(CASE WHEN sitio_web IS NOT NULL THEN 1 END) as marcas_con_web,
        (SELECT COUNT(*) FROM productos WHERE marca_id IS NOT NULL) as productos_con_marca
      FROM marcas
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
    // 2. OBTENER MARCA POR ID
    // =============================================
    static getBrandById = asyncHandler(async (req, res) => {
        const { id } = req.params;

        const result = await query(
            `SELECT 
        m.*,
        COUNT(DISTINCT p.producto_id) as total_productos,
        COUNT(DISTINCT CASE WHEN p.activo = true THEN p.producto_id END) as productos_activos,
        MIN(p.precio_venta) as precio_minimo,
        MAX(p.precio_venta) as precio_maximo,
        AVG(p.precio_venta) as precio_promedio,
        json_agg(
          DISTINCT jsonb_build_object(
            'categoria_id', c.categoria_id,
            'nombre', c.nombre,
            'productos_count', sub.productos_count
          )
        ) FILTER (WHERE c.categoria_id IS NOT NULL) as categorias
      FROM marcas m
      LEFT JOIN productos p ON m.marca_id = p.marca_id
      LEFT JOIN (
        SELECT 
          p.marca_id,
          p.categoria_id,
          COUNT(*) as productos_count
        FROM productos p
        GROUP BY p.marca_id, p.categoria_id
      ) sub ON m.marca_id = sub.marca_id
      LEFT JOIN categorias c ON sub.categoria_id = c.categoria_id
      WHERE m.marca_id = $1
      GROUP BY m.marca_id`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.NOT_FOUND,
                error: 'Marca no encontrada'
            });
        }

        const brand = result.rows[0];

        // Obtener productos recientes de esta marca
        const recentProducts = await query(
            `SELECT 
         p.producto_id,
         p.sku,
         p.nombre,
         p.precio_venta,
         p.precio_final,
         p.es_promocion,
         p.precio_promocion,
         c.nombre as categoria_nombre,
         COALESCE(SUM(vp.stock_disponible), 0) as stock_total
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
       LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id AND vp.activo = true
       WHERE p.marca_id = $1 AND p.activo = true
       GROUP BY p.producto_id, c.nombre
       ORDER BY p.fecha_creacion DESC
       LIMIT 10`,
            [id]
        );

        brand.productos_recientes = recentProducts.rows;

        // Obtener estadísticas por categoría
        const categoryStats = await query(
            `SELECT 
         c.categoria_id,
         c.nombre as categoria_nombre,
         COUNT(p.producto_id) as total_productos,
         SUM(CASE WHEN p.activo = true THEN 1 ELSE 0 END) as productos_activos,
         AVG(p.precio_venta) as precio_promedio,
         MIN(p.precio_venta) as precio_minimo,
         MAX(p.precio_venta) as precio_maximo
       FROM categorias c
       LEFT JOIN productos p ON c.categoria_id = p.categoria_id AND p.marca_id = $1
       GROUP BY c.categoria_id, c.nombre
       HAVING COUNT(p.producto_id) > 0
       ORDER BY total_productos DESC`,
            [id]
        );

        brand.estadisticas_categorias = categoryStats.rows;

        // Obtener ventas de productos de esta marca (últimos 30 días)
        const salesStats = await query(
            `SELECT 
         COUNT(DISTINCT v.venta_id) as ventas_totales,
         SUM(dv.cantidad) as unidades_vendidas,
         SUM(dv.precio_total) as ingresos_totales,
         AVG(dv.precio_total) as promedio_venta
       FROM detalles_venta dv
       JOIN variantes_producto vp ON dv.variante_id = vp.variante_id
       JOIN productos p ON vp.producto_id = p.producto_id
       JOIN ventas v ON dv.venta_id = v.venta_id
       WHERE p.marca_id = $1 
         AND v.estado_venta = 'Pagada'
         AND v.fecha_venta >= CURRENT_DATE - INTERVAL '30 days'`,
            [id]
        );

        brand.estadisticas_ventas = salesStats.rows[0];

        res.json({
            success: true,
            data: brand
        });
    });

    // =============================================
    // 3. CREAR NUEVA MARCA
    // =============================================
    static createBrand = [
        validate([
            body('nombre').notEmpty().trim().withMessage('El nombre es requerido'),
            body('pais_origen').optional().trim(),
            body('sitio_web').optional().isURL().withMessage('URL inválida'),
            body('contacto_email').optional().isEmail().withMessage('Email inválido'),
        ]),
        asyncHandler(async (req, res) => {
            const {
                nombre,
                descripcion,
                pais_origen,
                sitio_web,
                contacto_email,
                activa = true
            } = req.body;

            // Verificar si la marca ya existe (nombre único)
            const existingBrand = await query(
                'SELECT marca_id FROM marcas WHERE nombre = $1',
                [nombre]
            );

            if (existingBrand.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Ya existe una marca con ese nombre'
                });
            }

            const result = await query(
                `INSERT INTO marcas (
          nombre, descripcion, pais_origen, 
          sitio_web, contacto_email, activa
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
                [
                    nombre,
                    descripcion || null,
                    pais_origen || null,
                    sitio_web || null,
                    contacto_email || null,
                    activa
                ]
            );

            const newBrand = result.rows[0];

            // Registrar auditoría
            await query(
                `INSERT INTO auditorias (
          tabla_afectada, accion, id_registro,
          datos_nuevos, realizado_por, ip_address
        ) VALUES (
          'marcas', 'INSERT', $1,
          $2, $3, $4
        )`,
                [
                    newBrand.marca_id,
                    JSON.stringify({
                        nombre: newBrand.nombre,
                        creado_por: req.user?.usuario_id || 'system'
                    }),
                    req.user?.usuario_id || null,
                    req.ip
                ]
            );

            logger.info(`Marca creada: ${newBrand.nombre} por ${req.user?.email || 'system'}`);

            res.status(201).json({
                success: true,
                message: 'Marca creada exitosamente',
                data: newBrand
            });
        })
    ];

    // =============================================
    // 4. ACTUALIZAR MARCA
    // =============================================
    static updateBrand = [
        validate([
            body('nombre').optional().trim().notEmpty().withMessage('Nombre no puede estar vacío'),
            body('sitio_web').optional().isURL().withMessage('URL inválida'),
            body('contacto_email').optional().isEmail().withMessage('Email inválido'),
            body('activa').optional().isBoolean().withMessage('Activa debe ser booleano')
        ]),
        asyncHandler(async (req, res) => {
            const { id } = req.params;
            const updateData = req.body;
            const currentUser = req.user;

            // Verificar si la marca existe
            const brandCheck = await query(
                'SELECT * FROM marcas WHERE marca_id = $1',
                [id]
            );

            if (brandCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: ERROR_MESSAGES.NOT_FOUND
                });
            }

            const oldBrand = brandCheck.rows[0];

            // Si se cambia el nombre, verificar que no exista otro con el mismo nombre
            if (updateData.nombre && updateData.nombre !== oldBrand.nombre) {
                const nameCheck = await query(
                    'SELECT marca_id FROM marcas WHERE nombre = $1 AND marca_id != $2',
                    [updateData.nombre, id]
                );

                if (nameCheck.rows.length > 0) {
                    return res.status(409).json({
                        success: false,
                        message: 'Ya existe otra marca con ese nombre'
                    });
                }
            }

            // Construir query de actualización dinámica
            const fields = [];
            const values = [];
            let paramCount = 1;

            Object.keys(updateData).forEach(key => {
                if (key !== 'marca_id') {
                    fields.push(`${key} = $${paramCount}`);
                    values.push(updateData[key]);
                    paramCount++;
                }
            });

            if (fields.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No hay datos para actualizar'
                });
            }

            values.push(id);
            const queryStr = `
        UPDATE marcas 
        SET ${fields.join(', ')}
        WHERE marca_id = $${paramCount}
        RETURNING *
      `;

            const result = await query(queryStr, values);
            const updatedBrand = result.rows[0];

            // Registrar auditoría
            await query(
                `INSERT INTO auditorias (
          tabla_afectada, accion, id_registro,
          datos_anteriores, datos_nuevos,
          realizado_por, ip_address
        ) VALUES (
          'marcas', 'UPDATE', $1,
          $2, $3, $4, $5
        )`,
                [
                    id,
                    JSON.stringify(oldBrand),
                    JSON.stringify(updatedBrand),
                    currentUser?.usuario_id || null,
                    req.ip
                ]
            );

            logger.info(`Marca actualizada: ${updatedBrand.nombre} por ${currentUser?.email || 'system'}`);

            res.json({
                success: true,
                message: 'Marca actualizada exitosamente',
                data: updatedBrand
            });
        })
    ];

    // =============================================
    // 5. ELIMINAR/DESACTIVAR MARCA
    // =============================================
    static deleteBrand = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { hardDelete = false } = req.query;
        const currentUser = req.user;

        // Verificar si la marca existe
        const brandCheck = await query(
            'SELECT * FROM marcas WHERE marca_id = $1',
            [id]
        );

        if (brandCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.NOT_FOUND
            });
        }

        const brandToDelete = brandCheck.rows[0];

        // Verificar si hay productos asociados
        const productsCheck = await query(
            'SELECT COUNT(*) as total_productos FROM productos WHERE marca_id = $1',
            [id]
        );

        const totalProductos = parseInt(productsCheck.rows[0].total_productos);

        if (hardDelete === 'true' && currentUser?.tipo_usuario === 'Administrador') {
            if (totalProductos > 0) {
                return res.status(400).json({
                    success: false,
                    message: `No se puede eliminar permanentemente la marca porque tiene ${totalProductos} productos asociados. Desactívela en su lugar.`
                });
            }

            // Hard delete (eliminación permanente)
            await query('DELETE FROM marcas WHERE marca_id = $1', [id]);

            logger.warn(`Marca eliminada permanentemente: ${brandToDelete.nombre} por ${currentUser?.email}`);

        } else {
            // Soft delete (desactivación)
            await query(
                'UPDATE marcas SET activa = false WHERE marca_id = $1',
                [id]
            );

            // También desactivar productos de esta marca si se solicita
            if (req.query.desactivarProductos === 'true') {
                await query(
                    'UPDATE productos SET activo = false WHERE marca_id = $1',
                    [id]
                );

                logger.info(`Marca y productos desactivados: ${brandToDelete.nombre} por ${currentUser?.email}`);
            } else {
                logger.info(`Marca desactivada: ${brandToDelete.nombre} por ${currentUser?.email}`);
            }
        }

        // Registrar auditoría
        await query(
            `INSERT INTO auditorias (
        tabla_afectada, accion, id_registro,
        datos_anteriores, realizado_por, ip_address
      ) VALUES (
        'marcas', ${hardDelete === 'true' ? "'DELETE'" : "'UPDATE'"}, $1,
        $2, $3, $4
      )`,
            [
                id,
                JSON.stringify(brandToDelete),
                currentUser?.usuario_id || null,
                req.ip
            ]
        );

        res.json({
            success: true,
            message: hardDelete === 'true'
                ? 'Marca eliminada permanentemente'
                : `Marca desactivada exitosamente${totalProductos > 0 ? ` (${totalProductos} productos asociados)` : ''}`
        });
    });

    // =============================================
    // 6. BUSCAR MARCAS
    // =============================================
    static searchBrands = asyncHandler(async (req, res) => {
        const { q, limit = 10 } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Término de búsqueda demasiado corto (mínimo 2 caracteres)'
            });
        }

        const result = await query(
            `SELECT 
         m.marca_id,
         m.nombre,
         m.pais_origen,
         m.activa,
         COUNT(p.producto_id) as total_productos,
         CASE 
           WHEN m.nombre ILIKE $1 THEN 3
           WHEN m.descripcion ILIKE $1 THEN 2
           WHEN m.pais_origen ILIKE $1 THEN 1
           ELSE 0
         END as relevancia
       FROM marcas m
       LEFT JOIN productos p ON m.marca_id = p.marca_id
       WHERE 
         m.nombre ILIKE $1 OR
         m.descripcion ILIKE $1 OR
         m.pais_origen ILIKE $1
       GROUP BY m.marca_id, m.nombre, m.pais_origen, m.activa
       ORDER BY relevancia DESC, m.nombre
       LIMIT $2`,
            [`%${q}%`, limit]
        );

        res.json({
            success: true,
            data: result.rows
        });
    });

    // =============================================
    // 7. OBTENER PRODUCTOS DE UNA MARCA
    // =============================================
    static getBrandProducts = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const {
            page = 1,
            limit = 20,
            categoria_id,
            minPrice,
            maxPrice,
            enPromocion,
            activo = true,
            sortBy = 'fecha_creacion',
            sortOrder = 'desc'
        } = req.query;

        const offset = (page - 1) * limit;

        // Verificar si la marca existe
        const brandCheck = await query(
            'SELECT marca_id FROM marcas WHERE marca_id = $1',
            [id]
        );

        if (brandCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Marca no encontrada'
            });
        }

        let queryStr = `
      SELECT 
        p.*,
        c.nombre as categoria_nombre,
        COALESCE(SUM(vp.stock_disponible), 0) as stock_total,
        COALESCE(
          (SELECT SUM(dv.cantidad) 
           FROM detalles_venta dv
           JOIN variantes_producto vp2 ON dv.variante_id = vp2.variante_id
           JOIN ventas v ON dv.venta_id = v.venta_id
           WHERE vp2.producto_id = p.producto_id 
             AND v.estado_venta = 'Pagada'
             AND v.fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
          ), 0
        ) as unidades_vendidas_30dias
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
      LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id AND vp.activo = true
      WHERE p.marca_id = $1 AND p.activo = $2
    `;

        const params = [id, activo === 'true'];
        let paramCount = 2;

        // Aplicar filtros adicionales
        if (categoria_id) {
            paramCount++;
            queryStr += ` AND p.categoria_id = $${paramCount}`;
            params.push(categoria_id);
        }

        if (minPrice) {
            paramCount++;
            queryStr += ` AND p.precio_final >= $${paramCount}`;
            params.push(minPrice);
        }

        if (maxPrice) {
            paramCount++;
            queryStr += ` AND p.precio_final <= $${paramCount}`;
            params.push(maxPrice);
        }

        if (enPromocion === 'true') {
            queryStr += ` AND p.es_promocion = true AND CURRENT_DATE BETWEEN p.fecha_inicio_promocion AND p.fecha_fin_promocion`;
        }

        // Agrupar
        queryStr += ` GROUP BY p.producto_id, c.nombre`;

        // Ordenar
        const validSortColumns = ['nombre', 'precio_final', 'fecha_creacion', 'stock_total', 'unidades_vendidas_30dias'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'fecha_creacion';
        const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

        if (['stock_total', 'unidades_vendidas_30dias'].includes(sortColumn)) {
            queryStr += ` ORDER BY ${sortColumn} ${order}`;
        } else {
            queryStr += ` ORDER BY p.${sortColumn} ${order}`;
        }

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
            .replace(/SELECT p\.\*,.*?FROM/s, 'SELECT COUNT(DISTINCT p.producto_id) FROM')
            .replace(/GROUP BY.*/, '')
            .replace(/ORDER BY.*/, '')
            .replace(/LIMIT \$\d+ OFFSET \$\d+/, '');

        const countResult = await query(countQuery, params.slice(0, -2));
        const total = parseInt(countResult.rows[0]?.count || 0);

        // Estadísticas de los productos de esta marca
        const statsQuery = await query(
            `SELECT 
         COUNT(*) as total_productos,
         COUNT(CASE WHEN p.activo = true THEN 1 END) as productos_activos,
         COUNT(CASE WHEN p.es_promocion = true THEN 1 END) as productos_en_promocion,
         AVG(p.precio_venta) as precio_promedio,
         MIN(p.precio_venta) as precio_minimo,
         MAX(p.precio_venta) as precio_maximo,
         SUM(CASE WHEN vp.stock_disponible > 0 THEN 1 ELSE 0 END) as productos_con_stock
       FROM productos p
       LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id AND vp.activo = true
       WHERE p.marca_id = $1`,
            [id]
        );

        res.json({
            success: true,
            data: {
                productos: result.rows,
                estadisticas: statsQuery.rows[0]
            },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    });

    // =============================================
    // 8. OBTENER ESTADÍSTICAS DE MARCAS
    // =============================================
    static getBrandStats = asyncHandler(async (req, res) => {
        const {
            startDate,
            endDate,
            limit = 10
        } = req.query;

        const params = [];
        let paramCount = 0;
        let dateFilter = '';

        if (startDate) {
            paramCount++;
            dateFilter += ` AND v.fecha_venta >= $${paramCount}`;
            params.push(startDate);
        }

        if (endDate) {
            paramCount++;
            dateFilter += ` AND v.fecha_venta <= $${paramCount}`;
            params.push(endDate);
        }

        // Marcas más vendidas
        const topSellingBrands = await query(
            `SELECT 
         m.marca_id,
         m.nombre,
         m.pais_origen,
         COUNT(DISTINCT v.venta_id) as ventas_totales,
         SUM(dv.cantidad) as unidades_vendidas,
         SUM(dv.precio_total) as ingresos_totales,
         AVG(dv.precio_total) as promedio_venta
       FROM marcas m
       JOIN productos p ON m.marca_id = p.marca_id
       JOIN variantes_producto vp ON p.producto_id = vp.producto_id
       JOIN detalles_venta dv ON vp.variante_id = dv.variante_id
       JOIN ventas v ON dv.venta_id = v.venta_id
       WHERE v.estado_venta = 'Pagada'
         AND m.activa = true
         ${dateFilter}
       GROUP BY m.marca_id, m.nombre, m.pais_origen
       ORDER BY unidades_vendidas DESC
       LIMIT $${paramCount + 1}`,
            [...params, limit]
        );

        // Marcas con más productos
        const brandsWithMostProducts = await query(
            `SELECT 
         m.marca_id,
         m.nombre,
         COUNT(p.producto_id) as total_productos,
         COUNT(CASE WHEN p.activo = true THEN 1 END) as productos_activos,
         COUNT(CASE WHEN p.es_promocion = true THEN 1 END) as productos_promocion
       FROM marcas m
       LEFT JOIN productos p ON m.marca_id = p.marca_id
       WHERE m.activa = true
       GROUP BY m.marca_id, m.nombre
       ORDER BY total_productos DESC
       LIMIT $1`,
            [limit]
        );

        // Marcas por país
        const brandsByCountry = await query(
            `SELECT 
         m.pais_origen,
         COUNT(DISTINCT m.marca_id) as total_marcas,
         COUNT(DISTINCT p.producto_id) as total_productos,
         AVG(p.precio_venta) as precio_promedio
       FROM marcas m
       LEFT JOIN productos p ON m.marca_id = p.marca_id
       WHERE m.pais_origen IS NOT NULL
       GROUP BY m.pais_origen
       ORDER BY total_marcas DESC`
        );

        // Marcas sin productos
        const brandsWithoutProducts = await query(
            `SELECT 
         m.*
       FROM marcas m
       LEFT JOIN productos p ON m.marca_id = p.marca_id
       WHERE p.producto_id IS NULL
         AND m.activa = true
       ORDER BY m.nombre`
        );

        // Marcas recientemente añadidas
        const recentBrands = await query(
            `SELECT 
         m.*,
         (SELECT COUNT(*) FROM productos p WHERE p.marca_id = m.marca_id) as total_productos
       FROM marcas m
       WHERE m.fecha_registro >= CURRENT_DATE - INTERVAL '30 days'
       ORDER BY m.fecha_registro DESC
       LIMIT 10`
        );

        res.json({
            success: true,
            data: {
                mas_vendidas: topSellingBrands.rows,
                mas_productos: brandsWithMostProducts.rows,
                por_pais: brandsByCountry.rows,
                sin_productos: brandsWithoutProducts.rows,
                recientes: recentBrands.rows
            }
        });
    });

    // =============================================
    // 9. OBTENER MARCAS POR PAÍS
    // =============================================
    static getBrandsByCountry = asyncHandler(async (req, res) => {
        const { pais } = req.params;

        const result = await query(
            `SELECT 
         m.*,
         COUNT(DISTINCT p.producto_id) as total_productos,
         COUNT(DISTINCT CASE WHEN p.activo = true THEN p.producto_id END) as productos_activos
       FROM marcas m
       LEFT JOIN productos p ON m.marca_id = p.marca_id
       WHERE m.pais_origen ILIKE $1 AND m.activa = true
       GROUP BY m.marca_id
       ORDER BY m.nombre`,
            [`%${pais}%`]
        );

        // Estadísticas del país
        const countryStats = await query(
            `SELECT 
         COUNT(DISTINCT m.marca_id) as total_marcas,
         COUNT(DISTINCT p.producto_id) as total_productos,
         AVG(p.precio_venta) as precio_promedio,
         MIN(p.precio_venta) as precio_minimo,
         MAX(p.precio_venta) as precio_maximo
       FROM marcas m
       LEFT JOIN productos p ON m.marca_id = p.marca_id
       WHERE m.pais_origen ILIKE $1`,
            [`%${pais}%`]
        );

        res.json({
            success: true,
            data: {
                marcas: result.rows,
                estadisticas: countryStats.rows[0],
                pais: pais
            }
        });
    });

    // =============================================
    // 10. OBTENER TODAS LAS MARCAS (SIMPLIFICADO PARA SELECT)
    // =============================================
    static getAllBrandsSimple = asyncHandler(async (req, res) => {
        const { activa = true } = req.query;

        const result = await query(
            `SELECT 
         marca_id,
         nombre,
         pais_origen,
         activa,
         (SELECT COUNT(*) FROM productos p WHERE p.marca_id = m.marca_id AND p.activo = true) as productos_activos
       FROM marcas m
       WHERE activa = $1
       ORDER BY nombre`,
            [activa === 'true']
        );

        res.json({
            success: true,
            data: result.rows
        });
    });

    // =============================================
    // 11. OBTENER MARCAS CON MÁS VENTAS
    // =============================================
    static getTopSellingBrands = asyncHandler(async (req, res) => {
        const { limit = 10, periodo = '30' } = req.query;

        const result = await query(
            `SELECT 
         m.marca_id,
         m.nombre,
         m.pais_origen,
         COUNT(DISTINCT v.venta_id) as ventas_totales,
         SUM(dv.cantidad) as unidades_vendidas,
         SUM(dv.precio_total) as ingresos_totales,
         RANK() OVER (ORDER BY SUM(dv.cantidad) DESC) as ranking
       FROM marcas m
       JOIN productos p ON m.marca_id = p.marca_id
       JOIN variantes_producto vp ON p.producto_id = vp.producto_id
       JOIN detalles_venta dv ON vp.variante_id = dv.variante_id
       JOIN ventas v ON dv.venta_id = v.venta_id
       WHERE v.estado_venta = 'Pagada'
         AND v.fecha_venta >= CURRENT_DATE - INTERVAL '${periodo} days'
       GROUP BY m.marca_id, m.nombre, m.pais_origen
       ORDER BY unidades_vendidas DESC
       LIMIT $1`,
            [limit]
        );

        res.json({
            success: true,
            data: result.rows,
            periodo: `${periodo} días`
        });
    });

    // =============================================
    // 12. OBTENER MARCAS CON STOCK BAJO
    // =============================================
    static getBrandsWithLowStock = asyncHandler(async (req, res) => {
        const { limite_stock = 10 } = req.query;

        const result = await query(
            `SELECT 
         m.marca_id,
         m.nombre,
         COUNT(DISTINCT p.producto_id) as productos_con_stock_bajo,
         SUM(CASE WHEN COALESCE(vp.stock_disponible, 0) <= p.stock_minimo THEN 1 ELSE 0 END) as productos_criticos,
         ARRAY_AGG(
           DISTINCT jsonb_build_object(
             'producto_id', p.producto_id,
             'nombre', p.nombre,
             'stock_disponible', COALESCE(SUM(vp.stock_disponible), 0),
             'stock_minimo', p.stock_minimo
           )
         ) as productos_detalle
       FROM marcas m
       JOIN productos p ON m.marca_id = p.marca_id
       LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id AND vp.activo = true
       WHERE p.activo = true
       GROUP BY m.marca_id, m.nombre
       HAVING SUM(CASE WHEN COALESCE(vp.stock_disponible, 0) <= p.stock_minimo THEN 1 ELSE 0 END) > 0
       ORDER BY productos_criticos DESC`
        );

        res.json({
            success: true,
            data: result.rows
        });
    });

    // =============================================
    // 13. IMPORTAR MARCAS (LOTE)
    // =============================================
    static importBrands = asyncHandler(async (req, res) => {
        const { marcas } = req.body;
        const currentUser = req.user;

        if (!Array.isArray(marcas) || marcas.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere un array de marcas'
            });
        }

        if (marcas.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'No se pueden importar más de 100 marcas a la vez'
            });
        }

        const client = await getClient();

        try {
            await client.query('BEGIN');

            const importedBrands = [];
            const errors = [];
            let createdCount = 0;
            let updatedCount = 0;

            for (const marcaData of marcas) {
                try {
                    const { nombre, descripcion, pais_origen, sitio_web, contacto_email, activa = true } = marcaData;

                    // Validación básica
                    if (!nombre) {
                        errors.push(`Marca sin nombre: ${JSON.stringify(marcaData)}`);
                        continue;
                    }

                    // Verificar si ya existe
                    const existingBrand = await client.query(
                        'SELECT marca_id FROM marcas WHERE nombre = $1',
                        [nombre]
                    );

                    let result;
                    if (existingBrand.rows.length > 0) {
                        // Actualizar marca existente
                        result = await client.query(
                            `UPDATE marcas 
               SET descripcion = COALESCE($1, descripcion),
                   pais_origen = COALESCE($2, pais_origen),
                   sitio_web = COALESCE($3, sitio_web),
                   contacto_email = COALESCE($4, contacto_email),
                   activa = COALESCE($5, activa)
               WHERE marca_id = $6
               RETURNING *`,
                            [descripcion, pais_origen, sitio_web, contacto_email, activa, existingBrand.rows[0].marca_id]
                        );
                        updatedCount++;
                    } else {
                        // Crear nueva marca
                        result = await client.query(
                            `INSERT INTO marcas (
                nombre, descripcion, pais_origen, 
                sitio_web, contacto_email, activa
              ) VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING *`,
                            [nombre, descripcion || null, pais_origen || null,
                                sitio_web || null, contacto_email || null, activa]
                        );
                        createdCount++;
                    }

                    importedBrands.push({
                        ...result.rows[0],
                        action: existingBrand.rows.length > 0 ? 'updated' : 'created'
                    });

                } catch (error) {
                    errors.push(`Error procesando marca ${marcaData.nombre}: ${error.message}`);
                }
            }

            await client.query('COMMIT');

            // Registrar auditoría
            await query(
                `INSERT INTO auditorias (
          tabla_afectada, accion, id_registro,
          datos_nuevos, realizado_por, ip_address, detalles
        ) VALUES (
          'marcas', 'IMPORT', NULL,
          $1, $2, $3, $4
        )`,
                [
                    JSON.stringify({ total: marcas.length, creadas: createdCount, actualizadas: updatedCount }),
                    currentUser?.usuario_id || null,
                    req.ip,
                    `Importación de ${marcas.length} marcas`
                ]
            );

            logger.info(`Importación de marcas: ${createdCount} creadas, ${updatedCount} actualizadas por ${currentUser?.email}`);

            res.json({
                success: true,
                message: `Importación completada: ${createdCount} creadas, ${updatedCount} actualizadas`,
                data: {
                    total: marcas.length,
                    creadas: createdCount,
                    actualizadas: updatedCount,
                    errores: errors.length,
                    marcas: importedBrands,
                    errors: errors.length > 0 ? errors : undefined
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
    // 14. EXPORTAR MARCAS
    // =============================================
    static exportBrands = asyncHandler(async (req, res) => {
        const { format = 'json', activa } = req.query;

        let whereClause = '';
        const params = [];

        if (activa !== undefined) {
            whereClause = 'WHERE activa = $1';
            params.push(activa === 'true');
        }

        const result = await query(
            `SELECT 
         m.*,
         (SELECT COUNT(*) FROM productos p WHERE p.marca_id = m.marca_id) as total_productos,
         (SELECT COUNT(*) FROM productos p WHERE p.marca_id = m.marca_id AND p.activo = true) as productos_activos,
         (SELECT COUNT(*) FROM productos p WHERE p.marca_id = m.marca_id AND p.es_promocion = true) as productos_promocion
       FROM marcas m
       ${whereClause}
       ORDER BY m.nombre`,
            params
        );

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
            res.header('Content-Disposition', 'attachment; filename=marcas.csv');
            res.send(csv);
        } else {
            // JSON por defecto
            res.json({
                success: true,
                data: result.rows,
                count: result.rows.length,
                exported_at: new Date().toISOString(),
                format: 'json'
            });
        }
    });

    // =============================================
    // 15. OBTENER LOGO/MARCA SUGERIDO (PARA AUTOMATIZACIÓN)
    // =============================================
    static getBrandLogo = asyncHandler(async (req, res) => {
        const { id } = req.params;

        const result = await query(
            `SELECT 
         m.nombre,
         m.sitio_web,
         (SELECT logo_url FROM configuraciones_tienda WHERE clave = 'brand.logo.default') as logo_default
       FROM marcas m
       WHERE m.marca_id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Marca no encontrada'
            });
        }

        const brand = result.rows[0];

        // En una implementación real, aquí buscarías el logo automáticamente
        // Por ahora devolvemos información para obtenerlo
        const logoInfo = {
            nombre: brand.nombre,
            sitio_web: brand.sitio_web,
            sugerencias: {
                google_images: `https://www.google.com/search?q=${encodeURIComponent(brand.nombre)}+logo&tbm=isch`,
                clearbit: brand.sitio_web ? `https://logo.clearbit.com/${new URL(brand.sitio_web).hostname}` : null,
                default_logo: brand.logo_default
            }
        };

        res.json({
            success: true,
            data: logoInfo
        });
    });
}

export default BrandController;