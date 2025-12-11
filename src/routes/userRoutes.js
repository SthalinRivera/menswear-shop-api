// src/routes/userRoutes.js
import express from 'express';
import UserController from '../controllers/userController.js';

const router = express.Router();

// RUTAS PÚBLICAS PARA PRUEBAS
router.get('/test-db', UserController.testDB);
router.get('/count', UserController.countUsers);

// RUTAS BÁSICAS DE USUARIOS
router.get('/', UserController.getUsers);
router.get('/:id', UserController.getUserById);
router.post('/', UserController.createUser);

export default router;
