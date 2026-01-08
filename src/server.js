import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

import passport from "./config/passport.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorMiddleware.js";
import { testConnection } from "./config/database.js";
import logger from "./utils/logger.js";

// Rutas
import authRoutes from "./routes/authRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import brandRoutes from "./routes/brandRoutes.js";
import productImageRoutes from "./routes/productImageRoutes.js";
// import inventoryRoutes from "./routes/inventoryRoutes.js";
// import saleRoutes from "./routes/saleRoutes.js";
// import customerRoutes from "./routes/customerRoutes.js";
// import supplierRoutes from "./routes/supplierRoutes.js";
// import purchaseRoutes from "./routes/purchaseRoutes.js";
// import warehouseRoutes from "./routes/warehouseRoutes.js";
// import promotionRoutes from "./routes/promotionRoutes.js";
// import reportRoutes from "./routes/reportRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || "v1";

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        success: false,
        message: "Demasiadas solicitudes desde esta IP. Intenta de nuevo en 15 minutos.",
    },
});

// Middlewares globales
app.use(helmet());
app.use(express.json()) // para parsear JSON
// Configuración de CORS
const allowedOrigins = [
    'http://localhost:4000',  // tu frontend en desarrollo
    'http://localhost:3000',  // si tienes otro dev server
    'https://menswear-shop-api.vercel.app/', // api producción
    'https://menswear-shop-ten.vercel.app', //front producción

]

app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin) return callback(null, true) // Postman, curl, etc.
            if (allowedOrigins.includes(origin)) {
                callback(null, true)
            } else {
                callback(new Error('Not allowed by CORS'))
            }
        },
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    })
)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(morgan("combined", { stream: logger.stream }));
app.use(`/api/${API_VERSION}`, limiter);

app.use(passport.initialize());
// Ruta raíz - landing page o mensaje de bienvenida
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Bienvenido a la API de Moda Express!",
        info: "Usa /api/v1 para acceder a los endpoints. Por ejemplo: /api/v1/auth/login"
    });
});
// Health check
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "tienda-api",
        version: "1.0.0",
    });
});

// Rutas API
app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/roles`, roleRoutes);
app.use(`/api/${API_VERSION}/users`, userRoutes);
app.use(`/api/${API_VERSION}/products`, productRoutes);
app.use(`/api/${API_VERSION}/categories`, categoryRoutes);
app.use(`/api/${API_VERSION}/brands`, brandRoutes);
app.use(`/api/${API_VERSION}/images`, productImageRoutes);
// app.use(`/api/${API_VERSION}/inventory`, inventoryRoutes);
// app.use(`/api/${API_VERSION}/sales`, saleRoutes);
// app.use(`/api/${API_VERSION}/customers`, customerRoutes);
// app.use(`/api/${API_VERSION}/suppliers`, supplierRoutes);
// app.use(`/api/${API_VERSION}/purchases`, purchaseRoutes);
// app.use(`/api/${API_VERSION}/warehouses`, warehouseRoutes);
// app.use(`/api/${API_VERSION}/promotions`, promotionRoutes);
// app.use(`/api/${API_VERSION}/reports`, reportRoutes);

// Errores
app.use(notFoundHandler);
app.use(errorHandler);

// Iniciar servidor
const startServer = async () => {
    try {
        const dbConnected = await testConnection();
        if (!dbConnected) {
            logger.error("❌ No se pudo conectar a la base de datos");
            process.exit(1);
        }

        app.listen(PORT, () => {
            logger.info(`🚀 Servidor iniciado en http://localhost:${PORT}`);
            logger.info(`🔗 API Base: http://localhost:${PORT}/api/${API_VERSION}`);
        });
    } catch (error) {
        logger.error("❌ Error al iniciar el servidor:", error);
        process.exit(1);
    }
};

// Señales del sistema
process.on("SIGTERM", () => {
    logger.info("SIGTERM recibido. Cerrando servidor...");
    process.exit(0);
});

process.on("SIGINT", () => {
    logger.info("SIGINT recibido. Cerrando servidor...");
    process.exit(0);
});

// Iniciar
if (process.env.NODE_ENV !== "test") {
    startServer();
}

// Correcto export en ESM
export default app;
