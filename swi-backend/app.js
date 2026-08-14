// Bootstrap Cloudez: o process manager (forever) executa www/app.js.
// Fixa o cwd na pasta da aplicacao (o dotenv le .env do cwd) e delega
// pro build do Nest, que escuta no socket Unix via LISTEN_SOCKET.
process.chdir(__dirname)
require('./dist/main.js')
