
<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	onMount(() => {
		const handleOffline = () => {
			toast.error('No internet connection', {
				description: 'Check your internet connection and try again.',
				duration: Infinity,
				id: 'internet-offline',

                closeButton:false,
                action :{
                    label: 'Reconnect!',
                    onClick : ()=> {
window.location.reload()
                    }
                }
			});
		};

		const handleOnline = () => {
			toast.dismiss('internet-offline');

			toast.success('Internet connection restored', {
				description: 'You are back online.',
				duration: 3000
			});
		};

		window.addEventListener('offline', handleOffline);
		window.addEventListener('online', handleOnline);

		// Handle a page opened while already offline.
		if (!navigator.onLine) {
			handleOffline();
		}

		return () => {
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('online', handleOnline);
			toast.dismiss('internet-offline');
		};
	});
</script>
