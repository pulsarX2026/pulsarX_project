// ============================================================
// db.js — Conexión a MySQL
// Usa un "pool" de conexiones para mejor rendimiento.
// Un pool reutiliza conexiones en lugar de abrir una nueva
// cada vez que se hace una consulta a la base de datos.
// ============================================================

const mysql  = require('mysql2');  // Importa la librería mysql2
require('dotenv').config();         // Carga las variables del archivo .env

// Crea el pool de conexiones con los datos del .env
const pool = mysql.createPool({
  host:     process.env.DB_HOST,      // localhost
  port:     process.env.DB_PORT,      // 3306
  user:     process.env.DB_USER,      // root
  password: process.env.DB_PASSWORD,  // tu contraseña de MySQL
  database: process.env.DB_NAME,      // pulsarx_master
  waitForConnections: true,           // espera si todas las conexiones están ocupadas
  connectionLimit:    10,             // máximo 10 conexiones simultáneas
  queueLimit:         0,              // sin límite de cola de espera
  timezone: 'local',                  // usa la zona horaria de tu servidor
});

// Convierte el pool a versión "promise" para usar async/await
// En lugar de callbacks como pool.query('SQL', function(err, rows){})
// podemos escribir: const [rows] = await db.query('SQL')
const db = pool.promise();

// Verifica que la conexión funciona al iniciar el servidor
pool.getConnection((err, connection) => {
  if (err) {
    // Si hay error, muestra el mensaje y el código del error
    console.error('❌ Error al conectar a MySQL:', err.message);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('   → Verifica el usuario y contraseña en el archivo .env');
    }
    if (err.code === 'ECONNREFUSED') {
      console.error('   → MySQL no está corriendo. Verifica que el servicio esté activo.');
    }
    return;
  }
  console.log('✅ Conexión a MySQL establecida correctamente');
  connection.release(); // Libera la conexión de vuelta al pool
});

module.exports = db; // Exporta el pool para usarlo en otros archivos
