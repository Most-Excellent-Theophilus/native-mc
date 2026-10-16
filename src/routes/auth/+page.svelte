<script>
  import Logo from "$lib/components/logo.svelte";
  import NetworkForm from "$lib/components/network/network-form.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import Button from "$lib/components/ui/button/button.svelte";
  import { Mail } from "@lucide/svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
</script>

<div class="flex   md:grid md:grid-cols-2 h-screen items-center justify-around">
  <div class="h-full flex flex-col">
    <div class="flex items-center space-x-1.5 px-3 pt-2.5 justify-between">
      <div class="flex items-center space-x-1.5 px-3">
        <Logo class="size-8" />
        <p class="text-primary font-bold">One BackUp</p>
      </div>

      <ThemeToggle />
    </div>
    <div class="flex-1 flex justify-center">
      <NetworkForm />
    </div>
    <div class="p-4">
      <Button
      
        variant="link"
        onclick={() => {
          openUrl("https://digital-friends.com/#info", );
        }}
      >
        <Mail /> Contact for support!</Button
      >
    </div>
  </div>
  <div
    class="bg-accent-foreground/5 hidden md:flex justify-center items-center h-full w-full"
  >
    <Logo />
  </div>
</div>
