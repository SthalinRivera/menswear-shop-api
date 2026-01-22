import { query, getClient } from '../config/database.js';
import { validationSchemas, validate } from '../middlewares/validationMiddleware.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { PAGINATION } from '../config/constants.js';


class ProductController {
    // Obtener todos los productos con filtros
    static getProductsCatalog = asyncHandler(async (req, res) => {
        const {
            page = 1,
            limit = PAGINATION.DEFAULT_LIMIT,
            q = '',
            categoria_id,
            marca_id,
            genero,
            minPrice,
            maxPrice,
            enPromocion,
            sortBy = 'fecha_creacion',
            sortOrder = 'desc'
        } = req.query;

        const offset = (page - 1) * limit;

        // ============================
        // 1) QUERY PRINCIPAL (PRODUCTOS)
        // ============================

        //         let queryStr = `
        //     SELECT p.*, 
        //            c.nombre AS categoria_nombre,
        //            m.nombre AS marca_nombre,
        //            COALESCE((
        //              SELECT SUM(vp.stock_disponible) 
        //              FROM variantes_producto vp 
        //              WHERE vp.producto_id = p.producto_id 
        //                AND vp.activo = true
        //            ), 0) AS stock_total
        //     FROM productos p
        //     LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
        //     LEFT JOIN marcas m ON p.marca_id = m.marca_id
        //     WHERE p.activo = true
        //   `;
        let queryStr = `
SELECT 
  p.*, 
  c.nombre AS categoria_nombre,
  m.nombre AS marca_nombre,

  COALESCE((
    SELECT json_agg(
      json_build_object(
        'url', ip.url_imagen,
        'es_principal', ip.es_principal,
        'orden', ip.orden
      )
      ORDER BY ip.orden
    )
    FROM imagenes_producto ip
    WHERE ip.producto_id = p.producto_id
      AND ip.activo = true
  ), '[]') AS imagenes,

  COALESCE((
    SELECT SUM(vp.stock_disponible) 
    FROM variantes_producto vp 
    WHERE vp.producto_id = p.producto_id 
      AND vp.activo = true
  ), 0) AS stock_total,

  -- CALCULAR PRECIO PROMOCIÓN SI EXISTE DESCUENTO
  CASE 
    WHEN p.es_promocion = true 
      AND p.porcentaje_descuento > 0
      AND CURRENT_DATE BETWEEN COALESCE(p.fecha_inicio_promocion, CURRENT_DATE) 
                          AND COALESCE(p.fecha_fin_promocion, CURRENT_DATE)
    THEN ROUND(p.precio_final * (1 - p.porcentaje_descuento / 100), 2)
    ELSE NULL
  END AS precio_promocion_calculado

FROM productos p
LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
LEFT JOIN marcas m ON p.marca_id = m.marca_id
WHERE p.activo = true
`;


        const params = [];
        let paramCount = 0;

        // Filtros
        if (q) {
            paramCount++;
            queryStr += ` AND (p.nombre ILIKE $${paramCount} 
                   OR p.sku ILIKE $${paramCount}
                   OR p.descripcion ILIKE $${paramCount})`;
            params.push(`%${q}%`);
        }

        if (categoria_id) {
            paramCount++;
            queryStr += ` AND p.categoria_id IN (
      SELECT categoria_id FROM categorias 
      WHERE categoria_id = $${paramCount} 
         OR categoria_padre_id = $${paramCount}
    )`;
            params.push(categoria_id);
        }

        if (marca_id) {
            paramCount++;
            queryStr += ` AND p.marca_id = $${paramCount}`;
            params.push(marca_id);
        }

        if (genero) {
            paramCount++;
            queryStr += ` AND p.genero = $${paramCount}`;
            params.push(genero);
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
            queryStr += ` AND p.es_promocion = true 
                  AND CURRENT_DATE BETWEEN p.fecha_inicio_promocion 
                                      AND p.fecha_fin_promocion`;
        }

        // Ordenamiento
        const validSortColumns = ['nombre', 'precio_final', 'fecha_creacion', 'stock_total'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'fecha_creacion';

        if (sortColumn === 'stock_total') {
            queryStr += ` ORDER BY stock_total ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
        } else {
            queryStr += ` ORDER BY p.${sortColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
        }

        // Paginación   
        paramCount++;
        queryStr += ` LIMIT $${paramCount}`;
        params.push(limit);

        paramCount++;
        queryStr += ` OFFSET $${paramCount}`;
        params.push(offset);

        const result = await query(queryStr, params);

        // ============================
        // 2) QUERY DE TOTAL (COUNT)
        // ============================

        let countQuery = `
    SELECT COUNT(*)
    FROM productos p
    LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
    LEFT JOIN marcas m ON p.marca_id = m.marca_id
    WHERE p.activo = true
  `;

        const countParams = [];
        let countParamCount = 0;

        if (q) {
            countParamCount++;
            countQuery += ` AND (p.nombre ILIKE $${countParamCount} 
                     OR p.sku ILIKE $${countParamCount}
                     OR p.descripcion ILIKE $${countParamCount})`;
            countParams.push(`%${q}%`);
        }

        if (categoria_id) {
            countParamCount++;
            countQuery += ` AND p.categoria_id IN (
      SELECT categoria_id FROM categorias 
      WHERE categoria_id = $${countParamCount} 
         OR categoria_padre_id = $${countParamCount}
    )`;
            countParams.push(categoria_id);
        }

        if (marca_id) {
            countParamCount++;
            countQuery += ` AND p.marca_id = $${countParamCount}`;
            countParams.push(marca_id);
        }

        if (genero) {
            countParamCount++;
            countQuery += ` AND p.genero = $${countParamCount}`;
            countParams.push(genero);
        }

        if (minPrice) {
            countParamCount++;
            countQuery += ` AND p.precio_final >= $${countParamCount}`;
            countParams.push(minPrice);
        }

        if (maxPrice) {
            countParamCount++;
            countQuery += ` AND p.precio_final <= $${countParamCount}`;
            countParams.push(maxPrice);
        }

        if (enPromocion === 'true') {
            countQuery += ` AND p.es_promocion = true 
                    AND CURRENT_DATE BETWEEN p.fecha_inicio_promocion 
                                        AND p.fecha_fin_promocion`;
        }

        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        // ============================
        // 3) VARIANTES POR PRODUCTO
        // ============================

        const productsWithVariants = await Promise.all(
            result.rows.map(async (product) => {
                const variantsResult = await query(
                    `SELECT vp.*, 
            COALESCE(SUM(i.cantidad), 0) AS stock_total_almacenes
            FROM variantes_producto vp
            LEFT JOIN inventario i 
                ON vp.variante_id = i.variante_id
            WHERE vp.producto_id = $1 
            AND vp.activo = true
            GROUP BY vp.variante_id
            ORDER BY vp.talla, vp.color_nombre`,
                    [product.producto_id]
                );

                return {
                    ...product,
                    precio_promocion: product.precio_promocion_calculado, // Usar el calculado
                    variantes: variantsResult.rows,

                };
            })
        );

        // ============================
        // 4) RESPUESTA FINAL
        // ============================

        res.json({
            success: true,
            data: productsWithVariants,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    });

    static getProducts = asyncHandler(async (req, res) => {
        const {
            page = 1,
            limit = PAGINATION.DEFAULT_LIMIT,
            q = '',
            categoria_id,
            marca_id,
            genero,
            minPrice,
            maxPrice,
            enPromocion,
            activo,
            sortBy = 'fecha_creacion',
            sortOrder = 'desc'
        } = req.query;

        const offset = (page - 1) * limit;

        // ============================
        // 1) QUERY PRINCIPAL (PRODUCTOS)
        // ============================

        //         let queryStr = `
        //     SELECT p.*, 
        //            c.nombre AS categoria_nombre,
        //            m.nombre AS marca_nombre,
        //            COALESCE((
        //              SELECT SUM(vp.stock_disponible) 
        //              FROM variantes_producto vp 
        //              WHERE vp.producto_id = p.producto_id 
        //                AND vp.activo = true
        //            ), 0) AS stock_total
        //     FROM productos p
        //     LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
        //     LEFT JOIN marcas m ON p.marca_id = m.marca_id
        //     WHERE p.activo = true
        //   `;
        let queryStr = `
SELECT 
  p.*, 
  c.nombre AS categoria_nombre,
  m.nombre AS marca_nombre,

  COALESCE((
    SELECT json_agg(
      json_build_object(
        'url', ip.url_imagen,
        'es_principal', ip.es_principal,
        'orden', ip.orden
      )
      ORDER BY ip.orden
    )
    FROM imagenes_producto ip
    WHERE ip.producto_id = p.producto_id
      AND ip.activo = true
  ), '[]') AS imagenes,

  COALESCE((
    SELECT SUM(vp.stock_disponible) 
    FROM variantes_producto vp 
    WHERE vp.producto_id = p.producto_id 
      AND vp.activo = true
  ), 0) AS stock_total

FROM productos p
LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
LEFT JOIN marcas m ON p.marca_id = m.marca_id
WHERE 1=1
`;
        if (activo !== undefined) {
            paramCount++
            queryStr += ` AND p.activo = $${paramCount}`
            params.push(activo === 'true')
        }

        const params = [];
        let paramCount = 0;

        // Filtros
        if (q) {
            paramCount++;
            queryStr += ` AND (p.nombre ILIKE $${paramCount} 
                   OR p.sku ILIKE $${paramCount}
                   OR p.descripcion ILIKE $${paramCount})`;
            params.push(`%${q}%`);
        }

        if (categoria_id) {
            paramCount++;
            queryStr += ` AND p.categoria_id IN (
      SELECT categoria_id FROM categorias 
      WHERE categoria_id = $${paramCount} 
         OR categoria_padre_id = $${paramCount}
    )`;
            params.push(categoria_id);
        }

        if (marca_id) {
            paramCount++;
            queryStr += ` AND p.marca_id = $${paramCount}`;
            params.push(marca_id);
        }

        if (genero) {
            paramCount++;
            queryStr += ` AND p.genero = $${paramCount}`;
            params.push(genero);
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
            queryStr += ` AND p.es_promocion = true 
                  AND CURRENT_DATE BETWEEN p.fecha_inicio_promocion 
                                      AND p.fecha_fin_promocion`;
        }

        // Ordenamiento
        const validSortColumns = ['nombre', 'precio_final', 'fecha_creacion', 'stock_total'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'fecha_creacion';

        if (sortColumn === 'stock_total') {
            queryStr += ` ORDER BY stock_total ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
        } else {
            queryStr += ` ORDER BY p.${sortColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
        }

        // Paginación
        paramCount++;
        queryStr += ` LIMIT $${paramCount}`;
        params.push(limit);

        paramCount++;
        queryStr += ` OFFSET $${paramCount}`;
        params.push(offset);

        const result = await query(queryStr, params);

        // ============================
        // 2) QUERY DE TOTAL (COUNT)
        // ============================

        let countQuery = `
    SELECT COUNT(*)
    FROM productos p
    LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
    LEFT JOIN marcas m ON p.marca_id = m.marca_id
    WHERE 1=1
  `;
        if (activo !== undefined) {
            countParamCount++
            countQuery += ` AND p.activo = $${countParamCount}`
            countParams.push(activo === 'true')
        }
        const countParams = [];
        let countParamCount = 0;

        if (q) {
            countParamCount++;
            countQuery += ` AND (p.nombre ILIKE $${countParamCount} 
                     OR p.sku ILIKE $${countParamCount}
                     OR p.descripcion ILIKE $${countParamCount})`;
            countParams.push(`%${q}%`);
        }

        if (categoria_id) {
            countParamCount++;
            countQuery += ` AND p.categoria_id IN (
      SELECT categoria_id FROM categorias 
      WHERE categoria_id = $${countParamCount} 
         OR categoria_padre_id = $${countParamCount}
    )`;
            countParams.push(categoria_id);
        }

        if (marca_id) {
            countParamCount++;
            countQuery += ` AND p.marca_id = $${countParamCount}`;
            countParams.push(marca_id);
        }

        if (genero) {
            countParamCount++;
            countQuery += ` AND p.genero = $${countParamCount}`;
            countParams.push(genero);
        }

        if (minPrice) {
            countParamCount++;
            countQuery += ` AND p.precio_final >= $${countParamCount}`;
            countParams.push(minPrice);
        }

        if (maxPrice) {
            countParamCount++;
            countQuery += ` AND p.precio_final <= $${countParamCount}`;
            countParams.push(maxPrice);
        }

        if (enPromocion === 'true') {
            countQuery += ` AND p.es_promocion = true 
                    AND CURRENT_DATE BETWEEN p.fecha_inicio_promocion 
                                        AND p.fecha_fin_promocion`;
        }

        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);

        // ============================
        // 3) VARIANTES POR PRODUCTO
        // ============================

        const productsWithVariants = await Promise.all(
            result.rows.map(async (product) => {
                const variantsResult = await query(
                    `SELECT vp.*, 
                COALESCE(SUM(i.cantidad), 0) AS stock_total_almacenes
         FROM variantes_producto vp
         LEFT JOIN inventario i 
                ON vp.variante_id = i.variante_id
         WHERE vp.producto_id = $1 
           AND vp.activo = true
         GROUP BY vp.variante_id
         ORDER BY vp.talla, vp.color_nombre`,
                    [product.producto_id]
                );

                return {
                    ...product,
                    variantes: variantsResult.rows,

                };
            })
        );

        // ============================
        // 4) RESPUESTA FINAL
        // ============================

        res.json({
            success: true,
            data: productsWithVariants,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    });

    // Obtener producto por ID
    static getProductById = asyncHandler(async (req, res) => {
        const { id } = req.params;

        // Query principal con imágenes y stock total
        const result = await query(
            `
        SELECT 
            p.*, 
            c.nombre AS categoria_nombre,
            m.nombre AS marca_nombre,
            COALESCE((
                SELECT json_agg(
                    json_build_object(
                        'imagen_id', ip.imagen_id,
                        'url', ip.url_imagen,
                        'es_principal', ip.es_principal,
                        'orden', ip.orden
                    )
                    ORDER BY ip.orden
                )
                FROM imagenes_producto ip
                WHERE ip.producto_id = p.producto_id
                  AND ip.activo = true
            ), '[]') AS imagenes,
            COALESCE((
                SELECT SUM(vp.stock_disponible) 
                FROM variantes_producto vp 
                WHERE vp.producto_id = p.producto_id
                  AND vp.activo = true
            ), 0) AS stock_total,
            -- AÑADIR ESTE CÁLCULO
            CASE 
                WHEN p.es_promocion = true 
                  AND p.porcentaje_descuento > 0
                  AND CURRENT_DATE BETWEEN COALESCE(p.fecha_inicio_promocion, CURRENT_DATE) 
                                      AND COALESCE(p.fecha_fin_promocion, CURRENT_DATE)
                THEN ROUND(p.precio_final * (1 - p.porcentaje_descuento / 100), 2)
                ELSE NULL
            END AS precio_promocion_calculado
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
        LEFT JOIN marcas m ON p.marca_id = m.marca_id
        WHERE p.producto_id = $1
          AND p.activo = true
        `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        const product = result.rows[0];

        // Variantes
        const variantsResult = await query(
            `SELECT vp.*, 
            json_agg(
                json_build_object(
                    'almacen_id', i.almacen_id,
                    'nombre', a.nombre,
                    'cantidad', i.cantidad,
                    'ubicacion', i.ubicacion
                )
            ) AS inventario
         FROM variantes_producto vp
         LEFT JOIN inventario i ON vp.variante_id = i.variante_id
         LEFT JOIN almacenes a ON i.almacen_id = a.almacen_id
         WHERE vp.producto_id = $1 AND vp.activo = true
         GROUP BY vp.variante_id
         ORDER BY vp.talla, vp.color_nombre`,
            [id]
        );

        // Reseñas
        const reviewsResult = await query(
            `SELECT r.*, 
            c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
         FROM reseñas_productos r
         LEFT JOIN clientes c ON r.cliente_id = c.cliente_id
         WHERE r.producto_id = $1 AND r.aprobada = true
         ORDER BY r.fecha_creacion DESC
         LIMIT 10`,
            [id]
        );

        // Productos relacionados
        const relatedResult = await query(
            `SELECT p.producto_id, p.sku, p.nombre, p.precio_final, p.es_promocion, p.precio_promocion,
            (SELECT COUNT(*) FROM variantes_producto vp WHERE vp.producto_id = p.producto_id AND vp.stock_disponible > 0) AS tiene_stock
         FROM productos p
         WHERE p.categoria_id = $1
           AND p.producto_id != $2
           AND p.activo = true
         ORDER BY RANDOM()
         LIMIT 6`,
            [product.categoria_id, id]
        );

        // Historial de precios
        const priceHistoryResult = await query(
            `SELECT * FROM historial_precios 
         WHERE producto_id = $1 
         ORDER BY fecha_cambio DESC
         LIMIT 10`,
            [id]
        );

        res.json({
            success: true,
            data: {
                ...product,
                variantes: variantsResult.rows,
                reseñas: reviewsResult.rows,
                productos_relacionados: relatedResult.rows,
                historial_precios: priceHistoryResult.rows
            }
        });
    });

    // Crear nuevo producto
    static createProduct = [
        validate(validationSchemas.createProduct),
        asyncHandler(async (req, res) => {
            const client = await getClient();

            try {
                await client.query('BEGIN');

                const {
                    sku, nombre, descripcion, categoria_id, marca_id,
                    genero, temporada, material_principal, cuidados,
                    precio_compra, precio_venta, impuesto_porcentaje,
                    stock_minimo, stock_maximo
                } = req.body;

                // Verificar si SKU ya existe
                const existingProduct = await client.query(
                    'SELECT producto_id FROM productos WHERE sku = $1',
                    [sku]
                );

                if (existingProduct.rows.length > 0) {
                    return res.status(409).json({
                        success: false,
                        message: 'El SKU ya está en uso'
                    });
                }

                // Insertar producto
                const productResult = await client.query(
                    `INSERT INTO productos (
            sku, nombre, descripcion, categoria_id, marca_id,
            genero, temporada, material_principal, cuidados,
            precio_compra, precio_venta, impuesto_porcentaje,
            stock_minimo, stock_maximo
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *`,
                    [
                        sku, nombre, descripcion || null, categoria_id, marca_id || null,
                        genero || 'Unisex', temporada || 'Todo el año', material_principal || null, cuidados || null,
                        precio_compra, precio_venta, impuesto_porcentaje || 16.00,
                        stock_minimo || 5, stock_maximo || 100
                    ]
                );

                const newProduct = productResult.rows[0];

                // Registrar en historial de precios
                await client.query(
                    `INSERT INTO historial_precios (producto_id, precio_anterior, precio_nuevo, motivo, cambiado_por)
           VALUES ($1, NULL, $2, 'Otro', $3)`,
                    [newProduct.producto_id, precio_venta, req.user.empleado_id || null]
                );

                await client.query('COMMIT');

                res.status(201).json({
                    success: true,
                    message: 'Producto creado exitosamente',
                    data: newProduct
                });

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        })
    ];

    // Actualizar producto
    static updateProduct = [
        validate(validationSchemas.updateProduct),
        asyncHandler(async (req, res) => {
            const { id } = req.params;
            const updateData = { ...req.body }; // clonamos para no mutar req.body

            // Extraer motivo_cambio y eliminar del objeto updateData
            const motivoCambio = updateData.motivo_cambio || 'Otro';
            delete updateData.motivo_cambio;

            // Verificar si el producto existe
            const existingProduct = await query(
                'SELECT precio_venta FROM productos WHERE producto_id = $1',
                [id]
            );

            if (existingProduct.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Producto no encontrado'
                });
            }

            const oldPrice = existingProduct.rows[0].precio_venta;

            // Construir query de actualización dinámica
            const fields = [];
            const values = [];
            let paramCount = 1;

            Object.keys(updateData).forEach(key => {
                if (key !== 'producto_id') {
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
      UPDATE productos 
      SET ${fields.join(', ')}, fecha_actualizacion = NOW()
      WHERE producto_id = $${paramCount}
      RETURNING *
    `;

            const result = await query(queryStr, values);
            const updatedProduct = result.rows[0];

            // Registrar cambio de precio si aplica
            if (updateData.precio_venta && updateData.precio_venta !== oldPrice) {
                await query(
                    `INSERT INTO historial_precios (producto_id, precio_anterior, precio_nuevo, motivo, cambiado_por)
         VALUES ($1, $2, $3, $4, $5)`,
                    [id, oldPrice, updateData.precio_venta, motivoCambio, req.user.empleado_id || null]
                );
            }

            res.json({
                success: true,
                message: 'Producto actualizado exitosamente',
                data: updatedProduct
            });
        })
    ];

    // Eliminar producto (soft delete)
    static deleteProduct = asyncHandler(async (req, res) => {
        const { id } = req.params;

        // Verificar si el producto existe
        const existingProduct = await query(
            'SELECT producto_id FROM productos WHERE producto_id = $1 AND activo = true',
            [id]
        );

        if (existingProduct.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        // Verificar si hay stock o ventas asociadas
        const stockCheck = await query(
            `SELECT EXISTS(
         SELECT 1 FROM variantes_producto 
         WHERE producto_id = $1 AND stock_disponible > 0
       ) as tiene_stock,
       EXISTS(
         SELECT 1 FROM detalles_venta dv
         JOIN variantes_producto vp ON dv.variante_id = vp.variante_id
         WHERE vp.producto_id = $1
       ) as tiene_ventas`,
            [id]
        );

        const { tiene_stock, tiene_ventas } = stockCheck.rows[0];

        if (tiene_stock) {
            return res.status(400).json({
                success: false,
                message: 'No se puede eliminar el producto porque aún tiene stock disponible'
            });
        }

        if (tiene_ventas) {
            // Soft delete
            await query(
                'UPDATE productos SET activo = false, fecha_actualizacion = NOW() WHERE producto_id = $1',
                [id]
            );

            // Desactivar variantes
            await query(
                'UPDATE variantes_producto SET activo = false WHERE producto_id = $1',
                [id]
            );

            res.json({
                success: true,
                message: 'Producto desactivado exitosamente (tiene historial de ventas)'
            });
        } else {
            // Hard delete (solo si no tiene ventas)
            const client = await getClient();

            try {
                await client.query('BEGIN');

                // Eliminar variantes primero
                await client.query(
                    'DELETE FROM variantes_producto WHERE producto_id = $1',
                    [id]
                );

                // Eliminar producto
                await client.query(
                    'DELETE FROM productos WHERE producto_id = $1',
                    [id]
                );

                await client.query('COMMIT');

                res.json({
                    success: true,
                    message: 'Producto eliminado permanentemente'
                });

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        }
    });

    // Obtener productos con stock bajo
    static getLowStockProducts = asyncHandler(async (req, res) => {
        const { limit = 50 } = req.query;

        const result = await query(
            `SELECT p.*, 
              c.nombre as categoria_nombre,
              m.nombre as marca_nombre,
              COALESCE(SUM(vp.stock_disponible), 0) as stock_total,
              p.stock_minimo,
              CASE 
                WHEN COALESCE(SUM(vp.stock_disponible), 0) <= p.stock_minimo THEN 'CRÍTICO'
                WHEN COALESCE(SUM(vp.stock_disponible), 0) <= (p.stock_minimo * 2) THEN 'BAJO'
                ELSE 'OK'
              END as estado_stock
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
       LEFT JOIN marcas m ON p.marca_id = m.marca_id
       LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id AND vp.activo = true
       WHERE p.activo = true
       GROUP BY p.producto_id, c.nombre, m.nombre
       HAVING COALESCE(SUM(vp.stock_disponible), 0) <= (p.stock_minimo * 2)
       ORDER BY estado_stock, stock_total
       LIMIT $1`,
            [limit]
        );

        res.json({
            success: true,
            data: result.rows
        });
    });
    // Activar/Desactivar producto
    static toggleProductStatus = asyncHandler(async (req, res) => {
        const { id } = req.params
        const { activo } = req.body

        // 1️⃣ Verificar que el producto exista
        const existingProduct = await query(
            'SELECT producto_id, activo FROM productos WHERE producto_id = $1',
            [id]
        )

        if (existingProduct.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            })
        }

        // 2️⃣ Actualizar estado
        const result = await query(
            `
    UPDATE productos
    SET activo = $1,
        fecha_actualizacion = NOW()
    WHERE producto_id = $2
    RETURNING producto_id, activo
    `,
            [activo, id]
        )

        // 3️⃣ (Opcional recomendado) Desactivar variantes si se desactiva el producto
        if (activo === false) {
            await query(
                'UPDATE variantes_producto SET activo = false WHERE producto_id = $1',
                [id]
            )
        }

        res.json({
            success: true,
            message: `Producto ${activo ? 'activado' : 'desactivado'} correctamente`,
            data: result.rows[0]
        })
    })

    // Crear variante de producto
    static createVariant = asyncHandler(async (req, res) => {
        const productoId = Number(req.params.producto_id);

        const {
            talla,
            color_nombre,
            color_hex,
            codigo_barras,
            stock_actual,
            ubicacion_almacen,
            activo
        } = req.body;

        if (!productoId) {
            return res.status(400).json({
                success: false,
                message: 'ID de producto inválido'
            });
        }

        // Verificar si el producto existe
        const productCheck = await query(
            'SELECT producto_id FROM productos WHERE producto_id = $1 AND activo = true',
            [productoId]
        );

        if (productCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        // Verificar combinación talla + color
        const existingVariant = await query(
            `SELECT variante_id 
         FROM variantes_producto 
         WHERE producto_id = $1 
           AND talla = $2 
           AND LOWER(color_nombre) = LOWER($3)`,
            [productoId, talla, color_nombre]
        );

        if (existingVariant.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Ya existe una variante con esta talla y color'
            });
        }

        // Insertar variante
        const result = await query(
            `INSERT INTO variantes_producto (
            producto_id,
            talla,
            color_nombre,
            color_hex,
            codigo_barras,
            stock_actual,
            ubicacion_almacen,
            activo,
            fecha_ultima_entrada
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, CURRENT_DATE
        )
        RETURNING *`,
            [
                productoId,
                talla,
                color_nombre,
                color_hex || null,
                codigo_barras || null,
                stock_actual ?? 0,
                ubicacion_almacen || null,
                activo ?? true
            ]
        );

        res.status(201).json({
            success: true,
            message: 'Variante creada exitosamente',
            data: result.rows[0]
        });
    });


    // Actualizar stock de variante
    static updateVariantStock = asyncHandler(async (req, res) => {
        const { variante_id } = req.params;
        const { cantidad, almacen_id, tipo_movimiento, motivo, costo_unitario } = req.body;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Obtener variante actual
            const variantResult = await client.query(
                'SELECT * FROM variantes_producto WHERE variante_id = $1',
                [variante_id]
            );

            if (variantResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Variante no encontrada'
                });
            }

            const variant = variantResult.rows[0];
            const newStock = tipo_movimiento === 'Entrada'
                ? variant.stock_actual + cantidad
                : variant.stock_actual - cantidad;

            if (newStock < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Stock insuficiente'
                });
            }

            // Actualizar stock
            await client.query(
                `UPDATE variantes_producto 
         SET stock_actual = $1, 
             fecha_${tipo_movimiento === 'Entrada' ? 'ultima_entrada' : 'ultima_salida'} = CURRENT_DATE
         WHERE variante_id = $2`,
                [newStock, variante_id]
            );

            // Actualizar inventario específico del almacén
            const inventoryResult = await client.query(
                `SELECT * FROM inventario 
         WHERE variante_id = $1 AND almacen_id = $2`,
                [variante_id, almacen_id]
            );

            if (inventoryResult.rows.length > 0) {
                // Actualizar inventario existente
                const currentQuantity = inventoryResult.rows[0].cantidad;
                const newQuantity = tipo_movimiento === 'Entrada'
                    ? currentQuantity + cantidad
                    : currentQuantity - cantidad;

                await client.query(
                    `UPDATE inventario 
           SET cantidad = $1, fecha_ultimo_conteo = CURRENT_DATE
           WHERE variante_id = $2 AND almacen_id = $3`,
                    [newQuantity, variante_id, almacen_id]
                );
            } else {
                // Crear nuevo registro de inventario
                await client.query(
                    `INSERT INTO inventario (variante_id, almacen_id, cantidad)
           VALUES ($1, $2, $3)`,
                    [variante_id, almacen_id, cantidad]
                );
            }

            // Registrar movimiento
            await client.query(
                `INSERT INTO movimientos_inventario (
          variante_id, almacen_id, tipo_movimiento, cantidad,
          cantidad_anterior, cantidad_nueva, empleado_id,
          motivo, costo_unitario, valor_total
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    variante_id, almacen_id, tipo_movimiento, cantidad,
                    variant.stock_actual, newStock, req.user.empleado_id,
                    motivo || 'Ajuste manual', costo_unitario || 0,
                    (costo_unitario || 0) * cantidad
                ]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Stock actualizado exitosamente',
                data: {
                    variante_id,
                    stock_anterior: variant.stock_actual,
                    stock_nuevo: newStock,
                    movimiento: tipo_movimiento,
                    cantidad: cantidad
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // Obtener estadísticas de productos
    static getProductStats = asyncHandler(async (req, res) => {
        const stats = {};

        // Productos más vendidos (últimos 30 días)
        const topSelling = await query(
            `SELECT p.producto_id, p.nombre, p.sku,
              SUM(dv.cantidad) as total_vendido,
              SUM(dv.precio_total) as ingresos_totales,
              COUNT(DISTINCT v.venta_id) as veces_vendido
       FROM detalles_venta dv
       JOIN variantes_producto vp ON dv.variante_id = vp.variante_id
       JOIN productos p ON vp.producto_id = p.producto_id
       JOIN ventas v ON dv.venta_id = v.venta_id
       WHERE v.estado_venta = 'Pagada'
         AND v.fecha_venta >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY p.producto_id, p.nombre, p.sku
       ORDER BY total_vendido DESC
       LIMIT 10`
        );

        stats.top_selling = topSelling.rows;

        // Productos con mejor margen
        const bestMargin = await query(
            `SELECT producto_id, nombre, sku,
              precio_compra, precio_venta, margen_ganancia
       FROM productos
       WHERE activo = true AND margen_ganancia > 0
       ORDER BY margen_ganancia DESC
       LIMIT 10`
        );

        stats.best_margin = bestMargin.rows;

        // Productos sin ventas (últimos 60 días)
        const noSales = await query(
            `SELECT p.producto_id, p.nombre, p.sku,
              p.fecha_creacion, p.stock_minimo,
              COALESCE(SUM(vp.stock_disponible), 0) as stock_actual
       FROM productos p
       LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id
       WHERE p.activo = true
         AND p.producto_id NOT IN (
           SELECT DISTINCT vp2.producto_id
           FROM detalles_venta dv
           JOIN variantes_producto vp2 ON dv.variante_id = vp2.variante_id
           JOIN ventas v ON dv.venta_id = v.venta_id
           WHERE v.fecha_venta >= CURRENT_DATE - INTERVAL '60 days'
         )
       GROUP BY p.producto_id, p.nombre, p.sku, p.fecha_creacion, p.stock_minimo
       ORDER BY p.fecha_creacion DESC
       LIMIT 10`
        );

        stats.no_sales = noSales.rows;

        // Productos próximos a agotarse
        const lowStock = await query(
            `SELECT p.producto_id, p.nombre, p.sku,
              COALESCE(SUM(vp.stock_disponible), 0) as stock_total,
              p.stock_minimo,
              CASE 
                WHEN COALESCE(SUM(vp.stock_disponible), 0) <= p.stock_minimo THEN 'CRÍTICO'
                WHEN COALESCE(SUM(vp.stock_disponible), 0) <= (p.stock_minimo * 2) THEN 'BAJO'
                ELSE 'OK'
              END as estado
       FROM productos p
       LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id AND vp.activo = true
       WHERE p.activo = true
       GROUP BY p.producto_id, p.nombre, p.sku, p.stock_minimo
       HAVING COALESCE(SUM(vp.stock_disponible), 0) <= (p.stock_minimo * 2)
       ORDER BY estado, stock_total
       LIMIT 10`
        );

        stats.low_stock = lowStock.rows;

        // Productos en promoción activa
        const activePromotions = await query(
            `SELECT producto_id, nombre, sku,
              precio_venta, precio_promocion, porcentaje_descuento,
              fecha_inicio_promocion, fecha_fin_promocion
       FROM productos
       WHERE activo = true 
         AND es_promocion = true
         AND CURRENT_DATE BETWEEN fecha_inicio_promocion AND fecha_fin_promocion
       ORDER BY porcentaje_descuento DESC
       LIMIT 10`
        );

        stats.active_promotions = activePromotions.rows;

        res.json({
            success: true,
            data: stats
        });
    });

    // Buscar productos por código de barras
    static searchByBarcode = asyncHandler(async (req, res) => {
        const { barcode } = req.params;

        const result = await query(
            `SELECT vp.*, p.*, 
              c.nombre as categoria_nombre,
              m.nombre as marca_nombre,
              json_agg(
                json_build_object(
                  'almacen_id', i.almacen_id,
                  'nombre', a.nombre,
                  'cantidad', i.cantidad
                )
              ) as inventario
       FROM variantes_producto vp
       JOIN productos p ON vp.producto_id = p.producto_id
       LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
       LEFT JOIN marcas m ON p.marca_id = m.marca_id
       LEFT JOIN inventario i ON vp.variante_id = i.variante_id
       LEFT JOIN almacenes a ON i.almacen_id = a.almacen_id
       WHERE vp.codigo_barras = $1 AND vp.activo = true AND p.activo = true
       GROUP BY vp.variante_id, p.producto_id, c.nombre, m.nombre
       LIMIT 1`,
            [barcode]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado con ese código de barras'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    });


    // Obtener variante por ID
    // Obtener variante por ID - VERSIÓN MÍNIMA
    static getVariantById = asyncHandler(async (req, res) => {
        const { producto_id, variante_id } = req.params;

        console.log('🔍 getVariantById:', { producto_id, variante_id });

        // Query directa y simple
        const result = await query(
            `SELECT vp.*, p.nombre as producto_nombre, p.sku as producto_sku
         FROM variantes_producto vp
         LEFT JOIN productos p ON vp.producto_id = p.producto_id
         WHERE vp.variante_id = $1 AND vp.producto_id = $2`,
            [variante_id, producto_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Variante no encontrada'
            });
        }

        const variant = result.rows[0];

        // Verificar si realmente pertenece al producto indicado
        if (variant.producto_id != producto_id) {
            return res.status(404).json({
                success: false,
                message: 'La variante no pertenece a este producto'
            });
        }

        res.json({
            success: true,
            data: variant
        });
    });

    // Actualizar variante
    // Actualizar variante - VERSIÓN CORREGIDA
    static updateVariant = [
        validate(validationSchemas.updateVariant),
        asyncHandler(async (req, res) => {
            const { producto_id, variante_id } = req.params;
            const updateData = req.body;

            console.log('🔍 Actualizando variante:', { producto_id, variante_id, updateData });

            const client = await getClient();

            try {
                await client.query('BEGIN');

                // 1. Verificar que la variante exista
                const variantCheck = await client.query(
                    `SELECT * FROM variantes_producto 
                WHERE variante_id = $1 
                    AND producto_id = $2`,
                    [variante_id, producto_id]
                );

                if (variantCheck.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        success: false,
                        message: 'Variante no encontrada'
                    });
                }

                const oldVariant = variantCheck.rows[0];

                // 2. Verificar duplicados (solo si se cambia talla o color)
                if (updateData.talla || updateData.color_nombre) {
                    const newTalla = updateData.talla || oldVariant.talla;
                    const newColor = updateData.color_nombre || oldVariant.color_nombre;

                    const duplicateCheck = await client.query(
                        `SELECT variante_id 
                    FROM variantes_producto 
                    WHERE producto_id = $1 
                        AND variante_id != $2
                        AND talla = $3 
                        AND LOWER(color_nombre) = LOWER($4)`,
                        [producto_id, variante_id, newTalla, newColor]
                    );

                    if (duplicateCheck.rows.length > 0) {
                        await client.query('ROLLBACK');
                        return res.status(409).json({
                            success: false,
                            message: 'Ya existe una variante con esta combinación de talla y color'
                        });
                    }
                }

                // 3. Verificar duplicado de código de barras
                if (updateData.codigo_barras && updateData.codigo_barras !== oldVariant.codigo_barras) {
                    const barcodeCheck = await client.query(
                        `SELECT variante_id 
                    FROM variantes_producto 
                    WHERE codigo_barras = $1 
                        AND variante_id != $2`,
                        [updateData.codigo_barras, variante_id]
                    );

                    if (barcodeCheck.rows.length > 0) {
                        await client.query('ROLLBACK');
                        return res.status(409).json({
                            success: false,
                            message: 'El código de barras ya está en uso'
                        });
                    }
                }

                // 4. Construir query de actualización
                const fields = [];
                const values = [];
                let paramCount = 1;

                // Campos permitidos para actualizar
                const allowedFields = [
                    'talla', 'color_nombre', 'color_hex', 'codigo_barras',
                    'ubicacion_almacen', 'activo'
                ];

                allowedFields.forEach(field => {
                    if (updateData[field] !== undefined) {
                        fields.push(`${field} = $${paramCount}`);
                        values.push(updateData[field]);
                        paramCount++;
                    }
                });

                // Agregar campos adicionales si existen
                const additionalFields = ['costo_extra', 'precio_venta_variante', 'disponible_online'];
                additionalFields.forEach(field => {
                    if (updateData[field] !== undefined) {
                        fields.push(`${field} = $${paramCount}`);
                        values.push(updateData[field]);
                        paramCount++;
                    }
                });

                if (fields.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        message: 'No hay datos para actualizar'
                    });
                }

                // Agregar parámetros de WHERE
                values.push(variante_id);
                values.push(producto_id);

                const queryStr = `
                UPDATE variantes_producto 
                SET ${fields.join(', ')}
                WHERE variante_id = $${paramCount}
                    AND producto_id = $${paramCount + 1}
                RETURNING *
            `;

                console.log('📝 Query de actualización:', queryStr);
                console.log('📝 Valores:', values);

                // 5. Ejecutar actualización
                const result = await client.query(queryStr, values);
                const updatedVariant = result.rows[0];

                // 6. Registrar cambio en auditoría (con manejo seguro de req.user)
                try {
                    // Obtener empleado_id de forma segura
                    let empleadoId = null;

                    // Opción 1: Si tienes middleware de autenticación
                    if (req.user && req.user.empleado_id) {
                        empleadoId = req.user.empleado_id;
                    }
                    // Opción 2: Si tienes header de usuario
                    else if (req.headers['x-user-id']) {
                        empleadoId = req.headers['x-user-id'];
                    }
                    // Opción 3: Usar un usuario por defecto (sistema)
                    else {
                        empleadoId = 1; // ID de usuario sistema/admin por defecto
                    }

                    await client.query(
                        `INSERT INTO auditorias (
                        tabla_afectada, accion, id_registro,
                        datos_anteriores, datos_nuevos, realizado_por
                    ) VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            'variantes_producto',
                            'UPDATE',
                            variante_id,
                            JSON.stringify(oldVariant),
                            JSON.stringify(updatedVariant),
                            empleadoId
                        ]
                    );
                } catch (auditError) {
                    console.warn('⚠️ Error en auditoría (continuando):', auditError.message);
                    // No revertir por error en auditoría
                }

                await client.query('COMMIT');

                console.log('✅ Variante actualizada exitosamente');

                res.json({
                    success: true,
                    message: 'Variante actualizada exitosamente',
                    data: updatedVariant
                });

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('❌ Error en updateVariant:', error);
                throw error;
            } finally {
                client.release();
            }
        })
    ];
    // Eliminar variante (soft delete)
    static deleteVariant = asyncHandler(async (req, res) => {
        const { producto_id, variante_id } = req.params;
        const { motivo } = req.body;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // 1. Verificar que la variante exista
            const variantCheck = await client.query(
                `SELECT * FROM variantes_producto 
            WHERE variante_id = $1 
                AND producto_id = $2 
                AND activo = true`,
                [variante_id, producto_id]
            );

            if (variantCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: 'Variante no encontrada'
                });
            }

            const variant = variantCheck.rows[0];

            // 2. Verificar si tiene stock
            if (variant.stock_actual > 0 || variant.stock_reservado > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'No se puede eliminar una variante con stock disponible'
                });
            }

            // 3. Verificar si tiene ventas pendientes o recientes
            const salesCheck = await client.query(
                `SELECT COUNT(*) as ventas_recientes
            FROM detalles_venta dv
            JOIN ventas v ON dv.venta_id = v.venta_id
            WHERE dv.variante_id = $1
                AND v.fecha_venta >= CURRENT_DATE - INTERVAL '90 days'`,
                [variante_id]
            );

            const ventasRecientes = parseInt(salesCheck.rows[0].ventas_recientes);

            // 4. Realizar eliminación (soft delete)
            await client.query(
                `UPDATE variantes_producto 
            SET activo = false, 
                disponible_online = false,
                fecha_discontinuado = CURRENT_DATE
            WHERE variante_id = $1`,
                [variante_id]
            );

            // 5. Registrar en auditoría
            await client.query(
                `INSERT INTO auditorias (
                tabla_afectada, accion, id_registro,
                datos_anteriores, realizado_por, motivo
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    'variantes_producto',
                    'DELETE',
                    variante_id,
                    JSON.stringify(variant),
                    req.user.empleado_id || null,
                    motivo || 'Eliminación manual'
                ]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: ventasRecientes > 0
                    ? 'Variante desactivada (tiene historial de ventas)'
                    : 'Variante eliminada exitosamente',
                data: {
                    variante_id,
                    ventas_recientes
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    // Transferir stock entre almacenes
    static transferVariantStock = asyncHandler(async (req, res) => {
        const { producto_id, variante_id } = req.params;
        const {
            almacen_origen_id,
            almacen_destino_id,
            cantidad,
            motivo,
            empleado_id
        } = req.body;

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // 1. Validar que la variante existe
            const variantCheck = await client.query(
                `SELECT * FROM variantes_producto 
            WHERE variante_id = $1 
                AND producto_id = $2 
                AND activo = true`,
                [variante_id, producto_id]
            );

            if (variantCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: 'Variante no encontrada'
                });
            }

            // 2. Verificar stock en almacén origen
            const originStock = await client.query(
                `SELECT cantidad FROM inventario 
            WHERE variante_id = $1 
                AND almacen_id = $2`,
                [variante_id, almacen_origen_id]
            );

            if (originStock.rows.length === 0 || originStock.rows[0].cantidad < cantidad) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'Stock insuficiente en el almacén de origen'
                });
            }

            const stockOrigenActual = originStock.rows[0].cantidad;

            // 3. Actualizar almacén origen (restar)
            await client.query(
                `UPDATE inventario 
            SET cantidad = cantidad - $1
            WHERE variante_id = $2 
                AND almacen_id = $3`,
                [cantidad, variante_id, almacen_origen_id]
            );

            // 4. Actualizar o crear registro en almacén destino (sumar)
            const destStock = await client.query(
                `SELECT cantidad FROM inventario 
            WHERE variante_id = $1 
                AND almacen_id = $2`,
                [variante_id, almacen_destino_id]
            );

            if (destStock.rows.length > 0) {
                await client.query(
                    `UPDATE inventario 
                SET cantidad = cantidad + $1
                WHERE variante_id = $2 
                    AND almacen_id = $3`,
                    [cantidad, variante_id, almacen_destino_id]
                );
            } else {
                await client.query(
                    `INSERT INTO inventario (variante_id, almacen_id, cantidad)
                VALUES ($1, $2, $3)`,
                    [variante_id, almacen_destino_id, cantidad]
                );
            }

            // 5. Obtener stock actualizado del destino
            const destStockUpdated = await client.query(
                `SELECT cantidad FROM inventario 
            WHERE variante_id = $1 
                AND almacen_id = $2`,
                [variante_id, almacen_destino_id]
            );

            const stockDestinoActual = destStockUpdated.rows[0]?.cantidad || cantidad;

            // 6. Registrar movimiento de salida (origen)
            await client.query(
                `INSERT INTO movimientos_inventario (
                variante_id, almacen_id, tipo_movimiento,
                cantidad, cantidad_anterior, cantidad_nueva,
                referencia_id, tipo_referencia, empleado_id, motivo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    variante_id, almacen_origen_id, 'Transferencia',
                    cantidad, stockOrigenActual, stockOrigenActual - cantidad,
                    null, 'Transferencia', empleado_id || req.user.empleado_id,
                    motivo || 'Transferencia a otro almacén'
                ]
            );

            // 7. Registrar movimiento de entrada (destino)
            await client.query(
                `INSERT INTO movimientos_inventario (
                variante_id, almacen_id, tipo_movimiento,
                cantidad, cantidad_anterior, cantidad_nueva,
                referencia_id, tipo_referencia, empleado_id, motivo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    variante_id, almacen_destino_id, 'Entrada',
                    cantidad, (stockDestinoActual - cantidad), stockDestinoActual,
                    null, 'Transferencia', empleado_id || req.user.empleado_id,
                    motivo || 'Transferencia desde otro almacén'
                ]
            );

            // 8. Crear registro de transferencia
            const transferResult = await client.query(
                `INSERT INTO transferencias_almacen (
                codigo_transferencia, almacen_origen_id, almacen_destino_id,
                empleado_id, estado, notas
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
                [
                    `TRANS-${Date.now()}-${variante_id}`,
                    almacen_origen_id, almacen_destino_id,
                    empleado_id || req.user.empleado_id,
                    'Recibido',
                    motivo || 'Transferencia manual'
                ]
            );

            const transferencia = transferResult.rows[0];

            // 9. Registrar detalle de transferencia
            await client.query(
                `INSERT INTO detalles_transferencia (
                transferencia_id, variante_id, cantidad,
                cantidad_enviada, cantidad_recibida
            ) VALUES ($1, $2, $3, $4, $5)`,
                [
                    transferencia.transferencia_id,
                    variante_id,
                    cantidad,
                    cantidad,
                    cantidad
                ]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Stock transferido exitosamente',
                data: {
                    transferencia_id: transferencia.transferencia_id,
                    variante_id,
                    almacen_origen_id,
                    almacen_destino_id,
                    cantidad,
                    stock_origen_final: stockOrigenActual - cantidad,
                    stock_destino_final: stockDestinoActual
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });


    // Obtener todas las variantes de un producto
    static getProductVariants = asyncHandler(async (req, res) => {
        const { producto_id } = req.params;
        const {
            activo, // puede ser 'true', 'false' o undefined
            sortBy = 'talla',
            sortOrder = 'asc'
        } = req.query;

        console.log('🔍 Parámetros recibidos:', {
            producto_id,
            activo,
            sortBy,
            sortOrder
        });

        // Construir query base
        let queryStr = `
        SELECT 
            vp.*,
            COALESCE(SUM(i.cantidad), 0) as stock_total_almacenes
        FROM variantes_producto vp
        LEFT JOIN inventario i ON vp.variante_id = i.variante_id
        WHERE vp.producto_id = $1
    `;

        const params = [producto_id];
        let paramCount = 2;

        // Manejar filtro activo
        if (activo !== undefined) {
            queryStr += ` AND vp.activo = $${paramCount}`;
            // Convertir string a booleano
            params.push(activo === 'true');
            paramCount++;
            console.log('✅ Filtro activo aplicado:', activo === 'true');
        }

        queryStr += ` GROUP BY vp.variante_id`;

        // Ordenamiento
        const validSortColumns = ['talla', 'color_nombre', 'stock_disponible', 'fecha_ultima_entrada'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'talla';

        if (sortColumn === 'stock_disponible') {
            queryStr += ` ORDER BY stock_disponible ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
        } else {
            queryStr += ` ORDER BY vp.${sortColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;
        }

        console.log('📝 Query SQL:', queryStr);
        console.log('📝 Parámetros:', params);

        try {
            const result = await query(queryStr, params);
            console.log('✅ Resultados encontrados:', result.rows.length);

            res.json({
                success: true,
                data: result.rows
            });
        } catch (error) {
            console.error('❌ Error en la consulta:', error);
            throw error;
        }
    });

    // Obtener TODAS las variantes (versión corregida)
    static getAllVariants = asyncHandler(async (req, res) => {
        console.log('🔍 EJECUTANDO getAllVariants');

        const {
            page = 1,
            limit = 50,
            q = '',
            producto_id,
            activo,
            con_stock,
            sortBy = 'fecha_ultima_entrada',
            sortOrder = 'desc'
        } = req.query;

        console.log('📊 Parámetros recibidos:', {
            page, limit, q, producto_id, activo, con_stock, sortBy, sortOrder
        });

        const offset = (page - 1) * limit;

        // QUERY PRINCIPAL - VERSIÓN SIMPLIFICADA
        let queryStr = `
        SELECT 
            vp.*,
            p.nombre as producto_nombre,
            p.sku as producto_sku,
            c.nombre as categoria_nombre,
            m.nombre as marca_nombre
        FROM variantes_producto vp
        INNER JOIN productos p ON vp.producto_id = p.producto_id
        LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
        LEFT JOIN marcas m ON p.marca_id = m.marca_id
        WHERE 1=1
    `;

        const params = [];
        let paramCount = 0;

        // Filtro de búsqueda
        if (q) {
            paramCount++;
            params.push(`%${q}%`);
            queryStr += ` AND (
            p.nombre ILIKE $${paramCount} 
            OR p.sku ILIKE $${paramCount}
            OR vp.talla ILIKE $${paramCount}
            OR vp.color_nombre ILIKE $${paramCount}
            OR vp.codigo_barras ILIKE $${paramCount}
        )`;
        }

        // Filtro por producto
        if (producto_id) {
            paramCount++;
            params.push(producto_id);
            queryStr += ` AND vp.producto_id = $${paramCount}`;
        }

        // Filtro por estado
        if (activo !== undefined) {
            paramCount++;
            params.push(activo === 'true');
            queryStr += ` AND vp.activo = $${paramCount}`;
        }

        // Ordenamiento SIMPLIFICADO
        queryStr += ` ORDER BY vp.fecha_ultima_entrada DESC`;

        // Paginación
        paramCount++;
        params.push(limit);
        queryStr += ` LIMIT $${paramCount}`;

        paramCount++;
        params.push(offset);
        queryStr += ` OFFSET $${paramCount}`;

        console.log('📝 Query SQL:', queryStr);
        console.log('📝 Parámetros:', params);

        try {
            const result = await query(queryStr, params);
            console.log('✅ Resultados encontrados:', result.rows.length);

            if (result.rows.length > 0) {
                console.log('📋 Primer registro:', result.rows[0]);
            }

            // QUERY COUNT - SIMPLIFICADA
            let countQuery = `
            SELECT COUNT(*) as total
            FROM variantes_producto vp
            INNER JOIN productos p ON vp.producto_id = p.producto_id
            WHERE 1=1
        `;

            const countParams = [];
            let countParamCount = 0;

            if (q) {
                countParamCount++;
                countParams.push(`%${q}%`);
                countQuery += ` AND (
                p.nombre ILIKE $${countParamCount} 
                OR p.sku ILIKE $${countParamCount}
                OR vp.talla ILIKE $${countParamCount}
                OR vp.color_nombre ILIKE $${countParamCount}
                OR vp.codigo_barras ILIKE $${countParamCount}
            )`;
            }

            if (producto_id) {
                countParamCount++;
                countParams.push(producto_id);
                countQuery += ` AND vp.producto_id = $${countParamCount}`;
            }

            if (activo !== undefined) {
                countParamCount++;
                countParams.push(activo === 'true');
                countQuery += ` AND vp.activo = $${countParamCount}`;
            }

            console.log('📝 Count Query:', countQuery);
            console.log('📝 Count Params:', countParams);

            const countResult = await query(countQuery, countParams);
            const total = parseInt(countResult.rows[0].total);

            console.log('📊 Total registros:', total);

            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            console.error('❌ Error en getAllVariants:', error);
            throw error;
        }
    });

}

export default ProductController;