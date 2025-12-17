// src/config/passport.js
import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { query } from './database.js';
import { JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } from './constants.js';


// =============================
// ⚡ ESTRATEGIA JWT
// =============================
const jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: JWT_SECRET,
};

passport.use(new JwtStrategy(jwtOptions, async (jwtPayload, done) => {
    console.log("🔹 JWT recibido con payload:", jwtPayload);

    try {
        const result = await query(
            `SELECT u.*, c.nombre as cliente_nombre, c.apellido as cliente_apellido,
              e.nombre as empleado_nombre, e.apellido as empleado_apellido, e.puesto
            FROM usuarios u
            LEFT JOIN clientes c ON u.cliente_id = c.cliente_id
            LEFT JOIN empleados e ON u.empleado_id = e.empleado_id
            WHERE u.usuario_id = $1 AND u.activo = true`,
            [jwtPayload.usuario_id]
        );

        if (result.rows.length === 0) {
            console.log("❌ Usuario no encontrado o inactivo (JWT)");
            return done(null, false);
        }

        console.log("✅ Usuario encontrado vía JWT:", result.rows[0].email);

        const user = result.rows[0];

        // Obtener roles
        const rolesResult = await query(
            `SELECT r.nombre, r.nivel
             FROM usuarios_roles ur
             JOIN roles r ON ur.rol_id = r.rol_id
             WHERE ur.usuario_id = $1 AND ur.activo = true`,
            [user.usuario_id]
        );

        user.roles = rolesResult.rows;
        user.permisos = [];

        console.log("🔹 Roles cargados:", user.roles);

        // Permisos por rol
        for (const role of user.roles) {
            const permisosResult = await query(
                `SELECT p.codigo, p.nombre, p.modulo, p.nivel
                 FROM roles_permisos rp
                 JOIN permisos p ON rp.permiso_id = p.permiso_id
                 WHERE rp.rol_id = (SELECT rol_id FROM roles WHERE nombre = $1)
                 AND rp.concedido = true`,
                [role.nombre]
            );
            user.permisos.push(...permisosResult.rows);
        }

        console.log("🔹 Permisos cargados:", user.permisos.length);

        return done(null, user);

    } catch (error) {
        console.error("🔥 Error en estrategia JWT:", error);
        return done(error, false);
    }
}));




// =============================
// ⚡ ESTRATEGIA GOOGLE OAUTH
// =============================
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
    }, async (accessToken, refreshToken, profile, done) => {

        console.log("\n=============================");
        console.log("🔵 GOOGLE LOGIN INICIADO");
        console.log("=============================");
        console.log("📧 Email recibido:", profile.emails?.[0]?.value);
        console.log("🆔 Google ID:", profile.id);
        console.log("👤 Nombre:", profile.name);

        try {
            const email = profile.emails[0].value;

            // 1. Revisar si ya existe
            console.log("🔍 Buscando usuario por email o google_id...");
            let result = await query(
                'SELECT * FROM usuarios WHERE email = $1 OR google_id = $2',
                [email, profile.id]
            );

            if (result.rows.length > 0) {
                console.log("✅ Usuario EXISTE. Actualizando login...");

                await query(
                    'UPDATE usuarios SET fecha_ultimo_login = NOW(), google_id = $1 WHERE usuario_id = $2',
                    [profile.id, result.rows[0].usuario_id]
                );

                console.log("🔄 Último login actualizado correctamente");
                return done(null, result.rows[0]);
            }

            // 2. SI NO EXISTE → Crear usuario con SP
            console.log("🟡 Usuario NO existe. Creando nuevo usuario...");
            console.log("➡ Ejecutando SP: sp_login_google");

            console.log("🟡 Usuario NO existe. Creando nuevo usuario DIRECTO...");

            const insertUser = await query(
                `INSERT INTO usuarios (
        email,
        username,
        contrasena_hash,
        tipo_usuario,
        google_id,
        provider,
        email_verificado,
        fecha_verificacion,
        fecha_creacion,
        fecha_ultimo_login,
        activo
    ) VALUES (
        $1,            -- email
        $2,            -- username
        '',            -- contrasena_hash (vacía porque es Google)
        'Cliente',     -- tipo_usuario
        $3,            -- google_id
        'google',      -- provider
        true,          -- email_verificado
        NOW(),         -- fecha_verificacion
        NOW(),         -- fecha_creacion
        NOW(),         -- fecha_ultimo_login
        true           -- activo
    )
    RETURNING *`,
                [
                    email,
                    profile.name.givenName.toLowerCase(),
                    profile.id
                ]
            );

            console.log("🟢 Usuario creado DIRECTO:", insertUser.rows[0]);

            return done(null, insertUser.rows[0]);


            console.log("🟢 SP ejecutado. Respuesta:", nuevoUsuario.rows[0]);

            const user = nuevoUsuario.rows[0].resultado;

            if (!user) {
                console.log("❌ ERROR: SP devolvió NULL. No se creó usuario.");
                return done(null, false);
            }

            console.log("🎉 Usuario creado exitosamente:", user.email);
            return done(null, user);

        } catch (error) {
            console.error("🔥 ERROR en estrategia Google OAuth:", error);
            return done(error, false);
        }
    }));
}

export default passport;
