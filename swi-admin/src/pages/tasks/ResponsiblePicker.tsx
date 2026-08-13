// src/pages/tasks/ResponsiblePicker.tsx
// Overlay de seleção de responsáveis. É um COMPONENTE, não
// uma rota: quem monta/desmonta é o formulário de tarefa (Task 8), que recebe
// os ids no onConfirm. Layout espelha o `modals/ResponsablesModal` (mesmas
// medidas, divisor vertical, anatomia da linha), mas aquele é rota, escolhe
// admins e não devolve nada — daí um componente novo em vez de reuso.
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
  Avatar,
  Button,
  Checkbox,
  Icon,
  SearchInput,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import { ApiError } from '@/services/api/http'
import { workOrdersApi, type AssignableWorker } from '@/services/api/workOrders'
import { calcAge } from './format'

// DECORATIVO. Dado de saúde só existe quando a smartband existir; o backend
// NÃO devolve bloodType em AssignableWorker. O desenho traz a gota + tipo na
// linha, então exibimos um valor constante pra não quebrar o layout — não veio
// de lugar nenhum e não deve ser lido como informação real. Mesmo padrão do
// `ResponsablesModal`, que roda em cima de mocks.
//
// Exportado pra que o detalhe da tarefa (TaskDetails) mostre o MESMO valor: dois
// placeholders divergentes fariam o mesmo trabalhador aparecer com tipos
// sanguíneos diferentes em duas telas do mesmo fluxo.
export const BLOOD_TYPE_PLACEHOLDER = 'O+'

function VerticalDivider() {
  const theme = useTheme()
  // alignSelf stretch em vez de altura fixa: o divisor acompanha a linha sem
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

function WorkerPickRow({
  worker,
  age,
  selected,
  onToggle,
}: {
  worker: AssignableWorker
  age: number | null
  selected: boolean
  onToggle: (next: boolean) => void
}) {
  const theme = useTheme()
  // Nome sozinho não identifica a pessoa: o backend não impede dois "Carlos
  // Silva", e dois checkboxes de mesmo nome acessível são indistinguíveis pro
  // leitor de tela. O setor desempata — mesmo critério da TasksList, que
  // qualifica a linha com `${title}, ${sector}`.
  const accessibleName = `${worker.name}, ${worker.sector}`
  return (
    <View
      style={{
        backgroundColor: theme.background,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.gap.m,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m, flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s, flex: 1 }}>
          <Avatar uri={worker.avatar || undefined} size="l" accessibilityLabel={accessibleName} />
          <View style={{ flex: 1, gap: theme.gap.xs }}>
            <View>
              <Text variant="body.m" weight="bold" color={theme.content.dark}>
                {worker.name}
              </Text>
              <Text variant="body.m" color={theme.content.dark}>
                {/* Sem birthDate não dá pra inventar idade: dizer o que falta é
                    mais honesto que exibir "0 anos" ou omitir a linha e
                    desalinhar o cartão. */}
                {age === null ? 'Idade não informada' : `${age} anos`}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}>
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
              O setor ocupa o lugar: é o dado real mais próximo e o que ajuda a
              escolher quem executa a tarefa. */}
          <Text variant="body.m" color={theme.content.dark}>
            {worker.sector}
          </Text>
        </View>
      </View>

      <Checkbox
        label="Selecionar"
        checked={selected}
        onChange={onToggle}
        accessibilityLabel={`Selecionar ${accessibleName}`}
      />
    </View>
  )
}

export type ResponsiblePickerProps = {
  /**
   * Ids já responsáveis — chegam pré-marcados. **Lido só na MONTAGEM** (semente
   * do estado interno); mudanças posteriores no prop são ignoradas.
   *
   * CONTRATO PRO PAI: remonte o picker a cada abertura — `key` atrelada ao
   * estado aberto/fechado ou ao id da tarefa (ex.: `<ResponsiblePicker
   * key={taskId} … />`). Reaproveitar uma instância viva entre tarefas
   * diferentes pré-marca os responsáveis da tarefa ANTERIOR, silenciosamente:
   * não há erro, só a lista errada marcada.
   *
   * Por que ler só na montagem em vez de ressincronizar a cada render: a
   * seleção aqui é rascunho do usuário até o "Continuar". Se o estado seguisse
   * o prop, qualquer refetch em background do pai (ou um re-render que recrie o
   * array) apagaria escolhas que o usuário ainda não confirmou.
   */
  selectedIds: string[]
  onConfirm: (ids: string[]) => void
  onCancel: () => void
}

