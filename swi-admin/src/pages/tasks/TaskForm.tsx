// src/pages/tasks/TaskForm.tsx
// /tasks/new e /tasks/:id/edit — Figma 1611-9071 ("Nova tarefa"). O MESMO
// componente serve as duas rotas: a de edição não existe no Figma, é reuso
// deste form pré-preenchido (decisão do usuário).
//
// Copy: o Figma herdou "relatório" das telas de Relatórios em dois lugares (o
// CTA de salvar e o placeholder dos detalhes) e traz um label solto
// "description" que é lixo de layout. Aqui vale "tarefa", conforme decidido.
//
// As armadilhas do contrato (items com/sem id, items:[] vs chave omitida,
// upload no submit) estão comentadas ponto a ponto junto do código que as trata
// — ver também os tipos em services/api/workOrders. A conversão de data e de
// duração (calendário vs ISO, hh:mm vs minutos) mora em ./format, junto dos
// testes que a cobrem nos cantos.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Modal, View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button,
  Combobox,
  Icon,
  ImageUploader,
  Input,
  Text,
  Title,
  Toggle,
  useTheme,
} from '@kavicki/swi-design-system'
import { ApiError } from '@/services/api/http'
import { profileApi } from '@/services/api/profile'
import { uploadOrderImage } from '@/services/api/upload'
import {
  workOrdersApi,
  type WorkOrderDetail,
  type WorkOrderInput,
  type WorkOrderItemInput,
} from '@/services/api/workOrders'
import { ResponsiblePicker } from './ResponsiblePicker'
import {
  displayDateToCalendar,
  displayTimeToMinutes,
  isoToDisplayDate,
  minutesToDisplayTime,
} from './format'

// FALLBACK. A fonte primária virou o catálogo real da org (GET
// /profile/catalog — DISTINCT dos setores gravados); esta lista só segura a
// UX de uma org SEM cadastro nenhum, onde o DISTINCT volta vazio e um
// Combobox sem opções impediria de criar a primeira tarefa. `value` igual ao
// `label` de propósito: o que for gravado é exatamente o texto que a
// TasksList exibe na coluna de setor.
const SECTOR_FALLBACK_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Setor Leste', value: 'Setor Leste' },
  { label: 'Setor Norte', value: 'Setor Norte' },
  { label: 'Setor Sul', value: 'Setor Sul' },
  { label: 'Setor Oeste', value: 'Setor Oeste' },
  { label: 'Setor Centro', value: 'Setor Centro' },
]

// Quantos quadros de anexo o Figma desenha na fileira. É layout, NÃO limite —
// quem limita quantos anexos cabem numa tarefa é LIMITS.imageKeys.
const ATTACHMENT_SLOTS = 4

// Espelho dos limites do CreateWorkOrderDto/UpdateWorkOrderDto
// (swi-backend/src/work-orders/dto.ts). Validar aqui é o que mantém o painel em
// pt-BR: estourado, o class-validator responde 400 com a mensagem em inglês
// ('title must be shorter than or equal to 200 characters') e o form a exibia
// crua dentro do role="alert". Manter em sincronia com o DTO.
const LIMITS = {
  title: 200,
  summary: 1000,
  details: 8000,
  sector: 120,
  responsibleIds: 50,
  items: 50,
  itemTitle: 200,
  itemDescription: 1000,
  imageKeys: 20,
} as const

// Linha do checklist em edição. `id` só existe em item que veio do backend —
// a chave AUSENTE (e não '') é o que faz o PATCH criar em vez de atualizar.
type ChecklistDraft = { key: string; id?: string; title: string; description: string }

let draftSeq = 0
function emptyDraft(): ChecklistDraft {
  draftSeq += 1
  return { key: `draft_${draftSeq}`, title: '', description: '' }
}

function toItemInput(draft: ChecklistDraft): WorkOrderItemInput {
  const base = { title: draft.title.trim(), description: draft.description.trim() }
  // Espalhar condicionalmente: `{ id: draft.id ?? '' }` mandaria id vazio e o
  // backend trataria como item NOVO, duplicando o checklist a cada save.
  return draft.id ? { id: draft.id, ...base } : base
}

