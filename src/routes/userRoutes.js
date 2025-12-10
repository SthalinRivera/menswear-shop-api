const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');

// RUTAS PÚBLICAS PARA PRUEBAS
router.get('/test-db', UserController.testDB);
router.get('/count', UserController.countUsers);

// RUTAS BÁSICAS DE USUARIOS
router.get('/', UserController.getUsers);
router.get('/:id', UserController.getUserById);
router.post('/', UserController.createUser);

module.exports = router;