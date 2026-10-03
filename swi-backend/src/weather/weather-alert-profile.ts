// Perfil dos alertas meteorológicos: todos os limiares num lugar só.
//
// Os números seguem as escalas oficiais que os serviços de alerta usam (INMET
// para chuva e vento, OMS para UV, NWS para calor), mapeadas para as duas
// gravidades do sistema: ATENCAO pede cuidado, PERIGO pede interromper a
// atividade exposta. Mudar um número aqui muda a regra inteira, sem tocar na
// avaliação.
export const WEATHER_ALERT_PROFILE = Object.freeze({
  /**
   * Quantas horas à frente a avaliação olha, contando a hora em curso. Curto
   * de propósito: alerta é para o que afeta o turno agora, não para a semana.
   */
  horizonHours: 6,

  /**
   * Chuva, em mm por hora. Escala do INMET: perigo potencial de 20 a 30 mm/h,
   * perigo de 30 a 60 mm/h, grande perigo acima de 60 mm/h. Perigo potencial
   * vira ATENCAO; perigo e grande perigo viram PERIGO.
   */
  rainAttentionMmPerHour: 20,
  rainDangerMmPerHour: 30,

  /**
   * Probabilidade mínima de precipitação para a chuva virar alerta. Evita
   * alarme por um volume previsto com pouca chance de acontecer.
   */
  rainMinProbabilityPct: 50,

  /**
   * Códigos WMO de tempo presente (tabela 4677, como o Open-Meteo os publica):
   * 95 trovoada, 96 e 99 trovoada com granizo.
   */
  thunderstormCodes: Object.freeze([95, 96, 99] as const),
  thunderstormHailCodes: Object.freeze([96, 99] as const),

  /**
   * Rajada que agrava a tempestade para PERIGO, em km/h. Escala de vento do
   * INMET: perigo de 60 a 100 km/h, grande perigo acima de 100 km/h.
   */
  gustDangerKmh: 60,

  /**
   * Índice ultravioleta. Escala da OMS: 8 a 10 é muito alto (ATENCAO), 11 ou
   * mais é extremo (PERIGO).
   */
  uvAttention: 8,
  uvDanger: 11,

  /**
   * Sensação térmica, em °C. Faixas do índice de calor do NWS, as que a OSHA
   * usa para trabalho ao ar livre: cautela extrema de 32,8 a 39,4 °C (91 a
   * 103 °F) vira ATENCAO; perigo a partir de 39,4 °C (103 °F) vira PERIGO. A
   * sensação térmica do Open-Meteo não é o mesmo cálculo do índice de calor
   * do NWS, mas é a aproximação disponível.
   */
  apparentTempAttentionC: 32.8,
  apparentTempDangerC: 39.4,

  /**
   * Tipos que só viram notificação em PERIGO. Em região quente o sol intenso
   * fica em ATENCAO quase todo dia: aviso diário deixa de ser lido. A ATENCAO
   * desses tipos segue na resposta do clima, visível na tela.
   */
  notifyOnlyOnDanger: Object.freeze(['SOL_INTENSO'] as const),
})
