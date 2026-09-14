import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader } from "~/components/ui";
import { createOrg } from "~/server/functions/identity";

export const Route = createFileRoute("/_app/organizations/new")({ component: NewOrganization });

function NewOrganization() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Create an organization" description="You become its owner. Invite members afterwards; each member pairs their own machine." />
      <Card>
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault(); setError(null);
          const result = await createOrg({ data: { name, slug } });
          if (!result.ok) { setError(result.error); return; }
          await router.invalidate();
          await router.navigate({ to: "/" });
        }}>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Organization name"><Input value={name} onChange={event => setName(event.target.value)} required maxLength={120} /></Field>
          <Field label="Slug" hint="Lowercase identifier used in links."><Input value={slug} readOnly /></Field>
          <Button type="submit" disabled={slug.length < 2}>Create organization</Button>
        </form>
      </Card>
    </div>
  );
}
