// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{Manager, Emitter,WebviewWindowBuilder, WebviewUrl};
use serde::Serialize;
use tauri_plugin_sql::{Migration, MigrationKind};
use std::io::Read;
use std::thread;
use std::time::Duration;
use std::time::Instant;
use tauri_plugin_printer_v2;
use std::sync::Mutex;
use tauri::Listener;
use std::io::Write;
use tauri::{AppHandle, State};



#[derive(Clone, serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Failed,
    Stale,
}

#[derive(Clone, Serialize)]
pub struct ScaleStateInfo {
    pub status: ConnectionStatus,
    pub last_error: Option<String>,
    pub current_weight: i64,
    #[serde(skip)]
    pub last_reading_at: Instant,
}

impl Default for ScaleStateInfo {
    fn default() -> Self {
        Self {
            status: ConnectionStatus::Disconnected,
            last_error: None,
            current_weight: 0,
            last_reading_at: Instant::now(),
        }
    }
}

pub struct SerialState {
    pub scale1: std::sync::Mutex<ScaleStateInfo>,
    pub scale2: std::sync::Mutex<ScaleStateInfo>,
    pub scale3: std::sync::Mutex<ScaleStateInfo>,
    pub system_active: std::sync::Mutex<bool>,
    // These restore compatibility with your existing get_connection_status command
    pub status: std::sync::Mutex<ConnectionStatus>, 
    pub last_error: std::sync::Mutex<Option<String>>,
}

impl Default for SerialState {
    fn default() -> Self {
        SerialState {
            scale1: Mutex::new(ScaleStateInfo::default()),
            scale2: Mutex::new(ScaleStateInfo::default()),
            scale3: Mutex::new(ScaleStateInfo::default()),
            system_active: Mutex::new(false),
             // Set the baseline connection status to disconnected
            status: Mutex::new(ConnectionStatus::Disconnected),
            // Wrap None inside the Mutex to initialize an empty error state
            last_error: Mutex::new(None), 
        }
    }
}


