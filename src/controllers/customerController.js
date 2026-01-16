import { query } from "../config/database.js";
import { asyncHandler } from "../middlewares/errorMiddleware.js";

class CustomerController {

    static getCustomers = asyncHandler(async (req, res) => {
        const { page = 1, limit = 10, tipo_cliente, segmento, activo } = req.query;
        const offset = (page - 1) * limit;

        let where = [];
        let values = [];

        if (tipo_cliente) {
            values.push(tipo_cliente);
            where.push(`tipo_cliente = $${values.length}`);
        }
        if (segmento) {
            values.push(segmento);
            where.push(`segmento = $${values.length}`);
        }
        if (activo !== undefined) {
            values.push(activo === 'true');
            where.push(`activo = $${values.length}`);
        }

        const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const result = await query(
            `SELECT * FROM clientes
             ${whereSQL}
             ORDER BY fecha_registro DESC
             LIMIT $${values.length + 1}
             OFFSET $${values.length + 2}`,
            [...values, limit, offset]
        );

        res.json(result.rows);
    });

    static getCustomerById = asyncHandler(async (req, res) => {
        const { id } = req.params;

        const result = await query(
            `SELECT * FROM clientes WHERE cliente_id = $1`,
            [id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }

        res.json(result.rows[0]);
    });

    static createCustomer = asyncHandler(async (req, res) => {
        const {
            codigo_cliente,
            nombre,
            apellido,
            email,
            telefono,
            tipo_cliente,
            segmento
        } = req.body;

        const result = await query(
            `INSERT INTO clientes
            (codigo_cliente, nombre, apellido, email, telefono, tipo_cliente, segmento)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *`,
            [codigo_cliente, nombre, apellido, email, telefono, tipo_cliente, segmento]
        );

        res.status(201).json(result.rows[0]);
    });

    static updateCustomer = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const fields = [];
        const values = [];

        Object.entries(req.body).forEach(([key, value]) => {
            values.push(value);
            fields.push(`${key} = $${values.length}`);
        });

        if (!fields.length) {
            return res.status(400).json({ message: 'Nada para actualizar' });
        }

        values.push(id);

        const result = await query(
            `UPDATE clientes SET ${fields.join(', ')}
             WHERE cliente_id = $${values.length}
             RETURNING *`,
            values
        );

        res.json(result.rows[0]);
    });

    static updateCustomerStatus = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { activo } = req.body;

        const result = await query(
            `UPDATE clientes SET activo = $1 WHERE cliente_id = $2 RETURNING *`,
            [activo, id]
        );

        res.json(result.rows[0]);
    });

    static deleteCustomer = asyncHandler(async (req, res) => {
        const { id } = req.params;

        await query(
            `DELETE FROM clientes WHERE cliente_id = $1`,
            [id]
        );

        res.json({ message: 'Cliente eliminado' });
    });
}

export default CustomerController;
