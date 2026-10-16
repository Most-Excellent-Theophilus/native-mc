<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { enable, isEnabled } from "@tauri-apps/plugin-autostart";

  import { page } from "$app/state";
  import { ensureMc } from "$lib/comands";
  import { isLoggedIn } from "$lib/mcAuth";
  import { Toaster } from "$lib/components/ui/sonner";
  import * as Alert from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { toast } from "svelte-sonner";
  import { ModeWatcher } from "mode-watcher";
  import "./main.css";
  import Logo from "$lib/components/logo.svelte";

  let { children } = $props();

  let status = $state<"checking" | "ready" | "error">("checking");
  let errorMessage = $state("");

  // download progress: null = unknown size (indeterminate bar)
  let downloading = $state(false);
  let progress = $state<number | null>(null);

  async function init(toastId: string | number): Promise<"ready" | "login"> {
    status = "checking";
    errorMessage = "";
    downloading = false;
    progress = null;

    try {
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

      const loggedIn = await isLoggedIn(mc);

      if (!(await isEnabled())) {
        await enable();
      }

      if (!loggedIn) {
        // don't redirect if we're already on the login page
        if (page.url.pathname !== "/auth") {
          await goto("/auth", { replaceState: true });
        }
        status = "ready";
        return "login";
      }

      status = "ready";
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