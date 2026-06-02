// Human: Optional GPU-assisted H.264 encoding for long HLS ingest jobs.
// Agent: READS HLS_HARDWARE_ENCODE env; PROBES ffmpeg encoders + device nodes at startup; FALLBACK CPU on failure.

use std::path::Path;

use crate::config::Config;

/// Human: Operator preference for hardware-assisted ffmpeg video encoding.
/// Agent: PARSED from HLS_HARDWARE_ENCODE; AUTO tries NVENC → VAAPI → QSV when devices exist.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HardwareEncodePreference {
    Off,
    Auto,
    Nvenc,
    Vaapi,
    Qsv,
}

/// Human: Encoder chosen after startup probe — passed into ffmpeg for full transcodes only.
/// Agent: CPU when disabled/unavailable; NVENC/VAAPI/QSV when probed successfully.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolvedHardwareEncoder {
    Cpu,
    Nvenc,
    Vaapi,
    Qsv,
}

/// Human: Resolved hardware encode settings shared across background HLS workers.
/// Agent: CLONED from AppState; READ by HlsEncoder before spawning ffmpeg.
#[derive(Clone, Debug)]
pub struct HlsHardwareEncode {
    pub preference: HardwareEncodePreference,
    pub resolved: ResolvedHardwareEncoder,
    pub vaapi_device: String,
    /// Human: libx264 CRF for GOP-aligned segment re-encode.
    pub video_crf: u8,
    /// Human: NVENC / VAAPI / QSV quality for align-path encode.
    pub video_quality: u8,
    /// Human: CRF/CQ/QP for full transcode (smaller disk when raised).
    pub full_transcode_quality: u8,
    pub large_maxrate: String,
    pub large_bufsize: String,
}

impl HlsHardwareEncode {
    // Human: Build from env-backed Config before async device probing runs.
    // Agent: DEFAULT resolved=CPU until detect_and_log completes.
    pub fn from_config(config: &Config) -> Self {
        Self {
            preference: parse_hardware_preference(&config.hls_hardware_encode),
            resolved: ResolvedHardwareEncoder::Cpu,
            vaapi_device: config.hls_vaapi_device.clone(),
            video_crf: config.hls_video_crf,
            video_quality: config.hls_video_quality,
            full_transcode_quality: config.hls_full_transcode_quality,
            large_maxrate: config.hls_large_maxrate.clone(),
            large_bufsize: config.hls_large_bufsize.clone(),
        }
    }

    // Human: Probe ffmpeg encoders and GPU device nodes once at API startup.
    // Agent: WRITES resolved; LOGS preference + outcome for ops debugging.
    pub async fn detect_and_log(&mut self) {
        self.resolved = self.detect().await;
        tracing::info!(
            preference = ?self.preference,
            resolved = ?self.resolved,
            vaapi_device = %self.vaapi_device,
            "HLS hardware encoder probe complete"
        );
    }

    // Human: True when a non-CPU encoder was resolved for full transcode attempts.
    // Agent: FALSE when HLS_HARDWARE_ENCODE=off or no GPU device is present.
    pub fn use_hardware_for_full_transcode(&self) -> bool {
        self.resolved != ResolvedHardwareEncoder::Cpu
    }

    async fn detect(&self) -> ResolvedHardwareEncoder {
        if self.preference == HardwareEncodePreference::Off {
            return ResolvedHardwareEncoder::Cpu;
        }

        let encoders = ffmpeg_encoders_stdout().await;
        for candidate in self.candidate_order() {
            if !encoder_listed(&encoders, candidate) {
                continue;
            }
            if !device_available(candidate, &self.vaapi_device) {
                tracing::debug!(
                    encoder = ?candidate,
                    "ffmpeg lists encoder but required device path is unavailable"
                );
                continue;
            }
            return candidate;
        }

        ResolvedHardwareEncoder::Cpu
    }

    fn candidate_order(&self) -> Vec<ResolvedHardwareEncoder> {
        match self.preference {
            HardwareEncodePreference::Off => Vec::new(),
            HardwareEncodePreference::Auto => vec![
                ResolvedHardwareEncoder::Nvenc,
                ResolvedHardwareEncoder::Vaapi,
                ResolvedHardwareEncoder::Qsv,
            ],
            HardwareEncodePreference::Nvenc => vec![ResolvedHardwareEncoder::Nvenc],
            HardwareEncodePreference::Vaapi => vec![ResolvedHardwareEncoder::Vaapi],
            HardwareEncodePreference::Qsv => vec![ResolvedHardwareEncoder::Qsv],
        }
    }
}

// Human: Parse HLS_HARDWARE_ENCODE — unknown values fall back to auto with a warning.
// Agent: ACCEPTS off/auto/nvenc/vaapi/qsv and common aliases (cuda, cpu, none).
fn parse_hardware_preference(raw: &str) -> HardwareEncodePreference {
    match raw.trim().to_lowercase().as_str() {
        "" | "auto" => HardwareEncodePreference::Auto,
        "off" | "none" | "cpu" | "disabled" => HardwareEncodePreference::Off,
        "nvenc" | "cuda" | "nvidia" => HardwareEncodePreference::Nvenc,
        "vaapi" => HardwareEncodePreference::Vaapi,
        "qsv" | "intel" => HardwareEncodePreference::Qsv,
        other => {
            tracing::warn!(
                value = %other,
                "unknown HLS_HARDWARE_ENCODE; defaulting to auto"
            );
            HardwareEncodePreference::Auto
        }
    }
}

