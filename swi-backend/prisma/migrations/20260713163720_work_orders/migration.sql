/*
  WorkOrder (pai) + Task re-baseado (filho = item do checklist).

  Migração NÃO-destrutiva quanto ao vínculo item→ordem: `Task.orderId` entra
  NULLABLE, as Task pré-existentes são ADOTADAS por uma WorkOrder "legada" (autor
  = um admin, ou qualquer user; responsáveis = os antigos `assignedTo` distintos),
  e só então `orderId` vira NOT NULL. Isso deixa `prisma migrate deploy` rodar em
  qualquer banco com Task pré-existente sem quebrar (o `ADD COLUMN NOT NULL` seco
  abortava — coluna sem default numa tabela não-vazia).

  As colunas `assignedTo`/`imageKeys`/`interested*`/`objective`/`scheduledDate`
  são removidas de propósito (a semântica migrou pro pai): esses dados são
  descartados, mas o vínculo do item (via `assignedTo` → responsável da ordem
  legada) é preservado.
*/

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('pending', 'in_progress', 'done');

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "details" TEXT,
    "sector" TEXT,
    "estimatedMinutes" INTEGER,
    "startDate" DATE,
    "dueDate" DATE,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'pending',
    "imageKeys" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_workOrderResponsibles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "_workOrderResponsibles_AB_unique" ON "_workOrderResponsibles"("A", "B");

-- CreateIndex
CREATE INDEX "_workOrderResponsibles_B_index" ON "_workOrderResponsibles"("B");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_workOrderResponsibles" ADD CONSTRAINT "_workOrderResponsibles_A_fkey" FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_workOrderResponsibles" ADD CONSTRAINT "_workOrderResponsibles_B_fkey" FOREIGN KEY ("B") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: adiciona orderId NULLABLE + position (backfill vem antes do NOT NULL)
ALTER TABLE "Task" ADD COLUMN "orderId" TEXT,
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill: adota Task órfãs numa WorkOrder legada (roda só quando existe orderId
-- NULL). Só toca dados pré-existentes; num banco novo é no-op.
DO $$
DECLARE
  legacy_id  text;
  author_id  text;
BEGIN
  IF EXISTS (SELECT 1 FROM "Task" WHERE "orderId" IS NULL) THEN
    -- Autor: prefere um ADMIN; senão qualquer user (a ordem PRECISA de autor NOT NULL).
    SELECT id INTO author_id FROM "User" ORDER BY (role = 'ADMIN') DESC, "createdAt" ASC LIMIT 1;
    IF author_id IS NULL THEN
      RAISE EXCEPTION 'backfill work_orders: existem Task órfãs mas nenhum User para autorar a ordem legada';
    END IF;

    legacy_id := gen_random_uuid()::text;
    INSERT INTO "WorkOrder" (id, "authorId", title, summary, status, "imageKeys", "createdAt", "updatedAt")
    VALUES (legacy_id, author_id, 'Tarefas migradas',
            'Ordem criada na migração para adotar tarefas pré-existentes.',
            'pending', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    -- Adota as órfãs; posição sequencial determinística (por id).
    UPDATE "Task" t
    SET "orderId" = legacy_id, "position" = sub.rn
    FROM (SELECT id, (row_number() OVER (ORDER BY id)) - 1 AS rn FROM "Task" WHERE "orderId" IS NULL) sub
    WHERE t.id = sub.id;

    -- Responsáveis = antigos assignedTo distintos (não-nulos) das adotadas.
    INSERT INTO "_workOrderResponsibles" ("A", "B")
    SELECT DISTINCT t."assignedTo", legacy_id
    FROM "Task" t
    WHERE t."orderId" = legacy_id AND t."assignedTo" IS NOT NULL
    ON CONFLICT ("A", "B") DO NOTHING;
  END IF;
END $$;

-- Agora que toda Task tem orderId, trava o NOT NULL.
ALTER TABLE "Task" ALTER COLUMN "orderId" SET NOT NULL;

-- DropIndex + DropForeignKey + DropColumn das colunas cuja semântica migrou pro pai.
DROP INDEX "Task_assignedTo_scheduledDate_idx";
ALTER TABLE "Task" DROP CONSTRAINT "Task_assignedTo_fkey";
ALTER TABLE "Task" DROP COLUMN "assignedTo",
DROP COLUMN "imageKeys",
DROP COLUMN "interestedAvatarKeys",
DROP COLUMN "interestedCount",
DROP COLUMN "objective",
DROP COLUMN "scheduledDate";

-- CreateIndex
CREATE INDEX "Task_orderId_position_idx" ON "Task"("orderId", "position");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
