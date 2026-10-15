// src/pages/reports/NewReport.tsx
// /reports/new (criação) e /reports/:id/edit (revisão). Lives
// inside AppLayout. O MESMO componente serve as duas rotas: a de edição não
// existe no desenho, é reuso deste form pré-preenchido (mesma decisão do TaskForm).
// Form com:
//   1. Voltar GhostButton.
//   2. Title row: "Novo relatório"/"Editar relatório" verde + "Atribuir
//      responsáveis" CTA.
//   3. Status do relatório (SÓ na edição): Combobox com os 4 status.
//   4. Inputs: Título / Resumo / Detalhes (tall).
//   5. "Anexos" section: lista de anexos (imagem, vídeo, áudio e PDF, com tipo
//      e tamanho) + DS ImageUploader.
//   6. Actions: Cancelar (outline) + Salvar relatório (contained green).
//
// "Salvar relatório" cria (reportsApi.create) ou salva a revisão
// (reportsApi.update). Em ambos, os anexos NOVOS sobem no submit
// (uploadImage(file,'reports')); na edição as keys crus já existentes
// (report.imageKeys) são preservadas e mescladas com as novas. O overlay de
// responsáveis é montado AQUI (não é uma rota), então o formulário
// meio-preenchido não desmonta na ida e volta.
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AttachmentList,
  Button,
  Combobox,
  Icon,
  ImageUploader,
  ImageViewer,
  Input,
  Text,
  Title,
  useTheme,
  type AttachmentItem,
} from '@kavicki/swi-design-system'
import {
  checkReportFile,
  reportFileInfo,
  uploadImage,
  type ReportFileKind,
} from '@/services/api/upload'
import { reportsApi, type ReportAttachment, type ReportStatus } from '@/services/api/reports'
import { attachmentItems, pickedDescription, toAttachmentKind } from './reportAttachments'
import { useDemoToast } from '@/lib/demoToast'
import { ResponsablesModal } from '@/pages/modals/ResponsablesModal'

// Espelha o @ArrayMaxSize(20) de imageKeys no CreateReportDto (swi-backend/src/
// reports/dto.ts). Barrar na SELEÇÃO evita subir 25 arquivos pro S3 no submit e
// só então o backend rejeitar — as keys já teriam virado órfãs no bucket.
const LIMIT_IMAGE_KEYS = 20

// Opções do Combobox de status na edição. Ordem/rótulos batem com o filtro da
// ReportsList (menos a opção "Todos", que não faz sentido num relatório único).
const STATUS_OPTIONS: ReadonlyArray<{ label: string; value: ReportStatus }> = [
  { label: 'Concluído', value: 'accept' },
  { label: 'Em Revisão', value: 'pending' },
  { label: 'Em Andamento', value: 'info' },
  { label: 'Cancelado', value: 'canceled' },
]

// status → statusLabel enviado no PATCH. O backend guarda os dois campos e a UI
// (StatusTag) lê o statusLabel cru, então mandar o rótulo em pt junto do status
// mantém o detalhe consistente com o que o usuário escolheu. DERIVADO de
// STATUS_OPTIONS pra que o acoplamento rótulo↔status tenha uma fonte só.
const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label])) as Record<
  ReportStatus,
  string
>

// Anexo escolhido. `id` é estável na sessão (não muda com remoções), para a
// linha da lista e a remoção. `kind` sai da validação da escolha (imagem,
// vídeo, áudio ou PDF). `preview` é uma object URL só pro thumbnail de imagem;
// pode faltar em ambiente sem URL.createObjectURL (jsdom); aí a linha cai no
// ícone do tipo. `uploadedKey` guarda a key devolvida pelo presign depois que
// o arquivo já subiu, pra que um retry de save (ex.: create falhou com 4xx)
// REAPROVEITE a key em vez de subir o arquivo de novo (e mintar key órfã).
type PickedImage = {
  id: string
  file: File
  kind: ReportFileKind
  preview?: string
  uploadedKey?: string
}

// Tipos que o seletor do navegador oferece, os mesmos que o backend aceita em
// reports. As extensões entram junto porque alguns sistemas não associam
// .m4a, .mov ou .wav ao MIME, e o filtro esconderia o arquivo.
const ACCEPT = [
  'image/jpeg',
  'image/png',
  'video/mp4',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'application/pdf',
  '.mov',
  '.m4a',
  '.wav',
  '.mp3',
].join(',')

