// Helpers de anexo compartilhados pelas telas de relatório.

// Nome do arquivo a partir de uma URL (último segmento, sem query), só pra
// rotular a linha de um anexo e dar um nome ao arquivo baixado. Sem segmento
// usável devolve undefined, e quem chama cai num rótulo por posição.
export function fileNameFromUrl(url: string): string | undefined {
  try {
    const path = url.split('?')[0] ?? url
    const last = path.split('/').pop()
    return last ? decodeURIComponent(last) : undefined
  } catch {
    return undefined
  }
}

// Baixa uma URL presigned com o nome dado. O caminho normal busca o arquivo e
// dispara uma âncora de download; se o fetch falha (o CORS do bucket costuma
// barrar, e aí não há como forçar o download no navegador), ao menos abre a
// URL numa aba nova pra salvar à mão.
export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`status ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    a.rel = 'noopener'
    a.click()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}
