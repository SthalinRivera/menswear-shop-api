const { Pool } = require('pg');
require('dotenv').config();

// Si hay DATABASE_URL → usarla (Neon/Supabase)
// Si no → usar config local
const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false, // necesario en la nube
        },
        max: 5, // importante para Neon (limite 4 conexiones)
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
    }
    : {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    };

const pool = new Pool(poolConfig);

// Manejo de eventos del pool
pool.on('connect', () => {
    console.log('✅ Conexión establecida con PostgreSQL');
});

pool.on('error', (err) => {
    console.error('❌ Error en el pool de PostgreSQL:', err);
    process.exit(-1);
});

// Función para ejecutar queries
const query = (text, params = []) => pool.query(text, params);

// Función para obtener un cliente del pool
const getClient = () => pool.connect();

// Función para probar conexión
const testConnection = async () => {
    try {
        const res = await query('SELECT NOW()');
        console.log('🟢 PostgreSQL conectado:', res.rows[0].now);
        return true;
    } catch (error) {
        console.error('🔴 Error conectando a PostgreSQL:', error.message);
        return false;
    }
};

// Exportar
module.exports = {
    query,
    getClient,
    pool,
    testConnection,
};

