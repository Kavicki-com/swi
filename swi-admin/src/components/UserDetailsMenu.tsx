// src/components/UserDetailsMenu.tsx
// Fullscreen modal triggered by the topbar avatar (QA cliente §1.1).
// Two-column layout: profile + heart pulse on the left, vitals + animated
// progress bars on the right, sitting over a looping video backdrop. Port
// of the client reference software/dashboard.html (`row-menu` + overlay).
//
// Interaction:
//  - ESC or click on the dim backdrop calls onClose.
//  - The large avatar (140 px) inside the menu is Pressable and preserves
//    the previous "avatar opens /user/settings" affordance — the small
//    topbar avatar now only opens this menu.
import { useEffect, useRef } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import { Avatar, Logo, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useAdminVitals } from '@/services/mockApi/adminVitals'
import { AnimatedProgressBar } from '@/components/AnimatedProgressBar'
import { HeartPulseCanvas } from '@/components/HeartPulseCanvas'

export interface UserDetailsMenuProps {
  open: boolean
  onClose: () => void
}

export function UserDetailsMenu({ open, onClose }: UserDetailsMenuProps) {
  const theme = useTheme()
  const navigate = useNavigate()
  const { user } = useAuth()
  const vitals = useAdminVitals()
  // Keep a ref so the video can be paused programmatically when it ends —
  // HTML5 video naturally freezes on the last frame after ended without
  // loop, but holding a ref lets us also force pause() if the browser
  // behaves differently or we need to re-show the menu later.
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // ESC closes the menu. Bind only while open so the listener isn't always
  // sitting on document.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const fullName = user?.full_name ?? 'Carlos Augusto'
  const fatigueLabel = `${vitals.fatigueHours}horas, ${vitals.fatigueMinutes} minutos`
  const temperatureLabel = `${vitals.temperature.toString().replace('.', ',')}°C, ${vitals.temperatureLabel}`

  return (
    <View
      // RN typings don't include 'dialog' even though it's a valid ARIA
      // role on web (RN-Web passes it through). Cast keeps the
      // accessibility semantics without breaking the prod build.
      accessibilityRole={'dialog' as 'menu'}
      accessibilityLabel="Detalhes do usuário"
      style={{
        // position:'fixed' ancora no viewport (não no AppLayout que se
        // estende além de 900px). Isso: (a) cobre o DemoBanner visualmente,
        // (b) garante que o vídeo seja renderizado em 1366×900 ao invés de
        // 1351×1220 (smartband sai do tamanho ampliado), (c) cobre tudo no
        // top-z.
        position: 'fixed' as 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9000,
        // Conteúdo alinhado ao topo (não vertical-centralizado) começando
        // em y=128 — bate com o reference (.row-menu top:50% mas
        // visualmente o conteúdo entra logo abaixo do header chrome).
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 128,
      }}
    >
      {/* Video backdrop + dim overlay. Pressable wrapper closes on click
          outside the central content. */}
      <Pressable
        accessibilityLabel="Fechar menu"
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {/* QA cliente: video plays ONCE (no `loop`) and freezes on the
            final frame — onEnded explicitly pauses so the static smartband
            stays as a still backdrop. */}
        <video
          ref={videoRef}
          src="/user-menu-bg.mp4"
          autoPlay
          muted
          playsInline
          onEnded={() => {
            const v = videoRef.current
            if (v) v.pause()
          }}
          style={{
            position: 'absolute',
            // Exact same sizing as the reference dashboard.html
            // (#headerVideo: full viewport, no shift). objectFit: cover
            // centers the smartband automatically given the native 1280×720
            // video aspect vs the container aspect.
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center center',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            // Dim escurecido de 0.6 → 0.78 pra que a pulseira não compita
            // com o texto da coluna direita (vitals ficam mais legíveis
            // sobre o vídeo).
            backgroundColor: 'rgba(0, 0, 0, 0.78)',
          }}
        />
      </Pressable>

      {/* SWI logo top-left, Pressable → dashboard. `left: 200` alinha o
          logo verticalmente com o INÍCIO (borda esquerda) do avatar grande
          no left column (que começa em x≈200 com o paddingHorizontal do
          row-menu). */}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Ir para o dashboard"
        onPress={() => {
          onClose()
          navigate('/')
        }}
        style={{
          position: 'absolute',
          top: theme.padding.l,
          left: 200,
          zIndex: 1,
        }}
      >
        <Logo type="complete" size="m" color={theme.content.dark} />
      </Pressable>

      {/* Central content — row-menu full-width com paddingHorizontal:200
          pra puxar as colunas FORTEMENTE pra dentro, deixando-as próximas
          do smartband central (em vez de coladas nas bordas). */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          width: '100%',
          paddingHorizontal: 200,
        }}
        onStartShouldSetResponder={() => true}
      >
        {/* Column 1 — `.coluna-smartband` left at 459 px wide. Internal
            structure mirrors the reference `.batimentos` row: avatar on the
            left + a single content column on the right (`.column`)
            stacking nome/cargo/setor/label/pill/canvas/status/condições in
            one vertical flow. Everything in the content column anchors to
            the same x=232 in the canvas, matching the reference. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 20,
            width: 459,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir configurações do perfil"
            onPress={() => {
              onClose()
              navigate('/user/settings')
            }}
            style={{
              width: 140,
              height: 140,
              borderRadius: 999,
              borderWidth: 2,
              borderColor: theme.surface.success,
              overflow: 'hidden',
            }}
          >
            <Avatar uri={user?.avatarUri} customSize={140} />
          </Pressable>

          {/* Content column to the right of the avatar — everything else
              stacks here in a single vertical flow. */}
          <View style={{ flex: 1, alignItems: 'flex-start', gap: 4 }}>
            <Title variant="title.l" color={theme.content.dark}>
              {fullName}
            </Title>
            <Text
              color={theme.content.medium}
              style={{
                fontSize: 14,
                fontWeight: '500',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {vitals.role}
            </Text>
            <Text
              color={theme.content.medium}
              style={{
                fontSize: 14,
                fontWeight: '500',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {vitals.sector}
            </Text>
            <Text
              color={theme.content.medium}
              style={{
                fontSize: 14,
                fontWeight: '500',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginTop: theme.gap.s,
              }}
            >
              Batimentos cardíacos:
            </Text>
            <View
              style={{
                // Match exato do `.numero-batimentos` da referência
                // (software/style.css linhas 720-732): 180×40, centro
                // vertical+horizontal, border-radius 6.
                width: 180,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                backgroundColor: theme.surface.standard,
                marginTop: 4,
              }}
            >
              <Text
                variant="body.m"
                color={theme.content.dark}
                style={{ fontFamily: theme.fontFamily.title, fontWeight: '700', fontSize: 24 }}
              >
                {vitals.heartRate}bpm
              </Text>
            </View>
            {/* Canvas matches reference 295×147 (measured `#canvasBatimentos`
                in dashboard.html at 1366 vp). Color #084614 from
                software/dashboard.html line 970. */}
            <View style={{ marginTop: theme.gap.s }}>
              <HeartPulseCanvas width={295} height={147} color="#084614" />
            </View>
            <Text
              color={theme.content.medium}
              style={{
                fontSize: 14,
                fontWeight: '500',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginTop: theme.gap.s,
              }}
            >
              status:
            </Text>
            <Title
              variant="title.l"
              color={theme.content.primary}
              style={{ fontSize: 48, lineHeight: 56, fontWeight: '700' }}
            >
              {vitals.status}
            </Title>
          </View>
        </View>

        {/* Column 2 — vitals stack. Width 401 px casa com a medição do
            `.coluna-smartband` direito da referência (dashboard.html a
            1366 vp). Stacking natural com gap.m entre blocos — começa
            alinhada no top junto com a coluna 1. */}
        <View style={{ width: 401, gap: theme.gap.m }}>
          <VitalBlock
            label="Movimentos por minuto:"
            value={`${vitals.mpm} mpm`}
            percent={vitals.mpmPercent}
          />
          <View
            accessibilityElementsHidden
            style={{ height: 1, backgroundColor: theme.content.medium, opacity: 0.2 }}
          />
          <VitalBlock
            label="tempo estimado para atingir fadiga:"
            value={fatigueLabel}
            percent={vitals.fatiguePercent}
          />
          <View
            accessibilityElementsHidden
            style={{ height: 1, backgroundColor: theme.content.medium, opacity: 0.2 }}
          />
          <VitalBlock
            label="temperatura corporal:"
            value={temperatureLabel}
            percent={vitals.temperaturePercent}
          />
          <View
            accessibilityElementsHidden
            style={{ height: 1, backgroundColor: theme.content.medium, opacity: 0.2 }}
          />
          <VitalBlock
            label="bateria da smartband"
            value={`${vitals.battery}%`}
            percent={vitals.batteryPercent}
          />
        </View>
      </View>
    </View>
  )
}

function VitalBlock({ label, value, percent }: { label: string; value: string; percent: number }) {
  const theme = useTheme()
  return (
    <View style={{ gap: theme.gap.s }}>
      <Text
        variant="body.s"
        color={theme.content.medium}
        style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
      >
        {label}
      </Text>
      <Text
        variant="body.m"
        color={theme.content.dark}
        style={{ fontFamily: theme.fontFamily.title, fontWeight: '700', fontSize: 40 }}
      >
        {value}
      </Text>
      <AnimatedProgressBar percent={percent} />
    </View>
  )
}