export function NewReport() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const { id } = useParams<{ id?: string }>()
  const isEdit = !!id

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const [status, setStatus] = useState<ReportStatus>('pending')
  const [responsibles, setResponsibles] = useState<ReadonlyArray<string>>([])
  const [images, setImages] = useState<ReadonlyArray<PickedImage>>([])
  // Anexos já gravados (edição). `existingImageKeys` = keys crus preservadas no
  // PATCH; `existingAttachments` = URL presigned e tipo, só pra linha read-only.
  // Remover um anexo existente está FORA de escopo: a edição só preserva e ADICIONA.
  const [existingImageKeys, setExistingImageKeys] = useState<ReadonlyArray<string>>([])
  const [existingAttachments, setExistingAttachments] = useState<ReadonlyArray<ReportAttachment>>(
    [],
  )
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Edição: o get devolveu {data:null} (404/rede). Sem isto o usuário ficava
  // num "Editar relatório" vazio, sem retorno nenhum.
  const [notFound, setNotFound] = useState(false)
  // Contador de aberturas → `key` do overlay. Ele lê `initialSelectedNames` só
  // na montagem, então remontar a cada abertura é o que re-semeia a seleção.
  const [responsablesOpen, setResponsablesOpen] = useState(false)
  const [responsablesOpenings, setResponsablesOpenings] = useState(0)
  // Anexo aberto no visualizador em tamanho grande; null = fechado.
  const [viewing, setViewing] = useState<{ uri: string; title: string } | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Contador pra ids estáveis dos anexos escolhidos: o índice mudaria a cada
  // remoção e remover o errado.
  const pickSeqRef = useRef(0)

  // `true` depois que a tela sai da árvore. Um save pode estar em voo quando o
  // usuário desiste e sai: sem esta guarda, o navigate do sucesso o arrastaria
  // de volta pra tela que ele já abandonou.
  const leftScreenRef = useRef(false)
  // Toda object URL criada — revogadas no unmount pra não vazar memória.
  const createdUrlsRef = useRef<string[]>([])
  useEffect(() => {
    leftScreenRef.current = false
    return () => {
      leftScreenRef.current = true
      for (const url of createdUrlsRef.current) URL.revokeObjectURL(url)
      createdUrlsRef.current = []
    }
  }, [])

  // Edição: carrega o relatório e pré-preenche o formulário. `responsibleNames`
  // são os nomes CRUS (o array, não a string comma-joined do Report) — re-semear
  // do array evita o split(', ') lossy quando um nome contém ", ". `imageKeys`
  // (keys crus) preserva os anexos no PATCH; `images` (presigned) só decora.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    reportsApi.get(id).then(({ data }) => {
      if (cancelled) return
      if (!data) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setTitle(data.title)
      setSummary(data.summary ?? '')
      setDetails(data.details ?? '')
      setStatus(data.status)
      setResponsibles([...data.responsibleNames])
      setExistingImageKeys(data.imageKeys ?? [])
      setExistingAttachments(data.attachments ?? [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  const openResponsables = () => {
    setResponsablesOpenings((n) => n + 1)
    setResponsablesOpen(true)
  }

  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    // Zerar o input permite reescolher o MESMO arquivo depois (o change não
    // dispara quando o value não muda).
    event.target.value = ''
    if (picked.length === 0) return
    // O teto conta os anexos já gravados (edição) + os escolhidos: o backend
    // valida imageKeys > 20 no array MESCLADO do PATCH.
    if (existingImageKeys.length + images.length + picked.length > LIMIT_IMAGE_KEYS) {
      setError(`Anexe no máximo ${LIMIT_IMAGE_KEYS} arquivos por relatório.`)
      return
    }
    // Tipo e tamanho recusados NA ESCOLHA, com a mesma frase do servidor e o
    // nome do arquivo na frente. Os válidos do mesmo lote entram mesmo assim:
    // recusar o lote inteiro por um arquivo obrigaria a escolher tudo de novo.
    const refused: string[] = []
    const entries: PickedImage[] = []
    for (const file of picked) {
      const reason = checkReportFile(file)
      const info = reportFileInfo(file)
      if (reason || !info) {
        refused.push(`${file.name}: ${reason}`)
        continue
      }
      const preview =
        info.kind === 'image' &&
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(file)
          : undefined
      if (preview) createdUrlsRef.current.push(preview)
      entries.push({ id: `pick_${pickSeqRef.current++}`, file, kind: info.kind, preview })
    }
    setError(refused.length > 0 ? refused.join('\n') : null)
    if (entries.length > 0) setImages((prev) => [...prev, ...entries])
  }

  // Tira um anexo escolhido da lista sem sair do formulário: o resto do que foi
  // preenchido fica. A object URL do preview é revogada aqui.
  const removePicked = (id: string) => {
    setError(null)
    setImages((prev) => {
      const gone = prev.find((entry) => entry.id === id)
      if (gone?.preview) {
        URL.revokeObjectURL(gone.preview)
        createdUrlsRef.current = createdUrlsRef.current.filter((url) => url !== gone.preview)
      }
      return prev.filter((entry) => entry.id !== id)
    })
  }

  const handleSave = async () => {
    if (saving) return
    setError(null)

    if (!title.trim()) {
      setError('Informe o título do relatório.')
      return
    }

    setSaving(true)
    // Upload SÓ AGORA: o presign vale 300 s. Subir na hora que o arquivo é
    // escolhido faria um formulário preenchido devagar falhar com 403.
    //
    // Idempotente por arquivo: a key resolvida é gravada em `uploadedKey`, então
    // um retry de save (create/update falhou com 4xx, upload já tinha ido)
    // REAPROVEITA as keys em vez de subir tudo de novo e mintar keys órfãs.
    const newImageKeys: string[] = []
    try {
      for (const entry of images) {
        if (entry.uploadedKey) {
          newImageKeys.push(entry.uploadedKey)
          continue
        }
        const key = await uploadImage(entry.file, 'reports')
        entry.uploadedKey = key
        newImageKeys.push(key)
      }
    } catch (e: unknown) {
      if (leftScreenRef.current) return
      const message = e instanceof Error ? e.message : 'Não foi possível enviar o arquivo.'
      setError(message)
      showToast('Falha ao enviar anexo', message)
      setSaving(false)
      // Sem create/update: um relatório salvo com anexo faltando seria pior que
      // nenhum — o usuário reenviaria e duplicaria. Os anexos que subiram antes
      // da falha ficam órfãos no bucket (sem delete de mídia no backend); a
      // limpeza é da infra (lifecycle rule). As keys que JÁ subiram ficam em
      // `uploadedKey`, então o próximo save não as reenvia.
      return
    }

    if (leftScreenRef.current) return

    // Edição: PATCH com os campos + status/statusLabel + anexos MESCLADOS
    // (keys existentes preservadas + novas). Volta pro detalhe no sucesso.
    if (isEdit && id) {
      const patch = {
        title: title.trim(),
        // undefined é descartado pelo JSON.stringify — não entra no corpo.
        summary: summary.trim() || undefined,
        details: details.trim() || undefined,
        responsibles: responsibles.length > 0 ? [...responsibles] : undefined,
        imageKeys: [...existingImageKeys, ...newImageKeys],
        // `existingImageKeys` só é escrito no load, então ele É o snapshot que
        // este form viu. Vai junto como prova pro backend não apagar anexo
        // que chegou depois nem apagar do bucket sem remoção provada.
        imageKeysBase: [...existingImageKeys],
        status,
        statusLabel: STATUS_LABELS[status],
      }
      const { data, error: apiError } = await reportsApi.update(id, patch)
      if (leftScreenRef.current) return
      if (apiError || !data) {
        const message = apiError?.message ?? 'Não foi possível salvar o relatório.'
        setError(message)
        showToast('Falha ao salvar', message)
        setSaving(false)
        return
      }
      showToast('Relatório atualizado', data.title)
      navigate(`/reports/${id}`)
      return
    }

    const payload = {
      title: title.trim(),
      // undefined é descartado pelo JSON.stringify — não entra no corpo.
      summary: summary.trim() || undefined,
      details: details.trim() || undefined,
      responsibles: responsibles.length > 0 ? [...responsibles] : undefined,
      imageKeys: newImageKeys.length > 0 ? newImageKeys : undefined,
    }

    const { data, error: apiError } = await reportsApi.create(payload)
    if (leftScreenRef.current) return
    if (apiError || !data) {
      const message = apiError?.message ?? 'Não foi possível salvar o relatório.'
      setError(message)
      showToast('Falha ao salvar', message)
      setSaving(false)
      return
    }
    showToast('Relatório salvo', data.title)
    navigate('/reports')
  }

  const responsiblesLabel =
    responsibles.length === 0
      ? 'Nenhum responsável atribuído.'
      : responsibles.length === 1
        ? `1 responsável: ${responsibles[0]}`
        : `${responsibles.length} responsáveis: ${responsibles.join(', ')}`

  // Linhas da lista de anexos: primeiro os já gravados (edição), só
  // visualizáveis (remover anexo existente segue fora de escopo), depois os
  // escolhidos agora, que dá pra visualizar e remover.
  // Os escolhidos mostram tipo e tamanho junto do nome, antes de enviar. Só a
  // imagem tem o que visualizar antes de subir; os outros tipos só se removem.
  const existingItems = attachmentItems(existingAttachments, ['view'])
  const listItems: AttachmentItem[] = [
    ...existingItems,
    ...images.map((entry) => ({
      id: entry.id,
      name: pickedDescription(entry.file.name, entry.kind, entry.file.size),
      kind: toAttachmentKind(entry.kind),
      thumbnailUri: entry.preview,
      actions: entry.kind === 'image' ? (['view', 'remove'] as const) : (['remove'] as const),
    })),
  ]

  // Imagem abre no visualizador; anexo gravado de outro tipo abre em nova aba
  // (o navegador toca o vídeo e o áudio e mostra o PDF).
  const openViewer = (item: AttachmentItem) => {
    const existing = existingAttachments[existingItems.findIndex((i) => i.id === item.id)]
    if (existing && existing.kind !== 'image') {
      window.open(existing.url, '_blank', 'noopener')
      return
    }
    const picked = images.find((entry) => entry.id === item.id)
    const uri = existing?.url ?? picked?.preview
    if (uri) setViewing({ uri, title: item.name })
  }

  // Onde Voltar/Cancelar levam: na edição, de volta ao detalhe; na criação, à
  // lista.
  const backTarget = isEdit && id ? `/reports/${id}` : '/reports'
  const backLabel = isEdit ? 'Voltar para o relatório' : 'Voltar para a lista de relatórios'
  const cancelLabel = isEdit ? 'Cancelar edição do relatório' : 'Cancelar criação do relatório'

  // Edição com get {data:null} (404/rede): estado dedicado em vez de deixar o
  // usuário num formulário vazio sem retorno. Compõe DS Text + botão de voltar.
  if (notFound) {
    return (
      <View testID="new-report-not-found" style={{ gap: theme.gap.m, padding: theme.padding.m }}>
        <Title variant="title.s" color={theme.content.primary}>
          Relatório não encontrado
        </Title>
        <Text variant="body.m" color={theme.content.dark}>
          Não foi possível carregar este relatório para edição. Ele pode ter sido removido ou o link
          está incorreto.
        </Text>
        <View style={{ alignSelf: 'flex-start' }}>
          <Button
            label="Voltar para os relatórios"
            variant="outline"
            onPress={() => navigate('/reports')}
            accessibilityLabel="Voltar para a lista de relatórios"
          />
        </View>
      </View>
    )
  }

  return (
    <View testID="new-report" style={{ gap: theme.gap.l }}>
      {/* Section 1 — Voltar GhostButton. */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={() => navigate(backTarget)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: theme.padding.sm,
            paddingVertical: theme.padding.sm,
            borderRadius: theme.border.radius.m,
          }}
        >
          <Icon name="keyboard_arrow_left" size={24} color={theme.content.primaryLight} />
          <Text
            variant="body.m"
            color={theme.content.primaryLight}
            style={{ fontFamily: theme.fontFamily.title, fontWeight: '700' }}
          >
            Voltar
          </Text>
        </Pressable>
      </View>

      {/* Section 2 — Title row: "Novo/Editar relatório" + Atribuir responsáveis. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Title variant="title.s" color={theme.content.primary}>
          {isEdit ? 'Editar relatório' : 'Novo relatório'}
        </Title>
        <Button
          label="Atribuir responsáveis"
          variant="contained"
          iconRight={<Icon name="add_circle" size={24} color={theme.content.light} />}
          onPress={openResponsables}
          accessibilityLabel="Atribuir responsáveis ao relatório"
        />
      </View>

      <Text testID="new-report-responsibles-summary" variant="body.m" color={theme.content.medium}>
        {responsiblesLabel}
      </Text>

      {/* role="alert" pra que a mensagem seja ANUNCIADA quando aparece. */}
      {error ? (
        <Text
          testID="new-report-error"
          accessibilityRole="alert"
          variant="body.m"
          color={theme.content.error}
        >
          {error}
        </Text>
      ) : null}

      {loading ? (
        <Text testID="new-report-loading" variant="body.m" color={theme.content.medium}>
          Carregando relatório…
        </Text>
      ) : null}

      {/* Status — SÓ na edição. O create nasce `pending` no servidor, então o
          controle não aparece na criação. */}
      {isEdit ? (
        <View style={{ width: 220 }}>
          <Combobox
            label="Status do relatório"
            testID="new-report-status"
            options={STATUS_OPTIONS as { label: string; value: string }[]}
            value={status}
            onChange={(next) => setStatus(next as ReportStatus)}
            accessibilityLabel="Status do relatório"
          />
        </View>
      ) : null}

      {/* Section 3 — Form inputs. */}
      <View style={{ gap: theme.gap.m }}>
        <Input
          label="Título do relatório"
          testID="new-report-title"
          value={title}
          onChangeText={setTitle}
          placeholder="Digite aqui o título do relatório"
          accessibilityLabel="Título do relatório"
        />
        <Input
          label="Resumo do relatório"
          testID="new-report-summary"
          value={summary}
          onChangeText={setSummary}
          placeholder="Digite aqui um resumo do seu relatório"
          accessibilityLabel="Resumo do relatório"
        />
        {/* No fixed-height wrapper: a DS Input não propaga flex:1 pro TextInput
            interno, então um wrapper alto deixaria espaço morto embaixo. Deixa
            fluir no tamanho natural; o gap.l do pai cuida do espaçamento. */}
        <Input
          label="Detalhes do relatório"
          testID="new-report-details"
          value={details}
          onChangeText={setDetails}
          placeholder="Digite aqui o seu relatório"
          accessibilityLabel="Detalhes do relatório"
          multiline
          numberOfLines={12}
        />
      </View>

      {/* Section 4, Anexos: lista (visualizar/remover) + ImageUploader. */}
      <View style={{ gap: theme.gap.m }}>
        <Title variant="title.xs" color={theme.content.primary}>
          Anexos
        </Title>
        {listItems.length > 0 ? (
          <AttachmentList
            items={listItems}
            onView={openViewer}
            onRemove={(item) => removePicked(item.id)}
            testID="new-report-attachments"
          />
        ) : null}
        <View style={{ maxWidth: 420 }}>
          <ImageUploader
            helperText="Selecione arquivos do tipo: JPG, PNG, MP4, MOV, MP3, M4A, WAV ou PDF. Vídeo até 100 MB, áudio até 25 MB, os demais até 15 MB."
            pickFileLabel="Enviar arquivo"
            accentColor={theme.content.primary}
            showTakePhoto={false}
            onPickFile={() => fileInputRef.current?.click()}
          />
        </View>
        {/* O DS não tem (nem deve ter) um seletor de arquivo: o ImageUploader
            expõe `onPickFile` justamente pro host abrir o diálogo nativo. Este
            input é só a plumbing do browser — invisível, sem estilo. */}
        <input
          ref={fileInputRef}
          data-testid="new-report-file-input"
          type="file"
          accept={ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={onFilesSelected}
        />
      </View>

      {/* Section 5 — Actions: Cancelar + Salvar relatório. */}
      <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Cancelar"
            variant="outline"
            fullWidth
            onPress={() => navigate(backTarget)}
            accessibilityLabel={cancelLabel}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Salvar relatório"
            variant="contained"
            fullWidth
            disabled={saving || loading}
            accessibilityLabel="Salvar relatório"
            onPress={() => void handleSave()}
          />
        </View>
      </View>

      {/* Overlay de responsáveis — COMPONENTE montado aqui (não rota): o
          formulário meio-preenchido não desmonta na ida e volta. RN Modal
          portaliza pro topo (scrim próprio do overlay preenche o viewport).
          animationType="none": a animação de saída do RNW manteria o conteúdo
          montado até um animationend que nunca chega sem layout. */}
      <Modal
        visible={responsablesOpen}
        transparent
        animationType="none"
        onRequestClose={() => setResponsablesOpen(false)}
      >
        <ResponsablesModal
          key={responsablesOpenings}
          initialSelectedNames={responsibles}
          onConfirm={(names) => {
            setResponsibles(names)
            setResponsablesOpen(false)
          }}
          onClose={() => setResponsablesOpen(false)}
        />
      </Modal>

      {/* Visualizador do anexo em tamanho grande. Sem Baixar: no formulário o
          anexo escolhido ainda não subiu, e o já gravado se baixa no detalhe. */}
      <ImageViewer
        visible={viewing !== null}
        uri={viewing?.uri ?? null}
        title={viewing?.title ?? ''}
        onClose={() => setViewing(null)}
        testID="new-report-viewer"
      />
    </View>
  )
}
