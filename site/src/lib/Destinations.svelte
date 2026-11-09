<script lang="ts">
  import { api, type Capabilities, type Credentials, type Destination, type DestinationKind } from "./api";

  let {
    creds,
    destinations,
    caps,
    onchange,
    onflash,
  }: {
    creds: Credentials;
    destinations: Destination[];
    caps: Capabilities | null;
    onchange: () => void;
    onflash: (message: string, tone: "good" | "bad") => void;
  } = $props();

  interface Field {
    name: string;
    label: string;
    placeholder: string;
    hint?: string;
  }

  const FIELDS: Record<DestinationKind, Field[]> = {
    email: [
      { name: "to", label: "Send to", placeholder: "you@example.com" },
      {
        name: "from",
        label: "From",
        placeholder: "Smiles <smiles@yourdomain.com>",
        hint: "A domain you have verified with Resend. Falls back to the RESEND_FROM set on the API.",
      },
    ],
    slack: [
      { name: "webhook_url", label: "Incoming webhook URL", placeholder: "https://hooks.slack.com/services/..." },
    ],
    discord: [
      {
        name: "webhook_url",
        label: "Channel webhook URL",
        placeholder: "https://discord.com/api/webhooks/...",
        hint: "Channel settings, Integrations, Webhooks, New webhook, Copy URL.",
      },
    ],
    webhook: [
      { name: "url", label: "Endpoint", placeholder: "https://example.com/smiles" },
      {
        name: "secret",
        label: "Signing secret (optional)",
        placeholder: "a long random string",
        hint: "We send x-smiles-signature: sha256=<hmac of the body>.",
      },
    ],
  };

  const NAMES: Record<DestinationKind, string> = {
    email: "Email",
    slack: "Slack",
    discord: "Discord",
    webhook: "Webhook",
  };

  let kind = $state<DestinationKind>("email");
  let values = $state<Record<string, string>>({});
  let onlyBad = $state(false);
  let testing = $state<number | null>(null);

  const fields = $derived(FIELDS[kind]);
  const canConnect = $derived(
    (kind === "email" && caps?.connect.resend) ||
      (kind === "slack" && caps?.connect.slack) ||
      (kind === "discord" && caps?.connect.discord),
  );

  const describe = (dest: Destination) =>
    dest.kind === "email"
      ? dest.config.to
      : dest.kind === "webhook"
        ? dest.config.url
        : (dest.config.webhook_url ?? "").split("?")[0];

  const connectHref = $derived(
    kind === "email"
      ? api.connectUrl("resend", creds, { to: values.to ?? "", from: values.from ?? "" })
      : api.connectUrl(kind, creds),
  );

  async function add() {
    const config: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.name]?.trim();
      if (value) config[field.name] = value;
    }

    try {
      await api.addDestination(creds, { kind, config, only_bad: onlyBad });
      values = {};
      onlyBad = false;
      onflash("Destination added.", "good");
      onchange();
    } catch (err) {
      onflash(err instanceof Error ? err.message : String(err), "bad");
    }
  }

  async function test(id: number) {
    testing = id;
    try {
      await api.testDestination(creds, id);
      onflash("Test sent.", "good");
    } catch (err) {
      onflash(`Test failed: ${err instanceof Error ? err.message : String(err)}`, "bad");
    } finally {
      testing = null;
    }
  }

  async function remove(id: number) {
    try {
      await api.removeDestination(creds, id);
      onchange();
    } catch (err) {
      onflash(err instanceof Error ? err.message : String(err), "bad");
    }
  }
</script>

<div class="panel">
  <div class="panel-head"><h3>Where answers go</h3></div>
  <p class="muted" style="margin-bottom:18px">
    Every answer is sent to each destination below. Tick "only unhappy answers" if you would rather hear
    about the bad ones alone.
  </p>

  {#if destinations.length === 0}
    <p class="empty">No destinations yet. Answers are still recorded, they just stay in the dashboard.</p>
  {:else}
    {#each destinations as dest (dest.id)}
      <div class="dest">
        <span class="tag">{dest.kind}</span>
        <span class="dest-main">
          <strong>{dest.label || NAMES[dest.kind]}</strong>
          <span>{describe(dest)}{dest.only_bad ? " · unhappy answers only" : ""}</span>
        </span>
        <button class="btn btn-small btn-quiet" onclick={() => test(dest.id)} disabled={testing === dest.id}>
          {testing === dest.id ? "Sending..." : "Test"}
        </button>
        <button class="btn btn-small btn-quiet" onclick={() => remove(dest.id)}>Remove</button>
      </div>
    {/each}
  {/if}

  <div style="margin-top:22px;padding-top:22px;border-top:1px solid var(--line)">
    <div class="field">
      <label for="dest-kind">Add a destination</label>
      <select id="dest-kind" bind:value={kind}>
        <option value="email">Email (via Resend)</option>
        <option value="slack">Slack</option>
        <option value="discord">Discord</option>
        <option value="webhook">Custom webhook</option>
      </select>
    </div>

    {#if kind === "email" && caps?.connect.resend}
      <p class="hint" style="margin:-6px 0 14px">
        Fill in the address below, then connect your Resend account. No API key changes hands, and you can
        revoke it from Resend at any time.
      </p>
    {/if}

    {#each fields as field (field.name)}
      <div class="field">
        <label for="dest-{field.name}">{field.label}</label>
        <input id="dest-{field.name}" bind:value={values[field.name]} placeholder={field.placeholder} />
        {#if field.hint}<p class="hint">{field.hint}</p>{/if}
      </div>
    {/each}

    <label style="display:block;margin:6px 0 16px;font-size:14px;color:var(--muted)">
      <input type="checkbox" bind:checked={onlyBad} style="width:auto;margin-right:6px" />only unhappy answers
    </label>

    {#if canConnect}
      <a class="btn btn-small" href={connectHref}>Connect {NAMES[kind]}</a>
    {/if}
    <button class="btn btn-small btn-quiet" onclick={add}>Add destination</button>
  </div>
</div>
