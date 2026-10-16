// src/lib/services/connectivity.svelte.ts

import { browser } from '$app/environment';

export type InternetStatus =
	| 'unknown'
	| 'checking'
	| 'online'
	| 'offline';

export interface ConnectivityOptions {
	/** URL that returns a successful response without authentication. */
	probeUrl: string;
	/** Timeout for each connectivity request. */
	timeoutMs?: number;
	/** Interval between checks while the page is visible. */
	intervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 30_000;

class ConnectivityService {
	status = $state<InternetStatus>('unknown');
	lastCheckedAt = $state<number | null>(null);

	private timer: ReturnType<typeof setInterval> | undefined;
	private controller: AbortController | undefined;
	private started = false;
	private generation = 0;

	private options: Required<ConnectivityOptions> = {
		probeUrl: '/api/connectivity',
		timeoutMs: DEFAULT_TIMEOUT_MS,
		intervalMs: DEFAULT_INTERVAL_MS
	};

	get isOnline(): boolean {
		return this.status === 'online';
	}

	get isOffline(): boolean {
		return this.status === 'offline';
	}

	configure(options: ConnectivityOptions): void {
		this.options = {
			probeUrl: options.probeUrl,
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS
		};
	}

	async check(): Promise<boolean> {
		if (!browser) return false;

		const generation = ++this.generation;

		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;

		this.status = 'checking';

		try {
			const response = await fetch(this.options.probeUrl, {
				method: 'GET',
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				signal: AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(this.options.timeoutMs)
				])
			});

			const online = response.ok;

			if (generation === this.generation) {
				this.status = online ? 'online' : 'offline';
				this.lastCheckedAt = Date.now();
			}

			return online;
		} catch {
			if (generation === this.generation) {
				this.status = 'offline';
				this.lastCheckedAt = Date.now();
			}

			return false;
		} finally {
			if (this.controller === controller) {
				this.controller = undefined;
			}
		}
	}

	start(): void {
		if (!browser || this.started) return;

		this.started = true;

		const check = () => {
			if (document.visibilityState === 'visible') {
				void this.check();
			}
		};

		const handleOnline = () => check();
		const handleOffline = () => {
			this.controller?.abort();
			this.generation++;
			this.status = 'offline';
			this.lastCheckedAt = Date.now();
		};

		const handleVisibility = () => {
			if (document.visibilityState === 'visible') check();
		};

		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
		document.addEventListener('visibilitychange', handleVisibility);

		this.listenersCleanup = () => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
			document.removeEventListener(
				'visibilitychange',
				handleVisibility
			);
		};

		this.timer = setInterval(check, this.options.intervalMs);
		check();
	}

	private listenersCleanup: (() => void) | undefined;

	stop(): void {
		this.started = false;
		this.generation++;
		this.controller?.abort();
		this.controller = undefined;
		this.listenersCleanup?.();
		this.listenersCleanup = undefined;

		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}
}

export const connectivity = new ConnectivityService();