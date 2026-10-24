import type { AgentInfo, EngineInterface, Register } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  ANCHO_DEL_PANEL,
  INACTIVIDAD_DE_SHELL_MS,
  INACTIVIDAD_DE_WORKFLOW_MS,
  RETIRADOS_RECORDADOS,
  REVISION_DE_CAMBIOS_MS,
  REVISION_DE_MCP_MS,
  REVISION_DE_SHELLS_MS,
  VENTANA_DE_RETIRO_MS,
  acumular,
  adoptarAgente,
  conRetirado,
  GLIFOS_FINOS,
  anchoParaTerminal,
  armarBarra,
  cambiosCabenEnUnaLinea,
  colorDeContexto,
  colorDeModelo,
  conTokensDeAgente,
  entradaDelRequest,
  esMcpDelUsuario,
  etiquetaDeShell,
  formatear,
  idDeTareaTerminada,
  modeloCorto,
  nombreDe,
  numeroDeVersion,
  porcentajeDeAgente,
  recortar,
  seMuestraElMcp,
  shellSigueEnCurso,
  servidoresMcp,
  shellsDeLasTareas,
  sigueEnCurso,
  tareaLanzadaPor,
  textoDeReinicio,
  ventanaVencida,
  ventanasDeUso,
  INTERVALO_DE_CHEQUEO_MS,
  buscarVersionPublicada,
  comprobarVersionNueva,
  esMasNueva,
} from './register'

const USO = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 20,
}

const AGENTE = {
  id: 'a1',
  descripcion: 'revisar el diff',
  tipo: 'general-purpose',
  modelo: 'claude-sonnet-5-5',
  enSegundoPlano: true,
  esWorkflow: false,
  tokens: null,
  visto: 0,
}

const PROPS = {
  title: 'Contexto',
  isFocused: false,
  bodyColumns: 44,
  placement: 'dock' as 'dock' | 'inline',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const ORIGEN = { kind: 'plugin' as const, name: 'contexto-lateral' }

const sinTruncar = { isStdoutTruncated: false, isStderrTruncated: false }

const montar = ($: Engine, props: typeof PROPS = PROPS) =>
  $.ui.mount({
    plugin: 'contexto-lateral',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'contexto-lateral',
    props,
  })

// martes 6 de octubre de 2026, 10:00 en la zona de la máquina: los tests no dependen de cuál sea
const AHORA = new Date(2026, 9, 6, 10, 0).getTime()
const aISO = (dia: number, hora: number, minuto = 0): string =>
  new Date(2026, 9, dia, hora, minuto).toISOString()

describe('helpers', () => {
  test('la barra se llena en proporción al porcentaje', () => {
    expect(armarBarra(50, 10)).toEqual({ llenos: '█████', vacios: '░░░░░' })
    expect(armarBarra(0, 4)).toEqual({ llenos: '', vacios: '░░░░' })
    expect(armarBarra(150, 4)).toEqual({ llenos: '████', vacios: '' })
  })

  test('la barra fina usa trazos en vez de bloques', () => {
    expect(armarBarra(50, 10, GLIFOS_FINOS)).toEqual({ llenos: '━━━━━', vacios: '─────' })
  })

  test('de los límites solo se muestran las ventanas de 5 horas y semanal, en ese orden', () => {
    const cinco = { kind: 'five_hour', percentUsed: 34 }
    const semana = { kind: 'seven_day', percentUsed: 12 }

    expect(ventanasDeUso([semana, { kind: 'spend_limit', percentUsed: 1 }, cinco])).toEqual([
      { etiqueta: '5 horas', limite: cinco },
      { etiqueta: 'Semanal', limite: semana },
    ])
    expect(ventanasDeUso([semana])[0]?.limite).toBeNull()
    expect(ventanasDeUso([]).map(v => v.limite)).toEqual([null, null])
  })

  test('el reinicio muestra solo la hora si es hoy y el día si no', () => {
    expect(textoDeReinicio(aISO(6, 18, 5), AHORA)).toBe('18:05')
    expect(textoDeReinicio(aISO(7, 14), AHORA)).toBe('mié 14:00')
    expect(textoDeReinicio('no es una fecha', AHORA)).toBeNull()
  })

  test('una ventana vence cuando su reinicio ya pasó', () => {
    expect(ventanaVencida(new Date(AHORA - 1).toISOString(), AHORA)).toBe(true)
    expect(ventanaVencida(new Date(AHORA + 1).toISOString(), AHORA)).toBe(false)
    expect(ventanaVencida(undefined, AHORA)).toBe(false)
    expect(ventanaVencida('no es una fecha', AHORA)).toBe(false)
  })

  test('el color del contexto cambia a 60% y a 85%', () => {
    expect(colorDeContexto(59)).toBe('success')
    expect(colorDeContexto(60)).toBe('warning')
    expect(colorDeContexto(85)).toBe('error')
  })

  test('cada familia de modelo tiene su color y el resto cae en subtle', () => {
    expect(colorDeModelo('claude-opus-5-5')).not.toBe(colorDeModelo('claude-sonnet-5-5'))
    expect(colorDeModelo('modelo-raro')).toBe('subtle')
  })

  test('los números se abrevian', () => {
    expect(formatear(999)).toBe('999')
    expect(formatear(1500)).toBe('1.5k')
    expect(formatear(2_500_000)).toBe('2.50M')
  })

  test('acumular suma por modelo y agrega los nuevos', () => {
    const uno = acumular([], 'claude-sonnet-5-5', USO)
    expect(uno).toEqual([
      { id: 'claude-sonnet-5-5', turnos: 1, entrada: 30, salida: 5, cache: 100 },
    ])

    const dos = acumular(uno, 'claude-sonnet-5-5', USO)
    expect(dos[0]?.turnos).toBe(2)
    expect(dos[0]?.entrada).toBe(60)

    const tres = acumular(dos, 'claude-opus-5-5', USO)
    expect(tres.map(m => m.id)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5'])
  })

  test('el nombre corto del modelo saca el prefijo claude- y la fecha', () => {
    expect(modeloCorto('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
    expect(modeloCorto('claude-opus-4-1-20250805')).toBe('opus-4-1')
    expect(modeloCorto('claude-sonnet-5-5')).toBe('sonnet-5-5')
    expect(modeloCorto('modelo-raro')).toBe('modelo-raro')
  })

  test('el nombre del proyecto sale de la última carpeta, con cualquier separador', () => {
    expect(nombreDe('C:\\workspace\\mi-proyecto\\')).toBe('mi-proyecto')
    expect(nombreDe('/home/usuario/proyecto')).toBe('proyecto')
  })

  test('la versión se queda con el número', () => {
    expect(numeroDeVersion('2.1.292 (Claude Code)')).toBe('2.1.292')
    expect(numeroDeVersion('2.1.292')).toBe('2.1.292')
  })

  test('el panel pide un 20% de la terminal, con piso y techo', () => {
    expect(anchoParaTerminal(200)).toBe(40)
    expect(anchoParaTerminal(100)).toBe(36)
    expect(anchoParaTerminal(400)).toBe(60)
  })

  test('recortar agrega puntos suspensivos solo cuando no entra', () => {
    expect(recortar('corto', 10)).toBe('corto')
    expect(recortar('un texto bastante largo', 10)).toBe('un texto …')
    expect(recortar('un texto bastante largo', 10)).toHaveLength(10)
  })

  test('el contexto de un request suma lo no cacheado y el caché leído y escrito', () => {
    expect(entradaDelRequest(USO)).toBe(130)
  })

  test('un agente solo muestra porcentaje si se conoce la ventana de su modelo', () => {
    const conTokens = conTokensDeAgente([AGENTE], 'a1', 'claude-sonnet-5-5', 50_000, 5)
    expect(conTokens[0]?.tokens).toBe(50_000)
    expect(conTokens[0]?.visto).toBe(5)

    expect(porcentajeDeAgente(conTokens[0] ?? AGENTE, { 'claude-sonnet-5-5': 200_000 })).toBe(25)
    expect(porcentajeDeAgente(conTokens[0] ?? AGENTE, {})).toBeNull()
    expect(porcentajeDeAgente(AGENTE, { 'claude-sonnet-5-5': 200_000 })).toBeNull()
  })

  test('conTokensDeAgente no toca a los otros agentes', () => {
    const otro = { ...AGENTE, id: 'a2' }
    const lista = conTokensDeAgente([AGENTE, otro], 'a2', 'claude-haiku-4-5', 7, 9)
    expect(lista[0]).toEqual(AGENTE)
    expect(lista[1]?.modelo).toBe('claude-haiku-4-5')
  })

  test('un subagente sigue si la API lo lista; uno de workflow solo caduca por inactividad', () => {
    const vivos = new Set(['a1'])
    const workflow = { ...AGENTE, id: 'wf1', esWorkflow: true, visto: 1_000 }

    expect(sigueEnCurso(AGENTE, vivos, 0)).toBe(true)
    expect(sigueEnCurso({ ...AGENTE, id: 'caido' }, vivos, 0)).toBe(false)

    expect(sigueEnCurso(workflow, vivos, 1_000 + INACTIVIDAD_DE_WORKFLOW_MS - 1)).toBe(true)
    expect(sigueEnCurso(workflow, vivos, 1_000 + INACTIVIDAD_DE_WORKFLOW_MS)).toBe(false)
  })
})

describe('panel', () => {
  // el proyecto se lee en segundo plano al abrir la sesión: se le dan vueltas para que termine antes de mirar
  const abrirSesion = async ($: Engine, on: Parameters<typeof mock.clock>[0]) => {
    on('env.get', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'contexto' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))

    await $.session.start({ cwd: 'C:\\trabajo\\mi-proyecto', surface: 'terminal', isInteractive: true })
    for (let i = 0; i < 100; i += 1) {
      await Promise.resolve()
    }
  }

  test('/contexto abre el panel pidiendo el 20% del ancho de la terminal', async ($, on) => {
    const pedidos: Array<{ id: string; columns?: number }> = []
    on('ui.open', (_$, e) => {
      pedidos.push(e)

      return { value: { isPlaced: true } }
    })

    await $.command.run({
      command: 'contexto',
      args: '',
      origin: ORIGEN,
      presentation: { columns: 250, isFullscreen: true },
    })

    expect(pedidos[0]?.id).toBe('contexto-lateral')
    expect(pedidos[0]?.columns).toBe(anchoParaTerminal(250))
  })

  test('/contexto en una terminal angosta no baja del piso', async ($, on) => {
    const pedidos: Array<{ columns?: number }> = []
    on('ui.open', (_$, e) => {
      pedidos.push(e)

      return { value: { isPlaced: true } }
    })

    await $.command.run({
      command: 'contexto',
      args: '',
      origin: ORIGEN,
      presentation: { columns: 80, isFullscreen: false },
    })

    expect(pedidos[0]?.columns).toBe(anchoParaTerminal(80))
    expect(pedidos[0]?.columns).toBeLessThan(ANCHO_DEL_PANEL)
  })

  test('dibuja el estado vacío antes de la primera respuesta', async ($, on) => {
    mock.clock(on)

    const ui = await $.ui.mount({
      plugin: 'contexto-lateral',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'contexto-lateral',
      props: PROPS,
    })

    expect(await ui.find({ type: 'Text', text: /Esperando la primera respuesta/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sin turnos todavía/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Claude Code/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Leyendo…' })).toBeDefined()
    await ui.unmount()
  })

  test('el panel muestra el nombre del mod y la versión que dice su manifiesto', async ($, on) => {
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'contexto' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', ...sinTruncar } }))
    on('fs.read', () => ({ value: JSON.stringify({ name: 'contexto-lateral', version: '1.2.3' }) }))
    mock.clock(on)

    await $.session.start({ cwd: 'C:\\trabajo\\mi-proyecto', surface: 'terminal', isInteractive: true })

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: 'contexto-lateral v1.2.3' })).toBeDefined()
    await ui.unmount()
  })

  test('si todavía no se leyó el manifiesto, el panel muestra solo el nombre del mod', async ($, on) => {
    mock.clock(on)

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: 'contexto-lateral' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /contexto-lateral v/ })).toBeUndefined()
    await ui.unmount()
  })

  test('una medición llena la barra y el color sigue al porcentaje', async ($, on) => {
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    mock.clock(on)

    for (const [percent, color] of [
      [40, 'success'],
      [70, 'warning'],
      [90, 'error'],
    ] as const) {
      await $.session.measure({
        context: { tokens: percent * 1000, window: 100_000, percent },
        rateLimits: [],
        changed: ['context'],
      })

      const ui = await $.ui.mount({
        plugin: 'contexto-lateral',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'contexto-lateral',
        props: PROPS,
      })

      const porcentaje = await ui.find({ type: 'Text', text: `${percent}%` })
      expect(porcentaje).toBeDefined()
      expect(porcentaje?.props.color).toBe(color)

      const llenos = await ui.find({ type: 'Text', text: /^█+$/ })
      expect(llenos?.props.color).toBe(color)
      await ui.unmount()
    }
  })

  test('un turno suma el modelo con su color y los tokens', async ($, on) => {
    on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', ...sinTruncar } }))
    on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
    on('agent.list', () => ({ value: [] }))
    mock.clock(on)

    await $.turn.complete({
      answer: 'listo',
      durationMs: 10,
      isAborted: false,
      turnId: 'turno-1',
      reason: 'answer',
      usage: { ...USO, model: 'claude-opus-5-5' },
    })

    const ui = await $.ui.mount({
      plugin: 'contexto-lateral',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'contexto-lateral',
      props: PROPS,
    })

    const modelo = await ui.find({ type: 'Text', text: /opus-5-5/ })
    expect(modelo?.props.color).toBe(colorDeModelo('claude-opus-5-5'))
    expect(await ui.find({ type: 'Text', text: /×1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '↑ 30 ↓ 5 ⟳ 100' })).toBeDefined()
    await ui.unmount()
  })

  test('sin git el panel muestra el proyecto y avisa que no hay rama', async ($, on) => {
    on('process.run', () => ({
      value: { exitCode: 128, stdout: '', stderr: 'not a git repository', ...sinTruncar },
    }))
    on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
    mock.clock(on)

    await abrirSesion($, on)

    const ui = await $.ui.mount({
      plugin: 'contexto-lateral',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'contexto-lateral',
      props: PROPS,
    })

    expect(await ui.find({ type: 'Text', text: 'mi-proyecto' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'rama: sin git' })).toBeDefined()
    await ui.unmount()
  })

  test('en un worktree muestra el proyecto, la rama y el worktree', async ($, on) => {
    on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto-s22' }))
    mock.clock(on)
    on('process.run', (_$, e) => {
      const args = e.argv.join(' ')
      const salida = args.includes('--show-toplevel')
        ? 'C:/trabajo/mi-proyecto-s22\nC:/trabajo/mi-proyecto/.git/worktrees/s22\nC:/trabajo/mi-proyecto/.git'
        : 'feat/algo'

      return { value: { exitCode: 0, stdout: `${salida}\n`, stderr: '', ...sinTruncar } }
    })

    await abrirSesion($, on)

    const ui = await $.ui.mount({
      plugin: 'contexto-lateral',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'contexto-lateral',
      props: PROPS,
    })

    expect(await ui.find({ type: 'Text', text: 'mi-proyecto' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'rama: feat/algo' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'worktree: mi-proyecto-s22' })).toBeDefined()
    await ui.unmount()
  })
})

