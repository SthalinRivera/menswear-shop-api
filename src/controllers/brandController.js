import BrandService from "../services/brandService.js";
import {
    sendSuccess,
    sendError,
    sendNotFound,
    sendValidationError,
    sendCreated,
    sendUpdated,
    sendDeleted
} from "../utils/responseHandler.js";

class BrandController {
    // Obtener todas las marcas con paginación
    async getBrands(req, res) {
        try {
            const {
                page = 1,
                limit = 20,
                search = '',
                only_active = true,
                pais_origen = null,
                sort_by = 'nombre',
                sort_order = 'ASC'
            } = req.query;

            const filters = {
                search,
                only_active: only_active === 'true',
                pais_origen
            };

            const options = {
                page: parseInt(page),
                limit: parseInt(limit),
                sort_by,
                sort_order: sort_order.toUpperCase()
            };

            const result = await BrandService.getBrands(filters, options);

            sendSuccess(res, result, "Marcas obtenidas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener todas las marcas activas (sin paginación para dropdowns)
    async getAllActiveBrands(req, res) {
        try {
            const brands = await BrandService.getAllActiveBrands();
            sendSuccess(res, brands, "Marcas activas obtenidas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener marca por ID
    async getBrandById(req, res) {
        try {
            const { id } = req.params;
            const { include_products = false, include_stats = false } = req.query;

            const brand = await BrandService.getBrandById(parseInt(id), {
                include_products: include_products === 'true',
                include_stats: include_stats === 'true'
            });

            if (!brand) {
                return sendNotFound(res, "Marca");
            }

            sendSuccess(res, brand, "Marca obtenida exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener marca por slug
    async getBrandBySlug(req, res) {
        try {
            const { slug } = req.params;
            const { include_products = true } = req.query;

            const brand = await BrandService.getBrandBySlug(slug, {
                include_products: include_products === 'true'
            });

            if (!brand) {
                return sendNotFound(res, "Marca");
            }

            sendSuccess(res, brand, "Marca obtenida exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener productos de una marca
    async getBrandProducts(req, res) {
        try {
            const { id } = req.params;
            const {
                page = 1,
                limit = 20,
                categoria_id = null,
                min_price = null,
                max_price = null,
                in_stock = null,
                sort_by = 'nombre',
                sort_order = 'ASC'
            } = req.query;

            const filters = {
                categoria_id: categoria_id ? parseInt(categoria_id) : null,
                min_price: min_price ? parseFloat(min_price) : null,
                max_price: max_price ? parseFloat(max_price) : null,
                in_stock: in_stock === 'true' ? true : in_stock === 'false' ? false : null
            };

            const options = {
                page: parseInt(page),
                limit: parseInt(limit),
                sort_by,
                sort_order: sort_order.toUpperCase()
            };

            const result = await BrandService.getBrandProducts(parseInt(id), filters, options);

            sendSuccess(res, result, "Productos de marca obtenidos exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Crear nueva marca
    async createBrand(req, res) {
        try {
            const brandData = req.body;

            // Auto-generar slug si no se proporciona
            if (!brandData.slug && brandData.nombre) {
                brandData.slug = brandData.nombre
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
            }

            const newBrand = await BrandService.createBrand(brandData);

            sendCreated(res, newBrand, "Marca creada exitosamente");
        } catch (error) {
            if (error.code === '23505') {
                return sendError(res, {
                    message: "Ya existe una marca con ese nombre o slug"
                }, 400);
            }
            sendError(res, error);
        }
    }

    // Actualizar marca
    async updateBrand(req, res) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            // Verificar que la marca existe
            const existingBrand = await BrandService.getBrandById(parseInt(id));
            if (!existingBrand) {
                return sendNotFound(res, "Marca");
            }

            const updatedBrand = await BrandService.updateBrand(parseInt(id), updateData);

            sendUpdated(res, updatedBrand, "Marca actualizada exitosamente");
        } catch (error) {
            if (error.code === '23505') {
                return sendError(res, {
                    message: "Ya existe una marca con ese nombre o slug"
                }, 400);
            }
            sendError(res, error);
        }
    }

    // Eliminar marca
    async deleteBrand(req, res) {
        try {
            const { id } = req.params;

            // Verificar que la marca existe
            const brand = await BrandService.getBrandById(parseInt(id));
            if (!brand) {
                return sendNotFound(res, "Marca");
            }

            // Verificar si tiene productos asociados
            const productCount = await BrandService.getProductCount(parseInt(id));
            if (productCount > 0) {
                return sendError(res, {
                    message: `No se puede eliminar una marca que tiene ${productCount} productos asociados. Mueva los productos a otra marca primero.`
                }, 400);
            }

            await BrandService.deleteBrand(parseInt(id));

            sendDeleted(res, "Marca eliminada exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Actualizar estado de marca
    async updateBrandStatus(req, res) {
        try {
            const { id } = req.params;
            const { activo } = req.body;

            // Verificar que la marca existe
            const brand = await BrandService.getBrandById(parseInt(id));
            if (!brand) {
                return sendNotFound(res, "Marca");
            }

            const updatedBrand = await BrandService.updateBrandStatus(parseInt(id), activo);

            sendSuccess(res, updatedBrand,
                activo ? "Marca activada exitosamente" : "Marca desactivada exitosamente"
            );
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener estadísticas de marcas
    async getBrandStats(req, res) {
        try {
            const stats = await BrandService.getBrandStats();

            sendSuccess(res, stats, "Estadísticas de marcas obtenidas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Obtener estadísticas detalladas de una marca
    async getBrandDetailStats(req, res) {
        try {
            const { id } = req.params;

            // Verificar que la marca existe
            const brand = await BrandService.getBrandById(parseInt(id));
            if (!brand) {
                return sendNotFound(res, "Marca");
            }

            const stats = await BrandService.getBrandDetailStats(parseInt(id));

            sendSuccess(res, stats, "Estadísticas de marca obtenidas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Búsqueda de sugerencias de marcas
    async searchBrandSuggestions(req, res) {
        try {
            const { query, limit = 10 } = req.query;

            const suggestions = await BrandService.searchBrandSuggestions(query, parseInt(limit));

            sendSuccess(res, suggestions, "Sugerencias de marcas obtenidas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Importar marcas desde CSV
    async importBrandsFromCSV(req, res) {
        try {
            if (!req.file) {
                return sendError(res, { message: "Archivo CSV requerido" }, 400);
            }

            const result = await BrandService.importBrandsFromCSV(req.file.buffer);

            sendSuccess(res, result, "Marcas importadas exitosamente");
        } catch (error) {
            sendError(res, error);
        }
    }

    // Exportar marcas a CSV
    async exportBrandsToCSV(req, res) {
        try {
            const { only_active = true } = req.query;

            const csvData = await BrandService.exportBrandsToCSV({
                only_active: only_active === 'true'
            });

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=marcas.csv');
            res.send(csvData);
        } catch (error) {
            sendError(res, error);
        }
    }
}

export default new BrandController();