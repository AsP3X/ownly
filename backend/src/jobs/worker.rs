// Human: Worker pool that continuously claims and executes queued background jobs.
// Agent: SPAWNS N tokio tasks; HEARTBEAT while running; PERIODIC stale-lock sweep; RELEASES locks on exit.

use std::sync::Arc;
use std::time::Duration;

use uuid::Uuid;

use crate::config::Config;
use crate::AppState;

use super::executor::execute_job;
use super::store::{
    claim_next_job, ensure_worker_released_job, recover_running_jobs_on_startup,
    recover_stale_jobs, touch_job_heartbeat,
};

const IDLE_POLL_MS: u64 = 500;

/// Human: Tunable worker-pool settings for lock heartbeats and stale-job recovery.
#[derive(Clone, Copy, Debug)]
pub struct JobWorkerSettings {
    pub worker_count: usize,
    pub stale_minutes: i64,
    pub heartbeat_seconds: u64,
    pub recovery_poll_seconds: u64,
}

impl From<&Config> for JobWorkerSettings {
    fn from(config: &Config) -> Self {
        Self {
            worker_count: config.job_worker_count.max(1) as usize,
            stale_minutes: config.job_stale_minutes.max(1) as i64,
            heartbeat_seconds: config.job_heartbeat_seconds.max(5),
            recovery_poll_seconds: config.job_recovery_poll_seconds.max(10),
        }
    }
}

/// Human: Start the background worker pool, periodic stale-lock sweeper, and startup recovery.
// Agent: CALLS recover_stale_jobs once + on interval; SPAWNS worker_count claim loops.
pub fn start_worker_pool(state: Arc<AppState>, settings: JobWorkerSettings) {
    let recovery_state = state.clone();
    let stale_minutes = settings.stale_minutes;
    tokio::spawn(async move {
        match recover_running_jobs_on_startup(&recovery_state.pool).await {
            Ok(released) if released > 0 => {
                tracing::info!(
                    released,
                    "re-queued running background jobs after API restart"
                );
            }
            Ok(_) => {}
            Err(error) => {
                tracing::error!(%error, "failed to recover running jobs after API restart");
            }
        }

        match recover_stale_jobs(&recovery_state.pool, stale_minutes).await {
            Ok(released) if released > 0 => {
                tracing::info!(
                    released,
                    stale_minutes,
                    "recovered stale background jobs back to queued"
                );
            }
            Ok(_) => {}
            Err(error) => {
                tracing::error!(%error, "failed to recover stale background jobs at startup");
            }
        }
    });

    let sweep_state = state.clone();
    let poll_secs = settings.recovery_poll_seconds;
    tokio::spawn(async move {
        let interval = Duration::from_secs(poll_secs);
        loop {
            tokio::time::sleep(interval).await;
            match recover_stale_jobs(&sweep_state.pool, stale_minutes).await {
                Ok(released) if released > 0 => {
                    tracing::warn!(
                        released,
                        stale_minutes,
                        "periodic sweep released stale running job locks"
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::error!(%error, "periodic stale job recovery failed");
                }
            }
        }
    });

    for index in 0..settings.worker_count {
        let worker_state = state.clone();
        let worker_id = format!("worker-{}-{}", index, Uuid::new_v4());
        let heartbeat_seconds = settings.heartbeat_seconds;
        tokio::spawn(async move {
            worker_loop(worker_state, worker_id, heartbeat_seconds).await;
        });
    }

    tracing::info!(
        worker_count = settings.worker_count,
        stale_minutes = settings.stale_minutes,
        heartbeat_seconds = settings.heartbeat_seconds,
        recovery_poll_seconds = settings.recovery_poll_seconds,
        "background job worker pool started"
    );
}

async fn worker_loop(state: Arc<AppState>, worker_id: String, heartbeat_seconds: u64) {
    loop {
        let claimed = match claim_next_job(&state.pool, &worker_id).await {
            Ok(job) => job,
            Err(error) => {
                tracing::error!(worker_id = %worker_id, %error, "job claim failed");
                tokio::time::sleep(Duration::from_millis(IDLE_POLL_MS)).await;
                continue;
            }
        };

        let Some(job) = claimed else {
            tokio::time::sleep(Duration::from_millis(IDLE_POLL_MS)).await;
            continue;
        };

        tracing::info!(
            worker_id = %worker_id,
            job_id = %job.id,
            kind = %job.kind,
            attempt = job.attempts,
            "claimed background job"
        );

        let job_id = job.id.clone();
        let heartbeat_pool = state.pool.clone();
        let heartbeat_worker = worker_id.clone();
        let heartbeat_job_id = job_id.clone();
        let heartbeat_handle = tokio::spawn(async move {
            let interval = Duration::from_secs(heartbeat_seconds);
            loop {
                tokio::time::sleep(interval).await;
                match touch_job_heartbeat(&heartbeat_pool, &heartbeat_job_id, &heartbeat_worker).await {
                    Ok(true) => {}
                    Ok(false) => break,
                    Err(error) => {
                        tracing::warn!(
                            worker_id = %heartbeat_worker,
                            job_id = %heartbeat_job_id,
                            %error,
                            "job heartbeat failed"
                        );
                    }
                }
            }
        });

        match execute_job(state.clone(), job).await {
            Ok(()) => {
                tracing::info!(worker_id = %worker_id, job_id = %job_id, "background job finished");
            }
            Err(message) => {
                tracing::warn!(
                    worker_id = %worker_id,
                    job_id = %job_id,
                    error = %message,
                    "background job failed"
                );
            }
        }

        heartbeat_handle.abort();

        // Human: If execute exited without terminal status, free the lock so another worker can retry.
        // Agent: RE-QUEUES running rows still owned by this worker; PREVENTS orphan locks blocking dedup.
        match ensure_worker_released_job(&state.pool, &job_id, &worker_id).await {
            Ok(true) => {
                tracing::warn!(
                    worker_id = %worker_id,
                    job_id = %job_id,
                    "released orphaned running lock after worker finished"
                );
            }
            Ok(false) => {}
            Err(error) => {
                tracing::error!(
                    worker_id = %worker_id,
                    job_id = %job_id,
                    %error,
                    "failed to verify job lock was released"
                );
            }
        }
    }
}
