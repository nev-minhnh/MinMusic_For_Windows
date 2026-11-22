//! Job Object with KILL_ON_JOB_CLOSE: the kernel kills the JVM when MinMusic.exe dies for any reason.
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::*;

pub struct JobObject(HANDLE);

// A kernel handle is usable from any thread.
unsafe impl Send for JobObject {}
unsafe impl Sync for JobObject {}

impl JobObject {
    pub fn new_kill_on_close() -> Result<JobObject, String> {
        unsafe {
            let h = CreateJobObjectW(None, None).map_err(|e| format!("CreateJobObjectW: {e}"))?;
            let job = JobObject(h);
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
            SetInformationJobObject(
                h,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .map_err(|e| format!("SetInformationJobObject: {e}"))?;
            Ok(job)
        }
    }

    pub fn assign(&self, process: HANDLE) -> Result<(), String> {
        unsafe {
            AssignProcessToJobObject(self.0, process).map_err(|e| format!("AssignProcessToJobObject: {e}"))
        }
    }
}

impl Drop for JobObject {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
