use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::OnceLock;

static APP_JOB: OnceLock<ProcessTree> = OnceLock::new();

/// App-wide job so children inherit kill-on-close semantics (Windows).
pub fn init_application_job() {
    let tree = ProcessTree::new();
    let _ = APP_JOB.set(tree);
    #[cfg(windows)]
    {
        if let Some(app_tree) = APP_JOB.get() {
            let _ = app_tree.assign_pid(std::process::id());
        }
    }
}

pub fn assign_pid_to_pane_job(tree: &ProcessTree, pid: u32) {
    if pid == 0 {
        return;
    }
    let _ = tree.assign_pid(pid);
}

/// On Unix, put the PTY child in its own session so `killpg` tears down the tree.
#[cfg(unix)]
pub fn configure_unix_session(cmd: &mut portable_pty::CommandBuilder) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.as_mut().pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
}

#[cfg(not(unix))]
pub fn configure_unix_session(_cmd: &mut portable_pty::CommandBuilder) {}

/// Per-pane process group. `Send` via raw handle storage on Windows.
pub struct ProcessTree {
    assigned: Mutex<HashSet<u32>>,
    #[cfg(windows)]
    job_handle: isize,
}

unsafe impl Send for ProcessTree {}
unsafe impl Sync for ProcessTree {}

impl ProcessTree {
    pub fn new() -> Self {
        #[cfg(windows)]
        {
            use windows::core::PCWSTR;
            use windows::Win32::System::JobObjects::{
                CreateJobObjectW, JobObjectExtendedLimitInformation,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                SetInformationJobObject,
            };

            let job = unsafe {
                CreateJobObjectW(None, PCWSTR::null())
                    .map_err(|err| format!("CreateJobObjectW: {err}"))
                    .expect("CreateJobObjectW")
            };

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
                .expect("SetInformationJobObject");
            }

            let job_handle = job.0 as isize;

            Self {
                assigned: Mutex::new(HashSet::new()),
                job_handle,
            }
        }
        #[cfg(not(windows))]
        {
            Self {
                assigned: Mutex::new(HashSet::new()),
            }
        }
    }

    #[cfg(windows)]
    fn job(&self) -> windows::Win32::Foundation::HANDLE {
        windows::Win32::Foundation::HANDLE(self.job_handle as *mut _)
    }

    pub fn assign_pid(&self, pid: u32) -> Result<(), String> {
        if pid == 0 {
            return Ok(());
        }
        {
            let mut set = self.assigned.lock();
            if set.contains(&pid) {
                return Ok(());
            }
            set.insert(pid);
        }

        #[cfg(windows)]
        {
            use windows::Win32::Foundation::CloseHandle;
            use windows::Win32::System::JobObjects::AssignProcessToJobObject;
            use windows::Win32::System::Threading::{
                OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
            };

            let process = unsafe {
                OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
                    .map_err(|err| format!("OpenProcess({pid}): {err}"))?
            };
            unsafe {
                AssignProcessToJobObject(self.job(), process)
                    .map_err(|err| format!("AssignProcessToJobObject({pid}): {err}"))?;
                let _ = CloseHandle(process);
            }
        }

        Ok(())
    }

    fn terminate_assigned(&self) {
        #[cfg(windows)]
        {
            use windows::Win32::System::JobObjects::TerminateJobObject;
            unsafe {
                let _ = TerminateJobObject(self.job(), 1);
            }
        }
        #[cfg(unix)]
        {
            let pids: Vec<u32> = self.assigned.lock().iter().copied().collect();
            for pid in pids {
                unsafe {
                    let _ = libc::killpg(pid as i32, libc::SIGKILL);
                }
            }
        }
        self.assigned.lock().clear();
    }
}

impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.terminate_assigned();
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::CloseHandle;
            unsafe {
                let _ = CloseHandle(self.job());
            }
        }
    }
}