export function ResponsiblePicker({ selectedIds, onConfirm, onCancel }: ResponsiblePickerProps) {
  const theme = useTheme()
  const [workers, setWorkers] = useState<ReadonlyArray<AssignableWorker>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Seleção LOCAL: marcar/desmarcar não sai daqui, só o "Continuar" comunica o
  // pai. Guardada por id (não por índice/objeto) — é o que faz a seleção
  // sobreviver a um filtro que tira a linha da tela.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(selectedIds))
  // Só um gatilho pro efeito refazer a busca depois de um erro.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    workOrdersApi
      .assignable()
      .then((data) => {
        if (cancelled) return
        setWorkers(data)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // apiFetch garante ApiError em todo caminho de erro; o fallback cobre
        // só um bug nosso, não um cenário de rede.
        setError(e instanceof ApiError ? e.message : 'Erro ao carregar os responsáveis')
        setWorkers([])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // O endpoint não tem busca textual, então o filtro é client-side. Cargo e
  // setor entram junto com o nome: quem monta a equipe procura por função
  // ("segurança do trabalho") tanto quanto por pessoa.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return workers
    return workers.filter(
      (w) =>
        w.name.toLowerCase().includes(needle) ||
        w.jobTitle.toLowerCase().includes(needle) ||
        w.sector.toLowerCase().includes(needle),
    )
  }, [workers, search])

  const toggle = (id: string, next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(id)
      else copy.delete(id)
      return copy
    })
  }

  // O backend rejeita responsibleIds vazio com 400. Bloquear o CTA dá o retorno
  // na hora, em vez de gastar um round-trip pra receber um erro que já dava pra
  // prever aqui.
  const canConfirm = selected.size > 0

  return (
    <View
      testID="responsible-picker"
      style={{
        alignSelf: 'center',
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        padding: theme.padding.m,
        gap: theme.gap.l,
        // QA C2: sem teto, a lista estourava o viewport em 1366×900 e o rodapé
        // Cancelar/Continuar ficava inalcançável. O backdrop (flex:1 + padding)
        // dá a altura definida; a lista rola internamente (ScrollView abaixo).
        maxHeight: '100%',
      }}
    >
      <View style={{ gap: theme.gap.s }}>
        <Title variant="title.xs" color={theme.content.dark}>
          Selecionar responsáveis
        </Title>
        <Text variant="body.m" color={theme.content.dark}>
          Atribua 1 ou mais responsáveis à sua tarefa.
        </Text>
      </View>

      <SearchInput
        value={search}
        onChangeText={setSearch}
        placeholder="Pesquisar"
        onClear={() => setSearch('')}
      />

      {loading ? (
        <Text testID="responsible-picker-loading" variant="body.m" color={theme.content.medium}>
          Carregando responsáveis…
        </Text>
      ) : error ? (
        <View style={{ alignItems: 'flex-start', gap: theme.gap.s }}>
          <Text testID="responsible-picker-error" variant="body.m" color={theme.content.error}>
            {error}
          </Text>
          <Button
            label="Tentar novamente"
            variant="outline"
            onPress={() => setReloadKey((k) => k + 1)}
          />
        </View>
      ) : filtered.length === 0 ? (
        <Text testID="responsible-picker-empty" variant="body.m" color={theme.content.medium}>
          {search.trim()
            ? 'Nenhum responsável encontrado para esta busca.'
            : 'Nenhum responsável disponível para atribuição.'}
        </Text>
      ) : (
        <ScrollView
          testID="responsible-picker-list"
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ gap: theme.gap.s }}
        >
          {filtered.map((w) => (
            <WorkerPickRow
              key={w.id}
              worker={w}
              age={calcAge(w.birthDate, new Date())}
              selected={selected.has(w.id)}
              onToggle={(next) => toggle(w.id, next)}
            />
          ))}
        </ScrollView>
      )}

      <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Cancelar"
            variant="outline"
            fullWidth
            onPress={onCancel}
            accessibilityLabel="Cancelar seleção"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Continuar"
            variant="contained"
            fullWidth
            disabled={!canConfirm}
            onPress={() => onConfirm([...selected])}
            accessibilityLabel="Confirmar responsáveis"
          />
        </View>
      </View>
    </View>
  )
}
