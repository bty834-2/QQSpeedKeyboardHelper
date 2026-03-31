import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import { getCurrentWindow, LogicalSize, PhysicalPosition, primaryMonitor } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useCallback, useEffect, useState } from 'react'
import './App.css'

type BindingId =
  | 'acceleratePrimary'
  | 'brake'
  | 'turnLeft'
  | 'turnRight'
  | 'accelerateSecondary'
  | 'drift'
  | 'nitro'
  | 'resetCar'

type KeyBindings = Record<BindingId, string>
type InputState = Record<BindingId, boolean>
type RuntimeMode = 'loading' | 'desktop' | 'browser'

type BindingMeta = {
  id: BindingId
  title: string
  description: string
}

const storageKey = 'qqspeed-keyboard-bindings'
const settingsKey = 'qqspeed-keyboard-settings'

interface AppSettings {
  scale: number
  keyBg: string
  keyActiveBg: string
  keyTextColor: string
  bgOpacity: number
}

const defaultSettings: AppSettings = {
  scale: 1,
  keyBg: '#0a101d',
  keyActiveBg: '#3b82f6', // Changed from purple (#8b5cf6) to blue (#3b82f6)
  keyTextColor: '#ffffff',
  bgOpacity: 0.8,
}

const bindingMetaList: BindingMeta[] = [
  { id: 'acceleratePrimary', title: '前进主键', description: '默认展示为上方向键' },
  { id: 'brake', title: '后退', description: '默认展示为下方向键' },
  { id: 'turnLeft', title: '左拐', description: '默认展示为左方向键' },
  { id: 'turnRight', title: '右拐', description: '默认展示为右方向键' },
  { id: 'accelerateSecondary', title: '前进副键', description: '默认展示为 W 键' },
  { id: 'drift', title: '漂移', description: '默认展示为 Shift 键' },
  { id: 'nitro', title: '氮气', description: '默认展示为 Ctrl 键' },
  { id: 'resetCar', title: '复位', description: '默认展示为 R 键' },
]

const defaultBindings: KeyBindings = {
  acceleratePrimary: 'ArrowUp',
  brake: 'ArrowDown',
  turnLeft: 'ArrowLeft',
  turnRight: 'ArrowRight',
  accelerateSecondary: 'KeyW',
  drift: 'ShiftLeft',
  nitro: 'ControlLeft',
  resetCar: 'KeyR',
}

const createEmptyInputState = (): InputState => ({
  acceleratePrimary: false,
  brake: false,
  turnLeft: false,
  turnRight: false,
  accelerateSecondary: false,
  drift: false,
  nitro: false,
  resetCar: false,
})

