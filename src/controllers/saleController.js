import { query, getClient } from '../config/database.js';
import { validate, validationSchemas } from '../middlewares/validationMiddleware.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { ESTADOS_VENTA } from '../config/constants.js';

class SaleController {
  // Crear nueva venta
  static createSale = [
    validate(validationSchemas.createSale),

    asyncHandler(async (req, res) => {
      console.log('🎯 Iniciando creación de venta...');

      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Convertir valores a números
        const {
          cliente_id,
          tipo_venta = 'Presencial',
          metodo_pago = 'Efectivo',
          costo_envio = 0,
          detalles,
          notas
        } = req.body;

        // Convertir detalles a números
        const detallesConvertidos = detalles.map(detalle => ({
          producto_id: Number(detalle.producto_id),
          cantidad: Number(detalle.cantidad),
          precio_unitario: Number(detalle.precio_unitario),
          descuento_unitario: Number(detalle.descuento_unitario) || 0
        }));

        const empleado_id = req.user.empleado_id;
        if (!empleado_id) {
          throw new Error('El usuario no está asociado a un empleado');
        }

        // Obtener sucursal del empleado
        const empleadoResult = await client.query(
          'SELECT sucursal_id FROM empleados WHERE empleado_id = $1',
          [empleado_id]
        );

        if (empleadoResult.rows.length === 0) {
          throw new Error('Empleado no encontrado');
        }

        let sucursal_id = empleadoResult.rows[0].sucursal_id;

        // Verificar o crear sucursal
        if (!sucursal_id) {
          // Buscar cualquier sucursal activa
          const anySucursal = await client.query(
            'SELECT sucursal_id FROM sucursales WHERE activa = true LIMIT 1'
          );

          if (anySucursal.rows.length > 0) {
            sucursal_id = anySucursal.rows[0].sucursal_id;
          } else {
            // Crear nueva sucursal
            const newSucursal = await client.query(
              `INSERT INTO sucursales (
              empresa_id, nombre, codigo_sucursal, tipo, activa
            ) VALUES (1, 'Tienda Principal', 'T001', 'Tienda', true)
            RETURNING sucursal_id`
            );
            sucursal_id = newSucursal.rows[0].sucursal_id;
          }

          // Actualizar empleado
          await client.query(
            'UPDATE empleados SET sucursal_id = $1 WHERE empleado_id = $2',
            [sucursal_id, empleado_id]
          );
        }

        // Obtener o crear almacén para esta sucursal
        let almacenResult = await client.query(
          `SELECT almacen_id 
         FROM almacenes 
         WHERE sucursal_id = $1 AND tipo = 'Principal' 
         LIMIT 1`,
          [sucursal_id]
        );

        let almacen_id;
        if (almacenResult.rows.length > 0) {
          almacen_id = almacenResult.rows[0].almacen_id;
        } else {
          // Crear almacén por defecto
          almacenResult = await client.query(
            `INSERT INTO almacenes (
            sucursal_id, nombre, tipo, activo
          ) VALUES ($1, $2, $3, $4)
          RETURNING almacen_id`,
            [sucursal_id, 'Almacén Principal', 'Principal', true]
          );
          almacen_id = almacenResult.rows[0].almacen_id;

          // Asignar como almacén principal de la sucursal
          await client.query(
            'UPDATE sucursales SET almacen_principal_id = $1 WHERE sucursal_id = $2',
            [almacen_id, sucursal_id]
          );
        }

        console.log('📊 Usando:', {
          empleado_id,
          sucursal_id,
          almacen_id,
          cliente_id: cliente_id || 'Sin cliente'
        });

        // Crear venta
        const codigoVenta = `VTA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const saleResult = await client.query(
          `INSERT INTO ventas (
          sucursal_id, codigo_venta, cliente_id, empleado_id,
          tipo_venta, estado_venta, metodo_pago,
          costo_envio, notas, creado_por
        ) VALUES ($1, $2, $3, $4, $5, 'Pendiente', $6, $7, $8, $9)
        RETURNING *`,
          [
            sucursal_id, codigoVenta, cliente_id || null, empleado_id,
            tipo_venta, metodo_pago, Number(costo_envio) || 0,
            notas || null, empleado_id
          ]
        );

        const venta = saleResult.rows[0];
        let subtotal = 0, descuentoTotal = 0, impuestoTotal = 0;

        // Procesar detalles
        for (const detalle of detallesConvertidos) {
          const { producto_id, cantidad, precio_unitario, descuento_unitario } = detalle;

          // Obtener variante disponible
          const varianteResult = await client.query(
            `SELECT vp.variante_id, vp.stock_disponible, p.impuesto_porcentaje
           FROM variantes_producto vp
           JOIN productos p ON vp.producto_id = p.producto_id
           WHERE vp.producto_id = $1 AND vp.stock_disponible >= $2 AND vp.activo = true
           LIMIT 1`,
            [producto_id, cantidad]
          );

          if (varianteResult.rows.length === 0) {
            throw new Error(`Stock insuficiente para producto ${producto_id}`);
          }

          const { variante_id, impuesto_porcentaje } = varianteResult.rows[0];
          const precioNeto = precio_unitario - descuento_unitario;
          const impuestoUnitario = precioNeto * (impuesto_porcentaje / 100);

          // Crear detalle
          await client.query(
            `INSERT INTO detalles_venta (
            venta_id, variante_id, cantidad,
            precio_unitario, descuento_unitario, impuesto_unitario
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [venta.venta_id, variante_id, cantidad, precio_unitario, descuento_unitario, impuestoUnitario]
          );

          // Reservar stock
          await client.query(
            'UPDATE variantes_producto SET stock_reservado = stock_reservado + $1 WHERE variante_id = $2',
            [cantidad, variante_id]
          );

          subtotal += precioNeto * cantidad;
          descuentoTotal += descuento_unitario * cantidad;
          impuestoTotal += impuestoUnitario * cantidad;
        }

        // Calcular y actualizar total
        const total = subtotal + impuestoTotal + Number(costo_envio || 0);
        await client.query(
          'UPDATE ventas SET subtotal = $1, descuento_total = $2, impuesto_total = $3, total = $4 WHERE venta_id = $5',
          [subtotal, descuentoTotal, impuestoTotal, total, venta.venta_id]
        );

        // Marcar como pagada y procesar inventario
        if (['Efectivo', 'Tarjeta Crédito', 'Tarjeta Débito'].includes(metodo_pago)) {
          await client.query(
            'UPDATE ventas SET estado_venta = \'Pagada\' WHERE venta_id = $1',
            [venta.venta_id]
          );

          for (const detalle of detallesConvertidos) {
            const { producto_id, cantidad } = detalle;

            const varianteResult = await client.query(
              'SELECT variante_id FROM variantes_producto WHERE producto_id = $1 LIMIT 1',
              [producto_id]
            );

            if (varianteResult.rows.length > 0) {
              const { variante_id } = varianteResult.rows[0];

              // Actualizar stock
              await client.query(
                `UPDATE variantes_producto 
               SET stock_actual = stock_actual - $1,
                   stock_reservado = stock_reservado - $1,
                   fecha_ultima_salida = CURRENT_DATE
               WHERE variante_id = $2`,
                [cantidad, variante_id]
              );

              // Registrar movimiento con almacen_id correcto
              await client.query(
                `INSERT INTO movimientos_inventario (
                variante_id, almacen_id, tipo_movimiento, cantidad,
                referencia_id, tipo_referencia, empleado_id, motivo
              ) VALUES ($1, $2, 'Salida', $3, $4, 'Venta', $5, 'Venta procesada')`,
                [variante_id, almacen_id, cantidad, venta.venta_id, empleado_id]
              );
            }
          }
        }

        await client.query('COMMIT');

        // Responder con datos completos
        const completeSale = await client.query(
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

        res.status(201).json({
          success: true,
          message: 'Venta creada exitosamente',
          data: completeSale.rows[0]
        });

      } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error:', error.message);
        res.status(400).json({
          success: false,
          message: error.message
        });
      } finally {
        client.release();
      }
    })
  ];

  // Obtener todas las ventas
