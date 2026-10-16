<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
  // when using `"withGlobalTauri": true`, you may use
  // const { enable, isEnabled, disable } = window.__TAURI__.autostart;

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

  async function init(): Promise<"ready" | "login"> {
    status = "checking";
    errorMessage = "";

    try {
      const mc = await ensureMc();
      const loggedIn = await isLoggedIn(mc);

      if (!(await isEnabled())) {
        void (await enable());
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
      errorMessage = e instanceof Error ? e.message : String(e);
      status = "error";
      throw e; // lets toast.promise show its error state
    }
  }

  function run() {
    toast.promise(init(), {
      loading: "Checking client…",
      success: (r) =>
        r === "login" ? "Sign in to your storage" : "Client ready",
      error: "Client setup failed",
    });
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
{/if}

{#if status == "checking"}
  <div class="h-screen flex justify-center items-center">
    <div class="animate-pulse"><Logo /></div>
  </div>
{/if}
<ModeWatcher />

<Toaster richColors closeButton visibleToasts={1} position="top-center" />
