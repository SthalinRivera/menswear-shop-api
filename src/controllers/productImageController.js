// controllers/productImageController.js
import { getClient } from '../config/database.js'
import { asyncHandler } from '../middlewares/errorMiddleware.js'

export class ProductImageController {

    // 🔹 CREAR imágenes (existente - mantener igual)
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
                    url,
                    nombre_archivo = null,
                    es_principal = false
                } = imagenes[i]

                if (!url) {
                    throw new Error('URL de imagen inválida')
                }

                // Si es principal, desmarcar otras
                if (es_principal) {
                    await client.query(
                        'UPDATE imagenes_producto SET es_principal = false WHERE producto_id = $1',
                        [producto_id]
                    )
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

    // 🔹 ACTUALIZAR imágenes (VERSIÓN SIMPLIFICADA)
    static updateImages = asyncHandler(async (req, res) => {
        const client = await getClient()
        const { producto_id } = req.params

        try {
            await client.query('BEGIN')

            // 1. Verificar que el producto exista
            const productCheck = await client.query(
                'SELECT producto_id FROM productos WHERE producto_id = $1 AND activo = true',
                [producto_id]
            )

            if (productCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Producto no encontrado'
                })
            }

            // 2. Determinar operación
            const { operacion, imagenes } = req.body

            if (!operacion) {
                return res.status(400).json({
                    success: false,
                    message: 'El campo "operacion" es requerido (agregar|reemplazar|cambiar_principal)'
                })
            }

            switch (operacion) {
                case 'agregar':
                    await this.agregarImagenes(client, producto_id, imagenes)
                    break

                case 'reemplazar':
                    await this.reemplazarImagenes(client, producto_id, imagenes)
                    break

                case 'cambiar_principal':
                    await this.cambiarImagenPrincipal(client, producto_id, imagenes)
                    break

                default:
                    return res.status(400).json({
                        success: false,
                        message: 'Operación no válida. Opciones: agregar, reemplazar, cambiar_principal'
                    })
            }

            await client.query('COMMIT')

            // 3. Obtener imágenes actualizadas
            const updatedImages = await client.query(
                `SELECT imagen_id, url_imagen, nombre_archivo, orden, es_principal
                 FROM imagenes_producto 
                 WHERE producto_id = $1 AND activo = true
                 ORDER BY orden`,
                [producto_id]
            )

            res.json({
                success: true,
                message: getSuccessMessage(operacion),
                data: updatedImages.rows
            })

        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    })
    // 🔹 OBTENER imágenes por producto (nuevo método)