async fn ffmpeg_encoders_stdout() -> String {
    tokio::process::Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .await
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default()
}

fn encoder_listed(encoders: &str, encoder: ResolvedHardwareEncoder) -> bool {
    let needle = match encoder {
        ResolvedHardwareEncoder::Cpu => return false,
        ResolvedHardwareEncoder::Nvenc => "h264_nvenc",
        ResolvedHardwareEncoder::Vaapi => "h264_vaapi",
        ResolvedHardwareEncoder::Qsv => "h264_qsv",
    };
    encoders.contains(needle)
}

fn device_available(encoder: ResolvedHardwareEncoder, vaapi_device: &str) -> bool {
    match encoder {
        ResolvedHardwareEncoder::Cpu => false,
        ResolvedHardwareEncoder::Nvenc => nvenc_available(),
        ResolvedHardwareEncoder::Vaapi | ResolvedHardwareEncoder::Qsv => {
            Path::new(vaapi_device).exists()
        }
    }
}

// Human: NVENC needs a GPU device node plus libnvidia-encode mounted into the container.
// Agent: /dev/nvidia0 on Linux toolkit hosts; /dev/dxg on Docker Desktop WSL2; CHECKS ldconfig for encode lib.
fn nvenc_available() -> bool {
    let device_present =
        Path::new("/dev/nvidia0").exists() || Path::new("/dev/dxg").exists();
    if !device_present {
        return false;
    }

    std::process::Command::new("ldconfig")
        .arg("-p")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .is_some_and(|libraries| libraries.contains("libnvidia-encode"))
}

/// Human: Append ffmpeg flags for full H.264 transcode using CPU or a hardware encoder.
/// Agent: WRITES pre_input (before `-i`) and encode_args (after input path); SHARED audio downmix.
pub fn append_full_transcode_encoder_args(
    pre_input: &mut Vec<String>,
    encode_args: &mut Vec<String>,
    encoder: ResolvedHardwareEncoder,
    vaapi_device: &str,
    full_transcode_quality: u8,
) {
    let q = full_transcode_quality.to_string();
    match encoder {
        ResolvedHardwareEncoder::Cpu => {
            encode_args.extend([
                "-threads".into(),
                "0".into(),
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "ultrafast".into(),
                "-crf".into(),
                q.clone(),
                "-vf".into(),
                "scale='min(1920,iw)':-2,format=yuv420p".into(),
            ]);
        }
        ResolvedHardwareEncoder::Nvenc => {
            // Human: Software decode + NVENC encode — works with NVIDIA Container Toolkit passthrough.
            // Agent: AVOIDS CUDA hwaccel decode so ingest survives hosts without full CUDA decode.
            encode_args.extend([
                "-c:v".into(),
                "h264_nvenc".into(),
                "-preset".into(),
                "p4".into(),
                "-rc".into(),
                "vbr".into(),
                "-cq".into(),
                q.clone(),
                "-vf".into(),
                "scale='min(1920,iw)':-2,format=yuv420p".into(),
            ]);
        }
        ResolvedHardwareEncoder::Vaapi => {
            pre_input.extend([
                "-vaapi_device".into(),
                vaapi_device.to_string(),
            ]);
            encode_args.extend([
                "-vf".into(),
                "format=nv12,hwupload,scale_vaapi=1920:800:force_original_aspect_ratio=decrease"
                    .into(),
                "-c:v".into(),
                "h264_vaapi".into(),
                "-qp".into(),
                q.clone(),
            ]);
        }
        ResolvedHardwareEncoder::Qsv => {
            pre_input.extend([
                "-init_hw_device".into(),
                "qsv=hw".into(),
                "-filter_hw_device".into(),
                "hw".into(),
            ]);
            encode_args.extend([
                "-vf".into(),
                "format=nv12,hwupload=extra_hw_frames=64,scale_qsv=w=1920:h=-2".into(),
                "-c:v".into(),
                "h264_qsv".into(),
                "-preset".into(),
                "veryfast".into(),
                "-global_quality".into(),
                q,
            ]);
        }
    }

    encode_args.extend([
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "128k".into(),
        "-ac".into(),
        "2".into(),
    ]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hardware_preference_values() {
        assert_eq!(
            parse_hardware_preference("auto"),
            HardwareEncodePreference::Auto
        );
        assert_eq!(parse_hardware_preference("off"), HardwareEncodePreference::Off);
        assert_eq!(
            parse_hardware_preference("nvenc"),
            HardwareEncodePreference::Nvenc
        );
        assert_eq!(
            parse_hardware_preference("unknown"),
            HardwareEncodePreference::Auto
        );
    }

    #[test]
    fn cpu_encoder_args_include_libx264() {
        let mut pre = Vec::new();
        let mut encode = Vec::new();
        append_full_transcode_encoder_args(
            &mut pre,
            &mut encode,
            ResolvedHardwareEncoder::Cpu,
            "/dev/dri/renderD128",
            26,
        );
        assert!(pre.is_empty());
        assert!(encode.iter().any(|arg| arg == "libx264"));
    }

    #[test]
    fn nvenc_encoder_args_include_h264_nvenc() {
        let mut pre = Vec::new();
        let mut encode = Vec::new();
        append_full_transcode_encoder_args(
            &mut pre,
            &mut encode,
            ResolvedHardwareEncoder::Nvenc,
            "/dev/dri/renderD128",
            26,
        );
        assert!(encode.iter().any(|arg| arg == "h264_nvenc"));
    }
}
