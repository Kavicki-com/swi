-- Fase 1 do "Nome do usuário": handle visível (@username), único, exibido no
-- chat e no perfil. A fase 2 (login por username) usará esta mesma coluna.
--
-- Aditiva e nullable: nenhuma linha existente precisa de backfill, o índice
-- único do Postgres ignora NULL, e o deploy pode rodar com a versão anterior
-- do código no ar.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
