// backend/routes/index.js
const express = require('express');
const router = express.Router();

const calcRoutes = require('./calcRoutes');

// petit ping global
router.get('/ping', (_req, res) => {
  res.json({ ok: true, route: 'api', message: 'API prête' });
});

// on sert les deux chemins vers le même module de calcul
router.use('/calc', calcRoutes);
router.use('/calculate', calcRoutes);

module.exports = router;
