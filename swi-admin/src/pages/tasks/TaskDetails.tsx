// src/pages/tasks/TaskDetails.tsx
// /tasks/:id, detalhe da tarefa. Vive dentro do AppLayout.
//
// Seções (de cima pra baixo):
//   1. Voltar.
//   2. Cartão principal — chip de status + "Editar" | título | data de criação |
//      resumo | datas de início/conclusão | autor + setor | responsáveis.
//   3. "Detalhes da tarefa:" + parágrafo.
//   4. "Responsáveis" — cards de trabalhador + "Ver Todos".
//   5. "Progresso da tarefa" — ProgressBar.
//   6. "Check List" — cards com radio marcado só no item concluído.
//   7. "Imagens" — grade de fotos.
//
// DIVERGÊNCIAS CONHECIDAS EM RELAÇÃO AO DESENHO:
//   • Copy: o desenho diz "Detalhes do RELATÓRIO:" por resíduo das telas de
//     Relatórios, de onde o bloco foi copiado. Aqui vale "tarefa" — mesma
//     correção que o TaskForm já aplicou no placeholder equivalente.
//   • Campo de busca no topo ("Pesquisar na tarefa"): OMITIDO. Ver NOTA abaixo.
//   • "Ver Todos" dos responsáveis: expande in-place. Ver NOTA abaixo.
//
// NOTA: busca omitida. O desenho traz um SearchInput no cabeçalho (herdado do
// ReportDetails, que tem comentários e atividades pra varrer). Uma tarefa não
// tem corpo pesquisável — título, resumo e detalhes cabem na tela sem rolagem —
// e o backend não oferece busca dentro de uma work order. Um campo desabilitado
// anunciaria uma capacidade que nunca vai existir e ainda entraria na ordem de
// tabulação de quem usa teclado; um campo habilitado que não filtra nada é pior.
// Omitir é a única opção honesta. Reavaliar se o detalhe ganhar lista longa
// (comentários, histórico), aí a busca passa a ter o que buscar.
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Avatar,
  Button,
  Icon,
  Image,
  ProgressBar,
  Radio,
  StatusTag,
  Text,
  Title,
  useTheme,
  type StatusTagStatus,
} from '@kavicki/swi-design-system'
import { ApiError } from '@/services/api/http'
import {
  workOrdersApi,
  type AssignableWorker,
  type WorkOrderDetail,
  type WorkOrderItem,
  type WorkOrderStatus,
} from '@/services/api/workOrders'
import {
  formatElapsed,
  hasRunningItem,
  taskElapsedSeconds,
  taskTimeProgressPct,
} from '@/lib/taskProgress'
import { calcAge, isoToDisplayDate, minutesToDisplayTime } from './format'
import { BLOOD_TYPE_PLACEHOLDER } from './ResponsiblePicker'

// Rótulos do desenho. Tabela explícita (e não um `.replace('_',' ')`) porque
// 'Concluída' concorda em gênero com "tarefa" — nenhuma regra mecânica produz
// isso a partir de 'done'.
const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  pending: 'A fazer',
  in_progress: 'Em andamento',
  done: 'Concluída',
}

// Mapeia o status do backend pro status VISUAL do StatusTag do DS.
//
// Do desenho vem UM dado só: o chip de "Em andamento" é LARANJA, e laranja no DS
// é `StatusTag status="pending"` (surface.warning). O nome da variante do DS não
// bate com o nome do status do backend, daí a tabela: `in_progress` → 'pending'
// não é engano de digitação.
//
// Os outros dois o desenho NÃO traz; a escolha é semântica do próprio DS, não
// leitura de pixel: 'accept' (surface.success, verde) é a variante de concluído,
// e 'info' (surface.secondary, azul) é a neutra que sobra pro que ainda não
// começou. Se o design especificar cores pra esses dois, é aqui que muda.
const STATUS_TAG: Record<WorkOrderStatus, StatusTagStatus> = {
  pending: 'info',
  in_progress: 'pending',
  done: 'accept',
}

// Quantos cards de responsável a grade do desenho mostra por padrão (2 lado a
// lado). Acima disso entra o "Ver Todos".
const RESPONSIBLES_PREVIEW = 2

