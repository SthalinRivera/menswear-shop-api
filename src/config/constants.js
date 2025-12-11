// Roles del sistema
export const ROLES = {
    SUPER_ADMIN: 'Super Administrador',
    ADMIN_TIENDA: 'Administrador Tienda',
    GERENTE_VENTAS: 'Gerente de Ventas',
    VENDEDOR: 'Vendedor',
    ALMACENISTA: 'Almacenista',
    CLIENTE_VIP: 'Cliente VIP',
    CLIENTE_REGULAR: 'Cliente Regular',
};

// Permisos comunes
export const PERMISOS = {
    VENTAS_CREAR: 'VENTAS_CREAR',
    VENTAS_VER: 'VENTAS_VER',
    VENTAS_EDITAR: 'VENTAS_EDITAR',
    VENTAS_ANULAR: 'VENTAS_ANULAR',
    VENTAS_REPORTES: 'VENTAS_REPORTES',

    INV_VER: 'INV_VER',
    INV_EDITAR: 'INV_EDITAR',
    INV_AJUSTAR: 'INV_AJUSTAR',

    PRODUCTOS_VER: 'PRODUCTOS_VER',
    PRODUCTOS_EDITAR: 'PRODUCTOS_EDITAR',

    CLIENTES_VER: 'CLIENTES_VER',
    CLIENTES_EDITAR: 'CLIENTES_EDITAR',

    EMPLEADOS_VER: 'EMPLEADOS_VER',
    EMPLEADOS_EDITAR: 'EMPLEADOS_EDITAR',

    CONFIG_VER: 'CONFIG_VER',
    CONFIG_EDITAR: 'CONFIG_EDITAR',
};

// Estados comunes
export const ESTADOS_VENTA = {
    PENDIENTE: 'Pendiente',
    PAGADA: 'Pagada',
    CANCELADA: 'Cancelada',
    REEMBOLSADA: 'Reembolsada',
    ENVIADA: 'Enviada',
    ENTREGADA: 'Entregada',
};

export const ESTADOS_PEDIDO = {
    PENDIENTE: 'Pendiente',
    ENVIADO: 'Enviado',
    RECIBIDO: 'Recibido',
    CANCELADO: 'Cancelado',
    PARCIAL: 'Parcial',
};

// Tamaños de archivo (en bytes)
export const FILE_LIMITS = {
    MAX_FILE_SIZE: 5 * 1024 * 1024,
    ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};

// Paginación
export const PAGINATION = {
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100,
};

// Mensajes de error
export const ERROR_MESSAGES = {
    UNAUTHORIZED: 'No autorizado',
    FORBIDDEN: 'Acceso denegado',
    NOT_FOUND: 'Recurso no encontrado',
    VALIDATION_ERROR: 'Error de validación',
    INTERNAL_ERROR: 'Error interno del servidor',
    DUPLICATE_ENTRY: 'El registro ya existe',
};

// Variables de entorno con defaults
export const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_dev';
export const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh_secret_dev';
export const JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE || '30d';

// Variables de entorno con GOGLE CLEITENT
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
export const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback';
