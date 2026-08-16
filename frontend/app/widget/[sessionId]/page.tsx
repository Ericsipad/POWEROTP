import { WidgetClient } from "./widget-client";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

/**
 * The hosted, POWEROTP-branded verification modal — see
 * `docs/AS_BUILT.md`'s "Hosted verification modal" section. A customer's
 * own site embeds this page (typically in an iframe) after its backend
 * creates a modal session with its project API key
 * (`POST /v1/projects/{slug}/modal-sessions`); the end user then types
 * their own phone number here, never on the customer's own site.
 */
export default async function WidgetPage({ params }: PageProps) {
  const { sessionId } = await params;
  return (
    <main className="widgetPage">
      <WidgetClient sessionId={sessionId} />
    </main>
  );
}
