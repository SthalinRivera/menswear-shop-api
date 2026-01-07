import { query, getClient } from '../config/database.js';
import { validationSchemas, validate } from '../middlewares/validationMiddleware.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { PAGINATION } from '../config/constants.js';


class ProductController {
    // Obtener todos los productos con filtros
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
            sortBy = 'fecha_creacion',
            sortOrder = 'desc'
        } = req.query;

        const offset = (page - 1) * limit;

        // ============================
        // 1) QUERY PRINCIPAL (PRODUCTOS)
        // ============================

        let queryStr = `
    SELECT p.*, 
           c.nombre AS categoria_nombre,
           m.nombre AS marca_nombre,
           COALESCE((
             SELECT SUM(vp.stock_disponible) 
             FROM variantes_producto vp 
             WHERE vp.producto_id = p.producto_id 
               AND vp.activo = true
           ), 0) AS stock_total
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
                    variantes: variantsResult.rows,
                    imagenes: [] // Aquí puedes agregar la lógica que necesites
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

        const result = await query(
            `SELECT p.*, 
              c.nombre as categoria_nombre, c.categoria_padre_id,
              m.nombre as marca_nombre,
              (SELECT nombre FROM categorias WHERE categoria_id = c.categoria_padre_id) as categoria_padre_nombre
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
       LEFT JOIN marcas m ON p.marca_id = m.marca_id
       WHERE p.producto_id = $1 AND p.activo = true`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        const product = result.rows[0];

        // Obtener variantes
        const variantsResult = await query(
            `SELECT vp.*, 
              json_agg(
                json_build_object(
                  'almacen_id', i.almacen_id,
                  'nombre', a.nombre,
                  'cantidad', i.cantidad,
                  'ubicacion', i.ubicacion
                )
              ) as inventario
       FROM variantes_producto vp
       LEFT JOIN inventario i ON vp.variante_id = i.variante_id
       LEFT JOIN almacenes a ON i.almacen_id = a.almacen_id
       WHERE vp.producto_id = $1 AND vp.activo = true
       GROUP BY vp.variante_id
       ORDER BY vp.talla, vp.color_nombre`,
            [id]
        );

        // Obtener reseñas
        const reviewsResult = await query(
            `SELECT r.*, 
              c.nombre as cliente_nombre, c.apellido as cliente_apellido
       FROM reseñas_productos r
       LEFT JOIN clientes c ON r.cliente_id = c.cliente_id
       WHERE r.producto_id = $1 AND r.aprobada = true
       ORDER BY r.fecha_creacion DESC
       LIMIT 10`,
            [id]
        );

        // Obtener productos relacionados (misma categoría)
        const relatedResult = await query(
            `SELECT p.producto_id, p.sku, p.nombre, p.precio_final, p.es_promocion, p.precio_promocion,
              (SELECT COUNT(*) FROM variantes_producto vp WHERE vp.producto_id = p.producto_id AND vp.stock_disponible > 0) as tiene_stock
       FROM productos p
       WHERE p.categoria_id = $1 
         AND p.producto_id != $2 
         AND p.activo = true
       ORDER BY RANDOM()
       LIMIT 6`,
            [product.categoria_id, id]
        );

        // Obtener historial de precios
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
            const updateData = req.body;

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
                    [id, oldPrice, updateData.precio_venta, updateData.motivo_cambio || 'Ajuste de precio', req.user.empleado_id || null]
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

    // Crear variante de producto
    static createVariant = asyncHandler(async (req, res) => {
        const { producto_id } = req.params;
        const { talla, color_nombre, color_hex, codigo_barras, ubicacion_almacen } = req.body;

        // Verificar si el producto existe
        const productCheck = await query(
            'SELECT producto_id FROM productos WHERE producto_id = $1 AND activo = true',
            [producto_id]
        );

        if (productCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        // Verificar si la combinación talla-color ya existe
        const existingVariant = await query(
            `SELECT variante_id FROM variantes_producto 
       WHERE producto_id = $1 AND talla = $2 AND color_nombre = $3`,
            [producto_id, talla, color_nombre]
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
        producto_id, talla, color_nombre, color_hex, 
        codigo_barras, ubicacion_almacen
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
            [producto_id, talla, color_nombre, color_hex || null, codigo_barras || null, ubicacion_almacen || null]
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
}

export default ProductController;