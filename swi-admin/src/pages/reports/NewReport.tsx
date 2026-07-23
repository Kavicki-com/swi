// src/pages/reports/NewReport.tsx
// /reports/new — Figma 105:11725. Lives inside AppLayout. Form with:
//   1. Voltar GhostButton.
//   2. Title row: "Novo relatório" green + "Atribuir responsáveis" CTA.
//   3. Inputs: Título / Resumo / Detalhes (tall).
//   4. "Anexos" section: image slots (thumbnails dos anexos) + DS ImageUploader.
//   5. Actions: Cancelar (outline) + Salvar relatório (contained green).
//
// "Salvar relatório" cria de verdade via reportsApi.create: sobe os anexos no
// submit (uploadImage(file,'reports')) e manda os NOMES dos responsáveis
// escolhidos no overlay. O overlay de responsáveis é montado AQUI (não é uma
// rota), então o formulário meio-preenchido não desmonta na ida e volta.
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Image as RNImage, Modal, Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Icon,
  ImageUploader,
  Input,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import { uploadImage } from '@/services/api/upload'
import { reportsApi } from '@/services/api/reports'
import { useDemoToast } from '@/lib/demoToast'
import { ResponsablesModal } from '@/pages/modals/ResponsablesModal'

// Quantos quadros de anexo o Figma desenha na fileira. É layout, NÃO limite —
// quem limita a contagem é LIMIT_IMAGE_KEYS (o ArrayMaxSize(20) do backend).
const ATTACHMENT_SLOTS = 4

// Espelha o @ArrayMaxSize(20) de imageKeys no CreateReportDto (swi-backend/src/
// reports/dto.ts). Barrar na SELEÇÃO evita subir 25 arquivos pro S3 no submit e
// só então o backend rejeitar — as keys já teriam virado órfãs no bucket.
const LIMIT_IMAGE_KEYS = 20

// Anexo escolhido. `preview` é uma object URL só pro thumbnail; pode faltar em
// ambiente sem URL.createObjectURL (jsdom) — aí o quadro cai no rótulo com o
// nome do arquivo. `uploadedKey` guarda a key devolvida pelo presign depois que
// o arquivo já subiu, pra que um retry de save (ex.: create falhou com 4xx)
// REAPROVEITE a key em vez de subir o arquivo de novo (e mintar key órfã).
type PickedImage = { file: File; preview?: string; uploadedKey?: string }

// Quadro da fileira de anexos (Figma 105:12461). Vazio = glifo de foto; com
// anexo = thumbnail (ou nome do arquivo quando não há preview).
function AttachmentSlot({ entry }: { entry?: PickedImage }) {
  const theme = useTheme()
  return (
    <View
      style={{
        width: 165,
        height: 132,
        borderRadius: theme.border.radius.m,
        backgroundColor: theme.surface.high,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: theme.padding.s,
        gap: theme.gap.xs,
      }}
    >
      {entry?.preview ? (
        <RNImage
          source={{ uri: entry.preview }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          accessibilityRole="image"
          accessibilityLabel={entry.file.name}
        />
      ) : (
        <>
          <Icon name="add_a_photo" size={32} color={theme.content.medium} />
          {entry ? (
            <Text variant="body.s" color={theme.content.medium} numberOfLines={1}>
              {entry.file.name}
            </Text>
          ) : null}
        </>
      )}
    </View>
  )
}

export function NewReport() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const [responsibles, setResponsibles] = useState<ReadonlyArray<string>>([])
  const [images, setImages] = useState<ReadonlyArray<PickedImage>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Contador de aberturas → `key` do overlay. Ele lê `initialSelectedNames` só
  // na montagem, então remontar a cada abertura é o que re-semeia a seleção.
  const [responsablesOpen, setResponsablesOpen] = useState(false)
  const [responsablesOpenings, setResponsablesOpenings] = useState(0)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
    if (images.length + picked.length > LIMIT_IMAGE_KEYS) {
      setError(`Anexe no máximo ${LIMIT_IMAGE_KEYS} arquivos por relatório.`)
      return
    }
    setError(null)
    const entries: PickedImage[] = picked.map((file) => {
      const preview =
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(file)
          : undefined
      if (preview) createdUrlsRef.current.push(preview)
      return { file, preview }
    })
    setImages((prev) => [...prev, ...entries])
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
    // um retry de save (create falhou com 4xx, upload já tinha ido) REAPROVEITA
    // as keys em vez de subir tudo de novo e mintar keys órfãs.
    const imageKeys: string[] = []
    try {
      for (const entry of images) {
        if (entry.uploadedKey) {
          imageKeys.push(entry.uploadedKey)
          continue
        }
        const key = await uploadImage(entry.file, 'reports')
        entry.uploadedKey = key
        imageKeys.push(key)
      }
    } catch (e: unknown) {
      if (leftScreenRef.current) return
      const message = e instanceof Error ? e.message : 'Não foi possível enviar o arquivo.'
      setError(message)
      showToast('Falha ao enviar anexo', message)
      setSaving(false)
      // Sem create: um relatório criado com anexo faltando seria pior que
      // nenhum — o usuário reenviaria e duplicaria. Os anexos que subiram antes
      // da falha ficam órfãos no bucket (sem delete de mídia no backend); a
      // limpeza é da infra (lifecycle rule). As keys que JÁ subiram ficam em
      // `uploadedKey`, então o próximo save não as reenvia.
      return
    }

    if (leftScreenRef.current) return

    const payload = {
      title: title.trim(),
      // undefined é descartado pelo JSON.stringify — não entra no corpo.
      summary: summary.trim() || undefined,
      details: details.trim() || undefined,
      responsibles: responsibles.length > 0 ? [...responsibles] : undefined,
      imageKeys: imageKeys.length > 0 ? imageKeys : undefined,
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

  const emptySlots = Math.max(0, ATTACHMENT_SLOTS - images.length)

  return (
    <View testID="new-report" style={{ gap: theme.gap.l }}>
      {/* Section 1 — Voltar GhostButton. */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar para a lista de relatórios"
          onPress={() => navigate('/reports')}
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

      {/* Section 2 — Title row: "Novo relatório" + Atribuir responsáveis. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Title variant="title.s" color={theme.content.primary}>
          Novo relatório
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

      {/* Section 4 — Anexos: quadros (thumbnails) + ImageUploader. */}
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
          {images.map((entry, index) => (
            <AttachmentSlot key={`${entry.file.name}_${index}`} entry={entry} />
          ))}
          {Array.from({ length: emptySlots }, (_, i) => (
            <AttachmentSlot key={`empty_${i}`} />
          ))}
          <View style={{ flex: 1, minWidth: 240 }}>
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
          data-testid="new-report-file-input"
          type="file"
          accept="image/jpeg,image/png"
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
            onPress={() => navigate('/reports')}
            accessibilityLabel="Cancelar criação do relatório"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Salvar relatório"
            variant="contained"
            fullWidth
            disabled={saving}
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
    </View>
  )
}
