# Estágio de build: o toolchain inteiro (TypeScript, Vite, Storybook) só existe
# aqui. A imagem final não tem Node nenhum — o painel é HTML, CSS e JS estáticos.
FROM node:22.23.2-alpine AS build
WORKDIR /app

# O package.json declara o design system como `file:./vendor/*.tgz`, então o
# tarball precisa estar no lugar ANTES do `npm ci`. Copiado junto do manifesto
# para que a camada de instalação só invalide quando um dos dois mudar.
COPY package*.json ./
COPY vendor ./vendor
# .npmrc traz `engine-strict=true`: sem ele o pin de Node/npm em `engines` seria
# só documentação e a imagem poderia ser construída fora do runtime declarado.
COPY .npmrc ./
# npm ci em vez de npm install: instala exatamente o que o lockfile fixa e falha
# se package.json e lock divergirem, em vez de resolver de novo e produzir um
# bundle diferente do que foi testado.
RUN npm ci

COPY . .

# Endereço da API assado no bundle. O Vite resolve `import.meta.env` em tempo de
# BUILD, não de execução: não há como um container pronto apontar para outro
# backend, e por isso isto é ARG e não variável do runtime.
#
# O default é o stack local do pacote de duplo clique. O `.env.production`
# versionado aponta para https://api.kavicki.com, e a variável de ambiente tem
# prioridade sobre os arquivos .env no Vite — é ela que vence aqui.
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

# Token do Mapbox. Ausente por padrão, e isso é deliberado: sem token o painel
# cai no Esri World Imagery (src/lib/mapStyles.ts), que não pede chave. O mapa
# funciona no cliente sem ninguém provisionar nada.
#
# O BuildKit emite `SecretsUsedInArgOrEnv` nas duas linhas abaixo por causa da
# palavra TOKEN no nome. É falso positivo aqui: TODA variável `VITE_*` vai
# assada no bundle que o navegador baixa, então nada que passe por aqui pode ser
# segredo por definição. O token do Mapbox é do tipo público (`pk.*`) e é
# protegido por restrição de origem no painel da conta, não por sigilo.
ARG VITE_MAPBOX_TOKEN=
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN

RUN npm run build

# Estágio de runtime: Nginx servindo o dist/. Sem Node, sem npm, sem fonte.
FROM nginx:1.29-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# A sonda pede a RAIZ, e não um endpoint sintético que responda 200 sempre: o
# `try_files` cai em /index.html, então esta requisição só passa se o bundle
# realmente estiver em disco. Um /healthz fixo diria "saudável" com o
# /usr/share/nginx/html vazio.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --quiet --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
