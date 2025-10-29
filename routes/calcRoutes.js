// backend/routes/calcRoutes.js
const express = require('express');
const router = express.Router();

const { runCalculation } = require('../controllers/calcController');

// ping de la route
router.get('/ping', (_req, res) => {
  res.json({ ok: true, route: 'calc', message: 'route calc prête' });
});

// POST /api/calc  et  /api/calculate  (montés dans routes/index.js)
router.post('/', runCalculation);

module.exports = router;
