import { batteryLowCopy } from './rootNotice';

// No Android a leitura vem de uma pulseira (Health Connect ou Bluetooth); no
// iPhone, do relógio. O aviso de bateria fala do aparelho que a pessoa usa.

describe('batteryLowCopy: pulseira no Android', () => {
  it('com número', () => {
    expect(batteryLowCopy(12, 'pulseira')).toEqual({
      title: 'Bateria da pulseira baixa',
      message: 'Bateria em 12%. Carregue a pulseira para seguir monitorado.',
    });
  });

  it('sem número', () => {
    expect(batteryLowCopy(null, 'pulseira')).toEqual({
      title: 'Bateria da pulseira baixa',
      message: 'Carregue a pulseira para seguir monitorado.',
    });
  });
});

describe('batteryLowCopy: relógio no iPhone', () => {
  it('segue o texto da notificação do servidor', () => {
    expect(batteryLowCopy(12, 'relogio')).toEqual({
      title: 'Bateria do relógio baixa',
      message: 'Bateria em 12%. Carregue o relógio para seguir monitorado.',
    });
  });
});
