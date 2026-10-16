<!-- src/lib/components/user-button.svelte -->
<script lang="ts">
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Avatar from "$lib/components/ui/avatar";
  import { Button } from "$lib/components/ui/button";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { ensureMc } from "$lib/comands";
  import { removeAlias } from "$lib/mcAuth";
  import { settings } from "$lib/store/settings.svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { Mail } from "@lucide/svelte";

  let signingOut = $state(false);

  const accessKey = $derived(settings.data.s3AccessKey);
  const endpoint = $derived(settings.data.s3Endpoint);
  const initials = $derived((accessKey || "?").slice(0, 2).toUpperCase());
  const host = $derived.by(() => {
    try {
      return new URL(endpoint).host;
    } catch {
      return endpoint;
    }
  });

  async function signOut() {
    signingOut = true;
    try {
      const id = toast.loading("Signing Out");
      const mc = await ensureMc();
      void (await Promise.allSettled([
        await removeAlias(mc, settings.data.s3Alias || "app"),
        await settings.set("s3AccessKey", ""),
        await settings.set("s3Alias", ""),
        await goto(resolve("/auth"), { replaceState: true }),
      ]).finally(() => toast.success("Signed out!", { id })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign out failed");
    } finally {
      signingOut = false;
    }
  }
</script>

{#if accessKey}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon"
          class="rounded-full"
          aria-label="User menu"
        >
          <Avatar.Root class="size-8">
            <Avatar.Fallback class="text-xs font-medium"
              >{initials}</Avatar.Fallback
            >
          </Avatar.Root>
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>

    <DropdownMenu.Content align="end" class="w-56">
      <DropdownMenu.Label class="font-normal">
        <div class="flex flex-col gap-0.5">
          <span class="truncate text-sm font-medium">{accessKey}</span>
          <span class="truncate text-xs text-muted-foreground">{host}</span>
        </div>
      </DropdownMenu.Label>

      <DropdownMenu.Item
        onclick={async () => {
          void (await openUrl("https://digital-friends.com/#info"));
        }}
      >
        <Mail /> Contact For Support
      </DropdownMenu.Item>

      <DropdownMenu.Separator />
      <DropdownMenu.Item
        class="cursor-pointer text-destructive focus:text-destructive"
        disabled={signingOut}
        onSelect={signOut}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
