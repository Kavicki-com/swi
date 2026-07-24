# Design — Weather fidelity (nublado + noite)

**Data:** 2026-07-23
**Origem:** follow-up (a) do Passo 5 (ver `2026-07-23-swi-admin-dashboard-design.md` + [[swi-open-followups]]). Na verificação ao vivo, o clima real `clouds` colapsava no balde `sun` mostrando "SOL INTENSO", e slots noturnos mostravam sol.

## Problema

A tira "Previsão do tempo" do dashboard está fiada ao dado real (Open-Meteo, série horária), mas o DS `WeatherTimeline`/`WeatherIcon` só entende 3 condições (`sunny`/`rainy`/`partly-cloudy`, ilustrações PNG flat) e **não tem estado de noite**. O mapper do admin colapsava `clear/clouds/fog → sun`, então dia nublado virava "SOL INTENSO"; e não há variante de noite, então 21h/23h mostram sol.

## Escopo (decisão do usuário 2026-07-23)

Duas partes, sequenciadas por dependência de asset:

### Parte 1 — Nublado (admin-only, AGORA — sem DS, sem backend)

O DS **já tem** `partly-cloudy` (`cloudly.png`); só falta o admin usá-lo.

- **`services/api/dashboard.ts`:** `WeatherSlot['condition']` ganha `'cloudy'` (hoje `'sun'|'rain'|'storm'`).
- **`services/api/weather.ts`:** `CONDITION_TO_STRIP` passa a `clear → 'sun'`, **`clouds → 'cloudy'`, `fog → 'cloudy'`**, `rain/snow → 'rain'`, `storm → 'storm'`. `STRIP_LABEL` ganha `'cloudy' → 'PARCIALMENTE\nNUBLADO'`. Com clouds/fog fora, o balde `sun` = céu limpo, então `'SOL\nINTENSO'` passa a ser coerente.
- **`pages/dashboard/Dashboard.tsx`:** `WEATHER_CONDITION_MAP` ganha `'cloudy' → 'partly-cloudy'` (o `WeatherTimelineEvent['condition']` local já aceita `'partly-cloudy'`).
- **Testes:** `weather.test.ts` (bucket de condição + label do nublado); ajustar `Dashboard.test.tsx` se assertar o mapa.

Resolve o "dia nublado = SOL INTENSO". Zero DS, zero backend.

### Parte 2 — Noite (DS bump, AGUARDA ASSETS do designer)

**Bloqueada:** precisa de ilustrações flat de noite (lua/clear-night, cloud-moon, chuva-noite) no estilo do SWI, que **não existem no DS**. O usuário (designer) vai desenhar/exportar do arquivo SWI-UI e passar os nodeIds/PNG. Não usar libs externas (CRM Lib/Agrobee ForecastIcon) — provenance + estilo divergente.

Quando os assets chegarem:
- **DS bump:** PNGs em `src/icons/raw/`; `WeatherIcon` ganha `isNight?: boolean` (troca a fonte: `sunny→lua`, `partly-cloudy→cloud-moon`, `rainy→chuva-noite` se fornecida). Story + teste. `npm version` + build + `npm pack` pro `vendor/` do admin + pin + install (protocolo de bump do DS — ver [[swi-design-system-refs]]).
- **Determinação dia/noite:** `is_day` do Open-Meteo — campo aditivo no `hourly` do backend (igual fizemos com a série no Passo 5). `WeatherHourly` ganha `isDay`; `WeatherSlot`/`WeatherTimelineEvent` ganham `isNight = !isDay`; `Dashboard.tsx` repassa. (Alternativa descartável: heurística de hora no cliente — menos honesta.)
- **Fiação admin:** `toWeatherStrip` propaga `isNight`; `Dashboard.tsx` passa `isNight` pra timeline.

Toca 3 lugares (DS + backend + admin) → fatia própria, branch separada, quando os assets existirem.

## Sequência

1. **Parte 1 shipa agora** — branch `feat/admin-weather-cloudy` (admin-only), subagent-driven + review, verificação ao vivo, PR contra main.
2. **Parte 2** — documentada aqui, aguardando os assets de noite. Quando chegarem: bump do DS + `is_day` no backend + fiação, como fatia separada.

## Decisões registradas

- **Nublado é admin-only** — o DS já tem `partly-cloudy`; não precisa de bump. Separa a parte barata da cara.
- **Noite precisa de asset novo no estilo SWI** — designer fornece; nada de lib externa (provenance/estilo).
- **Dia/noite via `is_day` do Open-Meteo** — coerente com a honestidade de dado real do Passo 5; aditivo, não quebra o mobile.
- **`isNight` como prop ortogonal** (não novas condições `clear-night` etc.) — mantém o enum de condição estável; noite é uma dimensão separada.
