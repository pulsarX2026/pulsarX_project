// ============================================================
// server.js — Servidor principal de PulsarX Security CRM
// Este archivo arranca el servidor Express y registra
// todas las rutas (endpoints) de la API.
// ============================================================

const express = require('express');   // Framework web para Node.js
const cors    = require('cors');      // Permite peticiones desde el frontend
require('dotenv').config();           // Carga variables del .env

// Importa los archivos de rutas
const authRoutes     = require('./routes/auth');      // login, registro
const empresasRoutes = require('./routes/empresas');  // gestión de empresas (tenants)
const modulosRoutes  = require('./routes/modulos');   // los 22 módulos del CRM

const app  = express();               // Crea la aplicación Express
const PORT = process.env.PORT || 3000; // Puerto del servidor (del .env o 3000 por defecto)

// ── MIDDLEWARES ────────────────────────────────────────────
// Los middlewares son funciones que se ejecutan ANTES de cada ruta

// CORS: permite peticiones desde cualquier origen
// Necesario para que Docker pueda comunicarse con el backend
app.use(cors({
  origin: '*',
  credentials: false,
}));

// JSON parser: convierte el body de las peticiones POST/PUT de JSON a objeto JS
app.use(express.json());

// Logs de cada petición (útil para depurar)
app.use((req, res, next) => {
  const hora = new Date().toLocaleTimeString('es-PE');
  console.log(`[${hora}] ${req.method} ${req.path}`);
  next(); // pasa al siguiente middleware o a la ruta
});

// ── RUTAS DE LA API ────────────────────────────────────────
// Cada grupo de rutas tiene un prefijo /api/...

app.use('/api/auth',     authRoutes);     // POST /api/auth/login, /api/auth/registro-empresa, etc.
app.use('/api/empresas', empresasRoutes); // GET /api/empresas/validar/:codigo
app.use('/api/modulos',  modulosRoutes);  // GET/POST/PUT/DELETE /api/modulos/:nombre

// ── RUTA RAÍZ ─────────────────────────────────────────────
// Verifica que el servidor está corriendo
app.get('/', (req, res) => {
  res.json({
    sistema:  'PulsarX Security CRM',
    version:  '1.0.0',
    estado:   'activo',
    fecha:    new Date().toLocaleDateString('es-PE'),
  });
});

// ── MANEJO DE ERRORES GLOBALES ─────────────────────────────
// Si alguna ruta lanza un error no capturado, llega aquí
app.use((err, req, res, next) => {
  console.error('❌ Error no capturado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── RUTA NO ENCONTRADA ────────────────────────────────────
// Si el cliente llama a una ruta que no existe
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.path} no encontrada` });
});

// ── INICIA EL SERVIDOR ────────────────────────────────────
// '0.0.0.0' hace que el servidor escuche en TODAS las interfaces
// de red, no solo en localhost — necesario para que Docker
// y otros dispositivos puedan conectarse al backend.
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🚀 PulsarX Security CRM — Backend iniciado');
  console.log(`📡 Servidor corriendo en: http://localhost:${PORT}`);
  console.log(`🌐 Accesible desde red en: http://192.168.1.77:${PORT}`);
  console.log(`🌐 Frontend permitido en:  ${process.env.FRONTEND_URL}`);
  console.log('');
});