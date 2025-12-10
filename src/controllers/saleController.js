const { query, getClient } = require('../config/database');
const { validationSchemas, validate } = require('../middlewares/validationMiddleware');
const { asyncHandler } = require('../middlewares/errorMiddleware');
const { ESTADOS_VENTA } = require('../config/constants');

class SaleController {
  // Crear nueva venta
  static createSale = [
    validate(validationSchemas.createSale),
    asyncHandler(async (req, res) => {
      const client = await getClient();
      
      try {
        await client.query('BEGIN');

        const {
          cliente_id,
          tipo_venta = 'Presencial',
          metodo_pago = 'Efectivo',
          direccion_envio,
          costo_envio = 0,
          detalles,
          notas
        } = req.body;

        const empleado_id = req.user.empleado_id;
        const sucursal_id = req.user.sucursal_id || 1; // Default

        // Generar código único de venta
        const codigoVenta = `VTA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Crear venta
        const saleResult = await client.query(
          `INSERT INTO ventas (
            sucursal_id, codigo_venta, cliente_id, empleado_id,
            tipo_venta, estado_venta, metodo_pago,
            direccion_envio, costo_envio, notas, creado_por
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *`,
          [
            sucursal_id, codigoVenta, cliente_id || null, empleado_id,
            tipo_venta, 'Pendiente', metodo_pago,
            direccion_envio || null, costo_envio, notas || null, empleado_id
          ]
        );

        const venta = saleResult.rows[0];
        let subtotal = 0;
        let descuentoTotal = 0;
        let impuestoTotal = 0;

        // Procesar cada detalle de venta
        for (const detalle of detalles) {
          const { variante_id, cantidad, precio_unitario, descuento_unitario = 0 } = detalle;

          // Verificar stock disponible
          const stockResult = await client.query(
            `SELECT stock_disponible, producto_id 
             FROM variantes_producto 
             WHERE variante_id = $1`,
            [variante_id]
          );

          if (stockResult.rows.length === 0) {
            throw new Error(`Variante ${variante_id} no encontrada`);
          }

          const { stock_disponible, producto_id } = stockResult.rows[0];

          if (stock_disponible < cantidad) {
            throw new Error(`Stock insuficiente para variante ${variante_id}. Disponible: ${stock_disponible}, Solicitado: ${cantidad}`);
          }

          // Obtener información del producto para impuestos
          const productResult = await client.query(
            'SELECT impuesto_porcentaje FROM productos WHERE producto_id = $1',
            [producto_id]
          );

          const impuestoPorcentaje = productResult.rows[0]?.impuesto_porcentaje || 16.00;
          const impuestoUnitario = (precio_unitario - descuento_unitario) * (impuestoPorcentaje / 100);

          // Crear detalle de venta
          await client.query(
            `INSERT INTO detalles_venta (
              venta_id, variante_id, cantidad,
              precio_unitario, descuento_unitario, impuesto_unitario
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              venta.venta_id, variante_id, cantidad,
              precio_unitario, descuento_unitario, impuestoUnitario
            ]
          );

          // Actualizar stock reservado
          await client.query(
            `UPDATE variantes_producto 
             SET stock_reservado = stock_reservado + $1
             WHERE variante_id = $2`,
            [cantidad, variante_id]
          );

          // Calcular totales
          const precioNeto = precio_unitario - descuento_unitario;
          subtotal += precioNeto * cantidad;
          descuentoTotal += descuento_unitario * cantidad;
          impuestoTotal += impuestoUnitario * cantidad;
        }

        // Calcular total final
        const total = subtotal + impuestoTotal + costo_envio;

        // Actualizar totales de la venta
        await client.query(
          `UPDATE ventas 
           SET subtotal = $1, descuento_total = $2, impuesto_total = $3, total = $4
           WHERE venta_id = $5`,
          [subtotal, descuentoTotal, impuestoTotal, total, venta.venta_id]
        );

        // Si el método de pago es efectivo o tarjeta, marcar como pagada
        if (['Efectivo', 'Tarjeta Crédito', 'Tarjeta Débito'].includes(metodo_pago)) {
          await client.query(
            `UPDATE ventas SET estado_venta = 'Pagada' WHERE venta_id = $1`,
            [venta.venta_id]
          );

          // Liberar stock reservado y registrar salida
          for (const detalle of detalles) {
            const { variante_id, cantidad } = detalle;

            await client.query(
              `UPDATE variantes_producto 
               SET stock_actual = stock_actual - $1,
                   stock_reservado = stock_reservado - $1,
                   fecha_ultima_salida = CURRENT_DATE
               WHERE variante_id = $2`,
              [cantidad, variante_id]
            );

            // Registrar movimiento de inventario
            await client.query(
              `INSERT INTO movimientos_inventario (
                variante_id, almacen_id, tipo_movimiento, cantidad,
                referencia_id, tipo_referencia, empleado_id, motivo
              ) VALUES ($1, $2, 'Salida', $3, $4, 'Venta', $5, 'Venta procesada')`,
              [
                variante_id,
                sucursal_id, // Usar almacén de la sucursal
                cantidad,
                venta.venta_id,
                empleado_id
              ]
            );
          }

          // Actualizar cliente si aplica
          if (cliente_id) {
            await client.query(
              `UPDATE clientes 
               SET total_compras = total_compras + $1,
                   ultima_compra = CURRENT_DATE
               WHERE cliente_id = $2`,
              [total, cliente_id]
            );
          }
        }

        await client.query('COMMIT');

        // Obtener venta completa con detalles
        const completeSale = await query(
          `SELECT v.*, 
                  c.nombre as cliente_nombre, c.apellido as cliente_apellido,
                  e.nombre as empleado_nombre, e.apellido as empleado_apellido,
                  s.nombre as sucursal_nombre
           FROM ventas v
           LEFT JOIN clientes c ON v.cliente_id = c.cliente_id
           JOIN empleados e ON v.empleado_id = e.empleado_id
           LEFT JOIN sucursales s ON v.sucursal_id = s.sucursal_id
           WHERE v.venta_id = $1`,
          [venta.venta_id]
        );

        const saleDetails = await query(
          `SELECT dv.*, 
                  vp.talla, vp.color_nombre,
                  p.nombre as producto_nombre, p.sku
           FROM detalles_venta dv
           JOIN variantes_producto vp ON dv.variante_id = vp.variante_id
           JOIN productos p ON vp.producto_id = p.producto_id
           WHERE dv.venta_id = $1`,
          [venta.venta_id]
        );

        res.status(201).json({
          success: true,
          message: 'Venta creada exitosamente',
          data: {
            ...completeSale.rows[0],
            detalles: saleDetails.rows
          }
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })
  ];

  // Obtener todas las ventas
  static getSales = asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      estado,
      tipo_venta,
      cliente_id,
      empleado_id,
      sucursal_id
    } = req.query;

    const offset = (page - 1) * limit;

    let queryStr = `
      SELECT v.*, 
             c.nombre as cliente_nombre, c.apellido as cliente_apellido,
             e.nombre as empleado_nombre, e.apellido as empleado_apellido,
             s.nombre as sucursal_nombre,
             COUNT(dv.detalle_id) as items_count
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.cliente_id
      JOIN empleados e ON v.empleado_id = e.empleado_id
      LEFT JOIN sucursales s ON v.sucursal_id = s.sucursal_id
      LEFT JOIN detalles_venta dv ON v.venta_id = dv.venta_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    // Aplicar filtros
    if (startDate) {
      paramCount++;
      queryStr += ` AND DATE(v.fecha_venta) >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      queryStr += ` AND DATE(v.fecha_venta) <= $${paramCount}`;
      params.push(endDate);
    }

