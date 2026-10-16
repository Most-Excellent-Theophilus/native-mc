<!-- src/routes/auth/login/+page.svelte -->
<script lang="ts">
  import * as Form from "formsnap";
  import { onMount } from "svelte";
  import { defaults, setError, superForm } from "sveltekit-superforms";
  import { zod4 } from "sveltekit-superforms/adapters";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import { ensureMc } from "$lib/comands";
  import { setAlias } from "$lib/mcAuth";
  import { settings } from "$lib/store/settings.svelte";
  import { loginSchema } from "./network-schema";
  import { Eye, EyeClosed } from "@lucide/svelte";

  const MC_ALIAS = "app";
  let showPassword = $state(false);
  const form = superForm(defaults(zod4(loginSchema)), {
    SPA: true,
    validators: zod4(loginSchema),
    dataType: "json",
    resetForm: false,
    onUpdate: async ({ form: f }) => {
      if (!f.valid) {
        toast.error("Please fix the errors before continuing.");
        return;
      }
      const { endpoint, accessKey, secretKey } = f.data;
      try {
        const mc = await ensureMc();
        await setAlias(mc, MC_ALIAS, endpoint, accessKey, secretKey);

        // Save the non-secret parts. mc keeps the secret in its own config.
        await settings.set("s3Endpoint", endpoint);
        await settings.set("s3AccessKey", accessKey);
        await settings.set("s3Alias", MC_ALIAS);

        $formData.secretKey = "";
        toast.success("Logged in");
        await goto(resolve("/"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Login failed");
        setError(f, "secretKey", msg);
      }
    },
  });

  const { form: formData, enhance, submitting } = form;

  // Pre-fill from saved settings once the store has loaded.
  onMount(async () => {
    await settings.hydrated;
    if (!$formData.endpoint) $formData.endpoint = settings.data.s3Endpoint;
    if (!$formData.accessKey) $formData.accessKey = settings.data.s3AccessKey;
  });
</script>

<div class="flex flex-1 items-center justify-center">
  <div class="w-full max-w-xs px-3">
    <form method="POST" use:enhance>
      <div class="space-y-3 overflow-y-auto py-4">
        <div class="flex flex-col items-center gap-1 text-center">
          <h1 class="text-2xl font-bold">Storage login</h1>
          <p class="text-sm text-balance text-muted-foreground">
            Enter your S3-compatible storage details
          </p>
        </div>

        <Form.Field {form} name="endpoint">
          <Form.Control>
            {#snippet children({ props })}
              <div>
                <Form.Label class="text-xs"
                  >Endpoint <span class="text-destructive">*</span></Form.Label
                >
                <Input
                  {...props}
                  bind:value={$formData.endpoint}
                  placeholder="http://192.168.1.100:9000"
                  class="h-10"
                />
                <Form.FieldErrors class="mt-0.5 text-xs text-destructive" />
              </div>
            {/snippet}
          </Form.Control>
        </Form.Field>

        <Form.Field {form} name="accessKey">
          <Form.Control>
            {#snippet children({ props })}
              <div>
                <Form.Label class="text-xs"
                  >Username / Access key <span class="text-destructive">*</span
                  ></Form.Label
                >
                <Input
                  {...props}
                  bind:value={$formData.accessKey}
                  autocomplete="off"
                  class="h-10"
                />
                <Form.FieldErrors class="mt-0.5 text-xs text-destructive" />
              </div>
            {/snippet}
          </Form.Control>
        </Form.Field>

        <Form.Field {form} name="secretKey">
          <Form.Control>
            {#snippet children({ props })}
              <div>
                <Form.Label class="text-xs"
                  >Password / Secret key<span class="text-destructive">*</span
                  ></Form.Label
                >
                <div class="relative h-10">
                  <Input
                    {...props}
                    type={showPassword ? "text" : "password"}
                    bind:value={$formData.secretKey}
                    autocomplete="off"
                    class=" h-full"
                  />
                  <Button
                    onclick={() => (showPassword = !showPassword)}
                    class="absolute right-0 h-full"
					variant='ghost'
					size='icon-lg'
                  >
                    {#if showPassword}
                      <Eye />
                    {:else}
                      <EyeClosed />
                    {/if}
                  </Button>
                </div>

                <Form.FieldErrors class="mt-0.5 text-xs text-destructive" />
              </div>
            {/snippet}
          </Form.Control>
        </Form.Field>
      </div>

      <Button
        type="submit"
        disabled={$submitting}
        class="h-10 w-full cursor-pointer px-6"
      >
        {$submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  </div>
</div>
