import pool from "../config/database.js";

class CategoryService {
    // Obtener todas las categorías con filtros
    async getCategories(filters = {}, options = {}) {
        const {
            search = '',
            only_active = true,
            nivel = null
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
        c.*,
        cp.nombre as categoria_padre_nombre,
        COUNT(p.producto_id) as total_productos
      FROM categorias c
      LEFT JOIN categorias cp ON c.categoria_padre_id = cp.categoria_id
      LEFT JOIN productos p ON c.categoria_id = p.categoria_id
    `;

        const whereConditions = [];
        const queryParams = [];

        if (only_active) {
            whereConditions.push('c.activo = TRUE');
        }

        if (search) {
            whereConditions.push(`(
        c.nombre ILIKE $${queryParams.length + 1} OR 
        c.descripcion ILIKE $${queryParams.length + 1}
      )`);
            queryParams.push(`%${search}%`);
        }

        if (nivel) {
            whereConditions.push(`c.nivel = $${queryParams.length + 1}`);
            queryParams.push(nivel);
        }

        if (whereConditions.length > 0) {
            query += ' WHERE ' + whereConditions.join(' AND ');
        }

        query += `
      GROUP BY c.categoria_id, cp.categoria_id
      ORDER BY ${sort_by} ${sort_order}
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

        queryParams.push(limit, offset);

        // Contar total para paginación
        let countQuery = `
      SELECT COUNT(*) as total
      FROM categorias c
    `;

        const countWhereConditions = [];
        const countParams = [];

        if (only_active) {
            countWhereConditions.push('c.activo = TRUE');
        }

        if (search) {
            countWhereConditions.push(`(
        c.nombre ILIKE $${countParams.length + 1} OR 
        c.descripcion ILIKE $${countParams.length + 1}
      )`);
            countParams.push(`%${search}%`);
        }

        if (nivel) {
            countWhereConditions.push(`c.nivel = $${countParams.length + 1}`);
            countParams.push(nivel);
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

    // Obtener categorías con productos incluidos
    async getCategoriesWithProducts(filters = {}, options = {}) {
        const categories = await this.getCategories(filters, options);

        // Para cada categoría, obtener sus productos
        for (let category of categories.data) {
            const products = await this.getCategoryProducts(category.categoria_id, {}, { limit: 10, page: 1 });
            category.productos = products.data;
        }

        return categories;
    }

    // Obtener árbol de categorías
    async getCategoryTree(options = {}) {
        const { only_active = true } = options;

        let query = `
      WITH RECURSIVE category_tree AS (
        SELECT 
          c.*,
          ARRAY[]::INTEGER[] as path_ids,
          ARRAY[]::VARCHAR[] as path_names
        FROM categorias c
        WHERE c.categoria_padre_id IS NULL
        ${only_active ? 'AND c.activo = TRUE' : ''}
        
        UNION ALL
        
        SELECT 
          c.*,
          ct.path_ids || c.categoria_padre_id,
          ct.path_names || cp.nombre
        FROM categorias c
        INNER JOIN categorias cp ON c.categoria_padre_id = cp.categoria_id
        INNER JOIN category_tree ct ON c.categoria_padre_id = ct.categoria_id
        ${only_active ? 'WHERE c.activo = TRUE' : ''}
      )
      SELECT 
        ct.*,
        COUNT(p.producto_id) as total_productos,
        (
          SELECT COUNT(*)
          FROM categorias sc
          WHERE sc.categoria_padre_id = ct.categoria_id
          ${only_active ? 'AND sc.activo = TRUE' : ''}
        ) as total_subcategorias,
        COALESCE(ARRAY_LENGTH(ct.path_ids, 1), 0) + 1 as depth
      FROM category_tree ct
      LEFT JOIN productos p ON ct.categoria_id = p.categoria_id
      GROUP BY ct.categoria_id, ct.path_ids, ct.path_names
      ORDER BY ct.path_ids, ct.orden, ct.nombre
    `;

        const result = await pool.query(query);

        // Convertir a estructura jerárquica
        return this.buildCategoryTree(result.rows);
    }

    // Construir árbol jerárquico
    buildCategoryTree(categories) {
        const categoryMap = {};
        const rootCategories = [];

        // Crear mapa de categorías
        categories.forEach(category => {
            category.subcategorias = [];
            categoryMap[category.categoria_id] = category;
        });

        // Organizar jerarquía
        categories.forEach(category => {
            if (category.categoria_padre_id && categoryMap[category.categoria_padre_id]) {
                categoryMap[category.categoria_padre_id].subcategorias.push(category);
            } else {
                rootCategories.push(category);
            }
        });

        return rootCategories;
    }

    // Obtener categoría por ID
    async getCategoryById(id, options = {}) {
        const { include_products = false, include_parent = false } = options;

        let query = `
      SELECT 
        c.*,
        cp.nombre as categoria_padre_nombre,
        cp.slug as categoria_padre_slug,
        COUNT(p.producto_id) as total_productos
      FROM categorias c
      LEFT JOIN categorias cp ON c.categoria_padre_id = cp.categoria_id
      LEFT JOIN productos p ON c.categoria_id = p.categoria_id
      WHERE c.categoria_id = $1
      GROUP BY c.categoria_id, cp.categoria_id
    `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return null;
        }

        const category = result.rows[0];

        // Incluir productos si se solicita
        if (include_products) {
            const products = await this.getCategoryProducts(id, {}, { limit: 50, page: 1 });
            category.productos = products.data;
        }

        // Incluir subcategorías
        const subcategories = await pool.query(
            `SELECT * FROM categorias WHERE categoria_padre_id = $1 AND activo = TRUE ORDER BY orden, nombre`,
            [id]
        );
        category.subcategorias = subcategories.rows;

        return category;
    }

    // Obtener categoría por slug
    async getCategoryBySlug(slug, options = {}) {
        const { include_products = false } = options;

        let query = `
      SELECT 
        c.*,
        cp.nombre as categoria_padre_nombre,
        cp.slug as categoria_padre_slug
      FROM categorias c
      LEFT JOIN categorias cp ON c.categoria_padre_id = cp.categoria_id
      WHERE c.slug = $1 AND c.activo = TRUE
    `;

        const result = await pool.query(query, [slug]);

        if (result.rows.length === 0) {
            return null;
        }

        const category = result.rows[0];

        // Incluir productos si se solicita
        if (include_products) {
            const products = await this.getCategoryProducts(category.categoria_id, {}, { limit: 50, page: 1 });
            category.productos = products.data;
        }

        // Incluir subcategorías
        const subcategories = await pool.query(
            `SELECT * FROM categorias WHERE categoria_padre_id = $1 AND activo = TRUE ORDER BY orden, nombre`,
            [category.categoria_id]
        );
        category.subcategorias = subcategories.rows;

        return category;
    }

    // Obtener productos de una categoría
    async getCategoryProducts(categoryId, filters = {}, options = {}) {
        const {
            min_price = null,
            max_price = null,
            marca_id = null
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
        m.nombre as marca_nombre,
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
      LEFT JOIN marcas m ON p.marca_id = m.marca_id
      WHERE p.categoria_id = $1
    `;

        const queryParams = [categoryId];
        let paramCount = 1;

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

        if (marca_id !== null) {
            paramCount++;
            query += ` AND p.marca_id = $${paramCount}`;
            queryParams.push(marca_id);
        }

        query += ` ORDER BY p.${sort_by} ${sort_order}`;
        query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        queryParams.push(limit, offset);

        // Contar total
        let countQuery = `
      SELECT COUNT(*) as total
      FROM productos p
      WHERE p.categoria_id = $1
    `;

        const countParams = [categoryId];

        if (min_price !== null) {
            countQuery += ` AND p.precio_venta >= $2`;
            countParams.push(min_price);
        }

        if (max_price !== null) {
            countQuery += ` AND p.precio_venta <= $${countParams.length + 1}`;
            countParams.push(max_price);
        }

        if (marca_id !== null) {
            countQuery += ` AND p.marca_id = $${countParams.length + 1}`;
            countParams.push(marca_id);
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

    // Crear nueva categoría
    async createCategory(categoryData) {
        const {
            nombre,
            descripcion,
            categoria_padre_id,
            nivel,
            slug,
            imagen_url,
            orden = 0,
            activo = true,
            meta_title,
            meta_description,
            meta_keywords
        } = categoryData;

        const query = `
      INSERT INTO categorias (
        nombre, descripcion, categoria_padre_id, nivel, slug, 
        imagen_url, orden, activo, meta_title, meta_description, meta_keywords
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

        const values = [
            nombre,
            descripcion,
            categoria_padre_id || null,
            nivel,
            slug,
            imagen_url,
            orden,
            activo,
            meta_title,
            meta_description,
            meta_keywords
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    // Actualizar categoría
    async updateCategory(id, updateData) {
        const fields = [];
        const values = [];
        let paramCount = 1;

        const allowedFields = [
            'nombre', 'descripcion', 'categoria_padre_id', 'nivel', 'slug',
            'imagen_url', 'orden', 'activo', 'meta_title', 'meta_description', 'meta_keywords'
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
      UPDATE categorias
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE categoria_id = $${paramCount}
      RETURNING *
    `;

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    // Eliminar categoría
    async deleteCategory(id) {
        const query = 'DELETE FROM categorias WHERE categoria_id = $1';
        await pool.query(query, [id]);
    }

    // Verificar si tiene subcategorías
    async hasSubcategories(id) {
        const query = 'SELECT COUNT(*) FROM categorias WHERE categoria_padre_id = $1';
        const result = await pool.query(query, [id]);
        return parseInt(result.rows[0].count) > 0;
    }

    // Obtener cantidad de productos en categoría
    async getProductCount(id) {
        const query = 'SELECT COUNT(*) FROM productos WHERE categoria_id = $1';
        const result = await pool.query(query, [id]);
        return parseInt(result.rows[0].count);
    }

    // Actualizar estado de categoría
    async updateCategoryStatus(id, activo) {
        const query = `
      UPDATE categorias 
      SET activo = $1, updated_at = CURRENT_TIMESTAMP
      WHERE categoria_id = $2
      RETURNING *
    `;
        const result = await pool.query(query, [activo, id]);
        return result.rows[0];
    }

    // Actualizar orden de categoría
    async updateCategoryOrder(id, orden) {
        const query = `
      UPDATE categorias 
      SET orden = $1, updated_at = CURRENT_TIMESTAMP
      WHERE categoria_id = $2
      RETURNING *
    `;
        const result = await pool.query(query, [orden, id]);
        return result.rows[0];
    }

    // Mover categoría entre padres
    async moveCategory(id, nuevo_padre_id) {
        // Obtener nivel del nuevo padre
        let newLevel = 1;
        if (nuevo_padre_id) {
            const parentQuery = 'SELECT nivel FROM categorias WHERE categoria_id = $1';
            const parentResult = await pool.query(parentQuery, [nuevo_padre_id]);
            if (parentResult.rows.length > 0) {
                newLevel = parentResult.rows[0].nivel + 1;
            }
        }

        const query = `
      UPDATE categorias 
      SET categoria_padre_id = $1, nivel = $2, updated_at = CURRENT_TIMESTAMP
      WHERE categoria_id = $3
      RETURNING *
    `;
        const result = await pool.query(query, [nuevo_padre_id || null, newLevel, id]);
        return result.rows[0];
    }

    // Obtener estadísticas de categorías
    async getCategoryStats() {
        const query = `
      SELECT 
        COUNT(*) as total_categorias,
        COUNT(CASE WHEN activo = TRUE THEN 1 END) as categorias_activas,
        COUNT(CASE WHEN activo = FALSE THEN 1 END) as categorias_inactivas,
        COUNT(DISTINCT nivel) as niveles_diferentes,
        COALESCE(AVG(total_productos), 0) as promedio_productos_por_categoria
      FROM (
        SELECT 
          c.*,
          COUNT(p.producto_id) as total_productos
        FROM categorias c
        LEFT JOIN productos p ON c.categoria_id = p.categoria_id
        GROUP BY c.categoria_id
      ) as categorias_con_productos
    `;

        const result = await pool.query(query);
        return result.rows[0];
    }

    // Obtener estadísticas detalladas de una categoría
    async getCategoryDetailStats(id) {
        const query = `
      SELECT 
        c.nombre,
        c.categoria_id,
        COUNT(p.producto_id) as total_productos,
        COALESCE(SUM(vp.stock_actual), 0) as total_stock,
        COALESCE(MIN(p.precio_venta), 0) as precio_minimo,
        COALESCE(MAX(p.precio_venta), 0) as precio_maximo,
        COALESCE(AVG(p.precio_venta), 0) as precio_promedio,
        (
          SELECT COUNT(*)
          FROM categorias sc
          WHERE sc.categoria_padre_id = c.categoria_id
          AND sc.activo = TRUE
        ) as total_subcategorias,
        (
          SELECT JSON_AGG(json_build_object(
            'marca_id', m.marca_id,
            'marca_nombre', m.nombre,
            'total_productos', subq.total
          ))
          FROM (
            SELECT p.marca_id, COUNT(*) as total
            FROM productos p
            WHERE p.categoria_id = c.categoria_id
            GROUP BY p.marca_id
          ) subq
          JOIN marcas m ON subq.marca_id = m.marca_id
        ) as productos_por_marca
      FROM categorias c
      LEFT JOIN productos p ON c.categoria_id = p.categoria_id
      LEFT JOIN variantes_producto vp ON p.producto_id = vp.producto_id
      WHERE c.categoria_id = $1
      GROUP BY c.categoria_id, c.nombre
    `;

        const result = await pool.query(query, [id]);
        return result.rows[0];
    }

    // Buscar sugerencias de categorías
    async searchCategorySuggestions(query, limit = 10) {
        const searchQuery = `
      SELECT 
        categoria_id,
        nombre,
        slug,
        descripcion
      FROM categorias
      WHERE nombre ILIKE $1
        AND activo = TRUE
      ORDER BY nombre
      LIMIT $2
    `;

        const result = await pool.query(searchQuery, [`%${query}%`, limit]);
        return result.rows;
    }
}

export default new CategoryService();