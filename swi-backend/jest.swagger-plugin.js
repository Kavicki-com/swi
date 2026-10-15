// Transformer do ts-jest que aplica o plugin do @nestjs/swagger aos testes.
//
// O plugin roda como transformador do TypeScript: `nest build` o aplica por
// causa do nest-cli.json, mas o ts-jest compila por conta própria e não lê
// aquele arquivo. Sem isto, o documento gerado dentro do jest sairia sem os
// esquemas dos DTOs e o teste de snapshot (src/docs/openapi-snapshot.spec.ts)
// acusaria divergência que não existe no build. As opções vêm do nest-cli.json
// de propósito: uma fonte só, para o build e o teste gerarem o mesmo documento.
const { before } = require('@nestjs/swagger/plugin')
const nestCli = require('./nest-cli.json')

const swaggerPlugin = nestCli.compilerOptions.plugins.find((plugin) => plugin.name === '@nestjs/swagger')
if (!swaggerPlugin) throw new Error('nest-cli.json sem o plugin @nestjs/swagger')

module.exports = {
  name: 'nestjs-swagger-plugin',
  version: 1,
  factory: (compilerInstance) => before(swaggerPlugin.options, compilerInstance.program),
}
