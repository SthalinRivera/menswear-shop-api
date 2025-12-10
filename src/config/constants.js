module.exports = {
    // Roles del sistema
    ROLES: {
        SUPER_ADMIN: 'Super Administrador',
        ADMIN_TIENDA: 'Administrador Tienda',
        GERENTE_VENTAS: 'Gerente de Ventas',
        VENDEDOR: 'Vendedor',
        ALMACENISTA: 'Almacenista',
        CLIENTE_VIP: 'Cliente VIP',
        CLIENTE_REGULAR: 'Cliente Regular',
    },

    // Permisos comunes
    PERMISOS: {
        // Ventas
        VENTAS_CREAR: 'VENTAS_CREAR',
        VENTAS_VER: 'VENTAS_VER',
        VENTAS_EDITAR: 'VENTAS_EDITAR',
        VENTAS_ANULAR: 'VENTAS_ANULAR',
        VENTAS_REPORTES: 'VENTAS_REPORTES',

        // Inventario
        INV_VER: 'INV_VER',
        INV_EDITAR: 'INV_EDITAR',
        INV_AJUSTAR: 'INV_AJUSTAR',

        // Productos
        PRODUCTOS_VER: 'PRODUCTOS_VER',
        PRODUCTOS_EDITAR: 'PRODUCTOS_EDITAR',

        // Clientes
        CLIENTES_VER: 'CLIENTES_VER',
        CLIENTES_EDITAR: 'CLIENTES_EDITAR',

        // Empleados
        EMPLEADOS_VER: 'EMPLEADOS_VER',
        EMPLEADOS_EDITAR: 'EMPLEADOS_EDITAR',

        // Configuración
        CONFIG_VER: 'CONFIG_VER',
        CONFIG_EDITAR: 'CONFIG_EDITAR',
    },

    // Estados comunes
    ESTADOS_VENTA: {
        PENDIENTE: 'Pendiente',
        PAGADA: 'Pagada',
        CANCELADA: 'Cancelada',
        REEMBOLSADA: 'Reembolsada',
        ENVIADA: 'Enviada',
        ENTREGADA: 'Entregada',
    },

    ESTADOS_PEDIDO: {
        PENDIENTE: 'Pendiente',
        ENVIADO: 'Enviado',
        RECIBIDO: 'Recibido',
        CANCELADO: 'Cancelado',
        PARCIAL: 'Parcial',
    },

    // Tamaños de archivo (en bytes)
    FILE_LIMITS: {
        MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
        ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    },

    // Paginación
    PAGINATION: {
        DEFAULT_LIMIT: 20,
        MAX_LIMIT: 100,
    },

    // Mensajes de error
    ERROR_MESSAGES: {
        UNAUTHORIZED: 'No autorizado',
        FORBIDDEN: 'Acceso denegado',
        NOT_FOUND: 'Recurso no encontrado',
        VALIDATION_ERROR: 'Error de validación',
        INTERNAL_ERROR: 'Error interno del servidor',
        DUPLICATE_ENTRY: 'El registro ya existe',
    },

    // Variables de entorno con defaults
    JWT_SECRET: process.env.JWT_SECRET || 'secret_key_dev',
    JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'refresh_secret_dev',
    JWT_REFRESH_EXPIRE: process.env.JWT_REFRESH_EXPIRE || '30d',
};