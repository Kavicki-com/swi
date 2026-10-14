-- Player embutido (iframe) da câmera: endereço https de domínio liberado pela
-- allowlist do servidor, guardado à parte do endereço da página. Opcional e
-- nulo nas câmeras já cadastradas; só o administrador recebe o valor.
ALTER TABLE "Camera"
  ADD COLUMN "embedUrl" TEXT;
