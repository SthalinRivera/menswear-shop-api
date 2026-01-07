import CategoryService from "../services/categoryService.js";
import { sendSuccess, sendError, sendValidationError } from "../utils/responseHandler.js";

class CategoryController {
    // Obtener todas las categorías con paginación
    async getCategories(req, res) {
        try {
            const {
                page = 1,
                limit = 20,
                search = '',
                include_products = false,
                only_active = true,
                nivel = null,
                sort_by = 'nombre',
                sort_order = 'ASC'
            } = req.query;

            const filters = {
                search,
                only_active: only_active === 'true',
                nivel: nivel ? parseInt(nivel) : null
            };

            const options = {
                page: parseInt(page),
                limit: parseInt(limit),
                sort_by,
                sort_order: sort_order.toUpperCase()
            };

            const result = include_products === 'true'
                ? await CategoryService.getCategoriesWithProducts(filters, options)
                : await CategoryService.getCategories(filters, options);

            sendSuccess(res, result, "Categorías obtenidas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener árbol completo de categorías
    async getCategoryTree(req, res) {
        try {
            const { only_active = true } = req.query;

            const categories = await CategoryService.getCategoryTree({
                only_active: only_active === 'true'
            });

            sendSuccess(res, categories, "Árbol de categorías obtenido exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener categoría por ID
    async getCategoryById(req, res) {
        try {
            const { id } = req.params;
            const { include_products = false, include_parent = false } = req.query;

            const category = await CategoryService.getCategoryById(parseInt(id), {
                include_products: include_products === 'true',
                include_parent: include_parent === 'true'
            });

            if (!category) {
                return sendError(res, { message: "Categoría no encontrada" }, 404);
            }

            sendSuccess(res, category, "Categoría obtenida exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener categoría por slug
    async getCategoryBySlug(req, res) {
        try {
            const { slug } = req.params;
            const { include_products = true } = req.query;

            const category = await CategoryService.getCategoryBySlug(slug, {
                include_products: include_products === 'true'
            });

            if (!category) {
                return sendError(res, { message: "Categoría no encontrada" }, 404);
            }

            sendSuccess(res, category, "Categoría obtenida exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener productos de una categoría
    async getCategoryProducts(req, res) {
        try {
            const { id } = req.params;
            const {
                page = 1,
                limit = 20,
                min_price = null,
                max_price = null,
                marca_id = null,
                sort_by = 'nombre',
                sort_order = 'ASC'
            } = req.query;

            const filters = {
                min_price: min_price ? parseFloat(min_price) : null,
                max_price: max_price ? parseFloat(max_price) : null,
                marca_id: marca_id ? parseInt(marca_id) : null
            };

            const options = {
                page: parseInt(page),
                limit: parseInt(limit),
                sort_by,
                sort_order: sort_order.toUpperCase()
            };

            const result = await CategoryService.getCategoryProducts(parseInt(id), filters, options);

            sendSuccess(res, result, "Productos de categoría obtenidos exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Crear nueva categoría
    async createCategory(req, res) {
        try {
            const categoryData = req.body;

            // Auto-generar slug si no se proporciona
            if (!categoryData.slug && categoryData.nombre) {
                categoryData.slug = categoryData.nombre
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
            }

            // Auto-calcular nivel si no se proporciona
            if (!categoryData.nivel && categoryData.categoria_padre_id) {
                const parentCategory = await CategoryService.getCategoryById(categoryData.categoria_padre_id);
                categoryData.nivel = parentCategory ? parentCategory.nivel + 1 : 1;
            } else if (!categoryData.nivel) {
                categoryData.nivel = 1;
            }

            const newCategory = await CategoryService.createCategory(categoryData);

            sendSuccess(res, newCategory, "Categoría creada exitosamente", 201);
        } catch (error) {
            if (error.code === '23505') { // Violación de unicidad en PostgreSQL
                return sendError(res, {
                    message: "Ya existe una categoría con ese nombre o slug"
                }, 400);
            }
            sendError(res, error);
        }
    }

    // Actualizar categoría
    async updateCategory(req, res) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            // Verificar que la categoría existe
            const existingCategory = await CategoryService.getCategoryById(parseInt(id));
            if (!existingCategory) {
                return sendError(res, { message: "Categoría no encontrada" }, 404);
            }

            // Prevenir bucles en el árbol (una categoría no puede ser padre de sí misma)
            if (updateData.categoria_padre_id === parseInt(id)) {
                return sendError(res, {
                    message: "Una categoría no puede ser padre de sí misma"
                }, 400);
            }

            // Si se cambia el padre, actualizar niveles
            if (updateData.categoria_padre_id &&
                updateData.categoria_padre_id !== existingCategory.categoria_padre_id) {
                const parentCategory = await CategoryService.getCategoryById(updateData.categoria_padre_id);
                updateData.nivel = parentCategory ? parentCategory.nivel + 1 : 1;
            }

            const updatedCategory = await CategoryService.updateCategory(parseInt(id), updateData);

            sendSuccess(res, updatedCategory, "Categoría actualizada exitosamente");
        } catch (error) {
            if (error.code === '23505') {
                return sendError(res, {
                    message: "Ya existe una categoría con ese nombre o slug"
                }, 400);
            }
            sendError(res, error);
        }
    }

    // Eliminar categoría
    async deleteCategory(req, res) {
        try {
            const { id } = req.params;

            // Verificar que la categoría existe
            const category = await CategoryService.getCategoryById(parseInt(id));
            if (!category) {
                return sendError(res, { message: "Categoría no encontrada" }, 404);
            }

            // Verificar si tiene subcategorías
            const hasSubcategories = await CategoryService.hasSubcategories(parseInt(id));
            if (hasSubcategories) {
                return sendError(res, {
                    message: "No se puede eliminar una categoría que tiene subcategorías. Elimine las subcategorías primero o mueva las subcategorías a otra categoría padre."
                }, 400);
            }

            // Verificar si tiene productos asociados
            const productCount = await CategoryService.getProductCount(parseInt(id));
            if (productCount > 0) {
                return sendError(res, {
                    message: `No se puede eliminar una categoría que tiene ${productCount} productos asociados. Mueva los productos a otra categoría primero.`
                }, 400);
            }

            await CategoryService.deleteCategory(parseInt(id));

            sendSuccess(res, null, "Categoría eliminada exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Actualizar estado de categoría
    async updateCategoryStatus(req, res) {
        try {
            const { id } = req.params;
            const { activo } = req.body;

            // Verificar que la categoría existe
            const category = await CategoryService.getCategoryById(parseInt(id));
            if (!category) {
                return sendError(res, { message: "Categoría no encontrada" }, 404);
            }

            const updatedCategory = await CategoryService.updateCategoryStatus(parseInt(id), activo);

            sendSuccess(res, updatedCategory,
                activo ? "Categoría activada exitosamente" : "Categoría desactivada exitosamente"
            );
        } catch (error) {
            sendError(res, error);
        }
    }

    // Actualizar orden de categoría
    async updateCategoryOrder(req, res) {
        try {
            const { id } = req.params;
            const { orden } = req.body;

            // Verificar que la categoría existe
            const category = await CategoryService.getCategoryById(parseInt(id));
            if (!category) {
                return sendError(res, { message: "Categoría no encontrada" }, 404);
            }

            const updatedCategory = await CategoryService.updateCategoryOrder(parseInt(id), orden);

            sendSuccess(res, updatedCategory, "Orden de categoría actualizado exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Mover categoría entre padres
    async moveCategory(req, res) {
        try {
            const { id } = req.params;
            const { nuevo_padre_id } = req.body;

            // Verificar que la categoría existe
            const category = await CategoryService.getCategoryById(parseInt(id));
            if (!category) {
                return sendError(res, { message: "Categoría no encontrada" }, 404);
            }

            // Prevenir bucles
            if (nuevo_padre_id === parseInt(id)) {
                return sendError(res, {
                    message: "Una categoría no puede ser padre de sí misma"
                }, 400);
            }

            const movedCategory = await CategoryService.moveCategory(parseInt(id), nuevo_padre_id);

            sendSuccess(res, movedCategory, "Categoría movida exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener estadísticas de categorías
    async getCategoryStats(req, res) {
        try {
            const stats = await CategoryService.getCategoryStats();

            sendSuccess(res, stats, "Estadísticas de categorías obtenidas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener estadísticas detalladas de una categoría
    async getCategoryDetailStats(req, res) {
        try {
            const { id } = req.params;

            // Verificar que la categoría existe
            const category = await CategoryService.getCategoryById(parseInt(id));
            if (!category) {
                return sendError(res, { message: "Categoría no encontrada" }, 404);
            }

            const stats = await CategoryService.getCategoryDetailStats(parseInt(id));

            sendSuccess(res, stats, "Estadísticas de categoría obtenidas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Búsqueda de sugerencias de categorías
    async searchCategorySuggestions(req, res) {
        try {
            const { query, limit = 10 } = req.query;

            const suggestions = await CategoryService.searchCategorySuggestions(query, parseInt(limit));

            sendSuccess(res, suggestions, "Sugerencias obtenidas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }
}

export default new CategoryController();