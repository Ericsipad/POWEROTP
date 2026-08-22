import type { Project } from "@/lib/contracts";

export function HostedAuthStaticDetails({ project }: { project: Project }) {
  return (
    <>
      <div className="hostedUrlGrid">
        <div>
          <strong>Hosted sign-up URL</strong>
          <code>{project.signupHostedUrl}</code>
        </div>
        <div>
          <strong>Hosted sign-in URL</strong>
          <code>{project.signinHostedUrl}</code>
        </div>
      </div>

      <div className="templateControls" aria-label="Hosted page templates">
        <label className="field">
          Sign-up template
          <select disabled>
            <option>Template 1 — available in Phase 5</option>
          </select>
        </label>
        <button className="button buttonSmall buttonGhost" disabled type="button">
          Edit sign-up template
        </button>
        <label className="field">
          Sign-in template
          <select disabled>
            <option>Template 1 — available in Phase 5</option>
          </select>
        </label>
        <button className="button buttonSmall buttonGhost" disabled type="button">
          Edit sign-in template
        </button>
      </div>
    </>
  );
}
