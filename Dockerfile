FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/fieldwork.sqlite
RUN install -d -o node -g node /app/data
COPY --chown=node:node server.mjs package.json ./
COPY --chown=node:node lib/ lib/
COPY --chown=node:node public/ public/
COPY --chown=node:node config/ config/
COPY --chown=node:node reference/ reference/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node","-e","fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})"]
CMD ["node","server.mjs"]