// Miniatura da grade de "Imagens".
//
// O `Image` do DS exige width/height NUMÉRICOS — não há prop percentual nem
// escala de tamanhos de imagem nos tokens (os tokens cobrem cor, espaçamento,
// tipografia, borda e elevação; dimensão de conteúdo não é categoria de token).
// Passar números aqui é a MESMA classe de coisa que `Icon size={24}` e
// `Avatar customSize={32}`, usados as-is em todo o admin — é argumento da API do
// componente, não valor de token contornado. A alternativa seria trocar o
// `Image` do DS por um `<Image>` cru do react-native com style percentual, o
// que é exatamente a reimplementação que a regra do DS proíbe. As medidas
// repetem as da grade de imagens do ReportDetails pra que as duas telas de
// detalhe tenham miniaturas do mesmo tamanho.
const IMAGE_WIDTH = 320
const IMAGE_HEIGHT = 180

// Texto de data vazia: o backend permite startDate/dueDate nulos. Dizer o que
// falta é mais honesto que exibir '--/--/----' ou sumir com a linha (o que
// desalinharia a dupla de datas lado a lado do desenho).
const NO_DATE = 'Não definida'

// Par rótulo-em-negrito + valor, repetido em todo o cartão principal.
function Field({
  label,
  value,
  valueTestID,
}: {
  label: string
  value: string
  valueTestID?: string
}) {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.gap.xs }}>
      <Text variant="body.s" weight="bold" color={theme.content.dark}>
        {label}
      </Text>
      <Text testID={valueTestID} variant="body.m" color={theme.content.dark}>
        {value}
      </Text>
    </View>
  )
}

function VerticalDivider() {
  const theme = useTheme()
  // alignSelf stretch em vez de altura fixa: o divisor acompanha o card sem
  // depender de um número mágico fora do sistema de tokens.
  return (
    <View
      style={{
        width: theme.border.size.m,
        alignSelf: 'stretch',
        backgroundColor: theme.content.lightGrey,
      }}
    />
  )
}

/**
 * Card de responsável da seção "Responsáveis".
 *
 * Composição de primitivas do DS (Avatar/Text/Icon), não reimplementação: é a
 * mesma anatomia do `WorkerPickRow` do ResponsiblePicker, sem o Checkbox — aqui
 * a lista é de leitura, não de seleção.
 *
 * O `WorkersInfoCard` do DS tem exatamente estes campos (name/age/bloodType/
 * role/secondaryRole/avatarUri), mas renderiza SEMPRE um Toggle e um chevron de
 * expandir, sem prop pra suprimi-los. Nesta tela isso seriam dois controles
 * mortos por responsável: pioram a fidelidade (o desenho não traz nenhum dos
 * dois) e a acessibilidade. GAP DE DS registrado no relatório da task: falta uma
 * variante estática/somente-leitura do WorkersInfoCard; quando ela existir, este
 * card sai daqui e vira uso direto do componente.
 */
function ResponsibleCard({ worker }: { worker: AssignableWorker }) {
  const theme = useTheme()
  const age = calcAge(worker.birthDate, new Date())
  // Nome sozinho não identifica a pessoa (o backend não impede dois homônimos);
  // o setor desempata — mesmo critério da TasksList e do ResponsiblePicker.
  const accessibleName = `${worker.name}, ${worker.sector}`
  return (
    <View
      testID={`responsible-card-${worker.id}`}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.gap.m,
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s, flex: 1 }}>
        <Avatar uri={worker.avatar || undefined} size="l" accessibilityLabel={accessibleName} />
        <View style={{ flex: 1, gap: theme.gap.xs }}>
          <Text variant="body.m" weight="bold" color={theme.content.dark}>
            {worker.name}
          </Text>
          {/* Sem birthDate não dá pra inventar idade: dizer o que falta é mais
              honesto que exibir "0 anos". Mesma escolha do ResponsiblePicker. */}
          <Text variant="body.m" color={theme.content.dark}>
            {age === null ? 'Idade não informada' : `${age} anos`}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}>
            {/* DECORATIVO: o backend não devolve tipo sanguíneo (dado de saúde
                só existe quando a smartband existir). Constante compartilhada
                com o ResponsiblePicker pra não divergir entre as duas telas. */}
            <Icon name="humidity_mid" size={20} color={theme.content.error} />
            <Text variant="body.m" weight="bold" color={theme.content.dark}>
              {BLOOD_TYPE_PLACEHOLDER}
            </Text>
          </View>
        </View>
      </View>

      <VerticalDivider />

      <View style={{ flex: 1, gap: theme.gap.xs }}>
        <Text variant="body.m" weight="bold" color={theme.content.dark}>
          {worker.jobTitle}
        </Text>
        {/* O desenho mostra a FORMAÇÃO aqui, campo que não existe no backend
            (AssignableWorker só tem id/name/jobTitle/sector/birthDate/avatar).
            O setor ocupa o lugar — mesma decisão já tomada no ResponsiblePicker. */}
        <Text variant="body.m" color={theme.content.dark}>
          {worker.sector}
        </Text>
      </View>
    </View>
  )
}

