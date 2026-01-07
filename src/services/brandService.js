import pool from "../config/database.js";
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

class BrandService {
    // Obtener todas las marcas con filtros
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

        let query = `
      SELECT 
        m.*,
        COUNT(p.producto_id) as total_productos,
        COALESCE(SUM(vp.stock_actual), 0) as total_stock
      FROM marcas m
      LEFT JOIN productos p ON m.marca_id = p.marca_id
      LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id
    `;

        const whereConditions = [];
        const queryParams = [];

        if (only_active) {
            whereConditions.push('m.activo = TRUE');
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
      ORDER BY ${sort_by} ${sort_order}
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

        queryParams.push(limit, offset);

        // Contar total para paginación
        let countQuery = `
      SELECT COUNT(*) as total
      FROM marcas m
    `;

        const countWhereConditions = [];
        const countParams = [];

        if (only_active) {
            countWhereConditions.push('m.activo = TRUE');
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
            const result = await client.query(query, queryParams);
            const countResult = await client.query(countQuery, countParams);

            return {
                data: result.rows,
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

    // Obtener todas las marcas activas (sin paginación)
    async getAllActiveBrands() {
        const query = `
      SELECT 
        marca_id,
        nombre,
        pais_origen,
        logo_url
      FROM marcas
      WHERE activo = TRUE
      ORDER BY orden, nombre
    `;

        const result = await pool.query(query);
        return result.rows;
    }

    // Obtener marca por ID
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

    // Obtener marca por slug
    async getBrandBySlug(slug, options = {}) {
        const { include_products = false } = options;

        let query = `
      SELECT 
        m.*,
        COUNT(p.producto_id) as total_productos
      FROM marcas m
      LEFT JOIN productos p ON m.marca_id = p.marca_id
      WHERE m.slug = $1 AND m.activo = TRUE
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

    // Obtener productos de una marca
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

        let query = `
      SELECT 
        p.*,
        c.nombre as categoria_nombre,
        c.slug as categoria_slug,
        (
          SELECT JSON_AGG(json_build_object(
            'variante_id', v.variante_id,
            'talla', v.talla,
            'color_nombre', v.color_nombre,
            'color_hex', v.color_hex,
            'stock_actual', v.stock_actual,
            'codigo_barras', v.codigo_barras
          ))
          FROM variantes_producto v
          WHERE v.producto_id = p.producto_id
        ) as variantes
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
      WHERE p.marca_id = $1
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
            paramCount++;
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

        // Contar total
        let countQuery = `
      SELECT COUNT(*) as total
      FROM productos p
      WHERE p.marca_id = $1
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
            const countResult = await client.query(countQuery, countParams);

            return {
                data: result.rows,
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

    // Crear nueva marca
    async createBrand(brandData) {
        const {
            nombre,
            descripcion,
            pais_origen,
            sitio_web,
            contacto_email,
            telefono_contacto,
            logo_url,
            historia,
            activo = true,
            slug,
            meta_title,
            meta_description,
            meta_keywords,
            orden = 0
        } = brandData;

        const query = `
      INSERT INTO marcas (
        nombre, descripcion, pais_origen, sitio_web, contacto_email,
        telefono_contacto, logo_url, historia, activo, slug,
        meta_title, meta_description, meta_keywords, orden
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

        const values = [
            nombre,
            descripcion,
            pais_origen,
            sitio_web,
            contacto_email,
            telefono_contacto,
            logo_url,
            historia,
            activo,
            slug,
            meta_title,
            meta_description,
            meta_keywords,
            orden
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    // Actualizar marca
    async updateBrand(id, updateData) {
        const fields = [];
        const values = [];
        let paramCount = 1;

        const allowedFields = [
            'nombre', 'descripcion', 'pais_origen', 'sitio_web', 'contacto_email',
            'telefono_contacto', 'logo_url', 'historia', 'activo', 'slug',
            'meta_title', 'meta_description', 'meta_keywords', 'orden'
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
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
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

    // Actualizar estado de marca
    async updateBrandStatus(id, activo) {
        const query = `
      UPDATE marcas 
      SET activo = $1, updated_at = CURRENT_TIMESTAMP
      WHERE marca_id = $2
      RETURNING *
    `;
        const result = await pool.query(query, [activo, id]);
        return result.rows[0];
    }

    // Obtener estadísticas de marcas
    async getBrandStats() {
        const query = `
      SELECT 
        COUNT(*) as total_marcas,
        COUNT(CASE WHEN activo = TRUE THEN 1 END) as marcas_activas,
        COUNT(CASE WHEN activo = FALSE THEN 1 END) as marcas_inactivas,
        COUNT(DISTINCT pais_origen) as paises_diferentes,
        COALESCE(AVG(total_productos), 0) as promedio_productos_por_marca,
        (
          SELECT JSON_OBJECT_AGG(pais, count)
          FROM (
            SELECT pais_origen as pais, COUNT(*) as count
            FROM marcas
            WHERE pais_origen IS NOT NULL
            GROUP BY pais_origen
            ORDER BY count DESC
            LIMIT 10
          ) subq
        ) as top_paises
      FROM (
        SELECT 
          m.*,
          COUNT(p.producto_id) as total_productos
        FROM marcas m
        LEFT JOIN productos p ON m.marca_id = p.marca_id
        GROUP BY m.marca_id
      ) as marcas_con_productos
    `;

        const result = await pool.query(query);
        return result.rows[0];
    }

    // Obtener estadísticas detalladas de una marca
    async getBrandDetailStats(id) {
        const query = `
      SELECT 
        m.nombre,
        m.marca_id,
        COUNT(p.producto_id) as total_productos,
        COALESCE(SUM(vp.stock_actual), 0) as total_stock,
        COALESCE(MIN(p.precio_venta), 0) as precio_minimo,
        COALESCE(MAX(p.precio_venta), 0) as precio_maximo,
        COALESCE(AVG(p.precio_venta), 0) as precio_promedio,
        COALESCE(SUM(p.precio_venta * vp.stock_actual), 0) as valor_total_inventario,
        (
          SELECT COUNT(DISTINCT p2.categoria_id)
          FROM productos p2
          WHERE p2.marca_id = m.marca_id
        ) as categorias_diferentes,
        (
          SELECT JSON_AGG(json_build_object(
            'categoria_id', c.categoria_id,
            'categoria_nombre', c.nombre,
            'total_productos', subq.total
          ))
          FROM (
            SELECT p2.categoria_id, COUNT(*) as total
            FROM productos p2
            WHERE p2.marca_id = m.marca_id
            GROUP BY p2.categoria_id
            ORDER BY total DESC
            LIMIT 5
          ) subq
          JOIN categorias c ON subq.categoria_id = c.categoria_id
        ) as top_categorias
      FROM marcas m
      LEFT JOIN productos p ON m.marca_id = p.marca_id
      LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id
      WHERE m.marca_id = $1
      GROUP BY m.marca_id, m.nombre
    `;

        const result = await pool.query(query, [id]);
        return result.rows[0];
    }

    // Buscar sugerencias de marcas
    async searchBrandSuggestions(query, limit = 10) {
        const searchQuery = `
      SELECT 
        marca_id,
        nombre,
        pais_origen,
        logo_url
      FROM marcas
      WHERE nombre ILIKE $1
        AND activo = TRUE
      ORDER BY nombre
      LIMIT $2
    `;

        const result = await pool.query(searchQuery, [`%${query}%`, limit]);
        return result.rows;
    }

    // Importar marcas desde CSV
    async importBrandsFromCSV(csvBuffer) {
        const records = parse(csvBuffer, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        const results = {
            total: records.length,
            created: 0,
            updated: 0,
            errors: [],
            details: []
        };

        for (const record of records) {
            try {
                // Verificar si la marca ya existe
                const existingQuery = 'SELECT marca_id FROM marcas WHERE nombre = $1 OR slug = $2';
                const existingResult = await pool.query(existingQuery, [record.nombre, record.slug]);

                if (existingResult.rows.length > 0) {
                    // Actualizar marca existente
                    const updateQuery = `
            UPDATE marcas 
            SET 
              descripcion = COALESCE($1, descripcion),
              pais_origen = COALESCE($2, pais_origen),
              sitio_web = COALESCE($3, sitio_web),
              contacto_email = COALESCE($4, contacto_email),
              updated_at = CURRENT_TIMESTAMP
            WHERE marca_id = $5
            RETURNING marca_id, nombre
          `;

                    const updateResult = await pool.query(updateQuery, [
                        record.descripcion,
                        record.pais_origen,
                        record.sitio_web,
                        record.contacto_email,
                        existingResult.rows[0].marca_id
                    ]);

                    results.updated++;
                    results.details.push({
                        action: 'updated',
                        id: updateResult.rows[0].marca_id,
                        nombre: updateResult.rows[0].nombre
                    });
                } else {
                    // Crear nueva marca
                    const insertQuery = `
            INSERT INTO marcas (
              nombre, descripcion, pais_origen, sitio_web, 
              contacto_email, slug, activo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING marca_id, nombre
          `;

                    const insertResult = await pool.query(insertQuery, [
                        record.nombre,
                        record.descripcion,
                        record.pais_origen,
                        record.sitio_web,
                        record.contacto_email,
                        record.slug || record.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                        true
                    ]);

                    results.created++;
                    results.details.push({
                        action: 'created',
                        id: insertResult.rows[0].marca_id,
                        nombre: insertResult.rows[0].nombre
                    });
                }
            } catch (error) {
                results.errors.push({
                    record,
                    error: error.message
                });
            }
        }

        return results;
    }

    // Exportar marcas a CSV
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
        logo_url,
        activo,
        created_at,
        updated_at
      FROM marcas
    `;

        if (only_active) {
            query += ' WHERE activo = TRUE';
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
                { key: 'logo_url', header: 'URL del Logo' },
                { key: 'activo', header: 'Activo' },
                { key: 'created_at', header: 'Fecha de Creación' },
                { key: 'updated_at', header: 'Fecha de Actualización' }
            ]
        });

        return csvData;
    }
}

export default new BrandService();