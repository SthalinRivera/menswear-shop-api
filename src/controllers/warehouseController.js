import { query, getClient } from '../config/database.js';
import { validationSchemas, validate } from '../middlewares/validationMiddleware.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { PAGINATION } from '../config/constants.js';


class WarehouseController {
    // Obtener todos los productos con filtros

    static getWarehouses = asyncHandler(async (req, res) => {
        const {
            page = 1,
            limit = PAGINATION.DEFAULT_LIMIT,
            activo = 'true'
        } = req.query

        const offset = (page - 1) * limit
        const params = []
        let paramCount = 0

        let sql = `
      SELECT 
        a.almacen_id,
        a.nombre,
        a.tipo,
        a.ciudad,
        a.telefono,
        a.capacidad_total,
        a.capacidad_utilizada,
        a.activo,
        a.fecha_creacion,

        s.sucursal_id,
        s.nombre AS sucursal_nombre,

        e.empresa_id,
        e.nombre AS empresa_nombre,

        COALESCE(SUM(i.cantidad), 0) AS stock_total

      FROM almacenes a
      LEFT JOIN sucursales s ON a.sucursal_id = s.sucursal_id
      LEFT JOIN empresas e ON s.empresa_id = e.empresa_id
      LEFT JOIN inventario i ON a.almacen_id = i.almacen_id
      WHERE 1=1
    `

        if (activo !== undefined) {
            paramCount++
            sql += ` AND a.activo = $${paramCount}`
            params.push(activo === 'true')
        }

        sql += `
      GROUP BY a.almacen_id, s.sucursal_id, e.empresa_id
      ORDER BY a.fecha_creacion DESC
    `

        paramCount++
        sql += ` LIMIT $${paramCount}`
        params.push(limit)

        paramCount++
        sql += ` OFFSET $${paramCount}`
        params.push(offset)

        const data = await query(sql, params)

        // COUNT
        const countResult = await query(
            `SELECT COUNT(*) FROM almacenes WHERE activo = $1`,
            [activo === 'true']
        )

        res.json({
            success: true,
            data: data.rows,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total: Number(countResult.rows[0].count)
            }
        })
    })
}


export default WarehouseController;