// SVGs exportados direto do Figma (385:29591 dashboard-alert-active) pra
// substituir os ícones do DS que não batem visualmente:
// - DS humidity_mid tem barra interna; Figma é gota outlined sem barra.
// - DS wind_speed (Material `air`) tem end-caps circulares; Figma tem
//   end-caps em bracket (sem caps redondos).
// - DS keyboard_arrow_up/down são chevrons; Figma usa triângulos sólidos
//   (Polígono 4/5).
//
// Render via `SvgXml` do react-native-svg. Cores hardcoded do Figma —
// não passa por theme. Mantém a fidelidade do export 1:1.

// Figma 385:29333 — gota outlined em white, viewBox 14x20.
export const WATER_DROP_SVG = `<svg width="14" height="20" viewBox="0 0 14 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2 13C2 15.7614 4.23858 18 7 18C9.76142 18 12 15.7614 12 13C12 11.274 10.34 7.969 7 3.347C3.66 7.969 2 11.274 2 13ZM7 0C11.667 6.09 14 10.423 14 13C14 16.866 10.866 20 7 20C3.13401 20 0 16.866 0 13C0 10.423 2.333 6.09 7 0Z" fill="white"/>
</svg>`;

// Figma 385:29316 — 3 linhas de vento com end-caps tipo bracket (sem
// círculos), viewBox 20x17. 3 paths separados — cada linha é um shape.
export const WIND_SPEED_SVG = `<svg width="20" height="17" viewBox="0 0 20 17" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M0.833333 6.66667H14.1667C16 6.66667 17.5 5.16667 17.5 3.33333C17.5 1.5 16 0 14.1667 0C12.3333 0 10.8333 1.5 10.8333 3.33333C10.8333 3.83333 11.1667 4.16667 11.6667 4.16667C12.1667 4.16667 12.5 3.83333 12.5 3.33333C12.5 2.41667 13.25 1.66667 14.1667 1.66667C15.0833 1.66667 15.8333 2.41667 15.8333 3.33333C15.8333 4.25 15.0833 5 14.1667 5H0.833333C0.333333 5 0 5.33333 0 5.83333C0 6.33333 0.333333 6.66667 0.833333 6.66667Z" fill="#F5F5F5"/>
<path d="M9.16667 10H0.833333C0.416667 10 0 10.3333 0 10.8333C0 11.25 0.333333 11.6667 0.833333 11.6667H9.16667C10.0833 11.6667 10.8333 12.4167 10.8333 13.3333C10.8333 14.25 10.0833 15 9.16667 15C8.25 15 7.5 14.25 7.5 13.3333C7.5 12.8333 7.16667 12.5 6.66667 12.5C6.16667 12.5 5.83333 12.8333 5.83333 13.3333C5.83333 15.1667 7.33333 16.6667 9.16667 16.6667C11 16.6667 12.5 15.1667 12.5 13.3333C12.5 11.5 11 10 9.16667 10Z" fill="#F5F5F5"/>
<path d="M16.6667 7.5H0.833333C0.416667 7.5 0 7.83333 0 8.33333C0 8.75 0.333333 9.16667 0.833333 9.16667H16.6667C17.5833 9.16667 18.3333 9.91667 18.3333 10.8333C18.3333 11.75 17.5833 12.5 16.6667 12.5C15.75 12.5 15 11.75 15 10.8333C15 10.3333 14.6667 10 14.1667 10C13.6667 10 13.3333 10.3333 13.3333 10.8333C13.3333 12.6667 14.8333 14.1667 16.6667 14.1667C18.5 14.1667 20 12.6667 20 10.8333C20 9 18.5 7.5 16.6667 7.5Z" fill="#F5F5F5"/>
</svg>`;

// Figma 385:30131 (max-temperature) — Polígono 5: triângulo ▲ orange,
// 22x19, fill #EF8600 (surface/warning).
export const ARROW_UP_TRIANGLE_SVG = `<svg width="22" height="19" viewBox="0 0 22 19" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M11 0L22 19L0 19L11 0Z" fill="#EF8600"/>
</svg>`;

// Figma 385:30135 (min-temperature) — Polígono 4: triângulo ▼ blue,
// 22x19, fill #3899BF (surface/info).
export const ARROW_DOWN_TRIANGLE_SVG = `<svg width="22" height="19" viewBox="0 0 22 19" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M11 19L0 0H22L11 19Z" fill="#3899BF"/>
</svg>`;
