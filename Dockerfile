# Image runtime légère et maintenue
FROM node:22-alpine

# Dossier de travail
WORKDIR /app

# Installer les deps en production
COPY package*.json ./
# Essaye npm ci (si package-lock), sinon fallback npm install
RUN npm ci --omit=dev || npm install --omit=dev

# Copier le reste des sources
COPY . .

# Variables par défaut (ajuste si besoin)
ENV NODE_ENV=production \
    PORT=3000

# Le backend écoute sur ce port (modifie si nécessaire)
EXPOSE 3000

# Démarrage (ton entrée est server.js à la racine)
CMD ["node", "server.js"]
