// src/pages/tasks/TaskForm.tsx
// /tasks/new e /tasks/:id/edit — "Nova tarefa". O MESMO
// componente serve as duas rotas: a de edição não existe no desenho, é reuso
// deste form pré-preenchido (decisão do usuário).
//
// Copy: o desenho herdou "relatório" das telas de Relatórios em dois lugares (o
// CTA de salvar e o placeholder dos detalhes) e traz um label solto
// "description" que é lixo de layout. Aqui vale "tarefa", conforme decidido.
//
// As armadilhas do contrato (items com/sem id, items:[] vs chave omitida,
// upload no submit) estão comentadas ponto a ponto junto do código que as trata
// — ver também os tipos em services/api/workOrders. A conversão de data e de
// duração (calendário vs ISO, hh:mm vs minutos) mora em ./format, junto dos
// testes que a cobrem nos cantos.
//
// O estado, a carga do detalhe, a validação e o submit moram em
// ./hooks/useTaskForm; aqui fica só o layout.
import { Modal, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
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
import { ResponsiblePicker } from './ResponsiblePicker'
import { AttachmentSlot } from './components/AttachmentSlot'
import { emptyDraft, useTaskForm } from './hooks/useTaskForm'

export function TaskForm() {
  const theme = useTheme()
  const navigate = useNavigate()
  const {
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
  } = useTaskForm()

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
          // Copy corrigida: o desenho diz "seu relatório" por resíduo das telas de
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
