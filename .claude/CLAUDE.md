# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Mod de Claude Code (un plugin con un módulo de hooks): un panel lateral con el contexto, los modelos, los tokens, los agentes y shells en segundo plano, el proyecto y las cuotas de uso. El repositorio es a la vez plugin y marketplace: `marketplace.json` lista un solo plugin con `"source": "./"`, así que la raíz del repo es la raíz del plugin. Se instala con `claude plugin install contexto-lateral@side-context`.

## Comandos

```bash
claude plugin validate .   # lee los manifiestos y la fuente del módulo como lo hará el motor
claude plugin test .       # corre todos los *.test.ts de la carpeta (unos 4 s)
```

- `claude plugin test` no tiene filtro por nombre y el kit `claude-code/testing` no ofrece `test.only`: cada corrida ejecuta toda la suite. La salida lista `(pass)` / `(fail)` por test; si es larga, volcarla a un archivo y buscar `(fail)`.
- Chequeo de tipos: `tsc -p` con TypeScript 5.9 o superior. `.claude-plugin/types/` lo escribe solo el motor cuando carga el mod (hot reload); sin eso `tsc -p` falla, y hay que usar un `tsconfig` auxiliar fuera de la carpeta del mod.
- Los cambios se aplican con `/reload-plugins` o en una sesión nueva.
- No poner un `CLAUDE.md` en la raíz del repo: `claude plugin validate` avisa que en la raíz del plugin no se carga como contexto. Por eso este archivo vive en `.claude/`.

## Arquitectura

- **Un solo módulo de hooks.** `hooks/hooks.json` apunta a `./register.tsx`, que exporta `register(on, options)`. No hay otro código del mod.
- **Estado compartido con átomos.** Los hooks de eventos solo escriben átomos (`atom` / `update` de `claude-code`, clave `contexto-lateral.<nombre>`); el panel es un único hook `ui.render` (`Pane`, `requestId` = `PANEL`) que los lee con `read` y dibuja. Escribir un átomo redibuja a quien lo lee. Cada valor debe declararse en `types/index.d.ts` (`PluginState`): `validate` rechaza las claves que el contrato no declara. Ese archivo no puede tener `import`, los tipos se definen adentro.
- **Observar nunca rompe nada.** Los hooks que solo observan (`turn.step`, `tool.call`, el chequeo de versión) tragan sus errores con `try/catch`.
- **La lógica pura se exporta** desde `register.tsx` (formato, barras, caducidades, comparación de versiones) y se prueba directo en `hooks/register.test.ts`.
- **Agentes en curso.** `$.agent.list()` no lista los agentes de un workflow ni sus ids, así que no se los puede dar de baja por ausencia: caducan por inactividad (`INACTIVIDAD_DE_WORKFLOW_MS`). Los agentes terminados se recuerdan (`RETIRADOS_RECORDADOS`) para reponerlos si un mensaje los reanuda.
- **Shells en segundo plano.** Se infieren en `tool.call` (Bash y PowerShell), se corrigen con `background_tasks` de los hooks Stop, el aviso de fin llega como `prompt.submit`, y caducan tras dos horas sin señales de vida.
- **Cuotas de uso.** Son siempre lo último del panel; un test lo exige.
- **Versión propia y aviso de versión nueva.** `$.plugin` solo da `name` y `root`, así que la versión se lee del `plugin.json` con `$.fs.read`. En `session.start`, en segundo plano (`void`, para no demorar el arranque), se la compara con la de `main` en GitHub (`$.http.fetch`, repo en la constante `REPOSITORIO`), como mucho una vez cada 24 h (cache en `$.store`; una consulta fallida no se cachea). Lo que llega de la red solo se muestra si tiene forma estricta `MAJOR.MINOR.PATCH`. Se apaga con la opción `avisarVersionNueva` de `userConfig`, que se trata como activa salvo que valga `false`, y tampoco consulta si está definida `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (Claude Code no frena por sí solo el pedido de un mod, así que el mod la respeta con `$.env.get`). No instala nada: muestra el comando de actualización.

## Tests

- Todo test que monte el panel necesita `mock.clock(on)`: el render lee `$.clock.now()`.
- El `$` de un test es el motor visto desde afuera: solo eventos (`$.session.start`, `$.ui.mount`, …), sin `$.http` ni `$.store`. Dentro de una sesión las operaciones se simulan con `on('http.fetch' | 'store.get' | 'store.set' | 'fs.read' | 'env.get' | 'ui.toast' | …, …)` y, sin handler, rechazan. El motor de tests no trae almacenamiento: simularlo con un `Map`. Para probar una función suelta que usa `$`, pasarle un `$` falso mínimo.
- Una tarea lanzada con `void` desde un hook termina después de varias vueltas de `await Promise.resolve()`; el helper `asentar` las da antes de mirar.
- Opciones del usuario en un test: `test(nombre, { options: { … } }, cuerpo)`.
- El código, los comentarios y los textos del panel están en español; los manifiestos y el `LICENSE`, en inglés.
- Los textos de ejemplo en tests y documentación usan nombres neutros: sin nombres de proyectos reales, usuarios del sistema ni rutas personales.

## Versiones y publicación

- La versión vive en `.claude-plugin/plugin.json`. Quien ya instaló solo recibe cambios si ese campo cambia: subirlo en cada release y no declararlo también en `marketplace.json` (gana `plugin.json` sin avisar).
- `claude plugin tag` crea el tag `contexto-lateral--vX.Y.Z` y valida que los manifiestos coincidan; exige árbol de trabajo limpio. Instalar no depende de los tags. Cada tag lleva su Release en GitHub (`gh release create`, ver `docs/git-workflow.md`).
- Ramas, commits y Pull Requests siguen `docs/git-workflow.md`: nada llega a `main` sin PR, commits convencionales, sin atribución a herramientas de IA en commits ni tags, y el agente no hace push, no abre PRs ni crea Releases salvo que la persona se lo pida explícitamente.
- Un mod ejecuta código en la máquina de quien lo instala (`$.fs`, `$.process`, `$.http`). De un PR externo se lee el diff completo antes de ejecutar nada, tests incluidos; sobre todo `plugin.json`, `marketplace.json`, `hooks/hooks.json`, archivos nuevos y dependencias.