static getImagesByProduct = asyncHandler(async (req, res) => {
  const client = await getClient()
  const { producto_id } = req.params

  try {
    const result = await client.query(
      `SELECT imagen_id, url_imagen, nombre_archivo, orden, es_principal
       FROM imagenes_producto 
       WHERE producto_id = $1 AND activo = true
       ORDER BY orden`,
      [producto_id]
    )

    res.json({
      success: true,
      data: result.rows
    })
  } finally {
    client.release()
  }
})
    // 🔴 ELIMINAR imagen (soft delete)
    static deleteImage = asyncHandler(async (req, res) => {
        const client = await getClient()
        const { imagen_id } = req.params

        // Verificar que la imagen existe
        const imageCheck = await client.query(
            'SELECT producto_id, es_principal FROM imagenes_producto WHERE imagen_id = $1 AND activo = true',
            [imagen_id]
        )

        if (imageCheck.rows.length === 0) {
            client.release()
            return res.status(404).json({
                success: false,
                message: 'Imagen no encontrada'
            })
        }

        const { producto_id, es_principal } = imageCheck.rows[0]

        // Si es la imagen principal, marcar otra como principal
        if (es_principal) {
            await client.query(
                `UPDATE imagenes_producto 
                 SET es_principal = true 
                 WHERE imagen_id = (
                     SELECT imagen_id 
                     FROM imagenes_producto 
                     WHERE producto_id = $1 
                       AND imagen_id != $2
                       AND activo = true 
                     ORDER BY orden 
                     LIMIT 1
                 )`,
                [producto_id, imagen_id]
            )
        }

        // Desactivar la imagen
        const result = await client.query(
            `UPDATE imagenes_producto
             SET activo = false
             WHERE imagen_id = $1`,
            [imagen_id]
        )

        client.release()

        res.json({
            success: true,
            message: 'Imagen eliminada correctamente'
        })
    })

    // =============================================
    // MÉTODOS PRIVADOS SIMPLIFICADOS
    // =============================================

    static async agregarImagenes(client, producto_id, imagenes) {
        if (!Array.isArray(imagenes) || imagenes.length === 0) {
            throw new Error('Debe proporcionar al menos una imagen para agregar')
        }

        // Obtener el último orden
        const lastOrderResult = await client.query(
            'SELECT COALESCE(MAX(orden), 0) as max_orden FROM imagenes_producto WHERE producto_id = $1',
            [producto_id]
        )
        let nextOrder = lastOrderResult.rows[0].max_orden + 1

        for (const imagen of imagenes) {
            const { url, nombre_archivo = null, es_principal = false } = imagen

            if (!url) {
                throw new Error('URL de imagen requerida')
            }

            // Si se marca como principal, desmarcar las otras
            if (es_principal) {
                await client.query(
                    'UPDATE imagenes_producto SET es_principal = false WHERE producto_id = $1',
                    [producto_id]
                )
            }

            await client.query(
                `INSERT INTO imagenes_producto
                 (producto_id, url_imagen, nombre_archivo, orden, es_principal)
                 VALUES ($1, $2, $3, $4, $5)`,
                [producto_id, url, nombre_archivo, nextOrder, es_principal]
            )

            nextOrder++
        }
    }

    static async reemplazarImagenes(client, producto_id, imagenes) {
        if (!Array.isArray(imagenes)) {
            throw new Error('Debe proporcionar la lista de nuevas imágenes')
        }

        // 1. Desactivar todas las imágenes existentes
        await client.query(
            'UPDATE imagenes_producto SET activo = false WHERE producto_id = $1',
            [producto_id]
        )

        // 2. Insertar nuevas imágenes
        for (let i = 0; i < imagenes.length; i++) {
            const { url, nombre_archivo = null, es_principal = false } = imagenes[i]

            if (!url) {
                throw new Error('URL de imagen requerida')
            }

            // Solo la primera imagen será principal por defecto
            const isPrincipal = (i === 0 && imagenes.length > 0) ? true : es_principal

            await client.query(
                `INSERT INTO imagenes_producto
                 (producto_id, url_imagen, nombre_archivo, orden, es_principal)
                 VALUES ($1, $2, $3, $4, $5)`,
                [producto_id, url, nombre_archivo, i + 1, isPrincipal]
            )
        }
    }

    static async cambiarImagenPrincipal(client, producto_id, imagenes) {
        if (!Array.isArray(imagenes) || imagenes.length === 0) {
            throw new Error('Debe especificar una imagen como principal')
        }

        const { imagen_id } = imagenes[0]

        if (!imagen_id) {
            throw new Error('imagen_id es requerido para establecer como principal')
        }

        // Verificar que la imagen existe y pertenece al producto
        const checkResult = await client.query(
            'SELECT 1 FROM imagenes_producto WHERE imagen_id = $1 AND producto_id = $2 AND activo = true',
            [imagen_id, producto_id]
        )

        if (checkResult.rows.length === 0) {
            throw new Error('La imagen no existe o no pertenece al producto')
        }

        // 1. Desmarcar todas como no principales
        await client.query(
            'UPDATE imagenes_producto SET es_principal = false WHERE producto_id = $1',
            [producto_id]
        )

        // 2. Marcar la especificada como principal
        await client.query(
            'UPDATE imagenes_producto SET es_principal = true WHERE imagen_id = $1',
            [imagen_id]
        )
    }
    // 🔹 AGREGAR imágenes a un producto (nuevo método)
    static addImagesToProduct = asyncHandler(async (req, res) => {
        const client = await getClient()
        const { producto_id } = req.params
        const { imagenes } = req.body

        try {
            await client.query('BEGIN')

            // Verificar que el producto existe
            const productCheck = await client.query(
                'SELECT producto_id FROM productos WHERE producto_id = $1 AND activo = true',
                [producto_id]
            )

            if (productCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Producto no encontrado'
                })
            }

            // Obtener el último orden
            const lastOrderResult = await client.query(
                'SELECT COALESCE(MAX(orden), 0) as max_orden FROM imagenes_producto WHERE producto_id = $1 AND activo = true',
                [producto_id]
            )
            let nextOrder = lastOrderResult.rows[0].max_orden + 1

            // Verificar si ya hay imágenes para determinar si será principal
            const existingImages = await client.query(
                'SELECT COUNT(*) as count FROM imagenes_producto WHERE producto_id = $1 AND activo = true',
                [producto_id]
            )
            const hasExistingImages = parseInt(existingImages.rows[0].count) > 0

            for (const imagen of imagenes) {
                const { url, nombre_archivo = null, es_principal = false } = imagen

                if (!url) {
                    throw new Error('URL de imagen requerida')
                }

                // Si se marca como principal, desmarcar las otras
                if (es_principal) {
                    await client.query(
                        'UPDATE imagenes_producto SET es_principal = false WHERE producto_id = $1 AND activo = true',
                        [producto_id]
                    )
                }

                // Si no hay imágenes existentes y es la primera, hacerla principal
                const isPrincipal = (!hasExistingImages && nextOrder === 1) || es_principal

                await client.query(
                    `INSERT INTO imagenes_producto
                     (producto_id, url_imagen, nombre_archivo, orden, es_principal, activo)
                     VALUES ($1, $2, $3, $4, $5, true)`,
                    [producto_id, url, nombre_archivo, nextOrder, isPrincipal]
                )

                nextOrder++
            }

            await client.query('COMMIT')

            // Obtener imágenes actualizadas
            const updatedImages = await client.query(
                `SELECT imagen_id, url_imagen, nombre_archivo, orden, es_principal
                 FROM imagenes_producto 
                 WHERE producto_id = $1 AND activo = true
                 ORDER BY orden`,
                [producto_id]
            )

            res.status(201).json({
                success: true,
                message: 'Imágenes agregadas correctamente',
                data: updatedImages.rows
            })

        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    })

    // 🔹 REORDENAR imágenes (nuevo método)
    static reorderImages = asyncHandler(async (req, res) => {
        const client = await getClient()
        const { producto_id } = req.params
        const { orden_ids } = req.body

        if (!Array.isArray(orden_ids) || orden_ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'orden_ids debe ser un array de IDs de imágenes'
            })
        }

        try {
            await client.query('BEGIN')

            // Verificar que todas las imágenes pertenecen al producto
            const imagesCheck = await client.query(
                `SELECT COUNT(*) as count 
                 FROM imagenes_producto 
                 WHERE producto_id = $1 
                   AND imagen_id = ANY($2) 
                   AND activo = true`,
                [producto_id, orden_ids]
            )

            if (parseInt(imagesCheck.rows[0].count) !== orden_ids.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Algunas imágenes no pertenecen al producto'
                })
            }

            // Actualizar orden
            for (let i = 0; i < orden_ids.length; i++) {
                await client.query(
                    'UPDATE imagenes_producto SET orden = $1 WHERE imagen_id = $2',
                    [i + 1, orden_ids[i]]
                )
            }

            await client.query('COMMIT')

            res.json({
                success: true,
                message: 'Orden de imágenes actualizado correctamente'
            })

        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    })

    // 🔹 ESTABLECER imagen principal (nuevo método)
    static setMainImage = asyncHandler(async (req, res) => {
        const client = await getClient()
        const { producto_id } = req.params
        const { imagen_id } = req.body

        try {
            await client.query('BEGIN')

            // Verificar que la imagen existe y pertenece al producto
            const checkResult = await client.query(
                'SELECT 1 FROM imagenes_producto WHERE imagen_id = $1 AND producto_id = $2 AND activo = true',
                [imagen_id, producto_id]
            )

            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'La imagen no existe o no pertenece al producto'
                })
            }

            // 1. Desmarcar todas como no principales
            await client.query(
                'UPDATE imagenes_producto SET es_principal = false WHERE producto_id = $1 AND activo = true',
                [producto_id]
            )

            // 2. Marcar la especificada como principal
            await client.query(
                'UPDATE imagenes_producto SET es_principal = true WHERE imagen_id = $1',
                [imagen_id]
            )

            await client.query('COMMIT')

            res.json({
                success: true,
                message: 'Imagen principal actualizada correctamente'
            })

        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    })
}

// Función auxiliar para mensajes
function getSuccessMessage(operacion) {
    const messages = {
        'agregar': 'Imágenes agregadas correctamente',
        'reemplazar': 'Imágenes reemplazadas correctamente',
        'cambiar_principal': 'Imagen principal actualizada correctamente'
    }
    return messages[operacion] || 'Operación completada'
}