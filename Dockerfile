# Image runtime légère et maintenue
FROM node:22-alpine

# Dossier de travail
WORKDIR /app

# Copier uniquement les manifests pour profiter du cache
COPY package*.json ./

# ⚠️ Désactiver TOUS les scripts NPM (dont husky/prepare) pendant l'install
ENV NODE_ENV=production \
    HUSKY=0 \
    npm_config_ignore_scripts=true \
    npm_config_audit=false \
    npm_config_fund=false

# Installer uniquement les deps de prod SANS scripts
# - tente npm ci (si lockfile), sinon fallback npm install
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# Copier le reste des sources
COPY . .

# Le backend écoute sur ce port (modifie si besoin)
ENV PORT=3000
EXPOSE 3000

# Démarrage (entrée = server.js à la racine)
CMD ["node", "server.js"]
