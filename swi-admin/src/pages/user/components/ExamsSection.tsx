// src/pages/user/components/ExamsSection.tsx
// Bloco "Exames clínicos" da coluna da direita. Extraído de UserSettings.tsx
// sem mudança de comportamento. O <input type="file"> escondido continua na
// página, junto com o da foto, no bloco do cabeçalho de perfil (padrão house,
// mesmo do NewReport); daqui sai só o pedido de abrir o seletor.
import { View } from 'react-native'
import { Button, ExamInfoCard, Input, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { FormError } from '@/components/FormError'
import type { Exam } from '@/services/api/exams'
import { examCardParts } from '@/services/api/examCard'
import { maskDate } from '@/lib/masks'

export function ExamsSection({
  examName,
  onExamNameChange,
  examDate,
  onExamDateChange,
  examError,
  examsBusy,
  onPickFile,
  exams,
}: {
  examName: string
  onExamNameChange: (value: string) => void
  examDate: string
  onExamDateChange: (value: string) => void
  examError: string | null
  examsBusy: boolean
  onPickFile: () => void
  exams: readonly Exam[]
}) {
  const theme = useTheme()
  return (
    // Mora com o resto do dado de saúde. Nome e validade são o que o
    // ExamInfoCard desenha; sem eles o arquivo sobe e não vira card nenhum,
    // que era o bug.
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
            testID="settings-exam-name"
          />
        </View>
        <View style={{ width: 192 }}>
          <Input
            label="Validade"
            placeholder="dd/mm/aaaa"
            value={examDate}
            onChangeText={(v) => onExamDateChange(maskDate(v))}
            testID="settings-exam-date"
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
      {exams.length === 0 ? (
        <Text variant="body.s" color={theme.content.medium}>
          Nenhum exame enviado.
        </Text>
      ) : (
        exams.map((exam) => {
          const parts = examCardParts(exam.date)
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
