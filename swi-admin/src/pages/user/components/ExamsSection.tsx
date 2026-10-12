// src/pages/user/components/ExamsSection.tsx
// Bloco "Exames clínicos" da coluna da direita. Extraído de UserSettings.tsx
// sem mudança de comportamento. O <input type="file"> escondido continua na
// página, junto com o da foto, no bloco do cabeçalho de perfil (padrão house,
// mesmo do NewReport); daqui sai só o pedido de abrir o seletor.
import { View } from 'react-native'
import {
  Button,
  ExamInfoCard,
  Input,
  Text,
  Title,
  useTheme,
  type ExamAction,
} from '@kavicki/swi-design-system'
import { FormError } from '@/components/FormError'
import type { Exam } from '@/services/api/exams'
import { examCardParts } from '@/services/api/examCard'
import { maskDate } from '@/lib/masks'

// Mantém só as ações que têm handler, na ordem view, download, remove.
function enabledActions(
  order: readonly ExamAction[],
  handlers: Partial<Record<ExamAction, unknown>>,
): ExamAction[] {
  return order.filter((action) => Boolean(handlers[action]))
}

export function ExamsSection({
  examName,
  onExamNameChange,
  examDate,
  onExamDateChange,
  examError,
  examsBusy,
  onPickFile,
  exams,
  pending = [],
  testIDPrefix = 'settings',
  onPendingView,
  onPendingRemove,
  onExamView,
  onExamDownload,
  onExamRemove,
  examsRemoving = [],
}: {
  examName: string
  onExamNameChange: (value: string) => void
  examDate: string
  onExamDateChange: (value: string) => void
  examError: string | null
  examsBusy: boolean
  onPickFile: () => void
  exams: readonly Exam[]
  /** Exames escolhidos mas ainda NÃO gravados: o cadastro novo não tem id pra
   *  anexá-los, então eles esperam o create. Vazio em toda tela onde o usuário
   *  já existe. */
  pending?: readonly { name: string; date: string }[]
  /** Prefixo dos testID. A seção nasceu no settings e agora serve também o
   *  formulário de cadastro; um id dizendo 'settings' numa tela de cadastro
   *  manda o próximo leitor procurar no arquivo errado. */
  testIDPrefix?: string
  /** Ações dos exames. Sem elas, o card fica como era (só Baixar nos gravados,
   *  nada nos pendentes): o settings, que não as passa, não muda. */
  onPendingView?: (index: number) => void
  onPendingRemove?: (index: number) => void
  onExamView?: (exam: Exam) => void
  onExamDownload?: (exam: Exam) => void
  onExamRemove?: (exam: Exam) => void
  /** Ids de exames gravados cuja exclusão está em voo: desabilita o cluster. */
  examsRemoving?: readonly string[]
}) {
  const theme = useTheme()
  return (
    // Mora com o resto do dado de saúde. Nome e validade são o que o
    // ExamInfoCard desenha; sem eles o arquivo sobe e não vira card nenhum.
    <View style={{ gap: theme.gap.s }}>
      <Title variant="title.xs" color={theme.content.primary}>
        Exames clínicos
      </Title>
      <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
        <View style={{ flex: 1 }}>
          <Input
            label="Nome do exame"
            value={examName}
            onChangeText={onExamNameChange}
            testID={`${testIDPrefix}-exam-name`}
          />
        </View>
        <View style={{ width: 192 }}>
          <Input
            label="Validade"
            placeholder="dd/mm/aaaa"
            value={examDate}
            onChangeText={(v) => onExamDateChange(maskDate(v))}
            testID={`${testIDPrefix}-exam-date`}
          />
        </View>
      </View>
      <FormError message={examError} />
      <Button
        label={examsBusy ? 'Enviando…' : 'Enviar exame'}
        variant="contained"
        backgroundColor={theme.surface.secondary}
        size="small"
        disabled={examsBusy}
        onPress={onPickFile}
      />
      {pending.length > 0 ? (
        <>
          {/* Ditos como o que são: escolhidos, ainda não gravados. Um card
              idêntico ao dos salvos afirmaria que o exame já está no cadastro. */}
          <Text variant="body.s" color={theme.content.medium}>
            Serão anexados ao concluir o cadastro.
          </Text>
          {pending.map((p, i) => {
            const parts = examCardParts(p.date)
            // Sem baixar: o arquivo só sobe no submit. Com os handlers, dá pra
            // visualizar e tirar da fila; sem eles, o card fica desabilitado.
            const actions = enabledActions(['view', 'remove'], {
              view: onPendingView,
              remove: onPendingRemove,
            })
            return (
              <ExamInfoCard
                key={`pendente-${i}`}
                compact
                fullWidth
                year={parts.year}
                date={parts.date}
                examName={p.name}
                actionDisabled
                actions={actions.length > 0 ? actions : undefined}
                onView={onPendingView ? () => onPendingView(i) : undefined}
                onRemove={onPendingRemove ? () => onPendingRemove(i) : undefined}
              />
            )
          })}
        </>
      ) : null}
      {exams.length === 0 && pending.length === 0 ? (
        <Text variant="body.s" color={theme.content.medium}>
          Nenhum exame enviado.
        </Text>
      ) : (
        exams.map((exam) => {
          const parts = examCardParts(exam.date)
          const actions = enabledActions(['view', 'download', 'remove'], {
            view: onExamView,
            download: onExamDownload,
            remove: onExamRemove,
          })
          // Com os handlers de ação, o cluster (visualizar, baixar, excluir);
          // sem eles, o botão único de Baixar de antes (o settings não muda).
          if (actions.length > 0) {
            return (
              <ExamInfoCard
                key={exam.id}
                compact
                fullWidth
                year={parts.year}
                date={parts.date}
                examName={exam.name}
                actions={actions}
                actionsBusy={examsRemoving.includes(exam.id)}
                onView={onExamView ? () => onExamView(exam) : undefined}
                onDownload={onExamDownload ? () => onExamDownload(exam) : undefined}
                onRemove={onExamRemove ? () => onExamRemove(exam) : undefined}
              />
            )
          }
          return (
            <ExamInfoCard
              key={exam.id}
              compact
              fullWidth
              year={parts.year}
              date={parts.date}
              examName={exam.name}
              actionLabel={`Baixar ${exam.name}`}
              // fileUrl é presignado e expira, abre na hora do clique,
              // nunca guardado em href renderizado antes.
              onActionPress={() => window.open(exam.fileUrl, '_blank', 'noopener,noreferrer')}
            />
          )
        })
      )}
    </View>
  )
}