// En SaleController.js, modifica la función getSales:

static getSales = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    fecha_inicio,
    fecha_fin,
    estado_venta,
    tipo_venta,
    cliente_id,
    empleado_id,
    sucursal_id,
    codigo_venta,
    startDate,
    endDate,
    include_details = false,
    include_cliente = true,
    include_empleado = true,
    sort_by = 'fecha_venta',
    sort_order = 'DESC'
  } = req.query;

  const offset = (page - 1) * limit;

  // Construir consulta base con JOINs
  let baseQuery = `
    FROM ventas v
    LEFT JOIN clientes c ON v.cliente_id = c.cliente_id
    JOIN empleados e ON v.empleado_id = e.empleado_id
    LEFT JOIN sucursales s ON v.sucursal_id = s.sucursal_id
    WHERE 1=1
  `;

  let params = [];
  let paramCount = 0;

  // Aplicar filtros
  if (codigo_venta) {
    paramCount++;
    baseQuery += ` AND v.codigo_venta ILIKE $${paramCount}`;
    params.push(`%${codigo_venta}%`);
  }

  if (estado_venta) {
    paramCount++;
    baseQuery += ` AND v.estado_venta = $${paramCount}`;
    params.push(estado_venta);
  }

  if (tipo_venta) {
    paramCount++;
    baseQuery += ` AND v.tipo_venta = $${paramCount}`;
    params.push(tipo_venta);
  }

  if (cliente_id) {
    paramCount++;
    baseQuery += ` AND v.cliente_id = $${paramCount}`;
    params.push(cliente_id);
  }

  if (empleado_id) {
    paramCount++;
    baseQuery += ` AND v.empleado_id = $${paramCount}`;
    params.push(empleado_id);
  }

  if (sucursal_id) {
    paramCount++;
    baseQuery += ` AND v.sucursal_id = $${paramCount}`;
    params.push(sucursal_id);
  }

  // Filtros de fecha
  const startDateFilter = fecha_inicio || startDate;
  const endDateFilter = fecha_fin || endDate;

  if (startDateFilter) {
    paramCount++;
    baseQuery += ` AND DATE(v.fecha_venta) >= $${paramCount}`;
    params.push(startDateFilter);
  }

  if (endDateFilter) {
    paramCount++;
    baseQuery += ` AND DATE(v.fecha_venta) <= $${paramCount}`;
    params.push(endDateFilter);
  }

  // Validar ordenamiento
  const validSortFields = ['fecha_venta', 'total', 'codigo_venta', 'cliente_nombre', 'empleado_nombre'];
  const sortField = validSortFields.includes(sort_by) ? sort_by : 'fecha_venta';
  const sortOrder = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  // Consulta para obtener ventas con datos relacionados
  const queryStr = `
    SELECT 
      v.*,
      c.nombre as cliente_nombre,
      c.apellido as cliente_apellido,
      c.email as cliente_email,
      e.nombre as empleado_nombre,
      e.apellido as empleado_apellido,
      e.puesto as empleado_puesto,
      s.nombre as sucursal_nombre
    ${baseQuery}
    ORDER BY v.${sortField} ${sortOrder}
    LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
  `;

  params.push(parseInt(limit), offset);

  // Contar total
  const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
  
  try {
    const [salesResult, countResult] = await Promise.all([
      query(queryStr, params),
      query(countQuery, params.slice(0, paramCount))
    ]);

    const total = parseInt(countResult.rows[0].total);
    const sales = salesResult.rows;

    // Si se solicitan detalles, obtenerlos
    if (include_details && sales.length > 0) {
      const ventaIds = sales.map(v => v.venta_id);
      
      const detallesQuery = `
        SELECT 
          dv.venta_id,
          dv.cantidad,
          dv.precio_unitario,
          dv.descuento_unitario,
          dv.impuesto_unitario,
          p.nombre as producto_nombre,
          p.sku,
          vp.talla,
          vp.color_nombre
        FROM detalles_venta dv
        JOIN variantes_producto vp ON dv.variante_id = vp.variante_id
        JOIN productos p ON vp.producto_id = p.producto_id
        WHERE dv.venta_id = ANY($1)
        ORDER BY dv.detalle_id
      `;

      const detallesResult = await query(detallesQuery, [ventaIds]);
      
      // Agrupar detalles por venta
      const detallesPorVenta = {};
      detallesResult.rows.forEach(detalle => {
        if (!detallesPorVenta[detalle.venta_id]) {
          detallesPorVenta[detalle.venta_id] = [];
        }
        detallesPorVenta[detalle.venta_id].push(detalle);
      });

      // Agregar detalles a cada venta
      sales.forEach(venta => {
        venta.detalles = detallesPorVenta[venta.venta_id] || [];
        venta.items_count = venta.detalles.reduce((sum, item) => sum + item.cantidad, 0);
      });
    } else {
      // Si no se piden detalles, al menos contar items
      const itemsCountQuery = `
        SELECT venta_id, SUM(cantidad) as items_count
        FROM detalles_venta
        WHERE venta_id = ANY($1)
        GROUP BY venta_id
      `;
      
      if (sales.length > 0) {
        const ventaIds = sales.map(v => v.venta_id);
        const itemsResult = await query(itemsCountQuery, [ventaIds]);
        
        const itemsPorVenta = {};
        itemsResult.rows.forEach(row => {
          itemsPorVenta[row.venta_id] = parseInt(row.items_count);
        });

        sales.forEach(venta => {
          venta.items_count = itemsPorVenta[venta.venta_id] || 0;
        });
      }
    }

    res.json({
      success: true,
      data: sales,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error en getSales:', error);
    throw error;
  }
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
  static updateSaleStatus = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'updateSaleStatus pendiente de implementar' });
  });

  static cancelSale = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'cancelSale pendiente de implementar' });
  });

  static getSalesStats = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'getSalesStats pendiente de implementar' });
  });

  static generateInvoice = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'generateInvoice pendiente de implementar' });
  });

  static getSaleWithDetails = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'getSaleWithDetails pendiente de implementar' });
  });

  static processRefund = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'processRefund pendiente de implementar' });
  });

  static advancedSearch = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'advancedSearch pendiente de implementar' });
  });

  static exportSalesToCSV = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'exportSalesToCSV pendiente de implementar' });
  });

  static getDashboardStats = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'getDashboardStats pendiente de implementar' });
  });

  static getClientSales = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'getClientSales pendiente de implementar' });
  });

  static getTopProducts = asyncHandler(async (req, res) => {
    res.json({ success: true, message: 'getTopProducts pendiente de implementar' });
  });
}

export default SaleController;