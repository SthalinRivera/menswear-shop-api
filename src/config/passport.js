// src/config/passport.js
import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { query } from './database.js';
import { JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } from './constants.js';

// Estrategia JWT
const jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: JWT_SECRET,
};

passport.use(new JwtStrategy(jwtOptions, async (jwtPayload, done) => {
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

        if (result.rows.length === 0) return done(null, false);

        const user = result.rows[0];

        // Obtener roles del usuario
        const rolesResult = await query(
            `SELECT r.nombre, r.nivel
       FROM usuarios_roles ur
       JOIN roles r ON ur.rol_id = r.rol_id
       WHERE ur.usuario_id = $1 AND ur.activo = true`,
            [user.usuario_id]
        );

        user.roles = rolesResult.rows;
        user.permisos = [];

        // Obtener permisos del usuario
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

        return done(null, user);
    } catch (error) {
        return done(error, false);
    }
}));

// Estrategia Google OAuth
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const email = profile.emails[0].value;

            // Verificar si el usuario ya existe
            let result = await query(
                'SELECT * FROM usuarios WHERE email = $1 OR google_id = $2',
                [email, profile.id]
            );

            if (result.rows.length > 0) {
                // Usuario existe, actualizar última conexión
                await query(
                    'UPDATE usuarios SET fecha_ultimo_login = NOW(), google_id = $1 WHERE usuario_id = $2',
                    [profile.id, result.rows[0].usuario_id]
                );
                return done(null, result.rows[0]);
            }

            // Crear nuevo usuario
            const nuevoUsuario = await query(
                `SELECT sp_login_google($1, $2, $3, $4, $5, $6, $7) as resultado`,
                [
                    profile.id,
                    email,
                    profile.name.givenName,
                    profile.name.familyName || '',
                    profile.photos[0]?.value || '',
                    '127.0.0.1', // IP (debería obtenerse del request)
                    'Google OAuth Login'
                ]
            );

            const user = nuevoUsuario.rows[0].resultado;
            return done(null, user);
        } catch (error) {
            return done(error, false);
        }
    }));
}

export default passport;