/**
 * Card de item do Check List.
 *
 * O Radio é INDICADOR DE ESTADO, não controle: o admin não conclui item por
 * aqui (quem avança o checklist é o app do trabalhador, pela rota de journey).
 * Por isso vai sem `onChange` — o Radio do DS trata a ausência como no-op.
 * Não usamos `disabled` de propósito: ele aplica opacity 0.5 e apagaria o
 * checklist inteiro na tela.
 */
function ChecklistCard({ item }: { item: WorkOrderItem }) {
  const theme = useTheme()
  // SÓ 'done' marca. O item tem 4 estados (pending/in_progress/paused/done) —
  // um `!== 'pending'` daria concluído pra quem só começou ou pausou.
  const isDone = item.status === 'done'
  return (
    <View
      style={{
        flex: 1,
        gap: theme.gap.s,
        padding: theme.padding.m,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.standard,
      }}
    >
      <Radio
        checked={isDone}
        label={item.title}
        accessibilityLabel={`${item.title}${isDone ? ', concluído' : ''}`}
        testID={`checklist-item-${item.id}`}
      />
      <Text variant="body.s" color={theme.content.medium}>
        {item.description}
      </Text>
    </View>
  )
}

export function TaskDetails() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Incrementado pelo "Tentar novamente": só um gatilho pro efeito refazer a
  // busca (o id não mudou, então ele sozinho não re-dispara).
  const [reloadKey, setReloadKey] = useState(0)
  const [showAllResponsibles, setShowAllResponsibles] = useState(false)

  // Tick de 1s enquanto houver item correndo: o progresso é POR TEMPO, então o
  // valor do fetch envelhece a cada segundo. Sem item em andamento não há o que
  // animar e o intervalo nem é criado.
  const [nowMs, setNowMs] = useState(() => Date.now())
  const running = hasRunningItem(detail?.items ?? [])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  const progressPct = detail ? taskTimeProgressPct(detail.items, detail.estimatedMinutes, nowMs) : 0
  const elapsedSec = detail ? taskElapsedSeconds(detail.items, nowMs) : 0

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    workOrdersApi
      .get(id)
      .then((data) => {
        if (cancelled) return
        setDetail(data)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // apiFetch garante ApiError em todo caminho de erro (inclusive o 404
        // 'Tarefa não encontrada'); o fallback cobre só um bug nosso.
        setError(e instanceof ApiError ? e.message : 'Erro ao carregar a tarefa')
        setDetail(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  // Memoizado junto do detalhe: `?? []` cria um array novo a cada render e
  // faria o useMemo de baixo recalcular sempre.
  const responsibles = useMemo(() => detail?.responsibles ?? [], [detail])
  const visibleResponsibles = useMemo(
    () => (showAllResponsibles ? responsibles : responsibles.slice(0, RESPONSIBLES_PREVIEW)),
    [responsibles, showAllResponsibles],
  )
  // "Ver Todos" só existe quando há o que revelar. Com todos já na tela o botão
  // seria um controle sem efeito: o desenho o traz porque o mockup tem mais
  // responsáveis que a grade comporta.
  //
  // Expande NA PRÓPRIA TELA em vez de abrir "a tela de todos os responsáveis":
  // essa tela não existe no desenho nem no roteador, e inventar uma rota nova pra
  // preencher a lacuna seria pior que a divergência.
  const canExpandResponsibles = responsibles.length > RESPONSIBLES_PREVIEW

  return (
    <View testID="task-details" style={{ gap: theme.gap.l }}>
      <View style={{ alignSelf: 'flex-start' }}>
        <Button
          label="Voltar"
          variant="ghost"
          onPress={() => navigate('/tasks')}
          iconLeft={
            <Icon name="keyboard_arrow_left" size={16} color={theme.content.primaryLight} />
          }
        />
      </View>

      {loading ? (
        <Text testID="task-details-loading" variant="body.m" color={theme.content.medium}>
          Carregando tarefa…
        </Text>
      ) : error ? (
        <View style={{ alignItems: 'flex-start', gap: theme.gap.s }}>
          <Text testID="task-details-error" variant="body.m" color={theme.content.error}>
            {error}
          </Text>
          <Button
            label="Tentar novamente"
            variant="outline"
            onPress={() => setReloadKey((k) => k + 1)}
          />
        </View>
      ) : detail ? (
        <>
          {/* Cartão principal. */}
          <View
            style={{
              backgroundColor: theme.surface.standard,
              borderRadius: theme.border.radius.l,
              padding: theme.padding.m,
              gap: theme.gap.m,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: theme.gap.m,
              }}
            >
              <StatusTag
                testID="task-details-status"
                status={STATUS_TAG[detail.status]}
                label={STATUS_LABEL[detail.status]}
              />
              <Button
                label="Editar"
                variant="outline"
                onPress={() => navigate(`/tasks/${detail.id}/edit`)}
                iconLeft={<Icon name="edit" size={20} color={theme.content.primaryLight} />}
              />
            </View>

            {/* Título verde à esquerda, data de criação à direita. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: theme.gap.m,
              }}
            >
              <View style={{ flex: 1 }}>
                <Title variant="title.s" color={theme.content.primary}>
                  {detail.title}
                </Title>
              </View>
              <Field
                label="Data de criação"
                value={isoToDisplayDate(detail.createdAt)}
                valueTestID="task-created-at"
              />
            </View>

            <Field label="Resumo" value={detail.summary} />

            {/* Datas lado a lado + tempo estimado. O tempo não está no desenho
                deste nó, mas o dado existe no DTO e o formulário o coleta —
                escondê-lo aqui obrigaria a abrir a edição pra consultá-lo. */}
            <View style={{ flexDirection: 'row', gap: theme.gap.l, flexWrap: 'wrap' }}>
              <Field
                label="Data de inicio da tarefa"
                value={isoToDisplayDate(detail.startDate) || NO_DATE}
                valueTestID="task-start-date"
              />
              <Field
                label="Data esperada pra conclusão"
                value={isoToDisplayDate(detail.dueDate) || NO_DATE}
                valueTestID="task-due-date"
              />
              <Field
                label="Tempo estimado"
                value={minutesToDisplayTime(detail.estimatedMinutes) || NO_DATE}
                valueTestID="task-estimated-time"
              />
            </View>

            {/* Autor à esquerda, setor em verde à direita. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: theme.gap.m,
              }}
            >
              <View style={{ gap: theme.gap.xs }}>
                <Text variant="body.s" weight="bold" color={theme.content.dark}>
                  Autor
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                  <Avatar
                    uri={detail.author.avatar || undefined}
                    customSize={32}
                    accessibilityLabel={detail.author.name}
                  />
                  <Text variant="body.m" color={theme.content.dark}>
                    {detail.author.name}
                  </Text>
                </View>
              </View>
              <Text variant="body.m" weight="bold" color={theme.content.primary}>
                {detail.sector}
              </Text>
            </View>

            {/* Responsáveis — nomes em linha, como resumo do cartão. */}
            <Field
              label="Responsáveis"
              value={
                responsibles.length === 0
                  ? 'Nenhum responsável atribuído.'
                  : responsibles.map((r) => r.name).join(', ')
              }
            />
          </View>

          {/* Detalhes da tarefa. */}
          <View style={{ gap: theme.gap.s }}>
            <Title variant="title.s" color={theme.content.primary}>
              Detalhes da tarefa:
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              {detail.details}
            </Text>
          </View>

          {/* Responsáveis — cards + "Ver Todos". */}
          {responsibles.length > 0 ? (
            <View style={{ gap: theme.gap.s }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: theme.gap.m,
                }}
              >
                <Title variant="title.s" color={theme.content.primary}>
                  Responsáveis
                </Title>
                {canExpandResponsibles ? (
                  <Button
                    label={showAllResponsibles ? 'Ver menos' : 'Ver Todos'}
                    variant="contained"
                    onPress={() => setShowAllResponsibles((v) => !v)}
                  />
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: theme.gap.m, flexWrap: 'wrap' }}>
                {visibleResponsibles.map((w) => (
                  <ResponsibleCard key={w.id} worker={w} />
                ))}
              </View>
            </View>
          ) : null}

          {/* Progresso. */}
          <View style={{ gap: theme.gap.s }}>
            <Title variant="title.s" color={theme.content.primary}>
              Progresso da tarefa
            </Title>
            {/* Mesmo visual da barra de fadiga do app (dashboard mobile):
                moldura pill de 22px com preenchimento gradiente verde→amarelo→
                vermelho da direita pra esquerda. Lá ela mede fadiga; aqui só o
                visual foi reaproveitado — o que ela mede é o TEMPO decorrido
                sobre o estimado. No modo liso do DS o trilho vazio é claro e
                lia como barra cheia mesmo a 0% (QA 2026-07-26). */}
            <ProgressBar
              testID="task-details-progress"
              value={progressPct}
              gradient={[theme.surface.success, theme.surface.warning, theme.surface.error]}
              gradientStops={[43.75, 79.253, 100]}
              gradientDirection="rtl"
              bordered
              accessibilityLabel={`Progresso da tarefa: ${progressPct}%`}
            />
            {/* Mesma anatomia do bloco de fadiga do app: barra + leitura em
                texto logo abaixo. A barra sozinha responde "quanto falta" de
                forma vaga; o número diz quanto tempo a pessoa realmente gastou
                — e com estimativa cadastrada, contra o que se esperava. */}
            <Text testID="task-details-elapsed" variant="body.m" color={theme.content.dark}>
              {detail.estimatedMinutes
                ? `Tempo decorrido: ${formatElapsed(elapsedSec)} de ${formatElapsed(detail.estimatedMinutes * 60)}`
                : `Tempo decorrido: ${formatElapsed(elapsedSec)} (sem estimativa cadastrada)`}
            </Text>
          </View>

          {/* Check List. */}
          {detail.items.length > 0 ? (
            <View style={{ gap: theme.gap.s }}>
              <Title variant="title.s" color={theme.content.primary}>
                Check List
              </Title>
              <View style={{ flexDirection: 'row', gap: theme.gap.m, flexWrap: 'wrap' }}>
                {detail.items.map((item) => (
                  <ChecklistCard key={item.id} item={item} />
                ))}
              </View>
            </View>
          ) : null}

          {/* Imagens — URLs assinadas, validade de ~1 h. Uma tela aberta por
              muito tempo passa a mostrar quadros quebrados; recarregar refaz o
              GET e traz assinaturas novas. */}
          {detail.images.length > 0 ? (
            <View style={{ gap: theme.gap.s }}>
              <Title variant="title.s" color={theme.content.primary}>
                Imagens
              </Title>
              <View style={{ flexDirection: 'row', gap: theme.gap.m, flexWrap: 'wrap' }}>
                {detail.images.map((uri, index) => (
                  <Image
                    key={uri}
                    testID={`task-image-${index}`}
                    source={uri}
                    width={IMAGE_WIDTH}
                    height={IMAGE_HEIGHT}
                    resizeMode="cover"
                    accessibilityLabel={`Imagem ${index + 1} da tarefa ${detail.title}`}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  )
}
