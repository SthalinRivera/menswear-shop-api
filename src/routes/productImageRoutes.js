// routes/productImage.routes.js - VERIFICAR QUE ESTÉN ESTAS RUTAS
import express from 'express'
import { ProductImageController } from '../controllers/productImageController.js'

const router = express.Router()

// POST: Agregar imágenes a un producto
router.post('/product/:producto_id/add', ProductImageController.addImagesToProduct)

// PUT: Reordenar imágenes
router.put('/product/:producto_id/reorder', ProductImageController.reorderImages)

// PUT: Establecer imagen principal
router.put('/product/:producto_id/principal', ProductImageController.setMainImage)

// DELETE: Eliminar una imagen específica
router.delete('/:imagen_id', ProductImageController.deleteImage)

// GET: Obtener imágenes de un producto (opcional)
router.get('/product/:producto_id', ProductImageController.getImagesByProduct)

export default router