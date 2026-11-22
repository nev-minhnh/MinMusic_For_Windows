//! sendinput: inject real OS mouse input (goes through the compositor input path).
//!
//! Usage:
//!   sendinput wheel --x X --y Y [--notches N] [--delta -120] [--interval 200]
//!   sendinput move  --x X --y Y [--to-x X2 --to-y Y2] [--steps N] [--interval MS]
//!
//! Coordinates are PHYSICAL screen pixels (the process is per-monitor DPI aware).
//! `wheel`: moves the cursor to (x,y), then sends N wheel events of `delta`
//! (negative = scroll down) spaced `interval` ms apart.
//! `move`: moves the cursor to (x,y); with --to-x/--to-y glides to it in `steps`.
//! Prints one JSON line with the QPC-free wall clock (ms since epoch) of the
//! first and last injected event, so the analyzer can cut the trace window.

use std::mem::size_of;
use std::thread::sleep;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[repr(C)]
#[derive(Clone, Copy)]
struct MouseInput {
    dx: i32,
    dy: i32,
    mouse_data: u32,
    flags: u32,
    time: u32,
    extra: usize,
}

// INPUT { DWORD type; union { MOUSEINPUT mi; ... } } -- union is 32 bytes on x64 (KEYBDINPUT/MOUSEINPUT max).
#[repr(C)]
struct Input {
    kind: u32,
    _pad: u32, // alignment of the union on x64
    mi: MouseInput,
}

const INPUT_MOUSE: u32 = 0;
const MOUSEEVENTF_WHEEL: u32 = 0x0800;

#[link(name = "user32")]
extern "system" {
    fn SendInput(n: u32, inputs: *const Input, size: i32) -> u32;
    fn SetCursorPos(x: i32, y: i32) -> i32;
    fn SetProcessDpiAwarenessContext(ctx: isize) -> i32;
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()
}

fn arg(args: &[String], name: &str) -> Option<i64> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
}

fn wheel(delta: i32) -> bool {
    let inp = Input {
        kind: INPUT_MOUSE,
        _pad: 0,
        mi: MouseInput { dx: 0, dy: 0, mouse_data: delta as u32, flags: MOUSEEVENTF_WHEEL, time: 0, extra: 0 },
    };
    unsafe { SendInput(1, &inp, size_of::<Input>() as i32) == 1 }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("");
    unsafe {
        // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
        SetProcessDpiAwarenessContext(-4);
    }
    let (x, y) = match (arg(&args, "--x"), arg(&args, "--y")) {
        (Some(x), Some(y)) => (x as i32, y as i32),
        _ => {
            eprintln!("usage: sendinput wheel|move --x X --y Y [...]");
            std::process::exit(2);
        }
    };
    let interval = arg(&args, "--interval").unwrap_or(200).max(0) as u64;
    match cmd {
        "wheel" => {
            let notches = arg(&args, "--notches").unwrap_or(1);
            let delta = arg(&args, "--delta").unwrap_or(-120) as i32;
            unsafe { SetCursorPos(x, y) };
            sleep(Duration::from_millis(50));
            let first = now_ms();
            for i in 0..notches {
                if !wheel(delta) {
                    eprintln!("SendInput failed (blocked by UIPI?)");
                    std::process::exit(3);
                }
                if i + 1 < notches {
                    sleep(Duration::from_millis(interval));
                }
            }
            println!("{{\"firstMs\":{},\"lastMs\":{},\"notches\":{}}}", first, now_ms(), notches);
        }
        "move" => {
            let first = now_ms();
            match (arg(&args, "--to-x"), arg(&args, "--to-y")) {
                (Some(tx), Some(ty)) => {
                    let steps = arg(&args, "--steps").unwrap_or(30).max(1);
                    unsafe { SetCursorPos(x, y) };
                    for s in 1..=steps {
                        let px = x as i64 + (tx - x as i64) * s / steps;
                        let py = y as i64 + (ty - y as i64) * s / steps;
                        unsafe { SetCursorPos(px as i32, py as i32) };
                        sleep(Duration::from_millis(interval));
                    }
                }
                _ => unsafe {
                    SetCursorPos(x, y);
                },
            }
            println!("{{\"firstMs\":{},\"lastMs\":{}}}", first, now_ms());
        }
        _ => {
            eprintln!("unknown command '{cmd}' (wheel|move)");
            std::process::exit(2);
        }
    }
}
