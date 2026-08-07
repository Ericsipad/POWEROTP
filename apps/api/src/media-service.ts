import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpeg from "@ffmpeg-installer/ffmpeg";

const run = promisify(execFile);

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_DURATION_MS = 120_000;
const TARGET_SAMPLE_RATE = 8_000;

export class MediaValidationError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
  }
}

const magicByteSniffers: Array<{ format: string; test: (bytes: Buffer) => boolean }> = [
  {
    format: "wav",
    test: (bytes) =>
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WAVE",
  },
  {
    format: "mp3",
    test: (bytes) =>
      bytes.subarray(0, 3).toString("ascii") === "ID3" ||
      (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0),
  },
  { format: "m4a", test: (bytes) => bytes.subarray(4, 8).toString("ascii") === "ftyp" },
];

function detectFormat(bytes: Buffer): string {
  const sniffer = magicByteSniffers.find((entry) => entry.test(bytes));
  if (!sniffer) throw new MediaValidationError("unsupported_audio_format");
  return sniffer.format;
}

/**
 * Reads the byte length of a WAV file's `data` chunk by walking RIFF
 * chunks rather than assuming a fixed header size, since ffmpeg's WAV
 * muxer can add a `fact` or `LIST` chunk depending on the source codec.
 */
function wavDataChunkBytes(buffer: Buffer): number {
  let offset = 12; // past "RIFF"<size>"WAVE"
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "data") return chunkSize;
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  throw new MediaValidationError("invalid_normalized_audio");
}

export interface NormalizedRecording {
  buffer: Buffer;
  durationMs: number;
  checksumSha256: string;
}

/**
 * Validates an admin-uploaded recording (WAV, MP3, or M4A) and normalizes
 * it to 8kHz mono 16-bit PCM WAV — the canonical format every telephony
 * droplet plays back via ARI's `sound:` media type, matching the PJSIP
 * `allow=ulaw,alaw` codec set already used for calls (see
 * `apps/telephony-agent/src/pjsip-config.ts`). Normalization runs
 * entirely in-process via a static-binary FFmpeg
 * (`@ffmpeg-installer/ffmpeg`), so no system package, Aptfile, or custom
 * App Platform buildpack is required — DigitalOcean's Aptfile buildpack
 * does not reliably expose system FFmpeg to a running Node process.
 */
export async function normalizeRecording(upload: Buffer): Promise<NormalizedRecording> {
  if (upload.length === 0 || upload.length > MAX_UPLOAD_BYTES) {
    throw new MediaValidationError("upload_too_large");
  }
  const format = detectFormat(upload);

  const workDir = await mkdtemp(join(tmpdir(), "potp-media-"));
  const inputPath = join(workDir, `input.${format}`);
  const outputPath = join(workDir, "output.wav");
  try {
    await writeFile(inputPath, upload);
    await run(ffmpeg.path, [
      "-y",
      "-i",
      inputPath,
      "-ar",
      String(TARGET_SAMPLE_RATE),
      "-ac",
      "1",
      "-sample_fmt",
      "s16",
      "-f",
      "wav",
      outputPath,
    ]);

    const outputBuffer = await readFile(outputPath);
    const dataBytes = wavDataChunkBytes(outputBuffer);
    const durationMs = Math.round((dataBytes / 2 / TARGET_SAMPLE_RATE) * 1_000);
    if (durationMs <= 0) throw new MediaValidationError("invalid_normalized_audio");
    if (durationMs > MAX_DURATION_MS) throw new MediaValidationError("recording_too_long");

    return {
      buffer: outputBuffer,
      durationMs,
      checksumSha256: createHash("sha256").update(outputBuffer).digest("hex"),
    };
  } catch (error) {
    if (error instanceof MediaValidationError) throw error;
    throw new MediaValidationError("normalization_failed");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
