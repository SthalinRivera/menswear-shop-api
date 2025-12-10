const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20, // máximo de conexiones
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Manejo de eventos del pool
pool.on('connect', () => {
    console.log('✅ Conexión establecida con PostgreSQL');
});

pool.on('error', (err) => {
    console.error('❌ Error en el pool de PostgreSQL:', err);
    process.exit(-1);
});

// Función para ejecutar queries
const query = (text, params) => pool.query(text, params);

// Función para obtener un cliente del pool
const getClient = () => pool.connect();

// Exportar funcionalidades
module.exports = {
    query,
    getClient,
    pool,
};

// Función para probar conexión
const testConnection = async () => {
    try {
        const res = await query('SELECT NOW()');
        console.log('✅ PostgreSQL conectado:', res.rows[0].now);
        return true;
    } catch (error) {
        console.error('❌ Error conectando a PostgreSQL:', error.message);
        return false;
    }
};

module.exports.testConnection = testConnection;