#[derive(Serialize)]
struct SerialPortInfo {
    name: String,
    port_type: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
struct WeightReading {
    weight: i64,
    unit: String,
    stable: bool,
    mode: String, // "net" or "gross"
}

fn parse_weight_line(line: &str) -> Option<WeightReading> {
    // Strip any non-ASCII / control characters
    let clean: String = line.chars().filter(|c| c.is_ascii()).collect();
    let clean = clean.trim();

    if clean.is_empty() {
        return None;
    }

    // --- Universal Intercept for 12-Byte Indicator Continuous Streaming Packets ---
    if (clean.starts_with('+') || clean.starts_with('-')) && clean.len() >= 9 {
        if clean[1..7].chars().all(|c| c.is_ascii_digit()) {
            let sign = if clean.starts_with('-') { -1.0 } else { 1.0 };
            let raw_digits = &clean[1..7]; 
            
            if let Ok(raw_val) = raw_digits.parse::<f64>() {
                let mut final_weight_f64 = raw_val * sign;
                //Read the decimal configuration byte position (index 7)
                if let Some(decimal_char) = clean.chars().nth(7) {
                    if decimal_char.is_ascii_digit() {
                        let decimal_places = decimal_char.to_digit(10).unwrap_or(0) as i32;
                        
                        if decimal_places > 0 {
                            let factor = 10.0_f64.powi(decimal_places);
                            final_weight_f64 /= factor;
                        }
                    }
                }

                //FIX: Round to nearest whole integer before casting back to i64
                let weight_i64 = final_weight_f64.round() as i64;

                return Some(WeightReading {
                    weight: weight_i64,
                    unit: "kg".to_string(),
                    stable: true,
                    mode: "gross".to_string(),
                });
            }
        }
    }

    // --- Existing Legacy Logic Updated for Integers ---
    let first_digit_pos = clean.find(|c: char| c.is_ascii_digit() || c == '-' || c == '+')?;
    let (flags, rest) = clean.split_at(first_digit_pos);

    let unit_start = rest.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(rest.len());
    let (number_str, unit_str) = rest.split_at(unit_start);

    let whole_number_str = number_str.split('.').next().unwrap_or(number_str).trim();
    let weight: i64 = whole_number_str.parse().ok()?; 

    let stable = !flags.contains('w'); 
    let mode = if flags.contains('n') { "net" } else { "gross" };

    Some(WeightReading {
        weight,
        unit: if unit_str.is_empty() { "kg".to_string() } else { unit_str.to_lowercase() },
        stable,
        mode: mode.to_string(),
    })
}


// Keep your existing SerialState struct exactly as you had it, 
// but add a global status field so your original `get_connection_status` command remains unbroken!


#[tauri::command]
fn start_serial_reading(
    app: AppHandle,
    state: State<SerialState>,
    port_scale1: String,
    port_scale2: String,
    port_scale3: String,
    baud_rate: u32,
    jumbo_port: String,
) -> Result<(), String> {
    
    // System lock guard matching your logic requirements
    {
        let mut active = state.system_active.lock().unwrap();
        if *active {
            return Err("System already running".into());
        }
        *active = true;
    }

    *state.status.lock().unwrap() = ConnectionStatus::Connecting;

    let scale_targets = vec![
        (port_scale1, "scale1"),
        (port_scale2, "scale2"),
        (port_scale3, "scale3"),
    ];

    const STALE_THRESHOLD: Duration = Duration::from_millis(132 * 6);
    let app_for_broadcast = app.clone();

    // 1. Launch background readers for physical scales
    for (port_name, id_str) in scale_targets {
        if port_name.trim().is_empty() { continue; }

        let app_for_thread = app.clone();
        let id = id_str.to_string();
        let p_name = port_name.clone();

        thread::spawn(move || {
            let state_accessor = app_for_thread.state::<SerialState>();
            let target_mutex = match id.as_str() {
                "scale1" => &state_accessor.scale1,
                "scale2" => &state_accessor.scale2,
                _ => &state_accessor.scale3,
            };

            let mut port = match serialport::new(&p_name, baud_rate).timeout(Duration::from_millis(100)).open() {
                Ok(p) => p,
                Err(e) => {
                    *state_accessor.status.lock().unwrap() = ConnectionStatus::Failed;
                    *state_accessor.last_error.lock().unwrap() = Some(e.to_string());
                    let _ = app_for_thread.emit("serial-error", e.to_string());
                    return;
                }
            };

            *state_accessor.status.lock().unwrap() = ConnectionStatus::Connected;
            let _ = app_for_thread.emit("serial-connected", p_name.clone());

            let mut buffer = [0u8; 1024];
            let mut line_buffer = String::new();
            let mut already_stale = false;

            loop {
                match port.read(&mut buffer) {
                    Ok(bytes_read) => {
                        if bytes_read > 0 {
                            let chunk = String::from_utf8_lossy(&buffer[..bytes_read]);
                            line_buffer.push_str(&chunk);

                            while let Some(pos) = line_buffer.char_indices().skip(1).find(|&(_, c)| c == '+').map(|(idx, _)| idx) {
                                let line = line_buffer[..pos].trim().to_string();
                                line_buffer.drain(..pos);

                                if !line.is_empty() {
                                    if let Some(reading) = parse_weight_line(&line) {
                                        let mut lock = target_mutex.lock().unwrap();
                                        lock.last_reading_at = Instant::now();
                                        lock.current_weight = reading.weight;
                                        
                                    
                                    if already_stale {
                                        already_stale = false;
                                        lock.status = ConnectionStatus::Connected;
                                        lock.last_error = None;
                                        
                                        //Emit which specific scale recovered
                                        let _ = app_for_thread.emit("scale-recovered", id.clone());
                                    }

                                    }
                                }
                            }
                        }
                    }
                 
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        let elapsed = target_mutex.lock().unwrap().last_reading_at.elapsed();
                        if !already_stale && elapsed > STALE_THRESHOLD {
                            already_stale = true;
                            
                            // Update its personal structural state status slot to stale
                            target_mutex.lock().unwrap().status = ConnectionStatus::Stale;
                            
                            //Emit which specific scale went stale instead of a global blanket event
                            let _ = app_for_thread.emit("scale-stale", id.clone()); 
                        }
                    }
                    Err(e) => {
                        *state_accessor.status.lock().unwrap() = ConnectionStatus::Disconnected;
                        let _ = app_for_thread.emit("serial-disconnected", e.to_string());
                        break;
                    }
                }
            }
        });
    }

