// src/pages/chat/components/ContactInfoPanel.tsx
// Painel da coluna da direita: identidade do contato, mini-mapa de satélite,
// barra de tempo até a fadiga total e cartão de dados (gênero, idade, tipo
// sanguíneo, alergias). Extraído de ChatInbox.tsx sem mudança de
// comportamento.
import { useEffect, useRef } from 'react'
import { Pressable, View } from 'react-native'
import { useMapLibre } from '@/lib/useMapLibre'
import { Avatar, Button, Icon, Text, Title, elevation, useTheme } from '@kavicki/swi-design-system'
import { useDemoToast } from '@/lib/demoToast'
import type { ChatContact } from '@/services/chats'
import { SimulatedDataBadge } from '@/components/SimulatedDataBadge'

// ESRI satellite tile: same source as AdminDetails / MapsGeneral so the
// chat-inbox mini-map shares the canonical basemap.
const ESRI_SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    'esri-imagery': {
      type: 'raster' as const,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '',
      minzoom: 0,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'esri-imagery',
      type: 'raster' as const,
      source: 'esri-imagery',
    },
  ],
}

// Mini-map inside the right-column info panel. Renders a
// 177px-tall satellite tile with a centered LocationPin (avatar + tail),
// camera affordance top-right, and a "Mapa completo" CTA bottom-left.
function ContactMiniMap({
  contact,
  onOpenFullMap,
}: {
  contact: ChatContact
  onOpenFullMap: () => void
}) {
  const theme = useTheme()
  const lib = useMapLibre()
  const { show: showToast } = useDemoToast()
  const containerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!lib || !containerRef.current) return
    const map = new lib.Map({
      container: containerRef.current,
      style: ESRI_SATELLITE_STYLE,
      center: [-46.633, -23.55],
      zoom: 13,
      interactive: false,
      attributionControl: false,
    })
    const wrapper = document.createElement('div')
    wrapper.style.display = 'flex'
    wrapper.style.flexDirection = 'column'
    wrapper.style.alignItems = 'center'
    const avatarEl = document.createElement('div')
    avatarEl.style.width = '40px'
    avatarEl.style.height = '40px'
    avatarEl.style.borderRadius = '999px'
    avatarEl.style.background = theme.surface.medium
    avatarEl.style.backgroundImage = `url("${contact.avatarUri}")`
    avatarEl.style.backgroundSize = '130%'
    avatarEl.style.backgroundPosition = 'center'
    avatarEl.style.boxShadow = `0 0 0 3px ${theme.surface.secondary}`
    const tail = document.createElement('div')
    tail.style.width = '0'
    tail.style.height = '0'
    tail.style.borderLeft = '6px solid transparent'
    tail.style.borderRight = '6px solid transparent'
    tail.style.borderTop = `8px solid ${theme.surface.secondary}`
    tail.style.marginTop = '-1px'
    wrapper.appendChild(avatarEl)
    wrapper.appendChild(tail)
    new lib.Marker({ element: wrapper, anchor: 'bottom' }).setLngLat([-46.633, -23.55]).addTo(map)
    return () => {
      map.remove()
    }
    // Depende de `contact.avatarUri`, NAO do objeto `contact`.
    //
    // `contacts` e recalculado a cada render em useChatInbox, entao cada
    // setDraft do composer produz objetos ChatContact com identidade nova. Com
    // o objeto nas deps, o efeito rodaria a cada tecla: map.remove() seguido de
    // new Map(), o que faz o painel piscar E refaz o fetch dos tiles de
    // satelite da ESRI, uma requisicao por caractere digitado.
    //
    // avatarUri e o UNICO valor de `contact` que este efeito consome (o centro
    // do mapa e fixo), e e uma string, entao a comparacao passa a ser por valor
    // e sobrevive ao objeto novo.
    //
    // Tambem exclui `theme.surface.secondary` de proposito: o DOM do marker le
    // tokens na construcao, e reconstruir o maplibre por mudanca de tema seria
    // disruptivo pra um token que nao se move em runtime (tema unico escuro).
    // Mesmo trade-off dos mini-mapas de Admin/EmployeeDetails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.avatarUri, lib])
  return (
    <View
      style={{
        height: 177,
        borderRadius: theme.border.radius.m,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <View style={{ position: 'absolute', left: 12, bottom: 12 }}>
        <Button
          label="Mapa completo"
          variant="contained"
          size="small"
          onPress={onOpenFullMap}
          accessibilityLabel="Ver mapa completo"
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ver câmera da posição"
        onPress={() => showToast('Câmera da posição', `Stream ao vivo de ${contact.name}`)}
        style={{
          position: 'absolute',
          right: 12,
          top: 12,
          backgroundColor: theme.surface.high,
          borderRadius: theme.border.radius.m,
          paddingHorizontal: theme.padding.sm,
          paddingVertical: theme.padding.sm,
          alignItems: 'center',
          justifyContent: 'center',
          ...elevation.sm,
        }}
      >
        <Icon name="video_camera_back" size={20} color={theme.content.dark} />
      </Pressable>
    </View>
  )
}

// Right-column profile panel. Avatar + name + role/subtitle
// centered, mini-map, "Tempo até a fadiga total" with reversed gradient bar,
// and a stats card with Gênero / Idade / Tipo sanguíneo / Alergias.
export function ContactInfoPanel({
  contact,
  onOpenFullMap,
}: {
  contact: ChatContact
  onOpenFullMap: () => void
}) {
  const theme = useTheme()
  return (
    // Three vertical anchors distributed via justifyContent:'space-between':
    //   1) User card at the top (avatar + name + role + subtitle)
    //   2) Mini-map floats in the middle of any extra height
    //   3) right-collumn (fadigue bar + stats card) at the bottom
    // This matches the user-requested layout where the map sits in the empty
    // space between the identity block and the fatigue/stats group instead of
    // hugging the user card.
    <View style={{ flex: 1, gap: theme.gap.sm, justifyContent: 'space-between' }}>
      {/* User card: Avatar 56 + centered name + 2-line subtitle. */}
      <View style={{ alignItems: 'center', gap: theme.padding.m }}>
        <Avatar
          uri={contact.avatarUri}
          customSize={56}
          bordered
          borderColor={theme.surface.secondary}
          accessibilityLabel={contact.name}
        />
        <View style={{ width: '100%', alignItems: 'center', gap: 4 }}>
          <Title variant="title.xs" color={theme.content.dark}>
            {contact.name}
          </Title>
          <Text variant="body.m" color={theme.content.dark} style={{ textAlign: 'center' }}>
            {contact.role}
          </Text>
          <Text variant="body.m" color={theme.content.dark} style={{ textAlign: 'center' }}>
            {contact.subtitle}
          </Text>
        </View>
      </View>

      {/* Mini-map: floats in the middle vertical slot via space-between. */}
      <ContactMiniMap contact={contact} onOpenFullMap={onOpenFullMap} />

      {/* Right-collumn group: fadigue-bar + stats card. */}
      <View style={{ gap: theme.gap.m }}>
        {/* Fatigue total. Label, reversed gradient bar
            (success → warning → error), then remaining time below. */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Tempo até a fadiga total
          </Title>
          <div
            style={{
              height: 6,
              width: '100%',
              borderRadius: 999,
              background: `linear-gradient(90deg, ${theme.surface.success} 0%, ${theme.surface.warning} 54.327%, ${theme.surface.error} 100%)`,
            }}
          />
          <Title variant="title.xs" color={theme.content.dark}>
            {contact.fatigueRemaining ?? '—'}
          </Title>
          {/* Fadiga é o único número simulado que sobrou aqui (identidade e
              tipo sanguíneo agora vêm do Profile), selo igual ao resto do painel. */}
          <SimulatedDataBadge />
        </View>

        {/* Stats card sits on surface.medium because the outer RIGHT column
          already uses surface.standard; without the contrast the inner stats
          card would merge into the outer panel. */}
        <View
          style={{
            backgroundColor: theme.surface.medium,
            borderRadius: theme.border.radius.l,
            padding: theme.padding.l,
            gap: theme.gap.s,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: theme.gap.s,
            }}
          >
            <Text
              variant="body.m"
              color={theme.content.dark}
              style={{ fontWeight: '700', fontSize: 16 }}
            >
              Gênero
            </Text>
            <Icon
              name={contact.gender === 'male' ? 'male' : 'female'}
              size={20}
              color={theme.content.dark}
            />
            <Text variant="body.m" color={theme.content.dark}>
              {contact.gender === 'male' ? 'Masculino' : 'Feminino'}
            </Text>
            <Text
              variant="body.m"
              color={theme.content.dark}
              style={{ fontWeight: '700', fontSize: 16 }}
            >
              Idade
            </Text>
            <Text variant="body.m" color={theme.content.dark}>
              {contact.age != null ? `${contact.age} anos` : '—'}
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: theme.gap.s,
            }}
          >
            <Text
              variant="body.m"
              color={theme.content.dark}
              style={{ fontWeight: '700', fontSize: 16 }}
            >
              Tipo sanguíneo
            </Text>
            <Icon name="humidity_mid" size={20} color={theme.content.error} />
            <Text variant="body.m" color={theme.content.dark}>
              {contact.bloodType ?? '—'}
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: theme.gap.s,
            }}
          >
            <Text
              variant="body.m"
              color={theme.content.dark}
              style={{ fontWeight: '700', fontSize: 16 }}
            >
              Alergias
            </Text>
            <Text variant="body.m" color={theme.content.dark}>
              {contact.allergies ?? 'Nenhuma'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  )
}
