# docs/audits/mobile

Artefatos da fidelidade Figma das telas do app `mobile/`.

**Método canônico:** [`docs/plans/2026-05-10-mobile-fidelity-method.md`](../../plans/2026-05-10-mobile-fidelity-method.md) — leia este doc primeiro.

## Layout desta pasta

```
docs/audits/mobile/
  README.md                ← este arquivo
  _canvas-tree.xml         ← (Fase 0) metadata Figma da canvas Mobile 138:5997
  _master-ds-audit.md      ← (Fase 0) DS audit one-time
  _ds-gap-log.md           ← gaps cumulativos agrupados por DS version target
  <screen-slug>/           ← (Fase 1) per-screen artifacts
    figma.png
    divergence.md
    plan.md
    notes.md
    preview-ios.png
    preview-android.png
```

Slugs prefixados com `_` = meta-artefatos da Fase 0. Sem prefixo = per-screen da Fase 1.

## Onde estamos

- Fase 0: **completa (2026-05-10)** — `_canvas-tree.xml`, `_master-ds-audit.md`, `_ds-gap-log.md` populados.
- Telas destravadas: 30 / 39 · Bloqueadas em DS v0.1.8: 9 (ver Screen registry no método). _Renomeado de v0.1.7 quando o slot foi consumido pelo cut admin (commit DS `fd4c997`)._
- Telas em status `done`: 0 / 39.

## Espelhamento com o site

O método foi destilado da execução do S1.7 Dashboard fidelity no site. Referências:
- `docs/plans/2026-05-08-swi-admin-s1.7-dashboard-fidelity.md`
- `docs/audits/2026-05-08-s1.7-task0-divergence.md`
- `docs/audits/dashboard-figma-4-2.png` + `docs/audits/fidelity-method-experiment/`