    // 2. Scoreboard AND UI Broadcast Thread
    // This loop handles transmitting values directly to your physical scoreboard,
    // while simultaneously pushing the identical summed value to your UI Dashboard!
    // ─── UPDATE THE MAIN TRANSMISSION LOOP IN YOUR RUST CODE ───
    if !jumbo_port.trim().is_empty() {
        thread::spawn(move || {
            let state_accessor = app_for_broadcast.state::<SerialState>();
            if let Ok(mut scoreboard) = serialport::new(&jumbo_port, 9600).open() {
                loop {
                    // Read scales and check their connection statuses
                    let w1 = {
                        let s = state_accessor.scale1.lock().unwrap();
                        if s.status == ConnectionStatus::Connected { s.current_weight } else { 0 }
                    };
                    
                    let w2 = {
                        let s = state_accessor.scale2.lock().unwrap();
                        if s.status == ConnectionStatus::Connected { s.current_weight } else { 0 }
                    };
                    
                    let w3 = {
                        let s = state_accessor.scale3.lock().unwrap();
                        if s.status == ConnectionStatus::Connected { s.current_weight } else { 0 }
                    };

                    // Calculate sum using only active, fully connected indicators
                    let total_sum = w1 + w2 + w3;

                    // Write out to the physical Jumbo Scoreboard
                    let frame_out = format!("{}\r\n", total_sum);
                    let _ = scoreboard.write_all(frame_out.as_bytes());
                    let _ = scoreboard.flush();

                    // Emit the active live sum directly to your React context
                    let _ = app_for_broadcast.emit("summed-weight-data", WeightReading {
                        weight: total_sum,
                        unit: "kg".to_string(),
                        stable: true,
                        mode: "gross".to_string(),
                    });

                    thread::sleep(Duration::from_millis(200));
                }
            }
        });
    }


    Ok(())
}



/// Lists available serial ports, and along the way "primes" the Windows
/// serial subsystem by briefly opening and closing each port it finds.
/// This works around the CH340/CH341 quirk where the very first open
/// attempt in a session can fail even though the port is enumerated.
///
/// Call this from the "Refresh ports" button. After this runs, a
/// subsequent plain `connect` on the CH3XX port should succeed without
/// needing to prime again.
#[tauri::command]
fn refresh_serial_ports() -> Result<Vec<String>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    let port_names: Vec<String> = ports.into_iter().map(|p| p.port_name).collect();

    for name in &port_names {
        match serialport::new(name, 9600) // baud doesn't matter for priming
            .timeout(Duration::from_millis(200))
            .open()
        {
            Ok(port) => {
                println!("Primed {}", name);
                // Held briefly, then dropped/closed here.
                thread::sleep(Duration::from_millis(100));
                drop(port);
            }
            Err(e) => {
                // Expected for the CH3XX port on a cold subsystem — the act
                // of trying is often enough to help. Not fatal, just log it.
                eprintln!("Priming attempt on {} failed (may be normal): {}", name, e);
            }
        }
    }

    Ok(port_names)
}





#[tauri::command]
fn get_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;

    let port_infos = ports
        .into_iter()
        .map(|port| {
            let port_type = match &port.port_type {
                serialport::SerialPortType::UsbPort(info) => {
                    format!(
                        "USB {}",
                        info.product.clone().unwrap_or_else(|| "Serial".to_string())
                    )
                }
                serialport::SerialPortType::PciPort => "PCI".to_string(),
                serialport::SerialPortType::BluetoothPort => "Bluetooth".to_string(),
                serialport::SerialPortType::Unknown => "Unknown".to_string(),
            };

            SerialPortInfo {
                name: port.port_name,
                port_type,
            }
        })
        .collect();

    Ok(port_infos)
}



