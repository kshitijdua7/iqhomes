# IQHomes: one container serves the dashboard and the API on port 4000.
FROM node:22-slim

WORKDIR /app

# Install dependencies first so Docker can cache this layer.
COPY server/package.json server/package-lock.json server/
COPY web/package.json web/package-lock.json web/
RUN npm ci --prefix server && npm ci --prefix web

# Build the React app; the server serves web/dist in production.
COPY . .
RUN npm run build --prefix web

ENV NODE_ENV=production \
    PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start", "--prefix", "server"]
