use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_BACK, VK_CAPITAL, VK_DOWN, VK_ESCAPE, VK_LCONTROL, VK_LEFT, VK_LMENU,
    VK_LSHIFT, VK_OEM_1, VK_OEM_2, VK_OEM_3, VK_OEM_4, VK_OEM_5, VK_OEM_6, VK_OEM_7, VK_OEM_COMMA,
    VK_OEM_MINUS, VK_OEM_PERIOD, VK_OEM_PLUS, VK_RCONTROL, VK_RETURN, VK_RIGHT, VK_RMENU, VK_RSHIFT,
    VK_SPACE, VK_TAB, VK_UP, VK_ADD, VK_DECIMAL, VK_DELETE, VK_DIVIDE, VK_END, VK_F1, VK_F10,
    VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_HOME, VK_INSERT,
    VK_MULTIPLY, VK_NEXT, VK_NUMPAD0, VK_PRIOR, VK_SUBTRACT,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyBindings {
    accelerate_primary: String,
    brake: String,
    turn_left: String,
    turn_right: String,
    accelerate_secondary: String,
    drift: String,
    nitro: String,
    reset_car: String,
}

impl Default for KeyBindings {
    fn default() -> Self {
        Self {
            accelerate_primary: "ArrowUp".into(),
            brake: "ArrowDown".into(),
            turn_left: "ArrowLeft".into(),
            turn_right: "ArrowRight".into(),
            accelerate_secondary: "KeyW".into(),
            drift: "ShiftLeft".into(),
            nitro: "ControlLeft".into(),
            reset_car: "KeyR".into(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct InputStatePayload {
    accelerate_primary: bool,
    brake: bool,
    turn_left: bool,
    turn_right: bool,
    accelerate_secondary: bool,
    drift: bool,
    nitro: bool,
    reset_car: bool,
}

struct SharedState {
    bindings: Mutex<KeyBindings>,
    input_state: Mutex<InputStatePayload>,
    bindings_path: PathBuf,
}

#[tauri::command]
fn get_key_bindings(state: State<'_, Arc<SharedState>>) -> Result<KeyBindings, String> {
    let bindings = state
        .bindings
        .lock()
        .map_err(|_| String::from("无法读取当前键位"))?
        .clone();

    Ok(bindings)
}

#[tauri::command]
fn get_input_state(state: State<'_, Arc<SharedState>>) -> Result<InputStatePayload, String> {
    let input_state = state
        .input_state
        .lock()
        .map_err(|_| String::from("无法读取当前按键状态"))?
        .clone();

    Ok(input_state)
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn save_key_bindings(
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
    bindings: KeyBindings,
) -> Result<KeyBindings, String> {
    save_bindings_to_file(&state.bindings_path, &bindings)?;

    let next_input_state = build_input_state(&bindings);
    let should_emit = {
        let mut current_bindings = state
            .bindings
            .lock()
            .map_err(|_| String::from("无法写入键位配置"))?;
        *current_bindings = bindings.clone();

        let mut current_input_state = state
            .input_state
            .lock()
            .map_err(|_| String::from("无法更新按键状态"))?;
        let changed = *current_input_state != next_input_state;
        *current_input_state = next_input_state.clone();
        changed
    };

    if should_emit {
        app.emit("input-state", next_input_state)
            .map_err(|error| error.to_string())?;
    }

    Ok(bindings)
}

fn bindings_file_path() -> PathBuf {
    let app_data_dir = env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    app_data_dir.join("qqspeed-keyboard").join("bindings.json")
}

fn load_bindings_from_file(path: &Path) -> KeyBindings {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<KeyBindings>(&content).ok())
        .unwrap_or_default()
}

fn save_bindings_to_file(path: &Path, bindings: &KeyBindings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let serialized = serde_json::to_string_pretty(bindings).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}

fn start_monitoring(app: AppHandle, state: Arc<SharedState>) {
    thread::spawn(move || loop {
        let bindings = match state.bindings.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => {
                thread::sleep(Duration::from_millis(12));
                continue;
            }
        };

        let next_state = build_input_state(&bindings);
        let should_emit = match state.input_state.lock() {
            Ok(mut current_state) => {
                if *current_state == next_state {
                    false
                } else {
                    *current_state = next_state.clone();
                    true
                }
            }
            Err(_) => false,
        };

        if should_emit {
            let _ = app.emit("input-state", next_state);
        }

        thread::sleep(Duration::from_millis(8));
    });
}

fn build_input_state(bindings: &KeyBindings) -> InputStatePayload {
    InputStatePayload {
        accelerate_primary: is_key_pressed(&bindings.accelerate_primary),
        brake: is_key_pressed(&bindings.brake),
        turn_left: is_key_pressed(&bindings.turn_left),
        turn_right: is_key_pressed(&bindings.turn_right),
        accelerate_secondary: is_key_pressed(&bindings.accelerate_secondary),
        drift: is_key_pressed(&bindings.drift),
        nitro: is_key_pressed(&bindings.nitro),
        reset_car: is_key_pressed(&bindings.reset_car),
    }
}

fn is_key_pressed(code: &str) -> bool {
    code_to_virtual_key(code)
        .map(|virtual_key| unsafe { GetAsyncKeyState(virtual_key) < 0 })
        .unwrap_or(false)
}

fn code_to_virtual_key(code: &str) -> Option<i32> {
    if let Some(letter) = code.strip_prefix("Key") {
        let mut chars = letter.chars();
        let value = chars.next()?;
        if chars.next().is_none() && value.is_ascii_uppercase() {
            return Some(value as i32);
        }
    }

    if let Some(number) = code.strip_prefix("Digit") {
        let mut chars = number.chars();
        let value = chars.next()?;
        if chars.next().is_none() && value.is_ascii_digit() {
            return Some(value as i32);
        }
    }

    if let Some(number) = code.strip_prefix("Numpad") {
        let mut chars = number.chars();
        let value = chars.next()?;
        if chars.next().is_none() && value.is_ascii_digit() {
            let digit = value.to_digit(10)? as i32;
            return Some(VK_NUMPAD0.0 as i32 + digit);
        }
    }

    match code {
        "NumpadDecimal" => Some(VK_DECIMAL.0 as i32),
        "NumpadDivide" => Some(VK_DIVIDE.0 as i32),
        "NumpadMultiply" => Some(VK_MULTIPLY.0 as i32),
        "NumpadSubtract" => Some(VK_SUBTRACT.0 as i32),
        "NumpadAdd" => Some(VK_ADD.0 as i32),
        "NumpadEnter" => Some(VK_RETURN.0 as i32),
        "ArrowUp" => Some(VK_UP.0 as i32),
        "ArrowDown" => Some(VK_DOWN.0 as i32),
        "ArrowLeft" => Some(VK_LEFT.0 as i32),
        "ArrowRight" => Some(VK_RIGHT.0 as i32),
        "ShiftLeft" => Some(VK_LSHIFT.0 as i32),
        "ShiftRight" => Some(VK_RSHIFT.0 as i32),
        "ControlLeft" => Some(VK_LCONTROL.0 as i32),
        "ControlRight" => Some(VK_RCONTROL.0 as i32),
        "AltLeft" => Some(VK_LMENU.0 as i32),
        "AltRight" => Some(VK_RMENU.0 as i32),
        "Space" => Some(VK_SPACE.0 as i32),
        "Tab" => Some(VK_TAB.0 as i32),
        "Enter" => Some(VK_RETURN.0 as i32),
        "Escape" => Some(VK_ESCAPE.0 as i32),
        "Backspace" => Some(VK_BACK.0 as i32),
        "CapsLock" => Some(VK_CAPITAL.0 as i32),
        "Semicolon" => Some(VK_OEM_1.0 as i32),
        "Comma" => Some(VK_OEM_COMMA.0 as i32),
        "Period" => Some(VK_OEM_PERIOD.0 as i32),
        "Slash" => Some(VK_OEM_2.0 as i32),
        "Backquote" => Some(VK_OEM_3.0 as i32),
        "Quote" => Some(VK_OEM_7.0 as i32),
        "Minus" => Some(VK_OEM_MINUS.0 as i32),
        "Equal" => Some(VK_OEM_PLUS.0 as i32),
        "BracketLeft" => Some(VK_OEM_4.0 as i32),
        "BracketRight" => Some(VK_OEM_6.0 as i32),
        "Backslash" => Some(VK_OEM_5.0 as i32),
        "Delete" => Some(VK_DELETE.0 as i32),
        "Insert" => Some(VK_INSERT.0 as i32),
        "Home" => Some(VK_HOME.0 as i32),
        "End" => Some(VK_END.0 as i32),
        "PageUp" => Some(VK_PRIOR.0 as i32),
        "PageDown" => Some(VK_NEXT.0 as i32),
        "F1" => Some(VK_F1.0 as i32),
        "F2" => Some(VK_F2.0 as i32),
        "F3" => Some(VK_F3.0 as i32),
        "F4" => Some(VK_F4.0 as i32),
        "F5" => Some(VK_F5.0 as i32),
        "F6" => Some(VK_F6.0 as i32),
        "F7" => Some(VK_F7.0 as i32),
        "F8" => Some(VK_F8.0 as i32),
        "F9" => Some(VK_F9.0 as i32),
        "F10" => Some(VK_F10.0 as i32),
        "F11" => Some(VK_F11.0 as i32),
        "F12" => Some(VK_F12.0 as i32),
        _ => None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bindings_path = bindings_file_path();
    let initial_bindings = load_bindings_from_file(&bindings_path);
    let shared_state = Arc::new(SharedState {
        input_state: Mutex::new(build_input_state(&initial_bindings)),
        bindings: Mutex::new(initial_bindings),
        bindings_path,
    });
    let setup_state = shared_state.clone();

    tauri::Builder::default()
        .manage(shared_state)
        .setup(move |app| {
            start_monitoring(app.handle().clone(), setup_state.clone());
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                window.set_always_on_top(true)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_key_bindings,
            get_input_state,
            save_key_bindings,
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
