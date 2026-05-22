// src/components/ReportCardV2.tsx
// Report card redesign — QA cliente §4. Full-width colored status band on
// top + airy body (date, title, summary) + Responsável (AvatarGroup) and
// Criado por (avatar + name + sector) sections. Replaces the DS ReportCard
// usage in /reports.
import { Pressable, View } from 'react-native'
import { Avatar, AvatarGroup, Text, Title, useTheme } from '@kavicki/swi-design-system'
import type { StatusTagStatus } from '@kavicki/swi-design-system'

import { formatDateShort } from '@/lib/formatDateShort'

type CardStatus = StatusTagStatus

const STATUS_SURFACE: Record<
  CardStatus,
  keyof Pick<ReturnType<typeof useTheme>['surface'], 'success' | 'secondary' | 'warning' | 'error'>
> = {
  accept: 'success',
  info: 'secondary',
  pending: 'warning',
  canceled: 'error',
}

export interface ReportCardV2Props {
  status: CardStatus
  statusLabel: string
  title: string
  summary: string
  creationDate: string
  authorName: string
  authorAvatarUri?: string
  sector: string
  responsibleAvatars: ReadonlyArray<string>
  responsibleTotalCount?: number
  onPress?: () => void
}

export function ReportCardV2({
  status,
  statusLabel,
  title,
  summary,
  creationDate,
  authorName,
  authorAvatarUri,
  sector,
  responsibleAvatars,
  responsibleTotalCount,
  onPress,
}: ReportCardV2Props) {
  const theme = useTheme()
  const bandColor = theme.surface[STATUS_SURFACE[status]]
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
      onPress={onPress}
      style={{
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.l,
        overflow: 'hidden',
        alignSelf: 'stretch',
        width: '100%',
      }}
    >
      {/* Top status band — full-width color strip matching the mockup. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.gap.s,
          paddingHorizontal: theme.padding.m,
          paddingVertical: theme.padding.s,
          backgroundColor: bandColor,
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            backgroundColor: theme.content.light,
          }}
        />
        <Text
          variant="body.s"
          color={theme.content.light}
          style={{
            fontFamily: theme.fontFamily.body,
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {statusLabel}
        </Text>
      </View>

      {/* Body. QA mockup (§4): the colored side accent is SHORT — only
          flanks the date + title sub-block, forming a small "l" together
          with the top band. Summary, Responsáveis and Criado por sit
          neutral below, separated by thin hairlines.
          NOTE on color tokens: this DS names ink by the SURFACE it targets,
          not the ink shade itself. content.dark = ink for dark surfaces
          (near-white #F5F5F5); content.light = ink for light surfaces
          (near-black #222222). Status band + accent stripe sit on bright
          colored bg so they keep content.light; body text on the dark card
          surface uses content.dark / content.medium. */}
      <View style={{ flex: 1, padding: theme.padding.m, gap: theme.gap.m }}>
        {/* Date + title sub-block, flanked by the short colored accent. */}
        <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
          <View
            style={{
              width: 3,
              alignSelf: 'stretch',
              backgroundColor: bandColor,
              borderRadius: 2,
            }}
          />
          <View style={{ flex: 1, gap: theme.gap.xs }}>
            <Text variant="body.s" color={theme.content.medium}>
              {formatDateShort(creationDate)}
            </Text>
            {/* Title reserved to 3 lines so the date+title block has the
                same height on every card, anchoring the description start Y
                across the grid (QA cliente — alinhamento). Longer titles
                truncate with an ellipsis; shorter titles keep the reserved
                empty space for visual breathing room. */}
            <Title
              variant="title.xs"
              color={theme.content.dark}
              numberOfLines={3}
              style={{ lineHeight: 22, minHeight: 66 }}
            >
              {title}
            </Title>
          </View>
        </View>

        {/* Description also reserved to 3 lines so its end Y is consistent
            across cards (QA cliente — alinhamento da descrição). */}
        <Text
          variant="body.m"
          color={theme.content.dark}
          numberOfLines={3}
          style={{ lineHeight: 20, minHeight: 60 }}
        >
          {summary}
        </Text>

        {/* marginTop:'auto' here pushes this hairline + Responsáveis + the
            second hairline + Criado por to the bottom of the (flex:1) body
            as a single unit. Since those 3 blocks have stable heights
            (5 avatars + badge, hairline, avatar+name+sector), Responsáveis
            and Criado por land at the same Y across every card regardless
            of title/summary line variation. */}
        <View
          accessibilityElementsHidden
          style={{
            marginTop: 'auto',
            height: 1,
            backgroundColor: theme.content.medium,
            opacity: 0.2,
          }}
        />

        {/* Responsáveis */}
        <View style={{ gap: theme.gap.s }}>
          <Text
            variant="body.s"
            color={theme.content.dark}
            style={{ fontFamily: theme.fontFamily.body, fontWeight: '700' }}
          >
            Responsáveis:
          </Text>
          <AvatarGroup
            avatars={responsibleAvatars.map((uri) => ({ uri }))}
            totalCount={responsibleTotalCount ?? responsibleAvatars.length}
            maxVisible={4}
            size="s"
            bordered
            borderColor={theme.surface.standard}
          />
        </View>

        <View
          accessibilityElementsHidden
          style={{ height: 1, backgroundColor: theme.content.medium, opacity: 0.2 }}
        />

        {/* Criado por */}
        <View style={{ gap: theme.gap.s }}>
          <Text
            variant="body.s"
            color={theme.content.dark}
            style={{ fontFamily: theme.fontFamily.body, fontWeight: '700' }}
          >
            Criado por:
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
            <Avatar uri={authorAvatarUri} size="s" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                variant="body.s"
                color={theme.content.dark}
                style={{ fontFamily: theme.fontFamily.body, fontWeight: '700' }}
                numberOfLines={1}
              >
                {authorName}
              </Text>
              <Text variant="body.s" color={theme.content.medium} numberOfLines={1}>
                {sector}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  )
}
