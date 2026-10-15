// Seletor do nível de acesso no cadastro de administrador. Só compõe o
// RadioGroup do DS: a descrição do grupo acompanha o nível escolhido e diz o
// que ele pode fazer.
import { RadioGroup } from '@kavicki/swi-design-system'
import { LEVEL_OPTIONS } from '@/app/levels'
import type { PanelLevel } from '@/services/types'

type Props = { value: PanelLevel; onChange: (level: PanelLevel) => void }

const OPTIONS = LEVEL_OPTIONS.map(({ value, label }) => ({ value, label }))

export function LevelField({ value, onChange }: Props) {
  return (
    <RadioGroup
      testID="admins-create-nivel"
      label="Nível de acesso"
      options={OPTIONS}
      value={value}
      onChange={(v) => onChange(v as PanelLevel)}
      description={LEVEL_OPTIONS.find((o) => o.value === value)?.description}
    />
  )
}