const supportedKeyLabels = Object.fromEntries([
  ...Array.from({ length: 26 }, (_, index) => {
    const letter = String.fromCharCode(65 + index)
    return [`Key${letter}`, letter]
  }),
  ...Array.from({ length: 10 }, (_, index) => [`Digit${index}`, String(index)]),
  ...Array.from({ length: 10 }, (_, index) => [`Numpad${index}`, `Num${index}`]),
  ['NumpadDecimal', 'Num.'],
  ['NumpadDivide', 'Num/'],
  ['NumpadMultiply', 'Num*'],
  ['NumpadSubtract', 'Num-'],
  ['NumpadAdd', 'Num+'],
  ['NumpadEnter', 'NumEnt'],
  ['ArrowUp', '⬆'],
  ['ArrowDown', '⬇'],
  ['ArrowLeft', '⬅'],
  ['ArrowRight', '➡'],
  ['ShiftLeft', 'Shift'],
  ['ShiftRight', 'RShift'],
  ['ControlLeft', 'Ctrl'],
  ['ControlRight', 'RCtrl'],
  ['AltLeft', 'Alt'],
  ['AltRight', 'RAlt'],
  ['Space', 'Space'],
  ['Tab', 'Tab'],
  ['Enter', 'Enter'],
  ['Escape', 'Esc'],
  ['Backspace', 'Back'],
  ['Semicolon', ';'],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
  ['Backquote', '`'],
  ['Quote', "'"],
  ['Minus', '-'],
  ['Equal', '='],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backslash', '\\'],
  ['CapsLock', 'Caps'],
  ['Delete', 'Del'],
  ['Insert', 'Ins'],
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'PgUp'],
  ['PageDown', 'PgDn'],
  ...Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `F${index + 1}`]),
]) as Record<string, string>

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const sanitizeBindings = (value: unknown): KeyBindings => {
  const record = asRecord(value)
  const getString = (...keys: string[]) => {
    for (const key of keys) {
      const candidate = record[key]
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate
      }
    }
    return undefined
  }

  return {
    acceleratePrimary: getString('acceleratePrimary', 'accelerate_primary') ?? defaultBindings.acceleratePrimary,
    brake: getString('brake') ?? defaultBindings.brake,
    turnLeft: getString('turnLeft', 'turn_left') ?? defaultBindings.turnLeft,
    turnRight: getString('turnRight', 'turn_right') ?? defaultBindings.turnRight,
    accelerateSecondary: getString('accelerateSecondary', 'accelerate_secondary') ?? defaultBindings.accelerateSecondary,
    drift: getString('drift') ?? defaultBindings.drift,
    nitro: getString('nitro') ?? defaultBindings.nitro,
    resetCar: getString('resetCar', 'reset_car') ?? defaultBindings.resetCar,
  }
}

const sanitizeInputState = (value: unknown): InputState => {
  const record = asRecord(value)
  const getBool = (...keys: string[]) => {
    for (const key of keys) {
      const candidate = record[key]
      if (typeof candidate === 'boolean') {
        return candidate
      }
    }
    return undefined
  }

  return {
    acceleratePrimary: getBool('acceleratePrimary', 'accelerate_primary') ?? false,
    brake: getBool('brake') ?? false,
    turnLeft: getBool('turnLeft', 'turn_left') ?? false,
    turnRight: getBool('turnRight', 'turn_right') ?? false,
    accelerateSecondary: getBool('accelerateSecondary', 'accelerate_secondary') ?? false,
    drift: getBool('drift') ?? false,
    nitro: getBool('nitro') ?? false,
    resetCar: getBool('resetCar', 'reset_car') ?? false,
  }
}

const readBrowserBindings = (): KeyBindings => {
  const storedValue = window.localStorage.getItem(storageKey)

  if (!storedValue) {
    return defaultBindings
  }

  try {
    return sanitizeBindings(JSON.parse(storedValue) as Partial<KeyBindings>)
  } catch {
    return defaultBindings
  }
}

const writeBrowserBindings = (bindings: KeyBindings) => {
  window.localStorage.setItem(storageKey, JSON.stringify(bindings))
}

const readSettings = (): AppSettings => {
  const stored = window.localStorage.getItem(settingsKey)
  if (!stored) return defaultSettings
  try {
    const parsed = JSON.parse(stored) as Partial<AppSettings>
    return {
      scale: parsed.scale ?? defaultSettings.scale,
      keyBg: parsed.keyBg ?? defaultSettings.keyBg,
      keyActiveBg: parsed.keyActiveBg ?? defaultSettings.keyActiveBg,
      keyTextColor: parsed.keyTextColor ?? defaultSettings.keyTextColor,
      bgOpacity: parsed.bgOpacity ?? defaultSettings.bgOpacity,
    }
  } catch {
    return defaultSettings
  }
}

const writeSettings = (settings: AppSettings) => {
  window.localStorage.setItem(settingsKey, JSON.stringify(settings))
}

