import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  AgenteEnCurso,
  AgenteRetirado,
  BaseDeCambios,
  CambiosDeGit,
  Contexto,
  LimiteDeUso,
  ModeloUsado,
  Proyecto,
  ServidorMcp,
  ShellEnSegundoPlano,
  TareaEnSegundoPlano,
} from '../types'

const PANEL = 'contexto-lateral'

const contexto = atom({ plugin: 'contexto-lateral', key: 'contexto' } as const, null)
const modelos = atom({ plugin: 'contexto-lateral', key: 'modelos' } as const, [])
const version = atom({ plugin: 'contexto-lateral', key: 'version' } as const, null)
const modVersion = atom({ plugin: 'contexto-lateral', key: 'modVersion' } as const, null)
const versionNueva = atom({ plugin: 'contexto-lateral', key: 'versionNueva' } as const, null)
const modeloPrincipal = atom({ plugin: 'contexto-lateral', key: 'modeloPrincipal' } as const, null)
const proyecto = atom({ plugin: 'contexto-lateral', key: 'proyecto' } as const, null)
const agentes = atom({ plugin: 'contexto-lateral', key: 'agentes' } as const, [])
const retirados = atom({ plugin: 'contexto-lateral', key: 'retirados' } as const, [])
const ventanas = atom({ plugin: 'contexto-lateral', key: 'ventanas' } as const, {})
const limites = atom({ plugin: 'contexto-lateral', key: 'limites' } as const, [])
const shells = atom({ plugin: 'contexto-lateral', key: 'shells' } as const, [])
const mcp = atom({ plugin: 'contexto-lateral', key: 'mcp' } as const, null)
const mcpConsultando = atom({ plugin: 'contexto-lateral', key: 'mcpConsultando' } as const, false)
const cambios = atom({ plugin: 'contexto-lateral', key: 'cambios' } as const, null)
const baseDeCambios = atom({ plugin: 'contexto-lateral', key: 'baseDeCambios' } as const, null)
const cambiosPorRevisar = atom({ plugin: 'contexto-lateral', key: 'cambiosPorRevisar' } as const, false)

type Uso = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const COLORES_DE_MODELO: ReadonlyArray<readonly [string, string]> = [
  ['opus', '#BA68C8'],
  ['sonnet', '#4FC3F7'],
  ['haiku', '#81C784'],
  ['fable', '#FFB74D'],
]

export const colorDeModelo = (id: string): string =>
  COLORES_DE_MODELO.find(([familia]) => id.includes(familia))?.[1] ?? 'subtle'

export const colorDeContexto = (percent: number): string =>
  percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success'

export const formatear = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

const GLIFOS_GRUESOS = { lleno: '█', vacio: '░' }

/** Un trazo en vez de un bloque: la celda no se achica, pero la barra se ve más delgada. */
export const GLIFOS_FINOS = { lleno: '━', vacio: '─' }

export const armarBarra = (percent: number, ancho: number, glifos = GLIFOS_GRUESOS) => {
  const llenos = Math.round((Math.min(100, Math.max(0, percent)) / 100) * ancho)

  return { llenos: glifos.lleno.repeat(llenos), vacios: glifos.vacio.repeat(ancho - llenos) }
}

const VENTANAS_DE_USO = [
  { kind: 'five_hour', etiqueta: '5 horas' },
  { kind: 'seven_day', etiqueta: 'Semanal' },
] as const

/** De todo lo que reporta la API (también `spend_limit` de un gateway) solo se muestran estas dos. */
export const ventanasDeUso = (lista: ReadonlyArray<LimiteDeUso>) =>
  VENTANAS_DE_USO.map(({ kind, etiqueta }) => ({
    etiqueta,
    limite: lista.find(l => l.kind === kind) ?? null,
  }))

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

const dosDigitos = (n: number): string => String(n).padStart(2, '0')

/** La hora en que se reinicia, absoluta para que no se quede vieja entre mediciones; con el día si no es hoy. */
export const textoDeReinicio = (resetsAt: string, ahora: number): string | null => {
  const reinicio = new Date(resetsAt)
  if (Number.isNaN(reinicio.getTime())) {
    return null
  }

  const hoy = new Date(ahora)
  const esHoy =
    reinicio.getFullYear() === hoy.getFullYear() &&
    reinicio.getMonth() === hoy.getMonth() &&
    reinicio.getDate() === hoy.getDate()
  const hora = `${dosDigitos(reinicio.getHours())}:${dosDigitos(reinicio.getMinutes())}`

  return esHoy ? hora : `${DIAS[reinicio.getDay()]} ${hora}`
}

/** La API reporta la ventana con la última respuesta: pasado el reinicio, el porcentaje ya no vale. */
export const ventanaVencida = (resetsAt: string | undefined, ahora: number): boolean =>
  resetsAt !== undefined && Date.parse(resetsAt) <= ahora

export const modeloCorto = (id: string): string =>
  id.replace(/^claude-/, '').replace(/-\d{8}$/, '')

export const nombreDe = (ruta: string): string =>
  ruta.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ruta

export const numeroDeVersion = (texto: string): string => texto.split(' ')[0] ?? texto

export const recortar = (texto: string, maximo: number): string =>
  texto.length > maximo ? `${texto.slice(0, Math.max(0, maximo - 1))}…` : texto

/** Un 20% del ancho de la terminal, con piso y techo para que el panel siga siendo legible. */
export const anchoParaTerminal = (total: number): number =>
  Math.min(60, Math.max(36, Math.round(total * 0.2)))

/** Lo que ocupa la ventana en un request: lo no cacheado más lo que leyó y escribió el caché. */
export const entradaDelRequest = (uso: Uso): number =>
  uso.input_tokens + uso.cache_read_input_tokens + uso.cache_creation_input_tokens

