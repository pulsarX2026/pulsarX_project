// ============================================================
// routes/empresas.js — Rutas de empresas (tenants)
// ============================================================

const express = require('express');
const db      = require('../db');
const router  = express.Router();

// ════════════════════════════════════════════════════════════
// GET /api/empresas/validar/:codigo
// El frontend llama esto cuando el usuario escribe su código
// de empresa en tiempo real para mostrar el nombre
// ════════════════════════════════════════════════════════════
router.get('/validar/:codigo', async (req, res) => {
  try {
    const codigo = req.params.codigo.toUpperCase().trim();

    const [rows] = await db.query(
      `SELECT codigo, nombre, sector, pais
       FROM empresas
       WHERE codigo = ? AND activa = 1`,
      [codigo]
    );

    if (rows.length === 0) {
      // 404: código no existe
      return res.status(404).json({ existe: false, empresa: null });
    }

    // 200: código válido, devuelve el nombre de la empresa
    res.json({ existe: true, empresa: rows[0].nombre, sector: rows[0].sector });

  } catch (err) {
    console.error('Error al validar empresa:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
