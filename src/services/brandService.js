import pool from "../config/database.js";
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

class BrandService {
    // Obtener todas las marcas con filtros - VERSIÓN CORREGIDA
    async getBrands(filters = {}, options = {}) {
        const {
            search = '',
            only_active = true,
            pais_origen = null
        } = filters;

        const {
            page = 1,
            limit = 20,
            sort_by = 'nombre',
            sort_order = 'ASC'
        } = options;

        const offset = (page - 1) * limit;

        // CONSULTA PRINCIPAL CON CTE (Common Table Expression) - Solución más limpia
        let query = `
            WITH marcas_con_stats AS (
                SELECT 
                    m.marca_id,
                    m.nombre,
                    m.descripcion,
                    m.pais_origen,
                    m.sitio_web,
                    m.contacto_email,
                    m.activa,
                    m.fecha_registro,
                    COUNT(p.producto_id) as total_productos,
                    COALESCE(SUM(vp.stock_actual), 0) as total_stock
                FROM marcas m
                LEFT JOIN productos p ON m.marca_id = p.marca_id
                LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id
        `;

        const whereConditions = [];
        const queryParams = [];

        // IMPORTANTE: En tu tabla la columna se llama 'activa'
        if (only_active) {
            whereConditions.push('m.activa = TRUE');
        }

        if (search) {
            whereConditions.push(`(
                m.nombre ILIKE $${queryParams.length + 1} OR 
                m.descripcion ILIKE $${queryParams.length + 1}
            )`);
            queryParams.push(`%${search}%`);
        }

        if (pais_origen) {
            whereConditions.push(`m.pais_origen ILIKE $${queryParams.length + 1}`);
            queryParams.push(`%${pais_origen}%`);
        }

        if (whereConditions.length > 0) {
            query += ' WHERE ' + whereConditions.join(' AND ');
        }

        query += `
                GROUP BY m.marca_id
            )
            SELECT * FROM marcas_con_stats
        `;

        // Ordenamiento seguro
        const validSortColumns = ['nombre', 'pais_origen', 'fecha_registro', 'total_productos', 'total_stock'];
        const safeSortBy = validSortColumns.includes(sort_by) ? sort_by : 'nombre';

        query += ` ORDER BY ${safeSortBy} ${sort_order}`;

        query += ` LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;

        queryParams.push(limit, offset);

        // CONSULTA COUNT - IMPORTANTE: usar 'activa' no 'activo'
        let countQuery = `
            SELECT COUNT(*) as total
            FROM marcas m
        `;

        const countWhereConditions = [];
        const countParams = [];

        if (only_active) {
            countWhereConditions.push('m.activa = TRUE');
        }

        if (search) {
            countWhereConditions.push(`(
                m.nombre ILIKE $${countParams.length + 1} OR 
                m.descripcion ILIKE $${countParams.length + 1}
            )`);
            countParams.push(`%${search}%`);
        }

        if (pais_origen) {
            countWhereConditions.push(`m.pais_origen ILIKE $${countParams.length + 1}`);
            countParams.push(`%${pais_origen}%`);
        }

        if (countWhereConditions.length > 0) {
            countQuery += ' WHERE ' + countWhereConditions.join(' AND ');
        }

        const client = await pool.connect();
        try {
            console.log('🔍 Ejecutando query:', query);
            console.log('🔍 Parámetros:', queryParams);

            const result = await client.query(query, queryParams);
            console.log('✅ Resultados:', result.rows.length);

            const countResult = await client.query(countQuery, countParams);
            console.log('✅ Total:', countResult.rows[0].total);

            return {
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].total),
                    totalPages: Math.ceil(countResult.rows[0].total / limit)
                }
            };
        } catch (error) {
            console.error('❌ Error en consulta SQL:', error.message);
            console.error('❌ Query completa:', query);
            throw error;
        } finally {
            client.release();
        }
    }

    // Obtener todas las marcas activas (sin paginación) - CORREGIDO
    async getAllActiveBrands() {
        const query = `
            SELECT 
                marca_id,
                nombre,
                pais_origen
            FROM marcas
            WHERE activa = TRUE
            ORDER BY nombre
        `;

        const result = await pool.query(query);
        return result.rows;
    }

    // Obtener marca por ID - CORREGIDO
    async getBrandById(id, options = {}) {
        const { include_products = false, include_stats = false } = options;

        let query = `
            SELECT 
                m.*,
                COUNT(p.producto_id) as total_productos
            FROM marcas m
            LEFT JOIN productos p ON m.marca_id = p.marca_id
            WHERE m.marca_id = $1
            GROUP BY m.marca_id
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return null;
        }

        const brand = result.rows[0];

        // Incluir productos si se solicita
        if (include_products) {
            const products = await this.getBrandProducts(id, {}, { limit: 50, page: 1 });
            brand.productos = products.data;
        }

        // Incluir estadísticas si se solicita
        if (include_stats) {
            const stats = await this.getBrandDetailStats(id);
            brand.estadisticas = stats;
        }

