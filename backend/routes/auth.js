// ============================================================
// routes/auth.js — Rutas de autenticación
// Maneja: login, registro de empresa (tenant), registro de usuario
// ============================================================

const express = require('express');
const bcrypt  = require('bcryptjs');   // Para encriptar y verificar contraseñas
const jwt     = require('jsonwebtoken'); // Para generar tokens de sesión
const db      = require('../db');        // Conexión a MySQL

const router = express.Router(); // Crea un sub-router de Express

// ── HELPER: genera un código único de empresa ──────────────
// Formato: EMP-XXXXXX (6 caracteres aleatorios en mayúsculas)
function generarCodigoEmpresa() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codigo  = 'EMP-';
  for (let i = 0; i < 6; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return codigo;
}

// ── HELPER: genera el nombre de la base de datos del tenant ─
// Cada empresa tiene su propia base de datos en MySQL.
// Ejemplo: empresa con código EMP-A1B2C3 → base de datos tenant_a1b2c3
function nombreBD(codigoEmpresa) {
  return 'tenant_' + codigoEmpresa.replace('EMP-', '').toLowerCase();
}

// ════════════════════════════════════════════════════════════
// POST /api/auth/registro-empresa
// Registra una nueva empresa (crea su tenant en MySQL)
// Body: { nombre, ruc, pais, sector, telefono,
//         adm_nombre, adm_apellido, adm_email, adm_password }
// ════════════════════════════════════════════════════════════
router.post('/registro-empresa', async (req, res) => {
  const {
    nombre, ruc, pais, sector, telefono,
    adm_nombre, adm_apellido, adm_email, adm_password
  } = req.body;

  // Validación de campos obligatorios
  if (!nombre || !ruc || !adm_email || !adm_password) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    // 1. Verifica que el RUC no esté ya registrado
    const [existe] = await db.query(
      'SELECT id FROM empresas WHERE ruc = ?', [ruc]
    );
    if (existe.length > 0) {
      return res.status(409).json({ error: 'Ya existe una empresa registrada con ese RUC' });
    }

    // 2. Genera un código único para el tenant
    let codigo;
    let codigoUnico = false;
    while (!codigoUnico) {
      codigo = generarCodigoEmpresa();
      const [check] = await db.query(
        'SELECT id FROM empresas WHERE codigo = ?', [codigo]
      );
      if (check.length === 0) codigoUnico = true; // El código no existe → es único
    }

    // 3. Encripta la contraseña del administrador
    // bcrypt.hash(password, saltRounds) → el 12 indica cuántas veces se encripta (más = más seguro)
    const passwordHash = await bcrypt.hash(adm_password, 12);

    // 4. Determina el nombre de la base de datos del tenant
    const dbTenant = nombreBD(codigo);

    // 5. Crea la base de datos del tenant (cada empresa tiene la suya)
    // Esta es la clave del modelo multi-tenant
    await db.query(`CREATE DATABASE IF NOT EXISTS \`${dbTenant}\``);

    // 6. Crea las tablas del tenant dentro de su base de datos
    await crearTablasTenant(dbTenant);

    // 7. Registra la empresa en la base de datos maestra (pulsarx_master)
    await db.query(
      `INSERT INTO empresas (codigo, nombre, ruc, pais, sector, telefono, db_tenant)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [codigo, nombre, ruc, pais, sector, telefono, dbTenant]
    );

    // 8. Registra al administrador en la base de datos del tenant
    await db.query(
      `INSERT INTO \`${dbTenant}\`.usuarios
       (nombre, apellido, email, password, cargo, activo)
       VALUES (?, ?, ?, ?, 'admin', 1)`,
      [adm_nombre, adm_apellido, adm_email, passwordHash]
    );

    // 9. Responde con el código generado (el frontend lo muestra al usuario)
    res.status(201).json({
      mensaje: 'Empresa registrada exitosamente',
      codigo,
      empresa: nombre,
    });

  } catch (err) {
    console.error('Error en registro-empresa:', err);
    res.status(500).json({ error: 'Error al registrar la empresa' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/auth/registro-usuario
// Registra un nuevo usuario dentro de una empresa existente
// Body: { codigo_empresa, nombre, apellido, email, password, cargo }
// ════════════════════════════════════════════════════════════
router.post('/registro-usuario', async (req, res) => {
  const { codigo_empresa, nombre, apellido, email, password, cargo } = req.body;

  if (!codigo_empresa || !nombre || !email || !password) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    // 1. Verifica que la empresa existe con ese código
    const [empresas] = await db.query(
      'SELECT * FROM empresas WHERE codigo = ?', [codigo_empresa]
    );
    if (empresas.length === 0) {
      return res.status(404).json({ error: 'Código de empresa no encontrado' });
    }
    const empresa = empresas[0];

    // 2. Verifica que el email no esté ya registrado en esa empresa
    const [existe] = await db.query(
      `SELECT id FROM \`${empresa.db_tenant}\`.usuarios WHERE email = ?`, [email]
    );
    if (existe.length > 0) {
      return res.status(409).json({ error: 'Este correo ya está registrado en esa empresa' });
    }

    // 3. Encripta la contraseña
    const passwordHash = await bcrypt.hash(password, 12);

    // 4. Inserta el usuario en la base de datos del tenant
    await db.query(
      `INSERT INTO \`${empresa.db_tenant}\`.usuarios
       (nombre, apellido, email, password, cargo, activo)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [nombre, apellido, email, passwordHash, cargo || 'operador']
    );

    res.status(201).json({ mensaje: `Usuario ${nombre} registrado correctamente` });

  } catch (err) {
    console.error('Error en registro-usuario:', err);
    res.status(500).json({ error: 'Error al registrar el usuario' });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/auth/login
// Verifica credenciales y devuelve un token JWT
// Body: { codigo_empresa, email, password }
// ════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  const { codigo_empresa, email, password } = req.body;

  if (!codigo_empresa || !email || !password) {
    return res.status(400).json({ error: 'Código de empresa, email y contraseña son requeridos' });
  }

  try {
    // 1. Busca la empresa en la base de datos maestra
    const [empresas] = await db.query(
      'SELECT * FROM empresas WHERE codigo = ? AND activa = 1', [codigo_empresa]
    );
    if (empresas.length === 0) {
      return res.status(401).json({ error: 'Código de empresa no encontrado o empresa inactiva' });
    }
    const empresa = empresas[0];

    // 2. Busca el usuario en la base de datos del tenant
    const [usuarios] = await db.query(
      `SELECT * FROM \`${empresa.db_tenant}\`.usuarios
       WHERE email = ? AND activo = 1`, [email]
    );
    if (usuarios.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const usuario = usuarios[0];

    // 3. Verifica la contraseña con bcrypt
    // bcrypt.compare(passwordPlano, passwordHasheado) → true/false
    const passwordValida = await bcrypt.compare(password, usuario.password);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // 4. Genera el token JWT con los datos del usuario
    // El token contiene la información del usuario codificada y firmada.
    // jwt.sign(payload, secreto, opciones)
    const token = jwt.sign(
      {
        usuario_id:     usuario.id,
        nombre:         usuario.nombre,
        apellido:       usuario.apellido,
        email:          usuario.email,
        cargo:          usuario.cargo,
        empresa_codigo: empresa.codigo,
        empresa_nombre: empresa.nombre,
        db_tenant:      empresa.db_tenant,
      },
      process.env.JWT_SECRET,        // clave secreta del .env
      { expiresIn: process.env.JWT_EXPIRES || '8h' } // expira en 8 horas
    );

    // 5. Responde con el token y los datos del usuario (sin la contraseña)
    res.json({
      token,
      usuario: {
        id:      usuario.id,
        nombre:  usuario.nombre,
        apellido:usuario.apellido,
        email:   usuario.email,
        cargo:   usuario.cargo,
      },
      empresa: {
        codigo: empresa.codigo,
        nombre: empresa.nombre,
      },
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/auth/validar-empresa/:codigo
// Verifica si un código de empresa existe (para el frontend)
// ════════════════════════════════════════════════════════════
router.get('/validar-empresa/:codigo', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT codigo, nombre FROM empresas WHERE codigo = ? AND activa = 1',
      [req.params.codigo.toUpperCase()]
    );
    if (rows.length === 0) {
      return res.status(404).json({ existe: false });
    }
    res.json({ existe: true, empresa: rows[0].nombre });
  } catch (err) {
    res.status(500).json({ error: 'Error al validar empresa' });
  }
});

// ════════════════════════════════════════════════════════════
// FUNCIÓN: Crea todas las tablas del tenant
// Se llama cuando se registra una nueva empresa.
// Cada tabla corresponde a un módulo del CRM.
// ════════════════════════════════════════════════════════════
async function crearTablasTenant(dbName) {
  // Helper para ejecutar SQL en la base de datos del tenant
  const sql = async (query) => await db.query(`USE \`${dbName}\`; ${query}`);

  // Tabla de usuarios del tenant
  await db.query(`
    CREATE TABLE IF NOT EXISTS \`${dbName}\`.usuarios (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      nombre     VARCHAR(100) NOT NULL,
      apellido   VARCHAR(100),
      email      VARCHAR(150) NOT NULL UNIQUE,
      password   VARCHAR(255) NOT NULL,
      cargo      ENUM('admin','supervisor','vigilante','operador','auxiliar') DEFAULT 'operador',
      activo     TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 1. Acceso de Alumnos
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.acceso_alumnos (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    nombre     VARCHAR(150) NOT NULL,
    codigo     VARCHAR(50),
    grado      VARCHAR(50),
    hora       TIME,
    tipo       ENUM('Ingreso','Salida') DEFAULT 'Ingreso',
    obs        TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 2. Acceso de Colaboradores
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.acceso_colaboradores (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    nombre     VARCHAR(150) NOT NULL,
    dni        VARCHAR(20),
    area       VARCHAR(100),
    cargo      VARCHAR(100),
    hora       TIME,
    tipo       ENUM('Ingreso','Salida') DEFAULT 'Ingreso',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 3. Acceso de Visitas
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.acceso_visitas (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    nombre     VARCHAR(150) NOT NULL,
    dni        VARCHAR(20),
    motivo     VARCHAR(200),
    contacto   VARCHAR(150),
    ingreso    TIME,
    salida     TIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 4. Acceso de Proveedores
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.acceso_proveedores (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    empresa    VARCHAR(150) NOT NULL,
    contacto   VARCHAR(150),
    ruc        VARCHAR(20),
    servicio   VARCHAR(150),
    placa      VARCHAR(20),
    hora       TIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 5. Acceso a Eventos
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.acceso_eventos (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    evento     VARCHAR(200) NOT NULL,
    asistente  VARCHAR(150),
    tipo       ENUM('Alumno','Apoderado','Invitado','Personal') DEFAULT 'Invitado',
    ticket     VARCHAR(50),
    fecha      DATE,
    estado     ENUM('Confirmado','Pendiente','Cancelado') DEFAULT 'Pendiente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 6. Gestión de Estacionamientos
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.estacionamientos (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    placa        VARCHAR(20) NOT NULL,
    propietario  VARCHAR(150),
    tipo         ENUM('Auto','Moto','Camioneta','Bus','Otro') DEFAULT 'Auto',
    espacio      VARCHAR(20),
    ingreso      TIME,
    estado       ENUM('Ocupado','Libre','Reservado') DEFAULT 'Ocupado',
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 7. Movimiento de Activos
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.movimiento_activos (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    activo       VARCHAR(150) NOT NULL,
    codigo       VARCHAR(50),
    origen       VARCHAR(150),
    destino      VARCHAR(150),
    responsable  VARCHAR(150),
    fecha        DATE,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 8. Gestión de Accesos
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.gestion_accesos (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    persona    VARCHAR(150) NOT NULL,
    zona       VARCHAR(150),
    nivel      ENUM('Básico','Intermedio','Restringido','Total') DEFAULT 'Básico',
    inicio     DATE,
    fin        DATE,
    estado     ENUM('Activo','Suspendido','Revocado') DEFAULT 'Activo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 9. Control de Rondas
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.control_rondas (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    vigilante  VARCHAR(150) NOT NULL,
    zona       VARCHAR(150),
    inicio     TIME,
    fin        TIME,
    novedad    ENUM('Sin novedad','Con novedad') DEFAULT 'Sin novedad',
    obs        TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 10. Gestión de Incidentes
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.incidentes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    tipo       ENUM('Robo','Vandalismo','Accidente','Pelea','Intrusión','Otro') DEFAULT 'Otro',
    lugar      VARCHAR(200),
    fecha      DATETIME,
    afectado   VARCHAR(150),
    severidad  ENUM('Leve','Moderado','Grave','Crítico') DEFAULT 'Leve',
    estado     ENUM('Abierto','En proceso','Cerrado') DEFAULT 'Abierto',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 11. Bitácora
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.bitacora (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    turno        ENUM('Mañana','Tarde','Noche') DEFAULT 'Mañana',
    responsable  VARCHAR(150),
    hora         TIME,
    tipo         ENUM('Novedad','Incidente','Observación','Alerta','Normal') DEFAULT 'Normal',
    descripcion  TEXT,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 12. Control de Vigilancia
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.control_vigilancia (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    vigilante  VARCHAR(150) NOT NULL,
    puesto     VARCHAR(150),
    turno      VARCHAR(50),
    fecha      DATE,
    estado     ENUM('En servicio','Descanso','Franco','Licencia') DEFAULT 'En servicio',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 13. Control de Extintores
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.extintores (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    codigo      VARCHAR(50) NOT NULL,
    ubicacion   VARCHAR(200),
    tipo        ENUM('PQS','CO2','Agua','AFFF') DEFAULT 'PQS',
    capacidad   VARCHAR(20),
    vencimiento DATE,
    estado      ENUM('Operativo','Vencido','Recarga pendiente','Baja') DEFAULT 'Operativo',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 14. Gestión de Llaves
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.llaves (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    llave       VARCHAR(150) NOT NULL,
    persona     VARCHAR(150),
    area        VARCHAR(100),
    prestamo    TIME,
    devolucion  TIME,
    estado      ENUM('Prestada','Devuelta','Perdida') DEFAULT 'Prestada',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 15. Gestión de Inventarios
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.inventarios (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    item       VARCHAR(200) NOT NULL,
    codigo     VARCHAR(50),
    categoria  ENUM('Electrónico','Mobiliario','Herramienta','Vehículo','Otro') DEFAULT 'Otro',
    ubicacion  VARCHAR(200),
    cantidad   INT DEFAULT 1,
    estado     ENUM('Bueno','Regular','Deteriorado','Dado de baja') DEFAULT 'Bueno',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 16. Gestión de Mantenimiento
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.mantenimiento (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    area       VARCHAR(200) NOT NULL,
    tipo       ENUM('Preventivo','Correctivo','Predictivo') DEFAULT 'Preventivo',
    tecnico    VARCHAR(150),
    fecha      DATE,
    prioridad  ENUM('Baja','Media','Alta','Urgente') DEFAULT 'Media',
    estado     ENUM('Pendiente','En proceso','Completado','Cancelado') DEFAULT 'Pendiente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 17. Recojo de Alumnos
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.recojo_alumnos (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    alumno      VARCHAR(150) NOT NULL,
    grado       VARCHAR(50),
    apoderado   VARCHAR(150),
    parentesco  ENUM('Padre','Madre','Tutor','Hermano/a','Otro') DEFAULT 'Padre',
    hora        TIME,
    autorizado  ENUM('Sí','No') DEFAULT 'Sí',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 18. Objetos Perdidos
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.objetos_perdidos (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    objeto      VARCHAR(200) NOT NULL,
    lugar       VARCHAR(200),
    fecha       DATE,
    entregado   VARCHAR(150),
    reclamado   VARCHAR(150),
    estado      ENUM('En custodia','Devuelto','Sin reclamar') DEFAULT 'En custodia',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 19. Gestión de Altas y Bajas
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.altas_bajas (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    persona      VARCHAR(200) NOT NULL,
    tipo         ENUM('Alta','Baja') DEFAULT 'Alta',
    categoria    ENUM('Personal','Alumno','Activo','Otro') DEFAULT 'Personal',
    motivo       TEXT,
    fecha        DATE,
    responsable  VARCHAR(150),
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 20. Gestión de Riesgos
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.riesgos (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    riesgo        TEXT NOT NULL,
    area          VARCHAR(200),
    probabilidad  ENUM('Baja','Media','Alta','Muy alta') DEFAULT 'Media',
    impacto       ENUM('Leve','Moderado','Grave','Catastrófico') DEFAULT 'Moderado',
    medida        TEXT,
    estado        ENUM('Identificado','En tratamiento','Mitigado','Aceptado') DEFAULT 'Identificado',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 21. Gestión de Sismos
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.sismos (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    tipo       ENUM('Simulacro','Sismo real','Alerta temprana') DEFAULT 'Simulacro',
    fecha      DATETIME,
    magnitud   VARCHAR(50),
    zona       VARCHAR(200),
    evacuados  INT DEFAULT 0,
    estado     ENUM('Apta','Daños menores','Daños mayores','No habitable') DEFAULT 'Apta',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 22. Gestión de Transporte
  await db.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.transporte (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    unidad     VARCHAR(100) NOT NULL,
    conductor  VARCHAR(150),
    ruta       VARCHAR(200),
    alumnos    INT DEFAULT 0,
    salida     TIME,
    estado     ENUM('Programado','En ruta','Completado','Cancelado') DEFAULT 'Programado',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log(`✅ Tablas del tenant ${dbName} creadas correctamente`);
}

module.exports = router;
