import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MediaValidationError, normalizeRecording } from "./media-service.js";

const SAMPLE_RATE = 44_100;

/** Builds a minimal, valid 16-bit PCM mono WAV file of pure silence. */
function buildSilentWav(seconds: number): Buffer {
  const sampleCount = SAMPLE_RATE * seconds;
  const dataSize = sampleCount * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize)]);
}

describe("normalizeRecording", () => {
  it("normalizes a valid WAV to 8kHz mono PCM with a matching checksum", async () => {
    const normalized = await normalizeRecording(buildSilentWav(1));
    assert.ok(normalized.durationMs > 900 && normalized.durationMs < 1_100);
    assert.equal(normalized.checksumSha256.length, 64);
    assert.equal(normalized.buffer.subarray(0, 4).toString("ascii"), "RIFF");
  });

  it("rejects a buffer that doesn't match any supported audio format", async () => {
    await assert.rejects(
      normalizeRecording(Buffer.from("not audio at all")),
      (error: unknown) =>
        error instanceof MediaValidationError && error.reasonCode === "unsupported_audio_format",
    );
  });

  it("rejects an upload over the size cap without even inspecting its contents", async () => {
    const oversized = Buffer.alloc(16 * 1024 * 1024);
    await assert.rejects(
      normalizeRecording(oversized),
      (error: unknown) => error instanceof MediaValidationError && error.reasonCode === "upload_too_large",
    );
  });

  it("rejects an empty upload", async () => {
    await assert.rejects(
      normalizeRecording(Buffer.alloc(0)),
      (error: unknown) => error instanceof MediaValidationError && error.reasonCode === "upload_too_large",
    );
  });
});