export const acumular = (lista: ModeloUsado[], id: string, uso: Uso): ModeloUsado[] => {
  const previo = lista.find(m => m.id === id)
  const sumado: ModeloUsado = {
    id,
    turnos: (previo?.turnos ?? 0) + 1,
    entrada: (previo?.entrada ?? 0) + uso.input_tokens + uso.cache_creation_input_tokens,
    salida: (previo?.salida ?? 0) + uso.output_tokens,
    cache: (previo?.cache ?? 0) + uso.cache_read_input_tokens,
  }

  return previo ? lista.map(m => (m.id === id ? sumado : m)) : [...lista, sumado]
}

export const conTokensDeAgente = (
  lista: AgenteEnCurso[],
  id: string,
  modelo: string,
  tokens: number,
  visto: number,
): AgenteEnCurso[] => lista.map(a => (a.id === id ? { ...a, modelo, tokens, visto } : a))

export const INACTIVIDAD_DE_WORKFLOW_MS = 10 * 60 * 1000

/**
 * `$.agent.list()` no lista los agentes de un workflow, así que no se los puede dar de baja
 * por ausencia: caducan solo si pasan mucho tiempo sin dar señales de vida.
 */
export const sigueEnCurso = (
  agente: AgenteEnCurso,
  vivos: ReadonlySet<string>,
  ahora: number,
): boolean =>
  agente.esWorkflow ? ahora - agente.visto < INACTIVIDAD_DE_WORKFLOW_MS : vivos.has(agente.id)

/** Cuántos agentes terminados se recuerdan para poder reponerlos si un mensaje los reanuda. */
export const RETIRADOS_RECORDADOS = 20

/**
 * Un `turn.step` tan pegado al `SubagentStop` de su agente no es una reanudación sino el cierre
 * de la misma corrida: no se lo repone. Una reanudación real vuelve a dar pasos y se adopta en el siguiente.
 */
export const VENTANA_DE_RETIRO_MS = 5000

const ESTADOS_FINALES_DE_AGENTE: readonly string[] = ['completed', 'failed', 'killed']

export const conRetirado = (
  previos: AgenteRetirado[],
  agente: AgenteEnCurso,
  ahora: number,
): AgenteRetirado[] =>
  [
    ...previos.filter(r => r.id !== agente.id),
    {
      id: agente.id,
      descripcion: agente.descripcion,
      tipo: agente.tipo,
      enSegundoPlano: agente.enSegundoPlano,
      detenido: ahora,
    },
  ].slice(-RETIRADOS_RECORDADOS)

type AgenteListado = { description: string; type: string; status: string }

/**
 * Un agente que da pasos sin estar en el panel y que la API todavía lista como vivo es uno terminado
 * que un mensaje reanudó (no hay `agent.spawn` en una reanudación). Nunca se adopta uno que la API
 * no lista (los forks del motor, los agentes de un workflow caducado) ni uno que la API da por terminado.
 */
export const adoptarAgente = (datos: {
  id: string
  modelo: string
  tokens: number
  ahora: number
  listado: AgenteListado | undefined
  retirado: AgenteRetirado | undefined
}): AgenteEnCurso | null => {
  const { id, modelo, tokens, ahora, listado, retirado } = datos

  if (listado === undefined || ESTADOS_FINALES_DE_AGENTE.includes(listado.status)) {
    return null
  }
  if (retirado !== undefined && ahora - retirado.detenido < VENTANA_DE_RETIRO_MS) {
    return null
  }

  return {
    id,
    descripcion: retirado?.descripcion || listado.description || '(reanudado)',
    tipo: retirado?.tipo ?? listado.type,
    modelo,
    // un mensaje reanuda al agente sin bloquear al que lo envía: corre en segundo plano
    enSegundoPlano: retirado?.enSegundoPlano ?? true,
    esWorkflow: false,
    tokens,
    visto: ahora,
  }
}

/** La API no da la ventana de un modelo: solo se conoce la de los que el panel vio como modelo principal. */
export const porcentajeDeAgente = (
  agente: AgenteEnCurso,
  conocidas: Record<string, number>,
): number | null => {
  const ventana = conocidas[agente.modelo]

  return agente.tokens === null || !ventana
    ? null
    : Math.min(100, Math.round((agente.tokens / ventana) * 100))
}

/** Dónde se recuerdan, entre sesiones, las ventanas que el panel aprendió de cada modelo. */
const CLAVE_DE_VENTANAS = 'ventanas'

/** Lo guardado viene del disco: solo valen los modelos con una ventana numérica positiva. */
const leerVentanasGuardadas = async ($: EngineInterface): Promise<Record<string, number>> => {
  const guardado: unknown = await $.store.get(CLAVE_DE_VENTANAS)
  const validas: Record<string, number> = {}

  if (typeof guardado === 'object' && guardado !== null && !Array.isArray(guardado)) {
    for (const [modelo, ventana] of Object.entries(guardado)) {
      if (typeof ventana === 'number' && Number.isFinite(ventana) && ventana > 0) {
        validas[modelo] = ventana
      }
    }
  }

  return validas
}

const recordarVentana = async ($: EngineInterface, modelo: string, ventana: number) => {
  const guardadas = await leerVentanasGuardadas($)

  if (guardadas[modelo] !== ventana) {
    await $.store.set(CLAVE_DE_VENTANAS, { ...guardadas, [modelo]: ventana })
  }
}

/**
 * No hay una lista de shells en la API: se infieren de tres señales (el resultado del Bash o
 * PowerShell que lo lanzó, el aviso de fin, la lista `background_tasks` del hook Stop), y esta
 * cota evita que un aviso perdido deje un fantasma para siempre. Si el shell seguía vivo, la
 * próxima lista del motor lo repone.
 */
export const INACTIVIDAD_DE_SHELL_MS = 2 * 60 * 60 * 1000

/** Cada cuánto se revisa el vencimiento aunque la sesión esté quieta. */
export const REVISION_DE_SHELLS_MS = 5 * 60 * 1000

const ESTADOS_FINALES_DE_TAREA: readonly string[] = ['completed', 'failed', 'killed', 'cancelled', 'stopped']

export const shellSigueEnCurso = (shell: ShellEnSegundoPlano, ahora: number): boolean =>
  ahora - shell.visto < INACTIVIDAD_DE_SHELL_MS

