/** Una ventana de uso del plan, con la forma de `SessionRateLimit` (el contrato no puede importar). */
export type LimiteDeUso = { kind: string; percentUsed: number; resetsAt?: string }

export type Contexto = { tokens?: number; window: number; percent?: number }

export type ModeloUsado = {
  id: string
  turnos: number
  entrada: number
  salida: number
  cache: number
}

export type Proyecto = {
  nombre: string
  rama: string | null
  worktree: string | null
}

export type AgenteEnCurso = {
  id: string
  descripcion: string
  tipo: string
  modelo: string
  enSegundoPlano: boolean
  esWorkflow: boolean
  tokens: number | null
  visto: number
}

/** Lo último que se supo de un agente cuando terminó: sirve para reponerlo si un mensaje lo reanuda. */
export type AgenteRetirado = {
  id: string
  descripcion: string
  tipo: string
  enSegundoPlano: boolean
  detenido: number
}

/** Un shell lanzado en segundo plano (Bash o PowerShell); `visto` es la última vez que se supo que seguía vivo. */
export type ShellEnSegundoPlano = {
  id: string
  comando: string
  visto: number
}

/** Un servidor MCP instalado por la persona y si `claude mcp list` lo dio por conectado. */
export type ServidorMcp = {
  nombre: string
  conectado: boolean
}

/** Una entrada de `background_tasks` del hook Stop, con la forma de `BackgroundTaskSummary` (el contrato no puede importar). */
export type TareaEnSegundoPlano = {
  id: string
  type: string
  status: string
  description: string
  command?: string
}

declare module 'claude-code' {
  interface PluginState {
    'contexto-lateral': {
      contexto: Contexto | null
      modelos: ModeloUsado[]
      version: string | null
      modVersion: string | null
      versionNueva: string | null
      modeloPrincipal: string | null
      proyecto: Proyecto | null
      agentes: AgenteEnCurso[]
      retirados: AgenteRetirado[]
      ventanas: Record<string, number>
      limites: LimiteDeUso[]
      shells: ShellEnSegundoPlano[]
      mcp: ServidorMcp[] | null
    }
  }
}
