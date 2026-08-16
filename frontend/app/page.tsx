import { SignupCta } from "./signup-cta";
import { TryItNow } from "./try-it-now";

const methods = [
  {
    number: "01",
    title: "Call reachability",
    text: "Confirm that a destination answers a live call. Reachability is reported accurately without claiming ownership.",
  },
  {
    number: "02",
    title: "Voice code",
    text: "Loop a five-digit code over a call and verify the code submitted through your application.",
  },
  {
    number: "03",
    title: "Voice challenge",
    text: "Play a controlled recording, return question JSON, and validate opaque answer IDs on POWEROTP servers.",
  },
  {
    number: "04",
    title: "SMS code",
    text: "Send and validate short-lived codes through the same API lifecycle and callback contract.",
  },
] as const;

const mcpConfig = `{
  "mcpServers": {
    "powerotp": {
      "url": "https://api.powerotp.com/mcp"
    }
  }
}`;

export default function Home() {
  return (
    <main>
      <nav className="nav shell" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="POWEROTP home">
          <span className="brandMark">P</span>
          POWEROTP
        </a>
        <div className="navLinks">
          <a href="#methods">Methods</a>
          <a href="#integration">Integration</a>
          <a className="button buttonSmall buttonGhost" href="/login">
            Client login
          </a>
          <SignupCta className="button buttonSmall">Sign up</SignupCta>
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="heroGrid">
          <div className="heroMain">
            <div className="eyebrow">
              <span className="pulse" />
              Programmable phone verification
            </div>
            <h1>Production ready in 5 minutes.</h1>
            <p className="heroMcpLine">
              <code>https://api.powerotp.com/mcp</code> — paste this to your AI tools.
            </p>
            <div className="heroActions">
              <SignupCta className="button">Get API key now</SignupCta>
              <a className="textLink" href="#integration">
                See the API flow
              </a>
            </div>
            <p className="heroFreeTierNote">No card required · Free usage tier included</p>
            <div className="statusStrip">
              <span>Request accepted</span>
              <i>→</i>
              <span>Calling</span>
              <i>→</i>
              <span>Ringing</span>
              <i>→</i>
              <span>Answered</span>
              <i>→</i>
              <span>Awaiting response</span>
              <i>→</i>
              <strong>Success</strong>
            </div>
          </div>
          <TryItNow />
        </div>
      </section>

      <section className="section shell" id="methods">
        <div className="sectionHeading">
          <span>Verification methods</span>
          <h2>Choose the right proof for every interaction.</h2>
        </div>
        <div className="methodGrid">
          {methods.map((method) => (
            <article className="methodCard" key={method.number}>
              <span className="methodNumber">{method.number}</span>
              <h3>{method.title}</h3>
              <p>{method.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="integration" id="integration">
        <div className="shell integrationGrid">
          <div>
            <span className="sectionLabel">Designed for developers</span>
            <h2>Your server starts it. Your UI completes it.</h2>
            <ol className="steps">
              <li>
                <b>1</b>
                <span>Send the method and E.164 target to your preset project URL.</span>
              </li>
              <li>
                <b>2</b>
                <span>Follow signed callback events using the interaction ID.</span>
              </li>
              <li>
                <b>3</b>
                <span>Submit the user response with your server key or a short-lived token.</span>
              </li>
            </ol>
          </div>
          <div className="codePanel">
            <div className="codeTop">
              <span>Copy this to your AI</span>
              <span className="readOnly">PUBLIC · READ ONLY</span>
            </div>
            <pre>
              <code>{mcpConfig}</code>
            </pre>
            <p>
              Gives Cursor, Claude, and other MCP clients the current POWEROTP
              API structures and integration instructions—never project data or credentials.
            </p>
          </div>
        </div>
      </section>

      <footer className="shell footer">
        <a className="brand" href="#top">
          <span className="brandMark">P</span>
          POWEROTP
        </a>
        <p>Phone verification infrastructure built for observable interactions.</p>
      </footer>
    </main>
  );
}