/** Una sola línea; sin el `cd <ruta> &&` que los agentes anteponen y que se come todo el ancho. */
export const etiquetaDeShell = (comando: string | undefined, descripcion = ''): string => {
  const unaLinea = (comando ?? '').replace(/\s+/g, ' ').trim()
  const sinCd = unaLinea.replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)+(?=\S)/, '')

  return sinCd || unaLinea || descripcion.replace(/\s+/g, ' ').trim()
}

/** El id de la tarea en segundo plano que un Bash o PowerShell dejó corriendo; null si no dejó ninguna. */
export const tareaLanzadaPor = (salida: unknown): string | null => {
  if (typeof salida !== 'object' || salida === null) {
    return null
  }

  // con `backgroundEndsWithFinalResponse` el motor la mata al cerrar la respuesta y no manda aviso de fin
  const { backgroundTaskId: id, backgroundEndsWithFinalResponse: terminaConLaRespuesta } = salida as Record<
    string,
    unknown
  >

  return typeof id === 'string' && id !== '' && terminaConLaRespuesta !== true ? id : null
}

/** El id de la tarea que el aviso del motor (`<task-notification>`) da por terminada; null si no lo es. */
export const idDeTareaTerminada = (texto: string): string | null => {
  if (!texto.includes('<task-notification>')) {
    return null
  }

  const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(texto)?.[1]
  const estado = /<status>\s*([^<\s]+)\s*<\/status>/.exec(texto)?.[1]

  return id && estado && ESTADOS_FINALES_DE_TAREA.includes(estado) ? id : null
}

/** Los shells de la lista de tareas en curso que el motor entrega con cada Stop. */
export const shellsDeLasTareas = (
  tareas: ReadonlyArray<TareaEnSegundoPlano>,
  ahora: number,
): ShellEnSegundoPlano[] =>
  tareas
    .filter(t => t.type === 'shell' && !ESTADOS_FINALES_DE_TAREA.includes(t.status))
    .map(t => ({ id: t.id, comando: etiquetaDeShell(t.command, t.description) || t.id, visto: ahora }))

const normalizar = (ruta: string): string => ruta.replace(/\\/g, '/').replace(/\/+$/, '')

const git = async ($: EngineInterface, cwd: string, args: string[]): Promise<string | null> => {
  const resultado = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })

  return resultado.exitCode === 0 ? resultado.stdout.trim() : null
}

export const leerProyecto = async ($: EngineInterface): Promise<Proyecto> => {
  const raiz = await $.session.root()
  const sinGit: Proyecto = { nombre: nombreDe(raiz), rama: null, worktree: null }

  const rutas = await git($, raiz, [
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-dir',
    '--git-common-dir',
  ])
  if (rutas === null) {
    return sinGit
  }

  const [cima, gitDir, comun] = rutas.split(/\r?\n/)
  const rama = await git($, raiz, ['branch', '--show-current'])
  const sha = rama ? null : await git($, raiz, ['rev-parse', '--short', 'HEAD'])
  const esWorktree = !!gitDir && !!comun && normalizar(gitDir) !== normalizar(comun)

  return {
    nombre: comun ? nombreDe(normalizar(comun).replace(/\/\.git$/, '')) : nombreDe(raiz),
    rama: rama || (sha ? `(${sha})` : null),
    worktree: esWorktree ? nombreDe(cima ?? raiz) : null,
  }
}

/** La versión que declara el plugin.json del propio mod; null si no se puede leer (el panel muestra entonces solo el nombre). */
export const versionDelMod = async ($: EngineInterface): Promise<string | null> => {
  try {
    const manifiesto: unknown = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    const declarada = (manifiesto as { version?: unknown }).version

    return typeof declarada === 'string' ? declarada : null
  } catch {
    return null
  }
}

const REPOSITORIO = 'mixzplit/contexto-lateral'
export const URL_DEL_MANIFIESTO = `https://raw.githubusercontent.com/${REPOSITORIO}/main/.claude-plugin/plugin.json`
export const COMANDO_DE_ACTUALIZACION = 'claude plugin update contexto-lateral@side-context'
export const INTERVALO_DE_CHEQUEO_MS = 24 * 60 * 60 * 1000

const CLAVE_DEL_CHEQUEO = 'chequeo'
const CLAVE_DEL_AVISO = 'avisada'

// Solo MAJOR.MINOR.PATCH: lo que llega de la red se muestra únicamente si tiene exactamente esta forma.
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

export const esMasNueva = (candidata: string, actual: string): boolean => {
  const nueva = SEMVER.exec(candidata)
  const vigente = SEMVER.exec(actual)

  if (!nueva || !vigente) {
    return false
  }

  for (let i = 1; i <= 3; i += 1) {
    const diferencia = Number(nueva[i]) - Number(vigente[i])

    if (diferencia !== 0) {
      return diferencia > 0
    }
  }

  return false
}

/** La versión que declara el plugin.json de main en GitHub; null si no se pudo leer o no es MAJOR.MINOR.PATCH. */
export const buscarVersionPublicada = async ($: EngineInterface): Promise<string | null> => {
  try {
    const respuesta = await $.http.fetch(URL_DEL_MANIFIESTO)

    if (!respuesta.ok) {
      return null
    }

    const declarada = (JSON.parse(respuesta.text) as { version?: unknown }).version

    return typeof declarada === 'string' && SEMVER.test(declarada) ? declarada : null
  } catch {
    return null
  }
}

/**
 * Claude Code no frena por sí solo el pedido web de un mod: quien definió esta variable para no generar tráfico
 * innecesario espera que tampoco salga este. Vale cualquier valor salvo vacío, `0` o `false`.
 */
