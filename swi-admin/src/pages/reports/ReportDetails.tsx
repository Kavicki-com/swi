// src/pages/reports/ReportDetails.tsx
// /reports/:id — Figma 98:4877. Lives inside AppLayout.
//
// Sections (top to bottom):
//   1. Header bar — Voltar + Search + Fazer comentário + Revisar relatório.
//   2. Main report card — full-width variant: status pill + avatar group +
//      Concluído chip + title + Resumo + Data de criação + Autor + sector
//      right + Responsáveis.
//   3. Detalhes do relatório — title + long body paragraph.
//   4. Imagens — row of 3 image thumbnails.
//   5. Atividades — 3 rows each with build icon + title/sector + 3–4 chained
//      StatusTags + chevron.
//   6. Adicionar comentário — textarea + green "Fazer Comentário" CTA.
import { useEffect, useState } from 'react'
import { Image, Pressable, View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Avatar,
  Button,
  Icon,
  Input,
  SearchInput,
  StatusTag,
  Text,
  useTheme,
} from '@kavicki/swi-design-system'
import { reportsApi, type Report, type ReportActivity } from '@/services/mockApi/reports'
import { useDemoToast } from '@/lib/demoToast'
import workerA from '@/assets/avatars/worker-a.png'
import workerB from '@/assets/avatars/worker-b.png'
import workerC from '@/assets/avatars/worker-c.png'

// Avatar group (small overlapping circles) — Figma "Avatar Group" element
// at the top of the main report card. 4 avatars + "+13" counter pill.
function AvatarGroup() {
  const theme = useTheme()
  const avatars = [workerA, workerB, workerC, workerA]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {avatars.map((uri, i) => (
        <View
          key={i}
          style={{
            marginLeft: i === 0 ? 0 : -8,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: theme.surface.standard,
          }}
        >
          <Avatar uri={uri} customSize={32} accessibilityLabel={`Membro ${i + 1}`} />
        </View>
      ))}
      <View
        style={{
          marginLeft: -8,
          width: 32,
          height: 32,
          borderRadius: 999,
          backgroundColor: theme.surface.error,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: theme.surface.standard,
        }}
      >
        <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
          +13
        </Text>
      </View>
    </View>
  )
}

// Small overlapping avatar group — used inside ActivityRow. Last circle is
// an overflow counter ("+13") when overflowCount is set. alignSelf:'center'
// keeps the row vertically centered against the title/sector/progress
// stack on its left (which is taller than the avatar pills).
function ActivityAvatars({
  avatars,
  overflowCount,
}: {
  avatars: ReadonlyArray<string>
  overflowCount?: number
}) {
  const theme = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
      }}
    >
      {avatars.map((uri, i) => (
        <View
          key={i}
          style={{
            marginLeft: i === 0 ? 0 : -8,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: theme.surface.standard,
          }}
        >
          <Avatar uri={uri} customSize={32} accessibilityLabel={`Membro ${i + 1}`} />
        </View>
      ))}
      {overflowCount ? (
        <View
          style={{
            marginLeft: -8,
            width: 32,
            height: 32,
            borderRadius: 999,
            backgroundColor: theme.surface.secondary,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: theme.surface.standard,
          }}
        >
          <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
            +{overflowCount}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

// One activity row — Figma "Atividades" list. Layout per Figma reference:
// wrench icon | vertical divider | title + sector + progress bar | avatar
// group (overlapping) | location_on icon button (right).
function ActivityRow({
  activity,
  onLocation,
}: {
  activity: ReportActivity
  onLocation: () => void
}) {
  const theme = useTheme()
  const barColor =
    activity.tone === 'success'
      ? theme.surface.success
      : activity.tone === 'warning'
        ? theme.surface.warning
        : theme.surface.error
  return (
    <View
      style={{
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.gap.m,
      }}
    >
      {/* Wrench icon — Figma uses `build` (outlined), not `build_filled`. */}
      <Icon name="build" size={24} color={theme.content.dark} />

      {/* Vertical divider — content.lightGrey, ~32 tall. */}
      <View style={{ width: 1, height: 32, backgroundColor: theme.content.lightGrey }} />

      {/* Title + sector + progress bar stack. */}
      <View style={{ flex: 1, gap: theme.gap.xs }}>
        <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '500' }}>
          {activity.title}
        </Text>
        <Text variant="body.s" color={theme.content.medium}>
          {activity.sector}
        </Text>
        {/* Progress bar — 4px tall, partial fill in tone color, track in
            theme.surface.medium for the remaining segment. */}
        <View
          style={{
            width: 120,
            height: 4,
            borderRadius: 999,
            backgroundColor: theme.surface.medium,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.min(100, Math.max(0, activity.progress))}%`,
              height: '100%',
              backgroundColor: barColor,
              borderRadius: 999,
            }}
          />
        </View>
      </View>

      {/* Avatar group on the right of the body. */}
      <ActivityAvatars avatars={activity.avatars} overflowCount={activity.overflowCount} />

      {/* Location pin button — Figma renders a flat icon on the far right. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Localização: ${activity.title}`}
        onPress={onLocation}
        style={{
          paddingHorizontal: theme.padding.s,
          paddingVertical: theme.padding.s,
        }}
      >
        <Icon name="location_on_filled" size={24} color={theme.content.dark} />
      </Pressable>
    </View>
  )
}

