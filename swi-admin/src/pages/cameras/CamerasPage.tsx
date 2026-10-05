// src/pages/cameras/CamerasPage.tsx
// /cameras: pontos de câmera da obra. À esquerda a lista com busca; à direita
// a câmera selecionada ou o formulário de cadastro. Vive dentro do AppLayout.
//
// Sem desenho no Figma: a tela compõe componentes do DS como estão. A aba
// "Ao vivo" mostra a câmera do celular do funcionário que está transmitindo
// (components/LiveTab); a aba fica na URL (?aba=ao-vivo).
import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Icon, SearchInput, Tabs, Text, Title, useTheme } from '@kavicki/swi-design-system'
import type { Camera, CameraInput } from '@/services/api/cameras'
import { ConfirmDialog } from '@/pages/_shared/ConfirmDialog'
import { useCameras, errorMessage } from './hooks/useCameras'
import { CameraList } from './components/CameraList'
import { filterCameras } from './cameraSearch'
import { CameraViewer } from './components/CameraViewer'
import { CameraForm, changesFrom } from './components/CameraForm'
import { LiveTab } from './components/LiveTab'

const TABS = [
  { value: 'fixed', label: 'Câmeras fixas' },
  { value: 'live', label: 'Ao vivo' },
]

// Sem câmera cadastrada, o formulário abre no mesmo ponto padrão do mapa geral.
const DEFAULT_CENTER: [number, number] = [-46.63, -23.55]

type Mode = { kind: 'view' } | { kind: 'create' } | { kind: 'edit'; camera: Camera }

function centerOf(cameras: ReadonlyArray<Camera>): [number, number] {
  if (cameras.length === 0) return DEFAULT_CENTER
  const lng = cameras.reduce((s, c) => s + c.lng, 0) / cameras.length
  const lat = cameras.reduce((s, c) => s + c.lat, 0) / cameras.length
  return [lng, lat]
}