#[derive(serde::Serialize)]
struct ScaleStatus {
    status: ConnectionStatus,
    error: Option<String>,
    current_weight: i64,
}

#[derive(serde::Serialize)]
struct ConnectionStatusResponse {
    scale1: ScaleStatus,
    scale2: ScaleStatus,
    scale3: ScaleStatus,
    system_active: bool,
}

#[tauri::command]
fn get_connection_status(state: tauri::State<SerialState>) -> ConnectionStatusResponse {
    let s1 = state.scale1.lock().unwrap();
    let s2 = state.scale2.lock().unwrap();
    let s3 = state.scale3.lock().unwrap();
    
    ConnectionStatusResponse {
        scale1: ScaleStatus {
            status: s1.status.clone(),
            error: s1.last_error.clone(),
            current_weight: s1.current_weight,
        },
        scale2: ScaleStatus {
            status: s2.status.clone(),
            error: s2.last_error.clone(),
            current_weight: s2.current_weight,
        },
        scale3: ScaleStatus {
            status: s3.status.clone(),
            error: s3.last_error.clone(),
            current_weight: s3.current_weight,
        },
        system_active: *state.system_active.lock().unwrap(),
    }
}

// #[tauri::command]
// fn auto_detect_baud(port_name: String) -> Result<Option<u32>, String> {
//     let common_rates = vec![9600, 4800, 2400, 600,1200];
//     let mut buffer = [0u8; 1024];

//     for &rate in &common_rates {
//         match serialport::new(&port_name, rate)
//             .timeout(Duration::from_millis(500))
//             .open()
//         {
//             Ok(mut port) => {
//                 // Try a few reads per rate instead of just one
//                 for _ in 0..5 {
//                     match port.read(&mut buffer) {
//                         Ok(bytes_read) if bytes_read > 0 => {
//                             let sample = String::from_utf8_lossy(&buffer[..bytes_read]);
//                             println!("rate {}: got {} bytes: {:?}", rate, bytes_read, sample);
//                             if sample.contains('+') || sample.contains('-') {
//                                 println!("🎯 Detected baud rate: {}", rate);
//                                 return Ok(Some(rate));
//                             }
//                         }
//                         Ok(_) => continue, // 0 bytes, try again
//                         Err(e) => {
//                             eprintln!("read error at {}: {:?}", rate, e);
//                         }
//                     }
//                 }
//             }
//             Err(e) => {
//                 eprintln!("failed to open {} at {}: {:?}", port_name, rate, e);
//             }
//         }
//     }

//     Ok(None)
// }

