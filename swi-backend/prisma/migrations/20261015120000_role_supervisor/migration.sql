-- Terceiro nível de acesso: Supervisor (monitora e opera, não gerencia usuários
-- nem configurações). Aditiva: nenhum usuário existente muda de papel.
--
-- Só acrescenta o valor. O Postgres não deixa usar um valor de enum na mesma
-- transação em que ele foi criado, então qualquer UPDATE para SUPERVISOR fica
-- fora desta migration.
ALTER TYPE "Role" ADD VALUE 'SUPERVISOR';