export function CamerasPage() {
  const theme = useTheme()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { cameras, loading, error, retry, create, update, remove } = useCameras()
  const [search, setSearch] = useState('')
  const [mode, setModeState] = useState<Mode>({ kind: 'view' })
  const [removing, setRemoving] = useState<Camera | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Toda troca de modo é uma ação nova: o aviso de exclusão que falhou sai.
  const setMode = (next: Mode) => {
    setActionError(null)
    setModeState(next)
  }

  // A seleção mora na URL: o pino do mapa geral abre /cameras?camera=<id>.
  const selectedId = params.get('camera')
  const selected = cameras.find((c) => c.id === selectedId) ?? null
  const select = (id: string | null) => setParams(id ? { camera: id } : {}, { replace: true })

  // Aba e funcionário assistido também moram na URL: os botões de câmera do
  // detalhe e do chat abrem /cameras?aba=ao-vivo&funcionario=<id>.
  const tab = params.get('aba') === 'ao-vivo' ? 'live' : 'fixed'
  const liveWorkerId = tab === 'live' ? params.get('funcionario') : null
  const changeTab = (next: string) => {
    setMode({ kind: 'view' })
    setParams(next === 'live' ? { aba: 'ao-vivo' } : {}, { replace: true })
  }
  const selectLive = (workerId: string | null) =>
    setParams(workerId ? { aba: 'ao-vivo', funcionario: workerId } : { aba: 'ao-vivo' }, {
      replace: true,
    })

  const filtered = useMemo(() => filterCameras(cameras, search), [cameras, search])

  const center = useMemo(() => centerOf(cameras), [cameras])

  const submitCreate = async (input: CameraInput) => {
    const created = await create(input)
    setMode({ kind: 'view' })
    select(created.id)
  }

  const submitEdit = (camera: Camera) => async (input: CameraInput) => {
    const patch = changesFrom(camera, input)
    if (Object.keys(patch).length > 0) await update(camera.id, patch)
    setMode({ kind: 'view' })
    select(camera.id)
  }

  const confirmRemove = async () => {
    const target = removing
    setRemoving(null)
    if (!target) return
    setActionError(null)
    try {
      await remove(target.id)
      if (selectedId === target.id) select(null)
      if (mode.kind === 'edit' && mode.camera.id === target.id) setMode({ kind: 'view' })
    } catch (e) {
      setActionError(errorMessage(e, 'Não foi possível excluir a câmera'))
    }
  }

  return (
    <View testID="cameras-page" style={{ gap: theme.gap.m }}>
      <View style={{ alignSelf: 'flex-start' }}>
        {/* Destino explícito, como em /tasks: a página pode ser a primeira
            entrada do histórico, e voltar sairia do painel. */}
        <Button
          label="Voltar"
          variant="ghost"
          onPress={() => navigate('/')}
          iconLeft={
            <Icon name="keyboard_arrow_left" size={16} color={theme.content.primaryLight} />
          }
        />
      </View>

      {tab === 'fixed' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <View style={{ flex: 1 }}>
            <SearchInput
              testID="cameras-search"
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar câmera"
              onClear={() => setSearch('')}
            />
          </View>
          <Button
            label="Nova câmera"
            variant="contained"
            onPress={() => setMode({ kind: 'create' })}
            iconLeft={<Icon name="add_circle" size={18} color={theme.content.light} />}
          />
        </View>
      ) : null}

      <Title variant="title.s" color={theme.content.primary}>
        Câmeras
      </Title>

      <View style={{ alignSelf: 'flex-start' }}>
        <Tabs
          tabs={TABS}
          value={tab}
          onChange={changeTab}
          variant="separated"
          accessibilityLabel="Tipo de câmera"
        />
      </View>

      {tab === 'live' ? (
        <LiveTab selectedWorkerId={liveWorkerId} onSelect={selectLive} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap.l }}>
          <View style={{ flex: 1, gap: theme.gap.s, minWidth: 0 }}>
            {actionError ? (
              <Text testID="cameras-action-error" variant="body.m" color={theme.content.error}>
                {actionError}
              </Text>
            ) : null}
            {loading ? (
              <Text testID="cameras-loading" variant="body.m" color={theme.content.medium}>
                Carregando câmeras…
              </Text>
            ) : error ? (
              <View style={{ alignItems: 'flex-start', gap: theme.gap.s }}>
                <Text testID="cameras-error" variant="body.m" color={theme.content.error}>
                  {error}
                </Text>
                <Button label="Tentar novamente" variant="outline" onPress={retry} />
              </View>
            ) : cameras.length === 0 ? (
              <Text testID="cameras-empty" variant="body.m" color={theme.content.medium}>
                Nenhuma câmera cadastrada. Use &quot;Nova câmera&quot; para marcar a primeira no
                mapa.
              </Text>
            ) : filtered.length === 0 ? (
              <Text testID="cameras-no-match" variant="body.m" color={theme.content.medium}>
                Nenhuma câmera com esse nome.
              </Text>
            ) : (
              <CameraList
                cameras={filtered}
                selectedId={selectedId}
                onSelect={(c) => {
                  setMode({ kind: 'view' })
                  select(c.id)
                }}
                onEdit={(c) => setMode({ kind: 'edit', camera: c })}
                onRemove={setRemoving}
              />
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            {mode.kind === 'create' ? (
              <CameraForm
                key="new"
                center={center}
                onSubmit={submitCreate}
                onCancel={() => setMode({ kind: 'view' })}
              />
            ) : mode.kind === 'edit' ? (
              <CameraForm
                key={mode.camera.id}
                initial={mode.camera}
                center={center}
                onSubmit={submitEdit(mode.camera)}
                onCancel={() => setMode({ kind: 'view' })}
              />
            ) : (
              <CameraViewer camera={selected} />
            )}
          </View>
        </View>
      )}

      {removing ? (
        <ConfirmDialog
          title="Excluir câmera?"
          message={`A câmera "${removing.name}" sai do mapa e da lista, junto com o endereço cadastrado.`}
          confirmLabel="Excluir"
          confirmDanger
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </View>
  )
}
