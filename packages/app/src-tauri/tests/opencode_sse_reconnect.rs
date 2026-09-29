//! SSE reconnect smoke test against a minimal local HTTP server.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

#[test]
fn sse_client_reconnects_after_disconnect() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let connections = Arc::new(AtomicUsize::new(0));

    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    thread::spawn({
        let connections = Arc::clone(&connections);
        let stop = Arc::clone(&stop);
        move || {
            while !stop.load(Ordering::SeqCst) {
                let (mut stream, _) = listener.accept().expect("accept");
                connections.fetch_add(1, Ordering::SeqCst);
                let body = "data: {\"id\":\"1\",\"type\":\"server.connected\",\"properties\":{}}\n\n";
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n{body}"
                    )
                    .as_bytes(),
                );
                let _ = stream.flush();
                thread::sleep(Duration::from_millis(30));
                let mut buf = [0u8; 64];
                let _ = stream.read(&mut buf);
            }
        }
    });

    let url = format!("http://{addr}/event?directory=%2Ftmp");
    for _ in 0..3 {
        let _ = ureq::get(&url).timeout(Duration::from_millis(200)).call();
        thread::sleep(Duration::from_millis(80));
    }
    stop.store(true, Ordering::SeqCst);
    assert!(
        connections.load(Ordering::SeqCst) >= 2,
        "expected at least two SSE connection attempts"
    );
}
