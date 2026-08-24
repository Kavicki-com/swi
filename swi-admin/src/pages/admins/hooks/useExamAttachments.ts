// src/pages/admins/hooks/useExamAttachments.ts
// Anexo de exame clínico no formulário de cadastro/edição de usuário.
//
// São duas máquinas de estado, e é a existência do usuário que separa as duas.
// Na EDIÇÃO o cadastro já existe, então o exame sobe na hora, igual ao settings.
// No CADASTRO ainda não há id a quem anexar, então o exame fica numa fila e só
// sobe depois do create devolver o id. Subir antes deixaria arquivo órfão no
// bucket toda vez que alguém abandonasse o formulário.
import { useRef, useState, type ChangeEvent } from 'react'
import { adminsApi, employeesApi } from '@/services/api/users'
import { toCalendarDate } from '@/services/api/examCard'
import { uploadImage } from '@/services/api/upload'
import type { Exam } from '@/services/api/exams'

type Opcoes = {
  isEdit: boolean
  editandoId: string | undefined
  subject: 'administrador' | 'funcionário'
  showToast: (title: string, message?: string) => void
}

export function useExamAttachments({ isEdit, editandoId, subject, showToast }: Opcoes) {
  // Exames. `gravados` são os que já estão no cadastro (só na edição);
  // `pendentes` são os escolhidos antes do usuário existir, que esperam o
  // create pra ter a quem ser anexados.
  const [gravados, setGravados] = useState<readonly Exam[]>([])
  const [pendentes, setPendentes] = useState<
    readonly { name: string; date: string; file: File }[]
  >([])
  const [examName, setExamName] = useState('')
  const [examDate, setExamDate] = useState('')
  const [examError, setExamError] = useState<string | null>(null)
  const [examsBusy, setExamsBusy] = useState(false)
  const examInputRef = useRef<HTMLInputElement>(null)

  // Só abre o seletor com nome e validade preenchidos: o ExamInfoCard desenha
  // os dois, e sem eles o arquivo subiria pra virar um card sem identidade.
  const pedirArquivo = () => {
    if (!examName.trim()) {
      setExamError('Informe o nome do exame.')
      return
    }
    if (!toCalendarDate(examDate)) {
      setExamError('Validade inválida: use dd/mm/aaaa.')
      return
    }
    setExamError(null)
    examInputRef.current?.click()
  }

  // Um exame por vez: nome e validade são de UM laudo, e um seletor múltiplo os
  // aplicaria igual a todos os arquivos.
  const onArquivoEscolhido = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const nome = examName.trim()
    const date = toCalendarDate(examDate)
    if (!file || !nome || !date) return

    // Cadastro: o usuário ainda não existe, então não há a quem anexar. Fica na
    // fila e sobe no submit, DEPOIS do create devolver o id. Subir agora
    // deixaria arquivo órfão no bucket sempre que o formulário fosse abandonado.
    if (!isEdit || !editandoId) {
      setPendentes((prev) => [...prev, { name: nome, date, file }])
      setExamName('')
      setExamDate('')
      return
    }

    // Edição: o cadastro existe, então o exame sobe na hora, igual ao settings.
    setExamsBusy(true)
    try {
      const api = subject === 'funcionário' ? employeesApi : adminsApi
      const fileKey = await uploadImage(file, 'exams')
      const { data, error: erro } = await api.addExam(editandoId, { name: nome, date, fileKey })
      if (erro || !data) {
        setExamError(erro?.message ?? 'Falha ao enviar o exame.')
      } else {
        setGravados((prev) => [data, ...prev])
        setExamName('')
        setExamDate('')
      }
    } catch (err) {
      setExamError(err instanceof Error ? err.message : 'Falha ao enviar o exame.')
    }
    setExamsBusy(false)
  }

  // Descarga da fila, chamada só depois do create ter dado certo. Best-effort:
  // o cadastro JÁ existe, então falha de anexo não pode desfazê-lo nem virar
  // erro de cadastro. O que falhar é dito no toast, com o cadastro de pé.
  const enviarPendentes = async (novoId: string) => {
    const api = subject === 'funcionário' ? employeesApi : adminsApi
    let falhas = 0
    for (const p of pendentes) {
      try {
        const fileKey = await uploadImage(p.file, 'exams')
        const { error: erro } = await api.addExam(novoId, {
          name: p.name,
          date: p.date,
          fileKey,
        })
        if (erro) falhas += 1
      } catch {
        falhas += 1
      }
    }
    if (falhas > 0) {
      showToast('Cadastro salvo, exames pendentes', `${falhas} exame(s) não subiram. Anexe pela edição.`)
    }
  }


  return {
    gravados,
    definirGravados: setGravados,
    pendentes,
    examName,
    setExamName,
    examDate,
    setExamDate,
    examError,
    examsBusy,
    inputRef: examInputRef,
    pedirArquivo,
    onArquivoEscolhido,
    enviarPendentes,
  }
}
