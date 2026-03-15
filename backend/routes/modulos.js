// ============================================================
// routes/modulos.js — CRUD genérico para los 22 módulos
// Una sola ruta maneja todos los módulos usando el nombre
// de la tabla como parámetro dinámico en la URL.
// ============================================================

const express = require('express');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const router  = express.Router();

// ── MIDDLEWARE: verifica el token JWT ──────────────────────
// Se ejecuta ANTES de cada ruta de módulos.
// Si el token no existe o es inválido, devuelve 401.
function verificarToken(req, res, next) {
  // El token viene en el header: Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1]; // extrae solo el token

  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado. Inicia sesión.' });
  }

  try {
    // jwt.verify() decodifica el token y verifica que sea válido y no haya expirado
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario   = decoded; // guarda los datos del usuario en la petición
    next();                  // continúa a la ruta
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Tu sesión ha expirado. Vuelve a iniciar sesión.' });
    }
    return res.status(403).json({ error: 'Token inválido.' });
  }
}

// ── Mapa de módulos → nombre de tabla en MySQL ─────────────
// El frontend envía el nombre del módulo y aquí se mapea
// al nombre exacto de la tabla en la base de datos del tenant.
const TABLAS = {
  'acceso-alumnos':       'acceso_alumnos',
  'acceso-colaboradores': 'acceso_colaboradores',
  'acceso-visitas':       'acceso_visitas',
  'acceso-proveedores':   'acceso_proveedores',
  'acceso-eventos':       'acceso_eventos',
  'estacionamientos':     'estacionamientos',
  'movimiento-activos':   'movimiento_activos',
  'gestion-accesos':      'gestion_accesos',
  'control-rondas':       'control_rondas',
  'incidentes':           'incidentes',
  'bitacora':             'bitacora',
  'control-vigilancia':   'control_vigilancia',
  'extintores':           'extintores',
  'llaves':               'llaves',
  'inventarios':          'inventarios',
  'mantenimiento':        'mantenimiento',
  'recojo-alumnos':       'recojo_alumnos',
  'objetos-perdidos':     'objetos_perdidos',
  'altas-bajas':          'altas_bajas',
  'riesgos':              'riesgos',
  'sismos':               'sismos',
  'transporte':           'transporte',
};

// ── HELPER: obtiene el nombre de tabla validado ────────────
function obtenerTabla(modulo) {
  const tabla = TABLAS[modulo];
  if (!tabla) return null;
  return tabla;
}

// ════════════════════════════════════════════════════════════
// GET /api/modulos/:modulo
// Lee todos los registros de un módulo
// Ejemplo: GET /api/modulos/incidentes
// ════════════════════════════════════════════════════════════
router.get('/:modulo', verificarToken, async (req, res) => {
  const tabla   = obtenerTabla(req.params.modulo);
  if (!tabla) return res.status(400).json({ error: 'Módulo no válido' });

  const dbTenant = req.usuario.db_tenant; // base de datos de la empresa del usuario

  try {
    // Consulta todos los registros ordenados por más reciente primero
    const [rows] = await db.query(
      `SELECT * FROM \`${dbTenant}\`.\`${tabla}\` ORDER BY id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(`Error GET ${tabla}:`, err);
    res.status(500).json({ error: 'Error al obtener registros' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/modulos/:modulo
// Crea un nuevo registro en un módulo
// Body: objeto con los campos del formulario
// ════════════════════════════════════════════════════════════
router.post('/:modulo', verificarToken, async (req, res) => {
  const tabla   = obtenerTabla(req.params.modulo);
  if (!tabla) return res.status(400).json({ error: 'Módulo no válido' });

  const dbTenant = req.usuario.db_tenant;
  const datos    = req.body; // los campos del formulario del frontend

  // Elimina campos que no deben enviarse manualmente
  delete datos.id;
  delete datos._id;
  delete datos.created_at;

  if (!datos || Object.keys(datos).length === 0) {
    return res.status(400).json({ error: 'No se enviaron datos' });
  }

  try {
    // Construye el INSERT dinámicamente a partir de los campos enviados
    // Ejemplo: INSERT INTO `tenant_abc`.`incidentes` (`tipo`,`lugar`) VALUES (?,?)
    const columnas = Object.keys(datos).join('`, `');
    const valores  = Object.values(datos);
    const placeH   = valores.map(() => '?').join(', '); // genera los "?" para cada valor

    const [result] = await db.query(
      `INSERT INTO \`${dbTenant}\`.\`${tabla}\` (\`${columnas}\`) VALUES (${placeH})`,
      valores
    );

    res.status(201).json({
      mensaje: 'Registro creado correctamente',
      id:      result.insertId, // ID generado automáticamente por MySQL
    });
  } catch (err) {
    console.error(`Error POST ${tabla}:`, err);
    res.status(500).json({ error: 'Error al crear el registro' });
  }
});

