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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Failed,
    Stale,
}

pub struct SerialState {
    pub status: Mutex<ConnectionStatus>,
    pub last_error: Mutex<Option<String>>,
}

impl Default for SerialState {
    fn default() -> Self {
        SerialState {
            status: Mutex::new(ConnectionStatus::Disconnected),
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




#[tauri::command]
fn start_serial_reading(
    app: tauri::AppHandle,
    state: tauri::State<SerialState>,
    port_name: String,
    baud_rate: u32,
) -> Result<(), String> {
    // Guard against spawning a second reader thread while one is already
    // connected/connecting — otherwise reconnect clicks stack up threads.
    {
        let current = state.status.lock().unwrap();
        if matches!(*current, ConnectionStatus::Connected | ConnectionStatus::Connecting) {
            return Err("Already connected or connecting".into());
        }
    }

    *state.status.lock().unwrap() = ConnectionStatus::Connecting;

    // Clone an Arc-free handle we can move into the thread. Since Tauri's
    // managed state isn't directly Send into a raw thread::spawn closure
    // the usual way, grab the app handle's state accessor inside the thread.
    let app_for_thread = app.clone();

    thread::spawn(move || {
        let state = app_for_thread.state::<SerialState>();

        let mut port = match serialport::new(&port_name, baud_rate)
            .timeout(Duration::from_millis(100))
            .open()
        {
            Ok(port) => port,
            Err(e) => {
                eprintln!("Failed to open serial port: {}", e);
                *state.status.lock().unwrap() = ConnectionStatus::Failed;
                *state.last_error.lock().unwrap() = Some(format!("Failed to open {}: {}", port_name, e));
                let _ = app_for_thread.emit("serial-error", format!("Failed to open {}: {}", port_name, e));
                return;
            }
        };

        println!("Connected to {}", port_name);
        *state.status.lock().unwrap() = ConnectionStatus::Connected;
        *state.last_error.lock().unwrap() = None;
        let _ = app_for_thread.emit("serial-connected", port_name.clone());

        let mut buffer = [0u8; 1024];
        let mut line_buffer = String::new();
        let mut last_reading_at = Instant::now();
        let mut already_stale = false;
       //const EXPECTED_INTERVAL: Duration = Duration::from_millis(132);
        const STALE_THRESHOLD: Duration = Duration::from_millis(132 * 6); // tune to AE12's actual send interval

        loop {
            match port.read(&mut buffer) {
                Ok(bytes_read) => {
          if bytes_read > 0 {
            let chunk = String::from_utf8_lossy(&buffer[..bytes_read]);
            line_buffer.push_str(&chunk);

                // Loop while we can find a '+' that isn't at the very start
            while let Some(pos) = line_buffer
                .char_indices()
                .skip(1)
                .find(|&(_, c)| c == '+')
                .map(|(idx, _)| idx)
            {
                let line = line_buffer[..pos].trim().to_string();
                line_buffer.drain(..pos);

                if !line.is_empty() {
                    println!("Processed packet: {}", line);

                    if let Some(reading) = parse_weight_line(&line) {
                        last_reading_at = Instant::now();
                        if already_stale {
                            already_stale = false;
                            *state.status.lock().unwrap() = ConnectionStatus::Connected;
                            *state.last_error.lock().unwrap() = None;
                            let _ = app_for_thread.emit("serial-recovered", port_name.clone());
                        }
                        println!("Emitted weight reading: {:?}", reading);
                        let _ = app_for_thread.emit("weight-data", reading);
                        
                    } else {
                        eprintln!("Could not parse line: {}", line);
                    }
                }
            }

}



        }

        Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
            // No new bytes this cycle — check if we've gone too long without one
            if !already_stale && last_reading_at.elapsed() > STALE_THRESHOLD {
                already_stale = true;
                *state.status.lock().unwrap() = ConnectionStatus::Stale;
                *state.last_error.lock().unwrap() =
                    Some("No data received recently — indicator may be powered off".to_string());
                let _ = app_for_thread.emit(
                    "serial-stale",
                    "No data received recently — indicator may be powered off",
                );
            }
        }

        Err(e) => {
            eprintln!("Serial read error: {}", e);
            *state.status.lock().unwrap() = ConnectionStatus::Disconnected;
            *state.last_error.lock().unwrap() = Some(format!("Lost connection to {}: {}", port_name, e));
            let _ = app_for_thread.emit(
                "serial-disconnected",
                format!("Lost connection to {}: {}", port_name, e),
            );
            break;
        }


            }
        }
    
    
    });

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
struct ConnectionStatusResponse {
    status: ConnectionStatus,
    error: Option<String>,
}

#[tauri::command]
fn get_connection_status(state: tauri::State<SerialState>) -> ConnectionStatusResponse {
    ConnectionStatusResponse {
        status: state.status.lock().unwrap().clone(),
        error: state.last_error.lock().unwrap().clone(),
    }
}
#[tauri::command]
fn auto_detect_baud(port_name: String) -> Result<Option<u32>, String> {
    let common_rates = vec![9600, 4800, 2400, 600,1200];
    let mut buffer = [0u8; 1024];

    for &rate in &common_rates {
        match serialport::new(&port_name, rate)
            .timeout(Duration::from_millis(500))
            .open()
        {
            Ok(mut port) => {
                // Try a few reads per rate instead of just one
                for _ in 0..5 {
                    match port.read(&mut buffer) {
                        Ok(bytes_read) if bytes_read > 0 => {
                            let sample = String::from_utf8_lossy(&buffer[..bytes_read]);
                            println!("rate {}: got {} bytes: {:?}", rate, bytes_read, sample);
                            if sample.contains('+') || sample.contains('-') {
                                println!("🎯 Detected baud rate: {}", rate);
                                return Ok(Some(rate));
                            }
                        }
                        Ok(_) => continue, // 0 bytes, try again
                        Err(e) => {
                            eprintln!("read error at {}: {:?}", rate, e);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("failed to open {} at {}: {:?}", port_name, rate, e);
            }
        }
    }

    Ok(None)
}

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
            auto_detect_baud,
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
                .background_color(tauri::window::Color(15, 23, 41, 255))
                .build()?;
            // main.show().unwrap();
            Ok(())
        }).run(tauri::generate_context!())
        .expect("error while running tauri application");
}