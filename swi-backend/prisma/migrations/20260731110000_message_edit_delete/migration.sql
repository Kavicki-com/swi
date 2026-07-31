-- QA Web #4: editar e excluir mensagem do chat.
--
-- Excluir deixa MARCA em vez de apagar a linha: `deletedAt` é lápide, o `body`
-- fica no banco (reversível e auditável) e é a API que para de devolvê-lo.
-- `editedAt` é o que faz a bolha mostrar "editada".
--
-- Aditiva e nullable: nenhuma linha existente precisa de backfill, e o deploy
-- pode rodar com a versão anterior do código no ar.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3);
