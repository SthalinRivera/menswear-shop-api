const { query } = require('../config/database');

class UserController {
    // Obtener todos los usuarios (SOLO PARA PRUEBAS)
    static getUsers = async (req, res) => {
        try {
            console.log('📡 Ejecutando consulta para obtener usuarios...');

            // Consulta simple para probar la conexión
            const result = await query('SELECT * FROM usuarios LIMIT 10');

            console.log(`✅ Usuarios encontrados: ${result.rows.length}`);

            res.status(200).json({
                success: true,
                count: result.rows.length,
                data: result.rows
            });

        } catch (error) {
            console.error('❌ Error en getUsers:', error.message);
            res.status(500).json({
                success: false,
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    };

    // Obtener usuario por ID
    static getUserById = async (req, res) => {
        try {
            const { id } = req.params;

            console.log(`📡 Buscando usuario ID: ${id}`);

            const result = await query(
                'SELECT * FROM usuarios WHERE usuario_id = $1',
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuario no encontrado'
                });
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            console.error('❌ Error en getUserById:', error.message);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    };

    // Crear usuario simple (sin validaciones complejas)
    static createUser = async (req, res) => {
        try {
            const { email, nombre, apellido } = req.body;

            console.log('📡 Creando usuario:', { email, nombre, apellido });

            if (!email || !nombre) {
                return res.status(400).json({
                    success: false,
                    message: 'Email y nombre son requeridos'
                });
            }

            const result = await query(
                `INSERT INTO usuarios (email, tipo_usuario, activo) 
         VALUES ($1, 'Cliente', true) 
         RETURNING usuario_id, email, tipo_usuario, fecha_creacion`,
                [email]
            );

            console.log('✅ Usuario creado ID:', result.rows[0].usuario_id);

            res.status(201).json({
                success: true,
                message: 'Usuario creado exitosamente',
                data: result.rows[0]
            });

        } catch (error) {
            console.error('❌ Error en createUser:', error.message);

            // Error de duplicado
            if (error.code === '23505') {
                return res.status(409).json({
                    success: false,
                    message: 'El email ya está registrado'
                });
            }

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    };

    // Endpoint de prueba de conexión a DB
    static testDB = async (req, res) => {
        try {
            console.log('🧪 Probando conexión a PostgreSQL...');

            // Probar conexión básica
            const testQuery = await query('SELECT NOW() as server_time, version() as db_version');

            // Verificar algunas tablas existentes
            const tablesQuery = await query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);

            res.json({
                success: true,
                message: '✅ Conexión a PostgreSQL exitosa',
                data: {
                    server_time: testQuery.rows[0].server_time,
                    db_version: testQuery.rows[0].db_version,
                    tables: tablesQuery.rows.map(t => t.table_name),
                    tables_count: tablesQuery.rows.length
                }
            });

        } catch (error) {
            console.error('❌ Error de conexión a DB:', error.message);
            res.status(500).json({
                success: false,
                message: '❌ Error de conexión a PostgreSQL',
                error: error.message,
                details: 'Verifica que la base de datos esté corriendo y las credenciales sean correctas'
            });
        }
    };

    // Contar usuarios
    static countUsers = async (req, res) => {
        try {
            const result = await query(`
        SELECT 
          COUNT(*) as total_usuarios,
          COUNT(CASE WHEN tipo_usuario = 'Empleado' THEN 1 END) as empleados,
          COUNT(CASE WHEN tipo_usuario = 'Cliente' THEN 1 END) as clientes,
          COUNT(CASE WHEN activo = true THEN 1 END) as activos
        FROM usuarios
      `);

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            console.error('❌ Error en countUsers:', error.message);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    };
}

module.exports = UserController;