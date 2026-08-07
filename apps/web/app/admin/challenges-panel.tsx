"use client";

import type { ChallengeDefinition, RecordingAsset } from "@powerotp/contracts";
import { useEffect, useState, type FormEvent } from "react";

interface ChallengesPanelProps {
  csrfToken: string;
}

const jsonHeaders = { "content-type": "application/json" };

/**
 * Admin-only recording upload and challenge authoring for `voice_challenge`
 * (Type 3). Recordings and challenges are immutable once published —
 * "editing" one is always retiring it and creating a new version, matching
 * `apps/api/src/challenge-service.ts`.
 */
export function ChallengesPanel({ csrfToken }: ChallengesPanelProps) {
  const [recordings, setRecordings] = useState<RecordingAsset[]>([]);
  const [challenges, setChallenges] = useState<ChallengeDefinition[]>([]);
  const [status, setStatus] = useState("");
  const [question, setQuestion] = useState("");
  const [recordingId, setRecordingId] = useState("");
  const [optionLabels, setOptionLabels] = useState(["", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [recordingsResponse, challengesResponse] = await Promise.all([
      fetch("/v1/admin/recordings", { credentials: "same-origin", cache: "no-store" }),
      fetch("/v1/admin/challenges", { credentials: "same-origin", cache: "no-store" }),
    ]);
    if (recordingsResponse.ok) {
      setRecordings((await recordingsResponse.json()).recordings);
    }
    if (challengesResponse.ok) {
      setChallenges((await challengesResponse.json()).challenges);
    }
  }

  async function uploadRecording(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setStatus("Uploading and normalizing…");
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch("/v1/admin/recordings", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrfToken },
      body: formData,
    });
    setStatus(response.ok ? "Recording published." : "Upload rejected — check format/duration.");
    if (response.ok) {
      input.value = "";
      await refresh();
    }
  }

  async function retireRecording(id: string) {
    await fetch(`/v1/admin/recordings/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrfToken },
    });
    await refresh();
  }

  async function createChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const options = optionLabels.filter((label) => label.trim().length > 0);
    if (!recordingId || options.length < 2) {
      setStatus("Pick a recording and at least two options.");
      return;
    }

    const response = await fetch("/v1/admin/challenges", {
      method: "POST",
      credentials: "same-origin",
      headers: { ...jsonHeaders, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        recordingAssetId: recordingId,
        question,
        options: options.map((label) => ({ label })),
        correctOptionIndexes: [correctIndex],
        allowsMultiple: false,
        minSelections: 1,
        maxSelections: 1,
      }),
    });
    setStatus(response.ok ? "Challenge published." : "Challenge rejected — check the form.");
    if (response.ok) {
      setQuestion("");
      setOptionLabels(["", ""]);
      setCorrectIndex(0);
      await refresh();
    }
  }

  async function retireChallenge(id: string) {
    await fetch(`/v1/admin/challenges/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrfToken },
    });
    await refresh();
  }

  return (
    <>
      <article className="projectCard">
        <h2>Voice challenge recordings</h2>
        <p>
          Upload a WAV, MP3, or M4A file. It is normalized to 8kHz mono audio and stored
          privately; only published, non-retired recordings can back a new challenge.
        </p>
        <form onSubmit={uploadRecording}>
          <input type="file" name="file" accept=".wav,.mp3,.m4a" required />
          <button className="button buttonSmall" type="submit">
            Upload
          </button>
        </form>
        <ul className="nodeList">
          {recordings.length === 0 && <li>No recordings published yet.</li>}
          {recordings.map((recording) => (
            <li key={recording.id}>
              <strong>{recording.id}</strong>
              {` — ${Math.round(recording.durationMs / 1000)}s, ${recording.status}`}
              {recording.status === "published" && (
                <button
                  className="button buttonSmall buttonGhost"
                  type="button"
                  onClick={() => retireRecording(recording.id)}
                >
                  Retire
                </button>
              )}
            </li>
          ))}
        </ul>
      </article>

      <article className="projectCard">
        <h2>Voice challenges</h2>
        <p>Question, options, and the single correct answer for a published recording.</p>
        <form onSubmit={createChallenge}>
          <label className="field">
            Recording
            <select value={recordingId} onChange={(event) => setRecordingId(event.target.value)}>
              <option value="">Select a published recording…</option>
              {recordings
                .filter((recording) => recording.status === "published")
                .map((recording) => (
                  <option key={recording.id} value={recording.id}>
                    {recording.id}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Question
            <input value={question} onChange={(event) => setQuestion(event.target.value)} required />
          </label>
          {optionLabels.map((label, index) => (
            <label className="field" key={index}>
              {`Option ${index + 1}`}
              <input
                value={label}
                onChange={(event) => {
                  const next = [...optionLabels];
                  next[index] = event.target.value;
                  setOptionLabels(next);
                }}
              />
              <input
                type="radio"
                name="correctOption"
                checked={correctIndex === index}
                onChange={() => setCorrectIndex(index)}
              />
              Correct
            </label>
          ))}
          <button
            className="button buttonSmall buttonGhost"
            type="button"
            onClick={() => setOptionLabels([...optionLabels, ""])}
          >
            Add option
          </button>
          <button className="button buttonSmall" type="submit">
            Publish challenge
          </button>
        </form>
        <ul className="nodeList">
          {challenges.length === 0 && <li>No challenges published yet.</li>}
          {challenges.map((challenge) => (
            <li key={challenge.id}>
              <strong>{challenge.question}</strong>
              {` — ${challenge.status}`}
              {challenge.status === "published" && (
                <button
                  className="button buttonSmall buttonGhost"
                  type="button"
                  onClick={() => retireChallenge(challenge.id)}
                >
                  Retire
                </button>
              )}
            </li>
          ))}
        </ul>
      </article>
      {status && <p>{status}</p>}
    </>
  );
}
