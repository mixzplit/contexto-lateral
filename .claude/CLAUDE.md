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
- **Ventana de contexto de un agente.** Su barra necesita la ventana de su modelo, y el motor solo da la del modelo principal (`$.session.usage()`): ni `$.agent.list()` ni el uso de cada request la traen. El mod la aprende cuando ese modelo corre como principal (átomo `ventanas`) y la recuerda entre sesiones en `$.store` (clave `ventanas`, validada al leerla porque viene del disco). Sin ventana no inventa un porcentaje: muestra los tokens y una nota que explica por qué no hay barra.
- **Shells en segundo plano.** Se infieren en `tool.call` (Bash y PowerShell), se corrigen con `background_tasks` de los hooks Stop, el aviso de fin llega como `prompt.submit`, y caducan tras dos horas sin señales de vida.
- **Servidores MCP.** La API del motor no lista servidores (`$.tool.list()` solo da herramientas, y uno caído no tiene ninguna), así que se lee `claude mcp list` con `$.process.run` al iniciar la sesión y cada `REVISION_DE_MCP_MS` (10 min), en segundo plano. Sale con 0 aunque haya servidores caídos y todo va por stdout. Se muestran solo los de la persona: se descartan los que empiezan con `plugin:` o `claude.ai ` (convención del nombre, no hay campo de origen). La marca ✔/✘ no se compara, se mira el texto `Connected`. Mientras lee y todavía no hay lista (átomo `mcpConsultando`), la sección muestra «Consultando estados…»; con una lista ya dibujada no avisa, para no mover el panel cada 10 minutos. Una consulta fallida conserva lo último leído; no corre con `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. La función que la dispara tiene que estar en el nivel superior del archivo: el motor rechaza el módulo si `$` se pasa a una función declarada dentro de `register`.
- **Cambios de git.** Debajo de la rama (y del worktree), dos números: los archivos sin comitear en rojo (`git --no-optional-locks status --porcelain --untracked-files=all`) y los que cambiaron en commits desde el HEAD que había al abrir la sesión en verde (`git diff --name-only <base> HEAD`, átomo `baseDeCambios`; la base se reinicia si cambia la rama). Para no frenar ni estorbar: `turn.complete` (de cualquier agente) solo levanta una marca (átomo `cambiosPorRevisar`) y un `$.clock.every` de `REVISION_DE_CAMBIOS_MS` (15 s) consulta en segundo plano únicamente si la marca está levantada, así que una sesión quieta no llama a git. Esa misma marca y ese reloj releen también el proyecto (rama y worktree, `refrescarProyecto`), así que cerrar un turno ni abrir la sesión esperan a git: ambos lo piden en segundo plano y la rama puede tardar hasta 15 s en reflejar un cambio. `--no-optional-locks` evita que `git status` tome el lock del índice y le estorbe a quien comitea a la vez. Una consulta fallida conserva lo último leído y sin git no se muestra nada. La línea es «archivos: N sin comitear  N comiteados» (etiquetas en gris; «comiteado» en singular con 1) y mide 38 columnas con un dígito por número. El panel va de 36 a 60 columnas (`anchoParaTerminal`; 44 al abrir), así que `cambiosCabenEnUnaLinea` decide: si no entra, «archivos:» pasa a su propia línea y los números van debajo, para no cortar una etiqueta a la mitad. Un cero va en gris, sin color.
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
