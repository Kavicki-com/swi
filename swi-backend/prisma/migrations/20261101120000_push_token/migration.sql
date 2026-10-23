-- Token de push do aparelho (serviço da Expo, que repassa ao FCM e ao APNs).
-- Um token pertence a um usuário por vez: único na tabela, e o mesmo aparelho
-- trocando de conta passa a linha para a conta nova. Apagar o usuário apaga os
-- tokens. Aditiva: nenhuma tabela existente muda aqui.

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('android', 'ios');

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
