// src/components/UserDetailsMenu.tsx
// Fullscreen modal triggered by the topbar avatar (QA cliente §1.1).
// Two-column layout: profile + heart pulse on the left, vitals + animated
// progress bars on the right, sitting over a looping video backdrop. Port
// of the client reference software/dashboard.html (`row-menu` + overlay).
//
// Portado do demo (branch feat/admin-real-maps-and-fixes) em 2026-07-28: a
// feature ficou órfã naquele branch quando o painel migrou pro backend real.
// Diferenças do original: o avatar grande navega pra /user/profile (rota
// deste painel; /user/settings era do demo) e os vitais vêm do gerador
// determinístico compartilhado com o header (ver adminVitals.ts).
//
// Interaction:
//  - ESC or click on the dim backdrop calls onClose.
//  - The large avatar (140 px) inside the menu keeps the "avatar opens the
//    profile page" affordance — the small topbar avatar now only opens this
//    menu.
import { useEffect, useRef } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import { Avatar, Logo, ProgressBar, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useAdminVitals } from '@/services/mockApi/adminVitals'
import { HeartPulseCanvas } from '@/components/HeartPulseCanvas'
import workerA from '@/assets/avatars/worker-a.png'

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

  const fullName = user?.full_name ?? 'Administrador'
  const fatigueLabel = `${vitals.fatigueHours}horas, ${vitals.fatigueMinutes} minutos`
  const temperatureLabel = `${vitals.temperature.toString().replace('.', ',')}°C, ${vitals.temperatureLabel}`

  // Rótulo em caixa alta da coluna da esquerda. Extraído porque estava copiado
  // em quatro lugares, e cada cópia carregava o próprio `fontSize: 14` cravado.
  // `letterSpacing` fica literal: a escala do DS não tem token de tracking.
  const labelStyle = {
    fontSize: theme.fontSize.m,
    fontWeight: '500' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  }

  return (
    <View
      // RN typings don't include 'dialog' even though it's a valid ARIA
      // role on web (RN-Web passes it through). Cast keeps the
      // accessibility semantics without breaking the prod build.
      accessibilityRole={'dialog' as 'menu'}
      accessibilityLabel="Detalhes do usuário"
      style={{
        // position:'fixed' ancora no viewport (não no AppLayout que se
        // estende além de 900px). Isso garante que o vídeo cubra a tela
        // inteira e fique acima de todo o chrome do header.
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
            // 20 fica literal: a escala de gap do DS pula de m (16) pra l (24).
            // O 20 existe em padding.ml, mas usar token de padding num gap
            // seria trocar o valor certo pela semântica errada.
            gap: 20,
            width: 459,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir perfil do usuário"
            onPress={() => {
              onClose()
              navigate('/user/profile')
            }}
            style={{
              width: 140,
              height: 140,
              borderRadius: theme.border.radius.pill,
              borderWidth: theme.border.size.m,
              borderColor: theme.surface.success,
              overflow: 'hidden',
            }}
          >
            {/* Mesmo fallback do widget do header: sem ele o círculo abria
                vazio quando a sessão não traz avatarUri (QA 2026-07-29). */}
            <Avatar uri={user?.avatarUri ?? workerA} customSize={140} />
          </Pressable>

          {/* Content column to the right of the avatar — everything else
              stacks here in a single vertical flow. */}
          <View style={{ flex: 1, alignItems: 'flex-start', gap: theme.gap.xs }}>
            <Title variant="title.l" color={theme.content.dark}>
              {fullName}
            </Title>
            <Text color={theme.content.medium} style={labelStyle}>
              {vitals.role}
            </Text>
            <Text color={theme.content.medium} style={labelStyle}>
              {vitals.sector}
            </Text>
            <Text color={theme.content.medium} style={{ ...labelStyle, marginTop: theme.gap.s }}>
              Batimentos cardíacos:
            </Text>
            <View
              style={{
                // Match exato do `.numero-batimentos` da referência
                // (software/style.css linhas 720-732): 180×40, centro
                // vertical+horizontal, border-radius 6. As três medidas ficam
                // literais porque são do porte pixel-a-pixel e não existem na
                // escala do DS (os raios são 2, 4, 8, 16, pill).
                width: 180,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                backgroundColor: theme.surface.standard,
                marginTop: theme.gap.xs,
              }}
            >
              <Text
                variant="body.m"
                color={theme.content.dark}
                style={{
                  fontFamily: theme.fontFamily.title,
                  fontWeight: '700',
                  fontSize: theme.fontSize.l,
                }}
              >
                {vitals.heartRate}bpm
              </Text>
            </View>
            {/* Canvas em 295×147, medida do `#canvasBatimentos` da referência
                (dashboard.html a 1366 vp).

                A cor saiu do hex `#084614` da referência para
                `theme.surface.success`. Motivo: `#084614` não existe na paleta
                do DS (os verdes são green[950] `#112719` e surface.success
                `#3EAB2E`), então não havia token para onde tokenizá-lo. Era
                também a intenção declarada no comentário do próprio
                HeartPulseCanvas, que o call site nunca cumpriu. Efeito
                colateral bem-vindo: a linha do ECG passa a usar o MESMO verde
                do fill das barras de progresso ao lado. */}
            <View style={{ marginTop: theme.gap.s }}>
              <HeartPulseCanvas width={295} height={147} color={theme.surface.success} />
            </View>
            <Text color={theme.content.medium} style={{ ...labelStyle, marginTop: theme.gap.s }}>
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
      {/* ProgressBar do DS no modo inset (v0.1.128). Antes daqui vivia um
          AnimatedProgressBar.tsx local, criado porque o DS só tinha o track
          flat e o bordered — exatamente a violação que a regra do DS proíbe, e
          a mesma que o mobile já cometera com uma cópia do ProgressBar. O bump
          adicionou inset/trackRadius/animated e a cópia morreu.
          O wrapper de 300px preserva a largura da referência do cliente; sem
          ele o track esticaria pros 401px da coluna. */}
      <View style={{ width: 300 }}>
        <ProgressBar
          value={percent}
          animated
          inset={2}
          trackHeight={12}
          trackRadius={3}
          trackColor={theme.content.dark}
          color={theme.surface.success}
          accessibilityLabel={label}
        />
      </View>
    </View>
  )
}
