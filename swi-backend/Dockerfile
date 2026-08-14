# Estágio de build: precisa do toolchain inteiro (Nest CLI, TypeScript) para
# compilar. Nada daqui vai para a imagem final além do dist/.
FROM node:22.23.2-alpine AS build
# Prisma no Alpine (musl) precisa do OpenSSL/libssl: sem isso o schema engine
# não carrega ("Could not parse schema engine response").
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
# npm ci em vez de npm install: instala exatamente o que o lockfile fixa e
# falha se package.json e lock divergirem, em vez de resolver de novo e
# produzir uma imagem diferente da que foi testada.
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# Estágio de runtime: só o que a API e o `prisma migrate deploy` do boot
# precisam. As devDependencies (Nest CLI, TypeScript, Jest, ts-node, eslint)
# ficam para trás.
FROM node:22.23.2-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# O schema entra ANTES do npm ci porque o postinstall do @prisma/client
# procura por ele; sem o schema no lugar a instalação só avisa e o client
# nasceria sem engine.
COPY prisma ./prisma
RUN npm ci --omit=dev
# O CLI do Prisma é dependência de runtime de verdade, não de build: o compose
# sobe a API com `npx prisma migrate deploy && node dist/main`. Por isso ele
# mora em "dependencies" e sobrevive ao --omit=dev.
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
