import { mockAuthBackend } from './mockAuthBackend';

describe('mockAuthBackend', () => {
  it('signIn returns a user derived from the email', async () => {
    const user = await mockAuthBackend.signIn({ email: 'joao@swi.com', password: 'x' });
    expect(user).toEqual({ id: '1', email: 'joao@swi.com', name: 'joao' });
  });
  it('signUp reports a CONFIRM step', async () => {
    const r = await mockAuthBackend.signUp({ email: 'a@b.com', password: 'x', name: 'Ana Lima' });
    expect(r.nextStep).toBe('CONFIRM');
  });
  it('confirmSignUp / resetPassword / confirmReset resolve without throwing', async () => {
    await expect(mockAuthBackend.confirmSignUp({ email: 'a@b.com', code: '123' })).resolves.toBeUndefined();
    await expect(mockAuthBackend.resetPassword({ email: 'a@b.com' })).resolves.toBeUndefined();
    await expect(mockAuthBackend.confirmReset({ email: 'a@b.com', code: '1', newPassword: 'x' })).resolves.toBeUndefined();
  });
  it('não guarda sessão: nada a restaurar nem a confirmar', async () => {
    await expect(mockAuthBackend.restoreSession()).resolves.toBeNull();
    await expect(mockAuthBackend.confirmSession()).resolves.toEqual({ status: 'none' });
  });
  it('resendConfirmation resolves without throwing (no-op)', async () => {
    await expect(mockAuthBackend.resendConfirmation({ email: 'a@b.com' })).resolves.toBeUndefined();
  });
});