describe('cuotas de uso', () => {
  const medir = async (
    $: Engine,
    on: Parameters<Register>[0],
    rateLimits: Array<{ kind: string; percentUsed: number; resetsAt?: string }>,
  ) => {
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    mock.clock(on, { now: AHORA })

    await $.session.measure({ context: { window: 100_000 }, rateLimits, changed: ['rateLimits'] })
  }

  test('sin lectura avisa que se completa con la primera respuesta', async ($, on) => {
    mock.clock(on)

    const ui = await montar($)

    expect(await ui.find({ type: 'Text', text: 'Cuotas de uso' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Se completa con la primera respuesta/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^━+$/ })).toBeUndefined()
    await ui.unmount()
  })

  test('cada ventana tiene su barra fina, su reinicio y un color que sigue al uso', async ($, on) => {
    await medir($, on, [
      { kind: 'five_hour', percentUsed: 34, resetsAt: aISO(6, 15) },
      { kind: 'seven_day', percentUsed: 87.4, resetsAt: aISO(9, 8, 30) },
    ])

    const ui = await montar($)

    expect(await ui.find({ type: 'Text', text: '5 horas' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · reinicia 15:00' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Semanal' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' · reinicia vie 08:30' })).toBeDefined()

    expect((await ui.find({ type: 'Text', text: ' 34%' }))?.props.color).toBe('success')
    expect((await ui.find({ type: 'Text', text: ' 87%' }))?.props.color).toBe('error')

    const barras = await ui.findAll({ type: 'Text', text: /^━+$/ })
    expect(barras.map(b => b.props.color)).toEqual(['success', 'error'])
    await ui.unmount()
  })

  test('el color pasa a amarillo desde el 60%', async ($, on) => {
    await medir($, on, [{ kind: 'five_hour', percentUsed: 60, resetsAt: aISO(6, 15) }])

    const ui = await montar($)

    expect((await ui.find({ type: 'Text', text: ' 60%' }))?.props.color).toBe('warning')
    await ui.unmount()
  })

  test('si falta una ventana la marca sin dato en vez de inventarla', async ($, on) => {
    await medir($, on, [{ kind: 'seven_day', percentUsed: 12, resetsAt: aISO(9, 8, 30) }])

    const ui = await montar($)

    expect(await ui.find({ type: 'Text', text: ' · sin dato' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' 12%' })).toBeDefined()
    await ui.unmount()
  })

  test('una ventana ya reiniciada se atenúa y avisa que el dato es previo', async ($, on) => {
    await medir($, on, [{ kind: 'five_hour', percentUsed: 90, resetsAt: aISO(6, 9) }])

    const ui = await montar($)

    expect(await ui.find({ type: 'Text', text: ' · reinició 09:00' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: ' 90%' }))?.props.color).toBe('subtle')
    expect((await ui.find({ type: 'Text', text: /^━+$/ }))?.props.color).toBe('subtle')
    await ui.unmount()
  })

  test('acoplado, el panel ocupa todo el alto para dejar las cuotas abajo; en línea, no', async ($, on) => {
    mock.clock(on)

    const acoplado = await montar($)
    expect((await acoplado.find({ type: 'Box', key: 'panel' }))?.props.minHeight).toBe(40)
    await acoplado.unmount()

    const enLinea = await montar($, { ...PROPS, placement: 'inline' })
    expect((await enLinea.find({ type: 'Box', key: 'panel' }))?.props.minHeight).toBeUndefined()
    await enLinea.unmount()
  })
})

describe('agentes en segundo plano', () => {
  const SPAWN = {
    tool_use_id: 'toolu_1',
    prompt: 'mapear la API',
    description: 'revisar el diff',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' } as const,
    parentModel: 'claude-sonnet-5-5',
    background: true,
    fork: false,
  }

  test('un agente nuevo aparece con su modelo y se va cuando termina', async ($, on) => {
    on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
    on('classic.SubagentStop', () => ({}))
    mock.clock(on)

    await $.agent.spawn(SPAWN)

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /Agentes en curso \(1\)/ })).toBeDefined()
    const fila = await ui.find({ type: 'Text', text: /haiku-4-5 \[2º plano\]/ })
    expect(fila?.props.color).toBe(colorDeModelo('claude-haiku-4-5'))
    expect(await ui.find({ type: 'Text', text: /revisar el diff/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /esperando el primer paso/ })).toBeDefined()
    await ui.unmount()

    await $.classic.SubagentStop({
      stop_hook_active: false,
      agent_id: 'a1',
      agent_transcript_path: '',
      agent_type: 'general-purpose',
    })

    const despues = await montar($)
    expect(await despues.find({ type: 'Text', text: /Agentes en curso/ })).toBeUndefined()
    await despues.unmount()
  })

  test('un agente de workflow sobrevive aunque la API no lo liste; un subagente caído no', async ($, on) => {
    on('agent.spawn', (_$, e) => ({
      model: 'claude-haiku-4-5',
      agentId: e.workflow ? 'wf1' : 'sub1',
    }))
    on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', ...sinTruncar } }))
    on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
    on('agent.list', () => ({ value: [] }))

    const reloj = mock.clock(on)

    await $.agent.spawn(SPAWN)
    await $.agent.spawn({ ...SPAWN, workflow: { runId: 'wf_abc123', agentIndex: 1 } })

    await $.turn.complete({
      answer: 'listo',
      durationMs: 10,
      isAborted: false,
      turnId: 'turno-wf',
      reason: 'answer',
      usage: { ...USO, model: 'claude-sonnet-5-5' },
    })

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /Agentes en curso \(1\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /haiku-4-5 \[workflow\]/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\[2º plano\]/ })).toBeUndefined()
    await ui.unmount()

    // sin señales de vida durante más de diez minutos, el de workflow caduca
    await reloj.advance(INACTIVIDAD_DE_WORKFLOW_MS + 1)
    await $.turn.complete({
      answer: 'listo',
      durationMs: 10,
      isAborted: false,
      turnId: 'turno-wf-2',
      reason: 'answer',
      usage: { ...USO, model: 'claude-sonnet-5-5' },
    })

    const despues = await montar($)
    expect(await despues.find({ type: 'Text', text: /Agentes en curso/ })).toBeUndefined()
    await despues.unmount()
  })

  test('el contexto del agente sale del último request y usa la ventana ya conocida del modelo', async ($, on) => {
    on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'a2' }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    mock.clock(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: {
          input_tokens: 60_000,
          output_tokens: 10,
          cache_read_input_tokens: 50_000,
          cache_creation_input_tokens: 0,
          model: 'claude-haiku-4-5',
        },
      }
    })

    await $.session.measure({
      context: { tokens: 1000, window: 200_000, percent: 1 },
      rateLimits: [],
      changed: ['context'],
    })
    await $.agent.spawn(SPAWN)

    // sin haber visto a ese modelo como principal: tokens sí, ventana no
    for await (const _chunk of $.turn.step({
      turnId: 'turno-a2',
      index: 0,
      model: 'claude-haiku-4-5',
      messageCount: 1,
      agentId: 'a2',
    })) {
      // el hook de abajo no emite trozos
    }

    const sinVentana = await montar($)
    expect(await sinVentana.find({ type: 'Text', text: /110\.0k tokens · ventana sin dato/ })).toBeDefined()
    await sinVentana.unmount()

    // el mismo modelo corre ahora como principal: se aprende su ventana
    for await (const _chunk of $.turn.step({
      turnId: 'turno-main',
      index: 0,
      model: 'claude-haiku-4-5',
      messageCount: 1,
    })) {
      // idem
    }

    const conVentana = await montar($)
    const barra = await conVentana.find({ type: 'Text', text: ' 55%' })
    expect(barra?.props.color).toBe('success')
    expect(await conVentana.find({ type: 'Text', text: /110\.0k de 200\.0k tokens/ })).toBeDefined()
    await conVentana.unmount()
  })
})