const buildBrowserInputState = (
  bindings: KeyBindings,
  pressedKeys: Set<string>,
): InputState => ({
  acceleratePrimary: pressedKeys.has(bindings.acceleratePrimary),
  brake: pressedKeys.has(bindings.brake),
  turnLeft: pressedKeys.has(bindings.turnLeft),
  turnRight: pressedKeys.has(bindings.turnRight),
  accelerateSecondary: pressedKeys.has(bindings.accelerateSecondary),
  drift: pressedKeys.has(bindings.drift),
  nitro: pressedKeys.has(bindings.nitro),
  resetCar: pressedKeys.has(bindings.resetCar),
})

const formatKeyLabel = (code: string) => supportedKeyLabels[code] ?? code

const colorToRgb = (value: string): { r: number; g: number; b: number } | null => {
  const trimmed = value.trim()

  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1)
    const full = hex.length === 8 ? hex.slice(0, 6) : hex
    if (full.length !== 6) return null
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
    return { r, g, b }
  }

  const rgbaMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgbaMatch) {
    const r = Number(rgbaMatch[1])
    const g = Number(rgbaMatch[2])
    const b = Number(rgbaMatch[3])
    if ([r, g, b].some((n) => Number.isNaN(n))) return null
    return { r: Math.max(0, Math.min(255, r)), g: Math.max(0, Math.min(255, g)), b: Math.max(0, Math.min(255, b)) }
  }

  return null
}

