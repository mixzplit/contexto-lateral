# Ramas, Pull Requests y versiones

Este documento define cómo entran los cambios a este repositorio y cómo se publican las versiones del mod.
Aplica tanto a los cambios del mantenedor como a los de quien contribuya desde un fork.

---

## 1. Ramas

Hay una sola rama permanente y varias temporales. No se usa `git-flow` ni ninguna herramienta externa: alcanza con una convención de nombres.

- **`main`**: la rama publicada. Está protegida contra pushes directos y solo recibe cambios mediante Pull Request.
- **`feat/{nombre}`**: funcionalidad nueva o mejora. Sale de `main`.
- **`fix/{nombre}`**: corrección de un error. Sale de `main`.
- **`docs/{nombre}`**: cambios que solo tocan documentación. Sale de `main`.

Quien contribuya desde un fork aplica la misma convención de nombres en su fork.

---

## 2. Versionado (SemVer)

Se usa `MAJOR.MINOR.PATCH`:

- **MAJOR**: cambios que rompen compatibilidad.
- **MINOR**: funcionalidad nueva compatible.
- **PATCH**: corrección de errores.

La versión vive en `.claude-plugin/plugin.json` (campo `version`).

---

## 3. Commits (Conventional Commits)

Formato: `<tipo>: <descripción en minúsculas>`

- **`feat`**: funcionalidad nueva.
- **`fix`**: corrección de un error.
- **`docs`**: solo documentación.
- **`style`**: formato y espacios, sin cambio de lógica.
- **`refactor`**: mejora del código sin cambio funcional.
- **`test`**: pruebas.
- **`chore`**: mantenimiento y dependencias.

Los commits son atómicos: cada uno hace un solo cambio, con sus pruebas y su documentación.

---

## 4. Flujo de trabajo

### A. Inicio

```bash
git checkout main
git pull origin main
git checkout -b feat/nombre-del-cambio
```

### B. Desarrollo

Hacer commits atómicos con la convención de la sección 3. Antes de abrir el PR, verificar el mod:

```bash
claude plugin validate .
claude plugin test .
```

Cualquier texto de ejemplo en pruebas y documentación usa nombres neutros: sin nombres de proyectos personales, usuarios del sistema, rutas absolutas personales, correos ni tokens.

### C. Pull Request

1. Subir la rama: `git push origin feat/nombre-del-cambio`.
2. Abrir un PR hacia `main` y describir qué cambia y por qué.
3. El mantenedor revisa y prueba el cambio. Si pide ajustes, se agregan commits a la misma rama.

### D. Cierre

El merge se hace en GitHub. Después, limpieza local:

```bash
git checkout main
git pull origin main
git branch -d feat/nombre-del-cambio
```

---

## 5. Revisión de PRs externos

Un mod ejecuta código en la máquina de quien lo instala. Por eso el mantenedor lee el diff completo de cada PR **antes de ejecutar nada de él**, incluidas las pruebas. Se revisa con más atención:

- `.claude-plugin/plugin.json` y `.claude-plugin/marketplace.json`
- `hooks/hooks.json`
- archivos nuevos
- dependencias

---

## 6. Publicar una versión

Solo el mantenedor publica versiones.

Los tags no son obligatorios para que el mod se instale: sirven para marcar cada versión y para que otros plugins puedan declarar un rango de versiones de este. Lo que hace que los usuarios ya instalados reciban una actualización es el campo `version` de `.claude-plugin/plugin.json`: si no cambia, siguen con la copia en caché.

1. Abrir un PR `chore: version X.Y.Z` que actualice `version` en `.claude-plugin/plugin.json`, y mergearlo a `main`.
2. Sincronizar `main` local y comprobar que el árbol de trabajo está limpio.
3. Ver qué se va a etiquetar:

   ```bash
   claude plugin tag --dry-run
   ```

4. Crear el tag. El comando genera `contexto-lateral--vX.Y.Z` y valida que `plugin.json` y la entrada del marketplace coincidan:

   ```bash
   claude plugin tag
   ```

5. Subir el tag a GitHub: `git push origin contexto-lateral--vX.Y.Z`.

---

## 7. Reglas

> **Nada llega a `main` sin pasar por un Pull Request.**

El merge final se hace siempre en GitHub. Nunca se fusionan ramas localmente hacia `main`.

> **El agente no hace push ni crea PRs.**

Si se usa un agente de IA para preparar un cambio, el agente deja los commits listos de forma local. El `git push`, la apertura del PR y el merge los hace siempre una persona.

> **Los commits y los tags no llevan atribución a herramientas de IA.**

Ni `Co-Authored-By` ni firmas o trailers similares, ni en los commits ni en el mensaje de los tags.