#[tauri::command]
fn close_splashscreen(app_handle: tauri::AppHandle) {
    // Find the windows by their labels
    if let Some(splashscreen) = app_handle.get_webview_window("splashscreen") {
        if let Some(main_window) = app_handle.get_webview_window("main") {
            // Show main window and close splash
            main_window.show().unwrap();
            splashscreen.close().unwrap();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SerialState::default())
        .plugin(tauri_plugin_printer_v2::init())
        .plugin(tauri_plugin_sql::Builder::default().add_migrations( "sqlite:smartweigh.db",
                    vec![
                        Migration {
                            version: 1,
                            description: "create users table",
                            sql: "
                                CREATE TABLE users (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    name TEXT NOT NULL,
                                    email TEXT NOT NULL UNIQUE,
                                    password_hash TEXT NOT NULL,
                                    role TEXT NOT NULL DEFAULT 'VIEWER',
                                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                                );
                            ",
                            kind: MigrationKind::Up,
                        },
                        Migration {
                                version: 2,
                                description: "create vehicles table",
                                sql: "
                                    CREATE TABLE vehicles (
                                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                                        plate_number TEXT NOT NULL UNIQUE,
                                        transporter TEXT NOT NULL,
                                        truck_type TEXT NOT NULL,
                                        max_permissible_weight INTEGER NOT NULL,
                                        tare_weight INTEGER,
                                        driver_name TEXT,
                                        driver_license TEXT,
                                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    );
                                ",
                                kind: MigrationKind::Up,
                            },
                        Migration {
                            version: 3,
                            description: "create settings table",
                            sql: "
                                CREATE TABLE settings (
                                    email TEXT NOT NULL ,
                                    password TEXT NOT NULL,
                                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                                );
                            ",
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 4,
                            description: "create weighing records table",
                            sql: "
                                CREATE TABLE weighing_records (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,

                                    vehicle_id INTEGER NOT NULL,
                                    user_id INTEGER NOT NULL,

                                    tare_weight INTEGER NOT NULL,
                                    gross_weight INTEGER NOT NULL,
                                    net_weight INTEGER NOT NULL,
                                    max_allowed_weight INTEGER NOT NULL,
                                    unit TEXT NOT NULL DEFAULT 'kg',
                                    weighing_status TEXT NOT NULL DEFAULT 'COMPLETED',
                                    ticket_number TEXT NOT NULL UNIQUE,
                                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                    FOREIGN KEY (vehicle_id)
                                        REFERENCES vehicles(id),

                                    FOREIGN KEY (user_id)
                                        REFERENCES users(id)
                                );
                            ",
                            kind: MigrationKind::Up,
                        },

                    Migration {
                        version: 5,
                        description: "create audit logs table",
                        sql: "
                            CREATE TABLE audit_logs (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,

                                user_id INTEGER NOT NULL,

                                action TEXT NOT NULL,
                                entity_type TEXT NOT NULL,
                                entity_id INTEGER,

                                details TEXT,

                                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                FOREIGN KEY (user_id)
                                    REFERENCES users(id)
                            );
                        ",
                        kind: MigrationKind::Up,
                    },
                    Migration {
                        version: 7,
                        description: "create ticket photo table",
                        sql: "
                            CREATE TABLE ticket_photos (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                ticket_number TEXT NOT NULL,
                                camera TEXT NOT NULL CHECK(camera IN ('front', 'rear')),
                                screenshot_data TEXT NOT NULL,
                                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                            );
                        ",
                        kind: MigrationKind::Up,
                    },
                    Migration {
                        version: 6,
                        description: "add material and destination to vehicles",
                        sql: "
                            ALTER TABLE vehicles ADD COLUMN material TEXT;
                            ALTER TABLE vehicles ADD COLUMN destination TEXT;
                        ",
                        kind: MigrationKind::Up,
                    },
                    Migration {
                        version: 8,
                        description: "add material and destination to weighing_records",
                        sql: "
                            ALTER TABLE weighing_records ADD COLUMN material TEXT;
                            ALTER TABLE weighing_records ADD COLUMN destination TEXT;
                        ",
                        kind: MigrationKind::Up,
                    },

                     Migration {
                        version: 9,
                        description: "add pin setup otp columns to users",
                        sql: "
                            ALTER TABLE users ADD COLUMN pin_setup_otp_hash TEXT;
                            ALTER TABLE users ADD COLUMN pin_setup_otp_expires_at TEXT;
                        ",
                        kind: MigrationKind::Up,
                    },
                    ],).build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_serial_ports,
            start_serial_reading,
            refresh_serial_ports,
            get_connection_status,
            // auto_detect_baud,
            close_splashscreen
        ]) .setup(|app| {
            let splash_clone = app.get_webview_window("splashscreen").unwrap();

            app.listen("splashscreen-ready", move |_event| {
                splash_clone.show().unwrap();
            });

             WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("SmartWeigh")
                .visible(false)
                .maximized(true)
                .inner_size(1920.0, 1080.0)
                .background_color(tauri::window::Color(15, 23, 41, 255))
                .build()?;
            // main.show().unwrap();
            Ok(())
        }).run(tauri::generate_context!())
        .expect("error while running tauri application");
}