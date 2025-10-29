// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'smartpitch-backend', version: '0.1.0' });
});

// Home
app.get('/', (_req, res) => {
  res.send('✅ Serveur SmartPitch fonctionne parfaitement !');
});

// Routes API
const apiRoutes = require('./routes');
app.use('/api', apiRoutes);

// Lancer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur SmartPitch lancé sur http://localhost:${PORT}`);
});