        return brand;
    }

    // Obtener marca por slug - CORREGIDO (si no tienes columna slug, puedes omitir esto)
    async getBrandBySlug(slug, options = {}) {
        const { include_products = false } = options;

        // Primero verifica si tienes columna slug en tu tabla
        let query = `
            SELECT 
                m.*,
                COUNT(p.producto_id) as total_productos
            FROM marcas m
            LEFT JOIN productos p ON m.marca_id = p.marca_id
            WHERE m.nombre ILIKE $1 AND m.activa = TRUE
            GROUP BY m.marca_id
        `;

        const result = await pool.query(query, [slug]);

        if (result.rows.length === 0) {
            return null;
        }

        const brand = result.rows[0];

        // Incluir productos si se solicita
        if (include_products) {
            const products = await this.getBrandProducts(brand.marca_id, {}, { limit: 50, page: 1 });
            brand.productos = products.data;
        }

        return brand;
    }

    // Obtener productos de una marca - CORREGIDO (usar COUNT separado)
    async getBrandProducts(brandId, filters = {}, options = {}) {
        const {
            categoria_id = null,
            min_price = null,
            max_price = null,
            in_stock = null
        } = filters;

        const {
            page = 1,
            limit = 20,
            sort_by = 'nombre',
            sort_order = 'ASC'
        } = options;

        const offset = (page - 1) * limit;

        // CONSULTA PRINCIPAL
        let query = `
            SELECT 
                p.*,
                c.nombre as categoria_nombre
            FROM productos p
            LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
            WHERE p.marca_id = $1 AND p.activo = TRUE
        `;

        const queryParams = [brandId];
        let paramCount = 1;

        if (categoria_id) {
            paramCount++;
            query += ` AND p.categoria_id = $${paramCount}`;
            queryParams.push(categoria_id);
        }

        if (min_price !== null) {
            paramCount++;
            query += ` AND p.precio_venta >= $${paramCount}`;
            queryParams.push(min_price);
        }

        if (max_price !== null) {
            paramCount++;
            query += ` AND p.precio_venta <= $${paramCount}`;
            queryParams.push(max_price);
        }

        if (in_stock !== null) {
            if (in_stock) {
                query += ` AND EXISTS (
                    SELECT 1 FROM variantes_producto v 
                    WHERE v.producto_id = p.producto_id 
                    AND v.stock_actual > 0
                )`;
            } else {
                query += ` AND NOT EXISTS (
                    SELECT 1 FROM variantes_producto v 
                    WHERE v.producto_id = p.producto_id 
                    AND v.stock_actual > 0
                )`;
            }
        }

        query += ` ORDER BY p.${sort_by} ${sort_order}`;
        query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        queryParams.push(limit, offset);

        // CONSULTA COUNT SEPARADA
        let countQuery = `
            SELECT COUNT(*) as total
            FROM productos p
            WHERE p.marca_id = $1 AND p.activo = TRUE
        `;

        const countParams = [brandId];

        if (categoria_id) {
            countQuery += ` AND p.categoria_id = $2`;
            countParams.push(categoria_id);
        }

        if (min_price !== null) {
            countQuery += ` AND p.precio_venta >= $${countParams.length + 1}`;
            countParams.push(min_price);
        }

        if (max_price !== null) {
            countQuery += ` AND p.precio_venta <= $${countParams.length + 1}`;
            countParams.push(max_price);
        }

        if (in_stock !== null) {
            if (in_stock) {
                countQuery += ` AND EXISTS (
                    SELECT 1 FROM variantes_producto v 
                    WHERE v.producto_id = p.producto_id 
                    AND v.stock_actual > 0
                )`;
            } else {
                countQuery += ` AND NOT EXISTS (
                    SELECT 1 FROM variantes_producto v 
                    WHERE v.producto_id = p.producto_id 
                    AND v.stock_actual > 0
                )`;
            }
        }

        const client = await pool.connect();
        try {
            const result = await client.query(query, queryParams);

            // Obtener stock por producto
            const productsWithStock = await Promise.all(
                result.rows.map(async (product) => {
                    const stockResult = await client.query(
                        `SELECT COALESCE(SUM(stock_actual), 0) as stock_total 
                         FROM variantes_producto 
                         WHERE producto_id = $1 AND activo = true`,
                        [product.producto_id]
                    );

                    return {
                        ...product,
                        stock_total: parseInt(stockResult.rows[0].stock_total)
                    };
                })
            );

            const countResult = await client.query(countQuery, countParams);

            return {
                data: productsWithStock,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].total),
                    totalPages: Math.ceil(countResult.rows[0].total / limit)
                }
            };
        } finally {
            client.release();
        }
    }

    // Crear nueva marca - CORREGIDO (eliminar campos que no existen en tu tabla)
    async createBrand(brandData) {
        const {
            nombre,
            descripcion,
            pais_origen,
            sitio_web,
            contacto_email,
            telefono_contacto = null,
            activo = true
        } = brandData;

        const query = `
            INSERT INTO marcas (
                nombre, descripcion, pais_origen, sitio_web, 
                contacto_email, telefono_contacto, activa
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `;

        const values = [
            nombre,
            descripcion,
            pais_origen,
            sitio_web,
            contacto_email,
            telefono_contacto,
            activo
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    // Actualizar marca - CORREGIDO
    async updateBrand(id, updateData) {
        const fields = [];
        const values = [];
        let paramCount = 1;

        // Solo campos que existen en tu tabla
        const allowedFields = [
            'nombre', 'descripcion', 'pais_origen', 'sitio_web',
            'contacto_email', 'telefono_contacto', 'activa'
        ];

        allowedFields.forEach(field => {
            if (updateData[field] !== undefined) {
                fields.push(`${field} = $${paramCount}`);
                values.push(updateData[field]);
                paramCount++;
            }
        });

        if (fields.length === 0) {
            throw new Error("No hay campos para actualizar");
        }

        values.push(id);

        const query = `
            UPDATE marcas
            SET ${fields.join(', ')}
            WHERE marca_id = $${paramCount}
            RETURNING *
        `;

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    // Eliminar marca
    async deleteBrand(id) {
        const query = 'DELETE FROM marcas WHERE marca_id = $1';
        await pool.query(query, [id]);
    }

    // Verificar si tiene productos asociados
    async getProductCount(id) {
        const query = 'SELECT COUNT(*) FROM productos WHERE marca_id = $1';
        const result = await pool.query(query, [id]);
        return parseInt(result.rows[0].count);
    }

    // Actualizar estado de marca - CORREGIDO
    async updateBrandStatus(id, activa) {
        const query = `
            UPDATE marcas 
            SET activa = $1
            WHERE marca_id = $2
            RETURNING *
        `;
        const result = await pool.query(query, [activa, id]);
        return result.rows[0];
    }

    // Obtener estadísticas de marcas - CORREGIDO
    async getBrandStats() {
        const query = `
            SELECT 
                COUNT(*) as total_marcas,
                COUNT(CASE WHEN activa = TRUE THEN 1 END) as marcas_activas,
                COUNT(CASE WHEN activa = FALSE THEN 1 END) as marcas_inactivas,
                COUNT(DISTINCT pais_origen) as paises_diferentes,
                COALESCE(AVG(productos_por_marca), 0) as promedio_productos_por_marca
            FROM (
                SELECT 
                    m.*,
                    COUNT(p.producto_id) as productos_por_marca
                FROM marcas m
                LEFT JOIN productos p ON m.marca_id = p.marca_id
                GROUP BY m.marca_id
            ) as marcas_con_productos
        `;

        const result = await pool.query(query);
        return result.rows[0];
    }

    // Obtener estadísticas detalladas de una marca - CORREGIDO
    async getBrandDetailStats(id) {
        const query = `
            SELECT 
                m.nombre,
                m.marca_id,
                COUNT(p.producto_id) as total_productos,
                COALESCE(SUM(vp.stock_actual), 0) as total_stock,
                COALESCE(MIN(p.precio_venta), 0) as precio_minimo,
                COALESCE(MAX(p.precio_venta), 0) as precio_maximo,
                COALESCE(AVG(p.precio_venta), 0) as precio_promedio
            FROM marcas m
            LEFT JOIN productos p ON m.marca_id = p.marca_id
            LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id
            WHERE m.marca_id = $1
            GROUP BY m.marca_id, m.nombre
        `;

        const result = await pool.query(query, [id]);
        return result.rows[0];
    }

    // Buscar sugerencias de marcas - CORREGIDO
    async searchBrandSuggestions(query, limit = 10) {
        const searchQuery = `
            SELECT 
                marca_id,
                nombre,
                pais_origen
            FROM marcas
            WHERE nombre ILIKE $1
                AND activa = TRUE
            ORDER BY nombre
            LIMIT $2
        `;

        const result = await pool.query(searchQuery, [`%${query}%`, limit]);
        return result.rows;
    }

    // Exportar marcas a CSV - CORREGIDO
    async exportBrandsToCSV(options = {}) {
        const { only_active = true } = options;

        let query = `
            SELECT 
                marca_id,
                nombre,
                descripcion,
                pais_origen,
                sitio_web,
                contacto_email,
                telefono_contacto,
                activa,
                fecha_registro
            FROM marcas
        `;

        if (only_active) {
            query += ' WHERE activa = TRUE';
        }

        query += ' ORDER BY nombre';

        const result = await pool.query(query);

        const csvData = stringify(result.rows, {
            header: true,
            columns: [
                { key: 'marca_id', header: 'ID' },
                { key: 'nombre', header: 'Nombre' },
                { key: 'descripcion', header: 'Descripción' },
                { key: 'pais_origen', header: 'País de Origen' },
                { key: 'sitio_web', header: 'Sitio Web' },
                { key: 'contacto_email', header: 'Email de Contacto' },
                { key: 'telefono_contacto', header: 'Teléfono' },
                { key: 'activa', header: 'Activa' },
                { key: 'fecha_registro', header: 'Fecha de Registro' }
            ]
        });

        return csvData;
    }
}

export default new BrandService();