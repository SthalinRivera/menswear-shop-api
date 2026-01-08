// routes/productImage.routes.js
import express from 'express'
import { ProductImageController } from '../controllers/productImageController.js'


const router = express.Router()

router.post(
    '/',
    ProductImageController.createImages
)

router.delete(
    '/:imagen_id',
    ProductImageController.deleteImage
)

export default router