-- ============================================================
-- pulsarx_master.sql
-- Ejecuta este script en MySQL Workbench UNA SOLA VEZ
-- para crear la base de datos maestra del sistema.
-- ============================================================

-- Crea la base de datos maestra si no existe
CREATE DATABASE IF NOT EXISTS pulsarx_master
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Usa la base de datos maestra
USE pulsarx_master;

-- ── TABLA: empresas (cada fila = un tenant) ────────────────
-- Esta tabla almacena todas las empresas registradas.
-- Cada empresa tiene su propia base de datos (db_tenant).
CREATE TABLE IF NOT EXISTS empresas (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  codigo     VARCHAR(20)  NOT NULL UNIQUE,  -- Código del tenant: EMP-XXXXXX
  nombre     VARCHAR(200) NOT NULL,
  ruc        VARCHAR(20)  NOT NULL UNIQUE,
  pais       VARCHAR(10)  DEFAULT 'PE',
  sector     VARCHAR(100),
  telefono   VARCHAR(30),
  db_tenant  VARCHAR(100) NOT NULL,         -- Nombre de la BD del tenant: tenant_xxxxxx
  activa     TINYINT(1)   DEFAULT 1,        -- 1=activa, 0=suspendida
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── ÍNDICES para búsquedas rápidas ────────────────────────
CREATE INDEX IF NOT EXISTS idx_empresas_codigo ON empresas(codigo);
CREATE INDEX IF NOT EXISTS idx_empresas_ruc    ON empresas(ruc);

-- ── DATOS DE PRUEBA (empresa demo) ───────────────────────
-- Esta empresa demo te permite probar el sistema de inmediato.
-- Contraseña del admin: Admin2024!
-- (el hash de bcrypt se genera automáticamente en el backend)
-- Para pruebas, usa el registro manual desde el login.

-- Confirmación
SELECT 'Base de datos pulsarx_master creada correctamente' AS resultado;
SELECT 'Ahora ejecuta: node server.js en la carpeta backend' AS siguiente_paso;
