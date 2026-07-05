FROM node:22-alpine
# Prisma no Alpine (musl) precisa do OpenSSL/libssl — sem isso o schema engine
# não carrega ("Could not parse schema engine response").
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 3000
CMD ["node", "dist/main"]
