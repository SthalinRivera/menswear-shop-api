const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const passport = require('./config/passport');
const { errorHandler, notFoundHandler } = require('./middlewares/errorMiddleware');
const { testConnection } = require('./config/database');
const logger = require('./utils/logger');

// Importar rutas
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const brandRoutes = require('./routes/brandRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const saleRoutes = require('./routes/saleRoutes');
const customerRoutes = require('./routes/customerRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const warehouseRoutes = require('./routes/warehouseRoutes');
const promotionRoutes = require('./routes/promotionRoutes');
const reportRoutes = require('./routes/reportRoutes');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';

// Configuración de rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // límite por IP
    message: {
        success: false,
        message: 'Demasiadas solicitudes desde esta IP, por favor intente de nuevo en 15 minutos'
    }
});

// Middlewares globales
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined', { stream: logger.stream }));

// Rate limiting solo para API
app.use(`/api/${API_VERSION}`, limiter);

// Inicializar passport
app.use(passport.initialize());

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'tienda-api',
        version: '1.0.0'
    });
});

// Rutas API
app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/users`, userRoutes);
app.use(`/api/${API_VERSION}/products`, productRoutes);
// app.use(`/api/${API_VERSION}/categories`, categoryRoutes);
// app.use(`/api/${API_VERSION}/brands`, brandRoutes);
// app.use(`/api/${API_VERSION}/inventory`, inventoryRoutes);
app.use(`/api/${API_VERSION}/sales`, saleRoutes);
// app.use(`/api/${API_VERSION}/customers`, customerRoutes);
// app.use(`/api/${API_VERSION}/suppliers`, supplierRoutes);
// app.use(`/api/${API_VERSION}/purchases`, purchaseRoutes);
// app.use(`/api/${API_VERSION}/warehouses`, warehouseRoutes);
// app.use(`/api/${API_VERSION}/promotions`, promotionRoutes);
// app.use(`/api/${API_VERSION}/reports`, reportRoutes);

// Manejo de errores
app.use(notFoundHandler);
app.use(errorHandler);

// Iniciar servidor
const startServer = async () => {
    try {
        // Probar conexión a la base de datos
        const dbConnected = await testConnection();
        if (!dbConnected) {
            logger.error('No se pudo conectar a la base de datos');
            process.exit(1);
        }

        app.listen(PORT, () => {
            logger.info(`🚀 Servidor iniciado en http://localhost:${PORT}`);
            logger.info(`📚 Documentación API: http://localhost:${PORT}/api-docs`);
            logger.info(`🔗 API Base: http://localhost:${PORT}/api/${API_VERSION}`);
        });
    } catch (error) {
        logger.error('Error al iniciar el servidor:', error);
        process.exit(1);
    }
};

// Manejo de señales de terminación
process.on('SIGTERM', () => {
    logger.info('SIGTERM recibido. Cerrando servidor...');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT recibido. Cerrando servidor...');
    process.exit(0);
});

// Iniciar
if (process.env.NODE_ENV !== 'test') {
    startServer();
}

module.exports = app; // Para testing