const withAlpha = (value: string, alpha: number): string => {
  const rgb = colorToRgb(value)
  if (!rgb) return value
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`
}

const applyAccentVars = (accent: string) => {
  const root = document.documentElement
  root.style.setProperty('--accent-color', accent)
  root.style.setProperty('--accent-45', withAlpha(accent, 0.45))
  root.style.setProperty('--accent-30', withAlpha(accent, 0.30))
  root.style.setProperty('--accent-20', withAlpha(accent, 0.20))
  root.style.setProperty('--accent-12', withAlpha(accent, 0.12))
  root.style.setProperty('--accent-80', withAlpha(accent, 0.80))
}

function App() {
  const [bindings, setBindings] = useState<KeyBindings>(() => {
    const stored = window.localStorage.getItem(storageKey)
    if (stored) {
      try {
        return sanitizeBindings(JSON.parse(stored))
      } catch {
        return defaultBindings
      }
    }
    return defaultBindings
  })
  const [inputState, setInputState] = useState<InputState>(createEmptyInputState)
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('loading')
  const [editingBinding, setEditingBinding] = useState<BindingId | null>(null)

  // Settings
  const initialSettings = readSettings()
  const [scale, setScale] = useState(initialSettings.scale)
  const [keyBg, setKeyBg] = useState(initialSettings.keyBg)
  const [keyActiveBg, setKeyActiveBg] = useState(initialSettings.keyActiveBg)
  const [keyTextColor, setKeyTextColor] = useState(initialSettings.keyTextColor)
  const [bgOpacity, setBgOpacity] = useState(initialSettings.bgOpacity)

  // 监听来自设置窗口的更新
  useEffect(() => {
    const unlisten = listen<{
      scale?: number
      keyBg?: string
      keyActiveBg?: string
      keyTextColor?: string
      bgOpacity?: number
      bindings?: KeyBindings
    }>('settings-sync', (event) => {
      console.log('[DEBUG] Received sync event:', event.payload)
      const { scale, keyBg, keyActiveBg, keyTextColor, bgOpacity, bindings } = event.payload
      if (scale !== undefined) setScale(scale)
      if (keyBg !== undefined) setKeyBg(keyBg)
      if (keyActiveBg !== undefined) setKeyActiveBg(keyActiveBg)
      if (keyTextColor !== undefined) setKeyTextColor(keyTextColor)
      if (bgOpacity !== undefined) setBgOpacity(bgOpacity)
      if (bindings !== undefined) setBindings(bindings)
    })

    return () => {
      unlisten.then(u => u())
    }
  }, [])

  const applyBindings = useCallback(
    async (nextBindings: KeyBindings) => {
      try {
        if (runtimeMode === 'desktop') {
          const savedBindings = sanitizeBindings(
            await invoke<KeyBindings>('save_key_bindings', {
              bindings: nextBindings,
            }),
          )

          setBindings(savedBindings)
          writeBrowserBindings(savedBindings)
        } else {
          setBindings(nextBindings)
          writeBrowserBindings(nextBindings)
        }
      } catch {
        // Error handled silently or via console
      }
    },
    [runtimeMode],
  )

  useEffect(() => {
    document.body.classList.add('transparent-mode')
    
    // Always decorations false for this clean mode
    void getCurrentWindow()
      .setDecorations(false)
      .catch(() => {})

    const positionAtBottomRight = async () => {
      try {
        const monitor = await primaryMonitor()
        if (monitor) {
          const workArea = (monitor as unknown as { workArea?: { position: { x: number; y: number }; size: { width: number; height: number } } }).workArea
          const area = workArea ?? { position: monitor.position, size: monitor.size }
          const win = getCurrentWindow()
          const winSize = await win.outerSize()
          const x = area.position.x + area.size.width - winSize.width
          const y = area.position.y + area.size.height - winSize.height
          await win.setPosition(new PhysicalPosition(x, y))
        }
      } catch (err) {
        console.error('Failed to position window:', err)
      }
    }
    void positionAtBottomRight()
  }, [])

  useEffect(() => {
    writeSettings({ scale, keyBg, keyActiveBg, keyTextColor, bgOpacity })
    
    applyAccentVars(keyActiveBg)
  }, [scale, keyBg, keyActiveBg, keyTextColor, bgOpacity])

  useEffect(() => {
    // Window sizing constants at scale 1.0
    const BASE_WIDTH = 338
    const BASE_HEIGHT = 152
    const PADDING_LEFT = 10
    const PADDING_RIGHT = 64 // Space for settings buttons
    const PADDING_TOP = 15
    const PADDING_BOTTOM = 15

    const targetWidth = Math.ceil(BASE_WIDTH * scale + PADDING_LEFT + PADDING_RIGHT)
    const targetHeight = Math.ceil(BASE_HEIGHT * scale + PADDING_TOP + PADDING_BOTTOM)

    const updateWindowSize = async () => {
      try {
        const win = getCurrentWindow()
        await win.setSize(new LogicalSize(targetWidth, targetHeight))
      } catch (err) {
        console.error('Failed to set window size:', err)
      }
    }
    void updateWindowSize()
  }, [scale])

  useEffect(() => {
    let disposed = false
    let removeListener: (() => void) | undefined

    const bootstrap = async () => {
      try {
        const loadedBindings = sanitizeBindings(
          await invoke<KeyBindings>('get_key_bindings'),
        )
        const loadedState = sanitizeInputState(
          await invoke<InputState>('get_input_state'),
        )
        const unlisten = await listen<InputState>('input-state', (event) => {
          setInputState(sanitizeInputState(event.payload))
        })

        if (disposed) {
          unlisten()
          return
        }

        removeListener = unlisten
        setBindings(loadedBindings)
        setInputState(loadedState)
        writeBrowserBindings(loadedBindings)
        setRuntimeMode('desktop')
      } catch {
        const localBindings = readBrowserBindings()

        if (disposed) {
          return
        }

        setBindings(localBindings)
        setRuntimeMode('browser')
      }
    }

    void bootstrap()

    return () => {
      disposed = true
      removeListener?.()
    }
  }, [])

  useEffect(() => {
    if (runtimeMode !== 'browser') {
      return
    }

    const pressedKeys = new Set<string>()

    const syncState = () => {
      setInputState(buildBrowserInputState(bindings, pressedKeys))
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      pressedKeys.add(event.code)
      syncState()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.code)
      syncState()
    }

    const clearPressedKeys = () => {
      pressedKeys.clear()
      syncState()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearPressedKeys)
    syncState()

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearPressedKeys)
    }
  }, [bindings, runtimeMode])

  useEffect(() => {
    if (!editingBinding) {
      return
    }

    const handleCapture = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (!(event.code in supportedKeyLabels)) {
        return
      }

      const nextBindings = {
        ...bindings,
        [editingBinding]: event.code,
      }

      void applyBindings(
        nextBindings,
      )
      setEditingBinding(null)
    }

    window.addEventListener('keydown', handleCapture, true)

    return () => {
      window.removeEventListener('keydown', handleCapture, true)
    }
  }, [applyBindings, bindings, editingBinding])

  const handleExit = async () => {
    try {
      await invoke('exit_app')
    } catch {
      try {
        await getCurrentWindow().close()
      } catch {
        window.close()
      }
    }
  }

  const handleOpenSettings = async () => {
    try {
      new WebviewWindow('settings', {
        url: 'index.html?window=settings',
        title: '飞车按键助手 - 设置',
        width: 580,
        height: 420,
        resizable: true,
        decorations: true,
        alwaysOnTop: true,
        center: true,
      })
    } catch (err) {
      console.error('Failed to open settings window:', err)
    }
  }

  useEffect(() => {
    const handleWindowMouseDown = (e: MouseEvent) => {
      // 只有左键点击且不是点击控制按钮区域时触发拖拽
      if (e.button === 0 && !(e.target as HTMLElement).closest('.controls-overlay')) {
        void getCurrentWindow().startDragging().catch(() => {})
      }
    }
    window.addEventListener('mousedown', handleWindowMouseDown, true)
    return () => window.removeEventListener('mousedown', handleWindowMouseDown, true)
  }, [])

  const getEffectiveBg = (baseColor: string, isPressed: boolean) => {
    // If the color is already rgba, use it. Otherwise, inject opacity.
    if (baseColor.startsWith('rgba')) return baseColor
    const opacity = isPressed ? Math.min(1, bgOpacity + 0.15) : bgOpacity
    return `${baseColor}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`
  }

  return (
    <main className="app-shell">
      <section
        className="surface"
        style={{
          width: Math.ceil(338 * scale + 74), // BASE_WIDTH(338) + PADDING_LEFT(10) + PADDING_RIGHT(64)
          height: Math.ceil(152 * scale + 30), // BASE_HEIGHT(152) + PADDING_TOP(15) + PADDING_BOTTOM(15)
        }}
      >
        <section
          className="preview-panel"
          style={{
            width: 338,
            height: 152,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <div className="preview-grid">
            <div className="action-stack">
              <div
                className={`key-tile drift ${inputState.drift ? 'active' : ''}`}
                style={{
                  backgroundColor: getEffectiveBg(inputState.drift ? keyActiveBg : keyBg, inputState.drift),
                }}
              >
                <span className="key-value" style={{ color: keyTextColor }}>Shift</span>
              </div>
              <div
                className={`key-tile nitro ${inputState.nitro ? 'active' : ''}`}
                style={{
                  backgroundColor: getEffectiveBg(inputState.nitro ? keyActiveBg : keyBg, inputState.nitro),
                }}
              >
                <span className="key-value" style={{ color: keyTextColor }}>Ctrl</span>
              </div>
            </div>

            <div className="main-cluster">
              <div className="key-row">
                <div
                  className={`key-tile key-w ${inputState.accelerateSecondary ? 'active' : ''}`}
                  style={{
                    backgroundColor: getEffectiveBg(inputState.accelerateSecondary ? keyActiveBg : keyBg, inputState.accelerateSecondary),
                  }}
                >
                  <span className="key-value" style={{ color: keyTextColor }}>W</span>
                </div>
                <div
                  className={`key-tile key-up ${inputState.acceleratePrimary ? 'active' : ''}`}
                  style={{
                    backgroundColor: getEffectiveBg(inputState.acceleratePrimary ? keyActiveBg : keyBg, inputState.acceleratePrimary),
                  }}
                >
                  <span className="key-value" style={{ color: keyTextColor }}>⬆</span>
                </div>
                
                <div className={`key-tile key-r ${inputState.resetCar ? 'active' : ''}`}
                  style={{
                    backgroundColor: getEffectiveBg(inputState.resetCar ? keyActiveBg : keyBg, inputState.resetCar),
                  }}
                >
                  <span className="key-value" style={{ color: keyTextColor }}>R</span>
                </div>
              </div>

              <div className="key-row">
                <div
                  className={`key-tile key-left ${inputState.turnLeft ? 'active' : ''}`}
                  style={{
                    backgroundColor: getEffectiveBg(inputState.turnLeft ? keyActiveBg : keyBg, inputState.turnLeft),
                  }}
                >
                  <span className="key-value" style={{ color: keyTextColor }}>⬅</span>
                </div>
                <div
                  className={`key-tile key-down ${inputState.brake ? 'active' : ''}`}
                  style={{
                    backgroundColor: getEffectiveBg(inputState.brake ? keyActiveBg : keyBg, inputState.brake),
                  }}
                >
                  <span className="key-value" style={{ color: keyTextColor }}>⬇</span>
                </div>
                <div
                  className={`key-tile key-right ${inputState.turnRight ? 'active' : ''}`}
                  style={{
                    backgroundColor: getEffectiveBg(inputState.turnRight ? keyActiveBg : keyBg, inputState.turnRight),
                  }}
                >
                  <span className="key-value" style={{ color: keyTextColor }}>➡</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="controls-overlay">
          <button
            type="button"
            className="control-btn"
            title="设置"
            onClick={handleOpenSettings}
          >
            ⚙️
          </button>
          <button
            type="button"
            className="control-btn exit-btn"
            title="退出应用"
            onClick={handleExit}
          >
            ✕
          </button>
        </aside>
      </section>
    </main>
  )
}

export function SettingsWindow() {
  const [bindings, setBindings] = useState<KeyBindings>(() => {
    const stored = window.localStorage.getItem(storageKey)
    if (stored) {
      try {
        return sanitizeBindings(JSON.parse(stored))
      } catch {
        return defaultBindings
      }
    }
    return defaultBindings
  })
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('loading')
  const [editingBinding, setEditingBinding] = useState<BindingId | null>(null)
  // Settings
  const initialSettings = readSettings()
  const [scale, setScale] = useState(initialSettings.scale)
  const [keyBg, setKeyBg] = useState(initialSettings.keyBg)
  const [keyActiveBg, setKeyActiveBg] = useState(initialSettings.keyActiveBg)
  const [keyTextColor, setKeyTextColor] = useState(initialSettings.keyTextColor)
  const [bgOpacity, setBgOpacity] = useState(initialSettings.bgOpacity)

  // 同步设置到主窗口
  useEffect(() => {
    console.log('[DEBUG] Emitting sync event:', { scale, keyBg, keyActiveBg, keyTextColor, bgOpacity, bindings })
    emit('settings-sync', { scale, keyBg, keyActiveBg, keyTextColor, bgOpacity, bindings })
  }, [scale, keyBg, keyActiveBg, keyTextColor, bgOpacity, bindings])

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const loadedBindings = sanitizeBindings(await invoke<KeyBindings>('get_key_bindings'))
        setBindings(loadedBindings)
        setRuntimeMode('desktop')
      } catch {
        // Fallback already handled by initial state
        setRuntimeMode('browser')
      }
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    writeSettings({ scale, keyBg, keyActiveBg, keyTextColor, bgOpacity })
    
    applyAccentVars(keyActiveBg)
  }, [scale, keyBg, keyActiveBg, keyTextColor, bgOpacity])

  const applyBindings = useCallback(
    async (nextBindings: KeyBindings) => {
      try {
        if (runtimeMode === 'desktop') {
          const savedBindings = sanitizeBindings(
            await invoke<KeyBindings>('save_key_bindings', { bindings: nextBindings }),
          )
          setBindings(savedBindings)
          writeBrowserBindings(savedBindings)
        } else {
          setBindings(nextBindings)
          writeBrowserBindings(nextBindings)
        }
      } catch {
        return
      }
    },
    [runtimeMode],
  )

  useEffect(() => {
    if (!editingBinding) return
    const handleCapture = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (!(event.code in supportedKeyLabels)) {
        return
      }
      const nextBindings = { ...bindings, [editingBinding]: event.code }
      void applyBindings(nextBindings)
      setEditingBinding(null)
    }
    window.addEventListener('keydown', handleCapture, true)
    return () => window.removeEventListener('keydown', handleCapture, true)
  }, [applyBindings, bindings, editingBinding])

  const isBusyCapturing = editingBinding !== null

  return (
    <div className="settings-standalone">
      <div className="watermark-overlay">
        {Array.from({ length: 40 }).map((_, i) => (
          <div key={i} className="watermark-row">
            {Array.from({ length: 15 }).map((_, j) => (
              <span key={j}>https://github.com/bty834-2 ，禁止商用</span>
            ))}
          </div>
        ))}
      </div>
      <main className="settings-main">
        <section className="settings-group">
          <div className="group-header">外观设置</div>
          <div className="settings-grid row-two-cols">
            <div className="setting-card">
              <label>缩放比例: {Math.round(scale * 100)}%</label>
              <input
                type="range" min="0.4" max="2.0" step="0.1"
                value={scale} className="flat-range"
                onChange={(e) => setScale(parseFloat(e.target.value))}
              />
            </div>
            <div className="setting-card">
              <label>背景不透明度: {Math.round(bgOpacity * 100)}%</label>
              <input
                type="range" min="0" max="1" step="0.05"
                value={bgOpacity} className="flat-range"
                onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
              />
            </div>
          </div>
          <div className="settings-grid row-three-cols">
            <div className="setting-card">
              <label>按键背景色</label>
              <div className="color-row">
                <input type="color" value={keyBg.startsWith('rgba') ? '#0a101d' : keyBg} onChange={(e) => setKeyBg(e.target.value)} />
                <input type="text" value={keyBg} className="flat-input" onChange={(e) => setKeyBg(e.target.value)} />
              </div>
            </div>
            <div className="setting-card">
              <label>按下高亮色</label>
              <div className="color-row">
                <input type="color" value={keyActiveBg.startsWith('rgba') ? '#3b82f6' : keyActiveBg} onChange={(e) => setKeyActiveBg(e.target.value)} />
                <input type="text" value={keyActiveBg} className="flat-input" onChange={(e) => setKeyActiveBg(e.target.value)} />
              </div>
            </div>
            <div className="setting-card">
              <label>文字颜色</label>
              <div className="color-row">
                <input type="color" value={keyTextColor} onChange={(e) => setKeyTextColor(e.target.value)} />
                <input type="text" value={keyTextColor} className="flat-input" onChange={(e) => setKeyTextColor(e.target.value)} />
              </div>
            </div>
          </div>
        </section>

        <section className="settings-group">
          <div className="group-header">
            <span>按键绑定</span>
          </div>
          <div className="binding-table">
            {bindingMetaList.map((item) => (
              <div key={item.id} className={`binding-item ${editingBinding === item.id ? 'active-edit' : ''}`}>
                <div className="item-info">
                  <div className="item-title">{item.title}</div>
                </div>
                <div className="item-actions">
                  <div className="current-key">{formatKeyLabel(bindings[item.id])}</div>
                  <button
                    type="button" className={`flat-btn ${editingBinding === item.id ? 'btn-cancel' : 'btn-edit'}`}
                    disabled={isBusyCapturing && editingBinding !== item.id}
                    onClick={() => {
                      setEditingBinding((current) => (current === item.id ? null : item.id))
                    }}
                  >
                    {editingBinding === item.id ? '取消' : '修改'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
