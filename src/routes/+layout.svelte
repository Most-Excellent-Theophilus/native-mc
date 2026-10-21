<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { enable } from "@tauri-apps/plugin-autostart";

  import { page } from "$app/state";
  import { ensureMc } from "$lib/comands";
  import { localLogins, verifyLogin } from "$lib/mcAuth";
  import { Toaster } from "$lib/components/ui/sonner";
  import * as Alert from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { toast } from "svelte-sonner";
  import { ModeWatcher } from "mode-watcher";
  import "./main.css";
  import Logo from "$lib/components/logo.svelte";
  import InternetConnection from "$lib/components/internet-connection.svelte";

  let { children } = $props();

  let status = $state<"checking" | "ready" | "error">("checking");
  let errorMessage = $state("");

  // download progress: null = unknown size (indeterminate bar)
  let downloading = $state(false);
  let progress = $state<number | null>(null);

  // What the loading screen is waiting on, so a stall is visible instead of silent.
  let stage = $state("Starting…");

  async function init(toastId: string | number): Promise<"ready" | "login"> {
    status = "checking";
    errorMessage = "";
    downloading = false;
    progress = null;

    try {
      stage = "Checking storage client…";
      const mc = await ensureMc({
        onProgress: (p) => {
          downloading = true;
          progress = p;
          toast.loading(
            p === null ? "Downloading client…" : `Downloading client… ${p}%`,
            { id: toastId },
          );
        },
      });

      // download finished (or was never needed)
      downloading = false;
      toast.loading("Checking client…", { id: toastId });

      // Always (re)register the autostart entry (it carries --hidden). It has nothing to
      // do with being ready, so it must never hold up the UI.
      void enable().catch((e) => console.warn("Autostart not enabled:", e));

      // Only read mc's local config here: no network. Whether the server still accepts
      // the login is checked in the background below, so a slow or offline server can
      // never keep you on the loading screen (and never logs you out by itself).
      stage = "Reading saved login…";
      const logins = await localLogins(mc);

      if (logins.length === 0) {
        // don't redirect if we're already on the login page
        if (page.url.pathname !== "/auth") {
          await goto("/auth", { replaceState: true });
        }
        status = "ready";
        return "login";
      }

      status = "ready";
      void verifyLogin(mc, logins[0]).then(async (state) => {
        if (state === "invalid") {
          toast.error("The server rejected your saved login. Please sign in again.");
          if (page.url.pathname !== "/auth") await goto("/auth", { replaceState: true });
        }
      });
      return "ready";
    } catch (e) {
      downloading = false;
      errorMessage = e instanceof Error ? e.message : String(e);
      status = "error";
      throw e; // lets run() show the error toast
    }
  }

  function run() {
    const id = toast.loading("Checking client…");
    init(id)
      .then((r) =>
        toast.success(
          r === "login" ? "Sign in to your storage" : "Client ready",
          { id },
        ),
      )
      .catch(() => toast.error("Client setup failed", { id }));
  }

  onMount(run);
</script>

{#if status === "ready"}
  {@render children?.()}
{:else if status === "error"}
  <div
    class="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6"
  >
    <Alert.Root variant="destructive">
      <Alert.Title>Couldn't set up the storage client</Alert.Title>
      <Alert.Description>{errorMessage}</Alert.Description>
    </Alert.Root>
    <Button onclick={run}>Try again</Button>
  </div>
{:else}
  <div class="flex h-screen flex-col items-center justify-center gap-6">
    <div class="animate-pulse"><Logo /></div>
    {#if !downloading}
      <p class="text-xs text-muted-foreground">{stage}</p>
    {/if}

    {#if downloading}
      <div class="w-56">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full bg-primary transition-[width] duration-150 {progress ===
            null
              ? 'w-1/3 animate-pulse'
              : ''}"
            style:width={progress === null ? undefined : `${progress}%`}
          ></div>
        </div>
        <p class="mt-2 text-center text-xs text-muted-foreground">
          Downloading storage client{progress === null ? "…" : ` ${progress}%`}
        </p>
      </div>
    {/if}
  </div>
{/if}

<ModeWatcher />
<Toaster richColors closeButton visibleToasts={1} position="top-center" />
<InternetConnection />