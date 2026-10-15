// Seção "Anexos" do detalhe do relatório. Só compõe o DS: a lista de anexos,
// o ImageViewer para imagem e o MediaPlayer para vídeo e áudio. Cada tipo abre
// do seu jeito no "Visualizar": imagem em tamanho grande, vídeo e áudio no
// player abaixo da lista, PDF em nova aba (o leitor de PDF do navegador). Todos
// baixam pelo "Baixar".
import { useState } from 'react'
import { View } from 'react-native'
import {
  AttachmentList,
  ImageViewer,
  MediaPlayer,
  Title,
  useTheme,
  type AttachmentItem,
} from '@kavicki/swi-design-system'
import { downloadFile } from '@/lib/attachments'
import type { ReportAttachment } from '@/services/api/reports'
import { attachmentItems } from '../reportAttachments'

type Props = {
  attachments: ReadonlyArray<ReportAttachment>
  /** Prefixo dos testIDs: `<testID>-attachments`, `-viewer`, `-player`. */
  testID: string
}

type Open = { attachment: ReportAttachment; title: string }

export function ReportAttachments({ attachments, testID }: Props) {
  const theme = useTheme()
  const [viewing, setViewing] = useState<Open | null>(null)
  const [playing, setPlaying] = useState<Open | null>(null)

  if (attachments.length === 0) return null

  const items = attachmentItems(attachments, ['view', 'download'])
  // O id da linha é a posição (att_<i>), então a volta é direta.
  const attachmentOf = (item: AttachmentItem) => attachments[Number(item.id.slice('att_'.length))]

  const view = (item: AttachmentItem) => {
    const attachment = attachmentOf(item)
    if (!attachment) return
    if (attachment.kind === 'image') setViewing({ attachment, title: item.name })
    else if (attachment.kind === 'document') window.open(attachment.url, '_blank', 'noopener')
    else setPlaying({ attachment, title: item.name })
  }

  return (
    <View style={{ gap: theme.gap.s }}>
      <Title variant="title.s" color={theme.content.primary}>
        Anexos
      </Title>
      <AttachmentList
        items={items}
        onView={view}
        onDownload={(item) => {
          const attachment = attachmentOf(item)
          if (attachment) void downloadFile(attachment.url, item.name)
        }}
        testID={`${testID}-attachments`}
      />
      {playing ? (
        <MediaPlayer
          // key: trocar de anexo remonta o player, que zera o erro e o tempo.
          key={playing.attachment.url}
          kind={playing.attachment.kind === 'audio' ? 'audio' : 'video'}
          uri={playing.attachment.url}
          title={playing.title}
          testID={`${testID}-player`}
        />
      ) : null}
      <ImageViewer
        visible={viewing !== null}
        uri={viewing?.attachment.url ?? null}
        title={viewing?.title ?? ''}
        onClose={() => setViewing(null)}
        onDownload={() => {
          if (viewing) void downloadFile(viewing.attachment.url, viewing.title)
        }}
        testID={`${testID}-viewer`}
      />
    </View>
  )
}