// ════════════════════════════════════════════════════════════
// PUT /api/modulos/:modulo/:id
// Actualiza un registro existente
// Body: objeto con los campos a actualizar
// ════════════════════════════════════════════════════════════
router.put('/:modulo/:id', verificarToken, async (req, res) => {
  const tabla   = obtenerTabla(req.params.modulo);
  if (!tabla) return res.status(400).json({ error: 'Módulo no válido' });

  const dbTenant = req.usuario.db_tenant;
  const id       = parseInt(req.params.id);
  const datos    = req.body;

  delete datos.id;
  delete datos._id;
  delete datos.created_at;

  if (!datos || Object.keys(datos).length === 0) {
    return res.status(400).json({ error: 'No se enviaron datos para actualizar' });
  }

  try {
    // Construye el UPDATE dinámicamente
    // Ejemplo: UPDATE `tenant`.`incidentes` SET `tipo`=?, `lugar`=? WHERE id=?
    const sets   = Object.keys(datos).map(col => `\`${col}\` = ?`).join(', ');
    const valores = [...Object.values(datos), id];

    const [result] = await db.query(
      `UPDATE \`${dbTenant}\`.\`${tabla}\` SET ${sets} WHERE id = ?`,
      valores
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    res.json({ mensaje: 'Registro actualizado correctamente' });
  } catch (err) {
    console.error(`Error PUT ${tabla}:`, err);
    res.status(500).json({ error: 'Error al actualizar el registro' });
  }
});

// ════════════════════════════════════════════════════════════
// DELETE /api/modulos/:modulo/:id
// Elimina un registro por su ID
// ════════════════════════════════════════════════════════════
router.delete('/:modulo/:id', verificarToken, async (req, res) => {
  const tabla   = obtenerTabla(req.params.modulo);
  if (!tabla) return res.status(400).json({ error: 'Módulo no válido' });

  const dbTenant = req.usuario.db_tenant;
  const id       = parseInt(req.params.id);

  try {
    const [result] = await db.query(
      `DELETE FROM \`${dbTenant}\`.\`${tabla}\` WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    res.json({ mensaje: 'Registro eliminado correctamente' });
  } catch (err) {
    console.error(`Error DELETE ${tabla}:`, err);
    res.status(500).json({ error: 'Error al eliminar el registro' });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/modulos/:modulo/stats
// Devuelve el total de registros de cada módulo (para el dashboard)
// ════════════════════════════════════════════════════════════
router.get('/stats/resumen', verificarToken, async (req, res) => {
  const dbTenant = req.usuario.db_tenant;

  try {
    // Cuenta los registros de cada tabla de una sola vez
    const stats = {};
    for (const [modulo, tabla] of Object.entries(TABLAS)) {
      const [rows] = await db.query(
        `SELECT COUNT(*) as total FROM \`${dbTenant}\`.\`${tabla}\``
      );
      stats[modulo] = rows[0].total;
    }
    res.json(stats);
  } catch (err) {
    console.error('Error en stats:', err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

module.exports = router;
