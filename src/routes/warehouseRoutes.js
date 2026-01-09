import express from "express";
import { body } from "express-validator";

import WarehouseController from "../controllers/warehouseController.js";
import { authenticateJWT, checkPermission } from "../middlewares/authMiddleware.js";
import { validate, validationSchemas } from "../middlewares/validationMiddleware.js";

const router = express.Router();
// Rutas públicas (solo lectura)
router.get('/',
    validate(validationSchemas.pagination.concat(validationSchemas.search)),
    WarehouseController.getWarehouses
);


export default router;