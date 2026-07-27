import { errorMessage } from './errorMessage';

const withStatus = (message: string, status: number) => {
  const err = new Error(message);
  (err as any).status = status;
  return err;
};

describe('errorMessage', () => {
  it('mostra a mensagem do servidor (é o motivo que o usuário precisa)', () => {
    expect(errorMessage(withStatus('E-mail já cadastrado', 409), 'fallback')).toBe(
      'E-mail já cadastrado',
    );
    expect(errorMessage(withStatus('Empresa não encontrada', 400), 'fallback')).toBe(
      'Empresa não encontrada',
    );
    expect(
      errorMessage(withStatus('Sua conta está aguardando aprovação do administrador', 403), 'fallback'),
    ).toBe('Sua conta está aguardando aprovação do administrador');
  });

  it('traduz o 429 do throttler (a message crua é inglês + jargão)', () => {
    const msg = errorMessage(withStatus('ThrottlerException: Too many requests', 429), 'fallback');
    expect(msg).toContain('Muitas tentativas');
    expect(msg).not.toMatch(/Throttler/i);
  });

  it('esconde 5xx atrás do fallback ("Internal server error" não ajuda ninguém)', () => {
    expect(errorMessage(withStatus('Internal server error', 500), 'Não foi possível criar a conta.')).toBe(
      'Não foi possível criar a conta.',
    );
  });

  it('reconhece falha de rede (sem status) e sugere checar a conexão', () => {
    // RN: 'Network request failed' · web: 'Failed to fetch'
    for (const raw of ['Network request failed', 'Failed to fetch']) {
      expect(errorMessage(new Error(raw), 'fallback')).toContain('conexão');
    }
  });

  it('cai no fallback quando não há mensagem alguma', () => {
    expect(errorMessage(new Error(''), 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
    expect(errorMessage({ nada: true }, 'fallback')).toBe('fallback');
  });
});