    if (estado) {
      paramCount++;
      queryStr += ` AND v.estado_venta = $${paramCount}`;
      params.push(estado);
    }

    if (tipo_venta) {
      paramCount++;
      queryStr += ` AND v.tipo_venta = $${paramCount}`;
      params.push(tipo_venta);
    }

    if (cliente_id) {
      paramCount++;
      queryStr += ` AND v.cliente_id = $${paramCount}`;
      params.push(cliente_id);
    }

    if (empleado_id) {
      paramCount++;
      queryStr += ` AND v.empleado_id = $${paramCount}`;
      params.push(empleado_id);
    }

    if (sucursal_id) {
      paramCount++;
      queryStr += ` AND v.sucursal_id = $${paramCount}`;
      params.push(sucursal_id);
    }

    // Agrupar y ordenar
    queryStr += ` GROUP BY v.venta_id, c.nombre, c.apellido, e.nombre, e.apellido, s.nombre
                  ORDER BY v.fecha_venta DESC
                  LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;

    params.push(limit, offset);

    const result = await query(queryStr, params);

    // Contar total
    const countQuery = queryStr
      .replace(/SELECT v\.\*,.*?FROM/s, 'SELECT COUNT(DISTINCT v.venta_id) FROM')
      .replace(/GROUP BY.*/, '')
      .replace(/LIMIT \$\d+ OFFSET \$\d+/, '');

    const countResult = await query(countQuery, params.slice(0, -2));
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  // Obtener venta por ID
  static getSaleById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Verificar permisos (solo el empleado que creó la venta o admin)
    if (req.user.tipo_usuario === 'Empleado' && !req.user.permisos.some(p => p.codigo === 'VENTAS_VER')) {
      const saleCheck = await query(
        'SELECT empleado_id FROM ventas WHERE venta_id = $1',
        [id]
      );

      if (saleCheck.rows.length === 0 || saleCheck.rows[0].empleado_id !== req.user.empleado_id) {
        return res.status(403).json({
          success: false,
          message: 'No tienes permiso para ver esta venta'
        });
      }
    }

    const saleResult = await query(
      `SELECT v.*, 
              c.nombre as cliente_nombre, c.apellido as cliente_apellido, c.email as cliente_email,
              e.nombre as empleado_nombre, e.apellido as empleado_apellido,
              s.nombre as sucursal_nombre, s.direccion as sucursal_direccion
       FROM ventas v
       LEFT JOIN clientes c ON v.cliente_id = c.cliente_id
       JOIN empleados e ON v.empleado_id = e.empleado_id
       LEFT JOIN sucursales s ON v.sucursal_id = s.sucursal_id
       WHERE v.venta_id = $1`,
      [id]
    );

    if (saleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Venta no encontrada'
      });
    }

    const saleDetails = await query(
      `SELECT dv.*, 
              vp.talla, vp.color_nombre,
              p.nombre as producto_nombre, p.sku,
              p.precio_compra
       FROM detalles_venta dv
       JOIN variantes_producto vp ON dv.variante_id = vp.variante_id
       JOIN productos p ON vp.producto_id = p.producto_id
       WHERE dv.venta_id = $1`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...saleResult.rows[0],
        detalles: saleDetails.rows
      }
    });
  });

  // Actualizar estado de venta
  static updateSaleStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { estado_venta, motivo } = req.body;

    if (!Object.values(ESTADOS_VENTA).includes(estado_venta)) {
      return res.status(400).json({
        success: false,
        message: 'Estado de venta inválido'
      });
    }

    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Obtener venta actual
      const currentSale = await client.query(
        'SELECT estado_venta, empleado_id FROM ventas WHERE venta_id = $1',
        [id]
      );

      if (currentSale.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Venta no encontrada'
        });
      }

      const oldStatus = currentSale.rows[0].estado_venta;

      // Validar transición de estado
      if (oldStatus === 'Cancelada' || oldStatus === 'Reembolsada') {
        return res.status(400).json({
          success: false,
          message: `No se puede modificar una venta en estado: ${oldStatus}`
        });
      }

      // Actualizar estado
      await client.query(
        `UPDATE ventas 
         SET estado_venta = $1, fecha_actualizacion = NOW()
         WHERE venta_id = $2`,
        [estado_venta, id]
      );

      // Si se cancela la venta, liberar stock reservado
      if (estado_venta === 'Cancelada' && oldStatus === 'Pendiente') {
        const details = await client.query(
          'SELECT variante_id, cantidad FROM detalles_venta WHERE venta_id = $1',
          [id]
        );

        for (const detail of details.rows) {
          await client.query(
            `UPDATE variantes_producto 
             SET stock_reservado = stock_reservado - $1
             WHERE variante_id = $2`,
            [detail.cantidad, detail.variante_id]
          );
        }
      }

      // Si se marca como pagada, procesar stock
      if (estado_venta === 'Pagada' && oldStatus === 'Pendiente') {
        const details = await client.query(
          `SELECT dv.variante_id, dv.cantidad, v.sucursal_id
           FROM detalles_venta dv
           JOIN ventas v ON dv.venta_id = v.venta_id
           WHERE dv.venta_id = $1`,
          [id]
        );

        for (const detail of details.rows) {
          await client.query(
            `UPDATE variantes_producto 
             SET stock_actual = stock_actual - $1,
                 stock_reservado = stock_reservado - $1,
                 fecha_ultima_salida = CURRENT_DATE
             WHERE variante_id = $2`,
            [detail.cantidad, detail.variante_id]
          );

          // Registrar movimiento
          await client.query(
            `INSERT INTO movimientos_inventario (
              variante_id, almacen_id, tipo_movimiento, cantidad,
              referencia_id, tipo_referencia, empleado_id, motivo
            ) VALUES ($1, $2, 'Salida', $3, $4, 'Venta', $5, $6)`,
            [
              detail.variante_id,
              detail.sucursal_id,
              detail.cantidad,
              id,
              'Venta',
              req.user.empleado_id,
              motivo || 'Venta procesada'
            ]
          );
        }

        // Actualizar total de compras del cliente
        const saleTotal = await client.query(
          'SELECT cliente_id, total FROM ventas WHERE venta_id = $1',
          [id]
        );

        if (saleTotal.rows[0].cliente_id) {
          await client.query(
            `UPDATE clientes 
             SET total_compras = total_compras + $1,
                 ultima_compra = CURRENT_DATE
             WHERE cliente_id = $2`,
            [saleTotal.rows[0].total, saleTotal.rows[0].cliente_id]
          );
        }
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `Estado de venta actualizado a: ${estado_venta}`
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  // Anular venta
  static cancelSale = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { motivo } = req.body;

    const client = await getClient();
    
    try {
      await client.query('BEGIN');

      // Obtener venta
      const sale = await client.query(
        `SELECT v.*, c.cliente_id, c.total_compras
         FROM ventas v
         LEFT JOIN clientes c ON v.cliente_id = c.cliente_id
         WHERE v.venta_id = $1`,
        [id]
      );

      if (sale.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Venta no encontrada'
        });
      }

      const currentSale = sale.rows[0];

      if (currentSale.estado_venta === 'Cancelada') {
        return res.status(400).json({
          success: false,
          message: 'La venta ya está cancelada'
        });
      }

      if (currentSale.estado_venta === 'Reembolsada') {
        return res.status(400).json({
          success: false,
          message: 'No se puede cancelar una venta reembolsada'
        });
      }

      // Si la venta estaba pagada, revertir stock y actualizar cliente
      if (currentSale.estado_venta === 'Pagada') {
        // Revertir stock
        const details = await client.query(
          'SELECT variante_id, cantidad FROM detalles_venta WHERE venta_id = $1',
          [id]
        );

        for (const detail of details.rows) {
          await client.query(
            `UPDATE variantes_producto 
             SET stock_actual = stock_actual + $1,
                 fecha_ultima_entrada = CURRENT_DATE
             WHERE variante_id = $2`,
            [detail.cantidad, detail.variante_id]
          );

          // Registrar movimiento de entrada (devolución)
          await client.query(
            `INSERT INTO movimientos_inventario (
              variante_id, almacen_id, tipo_movimiento, cantidad,
              referencia_id, tipo_referencia, empleado_id, motivo
            ) VALUES ($1, $2, 'Entrada', $3, $4, 'Devolución', $5, $6)`,
            [
              detail.variante_id,
              currentSale.sucursal_id,
              detail.cantidad,
              id,
              'Devolución',
              req.user.empleado_id,
              motivo || 'Venta cancelada'
            ]
          );
        }

        // Revertir total de compras del cliente
        if (currentSale.cliente_id) {
          await client.query(
            `UPDATE clientes 
             SET total_compras = total_compras - $1
             WHERE cliente_id = $2`,
            [currentSale.total, currentSale.cliente_id]
          );
        }
      } else if (currentSale.estado_venta === 'Pendiente') {
        // Solo liberar stock reservado
        const details = await client.query(
          'SELECT variante_id, cantidad FROM detalles_venta WHERE venta_id = $1',
          [id]
        );

        for (const detail of details.rows) {
          await client.query(
            `UPDATE variantes_producto 
             SET stock_reservado = stock_reservado - $1
             WHERE variante_id = $2`,
            [detail.cantidad, detail.variante_id]
          );
        }
      }

      // Actualizar estado de la venta
      await client.query(
        `UPDATE ventas 
         SET estado_venta = 'Cancelada', fecha_actualizacion = NOW()
         WHERE venta_id = $1`,
        [id]
      );

      // Registrar anulación
      await client.query(
        `INSERT INTO auditorias (
          tabla_afectada, accion, id_registro,
          datos_anteriores, datos_nuevos,
          realizado_por, ip_address
        ) VALUES (
          'ventas', 'UPDATE', $1,
          $2, $3, $4, $5
        )`,
        [
          id,
          JSON.stringify({ estado_venta: currentSale.estado_venta }),
          JSON.stringify({ estado_venta: 'Cancelada', motivo }),
          req.user.empleado_id || req.user.usuario_id,
          req.ip
        ]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Venta cancelada exitosamente'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  // Obtener estadísticas de ventas
  static getSalesStats = asyncHandler(async (req, res) => {
    const { startDate, endDate, sucursal_id } = req.query;

    const params = [];
    let paramCount = 0;
    let whereClause = "WHERE v.estado_venta = 'Pagada'";

    if (startDate) {
      paramCount++;
      whereClause += ` AND DATE(v.fecha_venta) >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      whereClause += ` AND DATE(v.fecha_venta) <= $${paramCount}`;
      params.push(endDate);
    }

    if (sucursal_id) {
      paramCount++;
      whereClause += ` AND v.sucursal_id = $${paramCount}`;
      params.push(sucursal_id);
    }

    // Ventas totales
    const totalSales = await query(
      `SELECT 
         COUNT(*) as cantidad_ventas,
         SUM(v.total) as ingresos_totales,
         AVG(v.total) as promedio_venta,
         MIN(v.total) as venta_minima,
         MAX(v.total) as venta_maxima
       FROM ventas v
       ${whereClause}`,
      params
    );

    // Ventas por día (últimos 7 días)
    const dailySales = await query(
      `SELECT 
         DATE(v.fecha_venta) as fecha,
         COUNT(*) as ventas,
         SUM(v.total) as ingresos,
         AVG(v.total) as promedio
       FROM ventas v
       WHERE v.estado_venta = 'Pagada'
         AND v.fecha_venta >= CURRENT_DATE - INTERVAL '7 days'
       ${sucursal_id ? 'AND v.sucursal_id = $1' : ''}
       GROUP BY DATE(v.fecha_venta)
       ORDER BY fecha DESC`,
      sucursal_id ? [sucursal_id] : []
    );

    // Ventas por método de pago
    const paymentMethods = await query(
      `SELECT 
         v.metodo_pago,
         COUNT(*) as cantidad,
         SUM(v.total) as monto_total
       FROM ventas v
       ${whereClause}
       GROUP BY v.metodo_pago
       ORDER BY monto_total DESC`,
      params
    );

    // Ventas por empleado
    const salesByEmployee = await query(
      `SELECT 
         e.empleado_id,
         e.nombre,
         e.apellido,
         COUNT(v.venta_id) as ventas_realizadas,
         SUM(v.total) as ingresos_generados,
         AVG(v.total) as promedio_venta
       FROM ventas v
       JOIN empleados e ON v.empleado_id = e.empleado_id
       ${whereClause}
       GROUP BY e.empleado_id, e.nombre, e.apellido
       ORDER BY ingresos_generados DESC
       LIMIT 10`,
      params
    );

    // Productos más vendidos
    const topProducts = await query(
      `SELECT 
         p.producto_id,
         p.nombre,
         p.sku,
         SUM(dv.cantidad) as unidades_vendidas,
         SUM(dv.precio_total) as ingresos_generados
       FROM detalles_venta dv
       JOIN variantes_producto vp ON dv.variante_id = vp.variante_id
       JOIN productos p ON vp.producto_id = p.producto_id
       JOIN ventas v ON dv.venta_id = v.venta_id
       ${whereClause}
       GROUP BY p.producto_id, p.nombre, p.sku
       ORDER BY unidades_vendidas DESC
       LIMIT 10`,
      params
    );

    // Clientes más valiosos
    const topCustomers = await query(
      `SELECT 
         c.cliente_id,
         c.nombre,
         c.apellido,
         c.email,
         COUNT(v.venta_id) as compras_realizadas,
         SUM(v.total) as total_gastado,
         MAX(v.fecha_venta) as ultima_compra
       FROM ventas v
       JOIN clientes c ON v.cliente_id = c.cliente_id
       ${whereClause}
       GROUP BY c.cliente_id, c.nombre, c.apellido, c.email
       ORDER BY total_gastado DESC
       LIMIT 10`,
      params
    );

    res.json({
      success: true,
      data: {
        totales: totalSales.rows[0],
        ventas_diarias: dailySales.rows,
        metodos_pago: paymentMethods.rows,
        mejores_empleados: salesByEmployee.rows,
        productos_mas_vendidos: topProducts.rows,
        mejores_clientes: topCustomers.rows
      }
    });
  });

  // Generar ticket/factura
  static generateInvoice = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Obtener información completa de la venta
    const saleResult = await query(
      `SELECT v.*, 
              c.nombre as cliente_nombre, c.apellido as cliente_apellido, 
              c.direccion as cliente_direccion, c.rfc as cliente_rfc,
              e.nombre as empleado_nombre, e.apellido as empleado_apellido,
              s.nombre as sucursal_nombre, s.direccion as sucursal_direccion,
              s.telefono as sucursal_telefono, s.rfc as sucursal_rfc
       FROM ventas v
       LEFT JOIN clientes c ON v.cliente_id = c.cliente_id
       JOIN empleados e ON v.empleado_id = e.empleado_id
       JOIN sucursales s ON v.sucursal_id = s.sucursal_id
       WHERE v.venta_id = $1`,
      [id]
    );

    if (saleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Venta no encontrada'
      });
    }

    const saleDetails = await query(
      `SELECT dv.*, 
              vp.talla, vp.color_nombre,
              p.nombre as producto_nombre, p.sku,
              p.impuesto_porcentaje
       FROM detalles_venta dv
       JOIN variantes_producto vp ON dv.variante_id = vp.variante_id
       JOIN productos p ON vp.producto_id = p.producto_id
       WHERE dv.venta_id = $1`,
      [id]
    );

    const invoice = {
      venta: saleResult.rows[0],
      detalles: saleDetails.rows,
      empresa: {
        nombre: 'Moda Express SA de CV',
        rfc: 'MEX123456ABC',
        direccion: 'Av. Insurgentes Sur 1234, Ciudad de México',
        telefono: '55-1234-5678',
        regimen_fiscal: 'Régimen General de Ley Personas Morales'
      },
      fecha_emision: new Date().toISOString(),
      folio: `FAC-${saleResult.rows[0].codigo_venta}`,
      forma_pago: 'Pago en una sola exhibición',
      metodo_pago: saleResult.rows[0].metodo_pago,
      moneda: 'MXN'
    };

    // En un caso real, aquí generarías el PDF con pdfkit
    // Por ahora solo devolvemos los datos en JSON
    
    res.json({
      success: true,
      data: invoice,
      download_url: `/api/v1/ventas/${id}/factura/pdf` // Ruta para descargar PDF
    });
  });
}

module.exports = SaleController;