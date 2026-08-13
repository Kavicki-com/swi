import { expect, test, type Page } from '@playwright/test'
import { entrarNoPainel, WORKER_NOME } from './session'

// Tarefas e chat contra backend e banco de TESTE reais.
//
// São os dois fluxos em que o painel ESCREVE, e escrever é onde os testes de
// componente têm menos a dizer: eles provam o formulário e a lista contra um
// backend simulado, e nunca atravessam o DTO, a validação do servidor e a
// releitura do que foi gravado. O que cada teste aqui afirma é sempre uma
// releitura, não o eco otimista da tela.
//
// Os dados são gerados com timestamp para as suítes não brigarem entre si nem
// com uma execução anterior, e o alvo é sempre o trabalhador do seed.

const comCarimbo = (prefixo: string) => `${prefixo} ${Date.now()}`

/**
 * Cria uma tarefa pelo formulário e devolve o título usado.
 *
 * Título e ao menos um responsável são os únicos campos exigidos (ver
 * `handleSave` em src/pages/tasks/hooks/useTaskForm.ts): datas vazias viram
 * `null` no payload, e o resto é opcional.
 */
const criarTarefa = async (page: Page): Promise<string> => {
  const titulo = comCarimbo('Tarefa E2E')

  await page.goto('/tasks')
  await page.getByRole('button', { name: 'Nova Tarefa' }).click()
  await expect(page).toHaveURL(/\/tasks\/new/)

  await page.getByLabel('Título da tarefa').fill(titulo)
  await page.getByRole('button', { name: 'Atribuir responsáveis' }).click()
  // O item do picker é um Checkbox, não um botão, e o nome acessível qualifica
  // a pessoa com o setor (`Selecionar <nome>, <setor>`) porque dois homônimos
  // seriam indistinguíveis pro leitor de tela. Casar pelo prefixo mantém o
  // teste preso à pessoa, e não ao setor que ela ocupa hoje.
  await page.getByLabel(`Selecionar ${WORKER_NOME}`).click()
  await page.getByRole('button', { name: 'Confirmar responsáveis' }).click()
  await page.getByRole('button', { name: 'Salvar tarefa' }).click()

  // A URL do detalhe carrega o id que o BACKEND devolveu: sair de /tasks/new é
  // a prova de que a gravação aconteceu, e não de que a tela achou que sim.
  await expect(page).toHaveURL(/\/tasks\/[0-9a-fA-F-]{36}$/, { timeout: 30_000 })
  return titulo
}

test('cria uma tarefa com responsável e ela aparece na lista', async ({ page }) => {
  await entrarNoPainel(page)
  const titulo = await criarTarefa(page)

  // A lista é uma leitura NOVA do servidor, em outra rota: se a tarefa só
  // existisse no estado da tela do formulário, ela não estaria aqui.
  //
  // A aba importa e é parte do que se está afirmando: a lista abre em "Em
  // Andamento" e toda tarefa nasce `pending` no backend, então ela tem que
  // aparecer em "A Fazer". Procurar na aba padrão passaria a impressão de que
  // a tarefa sumiu.
  await page.goto('/tasks')
  await page.getByRole('tab', { name: 'A Fazer' }).click()
  await expect(page.getByText(titulo).first()).toBeVisible({ timeout: 30_000 })
})

test('o formulário recusa tarefa sem responsável, antes de gastar o servidor', async ({ page }) => {
  await entrarNoPainel(page)

  await page.goto('/tasks/new')
  await page.getByLabel('Título da tarefa').fill(comCarimbo('Tarefa sem responsável'))
  await page.getByRole('button', { name: 'Salvar tarefa' }).click()

  // O backend também rejeita, mas a mensagem sairia em inglês do
  // class-validator. Continuar em /tasks/new é a outra metade da prova: nada
  // foi criado.
  await expect(page.getByRole('alert')).toContainText('responsável')
  await expect(page).toHaveURL(/\/tasks\/new/)
})

test('edita o título da tarefa e a mudança sobrevive ao refresh', async ({ page }) => {
  await entrarNoPainel(page)
  const titulo = await criarTarefa(page)

  await page.getByRole('button', { name: 'Editar' }).click()
  await expect(page).toHaveURL(/\/tasks\/[0-9a-fA-F-]{36}\/edit$/)

  // Esperar o campo chegar preenchido não é zelo: o formulário de edição busca
  // a tarefa e chama `setTitle` quando a resposta volta, então digitar antes
  // disso faz a carga sobrescrever o que foi digitado, e o save grava o título
  // ANTIGO. O teste ficava vermelho de forma intermitente, no refresh, longe da
  // causa. De quebra, isto afirma que o formulário abre pré-preenchido.
  const campoTitulo = page.getByLabel('Título da tarefa')
  await expect(campoTitulo).toHaveValue(titulo, { timeout: 30_000 })

  const novoTitulo = comCarimbo('Tarefa E2E editada')
  await campoTitulo.fill(novoTitulo)
  await page.getByRole('button', { name: 'Salvar tarefa' }).click()

  await expect(page).toHaveURL(/\/tasks\/[0-9a-fA-F-]{36}$/, { timeout: 30_000 })

  // O refresh é o que separa "a tela atualizou" de "o servidor gravou": depois
  // dele, tudo que aparece veio de uma requisição nova.
  await page.reload()
  await expect(page.getByText(novoTitulo).first()).toBeVisible({ timeout: 30_000 })
})

test('envia uma mensagem no chat e o servidor a aceita', async ({ page }) => {
  await entrarNoPainel(page)

  await page.goto('/chat')
  // Banco de teste começa sem conversa nenhuma, então o caminho é o diretório
  // de contatos, não a lista de conversas.
  await page.getByRole('button', { name: 'Novo chat' }).click()
  await page.getByRole('button', { name: `Conversar com ${WORKER_NOME}` }).click()
  await expect(page).toHaveURL(/\/chat\/.+/)

  const texto = comCarimbo('Mensagem E2E')
  await page.getByPlaceholder('Digite aqui sua mensagem').fill(texto)

  // O 201 é o que separa "a tela mostrou" de "o servidor gravou": a bolha
  // aparece por eco otimista, e sozinha ela não prova nada sobre o banco.
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/chat/conversations/') &&
        r.url().endsWith('/messages') &&
        r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    page.getByRole('button', { name: 'Enviar mensagem' }).click(),
  ])

  expect(resposta.status()).toBe(201)
  await expect(page.getByText(texto)).toBeVisible({ timeout: 30_000 })

  // A releitura depois de um F5 NÃO é afirmada aqui, e a ausência é
  // deliberada: `openConversation` (src/services/chat/ChatProvider.tsx)
  // desiste quando a conversa ainda não está em `conversationsRef`, e num
  // carregamento frio de /chat/<id> o efeito de seleção roda antes de o GET
  // /chat/conversations responder. Às vezes a thread se recupera, às vezes
  // fica vazia, e asserção instável num portão de entrega é pior que asserção
  // estreita. O defeito está registrado na nota de execução da Task 14 do
  // plano; quando for corrigido, o refresh vira uma afirmação legítima aqui.
})
