/**
 * A promessa, ou uma rejeição se ela não resolver no prazo. Os leitores do app
 * Saúde (healthReadings.ts) e do Health Connect (healthConnectSource.ts) rodam
 * dentro do ciclo que envia a telemetria, e uma resposta nativa que nunca
 * chega seguraria esse ciclo inteiro.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem resposta em ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