// Quadro vazio da fileira de anexos (Figma 105:12461). `onRemove` (com o
// respectivo label acessível) põe o botão de remoção — mesmo padrão ghost +
// delete_icon dos cards do checklist.
function AttachmentSlot({
  label,
  onRemove,
  removeLabel,
}: {
  label?: string
  onRemove?: () => void
  removeLabel?: string
}) {
  const theme = useTheme()
  return (
    <View
      style={{
        flex: 1,
        aspectRatio: 5 / 4,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.high,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.s,
        gap: theme.gap.xs,
      }}
    >
      <Icon name="add_a_photo" size={32} color={theme.content.medium} />
      {label ? (
        <Text variant="body.s" color={theme.content.medium} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {onRemove ? (
        <Button
          variant="ghost"
          onPress={onRemove}
          iconLeft={<Icon name="delete_icon" size={20} color={theme.content.error} />}
          accessibilityLabel={removeLabel ?? 'Remover anexo'}
        />
      ) : null}
    </View>
  )
}

export function TaskForm() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const [sector, setSector] = useState('')
  const [estimatedTime, setEstimatedTime] = useState('')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [responsibleIds, setResponsibleIds] = useState<ReadonlyArray<string>>([])
  const [checklistOn, setChecklistOn] = useState(false)
  // Editando uma tarefa que JÁ TEM itens, "desligar o Check List" é uma ação
  // que o contrato não sabe executar: o backend rejeita items: [] com 400 ('a
  // tarefa precisa de pelo menos 1 item') e a chave omitida deixa o checklist
  // intocado. Antes o toggle sumia com a seção, o usuário salvava e o Check
  // List reaparecia intacto no detalhe. Agora o toggle fica travado e um texto
  // diz o porquê — itens se removem um a um, pelo botão que já existe no card.
  //
  // Travado (disabled) e não escondido: a seção "Adicionais" mantém o mesmo
  // desenho do Figma nas duas rotas, e um controle que some não deixa onde
  // pendurar a explicação — o usuário procuraria o toggle em vez de entender.
  const [checklistLocked, setChecklistLocked] = useState(false)
  const [drafts, setDrafts] = useState<ReadonlyArray<ChecklistDraft>>([emptyDraft()])
  const [files, setFiles] = useState<ReadonlyArray<File>>([])
  // Anexos já gravados: key crua (o que o PATCH aceita) + URL assinada (preview).
  // `removedExisting` marca a fileira como suja — sem mudança, o PATCH omite
  // imageKeys e não reescreve o array à toa.
  const [existingAttachments, setExistingAttachments] = useState<
    ReadonlyArray<{ key: string; url: string }>
  >([])
  const [removedExisting, setRemovedExisting] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Contador de aberturas: serve de `key` do picker. O overlay lê `selectedIds`
  // só na MONTAGEM (ver o JSDoc dele), então reaproveitar a instância entre
  // aberturas pré-marcaria a seleção da abertura anterior, sem erro nenhum.
  const [pickerOpenings, setPickerOpenings] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // `true` depois que a tela sai da árvore. Um save pode estar em voo quando o
  // usuário desiste e clica Cancelar/Voltar: sem esta guarda, o `navigate` do
  // sucesso o arrastaria de volta pra tela que ele acabou de abandonar.
  //
  // Guarda em vez de desabilitar Cancelar/Voltar enquanto salva: numa rede de
  // chão de fábrica a request pode ficar pendurada por muito tempo, e prender o
  // usuário na tela até ela responder é pior que perder a navegação. Cobre
  // também a saída pelo botão "voltar" do browser, que desabilitar não pegaria.
  const leftScreenRef = useRef(false)
  useEffect(() => {
    leftScreenRef.current = false
    return () => {
      leftScreenRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const detail: WorkOrderDetail = await workOrdersApi.get(id)
        if (cancelled) return
        setTitle(detail.title)
        setSummary(detail.summary)
        setDetails(detail.details)
        setSector(detail.sector)
        setEstimatedTime(minutesToDisplayTime(detail.estimatedMinutes))
        setStartDate(isoToDisplayDate(detail.startDate))
        setDueDate(isoToDisplayDate(detail.dueDate))
        setResponsibleIds(detail.responsibles.map((r) => r.id))
        // Par posicional: images[i] é a URL assinada de imageKeys[i].
        setExistingAttachments(
          detail.imageKeys.map((key, i) => ({ key, url: detail.images[i] ?? '' })),
        )
        // O backend garante ≥1 item (cria um espelhando título+resumo quando a
        // tarefa nasce sem checklist), então toda tarefa carregada tem lista.
        // Os ids vêm junto — é o que faz o PATCH ATUALIZAR os itens existentes.
        setDrafts(
          detail.items.length > 0
            ? detail.items.map((item) => ({
                key: item.id,
                id: item.id,
                title: item.title,
                description: item.description,
              }))
            : [emptyDraft()],
        )
        setChecklistOn(detail.items.length > 0)
        setChecklistLocked(detail.items.length > 0)
        setLoading(false)
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof ApiError ? e.message : 'Erro ao carregar a tarefa')
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  // Setores REAIS da org (DISTINCT do backend). null enquanto carrega.
  const [catalogSectors, setCatalogSectors] = useState<string[] | null>(null)
  useEffect(() => {
    let cancelled = false
    profileApi.catalog().then(({ data }) => {
      if (!cancelled && data) setCatalogSectors(data.sectors)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Catálogo quando existe; fallback só pra org sem cadastro nenhum. Um setor
  // gravado fora da lista (string livre no backend) sumiria do Combobox e o
  // save seguinte o apagaria — injetar a opção preserva o dado.
  const sectorOptions = useMemo(() => {
    const base =
      catalogSectors && catalogSectors.length > 0
        ? catalogSectors.map((s) => ({ label: s, value: s }))
        : SECTOR_FALLBACK_OPTIONS.map((o) => ({ ...o }))
    if (sector && !base.some((o) => o.value === sector)) {
      base.unshift({ label: sector, value: sector })
    }
    return base
  }, [catalogSectors, sector])

  const updateDraft = (key: string, patch: Partial<ChecklistDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }

  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    // Zerar o input permite escolher o MESMO arquivo de novo depois de removê-lo
    // (o change não dispara quando o value não muda).
    event.target.value = ''
    if (picked.length === 0) return
    // Teto na SELEÇÃO, antes de qualquer upload. Sem ele, escolher 25 arquivos
    // num diálogo fazia os 25 subirem sequencialmente pro S3 no submit e só
    // então o backend rejeitava imageKeys > 20 — os 25 já estavam no bucket,
    // órfãos, sem tarefa nenhuma referenciando as keys. E ao contrário da falha
    // de rede (rara), este caminho é trivial de alcançar.
    if (existingAttachments.length + files.length + picked.length > LIMITS.imageKeys) {
      setError(`Anexe no máximo ${LIMITS.imageKeys} arquivos por tarefa.`)
      return
    }
    setError(null)
    setFiles((prev) => [...prev, ...picked])
  }

  const handleSave = async () => {
    if (saving) return
    setError(null)

    if (!title.trim()) {
      setError('Informe o título da tarefa.')
      return
    }
    // O backend responde 400 pra responsibleIds vazio; barrar aqui evita gastar
    // o round-trip. O picker também não deixa confirmar sem ninguém marcado.
    if (responsibleIds.length === 0) {
      setError('Atribua ao menos 1 responsável à tarefa.')
      return
    }

    // Limites de tamanho do DTO. Barrados aqui pra que a mensagem saia em pt —
    // o class-validator responde em inglês e o texto ia cru pro role="alert".
    const tooLong = (
      [
        [
          title.trim().length > LIMITS.title,
          `O título da tarefa deve ter no máximo ${LIMITS.title} caracteres.`,
        ],
        [
          summary.trim().length > LIMITS.summary,
          `O resumo da tarefa deve ter no máximo ${LIMITS.summary} caracteres.`,
        ],
        [
          details.trim().length > LIMITS.details,
          `Os detalhes da tarefa devem ter no máximo ${LIMITS.details} caracteres.`,
        ],
        [sector.length > LIMITS.sector, `O setor deve ter no máximo ${LIMITS.sector} caracteres.`],
        [
          responsibleIds.length > LIMITS.responsibleIds,
          `Atribua no máximo ${LIMITS.responsibleIds} responsáveis à tarefa.`,
        ],
      ] as ReadonlyArray<readonly [boolean, string]>
    ).find(([exceeded]) => exceeded)?.[1]
    if (tooLong) {
      setError(tooLong)
      return
    }

    const start = displayDateToCalendar(startDate)
    const due = displayDateToCalendar(dueDate)
    if (start === undefined || due === undefined) {
      setError('Informe datas válidas no formato dd/mm/aaaa.')
      return
    }
    const estimatedMinutes = displayTimeToMinutes(estimatedTime)
    if (estimatedMinutes === undefined) {
      setError('Use o formato hh:mm no tempo estimado.')
      return
    }

    const items = drafts.filter((d) => d.title.trim()).map(toItemInput)
    if (checklistOn && items.length === 0) {
      // items: [] é rejeitado pelo backend ('a tarefa precisa de pelo menos 1
      // item'); com o toggle ligado e nada preenchido, o erro é do usuário.
      setError('Preencha ao menos 1 item do Check List ou desligue o Check List.')
      return
    }
    // Limites do checklist: ArrayMaxSize(50) na lista e MaxLength nos campos do
    // WorkOrderItemDto. Mesma razão dos de cima — mensagem em pt em vez do 400.
    const itemError = (
      [
        [items.length > LIMITS.items, `O Check List deve ter no máximo ${LIMITS.items} itens.`],
        [
          items.some((i) => i.title.length > LIMITS.itemTitle),
          `O título de cada item do Check List deve ter no máximo ${LIMITS.itemTitle} caracteres.`,
        ],
        [
          items.some((i) => (i.description ?? '').length > LIMITS.itemDescription),
          `O texto curto de cada item do Check List deve ter no máximo ${LIMITS.itemDescription} caracteres.`,
        ],
      ] as ReadonlyArray<readonly [boolean, string]>
    ).find(([exceeded]) => exceeded)?.[1]
    if (itemError) {
      setError(itemError)
      return
    }

    setSaving(true)
    // Upload SÓ AGORA: o presign vale 300 s. Subir na hora em que o arquivo é
    // escolhido faria um formulário preenchido devagar falhar com 403.
    const imageKeys: string[] = []
    try {
      for (const file of files) {
        imageKeys.push(await uploadOrderImage(file))
      }
    } catch (e: unknown) {
      if (leftScreenRef.current) return
      setError(e instanceof Error ? e.message : 'Não foi possível enviar o arquivo.')
      setSaving(false)
      // Sem create/update: uma tarefa criada com anexo faltando seria pior que
      // nenhuma tarefa — o usuário reenviaria e duplicaria.
      //
      // O outro lado do trade-off: os anexos que subiram ANTES da falha ficam
      // órfãos no bucket, sem tarefa nenhuma referenciando as keys. Não há
      // rollback possível daqui — o backend não expõe delete de mídia — e
      // deixar o órfão é preferível a criar a tarefa com anexo faltando. A
      // limpeza é responsabilidade da infra (lifecycle rule no bucket).
      return
    }

    // O usuário pode ter saído enquanto os anexos subiam.
    if (leftScreenRef.current) return

    const payload: WorkOrderInput = {
      title: title.trim(),
      responsibleIds: [...responsibleIds],
    }
    if (summary.trim()) payload.summary = summary.trim()
    if (details.trim()) payload.details = details.trim()
    if (sector) payload.sector = sector
    if (estimatedMinutes !== null) payload.estimatedMinutes = estimatedMinutes
    if (start !== null) payload.startDate = start
    if (due !== null) payload.dueDate = due
    // Com o toggle DESLIGADO a chave `items` não entra: omitida, o backend cria
    // sozinho 1 item espelhando título+resumo (no POST) ou deixa o checklist
    // intocado (no PATCH). Mandar [] em qualquer um dos dois dá 400.
    if (checklistOn) payload.items = items
    // O PATCH SUBSTITUI o array inteiro, então na edição o payload leva as keys
    // existentes remanescentes + as novas — e SÓ quando a fileira mudou (anexo
    // novo ou remoção); intocada, a chave é omitida e o backend não mexe.
    if (isEdit) {
      if (imageKeys.length > 0 || removedExisting) {
        payload.imageKeys = [...existingAttachments.map((a) => a.key), ...imageKeys]
      }
    } else if (imageKeys.length > 0) {
      payload.imageKeys = imageKeys
    }

    try {
      const saved = id
        ? await workOrdersApi.update(id, payload)
        : await workOrdersApi.create(payload)
      // A tarefa FOI salva; só a navegação é que não se impõe a quem já saiu.
      if (leftScreenRef.current) return
      // Navega pro id que o BACKEND devolveu (create/update retornam o detalhe
      // recarregado, não o eco do payload).
      navigate(`/tasks/${saved.id}`)
    } catch (e: unknown) {
      if (leftScreenRef.current) return
      // Erro do backend não limpa nada: o formulário inteiro continua como está.
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar a tarefa.')
      setSaving(false)
    }
  }

  const responsiblesLabel =
    responsibleIds.length === 0
      ? 'Nenhum responsável atribuído.'
      : responsibleIds.length === 1
        ? '1 responsável atribuído.'
        : `${responsibleIds.length} responsáveis atribuídos.`

  const emptySlots = Math.max(0, ATTACHMENT_SLOTS - files.length - existingAttachments.length)

  return (
    <View testID="task-form" style={{ gap: theme.gap.l }}>
      <View style={{ alignSelf: 'flex-start' }}>
        <Button
          label="Voltar"
          variant="ghost"
          onPress={() => navigate(isEdit && id ? `/tasks/${id}` : '/tasks')}
          iconLeft={
            <Icon name="keyboard_arrow_left" size={16} color={theme.content.primaryLight} />
          }
        />
      </View>

      {/* Cabeçalho: título à esquerda, CTA verde "Atribuir responsáveis" à direita. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.gap.m,
        }}
      >
        <Title variant="title.s" color={theme.content.primary}>
          {isEdit ? 'Editar tarefa' : 'Nova tarefa'}
        </Title>
        <Button
          label="Atribuir responsáveis"
          variant="contained"
          iconRight={<Icon name="add_circle" size={24} color={theme.content.light} />}
          onPress={() => {
            setPickerOpenings((n) => n + 1)
            setPickerOpen(true)
          }}
          accessibilityLabel="Atribuir responsáveis"
        />
      </View>

      <Text testID="task-responsibles-summary" variant="body.m" color={theme.content.medium}>
        {responsiblesLabel}
      </Text>

      {/* role="alert" pra que a mensagem seja ANUNCIADA quando aparece: sem
          ela, quem usa leitor de tela clica Salvar e não recebe retorno nenhum
          — o texto surge fora do foco e passa despercebido. */}
      {error ? (
        <Text
          testID="task-form-error"
          accessibilityRole="alert"
          variant="body.m"
          color={theme.content.error}
        >
          {error}
        </Text>
      ) : null}

      {loading ? (
        <Text testID="task-form-loading" variant="body.m" color={theme.content.medium}>
          Carregando tarefa…
        </Text>
      ) : null}

      {/* Fileira de 4 campos curtos. */}
      <View style={{ flexDirection: 'row', gap: theme.gap.m, flexWrap: 'wrap' }}>
        <View style={{ flex: 1 }}>
          <Combobox
            label="Setor"
            placeholder="Selecione o setor"
            options={sectorOptions}
            value={sector}
            onChange={setSector}
            testID="task-sector"
            accessibilityLabel="Setor"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Tempo estimado"
            testID="task-estimated-time"
            value={estimatedTime}
            onChangeText={setEstimatedTime}
            placeholder="h 00:00"
            accessibilityLabel="Tempo estimado"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Data de início"
            testID="task-start-date"
            value={startDate}
            onChangeText={setStartDate}
            placeholder="00/00/0000"
            accessibilityLabel="Data de início"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Data de conclusão"
            testID="task-due-date"
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="00/00/0000"
            accessibilityLabel="Data de conclusão"
          />
        </View>
      </View>

      {/* Campos longos empilhados. O `label` do Input do DS é visual puro (não
          associa nem serve de fallback), então todo campo repete o texto em
          accessibilityLabel — sem isso não há nome acessível nenhum. */}
      <View style={{ gap: theme.gap.m }}>
        <Input
          label="Título da tarefa"
          testID="task-title"
          value={title}
          onChangeText={setTitle}
          placeholder="Digite aqui o título da tarefa"
          accessibilityLabel="Título da tarefa"
        />
        <Input
          label="Resumo da tarefa"
          testID="task-summary"
          value={summary}
          onChangeText={setSummary}
          placeholder="Digite aqui um resumo da sua tarefa"
          accessibilityLabel="Resumo da tarefa"
        />
        <Input
          label="Detalhes da tarefa"
          testID="task-details-field"
          value={details}
          onChangeText={setDetails}
          accessibilityLabel="Detalhes da tarefa"
          // Copy corrigida: o Figma diz "seu relatório" por resíduo das telas de
          // Relatórios, de onde este bloco foi copiado.
          placeholder="Digite aqui os detalhes da tarefa"
          multiline
          numberOfLines={12}
        />
      </View>

      {/* Adicionais — o toggle que revela o Check List. */}
      <View style={{ gap: theme.gap.m }}>
        <Title variant="title.xs" color={theme.content.primary}>
          Adicionais
        </Title>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Toggle
            value={checklistOn}
            onChange={setChecklistOn}
            disabled={checklistLocked}
            accessibilityLabel="Check List"
            testID="task-checklist-toggle"
          />
          <Text variant="body.m" color={theme.content.dark}>
            Check List
          </Text>
        </View>
        {checklistLocked ? (
          <Text testID="checklist-locked-hint" variant="body.s" color={theme.content.medium}>
            Toda tarefa tem ao menos 1 item. Para tirar um item do Check List, use o botão de
            remover no próprio item.
          </Text>
        ) : null}
      </View>

      {checklistOn ? (
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.primary}>
            Check List
          </Title>
          <View style={{ flexDirection: 'row', gap: theme.gap.m, flexWrap: 'wrap' }}>
            {drafts.map((draft, index) => (
              <View
                key={draft.key}
                style={{
                  flex: 1,
                  gap: theme.gap.s,
                  padding: theme.padding.m,
                  borderRadius: theme.border.radius.m,
                  backgroundColor: theme.surface.standard,
                }}
              >
                <Input
                  label="Título"
                  testID={`checklist-title-${index}`}
                  value={draft.title}
                  onChangeText={(next) => updateDraft(draft.key, { title: next })}
                  placeholder="Título do item"
                  accessibilityLabel={`Título do item ${index + 1} do Check List`}
                />
                <Input
                  label="Texto curto"
                  testID={`checklist-description-${index}`}
                  value={draft.description}
                  onChangeText={(next) => updateDraft(draft.key, { description: next })}
                  placeholder="Texto curto"
                  accessibilityLabel={`Texto curto do item ${index + 1} do Check List`}
                />
                {/* Sem remover, um card só dava pra esvaziar — o submit filtra
                    título vazio, mas o card ficava na tela pra sempre. Em item
                    vindo do backend isto é mais que cosmético: ausente da lista
                    do PATCH é a ÚNICA forma de apagar o item (reconciliação). */}
                <View style={{ alignSelf: 'flex-end' }}>
                  <Button
                    variant="ghost"
                    onPress={() => setDrafts((prev) => prev.filter((d) => d.key !== draft.key))}
                    iconLeft={<Icon name="delete_icon" size={20} color={theme.content.error} />}
                    accessibilityLabel={`Remover item ${index + 1} do Check List`}
                  />
                </View>
              </View>
            ))}
            <View style={{ justifyContent: 'center' }}>
              <Button
                variant="outline"
                shape="pill"
                size="large"
                onPress={() => setDrafts((prev) => [...prev, emptyDraft()])}
                iconLeft={<Icon name="add_circle" size={24} color={theme.content.primary} />}
                accessibilityLabel="Adicionar item ao checklist"
              />
            </View>
          </View>
        </View>
      ) : null}

      {/* Anexos — 4 quadros + área de envio. */}
      <View style={{ gap: theme.gap.m }}>
        <Title variant="title.xs" color={theme.content.primary}>
          Anexos
        </Title>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'stretch',
            gap: theme.gap.m,
            flexWrap: 'wrap',
          }}
        >
          {/* Anexos já gravados: quadro rotulado + remoção. O DS `Image` exige
              width/height numéricos (fora do sistema de tokens), então o
              preview real segue de fora — a key é o que o PATCH precisa. */}
          {existingAttachments.map((att, index) => (
            <AttachmentSlot
              key={att.key}
              label={`Anexo ${index + 1}`}
              removeLabel={`Remover anexo ${index + 1}`}
              onRemove={() => {
                setRemovedExisting(true)
                setExistingAttachments((prev) => prev.filter((a) => a.key !== att.key))
              }}
            />
          ))}
          {files.map((file, index) => (
            <AttachmentSlot
              key={`${file.name}_${index}`}
              label={file.name}
              removeLabel={`Remover arquivo ${file.name}`}
              onRemove={() => setFiles((prev) => prev.filter((f) => f !== file))}
            />
          ))}
          {Array.from({ length: emptySlots }, (_, i) => (
            <AttachmentSlot key={`empty_${i}`} />
          ))}
          <View style={{ flex: 1 }}>
            <ImageUploader
              helperText="Selecione arquivos do tipo: JPG ou PNG"
              pickFileLabel="Enviar arquivo"
              accentColor={theme.content.primary}
              showTakePhoto={false}
              onPickFile={() => fileInputRef.current?.click()}
            />
          </View>
        </View>
        {/* O DS não tem (nem deve ter) um seletor de arquivo: o ImageUploader
            expõe `onPickFile` justamente pro host abrir o diálogo nativo. Este
            input é só a plumbing do browser — invisível, sem estilo. */}
        <input
          ref={fileInputRef}
          data-testid="task-file-input"
          type="file"
          accept="image/jpeg,image/png"
          multiple
          style={{ display: 'none' }}
          onChange={onFilesSelected}
        />
      </View>

      {/* Rodapé. */}
      <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Cancelar"
            variant="outline"
            fullWidth
            onPress={() => navigate(isEdit && id ? `/tasks/${id}` : '/tasks')}
            accessibilityLabel="Cancelar"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Salvar tarefa"
            variant="contained"
            fullWidth
            disabled={saving || loading}
            onPress={() => void handleSave()}
            accessibilityLabel="Salvar tarefa"
          />
        </View>
      </View>

      {/* O picker é um componente, não uma rota: o chrome do overlay (Modal +
          scrim `theme.overlay`) é responsabilidade deste pai.
          O contrato do picker exige remontagem a cada abertura (ele lê
          `selectedIds` só na montagem). Hoje quem cumpre isso é o próprio
          Modal, que desmonta o conteúdo ao fechar; a `key` fica como guarda pra
          que um refactor que passe a manter o overlay montado não reintroduza
          a pré-marcação errada — falha silenciosa, sem erro nenhum. */}
      {/* animationType="none" (mesma escolha do Combobox do DS): a animação de
          saída do RNW mantém o conteúdo montado até o `animationend`, evento
          que nunca chega em ambiente sem layout — o overlay ficaria pendurado
          no DOM depois de fechar. */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="none"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: theme.overlay,
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.padding.l,
          }}
        >
          <ResponsiblePicker
            key={pickerOpenings}
            selectedIds={[...responsibleIds]}
            onConfirm={(ids) => {
              setResponsibleIds(ids)
              setPickerOpen(false)
            }}
            onCancel={() => setPickerOpen(false)}
          />
        </View>
      </Modal>
    </View>
  )
}
