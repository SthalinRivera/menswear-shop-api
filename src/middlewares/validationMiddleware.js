import { body, query, param, validationResult } from "express-validator";
import { ERROR_MESSAGES } from "../config/constants.js";

// Middleware para validar resultados de express-validator
export const validate = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(v => v.run(req)));

        const errors = validationResult(req);

        if (errors.isEmpty()) return next();

        const extractedErrors = errors.array().map(err => ({
            [err.path]: err.msg
        }));

        return res.status(422).json({
            success: false,
            message: ERROR_MESSAGES.VALIDATION_ERROR,
            errors: extractedErrors
        });
    };
};

// También puedes agregar una versión que no valide nada (para rutas GET)
export const optionalValidate = (validations = []) => {
    return async (req, res, next) => {
        try {
            if (!validations || validations.length === 0) {
                return next();
            }
            
            await Promise.all(validations.map(v => v.run(req)));
            next();
        } catch (error) {
            console.error('Error en validación opcional:', error);
            next(); // Continúa incluso si hay error en validación
        }
    };
};
// Esquemas de validación comunes
export const validationSchemas = {
    // Autenticación
    login: [
        body("email")
            .isEmail()
            .normalizeEmail()
            .withMessage("Email inválido"),

        body("password")
            .isLength({ min: 6 })
            .withMessage("La contraseña debe tener al menos 6 caracteres")
    ],

    register: [
        body("email")
            .isEmail()
            .normalizeEmail()
            .withMessage("Email inválido"),

        body("password")
            .isLength({ min: 8 })
            .withMessage("La contraseña debe tener al menos 8 caracteres")
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
            .withMessage("La contraseña debe contener mayúsculas, minúsculas y números"),

        body("nombre")
            .notEmpty()
            .trim()
            .withMessage("El nombre es requerido"),

        body("apellido")
            .optional()
            .trim()
    ],

    // Productos
    createProduct: [
        body("sku").notEmpty().withMessage("SKU es requerido"),
        body("nombre").notEmpty().trim().withMessage("Nombre es requerido"),
        body("precio_compra").isFloat({ min: 0 }).withMessage("Precio de compra inválido"),
        body("precio_venta").isFloat({ min: 0 }).withMessage("Precio de venta inválido"),
        body("categoria_id").isInt({ min: 1 }).withMessage("Categoría inválida"),
        body("stock_minimo").optional().isInt({ min: 0 }).withMessage("Stock mínimo inválido"),
        body("stock_maximo").optional().isInt({ min: 1 }).withMessage("Stock máximo inválido"),
    ],

    updateProduct: [
        body("nombre").optional().trim().notEmpty().withMessage("Nombre no puede estar vacío"),
        body("precio_venta").optional().isFloat({ min: 0 }).withMessage("Precio de venta inválido"),
        body("activo").optional().isBoolean().withMessage("Activo debe ser booleano")
    ],

    // Ventas
    createSale: [
        body("cliente_id").optional().isInt({ min: 1 }).withMessage("Cliente inválido"),
        body("tipo_venta")
            .optional()
            .isIn(["Presencial", "Online", "Telefónica", "Mayorista"])
            .withMessage("Tipo de venta inválido"),
        body("metodo_pago")
            .optional()
            .isIn(["Efectivo", "Tarjeta Crédito", "Tarjeta Débito", "Transferencia", "PayPal", "Mercado Pago"])
            .withMessage("Método de pago inválido"),
        body("costo_envio").optional().isFloat({ min: 0 }).withMessage("Costo de envío inválido"),
        body("notas").optional().trim(),
        body("detalles")
            .isArray({ min: 1 })
            .withMessage("Debe incluir al menos un producto en los detalles"),
        body("detalles.*.producto_id")
            .isInt({ min: 1 })
            .withMessage("ID de producto inválido"),
        body("detalles.*.cantidad")
            .isInt({ min: 1 })
            .withMessage("Cantidad inválida (mínimo 1)"),
        body("detalles.*.precio_unitario")
            .isFloat({ min: 0 })
            .withMessage("Precio unitario inválido"),
        body("detalles.*.descuento_unitario")
            .optional()
            .isFloat({ min: 0 })
            .withMessage("Descuento inválido")
    ],

    // Clientes
    createCustomer: [
        body("nombre").notEmpty().trim().withMessage("Nombre es requerido"),
        body("email").isEmail().normalizeEmail().withMessage("Email inválido"),
        body("telefono")
            .optional()
            .matches(/^[0-9+\-\s()]{10,20}$/)
            .withMessage("Teléfono inválido"),
        body("tipo_cliente")
            .optional()
            .isIn(["Minorista", "Mayorista", "Empresarial", "VIP"])
    ],

    // Filtros y paginación
    pagination: [
        query("page").optional().isInt({ min: 1 }).withMessage("Página debe ser un número positivo"),
        query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Límite debe ser entre 1 y 100"),
        query("sortBy").optional().trim(),
        query("sortOrder").optional().isIn(["asc", "desc"]).withMessage("Orden debe ser asc o desc")
    ],
  // VARIANTES (AGREGA ESTOS)
    createVariant: [
        body("talla")
            .notEmpty()
            .trim()
            .withMessage("Talla es requerida"),
        body("color_nombre")
            .notEmpty()
            .trim()
            .withMessage("Nombre del color es requerido"),
        body("color_hex")
            .optional()
            .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
            .withMessage("Código HEX inválido"),
        body("codigo_barras")
            .optional()
            .trim(),
        body("stock_actual")
            .optional()
            .isInt({ min: 0 })
            .withMessage("Stock actual debe ser un número positivo"),
        body("activo")
            .optional()
            .isBoolean()
            .withMessage("Activo debe ser booleano")
    ],

    updateVariant: [
        body("talla")
            .optional()
            .trim()
            .notEmpty()
            .withMessage("Talla no puede estar vacía"),
        body("color_nombre")
            .optional()
            .trim()
            .notEmpty()
            .withMessage("Nombre del color no puede estar vacío"),
        body("color_hex")
            .optional()
            .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
            .withMessage("Código HEX inválido"),
        body("codigo_barras")
            .optional()
            .trim(),
        body("ubicacion_almacen")
            .optional()
            .trim(),
        body("activo")
            .optional()
            .isBoolean()
            .withMessage("Activo debe ser booleano")
    ],

    deleteVariant: [
        body("motivo")
            .optional()
            .trim()
            .isLength({ max: 255 })
            .withMessage("Motivo no puede exceder 255 caracteres")
    ],
    search: [
        query("q").optional().trim(),
        query("categoria_id").optional().isInt({ min: 1 }),
        query("marca_id").optional().isInt({ min: 1 }),
        query("genero").optional().isIn(["Hombre", "Mujer", "Unisex", "Niño", "Niña"]),
        query("minPrice").optional().isFloat({ min: 0 }),
        query("maxPrice").optional().isFloat({ min: 0 }),
        query("enPromocion").optional().isBoolean()
    ],
};