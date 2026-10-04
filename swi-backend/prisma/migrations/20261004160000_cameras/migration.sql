-- Pontos de câmera da obra, cadastrados pelo administrador. Tabela nova, sem
-- tocar em nenhuma existente. O endereço é opcional: o ponto pode entrar no
-- mapa antes de o cliente informar a página da câmera.

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Camera_companyId_name_key" ON "Camera"("companyId", "name");

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