export function ReportDetails() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const { id } = useParams<{ id: string }>()
  const [report, setReport] = useState<Report | null>(null)
  const [search, setSearch] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    reportsApi.get(id).then(({ data }) => {
      if (!cancelled) setReport(data)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (!report) {
    return (
      <View testID="report-details-loading" style={{ padding: 24 }}>
        <Text variant="body.m" color={theme.content.dark}>
          Carregando…
        </Text>
      </View>
    )
  }

  return (
    <View testID="report-details" style={{ gap: theme.gap.l }}>
      {/* Section 1 — Header bar. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
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

        <View style={{ flex: 1 }}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="Pesquisar no relatório"
            onClear={() => setSearch('')}
          />
        </View>

        <Button
          label="Fazer comentário"
          variant="outline"
          iconLeft={<Icon name="chat_bubble" size={20} color={theme.content.primaryLight} />}
          accessibilityLabel="Adicionar comentário"
          onPress={() => showToast('Foque no campo Adicionar comentário abaixo')}
        />
        <Button
          label="Revisar relatório"
          variant="outline"
          iconLeft={<Icon name="edit" size={20} color={theme.content.primaryLight} />}
          accessibilityLabel="Revisar relatório"
          onPress={() => showToast('Modo revisão iniciado', 'Relatório aberto para edição')}
        />
      </View>

      {/* Section 2 — Main report card (full-width). */}
      <View
        style={{
          backgroundColor: theme.surface.standard,
          borderRadius: theme.border.radius.l,
          padding: theme.padding.m,
          gap: theme.gap.m,
        }}
      >
        {/* Top row — current status + avatar group + Concluído chip right. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m }}>
            <StatusTag status={report.status} label={report.statusLabel} />
            <AvatarGroup />
          </View>
          <StatusTag status="accept" label="Concluído" />
        </View>

        {/* Title in content.primary green — matches DS Title styled. */}
        <Text
          variant="body.m"
          color={theme.content.primary}
          style={{ fontFamily: theme.fontFamily.title, fontWeight: '700', fontSize: 20 }}
        >
          {report.title}
        </Text>

        {/* Resumo. */}
        <View style={{ gap: theme.gap.xs }}>
          <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
            Resumo
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {report.summary}
          </Text>
        </View>

        {/* Data de criação. */}
        <View style={{ gap: theme.gap.xs }}>
          <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
            Data de criação
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {report.creationDate}
          </Text>
        </View>

        {/* Autor row — avatar + name on left, sector pill on right. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ gap: theme.gap.xs }}>
            <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
              Autor
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
              <Avatar
                uri={report.authorAvatarUri}
                customSize={32}
                accessibilityLabel={report.authorName}
              />
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '500' }}>
                {report.authorName}
              </Text>
            </View>
          </View>
          <Text variant="body.m" color={theme.content.secondary} style={{ fontWeight: '700' }}>
            {report.sector}
          </Text>
        </View>

        {/* Responsáveis. */}
        <View style={{ gap: theme.gap.xs }}>
          <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
            Responsáveis
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {report.responsibles}
          </Text>
        </View>
      </View>

      {/* Section 3 — Detalhes do relatório. */}
      <View style={{ gap: theme.gap.s }}>
        <Text
          variant="body.m"
          color={theme.content.primary}
          style={{ fontFamily: theme.fontFamily.title, fontWeight: '700', fontSize: 20 }}
        >
          Detalhes do relatório:
        </Text>
        <Text variant="body.m" color={theme.content.dark}>
          {report.details ?? ''}
        </Text>
      </View>

      {/* Section 4 — Imagens (3 thumbnails). */}
      <View style={{ gap: theme.gap.s }}>
        <Text
          variant="body.m"
          color={theme.content.primary}
          style={{ fontFamily: theme.fontFamily.title, fontWeight: '700', fontSize: 20 }}
        >
          Imagens
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.gap.m }}>
          {(report.images ?? []).map((uri, i) => (
            <View
              key={i}
              style={{
                width: 320,
                height: 180,
                borderRadius: theme.border.radius.m,
                overflow: 'hidden',
                backgroundColor: theme.surface.high,
              }}
            >
              <Image
                source={{ uri }}
                style={{ width: '100%', height: '100%' }}
                accessibilityLabel={`Imagem ${i + 1}`}
              />
            </View>
          ))}
        </View>
      </View>

      {/* Section 5 — Atividades. */}
      <View style={{ gap: theme.gap.s }}>
        <Text
          variant="body.m"
          color={theme.content.dark}
          style={{ fontWeight: '700', fontSize: 16 }}
        >
          Atividades
        </Text>
        <View style={{ gap: theme.gap.s }}>
          {(report.activities ?? []).map((a) => (
            <ActivityRow
              key={a.id}
              activity={a}
              onLocation={() => navigate('/maps/general')}
            />
          ))}
        </View>
      </View>

      {/* Section 6 — Adicionar comentário. */}
      <View style={{ gap: theme.gap.s }}>
        <Text
          variant="body.m"
          color={theme.content.dark}
          style={{ fontWeight: '700', fontSize: 16 }}
        >
          Adicionar comentário
        </Text>
        <Input
          value={comment}
          onChangeText={setComment}
          placeholder="Digite aqui o seu comentário"
          multiline
          numberOfLines={4}
        />
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label="Fazer comentário"
            variant="contained"
            accessibilityLabel="Enviar comentário"
          />
        </View>
      </View>
    </View>
  )
}
