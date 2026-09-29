//! Windows Job Object: killing the pane job should terminate assigned processes.

#[cfg(windows)]
#[test]
fn killing_pane_job_terminates_assigned_process() {
    use loomria_app_lib::process::ProcessTree;
    use std::process::Command;
    use std::thread;
    use std::time::Duration;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    fn process_exists(pid: u32) -> bool {
        if pid == 0 {
            return false;
        }
        let Ok(handle) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
            return false;
        };
        unsafe {
            let _ = CloseHandle(handle);
        }
        true
    }

    let tree = ProcessTree::new();
    let mut ping = Command::new("ping");
    ping.args(["-n", "30", "127.0.0.1"]);
    let child = ping.spawn().expect("spawn ping");
    let pid = child.id();
    tree.assign_pid(pid).expect("assign ping to job");

    assert!(process_exists(pid), "ping should be running");

    drop(child);
    drop(tree);

    thread::sleep(Duration::from_millis(800));
    assert!(
        !process_exists(pid),
        "ping pid {} should be gone after job drop",
        pid
    );
}