const sinTraficoInnecesario = async ($: EngineInterface): Promise<boolean> => {
  const valor = (await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'))?.trim().toLowerCase()

  return valor !== undefined && valor !== '' && valor !== '0' && valor !== 'false'
}

type Chequeo = { chequeadoEn: number; version: string }

const esChequeo = (valor: unknown): valor is Chequeo =>
  typeof valor === 'object' &&
  valor !== null &&
  typeof (valor as Chequeo).chequeadoEn === 'number' &&
  typeof (valor as Chequeo).version === 'string'

/**
 * La versión publicada si es más nueva que la `propia`; null si no hay, si el aviso está apagado, si el usuario pidió
 * no generar tráfico innecesario o si no se pudo consultar. Consulta como mucho una vez cada INTERVALO_DE_CHEQUEO_MS;
 * una consulta fallida no se recuerda.
 */
export const comprobarVersionNueva = async (
  $: EngineInterface,
  propia: string | null,
  activo: boolean,
): Promise<string | null> => {
  if (!activo || propia === null) {
    return null
  }

  try {
    if (await sinTraficoInnecesario($)) {
      return null
    }

    const ahora = await $.clock.now()
    const guardado = await $.store.get(CLAVE_DEL_CHEQUEO)
    let publicada: string | null

    if (esChequeo(guardado) && ahora >= guardado.chequeadoEn && ahora - guardado.chequeadoEn < INTERVALO_DE_CHEQUEO_MS) {
      publicada = guardado.version
    } else {
      publicada = await buscarVersionPublicada($)

      if (publicada === null) {
        return null
      }

      await $.store.set(CLAVE_DEL_CHEQUEO, { chequeadoEn: ahora, version: publicada })
    }

    return esMasNueva(publicada, propia) ? publicada : null
  } catch {
    return null
  }
}

const avisarUnaVez = async ($: EngineInterface, nueva: string) => {
  if ((await $.store.get(CLAVE_DEL_AVISO)) === nueva) {
    return
  }

  $.ui.toast(`${$.plugin.name}: hay una versión nueva (v${nueva}). El panel dice cómo actualizar.`)
  await $.store.set(CLAVE_DEL_AVISO, nueva)
}

const revisarVersionNueva = async ($: EngineInterface, propia: string | null, activo: boolean) => {
  try {
    const nueva = await comprobarVersionNueva($, propia, activo)
    await update($, versionNueva, () => nueva)

    if (nueva !== null) {
      await avisarUnaVez($, nueva)
    }
  } catch {
    // avisar de una versión nueva nunca debe romper la sesión
  }
}

const refrescarProyecto = async ($: EngineInterface) => {
  try {
    const nuevo = await leerProyecto($)
    const actual = await read($, proyecto)

    if (JSON.stringify(actual) !== JSON.stringify(nuevo)) {
      await update($, proyecto, () => nuevo)
    }
  } catch {
    // sin git o sin permiso: el panel conserva lo último que leyó
  }
}

const reconciliarAgentes = async ($: EngineInterface) => {
  try {
    const vivos = new Set((await $.agent.list()).map(a => a.id))
    const ahora = await $.clock.now()
    const lista = await read($, agentes)

    if (lista.some(a => !sigueEnCurso(a, vivos, ahora))) {
      await update($, agentes, previa => previa.filter(a => sigueEnCurso(a, vivos, ahora)))
    }
  } catch {
    // sin lectura: la fila se va cuando llegue el aviso de que el agente terminó
  }
}

/** Da de baja al agente y recuerda lo que se sabía de él por si un mensaje lo reanuda. */
const retirarAgente = async ($: EngineInterface, id: string) => {
  try {
    const agente = (await read($, agentes)).find(a => a.id === id)

    if (agente !== undefined && !agente.esWorkflow) {
      const ahora = await $.clock.now()
      await update($, retirados, previos => conRetirado(previos, agente, ahora))
    }
  } catch {
    // sin recuerdo, una reanudación igual se adopta con los datos de la API
  }

  await update($, agentes, lista => lista.filter(a => a.id !== id))
}

/** Un agente que da pasos sin figurar en el panel: se lo repone solo si adoptarAgente lo permite. */
const reponerAgente = async (
  $: EngineInterface,
  id: string,
  modelo: string,
  tokens: number,
  ahora: number,
) => {
  const listado = (await $.agent.list()).find(a => a.id === id)
  const retirado = (await read($, retirados)).find(r => r.id === id)
  const nuevo = adoptarAgente({ id, modelo, tokens, ahora, listado, retirado })

  if (nuevo !== null) {
    // dos pasos seguidos pueden llegar juntos: se revisa de nuevo dentro de la escritura
    await update($, agentes, lista =>
      lista.some(a => a.id === id) ? conTokensDeAgente(lista, id, modelo, tokens, ahora) : [...lista, nuevo],
    )
  }
}

/**
 * Con `tareas` (la lista del motor al terminar un turno) la lista de shells pasa a ser esa: es la
 * verdad y corrige lo inferido; sin ella solo se sueltan los vencidos.
 */
const reconciliarShells = async ($: EngineInterface, tareas?: ReadonlyArray<TareaEnSegundoPlano>) => {
  try {
    const ahora = await $.clock.now()
    const siguiente = (previos: ShellEnSegundoPlano[]): ShellEnSegundoPlano[] =>
      tareas === undefined
        ? previos.filter(s => shellSigueEnCurso(s, ahora))
        : shellsDeLasTareas(tareas, ahora)
    const actuales = await read($, shells)

    if (JSON.stringify(siguiente(actuales)) !== JSON.stringify(actuales)) {
      await update($, shells, siguiente)
    }
  } catch {
    // sin lectura: el aviso de fin y el vencimiento siguen cuidando la lista
  }
}

const soltarShell = async ($: EngineInterface, id: string) => {
  try {
    const actuales = await read($, shells)

    if (actuales.some(s => s.id === id)) {
      await update($, shells, previos => previos.filter(s => s.id !== id))
    }
  } catch {
    // sin lectura: la próxima lista de tareas lo da de baja
  }
}

/** `claude mcp list` conecta cada servidor y tarda unos segundos: se lo consulta poco, no en cada redibujado. */
export const REVISION_DE_MCP_MS = 10 * 60 * 1000

const TIEMPO_MAXIMO_DE_MCP_MS = 60 * 1000

const PREFIJO_DE_MCP_DE_PLUGIN = 'plugin:'

/** Lo que viene con Claude Code (los servidores de los plugins y los conectores de claude.ai) no cuenta como de la persona. */
const PREFIJOS_DE_MCP_AJENOS = [PREFIJO_DE_MCP_DE_PLUGIN, 'claude.ai ']

export const esMcpDelUsuario = (nombre: string): boolean =>
  !PREFIJOS_DE_MCP_AJENOS.some(prefijo => nombre.startsWith(prefijo))

/** Los conectores de claude.ai nunca se muestran; los servidores de los plugins, solo si la persona activó la opción. */
export const seMuestraElMcp = (nombre: string, conDePlugins: boolean): boolean =>
  esMcpDelUsuario(nombre) || (conDePlugins && nombre.startsWith(PREFIJO_DE_MCP_DE_PLUGIN))

// «<nombre>: <destino> - <marca> <estado>». La marca (✔, ✘, !) no se compara: según la consola puede llegar deformada.
const LINEA_DE_MCP = /^(.+?): (.*) - \S+ (.+)$/

/**
 * Los servidores que lista `claude mcp list` y que se muestran: los de la persona y, con `conDePlugins`, los de los
 * plugins. Lo que no tiene la forma de una línea (avisos, encabezado) se ignora.
 */
export const servidoresMcp = (salida: string, conDePlugins = false): ServidorMcp[] =>
  salida.split(/\r?\n/).flatMap(linea => {
    const partes = LINEA_DE_MCP.exec(linea.trim())
    const nombre = partes?.[1]

    return partes && nombre && seMuestraElMcp(nombre, conDePlugins)
      ? [{ nombre, conectado: /^Connected\b/.test(partes[3] ?? '') }]
      : []
  })

/**
 * No hay una lista de servidores en la API del motor: se pregunta a `claude mcp list`, que sale con 0 aunque haya
 * servidores caídos. Cualquier falla deja lo último que se leyó. Con CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC no se
 * consulta, porque la comprobación conecta con cada servidor.
 */
const refrescarMcp = async ($: EngineInterface, conDePlugins: boolean) => {
  try {
    if (await sinTraficoInnecesario($)) {
      return
    }

    await update($, mcpConsultando, () => true)

    try {
      const resultado = await $.process.run(['claude', 'mcp', 'list'], { timeoutMs: TIEMPO_MAXIMO_DE_MCP_MS })
      if (resultado.exitCode !== 0) {
        return
      }

      const nuevos = servidoresMcp(resultado.stdout, conDePlugins)
      const actuales = await read($, mcp)

      if (JSON.stringify(actuales) !== JSON.stringify(nuevos)) {
        await update($, mcp, () => nuevos)
      }
    } finally {
      await update($, mcpConsultando, () => false)
    }
  } catch {
    // sin la consulta: el panel conserva lo último que leyó, o no muestra la sección
  }
}

let leyendoMcp = false

/** Una consulta que tarda no se pisa con la siguiente: la periódica espera a que termine la anterior. */
const revisarMcp = async ($: EngineInterface, conDePlugins: boolean) => {
  if (leyendoMcp) {
    return
  }

  leyendoMcp = true
  try {
    await refrescarMcp($, conDePlugins)
  } finally {
    leyendoMcp = false
  }
}

/** `git status` recorre el árbol de trabajo: se lo consulta como mucho una vez por intervalo, y solo si hubo actividad. */
export const REVISION_DE_CAMBIOS_MS = 15 * 1000

const contarLineas = (texto: string): number => texto.split(/\r?\n/).filter(linea => linea.trim() !== '').length

const ROTULO_DE_ARCHIVOS = 'archivos: '
const ETIQUETA_SIN_COMITEAR = ' sin comitear'
const SEPARACION_DE_CAMBIOS = '  '
const etiquetaDeComiteados = (cantidad: number): string => (cantidad === 1 ? ' comiteado' : ' comiteados')

/** «archivos: 5 sin comitear  0 comiteados» va en una línea; si el panel es angosto, «archivos:» va arriba y los números debajo. */
export const cambiosCabenEnUnaLinea = ({ sinComitear, comiteados }: CambiosDeGit, columnas: number): boolean =>
  ROTULO_DE_ARCHIVOS.length +
    `${sinComitear}`.length +
    ETIQUETA_SIN_COMITEAR.length +
    SEPARACION_DE_CAMBIOS.length +
    `${comiteados}`.length +
    etiquetaDeComiteados(comiteados).length <=
  columnas

/**
 * Los archivos sin comitear (los que `git status` da por sucios) y los que cambiaron en commits desde el que había al
 * abrir la sesión. Esa base se reinicia al cambiar de rama: entre ramas la comparación no habla de la sesión.
 * `--no-optional-locks` evita que `git status` tome el lock del índice y le estorbe a quien comitea a la vez.
 * Cualquier falla deja lo último que se leyó.
 */
const refrescarCambios = async ($: EngineInterface) => {
  try {
    const raiz = await $.session.root()
    const cabeza = await git($, raiz, ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'])
    const [sha, rama] = cabeza?.split(/\r?\n/) ?? []

    if (!sha || !rama) {
      return
    }

    const previa = await read($, baseDeCambios)
    const base: BaseDeCambios = previa !== null && previa.rama === rama ? previa : { rama, sha }
    if (base !== previa) {
      await update($, baseDeCambios, () => base)
    }

    const sucios = await git($, raiz, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'])
    const comiteados = base.sha === sha ? '' : await git($, raiz, ['diff', '--name-only', base.sha, sha])
    if (sucios === null || comiteados === null) {
      return
    }

    const nuevos: CambiosDeGit = { sinComitear: contarLineas(sucios), comiteados: contarLineas(comiteados) }
    const actuales = await read($, cambios)

    if (JSON.stringify(actuales) !== JSON.stringify(nuevos)) {
      await update($, cambios, () => nuevos)
    }
  } catch {
    // sin git o sin permiso: el panel conserva lo último que leyó, o no muestra los números
  }
}

/**
 * Solo consulta si hubo actividad desde la última vez: una sesión quieta no llama a git. La misma marca cubre la rama
 * (un comando del turno puede haberla cambiado) y los archivos, y ninguna consulta demora el cierre del turno.
 */
const revisarCambios = async ($: EngineInterface) => {
  try {
    if (await read($, cambiosPorRevisar)) {
      await update($, cambiosPorRevisar, () => false)
      await Promise.all([refrescarProyecto($), refrescarCambios($)])
    }
  } catch {
    // observar nunca debe romper la sesión
  }
}

const marcarCambiosPorRevisar = async ($: EngineInterface) => {
  try {
    if (!(await read($, cambiosPorRevisar))) {
      await update($, cambiosPorRevisar, () => true)
    }
  } catch {
    // sin la marca: el próximo turno la vuelve a poner
  }
}

export const ANCHO_DEL_PANEL = 44
const ANCHO_MAXIMO_DE_LA_BARRA = 40

const ABRIR = { id: PANEL, title: 'Contexto', columns: ANCHO_DEL_PANEL } as const

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'contexto',
      description: 'Abre el panel lateral con el contexto, los modelos y los tokens',
    })

    void $.ui.open(ABRIR)

    $.clock.every(REVISION_DE_SHELLS_MS, () => {
      void reconciliarShells($)
    })

    // en segundo plano: la consulta tarda unos segundos y no debe demorar el arranque
    const conMcpDePlugins = options.mostrarMcpDePlugins === true
    void revisarMcp($, conMcpDePlugins)
    $.clock.every(REVISION_DE_MCP_MS, () => {
      void revisarMcp($, conMcpDePlugins)
    })

    // en segundo plano: la primera lectura lee el proyecto y fija el commit desde el que se cuentan los de la sesión
    await update($, cambiosPorRevisar, () => true)
    void revisarCambios($)
    $.clock.every(REVISION_DE_CAMBIOS_MS, () => {
      void revisarCambios($)
    })

    try {
      const guardadas = await leerVentanasGuardadas($)
      // lo aprendido en esta sesión manda sobre lo guardado
      await update($, ventanas, previas => ({ ...guardadas, ...previas }))
    } catch {
      // sin memoria entre sesiones: las ventanas se vuelven a aprender
    }

    try {
      const { context, rateLimits } = await $.session.usage()
      await update($, contexto, () => context)
      await update($, limites, () => rateLimits)
      const { version: texto } = await $.session.version()
      await update($, version, () => texto)
      const modelo = await $.session.model()
      await update($, modeloPrincipal, () => modelo)
    } catch {
      // sin lectura inicial: el panel espera a la primera medición
    }

    const propia = await versionDelMod($)
    await update($, modVersion, () => propia)
    // en segundo plano: la consulta a GitHub no debe demorar el arranque de la sesión
    void revisarVersionNueva($, propia, options.avisarVersionNueva !== false)

    return next(e)
  })

  on('command.run', { command: 'contexto' }, async ($, e) => {
    const ancho = anchoParaTerminal(e.presentation.columns)
    await $.ui.open({ ...ABRIR, columns: ancho })

    return { text: `Panel de contexto abierto (${ancho} columnas).` }
  })

  on('session.measure', async ($, e, next) => {
    await update($, contexto, () => e.context)

    if (e.changed.includes('rateLimits')) {
      await update($, limites, () => e.rateLimits)
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const resultado = await next(e)

    if (resultado.deny === undefined && resultado.agentId !== undefined) {
      const id = resultado.agentId
      const nuevo: AgenteEnCurso = {
        id,
        descripcion: e.description,
        tipo: e.subagentType,
        modelo: resultado.model,
        enSegundoPlano: e.background,
        esWorkflow: e.workflow !== undefined,
        tokens: null,
        visto: await $.clock.now(),
      }
      await update($, agentes, lista => [...lista.filter(a => a.id !== id), nuevo])
    }

    return resultado
  })

  on('turn.step', async function* ($, e, next) {
    const resultado = yield* next(e)
    const uso = resultado.usage

    if (uso) {
      try {
        if (e.agentId !== undefined) {
          const id = e.agentId
          const ahora = await $.clock.now()
          const tokens = entradaDelRequest(uso)

          if ((await read($, agentes)).some(a => a.id === id)) {
            await update($, agentes, lista => conTokensDeAgente(lista, id, uso.model, tokens, ahora))
          } else {
            await reponerAgente($, id, uso.model, tokens, ahora)
          }
        } else {
          const ctx = await read($, contexto)
          const conocidas = await read($, ventanas)

          if (ctx && conocidas[uso.model] !== ctx.window) {
            await update($, ventanas, previas => ({ ...previas, [uso.model]: ctx.window }))
            await recordarVentana($, uso.model, ctx.window)
          }
        }
      } catch {
        // observar nunca debe romper el turno
      }
    }
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await retirarAgente($, e.agent_id)
    await reconciliarShells($, e.background_tasks)

    return next(e)
  })

  // La lista del motor es de la sesión (no del subagente): vale igual desde cualquiera de los dos Stop.
  on('classic.Stop', async ($, e, next) => {
    await reconciliarShells($, e.background_tasks)

    return next(e)
  })

  // Un Bash o PowerShell que dejó una tarea en segundo plano (run_in_background, Ctrl+B o timeout).
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const resultado = await next(e)

    try {
      const id = resultado.deny === undefined ? tareaLanzadaPor(resultado.result) : null

      if (id !== null) {
        const visto = await $.clock.now()
        const comando = etiquetaDeShell(e.command, e.description) || id
        await update($, shells, lista => [...lista.filter(s => s.id !== id), { id, comando, visto }])
      }
    } catch {
      // observar nunca debe romper la herramienta
    }

    return resultado
  })

  // El aviso de fin de una tarea llega como un prompt: se la da de baja sin esperar al próximo Stop.
  on('prompt.submit', async ($, e, next) => {
    const terminada = idDeTareaTerminada(e.text)

    if (terminada !== null) {
      await soltarShell($, terminada)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.usage) {
      const { model, ...uso } = e.usage
      await update($, modelos, lista => acumular(lista, model, uso))

      if (e.agentId === undefined) {
        await update($, modeloPrincipal, () => model)
      }
    }

    const resultado = await next(e)

    // también los agentes editan archivos: cualquier turno avisa que puede haber cambios
    await marcarCambiosPorRevisar($)

    if (e.agentId === undefined) {
      await reconciliarAgentes($)
    }

    return resultado
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const ctx: Contexto | null = await read($, contexto)
    const lista: ModeloUsado[] = await read($, modelos)
    const texto: string | null = await read($, version)
    const propia: string | null = await read($, modVersion)
    const nueva: string | null = await read($, versionNueva)
    const principal: string | null = await read($, modeloPrincipal)
    const donde: Proyecto | null = await read($, proyecto)
    const cambiosGit: CambiosDeGit | null = await read($, cambios)
    const enCurso: AgenteEnCurso[] = await read($, agentes)
    const conocidas: Record<string, number> = await read($, ventanas)
    const reportados: LimiteDeUso[] = await read($, limites)
    const ahora = await $.clock.now()
    const enSegundoPlano = (await read($, shells)).filter(s => shellSigueEnCurso(s, ahora))
    const servidores: ServidorMcp[] | null = await read($, mcp)
    const consultandoMcp: boolean = await read($, mcpConsultando)
    // el aviso es solo para la primera lectura: con una lista ya dibujada, refrescarla no debe mover el panel
    const primeraLecturaDeMcp = servidores === null && consultandoMcp

    const columnas = e.props.bodyColumns ?? ANCHO_DEL_PANEL
    const cambiosEnUnaLinea = cambiosGit !== null && cambiosCabenEnUnaLinea(cambiosGit, columnas)
    const ancho = Math.max(10, Math.min(ANCHO_MAXIMO_DE_LA_BARRA, columnas - 8))
    const hayLectura = ctx !== null && ctx.percent !== undefined && ctx.tokens !== undefined
    const color = hayLectura ? colorDeContexto(ctx.percent ?? 0) : 'subtle'
    const barra = armarBarra(hayLectura ? (ctx.percent ?? 0) : 0, ancho)

    const entrada = lista.reduce((suma, m) => suma + m.entrada, 0)
    const salida = lista.reduce((suma, m) => suma + m.salida, 0)
    const cache = lista.reduce((suma, m) => suma + m.cache, 0)

    // Acoplado, el panel llena el alto para que el espaciador empuje las cuotas al fondo; en línea, el marco se ajusta al contenido.
    const altoCompleto = e.props.placement === 'dock' ? { minHeight: e.props.scroll.bodyRows } : {}

    return (
      <Box key="panel" flexDirection="column" {...altoCompleto}>
        <Box>
          <Box flexDirection="column">
            <Text color="claude">{' ▐▛███▜▌'}</Text>
            <Text color="claude">{'▝▜█████▛▘'}</Text>
            <Text color="claude">{'  ▘▘ ▝▝'}</Text>
          </Box>
          <Box flexDirection="column">
            <Text bold>{'  Claude Code'}</Text>
            <Text dimColor>{texto ? `  v${numeroDeVersion(texto)}` : '  versión sin leer'}</Text>
            <Text color={principal ? colorDeModelo(principal) : 'subtle'}>
              {principal ? `  ${modeloCorto(principal)}` : '  modelo sin leer'}
            </Text>
          </Box>
        </Box>

        <Text dimColor>{recortar(propia ? `${$.plugin.name} v${propia}` : $.plugin.name, columnas)}</Text>
        {nueva !== null && (
          <Box flexDirection="column">
            <Text color="warning" bold>{`Versión nueva: v${nueva}`}</Text>
            <Text dimColor>{`Actualizar: ${COMANDO_DE_ACTUALIZACION}`}</Text>
            <Text dimColor>Se aplica al reiniciar.</Text>
          </Box>
        )}

        <Text bold>{'\n'}Contexto</Text>
        <Box>
          <Text color={color}>{barra.llenos}</Text>
          <Text dimColor>{barra.vacios}</Text>
          <Text color={color} bold>
            {hayLectura ? ` ${ctx.percent}%` : ' --'}
          </Text>
        </Box>
        <Text dimColor>
          {hayLectura
            ? `${formatear(ctx.tokens ?? 0)} de ${formatear(ctx.window)} tokens`
            : 'Esperando la primera respuesta…'}
        </Text>

        <Text bold>{'\n'}Modelos</Text>
        {lista.length === 0 && <Text dimColor>Sin turnos todavía.</Text>}
        {lista.map(m => (
          <Box key={m.id} flexDirection="column">
            <Box>
              <Text color={colorDeModelo(m.id)} bold>
                ● {modeloCorto(m.id)}
              </Text>
              <Text dimColor> ×{m.turnos}</Text>
            </Box>
            <Text dimColor>
              {'  '}↑{formatear(m.entrada)} ↓{formatear(m.salida)} ⟳{formatear(m.cache)}
            </Text>
          </Box>
        ))}

        <Text bold>{'\n'}Tokens consumidos</Text>
        <Text>
          ↑ {formatear(entrada)} ↓ {formatear(salida)} ⟳ {formatear(cache)}
        </Text>
        <Text dimColor>↑ entrada ↓ salida ⟳ caché leída</Text>
        <Text dimColor>Cuenta desde que cargó el panel.</Text>

        <Text bold>{'\n'}Proyecto</Text>
        {donde === null ? (
          <Text dimColor>Leyendo…</Text>
        ) : (
          <Box flexDirection="column">
            <Text>{recortar(donde.nombre, columnas)}</Text>
            <Text dimColor>{recortar(`rama: ${donde.rama ?? 'sin git'}`, columnas)}</Text>
            {donde.worktree !== null && (
              <Text dimColor>{recortar(`worktree: ${donde.worktree}`, columnas)}</Text>
            )}
            {cambiosGit !== null && (
              <Box flexDirection="column">
                {!cambiosEnUnaLinea && <Text dimColor>{ROTULO_DE_ARCHIVOS.trimEnd()}</Text>}
                <Box>
                  {cambiosEnUnaLinea && <Text dimColor>{ROTULO_DE_ARCHIVOS}</Text>}
                  <Text
                    color={cambiosGit.sinComitear > 0 ? 'error' : undefined}
                    dimColor={cambiosGit.sinComitear === 0}
                    bold={cambiosGit.sinComitear > 0}
                  >
                    {`${cambiosGit.sinComitear}`}
                  </Text>
                  <Text dimColor>{ETIQUETA_SIN_COMITEAR}</Text>
                  <Text>{SEPARACION_DE_CAMBIOS}</Text>
                  <Text
                    color={cambiosGit.comiteados > 0 ? 'success' : undefined}
                    dimColor={cambiosGit.comiteados === 0}
                    bold={cambiosGit.comiteados > 0}
                  >
                    {`${cambiosGit.comiteados}`}
                  </Text>
                  <Text dimColor>{etiquetaDeComiteados(cambiosGit.comiteados)}</Text>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {(primeraLecturaDeMcp || (servidores !== null && servidores.length > 0)) && (
          <Box flexDirection="column">
            <Text bold>{'\n'}MCP</Text>
            {primeraLecturaDeMcp && <Text dimColor>Consultando estados…</Text>}
            {(servidores ?? []).map(s => (
              <Box key={s.nombre}>
                <Text color={s.conectado ? 'success' : 'error'} bold>
                  {s.conectado ? '✔ ' : '✘ '}
                </Text>
                <Text wrap="truncate-end">{recortar(s.nombre, Math.max(1, columnas - 2))}</Text>
              </Box>
            ))}
          </Box>
        )}

        {enCurso.length > 0 && (
          <Box flexDirection="column">
            <Text bold>{`\nAgentes en curso (${enCurso.length})`}</Text>
            {enCurso.map(a => {
              const pct = porcentajeDeAgente(a, conocidas)
              const ventana = conocidas[a.modelo]
              const mini = armarBarra(pct ?? 0, Math.max(8, Math.floor(ancho / 2)))

              return (
                <Box key={a.id} flexDirection="column">
                  <Text color={colorDeModelo(a.modelo)} bold>
                    {`● ${modeloCorto(a.modelo)}${a.esWorkflow ? ' [workflow]' : a.enSegundoPlano ? ' [2º plano]' : ''}`}
                  </Text>
                  <Text dimColor>{recortar(`  ${a.descripcion || a.tipo}`, columnas)}</Text>
                  {pct !== null && a.tokens !== null ? (
                    <Box>
                      <Text>{'  '}</Text>
                      <Text color={colorDeContexto(pct)}>{mini.llenos}</Text>
                      <Text dimColor>{mini.vacios}</Text>
                      <Text color={colorDeContexto(pct)} bold>{` ${pct}%`}</Text>
                    </Box>
                  ) : null}
                  <Text dimColor>
                    {a.tokens === null
                      ? '  contexto: esperando el primer paso'
                      : ventana
                        ? `  ${formatear(a.tokens)} de ${formatear(ventana)} tokens`
                        : `  ${formatear(a.tokens)} tokens · ventana sin dato`}
                  </Text>
                </Box>
              )
            })}
            {enCurso.some(a => a.tokens !== null && !conocidas[a.modelo]) && (
              <Box flexDirection="column">
                <Text dimColor>{`\n${recortar('Sin barra: ventana del modelo sin dato.', columnas)}`}</Text>
                <Text dimColor>{recortar('Se aprende cuando corre como principal.', columnas)}</Text>
              </Box>
            )}
          </Box>
        )}

        {enSegundoPlano.length > 0 && (
          <Box flexDirection="column">
            <Text bold>{`\nShells en segundo plano (${enSegundoPlano.length})`}</Text>
            {enSegundoPlano.map(s => (
              <Box key={s.id}>
                <Text color="success" bold>
                  {'● '}
                </Text>
                <Text dimColor wrap="truncate-end">
                  {recortar(s.comando, Math.max(1, columnas - 2))}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexGrow={1} />

        <Box flexDirection="column">
          <Text bold>{'\n'}Cuotas de uso</Text>
          {reportados.length === 0 ? (
            <Box flexDirection="column">
              <Text dimColor>Se completa con la primera respuesta.</Text>
              <Text dimColor>Solo en cuentas con suscripción.</Text>
            </Box>
          ) : (
            ventanasDeUso(reportados).map(({ etiqueta, limite }) => {
              const vencida = limite !== null && ventanaVencida(limite.resetsAt, ahora)
              const reinicio = limite?.resetsAt ? textoDeReinicio(limite.resetsAt, ahora) : null
              const aviso =
                limite === null
                  ? ' · sin dato'
                  : reinicio === null
                    ? ''
                    : ` · ${vencida ? 'reinició' : 'reinicia'} ${reinicio}`
              const colorDeCuota =
                limite === null || vencida ? 'subtle' : colorDeContexto(limite.percentUsed)
              const fina = armarBarra(limite?.percentUsed ?? 0, ancho, GLIFOS_FINOS)

              return (
                <Box key={etiqueta} flexDirection="column">
                  <Box>
                    <Text bold>{etiqueta}</Text>
                    <Text dimColor>{recortar(aviso, Math.max(0, columnas - etiqueta.length))}</Text>
                  </Box>
                  <Box>
                    <Text color={colorDeCuota}>{fina.llenos}</Text>
                    <Text dimColor>{fina.vacios}</Text>
                    <Text color={colorDeCuota} bold>
                      {limite === null ? ' --' : ` ${Math.round(limite.percentUsed)}%`}
                    </Text>
                  </Box>
                </Box>
              )
            })
          )}
        </Box>
      </Box>
    )
  })
}
