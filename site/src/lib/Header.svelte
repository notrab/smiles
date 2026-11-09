<script lang="ts">
  let { current = "" }: { current?: string } = $props();

  const links = [
    { key: "home", href: "index.html", label: "Home" },
    { key: "how", href: "how-it-works.html", label: "How it works" },
    { key: "signup", href: "signup.html", label: "Sign up" },
  ];
</script>

<header class="site-header">
  <div class="wrap">
    <a class="logo" href="index.html">
      <svg width="26" height="26" viewBox="0 0 48 48" aria-hidden="true" style="color:#49b571">
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="3.5" />
        <circle cx="16" cy="18" r="3" fill="currentColor" />
        <circle cx="32" cy="18" r="3" fill="currentColor" />
        <path d="M14,25 Q24,35 34,25" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" />
      </svg>
      Smiles
    </a>
    <nav class="nav">
      {#each links as link (link.key)}
        <a href={link.href} class:active={current === link.key}>{link.label}</a>
      {/each}
      <a href="app.html" class:active={current === "app"}>
        {current === "app" ? "Dashboard" : "Log in"}
      </a>
    </nav>
  </div>
</header>
