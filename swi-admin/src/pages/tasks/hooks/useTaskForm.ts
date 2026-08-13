// src/pages/tasks/hooks/useTaskForm.ts
// Estado, carga, validação e submit do formulário de tarefa. Extraído de
// TaskForm.tsx sem mudança de comportamento: a página virou só o layout.
//
// As armadilhas do contrato (items com/sem id, items:[] vs chave omitida,
// upload no submit) estão comentadas ponto a ponto junto do código que as
// trata; os tipos moram em services/api/workOrders.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '@/services/api/http'
import { profileApi } from '@/services/api/profile'
import { uploadOrderImage } from '@/services/api/upload'
import {
  workOrdersApi,
  type WorkOrderDetail,
  type WorkOrderInput,
  type WorkOrderItemInput,
} from '@/services/api/workOrders'
import {
  displayDateToCalendar,
  displayTimeToMinutes,
  isoToDisplayDate,
  minutesToDisplayTime,
} from '../format'

// FALLBACK. A fonte primária virou o catálogo real da org (GET
// /profile/catalog: DISTINCT dos setores gravados); esta lista só segura a
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

// Quantos quadros de anexo a fileira mostra. É layout, NÃO limite:
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

// Linha do checklist em edição. `id` só existe em item que veio do backend:
// a chave AUSENTE (e não '') é o que faz o PATCH criar em vez de atualizar.
type ChecklistDraft = { key: string; id?: string; title: string; description: string }

let draftSeq = 0
export function emptyDraft(): ChecklistDraft {
  draftSeq += 1
  return { key: `draft_${draftSeq}`, title: '', description: '' }
}

function toItemInput(draft: ChecklistDraft): WorkOrderItemInput {
  const base = { title: draft.title.trim(), description: draft.description.trim() }
  // Espalhar condicionalmente: `{ id: draft.id ?? '' }` mandaria id vazio e o
  // backend trataria como item NOVO, duplicando o checklist a cada save.
  return draft.id ? { id: draft.id, ...base } : base
}

export function useTaskForm() {
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
  // diz o porquê: itens se removem um a um, pelo botão que já existe no card.
  //
  // Travado (disabled) e não escondido: a seção "Adicionais" mantém o mesmo
  // desenho de referência nas duas rotas, e um controle que some não deixa onde
  // pendurar a explicação: o usuário procuraria o toggle em vez de entender.
  const [checklistLocked, setChecklistLocked] = useState(false)
  const [drafts, setDrafts] = useState<ReadonlyArray<ChecklistDraft>>([emptyDraft()])
  const [files, setFiles] = useState<ReadonlyArray<File>>([])
  // Anexos já gravados: key crua (o que o PATCH aceita) + URL assinada (preview).
  // `removedExisting` marca a fileira como suja, sem mudança, o PATCH omite
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
        // Os ids vêm junto: é o que faz o PATCH ATUALIZAR os itens existentes.
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
  // save seguinte o apagaria: injetar a opção preserva o dado.
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
    // então o backend rejeitava imageKeys > 20, os 25 já estavam no bucket,
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

    // Limites de tamanho do DTO. Barrados aqui pra que a mensagem saia em pt:
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
    // WorkOrderItemDto. Mesma razão dos de cima, mensagem em pt em vez do 400.
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
      // nenhuma tarefa: o usuário reenviaria e duplicaria.
      //
      // O outro lado do trade-off: os anexos que subiram ANTES da falha ficam
      // órfãos no bucket, sem tarefa nenhuma referenciando as keys. Não há
      // rollback possível daqui: o backend não expõe delete de mídia, e
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
    // existentes remanescentes + as novas, e SÓ quando a fileira mudou (anexo
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

  return {
    id,
    isEdit,
    title,
    setTitle,
    summary,
    setSummary,
    details,
    setDetails,
    sector,
    setSector,
    sectorOptions,
    estimatedTime,
    setEstimatedTime,
    startDate,
    setStartDate,
    dueDate,
    setDueDate,
    responsibleIds,
    setResponsibleIds,
    responsiblesLabel,
    checklistOn,
    setChecklistOn,
    checklistLocked,
    drafts,
    setDrafts,
    updateDraft,
    files,
    setFiles,
    existingAttachments,
    setExistingAttachments,
    setRemovedExisting,
    emptySlots,
    fileInputRef,
    onFilesSelected,
    loading,
    saving,
    error,
    handleSave,
    pickerOpen,
    setPickerOpen,
    pickerOpenings,
    setPickerOpenings,
  }
}
