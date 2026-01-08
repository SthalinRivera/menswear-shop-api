// controllers/productImage.controller.js
import { getClient } from '../config/database.js'
import { asyncHandler } from '../middlewares/errorMiddleware.js'

export class ProductImageController {

    // 🔹 Guardar imágenes del producto
    static createImages = asyncHandler(async (req, res) => {
        const client = await getClient()

        try {
            const { producto_id, imagenes } = req.body

            if (!producto_id || !Array.isArray(imagenes) || imagenes.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'producto_id e imagenes son requeridos'
                })
            }

            await client.query('BEGIN')

            for (let i = 0; i < imagenes.length; i++) {
                const {
                    url,                // viene del frontend
                    nombre_archivo = null,
                    es_principal = false
                } = imagenes[i]

                if (!url) {
                    throw new Error('URL de imagen inválida')
                }

                await client.query(
                    `INSERT INTO imagenes_producto
                     (producto_id, url_imagen, nombre_archivo, orden, es_principal)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                        producto_id,
                        url,
                        nombre_archivo,
                        i + 1,
                        es_principal
                    ]
                )
            }

            await client.query('COMMIT')

            res.status(201).json({
                success: true,
                message: 'Imágenes registradas correctamente'
            })

        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    })

    // 🔴 Eliminar imagen (soft delete recomendado)
    static deleteImage = asyncHandler(async (req, res) => {
        const client = await getClient()
        const { imagen_id } = req.params

        const result = await client.query(
            `UPDATE imagenes_producto
             SET activo = false
             WHERE imagen_id = $1
             RETURNING *`,
            [imagen_id]
        )

        client.release()

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Imagen no encontrada'
            })
        }

        res.json({
            success: true,
            message: 'Imagen desactivada correctamente'
        })
    })
}
