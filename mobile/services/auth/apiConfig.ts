// URL base da API. Emulador Android usa 10.0.2.2; device físico usa o IP da LAN.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