type Nodo = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** El árbol dibujado, aplanado en orden de documento: sirve para comprobar quién queda último. */
const aplanar = (nodo: unknown, salida: Nodo[] = []): Nodo[] => {
  if (typeof nodo === 'object' && nodo !== null) {
    const elemento = nodo as Nodo
    salida.push(elemento)
    elemento.children?.forEach(hijo => aplanar(hijo, salida))
  }

  return salida
}

/** El aviso que el motor entrega cuando termina una tarea en segundo plano (formato real de un transcript). */
const aviso = (id: string, estado = 'completed'): string =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_01B9</tool-use-id>\n` +
  `<output-file>C:\\tmp\\tasks\\${id}.output</output-file>\n<status>${estado}</status>\n` +
  `<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>`

describe('shells en segundo plano', () => {
  const TITULO = /Shells en segundo plano/

  /** Lo último que el panel guardó como lista de shells: el estado, no lo dibujado. */
  const vigilarShells = (on: Parameters<Register>[0]) => {
    const escritas: Array<ReadonlyArray<{ id: string; comando: string; visto: number }>> = []
    on('state.set', (_$, e, next) => {
      if (e.plugin === 'contexto-lateral' && e.key === 'shells') {
        escritas.push(e.value as (typeof escritas)[number])
      }

      return next(e)
    })

    return () => escritas.at(-1)
  }

  /** El aviso llega como un prompt cuyo origen es una notificación de tarea. */
  const avisar = ($: Engine, texto: string) =>
    $.prompt.submit({ text: texto, wait: false, origin: { kind: 'task-notification' } })

  /** Lo que el motor contesta a un Bash: cada comando deja la tarea que diga `ids`. */
  const conBash = (on: Parameters<Register>[0], ids: Record<string, string>) => {
    on('tool.call', { tool: 'Bash' }, (_$, e) => ({
      result: {
        stdout: '',
        stderr: '',
        interrupted: false,
        backgroundTaskId: ids[e.command],
      },
    }))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    on('classic.Stop', () => ({}))
  }

  const lanzar = ($: Engine, comando: string) =>
    $.tool.call({ tool: 'Bash', command: comando, run_in_background: true })

  describe('helpers', () => {
    test('la etiqueta es una sola línea y no empieza con el cd a la carpeta', () => {
      expect(etiquetaDeShell('sleep 60')).toBe('sleep 60')
      expect(etiquetaDeShell('pnpm dev\n  --port 3006\n')).toBe('pnpm dev --port 3006')
      expect(etiquetaDeShell('cd "C:/proyectos/mi carpeta" && pnpm vitest run')).toBe('pnpm vitest run')
      expect(etiquetaDeShell("cd /tmp/a; cd b && node servidor.js")).toBe('node servidor.js')
      expect(etiquetaDeShell('cd /tmp/a &&')).toBe('cd /tmp/a &&')
      expect(etiquetaDeShell(undefined, 'Levantar el   servidor')).toBe('Levantar el servidor')
      expect(etiquetaDeShell('', '')).toBe('')
    })

    test('un Bash deja una tarea solo si el motor dio su id y la va a avisar', () => {
      expect(tareaLanzadaPor({ stdout: '', backgroundTaskId: 'b1' })).toBe('b1')
      expect(tareaLanzadaPor({ stdout: 'listo' })).toBeNull()
      expect(tareaLanzadaPor({ backgroundTaskId: '' })).toBeNull()
      expect(tareaLanzadaPor({ backgroundTaskId: 7 })).toBeNull()
      expect(tareaLanzadaPor('texto')).toBeNull()
      expect(tareaLanzadaPor(null)).toBeNull()
      // el motor la mata con la respuesta final y no manda aviso: no se la sigue
      expect(tareaLanzadaPor({ backgroundTaskId: 'b2', backgroundEndsWithFinalResponse: true })).toBeNull()
    })

    test('el aviso da de baja la tarea solo si trae un estado final', () => {
      expect(idDeTareaTerminada(aviso('b11s1i62y'))).toBe('b11s1i62y')
      expect(idDeTareaTerminada(aviso('b3', 'failed'))).toBe('b3')
      expect(idDeTareaTerminada(aviso('b4', 'killed'))).toBe('b4')
      // un aviso que no es de fin, un estado desconocido y un texto cualquiera no tocan nada
      expect(idDeTareaTerminada(aviso('b5', 'running'))).toBeNull()
      expect(idDeTareaTerminada('<task-notification>\n<task-id>b6</task-id>\n</task-notification>')).toBeNull()
      expect(idDeTareaTerminada('<task-id>b7</task-id><status>completed</status>')).toBeNull()
      expect(idDeTareaTerminada('hola, ¿cómo va todo?')).toBeNull()
    })

    test('de la lista del motor solo cuentan los shells que siguen en curso', () => {
      const tareas = [
        { id: 'b1', type: 'shell', status: 'running', description: 'Levantar el server', command: 'pnpm dev' },
        { id: 'b2', type: 'shell', status: 'completed', description: 'Ya terminó', command: 'ls' },
        { id: 'a1', type: 'subagent', status: 'running', description: 'revisar el diff' },
        { id: 'm1', type: 'monitor', status: 'running', description: 'mirar logs', command: 'tail -f x' },
        { id: 'b3', type: 'shell', status: 'pending', description: 'Sin comando', command: undefined },
      ]

      expect(shellsDeLasTareas(tareas, 9)).toEqual([
        { id: 'b1', comando: 'pnpm dev', visto: 9 },
        { id: 'b3', comando: 'Sin comando', visto: 9 },
      ])
    })

    test('un shell caduca solo tras dos horas sin una señal de vida', () => {
      const shell = { id: 'b1', comando: 'sleep 60', visto: 1_000 }

      expect(INACTIVIDAD_DE_SHELL_MS).toBe(2 * 60 * 60 * 1000)
      expect(shellSigueEnCurso(shell, 1_000 + INACTIVIDAD_DE_SHELL_MS - 1)).toBe(true)
      expect(shellSigueEnCurso(shell, 1_000 + INACTIVIDAD_DE_SHELL_MS)).toBe(false)
    })
  })

  describe('panel', () => {
    test('sin shells la sección no existe y no ocupa lugar', async ($, on) => {
      conBash(on, {})
      mock.clock(on)

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: TITULO })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /●/ })).toBeUndefined()
      await ui.unmount()
    })

    test('un shell lanzado en segundo plano aparece con su comando', async ($, on) => {
      conBash(on, { 'sleep 60': 'b1' })
      mock.clock(on)

      await lanzar($, 'sleep 60')

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: 'Shells en segundo plano (1)' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: '● ' }))?.props.color).toBe('success')
      const fila = await ui.find({ type: 'Text', text: 'sleep 60' })
      expect(fila?.props.dimColor).toBe(true)
      await ui.unmount()
    })

    test('uno lanzado en primer plano (sin tarea) no aparece', async ($, on) => {
      conBash(on, {})
      mock.clock(on)

      await $.tool.call({ tool: 'Bash', command: 'ls' })

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await ui.unmount()
    })

    test('varios shells se cuentan y se listan, cada uno en su fila y sin repetirse', async ($, on) => {
      conBash(on, { 'pnpm dev': 'b1', 'sleep 60': 'b2', 'tail -f app.log': 'b3' })
      mock.clock(on)

      await lanzar($, 'pnpm dev')
      await lanzar($, 'sleep 60')
      await lanzar($, 'tail -f app.log')
      await lanzar($, 'sleep 60')

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: 'Shells en segundo plano (3)' })).toBeDefined()
      const filas = await ui.findAll({ type: 'Text', text: /^(pnpm dev|sleep 60|tail -f app\.log)$/ })
      expect(filas.map(f => f.text)).toEqual(['pnpm dev', 'tail -f app.log', 'sleep 60'])
      await ui.unmount()
    })

    test('el cd a la carpeta no se come la fila, y el comando largo se corta con puntos suspensivos', async ($, on) => {
      const largo = `node ${'servidor-con-un-nombre-larguisimo-'.repeat(4)}.js`
      conBash(on, {
        'cd "C:/proyectos/mi carpeta" && pnpm dev': 'b1',
        [largo]: 'b2',
      })
      mock.clock(on)

      await lanzar($, 'cd "C:/proyectos/mi carpeta" && pnpm dev')
      await lanzar($, largo)

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: 'pnpm dev' })).toBeDefined()

      const cortado = await ui.find({ type: 'Text', text: /^node servidor-.*…$/ })
      expect(cortado).toBeDefined()
      // la fila entera (viñeta incluida) entra en el ancho del panel
      expect(cortado?.text).toHaveLength(PROPS.bodyColumns - 2)
      await ui.unmount()
    })

    test('un shell que termina desaparece con su aviso de fin y la sección se va con el último', async ($, on) => {
      conBash(on, { 'pnpm dev': 'b1', 'sleep 60': 'b2' })
      const guardados = vigilarShells(on)
      mock.clock(on)

      await lanzar($, 'pnpm dev')
      await lanzar($, 'sleep 60')
      await avisar($, aviso('b2'))

      const uno = await montar($)
      expect(await uno.find({ type: 'Text', text: 'Shells en segundo plano (1)' })).toBeDefined()
      expect(await uno.find({ type: 'Text', text: 'sleep 60' })).toBeUndefined()
      expect(await uno.find({ type: 'Text', text: 'pnpm dev' })).toBeDefined()
      await uno.unmount()

      // un aviso de otra tarea, uno que no es de fin o un prompt cualquiera no tocan lo que sigue vivo
      await avisar($, aviso('b999'))
      await avisar($, aviso('b1', 'running'))
      await avisar($, 'seguí con lo que estabas haciendo')
      expect(guardados()?.map(s => s.id)).toEqual(['b1'])

      await avisar($, aviso('b1', 'killed'))

      const ninguno = await montar($)
      expect(await ninguno.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await ninguno.unmount()
    })

    test('la lista de tareas del motor al terminar el turno corrige lo inferido', async ($, on) => {
      conBash(on, { 'pnpm dev': 'b1', 'sleep 60': 'b2' })
      const guardados = vigilarShells(on)
      mock.clock(on)

      await lanzar($, 'pnpm dev')
      await lanzar($, 'sleep 60')

      // b2 terminó sin que el aviso llegara; b3 se lanzó antes de que el panel cargara; el resto no son shells
      await $.classic.Stop({
        stop_hook_active: false,
        background_tasks: [
          { id: 'b1', type: 'shell', status: 'running', description: 'Levantar', command: 'pnpm dev' },
          { id: 'b3', type: 'shell', status: 'running', description: 'Logs', command: 'tail -f app.log' },
          { id: 'a1', type: 'subagent', status: 'running', description: 'revisar', agent_type: 'Explore' },
          { id: 'm1', type: 'monitor', status: 'running', description: 'mirar', command: 'tail -f x' },
        ],
      })

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: 'Shells en segundo plano (2)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'sleep 60' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'tail -f app.log' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'tail -f x' })).toBeUndefined()
      await ui.unmount()

      await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
      expect(guardados()).toEqual([])
    })

    test('un Stop sin la lista de tareas no borra nada', async ($, on) => {
      conBash(on, { 'pnpm dev': 'b1' })
      const guardados = vigilarShells(on)
      mock.clock(on)

      await lanzar($, 'pnpm dev')
      await $.classic.Stop({ stop_hook_active: false })

      expect(guardados()).toHaveLength(1)
    })

    test('lo que corre un subagente cuenta; lo que el motor mata con su respuesta final, no', async ($, on) => {
      on('tool.call', { tool: 'Bash' }, (_$, e) => ({
        result: {
          stdout: '',
          stderr: '',
          interrupted: false,
          backgroundTaskId: e.command === 'efimero' ? 'b9' : 'b8',
          ...(e.command === 'efimero' ? { backgroundEndsWithFinalResponse: true as const } : {}),
        },
      }))
      const guardados = vigilarShells(on)
      mock.clock(on)

      await $.tool.call({ tool: 'Bash', command: 'efimero', run_in_background: true })
      await $.tool.call({ tool: 'Bash', command: 'servidor', run_in_background: true })

      expect(guardados()?.map(s => s.id)).toEqual(['b8'])
    })

    test('PowerShell también deja shells en segundo plano', async ($, on) => {
      on('tool.call', { tool: 'PowerShell' }, () => ({
        result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'p1' },
      }))
      mock.clock(on)

      await $.tool.call({ tool: 'PowerShell', command: 'Start-Sleep 60', run_in_background: true })

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: 'Start-Sleep 60' })).toBeDefined()
      await ui.unmount()
    })

    test('si el aviso de fin se pierde, el shell caduca a las dos horas sin señales de vida', async ($, on) => {
      conBash(on, { 'pnpm dev': 'b1' })
      const guardados = vigilarShells(on)
      const reloj = mock.clock(on)

      await lanzar($, 'pnpm dev')

      await reloj.advance(INACTIVIDAD_DE_SHELL_MS - 1)
      const vivo = await montar($)
      expect(await vivo.find({ type: 'Text', text: 'Shells en segundo plano (1)' })).toBeDefined()
      await vivo.unmount()

      await reloj.advance(1)
      const caducado = await montar($)
      expect(await caducado.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await caducado.unmount()

      // y el próximo Stop sin lista lo suelta del estado, no solo de la pantalla
      await $.classic.Stop({ stop_hook_active: false })
      expect(guardados()).toEqual([])
    })

    test('con la sesión quieta, el chequeo periódico suelta al shell vencido sin esperar a un Stop', async ($, on) => {
      conBash(on, { 'pnpm dev': 'b1' })
      const guardados = vigilarShells(on)
      on('session.start', (_$, e) => ({ cwd: e.cwd }))
      on('command.register', () => ({ value: { command: 'contexto' } }))
      on('ui.open', () => ({ value: { isPlaced: true } }))
      on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
      on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', ...sinTruncar } }))
      const reloj = mock.clock(on)

      await $.session.start({ cwd: 'C:\\trabajo\\mi-proyecto', surface: 'terminal', isInteractive: true })
      await lanzar($, 'pnpm dev')
      expect(guardados()).toHaveLength(1)

      await reloj.advance(INACTIVIDAD_DE_SHELL_MS - 1)
      expect(guardados()).toHaveLength(1)

      await reloj.advance(REVISION_DE_SHELLS_MS)
      expect(guardados()).toEqual([])
    })

    test('una lista de tareas que lo confirma renueva el plazo de un shell', async ($, on) => {
      conBash(on, { 'pnpm dev': 'b1' })
      const reloj = mock.clock(on)

      await lanzar($, 'pnpm dev')
      await reloj.advance(INACTIVIDAD_DE_SHELL_MS - 1)
      await $.classic.Stop({
        stop_hook_active: false,
        background_tasks: [
          { id: 'b1', type: 'shell', status: 'running', description: 'Levantar', command: 'pnpm dev' },
        ],
      })
      await reloj.advance(INACTIVIDAD_DE_SHELL_MS - 1)

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: 'Shells en segundo plano (1)' })).toBeDefined()
      await ui.unmount()
    })

    test('con mucho contenido el panel crece sin cortar nada y las cuotas siguen siendo lo último', async ($, on) => {
      const ids: Record<string, string> = {}
      for (let i = 1; i <= 30; i += 1) {
        ids[`servidor-${i}`] = `b${i}`
      }
      conBash(on, ids)
      on('session.measure', (_$, e) => ({ changed: e.changed }))
      mock.clock(on, { now: AHORA })

      await $.session.measure({
        context: { window: 100_000 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 34, resetsAt: aISO(6, 15) },
          { kind: 'seven_day', percentUsed: 12, resetsAt: aISO(9, 8, 30) },
        ],
        changed: ['rateLimits'],
      })
      for (const comando of Object.keys(ids)) {
        await lanzar($, comando)
      }

      // el alto del panel (12 filas) es mucho menor que el contenido: debe crecer, no cortar
      const ui = await montar($, { ...PROPS, scroll: { offset: 0, bodyRows: 12 } })

      expect(await ui.find({ type: 'Text', text: 'Shells en segundo plano (30)' })).toBeDefined()
      const filas = await ui.findAll({ type: 'Text', text: /^servidor-\d+$/ })
      expect(filas).toHaveLength(30)

      const raiz = await ui.find({ type: 'Box', key: 'panel' })
      expect(raiz?.props.minHeight).toBe(12)
      for (const recorte of ['height', 'maxHeight', 'overflow', 'overflowY']) {
        expect(raiz?.props[recorte]).toBeUndefined()
      }

      const nodos = aplanar(await ui.drawn())
      const textoDe = (n: Nodo) => (n.children ?? []).filter(h => typeof h === 'string').join('')
      const posicionDe = (texto: RegExp) => nodos.findIndex(n => n.type === 'Text' && texto.test(textoDe(n)))

      const ultimaFila = posicionDe(/^servidor-30$/)
      const espaciador = nodos.findIndex(n => n.type === 'Box' && n.props?.flexGrow === 1)
      const cuotas = posicionDe(/^\nCuotas de uso$/)

      // el orden es: shells, espaciador, cuotas; y lo último que se dibuja es la barra de la última cuota
      expect(ultimaFila).toBeGreaterThan(-1)
      expect(espaciador).toBeGreaterThan(ultimaFila)
      expect(cuotas).toBeGreaterThan(espaciador)
      expect(textoDe(nodos.filter(n => n.type === 'Text').at(-1) ?? {})).toBe(' 12%')
      await ui.unmount()
    })

    test('en línea (sin alto fijo) la sección sigue su curso sin forzar altura', async ($, on) => {
      conBash(on, { 'sleep 60': 'b1' })
      mock.clock(on)

      await lanzar($, 'sleep 60')

      const ui = await montar($, { ...PROPS, placement: 'inline' })
      expect((await ui.find({ type: 'Box', key: 'panel' }))?.props.minHeight).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'sleep 60' })).toBeDefined()
      await ui.unmount()
    })
  })
})

describe('agentes reanudados', () => {
  const SPAWN = {
    tool_use_id: 'toolu_1',
    prompt: 'mapear la API',
    description: 'revisar el diff',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' } as const,
    parentModel: 'claude-sonnet-5-5',
    background: true,
    fork: false,
  }

  const PARADA = {
    stop_hook_active: false,
    agent_id: 'a1',
    agent_transcript_path: '',
    agent_type: 'general-purpose',
  }

  const TITULO = /Agentes en curso/

  /** Lo que `$.agent.list()` contesta; cada test lo cambia a medida que el agente vive, termina o se reanuda. */
  const conAgentes = (on: Parameters<Register>[0], inicial: AgentInfo[] = [], agentId = 'a1') => {
    const estado = { vivos: inicial }
    on('agent.list', () => ({ value: estado.vivos }))
    on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId }))
    on('classic.SubagentStop', () => ({}))
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: {
          input_tokens: 60_000,
          output_tokens: 10,
          cache_read_input_tokens: 50_000,
          cache_creation_input_tokens: 0,
          model: 'claude-haiku-4-5',
        },
      }
    })

    return estado
  }

  const vivo = (id: string, extra: Partial<AgentInfo> = {}): AgentInfo => ({
    id,
    description: 'revisar el diff',
    type: 'general-purpose',
    status: 'running',
    ...extra,
  })

  const paso = async ($: Engine, agentId: string) => {
    for await (const _chunk of $.turn.step({
      turnId: `turno-${agentId}`,
      index: 0,
      model: 'claude-haiku-4-5',
      messageCount: 1,
      agentId,
    })) {
      // el hook de abajo no emite trozos
    }
  }

  describe('helpers', () => {
    const AGENTE = {
      id: 'a1',
      descripcion: 'revisar el diff',
      tipo: 'general-purpose',
      modelo: 'claude-haiku-4-5',
      enSegundoPlano: false,
      esWorkflow: false,
      tokens: null,
      visto: 0,
    }

    test('se recuerdan los últimos agentes terminados, uno por id', () => {
      const uno = conRetirado([], AGENTE, 100)
      expect(uno).toEqual([
        { id: 'a1', descripcion: 'revisar el diff', tipo: 'general-purpose', enSegundoPlano: false, detenido: 100 },
      ])
      expect(conRetirado(uno, AGENTE, 200).map(r => r.detenido)).toEqual([200])

      let muchos = uno
      for (let i = 0; i < RETIRADOS_RECORDADOS + 5; i += 1) {
        muchos = conRetirado(muchos, { ...AGENTE, id: `x${i}` }, i)
      }
      expect(muchos).toHaveLength(RETIRADOS_RECORDADOS)
      expect(muchos.at(-1)?.id).toBe(`x${RETIRADOS_RECORDADOS + 4}`)
    })

    test('solo se adopta al agente que la API lista como vivo y que no acaba de terminar', () => {
      const base = { id: 'a1', modelo: 'claude-haiku-4-5', tokens: 110_000, ahora: 50_000 }
      const listado = { description: 'explorar la API', type: 'Explore', status: 'running' }
      const retirado = {
        id: 'a1',
        descripcion: 'revisar el diff',
        tipo: 'general-purpose',
        enSegundoPlano: false,
        detenido: 40_000,
      }

      // sin recuerdo: lo que dice la API, y en segundo plano porque un mensaje lo reanuda sin bloquear
      expect(adoptarAgente({ ...base, listado, retirado: undefined })).toEqual({
        id: 'a1',
        descripcion: 'explorar la API',
        tipo: 'Explore',
        modelo: 'claude-haiku-4-5',
        enSegundoPlano: true,
        esWorkflow: false,
        tokens: 110_000,
        visto: 50_000,
      })
      // con recuerdo: lo que se sabía de él
      expect(adoptarAgente({ ...base, listado, retirado })).toMatchObject({
        descripcion: 'revisar el diff',
        tipo: 'general-purpose',
        enSegundoPlano: false,
      })
      expect(adoptarAgente({ ...base, listado: { ...listado, description: '' }, retirado: undefined })?.descripcion).toBe(
        '(reanudado)',
      )

      expect(adoptarAgente({ ...base, listado: undefined, retirado })).toBeNull()
      for (const status of ['completed', 'failed', 'killed']) {
        expect(adoptarAgente({ ...base, listado: { ...listado, status }, retirado })).toBeNull()
      }
      for (const status of ['running', 'idle', 'waiting', 'pending']) {
        expect(adoptarAgente({ ...base, listado: { ...listado, status }, retirado })).not.toBeNull()
      }
      // dentro de la ventana de su propio SubagentStop no; al cumplirse, sí
      expect(adoptarAgente({ ...base, ahora: 40_000 + VENTANA_DE_RETIRO_MS - 1, listado, retirado })).toBeNull()
      expect(adoptarAgente({ ...base, ahora: 40_000 + VENTANA_DE_RETIRO_MS, listado, retirado })).not.toBeNull()
    })
  })

  describe('panel', () => {
    test('un agente terminado que un mensaje reanuda vuelve a figurar, con lo que se sabía de él', async ($, on) => {
      const api = conAgentes(on)
      const reloj = mock.clock(on)

      await $.agent.spawn(SPAWN)
      await $.classic.SubagentStop(PARADA)

      const terminado = await montar($)
      expect(await terminado.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await terminado.unmount()

      // lo reanuda un SendMessage: no hay agent.spawn, solo sus pasos
      api.vivos = [vivo('a1')]
      await reloj.advance(VENTANA_DE_RETIRO_MS)
      await paso($, 'a1')

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: 'Agentes en curso (1)' })).toBeDefined()
      const fila = await ui.find({ type: 'Text', text: /haiku-4-5 \[2º plano\]/ })
      expect(fila?.props.color).toBe(colorDeModelo('claude-haiku-4-5'))
      expect(await ui.find({ type: 'Text', text: /revisar el diff/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /110\.0k tokens · ventana sin dato/ })).toBeDefined()
      await ui.unmount()
    })

    test('el mismo paso de un agente que la API no lista no lo agrega', async ($, on) => {
      conAgentes(on)
      const reloj = mock.clock(on)

      await $.agent.spawn(SPAWN)
      await $.classic.SubagentStop(PARADA)
      await reloj.advance(VENTANA_DE_RETIRO_MS)
      await paso($, 'a1')
      // ni el que nunca estuvo: un fork del motor o un agente de workflow dan pasos con ids que ninguna lista nombra
      await paso($, 'fork-compactacion')

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await ui.unmount()
    })

    test('el agente reanudado desaparece de nuevo con su SubagentStop', async ($, on) => {
      const api = conAgentes(on)
      const reloj = mock.clock(on)

      await $.agent.spawn(SPAWN)
      await $.classic.SubagentStop(PARADA)
      api.vivos = [vivo('a1')]
      await reloj.advance(VENTANA_DE_RETIRO_MS)
      await paso($, 'a1')

      const reanudado = await montar($)
      expect(await reanudado.find({ type: 'Text', text: 'Agentes en curso (1)' })).toBeDefined()
      await reanudado.unmount()

      await $.classic.SubagentStop(PARADA)

      const despues = await montar($)
      expect(await despues.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await despues.unmount()
    })

    test('un paso de un agente que ya figura no lo duplica', async ($, on) => {
      const api = conAgentes(on)
      mock.clock(on)

      await $.agent.spawn(SPAWN)
      api.vivos = [vivo('a1')]
      await paso($, 'a1')
      await paso($, 'a1')

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: 'Agentes en curso (1)' })).toBeDefined()
      expect(await ui.findAll({ type: 'Text', text: /haiku-4-5 \[2º plano\]/ })).toHaveLength(1)
      await ui.unmount()
    })

    test('un paso pegado a su SubagentStop no resucita al agente aunque la API todavía lo liste', async ($, on) => {
      const api = conAgentes(on)
      const reloj = mock.clock(on)

      await $.agent.spawn(SPAWN)
      api.vivos = [vivo('a1')]
      await $.classic.SubagentStop(PARADA)

      await reloj.advance(VENTANA_DE_RETIRO_MS - 1)
      await paso($, 'a1')

      const pegado = await montar($)
      expect(await pegado.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await pegado.unmount()

      await reloj.advance(1)
      await paso($, 'a1')

      const reanudado = await montar($)
      expect(await reanudado.find({ type: 'Text', text: 'Agentes en curso (1)' })).toBeDefined()
      await reanudado.unmount()
    })

    test('un agente que la API da por terminado no vuelve aunque dé un paso', async ($, on) => {
      const api = conAgentes(on)
      const reloj = mock.clock(on)

      await $.agent.spawn(SPAWN)
      await $.classic.SubagentStop(PARADA)
      api.vivos = [vivo('a1', { status: 'completed' })]
      await reloj.advance(VENTANA_DE_RETIRO_MS)
      await paso($, 'a1')

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await ui.unmount()
    })

    test('uno que el panel nunca vio se adopta con los datos de la API; sin descripción dice (reanudado)', async ($, on) => {
      conAgentes(on, [vivo('a7', { description: 'explorar la API' }), vivo('a8', { description: '' })])
      mock.clock(on)

      await paso($, 'a7')
      await paso($, 'a8')

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: 'Agentes en curso (2)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /explorar la API/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\(reanudado\)/ })).toBeDefined()
      await ui.unmount()
    })

    test('un agente de workflow que caducó no se repone aunque siga dando pasos', async ($, on) => {
      conAgentes(on, [], 'wf1')
      on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
      on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', ...sinTruncar } }))
      on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
      const reloj = mock.clock(on)

      await $.agent.spawn({ ...SPAWN, workflow: { runId: 'wf_abc123', agentIndex: 1 } })
      await reloj.advance(INACTIVIDAD_DE_WORKFLOW_MS + 1)
      await $.turn.complete({
        answer: 'listo',
        durationMs: 10,
        isAborted: false,
        turnId: 'turno-wf',
        reason: 'answer',
        usage: { ...USO, model: 'claude-sonnet-5-5' },
      })
      await paso($, 'wf1')

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await ui.unmount()
    })

    test('si la API no contesta, el paso termina igual y el panel no inventa nada', async ($, on) => {
      on('turn.step', async function* (_$, e) {
        return {
          turnId: e.turnId,
          index: e.index,
          answer: '',
          toolUses: [],
          stopReason: 'end_turn' as const,
          usage: { ...USO, model: 'claude-haiku-4-5' },
        }
      })
      mock.clock(on)

      // sin nadie que conteste agent.list: la lectura rechaza y el hook lo traga
      await paso($, 'a1')

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: TITULO })).toBeUndefined()
      await ui.unmount()
    })
  })
})

describe('aviso de versión nueva', () => {
  type Alta = Parameters<typeof mock.clock>[0]
  type Respuesta = { status: number; ok: boolean; headers: Record<string, string>; text: string }

  const MANIFIESTO_PUBLICADO =
    'https://raw.githubusercontent.com/mixzplit/contexto-lateral/main/.claude-plugin/plugin.json'

  const respuestaOk = (version: string): Respuesta => ({
    status: 200,
    ok: true,
    headers: {},
    text: JSON.stringify({ name: 'contexto-lateral', version }),
  })

  // El `$` de un test solo ve eventos: para probar las funciones solas se les pasa uno mínimo, con lo que usan.
  const motorFalso = (responder: () => Respuesta) => {
    const datos = new Map<string, unknown>()
    const pedidos: string[] = []
    let ahora = AHORA
    const entorno: Record<string, string | undefined> = {}

    const $ = {
      plugin: { name: 'contexto-lateral', root: '' },
      clock: { now: async () => ahora },
      env: { get: async (nombre: string) => entorno[nombre] },
      http: {
        fetch: async (url: string) => {
          pedidos.push(url)

          return responder()
        },
      },
      store: {
        get: async (clave: string) => datos.get(clave),
        set: async (clave: string, valor: unknown) => {
          datos.set(clave, JSON.parse(JSON.stringify(valor)))
        },
      },
    } as unknown as EngineInterface

    return {
      $,
      pedidos,
      entorno,
      avanzar: (ms: number) => {
        ahora += ms
      },
    }
  }

  // GitHub simulado dentro de una sesión: anota cada pedido y contesta lo que diga `responder`
  const conGitHub = (on: Alta, responder: () => Respuesta) => {
    const pedidos: string[] = []
    on('http.fetch', (_$, e) => {
      pedidos.push(e.url)

      return { value: responder() }
    })

    return pedidos
  }

  // el motor de los tests no trae almacenamiento: uno en memoria, con la ida y vuelta por JSON del real
  const conAlmacen = (on: Alta) => {
    const datos = new Map<string, unknown>()
    on('store.get', (_$, e) => ({ value: datos.get(e.key) }))
    on('store.set', (_$, e) => {
      datos.set(e.key, JSON.parse(JSON.stringify(e.value)))

      return { value: undefined }
    })
  }

  // la consulta corre en segundo plano: se le dan vueltas para que termine antes de mirar
  const asentar = async () => {
    for (let i = 0; i < 300; i += 1) {
      await Promise.resolve()
    }
  }

  // una sesión con el mod instalado en la versión 0.1.0; devuelve los toasts y las órdenes que lanzó
  const conSesion = (on: Alta) => {
    const toasts: string[] = []
    const ordenes: string[] = []
    const entorno: Record<string, string | undefined> = {}
    conAlmacen(on)
    on('env.get', (_$, e) => ({ value: entorno[e.name] }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'contexto' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
    on('process.run', (_$, e) => {
      ordenes.push(JSON.stringify(e))

      return { value: { exitCode: 1, stdout: '', stderr: '', ...sinTruncar } }
    })
    on('fs.read', () => ({ value: JSON.stringify({ name: 'contexto-lateral', version: '0.1.0' }) }))
    on('ui.toast', (_$, e) => {
      toasts.push(e.text)

      return { value: undefined }
    })

    return { toasts, ordenes, entorno }
  }

  const iniciar = ($: Engine) =>
    $.session.start({ cwd: 'C:\\trabajo\\mi-proyecto', surface: 'terminal', isInteractive: true })

  test('una versión es más nueva solo si su número es mayor', () => {
    expect(esMasNueva('0.2.0', '0.1.0')).toBe(true)
    expect(esMasNueva('0.10.0', '0.9.0')).toBe(true)
    expect(esMasNueva('1.0.0', '0.9.9')).toBe(true)
    expect(esMasNueva('0.1.1', '0.1.0')).toBe(true)
    expect(esMasNueva('0.1.0', '0.1.0')).toBe(false)
    expect(esMasNueva('0.1.0', '0.2.0')).toBe(false)
    expect(esMasNueva('0.2.0-beta.1', '0.1.0')).toBe(false)
    expect(esMasNueva('nueva', '0.1.0')).toBe(false)
  })

  test('la versión publicada se lee del plugin.json de main', async () => {
    const { $, pedidos } = motorFalso(() => respuestaOk('0.2.0'))

    expect(await buscarVersionPublicada($)).toBe('0.2.0')
    expect(pedidos).toEqual([MANIFIESTO_PUBLICADO])
  })

  test('si GitHub no contesta bien o el contenido no sirve, no hay versión publicada', async () => {
    let respuesta: Respuesta = { status: 404, ok: false, headers: {}, text: 'Not Found' }
    const { $ } = motorFalso(() => respuesta)

    expect(await buscarVersionPublicada($)).toBeNull()
    respuesta = { status: 200, ok: true, headers: {}, text: 'esto no es JSON' }
    expect(await buscarVersionPublicada($)).toBeNull()
    respuesta = { status: 200, ok: true, headers: {}, text: JSON.stringify({ name: 'contexto-lateral' }) }
    expect(await buscarVersionPublicada($)).toBeNull()
  })

  test('lo que llega de la red solo se acepta con forma MAJOR.MINOR.PATCH', async () => {
    let version = '0.2.0-beta.1'
    const { $ } = motorFalso(() => respuestaOk(version))

    expect(await buscarVersionPublicada($)).toBeNull()
    version = '0.2.0\u001b[2J mira esto'
    expect(await buscarVersionPublicada($)).toBeNull()
    version = '0.2.0'
    expect(await buscarVersionPublicada($)).toBe('0.2.0')
  })

  test('si no hay red, la consulta devuelve nada en vez de romper', async () => {
    const { $ } = motorFalso(() => {
      throw new Error('sin red')
    })

    expect(await buscarVersionPublicada($)).toBeNull()
  })

  test('avisa de la versión nueva y no vuelve a consultar hasta pasadas 24 horas', async () => {
    const { $, pedidos, avanzar } = motorFalso(() => respuestaOk('0.2.0'))

    expect(await comprobarVersionNueva($, '0.1.0', true)).toBe('0.2.0')
    expect(pedidos).toHaveLength(1)

    avanzar(INTERVALO_DE_CHEQUEO_MS - 1)
    expect(await comprobarVersionNueva($, '0.1.0', true)).toBe('0.2.0')
    expect(pedidos).toHaveLength(1)

    avanzar(1)
    expect(await comprobarVersionNueva($, '0.1.0', true)).toBe('0.2.0')
    expect(pedidos).toHaveLength(2)
  })

  test('si la publicada no es más nueva que la instalada, no avisa', async () => {
    const { $ } = motorFalso(() => respuestaOk('0.1.0'))

    expect(await comprobarVersionNueva($, '0.1.0', true)).toBeNull()
  })

  test('una consulta fallida no se recuerda: la próxima vez vuelve a intentar', async () => {
    let respuesta: Respuesta = { status: 503, ok: false, headers: {}, text: '' }
    const { $, pedidos } = motorFalso(() => respuesta)

    expect(await comprobarVersionNueva($, '0.1.0', true)).toBeNull()
    respuesta = respuestaOk('0.2.0')
    expect(await comprobarVersionNueva($, '0.1.0', true)).toBe('0.2.0')
    expect(pedidos).toHaveLength(2)
  })

  test('con el aviso apagado, o sin versión propia con qué comparar, no consulta nada', async () => {
    const { $, pedidos } = motorFalso(() => respuestaOk('0.2.0'))

    expect(await comprobarVersionNueva($, '0.1.0', false)).toBeNull()
    expect(await comprobarVersionNueva($, null, true)).toBeNull()
    expect(pedidos).toEqual([])
  })

  test('si el usuario pidió no generar tráfico innecesario, no consulta nada', async () => {
    const { $, pedidos, entorno } = motorFalso(() => respuestaOk('0.2.0'))

    entorno.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    expect(await comprobarVersionNueva($, '0.1.0', true)).toBeNull()
    expect(pedidos).toEqual([])

    // un valor que no la enciende no cuenta como definida
    entorno.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '0'
    expect(await comprobarVersionNueva($, '0.1.0', true)).toBe('0.2.0')
    entorno.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 'false'
    expect(await comprobarVersionNueva($, '0.1.0', true)).toBe('0.2.0')
    entorno.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = ''
    expect(await comprobarVersionNueva($, '0.1.0', true)).toBe('0.2.0')
    expect(pedidos).toHaveLength(1)
  })

  test('con CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC definida, la sesión no consulta GitHub', async ($, on) => {
    const { toasts, entorno } = conSesion(on)
    entorno.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    const pedidos = conGitHub(on, () => respuestaOk('0.2.0'))
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /Versión nueva/ })).toBeUndefined()
    await ui.unmount()

    expect(pedidos).toEqual([])
    expect(toasts).toEqual([])
  })

  test('al iniciar la sesión avisa en el panel y con un toast, y no instala nada por su cuenta', async ($, on) => {
    const { toasts, ordenes } = conSesion(on)
    conGitHub(on, () => respuestaOk('0.2.0'))
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /Versión nueva: v0\.2\.0/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /claude plugin update contexto-lateral@side-context/ })).toBeDefined()
    await ui.unmount()

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/v0\.2\.0/)
    expect(ordenes.join('\n')).not.toMatch(/update|install/)
  })

  test('el toast sale una sola vez por versión, aunque se abran más sesiones', async ($, on) => {
    const { toasts } = conSesion(on)
    const pedidos = conGitHub(on, () => respuestaOk('0.2.0'))
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()
    await reloj.advance(1000)
    await iniciar($)
    await asentar()

    expect(pedidos).toHaveLength(1)
    expect(toasts).toHaveLength(1)
  })

  test(
    'con el aviso apagado en la configuración, la sesión no consulta GitHub',
    { options: { avisarVersionNueva: false } },
    async ($, on) => {
      const { toasts } = conSesion(on)
      const pedidos = conGitHub(on, () => respuestaOk('0.2.0'))
      mock.clock(on, { now: AHORA })

      await iniciar($)
      await asentar()

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: /Versión nueva/ })).toBeUndefined()
      await ui.unmount()

      expect(pedidos).toEqual([])
      expect(toasts).toEqual([])
    },
  )
})

describe('servidores MCP', () => {
  type Alta = Parameters<typeof mock.clock>[0]

  const SALIDA = [
    'Checking MCP server health…',
    '',
    "[mcp-sdk] SEP-2352: stored OAuth credential has no 'issuer' stamp (pre-upgrade storage). Isolation is inactive.",
    'claude.ai Docs: https://docs.example.com/mcp - ✔ Connected',
    'plugin:equipo:chat: https://chat.example.com/mcp (HTTP) - ! Needs authentication',
    'plugin:equipo:agenda:  (HTTP) - - Not configured',
    'notas: https://notas.example.com/mcp (HTTP) - ✔ Connected',
    'memoria: memoria mcp --tools=agent - ✔ Connected',
    'tablero: https://tablero.example.com/mcp (HTTP) - ✘ Failed to connect — Incompatible auth server',
    'wiki: https://wiki.example.com/mcp (HTTP) - ! Needs authentication',
  ].join('\n')

  // la consulta corre en segundo plano: se le dan vueltas para que termine antes de mirar
  const asentar = async () => {
    for (let i = 0; i < 100; i += 1) {
      await Promise.resolve()
    }
  }

  // una sesión cuyo `claude mcp list` contesta lo que diga `salida()` cuando `espera()` se cumple; devuelve cuántas veces se lo consultó
  const conSesionMcp = (
    on: Alta,
    salida: () => { exitCode: number; stdout: string },
    espera: () => Promise<void> = async () => {},
  ) => {
    const entorno: Record<string, string | undefined> = {}
    const consultas = { cuenta: 0 }
    on('env.get', (_$, e) => ({ value: entorno[e.name] }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'contexto' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
    on('fs.read', () => ({ value: JSON.stringify({ name: 'contexto-lateral', version: '0.2.0' }) }))
    on('process.run', async (_$, e) => {
      if (e.argv[0] === 'claude') {
        consultas.cuenta += 1
        await espera()

        return { value: { ...salida(), stderr: '', ...sinTruncar } }
      }

      return { value: { exitCode: 1, stdout: '', stderr: '', ...sinTruncar } }
    })

    return { consultas, entorno }
  }

  const iniciar = ($: Engine) =>
    $.session.start({ cwd: 'C:\\trabajo\\mi-proyecto', surface: 'terminal', isInteractive: true })

  test('de la lista solo quedan los servidores de la persona, cada uno con su estado', () => {
    expect(servidoresMcp(SALIDA)).toEqual([
      { nombre: 'notas', conectado: true },
      { nombre: 'memoria', conectado: true },
      { nombre: 'tablero', conectado: false },
      { nombre: 'wiki', conectado: false },
    ])
  })

  test('los servidores de plugins y los conectores de claude.ai no cuentan como de la persona', () => {
    expect(esMcpDelUsuario('plugin:equipo:chat')).toBe(false)
    expect(esMcpDelUsuario('claude.ai Docs')).toBe(false)
    expect(esMcpDelUsuario('notas')).toBe(true)
    expect(esMcpDelUsuario('mi-plugin-propio')).toBe(true)
  })

  test('con la opción de plugins, la lista suma sus servidores y sigue sin los conectores de claude.ai', () => {
    expect(servidoresMcp(SALIDA, true)).toEqual([
      { nombre: 'plugin:equipo:chat', conectado: false },
      { nombre: 'plugin:equipo:agenda', conectado: false },
      { nombre: 'notas', conectado: true },
      { nombre: 'memoria', conectado: true },
      { nombre: 'tablero', conectado: false },
      { nombre: 'wiki', conectado: false },
    ])
  })

  test('un servidor de plugin se muestra solo si la persona lo pidió; un conector de claude.ai, nunca', () => {
    expect(seMuestraElMcp('plugin:equipo:chat', true)).toBe(true)
    expect(seMuestraElMcp('plugin:equipo:chat', false)).toBe(false)
    expect(seMuestraElMcp('claude.ai Docs', true)).toBe(false)
    expect(seMuestraElMcp('notas', false)).toBe(true)
  })

  test('una marca deformada por la consola no cambia el estado, y las líneas con CRLF se leen igual', () => {
    const salida =
      'notas: https://notas.example.com/mcp (HTTP) - âœ" Connected\r\nwiki: https://wiki.example.com/mcp - âœ˜ Failed to connect\r\n'

    expect(servidoresMcp(salida)).toEqual([
      { nombre: 'notas', conectado: true },
      { nombre: 'wiki', conectado: false },
    ])
  })

  test('sin servidores de la persona, la lista queda vacía', () => {
    expect(servidoresMcp('Checking MCP server health…\n')).toEqual([])
    expect(servidoresMcp('')).toEqual([])
  })

  test('el panel muestra un tick verde por servidor conectado y una cruz roja por el que no, sin los ajenos', async ($, on) => {
    conSesionMcp(on, () => ({ exitCode: 0, stdout: SALIDA }))
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /^\nMCP$/ })).toBeDefined()
    const ticks = await ui.findAll({ type: 'Text', text: /^✔ $/ })
    const cruces = await ui.findAll({ type: 'Text', text: /^✘ $/ })
    expect(ticks.map(t => t.props.color)).toEqual(['success', 'success'])
    expect(cruces.map(c => c.props.color)).toEqual(['error', 'error'])
    expect(await ui.find({ type: 'Text', text: 'notas' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'tablero' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /chat|Docs|agenda/ })).toBeUndefined()
    await ui.unmount()
  })

  test(
    'con la opción de plugins, el panel muestra también sus servidores, y los de claude.ai siguen ocultos',
    { options: { mostrarMcpDePlugins: true } },
    async ($, on) => {
      conSesionMcp(on, () => ({ exitCode: 0, stdout: SALIDA }))
      mock.clock(on, { now: AHORA })

      await iniciar($)
      await asentar()

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: /^plugin:equipo:chat$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^plugin:equipo:agenda$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^notas$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Docs/ })).toBeUndefined()
      expect(await ui.findAll({ type: 'Text', text: /^✘ $/ })).toHaveLength(4)
      await ui.unmount()
    },
  )

  test(
    'la opción de plugins vale también en las consultas que se repiten cada 10 minutos',
    { options: { mostrarMcpDePlugins: true } },
    async ($, on) => {
      const { consultas } = conSesionMcp(on, () => ({ exitCode: 0, stdout: SALIDA }))
      const reloj = mock.clock(on, { now: AHORA })

      await iniciar($)
      await asentar()
      await reloj.advance(REVISION_DE_MCP_MS)
      await asentar()
      expect(consultas.cuenta).toBe(2)

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: /^plugin:equipo:chat$/ })).toBeDefined()
      await ui.unmount()
    },
  )

  test('las cuotas siguen siendo lo último del panel con la sección MCP', async ($, on) => {
    conSesionMcp(on, () => ({ exitCode: 0, stdout: SALIDA }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await $.session.measure({
      context: { window: 100_000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 34, resetsAt: aISO(6, 15) },
        { kind: 'seven_day', percentUsed: 12, resetsAt: aISO(9, 8, 30) },
      ],
      changed: ['rateLimits'],
    })
    await asentar()

    const ui = await montar($)
    const nodos = aplanar(await ui.drawn())
    const textoDe = (n: Nodo) => (n.children ?? []).filter(h => typeof h === 'string').join('')
    const posicionDe = (texto: RegExp) => nodos.findIndex(n => n.type === 'Text' && texto.test(textoDe(n)))

    const seccion = posicionDe(/^\nMCP$/)
    const espaciador = nodos.findIndex(n => n.type === 'Box' && n.props?.flexGrow === 1)
    const cuotas = posicionDe(/^\nCuotas de uso$/)

    expect(seccion).toBeGreaterThan(-1)
    expect(espaciador).toBeGreaterThan(seccion)
    expect(cuotas).toBeGreaterThan(espaciador)
    expect(textoDe(nodos.filter(n => n.type === 'Text').at(-1) ?? {})).toBe(' 12%')
    await ui.unmount()
  })

  test('la sección MCP va después del proyecto y antes de los agentes en curso y de los shells', async ($, on) => {
    conSesionMcp(on, () => ({ exitCode: 0, stdout: SALIDA }))
    on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
    on('tool.call', (_$, e) =>
      e.tool === 'Bash' ? { result: { backgroundTaskId: 'b1' } } : { result: {} },
    )
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await $.agent.spawn({
      tool_use_id: 'toolu_1',
      prompt: 'mapear la API',
      description: 'revisar el diff',
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' } as const,
      parentModel: 'claude-sonnet-5-5',
      background: true,
      fork: false,
    })
    await $.tool.call({ tool: 'Bash', command: 'pnpm dev', run_in_background: true })
    await asentar()

    const ui = await montar($)
    const nodos = aplanar(await ui.drawn())
    const textoDe = (n: Nodo) => (n.children ?? []).filter(h => typeof h === 'string').join('')
    const posicionDe = (texto: RegExp) => nodos.findIndex(n => n.type === 'Text' && texto.test(textoDe(n)))

    const proyecto = posicionDe(/^\nProyecto$/)
    const seccion = posicionDe(/^\nMCP$/)
    const agentes = posicionDe(/^\nAgentes en curso \(1\)$/)
    const shells = posicionDe(/^\nShells en segundo plano \(1\)$/)

    expect(proyecto).toBeGreaterThan(-1)
    expect(seccion).toBeGreaterThan(proyecto)
    expect(agentes).toBeGreaterThan(seccion)
    expect(shells).toBeGreaterThan(agentes)
    await ui.unmount()
  })

  test('sin servidores de la persona, el panel no dibuja la sección', async ($, on) => {
    conSesionMcp(on, () => ({
      exitCode: 0,
      stdout: 'plugin:equipo:chat: https://chat.example.com/mcp (HTTP) - ✔ Connected',
    }))
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /^\nMCP$/ })).toBeUndefined()
    await ui.unmount()
  })

  test('consulta al abrir la sesión y vuelve a hacerlo cada 10 minutos, no antes', async ($, on) => {
    const { consultas } = conSesionMcp(on, () => ({ exitCode: 0, stdout: SALIDA }))
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()
    expect(consultas.cuenta).toBe(1)
    expect(REVISION_DE_MCP_MS).toBe(10 * 60 * 1000)

    await reloj.advance(REVISION_DE_MCP_MS - 1)
    await asentar()
    expect(consultas.cuenta).toBe(1)

    await reloj.advance(1)
    await asentar()
    expect(consultas.cuenta).toBe(2)
  })

  test('el estado se actualiza con cada consulta: el servidor que se cae pasa a cruz roja', async ($, on) => {
    let salida = 'notas: https://notas.example.com/mcp (HTTP) - ✔ Connected'
    conSesionMcp(on, () => ({ exitCode: 0, stdout: salida }))
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()
    const antes = await montar($)
    expect(await antes.find({ type: 'Text', text: /^✔ $/ })).toBeDefined()
    await antes.unmount()

    salida = 'notas: https://notas.example.com/mcp (HTTP) - ✘ Failed to connect'
    await reloj.advance(REVISION_DE_MCP_MS)
    await asentar()

    const despues = await montar($)
    expect(await despues.find({ type: 'Text', text: /^✔ $/ })).toBeUndefined()
    expect((await despues.find({ type: 'Text', text: /^✘ $/ }))?.props.color).toBe('error')
    await despues.unmount()
  })

  test('si una consulta falla, el panel conserva lo último que leyó', async ($, on) => {
    let respuesta = { exitCode: 0, stdout: 'notas: https://notas.example.com/mcp (HTTP) - ✔ Connected' }
    conSesionMcp(on, () => respuesta)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    respuesta = { exitCode: 1, stdout: '' }
    await reloj.advance(REVISION_DE_MCP_MS)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: 'notas' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✔ $/ })).toBeDefined()
    await ui.unmount()
  })

  test('con CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC definida no consulta nada y no hay sección', async ($, on) => {
    const { consultas, entorno } = conSesionMcp(on, () => ({ exitCode: 0, stdout: SALIDA }))
    entorno.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()
    await reloj.advance(REVISION_DE_MCP_MS)
    await asentar()

    expect(consultas.cuenta).toBe(0)
    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /^\nMCP$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Consultando estados…' })).toBeUndefined()
    await ui.unmount()
  })

  // una compuerta para tener la consulta a medias: `abrir()` la deja terminar
  const compuerta = () => {
    let abrir = () => {}
    const pasada = new Promise<void>(resolver => {
      abrir = resolver
    })

    return { abrir, pasada }
  }

  test('mientras lee los estados por primera vez lo avisa, y al terminar muestra la lista', async ($, on) => {
    const { abrir, pasada } = compuerta()
    conSesionMcp(on, () => ({ exitCode: 0, stdout: SALIDA }), () => pasada)
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const leyendo = await montar($)
    expect(await leyendo.find({ type: 'Text', text: /^\nMCP$/ })).toBeDefined()
    expect(await leyendo.find({ type: 'Text', text: 'Consultando estados…' })).toBeDefined()
    expect(await leyendo.find({ type: 'Text', text: /^[✔✘] $/ })).toBeUndefined()
    await leyendo.unmount()

    abrir()
    await asentar()

    const lista = await montar($)
    expect(await lista.find({ type: 'Text', text: 'Consultando estados…' })).toBeUndefined()
    expect(await lista.findAll({ type: 'Text', text: /^✔ $/ })).toHaveLength(2)
    await lista.unmount()
  })

  test('si la primera lectura falla, el aviso se va y no queda una sección vacía', async ($, on) => {
    conSesionMcp(on, () => ({ exitCode: 1, stdout: '' }))
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: 'Consultando estados…' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^\nMCP$/ })).toBeUndefined()
    await ui.unmount()
  })

  test('refrescar una lista ya dibujada no vuelve a mostrar el aviso ni mueve el panel', async ($, on) => {
    let pasada = Promise.resolve()
    conSesionMcp(on, () => ({ exitCode: 0, stdout: SALIDA }), () => pasada)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const segunda = compuerta()
    pasada = segunda.pasada
    await reloj.advance(REVISION_DE_MCP_MS)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: 'Consultando estados…' })).toBeUndefined()
    expect(await ui.findAll({ type: 'Text', text: /^✔ $/ })).toHaveLength(2)
    await ui.unmount()

    segunda.abrir()
    await asentar()
  })
})

describe('cambios de git', () => {
  type Alta = Parameters<typeof mock.clock>[0]

  type Estado = { sha: string; rama: string; sucios: number; cambiados: number; sinGit?: boolean; falla?: boolean }

  // la consulta corre en segundo plano: se le dan vueltas para que termine antes de mirar
  const asentar = async () => {
    for (let i = 0; i < 100; i += 1) {
      await Promise.resolve()
    }
  }

  const archivos = (cantidad: number): string[] => Array.from({ length: cantidad }, (_, i) => `archivo-${i}.ts`)

  // un repositorio falso: `git` contesta según `estado` (que el test puede cambiar) y `llamadas` guarda lo que se le pidió
  const conRepositorio = (on: Alta, estado: Estado) => {
    const llamadas: string[] = []
    const ok = (lineas: string[]) => ({
      value: { exitCode: 0, stdout: lineas.join('\n'), stderr: '', ...sinTruncar },
    })
    const falla = { value: { exitCode: 128, stdout: '', stderr: 'fatal', ...sinTruncar } }

    on('env.get', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'contexto' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
    on('fs.read', () => ({ value: JSON.stringify({ name: 'contexto-lateral', version: '0.2.0' }) }))
    on('agent.list', () => ({ value: [] }))
    on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
    on('process.run', (_$, e) => {
      const args = e.argv.slice(1).join(' ')
      llamadas.push(args)

      if (e.argv[0] !== 'git' || estado.sinGit) {
        return falla
      }
      if (args.startsWith('rev-parse HEAD')) {
        return ok([estado.sha, estado.rama])
      }
      if (args.startsWith('rev-parse --path-format=absolute')) {
        return ok(['C:/trabajo/mi-proyecto', 'C:/trabajo/mi-proyecto/.git', 'C:/trabajo/mi-proyecto/.git'])
      }
      if (args === 'branch --show-current') {
        return ok([estado.rama])
      }
      if (args.includes('status')) {
        return estado.falla ? falla : ok(archivos(estado.sucios).map(a => ` M ${a}`))
      }
      if (args.startsWith('diff --name-only')) {
        return ok(archivos(estado.cambiados))
      }

      return falla
    })

    return {
      llamadas,
      consultasDeEstado: () => llamadas.filter(l => l.includes('status')).length,
      lecturasDeProyecto: () => llamadas.filter(l => l.includes('--show-toplevel')).length,
    }
  }

  const iniciar = ($: Engine) =>
    $.session.start({ cwd: 'C:\\trabajo\\mi-proyecto', surface: 'terminal', isInteractive: true })

  const completarTurno = ($: Engine, id: string) =>
    $.turn.complete({
      answer: 'listo',
      durationMs: 10,
      isAborted: false,
      turnId: id,
      reason: 'answer',
      usage: { ...USO, model: 'claude-sonnet-5-5' },
    })

  const BASE: Estado = { sha: 'aaa111', rama: 'main', sucios: 0, cambiados: 0 }

  test('al abrir la sesión muestra en rojo los archivos que faltan por comitear', async ($, on) => {
    conRepositorio(on, { ...BASE, sucios: 3 })
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const ui = await montar($)
    expect((await ui.find({ type: 'Text', text: /^3$/ }))?.props.color).toBe('error')
    await ui.unmount()
  })

  test('los archivos comiteados desde que abrió la sesión salen en verde', async ($, on) => {
    const estado = { ...BASE }
    conRepositorio(on, estado)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    estado.sha = 'bbb222'
    estado.cambiados = 5
    await completarTurno($, 'turno-1')
    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()

    const ui = await montar($)
    expect((await ui.find({ type: 'Text', text: /^5$/ }))?.props.color).toBe('success')
    await ui.unmount()
  })

  test('cada número lleva su etiqueta para que se sepa de qué es', async ($, on) => {
    const estado = { ...BASE, sucios: 3 }
    conRepositorio(on, estado)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    estado.sha = 'bbb222'
    estado.cambiados = 5
    await completarTurno($, 'turno-1')
    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /^archivos: $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^archivos:$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ sin comitear$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ comiteados$/ })).toBeDefined()
    await ui.unmount()
  })

  test('en un panel angosto «archivos:» pasa a su propia línea para no cortar las etiquetas', async ($, on) => {
    conRepositorio(on, { ...BASE, sucios: 5 })
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const ui = await montar($, { ...PROPS, bodyColumns: 36 })
    expect(await ui.find({ type: 'Text', text: /^archivos:$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^archivos: $/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ sin comitear$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ comiteados$/ })).toBeDefined()
    await ui.unmount()
  })

  test('los contadores caben en una línea según el ancho del panel', () => {
    expect(cambiosCabenEnUnaLinea({ sinComitear: 5, comiteados: 0 }, 38)).toBe(true)
    expect(cambiosCabenEnUnaLinea({ sinComitear: 5, comiteados: 0 }, 37)).toBe(false)
    expect(cambiosCabenEnUnaLinea({ sinComitear: 12, comiteados: 12 }, 40)).toBe(true)
    expect(cambiosCabenEnUnaLinea({ sinComitear: 12, comiteados: 12 }, 39)).toBe(false)
    // «comiteado» en singular es un carácter más corto
    expect(cambiosCabenEnUnaLinea({ sinComitear: 5, comiteados: 1 }, 37)).toBe(true)
  })

  test('con un solo archivo comiteado la etiqueta va en singular', async ($, on) => {
    const estado = { ...BASE }
    conRepositorio(on, estado)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    estado.sha = 'bbb222'
    estado.cambiados = 1
    await completarTurno($, 'turno-1')
    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /^ comiteado$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ comiteados$/ })).toBeUndefined()
    await ui.unmount()
  })

  test('el número de lo comiteado se cuenta desde el commit que había al abrir la sesión', async ($, on) => {
    const estado = { ...BASE }
    const { llamadas } = conRepositorio(on, estado)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    estado.sha = 'bbb222'
    estado.cambiados = 2
    await completarTurno($, 'turno-1')
    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()

    expect(llamadas).toContain('diff --name-only aaa111 bbb222')
  })

  test('sin nada que comitear ni comiteado los números van sin color', async ($, on) => {
    conRepositorio(on, BASE)
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    const ui = await montar($)
    const ceros = await ui.findAll({ type: 'Text', text: /^0$/ })
    expect(ceros).toHaveLength(2)
    expect(ceros.every(c => c.props.color === undefined)).toBe(true)
    await ui.unmount()
  })

  test('consulta como mucho una vez cada 15 segundos y solo si hubo actividad', async ($, on) => {
    const { consultasDeEstado } = conRepositorio(on, { ...BASE, sucios: 1 })
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()
    expect(consultasDeEstado()).toBe(1)
    expect(REVISION_DE_CAMBIOS_MS).toBe(15 * 1000)

    for (let i = 0; i < 5; i += 1) {
      await completarTurno($, `turno-${i}`)
    }
    await asentar()
    expect(consultasDeEstado()).toBe(1)

    await reloj.advance(REVISION_DE_CAMBIOS_MS - 1)
    await asentar()
    expect(consultasDeEstado()).toBe(1)

    await reloj.advance(1)
    await asentar()
    expect(consultasDeEstado()).toBe(2)

    // quieta: sin actividad no vuelve a consultar
    await reloj.advance(REVISION_DE_CAMBIOS_MS * 4)
    await asentar()
    expect(consultasDeEstado()).toBe(2)
  })

  test('cerrar un turno no le pide la rama a git: se lee en el intervalo siguiente y solo si hubo actividad', async ($, on) => {
    const { lecturasDeProyecto } = conRepositorio(on, BASE)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()
    expect(lecturasDeProyecto()).toBe(1)

    await completarTurno($, 'turno-1')
    expect(lecturasDeProyecto()).toBe(1)

    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()
    expect(lecturasDeProyecto()).toBe(2)

    // quieta: sin actividad no vuelve a leer
    await reloj.advance(REVISION_DE_CAMBIOS_MS * 4)
    await asentar()
    expect(lecturasDeProyecto()).toBe(2)
  })

  test('si la rama cambia durante un turno, el panel la muestra en el intervalo siguiente', async ($, on) => {
    const estado = { ...BASE }
    conRepositorio(on, estado)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    estado.rama = 'feat/otra'
    estado.sha = 'bbb222'
    await completarTurno($, 'turno-1')
    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: 'rama: feat/otra' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'rama: main' })).toBeUndefined()
    await ui.unmount()
  })

  test('git status no toma el lock del índice: no le estorba a quien comitea a la vez', async ($, on) => {
    const { llamadas } = conRepositorio(on, BASE)
    mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    expect(llamadas).toContain('--no-optional-locks status --porcelain --untracked-files=all')
  })

  test('al cambiar de rama lo comiteado vuelve a contar desde cero', async ($, on) => {
    const estado = { ...BASE }
    const { llamadas } = conRepositorio(on, estado)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    estado.rama = 'otra'
    estado.sha = 'ccc333'
    estado.cambiados = 7
    await completarTurno($, 'turno-1')
    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()

    expect(llamadas.some(l => l.startsWith('diff'))).toBe(false)
    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /^7$/ })).toBeUndefined()
    await ui.unmount()

    estado.sha = 'ddd444'
    estado.cambiados = 2
    await completarTurno($, 'turno-2')
    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()

    expect(llamadas).toContain('diff --name-only ccc333 ddd444')
  })

  test('sin git no muestra los números ni llama a git status', async ($, on) => {
    const { consultasDeEstado } = conRepositorio(on, { ...BASE, sinGit: true })
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()
    await completarTurno($, 'turno-1')
    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()

    expect(consultasDeEstado()).toBe(0)
    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /^0$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /comite/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /archivos/ })).toBeUndefined()
    await ui.unmount()
  })

  test('si una consulta falla el panel conserva el último número', async ($, on) => {
    const estado = { ...BASE, sucios: 3 }
    conRepositorio(on, estado)
    const reloj = mock.clock(on, { now: AHORA })

    await iniciar($)
    await asentar()

    estado.falla = true
    estado.sucios = 9
    await completarTurno($, 'turno-1')
    await reloj.advance(REVISION_DE_CAMBIOS_MS)
    await asentar()

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /^3$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^9$/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('ventana de contexto de los agentes', () => {
  type Alta = Parameters<typeof mock.clock>[0]

  const MODELO = 'claude-haiku-4-5'

  const SPAWN = {
    tool_use_id: 'toolu_1',
    prompt: 'mapear la API',
    description: 'revisar el diff',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' } as const,
    parentModel: 'claude-sonnet-5-5',
    background: true,
    fork: false,
  }

  // el motor de los tests no trae almacenamiento: uno en memoria, con la ida y vuelta por JSON del real
  const conAlmacen = (on: Alta, iniciales: Record<string, unknown> = {}) => {
    const datos = new Map<string, unknown>(Object.entries(iniciales))
    on('store.get', (_$, e) => ({ value: datos.get(e.key) }))
    on('store.set', (_$, e) => {
      datos.set(e.key, JSON.parse(JSON.stringify(e.value)))

      return { value: undefined }
    })

    return datos
  }

  // lo mínimo para que arranque la sesión; lo demás que lee el arranque rechaza y el mod lo traga
  const conArranque = (on: Alta) => {
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'contexto' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.root', () => ({ value: 'C:\\trabajo\\mi-proyecto' }))
    on('env.get', () => ({ value: undefined }))
    on('fs.read', () => ({ value: JSON.stringify({ name: 'contexto-lateral', version: '0.1.0' }) }))
    on('process.run', () => ({
      value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
  }

  // un agente en segundo plano del modelo de `MODELO`, cuyo último request llevó 110 mil tokens
  const conAgente = (on: Alta) => {
    on('agent.spawn', () => ({ model: MODELO, agentId: 'a2' }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    mock.clock(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: {
          input_tokens: 60_000,
          output_tokens: 10,
          cache_read_input_tokens: 50_000,
          cache_creation_input_tokens: 0,
          model: MODELO,
        },
      }
    })
  }

  const iniciar = ($: Engine) =>
    $.session.start({ cwd: 'C:\\trabajo\\mi-proyecto', surface: 'terminal', isInteractive: true })

  const medirPrincipal = ($: Engine) =>
    $.session.measure({
      context: { tokens: 1000, window: 200_000, percent: 1 },
      rateLimits: [],
      changed: ['context'],
    })

  const pasoPrincipal = async ($: Engine) => {
    for await (const _chunk of $.turn.step({ turnId: 'turno-main', index: 0, model: MODELO, messageCount: 1 })) {
      // el hook de arriba no emite trozos
    }
  }

  const pasoDelAgente = async ($: Engine) => {
    for await (const _chunk of $.turn.step({
      turnId: 'turno-a2',
      index: 0,
      model: MODELO,
      messageCount: 1,
      agentId: 'a2',
    })) {
      // idem
    }
  }

  test('la ventana que se aprende de un modelo principal se guarda', async ($, on) => {
    const datos = conAlmacen(on)
    conAgente(on)

    await medirPrincipal($)
    await pasoPrincipal($)

    expect(datos.get('ventanas')).toEqual({ [MODELO]: 200_000 })
  })

  test('guardar la ventana de un modelo no pierde la de los que ya estaban', async ($, on) => {
    const datos = conAlmacen(on, { ventanas: { 'claude-sonnet-5-5': 1_000_000 } })
    conAgente(on)

    await medirPrincipal($)
    await pasoPrincipal($)

    expect(datos.get('ventanas')).toEqual({ 'claude-sonnet-5-5': 1_000_000, [MODELO]: 200_000 })
  })

  test('al iniciar la sesión recupera lo guardado: un agente que nunca fue principal muestra su barra', async ($, on) => {
    conAlmacen(on, { ventanas: { [MODELO]: 200_000 } })
    conArranque(on)
    conAgente(on)

    await iniciar($)
    await $.agent.spawn(SPAWN)
    await pasoDelAgente($)

    const ui = await montar($)
    const barra = await ui.find({ type: 'Text', text: ' 55%' })
    expect(barra?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: /110\.0k de 200\.0k tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sin barra/ })).toBeUndefined()
    await ui.unmount()
  })

  const GUARDADOS_INVALIDOS: ReadonlyArray<readonly [string, unknown]> = [
    ['no es un objeto', 'texto'],
    ['no es nada', null],
    ['la ventana no es un número', { [MODELO]: 'mucho' }],
    ['la ventana no es positiva', { [MODELO]: -5 }],
  ]

  for (const [motivo, guardado] of GUARDADOS_INVALIDOS) {
    test(`ignora lo guardado si ${motivo}`, async ($, on) => {
      conAlmacen(on, { ventanas: guardado })
      conArranque(on)
      conAgente(on)

      await iniciar($)
      await $.agent.spawn(SPAWN)
      await pasoDelAgente($)

      const ui = await montar($)
      expect(await ui.find({ type: 'Text', text: /110\.0k tokens · ventana sin dato/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('sin la ventana de un agente, el panel explica por qué no hay barra', async ($, on) => {
    conAgente(on)

    await $.agent.spawn(SPAWN)
    await pasoDelAgente($)

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /110\.0k tokens · ventana sin dato/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sin barra: ventana del modelo sin dato/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Se aprende cuando corre como principal/ })).toBeDefined()
    await ui.unmount()
  })

  test('con la ventana conocida el panel no explica nada', async ($, on) => {
    conAgente(on)

    await medirPrincipal($)
    await pasoPrincipal($)
    await $.agent.spawn(SPAWN)
    await pasoDelAgente($)

    const ui = await montar($)
    expect(await ui.find({ type: 'Text', text: /110\.0k de 200\.0k tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sin barra/ })).toBeUndefined()
    await ui.unmount()
  })
})
